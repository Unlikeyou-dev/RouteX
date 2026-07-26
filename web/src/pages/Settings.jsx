import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api } from '../api.js'
import { toast, useAuth } from '../store.jsx'
import { PageHeader, Spinner } from '../components/ui.jsx'

export default function Settings() {
  const { refresh } = useAuth()
  const [form, setForm] = useState(null)
  const [pwd, setPwd] = useState({ old_password: '', new_password: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/settings').then(setForm).catch(e => toast(e.message, 'error'))
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      await api('/settings', { method: 'PUT', body: form })
      toast('设置已保存', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const changePwd = async () => {
    if (!pwd.old_password || !pwd.new_password) return toast('请填写完整', 'error')
    setBusy(true)
    try {
      await api('/user/me', { method: 'PUT', body: pwd })
      toast('密码已修改', 'success')
      setPwd({ old_password: '', new_password: '' })
      refresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!form) return <Spinner />
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="animate-fade-up">
      <PageHeader title="站点设置" desc="配置站点信息、计费倍率与注册福利。" />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card space-y-4 p-6">
          <h3 className="card-title">基础信息</h3>
          <div>
            <label className="label">站点名称</label>
            <input className="input" value={form.site_name} onChange={set('site_name')} />
          </div>
          <div>
            <label className="label">公告(展示在首页)</label>
            <textarea className="input min-h-[72px] resize-y" value={form.announcement} onChange={set('announcement')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">计费倍率</label>
              <input className="input" type="number" step="0.1" min="0.1" value={form.price_ratio} onChange={set('price_ratio')} />
              <p className="mt-1.5 text-xs text-ink-mute">最终价格 = 基础价 × 倍率</p>
            </div>
            <div>
              <label className="label">注册赠送额度($)</label>
              <input className="input" type="number" step="0.1" min="0" value={form.signup_bonus} onChange={set('signup_bonus')} />
            </div>
          </div>
          <button className="btn-primary" onClick={save} disabled={busy}>
            <Save size={15} /> 保存设置
          </button>
        </div>

        <div className="card space-y-4 self-start p-6">
          <h3 className="card-title">修改密码</h3>
          <div>
            <label className="label">原密码</label>
            <input
              className="input"
              type="password"
              value={pwd.old_password}
              onChange={e => setPwd(p => ({ ...p, old_password: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">新密码(至少 6 位)</label>
            <input
              className="input"
              type="password"
              value={pwd.new_password}
              onChange={e => setPwd(p => ({ ...p, new_password: e.target.value }))}
            />
          </div>
          <button className="btn-primary" onClick={changePwd} disabled={busy}>修改密码</button>
        </div>
      </div>
    </div>
  )
}
