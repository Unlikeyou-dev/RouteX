import { useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { api, fmtUSD, fmtNum, fmtTime } from '../api.js'
import { toast } from '../store.jsx'
import { Modal, PageHeader, Spinner, StatusChip } from '../components/ui.jsx'

export default function Users() {
  const [rows, setRows] = useState(null)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ quota: 0, role: 'user' })
  const [busy, setBusy] = useState(false)

  const load = () => api('/users').then(setRows).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])

  const openEdit = row => {
    setForm({ quota: row.quota, role: row.role })
    setModal(row)
  }

  const submit = async () => {
    setBusy(true)
    try {
      await api(`/users/${modal.id}`, { method: 'PUT', body: { quota: Number(form.quota), role: form.role } })
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
          <div>
            <label className="label">角色</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>保存</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
