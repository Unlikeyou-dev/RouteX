import { Router } from 'express'
import { db } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { badRequest } from '../util.js'

const router = Router()
router.use(authRequired, adminRequired)

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.name, g.ratio, COUNT(u.id) AS user_count
       FROM groups g LEFT JOIN users u ON u.group_name = g.name
       GROUP BY g.name ORDER BY g.name`
    )
    .all()
  res.json({ success: true, data: rows })
})

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim()
  const ratio = Number(req.body?.ratio)
  if (!/^[\w-]{1,30}$/.test(name)) return badRequest(res, '分组名需为 1-30 位字母、数字、下划线')
  if (!Number.isFinite(ratio) || ratio <= 0) return badRequest(res, '倍率需为正数')
  const exists = db.prepare('SELECT name FROM groups WHERE name = ?').get(name)
  if (exists) return badRequest(res, '分组已存在')
  db.prepare('INSERT INTO groups (name, ratio) VALUES (?, ?)').run(name, ratio)
  res.json({ success: true })
})

router.put('/:name', (req, res) => {
  const ratio = Number(req.body?.ratio)
  if (!Number.isFinite(ratio) || ratio <= 0) return badRequest(res, '倍率需为正数')
  const info = db.prepare('UPDATE groups SET ratio = ? WHERE name = ?').run(ratio, req.params.name)
  if (info.changes === 0) return badRequest(res, '分组不存在')
  res.json({ success: true })
})

router.delete('/:name', (req, res) => {
  if (req.params.name === 'default') return badRequest(res, '默认分组不可删除')
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET group_name = 'default' WHERE group_name = ?").run(req.params.name)
    db.prepare('DELETE FROM groups WHERE name = ?').run(req.params.name)
  })
  tx()
  res.json({ success: true })
})

export default router
