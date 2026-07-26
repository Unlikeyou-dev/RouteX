import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { badRequest, normalizeBaseUrl, splitList } from '../util.js'
import { testChannel } from '../health.js'

const router = Router()
router.use(authRequired, adminRequired)

const TYPES = ['openai', 'anthropic', 'gemini']

// 分组归一化:去重、校验分组存在;留空则回落到 default
function normalizeGroups(raw) {
  const list = [...new Set(splitList(raw))]
  if (!list.length) return { value: 'default' }
  const known = new Set(db.prepare('SELECT name FROM groups').all().map(g => g.name))
  const unknown = list.filter(g => !known.has(g))
  if (unknown.length) return { error: `分组不存在:${unknown.join('、')}` }
  return { value: list.join(',') }
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY priority DESC, id').all()
  res.json({ success: true, data: rows })
})

router.post('/', (req, res) => {
  const {
    name, base_url = '', api_key, models = '', model_mapping = '{}',
    priority = 0, weight = 1, type = 'openai', group_names = 'default'
  } = req.body || {}
  if (!name || !api_key) return badRequest(res, '名称、密钥均为必填')
  if (!TYPES.includes(type)) return badRequest(res, '未知的渠道类型')
  try { JSON.parse(model_mapping || '{}') } catch { return badRequest(res, '模型映射需为合法 JSON') }
  const groups = normalizeGroups(group_names)
  if (groups.error) return badRequest(res, groups.error)
  const info = db
    .prepare(
      `INSERT INTO channels (name, base_url, api_key, models, model_mapping, priority, weight, type, group_names, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name, normalizeBaseUrl(base_url, type), api_key, models, model_mapping || '{}',
      Number(priority) || 0, Number(weight) || 1, type, groups.value, now()
    )
  res.json({ success: true, data: db.prepare('SELECT * FROM channels WHERE id = ?').get(info.lastInsertRowid) })
})

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '渠道不存在')
  const b = req.body || {}
  if (b.type !== undefined && !TYPES.includes(b.type)) return badRequest(res, '未知的渠道类型')
  if (b.model_mapping !== undefined) {
    try { JSON.parse(b.model_mapping || '{}') } catch { return badRequest(res, '模型映射需为合法 JSON') }
  }
  let groupValue = row.group_names
  if (b.group_names !== undefined) {
    const groups = normalizeGroups(b.group_names)
    if (groups.error) return badRequest(res, groups.error)
    groupValue = groups.value
  }
  // 手动启用时清除熔断状态,给渠道重新上场的机会
  const enabling = b.status !== undefined && b.status && row.status !== 1
  db.prepare(
    `UPDATE channels SET name=?, base_url=?, api_key=?, models=?, model_mapping=?, priority=?, weight=?, type=?, group_names=?, status=?,
     auto_disabled = CASE WHEN ? THEN 0 ELSE auto_disabled END,
     fail_count = CASE WHEN ? THEN 0 ELSE fail_count END
     WHERE id=?`
  ).run(
    b.name ?? row.name,
    normalizeBaseUrl(b.base_url ?? row.base_url, b.type ?? row.type),
    b.api_key ?? row.api_key,
    b.models ?? row.models,
    b.model_mapping ?? row.model_mapping,
    b.priority !== undefined ? Number(b.priority) || 0 : row.priority,
    b.weight !== undefined ? Number(b.weight) || 1 : row.weight,
    b.type ?? row.type,
    groupValue,
    b.status !== undefined ? (b.status ? 1 : 0) : row.status,
    enabling ? 1 : 0,
    enabling ? 1 : 0,
    row.id
  )
  res.json({ success: true, data: db.prepare('SELECT * FROM channels WHERE id = ?').get(row.id) })
})

// ---- 批量操作 ----
// 注意:/batch、/disabled 必须声明在 /:id 之前,否则会被参数路由吃掉
router.post('/batch', (req, res) => {
  const action = String(req.body?.action || '')
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger)
  if (!ids.length) return badRequest(res, '请先选择渠道')
  const placeholders = ids.map(() => '?').join(',')
  let changes = 0
  if (action === 'enable') {
    // 批量启用同时解除熔断,和单个启用的语义保持一致
    changes = db.prepare(
      `UPDATE channels SET status = 1, auto_disabled = 0, fail_count = 0 WHERE id IN (${placeholders})`
    ).run(...ids).changes
  } else if (action === 'disable') {
    changes = db.prepare(`UPDATE channels SET status = 0 WHERE id IN (${placeholders})`).run(...ids).changes
  } else if (action === 'delete') {
    changes = db.prepare(`DELETE FROM channels WHERE id IN (${placeholders})`).run(...ids).changes
  } else {
    return badRequest(res, '未知的批量操作')
  }
  res.json({ success: true, data: { affected: changes } })
})

// 清理所有已手动禁用的渠道
router.delete('/disabled', (req, res) => {
  const info = db.prepare('DELETE FROM channels WHERE status = 0').run()
  res.json({ success: true, data: { affected: info.changes } })
})

// 一键测活:并发探测(限流 5 路),返回每个渠道的结果
router.post('/test-all', async (req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY priority DESC, id').all()
  const results = []
  const CONCURRENCY = 5
  let cursor = 0
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++]
      const r = await testChannel(row)
      if (r.ok) {
        db.prepare(
          'UPDATE channels SET last_test_at = ?, last_test_ok = 1, latency_ms = ?, fail_count = 0, auto_disabled = 0 WHERE id = ?'
        ).run(now(), r.latency, row.id)
      } else {
        db.prepare('UPDATE channels SET last_test_at = ?, last_test_ok = 0, latency_ms = ? WHERE id = ?')
          .run(now(), r.latency, row.id)
      }
      results.push({ id: row.id, name: row.name, ok: r.ok, latency_ms: r.latency, message: r.message })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))
  res.json({
    success: true,
    data: { total: results.length, ok: results.filter(r => r.ok).length, results }
  })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// 手动测活:成功则同时解除熔断
router.post('/:id/test', async (req, res) => {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '渠道不存在')
  const result = await testChannel(row, req.body?.model)
  if (result.ok) {
    db.prepare(
      'UPDATE channels SET last_test_at = ?, last_test_ok = 1, latency_ms = ?, fail_count = 0, auto_disabled = 0 WHERE id = ?'
    ).run(now(), result.latency, row.id)
  } else {
    db.prepare('UPDATE channels SET last_test_at = ?, last_test_ok = 0, latency_ms = ? WHERE id = ?')
      .run(now(), result.latency, row.id)
  }
  res.json({ success: true, data: { ok: result.ok, latency_ms: result.latency, message: result.message } })
})

export default router
