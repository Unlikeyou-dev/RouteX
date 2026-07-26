// 日常运维:日志保留清理 + SQLite 热备份。
// 两件事都是「不做不会立刻出事,出事就来不及了」的类型 ——
// 日志表只增不删会把磁盘吃满,而钱和订单全在一个 db 文件里,没有备份就是单点。
import fs from 'node:fs'
import path from 'node:path'
import { db, getSetting, now } from './db.js'
import { DATA_DIR } from './config.js'

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

// better-sqlite3 的 backup() 是在线热备份,不会阻塞写入,也不会备出半个事务
export async function backupNow() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const file = `routex-${stamp()}.db`
  const dest = path.join(BACKUP_DIR, file)
  await db.backup(dest)
  rotate()
  const size = fs.statSync(dest).size
  console.log(`[RouteX] 已备份数据库 → ${file} (${(size / 1024 / 1024).toFixed(2)} MB)`)
  return { file, size }
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
      console.error('[RouteX] 数据库备份失败:', e.message)
    }
  }
}

export function startMaintenance() {
  // 启动 30 秒后先跑一次,让新部署立刻拿到第一份备份
  setTimeout(() => tick().catch(() => {}), 30_000).unref()
  setInterval(() => tick().catch(() => {}), HOUR).unref()
}
