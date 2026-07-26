// 入站 OpenAI Responses 协议(POST /v1/responses)。
//
// 虽然同属 OpenAI,Responses 和 Chat Completions 的结构差别不小:
//   · messages → input(可以是纯字符串,也可以是「消息 + 函数调用 + 函数结果」混排的数组)
//   · system → instructions(独立字段,不在 input 里)
//   · tools 是**扁平**的 {type:'function', name, ...},不是 {type:'function', function:{...}}
//   · 响应不是 choices,而是一个 output 数组,消息/推理/函数调用各占一项
//   · 流式是**带类型的事件**(response.output_text.delta 等),不是统一的 chunk
//
// 有状态特性(previous_response_id / store)依赖服务端保存会话,中转站不持有
// 这些数据,所以明确拒绝而不是假装支持 —— 静默忽略会让客户端拿到错误的上下文。

const genId = p => `${p}_${Math.random().toString(36).slice(2, 14)}`

// ---- 请求:Responses → 规范(Chat Completions)格式 ----

function contentToChat(content) {
  if (typeof content === 'string') return content
  const parts = []
  for (const c of content || []) {
    if (c?.type === 'input_text' || c?.type === 'output_text' || c?.type === 'text') {
      parts.push({ type: 'text', text: c.text || '' })
    } else if (c?.type === 'input_image') {
      const url = typeof c.image_url === 'string' ? c.image_url : c.image_url?.url
      if (url) parts.push({ type: 'image_url', image_url: { url } })
    }
  }
  if (parts.length && parts.every(p => p.type === 'text')) return parts.map(p => p.text).join('')
  return parts
}

export function responsesRequestToOpenAI(body) {
  if (body.previous_response_id) {
    throw new Error('previous_response_id 需要服务端保存会话,中转站不支持;请把完整对话放在 input 里')
  }

  const out = {
    model: body.model,
    messages: [],
    ...(body.max_output_tokens ? { max_tokens: body.max_output_tokens } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.stream ? { stream: true } : {}),
    ...(body.reasoning?.effort ? { reasoning_effort: body.reasoning.effort } : {})
  }

  if (body.instructions) out.messages.push({ role: 'system', content: String(body.instructions) })

  const input = body.input
  if (typeof input === 'string') {
    out.messages.push({ role: 'user', content: input })
  } else {
    // 连续的函数调用要合并进同一条 assistant 消息,否则上游会认为
    // 每次只调了一个工具,并行调用的语义就丢了
    let pendingCalls = null
    const flush = () => {
      if (pendingCalls) {
        out.messages.push({ role: 'assistant', content: null, tool_calls: pendingCalls })
        pendingCalls = null
      }
    }

    for (const item of input || []) {
      if (item?.type === 'function_call') {
        pendingCalls = pendingCalls || []
        pendingCalls.push({
          id: item.call_id || item.id || genId('call'),
          type: 'function',
          function: { name: item.name, arguments: item.arguments || '{}' }
        })
        continue
      }
      flush()
      if (item?.type === 'function_call_output') {
        out.messages.push({
          role: 'tool',
          tool_call_id: item.call_id,
          content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
        })
        continue
      }
      if (item?.type === 'reasoning') continue // 推理项没有可回传的内容
      const role = item?.role || 'user'
      const content = contentToChat(item?.content)
      if (content && content.length) out.messages.push({ role, content })
    }
    flush()
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools
      .filter(t => t?.type === 'function' && t.name)
      .map(t => ({
        type: 'function',
        // Responses 的工具是扁平的,Chat Completions 要嵌一层 function
        function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object' } }
      }))
  }

  const tc = body.tool_choice
  if (typeof tc === 'string') out.tool_choice = tc
  else if (tc?.type === 'function' && tc.name) out.tool_choice = { type: 'function', function: { name: tc.name } }

  const fmt = body.text?.format
  if (fmt?.type === 'json_object') out.response_format = { type: 'json_object' }
  else if (fmt?.type === 'json_schema') {
    out.response_format = {
      type: 'json_schema',
      json_schema: { name: fmt.name || 'response', schema: fmt.schema, strict: fmt.strict !== false }
    }
  }

  return out
}

// ---- 响应:规范格式 → Responses ----

function usageToResponses(u = {}) {
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0
  return {
    input_tokens: u.prompt_tokens ?? 0,
    output_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
    input_tokens_details: { cached_tokens: cached },
    output_tokens_details: { reasoning_tokens: reasoning }
  }
}

const STATUS_MAP = { stop: 'completed', tool_calls: 'completed', length: 'incomplete', content_filter: 'incomplete' }

