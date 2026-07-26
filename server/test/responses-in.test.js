import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const {
  responsesRequestToOpenAI, openaiResponseToResponses, createResponsesEncoder
} = await import('../src/protocols/responses-in.js')

// ---------- 入站请求 → 规范格式 ----------

test('入站:instructions 变 system,input 字符串变 user', () => {
  const o = responsesRequestToOpenAI({
    model: 'm', instructions: '你是助手', input: '你好', max_output_tokens: 300
  })
  assert.deepEqual(o.messages, [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '你好' }
  ])
  assert.equal(o.max_tokens, 300)
})

test('入站:input 数组里的消息按角色转换', () => {
  const o = responsesRequestToOpenAI({
    model: 'm',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: '看图' }, { type: 'input_image', image_url: 'https://x/a.png' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: '好的' }] }
    ]
  })
  assert.deepEqual(o.messages[0].content, [
    { type: 'text', text: '看图' },
    { type: 'image_url', image_url: { url: 'https://x/a.png' } }
  ])
  assert.equal(o.messages[1].content, '好的')
})

test('入站:function_call / function_call_output 转成 tool_calls 与 tool 消息', () => {
  const o = responsesRequestToOpenAI({
    model: 'm',
    input: [
      { role: 'user', content: 'q' },
      { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"BJ"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"temp":25}' }
    ]
  })
  const a = o.messages.find(m => m.role === 'assistant')
  assert.equal(a.tool_calls[0].id, 'call_1')
  assert.equal(a.tool_calls[0].function.name, 'get_weather')
  const t = o.messages.find(m => m.role === 'tool')
  assert.equal(t.tool_call_id, 'call_1')
  assert.equal(t.content, '{"temp":25}')
})

test('入站:连续的 function_call 合并进同一条 assistant 消息(保住并行调用语义)', () => {
  const o = responsesRequestToOpenAI({
    model: 'm',
    input: [
      { role: 'user', content: 'q' },
      { type: 'function_call', call_id: 'c1', name: 'a', arguments: '{}' },
      { type: 'function_call', call_id: 'c2', name: 'b', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: 'r1' },
      { type: 'function_call_output', call_id: 'c2', output: 'r2' }
    ]
  })
  const assistants = o.messages.filter(m => m.role === 'assistant')
  assert.equal(assistants.length, 1, '拆成两条 assistant 会让上游以为是串行调用')
  assert.equal(assistants[0].tool_calls.length, 2)
  assert.equal(o.messages.filter(m => m.role === 'tool').length, 2)
})

test('入站:tools 是扁平结构,要嵌一层 function', () => {
  const o = responsesRequestToOpenAI({
    model: 'm', input: 'q',
    tools: [{ type: 'function', name: 'f', description: 'd', parameters: { type: 'object' } }],
    tool_choice: { type: 'function', name: 'f' }
  })
  assert.deepEqual(o.tools[0], {
    type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } }
  })
  assert.deepEqual(o.tool_choice, { type: 'function', function: { name: 'f' } })
})

test('入站:reasoning.effort 与 text.format 映射', () => {
  const o = responsesRequestToOpenAI({
    model: 'm', input: 'q',
    reasoning: { effort: 'high' },
    text: { format: { type: 'json_schema', name: 'out', schema: { type: 'object' } } }
  })
  assert.equal(o.reasoning_effort, 'high')
  assert.equal(o.response_format.type, 'json_schema')
  assert.equal(o.response_format.json_schema.name, 'out')
})

test('入站:previous_response_id 明确拒绝而不是静默忽略', () => {
  assert.throws(
    () => responsesRequestToOpenAI({ model: 'm', input: 'q', previous_response_id: 'resp_1' }),
    /previous_response_id/
  )
})

// ---------- 规范格式 → 出站 Responses ----------

