import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { genApiKey, badRequest } from '../util.js'

const router = Router()
router.use(authRequired)

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM tokens WHERE user_id = ? ORDER BY id DESC').all(req.user.id)
  res.json({ success: true, data: rows })
})

router.post('/', (req, res) => {
  const { name, unlimited = true, quota = 0, expires_at = null } = req.body || {}
  if (!name || !name.trim()) return badRequest(res, '请填写令牌名称')
  const key = genApiKey()
  const info = db
    .prepare(
      'INSERT INTO tokens (user_id, key, name, quota, unlimited, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(req.user.id, key, name.trim(), Number(quota) || 0, unlimited ? 1 : 0, expires_at || null, now())
  const row = db.prepare('SELECT * FROM tokens WHERE id = ?').get(info.lastInsertRowid)
  res.json({ success: true, data: row })
})

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tokens WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!row) return badRequest(res, '令牌不存在')
  const { name, unlimited, quota, expires_at, status } = req.body || {}
  db.prepare(
    `UPDATE tokens SET name = ?, unlimited = ?, quota = ?, expires_at = ?, status = ? WHERE id = ?`
  ).run(
    name !== undefined ? String(name) : row.name,
    unlimited !== undefined ? (unlimited ? 1 : 0) : row.unlimited,
    quota !== undefined ? Number(quota) || 0 : row.quota,
    expires_at !== undefined ? expires_at : row.expires_at,
    status !== undefined ? (status ? 1 : 0) : row.status,
    row.id
  )
  res.json({ success: true, data: db.prepare('SELECT * FROM tokens WHERE id = ?').get(row.id) })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tokens WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  res.json({ success: true })
})

export default router
