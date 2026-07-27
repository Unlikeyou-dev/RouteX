import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'
import { db } from '../db.js'

export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ success: false, message: '未登录' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
    if (!user || user.status !== 1) return res.status(401).json({ success: false, message: '账户不可用' })
    // 会话版本对不上说明密码改过(或被管理员重置),旧 token 立即作废。
    // 没有这一步的话,泄露的 token 在 7 天有效期内改密码也拦不住。
    if ((payload.v ?? 0) !== (user.token_version ?? 0)) {
      return res.status(401).json({ success: false, message: '密码已变更,请重新登录' })
    }
    req.user = user
    next()
  } catch {
    return res.status(401).json({ success: false, message: '登录已过期,请重新登录' })
  }
}

// 带上就认、不带也放行。用于「未登录能看、登录了内容更多」的接口(如公告列表:
// 落地页要在没登录时就显示,登录后还要标出哪些是未读)。
// 注意 token 无效时也只是当作未登录,不能报错 —— 否则过期的 token 会让落地页整块空掉。
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return next()
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
    if (user && user.status === 1 && (payload.v ?? 0) === (user.token_version ?? 0)) req.user = user
  } catch { /* 无效 token 按未登录处理 */ }
  next()
}

export function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: '需要管理员权限' })
  next()
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, v: user.token_version ?? 0 },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    quota: u.quota,
    used_quota: u.used_quota,
    request_count: u.request_count,
    status: u.status,
    created_at: u.created_at,
    group_name: u.group_name || 'default',
    invite_code: u.invite_code,
    aff_earned: u.aff_earned || 0,
    aff_count: u.aff_count || 0
  }
}
