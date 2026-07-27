import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { startServer } = await import('./server-helper.js')

const srv = await startServer()
test.after(() => srv.close())

const admin = await srv.login('root', '123456')
const alice = await srv.register('alice_t', 'pass123')
const bob = await srv.register('bob_t', 'pass123')

const open = (tok, body) => srv.post('/api/tickets', tok, body)

test('提单:标题和内容都不能空', async () => {
  assert.equal((await open(alice, { subject: '', body: 'x' })).status, 400)
  assert.equal((await open(alice, { subject: 'x', body: '  ' })).status, 400)
})

test('提单:未知分类回落到「其他」,不是报错', async () => {
  const r = await open(alice, { subject: '标题', body: '内容', category: '不存在的分类' })
  assert.equal(r.status, 200)
  const d = await srv.get(`/api/tickets/${r.json.data.id}`, alice)
  assert.equal(d.json.data.ticket.category, 'other')
})

test('提单:首条内容作为第一条消息落库,状态是待处理', async () => {
  const r = await open(alice, { subject: '充值没到账', body: '订单 X1 付了没反应', category: 'topup' })
  const d = await srv.get(`/api/tickets/${r.json.data.id}`, alice)
  assert.equal(d.json.data.ticket.status, 'open')
  assert.equal(d.json.data.ticket.category, 'topup')
  assert.equal(d.json.data.messages.length, 1)
  assert.equal(d.json.data.messages[0].is_staff, 0)
  assert.equal(d.json.data.messages[0].body, '订单 X1 付了没反应')
})

// ---- 越权(工单里会有订单号、报错原文,读到别人的就是事故)----

test('越权:读不到别人的工单', async () => {
  const r = await open(alice, { subject: 'alice 的私事', body: '含订单号 ABC' })
  const id = r.json.data.id
  const asBob = await srv.get(`/api/tickets/${id}`, bob)
  assert.equal(asBob.status, 400)
  assert.ok(!JSON.stringify(asBob.json).includes('ABC'), '连报错里都不能带出内容')
})

test('越权:回复不了别人的工单', async () => {
  const id = (await open(alice, { subject: 't', body: 'b' })).json.data.id
  assert.equal((await srv.post(`/api/tickets/${id}/reply`, bob, { body: '插一句' })).status, 400)
  assert.equal((await srv.post(`/api/tickets/${id}/close`, bob, {})).status, 400)
})

test('越权:列表里只有自己的工单', async () => {
  await open(alice, { subject: 'A 的单', body: 'x' })
  await open(bob, { subject: 'B 的单', body: 'x' })
  const list = (await srv.get('/api/tickets', bob)).json.data
  assert.ok(list.length > 0)
  assert.ok(list.every(t => t.subject === 'B 的单'), '看到别人的标题也是泄露')
})

test('管理员能看到全部,并带上提单人信息', async () => {
  const list = (await srv.get('/api/tickets', admin)).json.data
  const names = new Set(list.map(t => t.username))
  assert.ok(names.has('alice_t') && names.has('bob_t'))
  assert.ok(list[0].user_quota !== undefined, '处理工单时不该还要去用户页查余额')
})

// ---- 状态流转 ----

test('流转:站长回复 → 等用户;用户再回 → 回到待处理', async () => {
  const id = (await open(alice, { subject: '流转', body: '问题' })).json.data.id

  await srv.post(`/api/tickets/${id}/reply`, admin, { body: '已处理' })
  let d = await srv.get(`/api/tickets/${id}`, alice)
  assert.equal(d.json.data.ticket.status, 'answered')
  assert.equal(d.json.data.messages.at(-1).is_staff, 1)

  await srv.post(`/api/tickets/${id}/reply`, alice, { body: '还有个问题' })
  d = await srv.get(`/api/tickets/${id}`, alice)
  assert.equal(d.json.data.ticket.status, 'open')
  assert.equal(d.json.data.messages.at(-1).is_staff, 0)
})

test('流转:关闭后再回复会自动重开,而不是让用户另开一张单', async () => {
  const id = (await open(alice, { subject: '关闭重开', body: '问题' })).json.data.id
  await srv.post(`/api/tickets/${id}/close`, alice, {})
  assert.equal((await srv.get(`/api/tickets/${id}`, alice)).json.data.ticket.status, 'closed')

  await srv.post(`/api/tickets/${id}/reply`, alice, { body: '追问' })
  const d = await srv.get(`/api/tickets/${id}`, alice)
  assert.equal(d.json.data.ticket.status, 'open', '另开一张单会让上下文散掉')
  assert.equal(d.json.data.ticket.closed_at, null)
})

test('待处理计数只算 open,且非管理员拿不到', async () => {
  const c = (await srv.get('/api/tickets/pending-count', admin)).json.data.count
  const all = (await srv.get('/api/tickets?scope=all', admin)).json.data
  assert.equal(c, all.filter(t => t.status === 'open').length)
  assert.equal((await srv.get('/api/tickets/pending-count', alice)).status, 403)
})

test('列表带最后一条消息摘要,否则看不出谁在等谁', async () => {
  const id = (await open(alice, { subject: '摘要', body: '第一条' })).json.data.id
  await srv.post(`/api/tickets/${id}/reply`, admin, { body: '站长的回复' })
  const t = (await srv.get('/api/tickets', alice)).json.data.find(x => x.id === id)
  assert.equal(t.last_message.body, '站长的回复')
  assert.equal(t.last_message.is_staff, 1)
})

test('超长输入被截断而不是拒绝', async () => {
  const r = await open(bob, { subject: 'x'.repeat(500), body: 'y'.repeat(9000) })
  const d = await srv.get(`/api/tickets/${r.json.data.id}`, bob)
  assert.equal(d.json.data.ticket.subject.length, 100)
  assert.equal(d.json.data.messages[0].body.length, 4000)
})

test('限流:校验失败的请求不占开单名额', async () => {
  const carol = await srv.register('carol_t', 'pass123')
  // 先把表单填错 5 次
  for (let i = 0; i < 5; i++) assert.equal((await open(carol, { subject: '', body: '' })).status, 400)
  // 名额应当还是满的:连开 10 张都该成功
  for (let i = 0; i < 10; i++) {
    assert.equal((await open(carol, { subject: `第 ${i} 张`, body: 'x' })).status, 200, `第 ${i + 1} 张不该被拦`)
  }
  // 第 11 张才超限
  const over = await open(carol, { subject: '第 11 张', body: 'x' })
  assert.equal(over.status, 400)
  assert.match(over.json.message, /频繁/)
})
