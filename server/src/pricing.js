// 模型定价表,单位:美元 / 1M tokens,[输入, 输出]
// 实际计费 = 基础价 × price_ratio(站点倍率,可在设置中调整)
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

export function getPrice(model) {
  const row = db.prepare('SELECT input_price, output_price FROM model_prices WHERE model = ?').get(model)
  if (row) return [row.input_price, row.output_price]
  // 带日期后缀的模型尝试匹配前缀
  const base = db
    .prepare("SELECT model, input_price, output_price FROM model_prices WHERE ? LIKE model || '%' ORDER BY LENGTH(model) DESC LIMIT 1")
    .get(model)
  if (base) return [base.input_price, base.output_price]
  return FALLBACK_PRICE
}

export function computeCost(model, promptTokens, completionTokens) {
  const [inp, out] = getPrice(model)
  const ratio = Number(getSetting('price_ratio', '1')) || 1
  return ((promptTokens * inp + completionTokens * out) / 1_000_000) * ratio
}
