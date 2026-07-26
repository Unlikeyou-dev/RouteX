import { Router } from 'express'
import { db, getSetting, groupRatio } from '../db.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { lookupPrice, suggestPrice } from '../pricing.js'
import { splitModels, channelServesGroup } from '../util.js'

const router = Router()

// 站点可用模型 + 定价(登录可见)
//
// 数据源以「渠道实际提供的模型」为主 —— 价目表只负责给这些模型配价。
// 于是每个模型有三种处境:
//   priced   渠道有 + 已定价                → 正常
//   unpriced 渠道有 + 没定价                → 正在按兜底价计费,管理员需要尽快补
//   orphan   已定价但当前没有任何渠道提供    → 历史残留,折叠展示
router.get('/', authRequired, (req, res) => {
  const isAdmin = req.user.role === 'admin'
  const ratio = (Number(getSetting('price_ratio', '1')) || 1) * groupRatio(req.user.group_name)

  // 可用性按当前用户所在分组判定:不对本组开放的模型不算「可用」
  const channels = db.prepare('SELECT models, group_names FROM channels WHERE status = 1').all()
  const channelCount = new Map()
  for (const c of channels) {
    if (!channelServesGroup(c, req.user.group_name)) continue
    for (const m of splitModels(c.models)) channelCount.set(m, (channelCount.get(m) || 0) + 1)
  }
  // 管理员额外需要看到「全站」视角,否则自己不在某分组时会误判成没有渠道
  const allChannelCount = new Map()
  if (isAdmin) {
    for (const c of channels) {
      for (const m of splitModels(c.models)) allChannelCount.set(m, (allChannelCount.get(m) || 0) + 1)
    }
  }

  const priced = db.prepare('SELECT * FROM model_prices').all()
  const names = new Set([...channelCount.keys(), ...priced.map(p => p.model)])
  if (isAdmin) for (const m of allChannelCount.keys()) names.add(m)

  const list = []
  for (const model of names) {
    const p = lookupPrice(model)
    const serving = isAdmin ? (allChannelCount.get(model) || 0) : (channelCount.get(model) || 0)
    list.push({
      model,
      input_price: p.input * ratio,
      output_price: p.output * ratio,
      available: (channelCount.get(model) || 0) > 0,
      ...(isAdmin
        ? {
            base_input_price: p.input,
            base_output_price: p.output,
            cache_read_ratio: p.cache_read_ratio,
            cache_write_ratio: p.cache_write_ratio,
            priced: p.source !== 'fallback',
            price_source: p.source,
            matched_price_rule: p.matched,
            channel_count: serving,
            orphan: serving === 0
          }
        : {})
    })
  }
  list.sort((a, b) => (b.available - a.available) || a.model.localeCompare(b.model))

  // 未定价数量前端自己从 priced / channel_count 算,保持 api() 统一返回 data 的约定
  res.json({ success: true, data: list })
})

// 管理员:未定价模型 + 建议价(批量定价弹窗用)
router.get('/unpriced', authRequired, adminRequired, (req, res) => {
  const channels = db.prepare('SELECT models FROM channels WHERE status = 1').all()
  const names = new Set()
  for (const c of channels) for (const m of splitModels(c.models)) names.add(m)

  const rows = []
  for (const model of names) {
    if (lookupPrice(model).source !== 'fallback') continue
    const [input, output] = suggestPrice(model)
    rows.push({ model, suggested_input: input, suggested_output: output })
  }
  rows.sort((a, b) => a.model.localeCompare(b.model))
  res.json({ success: true, data: rows })
})

// 管理员更新定价
// 缓存倍率留空表示「跟随站点默认」,所以要区分「没传」和「传了空」
const optionalRatio = v => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

router.put('/price', authRequired, adminRequired, (req, res) => {
  const { model, input_price, output_price, cache_read_ratio, cache_write_ratio } = req.body || {}
  if (!model) return res.status(400).json({ success: false, message: '缺少模型名' })
  db.prepare(
    `INSERT INTO model_prices (model, input_price, output_price, cache_read_ratio, cache_write_ratio)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET
       input_price = excluded.input_price,
       output_price = excluded.output_price,
       cache_read_ratio = excluded.cache_read_ratio,
       cache_write_ratio = excluded.cache_write_ratio`
  ).run(
    model, Number(input_price) || 0, Number(output_price) || 0,
    optionalRatio(cache_read_ratio), optionalRatio(cache_write_ratio)
  )
  res.json({ success: true })
})

// 管理员批量定价
router.put('/price/batch', authRequired, adminRequired, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  if (!items.length) return res.status(400).json({ success: false, message: '没有要保存的定价' })
  const ins = db.prepare(
    `INSERT INTO model_prices (model, input_price, output_price) VALUES (?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET input_price = excluded.input_price, output_price = excluded.output_price`
  )
  let saved = 0
  db.transaction(() => {
    for (const it of items) {
      const model = String(it?.model || '').trim()
      if (!model) continue
      ins.run(model, Number(it.input_price) || 0, Number(it.output_price) || 0)
      saved++
    }
  })()
  res.json({ success: true, data: { saved } })
})

router.delete('/price/:model', authRequired, adminRequired, (req, res) => {
  db.prepare('DELETE FROM model_prices WHERE model = ?').run(req.params.model)
  res.json({ success: true })
})

export default router
