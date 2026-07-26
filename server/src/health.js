// 渠道健康巡检:
// - 每 5 分钟探测「熔断中」的渠道,恢复则自动重新上线
// - 每 30 分钟对所有启用渠道做一次连通性巡检,更新延迟并熔断故障渠道
import { db, now } from './db.js'
import { buildUpstreamRequest } from './adapters.js'
import { pickKey } from './relay.js'

const RECOVERY_INTERVAL = 5 * 60_000
const FULL_SWEEP_EVERY = 6 // 每 6 个周期(30 分钟)全量巡检一次

export async function testChannel(channel, model) {
  const testModel = (model || channel.models.split(',')[0] || 'gpt-4o-mini').trim()
  const body = { model: testModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }
  const { url, headers, payload } = buildUpstreamRequest(
    channel, pickKey(channel), '/chat/completions', body, testModel, false
  )
  const start = Date.now()
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000)
    })
    const latency = Date.now() - start
    if (resp.ok) {
      await resp.body?.cancel().catch(() => {})
      return { ok: true, latency, message: '' }
    }
    const text = await resp.text().catch(() => '')
    return { ok: false, latency, message: `HTTP ${resp.status}: ${text.slice(0, 200)}` }
  } catch (e) {
    return { ok: false, latency: Date.now() - start, message: e.message || '连接失败' }
  }
}

function recordResult(channel, result) {
  if (result.ok) {
    db.prepare(
      'UPDATE channels SET last_test_at = ?, last_test_ok = 1, latency_ms = ?, fail_count = 0, auto_disabled = 0 WHERE id = ?'
    ).run(now(), result.latency, channel.id)
    if (channel.auto_disabled) console.log(`[RouteX] 渠道 #${channel.id}「${channel.name}」已恢复,自动重新上线`)
  } else {
    db.prepare(
      'UPDATE channels SET last_test_at = ?, last_test_ok = 0, latency_ms = ?, fail_count = fail_count + 1, auto_disabled = 1 WHERE id = ?'
    ).run(now(), result.latency, channel.id)
    if (!channel.auto_disabled) console.warn(`[RouteX] 渠道 #${channel.id}「${channel.name}」巡检失败已熔断:${result.message}`)
  }
}

let tick = 0
async function sweep() {
  tick++
  const fullSweep = tick % FULL_SWEEP_EVERY === 0
  const rows = fullSweep
    ? db.prepare('SELECT * FROM channels WHERE status = 1').all()
    : db.prepare('SELECT * FROM channels WHERE status = 1 AND auto_disabled = 1').all()
  for (const channel of rows) {
    const result = await testChannel(channel)
    recordResult(channel, result)
  }
}

export function startHealthChecker() {
  const timer = setInterval(() => {
    sweep().catch(e => console.error('[RouteX] 健康巡检异常:', e.message))
  }, RECOVERY_INTERVAL)
  timer.unref()
}
