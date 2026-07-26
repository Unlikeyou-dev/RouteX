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
  const row = db.prepare('SELECT * FROM model_prices WHERE model = ?').get(model)
  if (row) return priceOf(row, 'exact', model)
  const base = db
    .prepare("SELECT * FROM model_prices WHERE ? LIKE model || '%' ORDER BY LENGTH(model) DESC LIMIT 1")
    .get(model)
  if (base) return priceOf(base, 'prefix', base.model)
  return {
    input: FALLBACK_PRICE[0], output: FALLBACK_PRICE[1],
    cacheRead: FALLBACK_PRICE[0] * defaultCacheRead(),
    cacheWrite: FALLBACK_PRICE[0] * defaultCacheWrite(),
    source: 'fallback', matched: null
  }
}

const defaultCacheRead = () => {
  const v = Number(getSetting('cache_read_ratio', '0.1'))
  return Number.isFinite(v) && v >= 0 ? v : 0.1
}
const defaultCacheWrite = () => {
  const v = Number(getSetting('cache_write_ratio', '1.25'))
  return Number.isFinite(v) && v >= 0 ? v : 1.25
}

// 缓存价按「输入价 × 倍率」推导:模型自己填了倍率就用自己的,没填回落站点默认。
// 各家折扣差很多,一个全局倍率必然会对其中一家算错,所以留了 per-model 的口子。
function priceOf(row, source, matched) {
  const readRatio = row.cache_read_ratio ?? defaultCacheRead()
  const writeRatio = row.cache_write_ratio ?? defaultCacheWrite()
  return {
    input: row.input_price,
    output: row.output_price,
    cacheRead: row.input_price * readRatio,
    cacheWrite: row.input_price * writeRatio,
    cache_read_ratio: row.cache_read_ratio,
    cache_write_ratio: row.cache_write_ratio,
    source,
    matched
  }
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

// 最终价 = 基础价 × 站点倍率 × 用户分组倍率,收敛到微美元精度。
//
// promptTokens 按 OpenAI 的口径:**包含**缓存命中的部分。
// cacheRead / cacheWrite 从中拆出来单独按折扣价计,剩下的才是全价输入。
// (Anthropic 的 input_tokens 本身不含缓存,已在适配器里归一化过)
export function computeCost(model, promptTokens, completionTokens, group = 'default', extra = {}) {
  const p = lookupPrice(model)
  const cacheRead = Math.max(0, Number(extra.cacheRead) || 0)
  const cacheWrite = Math.max(0, Number(extra.cacheWrite) || 0)
  const fullInput = Math.max(0, promptTokens - cacheRead - cacheWrite)

  const raw =
    (fullInput * p.input + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite + completionTokens * p.output) /
    1_000_000
  const ratio = Number(getSetting('price_ratio', '1')) || 1
  return usd(raw * ratio * groupRatio(group))
}

// 不打折时会是多少 —— 用来告诉用户「这次省了多少」
export function computeFullCost(model, promptTokens, completionTokens, group = 'default') {
  return computeCost(model, promptTokens, completionTokens, group)
}
