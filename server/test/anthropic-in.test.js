import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const {
  anthropicRequestToOpenAI, openaiResponseToAnthropic, createAnthropicEncoder, anthropicErrorBody
} = await import('../src/protocols/anthropic-in.js')
const { buildAnthropicPassthrough } = await import('../src/adapters.js')

// ---------- 入站请求 → 规范格式 ----------

test('入站:system 提到 messages 最前面', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm', max_tokens: 100,
    system: '你是助手',
    messages: [{ role: 'user', content: '你好' }]
  })
  assert.deepEqual(o.messages[0], { role: 'system', content: '你是助手' })
  assert.deepEqual(o.messages[1], { role: 'user', content: '你好' })
  assert.equal(o.max_tokens, 100)
})

test('入站:system 也可以是块数组', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm',
    system: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }],
    messages: [{ role: 'user', content: 'q' }]
  })
  assert.equal(o.messages[0].content, 'A\nB')
})

test('入站:tool_use → tool_calls', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm',
    messages: [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我查一下' },
          { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'BJ' } }
        ]
      }
    ]
  })
  const a = o.messages.find(m => m.role === 'assistant')
  assert.equal(a.content, '我查一下')
  assert.equal(a.tool_calls[0].id, 'toolu_1')
  assert.equal(a.tool_calls[0].function.name, 'get_weather')
  assert.equal(a.tool_calls[0].function.arguments, '{"city":"BJ"}')
})

test('入站:user 里的 tool_result 拆成独立的 tool 消息', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm',
    messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'f', input: {} }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '结果' },
          { type: 'text', text: '继续' }
        ]
      }
    ]
  })
  const toolMsg = o.messages.find(m => m.role === 'tool')
  assert.equal(toolMsg.tool_call_id, 't1')
  assert.equal(toolMsg.content, '结果')
  // 剩下的文本仍是一条 user 消息
  assert.equal(o.messages[o.messages.length - 1].content, '继续')
})

test('入站:图片块转成 data URI', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm',
    messages: [{
      role: 'user',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }]
    }]
  })
  assert.deepEqual(o.messages[0].content[0], {
    type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' }
  })
})

test('入站:思考块原样保留,供回到 Anthropic 渠道时还原', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm',
    messages: [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '想想', signature: 'SIG' },
          { type: 'text', text: '答' }
        ]
      }
    ]
  })
  const a = o.messages.find(m => m.role === 'assistant')
  assert.equal(a.thinking_blocks[0].signature, 'SIG')
  assert.equal(a.reasoning_content, '想想')
})

test('入站:tools 与 tool_choice 转换', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm',
    messages: [{ role: 'user', content: 'q' }],
    tools: [{ name: 'f', description: 'd', input_schema: { type: 'object' } }],
    tool_choice: { type: 'any' }
  })
  assert.deepEqual(o.tools[0], {
    type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } }
  })
  assert.equal(o.tool_choice, 'required')

  const o2 = anthropicRequestToOpenAI({
    model: 'm', messages: [{ role: 'user', content: 'q' }],
    tools: [{ name: 'f', input_schema: {} }], tool_choice: { type: 'tool', name: 'f' }
  })
  assert.deepEqual(o2.tool_choice, { type: 'function', function: { name: 'f' } })
})

// ---------- 规范格式 → 出站 Anthropic ----------

test('出站:tool_calls → tool_use,finish_reason → stop_reason', () => {
  const a = openaiResponseToAnthropic({
    id: 'chatcmpl-1',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant', content: '稍等',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }]
      }
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  }, 'my-model')

  assert.equal(a.type, 'message')
  assert.equal(a.role, 'assistant')
  assert.equal(a.model, 'my-model')
  assert.equal(a.stop_reason, 'tool_use')
  assert.deepEqual(a.content[0], { type: 'text', text: '稍等' })
  assert.deepEqual(a.content[1], { type: 'tool_use', id: 'call_1', name: 'f', input: { a: 1 } })
  assert.equal(a.usage.input_tokens, 10)
  assert.equal(a.usage.output_tokens, 5)
})

test('出站:input_tokens 要把缓存部分减出去(Anthropic 口径)', () => {
  const a = openaiResponseToAnthropic({
    choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
    usage: {
      prompt_tokens: 1000, completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 900 },
      cache_creation_tokens: 50
    }
  }, 'm')
  assert.equal(a.usage.input_tokens, 50, '总输入 1000 - 缓存读 900 - 缓存写 50')
  assert.equal(a.usage.cache_read_input_tokens, 900)
  assert.equal(a.usage.cache_creation_input_tokens, 50)
})

test('出站:各种 finish_reason 映射', () => {
  const mk = fr => openaiResponseToAnthropic(
    { choices: [{ finish_reason: fr, message: { content: 'x' } }], usage: {} }, 'm'
  ).stop_reason
  assert.equal(mk('stop'), 'end_turn')
  assert.equal(mk('length'), 'max_tokens')
  assert.equal(mk('tool_calls'), 'tool_use')
  assert.equal(mk('content_filter'), 'refusal')
})

// ---------- 流式编码 ----------

const events = sse =>
  sse.split('\n\n').filter(Boolean).map(b => {
    const line = b.split('\n').find(l => l.startsWith('data: '))
    return line ? JSON.parse(line.slice(6)) : null
  }).filter(Boolean)

