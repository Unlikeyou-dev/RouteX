import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { badRequest } from '../util.js'

const router = Router()
router.use(authRequired, adminRequired)

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY priority DESC, id').all()
  res.json({ success: true, data: rows })
})

router.post('/', (req, res) => {
  const { name, base_url, api_key, models = '', model_mapping = '{}', priority = 0, weight = 1 } = req.body || {}
  if (!name || !base_url || !api_key) return badRequest(res, '名称、Base URL、密钥均为必填')
  try { JSON.parse(model_mapping || '{}') } catch { return badRequest(res, '模型映射需为合法 JSON') }
  const info = db
    .prepare(
      'INSERT INTO channels (name, base_url, api_key, models, model_mapping, priority, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(name, base_url.replace(/\/+$/, ''), api_key, models, model_mapping || '{}', Number(priority) || 0, Number(weight) || 1, now())
  res.json({ success: true, data: db.prepare('SELECT * FROM channels WHERE id = ?').get(info.lastInsertRowid) })
})

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '渠道不存在')
  const b = req.body || {}
  if (b.model_mapping !== undefined) {
    try { JSON.parse(b.model_mapping || '{}') } catch { return badRequest(res, '模型映射需为合法 JSON') }
  }
  db.prepare(
    `UPDATE channels SET name=?, base_url=?, api_key=?, models=?, model_mapping=?, priority=?, weight=?, status=? WHERE id=?`
  ).run(
    b.name ?? row.name,
    (b.base_url ?? row.base_url).replace(/\/+$/, ''),
    b.api_key ?? row.api_key,
    b.models ?? row.models,
    b.model_mapping ?? row.model_mapping,
    b.priority !== undefined ? Number(b.priority) || 0 : row.priority,
    b.weight !== undefined ? Number(b.weight) || 1 : row.weight,
    b.status !== undefined ? (b.status ? 1 : 0) : row.status,
    row.id
  )
  res.json({ success: true, data: db.prepare('SELECT * FROM channels WHERE id = ?').get(row.id) })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// 连通性测试:向上游发起一次最小 chat 请求
router.post('/:id/test', async (req, res) => {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '渠道不存在')
  const model = (req.body?.model || row.models.split(',')[0] || 'gpt-4o-mini').trim()
  const start = Date.now()
  let ok = 0
  let message = ''
  try {
    const resp = await fetch(`${row.base_url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${row.api_key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(20_000)
    })
    ok = resp.ok ? 1 : 0
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      message = `HTTP ${resp.status}: ${text.slice(0, 200)}`
    }
  } catch (e) {
    message = e.message || '连接失败'
  }
  const latency = Date.now() - start
  db.prepare('UPDATE channels SET last_test_at = ?, last_test_ok = ?, latency_ms = ? WHERE id = ?').run(
    now(), ok, latency, row.id
  )
  res.json({ success: true, data: { ok: !!ok, latency_ms: latency, message } })
})

export default router
