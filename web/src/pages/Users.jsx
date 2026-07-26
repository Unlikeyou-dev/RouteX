import { useEffect, useState } from 'react'
import { Pencil, Trash2, KeyRound, Check } from 'lucide-react'
import { api, fmtUSD, fmtNum, fmtTime } from '../api.js'
import { toast } from '../store.jsx'
import { Modal, PageHeader, Spinner, StatusChip, CopyButton } from '../components/ui.jsx'

export default function Users() {
  const [rows, setRows] = useState(null)
  const [groups, setGroups] = useState([])
  const [resets, setResets] = useState([])
  const [modal, setModal] = useState(null)
  const [reset, setReset] = useState(null)   // 重置结果:{username, password}
  const [form, setForm] = useState({ quota: 0, role: 'user', group_name: 'default' })
  const [busy, setBusy] = useState(false)

  const load = () => api('/users').then(setRows).catch(e => toast(e.message, 'error'))
  const loadResets = () => api('/users/resets').then(setResets).catch(() => {})
  useEffect(() => {
    load()
    loadResets()
    api('/groups').then(setGroups).catch(() => {})
  }, [])

  const resetPassword = async row => {
    if (!confirm(`确定重置「${row.username}」的密码吗?\n该用户在所有设备上的登录会立即失效。`)) return
    try {
      const data = await api(`/users/${row.id}/reset-password`, { method: 'POST', body: {} })
      setReset(data)
      loadResets()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const markDone = async id => {
    try {
      await api(`/users/resets/${id}/done`, { method: 'POST', body: {} })
      loadResets()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const pendingResets = resets.filter(r => r.status === 'pending')

  const openEdit = row => {
    setForm({ quota: row.quota, role: row.role, group_name: row.group_name || 'default' })
    setModal(row)
  }

  const submit = async () => {
    setBusy(true)
    try {
      await api(`/users/${modal.id}`, {
        method: 'PUT',
        body: { quota: Number(form.quota), role: form.role, group_name: form.group_name }
      })
      toast('用户已更新', 'success')
      setModal(null)
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async row => {
    try {
      await api(`/users/${row.id}`, { method: 'PUT', body: { status: row.status ? 0 : 1 } })
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const remove = async row => {
    if (!confirm(`确定删除用户「${row.username}」吗?其令牌与日志将一并删除。`)) return
    try {
      await api(`/users/${row.id}`, { method: 'DELETE' })
      toast('已删除', 'success')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="用户管理" desc="管理注册用户的额度、角色与状态。" />

      {pendingResets.length > 0 && (
        <div className="card mb-5 overflow-hidden">
          <h3 className="card-title flex items-center gap-2 border-b border-line px-6 py-4">
            <KeyRound size={16} className="text-warn" /> 密码找回申请
            <span className="chip bg-warnbg text-warn">{pendingResets.length}</span>
          </h3>
          <div className="divide-y divide-line/60">
            {pendingResets.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                <span className="font-medium text-ink">{r.username}</span>
                <span className="text-ink-dim">{r.contact || <span className="text-ink-mute">未留联系方式</span>}</span>
                <span className="tabular-nums text-ink-mute">{fmtTime(r.created_at)}</span>
                <div className="ml-auto flex gap-2">
                  {rows?.find(u => u.username === r.username) && (
                    <button
                      className="btn-primary !px-3 !py-1.5 !text-[13px]"
                      onClick={() => resetPassword(rows.find(u => u.username === r.username))}
                    >
                      <KeyRound size={14} /> 重置密码
                    </button>
                  )}
                  <button className="btn-ghost !px-3 !py-1.5 !text-[13px]" onClick={() => markDone(r.id)}>
                    <Check size={14} /> 已处理
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!rows ? (
        <Spinner />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th-r">ID</th>
                  <th className="th">用户名</th>
                  <th className="th">角色</th>
                  <th className="th">分组</th>
                  <th className="th-r">余额</th>
                  <th className="th-r">已消耗</th>
                  <th className="th-r">请求数</th>
                  <th className="th">注册时间</th>
                  <th className="th">状态</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(row => (
                  <tr key={row.id} className="transition hover:bg-panel/60">
                    <td className="td-r">{row.id}</td>
                    <td className="td font-medium text-ink">{row.username}</td>
                    <td className="td">
                      {row.role === 'admin' ? (
                        <span className="chip bg-brand-50 text-brand-700">管理员</span>
                      ) : (
                        <span className="chip bg-panel text-ink-dim">用户</span>
                      )}
                    </td>
                    <td className="td">
                      <span className="chip bg-panel text-ink-dim">{row.group_name || 'default'}</span>
                    </td>
                    <td className="td-r">{fmtUSD(row.quota, 2)}</td>
                    <td className="td-r">{fmtUSD(row.used_quota)}</td>
                    <td className="td-r">{fmtNum(row.request_count)}</td>
                    <td className="td tabular-nums">{fmtTime(row.created_at)}</td>
                    <td className="td">
                      <button onClick={() => toggle(row)}>
                        <StatusChip ok={row.status === 1} onText="正常" offText="封禁" />
                      </button>
                    </td>
                    <td className="td text-right">
                      <button
                        className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-brand-600"
                        title="重置密码"
                        onClick={() => resetPassword(row)}
                      >
                        <KeyRound size={15} />
                      </button>
                      <button className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-ink" onClick={() => openEdit(row)}>
                        <Pencil size={15} />
                      </button>
                      <button className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-bad" onClick={() => remove(row)}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={`编辑用户:${modal?.username || ''}`}>
        <div className="space-y-4">
          <div>
            <label className="label">余额(美元)</label>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.quota}
              onChange={e => setForm(f => ({ ...f, quota: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">角色</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div>
              <label className="label">计费分组</label>
              <select className="input" value={form.group_name} onChange={e => setForm(f => ({ ...f, group_name: e.target.value }))}>
                {groups.map(g => (
                  <option key={g.name} value={g.name}>{g.name}(×{g.ratio})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>保存</button>
          </div>
        </div>
      </Modal>

      {/* 临时密码只在这里显示一次,关掉就查不回来了 */}
      <Modal open={!!reset} onClose={() => setReset(null)} title="密码已重置">
        <div className="space-y-4">
          <p className="text-sm leading-6 text-ink-dim">
            已为「<b className="text-ink">{reset?.username}</b>」生成新密码,该用户在所有设备上的登录已失效。
            请把下面这串发给对方,并提醒 TA 登录后尽快修改。
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3">
            <span className="flex-1 select-all font-mono text-[15px] tracking-wide text-ink">{reset?.password}</span>
            <CopyButton text={reset?.password || ''} />
          </div>
          <div className="rounded-xl border border-amber-200 bg-warnbg px-4 py-3 text-[13px] leading-6 text-warn">
            这串密码只显示这一次,关掉窗口后无法再查看 —— 现在就复制走。
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setReset(null)}>我已复制</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
