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
import relayRoutes from './relay.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.disable('x-powered-by')
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Referrer-Policy', 'no-referrer')
  next()
})
app.use(cors())
app.use(express.json({ limit: '32mb' }))

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

// OpenAI 兼容中转入口
app.use('/v1', relayRoutes)

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

app.listen(PORT, () => {
  console.log(`[RouteX] listening on http://localhost:${PORT}`)
})
