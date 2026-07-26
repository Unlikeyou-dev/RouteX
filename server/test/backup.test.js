import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { useTempDataDir } from './helpers.js'

const dir = useTempDataDir()

const { db, setSetting } = await import('../src/db.js')
const { backupNow, verifyBackup, listBackups, BACKUP_DIR } = await import('../src/maintenance.js')
const { uploadBackup, storageConfigured } = await import('../src/storage.js')

test('备份:产出的文件能通过完整性校验', async () => {
  const info = await backupNow({ silent: true })
  const file = path.join(BACKUP_DIR, info.file)
  assert.ok(fs.existsSync(file))
  assert.equal(verifyBackup(file).ok, true)
})

test('校验:文件被截断时必须报错,不能只看大小蒙混过关', async () => {
  const info = await backupNow({ silent: true })
  const file = path.join(BACKUP_DIR, info.file)
  const buf = fs.readFileSync(file)
  // 保留一个像模像样的体积,只把中间打烂 —— 只比大小的话这种损坏查不出来
  buf.fill(0, 4096, Math.min(buf.length, 20480))
  fs.writeFileSync(file, buf)

  const r = verifyBackup(file)
  assert.equal(r.ok, false)
  assert.ok(r.message)
})

test('校验:根本不是数据库的文件要被挡下', () => {
  const bogus = path.join(dir, 'not-a-db.db')
  fs.writeFileSync(bogus, 'hello world'.repeat(100))
  assert.equal(verifyBackup(bogus).ok, false)
})

test('校验:关键表在备份里为空(主库有数据)要判失败', () => {
  // 主库有 root 账号;造一个结构正确但 users 为空的库
  const empty = path.join(dir, 'empty.db')
  const d = new Database(empty)
  d.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE tokens (id INTEGER PRIMARY KEY);'
    + 'CREATE TABLE channels (id INTEGER PRIMARY KEY); CREATE TABLE topups (id INTEGER PRIMARY KEY);'
    + 'CREATE TABLE redemptions (id INTEGER PRIMARY KEY);')
  d.close()

  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0, '主库应当有 root 账号')
  const r = verifyBackup(empty)
  assert.equal(r.ok, false)
  assert.match(r.message, /users/)
})

test('备份:同一秒内连备两次不会静默覆盖', async () => {
  const a = await backupNow({ silent: true })
  const b = await backupNow({ silent: true })
  assert.notEqual(a.file, b.file, '撞名的话你以为有两份,其实只有一份')
  assert.ok(fs.existsSync(path.join(BACKUP_DIR, a.file)))
  assert.ok(fs.existsSync(path.join(BACKUP_DIR, b.file)))
})

test('备份:坏掉的副本被隔离,不占用保留份数把好备份挤掉', async () => {
  const info = await backupNow({ silent: true })
  const file = path.join(BACKUP_DIR, info.file)
  fs.renameSync(file, `${file}.corrupt`) // backupNow 校验失败时就是这样处置的
  assert.ok(
    listBackups().every(b => b.file.endsWith('.db') && !b.file.includes('.corrupt')),
    '坏副本被算进保留份数的话,轮转会把好的删掉'
  )
})

test('对象存储:没配全时不算配置好,也不会真去发请求', async () => {
  setSetting('s3_endpoint', '')
  assert.equal(storageConfigured(), false)
  const r = await uploadBackup('x.db', Buffer.from('x'))
  assert.equal(r.ok, false)
  assert.match(r.message, /未配置/)
})

test('对象存储:上传按 SigV4 签名,请求形状正确', async () => {
  setSetting('s3_endpoint', 'https://acc.r2.cloudflarestorage.com')
  setSetting('s3_bucket', 'routex')
  setSetting('s3_access_key', 'AKIAEXAMPLE')
  setSetting('s3_secret_key', 'secret')
  setSetting('s3_region', 'auto')
  setSetting('s3_prefix', 'backups')
  assert.equal(storageConfigured(), true)

  let seen = null
  global.fetch = async (url, init) => {
    seen = { url: String(url), init }
    return new Response('', { status: 200 })
  }

  const body = Buffer.from('database bytes')
  const r = await uploadBackup('routex-20260727.db', body)
  assert.equal(r.ok, true)
  assert.equal(r.key, 'backups/routex-20260727.db')

  assert.equal(seen.init.method, 'PUT')
  assert.equal(seen.url, 'https://acc.r2.cloudflarestorage.com/routex/backups/routex-20260727.db')

  const auth = seen.init.headers.Authorization
  assert.match(auth, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/)
  // 签名头列表必须与实际发出的头一致且已排序,差一个字节就是 403
  assert.match(auth, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/)
  assert.match(auth, /Signature=[0-9a-f]{64}$/)

  // 载荷哈希要对得上,否则上游算出来的签名和我们不一样
  const expect = crypto.createHash('sha256').update(body).digest('hex')
  assert.equal(seen.init.headers['x-amz-content-sha256'], expect)
  assert.match(seen.init.headers['x-amz-date'], /^\d{8}T\d{6}Z$/)
})

test('对象存储:上游返回错误时如实报回,不能假装成功', async () => {
  global.fetch = async () => new Response('<Error>SignatureDoesNotMatch</Error>', { status: 403 })
  const r = await uploadBackup('x.db', Buffer.from('x'))
  assert.equal(r.ok, false)
  assert.match(r.message, /403/)
})
