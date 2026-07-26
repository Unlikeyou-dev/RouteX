import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const { toGeminiSchema, toAnthropicSchema, inlineRefs } = await import('../src/schema.js')
const { buildUpstreamRequest } = await import('../src/adapters.js')
const { anthropicRequestToOpenAI } = await import('../src/protocols/anthropic-in.js')
const { geminiRequestToOpenAI } = await import('../src/protocols/gemini-in.js')

const ch = type => ({ type, base_url: 'https://up.test' })
const build = (type, body, model) => buildUpstreamRequest(ch(type), 'k', '/chat/completions', body, model, false).payload
// 自动缓存会把 system 变成块数组,断言前统一取回文本
const sysText = s => (typeof s === 'string' ? s : (s || []).map(b => b.text || '').join(''))

// pydantic 有嵌套模型就一定长这样
const REF_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  $defs: { Addr: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
  properties: { name: { type: 'string' }, addr: { $ref: '#/$defs/Addr' } },
  required: ['name', 'addr'],
  additionalProperties: false
}

// ---------- schema 净化 ----------

test('$ref 就地展开,$defs 摘掉', () => {
  const s = inlineRefs(REF_SCHEMA)
  assert.equal(s.$defs, undefined)
  assert.deepEqual(s.properties.addr, { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] })
  assert.ok(!JSON.stringify(s).includes('$ref'), '留着 $ref 两家都会报错')
})

test('解析不了的 $ref 退化成自由对象,而不是原样发出去', () => {
  const s = inlineRefs({ type: 'object', properties: { x: { $ref: 'https://other/schema.json' } } })
  assert.deepEqual(s.properties.x, { type: 'object' })
})

test('递归 schema 不会把展开卡死', () => {
  const node = { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } }
  const s = inlineRefs({ $defs: { Node: node }, ...node })
  assert.ok(JSON.stringify(s).length < 100000)
})

test('Gemini schema:白名单外的关键字全丢掉', () => {
  const s = toGeminiSchema({
    type: 'object', title: 'X', additionalProperties: false, default: {},
    properties: { a: { type: 'string', pattern: '^x' } }
  })
  assert.equal(s.title, undefined)
  assert.equal(s.additionalProperties, undefined)
  assert.equal(s.default, undefined)
  assert.equal(s.properties.a.pattern, undefined)
  assert.equal(s.properties.a.type, 'string')
})

test('Gemini schema:const 换成单值 enum,联合 type 拆成 nullable', () => {
  const s = toGeminiSchema({
    type: 'object',
    properties: { kind: { const: 'user' }, note: { type: ['string', 'null'] } }
  })
  assert.deepEqual(s.properties.kind.enum, ['user'])
  assert.equal(s.properties.note.type, 'string')
  assert.equal(s.properties.note.nullable, true)
})

test('Anthropic schema:丢掉官方明确不支持的约束,保住 additionalProperties:false', () => {
  const s = toAnthropicSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      age: { type: 'integer', minimum: 0, maximum: 200 },
      name: { type: 'string', minLength: 1, maxLength: 40 },
      tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 }
    },
    required: ['age']
  })
  assert.equal(s.additionalProperties, false)
  assert.deepEqual(s.required, ['age'])
  assert.equal(s.properties.age.minimum, undefined)
  assert.equal(s.properties.name.maxLength, undefined)
  assert.equal(s.properties.tags.minItems, 1, 'minItems 为 0/1 时是允许的')
  assert.equal(s.properties.tags.maxItems, undefined)
  assert.equal(s.properties.tags.items.type, 'string')
})

test('Anthropic schema:additionalProperties 只有 false 才留', () => {
  const s = toAnthropicSchema({ type: 'object', additionalProperties: true })
  assert.equal(s.additionalProperties, undefined)
})

// ---------- 出站 ----------

test('Anthropic 出站:json_schema 走 output_config.format', () => {
  const p = build('anthropic', {
    messages: [{ role: 'user', content: 'q' }],
    response_format: { type: 'json_schema', json_schema: { name: 'u', schema: REF_SCHEMA } }
  }, 'claude-opus-5')
  assert.equal(p.output_config.format.type, 'json_schema')
  assert.equal(p.output_config.format.schema.properties.addr.properties.city.type, 'string')
  assert.equal(p.output_config.format.schema.$defs, undefined)
})

test('Anthropic 出站:思考档位与结构化输出共存于同一个 output_config', () => {
  const p = build('anthropic', {
    messages: [{ role: 'user', content: 'q' }],
    reasoning_effort: 'high',
    response_format: { type: 'json_schema', json_schema: { schema: { type: 'object' } } }
  }, 'claude-opus-5')
  assert.equal(p.output_config.effort, 'high', '结构化输出不能把思考档位挤掉')
  assert.equal(p.output_config.format.type, 'json_schema')
  assert.equal(p.thinking.type, 'adaptive')
})

