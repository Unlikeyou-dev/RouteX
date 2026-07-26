// 上游协议适配器:对外统一 OpenAI 格式,对内按渠道类型转换
// type = 'openai' | 'anthropic' | 'gemini'
//
// 这里的重点是 **function calling 全链路**。agent 的每一步都建立在工具调用上:
// 请求里的 tools、assistant 回复里的 tool_calls、role:'tool' 的执行结果,
// 三者缺一不可。任何一环丢失,agent 就会在原地打转或直接崩掉。
import { channelBaseUrl } from './util.js'
import {
  supportsSampling, supportsThinkingBudget, supportsAdaptiveThinking, normalizeEffort
} from './model-caps.js'
import { getSetting } from './db.js'

const autoCacheEnabled = () => getSetting('anthropic_auto_cache', '1') === '1'

// ---- 通用小工具 ----

const genId = prefix => `${prefix}_${Math.random().toString(36).slice(2, 12)}`

// "data:image/png;base64,iVBOR..." → { mediaType, data }
function parseDataUri(url) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ''))
  return m ? { mediaType: m[1], data: m[2] } : null
}

// OpenAI 的 content 既可能是字符串,也可能是 [{type:'text'|'image_url', ...}]
function contentParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return content == null ? [] : [{ type: 'text', text: String(content) }]
  return content
}

function partsToText(content) {
  return contentParts(content)
    .filter(p => p?.type === 'text' || typeof p?.text === 'string')
    .map(p => p.text || '')
    .join('')
}

// ---- 用量归一化 ----
// 三家对「缓存命中的输入 token」统计口径不同,直接拿来计费必然算错:
//   OpenAI     prompt_tokens 里**已包含** cached_tokens
//   Anthropic  input_tokens **不含** cache_creation / cache_read,是三个独立的数
//   Gemini     promptTokenCount 里**已包含** cachedContentTokenCount
// 统一按 OpenAI 口径输出:prompt_tokens = 全部输入(含缓存),
// 缓存部分放在 prompt_tokens_details 里,由计费层拆出来按折扣价单独算。
function usageOf({ prompt, completion, cacheRead = 0, cacheWrite = 0, reasoning = 0 }) {
  const u = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion
  }
  if (cacheRead || cacheWrite) {
    u.prompt_tokens_details = { cached_tokens: cacheRead }
    if (cacheWrite) u.cache_creation_tokens = cacheWrite
  }
  if (reasoning) u.completion_tokens_details = { reasoning_tokens: reasoning }
  return u
}

export function anthropicUsage(raw = {}) {
  const cacheRead = raw.cache_read_input_tokens ?? 0
  const cacheWrite = raw.cache_creation_input_tokens ?? 0
  return usageOf({
    // Anthropic 的 input_tokens 不含缓存,要自己加回去才是「总输入」
    prompt: (raw.input_tokens ?? 0) + cacheRead + cacheWrite,
    completion: raw.output_tokens ?? 0,
    cacheRead,
    cacheWrite
  })
}

function geminiUsage(um = {}) {
  return usageOf({
    prompt: um.promptTokenCount ?? 0,
    completion: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
    cacheRead: um.cachedContentTokenCount ?? 0,
    reasoning: um.thoughtsTokenCount ?? 0
  })
}

// 工具参数在 OpenAI 里是 JSON 字符串,在 Anthropic/Gemini 里是对象
function parseArgs(raw) {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    // 上游偶尔会吐出不合法的 JSON,原样塞进去比整个请求失败要好
    return { _raw: String(raw) }
  }
}

// ---- 推理 / 思考链 ----
// OpenAI 用 reasoning_effort(low/medium/high)控制思考深度,
// Anthropic 用 thinking.budget_tokens,Gemini 用 thinkingConfig.thinkingBudget。
// 统一以 reasoning_effort 为入口换算成预算,让 agent 不用为每家写一套参数。
const EFFORT_BUDGET = { low: 1024, medium: 4096, high: 16384, xhigh: 32768, max: 32768 }

