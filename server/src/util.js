import crypto from 'node:crypto'

export function genApiKey() {
  return 'sk-' + crypto.randomBytes(24).toString('hex')
}

export function genInviteCode() {
  return crypto.randomBytes(4).toString('hex')
}

// 金额统一收敛到微美元(1e-6)精度,避免浮点累积误差
export function usd(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6
}

// 各协议的官方默认地址:渠道不填地址时直连官方(对齐 new-api 设计)
export const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com'
}

// 地址归一化:去尾斜杠;并去掉用户习惯性带上的尾部 /v1、/v1beta
// (否则会拼出 /v1/v1/chat/completions 之类的 404 地址)
export function normalizeBaseUrl(url, type = 'openai') {
  let u = String(url || '').trim().replace(/\/+$/, '')
  if (!u) return ''
  u = u.replace(/\/v1(beta)?$/, '')
  return u.replace(/\/+$/, '')
}

// 渠道有效地址:留空则用协议官方地址
export function channelBaseUrl(channel) {
  return channel.base_url || DEFAULT_BASE_URLS[channel.type] || DEFAULT_BASE_URLS.openai
}

// 模型列表解析:兼容逗号与换行分隔(渠道表单里一行一个是最自然的填法)
export function splitModels(models) {
  return String(models || '').split(/[\n,]/).map(m => m.trim()).filter(Boolean)
}

export function genRedemptionCode() {
  return crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-')
}

// 粗略 token 估算(上游未返回 usage 时的兜底):中英文混合按 1 token ≈ 3.5 字符
export function estimateTokens(text) {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 3.5))
}

export function badRequest(res, message) {
  return res.status(400).json({ success: false, message })
}
