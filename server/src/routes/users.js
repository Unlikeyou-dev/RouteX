import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, now } from '../db.js'
import { authRequired, adminRequired, publicUser } from '../middleware/auth.js'
import { badRequest, usd, genTempPassword } from '../util.js'
import { recordLedger, listLedger, reconcile } from '../ledger.js'

const router = Router()
router.use(authRequired, adminRequired)

// ---- 密码找回申请 ----
// 声明在 /:id 之前,否则 "resets" 会被当成用户 id
router.get('/resets', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, u.username AS handler
       FROM password_resets r LEFT JOIN users u ON u.id = r.handled_by
       ORDER BY (r.status = 'pending') DESC, r.id DESC LIMIT 100`
    )
    .all()
  res.json({ success: true, data: rows })
})

router.post('/resets/:id/done', (req, res) => {
  db.prepare("UPDATE password_resets SET status = 'done', handled_by = ?, handled_at = ? WHERE id = ?")
    .run(req.user.id, now(), req.params.id)
  res.json({ success: true })
})

// 重置密码:生成临时密码并只返回这一次,同时吊销该用户所有已签发的登录态
router.post('/:id/reset-password', (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '用户不存在')
  const password = genTempPassword()
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), row.id)
  // 把该用户所有 pending 的找回申请一并标记处理完
  db.prepare("UPDATE password_resets SET status = 'done', handled_by = ?, handled_at = ? WHERE username = ? AND status = 'pending'")
    .run(req.user.id, now(), row.username)
  res.json({ success: true, data: { username: row.username, password } })
})

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all()
  res.json({ success: true, data: rows.map(publicUser) })
})

// 对账:核对每个用户「流水合计 - 累计消费」是否等于当前余额。
// 路由要放在 /:id 之前,否则 reconcile 会被当成用户 id
router.get('/reconcile', (req, res) => {
  res.json({ success: true, data: reconcile() })
})

router.get('/:id/ledger', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.page_size) || 20))
  const { rows, total } = listLedger(Number(req.params.id), { limit: size, offset: (page - 1) * size })
  res.json({ success: true, data: { rows, total, page, page_size: size } })
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
  // 这里是直接把余额**设成**某个值,不是加减 —— 原来完全不留痕,
  // 谁在什么时候把谁的余额从多少改成了多少,事后一概查不到
  const newQuota = quota !== undefined ? usd(quota) : row.quota
  const delta = usd(newQuota - row.quota)

  db.transaction(() => {
    db.prepare('UPDATE users SET quota = ?, role = ?, status = ?, group_name = ? WHERE id = ?').run(
      newQuota,
      role === 'admin' || role === 'user' ? role : row.role,
      status !== undefined ? (status ? 1 : 0) : row.status,
      group_name ?? row.group_name,
      row.id
    )
    if (delta) {
      recordLedger({
        userId: row.id, amount: delta, type: 'admin',
        note: `后台直接改余额:${usd(row.quota)} → ${newQuota}`,
        operatorId: req.user.id
      })
    }
  })()
  res.json({ success: true, data: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)) })
})

router.delete('/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) return badRequest(res, '不能删除自己')
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

export default router
