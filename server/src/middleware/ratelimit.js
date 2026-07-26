// 轻量内存滑动窗口限流(按 IP),用于防爆破/防刷注册
const buckets = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [key, arr] of buckets) {
    const kept = arr.filter(t => now - t < 3_600_000)
    if (kept.length === 0) buckets.delete(key)
    else buckets.set(key, kept)
  }
}, 600_000).unref()

export function rateLimit({ windowMs, max, prefix }) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
    const key = `${prefix}:${ip}`
    const now = Date.now()
    const arr = (buckets.get(key) || []).filter(t => now - t < windowMs)
    if (arr.length >= max) {
      return res.status(429).json({ success: false, message: '请求过于频繁,请稍后再试' })
    }
    arr.push(now)
    buckets.set(key, arr)
    next()
  }
}
