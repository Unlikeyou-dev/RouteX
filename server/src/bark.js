// Bark(iOS)推送 —— 只用于「有人提交充值待确认」这类运营通知。
// 原则:fire-and-forget。推送是锦上添花,绝不能因为它失败或变慢而影响下单/入账主流程。
import { getSetting } from './db.js'

const TIMEOUT_MS = 5000

export function barkConfigured() {
  return !!getSetting('bark_key', '').trim()
}

// 返回 Promise 仅供「测试推送」按钮 await;业务代码请直接调用,不要 await。
export async function barkPush({ title, body, group = 'RouteX', level = 'timeSensitive', url, sound }) {
  const key = getSetting('bark_key', '').trim()
  if (!key) return { ok: false, message: '未配置 Bark Key' }
  const server = (getSetting('bark_server', 'https://api.day.app') || 'https://api.day.app')
    .trim().replace(/\/+$/, '')

  try {
    const resp = await fetch(`${server}/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ title, body, group, level, url, sound }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    const text = await resp.text().catch(() => '')
    if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}: ${text.slice(0, 200)}` }
    // Bark 返回 {"code":200,...},非 200 也算失败
    try {
      const json = JSON.parse(text)
      if (json.code && json.code !== 200) return { ok: false, message: json.message || `code ${json.code}` }
    } catch { /* 非 JSON 响应按成功处理 */ }
    return { ok: true, message: '' }
  } catch (e) {
    return { ok: false, message: e.message || '推送失败' }
  }
}

// 业务代码用这个:永不抛异常、永不阻塞调用方
export function notify(payload) {
  barkPush(payload)
    .then(r => { if (!r.ok && r.message !== '未配置 Bark Key') console.warn('[RouteX] Bark 推送失败:', r.message) })
    .catch(() => {})
}
