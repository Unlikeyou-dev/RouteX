import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { db, setSetting } = await import('../src/db.js')
const { computeCost, lookupPrice } = await import('../src/pricing.js')
const { buildUpstreamRequest, convertResponse, createStreamTransformer } = await import('../src/adapters.js')
const { cacheTokensOf } = await import('../src/relay.js')

const anthropic = { type: 'anthropic', base_url: '' }
const gemini = { type: 'gemini', base_url: '' }
const build = (ch, body) => buildUpstreamRequest(ch, 'k', '/chat/completions', body, 'm', false).payload

const setPrice = (model, i, o, cr = null, cw = null) =>
  db.prepare(
    `INSERT INTO model_prices (model, input_price, output_price, cache_read_ratio, cache_write_ratio)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(model) DO UPDATE SET input_price=excluded.input_price, output_price=excluded.output_price,
       cache_read_ratio=excluded.cache_read_ratio, cache_write_ratio=excluded.cache_write_ratio`
  ).run(model, i, o, cr, cw)

setSetting('price_ratio', '1')
setSetting('cache_read_ratio', '0.1')
setSetting('cache_write_ratio', '1.25')

// ---------- 用量口径归一化 ----------

test('用量口径:Anthropic 的 input_tokens 不含缓存,要加回去才是总输入', () => {
  const out = convertResponse(anthropic, 'm', {
    content: [{ type: 'text', text: 'hi' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 50,
      output_tokens: 20
    }
  })
  // 100 全价 + 900 缓存读 + 50 缓存写 = 1050 总输入
  assert.equal(out.usage.prompt_tokens, 1050)
  assert.equal(out.usage.prompt_tokens_details.cached_tokens, 900)
  assert.equal(out.usage.cache_creation_tokens, 50)
  assert.equal(out.usage.completion_tokens, 20)
})

test('用量口径:Gemini 的 promptTokenCount 已含缓存,不能重复加', () => {
  const out = convertResponse(gemini, 'm', {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hi' }] } }],
    usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 800, candidatesTokenCount: 10 }
  })
  assert.equal(out.usage.prompt_tokens, 1000, '已包含缓存,不应变成 1800')
  assert.equal(out.usage.prompt_tokens_details.cached_tokens, 800)
})

test('用量口径:没有缓存时不产生多余字段', () => {
  const out = convertResponse(anthropic, 'm', {
    content: [{ type: 'text', text: 'hi' }],
    usage: { input_tokens: 10, output_tokens: 5 }
  })
  assert.ok(!('prompt_tokens_details' in out.usage))
  assert.equal(out.usage.total_tokens, 15)
})

test('用量提取:relay 能从归一化后的 usage 里取出缓存与思考 token', () => {
  assert.deepEqual(
    cacheTokensOf({
      prompt_tokens_details: { cached_tokens: 900 },
      cache_creation_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 300 }
    }),
    { cacheRead: 900, cacheWrite: 50, reasoning: 300 }
  )
  assert.deepEqual(cacheTokensOf(undefined), { cacheRead: 0, cacheWrite: 0, reasoning: 0 })
})

// ---------- 缓存计价 ----------

test('缓存计价:命中的部分按折扣价,剩下的才是全价', () => {
  setPrice('cache-model', 10, 30)   // 缓存倍率跟随默认 0.1 / 1.25
  // 总输入 100 万,其中 90 万命中缓存
  // = 10 万 × 10 + 90 万 × 1 = 1 + 0.9 = 1.9
  const cost = computeCost('cache-model', 1_000_000, 0, 'default', { cacheRead: 900_000 })
  assert.equal(cost, 1.9)
  // 不打折的话是 10
  assert.equal(computeCost('cache-model', 1_000_000, 0), 10)
})

test('缓存计价:写入缓存比全价还贵一点', () => {
  setPrice('write-model', 10, 0)
  // 100 万里 20 万是写缓存:80 万 × 10 + 20 万 × 12.5 = 8 + 2.5 = 10.5
  assert.equal(computeCost('write-model', 1_000_000, 0, 'default', { cacheWrite: 200_000 }), 10.5)
})

test('缓存计价:模型自己的倍率优先于站点默认', () => {
  setPrice('own-ratio', 10, 0, 0.5, 1)   // OpenAI 风格:缓存半价
  // 100 万全部命中缓存 → 10 × 0.5 = 5
  assert.equal(computeCost('own-ratio', 1_000_000, 0, 'default', { cacheRead: 1_000_000 }), 5)
  // 同样场景下走默认倍率的模型只要 1
  setPrice('def-ratio', 10, 0)
  assert.equal(computeCost('def-ratio', 1_000_000, 0, 'default', { cacheRead: 1_000_000 }), 1)
})

test('缓存计价:缓存数超过总输入也不会算出负数', () => {
  setPrice('weird-model', 10, 0)
  const cost = computeCost('weird-model', 1000, 0, 'default', { cacheRead: 999_999 })
  assert.ok(cost >= 0)
})

