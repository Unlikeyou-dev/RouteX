// 入站 Anthropic Messages 协议(POST /v1/messages)。
//
// 站点内部一律以 OpenAI 格式作为「规范格式」——路由、计费、令牌白名单、
// 日志全都基于它。所以入站的 Anthropic 请求先转成规范格式,出站再转回去。
//
// 但有一条捷径:**入站 Anthropic + 上游也是 Anthropic 渠道时直接透传**,
// 不做任何转换。这条路径保真度最高 —— cache_control、thinking 的 signature、
// beta 特性、我们还不认识的新字段全都原样过去,不会在两次转换里丢失。
// 转换只在跨协议时才发生(Anthropic 进 / OpenAI 渠道出)。

const genId = prefix => `${prefix}_${Math.random().toString(36).slice(2, 14)}`

// ---- 请求:Anthropic → 规范(OpenAI)格式 ----

function blocksToOpenAIContent(blocks) {
  const parts = []
  for (const b of blocks) {
    if (b?.type === 'text') parts.push({ type: 'text', text: b.text || '' })
    else if (b?.type === 'image') {
      const src = b.source || {}
      const url = src.type === 'base64'
        ? `data:${src.media_type};base64,${src.data}`
        : src.url
      if (url) parts.push({ type: 'image_url', image_url: { url } })
    }
  }
  // 纯文本时退回字符串形式,大多数上游对字符串的兼容性更好
  if (parts.length && parts.every(p => p.type === 'text')) {
    return parts.map(p => p.text).join('')
  }
  return parts
}

const systemToText = system =>
  typeof system === 'string'
    ? system
    : (Array.isArray(system) ? system.filter(b => b?.type === 'text').map(b => b.text || '').join('\n') : '')

export function anthropicRequestToOpenAI(body) {
  const out = {
    model: body.model,
    messages: [],
    ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.stop_sequences ? { stop: body.stop_sequences } : {}),
    ...(body.stream ? { stream: true } : {})
  }

  const system = systemToText(body.system)
  if (system) out.messages.push({ role: 'system', content: system })

  for (const m of body.messages || []) {
    const blocks = typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : (Array.isArray(m.content) ? m.content : [])

    if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: null }
      const thinking = blocks.filter(b => b.type === 'thinking' || b.type === 'redacted_thinking')
      if (thinking.length) {
        // 原样留着,跨协议时用不上,但回到 Anthropic 渠道时要能还原
        msg.thinking_blocks = thinking
        const text = thinking.filter(b => b.type === 'thinking').map(b => b.thinking || '').join('')
        if (text) msg.reasoning_content = text
      }
      const content = blocksToOpenAIContent(blocks.filter(b => b.type === 'text' || b.type === 'image'))
      if (content && content.length) msg.content = content
      const toolCalls = blocks.filter(b => b.type === 'tool_use').map(b => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
      }))
      if (toolCalls.length) msg.tool_calls = toolCalls
      out.messages.push(msg)
      continue
    }

    // user 消息里可能混着 tool_result —— OpenAI 侧要拆成独立的 tool 消息
    const results = blocks.filter(b => b.type === 'tool_result')
    for (const r of results) {
      out.messages.push({
        role: 'tool',
        tool_call_id: r.tool_use_id,
        content: typeof r.content === 'string'
          ? r.content
          : (Array.isArray(r.content)
            ? r.content.filter(x => x?.type === 'text').map(x => x.text || '').join('')
            : JSON.stringify(r.content ?? ''))
      })
    }
    const rest = blocks.filter(b => b.type !== 'tool_result')
    if (rest.length) {
      const content = blocksToOpenAIContent(rest)
      if (content && content.length) out.messages.push({ role: 'user', content })
    }
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools
      .filter(t => t?.name)
      .map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object' } }
      }))
  }

  const tc = body.tool_choice
  if (tc?.type === 'any') out.tool_choice = 'required'
  else if (tc?.type === 'tool' && tc.name) out.tool_choice = { type: 'function', function: { name: tc.name } }
  else if (tc?.type === 'none') out.tool_choice = 'none'

  // thinking 原样带上 —— 计费侧的 wantsThinking 和出站适配器都认这个字段
  if (body.thinking) out.thinking = body.thinking

  return out
}

// ---- 响应:规范(OpenAI)格式 → Anthropic ----

const STOP_MAP = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'refusal',
  function_call: 'tool_use'
}

