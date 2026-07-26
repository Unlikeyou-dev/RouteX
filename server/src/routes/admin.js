import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { lookupPrice } from '../pricing.js'
import { splitModels } from '../util.js'

const router = Router()
router.use(authRequired, adminRequired)

// 全站总览 —— 站长每天要看的第一屏。
// 注意口径:用户消耗的额度是站点「收入的实现」,充值是「现金流入」,两者不是一回事,
// 所以分开统计;RouteX 不掌握上游真实成本,不做毛利推算,避免给出误导性的数字。
router.get('/overview', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90)
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const todayTs = Math.floor(dayStart.getTime() / 1000)
  const since = todayTs - (days - 1) * 86400

  const today = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(cost), 0) AS revenue,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(status = 'error'), 0) AS errors
       FROM logs WHERE created_at >= ?`
    )
    .get(todayTs)

  const todayTopup = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM topups WHERE status = 'paid' AND reviewed_at >= ?")
    .get(todayTs)

  // 近 N 天曲线(全站)
  const rows = db
    .prepare(
      `SELECT date(created_at, 'unixepoch', 'localtime') AS day,
              COUNT(*) AS requests,
              COALESCE(SUM(cost), 0) AS revenue,
              COALESCE(SUM(total_tokens), 0) AS tokens
       FROM logs WHERE created_at >= ? GROUP BY day ORDER BY day`
    )
    .all(since)
  const byDay = Object.fromEntries(rows.map(r => [r.day, r]))
  const series = []
  for (let i = 0; i < days; i++) {
    const d = new Date(dayStart.getTime() - (days - 1 - i) * 86400_000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const r = byDay[key]
    series.push({ day: key, requests: r?.requests || 0, revenue: r?.revenue || 0, tokens: r?.tokens || 0 })
  }

  const users = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 1), 0) AS active,
              COALESCE(SUM(quota), 0) AS balance
       FROM users`
    )
    .get()
  // 「活跃」按近 N 天有过调用算,比单纯的账号状态更能反映真实盘子
  const activeUsers = db
    .prepare('SELECT COUNT(DISTINCT user_id) AS c FROM logs WHERE created_at >= ?')
    .get(since).c

  const topUsers = db
    .prepare(
      `SELECT u.username, COUNT(*) AS requests, COALESCE(SUM(l.cost), 0) AS revenue
       FROM logs l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.created_at >= ? GROUP BY l.user_id ORDER BY revenue DESC LIMIT 8`
    )
    .all(since)

  const topModels = db
    .prepare(
      `SELECT model, COUNT(*) AS requests, COALESCE(SUM(cost), 0) AS revenue
       FROM logs WHERE created_at >= ? GROUP BY model ORDER BY revenue DESC LIMIT 8`
    )
    .all(since)

  // 渠道健康:成功率与延迟直接决定用户体感,是排障的第一入口
  const channels = db
    .prepare(
      `SELECT c.id, c.name, c.status, c.auto_disabled, c.latency_ms, c.last_test_ok,
              c.used_quota, c.request_count,
              COALESCE(SUM(l.id IS NOT NULL), 0) AS recent_requests,
              COALESCE(SUM(l.status = 'error'), 0) AS recent_errors
       FROM channels c
       LEFT JOIN logs l ON l.channel_id = c.id AND l.created_at >= ?
       GROUP BY c.id ORDER BY c.used_quota DESC`
    )
    .all(since)

  // 待办:这些是需要站长动手的事,放在最显眼处
  const pendingTopups = db.prepare("SELECT COUNT(*) AS c FROM topups WHERE status = 'submitted'").get().c
  const brokenChannels = db.prepare('SELECT COUNT(*) AS c FROM channels WHERE auto_disabled = 1').get().c
  const modelNames = new Set()
  for (const c of db.prepare('SELECT models FROM channels WHERE status = 1').all()) {
    for (const m of splitModels(c.models)) modelNames.add(m)
  }
  let unpricedModels = 0
  for (const m of modelNames) if (lookupPrice(m).source === 'fallback') unpricedModels++

  res.json({
    success: true,
    data: {
      days,
      today: {
        requests: today.requests,
        revenue: today.revenue,
        tokens: today.tokens,
        errors: today.errors,
        topup_amount: todayTopup.amount,
        topup_count: todayTopup.count
      },
      series,
      users: { total: users.total, enabled: users.active, active: activeUsers, balance: users.balance },
      top_users: topUsers,
      top_models: topModels,
      channels,
      todo: {
        pending_topups: pendingTopups,
        broken_channels: brokenChannels,
        unpriced_models: unpricedModels
      },
      generated_at: now()
    }
  })
})

export default router
