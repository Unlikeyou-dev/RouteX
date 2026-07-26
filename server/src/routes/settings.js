import { Router } from 'express'
import { db, getSetting, setSetting } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'

const router = Router()

const PUBLIC_KEYS = ['site_name', 'announcement']
const ADMIN_KEYS = ['site_name', 'announcement', 'price_ratio', 'signup_bonus']

// 公开站点信息(落地页使用)
router.get('/public', (req, res) => {
  const data = Object.fromEntries(PUBLIC_KEYS.map(k => [k, getSetting(k)]))
  res.json({ success: true, data })
})

router.get('/', authRequired, adminRequired, (req, res) => {
  const data = Object.fromEntries(ADMIN_KEYS.map(k => [k, getSetting(k)]))
  res.json({ success: true, data })
})

const NUMERIC_KEYS = ['price_ratio', 'signup_bonus']

router.put('/', authRequired, adminRequired, (req, res) => {
  for (const key of NUMERIC_KEYS) {
    const v = req.body?.[key]
    if (v !== undefined && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ success: false, message: `${key} 需为非负数字` })
    }
  }
  for (const key of ADMIN_KEYS) {
    if (req.body?.[key] !== undefined) setSetting(key, req.body[key])
  }
  res.json({ success: true })
})

export default router
