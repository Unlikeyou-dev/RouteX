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

// 列表解析:兼容逗号与换行分隔(表单里一行一个是最自然的填法)
export function splitList(text) {
  return String(text || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)
}

export const splitModels = splitList

// 渠道服务的用户分组;历史数据留空时按 default 处理
export function channelGroups(channel) {
  const list = splitList(channel.group_names)
  return list.length ? list : ['default']
}

export function channelServesGroup(channel, group) {
  return channelGroups(channel).includes(group || 'default')
}

// 充值订单号:RX + 年月日时分 + 4 位随机,方便用户在付款备注里填、你在收款记录里对
export function genOrderNo() {
  const d = new Date()
  const p = (x, n = 2) => String(x).padStart(n, '0')
  const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
  return `RX${stamp}${crypto.randomBytes(2).toString('hex').toUpperCase()}`
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

// 上游返回的错误里经常原样带着我们的 Key(例如 OpenAI 的
// "Incorrect API key provided: sk-xxxx"),这些内容既会回给终端用户、
// 也会写进调用日志,必须先抹掉密钥再落地。
const SECRET_PATTERNS = [
  /\b(sk-ant-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g,   // Anthropic
  /\b(sk-proj-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g,  // OpenAI 项目密钥
  /\b(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g,       // OpenAI 及绝大多数兼容站
  /\b(AIza[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g,      // Google
  /\b(gsk_[A-Za-z0-9]{4})[A-Za-z0-9]+/g,          // Groq
  /\b(xai-[A-Za-z0-9]{4})[A-Za-z0-9]+/g           // xAI
]

export function redactSecrets(text) {
  let out = String(text ?? '')
  for (const re of SECRET_PATTERNS) out = out.replace(re, '$1***')
  // 兜底:JSON / query 里显式的 key 字段
  out = out.replace(/("?(?:api[_-]?key|authorization|x-api-key)"?\s*[:=]\s*"?)([^"'\s,&}]{6,})/gi, '$1***')
  return out
}
