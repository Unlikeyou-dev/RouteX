import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, now, getSetting } from '../db.js'
import { signToken, publicUser } from '../middleware/auth.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { badRequest, genInviteCode } from '../util.js'
import { notify } from '../bark.js'

const router = Router()

// 防刷注册(薅注册赠送额度)/ 防密码爆破
const registerLimit = rateLimit({ windowMs: 3_600_000, max: 5, prefix: 'register' })
const loginLimit = rateLimit({ windowMs: 300_000, max: 10, prefix: 'login' })

router.post('/register', registerLimit, (req, res) => {
  const { username, password, email, aff } = req.body || {}
  if (!username || !/^[\w-]{3,30}$/.test(username)) return badRequest(res, '用户名需为 3-30 位字母、数字、下划线')
  if (!password || password.length < 6) return badRequest(res, '密码至少 6 位')
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (exists) return badRequest(res, '用户名已被占用')
  const bonus = Number(getSetting('signup_bonus', '0')) || 0

  // 邀请码归因(可选,无效则静默忽略)
  let inviter = null
  if (aff) {
    inviter = db.prepare('SELECT id FROM users WHERE invite_code = ?').get(String(aff).trim()) || null
  }

  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, email, quota, invite_code, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(username, bcrypt.hashSync(password, 10), email || null, bonus, genInviteCode(), inviter?.id || null, now())
  if (inviter) {
    db.prepare('UPDATE users SET aff_count = aff_count + 1 WHERE id = ?').run(inviter.id)
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  res.json({ success: true, data: { token: signToken(user), user: publicUser(user) } })
})

// 找回密码申请。
// 站点没有邮件基础设施(SMTP 配置 + 送达率在国内是个长期麻烦),
// 所以走和充值一致的路子:用户提交申请 → Bark 推给站长 → 站长在后台重置。
// 注意不回显「用户是否存在」,避免被拿来枚举账号。
const resetLimit = rateLimit({ windowMs: 3_600_000, max: 5, prefix: 'reset' })

router.post('/forgot', resetLimit, (req, res) => {
  const username = String(req.body?.username || '').trim()
  const contact = String(req.body?.contact || '').trim().slice(0, 120)
  if (!username) return badRequest(res, '请填写用户名')

  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (user) {
    db.prepare('INSERT INTO password_resets (username, contact, created_at) VALUES (?, ?, ?)')
      .run(username, contact || null, now())
    const pending = db.prepare("SELECT COUNT(*) AS c FROM password_resets WHERE status = 'pending'").get().c
    notify({
      title: '🔑 密码找回申请',
      body: [`用户 ${username} 申请重置密码`, contact ? `联系方式:${contact}` : null, `共 ${pending} 条待处理`]
        .filter(Boolean).join('\n'),
      group: 'RouteX'
    })
  }
  // 不管用户存不存在都返回同样的话
  res.json({ success: true, data: { message: '申请已提交,管理员核实后会通过你留下的联系方式发送新密码。' } })
})

router.post('/login', loginLimit, (req, res) => {
  const { username, password } = req.body || {}
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '')
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return badRequest(res, '用户名或密码错误')
  }
  if (user.status !== 1) return badRequest(res, '账户已被封禁')
  res.json({ success: true, data: { token: signToken(user), user: publicUser(user) } })
})

export default router
