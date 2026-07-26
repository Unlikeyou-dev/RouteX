import { Router } from 'express'
import { db, now } from './db.js'
import { computeCost } from './pricing.js'
import { estimateTokens } from './util.js'
import { RELAY_TIMEOUT_MS } from './config.js'

const router = Router()

function openaiError(res, status, message, code = null) {
  return res.status(status).json({ error: { message, type: 'routex_error', code } })
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

// ---- 渠道选择:同优先级内按权重随机 ----
function pickChannels(model) {
  const rows = db.prepare('SELECT * FROM channels WHERE status = 1 ORDER BY priority DESC').all()
  const candidates = rows.filter(c =>
    c.models.split(',').map(m => m.trim()).includes(model)
  )
  if (candidates.length === 0) return []
  // 按优先级分组,组内加权洗牌,整体保持优先级次序,作为故障转移顺序
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

function mapModel(channel, model) {
  try {
    const mapping = JSON.parse(channel.model_mapping || '{}')
    return mapping[model] || model
  } catch {
    return model
  }
}

// ---- 计费落账 ----
function settle({ user, token, channel, model, promptTokens, completionTokens, latency, stream, ok, error }) {
  const cost = ok ? computeCost(model, promptTokens, completionTokens) : 0
  const tx = db.transaction(() => {
    if (ok && cost > 0) {
      db.prepare('UPDATE users SET quota = MAX(0, quota - ?), used_quota = used_quota + ?, request_count = request_count + 1 WHERE id = ?')
        .run(cost, cost, user.id)
      db.prepare('UPDATE tokens SET used_quota = used_quota + ?, last_used_at = ? WHERE id = ?')
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

// ---- GET /v1/models:聚合所有启用渠道的模型 ----
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

  const candidates = pickChannels(model)
  if (candidates.length === 0) {
    return openaiError(res, 503, `当前没有可用渠道支持模型 ${model}`, 'no_available_channel')
  }

  const isStream = !!body.stream && path === '/chat/completions'
  const start = Date.now()
  let lastError = 'unknown error'

  for (const channel of candidates.slice(0, 3)) {
    const upstreamModel = mapModel(channel, model)
    const upstreamBody = { ...body, model: upstreamModel }
    if (isStream) {
      // 请求上游在流末尾附带 usage,便于精确计费
      upstreamBody.stream_options = { ...(body.stream_options || {}), include_usage: true }
    }

    let upstream
    try {
      upstream = await fetch(`${channel.base_url}/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${channel.api_key}` },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS)
      })
    } catch (e) {
      lastError = `渠道 #${channel.id} 连接失败: ${e.message}`
      continue
    }

    // 5xx / 429 视为渠道故障,转移到下一渠道
    if (upstream.status >= 500 || upstream.status === 429) {
      lastError = `渠道 #${channel.id} 返回 HTTP ${upstream.status}`
      await upstream.body?.cancel().catch(() => {})
      continue
    }

    // 4xx 原样透传给客户端(请求本身的问题),不计费
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

    if (isStream) return relayStream(req, res, upstream, channel, model, body, start)
    return relayJson(req, res, upstream, channel, model, body, start)
  }

  return openaiError(res, 502, `所有可用渠道均请求失败:${lastError}`, 'upstream_error')
}

function promptTextOf(body) {
  if (Array.isArray(body.messages)) {
    return body.messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))).join('\n')
  }
  if (body.input) return typeof body.input === 'string' ? body.input : JSON.stringify(body.input)
  if (body.prompt) return typeof body.prompt === 'string' ? body.prompt : JSON.stringify(body.prompt)
  return ''
}

async function relayJson(req, res, upstream, channel, model, body, start) {
  let data
  try {
    data = await upstream.json()
  } catch {
    return openaiError(res, 502, '上游返回了无法解析的响应', 'upstream_error')
  }
  const usage = data.usage || {}
  const promptTokens = usage.prompt_tokens ?? estimateTokens(promptTextOf(body))
  const completionTokens =
    usage.completion_tokens ??
    estimateTokens(data.choices?.map(c => c.message?.content || c.text || '').join('') || '')
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
  let sseBuffer = ''
  let usage = null
  let completionChars = 0
  let clientGone = false
  res.on('close', () => { clientGone = true })

  const scanLine = line => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    try {
      const obj = JSON.parse(payload)
      if (obj.usage) usage = obj.usage
      const delta = obj.choices?.[0]?.delta?.content
      if (typeof delta === 'string') completionChars += delta.length
    } catch { /* 非 JSON 数据块,忽略 */ }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientGone) {
        await reader.cancel().catch(() => {})
        break
      }
      res.write(value)
      sseBuffer += decoder.decode(value, { stream: true })
      let nl
      while ((nl = sseBuffer.indexOf('\n')) >= 0) {
        scanLine(sseBuffer.slice(0, nl).trimEnd())
        sseBuffer = sseBuffer.slice(nl + 1)
      }
    }
  } catch { /* 上游中断,按已收到的内容计费 */ }
  if (sseBuffer) scanLine(sseBuffer.trimEnd())
  res.end()

  const promptTokens = usage?.prompt_tokens ?? estimateTokens(promptTextOf(body))
  const completionTokens = usage?.completion_tokens ?? Math.max(1, Math.ceil(completionChars / 3.5))
  settle({
    user: req.relayUser, token: req.relayToken, channel, model,
    promptTokens, completionTokens,
    latency: Date.now() - start, stream: true, ok: true
  })
}

export default router
