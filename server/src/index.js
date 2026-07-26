import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PORT } from './config.js'
import './db.js'

import authRoutes from './routes/auth.js'
import userRoutes from './routes/user.js'
import tokenRoutes from './routes/tokens.js'
import channelRoutes from './routes/channels.js'
import logRoutes from './routes/logs.js'
import modelRoutes from './routes/models.js'
import redemptionRoutes from './routes/redemptions.js'
import topupRoutes from './routes/topup.js'
import usersRoutes from './routes/users.js'
import settingsRoutes from './routes/settings.js'
import relayRoutes, { inflightRelayCount, geminiRouter } from './relay.js'
import groupsRoutes from './routes/groups.js'
import adminRoutes from './routes/admin.js'
import { startHealthChecker } from './health.js'
import { startMaintenance } from './maintenance.js'
import { db, getSetting } from './db.js'
import { splitList } from './util.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.disable('x-powered-by')
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Referrer-Policy', 'no-referrer')
  next()
})
// CORS 分两档:
// · 中转入口(/v1、/v1beta)必须开放 —— 用户会从浏览器里的应用直连,
//   而且那里的凭据是用户自己的 API Key,不存在被跨站冒用的问题
// · 控制台接口(/api)默认只允许同源。前端和后端是同一个服务托管的,
//   同源请求根本不需要 CORS;把它开放给任意源纯粹是白送攻击面
const relayCors = cors()
const apiCors = (req, res, next) => {
  const origin = req.headers.origin
  if (!origin) return next() // 同源或非浏览器请求
  const allowed = splitList(getSetting('cors_origins', ''))
  if (allowed.includes(origin) || allowed.includes('*')) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Vary', 'Origin')
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
  }
  // 不在白名单里就不发 CORS 头,浏览器自己会拦下来
  next()
}

app.use(express.json({ limit: '32mb' }))

app.use('/api', apiCors)
app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api/tokens', tokenRoutes)
app.use('/api/channels', channelRoutes)
app.use('/api/logs', logRoutes)
app.use('/api/models', modelRoutes)
app.use('/api/redemptions', redemptionRoutes)
app.use('/api/topup', topupRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/groups', groupsRoutes)
app.use('/api/admin', adminRoutes)

// 中转入口:三种入站协议
// /v1      OpenAI 兼容 + Anthropic Messages(/v1/messages)
// /v1beta  Gemini(/v1beta/models/{model}:generateContent)
app.use('/v1', relayCors, relayRoutes)
app.use('/v1beta', relayCors, geminiRouter)

app.get('/api/health', (req, res) => res.json({ success: true, name: 'RouteX', time: Date.now() }))

// 生产环境:托管前端构建产物(SPA 回退)
const webDist = path.join(__dirname, '..', '..', 'web', 'dist')
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get(/^\/(?!api|v1).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')))
}

app.use((err, req, res, next) => {
  console.error('[RouteX]', err)
  res.status(500).json({ success: false, message: '服务器内部错误' })
})

startHealthChecker()
startMaintenance()

const server = app.listen(PORT, () => {
  console.log(`[RouteX] listening on http://localhost:${PORT}`)
})

// ---- 优雅退出 ----
// 直接被杀掉的代价是实打实的:正在中转的请求已经花了上游的钱但还没落账,
// 预扣的额度也会悬空退不回去,用户白白损失。所以先停止接受新连接,
// 等在途中转请求做完,再 checkpoint WAL 并关库。
const SHUTDOWN_GRACE_MS = 30_000
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[RouteX] 收到 ${signal},开始优雅退出…`)

  server.close(() => console.log('[RouteX] 已停止接受新连接'))

  const deadline = Date.now() + SHUTDOWN_GRACE_MS
  while (inflightRelayCount() > 0 && Date.now() < deadline) {
    console.log(`[RouteX] 等待 ${inflightRelayCount()} 个在途中转请求完成…`)
    await new Promise(r => setTimeout(r, 500))
  }
  if (inflightRelayCount() > 0) {
    console.warn(`[RouteX] 仍有 ${inflightRelayCount()} 个请求未完成,超时强制退出`)
  }

  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    console.log('[RouteX] 数据库已安全关闭')
  } catch (e) {
    console.error('[RouteX] 关闭数据库失败:', e.message)
  }
  process.exit(0)
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { shutdown(sig).catch(() => process.exit(1)) })
}
