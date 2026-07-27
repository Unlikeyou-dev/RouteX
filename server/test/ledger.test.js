import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { db, setSetting, now } = await import('../src/db.js')
const { creditUser } = await import('../src/billing.js')
const { recordLedger, listLedger, reconcile } = await import('../src/ledger.js')

let seq = 0
function makeUser({ quota = 0, invitedBy = null } = {}) {
  const name = `u${++seq}`
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, quota, invited_by, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name, 'x', quota, invitedBy, now())
  return Number(info.lastInsertRowid)
}
const quotaOf = id => db.prepare('SELECT quota FROM users WHERE id = ?').get(id).quota

test('入账写流水,balance_after 记的是变动后的真实余额', () => {
  const id = makeUser({ quota: 5 })
  recordLedger({ userId: id, amount: 5, type: 'signup' })
  creditUser(id, 10, { type: 'topup', note: '订单 X1' })

  const { rows } = listLedger(id)
  assert.equal(rows[0].type, 'topup')
  assert.equal(rows[0].amount, 10)
  assert.equal(rows[0].balance_after, 15, '记成变动前的余额,事后就没法定位是哪一笔写歪的')
  assert.equal(rows[0].note, '订单 X1')
})

test('邀请返利也留痕:此前只有 aff_earned 一个合计数', () => {
  setSetting('aff_rebate_percent', '10')
  const inviter = makeUser()
  const invitee = makeUser({ invitedBy: inviter })

  creditUser(invitee, 100, { type: 'topup' })

  const { rows } = listLedger(inviter)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, 'rebate')
  assert.equal(rows[0].amount, 10)
  assert.equal(rows[0].balance_after, quotaOf(inviter))
  assert.match(rows[0].note, new RegExp(`#${invitee}`), '要能看出这笔返利是谁带来的')
})

test('金额为 0 不记流水,免得账本全是噪音', () => {
  const id = makeUser()
  recordLedger({ userId: id, amount: 0, type: 'admin' })
  assert.equal(listLedger(id).total, 0)
})

test('管理员调整记的是差额而不是新余额', () => {
  const id = makeUser({ quota: 30 })
  // 后台把余额从 30 改成 12 —— 流水该记 -18
  db.prepare('UPDATE users SET quota = ? WHERE id = ?').run(12, id)
  recordLedger({ userId: id, amount: 12 - 30, type: 'admin', operatorId: 1, note: '后台直接改余额:30 → 12' })

  const { rows } = listLedger(id)
  assert.equal(rows[0].amount, -18)
  assert.equal(rows[0].balance_after, 12)
  assert.equal(rows[0].operator_id, 1, '不记操作人就等于没有审计')
})

// ---- 对账 ----

test('对账:流水与消费能解释余额时不报问题', () => {
  const id = makeUser()
  creditUser(id, 100, { type: 'topup', rebate: false })
  // 花掉 40
  db.prepare('UPDATE users SET quota = ROUND(quota - ?, 6), used_quota = ROUND(used_quota + ?, 6) WHERE id = ?')
    .run(40, 40, id)

  assert.equal(quotaOf(id), 60)
  assert.ok(!reconcile().issues.some(i => i.user_id === id))
})

test('对账:绕过流水直接加钱会被抓出来', () => {
  const id = makeUser()
  creditUser(id, 50, { type: 'topup', rebate: false })
  db.prepare('UPDATE users SET quota = quota + 999 WHERE id = ?').run(id) // 模拟被直接改库

  const issue = reconcile().issues.find(i => i.user_id === id)
  assert.ok(issue, '账对不上却查不出来,这张表就白建了')
  assert.equal(issue.diff, 999)
  assert.equal(issue.expected, 50)
})

test('对账:微美元级的末位误差不算问题', () => {
  const id = makeUser()
  creditUser(id, 10, { type: 'topup', rebate: false })
  db.prepare('UPDATE users SET quota = quota + 0.000002 WHERE id = ?').run(id)
  assert.ok(!reconcile().issues.some(i => i.user_id === id))
})

test('对账:偏差大的排在前面', () => {
  const a = makeUser()
  const b = makeUser()
  db.prepare('UPDATE users SET quota = quota + 5 WHERE id = ?').run(a)
  db.prepare('UPDATE users SET quota = quota + 500 WHERE id = ?').run(b)
  const issues = reconcile().issues
  const ia = issues.findIndex(i => i.user_id === a)
  const ib = issues.findIndex(i => i.user_id === b)
  assert.ok(ib < ia)
})

test('对账:落账兜底到 0 造成的负差额也能看出来(平台自己吃了的部分)', () => {
  const id = makeUser()
  creditUser(id, 10, { type: 'topup', rebate: false })
  // 计费用的是 MAX(0, quota - cost),而 used_quota 记全额
  db.prepare('UPDATE users SET quota = MAX(0, quota - ?), used_quota = ROUND(used_quota + ?, 6) WHERE id = ?')
    .run(25, 25, id)

  const issue = reconcile().issues.find(i => i.user_id === id)
  assert.ok(issue)
  assert.equal(quotaOf(id), 0)
  assert.equal(issue.expected, -15, '负的预期余额 = 用户没付钱的那部分')
})
