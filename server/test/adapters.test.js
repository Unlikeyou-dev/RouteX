import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { buildUpstreamRequest, convertResponse, createStreamTransformer } = await import('../src/adapters.js')

const anthropic = { type: 'anthropic', base_url: '' }
const gemini = { type: 'gemini', base_url: '' }
const openai = { type: 'openai', base_url: '' }

const build = (ch, body, stream = false) =>
  buildUpstreamRequest(ch, 'sk-test', '/chat/completions', body, 'm', stream).payload

const WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询天气',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
      additionalProperties: false
    }
  }
}

// ---------- 工具定义 ----------

test('工具定义:OpenAI → Anthropic', () => {
  const p = build(anthropic, { messages: [{ role: 'user', content: 'hi' }], tools: [WEATHER_TOOL] })
  assert.deepEqual(p.tools, [{
    name: 'get_weather',
    description: '查询天气',
    input_schema: WEATHER_TOOL.function.parameters
  }])
})

test('工具定义:OpenAI → Gemini,并剔掉它不认的 schema 关键字', () => {
  const p = build(gemini, { messages: [{ role: 'user', content: 'hi' }], tools: [WEATHER_TOOL] })
  const decl = p.tools[0].functionDeclarations[0]
  assert.equal(decl.name, 'get_weather')
  assert.ok(!('additionalProperties' in decl.parameters), 'additionalProperties 会让 Gemini 报 400')
  assert.deepEqual(decl.parameters.required, ['city'])
})

test('工具定义:OpenAI 兼容渠道原样透传', () => {
  const p = build(openai, { messages: [{ role: 'user', content: 'hi' }], tools: [WEATHER_TOOL] })
  assert.deepEqual(p.tools, [WEATHER_TOOL])
})

test('tool_choice:三种取值的映射', () => {
  const msgs = [{ role: 'user', content: 'hi' }]
  assert.equal(build(anthropic, { messages: msgs, tools: [WEATHER_TOOL] }).tool_choice, undefined)
  assert.deepEqual(
    build(anthropic, { messages: msgs, tools: [WEATHER_TOOL], tool_choice: 'required' }).tool_choice,
    { type: 'any' }
  )
  assert.deepEqual(
    build(anthropic, {
      messages: msgs, tools: [WEATHER_TOOL],
      tool_choice: { type: 'function', function: { name: 'get_weather' } }
    }).tool_choice,
    { type: 'tool', name: 'get_weather' }
  )
  // none:干脆不给上游 tools
  assert.equal(build(anthropic, { messages: msgs, tools: [WEATHER_TOOL], tool_choice: 'none' }).tools, undefined)
  assert.equal(build(gemini, { messages: msgs, tools: [WEATHER_TOOL], tool_choice: 'none' }).tools, undefined)
})

test('tool_choice:Gemini 的 functionCallingConfig', () => {
  const msgs = [{ role: 'user', content: 'hi' }]
  assert.deepEqual(
    build(gemini, { messages: msgs, tools: [WEATHER_TOOL], tool_choice: 'required' }).toolConfig,
    { functionCallingConfig: { mode: 'ANY' } }
  )
  assert.deepEqual(
    build(gemini, {
      messages: msgs, tools: [WEATHER_TOOL],
      tool_choice: { type: 'function', function: { name: 'get_weather' } }
    }).toolConfig,
    { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_weather'] } }
  )
})

// ---------- 工具调用往返(agent 的核心回合) ----------

const AGENT_TURN = [
  { role: 'user', content: '北京天气怎么样' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } }]
  },
  { role: 'tool', tool_call_id: 'call_1', content: '{"temp":25,"desc":"晴"}' }
]

test('工具往返:Anthropic 的 tool_use 与 tool_result', () => {
  const p = build(anthropic, { messages: AGENT_TURN, tools: [WEATHER_TOOL] })
  const [user, assistant, result] = p.messages
  assert.equal(user.role, 'user')

  assert.equal(assistant.role, 'assistant')
  const toolUse = assistant.content.find(b => b.type === 'tool_use')
  assert.ok(toolUse, 'assistant 的 tool_calls 必须转成 tool_use 块')
  assert.equal(toolUse.id, 'call_1')
  assert.equal(toolUse.name, 'get_weather')
  assert.deepEqual(toolUse.input, { city: '北京' })

  // 工具结果要作为 user 消息里的 tool_result 块回去
  assert.equal(result.role, 'user')
  const toolResult = result.content.find(b => b.type === 'tool_result')
  assert.ok(toolResult, '工具执行结果必须转成 tool_result 块')
  assert.equal(toolResult.tool_use_id, 'call_1')
  assert.equal(toolResult.content, '{"temp":25,"desc":"晴"}')
})

