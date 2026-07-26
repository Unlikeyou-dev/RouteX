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
    req.user = user
    next()
  } catch {
    return res.status(401).json({ success: false, message: '登录已过期,请重新登录' })
  }
}

export function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: '需要管理员权限' })
  next()
}

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
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
