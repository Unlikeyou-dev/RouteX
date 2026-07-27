// 需要走真实 HTTP 的测试(权限、路由、中间件)用这个起一个进程内实例。
//
// 直接 import src/index.js 会连带启动巡检、备份和固定端口监听,不适合测试;
// 这里只把路由重新挂一遍,拿到一个干净的 app。端口交给系统分配,避免并发跑测试时打架。
import express from 'express'
import http from 'node:http'

export async function startServer() {
  const authRoutes = (await import('../src/routes/auth.js')).default
  const userRoutes = (await import('../src/routes/user.js')).default
  const usersRoutes = (await import('../src/routes/users.js')).default
  const ticketRoutes = (await import('../src/routes/tickets.js')).default
  const settingsRoutes = (await import('../src/routes/settings.js')).default
  const topupRoutes = (await import('../src/routes/topup.js')).default

  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use('/api/auth', authRoutes)
  app.use('/api/user', userRoutes)
  app.use('/api/users', usersRoutes)
  app.use('/api/tickets', ticketRoutes)
  app.use('/api/settings', settingsRoutes)
  app.use('/api/topup', topupRoutes)

  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const call = async (method, path, token, body) => {
    const resp = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const text = await resp.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON 响应保持 null */ }
    return { status: resp.status, json, text }
  }

  return {
    base,
    close: () => new Promise(resolve => server.close(resolve)),
    get: (path, token) => call('GET', path, token),
    post: (path, token, body) => call('POST', path, token, body ?? {}),
    put: (path, token, body) => call('PUT', path, token, body ?? {}),
    async login(username, password) {
      const r = await call('POST', '/api/auth/login', null, { username, password })
      if (!r.json?.data?.token) throw new Error(`登录失败:${r.text}`)
      return r.json.data.token
    },
    async register(username, password) {
      const r = await call('POST', '/api/auth/register', null, { username, password })
      if (!r.json?.data?.token) throw new Error(`注册失败:${r.text}`)
      return r.json.data.token
    }
  }
}
