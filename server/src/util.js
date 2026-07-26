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
