// 从上游拉取真实支持的模型列表(对齐 new-api 渠道编辑页的「获取模型列表」)。
//
// 三种协议的模型接口各不相同:
//   openai     GET {base}/v1/models          Authorization: Bearer     → data[].id
//   anthropic  GET {base}/v1/models          x-api-key + version 头     → data[].id
//   gemini     GET {base}/v1beta/models      x-goog-api-key             → models[].name(带 models/ 前缀)
//
// 上游不提供标准接口是常态(很多小中转站没实现),所以失败一律返回可读原因,
// 让前端提示「手动填写」,而不是把错误当异常抛出去。
import { channelBaseUrl } from './util.js'

const TIMEOUT_MS = 20_000

// 「填入常用」用的内置清单,按协议给一份手打起来最烦的主流模型
export const presetModels = {
  openai: [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'o3', 'o4-mini',
    'deepseek-chat', 'deepseek-reasoner',
    'qwen-max', 'qwen-plus', 'glm-4-plus'
  ],
  anthropic: [
    'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'
  ],
  gemini: [
    'gemini-2.5-pro', 'gemini-2.5-flash'
  ]
}

function requestOf(type, base, apiKey) {
  if (type === 'anthropic') {
    return {
      url: `${base}/v1/models?limit=1000`,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    }
  }
  if (type === 'gemini') {
    return {
      url: `${base}/v1beta/models?pageSize=1000`,
      headers: { 'x-goog-api-key': apiKey }
    }
  }
  return { url: `${base}/v1/models`, headers: { Authorization: `Bearer ${apiKey}` } }
}

// 各家返回结构不同,统一抽成模型名数组
function extractModels(type, data) {
  if (type === 'gemini') {
    return (data?.models || [])
      // Gemini 返回 "models/gemini-2.5-pro",要剥掉前缀才是调用时用的名字
      .map(m => String(m.name || '').replace(/^models\//, ''))
      // 我们的 Gemini 适配器只做对话,embedding / aqa 这类拉进来也调不通
      .filter(name => name && !/embedding|aqa|imagen/i.test(name))
  }
  const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
  return list.map(m => (typeof m === 'string' ? m : m?.id)).filter(Boolean)
}

export async function fetchUpstreamModels({ type = 'openai', base_url = '', api_key }) {
  if (!api_key) return { ok: false, message: '缺少上游 API Key,无法拉取模型列表' }
  const base = channelBaseUrl({ type, base_url })
  const { url, headers } = requestOf(type, base, api_key)

  let resp
  try {
    resp = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    return { ok: false, message: `连接上游失败:${e.message}` }
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return {
      ok: false,
      message: resp.status === 404
        ? '该上游没有提供标准的模型列表接口,请手动填写模型名'
        : `上游返回 HTTP ${resp.status}:${text.slice(0, 160)}`
    }
  }

  let data
  try {
    data = await resp.json()
  } catch {
    return { ok: false, message: '上游返回的不是合法 JSON,请手动填写模型名' }
  }

  const models = [...new Set(extractModels(type, data))].sort()
  if (!models.length) return { ok: false, message: '上游返回了空的模型列表,请手动填写模型名' }
  return { ok: true, models }
}
