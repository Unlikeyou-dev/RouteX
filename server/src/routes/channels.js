import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { badRequest, normalizeBaseUrl } from '../util.js'
import { testChannel } from '../health.js'

const router = Router()
router.use(authRequired, adminRequired)

const TYPES = ['openai', 'anthropic', 'gemini']

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY priority DESC, id').all()
  res.json({ success: true, data: rows })
})

router.post('/', (req, res) => {
  const {
    name, base_url = '', api_key, models = '', model_mapping = '{}',
    priority = 0, weight = 1, type = 'openai'
  } = req.body || {}
  if (!name || !api_key) return badRequest(res, '名称、密钥均为必填')
  if (!TYPES.includes(type)) return badRequest(res, '未知的渠道类型')
  try { JSON.parse(model_mapping || '{}') } catch { return badRequest(res, '模型映射需为合法 JSON') }
  const info = db
    .prepare(
      `INSERT INTO channels (name, base_url, api_key, models, model_mapping, priority, weight, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name, normalizeBaseUrl(base_url, type), api_key, models, model_mapping || '{}',
      Number(priority) || 0, Number(weight) || 1, type, now()
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
  // 手动启用时清除熔断状态,给渠道重新上场的机会
  const enabling = b.status !== undefined && b.status && row.status !== 1
  db.prepare(
    `UPDATE channels SET name=?, base_url=?, api_key=?, models=?, model_mapping=?, priority=?, weight=?, type=?, status=?,
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
    b.status !== undefined ? (b.status ? 1 : 0) : row.status,
    enabling ? 1 : 0,
    enabling ? 1 : 0,
    row.id
  )
  res.json({ success: true, data: db.prepare('SELECT * FROM channels WHERE id = ?').get(row.id) })
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
