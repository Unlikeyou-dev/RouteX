import { Router } from 'express'
import { db, now } from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { badRequest } from '../util.js'

const router = Router()
router.use(authRequired)

// 在线充值 —— 支付渠道尚未接入,当前为占位实现:
// 创建一笔 pending 订单并返回提示,后续接入支付后在回调中完成到账。
router.post('/', (req, res) => {
  const amount = Number(req.body?.amount)
  const method = String(req.body?.method || 'alipay')
  if (!amount || amount < 1) return badRequest(res, '充值金额至少 $1')
  if (!['alipay', 'wxpay', 'usdt'].includes(method)) return badRequest(res, '不支持的支付方式')
  const info = db
    .prepare('INSERT INTO topups (user_id, amount, method, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, amount, method, now())
  res.json({
    success: true,
    data: {
      order_id: info.lastInsertRowid,
      pay_url: null,
      message: '在线支付通道正在接入中,订单已保存。当前请使用兑换码充值,或联系管理员手动到账。'
    }
  })
})

router.get('/orders', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id)
  res.json({ success: true, data: rows })
})

export default router
