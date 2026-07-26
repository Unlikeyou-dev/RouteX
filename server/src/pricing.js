// 内置价格库,单位:美元 / 1M tokens,[输入, 输出]
//
// 注意:这份表**不会**被预先写进 model_prices —— 站点里有哪些模型由「渠道」决定,
// 价目表只负责给这些模型配价(对齐 new-api:模型名的户口在渠道,不在价目表)。
// 它的用途是:你在价目页添加/批量定价时,按模型名前缀给出建议价,省得逐个去查官网。
export const DEFAULT_PRICES = {
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'o3': [2, 8],
  'o4-mini': [1.1, 4.4],
  'claude-sonnet-4-20250514': [3, 15],
  'claude-opus-4-20250514': [15, 75],
  'claude-3-5-haiku-20241022': [0.8, 4],
  'deepseek-chat': [0.27, 1.1],
  'deepseek-reasoner': [0.55, 2.19],
  'gemini-2.5-pro': [1.25, 10],
  'gemini-2.5-flash': [0.3, 2.5],
  'qwen-max': [1.6, 6.4],
  'qwen-plus': [0.4, 1.2],
  'glm-4-plus': [0.7, 0.7],
  'text-embedding-3-small': [0.02, 0],
  'text-embedding-3-large': [0.13, 0]
}

// 未知模型的兜底价格
export const FALLBACK_PRICE = [1, 2]

import { db, getSetting } from './db.js'

// 查价并说明来源:exact 精确命中 / prefix 前缀命中(带日期后缀的模型)/ fallback 兜底。
// 价目页靠 source 把「未定价」的模型标出来,免得它们悄悄按兜底价卖。
export function lookupPrice(model) {
  const row = db.prepare('SELECT input_price, output_price FROM model_prices WHERE model = ?').get(model)
  if (row) return { input: row.input_price, output: row.output_price, source: 'exact', matched: model }
  const base = db
    .prepare("SELECT model, input_price, output_price FROM model_prices WHERE ? LIKE model || '%' ORDER BY LENGTH(model) DESC LIMIT 1")
    .get(model)
  if (base) return { input: base.input_price, output: base.output_price, source: 'prefix', matched: base.model }
  return { input: FALLBACK_PRICE[0], output: FALLBACK_PRICE[1], source: 'fallback', matched: null }
}

export function getPrice(model) {
  const p = lookupPrice(model)
  return [p.input, p.output]
}

// 建议价:新模型定价时按前缀在内置价格库里找一个最接近的,找不到就给兜底价
export function suggestPrice(model) {
  const name = String(model || '')
  if (DEFAULT_PRICES[name]) return DEFAULT_PRICES[name]
  let best = null
  for (const key of Object.keys(DEFAULT_PRICES)) {
    if (name.startsWith(key) && (!best || key.length > best.length)) best = key
  }
  return best ? DEFAULT_PRICES[best] : FALLBACK_PRICE
}

import { usd } from './util.js'
import { groupRatio } from './db.js'

// 最终价 = 基础价 × 站点倍率 × 用户分组倍率,收敛到微美元精度
export function computeCost(model, promptTokens, completionTokens, group = 'default') {
  const [inp, out] = getPrice(model)
  const ratio = Number(getSetting('price_ratio', '1')) || 1
  return usd(((promptTokens * inp + completionTokens * out) / 1_000_000) * ratio * groupRatio(group))
}
