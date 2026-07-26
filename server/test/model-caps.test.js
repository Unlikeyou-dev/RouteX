import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { setSetting } = await import('../src/db.js')
const {
  anthropicGeneration, supportsSampling, supportsThinkingBudget,
  supportsAdaptiveThinking, normalizeEffort, cacheMinimumTokens
} = await import('../src/model-caps.js')
const { buildUpstreamRequest, convertResponse, createStreamTransformer } = await import('../src/adapters.js')

const anthropic = { type: 'anthropic', base_url: '' }
const build = (body, model = 'claude-opus-5') =>
  buildUpstreamRequest(anthropic, 'k', '/chat/completions', body, model, false).payload
const msgs = [{ role: 'user', content: 'hi' }]

// ---------- 模型世代解析 ----------

test('世代解析:认得出各种命名', () => {
  assert.deepEqual(anthropicGeneration('claude-opus-5'), { family: 'opus', major: 5, minor: 0 })
  assert.deepEqual(anthropicGeneration('claude-sonnet-4-6'), { family: 'sonnet', major: 4, minor: 6 })
  assert.deepEqual(anthropicGeneration('claude-opus-4-5-20251101'), { family: 'opus', major: 4, minor: 5 })
  assert.deepEqual(anthropicGeneration('claude-fable-5'), { family: 'fable', major: 5, minor: 0 })
  // 老式写法:世代号在模型族之前
  assert.deepEqual(anthropicGeneration('claude-3-5-haiku-20241022'), { family: 'haiku', major: 3, minor: 5 })
  assert.equal(anthropicGeneration('doubao-pro-32k'), null)
})

test('采样参数:4.7 及更新的模型不接受,老模型可以', () => {
  for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7']) {
    assert.equal(supportsSampling(m), false, `${m} 不该发采样参数`)
  }
  for (const m of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5']) {
    assert.equal(supportsSampling(m), true, `${m} 可以发采样参数`)
  }
  // 认不出来的名字按新模型处理 —— 少传参数只是行为差异,多传是整个请求失败
  assert.equal(supportsSampling('some-unknown-model'), false)
})

test('思考方式:新模型用 adaptive,老模型用 budget_tokens', () => {
  assert.equal(supportsThinkingBudget('claude-opus-5'), false)
  assert.equal(supportsThinkingBudget('claude-opus-4-7'), false)
  assert.equal(supportsThinkingBudget('claude-sonnet-4-6'), true)
  assert.equal(supportsThinkingBudget('claude-sonnet-4-5'), true)

  assert.equal(supportsAdaptiveThinking('claude-opus-5'), true)
  assert.equal(supportsAdaptiveThinking('claude-sonnet-4-6'), true)
  assert.equal(supportsAdaptiveThinking('claude-sonnet-4-5'), false)
})

test('effort 档位:xhigh/max 只在新模型上保留,老模型降到 high', () => {
  assert.equal(normalizeEffort('claude-opus-5', 'xhigh'), 'xhigh')
  assert.equal(normalizeEffort('claude-opus-5', 'max'), 'max')
  assert.equal(normalizeEffort('claude-opus-4-6', 'xhigh'), 'high')
  assert.equal(normalizeEffort('claude-opus-5', 'medium'), 'medium')
  // OpenAI 侧的 minimal/none 归到最低档
  assert.equal(normalizeEffort('claude-opus-5', 'minimal'), 'low')
  assert.equal(normalizeEffort('claude-opus-5', ''), null)
})

test('缓存最小长度:按模型返回,用于 UI 提示', () => {
  assert.equal(cacheMinimumTokens('claude-opus-5'), 512)
  assert.equal(cacheMinimumTokens('claude-sonnet-5'), 1024)
  assert.equal(cacheMinimumTokens('claude-opus-4-8'), 1024)
  assert.equal(cacheMinimumTokens('claude-opus-4-7'), 2048)
  assert.equal(cacheMinimumTokens('claude-opus-4-6'), 4096)
})

// ---------- 采样参数裁剪(P0) ----------

test('采样参数:当前模型上必须被剥掉,否则整条链路 400', () => {
  const p = build({ messages: msgs, temperature: 0.7, top_p: 0.9 }, 'claude-opus-5')
  assert.ok(!('temperature' in p), 'temperature 会让 Opus 5 直接 400')
  assert.ok(!('top_p' in p), 'top_p 会让 Opus 5 直接 400')
})

test('采样参数:老模型上照常透传', () => {
  const p = build({ messages: msgs, temperature: 0.7, top_p: 0.9 }, 'claude-sonnet-4-5')
  assert.equal(p.temperature, 0.7)
  assert.equal(p.top_p, 0.9)
})

// ---------- 思考块往返(P0) ----------

