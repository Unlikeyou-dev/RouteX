import { Router } from 'express'
import { db, now, getSetting } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { badRequest, usd, genOrderNo } from '../util.js'
import { creditUser } from '../billing.js'
import { notify } from '../bark.js'
import { getProvider, listMethods } from '../payments/index.js'

const router = Router()
router.use(authRequired)

// 未支付订单 30 分钟过期;已提交待确认的订单不会过期,一直等管理员处理
const PENDING_TTL = 30 * 60

const cnyRate = () => Number(getSetting('cny_rate', '7.3')) || 7.3
const minTopup = () => Number(getSetting('topup_min', '1')) || 1

// 惰性过期:读订单时顺手把超时未支付的置为 expired,省掉一个定时任务
function expireStale() {
  db.prepare("UPDATE topups SET status = 'expired' WHERE status = 'pending' AND created_at < ?")
    .run(now() - PENDING_TTL)
}

function publicOrder(row) {
  if (!row) return null
  return {
    id: row.id,
    order_no: row.order_no,
    amount: row.amount,
    cny_amount: row.cny_amount,
    method: row.method,
    status: row.status,
    payer_note: row.payer_note,
    review_note: row.review_note,
    created_at: row.created_at,
    expires_at: row.status === 'pending' ? row.created_at + PENDING_TTL : null
  }
}

// ---- 充值页配置(收款方式、汇率、可选金额)----
router.get('/config', (req, res) => {
  const methods = listMethods()
  const provider = getProvider('manual')
  res.json({
    success: true,
    data: {
      methods: methods.map(m => ({ ...m, qr_image: provider.qrOf(m.key) })),
      cny_rate: cnyRate(),
      min: minTopup(),
      amounts: [5, 10, 30, 50, 100, 200],
      // 人工确认模式:告诉前端要走「付款 → 提交 → 等审核」的流程
      auto: provider.auto
    }
  })
})

// ---- 我的订单 ----
router.get('/orders', (req, res) => {
  expireStale()
  const rows = db
    .prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id)
  res.json({ success: true, data: rows.map(publicOrder) })
})

// ---- 管理员:订单审核 ----
router.get('/admin/orders', adminRequired, (req, res) => {
  expireStale()
  const status = String(req.query.status || '')
  const where = ['submitted', 'paid', 'rejected', 'pending', 'expired'].includes(status)
    ? 'WHERE t.status = ?'
    : ''
  const params = where ? [status] : []
  const rows = db
    .prepare(
      `SELECT t.*, u.username, r.username AS reviewer
       FROM topups t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN users r ON r.id = t.reviewed_by
       ${where} ORDER BY (t.status = 'submitted') DESC, t.id DESC LIMIT 200`
    )
    .all(...params)
  const pendingCount = db
    .prepare("SELECT COUNT(*) AS c FROM topups WHERE status = 'submitted'")
    .get().c
  res.json({ success: true, data: { rows, pending_count: pendingCount } })
})

// 确认到账:事务内「订单状态 + 余额 + 返利」一起提交,靠 status 条件做幂等
router.post('/admin/:id/approve', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM topups WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '订单不存在')
  if (row.status === 'paid') return badRequest(res, '该订单已到账,请勿重复确认')
  if (!['submitted', 'pending', 'expired'].includes(row.status)) {
    return badRequest(res, `订单当前状态为 ${row.status},不能确认`)
  }

  let result
  try {
    result = db.transaction(() => {
      // 条件更新 = 幂等锁:并发点两次只有一次能把状态从非 paid 改成 paid
      const upd = db
        .prepare(
          "UPDATE topups SET status = 'paid', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status != 'paid'"
        )
        .run(req.user.id, now(), String(req.body?.note || '').slice(0, 200) || null, row.id)
      if (upd.changes !== 1) throw new Error('该订单已到账,请勿重复确认')
      return creditUser(row.user_id, row.amount)
    })()
  } catch (e) {
    return badRequest(res, e.message)
  }

  const user = db.prepare('SELECT username, quota FROM users WHERE id = ?').get(row.user_id)
  notify({
    title: '✅ 充值已确认',
    body: `${user.username} 充值 ${usd(row.amount)} 已到账\n订单 ${row.order_no}`,
    group: 'RouteX充值'
  })
  res.json({
    success: true,
    data: { amount: result.amount, rebate: result.rebate, username: user.username, quota: user.quota }
  })
})

router.post('/admin/:id/reject', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM topups WHERE id = ?').get(req.params.id)
  if (!row) return badRequest(res, '订单不存在')
  if (row.status === 'paid') return badRequest(res, '已到账的订单不能驳回')
  db.prepare(
    "UPDATE topups SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?"
  ).run(req.user.id, now(), String(req.body?.note || '').slice(0, 200) || null, row.id)
  res.json({ success: true })
})

// ---- 下单 ----
router.post('/', (req, res) => {
  const amount = usd(req.body?.amount)
  const method = String(req.body?.method || '')
  const min = minTopup()
  if (!(amount >= min)) return badRequest(res, `充值金额至少 $${min}`)
  if (amount > 10000) return badRequest(res, '单笔充值金额过大,请分次充值')

  const provider = getProvider('manual')
  let pay
  try {
    pay = provider.createOrder({ method, amount })
  } catch (e) {
    return badRequest(res, e.message)
  }

  // 实付人民币按当前汇率换算并固定进订单 —— 之后管理员改汇率不影响已下单的订单
  const cny = Math.round(amount * cnyRate() * 100) / 100
  const orderNo = genOrderNo()
  const info = db
    .prepare(
      `INSERT INTO topups (user_id, amount, cny_amount, method, order_no, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(req.user.id, amount, cny, method, orderNo, now())

  const row = db.prepare('SELECT * FROM topups WHERE id = ?').get(info.lastInsertRowid)
  res.json({ success: true, data: { ...publicOrder(row), ...pay } })
})

// ---- 用户点「我已完成支付」----
router.post('/:id/submit', (req, res) => {
  const row = db.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!row) return badRequest(res, '订单不存在')
  if (row.status === 'paid') return badRequest(res, '该订单已到账')
  if (!['pending', 'expired'].includes(row.status)) return badRequest(res, '该订单已提交,请等待管理员确认')

  const note = String(req.body?.note || '').trim().slice(0, 100)
  db.prepare("UPDATE topups SET status = 'submitted', submitted_at = ?, payer_note = ? WHERE id = ?")
    .run(now(), note || null, row.id)

  const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM topups WHERE status = 'submitted'").get().c
  notify({
    title: `💰 待确认充值 ¥${row.cny_amount}`,
    body: [
      `用户 ${req.user.username} 提交了 ${usd(row.amount)} 的充值`,
      `订单 ${row.order_no} · ${row.method === 'alipay' ? '支付宝' : '微信'}`,
      note ? `备注:${note}` : null,
      `当前共 ${pendingCount} 笔待确认`
    ].filter(Boolean).join('\n'),
    group: 'RouteX充值',
    level: 'timeSensitive'
  })

  res.json({ success: true, data: publicOrder(db.prepare('SELECT * FROM topups WHERE id = ?').get(row.id)) })
})

// ---- 单个订单状态(前端轮询)----
router.get('/:id', (req, res) => {
  expireStale()
  const row = db.prepare('SELECT * FROM topups WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!row) return badRequest(res, '订单不存在')
  res.json({ success: true, data: publicOrder(row) })
})

export default router
