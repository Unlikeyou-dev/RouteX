// 入站 Gemini 协议(POST /v1beta/models/{model}:generateContent)。
//
// 和 Anthropic 入站一样,先转成站内的规范格式(OpenAI)再走统一的路由与计费;
// 入站与上游同为 Gemini 时直接透传,不做转换。
//
// Gemini 这边有个结构性差异要处理:它的 functionCall / functionResponse **没有调用 ID**,
// 靠函数名配对;而 OpenAI 侧的 tool_result 必须带 tool_call_id。所以转换时要
// 自己造一套稳定的 id,并在回程时按顺序配回去。

const genId = () => 'call_' + Math.random().toString(36).slice(2, 12)

// ---- 请求:Gemini → 规范(OpenAI)格式 ----

function partsToOpenAIContent(parts) {
  const out = []
  for (const p of parts) {
    if (typeof p?.text === 'string' && !p.thought) out.push({ type: 'text', text: p.text })
    else if (p?.inlineData || p?.inline_data) {
      const d = p.inlineData || p.inline_data
      out.push({ type: 'image_url', image_url: { url: `data:${d.mimeType || d.mime_type};base64,${d.data}` } })
    }
  }
  if (out.length && out.every(x => x.type === 'text')) return out.map(x => x.text).join('')
  return out
}

export function geminiRequestToOpenAI(body, model) {
  const gc = body.generationConfig || body.generation_config || {}
  const out = {
    model,
    messages: [],
    ...(gc.maxOutputTokens ? { max_tokens: gc.maxOutputTokens } : {}),
    ...(gc.temperature !== undefined ? { temperature: gc.temperature } : {}),
    ...(gc.topP !== undefined ? { top_p: gc.topP } : {}),
    ...(gc.stopSequences?.length ? { stop: gc.stopSequences } : {}),
    // 带 schema 的要保住 schema 本身,只翻成 json_object 会把约束丢掉,
    // 客户端明明给了结构却拿回自由格式的 JSON
    ...(gc.responseSchema || gc.response_schema
      ? {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'response', schema: gc.responseSchema || gc.response_schema, strict: true }
        }
      }
      : gc.responseMimeType === 'application/json'
        ? { response_format: { type: 'json_object' } }
        : {})
  }

  const si = body.systemInstruction || body.system_instruction
  if (si) {
    const text = (si.parts || []).map(p => p.text || '').join('\n')
    if (text) out.messages.push({ role: 'system', content: text })
  }

  // functionCall 没有 id,自己造一套并按函数名记住,供 functionResponse 配回
  const pendingIds = new Map() // name → [id, id, ...]

  for (const c of body.contents || []) {
    const parts = c.parts || []
    const calls = parts.filter(p => p.functionCall || p.function_call)
    const responses = parts.filter(p => p.functionResponse || p.function_response)

    if (c.role === 'model') {
      const msg = { role: 'assistant', content: null }
      const content = partsToOpenAIContent(parts)
      if (content && content.length) msg.content = content
      const thought = parts.filter(p => p.thought && p.text).map(p => p.text).join('')
      if (thought) msg.reasoning_content = thought
      if (calls.length) {
        msg.tool_calls = calls.map(p => {
          const fc = p.functionCall || p.function_call
          const id = genId()
          if (!pendingIds.has(fc.name)) pendingIds.set(fc.name, [])
          pendingIds.get(fc.name).push(id)
          return { id, type: 'function', function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) } }
        })
      }
      out.messages.push(msg)
      continue
    }

    // user 侧:functionResponse 要拆成独立的 tool 消息
    for (const p of responses) {
      const fr = p.functionResponse || p.function_response
      const queue = pendingIds.get(fr.name)
      const id = queue?.shift() || genId()
      out.messages.push({
        role: 'tool',
        tool_call_id: id,
        content: typeof fr.response === 'string' ? fr.response : JSON.stringify(fr.response ?? {})
      })
    }
    const rest = parts.filter(p => !p.functionResponse && !p.function_response)
    if (rest.length) {
      const content = partsToOpenAIContent(rest)
      if (content && content.length) out.messages.push({ role: 'user', content })
    }
  }

  const decls = (body.tools || []).flatMap(t => t.functionDeclarations || t.function_declarations || [])
  if (decls.length) {
    out.tools = decls.map(d => ({
      type: 'function',
      function: { name: d.name, description: d.description || '', parameters: d.parameters || { type: 'object' } }
    }))
  }

  const mode = (body.toolConfig || body.tool_config)?.functionCallingConfig?.mode
  if (mode === 'ANY') out.tool_choice = 'required'
  else if (mode === 'NONE') out.tool_choice = 'none'

  const budget = gc.thinkingConfig?.thinkingBudget ?? gc.thinking_config?.thinking_budget
  if (Number(budget) > 0) out.thinking = { type: 'enabled', budget_tokens: Number(budget) }

  return out
}

