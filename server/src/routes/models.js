import { Router } from 'express'
import { db, getSetting, groupRatio } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { getPrice } from '../pricing.js'
import { splitModels } from '../util.js'

const router = Router()

// 站点可用模型 + 定价(登录可见)
router.get('/', authRequired, (req, res) => {
  const channels = db.prepare('SELECT models FROM channels WHERE status = 1').all()
  const available = new Set()
  for (const c of channels) splitModels(c.models).forEach(m => available.add(m))
  // 展示价 = 基础价 × 站点倍率 × 当前用户分组倍率
  const ratio = (Number(getSetting('price_ratio', '1')) || 1) * groupRatio(req.user.group_name)
  const priced = db.prepare('SELECT * FROM model_prices ORDER BY model').all()
  const knownNames = new Set(priced.map(p => p.model))
  const isAdmin = req.user.role === 'admin'
  const list = priced.map(p => ({
    model: p.model,
    input_price: p.input_price * ratio,
    output_price: p.output_price * ratio,
    available: available.has(p.model),
    ...(isAdmin ? { base_input_price: p.input_price, base_output_price: p.output_price } : {})
  }))
  for (const m of available) {
    if (!knownNames.has(m)) {
      const [inp, out] = getPrice(m)
      list.push({
        model: m, input_price: inp * ratio, output_price: out * ratio, available: true,
        ...(isAdmin ? { base_input_price: inp, base_output_price: out, fallback: true } : {})
      })
    }
  }
  list.sort((a, b) => (b.available - a.available) || a.model.localeCompare(b.model))
  res.json({ success: true, data: list })
})

// 管理员更新定价
router.put('/price', authRequired, adminRequired, (req, res) => {
  const { model, input_price, output_price } = req.body || {}
  if (!model) return res.status(400).json({ success: false, message: '缺少模型名' })
  db.prepare(
    `INSERT INTO model_prices (model, input_price, output_price) VALUES (?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET input_price = excluded.input_price, output_price = excluded.output_price`
  ).run(model, Number(input_price) || 0, Number(output_price) || 0)
  res.json({ success: true })
})

router.delete('/price/:model', authRequired, adminRequired, (req, res) => {
  db.prepare('DELETE FROM model_prices WHERE model = ?').run(req.params.model)
  res.json({ success: true })
})

export default router