// 用户是否要求思考
export function wantsThinking(body) {
  if (body?.thinking?.type === 'disabled') return false
  const explicit = Number(body?.thinking?.budget_tokens ?? body?.reasoning?.max_tokens)
  if (Number.isFinite(explicit) && explicit > 0) return true
  return !!(body?.reasoning_effort || body?.thinking?.type)
}

// 旧模型(4.6 及更早)才用的固定预算
function thinkingBudget(body) {
  const explicit = Number(body.thinking?.budget_tokens ?? body.reasoning?.max_tokens)
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(1024, explicit)
  const effort = String(body.reasoning_effort || '').toLowerCase()
  return EFFORT_BUDGET[effort] || 0
}

// 组装思考配置。这里是本适配器最容易踩雷的地方:
//   · Opus 4.7 及更新的模型**移除**了 thinking.budget_tokens,传了直接 400,
//     必须改用 thinking:{type:'adaptive'} + output_config:{effort}
//   · 这些模型的 thinking.display 默认是 'omitted',不显式要 summarized
//     就只能拿到空的思考内容
//   · 4.6 及更早只认 budget_tokens,且 budget 必须小于 max_tokens
function thinkingConfig(body, upstreamModel, maxTokens) {
  if (!wantsThinking(body)) return { extra: {}, maxTokens }

  if (supportsAdaptiveThinking(upstreamModel) && !supportsThinkingBudget(upstreamModel)) {
    const effort = normalizeEffort(upstreamModel, body.reasoning_effort)
    return {
      extra: {
        thinking: { type: 'adaptive', display: 'summarized' },
        ...(effort ? { output_config: { effort } } : {})
      },
      maxTokens
    }
  }

  const budget = thinkingBudget(body)
  if (budget <= 0) return { extra: {}, maxTokens }
  return {
    // 预算必须严格小于 max_tokens,否则上游 400
    extra: { thinking: { type: 'enabled', budget_tokens: budget } },
    maxTokens: Math.max(maxTokens, budget + 1024)
  }
}

// tool_call_id → 函数名。Gemini 的 functionResponse 认名字不认 id,
// 所以要先把 assistant 消息里的映射关系收集出来。
function toolCallNameMap(messages) {
  const map = new Map()
  for (const m of messages || []) {
    for (const tc of m?.tool_calls || []) {
      if (tc?.id) map.set(tc.id, tc.function?.name || '')
    }
  }
  return map
}

// ================= 请求侧:Anthropic =================

function toolsToAnthropic(tools) {
  const list = (tools || [])
    .filter(t => t?.type === 'function' && t.function?.name)
    .map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters || { type: 'object', properties: {} }
    }))
  return list.length ? list : undefined
}

function toolChoiceToAnthropic(choice) {
  if (!choice || choice === 'auto') return undefined
  if (choice === 'none') return undefined            // 由调用方一并去掉 tools
  if (choice === 'required') return { type: 'any' }
  if (typeof choice === 'object' && choice.function?.name) {
    return { type: 'tool', name: choice.function.name }
  }
  return undefined
}

function contentToAnthropicBlocks(content) {
  const blocks = []
  for (const p of contentParts(content)) {
    if (p?.type === 'image_url' || p?.image_url) {
      const url = p.image_url?.url || p.url
      const data = parseDataUri(url)
      if (data) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: data.mediaType, data: data.data } })
      } else if (url) {
        // Anthropic 支持直接给图片 URL
        blocks.push({ type: 'image', source: { type: 'url', url } })
      }
      continue
    }
    const text = p?.text ?? (typeof p === 'string' ? p : '')
    if (text) blocks.push({ type: 'text', text })
  }
  return blocks
}

