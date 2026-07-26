import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const jwt = (await import('jsonwebtoken')).default
const { db, now } = await import('../src/db.js')
const { signToken } = await import('../src/middleware/auth.js')
const { genTempPassword } = await import('../src/util.js')

let seq = 0
const makeUser = () => {
  const name = `au${++seq}`
  const id = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(name, 'x', now()).lastInsertRowid
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}
const decode = t => jwt.verify(t, process.env.JWT_SECRET)

test('会话版本:签发的 token 里带上当前版本号', () => {
  const u = makeUser()
  assert.equal(decode(signToken(u)).v, 0)
  db.prepare('UPDATE users SET token_version = 3 WHERE id = ?').run(u.id)
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)
  assert.equal(decode(signToken(fresh)).v, 3)
})

test('会话版本:改密码后版本递增,旧 token 的版本号就对不上了', () => {
  const u = makeUser()
  const oldToken = signToken(u)
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?')
    .run('newhash', u.id)
  const after = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)
  assert.notEqual(decode(oldToken).v, after.token_version)
  // 新签发的对得上
  assert.equal(decode(signToken(after)).v, after.token_version)
})

test('临时密码:长度足够且只含无歧义字符', () => {
  for (let i = 0; i < 50; i++) {
    const p = genTempPassword()
    assert.equal(p.length, 12)
    // 排除掉 0/O/1/l/I 这些抄起来会错的
    assert.ok(!/[0O1lI]/.test(p), `含易混字符: ${p}`)
    assert.ok(/^[A-Za-z2-9]+$/.test(p))
  }
})

test('临时密码:两次生成不重复', () => {
  const set = new Set()
  for (let i = 0; i < 200; i++) set.add(genTempPassword())
  assert.equal(set.size, 200)
})

test('找回申请:同一用户可多次提交,按状态区分待处理', () => {
  const u = makeUser()
  const ins = db.prepare('INSERT INTO password_resets (username, contact, created_at) VALUES (?, ?, ?)')
  ins.run(u.username, 'a@b.c', now())
  ins.run(u.username, 'a@b.c', now())
  const pending = db
    .prepare("SELECT COUNT(*) AS c FROM password_resets WHERE username = ? AND status = 'pending'")
    .get(u.username).c
  assert.equal(pending, 2)

  // 重置密码时会把该用户所有待处理申请一并结掉
  db.prepare("UPDATE password_resets SET status = 'done' WHERE username = ? AND status = 'pending'")
    .run(u.username)
  const left = db
    .prepare("SELECT COUNT(*) AS c FROM password_resets WHERE username = ? AND status = 'pending'")
    .get(u.username).c
  assert.equal(left, 0)
})
