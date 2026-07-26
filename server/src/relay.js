import { Router } from 'express'
import { encode } from 'gpt-tokenizer'
import { db, now, getSetting } from './db.js'
import { computeCost } from './pricing.js'
import { RELAY_TIMEOUT_MS } from './config.js'
import {
  buildUpstreamRequest, convertResponse, createStreamTransformer, wantsThinking,
  buildAnthropicPassthrough, anthropicUsage
} from './adapters.js'
import {
  anthropicRequestToOpenAI, openaiResponseToAnthropic, createAnthropicEncoder, anthropicErrorBody
} from './protocols/anthropic-in.js'
import { splitModels, splitList, channelServesGroup, redactSecrets } from './util.js'
import { consumeRelayQuota } from './middleware/ratelimit.js'

const router = Router()

// 连续失败 3 次熔断,由健康检查定时探活恢复
const FAIL_THRESHOLD = 3

// ---- 预扣费 ----
// 只在响应回来后扣费是不安全的:余额检查和实际扣费之间存在时间窗,
// 用户并发发起大量请求时每一个都能通过「余额 > 0」的检查,最终花掉的
// 上游成本远超其余额(实测:$0.1 余额并发 20 个请求可造成 $72 的敞口)。
// 因此改为请求前按「输入 + 预估输出」原子冻结额度,响应后按实际用量多退少补。
const estimatedCompletion = () => Number(getSetting('precharge_completion_tokens', '4096')) || 4096
const thinkingAllowance = () => Number(getSetting('precharge_thinking_tokens', '8192')) || 8192
const maxConcurrent = () => Number(getSetting('max_concurrent_per_user', '0')) || 0
// 一次请求最多尝试几个渠道(故障转移次数),此前写死为 3
const retryChannels = () => Math.max(1, Number(getSetting('relay_retry_channels', '3')) || 3)
// 安全边际:输出侧我们能靠注入 max_tokens 卡死上界,输入侧不能 ——
// 上游用的分词器和我们不同(多模态、缓存、系统提示注入都会让它数出更多),
// 实测同一段文本我们数 8 个 token、上游报 1000 个。冻结时统一上浮这个系数兜住偏差。
const prechargeMargin = () => Math.max(1, Number(getSetting('precharge_margin', '1.2')) || 1.2)

// 冻结额度。返回冻结金额;余额不足返回 -1。
// 关键在于 WHERE quota >= ? —— SQLite 单条 UPDATE 是原子的,
// 并发请求里只有余额真正够的那些才能成功冻结。
function reserveQuota(userId, amount) {
  if (!(amount > 0)) return 0
  const info = db
    .prepare('UPDATE users SET quota = ROUND(quota - ?, 6) WHERE id = ? AND quota >= ?')
    .run(amount, userId, amount)
  return info.changes === 1 ? amount : -1
}

function releaseQuota(userId, amount) {
  if (amount > 0) {
    db.prepare('UPDATE users SET quota = ROUND(quota + ?, 6) WHERE id = ?').run(amount, userId)
  }
}

// 每用户在途请求数(内存态,够单机用;设为 0 表示不限)
const inflight = new Map()
let inflightTotal = 0

function acquireSlot(userId) {
  const limit = maxConcurrent()
  const cur = inflight.get(userId) || 0
  if (limit > 0 && cur >= limit) return false
  inflight.set(userId, cur + 1)
  inflightTotal++
  return true
}
function releaseSlot(userId) {
  const cur = inflight.get(userId) || 0
  if (cur <= 1) inflight.delete(userId)
  else inflight.set(userId, cur - 1)
  if (inflightTotal > 0) inflightTotal--
}

// 优雅退出时要等这些请求做完 —— 中途被切断的请求已经花了上游的钱却还没落账,
// 而且预扣的额度也会悬空退不回去。
export function inflightRelayCount() {
  return inflightTotal
}

// 中转限流:按令牌计数,窗口固定 1 分钟,限额可在站点设置里调(0 = 不限)
const relayRateLimit = () => Number(getSetting('relay_rate_limit_per_min', '0')) || 0

