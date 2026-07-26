import { Router } from 'express'
import { db } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { badRequest, channelGroups } from '../util.js'

const router = Router()
router.use(authRequired, adminRequired)

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.name, g.ratio, COUNT(u.id) AS user_count
       FROM groups g LEFT JOIN users u ON u.group_name = g.name
       GROUP BY g.name ORDER BY g.name`
    )
    .all()
  // 分组服务的渠道数(渠道可属多组,SQL 里不好统计,取回内存里数)
  const channels = db.prepare('SELECT group_names FROM channels').all()
  for (const row of rows) {
    row.channel_count = channels.filter(c => channelGroups(c).includes(row.name)).length
  }
  res.json({ success: true, data: rows })
})

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim()
  const ratio = Number(req.body?.ratio)
  if (!/^[\w-]{1,30}$/.test(name)) return badRequest(res, '分组名需为 1-30 位字母、数字、下划线')
  if (!Number.isFinite(ratio) || ratio <= 0) return badRequest(res, '倍率需为正数')
  const exists = db.prepare('SELECT name FROM groups WHERE name = ?').get(name)
  if (exists) return badRequest(res, '分组已存在')
  db.prepare('INSERT INTO groups (name, ratio) VALUES (?, ?)').run(name, ratio)
  res.json({ success: true })
})

router.put('/:name', (req, res) => {
  const ratio = Number(req.body?.ratio)
  if (!Number.isFinite(ratio) || ratio <= 0) return badRequest(res, '倍率需为正数')
  const info = db.prepare('UPDATE groups SET ratio = ? WHERE name = ?').run(ratio, req.params.name)
  if (info.changes === 0) return badRequest(res, '分组不存在')
  res.json({ success: true })
})

router.delete('/:name', (req, res) => {
  if (req.params.name === 'default') return badRequest(res, '默认分组不可删除')
  const name = req.params.name
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET group_name = 'default' WHERE group_name = ?").run(name)
    // 从渠道的服务分组里剥离,只剩空则回落 default,避免渠道变成谁都路由不到
    const upd = db.prepare('UPDATE channels SET group_names = ? WHERE id = ?')
    for (const c of db.prepare('SELECT id, group_names FROM channels').all()) {
      const kept = channelGroups(c).filter(g => g !== name)
      const next = kept.length ? kept.join(',') : 'default'
      if (next !== c.group_names) upd.run(next, c.id)
    }
    db.prepare('DELETE FROM groups WHERE name = ?').run(name)
  })
  tx()
  res.json({ success: true })
})

export default router
