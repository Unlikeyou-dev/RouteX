import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { db, setSetting } = await import('../src/db.js')
const { modelRateLimit } = await import('../src/pricing.js')
const { consumeRelayQuota } = await import('../src/middleware/ratelimit.js')

const price = (model, rpm) =>
  db.prepare(
    `INSERT INTO model_prices (model, input_price, output_price, rpm_per_user) VALUES (?, 1, 2, ?)
     ON CONFLICT(model) DO UPDATE SET rpm_per_user = excluded.rpm_per_user`
  ).run(model, rpm)

test('模型自己设了上限就用自己的', () => {
  setSetting('model_rate_limit_per_min', '5')
  price('claude-opus-5', 2)
  assert.equal(modelRateLimit('claude-opus-5'), 2)
})

test('模型没设(0)时回落站点默认', () => {
  setSetting('model_rate_limit_per_min', '5')
  price('gpt-4o-mini', 0)
  assert.equal(modelRateLimit('gpt-4o-mini'), 5)
})

test('站点默认也是 0 就等于不限', () => {
  setSetting('model_rate_limit_per_min', '0')
  price('free-model', 0)
  assert.equal(modelRateLimit('free-model'), 0)
})

test('匹配口径与查价一致:带日期后缀的模型走前缀命中', () => {
  setSetting('model_rate_limit_per_min', '0')
  price('claude-sonnet-4-6', 3)
  assert.equal(
    modelRateLimit('claude-sonnet-4-6-20251114'), 3,
    '两处落到不同的行上,管理员会看不懂为什么限额没生效'
  )
})

test('完全没定价的模型也能被站点默认兜住', () => {
  setSetting('model_rate_limit_per_min', '7')
  assert.equal(modelRateLimit('some-brand-new-model'), 7)
})

test('计数按「用户 + 模型」隔离', () => {
  const w = 60_000
  // 同一用户同一模型:第 3 次被拦
  assert.equal(consumeRelayQuota('u1:m-a', w, 2), true)
  assert.equal(consumeRelayQuota('u1:m-a', w, 2), true)
  assert.equal(consumeRelayQuota('u1:m-a', w, 2), false)
  // 换个模型:重新计数
  assert.equal(consumeRelayQuota('u1:m-b', w, 2), true)
  // 换个用户:也重新计数,不会被别人的用量牵连
  assert.equal(consumeRelayQuota('u2:m-a', w, 2), true)
})

test('上限为 0 时不计数,永远放行', () => {
  for (let i = 0; i < 50; i++) assert.equal(consumeRelayQuota('u9:m-x', 60_000, 0), true)
})
