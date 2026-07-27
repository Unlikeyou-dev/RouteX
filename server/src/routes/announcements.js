// 公告。
//
// 列表是公开的:落地页要在没登录的时候就显示,不然新访客看不到「今晚维护」。
// 写入一律要管理员。未读判定挂在用户身上,所以那几个接口需要登录。
import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired, adminRequired, optionalAuth } from '../middleware/auth.js'
import { badRequest } from '../util.js'

const router = Router()

export const LEVELS = ['info', 'warning', 'important']
const MAX_TITLE = 200
const MAX_BODY = 8000

// 置顶优先,其次按时间倒序 —— 「维护中」这类要一直挂在最上面,
// 不能被后来的日常通知顶下去
const ORDER = 'ORDER BY pinned DESC, id DESC'

// 公开列表:未登录也能看,所以只返回已发布的
router.get('/', optionalAuth, (req, res) => {
  const admin = req.user?.role === 'admin'
  // 管理员带 all=1 时连草稿一起看,别的一律只给已发布的
  const all = admin && req.query.all === '1'
  const rows = db.prepare(
    `SELECT * FROM announcements ${all ? '' : 'WHERE published = 1'} ${ORDER} LIMIT 100`
  ).all()
  const readAt = req.user?.announcement_read_at || 0
  res.json({
    success: true,
    data: rows.map(r => ({ ...r, unread: !!req.user && r.created_at > readAt }))
  })
})

router.get('/unread-count', authRequired, (req, res) => {
  const c = db.prepare(
    'SELECT COUNT(*) AS c FROM announcements WHERE published = 1 AND created_at > ?'
  ).get(req.user.announcement_read_at || 0).c
  res.json({ success: true, data: { count: c } })
})

router.post('/read', authRequired, (req, res) => {
  db.prepare('UPDATE users SET announcement_read_at = ? WHERE id = ?').run(now(), req.user.id)
  res.json({ success: true })
})

// ---- 管理 ----

function parseBody(body) {
  const title = String(body?.title || '').trim().slice(0, MAX_TITLE)
  if (!title) return { error: '请填写标题' }
  return {
    title,
    body: String(body?.body || '').trim().slice(0, MAX_BODY),
    level: LEVELS.includes(body?.level) ? body.level : 'info',
    pinned: body?.pinned ? 1 : 0,
    published: body?.published === false || body?.published === 0 ? 0 : 1
  }
}

router.post('/', authRequired, adminRequired, (req, res) => {
  const v = parseBody(req.body)
  if (v.error) return badRequest(res, v.error)
  const ts = now()
  const info = db.prepare(
    'INSERT INTO announcements (title, body, level, pinned, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(v.title, v.body, v.level, v.pinned, v.published, ts, ts)
  res.json({ success: true, data: { id: Number(info.lastInsertRowid) } })
})

router.put('/:id', authRequired, adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '公告不存在')
  const v = parseBody(req.body)
  if (v.error) return badRequest(res, v.error)
  // created_at 不动:改个错别字不该让所有人重新收到一次未读提醒。
  // 真要重新提醒,删掉重发就是了
  db.prepare(
    'UPDATE announcements SET title = ?, body = ?, level = ?, pinned = ?, published = ?, updated_at = ? WHERE id = ?'
  ).run(v.title, v.body, v.level, v.pinned, v.published, now(), row.id)
  res.json({ success: true })
})

router.delete('/:id', authRequired, adminRequired, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

export default router