function openaiError(res, status, message, code = null) {
  return res.status(status).json({ error: { message, type: 'routex_error', code } })
}

// ---- 精确 token 计数(gpt-tokenizer / o200k)----
export function countText(text) {
  if (!text) return 0
  try {
    return encode(String(text)).length
  } catch {
    return Math.ceil(String(text).length / 3.5)
  }
}

export function countChatTokens(messages) {
  if (!Array.isArray(messages)) return 0
  let total = 3 // 回复引导
  for (const m of messages) {
    total += 4 // 每条消息封装开销
    total += countText(m.role)
    total += countText(
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
    )
    // agent 的对话里,assistant 的工具调用和 tool 消息的执行结果都是实打实的输入 token
    for (const tc of m.tool_calls || []) {
      total += countText(tc.function?.name) + countText(tc.function?.arguments) + 4
    }
  }
  return total
}

function countPromptTokens(body) {
  if (Array.isArray(body.messages)) {
    let total = countChatTokens(body.messages)
    // 工具定义会随每次请求一起发给模型 —— agent 挂十几个工具时,
    // 光 schema 就是几千 token。漏掉它会让预扣费严重低估。
    if (Array.isArray(body.tools) && body.tools.length) {
      total += countText(JSON.stringify(body.tools))
    }
    return total
  }
  const raw = body.input ?? body.prompt ?? ''
  return countText(typeof raw === 'string' ? raw : JSON.stringify(raw))
}

// ---- 按入站协议回错 ----
// Anthropic 客户端 SDK 只认 {type:'error',error:{type,message}} 这个结构,
// 回 OpenAI 风格的错误体会让它们解析失败、报出一堆无关的异常。
function fail(req, res, status, message, code = null) {
  if (req.inFormat === 'anthropic') {
    const type = status === 401 ? 'authentication_error'
      : status === 403 ? 'permission_error'
        : status === 404 ? 'not_found_error'
          : status === 429 ? 'rate_limit_error'
            : status === 503 ? 'overloaded_error'
              : status >= 500 ? 'api_error' : 'invalid_request_error'
    return res.status(status).json(anthropicErrorBody(message, type))
  }
  return openaiError(res, status, message, code)
}

// ---- API Key 鉴权 ----
// 两种入站协议的鉴权头不一样:OpenAI 用 Authorization: Bearer,
// Anthropic 用 x-api-key。Claude Code 之类的客户端只会发后者。
function relayAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  const key = bearer || String(req.headers['x-api-key'] || '').trim()
  if (!key || !key.startsWith('sk-')) {
    return fail(req, res, 401, '缺少 API Key,请在 Authorization: Bearer 或 x-api-key 头中携带 sk-xxx')
  }
  const token = db.prepare('SELECT * FROM tokens WHERE key = ?').get(key)
  if (!token || token.status !== 1) return fail(req, res, 401, 'API Key 无效或已被禁用', 'invalid_api_key')
  if (token.expires_at && token.expires_at < now()) return fail(req, res, 401, 'API Key 已过期', 'expired_api_key')
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token.user_id)
  if (!user || user.status !== 1) return fail(req, res, 403, '账户不可用', 'account_disabled')
  if (user.quota <= 0) return fail(req, res, 429, '账户额度不足,请充值后再试', 'insufficient_quota')
  if (!token.unlimited && token.used_quota >= token.quota) {
    return fail(req, res, 429, '该令牌的额度已用尽', 'insufficient_quota')
  }
  req.relayToken = token
  req.relayUser = user
  next()
}

