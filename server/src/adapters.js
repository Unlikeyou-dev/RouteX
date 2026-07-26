// 上游协议适配器:对外统一 OpenAI 格式,对内按渠道类型转换
// type = 'openai' | 'anthropic' | 'gemini'
import { channelBaseUrl } from './util.js'

// ---- 请求侧 ----

function messagesToAnthropic(body) {
  const system = []
  const messages = []
  for (const m of body.messages || []) {
    const text = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content.map(p => p.text || '').join('') : String(m.content ?? ''))
    if (m.role === 'system') system.push(text)
    else messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text })
  }
  // Anthropic 要求 user/assistant 交替且以 user 开头
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: ' ' })
  }
  return { system: system.join('\n') || undefined, messages }
}

function messagesToGemini(body) {
  const system = []
  const contents = []
  for (const m of body.messages || []) {
    const text = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content.map(p => p.text || '').join('') : String(m.content ?? ''))
    if (m.role === 'system') system.push(text)
    else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] })
  }
  if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: ' ' }] })
  return { systemInstruction: system.length ? { parts: [{ text: system.join('\n') }] } : undefined, contents }
}

// 构造上游请求:返回 { url, headers, payload }
export function buildUpstreamRequest(channel, apiKey, path, body, upstreamModel, isStream) {
  const base = channelBaseUrl(channel)

  if (channel.type === 'anthropic') {
    const { system, messages } = messagesToAnthropic(body)
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
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
        ...(body.stop ? { stop_sequences: Array.isArray(body.stop) ? body.stop : [body.stop] } : {}),
        stream: !!isStream
      }
    }
  }

  if (channel.type === 'gemini') {
    const { systemInstruction, contents } = messagesToGemini(body)
    const method = isStream ? 'streamGenerateContent?alt=sse' : 'generateContent'
    return {
      url: `${base}/v1beta/models/${upstreamModel}:${method}`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      payload: {
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
        generationConfig: {
          ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
          ...(body.top_p !== undefined ? { topP: body.top_p } : {}),
          ...(body.max_tokens ? { maxOutputTokens: body.max_tokens } : {})
        }
      }
    }
  }

  // OpenAI 兼容:原样转发
  const payload = { ...body, model: upstreamModel }
  if (isStream) payload.stream_options = { ...(body.stream_options || {}), include_usage: true }
  return {
    url: `${base}/v1${path}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    payload
  }
}

// ---- 响应侧(非流式)----
// 统一转成 OpenAI chat.completion 格式,并返回 usage

const finishMap = {
  end_turn: 'stop', max_tokens: 'length', stop_sequence: 'stop',
  STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'content_filter'
}

export function convertResponse(channel, model, data) {
  if (channel.type === 'anthropic') {
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    return {
      id: data.id || 'chatcmpl-routex',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: finishMap[data.stop_reason] || 'stop'
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
    const text = (cand?.content?.parts || []).map(p => p.text || '').join('')
    const um = data.usageMetadata || {}
    return {
      id: 'chatcmpl-routex',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: finishMap[cand?.finishReason] || 'stop'
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

// ---- 响应侧(流式)----
// 返回一个逐行解析器:feed(line) 产出 OpenAI 格式的 SSE 块(或 null),
// usage() 返回目前已知的用量,text() 返回累计文本长度
export function createStreamTransformer(channel, model) {
  const id = 'chatcmpl-' + Math.random().toString(36).slice(2, 10)
  let usage = null
  let inputTokens = 0
  let chars = 0
  let finished = false

  const chunk = delta => `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: null }]
  })}\n\n`

  const finalChunks = () => {
    let out = `data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })}\n\n`
    if (usage) {
      out += `data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
        choices: [], usage
      })}\n\n`
    }
    return out + 'data: [DONE]\n\n'
  }

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
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      chars += ev.delta.text.length
      return chunk({ content: ev.delta.text })
    }
    if (ev.type === 'message_delta') {
      const out = ev.usage?.output_tokens ?? 0
      usage = { prompt_tokens: inputTokens, completion_tokens: out, total_tokens: inputTokens + out }
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
    const text = (ev.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
    if (ev.usageMetadata) {
      usage = {
        prompt_tokens: ev.usageMetadata.promptTokenCount ?? 0,
        completion_tokens: ev.usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: ev.usageMetadata.totalTokenCount ?? 0
      }
    }
    if (text) {
      chars += text.length
      return chunk({ content: text })
    }
    return null
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