test('Anthropic 出站:老模型不认 output_config.format,退回写进 system', () => {
  const p = build('anthropic', {
    messages: [{ role: 'user', content: 'q' }],
    response_format: { type: 'json_schema', json_schema: { schema: { type: 'object', properties: { a: { type: 'string' } } } } }
  }, 'claude-3-5-sonnet-20241022')
  assert.equal(p.output_config, undefined)
  assert.ok(sysText(p.system).includes('JSON Schema'), '既不支持又不兜底就等于静默丢弃')
  assert.ok(sysText(p.system).includes('"a"'))
})

test('Anthropic 出站:json_object 没有 schema 可给,也走 system 兜底', () => {
  const p = build('anthropic', {
    messages: [{ role: 'system', content: '你是助手' }, { role: 'user', content: 'q' }],
    response_format: { type: 'json_object' }
  }, 'claude-opus-5')
  assert.equal(p.output_config, undefined)
  assert.ok(sysText(p.system).startsWith('你是助手'), '原有 system 要保住')
  assert.ok(sysText(p.system).includes('合法的 JSON'))
})

test('Anthropic 出站:没要结构化输出时不凭空多出 output_config', () => {
  const p = build('anthropic', { messages: [{ role: 'user', content: 'q' }] }, 'claude-opus-5')
  assert.equal(p.output_config, undefined)
})

test('Gemini 出站:json_schema 走 responseSchema,并按 OpenAPI 子集裁剪', () => {
  const p = build('gemini', {
    messages: [{ role: 'user', content: 'q' }],
    response_format: { type: 'json_schema', json_schema: { schema: REF_SCHEMA } }
  }, 'gemini-2.5-pro')
  assert.equal(p.generationConfig.responseMimeType, 'application/json')
  assert.equal(p.generationConfig.responseSchema.additionalProperties, undefined)
  assert.equal(p.generationConfig.responseSchema.properties.addr.properties.city.type, 'string')
})

test('Gemini 出站:json_object 仍然只设 mime type', () => {
  const p = build('gemini', {
    messages: [{ role: 'user', content: 'q' }], response_format: { type: 'json_object' }
  }, 'gemini-2.5-pro')
  assert.equal(p.generationConfig.responseMimeType, 'application/json')
  assert.equal(p.generationConfig.responseSchema, undefined)
})

test('Gemini 出站:工具参数里的 $ref 也要展开', () => {
  const p = build('gemini', {
    messages: [{ role: 'user', content: 'q' }],
    tools: [{ type: 'function', function: { name: 'f', parameters: REF_SCHEMA } }]
  }, 'gemini-2.5-pro')
  const params = p.tools[0].functionDeclarations[0].parameters
  assert.ok(!JSON.stringify(params).includes('$ref'))
  assert.equal(params.properties.addr.properties.city.type, 'string')
})

// ---------- 入站 ----------

test('Anthropic 入站:output_config.format 转成规范格式的 response_format', () => {
  const o = anthropicRequestToOpenAI({
    model: 'm', messages: [{ role: 'user', content: 'q' }],
    output_config: { effort: 'high', format: { type: 'json_schema', schema: { type: 'object' } } }
  })
  assert.equal(o.response_format.type, 'json_schema')
  assert.deepEqual(o.response_format.json_schema.schema, { type: 'object' })
  assert.equal(o.reasoning_effort, 'high')
})

test('Gemini 入站:responseSchema 要保住 schema,不能只翻成 json_object', () => {
  const o = geminiRequestToOpenAI({
    contents: [{ role: 'user', parts: [{ text: 'q' }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { a: { type: 'string' } } }
    }
  }, 'm')
  assert.equal(o.response_format.type, 'json_schema')
  assert.equal(o.response_format.json_schema.schema.properties.a.type, 'string')
})

test('Gemini 入站:只有 mime type 时仍是 json_object', () => {
  const o = geminiRequestToOpenAI({
    contents: [{ role: 'user', parts: [{ text: 'q' }] }],
    generationConfig: { responseMimeType: 'application/json' }
  }, 'm')
  assert.deepEqual(o.response_format, { type: 'json_object' })
})

test('OpenAI 渠道:response_format 原样转发', () => {
  const rf = { type: 'json_schema', json_schema: { name: 'u', schema: REF_SCHEMA } }
  const p = build('openai', { messages: [{ role: 'user', content: 'q' }], response_format: rf }, 'gpt-x')
  assert.deepEqual(p.response_format, rf, 'OpenAI 上游本来就认这套,不该被我们裁剪')
})