test('工具往返:多个并行工具结果合并进同一条 user 消息(Anthropic 要求交替)', () => {
  const msgs = [
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'a', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'b', arguments: '{}' } }
      ]
    },
    { role: 'tool', tool_call_id: 'c1', content: 'r1' },
    { role: 'tool', tool_call_id: 'c2', content: 'r2' }
  ]
  const p = build(anthropic, { messages: msgs })
  const roles = p.messages.map(m => m.role)
  assert.deepEqual(roles, ['user', 'assistant', 'user'], '角色必须严格交替')
  const results = p.messages[2].content.filter(b => b.type === 'tool_result')
  assert.equal(results.length, 2)
  assert.deepEqual(results.map(r => r.tool_use_id), ['c1', 'c2'])
})

test('工具往返:Gemini 的 functionCall 与 functionResponse', () => {
  const p = build(gemini, { messages: AGENT_TURN, tools: [WEATHER_TOOL] })
  const model = p.contents.find(c => c.role === 'model')
  assert.ok(model.parts.some(x => x.functionCall?.name === 'get_weather'))
  assert.deepEqual(model.parts.find(x => x.functionCall).functionCall.args, { city: '北京' })

  const last = p.contents[p.contents.length - 1]
  const fr = last.parts.find(x => x.functionResponse)
  assert.ok(fr, '工具结果必须转成 functionResponse')
  // Gemini 认名字不认 id,要能从之前的 tool_calls 里查出来
  assert.equal(fr.functionResponse.name, 'get_weather')
  assert.deepEqual(fr.functionResponse.response, { temp: 25, desc: '晴' })
})

test('工具往返:非 JSON 的工具结果也要能包成对象给 Gemini', () => {
  const msgs = [
    { role: 'user', content: 'q' },
    { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '就是一段纯文本' }
  ]
  const p = build(gemini, { messages: msgs })
  const fr = p.contents[p.contents.length - 1].parts.find(x => x.functionResponse)
  assert.equal(typeof fr.functionResponse.response, 'object')
  assert.equal(fr.functionResponse.response.result, '就是一段纯文本')
})

test('工具往返:参数不是合法 JSON 时不整体失败', () => {
  const msgs = [
    { role: 'user', content: 'q' },
    { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{坏的' } }] }
  ]
  const p = build(anthropic, { messages: msgs })
  const tu = p.messages[1].content.find(b => b.type === 'tool_use')
  assert.equal(typeof tu.input, 'object')
})

// ---------- 多模态 ----------

const PNG = 'data:image/png;base64,iVBORw0KGgo='

test('图片输入:data URI → Anthropic 的 base64 image 块', () => {
  const p = build(anthropic, {
    messages: [{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: PNG } }] }]
  })
  const blocks = p.messages[0].content
  assert.equal(blocks[0].type, 'text')
  assert.deepEqual(blocks[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' }
  })
})

test('图片输入:http 地址 → Anthropic 的 url image 块', () => {
  const p = build(anthropic, {
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x.test/a.png' } }] }]
  })
  assert.deepEqual(p.messages[0].content[0], {
    type: 'image', source: { type: 'url', url: 'https://x.test/a.png' }
  })
})

test('图片输入:data URI → Gemini 的 inlineData', () => {
  const p = build(gemini, {
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: PNG } }] }]
  })
  assert.deepEqual(p.contents[0].parts[0], {
    inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' }
  })
})

// ---------- 响应转换 ----------

test('响应:Anthropic 的 tool_use → OpenAI tool_calls', () => {
  const out = convertResponse(anthropic, 'm', {
    id: 'msg_1',
    stop_reason: 'tool_use',
    content: [
      { type: 'text', text: '我查一下' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: '北京' } }
    ],
    usage: { input_tokens: 10, output_tokens: 5 }
  })
  const msg = out.choices[0].message
  assert.equal(msg.content, '我查一下')
  assert.equal(msg.tool_calls.length, 1)
  assert.deepEqual(msg.tool_calls[0], {
    id: 'toolu_1', type: 'function',
    function: { name: 'get_weather', arguments: '{"city":"北京"}' }
  })
  assert.equal(out.choices[0].finish_reason, 'tool_calls')
  assert.equal(out.usage.total_tokens, 15)
})

