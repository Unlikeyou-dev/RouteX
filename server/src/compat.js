// 渠道兼容性自检。
//
// 我们按模型名解析世代来裁剪参数(见 model-caps.js),这在对接官方 API 时够用,
// 但上游往往是**别人的中转站**:改版、限制、魔改都可能让某个参数突然被拒。
// 那时用户看到的只是一片 400,没有任何线索指向是哪个字段的问题,而我们的
// 名字启发式还会一直坚持自己是对的。
//
// 自检的做法是把参数逐项**单独**发一遍:先发一次什么都不带的基线请求确认链路本身
// 是通的,再在基线之上一次只加一个特性。只有「基线过了、加上这个就挂」才能归咎于
// 这个特性 —— 否则网络抖一下就会被记成「上游不支持工具调用」。
//
// 结果会回喂给出站构造:探到被拒的参数在真实请求里直接剔掉,而不是每次都撞一次 400。
import { db, now } from './db.js'
import { buildUpstreamRequest } from './adapters.js'
import { redactSecrets } from './util.js'

const TIMEOUT = 30_000

// 每项探测 = 在基线请求上叠加的一小段字段。
// max_tokens 都压到最低,一次自检的开销大致等于几条 ping。
export const FEATURES = [
  { key: 'baseline', label: '基础对话', patch: () => ({}) },
  { key: 'stream', label: '流式输出', patch: () => ({ stream: true }) },
  { key: 'sampling', label: '采样参数', patch: () => ({ temperature: 0.5, top_p: 0.9 }) },
  { key: 'thinking', label: '思考链', patch: () => ({ reasoning_effort: 'low' }) },
  {
    key: 'tools',
    label: '工具调用',
    patch: () => ({
      tools: [{
        type: 'function',
        function: {
          name: 'ping',
          description: '测试用',
          parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] }
        }
      }]
    })
  },
  {
    key: 'structured',
    label: '结构化输出',
    patch: () => ({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'probe',
          schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
          strict: true
        }
      }
    })
  }
]

const BASE = { messages: [{ role: 'user', content: 'ping' }], max_tokens: 16 }

async function probe(channel, apiKey, model, feature) {
  const body = { ...BASE, model, ...feature.patch() }
  const isStream = !!body.stream
  let req
  try {
    req = buildUpstreamRequest(channel, apiKey, '/chat/completions', body, model, isStream)
  } catch (e) {
    return { ok: false, message: `构造请求失败:${e.message}` }
  }

  const start = Date.now()
  try {
    const resp = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.payload),
      signal: AbortSignal.timeout(TIMEOUT)
    })
    const latency = Date.now() - start
    if (resp.ok) {
      await resp.body?.cancel().catch(() => {})
      return { ok: true, latency }
    }
    const text = await resp.text().catch(() => '')
    // 原文里可能带着我们的上游 Key,写库前必须抹掉
    return { ok: false, latency, status: resp.status, message: redactSecrets(text).slice(0, 300) }
  } catch (e) {
    return { ok: false, latency: Date.now() - start, message: e.message || '连接失败' }
  }
}

// 跑一次完整自检。基线不通就直接停 —— 后面每一项都会跟着失败,
// 记一堆「不支持」只会误导人。
export async function runCompatCheck(channel, apiKey, model) {
  const results = {}
  const baseline = await probe(channel, apiKey, model, FEATURES[0])
  results.baseline = baseline

  if (baseline.ok) {
    for (const f of FEATURES.slice(1)) {
      results[f.key] = await probe(channel, apiKey, model, f)
    }
  } else {
    for (const f of FEATURES.slice(1)) {
      results[f.key] = { skipped: true, message: '基线未通过,未继续探测' }
    }
  }

  const record = { channel_id: channel.id, model, results, checked_at: now() }
  db.prepare(
    `INSERT INTO channel_caps (channel_id, model, results, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(channel_id, model) DO UPDATE SET results = excluded.results, checked_at = excluded.checked_at`
  ).run(channel.id, model, JSON.stringify(results), record.checked_at)
  return record
}

export function getCompat(channelId, model) {
  const row = db.prepare('SELECT * FROM channel_caps WHERE channel_id = ? AND model = ?').get(channelId, model)
  if (!row) return null
  try {
    return { model: row.model, checked_at: row.checked_at, results: JSON.parse(row.results) }
  } catch {
    return null
  }
}

export function listCompat(channelId) {
  return db.prepare('SELECT * FROM channel_caps WHERE channel_id = ? ORDER BY model').all(channelId)
    .map(r => {
      try {
        return { model: r.model, checked_at: r.checked_at, results: JSON.parse(r.results) }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function clearCompat(channelId) {
  db.prepare('DELETE FROM channel_caps WHERE channel_id = ?').run(channelId)
}

// 把自检结论应用到真实请求上:探到被拒的参数直接剔掉,不必每次都撞一次 400。
// 只在「基线通过 + 该项明确失败」时才动手 —— 基线都没过说明是链路问题,
// 那份结果不能拿来判定单个特性。
export function applyCompat(body, channelId, model) {
  const compat = getCompat(channelId, model)
  const r = compat?.results
  if (!r?.baseline?.ok) return body

  const rejected = k => r[k] && r[k].ok === false && !r[k].skipped
  if (!['sampling', 'thinking', 'structured'].some(rejected)) return body

  const out = { ...body }
  if (rejected('sampling')) {
    delete out.temperature
    delete out.top_p
    delete out.top_k
  }
  if (rejected('thinking')) {
    delete out.reasoning_effort
    delete out.thinking
    delete out.reasoning
  }
  if (rejected('structured') && out.response_format) {
    // 直接删掉等于静默丢弃用户的约束,退回提示词兜底至少还有机会拿到 JSON
    const hint = structuredHint(out.response_format)
    delete out.response_format
    if (hint) out.messages = withHint(out.messages, hint)
  }
  return out
}

function structuredHint(format) {
  const schema = format?.json_schema?.schema
  const head = '你必须只输出一个合法的 JSON 对象,不要输出任何解释文字或 Markdown 代码块标记。'
  return schema ? `${head}输出必须严格符合以下 JSON Schema:\n${JSON.stringify(schema)}` : head
}

function withHint(messages, hint) {
  const list = [...(messages || [])]
  const i = list.findIndex(m => m.role === 'system')
  if (i < 0) return [{ role: 'system', content: hint }, ...list]
  const cur = list[i]
  const text = typeof cur.content === 'string'
    ? cur.content
    : (Array.isArray(cur.content) ? cur.content.map(c => c.text || '').join('') : '')
  list[i] = { ...cur, content: `${text}\n\n${hint}` }
  return list
}