test('思考块:响应里同时给纯文本与带 signature 的原始块', () => {
  const out = convertResponse(anthropic, 'm', {
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: '先想想', signature: 'sig-abc' },
      { type: 'tool_use', id: 't1', name: 'f', input: {} }
    ],
    usage: { input_tokens: 5, output_tokens: 5 }
  })
  const msg = out.choices[0].message
  assert.equal(msg.reasoning_content, '先想想')
  assert.deepEqual(msg.thinking_blocks, [{ type: 'thinking', thinking: '先想想', signature: 'sig-abc' }])
})

test('思考块:回传时原样放在 assistant 内容最前面', () => {
  const p = build({
    messages: [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: null,
        thinking_blocks: [{ type: 'thinking', thinking: '先想想', signature: 'sig-abc' }],
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'r' }
    ]
  })
  const assistant = p.messages.find(m => m.role === 'assistant')
  // Anthropic 要求带 tool_use 的 assistant 消息必须以 thinking 块开头
  assert.equal(assistant.content[0].type, 'thinking')
  assert.equal(assistant.content[0].signature, 'sig-abc', 'signature 丢了下一轮就 400')
  assert.ok(assistant.content.some(b => b.type === 'tool_use'))
})

test('思考块:redacted_thinking 也要原样带回', () => {
  const p = build({
    messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'ok', thinking_blocks: [{ type: 'redacted_thinking', data: 'ENCRYPTED' }] }
    ]
  })
  const assistant = p.messages.find(m => m.role === 'assistant')
  assert.deepEqual(assistant.content[0], { type: 'redacted_thinking', data: 'ENCRYPTED' })
})

test('思考块:流式下 signature 也要收集并作为完整块发出', () => {
  const t = createStreamTransformer(anthropic, 'm')
  let out = ''
  for (const l of [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"想…"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-xyz"}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
    'data: {"type":"message_stop"}'
  ]) out += t.feed(l) || ''

  const ds = out.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(5)))
  const tb = ds.find(d => d.choices?.[0]?.delta?.thinking_blocks)?.choices[0].delta.thinking_blocks[0]
  assert.ok(tb, '流式下必须把带 signature 的思考块发出去')
  assert.equal(tb.signature, 'sig-xyz')
  assert.equal(tb.thinking, '想…')
})

// ---------- 拒答 ----------

test('拒答:映射成 content_filter 并给出可读说明,而不是空响应', () => {
  const out = convertResponse(anthropic, 'm', {
    stop_reason: 'refusal',
    content: [],
    usage: { input_tokens: 10, output_tokens: 0 }
  })
  assert.equal(out.choices[0].finish_reason, 'content_filter')
  assert.ok(out.choices[0].message.content.length > 0, '不能给用户一个空响应')
})

// ---------- 缓存断点注入 ----------

test('缓存断点:默认注入 tools / system / 倒数第二条消息', () => {
  setSetting('anthropic_auto_cache', '1')
  const p = build({
    messages: [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: '第二轮' }
    ],
    tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }]
  })
  assert.deepEqual(p.tools[p.tools.length - 1].cache_control, { type: 'ephemeral' })
  assert.ok(Array.isArray(p.system), 'system 要用块数组形式才能挂 cache_control')
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' })

  // 断点打在倒数第二条,最后一轮保持易变
  const secondLast = p.messages[p.messages.length - 2]
  const lastBlock = secondLast.content[secondLast.content.length - 1]
  assert.deepEqual(lastBlock.cache_control, { type: 'ephemeral' })
  const final = p.messages[p.messages.length - 1]
  assert.ok(!final.content.some(b => b.cache_control), '最后一轮不该打断点')
})

test('缓存断点:最多 3 个,不超过上游 4 个的上限', () => {
  setSetting('anthropic_auto_cache', '1')
  const p = build({
    messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }
    ],
    tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }]
  })
  const count =
    p.tools.filter(t => t.cache_control).length +
    (Array.isArray(p.system) ? p.system.filter(s => s.cache_control).length : 0) +
    p.messages.reduce((n, m) => n + m.content.filter(b => b.cache_control).length, 0)
  assert.ok(count <= 4, `断点数 ${count} 超过上游上限`)
  assert.equal(count, 3)
})

test('缓存断点:关掉开关后不注入', () => {
  setSetting('anthropic_auto_cache', '0')
  const p = build({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] })
  assert.ok(!p.messages.some(m => m.content.some(b => b.cache_control)))
  setSetting('anthropic_auto_cache', '1')
})

test('缓存断点:不会打到 thinking 块上(上游不允许)', () => {
  setSetting('anthropic_auto_cache', '1')
  const p = build({
    messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, thinking_blocks: [{ type: 'thinking', thinking: 't', signature: 's' }] },
      { role: 'user', content: 'q2' }
    ]
  })
  const assistant = p.messages.find(m => m.role === 'assistant')
  assert.ok(!assistant.content.some(b => b.type === 'thinking' && b.cache_control))
})
