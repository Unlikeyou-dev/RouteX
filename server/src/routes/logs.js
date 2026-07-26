import { Router } from 'express'
import { db } from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()
router.use(authRequired)

router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Number(req.query.page_size) || 20)
  const { model, status, scope, username, token_name, channel_id, start, end } = req.query

  const isAdmin = req.user.role === 'admin'
  const isAdminAll = isAdmin && scope === 'all'
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
  if (token_name) {
    where.push('t.name LIKE ?')
    params.push(`%${token_name}%`)
  }
  // 用户名与渠道筛选仅对管理员开放
  if (isAdminAll && username) {
    where.push('u.username LIKE ?')
    params.push(`%${username}%`)
  }
  if (isAdmin && channel_id) {
    where.push('l.channel_id = ?')
    params.push(Number(channel_id))
  }
  if (start) {
    where.push('l.created_at >= ?')
    params.push(Number(start))
  }
  if (end) {
    where.push('l.created_at <= ?')
    params.push(Number(end))
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // 汇总与分页共用同一套 JOIN,保证筛选口径一致
  const joinSql = `FROM logs l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN tokens t ON t.id = l.token_id
       LEFT JOIN channels c ON c.id = l.channel_id`

  const summary = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(l.cost), 0) AS cost,
              COALESCE(SUM(l.total_tokens), 0) AS tokens,
              COALESCE(SUM(l.cached_tokens), 0) AS cached,
              COALESCE(SUM(l.status = 'error'), 0) AS errors
       ${joinSql} ${whereSql}`
    )
    .get(...params)

  const rows = db
    .prepare(
      `SELECT l.*, u.username, t.name AS token_name, c.name AS channel_name
       ${joinSql} ${whereSql} ORDER BY l.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize)

  // 非管理员不返回渠道信息
  if (!isAdmin) rows.forEach(r => delete r.channel_name)
  res.json({
    success: true,
    data: {
      rows,
      total: summary.total,
      page,
      page_size: pageSize,
      summary: {
        count: summary.total,
        cost: summary.cost,
        tokens: summary.tokens,
        cached: summary.cached,
        errors: summary.errors
      }
    }
  })
})

export default router