function messagesToAnthropic(body) {
  const system = []
  const messages = []

  const pushUser = blocks => {
    if (!blocks.length) return
    const last = messages[messages.length - 1]
    // 连续的 user 块要合并 —— Anthropic 要求 user/assistant 严格交替,
    // 而多个工具结果在 OpenAI 里是多条独立的 tool 消息
    if (last && last.role === 'user') last.content.push(...blocks)
    else messages.push({ role: 'user', content: blocks })
  }

  for (const m of body.messages || []) {
    if (m.role === 'system') {
      system.push(partsToText(m.content))
      continue
    }

    if (m.role === 'tool') {
      pushUser([{
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
      }])
      continue
    }

    if (m.role === 'assistant') {
      const blocks = []
      // 思考块必须原样回传,且必须排在最前面。
      // Anthropic 的规则:启用思考时,带 tool_use 的那条 assistant 消息
      // **必须以 thinking 块开头**,且块内容(含 signature)不能被修改 ——
      // 否则第二轮就会 400。signature 无法伪造,所以只能靠客户端把
      // 我们在响应里给出的 thinking_blocks 原样带回来。
      for (const tb of m.thinking_blocks || []) {
        if (tb?.type === 'thinking' && tb.signature) {
          blocks.push({ type: 'thinking', thinking: tb.thinking || '', signature: tb.signature })
        } else if (tb?.type === 'redacted_thinking' && tb.data) {
          blocks.push({ type: 'redacted_thinking', data: tb.data })
        }
      }
      blocks.push(...contentToAnthropicBlocks(m.content))
      for (const tc of m.tool_calls || []) {
        blocks.push({
          type: 'tool_use',
          id: tc.id || genId('toolu'),
          name: tc.function?.name || '',
          input: parseArgs(tc.function?.arguments)
        })
      }
      if (blocks.length) messages.push({ role: 'assistant', content: blocks })
      continue
    }

    pushUser(contentToAnthropicBlocks(m.content))
  }

  // Anthropic 要求以 user 开头
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: ' ' }] })
  }
  return { system: system.join('\n') || undefined, messages }
}

// ---- 自动注入缓存断点 ----
// Anthropic 的 prompt cache 必须显式打 cache_control 标记,而 OpenAI 协议里
// 根本没有这个字段 —— 不主动注入的话,原生 Anthropic 渠道的缓存永远不会命中,
// 我们的缓存折扣也就形同虚设。
//
// 注入是安全的:低于模型最小可缓存长度的断点会被上游**静默忽略**,
// 既不报错也不产生缓存写入费用。
//
// 渲染顺序是 tools → system → messages,断点打在「稳定前缀」与「易变尾部」的
// 交界处。最多允许 4 个,这里用 3 个:
//   1. 最后一个工具定义 —— 缓存整个 tools
//   2. 最后一个 system 块 —— 连带缓存 tools + system
//   3. 倒数第二条消息的末尾 —— 缓存除最后一轮外的全部对话
const CACHE_MARK = { type: 'ephemeral' }

function withAnthropicCache({ system, messages, tools }) {
  if (!autoCacheEnabled()) {
    return { system, messages, tools }
  }

  let outTools = tools
  if (tools?.length) {
    outTools = tools.map((t, i) =>
      i === tools.length - 1 ? { ...t, cache_control: CACHE_MARK } : t
    )
  }

  // system 要用块数组形式才能挂 cache_control
  let outSystem = system
  if (system) {
    outSystem = [{ type: 'text', text: system, cache_control: CACHE_MARK }]
  }

  let outMessages = messages
  if (messages.length >= 2) {
    const idx = messages.length - 2
    const target = messages[idx]
    const blocks = target.content
    const last = blocks[blocks.length - 1]
    // thinking 块不允许挂 cache_control
    if (last && last.type !== 'thinking' && last.type !== 'redacted_thinking') {
      outMessages = messages.map((m, i) =>
        i === idx
          ? { ...m, content: blocks.map((b, j) => (j === blocks.length - 1 ? { ...b, cache_control: CACHE_MARK } : b)) }
          : m
      )
    }
  }

  return { system: outSystem, messages: outMessages, tools: outTools }
}

// ================= 请求侧:Gemini =================

// Gemini 的 schema 不认 OpenAI JSON Schema 的部分关键字,先剔掉避免 400
function cleanSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(cleanSchema)
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (['additionalProperties', '$schema', 'default', 'examples', 'title'].includes(k)) continue
    out[k] = cleanSchema(v)
  }
  return out
}

function toolsToGemini(tools) {
  const decls = (tools || [])
    .filter(t => t?.type === 'function' && t.function?.name)
    .map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      parameters: cleanSchema(t.function.parameters) || { type: 'object', properties: {} }
    }))
  return decls.length ? [{ functionDeclarations: decls }] : undefined
}

