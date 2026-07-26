// JSON Schema 净化。
//
// 客户端发来的 schema 基本都是 OpenAI 那套(pydantic / zod 生成),而
// Anthropic 和 Gemini 各自只认其中一个子集,多传的关键字**直接 400**,
// 于是同一份 schema 必须按目标协议裁剪两次。
//
// 最坑的是 $ref:pydantic 只要有嵌套模型就会生成 $defs + "$ref":"#/$defs/X",
// 而两家都不接受这种引用。不展开的话,用户拿到的 schema 里那一层永远是空的 ——
// 报不出错,只是结果悄悄少了字段,比直接 400 还难查。所以这里先就地展开。

const MAX_DEPTH = 12 // 递归 schema 展不完,到这个深度就退化成自由对象

function resolveRef(ref, roots) {
  // 只处理文档内引用(#/$defs/X、#/definitions/X);外部 $ref 两家都不支持
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  for (const root of roots) {
    let cur = root
    for (const p of parts) {
      cur = cur?.[decodeURIComponent(p.replace(/~1/g, '/').replace(/~0/g, '~'))]
      if (cur === undefined) break
    }
    if (cur && typeof cur === 'object') return cur
  }
  return null
}

// 展开本地 $ref,顺带把 $defs / definitions 摘掉
export function inlineRefs(schema, root = schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(s => inlineRefs(s, root, depth + 1))

  if (schema.$ref) {
    if (depth >= MAX_DEPTH) return { type: 'object' }
    const target = resolveRef(schema.$ref, [root, schema])
    if (!target) {
      // 引用解析不了,与其发一个必然 400 的 $ref 出去,不如退化成自由对象
      return { type: 'object' }
    }
    const { $ref, ...rest } = schema
    return inlineRefs({ ...target, ...rest }, root, depth + 1)
  }

  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$defs' || k === 'definitions') continue
    out[k] = inlineRefs(v, root, depth + 1)
  }
  return out
}

// Gemini 的 responseSchema / functionDeclarations.parameters 是 OpenAPI 3.0 子集,
// 用白名单更稳:不在表里的一律丢掉,以后 schema 里冒出新关键字也不会把请求打挂。
const GEMINI_KEYS = new Set([
  'type', 'format', 'description', 'nullable', 'enum', 'maxItems', 'minItems',
  'properties', 'required', 'items', 'anyOf', 'propertyOrdering', 'minimum', 'maximum'
])

export function toGeminiSchema(schema) {
  return strip(inlineRefs(schema))

  function strip(s) {
    if (!s || typeof s !== 'object') return s
    if (Array.isArray(s)) return s.map(strip)
    const out = {}
    for (const [k, v] of Object.entries(s)) {
      // const 语义等价于单值 enum,换个写法就能保住约束
      if (k === 'const') {
        out.enum = [v]
        if (!out.type && typeof v === 'string') out.type = 'string'
        continue
      }
      if (!GEMINI_KEYS.has(k)) continue
      if (k === 'properties') {
        out.properties = Object.fromEntries(Object.entries(v || {}).map(([n, p]) => [n, strip(p)]))
      } else if (k === 'type' && Array.isArray(v)) {
        // ["string","null"] 这种联合写法 Gemini 不认,拆成 type + nullable
        const real = v.find(t => t !== 'null')
        out.type = real || 'string'
        if (v.includes('null')) out.nullable = true
      } else {
        out[k] = strip(v)
      }
    }
    return out
  }
}

// Anthropic 的结构化输出接受标准 JSON Schema,但明确不支持这些约束,
// 带着就是 400(官方文档「Unsupported JSON Schema features」一节)。
const ANTHROPIC_DROP = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'maxItems', 'uniqueItems',
  '$schema', 'default', 'examples'
])

export function toAnthropicSchema(schema) {
  return strip(inlineRefs(schema))

  function strip(s) {
    if (!s || typeof s !== 'object') return s
    if (Array.isArray(s)) return s.map(strip)
    const out = {}
    for (const [k, v] of Object.entries(s)) {
      if (ANTHROPIC_DROP.has(k)) continue
      // minItems 只接受 0 或 1
      if (k === 'minItems') {
        if (v === 0 || v === 1) out.minItems = v
        continue
      }
      // additionalProperties 只接受 false
      if (k === 'additionalProperties') {
        if (v === false) out.additionalProperties = false
        continue
      }
      if (k === 'properties') {
        out.properties = Object.fromEntries(Object.entries(v || {}).map(([n, p]) => [n, strip(p)]))
      } else {
        out[k] = strip(v)
      }
    }
    return out
  }
}

// 上游不支持结构化输出时的兜底:把要求写进 system。
// 不保证一定合法,但比「用户要 JSON、我们给一段散文」强得多。
export function schemaInstruction(format) {
  if (!format) return ''
  if (format.type === 'json_object') {
    return '你必须只输出一个合法的 JSON 对象,不要输出任何解释文字或 Markdown 代码块标记。'
  }
  const schema = format.json_schema?.schema || format.schema
  if (!schema) return ''
  return '你必须只输出一个合法的 JSON 对象,不要输出任何解释文字或 Markdown 代码块标记。'
    + '输出必须严格符合以下 JSON Schema:\n'
    + JSON.stringify(inlineRefs(schema))
}
