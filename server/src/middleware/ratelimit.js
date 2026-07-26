// 轻量内存滑动窗口限流。默认按 IP,也可传 keyOf 改成按用户/令牌计数。
// 内存态:进程重启即清零,多实例各算各的 —— 单机小站够用,上规模需要换 Redis。
const buckets = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [key, arr] of buckets) {
    const kept = arr.filter(t => now - t < 3_600_000)
    if (kept.length === 0) buckets.delete(key)
    else buckets.set(key, kept)
  }
}, 600_000).unref()

const clientIp = req =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'

export function rateLimit({ windowMs, max, prefix, keyOf = clientIp }) {
  return (req, res, next) => {
    const key = `${prefix}:${keyOf(req)}`
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

// 中转入口用:限额可在站点设置里改,所以每次请求现读;返回 false 表示超限。
// 单独实现是因为中转要返回 OpenAI 格式的错误体,而不是控制台的 {success:false}。
export function consumeRelayQuota(key, windowMs, max) {
  if (!(max > 0)) return true
  const bucketKey = `relay:${key}`
  const now = Date.now()
  const arr = (buckets.get(bucketKey) || []).filter(t => now - t < windowMs)
  if (arr.length >= max) return false
  arr.push(now)
  buckets.set(bucketKey, arr)
  return true
}