function toolChoiceToGemini(choice) {
  if (!choice || choice === 'auto') return undefined
  if (choice === 'none') return { functionCallingConfig: { mode: 'NONE' } }
  if (choice === 'required') return { functionCallingConfig: { mode: 'ANY' } }
  if (typeof choice === 'object' && choice.function?.name) {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.function.name] } }
  }
  return undefined
}

function contentToGeminiParts(content) {
  const parts = []
  for (const p of contentParts(content)) {
    if (p?.type === 'image_url' || p?.image_url) {
      const url = p.image_url?.url || p.url
      const data = parseDataUri(url)
      // Gemini 只接受内联的 base64 或它自家 File API 的 URI,
      // 普通 http 图片地址没法直接用,只能跳过(agent 基本都传 data URI)
      if (data) parts.push({ inlineData: { mimeType: data.mediaType, data: data.data } })
      continue
    }
    const text = p?.text ?? (typeof p === 'string' ? p : '')
    if (text) parts.push({ text })
  }
  return parts
}

function messagesToGemini(body) {
  const system = []
  const contents = []
  const nameOf = toolCallNameMap(body.messages)

  const push = (role, parts) => {
    if (!parts.length) return
    const last = contents[contents.length - 1]
    if (last && last.role === role) last.parts.push(...parts)
    else contents.push({ role, parts })
  }

  for (const m of body.messages || []) {
    if (m.role === 'system') {
      system.push(partsToText(m.content))
      continue
    }

    if (m.role === 'tool') {
      let response
      try {
        response = typeof m.content === 'string' ? JSON.parse(m.content) : (m.content ?? {})
      } catch {
        response = { result: String(m.content ?? '') }
      }
      // Gemini 要求 response 是对象
      if (response === null || typeof response !== 'object' || Array.isArray(response)) {
        response = { result: response }
      }
      push('user', [{
        functionResponse: { name: nameOf.get(m.tool_call_id) || m.name || 'function', response }
      }])
      continue
    }

    if (m.role === 'assistant') {
      const parts = contentToGeminiParts(m.content)
      for (const tc of m.tool_calls || []) {
        parts.push({ functionCall: { name: tc.function?.name || '', args: parseArgs(tc.function?.arguments) } })
      }
      push('model', parts)
      continue
    }

    push('user', contentToGeminiParts(m.content))
  }

  if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: ' ' }] })
  return {
    systemInstruction: system.length ? { parts: [{ text: system.join('\n') }] } : undefined,
    contents,
    toolConfig: toolChoiceToGemini(body.tool_choice)
  }
}