// ---- 渠道选择 ----
// 原生协议渠道只支持 chat;embeddings / completions 仅路由到 OpenAI 兼容渠道
// 渠道分组:用户只会被路由到「服务其所在分组」的渠道(对齐 new-api)
export function pickChannels(model, path, group) {
  const rows = db
    .prepare('SELECT * FROM channels WHERE status = 1 AND auto_disabled = 0 ORDER BY priority DESC')
    .all()
  const candidates = rows.filter(c => {
    if (path !== '/chat/completions' && c.type !== 'openai') return false
    if (!channelServesGroup(c, group)) return false
    return splitModels(c.models).includes(model)
  })
  if (candidates.length === 0) return []
  const groups = new Map()
  for (const c of candidates) {
    if (!groups.has(c.priority)) groups.set(c.priority, [])
    groups.get(c.priority).push(c)
  }
  const ordered = []
  for (const [, group] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    const pool = [...group]
    while (pool.length) {
      const totalWeight = pool.reduce((s, c) => s + Math.max(1, c.weight), 0)
      let r = Math.random() * totalWeight
      let idx = 0
      for (let i = 0; i < pool.length; i++) {
        r -= Math.max(1, pool[i].weight)
        if (r <= 0) { idx = i; break }
      }
      ordered.push(pool.splice(idx, 1)[0])
    }
  }
  return ordered
}

// 多 Key 渠道:按换行/逗号分隔,随机取一把分摊上游限额
export function pickKey(channel) {
  const keys = channel.api_key.split(/[\n,]/).map(k => k.trim()).filter(Boolean)
  if (keys.length <= 1) return keys[0] || channel.api_key
  return keys[Math.floor(Math.random() * keys.length)]
}

function mapModel(channel, model) {
  try {
    const mapping = JSON.parse(channel.model_mapping || '{}')
    return mapping[model] || model
  } catch {
    return model
  }
}

// ---- 渠道健康记账(熔断)----
export function markChannelFailure(channelId, reason) {
  const row = db.prepare('SELECT fail_count FROM channels WHERE id = ?').get(channelId)
  if (!row) return
  const fails = row.fail_count + 1
  if (fails >= FAIL_THRESHOLD) {
    db.prepare('UPDATE channels SET fail_count = ?, auto_disabled = 1, last_test_ok = 0, last_test_at = ? WHERE id = ?')
      .run(fails, now(), channelId)
    console.warn(`[RouteX] 渠道 #${channelId} 连续失败 ${fails} 次,已熔断(${reason})`)
  } else {
    db.prepare('UPDATE channels SET fail_count = ? WHERE id = ?').run(fails, channelId)
  }
}

export function markChannelSuccess(channelId) {
  db.prepare('UPDATE channels SET fail_count = 0, auto_disabled = 0 WHERE id = ? AND (fail_count > 0 OR auto_disabled = 1)')
    .run(channelId)
}

// 从上游 usage 里取出缓存与思考 token(已由适配器归一化成 OpenAI 口径)
export function cacheTokensOf(usage) {
  return {
    cacheRead: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWrite: usage?.cache_creation_tokens ?? 0,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0
  }
}

