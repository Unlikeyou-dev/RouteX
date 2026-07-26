import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { db, now } = await import('../src/db.js')
const { pickChannels } = await import('../src/relay.js')

let seq = 0
function makeChannel({
  models, groups = 'default', type = 'openai', status = 1, autoDisabled = 0, priority = 0, weight = 1
}) {
  const name = `c${++seq}`
  const info = db
    .prepare(
      `INSERT INTO channels (name, base_url, api_key, models, model_mapping, priority, weight, type,
                             group_names, status, auto_disabled, created_at)
       VALUES (?, '', 'sk-x', ?, '{}', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, models, priority, weight, type, groups, status, autoDisabled, now())
  return { id: Number(info.lastInsertRowid), name }
}
const clear = () => db.prepare('DELETE FROM channels').run()
const names = list => list.map(c => c.name).sort()

test('路由:命中支持该模型的渠道', () => {
  clear()
  const a = makeChannel({ models: 'gpt-4o' })
  makeChannel({ models: 'claude-sonnet-4-20250514' })
  assert.deepEqual(names(pickChannels('gpt-4o', '/chat/completions', 'default')), [a.name])
})

test('路由:模型列表兼容换行分隔', () => {
  clear()
  const a = makeChannel({ models: 'gpt-4o\ngpt-4o-mini\nclaude-3-5-haiku-20241022' })
  assert.deepEqual(names(pickChannels('gpt-4o-mini', '/chat/completions', 'default')), [a.name])
})

test('路由:分组隔离 —— 只走服务本组的渠道', () => {
  clear()
  db.prepare('INSERT OR IGNORE INTO groups (name, ratio) VALUES (?, ?)').run('vip', 1)
  const vipOnly = makeChannel({ models: 'gpt-4o', groups: 'vip' })
  const both = makeChannel({ models: 'gpt-4o', groups: 'default,vip' })

  assert.deepEqual(names(pickChannels('gpt-4o', '/chat/completions', 'default')), [both.name])
  assert.deepEqual(names(pickChannels('gpt-4o', '/chat/completions', 'vip')), names([vipOnly, both]))
})

test('路由:分组字段为空的历史渠道按 default 处理,不应变成孤儿', () => {
  clear()
  const c = makeChannel({ models: 'gpt-4o', groups: '' })
  assert.deepEqual(names(pickChannels('gpt-4o', '/chat/completions', 'default')), [c.name])
})

test('路由:禁用与熔断的渠道都不参与', () => {
  clear()
  makeChannel({ models: 'gpt-4o', status: 0 })
  makeChannel({ models: 'gpt-4o', autoDisabled: 1 })
  const ok = makeChannel({ models: 'gpt-4o' })
  assert.deepEqual(names(pickChannels('gpt-4o', '/chat/completions', 'default')), [ok.name])
})

test('路由:embeddings 只走 OpenAI 兼容渠道(原生协议适配器不支持)', () => {
  clear()
  makeChannel({ models: 'text-embedding-3-small', type: 'anthropic' })
  makeChannel({ models: 'text-embedding-3-small', type: 'gemini' })
  const openai = makeChannel({ models: 'text-embedding-3-small', type: 'openai' })
  assert.deepEqual(names(pickChannels('text-embedding-3-small', '/embeddings', 'default')), [openai.name])
})

test('路由:chat 允许原生协议渠道', () => {
  clear()
  const anthropic = makeChannel({ models: 'claude-opus-4-20250514', type: 'anthropic' })
  assert.deepEqual(
    names(pickChannels('claude-opus-4-20250514', '/chat/completions', 'default')),
    [anthropic.name]
  )
})

test('路由:高优先级排在前面,同优先级的都在候选里', () => {
  clear()
  const low = makeChannel({ models: 'gpt-4o', priority: 0 })
  const high = makeChannel({ models: 'gpt-4o', priority: 10 })
  const mid = makeChannel({ models: 'gpt-4o', priority: 5 })
  const order = pickChannels('gpt-4o', '/chat/completions', 'default').map(c => c.name)
  assert.deepEqual(order, [high.name, mid.name, low.name])
})

test('路由:同优先级多渠道都会进候选(供故障转移),顺序按权重随机', () => {
  clear()
  makeChannel({ models: 'gpt-4o', priority: 1, weight: 1 })
  makeChannel({ models: 'gpt-4o', priority: 1, weight: 99 })
  const picked = pickChannels('gpt-4o', '/chat/completions', 'default')
  assert.equal(picked.length, 2)
})

test('路由:没有渠道支持该模型时返回空', () => {
  clear()
  makeChannel({ models: 'gpt-4o' })
  assert.deepEqual(pickChannels('no-such-model', '/chat/completions', 'default'), [])
})

test('路由:模型名必须精确匹配,不做前缀模糊', () => {
  clear()
  makeChannel({ models: 'gpt-4o' })
  assert.deepEqual(pickChannels('gpt-4', '/chat/completions', 'default'), [])
  assert.deepEqual(pickChannels('gpt-4o-mini', '/chat/completions', 'default'), [])
})