// ================= Anthropic 原样透传 =================
// 入站是 Anthropic、上游渠道也是 Anthropic 时,不做任何格式转换。
// 只做三件必要的事:换模型名、按模型世代裁剪会导致 400 的参数、补缓存断点。
// 客户端已经写好的 cache_control / thinking signature / beta 字段全部原样过去。
export function buildAnthropicPassthrough(channel, apiKey, body, upstreamModel, isStream) {
  const payload = { ...body, model: upstreamModel, stream: !!isStream }

  if (!supportsSampling(upstreamModel)) {
    delete payload.temperature
    delete payload.top_p
    delete payload.top_k
  }

  // 客户端可能按老模型写法发了 budget_tokens,在新模型上会 400 —— 就地改写
  if (payload.thinking?.type === 'enabled' && !supportsThinkingBudget(upstreamModel)) {
    const budget = Number(payload.thinking.budget_tokens) || 0
    payload.thinking = { type: 'adaptive', display: payload.thinking.display || 'summarized' }
    if (!payload.output_config && budget > 0) {
      payload.output_config = { effort: budget >= 16384 ? 'high' : budget >= 4096 ? 'medium' : 'low' }
    }
  } else if (payload.thinking?.type === 'adaptive' && supportsThinkingBudget(upstreamModel)) {
    // 反过来:老模型不认 adaptive
    payload.thinking = { type: 'enabled', budget_tokens: 4096 }
    payload.max_tokens = Math.max(Number(payload.max_tokens) || 4096, 5120)
    delete payload.output_config
  }

  // 客户端自己打过断点就别插手,否则可能超出上游 4 个的上限
  const hasCache = JSON.stringify(body).includes('"cache_control"')
  if (!hasCache) {
    const cached = withAnthropicCache({
      system: typeof payload.system === 'string' ? payload.system : undefined,
      messages: normalizedForCache(payload.messages),
      tools: payload.tools
    })
    if (cached.tools) payload.tools = cached.tools
    if (cached.system) payload.system = cached.system
    if (cached.messages) payload.messages = cached.messages
  }

  return {
    url: `${channelBaseUrl(channel)}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload
  }
}

// Gemini 透传:结构本身不用动,只换模型名并补上输出上限(预扣费需要真上界)
export function buildGeminiPassthrough(channel, apiKey, body, upstreamModel, isStream, outputCap) {
  const payload = { ...body }
  const gc = { ...(payload.generationConfig || payload.generation_config || {}) }
  if (!gc.maxOutputTokens && outputCap > 0) gc.maxOutputTokens = outputCap
  payload.generationConfig = gc
  delete payload.generation_config

  const method = isStream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  return {
    url: `${channelBaseUrl(channel)}/v1beta/models/${upstreamModel}:${method}`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    payload
  }
}

// 透传时消息内容可能是字符串,缓存断点只能挂在块上 —— 统一成块数组
function normalizedForCache(messages) {
  return (messages || []).map(m => ({
    ...m,
    content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
  }))
}

// ================= 构造上游请求 =================

export function buildUpstreamRequest(channel, apiKey, path, body, upstreamModel, isStream) {
  const base = channelBaseUrl(channel)

  if (channel.type === 'anthropic') {
    const { system, messages } = messagesToAnthropic(body)
    const noTools = body.tool_choice === 'none'
    const tools = noTools ? undefined : toolsToAnthropic(body.tools)
    const think = thinkingConfig(
      body, upstreamModel, body.max_tokens || body.max_completion_tokens || 4096
    )
    // 采样参数在 Opus 4.7 及更新的模型上被移除,传了就是 400 —— 按模型世代裁剪。
    // 绝大多数 OpenAI 客户端都会默认带 temperature,这一步不做整条链路都不通。
    const sampling = supportsSampling(upstreamModel)
    const cached = withAnthropicCache({ system, messages, tools })

    return {
      url: `${base}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: {
        model: upstreamModel,
        max_tokens: think.maxTokens,
        ...(cached.system ? { system: cached.system } : {}),
        messages: cached.messages,
        ...think.extra,
        ...(cached.tools ? { tools: cached.tools } : {}),
        ...(cached.tools && toolChoiceToAnthropic(body.tool_choice)
          ? { tool_choice: toolChoiceToAnthropic(body.tool_choice) }
          : {}),
        ...(sampling && body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(sampling && body.top_p !== undefined ? { top_p: body.top_p } : {}),
        ...(body.stop ? { stop_sequences: Array.isArray(body.stop) ? body.stop : [body.stop] } : {}),
        stream: !!isStream
      }
    }
  }

  if (channel.type === 'gemini') {
    const { systemInstruction, contents, toolConfig } = messagesToGemini(body)
    const tools = body.tool_choice === 'none' ? undefined : toolsToGemini(body.tools)
    const method = isStream ? 'streamGenerateContent?alt=sse' : 'generateContent'
    return {
      url: `${base}/v1beta/models/${upstreamModel}:${method}`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      payload: {
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
        ...(tools ? { tools } : {}),
        ...(tools && toolConfig ? { toolConfig } : {}),
        generationConfig: {
          ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
          ...(body.top_p !== undefined ? { topP: body.top_p } : {}),
          ...(body.max_tokens ? { maxOutputTokens: body.max_tokens } : {}),
          // JSON 模式:agent 拿结构化结果时会用
          ...(body.response_format?.type === 'json_object' ? { responseMimeType: 'application/json' } : {}),
          ...(thinkingBudget(body) > 0
            ? { thinkingConfig: { thinkingBudget: thinkingBudget(body), includeThoughts: true } }
            : {})
        }
      }
    }
  }

  // OpenAI 兼容:原样转发(tools 等字段本来就是这个格式)
  const payload = { ...body, model: upstreamModel }
  if (isStream) payload.stream_options = { ...(body.stream_options || {}), include_usage: true }
  return {
    url: `${base}/v1${path}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    payload
  }
}

// ================= 响应侧(非流式) =================

const finishMap = {
  end_turn: 'stop', max_tokens: 'length', stop_sequence: 'stop', tool_use: 'tool_calls',
  // 新模型的安全分类器会以 HTTP 200 + refusal 返回,content 可能是空的。
  // 不映射的话用户会拿到一个「成功但什么都没有」的响应,完全不知道发生了什么。
  refusal: 'content_filter',
  STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter', BLOCKLIST: 'content_filter'
}

// 上游拒答时给一句能看懂的话,别让用户对着空响应发呆
const REFUSAL_TEXT = '上游模型基于安全策略拒绝了本次请求。'

export function convertResponse(channel, model, data) {
  if (channel.type === 'anthropic') {
    const blocks = data.content || []
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
    // 思考过程给两份:
    //   reasoning_content —— 纯文本,供展示,客户端最普遍认的字段
    //   thinking_blocks   —— 原始块(含 signature),供多轮回传;丢了下一轮就 400
    const reasoning = blocks.filter(b => b.type === 'thinking').map(b => b.thinking || '').join('')
    const thinkingBlocks = blocks
      .filter(b => b.type === 'thinking' || b.type === 'redacted_thinking')
      .map(b => (b.type === 'thinking'
        ? { type: 'thinking', thinking: b.thinking || '', signature: b.signature }
        : { type: 'redacted_thinking', data: b.data }))
    const toolCalls = blocks
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        id: b.id || genId('call'),
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
      }))
    return {
      id: data.id || 'chatcmpl-routex',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          // OpenAI 约定:只有工具调用时 content 为 null
          content: text || (data.stop_reason === 'refusal' ? REFUSAL_TEXT : (toolCalls.length ? null : '')),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(thinkingBlocks.length ? { thinking_blocks: thinkingBlocks } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length ? 'tool_calls' : (finishMap[data.stop_reason] || 'stop')
      }],
      usage: anthropicUsage(data.usage)
    }
  }

  if (channel.type === 'gemini') {
    const cand = data.candidates?.[0]
    const parts = cand?.content?.parts || []
    // Gemini 用 thought:true 标记思考片段,不能混进正文
    const text = parts.filter(p => !p.thought).map(p => p.text || '').join('')
    const reasoning = parts.filter(p => p.thought).map(p => p.text || '').join('')
    const toolCalls = parts
      .filter(p => p.functionCall)
      .map(p => ({
        id: genId('call'),
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) }
      }))
    const um = data.usageMetadata || {}
    return {
      id: 'chatcmpl-routex',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text || (toolCalls.length ? null : ''),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length ? 'tool_calls' : (finishMap[cand?.finishReason] || 'stop')
      }],
      usage: geminiUsage(um)
    }
  }

  return data // openai 透传
}

// ================= 响应侧(流式) =================
// 返回逐行解析器:feed(line) 产出 OpenAI 格式的 SSE 块(或 null),
// usage() 返回目前已知用量,chars() 返回累计文本长度(兜底计费用)
export function createStreamTransformer(channel, model) {
  const id = 'chatcmpl-' + Math.random().toString(36).slice(2, 10)
  let usage = null
  let startUsage = {}
  let chars = 0
  let finished = false
  let sawToolCall = false
  // 流式下也要把思考块(含 signature)还给客户端,否则下一轮就拼不回去了
  let thinkingText = ''
  let thinkingSignature = ''
  let emittedThinking = false
  let refused = false

  const chunk = delta => `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: null }]
  })}\n\n`

  const finalChunks = () => {
    const reason = refused ? 'content_filter' : (sawToolCall ? 'tool_calls' : 'stop')
    let out = ''
    // 拒答时正文可能一个字都没有,补一句说明
    if (refused && chars === 0) out += chunk({ content: REFUSAL_TEXT })
    out += `data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, delta: {}, finish_reason: reason }]
    })}\n\n`
    if (usage) {
      out += `data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
        choices: [], usage
      })}\n\n`
    }
    return out + 'data: [DONE]\n\n'
  }

  // Anthropic 的 content_block index 把文本块和工具块混在一起数,
  // 而 OpenAI 的 tool_calls index 只数工具调用,需要单独映射
  const toolIndexOfBlock = new Map()
  let nextToolIndex = 0

  const feedAnthropic = line => {
    if (!line.startsWith('data:')) return null
    const payload = line.slice(5).trim()
    if (!payload) return null
    let ev
    try { ev = JSON.parse(payload) } catch { return null }

    if (ev.type === 'message_start') {
      // 输入侧的用量(含缓存明细)只在开头给一次,必须存下来
      startUsage = ev.message?.usage || {}
      return chunk({ role: 'assistant', content: '' })
    }

    if (ev.type === 'content_block_start') {
      const block = ev.content_block || {}
      if (block.type === 'tool_use') {
        sawToolCall = true
        const idx = nextToolIndex++
        toolIndexOfBlock.set(ev.index, idx)
        return chunk({
          tool_calls: [{
            index: idx,
            id: block.id || genId('call'),
            type: 'function',
            function: { name: block.name || '', arguments: '' }
          }]
        })
      }
      return null
    }

    if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta') {
        chars += ev.delta.text.length
        return chunk({ content: ev.delta.text })
      }
      // 思考增量单独走 reasoning_content,不能混进正文
      if (ev.delta?.type === 'thinking_delta') {
        const t = ev.delta.thinking || ''
        chars += t.length
        thinkingText += t
        return chunk({ reasoning_content: t })
      }
      // signature 只在思考块结束前给一次,必须留住 —— 多轮回传全靠它
      if (ev.delta?.type === 'signature_delta') {
        thinkingSignature += ev.delta.signature || ''
        return null
      }
      if (ev.delta?.type === 'input_json_delta') {
        const idx = toolIndexOfBlock.get(ev.index)
        if (idx === undefined) return null
        const partial = ev.delta.partial_json || ''
        chars += partial.length
        return chunk({ tool_calls: [{ index: idx, function: { arguments: partial } }] })
      }
      return null
    }

    // 思考块收尾时把完整块(含 signature)作为一条增量发出去
    if (ev.type === 'content_block_stop' && thinkingSignature && !emittedThinking) {
      emittedThinking = true
      return chunk({
        thinking_blocks: [{ type: 'thinking', thinking: thinkingText, signature: thinkingSignature }]
      })
    }

    if (ev.type === 'message_delta') {
      usage = anthropicUsage({ ...startUsage, output_tokens: ev.usage?.output_tokens ?? 0 })
      if (ev.delta?.stop_reason === 'tool_use') sawToolCall = true
      if (ev.delta?.stop_reason === 'refusal') refused = true
      return null
    }

    if (ev.type === 'message_stop') {
      finished = true
      return finalChunks()
    }
    return null
  }

  const feedGemini = line => {
    if (!line.startsWith('data:')) return null
    const payload = line.slice(5).trim()
    if (!payload) return null
    let ev
    try { ev = JSON.parse(payload) } catch { return null }

    if (ev.usageMetadata) usage = geminiUsage(ev.usageMetadata)

    const parts = ev.candidates?.[0]?.content?.parts || []
    let out = ''
    for (const p of parts) {
      if (p.functionCall) {
        // Gemini 的 functionCall 一次给全,直接当成完整的一条 tool_call 发出去
        sawToolCall = true
        const args = JSON.stringify(p.functionCall.args ?? {})
        chars += args.length
        out += chunk({
          tool_calls: [{
            index: nextToolIndex++,
            id: genId('call'),
            type: 'function',
            function: { name: p.functionCall.name || '', arguments: args }
          }]
        })
        continue
      }
      if (p.text) {
        chars += p.text.length
        out += chunk(p.thought ? { reasoning_content: p.text } : { content: p.text })
      }
    }
    return out || null
  }

  return {
    feed: channel.type === 'anthropic' ? feedAnthropic : feedGemini,
    // 上游流结束时由 relay 调用;Anthropic 若已在 message_stop 收尾则跳过
    finish: () => {
      if (finished) return ''
      finished = true
      return finalChunks()
    },
    usage: () => usage,
    chars: () => chars
  }
}
