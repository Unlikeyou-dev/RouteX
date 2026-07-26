import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const {
  geminiRequestToOpenAI, openaiResponseToGemini, createGeminiEncoder, geminiErrorBody
} = await import('../src/protocols/gemini-in.js')
const { buildGeminiPassthrough } = await import('../src/adapters.js')

// ---------- 入站请求 → 规范格式 ----------

test('入站:systemInstruction 提到 messages 最前面', () => {
  const o = geminiRequestToOpenAI({
    systemInstruction: { parts: [{ text: '你是助手' }] },
    contents: [{ role: 'user', parts: [{ text: '你好' }] }],
    generationConfig: { maxOutputTokens: 200, temperature: 0.4, topP: 0.8, stopSequences: ['END'] }
  }, 'gemini-2.5-pro')

  assert.equal(o.model, 'gemini-2.5-pro')
  assert.deepEqual(o.messages[0], { role: 'system', content: '你是助手' })
  assert.equal(o.messages[1].content, '你好')
  assert.equal(o.max_tokens, 200)
  assert.equal(o.temperature, 0.4)
  assert.equal(o.top_p, 0.8)
  assert.deepEqual(o.stop, ['END'])
})

test('入站:model 角色转 assistant,functionCall 转 tool_calls', () => {
  const o = geminiRequestToOpenAI({
    contents: [
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: '我查一下' }, { functionCall: { name: 'get_weather', args: { city: 'BJ' } } }] }
    ]
  }, 'm')
  const a = o.messages.find(m => m.role === 'assistant')
  assert.equal(a.content, '我查一下')
  assert.equal(a.tool_calls[0].function.name, 'get_weather')
  assert.equal(a.tool_calls[0].function.arguments, '{"city":"BJ"}')
  assert.ok(a.tool_calls[0].id, 'Gemini 没有调用 ID,必须自己造一个')
})

test('入站:functionResponse 按函数名配回同一个 tool_call_id', () => {
  const o = geminiRequestToOpenAI({
    contents: [
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ functionCall: { name: 'f', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'f', response: { ok: true } } }] }
    ]
  }, 'm')
  const call = o.messages.find(m => m.role === 'assistant').tool_calls[0]
  const result = o.messages.find(m => m.role === 'tool')
  assert.equal(result.tool_call_id, call.id, 'id 对不上的话上游会报工具结果无主')
  assert.equal(result.content, '{"ok":true}')
})

test('入站:同名函数多次调用要按顺序一一配对', () => {
  const o = geminiRequestToOpenAI({
    contents: [
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ functionCall: { name: 'f', args: { i: 1 } } }, { functionCall: { name: 'f', args: { i: 2 } } }] },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'f', response: { r: 1 } } },
          { functionResponse: { name: 'f', response: { r: 2 } } }
        ]
      }
    ]
  }, 'm')
  const calls = o.messages.find(m => m.role === 'assistant').tool_calls
  const results = o.messages.filter(m => m.role === 'tool')
  assert.equal(results.length, 2)
  assert.equal(results[0].tool_call_id, calls[0].id)
  assert.equal(results[1].tool_call_id, calls[1].id)
  assert.notEqual(calls[0].id, calls[1].id)
})

test('入站:inlineData 转 data URI', () => {
  const o = geminiRequestToOpenAI({
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAA' } }] }]
  }, 'm')
  assert.deepEqual(o.messages[0].content[0], {
    type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' }
  })
})

test('入站:functionDeclarations 与 functionCallingConfig 转换', () => {
  const o = geminiRequestToOpenAI({
    contents: [{ role: 'user', parts: [{ text: 'q' }] }],
    tools: [{ functionDeclarations: [{ name: 'f', description: 'd', parameters: { type: 'object' } }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY' } }
  }, 'm')
  assert.deepEqual(o.tools[0], {
    type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } }
  })
  assert.equal(o.tool_choice, 'required')
})

test('入站:thinkingBudget 与 JSON 模式', () => {
  const o = geminiRequestToOpenAI({
    contents: [{ role: 'user', parts: [{ text: 'q' }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 4096 }, responseMimeType: 'application/json' }
  }, 'm')
  assert.deepEqual(o.thinking, { type: 'enabled', budget_tokens: 4096 })
  assert.deepEqual(o.response_format, { type: 'json_object' })
})

// ---------- 规范格式 → 出站 Gemini ----------

test('出站:tool_calls → functionCall,finishReason 映射', () => {
  const g = openaiResponseToGemini({
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: '稍等',
        tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{"a":1}' } }]
      }
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  }, 'gemini-2.5-pro')

  const parts = g.candidates[0].content.parts
  assert.equal(g.candidates[0].content.role, 'model')
  assert.deepEqual(parts[0], { text: '稍等' })
  assert.deepEqual(parts[1], { functionCall: { name: 'f', args: { a: 1 } } })
  assert.equal(g.candidates[0].finishReason, 'STOP')
  assert.equal(g.usageMetadata.promptTokenCount, 10)
  assert.equal(g.modelVersion, 'gemini-2.5-pro')
})

test('出站:思考 token 要从 candidatesTokenCount 里拆出来', () => {
  const g = openaiResponseToGemini({
    choices: [{ finish_reason: 'stop', message: { content: 'x', reasoning_content: '想' } }],
    usage: {
      prompt_tokens: 10, completion_tokens: 20, total_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 7 }
    }
  }, 'm')
  assert.equal(g.usageMetadata.candidatesTokenCount, 13)
  assert.equal(g.usageMetadata.thoughtsTokenCount, 7)
  assert.ok(g.candidates[0].content.parts.some(p => p.thought))
})

