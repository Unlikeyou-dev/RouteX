import { Router } from 'express'
import { db, now, getSetting } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { genRedemptionCode, badRequest, usd } from '../util.js'

const router = Router()
router.use(authRequired)

// 兑换(所有用户)
router.post('/redeem', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase()
  if (!code) return badRequest(res, '请输入兑换码')
  const redeem = db.transaction(() => {
    const row = db.prepare("SELECT * FROM redemptions WHERE code = ? AND status = 'unused'").get(code)
    if (!row) throw new Error('兑换码无效或已被使用')
    db.prepare("UPDATE redemptions SET status = 'used', used_by = ?, used_at = ? WHERE id = ?").run(
      req.user.id, now(), row.id
    )
    db.prepare('UPDATE users SET quota = ROUND(quota + ?, 6) WHERE id = ?').run(usd(row.amount), req.user.id)
    // 邀请返利:邀请人按比例分成
    if (req.user.invited_by) {
      const percent = Number(getSetting('aff_rebate_percent', '0')) || 0
      const rebate = usd((row.amount * percent) / 100)
      if (rebate > 0) {
        db.prepare('UPDATE users SET quota = ROUND(quota + ?, 6), aff_earned = ROUND(aff_earned + ?, 6) WHERE id = ?')
          .run(rebate, rebate, req.user.invited_by)
      }
    }
    return row.amount
  })
  try {
    const amount = redeem()
    const user = db.prepare('SELECT quota FROM users WHERE id = ?').get(req.user.id)
    res.json({ success: true, data: { amount, quota: user.quota } })
  } catch (e) {
    badRequest(res, e.message)
  }
})

// 以下管理员专用
router.use(adminRequired)

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, u.username AS used_by_name FROM redemptions r
       LEFT JOIN users u ON u.id = r.used_by ORDER BY r.id DESC LIMIT 200`
    )
    .all()
  res.json({ success: true, data: rows })
})

router.post('/', (req, res) => {
  const amount = Number(req.body?.amount)
  const count = Math.min(Math.max(1, Number(req.body?.count) || 1), 100)
  if (!amount || amount <= 0) return badRequest(res, '面额需大于 0')
  const codes = []
  const ins = db.prepare('INSERT INTO redemptions (code, amount, created_at) VALUES (?, ?, ?)')
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const code = genRedemptionCode()
      ins.run(code, amount, now())
      codes.push(code)
    }
  })
  tx()
  res.json({ success: true, data: { codes, amount } })
})

router.delete('/:id', (req, res) => {
  db.prepare("DELETE FROM redemptions WHERE id = ? AND status = 'unused'").run(req.params.id)
  res.json({ success: true })
})

export default router
