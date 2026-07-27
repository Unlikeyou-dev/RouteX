import { useState } from 'react'
import { KeyRound, Mail, ShieldCheck, User as UserIcon, Loader2 } from 'lucide-react'
import { api, setToken, fmtTime, fmtUSD } from '../api.js'
import { toast, useAuth } from '../store.jsx'
import { PageHeader, Spinner, CopyButton } from '../components/ui.jsx'

export default function Account() {
  const { user, refresh } = useAuth()
  const [email, setEmail] = useState(null)     // null = 还没动过,用账号里的值
  const [pwd, setPwd] = useState({ old_password: '', new_password: '', confirm: '' })
  const [busyEmail, setBusyEmail] = useState(false)
  const [busyPwd, setBusyPwd] = useState(false)

  if (!user) return <Spinner />

  const emailValue = email === null ? (user.email || '') : email

  const saveEmail = async () => {
    setBusyEmail(true)
    try {
      await api('/user/me', { method: 'PUT', body: { email: emailValue.trim() } })
      await refresh()
      setEmail(null)
      toast('联系邮箱已保存', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusyEmail(false)
    }
  }

  const savePwd = async () => {
    if (pwd.new_password.length < 6) return toast('新密码至少 6 位', 'error')
    if (pwd.new_password !== pwd.confirm) return toast('两次输入的新密码不一致', 'error')
    setBusyPwd(true)
    try {
      // 改密码会让所有已签发的登录失效,后端顺手换发一张新的,
      // 不换上它自己这一步就会被踢下线
      const data = await api('/user/me', {
        method: 'PUT',
        body: { old_password: pwd.old_password, new_password: pwd.new_password }
      })
      if (data.token) setToken(data.token)
      await refresh()
      setPwd({ old_password: '', new_password: '', confirm: '' })
      toast('密码已修改,其他设备上的登录已失效', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusyPwd(false)
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="账号设置" desc="修改密码、联系方式,查看账号信息。" />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card space-y-4 p-6">
          <h3 className="card-title flex items-center gap-2">
            <UserIcon size={16} className="text-brand-600" /> 账号信息
          </h3>
          <dl className="space-y-3 text-sm">
            <Row label="用户名" value={user.username} />
            <Row label="计费分组" value={<span className="chip bg-panel text-ink-dim">{user.group_name || 'default'}</span>} />
            <Row label="当前余额" value={<span className="font-medium tabular-nums">{fmtUSD(user.quota, 2)}</span>} />
            <Row label="累计消费" value={<span className="tabular-nums">{fmtUSD(user.used_quota)}</span>} />
            <Row label="注册时间" value={<span className="tabular-nums text-ink-dim">{fmtTime(user.created_at)}</span>} />
            <Row
              label="邀请码"
              value={
                <span className="flex items-center gap-1.5">
                  <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs">{user.invite_code || '—'}</code>
                  {user.invite_code && <CopyButton text={user.invite_code} />}
                </span>
              }
            />
          </dl>
        </div>

        <div className="card space-y-4 p-6">
          <h3 className="card-title flex items-center gap-2">
            <Mail size={16} className="text-brand-600" /> 联系邮箱
          </h3>
          <p className="-mt-2 text-xs leading-5 text-ink-mute">
            忘记密码时站长靠它联系你。站点没有邮件服务,不会给你发任何邮件。
          </p>
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={emailValue}
            onChange={e => setEmail(e.target.value)}
          />
          <button className="btn-primary" onClick={saveEmail} disabled={busyEmail}>
            {busyEmail ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} 保存
          </button>
        </div>

        <div className="card space-y-4 p-6 lg:col-span-2">
          <h3 className="card-title flex items-center gap-2">
            <KeyRound size={16} className="text-brand-600" /> 修改密码
          </h3>
          <p className="-mt-2 flex items-start gap-1.5 text-xs leading-5 text-ink-mute">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ok" />
            改完之后,你在其他设备上的登录会立即失效 —— 当前这台会自动续上,不用重新登录。
            <b className="text-ink-dim">API 令牌不受影响,不用改代码。</b>
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">当前密码</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={pwd.old_password}
                onChange={e => setPwd(p => ({ ...p, old_password: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">新密码</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="至少 6 位"
                value={pwd.new_password}
                onChange={e => setPwd(p => ({ ...p, new_password: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">确认新密码</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={pwd.confirm}
                onChange={e => setPwd(p => ({ ...p, confirm: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && savePwd()}
              />
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={savePwd}
            disabled={busyPwd || !pwd.old_password || !pwd.new_password}
          >
            {busyPwd ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} 修改密码
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-mute">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  )
}