test('出站:length → MAX_TOKENS,content_filter → SAFETY', () => {
  const mk = fr => openaiResponseToGemini(
    { choices: [{ finish_reason: fr, message: { content: 'x' } }], usage: {} }, 'm'
  ).candidates[0].finishReason
  assert.equal(mk('length'), 'MAX_TOKENS')
  assert.equal(mk('content_filter'), 'SAFETY')
})

// ---------- 流式 ----------

const chunks = sse =>
  sse.split('\n\n').filter(Boolean).map(b => JSON.parse(b.replace(/^data: /, '')))

test('流式:文本逐块给,functionCall 在结尾一次给全', () => {
  const enc = createGeminiEncoder('m')
  let out = ''
  out += enc.feed({ choices: [{ delta: { content: '你' } }] })
  out += enc.feed({ choices: [{ delta: { content: '好' } }] })
  out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'f', arguments: '{"a"' } }] } }] })
  out += enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] })
  out += enc.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  out += enc.feed({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })
  out += enc.finish()

  const cs = chunks(out)
  const text = cs.flatMap(c => c.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('')
  assert.equal(text, '你好')

  const last = cs[cs.length - 1]
  const fc = last.candidates[0].content.parts.find(p => p.functionCall)
  assert.ok(fc, '工具调用必须在结尾一次性给全')
  assert.deepEqual(fc.functionCall.args, { a: 1 })
  assert.equal(last.candidates[0].finishReason, 'STOP')
  assert.equal(last.usageMetadata.promptTokenCount, 5)
  // Gemini 的流式没有 event: 行
  assert.ok(!out.includes('event:'))
})

test('流式:思考增量带 thought 标记', () => {
  const enc = createGeminiEncoder('m')
  const out = enc.feed({ choices: [{ delta: { reasoning_content: '想…' } }] })
  const p = chunks(out)[0].candidates[0].content.parts[0]
  assert.equal(p.thought, true)
  assert.equal(p.text, '想…')
})

// ---------- 透传与错误 ----------

test('透传:换模型名并补上输出上限,其余原样', () => {
  const { url, headers, payload } = buildGeminiPassthrough(
    { type: 'gemini', base_url: '' }, 'sk-k',
    { contents: [{ role: 'user', parts: [{ text: 'q' }] }], safetySettings: [{ category: 'X' }] },
    'gemini-2.5-pro', false, 4096
  )
  assert.ok(url.endsWith('/v1beta/models/gemini-2.5-pro:generateContent'))
  assert.equal(headers['x-goog-api-key'], 'sk-k')
  assert.equal(payload.generationConfig.maxOutputTokens, 4096)
  assert.deepEqual(payload.safetySettings, [{ category: 'X' }], '不认识的字段也要原样过去')
})

test('透传:流式走 streamGenerateContent 且带 alt=sse', () => {
  const { url } = buildGeminiPassthrough(
    { type: 'gemini', base_url: '' }, 'k', { contents: [] }, 'm', true, 100
  )
  assert.ok(url.includes(':streamGenerateContent'))
  assert.ok(url.includes('alt=sse'))
})

test('透传:客户端自己给了 maxOutputTokens 就不覆盖', () => {
  const { payload } = buildGeminiPassthrough(
    { type: 'gemini', base_url: '' }, 'k',
    { contents: [], generationConfig: { maxOutputTokens: 999 } }, 'm', false, 4096
  )
  assert.equal(payload.generationConfig.maxOutputTokens, 999)
})

test('错误体:Gemini 风格结构', () => {
  assert.deepEqual(geminiErrorBody(429, '太快了'), {
    error: { code: 429, message: '太快了', status: 'RESOURCE_EXHAUSTED' }
  })
  assert.equal(geminiErrorBody(404, 'x').error.status, 'NOT_FOUND')
})