test('流式:文本增量编成完整的 Anthropic 事件序列', () => {
  const enc = createAnthropicEncoder('m')
  let out = ''
  out += enc.feed({ choices: [{ delta: { role: 'assistant', content: '' } }] })
  out += enc.feed({ choices: [{ delta: { content: '你' } }] })
  out += enc.feed({ choices: [{ delta: { content: '好' } }] })
  out += enc.feed({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  out += enc.finish()

  const evs = events(out)
  const types = evs.map(e => e.type)
  assert.equal(types[0], 'message_start')
  assert.ok(types.includes('content_block_start'))
  assert.ok(types.includes('content_block_stop'))
  assert.equal(types[types.length - 2], 'message_delta')
  assert.equal(types[types.length - 1], 'message_stop')

  const text = evs.filter(e => e.type === 'content_block_delta' && e.delta.type === 'text_delta')
    .map(e => e.delta.text).join('')
  assert.equal(text, '你好')
  assert.equal(evs.find(e => e.type === 'message_delta').delta.stop_reason, 'end_turn')
  // SSE 必须带 event: 行,Anthropic SDK 靠它分发
  assert.ok(out.includes('event: message_start'))
})

test('流式:工具调用块序号与文本块统一编号', () => {
  const enc = createAnthropicEncoder('m')
  let out = ''
  out += enc.feed({ choices: [{ delta: { content: '我查一下' } }] })
  out += enc.feed({
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '' } }] } }]
  })
  out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a"' } }] } }] })
  out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] })
  out += enc.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  out += enc.finish()

  const evs = events(out)
  const starts = evs.filter(e => e.type === 'content_block_start')
  assert.equal(starts[0].index, 0)
  assert.equal(starts[0].content_block.type, 'text')
  assert.equal(starts[1].index, 1, '工具块跟在文本块之后统一编号')
  assert.equal(starts[1].content_block.type, 'tool_use')
  assert.equal(starts[1].content_block.name, 'f')

  const args = evs.filter(e => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta')
    .map(e => e.delta.partial_json).join('')
  assert.equal(args, '{"a":1}')
  assert.equal(evs.find(e => e.type === 'message_delta').delta.stop_reason, 'tool_use')
  // 每个打开的块都要被关掉
  assert.equal(evs.filter(e => e.type === 'content_block_start').length,
    evs.filter(e => e.type === 'content_block_stop').length)
})

test('流式:思考增量走 thinking_delta', () => {
  const enc = createAnthropicEncoder('m')
  let out = enc.feed({ choices: [{ delta: { reasoning_content: '想…' } }] })
  out += enc.feed({ choices: [{ delta: { content: '答' } }] })
  out += enc.finish()
  const evs = events(out)
  assert.ok(evs.some(e => e.type === 'content_block_delta' && e.delta.type === 'thinking_delta'))
  assert.ok(evs.some(e => e.type === 'content_block_start' && e.content_block.type === 'thinking'))
})

// ---------- 透传 ----------

const channel = { type: 'anthropic', base_url: '' }

test('透传:换模型名,原始字段一律不动', () => {
  const body = {
    model: 'my-alias', max_tokens: 100,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'q', cache_control: { type: 'ephemeral' } }] }],
    metadata: { user_id: 'u1' },
    某个未知字段: 1
  }
  const { payload, url, headers } = buildAnthropicPassthrough(channel, 'sk-k', body, 'claude-opus-5', false)
  assert.ok(url.endsWith('/v1/messages'))
  assert.equal(headers['x-api-key'], 'sk-k')
  assert.equal(payload.model, 'claude-opus-5')
  assert.deepEqual(payload.metadata, { user_id: 'u1' })
  assert.equal(payload['某个未知字段'], 1, '不认识的字段也要原样过去')
  // 客户端自己打过断点就不再插手
  assert.deepEqual(payload.messages[0].content[0].cache_control, { type: 'ephemeral' })
})

test('透传:仍会按模型世代剥掉会 400 的采样参数', () => {
  const p = buildAnthropicPassthrough(
    channel, 'k',
    { model: 'x', messages: [{ role: 'user', content: 'q' }], temperature: 0.5, top_k: 10 },
    'claude-opus-5', false
  ).payload
  assert.ok(!('temperature' in p))
  assert.ok(!('top_k' in p))
})

test('透传:客户端按老写法发的 budget_tokens 会被改写成 adaptive', () => {
  const p = buildAnthropicPassthrough(
    channel, 'k',
    { model: 'x', messages: [{ role: 'user', content: 'q' }], thinking: { type: 'enabled', budget_tokens: 16384 } },
    'claude-opus-5', false
  ).payload
  assert.equal(p.thinking.type, 'adaptive')
  assert.ok(!('budget_tokens' in p.thinking))
  assert.deepEqual(p.output_config, { effort: 'high' })
})

test('透传:发给老模型的 adaptive 会被改写回 budget_tokens', () => {
  const p = buildAnthropicPassthrough(
    channel, 'k',
    { model: 'x', messages: [{ role: 'user', content: 'q' }], thinking: { type: 'adaptive' } },
    'claude-sonnet-4-5', false
  ).payload
  assert.equal(p.thinking.type, 'enabled')
  assert.ok(p.max_tokens > p.thinking.budget_tokens)
  assert.equal(p.output_config, undefined)
})

test('错误体:Anthropic 风格结构', () => {
  assert.deepEqual(anthropicErrorBody('炸了', 'rate_limit_error'), {
    type: 'error', error: { type: 'rate_limit_error', message: '炸了' }
  })
})
