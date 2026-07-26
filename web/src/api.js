const TOKEN_KEY = 'routex_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = t => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let data = null
  try { data = await res.json() } catch { /* 非 JSON 响应 */ }
  if (res.status === 401 && getToken()) {
    clearToken()
    window.location.href = '/login'
    throw new Error('登录已过期')
  }
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || `请求失败 (${res.status})`)
  }
  return data?.data
}

export const fmtUSD = (n, digits = 4) => {
  const v = Number(n) || 0
  return '$' + v.toFixed(v >= 100 ? 2 : digits)
}

export const fmtNum = n => {
  const v = Number(n) || 0
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
  return String(v)
}

export const fmtTime = ts => {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const p = x => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
