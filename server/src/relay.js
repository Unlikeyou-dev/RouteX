import { Router } from 'express'
import { encode } from 'gpt-tokenizer'
import { db, now } from './db.js'
import { computeCost } from './pricing.js'
import { RELAY_TIMEOUT_MS } from './config.js'
import { buildUpstreamRequest, convertResponse, createStreamTransformer } from './adapters.js'

const router = Router()

// 连续失败 3 次熔断,由健康检查定时探活恢复
const FAIL_THRESHOLD = 3

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
  }
  return total
}

function countPromptTokens(body) {
  if (Array.isArray(body.messages)) return countChatTokens(body.messages)
  const raw = body.input ?? body.prompt ?? ''
  return countText(typeof raw === 'string' ? raw : JSON.stringify(raw))
}

// ---- API Key 鉴权 ----
function relayAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!key || !key.startsWith('sk-')) return openaiError(res, 401, '缺少 API Key,请在 Authorization 头中携带 Bearer sk-xxx')
  const token = db.prepare('SELECT * FROM tokens WHERE key = ?').get(key)
  if (!token || token.status !== 1) return openaiError(res, 401, 'API Key 无效或已被禁用', 'invalid_api_key')
  if (token.expires_at && token.expires_at < now()) return openaiError(res, 401, 'API Key 已过期', 'expired_api_key')
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token.user_id)
  if (!user || user.status !== 1) return openaiError(res, 403, '账户不可用', 'account_disabled')
  if (user.quota <= 0) return openaiError(res, 429, '账户额度不足,请充值后再试', 'insufficient_quota')
  if (!token.unlimited && token.used_quota >= token.quota) {
    return openaiError(res, 429, '该令牌的额度已用尽', 'insufficient_quota')
  }
  req.relayToken = token
  req.relayUser = user
  next()
}

