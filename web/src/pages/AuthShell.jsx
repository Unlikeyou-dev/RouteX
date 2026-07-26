import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, UserPlus } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import { api } from '../api.js'
import { useAuth } from '../store.jsx'
import { Modal } from '../components/ui.jsx'

// 找回密码:站点没有邮件通道,走「提交申请 → 站长后台重置」的路子,
// 和充值确认是同一套人工流程。
function ForgotModal({ open, onClose }) {
  const [form, setForm] = useState({ username: '', contact: '' })
  const [state, setState] = useState({ busy: false, done: '', error: '' })

  const submit = async e => {
    e.preventDefault()
    setState({ busy: true, done: '', error: '' })
    try {
      const data = await api('/auth/forgot', { method: 'POST', body: form })
      setState({ busy: false, done: data.message, error: '' })
    } catch (err) {
      setState({ busy: false, done: '', error: err.message })
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="找回密码">
      {state.done ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-ink-dim">{state.done}</p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={onClose}>知道了</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-[13px] leading-6 text-ink-mute">
            提交后管理员会收到通知,核实身份后为你重置密码并通过你留下的联系方式告知。
          </p>
          <div>
            <label className="label">用户名</label>
            <input
              className="input"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">联系方式(邮箱 / QQ / 微信,便于管理员联系你)</label>
            <input
              className="input"
              value={form.contact}
              onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
              placeholder="留空的话管理员没法把新密码给你"
            />
          </div>
          {state.error && (
            <div className="rounded-lg border border-red-200 bg-badbg px-3.5 py-2.5 text-sm text-bad">{state.error}</div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
            <button className="btn-primary" disabled={state.busy}>
              {state.busy && <Loader2 size={15} className="animate-spin" />} 提交申请
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export default function AuthShell({ mode }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const { login } = useAuth()
  const [params] = useSearchParams()
  const aff = params.get('aff') || ''
  const [form, setForm] = useState({ username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)

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
        body: { username: form.username.trim(), password: form.password, ...(aff && !isLogin ? { aff } : {}) }
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
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Link to="/">
            <Logo size={40} textClass="text-xl" />
          </Link>
          <p className="text-sm text-ink-mute">
            {isLogin ? '欢迎回来,继续你的 AI 之旅' : '创建账号,注册即送体验额度'}
          </p>
        </div>

        <div className="card p-8">
          {!isLogin && aff && (
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] text-brand-700">
              <UserPlus size={14} /> 你正在通过好友邀请注册
            </div>
          )}
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
              <div className="flex items-baseline justify-between">
                <label className="label">密码</label>
                {isLogin && (
                  <button
                    type="button"
                    className="mb-1.5 text-[13px] text-ink-mute transition-colors hover:text-brand-600"
                    onClick={() => setForgot(true)}
                  >
                    忘记密码?
                  </button>
                )}
              </div>
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
              <div className="rounded-lg border border-red-200 bg-badbg px-3.5 py-2.5 text-sm text-bad">{error}</div>
            )}
            <button className="btn-primary w-full !py-2.5" disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              {isLogin ? '登 录' : '注 册'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-mute">
          {isLogin ? (
            <>
              还没有账号?{' '}
              <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">立即注册</Link>
            </>
          ) : (
            <>
              已有账号?{' '}
              <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">直接登录</Link>
            </>
          )}
        </p>
      </div>
      <ForgotModal open={forgot} onClose={() => setForgot(false)} />
    </div>
  )
}
