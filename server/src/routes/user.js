import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, now } from '../db.js'
import { authRequired, publicUser, signToken } from '../middleware/auth.js'
import { badRequest } from '../util.js'
import { listLedger } from '../ledger.js'

const router = Router()
router.use(authRequired)

router.get('/me', (req, res) => {
  res.json({ success: true, data: publicUser(req.user) })
})

router.put('/me', (req, res) => {
  const { old_password, new_password, email } = req.body || {}
  let changedPassword = false
  if (new_password) {
    if (!bcrypt.compareSync(old_password || '', req.user.password_hash)) return badRequest(res, '原密码错误')
    if (new_password.length < 6) return badRequest(res, '新密码至少 6 位')
    // 递增会话版本 = 让其他设备上已签发的 token 立刻失效
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(bcrypt.hashSync(new_password, 10), req.user.id)
    changedPassword = true
  }
  if (email !== undefined) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, req.user.id)
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  // 改密码会把自己手上这张 token 也作废,所以顺手换发一张新的,
  // 否则用户一改完密码就被踢下线
  res.json({
    success: true,
    data: { ...publicUser(user), ...(changedPassword ? { token: signToken(user) } : {}) }
  })
})

// 自己的余额流水。管理端那份带 operator_id(谁改的),用户端不给 ——
// 让用户看见「是哪个管理员动了我的余额」没有意义,只会徒增疑虑。
router.get('/ledger', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.page_size) || 20))
  const { rows, total } = listLedger(req.user.id, { limit: size, offset: (page - 1) * size })
  res.json({
    success: true,
    data: {
      rows: rows.map(({ operator_id, operator_name, ...r }) => r),
      total, page, page_size: size
    }
  })
})

// 仪表盘统计:近 N 天用量曲线、模型分布、今日概览、最近日志
router.get('/dashboard', (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90)
  const uid = req.user.id
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const todayTs = Math.floor(dayStart.getTime() / 1000)
  const since = todayTs - (days - 1) * 86400

  const today = db
    .prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens
       FROM logs WHERE user_id = ? AND created_at >= ? AND status = 'success'`
    )
    .get(uid, todayTs)

  const rows = db
    .prepare(
      `SELECT date(created_at, 'unixepoch', 'localtime') AS day,
              COUNT(*) AS requests, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens
       FROM logs WHERE user_id = ? AND created_at >= ? AND status = 'success'
       GROUP BY day ORDER BY day`
    )
    .all(uid, since)
  const byDay = Object.fromEntries(rows.map(r => [r.day, r]))
  const series = []
  for (let i = 0; i < days; i++) {
    const d = new Date(dayStart.getTime() - (days - 1 - i) * 86400_000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const r = byDay[key]
    series.push({ day: key, requests: r?.requests || 0, cost: r?.cost || 0, tokens: r?.tokens || 0 })
  }

  const models = db
    .prepare(
      `SELECT model, COUNT(*) AS requests, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(total_tokens),0) AS tokens
       FROM logs WHERE user_id = ? AND created_at >= ? AND status = 'success'
       GROUP BY model ORDER BY cost DESC LIMIT 10`
    )
    .all(uid, since)

  const recent = db
    .prepare('SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 8')
    .all(uid)

  res.json({ success: true, data: { today, series, models, recent, user: publicUser(req.user) } })
})

export default router