export function openaiResponseToResponses(data, model) {
  const choice = data.choices?.[0] || {}
  const msg = choice.message || {}
  const output = []

  if (msg.reasoning_content) {
    output.push({
      type: 'reasoning', id: genId('rs'),
      summary: [{ type: 'summary_text', text: msg.reasoning_content }]
    })
  }
  if (msg.content) {
    output.push({
      type: 'message', id: genId('msg'), status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: String(msg.content), annotations: [] }]
    })
  }
  for (const tc of msg.tool_calls || []) {
    output.push({
      type: 'function_call', id: genId('fc'), status: 'completed',
      call_id: tc.id, name: tc.function?.name || '', arguments: tc.function?.arguments || '{}'
    })
  }

  const status = STATUS_MAP[choice.finish_reason] || 'completed'
  return {
    id: genId('resp'),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    model: model || data.model,
    output,
    output_text: msg.content ? String(msg.content) : '',
    usage: usageToResponses(data.usage),
    incomplete_details: status === 'incomplete' ? { reason: choice.finish_reason } : null,
    error: null,
    metadata: {}
  }
}

// ---- 流式:OpenAI chunk → Responses 类型化事件 ----
// Responses 的流是一串带 type 的事件,客户端按 type 分发。
// 每个输出项(消息 / 函数调用)都要成对地 added → delta* → done。
export function createResponsesEncoder(model) {
  const id = genId('resp')
  const send = obj => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`

  let seq = 0
  const n = () => seq++
  let started = false
  let outputIndex = 0
  let textItem = null            // {id, index}
  const toolItems = new Map()    // OpenAI tool index → {id, call_id, name, args, index}
  let usage = null
  let finish = 'stop'

  const shell = (status, output = []) => ({
    id, object: 'response', created_at: Math.floor(Date.now() / 1000), status,
    model, output, output_text: '', usage: usage ? usageToResponses(usage) : null,
    incomplete_details: null, error: null, metadata: {}
  })

  const start = () => {
    if (started) return ''
    started = true
    return send({ type: 'response.created', sequence_number: n(), response: shell('in_progress') })
      + send({ type: 'response.in_progress', sequence_number: n(), response: shell('in_progress') })
  }

  const feed = chunk => {
    let out = start()
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (!choice) return out
    const delta = choice.delta || {}

    if (delta.content) {
      if (!textItem) {
        textItem = { id: genId('msg'), index: outputIndex++ }
        out += send({
          type: 'response.output_item.added', sequence_number: n(), output_index: textItem.index,
          item: { type: 'message', id: textItem.id, status: 'in_progress', role: 'assistant', content: [] }
        })
        out += send({
          type: 'response.content_part.added', sequence_number: n(), item_id: textItem.id,
          output_index: textItem.index, content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] }
        })
      }
      out += send({
        type: 'response.output_text.delta', sequence_number: n(), item_id: textItem.id,
        output_index: textItem.index, content_index: 0, delta: delta.content
      })
      textItem.text = (textItem.text || '') + delta.content
    }

    for (const tc of delta.tool_calls || []) {
      const i = tc.index ?? 0
      if (!toolItems.has(i)) {
        const item = {
          id: genId('fc'), call_id: tc.id || genId('call'),
          name: tc.function?.name || '', args: '', index: outputIndex++
        }
        toolItems.set(i, item)
        out += send({
          type: 'response.output_item.added', sequence_number: n(), output_index: item.index,
          item: {
            type: 'function_call', id: item.id, status: 'in_progress',
            call_id: item.call_id, name: item.name, arguments: ''
          }
        })
      }
      const item = toolItems.get(i)
      if (tc.function?.name) item.name = tc.function.name
      if (tc.function?.arguments) {
        item.args += tc.function.arguments
        out += send({
          type: 'response.function_call_arguments.delta', sequence_number: n(),
          item_id: item.id, output_index: item.index, delta: tc.function.arguments
        })
      }
    }

    if (choice.finish_reason) finish = choice.finish_reason
    return out
  }

  const finishFn = () => {
    let out = start()
    const output = []

    if (textItem) {
      const text = textItem.text || ''
      out += send({
        type: 'response.output_text.done', sequence_number: n(), item_id: textItem.id,
        output_index: textItem.index, content_index: 0, text
      })
      out += send({
        type: 'response.content_part.done', sequence_number: n(), item_id: textItem.id,
        output_index: textItem.index, content_index: 0,
        part: { type: 'output_text', text, annotations: [] }
      })
      const item = {
        type: 'message', id: textItem.id, status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }]
      }
      out += send({ type: 'response.output_item.done', sequence_number: n(), output_index: textItem.index, item })
      output.push(item)
    }

    for (const it of toolItems.values()) {
      out += send({
        type: 'response.function_call_arguments.done', sequence_number: n(),
        item_id: it.id, output_index: it.index, arguments: it.args
      })
      const item = {
        type: 'function_call', id: it.id, status: 'completed',
        call_id: it.call_id, name: it.name, arguments: it.args
      }
      out += send({ type: 'response.output_item.done', sequence_number: n(), output_index: it.index, item })
      output.push(item)
    }

    const status = STATUS_MAP[finish] || 'completed'
    const final = shell(status, output)
    final.output_text = textItem?.text || ''
    if (status === 'incomplete') final.incomplete_details = { reason: finish }
    out += send({ type: 'response.completed', sequence_number: n(), response: final })
    return out
  }

  return { feed, finish: finishFn }
}
