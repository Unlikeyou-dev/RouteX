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

// 手动计数版:返回 false 表示超限。
//
// 中间件版会在**进入处理函数之前**就扣掉一次,也就是说校验失败的请求同样占名额 ——
// 用户把表单填错两次就白白少两次机会。需要「先校验、再计数」的地方用这个。
export function consumeQuota(key, windowMs, max) {
  if (!(max > 0)) return true
  const now = Date.now()
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs)
  if (arr.length >= max) return false
  arr.push(now)
  buckets.set(key, arr)
  return true
}

// 中转入口用:限额可在站点设置里改,所以每次请求现读。
// 单独包一层是因为中转要返回 OpenAI 格式的错误体,而不是控制台的 {success:false}。
export const consumeRelayQuota = (key, windowMs, max) => consumeQuota(`relay:${key}`, windowMs, max)