export function openaiResponseToAnthropic(data, model) {
  const choice = data.choices?.[0] || {}
  const msg = choice.message || {}
  const content = []

  for (const tb of msg.thinking_blocks || []) content.push(tb)
  if (!msg.thinking_blocks?.length && msg.reasoning_content) {
    content.push({ type: 'thinking', thinking: msg.reasoning_content })
  }
  if (msg.content) content.push({ type: 'text', text: String(msg.content) })
  for (const tc of msg.tool_calls || []) {
    let input = {}
    try { input = JSON.parse(tc.function?.arguments || '{}') } catch { input = {} }
    content.push({ type: 'tool_use', id: tc.id || genId('toolu'), name: tc.function?.name || '', input })
  }

  const u = data.usage || {}
  const cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0
  const cacheWrite = u.cache_creation_tokens ?? 0
  return {
    id: data.id || genId('msg'),
    type: 'message',
    role: 'assistant',
    model: model || data.model,
    content,
    // Anthropic 的 input_tokens 不含缓存,要把缓存部分减出去
    stop_reason: STOP_MAP[choice.finish_reason] || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (u.prompt_tokens ?? 0) - cacheRead - cacheWrite),
      output_tokens: u.completion_tokens ?? 0,
      ...(cacheRead ? { cache_read_input_tokens: cacheRead } : {}),
      ...(cacheWrite ? { cache_creation_input_tokens: cacheWrite } : {})
    }
  }
}

// ---- 流式:OpenAI SSE 块 → Anthropic SSE 事件序列 ----
//
// Anthropic 的事件序列有严格结构:message_start → (content_block_start →
// content_block_delta* → content_block_stop)* → message_delta → message_stop。
// 而且块序号是**所有块统一编号**的,文本块和工具块混在一起数 —— 和 OpenAI 的
// tool_calls[].index 只数工具调用不同,必须单独映射。
export function createAnthropicEncoder(model) {
  const id = genId('msg')
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

  let started = false
  let nextIndex = 0
  let textIndex = null       // 正文块的序号,首次出现文本时分配
  let thinkingIndex = null
  const toolIndex = new Map() // OpenAI tool_calls index → Anthropic block index
  let openBlock = null        // 当前打开的块序号
  let stopReason = 'end_turn'
  let usage = null

  const closeOpen = () => {
    if (openBlock === null) return ''
    const out = ev('content_block_stop', { index: openBlock })
    openBlock = null
    return out
  }

  const start = () => {
    if (started) return ''
    started = true
    return ev('message_start', {
      message: {
        id, type: 'message', role: 'assistant', model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })
  }

  // 传入一个已解析的 OpenAI chunk 对象,返回要写出的 Anthropic SSE 文本
  const feed = chunk => {
    let out = start()
    if (chunk.usage) usage = chunk.usage

    const choice = chunk.choices?.[0]
    if (!choice) return out
    const delta = choice.delta || {}

    if (delta.reasoning_content) {
      if (thinkingIndex === null) {
        out += closeOpen()
        thinkingIndex = nextIndex++
        openBlock = thinkingIndex
        out += ev('content_block_start', { index: thinkingIndex, content_block: { type: 'thinking', thinking: '' } })
      } else if (openBlock !== thinkingIndex) {
        out += closeOpen()
        openBlock = thinkingIndex
      }
      out += ev('content_block_delta', {
        index: thinkingIndex, delta: { type: 'thinking_delta', thinking: delta.reasoning_content }
      })
    }

    if (delta.content) {
      if (textIndex === null) {
        out += closeOpen()
        textIndex = nextIndex++
        openBlock = textIndex
        out += ev('content_block_start', { index: textIndex, content_block: { type: 'text', text: '' } })
      } else if (openBlock !== textIndex) {
        out += closeOpen()
        openBlock = textIndex
      }
      out += ev('content_block_delta', { index: textIndex, delta: { type: 'text_delta', text: delta.content } })
    }

    for (const tc of delta.tool_calls || []) {
      const oaIdx = tc.index ?? 0
      if (!toolIndex.has(oaIdx)) {
        out += closeOpen()
        const idx = nextIndex++
        toolIndex.set(oaIdx, idx)
        openBlock = idx
        out += ev('content_block_start', {
          index: idx,
          content_block: { type: 'tool_use', id: tc.id || genId('toolu'), name: tc.function?.name || '', input: {} }
        })
      }
      const idx = toolIndex.get(oaIdx)
      if (openBlock !== idx) {
        out += closeOpen()
        openBlock = idx
      }
      if (tc.function?.arguments) {
        out += ev('content_block_delta', {
          index: idx, delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
        })
      }
    }

    if (choice.finish_reason) stopReason = STOP_MAP[choice.finish_reason] || 'end_turn'
    return out
  }

  const finish = () => {
    let out = start()
    out += closeOpen()
    const u = usage || {}
    const cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0
    const cacheWrite = u.cache_creation_tokens ?? 0
    out += ev('message_delta', {
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: {
        input_tokens: Math.max(0, (u.prompt_tokens ?? 0) - cacheRead - cacheWrite),
        output_tokens: u.completion_tokens ?? 0,
        ...(cacheRead ? { cache_read_input_tokens: cacheRead } : {}),
        ...(cacheWrite ? { cache_creation_input_tokens: cacheWrite } : {})
      }
    })
    out += ev('message_stop', {})
    return out
  }

  return { feed, finish }
}

// Anthropic 风格的错误体 —— 客户端 SDK 会按这个结构解析
export const anthropicErrorBody = (message, type = 'invalid_request_error') => ({
  type: 'error',
  error: { type, message }
})