test('出站:output 数组按 消息 / 函数调用 组装', () => {
  const r = openaiResponseToResponses({
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: '我查一下',
        tool_calls: [{ id: 'call_9', function: { name: 'f', arguments: '{"a":1}' } }]
      }
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  }, 'my-model')

  assert.equal(r.object, 'response')
  assert.equal(r.status, 'completed')
  assert.equal(r.model, 'my-model')

  const msg = r.output.find(o => o.type === 'message')
  assert.equal(msg.content[0].type, 'output_text')
  assert.equal(msg.content[0].text, '我查一下')

  const fc = r.output.find(o => o.type === 'function_call')
  assert.equal(fc.call_id, 'call_9')
  assert.equal(fc.name, 'f')
  assert.equal(fc.arguments, '{"a":1}')

  assert.equal(r.output_text, '我查一下')
  assert.equal(r.usage.input_tokens, 10)
  assert.equal(r.usage.output_tokens, 5)
})

test('出站:思考内容进 reasoning 项', () => {
  const r = openaiResponseToResponses({
    choices: [{ finish_reason: 'stop', message: { content: '答', reasoning_content: '想' } }],
    usage: { completion_tokens_details: { reasoning_tokens: 7 } }
  }, 'm')
  const rs = r.output.find(o => o.type === 'reasoning')
  assert.equal(rs.summary[0].text, '想')
  assert.equal(r.usage.output_tokens_details.reasoning_tokens, 7)
})

test('出站:截断时 status 为 incomplete 并给出原因', () => {
  const r = openaiResponseToResponses({
    choices: [{ finish_reason: 'length', message: { content: '半句' } }], usage: {}
  }, 'm')
  assert.equal(r.status, 'incomplete')
  assert.deepEqual(r.incomplete_details, { reason: 'length' })
})

// ---------- 流式 ----------

const parse = sse => sse.split('\n\n').filter(Boolean).map(b => {
  const l = b.split('\n').find(x => x.startsWith('data: '))
  return l ? JSON.parse(l.slice(6)) : null
}).filter(Boolean)

test('流式:文本项 added → delta → done → completed 完整成对', () => {
  const enc = createResponsesEncoder('m')
  let out = ''
  out += enc.feed({ choices: [{ delta: { content: '你' } }] })
  out += enc.feed({ choices: [{ delta: { content: '好' } }] })
  out += enc.feed({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  out += enc.finish()

  const evs = parse(out)
  const types = evs.map(e => e.type)
  assert.equal(types[0], 'response.created')
  assert.ok(types.includes('response.output_item.added'))
  assert.ok(types.includes('response.output_text.delta'))
  assert.ok(types.includes('response.output_text.done'))
  assert.ok(types.includes('response.output_item.done'))
  assert.equal(types[types.length - 1], 'response.completed')

  const text = evs.filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join('')
  assert.equal(text, '你好')

  const done = evs[evs.length - 1].response
  assert.equal(done.status, 'completed')
  assert.equal(done.output_text, '你好')
  assert.equal(done.output.find(o => o.type === 'message').content[0].text, '你好')

  // 每个事件都要带 event: 行,SDK 靠它分发
  assert.ok(out.includes('event: response.output_text.delta'))
  // sequence_number 必须单调递增
  const seqs = evs.map(e => e.sequence_number)
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b))
})

test('流式:函数调用参数逐块给,收尾时 done 带完整参数', () => {
  const enc = createResponsesEncoder('m')
  let out = ''
  out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'f', arguments: '{"a"' } }] } }] })
  out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] })
  out += enc.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  out += enc.finish()

  const evs = parse(out)
  const added = evs.find(e => e.type === 'response.output_item.added')
  assert.equal(added.item.type, 'function_call')
  assert.equal(added.item.call_id, 'call_1')

  const args = evs.filter(e => e.type === 'response.function_call_arguments.delta').map(e => e.delta).join('')
  assert.equal(args, '{"a":1}')

  const argsDone = evs.find(e => e.type === 'response.function_call_arguments.done')
  assert.equal(argsDone.arguments, '{"a":1}')

  const final = evs[evs.length - 1].response
  assert.equal(final.output.find(o => o.type === 'function_call').arguments, '{"a":1}')
})

test('流式:文本与工具项的 output_index 不冲突', () => {
  const enc = createResponsesEncoder('m')
  let out = enc.feed({ choices: [{ delta: { content: 'hi' } }] })
  out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'f', arguments: '{}' } }] } }] })
  out += enc.finish()
  const added = parse(out).filter(e => e.type === 'response.output_item.added')
  assert.equal(added[0].output_index, 0)
  assert.equal(added[1].output_index, 1)
})
