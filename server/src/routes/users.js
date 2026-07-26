import { Router } from 'express'
import { db } from '../db.js'
import { authRequired, adminRequired, publicUser } from '../middleware/auth.js'
import { badRequest, usd } from '../util.js'

const router = Router()
router.use(authRequired, adminRequired)

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all()
  res.json({ success: true, data: rows.map(publicUser) })
})

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '用户不存在')
  const { quota, role, status, group_name } = req.body || {}
  if (row.id === req.user.id && (status === 0 || (role && role !== 'admin'))) {
    return badRequest(res, '不能封禁或降级自己')
  }
  if (group_name !== undefined) {
    const g = db.prepare('SELECT name FROM groups WHERE name = ?').get(group_name)
    if (!g) return badRequest(res, '分组不存在')
  }
  db.prepare('UPDATE users SET quota = ?, role = ?, status = ?, group_name = ? WHERE id = ?').run(
    quota !== undefined ? usd(quota) : row.quota,
    role === 'admin' || role === 'user' ? role : row.role,
    status !== undefined ? (status ? 1 : 0) : row.status,
    group_name ?? row.group_name,
    row.id
  )
  res.json({ success: true, data: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)) })
})

router.delete('/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) return badRequest(res, '不能删除自己')
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

export default router
