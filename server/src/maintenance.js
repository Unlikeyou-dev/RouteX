// 日常运维:日志保留清理 + SQLite 热备份。
// 两件事都是「不做不会立刻出事,出事就来不及了」的类型 ——
// 日志表只增不删会把磁盘吃满,而钱和订单全在一个 db 文件里,没有备份就是单点。
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { db, getSetting, now } from './db.js'
import { DATA_DIR } from './config.js'
import { uploadBackup, storageConfigured } from './storage.js'
import { notify } from './bark.js'

export const BACKUP_DIR = path.join(DATA_DIR, 'backups')

const retentionDays = () => Math.max(0, Number(getSetting('log_retention_days', '90')) || 0)
const backupKeep = () => Math.max(1, Number(getSetting('backup_keep', '7')) || 7)
const backupEnabled = () => getSetting('backup_enabled', '1') === '1'

// ---- 日志清理 ----
// 保留天数设为 0 表示永久保留。返回删除条数。
export function pruneLogs() {
  const days = retentionDays()
  if (days <= 0) return 0
  const cutoff = now() - days * 86400
  const info = db.prepare('DELETE FROM logs WHERE created_at < ?').run(cutoff)
  if (info.changes > 0) {
    console.log(`[RouteX] 清理了 ${info.changes} 条超过 ${days} 天的调用日志`)
    // 删除后页会被复用,但 WAL 需要回收一次,否则 -wal 文件会一直膨胀
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* 有并发读时跳过即可 */ }
  }
  return info.changes
}

// ---- 备份 ----
const stamp = () => {
  const d = new Date()
  const p = (x, n = 2) => String(x).padStart(n, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs
    .readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f))
      return { file: f, size: st.size, created_at: Math.floor(st.mtimeMs / 1000) }
    })
    .sort((a, b) => b.created_at - a.created_at)
}

function rotate() {
  const keep = backupKeep()
  const all = listBackups()
  for (const old of all.slice(keep)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, old.file))
    } catch { /* 删不掉就下次再说,不影响备份本身 */ }
  }
}

// 校验刚备出来的文件确实能用。
//
// 备份最经典的失败模式不是「没备」,而是「一直在备,恢复的时候发现是坏的」。
// 只看文件大小不够 —— 页损坏、截断都能凑出一个像样的体积。这里真的把它当数据库
// 打开跑一次 integrity_check,再核对关键表的行数与主库是否吻合。
const CRITICAL_TABLES = ['users', 'tokens', 'channels', 'topups', 'redemptions']

export function verifyBackup(file) {
  let copy
  try {
    copy = new Database(file, { readonly: true, fileMustExist: true })
    const check = copy.pragma('integrity_check', { simple: true })
    if (check !== 'ok') return { ok: false, message: `integrity_check: ${check}` }

    for (const t of CRITICAL_TABLES) {
      const mine = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c
      const theirs = copy.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c
      // 备份是热的,期间可能刚好有写入 —— 备份只会比主库少,多出来才说明有问题
      if (theirs > mine) return { ok: false, message: `${t} 行数异常(备份 ${theirs} > 主库 ${mine})` }
      if (mine > 0 && theirs === 0) return { ok: false, message: `${t} 在备份里是空的` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e.message || '无法打开备份文件' }
  } finally {
    try { copy?.close() } catch { /* 已经关了 */ }
  }
}

// better-sqlite3 的 backup() 是在线热备份,不会阻塞写入,也不会备出半个事务
// 文件名精确到秒,同一秒内备两次会撞名 —— 手动连点两下「立即备份」就能触发,
// 而结果是**静默覆盖**:你以为有两份,其实只有一份
function uniqueName() {
  const base = `routex-${stamp()}`
  let name = `${base}.db`
  for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, name)); i++) name = `${base}-${i}.db`
  return name
}

export async function backupNow({ silent = false } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const file = uniqueName()
  const dest = path.join(BACKUP_DIR, file)
  await db.backup(dest)

  const verified = verifyBackup(dest)
  if (!verified.ok) {
    // 坏备份不参与轮转,否则它会把好的那几份挤掉
    const bad = `${dest}.corrupt`
    try { fs.renameSync(dest, bad) } catch { /* 改不了名就留着,反正下面会报警 */ }
    if (!silent) alert('数据库备份校验失败', `${file}:${verified.message}`)
    throw new Error(`备份校验失败:${verified.message}`)
  }

  rotate()
  const size = fs.statSync(dest).size
  console.log(`[RouteX] 已备份数据库 → ${file} (${(size / 1024 / 1024).toFixed(2)} MB,校验通过)`)

  // 异地副本:这是唯一能挡住「整台机器没了」的一步
  let remote = null
  if (storageConfigured()) {
    remote = await uploadBackup(file, fs.readFileSync(dest))
    if (remote.ok) console.log(`[RouteX] 备份已上传至对象存储 → ${remote.key}`)
    else {
      console.error('[RouteX] 备份上传失败:', remote.message)
      if (!silent) alert('备份上传对象存储失败', `${file}:${remote.message}\n本地副本仍在,但机器故障时救不回来`)
    }
  }
  return { file, size, remote }
}

// 备份出问题必须主动告警。只写 console.error 的话,你可能几周之后才发现
// 备份早就停了 —— 而那时候已经晚了。
function alert(title, body) {
  console.error(`[RouteX] ${title}:${body}`)
  notify({ title: `RouteX ${title}`, body, group: 'RouteX 运维', level: 'critical' })
}

// ---- 调度 ----
// 每小时醒一次,判断「今天是否已经做过」,这样进程重启也不会漏掉当天的任务。
const HOUR = 3600_000
let lastRunDay = null

async function tick() {
  const today = new Date().toDateString()
  if (lastRunDay === today) return
  lastRunDay = today
  try {
    pruneLogs()
  } catch (e) {
    console.error('[RouteX] 日志清理失败:', e.message)
  }
  if (backupEnabled()) {
    try {
      await backupNow()
    } catch (e) {
      // backupNow 内部已经就「校验失败」报过警,这里兜住其余情况(磁盘满、权限等)
      if (!/校验失败/.test(e.message)) alert('数据库备份失败', e.message)
    }
  }
}

export function startMaintenance() {
  // 启动 30 秒后先跑一次,让新部署立刻拿到第一份备份
  setTimeout(() => tick().catch(() => {}), 30_000).unref()
  setInterval(() => tick().catch(() => {}), HOUR).unref()
}
