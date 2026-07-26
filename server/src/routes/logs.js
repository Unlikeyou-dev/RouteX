import { Router } from 'express'
import { db } from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()
router.use(authRequired)

router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Number(req.query.page_size) || 20)
  const { model, status, scope } = req.query

  const isAdminAll = req.user.role === 'admin' && scope === 'all'
  const where = []
  const params = []
  if (!isAdminAll) {
    where.push('l.user_id = ?')
    params.push(req.user.id)
  }
  if (model) {
    where.push('l.model LIKE ?')
    params.push(`%${model}%`)
  }
  if (status === 'success' || status === 'error') {
    where.push('l.status = ?')
    params.push(status)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = db.prepare(`SELECT COUNT(*) AS c FROM logs l ${whereSql}`).get(...params).c
  const rows = db
    .prepare(
      `SELECT l.*, u.username, t.name AS token_name, c.name AS channel_name
       FROM logs l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN tokens t ON t.id = l.token_id
       LEFT JOIN channels c ON c.id = l.channel_id
       ${whereSql} ORDER BY l.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize)

  // 非管理员不返回渠道信息
  if (req.user.role !== 'admin') rows.forEach(r => delete r.channel_name)
  res.json({ success: true, data: { rows, total, page, page_size: pageSize } })
})

export default router