// ---- 渠道选择 ----
// 原生协议渠道只支持 chat;embeddings / completions 仅路由到 OpenAI 兼容渠道
function pickChannels(model, path) {
  const rows = db
    .prepare('SELECT * FROM channels WHERE status = 1 AND auto_disabled = 0 ORDER BY priority DESC')
    .all()
  const candidates = rows.filter(c => {
    if (path !== '/chat/completions' && c.type !== 'openai') return false
    return c.models.split(',').map(m => m.trim()).includes(model)
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

// ---- 计费落账 ----
function settle({ user, token, channel, model, promptTokens, completionTokens, latency, stream, ok, error }) {
  const cost = ok ? computeCost(model, promptTokens, completionTokens, user.group_name) : 0
  const tx = db.transaction(() => {
    if (ok && cost > 0) {
      db.prepare('UPDATE users SET quota = MAX(0, ROUND(quota - ?, 6)), used_quota = ROUND(used_quota + ?, 6), request_count = request_count + 1 WHERE id = ?')
        .run(cost, cost, user.id)
      db.prepare('UPDATE tokens SET used_quota = ROUND(used_quota + ?, 6), last_used_at = ? WHERE id = ?')
        .run(cost, now(), token.id)
    } else {
      db.prepare('UPDATE users SET request_count = request_count + 1 WHERE id = ?').run(user.id)
      db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(now(), token.id)
    }
    db.prepare(
      `INSERT INTO logs (user_id, token_id, channel_id, model, prompt_tokens, completion_tokens, total_tokens, cost, latency_ms, stream, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user.id, token.id, channel?.id || null, model,
      promptTokens, completionTokens, promptTokens + completionTokens,
      cost, latency, stream ? 1 : 0, ok ? 'success' : 'error', error || null, now()
    )
  })
  tx()
  return cost
}

// ---- GET /v1/models ----
router.get('/models', relayAuth, (req, res) => {
  const channels = db.prepare('SELECT models FROM channels WHERE status = 1').all()
  const set = new Set()
  for (const c of channels) c.models.split(',').map(m => m.trim()).filter(Boolean).forEach(m => set.add(m))
  res.json({
    object: 'list',
    data: [...set].sort().map(id => ({ id, object: 'model', created: 0, owned_by: 'routex' }))
  })
})

// ---- 中转主入口 ----
const RELAY_PATHS = ['/chat/completions', '/completions', '/embeddings']

for (const path of RELAY_PATHS) {
  router.post(path, relayAuth, (req, res) => handleRelay(req, res, path))
}

async function handleRelay(req, res, path) {
  const body = req.body || {}
  const model = String(body.model || '').trim()
  if (!model) return openaiError(res, 400, '请求缺少 model 字段', 'invalid_request')

  const candidates = pickChannels(model, path)
  if (candidates.length === 0) {
    return openaiError(res, 503, `当前没有可用渠道支持模型 ${model}`, 'no_available_channel')
  }

  const isStream = !!body.stream && path === '/chat/completions'
  const start = Date.now()
  let lastError = 'unknown error'

  for (const channel of candidates.slice(0, 3)) {
    const upstreamModel = mapModel(channel, model)
    const apiKey = pickKey(channel)
    const { url, headers, payload } = buildUpstreamRequest(channel, apiKey, path, body, upstreamModel, isStream)

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

    // 4xx 原样透传(请求本身的问题),不计费不熔断
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      settle({
        user: req.relayUser, token: req.relayToken, channel, model,
        promptTokens: 0, completionTokens: 0,
        latency: Date.now() - start, stream: isStream, ok: false,
        error: `HTTP ${upstream.status}: ${text.slice(0, 300)}`
      })
      res.status(upstream.status)
      try { return res.json(JSON.parse(text)) } catch { return res.send(text) }
    }

    markChannelSuccess(channel.id)
    if (isStream) return relayStream(req, res, upstream, channel, model, body, start)
    return relayJson(req, res, upstream, channel, model, body, start)
  }

  return openaiError(res, 502, `所有可用渠道均请求失败:${lastError}`, 'upstream_error')
}

async function relayJson(req, res, upstream, channel, model, body, start) {
  let raw
  try {
    raw = await upstream.json()
  } catch {
    return openaiError(res, 502, '上游返回了无法解析的响应', 'upstream_error')
  }
  const data = convertResponse(channel, model, raw)
  const usage = data.usage || {}
  const promptTokens = usage.prompt_tokens || countPromptTokens(body)
  const completionTokens = usage.completion_tokens ??
    countText(data.choices?.map(c => c.message?.content || c.text || '').join('') || '')
  settle({
    user: req.relayUser, token: req.relayToken, channel, model,
    promptTokens, completionTokens,
    latency: Date.now() - start, stream: false, ok: true
  })
  res.status(200).json(data)
}

async function relayStream(req, res, upstream, channel, model, body, start) {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const native = channel.type !== 'openai'
  const transformer = native ? createStreamTransformer(channel, model) : null

  let sseBuffer = ''
  let usage = null
  let deltaText = ''
  const DELTA_CAP = 1_000_000 // 兜底计数的累计文本上限
  let clientGone = false
  res.on('close', () => { clientGone = true })

  // OpenAI 透传模式:旁路解析 usage 与增量文本
  const scanOpenAI = line => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const obj = JSON.parse(payload)
      if (obj.usage) usage = obj.usage
      const delta = obj.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && deltaText.length < DELTA_CAP) deltaText += delta
    } catch { /* 忽略非 JSON 块 */ }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientGone) {
        await reader.cancel().catch(() => {})
        break
      }
      if (!native) res.write(value)
      sseBuffer += decoder.decode(value, { stream: true })
      let nl
      while ((nl = sseBuffer.indexOf('\n')) >= 0) {
        const line = sseBuffer.slice(0, nl).trimEnd()
        sseBuffer = sseBuffer.slice(nl + 1)
        if (native) {
          const out = transformer.feed(line)
          if (out) res.write(out)
        } else {
          scanOpenAI(line)
        }
      }
    }
  } catch { /* 上游中断,按已收到的内容计费 */ }

  if (sseBuffer) {
    if (native) {
      const out = transformer.feed(sseBuffer.trimEnd())
      if (out) res.write(out)
    } else {
      scanOpenAI(sseBuffer.trimEnd())
    }
  }
  if (native && !clientGone) res.write(transformer.finish())
  res.end()

  let nativeChars = 0
  if (native) {
    usage = transformer.usage()
    nativeChars = transformer.chars()
  }
  const promptTokens = usage?.prompt_tokens || countPromptTokens(body)
  const completionTokens = usage?.completion_tokens ??
    (native ? Math.max(1, Math.ceil(nativeChars / 3.5)) : Math.max(1, countText(deltaText)))
  settle({
    user: req.relayUser, token: req.relayToken, channel, model,
    promptTokens, completionTokens,
    latency: Date.now() - start, stream: true, ok: true
  })
}

export default router