// ---- 响应:规范(OpenAI)格式 → Gemini ----

const FINISH_MAP = {
  stop: 'STOP', length: 'MAX_TOKENS', tool_calls: 'STOP',
  content_filter: 'SAFETY', function_call: 'STOP'
}

function usageToGemini(u = {}) {
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0
  return {
    promptTokenCount: u.prompt_tokens ?? 0,
    candidatesTokenCount: Math.max(0, (u.completion_tokens ?? 0) - reasoning),
    totalTokenCount: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
    ...(cached ? { cachedContentTokenCount: cached } : {}),
    ...(reasoning ? { thoughtsTokenCount: reasoning } : {})
  }
}

export function openaiResponseToGemini(data, model) {
  const choice = data.choices?.[0] || {}
  const msg = choice.message || {}
  const parts = []
  if (msg.reasoning_content) parts.push({ text: msg.reasoning_content, thought: true })
  if (msg.content) parts.push({ text: String(msg.content) })
  for (const tc of msg.tool_calls || []) {
    let args = {}
    try { args = JSON.parse(tc.function?.arguments || '{}') } catch { args = {} }
    parts.push({ functionCall: { name: tc.function?.name || '', args } })
  }
  return {
    candidates: [{
      content: { role: 'model', parts },
      finishReason: FINISH_MAP[choice.finish_reason] || 'STOP',
      index: 0,
      safetyRatings: []
    }],
    usageMetadata: usageToGemini(data.usage),
    modelVersion: model
  }
}

// ---- 流式:OpenAI SSE 块 → Gemini SSE ----
// Gemini 的流式就是一串 `data: {GenerateContentResponse}`,没有 event: 行。
// 文本逐块给,functionCall 一次给全 —— 所以工具参数要先攒齐再在结尾发出。
export function createGeminiEncoder(model) {
  const send = obj => `data: ${JSON.stringify(obj)}\n\n`
  const toolBuf = new Map() // index → {name, args}
  let finish = 'STOP'
  let usage = null

  const feed = chunk => {
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) return ''
    const delta = choice.delta || {}
    let out = ''

    if (delta.reasoning_content) {
      out += send({
        candidates: [{ content: { role: 'model', parts: [{ text: delta.reasoning_content, thought: true }] }, index: 0 }],
        modelVersion: model
      })
    }
    if (delta.content) {
      out += send({
        candidates: [{ content: { role: 'model', parts: [{ text: delta.content }] }, index: 0 }],
        modelVersion: model
      })
    }
    for (const tc of delta.tool_calls || []) {
      const i = tc.index ?? 0
      if (!toolBuf.has(i)) toolBuf.set(i, { name: '', args: '' })
      const buf = toolBuf.get(i)
      if (tc.function?.name) buf.name = tc.function.name
      if (tc.function?.arguments) buf.args += tc.function.arguments
    }
    if (choice.finish_reason) finish = FINISH_MAP[choice.finish_reason] || 'STOP'
    return out
  }

  const finishFn = () => {
    const parts = []
    for (const buf of toolBuf.values()) {
      let args = {}
      try { args = JSON.parse(buf.args || '{}') } catch { args = {} }
      parts.push({ functionCall: { name: buf.name, args } })
    }
    return send({
      candidates: [{
        content: { role: 'model', parts },
        finishReason: finish,
        index: 0,
        safetyRatings: []
      }],
      usageMetadata: usageToGemini(usage || {}),
      modelVersion: model
    })
  }

  return { feed, finish: finishFn }
}

// Gemini 风格的错误体
export const geminiErrorBody = (status, message) => ({
  error: {
    code: status,
    message,
    status: status === 400 ? 'INVALID_ARGUMENT'
      : status === 401 ? 'UNAUTHENTICATED'
        : status === 403 ? 'PERMISSION_DENIED'
          : status === 404 ? 'NOT_FOUND'
            : status === 429 ? 'RESOURCE_EXHAUSTED'
              : status === 503 ? 'UNAVAILABLE' : 'INTERNAL'
  }
})
