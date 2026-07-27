// 工单。用户提问 → 站长回复 → 直到关闭。
//
// 权限模型很简单但必须做对:除管理员外,任何读写都要带上 user_id 条件。
// 工单里会有订单号、报错原文这类内容,越权读到别人的就是事故 —— 所以下面
// 一律用「先按 id + user_id 取,取不到就当不存在」,不做「先取再比对」。
import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { consumeQuota } from '../middleware/ratelimit.js'
import { badRequest } from '../util.js'
import { notify } from '../bark.js'

const router = Router()
router.use(authRequired)

export const CATEGORIES = {
  topup: '充值问题',
  api: '接口报错',
  billing: '计费疑问',
  account: '账号问题',
  other: '其他'
}

const MAX_SUBJECT = 100
const MAX_BODY = 4000
// 开单限流:防止有人刷屏把 Bark 推爆。
// 用手动计数而不是中间件 —— 中间件会在校验之前就扣额度,用户把表单填错两次就白白少两次机会
const CREATE_WINDOW = 3_600_000
const CREATE_MAX = 10

const isAdmin = req => req.user.role === 'admin'

// 管理员看得到工单归属人,用户看自己的不需要
function withUser(row) {
  if (!row) return null
  const u = db.prepare('SELECT username, quota, group_name FROM users WHERE id = ?').get(row.user_id)
  return { ...row, username: u?.username || `#${row.user_id}`, user_quota: u?.quota ?? 0, user_group: u?.group_name || 'default' }
}

// 取工单:管理员可取任意一条,普通用户只能取自己的
function fetchTicket(req, id) {
  return isAdmin(req)
    ? db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(id, req.user.id)
}

// ---- 列表 ----

router.get('/', (req, res) => {
  const mine = !isAdmin(req) || req.query.scope === 'mine'
  const status = String(req.query.status || '').trim()
  const where = []
  const args = []
  if (mine) { where.push('user_id = ?'); args.push(req.user.id) }
  if (status && status !== 'all') { where.push('status = ?'); args.push(status) }
  const sql = `SELECT * FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 200`
  const rows = db.prepare(sql).all(...args)

  // 列表页要显示「最后一条说了什么」,否则一列标题看不出谁在等谁
  const last = db.prepare('SELECT body, is_staff, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id DESC LIMIT 1')
  res.json({
    success: true,
    data: rows.map(t => {
      const m = last.get(t.id)
      const base = isAdmin(req) ? withUser(t) : t
      return { ...base, last_message: m ? { ...m, body: m.body.slice(0, 120) } : null }
    })
  })
})

// 侧边栏角标:待你处理的工单数
router.get('/pending-count', adminRequired, (req, res) => {
  const c = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'open'").get().c
  res.json({ success: true, data: { count: c } })
})

// ---- 详情 ----

router.get('/:id', (req, res) => {
  const t = fetchTicket(req, req.params.id)
  if (!t) return badRequest(res, '工单不存在')
  const messages = db.prepare(
    `SELECT m.*, u.username FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.ticket_id = ? ORDER BY m.id`
  ).all(t.id)
  res.json({ success: true, data: { ticket: isAdmin(req) ? withUser(t) : t, messages } })
})

// ---- 新建 ----

router.post('/', (req, res) => {
  const subject = String(req.body?.subject || '').trim().slice(0, MAX_SUBJECT)
  const body = String(req.body?.body || '').trim().slice(0, MAX_BODY)
  const category = CATEGORIES[req.body?.category] ? req.body.category : 'other'
  if (!subject) return badRequest(res, '请填写标题')
  if (!body) return badRequest(res, '请描述你的问题')
  if (!consumeQuota(`ticket:u${req.user.id}`, CREATE_WINDOW, CREATE_MAX)) {
    return badRequest(res, `提交过于频繁,每小时最多开 ${CREATE_MAX} 张工单;有后续问题请在原工单里回复`)
  }

  const ts = now()
  const id = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO tickets (user_id, subject, category, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, subject, category, 'open', ts, ts)
    db.prepare(
      'INSERT INTO ticket_messages (ticket_id, user_id, is_staff, body, created_at) VALUES (?, ?, 0, ?, ?)'
    ).run(info.lastInsertRowid, req.user.id, body, ts)
    return Number(info.lastInsertRowid)
  })()

  notify({
    title: '🎫 新工单',
    body: `${req.user.username} · ${CATEGORIES[category]}\n${subject}\n\n${body.slice(0, 200)}`,
    group: 'RouteX工单'
  })
  res.json({ success: true, data: { id } })
})

// ---- 回复 ----

router.post('/:id/reply', (req, res) => {
  const t = fetchTicket(req, req.params.id)
  if (!t) return badRequest(res, '工单不存在')
  const body = String(req.body?.body || '').trim().slice(0, MAX_BODY)
  if (!body) return badRequest(res, '回复内容不能为空')

  const staff = isAdmin(req)
  const ts = now()
  // 站长回复 → 等用户;用户回复 → 回到待处理。已关闭的工单被回复则自动重开 ——
  // 让用户为了追问同一件事再开一张单,只会让上下文散掉
  const status = staff ? 'answered' : 'open'

  db.transaction(() => {
    db.prepare(
      'INSERT INTO ticket_messages (ticket_id, user_id, is_staff, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(t.id, req.user.id, staff ? 1 : 0, body, ts)
    db.prepare('UPDATE tickets SET status = ?, updated_at = ?, closed_at = NULL WHERE id = ?').run(status, ts, t.id)
  })()

  // 只在用户说话时推给站长 —— 站长自己回复还推给自己是噪音
  if (!staff) {
    notify({
      title: '💬 工单有新回复',
      body: `${req.user.username} · #${t.id} ${t.subject}\n\n${body.slice(0, 200)}`,
      group: 'RouteX工单'
    })
  }
  res.json({ success: true, data: { status } })
})

// ---- 关闭 / 重开 ----

router.post('/:id/close', (req, res) => {
  const t = fetchTicket(req, req.params.id)
  if (!t) return badRequest(res, '工单不存在')
  db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), t.id)
  res.json({ success: true })
})

router.post('/:id/reopen', (req, res) => {
  const t = fetchTicket(req, req.params.id)
  if (!t) return badRequest(res, '工单不存在')
  db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL, updated_at = ? WHERE id = ?").run(now(), t.id)
  res.json({ success: true })
})

export default router
