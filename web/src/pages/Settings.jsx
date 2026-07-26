import { useEffect, useState } from 'react'
import { Save, Plus, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { toast, useAuth } from '../store.jsx'
import { PageHeader, Spinner } from '../components/ui.jsx'

export default function Settings() {
  const { refresh } = useAuth()
  const [form, setForm] = useState(null)
  const [pwd, setPwd] = useState({ old_password: '', new_password: '' })
  const [groups, setGroups] = useState([])
  const [newGroup, setNewGroup] = useState({ name: '', ratio: 0.9 })
  const [busy, setBusy] = useState(false)

  const loadGroups = () => api('/groups').then(setGroups).catch(() => {})
  useEffect(() => {
    api('/settings').then(setForm).catch(e => toast(e.message, 'error'))
    loadGroups()
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

  const saveRatio = async (name, ratio) => {
    try {
      await api(`/groups/${name}`, { method: 'PUT', body: { ratio: Number(ratio) } })
      toast(`分组 ${name} 已更新`, 'success')
      loadGroups()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const addGroup = async () => {
    try {
      await api('/groups', { method: 'POST', body: newGroup })
      toast('分组已创建', 'success')
      setNewGroup({ name: '', ratio: 0.9 })
      loadGroups()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const removeGroup = async name => {
    if (!confirm(`删除分组「${name}」?其中的用户将回到 default 组。`)) return
    try {
      await api(`/groups/${name}`, { method: 'DELETE' })
      loadGroups()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  if (!form) return <Spinner />
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="animate-fade-up">
      <PageHeader title="站点设置" desc="配置站点信息、计费倍率、分组与邀请返利。" />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
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
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">计费倍率</label>
                <input className="input" type="number" step="0.1" min="0.1" value={form.price_ratio} onChange={set('price_ratio')} />
              </div>
              <div>
                <label className="label">注册赠送($)</label>
                <input className="input" type="number" step="0.1" min="0" value={form.signup_bonus} onChange={set('signup_bonus')} />
              </div>
              <div>
                <label className="label">邀请返利(%)</label>
                <input className="input" type="number" step="1" min="0" value={form.aff_rebate_percent} onChange={set('aff_rebate_percent')} />
              </div>
            </div>
            <p className="text-xs leading-5 text-ink-mute">
              最终价格 = 基础价 × 计费倍率 × 用户分组倍率;被邀请人每次兑换充值,邀请人按比例得返利。
            </p>
            <button className="btn-primary" onClick={save} disabled={busy}>
              <Save size={15} /> 保存设置
            </button>
          </div>

          <div className="card space-y-4 p-6">
            <h3 className="card-title">修改密码</h3>
            <div className="grid grid-cols-2 gap-4">
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
            </div>
            <button className="btn-primary" onClick={changePwd} disabled={busy}>修改密码</button>
          </div>
        </div>

        <div className="card self-start p-6">
          <h3 className="card-title">用户分组与倍率</h3>
          <p className="mb-4 mt-1 text-xs text-ink-mute">
            按分组差异化定价:批发客户可给更低倍率。用户的分组在「用户管理」中指派。
          </p>
          <div className="space-y-2.5">
            {groups.map(g => (
              <div key={g.name} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-2.5">
                <span className="w-28 truncate text-sm font-medium">{g.name}</span>
                <span className="text-xs text-ink-mute">{g.user_count} 人</span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-ink-mute">倍率 ×</span>
                  <input
                    className="input !w-20 !px-2 !py-1 text-right tabular-nums"
                    type="number"
                    step="0.05"
                    min="0.05"
                    defaultValue={g.ratio}
                    onBlur={e => Number(e.target.value) !== g.ratio && saveRatio(g.name, e.target.value)}
                  />
                  {g.name !== 'default' && (
                    <button
                      className="rounded-lg p-1.5 text-ink-mute hover:bg-white hover:text-bad"
                      onClick={() => removeGroup(g.name)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
            <input
              className="input flex-1"
              placeholder="新分组名,如 wholesale"
              value={newGroup.name}
              onChange={e => setNewGroup(g => ({ ...g, name: e.target.value }))}
            />
            <input
              className="input !w-24 text-right tabular-nums"
              type="number"
              step="0.05"
              min="0.05"
              value={newGroup.ratio}
              onChange={e => setNewGroup(g => ({ ...g, ratio: e.target.value }))}
            />
            <button className="btn-primary !px-3" onClick={addGroup} disabled={!newGroup.name.trim()}>
              <Plus size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
