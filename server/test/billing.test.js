import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { db, setSetting, now } = await import('../src/db.js')
const { creditUser } = await import('../src/billing.js')

let seq = 0
function makeUser({ quota = 0, invitedBy = null } = {}) {
  const name = `u${++seq}`
  const info = db
    .prepare('INSERT INTO users (username, password_hash, quota, invited_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, 'x', quota, invitedBy, now())
  return info.lastInsertRowid
}
const quotaOf = id => db.prepare('SELECT quota FROM users WHERE id = ?').get(id).quota
const affOf = id => db.prepare('SELECT aff_earned FROM users WHERE id = ?').get(id).aff_earned

test('入账:余额增加对应金额', () => {
  const id = makeUser({ quota: 1 })
  const r = creditUser(id, 10)
  assert.equal(quotaOf(id), 11)
  assert.equal(r.amount, 10)
  assert.equal(r.rebate, 0)
})

test('入账:被邀请人充值,邀请人按比例得返利', () => {
  setSetting('aff_rebate_percent', '10')
  const inviter = makeUser({ quota: 0 })
  const invitee = makeUser({ quota: 0, invitedBy: inviter })
  const r = creditUser(invitee, 50)
  assert.equal(quotaOf(invitee), 50)
  assert.equal(quotaOf(inviter), 5)
  assert.equal(affOf(inviter), 5)
  assert.equal(r.rebate, 5)
})

test('入账:没有邀请人时不产生返利', () => {
  setSetting('aff_rebate_percent', '10')
  const id = makeUser({ quota: 0 })
  const r = creditUser(id, 50)
  assert.equal(r.rebate, 0)
})

test('入账:返利比例为 0 时邀请人不加钱', () => {
  setSetting('aff_rebate_percent', '0')
  const inviter = makeUser({ quota: 0 })
  const invitee = makeUser({ quota: 0, invitedBy: inviter })
  creditUser(invitee, 50)
  assert.equal(quotaOf(inviter), 0)
  setSetting('aff_rebate_percent', '10')
})

test('入账:可显式关闭返利(用于管理员手动调额之类的场景)', () => {
  setSetting('aff_rebate_percent', '10')
  const inviter = makeUser({ quota: 0 })
  const invitee = makeUser({ quota: 0, invitedBy: inviter })
  creditUser(invitee, 50, { rebate: false })
  assert.equal(quotaOf(invitee), 50)
  assert.equal(quotaOf(inviter), 0)
})

test('入账:金额必须为正,防止被当成扣款用', () => {
  const id = makeUser({ quota: 5 })
  assert.throws(() => creditUser(id, 0))
  assert.throws(() => creditUser(id, -10))
  assert.equal(quotaOf(id), 5)
})

test('入账:多次累加不产生浮点漂移', () => {
  const id = makeUser({ quota: 0 })
  for (let i = 0; i < 100; i++) creditUser(id, 0.1)
  assert.equal(quotaOf(id), 10)
})

test('预扣费:条件更新在余额不足时不会成功,这是并发安全的基础', () => {
  const id = makeUser({ quota: 1 })
  const reserve = amount =>
    db.prepare('UPDATE users SET quota = ROUND(quota - ?, 6) WHERE id = ? AND quota >= ?')
      .run(amount, id, amount).changes

  assert.equal(reserve(0.6), 1)          // 够,扣掉
  assert.equal(quotaOf(id), 0.4)
  assert.equal(reserve(0.6), 0)          // 不够了,一分不动
  assert.equal(quotaOf(id), 0.4)
  assert.equal(reserve(0.4), 1)          // 刚好够
  assert.equal(quotaOf(id), 0)
})
