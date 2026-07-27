// 余额变更流水与对账。
//
// 只记「非消费」的变动:充值、兑换、返利、注册赠送、管理员调整、退款。
// 消费不进这张表 —— logs 已经一条不落地记了,再记一遍等于把最热的表写两遍;
// 而且累计消费在 users.used_quota 上有一份不随日志清理而丢失的合计。
//
// 于是对账只需要一条恒等式:
//   余额 = 流水合计 - 累计消费
// 对不上就说明有绕过入口的写入(或者数据被改过),这正是我们想知道的。
import { db, now } from './db.js'
import { usd } from './util.js'

export const LEDGER_TYPES = {
  topup: '扫码充值',
  redeem: '兑换码',
  rebate: '邀请返利',
  signup: '注册赠送',
  admin: '管理员调整',
  refund: '退款',
  opening: '期初结转'
}

// 必须在调用方已经改完 users.quota 之后调用 —— balance_after 记的是变动后的真实余额,
// 事后才能靠它定位「是哪一笔把余额写歪的」。
export function recordLedger({ userId, amount, type, note = null, operatorId = null }) {
  const value = usd(amount)
  if (!value) return null // 0 不记,省得流水里全是噪音
  const row = db.prepare('SELECT quota FROM users WHERE id = ?').get(userId)
  const info = db.prepare(
    `INSERT INTO balance_ledger (user_id, amount, balance_after, type, note, operator_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, value, usd(row?.quota ?? 0), type, note, operatorId, now())
  return info.lastInsertRowid
}

export function listLedger(userId, { limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(
    `SELECT l.*, u.username AS operator_name
     FROM balance_ledger l LEFT JOIN users u ON u.id = l.operator_id
     WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ? OFFSET ?`
  ).all(userId, limit, offset)
  const total = db.prepare('SELECT COUNT(*) AS c FROM balance_ledger WHERE user_id = ?').get(userId).c
  return { rows, total }
}

// 对账:逐个用户核对「流水合计 - 累计消费」是否等于当前余额。
//
// 允许一分钱以内的误差 —— 金额收敛到微美元,长期累加下来末位可能差一点点,
// 那不是问题;真正要抓的是无法用流水解释的大额偏差。
//
// 差额为正(余额比该有的多)通常意味着有绕过 recordLedger 的入账,或者数据被直接改过。
// 差额为负一般是落账时余额兜底到 0 造成的:计费用了 MAX(0, quota - cost),
// 而 used_quota 记的是全额 —— 也就是说这部分服务用户没付钱,平台自己吃了。
// 预扣费理论上不该让它发生,真出现了正说明预扣有漏洞,是要查的。
const TOLERANCE = 0.01

export function reconcile() {
  const rows = db.prepare(
    `SELECT u.id, u.username, u.quota, u.used_quota,
            COALESCE((SELECT SUM(amount) FROM balance_ledger WHERE user_id = u.id), 0) AS credited
     FROM users u`
  ).all()

  const issues = []
  for (const r of rows) {
    const expected = usd(r.credited - r.used_quota)
    const diff = usd(r.quota - expected)
    if (Math.abs(diff) > TOLERANCE) {
      issues.push({
        user_id: r.id, username: r.username,
        quota: usd(r.quota), expected, diff,
        credited: usd(r.credited), used_quota: usd(r.used_quota)
      })
    }
  }
  issues.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  return { checked: rows.length, issues }
}
