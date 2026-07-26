import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { db } = await import('../src/db.js')
const { runCompatCheck, getCompat, applyCompat, clearCompat, FEATURES } = await import('../src/compat.js')

const channel = { id: 1, type: 'openai', base_url: 'http://localhost:65500', models: 'gpt-x' }

// 用假的 fetch 决定哪一项通过,不碰真网络
function stubFetch(decide) {
  const seen = []
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    seen.push(body)
    const verdict = decide(body)
    if (verdict === true) return new Response(JSON.stringify({ choices: [] }), { status: 200 })
    return new Response(JSON.stringify({ error: { message: verdict || '不支持' } }), { status: 400 })
  }
  return seen
}

const save = (model, results) => {
  db.prepare(
    `INSERT INTO channel_caps (channel_id, model, results, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(channel_id, model) DO UPDATE SET results = excluded.results`
  ).run(1, model, JSON.stringify(results), 1)
}

test('自检:每项单独探测,结果逐项记录', async () => {
  const seen = stubFetch(b => (b.temperature === undefined))
  const r = await runCompatCheck(channel, 'k', 'gpt-x')

  assert.equal(r.results.baseline.ok, true)
  assert.equal(r.results.sampling.ok, false, '带 temperature 的那次被拒了')
  assert.equal(r.results.tools.ok, true)
  assert.equal(r.results.structured.ok, true)
  assert.equal(seen.length, FEATURES.length, '每个特性各发一次,不能混在一个请求里')

  // 一次只能加一个特性,否则失败归不到具体字段上
  const withTools = seen.find(b => b.tools)
  assert.equal(withTools.temperature, undefined)
  assert.equal(withTools.response_format, undefined)
})

test('自检:基线不通就不继续探,免得记一堆误导人的「不支持」', async () => {
  const seen = stubFetch(() => 'Key 无效')
  const r = await runCompatCheck(channel, 'k', 'gpt-x')
  assert.equal(r.results.baseline.ok, false)
  assert.equal(r.results.tools.skipped, true)
  assert.equal(seen.length, 1)
})

test('自检:上游错误原文里的 Key 不能落库', async () => {
  stubFetch(() => 'Incorrect API key provided: sk-abcdefghijklmnopqrstuvwxyz123456')
  await runCompatCheck(channel, 'k', 'gpt-x')
  const saved = JSON.stringify(getCompat(1, 'gpt-x'))
  assert.ok(!saved.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), '错误原文会带上我们的上游 Key')
})

test('应用自检结论:被拒的采样与思考参数直接剔掉', () => {
  clearCompat(1)
  save('m', { baseline: { ok: true }, sampling: { ok: false }, thinking: { ok: false } })
  const out = applyCompat(
    { messages: [], temperature: 0.7, top_p: 1, top_k: 5, reasoning_effort: 'high' }, 1, 'm'
  )
  assert.equal(out.temperature, undefined)
  assert.equal(out.top_p, undefined)
  assert.equal(out.top_k, undefined)
  assert.equal(out.reasoning_effort, undefined)
})

test('应用自检结论:结构化输出被拒时退回提示词,而不是静默丢弃', () => {
  clearCompat(1)
  save('m', { baseline: { ok: true }, structured: { ok: false } })
  const out = applyCompat({
    messages: [{ role: 'user', content: 'q' }],
    response_format: { type: 'json_schema', json_schema: { schema: { type: 'object', properties: { a: {} } } } }
  }, 1, 'm')
  assert.equal(out.response_format, undefined)
  assert.equal(out.messages[0].role, 'system')
  assert.ok(out.messages[0].content.includes('JSON Schema'))
  assert.equal(out.messages[1].content, 'q', '原消息不能被顶掉')
})

test('应用自检结论:基线没过的那份结果不能拿来判定单个特性', () => {
  clearCompat(1)
  save('m', { baseline: { ok: false }, sampling: { ok: false } })
  const body = { messages: [], temperature: 0.7 }
  assert.equal(applyCompat(body, 1, 'm').temperature, 0.7, '链路问题不该被当成参数不兼容')
})

test('应用自检结论:没有记录 / 全过时原样返回,不做多余拷贝', () => {
  clearCompat(1)
  const body = { messages: [], temperature: 0.7 }
  assert.equal(applyCompat(body, 1, 'never-checked'), body)

  save('m', { baseline: { ok: true }, sampling: { ok: true }, structured: { ok: true } })
  assert.equal(applyCompat(body, 1, 'm'), body)
})

test('应用自检结论:按模型分别记账,不会互相波及', () => {
  clearCompat(1)
  save('bad', { baseline: { ok: true }, sampling: { ok: false } })
  save('good', { baseline: { ok: true }, sampling: { ok: true } })
  assert.equal(applyCompat({ messages: [], temperature: 1 }, 1, 'bad').temperature, undefined)
  assert.equal(applyCompat({ messages: [], temperature: 1 }, 1, 'good').temperature, 1)
})
