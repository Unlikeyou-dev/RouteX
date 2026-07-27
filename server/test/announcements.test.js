import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { startServer } = await import('./server-helper.js')
const { db } = await import('../src/db.js')

const srv = await startServer()
test.after(() => srv.close())

const admin = await srv.login('root', '123456')
const alice = await srv.register('alice_a', 'pass123')

// 迁移会带进来一条,先清干净,免得干扰计数
db.prepare('DELETE FROM announcements').run()

const create = (tok, body) => srv.post('/api/announcements', tok, body)
const list = (tok, q = '') => srv.get(`/api/announcements${q}`, tok)

test('未登录也能看公告 —— 落地页要在没登录时就显示「今晚维护」', async () => {
  await create(admin, { title: '今晚 02:00 维护 10 分钟', level: 'warning' })
  const r = await list(null)
  assert.equal(r.status, 200)
  assert.equal(r.json.data[0].title, '今晚 02:00 维护 10 分钟')
})

test('草稿对外不可见,管理员带 all=1 才看得到', async () => {
  await create(admin, { title: '还没想好要不要发', published: false })
  assert.ok(!(await list(null)).json.data.some(a => a.title.includes('还没想好')))
  assert.ok(!(await list(alice)).json.data.some(a => a.title.includes('还没想好')))
  assert.ok((await list(admin, '?all=1')).json.data.some(a => a.title.includes('还没想好')))
})

test('普通用户带 all=1 也拿不到草稿', async () => {
  const r = await list(alice, '?all=1')
  assert.ok(!r.json.data.some(a => a.published === 0), '参数不能成为越权的口子')
})

test('置顶的排在最前,不会被后来的日常通知顶下去', async () => {
  await create(admin, { title: '长期公告:计费规则', pinned: true, level: 'important' })
  await create(admin, { title: '后发的日常通知' })
  const rows = (await list(null)).json.data
  assert.equal(rows[0].title, '长期公告:计费规则')
  assert.equal(rows[0].pinned, 1)
})

test('只有管理员能发布 / 修改 / 删除', async () => {
  const r = await create(alice, { title: '我也来发一条' })
  assert.equal(r.status, 403)
  const id = (await list(admin, '?all=1')).json.data[0].id
  assert.equal((await srv.put(`/api/announcements/${id}`, alice, { title: 'x' })).status, 403)
  const del = await fetch(`${srv.base}/api/announcements/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${alice}` }
  })
  assert.equal(del.status, 403)
})

test('标题不能为空,未知级别回落到 info', async () => {
  assert.equal((await create(admin, { title: '   ' })).status, 400)
  const r = await create(admin, { title: '级别测试', level: '瞎写的' })
  const a = (await list(admin, '?all=1')).json.data.find(x => x.id === r.json.data.id)
  assert.equal(a.level, 'info')
})

// ---- 未读 ----

test('未读数:新用户看到的是全部已发布公告', async () => {
  const bob = await srv.register('bob_a', 'pass123')
  const published = (await list(null)).json.data.length
  assert.equal((await srv.get('/api/announcements/unread-count', bob)).json.data.count, published)
})

test('标记已读后未读归零,之后新发的又会计数', async () => {
  const carol = await srv.register('carol_a', 'pass123')
  await srv.post('/api/announcements/read', carol)
  assert.equal((await srv.get('/api/announcements/unread-count', carol)).json.data.count, 0)

  // 直接插一条时间在「已读之后」的公告。测试跑得比一秒快,靠真实时间推进不可靠
  const readAt = db.prepare('SELECT announcement_read_at AS t FROM users WHERE username = ?').get('carol_a').t
  db.prepare(
    "INSERT INTO announcements (title, body, level, pinned, published, created_at, updated_at) VALUES ('读完之后才发的', '', 'info', 0, 1, ?, ?)"
  ).run(readAt + 60, readAt + 60)
  assert.equal((await srv.get('/api/announcements/unread-count', carol)).json.data.count, 1)
  // 这条是未来时间戳,留着会让后面每个测试用户都多出一条未读
  db.prepare("DELETE FROM announcements WHERE title = '读完之后才发的'").run()
})

test('列表给登录用户标出哪些未读,未登录时不标', async () => {
  const dave = await srv.register('dave_a', 'pass123')
  assert.ok((await list(dave)).json.data.every(a => a.unread === true))
  await srv.post('/api/announcements/read', dave)
  assert.ok((await list(dave)).json.data.every(a => a.unread === false))
  assert.ok((await list(null)).json.data.every(a => a.unread === false), '未登录没有「未读」这个概念')
})

test('改公告不重置 created_at —— 改个错别字不该让所有人重新收到提醒', async () => {
  const eve = await srv.register('eve_a', 'pass123')
  await srv.post('/api/announcements/read', eve)
  const id = (await list(admin, '?all=1')).json.data.find(a => a.published === 1).id
  const before = (await list(admin, '?all=1')).json.data.find(a => a.id === id).created_at

  await srv.put(`/api/announcements/${id}`, admin, { title: '修正过错别字的标题' })
  const after = (await list(admin, '?all=1')).json.data.find(a => a.id === id)
  assert.equal(after.created_at, before)
  assert.ok(after.updated_at >= before)
  assert.equal((await srv.get('/api/announcements/unread-count', eve)).json.data.count, 0)
})

test('无效 token 按未登录处理,而不是让整块内容报错空掉', async () => {
  const r = await list('not-a-valid-jwt')
  assert.equal(r.status, 200)
  assert.ok(r.json.data.length > 0)
})
