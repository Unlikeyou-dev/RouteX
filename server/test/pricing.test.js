import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { db, setSetting } = await import('../src/db.js')
const { computeCost, lookupPrice, suggestPrice } = await import('../src/pricing.js')

const setPrice = (model, i, o) =>
  db.prepare(
    `INSERT INTO model_prices (model, input_price, output_price) VALUES (?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET input_price = excluded.input_price, output_price = excluded.output_price`
  ).run(model, i, o)

test('查价:精确命中优先于前缀命中', () => {
  setPrice('gpt-4o', 2.5, 10)
  setPrice('gpt-4o-2024-11-20', 3, 12)
  assert.deepEqual(
    { ...lookupPrice('gpt-4o-2024-11-20') },
    { input: 3, output: 12, source: 'exact', matched: 'gpt-4o-2024-11-20' }
  )
})

test('查价:带日期后缀的模型回落到前缀规则', () => {
  setPrice('claude-sonnet-4-20250514', 3, 15)
  const p = lookupPrice('claude-sonnet-4-20250514-preview')
  assert.equal(p.source, 'prefix')
  assert.equal(p.matched, 'claude-sonnet-4-20250514')
  assert.equal(p.input, 3)
})

test('查价:未定价的模型走兜底价并标记来源', () => {
  const p = lookupPrice('totally-unknown-model')
  assert.equal(p.source, 'fallback')
  assert.equal(p.matched, null)
  assert.equal(p.input, 1)
  assert.equal(p.output, 2)
})

test('计费:按 100 万 tokens 计价', () => {
  setSetting('price_ratio', '1')
  setPrice('calc-model', 10, 30)
  // 100 万输入 + 100 万输出 = 10 + 30
  assert.equal(computeCost('calc-model', 1_000_000, 1_000_000), 40)
  // 10 万输入 + 10 万输出 = 1 + 3
  assert.equal(computeCost('calc-model', 100_000, 100_000), 4)
})

test('计费:站点倍率生效', () => {
  setPrice('ratio-model', 10, 30)
  setSetting('price_ratio', '2')
  assert.equal(computeCost('ratio-model', 1_000_000, 0), 20)
  setSetting('price_ratio', '1')
})

test('计费:分组倍率在站点倍率之上再叠加', () => {
  setPrice('group-model', 10, 0)
  setSetting('price_ratio', '2')
  db.prepare('INSERT OR REPLACE INTO groups (name, ratio) VALUES (?, ?)').run('half', 0.5)
  // 基础 10 × 站点 2 × 分组 0.5 = 10
  assert.equal(computeCost('group-model', 1_000_000, 0, 'half'), 10)
  setSetting('price_ratio', '1')
})

test('计费:不存在的分组按 1 倍处理,不应静默归零', () => {
  setPrice('safe-model', 10, 0)
  assert.equal(computeCost('safe-model', 1_000_000, 0, 'no-such-group'), 10)
})

test('计费:收敛到微美元精度,不产生浮点尾巴', () => {
  setPrice('tiny-model', 0.27, 1.1)
  const cost = computeCost('tiny-model', 333, 777)
  // 结果必须是 1e-6 的整数倍,否则累加会漂
  assert.equal(Math.round(cost * 1e6), cost * 1e6)
})

test('计费:零 token 不产生费用', () => {
  setPrice('zero-model', 10, 30)
  assert.equal(computeCost('zero-model', 0, 0), 0)
})

test('建议价:按最长前缀匹配内置价格库', () => {
  assert.deepEqual(suggestPrice('gpt-4o'), [2.5, 10])
  // gpt-4o-mini 应该匹配到自己而不是更短的 gpt-4o
  assert.deepEqual(suggestPrice('gpt-4o-mini'), [0.15, 0.6])
  assert.deepEqual(suggestPrice('claude-sonnet-4-20250514-preview'), [3, 15])
  assert.deepEqual(suggestPrice('某个没见过的模型'), [1, 2])
})
