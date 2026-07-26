// 上游协议适配器:对外统一 OpenAI 格式,对内按渠道类型转换
// type = 'openai' | 'anthropic' | 'gemini'
//
// 这里的重点是 **function calling 全链路**。agent 的每一步都建立在工具调用上:
// 请求里的 tools、assistant 回复里的 tool_calls、role:'tool' 的执行结果,
// 三者缺一不可。任何一环丢失,agent 就会在原地打转或直接崩掉。
import { channelBaseUrl } from './util.js'

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
      const blocks = contentToAnthropicBlocks(m.content)
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

// ================= 构造上游请求 =================

export function buildUpstreamRequest(channel, apiKey, path, body, upstreamModel, isStream) {
  const base = channelBaseUrl(channel)

  if (channel.type === 'anthropic') {
    const { system, messages } = messagesToAnthropic(body)
    const noTools = body.tool_choice === 'none'
    const tools = noTools ? undefined : toolsToAnthropic(body.tools)
    return {
      url: `${base}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: {
        model: upstreamModel,
        max_tokens: body.max_tokens || body.max_completion_tokens || 4096,
        ...(system ? { system } : {}),
        messages,
        ...(tools ? { tools } : {}),
        ...(tools && toolChoiceToAnthropic(body.tool_choice)
          ? { tool_choice: toolChoiceToAnthropic(body.tool_choice) }
          : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
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
          ...(body.response_format?.type === 'json_object' ? { responseMimeType: 'application/json' } : {})
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
  STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'content_filter'
}

export function convertResponse(channel, model, data) {
  if (channel.type === 'anthropic') {
    const blocks = data.content || []
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
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
          content: text || (toolCalls.length ? null : ''),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length ? 'tool_calls' : (finishMap[data.stop_reason] || 'stop')
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)
      }
    }
  }

  if (channel.type === 'gemini') {
    const cand = data.candidates?.[0]
    const parts = cand?.content?.parts || []
    const text = parts.map(p => p.text || '').join('')
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
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length ? 'tool_calls' : (finishMap[cand?.finishReason] || 'stop')
      }],
      usage: {
        prompt_tokens: um.promptTokenCount ?? 0,
        completion_tokens: um.candidatesTokenCount ?? 0,
        total_tokens: um.totalTokenCount ?? 0
      }
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
  let inputTokens = 0
  let chars = 0
  let finished = false
  let sawToolCall = false

  const chunk = delta => `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: null }]
  })}\n\n`

  const finalChunks = () => {
    let out = `data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, delta: {}, finish_reason: sawToolCall ? 'tool_calls' : 'stop' }]
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
      inputTokens = ev.message?.usage?.input_tokens ?? 0
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
      if (ev.delta?.type === 'input_json_delta') {
        const idx = toolIndexOfBlock.get(ev.index)
        if (idx === undefined) return null
        const partial = ev.delta.partial_json || ''
        chars += partial.length
        return chunk({ tool_calls: [{ index: idx, function: { arguments: partial } }] })
      }
      return null
    }

    if (ev.type === 'message_delta') {
      const out = ev.usage?.output_tokens ?? 0
      usage = { prompt_tokens: inputTokens, completion_tokens: out, total_tokens: inputTokens + out }
      if (ev.delta?.stop_reason === 'tool_use') sawToolCall = true
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

    if (ev.usageMetadata) {
      usage = {
        prompt_tokens: ev.usageMetadata.promptTokenCount ?? 0,
        completion_tokens: ev.usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: ev.usageMetadata.totalTokenCount ?? 0
      }
    }

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
        out += chunk({ content: p.text })
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
