// 余额入账的唯一入口 —— 兑换码、扫码充值、管理员手动加额都走这里,
// 保证「加余额 + 邀请返利」两件事永远一致,不会某条路径漏算返利。
import { db, now, getSetting } from './db.js'
import { usd } from './util.js'
import { recordLedger } from './ledger.js'

// 注意:调用方通常已经在事务里(审核入账需要和订单状态一起原子提交),
// 所以这里不自己开事务,只做纯粹的写操作。
export function creditUser(userId, amount, { rebate = true, type = 'topup', note = null, operatorId = null } = {}) {
  const value = usd(amount)
  if (!(value > 0)) throw new Error('入账金额需大于 0')

  db.prepare('UPDATE users SET quota = ROUND(quota + ?, 6) WHERE id = ?').run(value, userId)
  recordLedger({ userId, amount: value, type, note, operatorId })

  let rebateAmount = 0
  if (rebate) {
    const user = db.prepare('SELECT invited_by FROM users WHERE id = ?').get(userId)
    if (user?.invited_by) {
      const percent = Number(getSetting('aff_rebate_percent', '0')) || 0
      rebateAmount = usd((value * percent) / 100)
      if (rebateAmount > 0) {
        db.prepare(
          'UPDATE users SET quota = ROUND(quota + ?, 6), aff_earned = ROUND(aff_earned + ?, 6) WHERE id = ?'
        ).run(rebateAmount, rebateAmount, user.invited_by)
        // 返利此前完全没有痕迹:只有 aff_earned 一个合计数,
        // 被邀请人那边入账多少、什么时候返的,事后一概查不到
        recordLedger({
          userId: user.invited_by, amount: rebateAmount, type: 'rebate',
          note: `来自用户 #${userId} 入账 ${value} 的 ${percent}%`
        })
      }
    }
  }
  return { amount: value, rebate: rebateAmount, at: now() }
}