// ---- 计费落账 ----
// reserved 是请求前冻结的额度:这里先原样退还,再按实际用量扣,两步在同一事务内完成。
function settle({
  user, token, channel, model, promptTokens, completionTokens, latency, stream, ok, error,
  reserved = 0, cacheRead = 0, cacheWrite = 0, reasoning = 0
}) {
  const cost = ok ? computeCost(model, promptTokens, completionTokens, user.group_name, { cacheRead, cacheWrite }) : 0
  const tx = db.transaction(() => {
    if (reserved > 0) {
      db.prepare('UPDATE users SET quota = ROUND(quota + ?, 6) WHERE id = ?').run(reserved, user.id)
    }
    if (ok && cost > 0) {
      db.prepare('UPDATE users SET quota = MAX(0, ROUND(quota - ?, 6)), used_quota = ROUND(used_quota + ?, 6), request_count = request_count + 1 WHERE id = ?')
        .run(cost, cost, user.id)
      db.prepare('UPDATE tokens SET used_quota = ROUND(used_quota + ?, 6), last_used_at = ? WHERE id = ?')
        .run(cost, now(), token.id)
    } else {
      db.prepare('UPDATE users SET request_count = request_count + 1 WHERE id = ?').run(user.id)
      db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(now(), token.id)
    }
    // 渠道用量:失败也计一次调用,便于看出「跑量大但成功率低」的渠道
    if (channel) {
      db.prepare('UPDATE channels SET used_quota = ROUND(used_quota + ?, 6), request_count = request_count + 1 WHERE id = ?')
        .run(cost, channel.id)
    }
    db.prepare(
      `INSERT INTO logs (user_id, token_id, channel_id, model, prompt_tokens, completion_tokens, total_tokens,
                         cached_tokens, reasoning_tokens, cost, latency_ms, stream, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user.id, token.id, channel?.id || null, model,
      promptTokens, completionTokens, promptTokens + completionTokens,
      cacheRead, reasoning,
      cost, latency, stream ? 1 : 0, ok ? 'success' : 'error', error || null, now()
    )
  })
  tx()
  return cost
}

// ---- GET /v1/models ----
router.get('/models', relayAuth, (req, res) => {
  const group = req.relayUser.group_name || 'default'
  const limits = splitList(req.relayToken.model_limits)
  const channels = db.prepare('SELECT models, group_names FROM channels WHERE status = 1').all()
  const set = new Set()
  for (const c of channels) {
    if (!channelServesGroup(c, group)) continue
    splitModels(c.models).forEach(m => {
      if (!limits.length || limits.includes(m)) set.add(m)
    })
  }
  // 同时带上两种协议的字段:OpenAI 客户端看 object/owned_by,
  // Anthropic 客户端看 type/display_name —— 多带几个字段没有副作用
  res.json({
    object: 'list',
    has_more: false,
    data: [...set].sort().map(id => ({
      id, object: 'model', created: 0, owned_by: 'routex',
      type: 'model', display_name: id
    }))
  })
})

// ---- 中转主入口 ----
const RELAY_PATHS = ['/chat/completions', '/completions', '/embeddings']

// 入站协议标记要在鉴权之前设好 —— 鉴权失败时也得按对应格式回错
const markFormat = format => (req, res, next) => { req.inFormat = format; next() }

// 限流 + 并发槽,两种入站协议共用
async function guarded(req, res, run) {
  if (!consumeRelayQuota(`t${req.relayToken.id}`, 60_000, relayRateLimit())) {
    return fail(req, res, 429, `请求过于频繁,该令牌每分钟最多 ${relayRateLimit()} 次`, 'rate_limit_exceeded')
  }
  if (!acquireSlot(req.relayUser.id)) {
    return fail(req, res, 429, `并发请求数已达上限(${maxConcurrent()}),请稍后重试`, 'too_many_requests')
  }
  try {
    await run()
  } finally {
    releaseSlot(req.relayUser.id)
  }
}

for (const path of RELAY_PATHS) {
  router.post(path, markFormat('openai'), relayAuth, async (req, res) => {
    req.canonicalBody = req.body || {}
    req.nativeBody = req.body || {}
    await guarded(req, res, () => handleRelay(req, res, path))
  })
}

// ---- Anthropic Messages 入站 ----
// 站内一律以 OpenAI 格式做路由与计费,所以先转成规范格式;
// 原始请求体留着 —— 命中 Anthropic 渠道时直接透传,不做任何转换。
router.post('/messages', markFormat('anthropic'), relayAuth, async (req, res) => {
  const native = req.body || {}
  try {
    req.canonicalBody = anthropicRequestToOpenAI(native)
  } catch (e) {
    return fail(req, res, 400, `请求体解析失败:${e.message}`)
  }
  req.nativeBody = native
  await guarded(req, res, () => handleRelay(req, res, '/chat/completions'))
})

// 上游 4xx 的处理策略:
// - 401/403  上游密钥问题,是站长的事,绝不能把上游原文(常含我们的 Key)回给用户
// - 404      上游不认这个模型
// - 400/422  用户自己的请求有问题,脱敏后透传,否则用户无从改起
// - 其他     统一兜底
function describeUpstreamError(status, rawText) {
  const safe = redactSecrets(rawText).slice(0, 300)
  if (status === 401 || status === 403) {
    return { clientMessage: '上游渠道鉴权失败,请联系管理员', code: 'upstream_auth_error', logDetail: `HTTP ${status}(上游鉴权失败)`, channelFault: true }
  }
  if (status === 404) {
    return { clientMessage: '上游不支持该模型', code: 'upstream_model_not_found', logDetail: `HTTP 404`, channelFault: true }
  }
  if (status === 400 || status === 422) {
    return { clientMessage: safe || '请求参数不被上游接受', code: 'invalid_request', logDetail: `HTTP ${status}: ${safe}`, channelFault: false }
  }
  return { clientMessage: `上游返回错误(HTTP ${status})`, code: 'upstream_error', logDetail: `HTTP ${status}`, channelFault: false }
}

async function handleRelay(req, res, path) {
  // body 一律是「规范格式」(OpenAI):路由、白名单、计费全基于它。
  // 原始入站请求体在 req.nativeBody,仅在同协议透传时才用到。
  const body = req.canonicalBody || req.body || {}
  const model = String(body.model || '').trim()
  if (!model) return fail(req, res, 400, '请求缺少 model 字段', 'invalid_request')

  // 令牌级模型白名单(留空不限)
  const limits = splitList(req.relayToken.model_limits)
  if (limits.length && !limits.includes(model)) {
    return fail(req, res, 403, `该令牌不允许调用模型 ${model}`, 'model_not_allowed')
  }

  const group = req.relayUser.group_name || 'default'
  const candidates = pickChannels(model, path, group)
  if (candidates.length === 0) {
    // 区分「站点根本没这个模型」与「有但不对本分组开放」,避免用户反复排查
    const servedElsewhere = db
      .prepare('SELECT models FROM channels WHERE status = 1 AND auto_disabled = 0')
      .all()
      .some(c => splitModels(c.models).includes(model))
    if (servedElsewhere) {
      return fail(req, res, 403, `模型 ${model} 未对你所在的分组「${group}」开放`, 'model_not_in_group')
    }
    return fail(req, res, 503, `当前没有可用渠道支持模型 ${model}`, 'no_available_channel')
  }

  const isStream = !!body.stream && path === '/chat/completions'
  const start = Date.now()
  let lastError = 'unknown error'

  // 请求前冻结额度:按输入 token + 输出上限估价。
  //
  // 关键在于「输出上限」必须是真正的上界,否则冻结的钱不够覆盖实际消耗,
  // 并发白嫖的口子就还在。所以请求没有指定 max_tokens 时,我们主动注入一个上限
  // 再发给上游 —— 上游就不可能返回超过我们已经冻结的量。
  const isEmbedding = path === '/embeddings'
  const requestedMax = Number(body.max_tokens || body.max_completion_tokens) || 0
  // 思考 token 和正文共用 max_tokens。开了思考还按默认上限注入的话,
  // 思考会把额度吃光、正文被截断 —— 所以要额外留出思考的空间,
  // 并且这部分也必须计入预扣,否则又是一个低估。
  const thinkingRoom = !isEmbedding && wantsThinking(body) ? thinkingAllowance() : 0
  const outputCap = isEmbedding
    ? 0
    : (requestedMax > 0 ? requestedMax : estimatedCompletion() + thinkingRoom)
  const cappedBody = isEmbedding || requestedMax > 0 ? body : { ...body, max_tokens: outputCap }

  const promptTokens = countPromptTokens(body)
  const reserved = reserveQuota(
    req.relayUser.id,
    computeCost(model, promptTokens, outputCap, group) * prechargeMargin()
  )
  if (reserved === -1) {
    return fail(req, res, 429, '账户额度不足以支撑本次请求,请充值后再试', 'insufficient_quota')
  }

  for (const channel of candidates.slice(0, retryChannels())) {
    const upstreamModel = mapModel(channel, model)
    const apiKey = pickKey(channel)
    // 入站与上游是同一种协议时走透传:不做任何转换,保真度最高
    const passthrough = req.inFormat === 'anthropic' && channel.type === 'anthropic'
    const { url, headers, payload } = passthrough
      ? buildAnthropicPassthrough(
        channel, apiKey,
        requestedMax > 0 ? req.nativeBody : { ...req.nativeBody, max_tokens: outputCap },
        upstreamModel, isStream
      )
      : buildUpstreamRequest(channel, apiKey, path, cappedBody, upstreamModel, isStream)

    let upstream
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS)
      })
    } catch (e) {
      lastError = `渠道 #${channel.id} 连接失败: ${e.message}`
      markChannelFailure(channel.id, e.message)
      continue
    }

    // 5xx / 429 视为渠道故障:记失败并转移下一渠道
    if (upstream.status >= 500 || upstream.status === 429) {
      lastError = `渠道 #${channel.id} 返回 HTTP ${upstream.status}`
      markChannelFailure(channel.id, `HTTP ${upstream.status}`)
      await upstream.body?.cancel().catch(() => {})
      continue
    }

    // 其余 4xx:绝不原样透传 —— 上游错误里常带着我们自己的 Key 和供应商信息
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      const info = describeUpstreamError(upstream.status, text)
      // 完整原文只进服务端控制台,方便站长排查
      console.warn(`[RouteX] 渠道 #${channel.id} HTTP ${upstream.status}: ${redactSecrets(text).slice(0, 500)}`)

      // 上游密钥失效 / 模型不存在属于渠道故障,应当转移到下一个渠道并累计熔断,
      // 否则一个换了密钥的渠道会一直把请求吃掉
      if (info.channelFault) {
        lastError = `渠道 #${channel.id}:${info.clientMessage}`
        markChannelFailure(channel.id, `HTTP ${upstream.status}`)
        continue
      }

      settle({
        user: req.relayUser, token: req.relayToken, channel, model,
        promptTokens: 0, completionTokens: 0,
        latency: Date.now() - start, stream: isStream, ok: false,
        error: info.logDetail, reserved
      })
      return fail(req, res, upstream.status, info.clientMessage, info.code)
    }

    markChannelSuccess(channel.id)
    const io = { passthrough }
    if (isStream) return relayStream(req, res, upstream, channel, model, body, start, reserved, io)
    return relayJson(req, res, upstream, channel, model, body, start, reserved, io)
  }

  // 所有渠道都没成功:冻结的额度必须原样退回,否则用户白白被扣
  releaseQuota(req.relayUser.id, reserved)
  return openaiError(res, 502, `所有可用渠道均请求失败:${redactSecrets(lastError)}`, 'upstream_error')
}