test('缓存计价:站点倍率与分组倍率照常叠加', () => {
  setPrice('stacked', 10, 0)
  setSetting('price_ratio', '2')
  db.prepare('INSERT OR REPLACE INTO groups (name, ratio) VALUES (?, ?)').run('half', 0.5)
  // 100 万全缓存 → 10 × 0.1 = 1,再 × 2 × 0.5 = 1
  assert.equal(computeCost('stacked', 1_000_000, 0, 'half', { cacheRead: 1_000_000 }), 1)
  setSetting('price_ratio', '1')
})

test('查价:缓存价从输入价按倍率推导', () => {
  setPrice('lookup-model', 8, 24, 0.25, 2)
  const p = lookupPrice('lookup-model')
  assert.equal(p.cacheRead, 2)
  assert.equal(p.cacheWrite, 16)
})

// ---------- 思考链 ----------

test('思考链:当前模型走 adaptive + effort,绝不能再发 budget_tokens', () => {
  const msgs = [{ role: 'user', content: 'hi' }]
  const build5 = body => buildUpstreamRequest(anthropic, 'k', '/chat/completions', body, 'claude-opus-5', false).payload

  assert.equal(build5({ messages: msgs }).thinking, undefined)

  const p = build5({ messages: msgs, reasoning_effort: 'high' })
  // budget_tokens 在 Opus 4.7+ 上会直接 400
  assert.equal(p.thinking.type, 'adaptive')
  assert.ok(!('budget_tokens' in p.thinking), 'budget_tokens 在当前模型上会 400')
  assert.deepEqual(p.output_config, { effort: 'high' })
  // 默认是 omitted,不显式要 summarized 就拿不到思考内容
  assert.equal(p.thinking.display, 'summarized')
})

test('思考链:老模型仍用 budget_tokens,且 max_tokens 要大于预算', () => {
  const old = body => buildUpstreamRequest(anthropic, 'k', '/chat/completions', body, 'claude-sonnet-4-5', false).payload
  const p = old({ messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' })
  assert.deepEqual(p.thinking, { type: 'enabled', budget_tokens: 16384 })
  assert.ok(p.max_tokens > 16384, `max_tokens 必须给思考留出空间,实际 ${p.max_tokens}`)
  assert.equal(p.output_config, undefined, '老模型不认 output_config')
})

test('思考链:显式给的预算在老模型上优先于 effort 档位', () => {
  const p = buildUpstreamRequest(
    anthropic, 'k', '/chat/completions',
    { messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'low', thinking: { budget_tokens: 9999 } },
    'claude-sonnet-4-5', false
  ).payload
  assert.equal(p.thinking.budget_tokens, 9999)
})

test('思考链:Gemini 的 thinkingConfig', () => {
  const p = build(gemini, { messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'medium' })
  assert.deepEqual(p.generationConfig.thinkingConfig, { thinkingBudget: 4096, includeThoughts: true })
})

test('思考链:Anthropic 的 thinking 块转成 reasoning_content,不混进正文', () => {
  const out = convertResponse(anthropic, 'm', {
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '先想一下…' },
      { type: 'text', text: '答案是 42' }
    ],
    usage: { input_tokens: 5, output_tokens: 20 }
  })
  const msg = out.choices[0].message
  assert.equal(msg.content, '答案是 42')
  assert.equal(msg.reasoning_content, '先想一下…')
})

test('思考链:Gemini 的 thought 片段不能混进正文', () => {
  const out = convertResponse(gemini, 'm', {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text: '思考中', thought: true }, { text: '最终答案' }] }
    }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, thoughtsTokenCount: 7 }
  })
  const msg = out.choices[0].message
  assert.equal(msg.content, '最终答案')
  assert.equal(msg.reasoning_content, '思考中')
  // 思考 token 计入输出,并单独报出来
  assert.equal(out.usage.completion_tokens, 17)
  assert.equal(out.usage.completion_tokens_details.reasoning_tokens, 7)
})

test('思考链:流式的 thinking_delta 走 reasoning_content', () => {
  const t = createStreamTransformer(anthropic, 'm')
  let out = ''
  for (const l of [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":95}}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"嗯…"}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"好的"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}',
    'data: {"type":"message_stop"}'
  ]) out += t.feed(l) || ''

  const ds = out.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(5)))
  assert.ok(ds.some(d => d.choices?.[0]?.delta?.reasoning_content === '嗯…'), '思考增量要走 reasoning_content')
  assert.ok(ds.some(d => d.choices?.[0]?.delta?.content === '好的'), '正文增量照常走 content')
  // 流式下缓存明细也要带出来
  assert.equal(t.usage().prompt_tokens, 100)
  assert.equal(t.usage().prompt_tokens_details.cached_tokens, 95)
})
