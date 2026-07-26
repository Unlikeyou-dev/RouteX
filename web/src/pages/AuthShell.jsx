import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import { api } from '../api.js'
import { useAuth } from '../store.jsx'

export default function AuthShell({ mode }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const { login } = useAuth()
  const [form, setForm] = useState({ username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setError('')
    if (!isLogin && form.password !== form.confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const data = await api(`/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        body: { username: form.username.trim(), password: form.password }
      })
      login(data.token, data.user)
      navigate('/console')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4">
      <div className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-full" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[640px] -translate-x-1/2 rounded-full bg-brand-600/20 blur-[130px]" />

      <div className="card relative w-full max-w-md p-8 animate-fade-up">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Link to="/">
            <Logo size={40} textClass="text-xl" />
          </Link>
          <p className="text-sm text-ink-mute">
            {isLogin ? '欢迎回来,继续你的 AI 之旅' : '创建账号,注册即送体验额度'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">用户名</label>
            <input
              className="input"
              placeholder="3-30 位字母、数字或下划线"
              value={form.username}
              onChange={set('username')}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">密码</label>
            <input
              className="input"
              type="password"
              placeholder={isLogin ? '请输入密码' : '至少 6 位'}
              value={form.password}
              onChange={set('password')}
              required
            />
          </div>
          {!isLogin && (
            <div>
              <label className="label">确认密码</label>
              <input
                className="input"
                type="password"
                placeholder="再次输入密码"
                value={form.confirm}
                onChange={set('confirm')}
                required
              />
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">{error}</div>
          )}
          <button className="btn-primary w-full !py-3" disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {isLogin ? '登 录' : '注 册'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-mute">
          {isLogin ? (
            <>
              还没有账号?{' '}
              <Link to="/register" className="text-brand-400 hover:text-brand-300">立即注册</Link>
            </>
          ) : (
            <>
              已有账号?{' '}
              <Link to="/login" className="text-brand-400 hover:text-brand-300">直接登录</Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