async function relayJson(req, res, upstream, channel, model, body, start, reserved = 0, io = {}) {
  let raw
  try {
    raw = await upstream.json()
  } catch {
    releaseQuota(req.relayUser.id, reserved)
    return fail(req, res, 502, '上游返回了无法解析的响应', 'upstream_error')
  }
  // 无论出站给什么格式,计费一律基于规范格式的 usage
  const data = convertResponse(channel, model, raw)
  const usage = data.usage || {}
  const promptTokens = usage.prompt_tokens || countPromptTokens(body)
  const completionTokens = usage.completion_tokens ??
    countText(data.choices?.map(c => c.message?.content || c.text || '').join('') || '')
  settle({
    user: req.relayUser, token: req.relayToken, channel, model,
    promptTokens, completionTokens,
    latency: Date.now() - start, stream: false, ok: true, reserved,
    ...cacheTokensOf(usage)
  })

  if (req.inFormat === 'anthropic') {
    // 透传时上游返回的本来就是 Anthropic 格式,只把模型名换回用户请求的那个
    return res.status(200).json(
      io.passthrough ? { ...raw, model } : openaiResponseToAnthropic(data, model)
    )
  }
  res.status(200).json(data)
}

async function relayStream(req, res, upstream, channel, model, body, start, reserved = 0, io = {}) {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  // 上游是原生协议(anthropic/gemini)时,先用 transformer 转成 OpenAI SSE
  const nativeUpstream = channel.type !== 'openai'
  const transformer = nativeUpstream ? createStreamTransformer(channel, model) : null
  // 入站是 Anthropic 且不是透传时,还要再把 OpenAI SSE 编码成 Anthropic 事件
  const toAnthropic = req.inFormat === 'anthropic' && !io.passthrough
  const encoder = toAnthropic ? createAnthropicEncoder(model) : null
  // 入站与上游同协议:字节原样转发,只旁路统计用量
  const rawPassthrough = io.passthrough || (req.inFormat === 'openai' && !nativeUpstream)

  let sseBuffer = ''
  let usage = null
  let deltaText = ''
  const DELTA_CAP = 1_000_000
  let clientGone = false
  res.on('close', () => { clientGone = true })

  const parseData = line => {
    if (!line.startsWith('data:')) return null
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return null
    try { return JSON.parse(payload) } catch { return null }
  }

  // OpenAI SSE:旁路取 usage 与增量文本(兜底计费用)
  const scanOpenAI = obj => {
    if (!obj) return
    if (obj.usage) usage = obj.usage
    const d = obj.choices?.[0]?.delta?.content
    if (typeof d === 'string' && deltaText.length < DELTA_CAP) deltaText += d
  }

  // Anthropic SSE 透传:用量只在 message_start / message_delta 里出现一次
  let anthropicStart = null
  const scanAnthropic = obj => {
    if (!obj) return
    if (obj.type === 'message_start') anthropicStart = obj.message?.usage || {}
    if (obj.type === 'message_delta') {
      usage = anthropicUsage({ ...(anthropicStart || {}), output_tokens: obj.usage?.output_tokens ?? 0 })
    }
    if (obj.type === 'content_block_delta') {
      const t = obj.delta?.text || obj.delta?.thinking || obj.delta?.partial_json || ''
      if (deltaText.length < DELTA_CAP) deltaText += t
    }
  }

  // 把一行上游 SSE 处理成「要写给客户端的内容」
  const handleLine = line => {
    if (rawPassthrough) {
      // 字节已经原样写过了,这里只做统计
      const obj = parseData(line)
      if (io.passthrough) scanAnthropic(obj)
      else scanOpenAI(obj)
      return ''
    }
    if (nativeUpstream) {
      const text = transformer.feed(line)
      if (!text) return ''
      if (!toAnthropic) return text
      // transformer 产出的是 OpenAI SSE 文本,再编码成 Anthropic 事件
      let out = ''
      for (const l of text.split(/\r?\n/)) {
        const obj = parseData(l.trim())
        if (obj) out += encoder.feed(obj)
      }
      return out
    }
    // 上游是 OpenAI,入站是 Anthropic
    const obj = parseData(line)
    if (!obj) return ''
    scanOpenAI(obj)
    return encoder.feed(obj)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientGone) {
        await reader.cancel().catch(() => {})
        break
      }
      if (rawPassthrough) res.write(value)
      sseBuffer += decoder.decode(value, { stream: true })
      let nl
      while ((nl = sseBuffer.indexOf('\n')) >= 0) {
        const line = sseBuffer.slice(0, nl).trimEnd()
        sseBuffer = sseBuffer.slice(nl + 1)
        const out = handleLine(line)
        if (out) res.write(out)
      }
    }
  } catch { /* 上游中断,按已收到的内容计费 */ }

  if (sseBuffer) {
    const out = handleLine(sseBuffer.trimEnd())
    if (out) res.write(out)
  }
  if (!clientGone && !rawPassthrough) {
    if (toAnthropic) res.write(encoder.finish())
    else if (nativeUpstream) res.write(transformer.finish())
  }
  res.end()

  let nativeChars = 0
  if (nativeUpstream && transformer) {
    usage = transformer.usage() || usage
    nativeChars = transformer.chars()
  }
  const promptTokens = usage?.prompt_tokens || countPromptTokens(body)
  const completionTokens = usage?.completion_tokens ??
    (nativeChars > 0
      ? Math.max(1, Math.ceil(nativeChars / 3.5))
      : Math.max(1, countText(deltaText)))
  settle({
    user: req.relayUser, token: req.relayToken, channel, model,
    promptTokens, completionTokens,
    latency: Date.now() - start, stream: true, ok: true, reserved,
    ...cacheTokensOf(usage)
  })
}

export default router
