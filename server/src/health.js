// 渠道健康巡检:
// - 每 5 分钟探测「熔断中」的渠道,恢复则自动重新上线
// - 每 N 分钟对所有启用渠道做一次连通性巡检,更新延迟并熔断故障渠道
//
// 成本考量:定时巡检发的是真实请求,即使 max_tokens=1,输入 token 也照样计费。
// 渠道一多就是一笔持续的隐性支出。所以定时巡检默认改用「拉模型列表」探活 ——
// 同样能验证地址与密钥是否有效,但不消耗任何 token。
// 需要更严格的验证(确认 chat 真的能通)时,把巡检模式切成 chat 即可。
import { db, now, getSetting } from './db.js'
import { buildUpstreamRequest } from './adapters.js'
import { pickKey } from './relay.js'
import { splitModels, redactSecrets } from './util.js'
import { fetchUpstreamModels } from './models-fetch.js'

const RECOVERY_INTERVAL = 5 * 60_000

const enabled = () => getSetting('health_check_enabled', '1') === '1'
const sweepMinutes = () => Math.max(0, Number(getSetting('health_sweep_minutes', '30')) || 0)
const checkMode = () => (getSetting('health_check_mode', 'models') === 'chat' ? 'chat' : 'models')

// 免费探活:拉一次上游的模型列表。不消耗 token,能验证地址与密钥。
async function probeByModels(channel) {
  const start = Date.now()
  const r = await fetchUpstreamModels({
    type: channel.type,
    base_url: channel.base_url,
    api_key: pickKey(channel)
  })
  return { ok: r.ok, latency: Date.now() - start, message: r.ok ? '' : r.message }
}

// 真实探活:发一次极小的 chat 请求。会产生少量费用,但能确认 chat 链路真的通。
async function probeByChat(channel, model) {
  const testModel = model || splitModels(channel.models)[0] || 'gpt-4o-mini'
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
    return { ok: false, latency, message: `HTTP ${resp.status}: ${redactSecrets(text).slice(0, 200)}` }
  } catch (e) {
    return { ok: false, latency: Date.now() - start, message: e.message || '连接失败' }
  }
}

// mode 缺省时按站点设置;管理员在渠道页手动点「测试」传 'chat',
// 既然是主动点的就做最严格的验证。
export async function testChannel(channel, model, mode) {
  const use = mode || checkMode()
  if (use === 'models') {
    const r = await probeByModels(channel)
    // 上游没有模型列表接口时不能判死刑,退回真实调用再确认一次
    if (!r.ok && /模型列表|JSON|404/.test(r.message)) return probeByChat(channel, model)
    return r
  }
  return probeByChat(channel, model)
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

let lastFullSweep = 0
async function sweep() {
  if (!enabled()) return
  // 全量巡检按设置的分钟数触发;设为 0 表示只探熔断中的渠道,不做全量
  const minutes = sweepMinutes()
  const fullSweep = minutes > 0 && Date.now() - lastFullSweep >= minutes * 60_000
  if (fullSweep) lastFullSweep = Date.now()

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
