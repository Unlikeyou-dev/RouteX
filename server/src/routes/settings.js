import { Router } from 'express'
import { getSetting, setSetting } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { barkPush } from '../bark.js'
import { backupNow, listBackups, pruneLogs } from '../maintenance.js'
import { uploadBackup, storageConfigured } from '../storage.js'

const router = Router()

const PUBLIC_KEYS = ['site_name', 'announcement']
const ADMIN_KEYS = [
  'site_name', 'announcement', 'price_ratio', 'signup_bonus', 'aff_rebate_percent',
  'cache_read_ratio', 'cache_write_ratio',
  // 收款与推送
  'pay_qr_alipay', 'pay_qr_wechat', 'cny_rate', 'topup_min', 'bark_key', 'bark_server',
  // 风控
  'precharge_completion_tokens', 'precharge_thinking_tokens', 'precharge_margin',
  'max_concurrent_per_user', 'relay_rate_limit_per_min', 'model_rate_limit_per_min',
  'relay_retry_channels', 'anthropic_auto_cache', 'cors_origins',
  // 运维
  'log_retention_days', 'backup_enabled', 'backup_keep',
  'health_check_enabled', 'health_check_mode', 'health_sweep_minutes',
  // 异地备份
  's3_endpoint', 's3_bucket', 's3_access_key', 's3_secret_key', 's3_region', 's3_prefix'
]

// 对象存储的 Secret 拿到手就能改写/删掉你的全部备份,比其他配置都危险,
// 所以只回一个占位符;提交时原样传回来 = 保持不变。
const MASKED = '********'
const SECRET_KEYS = ['s3_secret_key']

// 公开站点信息(落地页使用)
router.get('/public', (req, res) => {
  const data = Object.fromEntries(PUBLIC_KEYS.map(k => [k, getSetting(k)]))
  res.json({ success: true, data })
})

router.get('/', authRequired, adminRequired, (req, res) => {
  const data = Object.fromEntries(ADMIN_KEYS.map(k => [
    k, SECRET_KEYS.includes(k) && getSetting(k) ? MASKED : getSetting(k)
  ]))
  res.json({ success: true, data })
})

const NUMERIC_KEYS = [
  'price_ratio', 'signup_bonus', 'aff_rebate_percent', 'cny_rate', 'topup_min',
  'cache_read_ratio', 'cache_write_ratio',
  'precharge_completion_tokens', 'precharge_thinking_tokens', 'precharge_margin',
  'max_concurrent_per_user', 'relay_rate_limit_per_min', 'model_rate_limit_per_min',
  'relay_retry_channels', 'log_retention_days',
  'backup_keep', 'health_sweep_minutes'
]
// 收款码允许 http(s) 图片地址或 data URI(前端本地选图后转 base64,省掉一套上传接口)
const MAX_QR_LEN = 4 * 1024 * 1024

router.put('/', authRequired, adminRequired, (req, res) => {
  for (const key of NUMERIC_KEYS) {
    const v = req.body?.[key]
    if (v !== undefined && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ success: false, message: `${key} 需为非负数字` })
    }
  }
  if (req.body?.cny_rate !== undefined && Number(req.body.cny_rate) <= 0) {
    return res.status(400).json({ success: false, message: '汇率需大于 0' })
  }
  for (const key of ['pay_qr_alipay', 'pay_qr_wechat']) {
    const v = req.body?.[key]
    if (v === undefined) continue
    const s = String(v).trim()
    if (s && !/^(https?:\/\/|data:image\/)/.test(s)) {
      return res.status(400).json({ success: false, message: '收款码需为图片地址或本地选取的图片' })
    }
    if (s.length > MAX_QR_LEN) {
      return res.status(400).json({ success: false, message: '收款码图片过大,请压缩后再上传' })
    }
  }
  for (const key of ADMIN_KEYS) {
    if (req.body?.[key] === undefined) continue
    // 原样传回占位符说明用户没动这一项,不能把真 Secret 覆盖成一串星号
    if (SECRET_KEYS.includes(key) && req.body[key] === MASKED) continue
    setSetting(key, req.body[key])
  }
  res.json({ success: true })
})

// ---- 运维:备份与日志清理 ----
router.get('/backups', authRequired, adminRequired, (req, res) => {
  res.json({ success: true, data: listBackups() })
})

router.post('/backup', authRequired, adminRequired, async (req, res) => {
  try {
    const info = await backupNow()
    res.json({ success: true, data: info })
  } catch (e) {
    res.status(500).json({ success: false, message: `备份失败:${e.message}` })
  }
})

// 异地备份连通性测试。配错了不该等到某天真出事才发现,所以传一个小文件上去试试。
router.post('/storage-test', authRequired, adminRequired, async (req, res) => {
  if (!storageConfigured()) return res.status(400).json({ success: false, message: '请先填写对象存储配置并保存' })
  const r = await uploadBackup(`connectivity-test-${Date.now()}.txt`, Buffer.from('RouteX storage test\n'))
  if (r.ok) res.json({ success: true, data: { key: r.key } })
  else res.status(400).json({ success: false, message: r.message })
})

router.post('/prune-logs', authRequired, adminRequired, (req, res) => {
  try {
    res.json({ success: true, data: { removed: pruneLogs() } })
  } catch (e) {
    res.status(500).json({ success: false, message: `清理失败:${e.message}` })
  }
})

// 测试推送:让管理员填完 Bark Key 就能立刻确认通不通
router.post('/bark-test', authRequired, adminRequired, async (req, res) => {
  const result = await barkPush({
    title: '🔔 RouteX 测试推送',
    body: '能收到这条,说明充值通知已经配好了。',
    group: 'RouteX充值'
  })
  if (!result.ok) return res.status(400).json({ success: false, message: result.message })
  res.json({ success: true })
})

export default router