test('响应:只有工具调用时 content 为 null(OpenAI 的约定)', () => {
  const out = convertResponse(anthropic, 'm', {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't1', name: 'f', input: {} }],
    usage: { input_tokens: 1, output_tokens: 1 }
  })
  assert.equal(out.choices[0].message.content, null)
})

test('响应:纯文本回复不应带 tool_calls 字段', () => {
  const out = convertResponse(anthropic, 'm', {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '你好' }],
    usage: { input_tokens: 1, output_tokens: 1 }
  })
  assert.equal(out.choices[0].message.content, '你好')
  assert.ok(!('tool_calls' in out.choices[0].message))
  assert.equal(out.choices[0].finish_reason, 'stop')
})

test('响应:Gemini 的 functionCall → OpenAI tool_calls', () => {
  const out = convertResponse(gemini, 'm', {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ functionCall: { name: 'get_weather', args: { city: '上海' } } }] }
    }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 }
  })
  const msg = out.choices[0].message
  assert.equal(msg.tool_calls[0].function.name, 'get_weather')
  assert.equal(msg.tool_calls[0].function.arguments, '{"city":"上海"}')
  assert.equal(out.choices[0].finish_reason, 'tool_calls')
})

// ---------- 流式 ----------

const collect = (ch, lines) => {
  const t = createStreamTransformer(ch, 'm')
  let out = ''
  for (const l of lines) out += t.feed(l) || ''
  out += t.finish()
  return { out, t }
}
const deltas = out =>
  out.split('\n')
    .filter(l => l.startsWith('data:') && !l.includes('[DONE]'))
    .map(l => JSON.parse(l.slice(5)))

test('流式:Anthropic 的工具调用增量 → OpenAI tool_calls 增量', () => {
  const { out } = collect(anthropic, [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"稍等"}}',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_9","name":"get_weather"}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"北京\\"}"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}',
    'data: {"type":"message_stop"}'
  ])
  const ds = deltas(out)

  const started = ds.find(d => d.choices?.[0]?.delta?.tool_calls?.[0]?.id)
  assert.ok(started, '必须先发一条带 id 和函数名的 tool_calls 增量')
  assert.equal(started.choices[0].delta.tool_calls[0].function.name, 'get_weather')
  assert.equal(started.choices[0].delta.tool_calls[0].index, 0, '工具序号只数工具块,不含文本块')

  const argChunks = ds
    .filter(d => d.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments)
    .map(d => d.choices[0].delta.tool_calls[0].function.arguments)
    .join('')
  assert.equal(argChunks, '{"city":"北京"}', '参数增量拼起来要是完整 JSON')

  const finish = ds.find(d => d.choices?.[0]?.finish_reason)
  assert.equal(finish.choices[0].finish_reason, 'tool_calls')
  assert.ok(out.includes('[DONE]'))
})

test('流式:纯文本回复的 finish_reason 仍是 stop', () => {
  const { out } = collect(anthropic, [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
    'data: {"type":"message_stop"}'
  ])
  const finish = deltas(out).find(d => d.choices?.[0]?.finish_reason)
  assert.equal(finish.choices[0].finish_reason, 'stop')
})

test('流式:Gemini 的 functionCall 一次给全', () => {
  const { out } = collect(gemini, [
    'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"上海"}}}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":4,"totalTokenCount":9}}'
  ])
  const ds = deltas(out)
  const tc = ds.find(d => d.choices?.[0]?.delta?.tool_calls)?.choices[0].delta.tool_calls[0]
  assert.equal(tc.function.name, 'get_weather')
  assert.equal(tc.function.arguments, '{"city":"上海"}')
  const finish = ds.find(d => d.choices?.[0]?.finish_reason)
  assert.equal(finish.choices[0].finish_reason, 'tool_calls')
})

test('流式:用量能正确带出来', () => {
  const { t } = collect(anthropic, [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
    'data: {"type":"message_stop"}'
  ])
  assert.deepEqual(t.usage(), { prompt_tokens: 100, completion_tokens: 42, total_tokens: 142 })
})
