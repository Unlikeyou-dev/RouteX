import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Eye, EyeOff } from 'lucide-react'
import { api, fmtUSD, fmtTime } from '../api.js'
import { toast } from '../store.jsx'
import { Modal, PageHeader, Spinner, Empty, StatusChip, CopyButton, Switch } from '../components/ui.jsx'

const emptyForm = { name: '', unlimited: true, quota: 5 }

export default function Tokens() {
  const [rows, setRows] = useState(null)
  const [modal, setModal] = useState(null) // {mode:'create'|'edit', row?}
  const [form, setForm] = useState(emptyForm)
  const [revealed, setRevealed] = useState({})
  const [busy, setBusy] = useState(false)

  const load = () => api('/tokens').then(setRows).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setModal({ mode: 'create' })
  }
  const openEdit = row => {
    setForm({ name: row.name, unlimited: !!row.unlimited, quota: row.quota || 5 })
    setModal({ mode: 'edit', row })
  }

  const submit = async () => {
    if (!form.name.trim()) return toast('请填写令牌名称', 'error')
    setBusy(true)
    try {
      if (modal.mode === 'create') {
        await api('/tokens', { method: 'POST', body: form })
        toast('令牌创建成功', 'success')
      } else {
        await api(`/tokens/${modal.row.id}`, { method: 'PUT', body: form })
        toast('令牌已更新', 'success')
      }
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
      await api(`/tokens/${row.id}`, { method: 'PUT', body: { status: row.status ? 0 : 1 } })
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const remove = async row => {
    if (!confirm(`确定删除令牌「${row.name}」吗?使用该令牌的应用将立即失效。`)) return
    try {
      await api(`/tokens/${row.id}`, { method: 'DELETE' })
      toast('已删除', 'success')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const maskKey = key => key.slice(0, 7) + '••••••••' + key.slice(-4)

  return (
    <div className="animate-fade-up">
      <PageHeader title="API 令牌" desc="创建密钥接入你的应用,支持独立限额与启停控制。">
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={16} /> 新建令牌
        </button>
      </PageHeader>

      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty text="还没有令牌,点击右上角「新建令牌」开始接入" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">名称</th>
                  <th className="th">密钥</th>
                  <th className="th">额度</th>
                  <th className="th">已用</th>
                  <th className="th">最后使用</th>
                  <th className="th">状态</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(row => (
                  <tr key={row.id} className="transition hover:bg-panel/60">
                    <td className="td font-medium text-ink">{row.name}</td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1 font-mono text-[13px]">
                        {revealed[row.id] ? row.key : maskKey(row.key)}
                        <button
                          className="rounded p-1 text-ink-mute hover:text-ink"
                          onClick={() => setRevealed(r => ({ ...r, [row.id]: !r[row.id] }))}
                        >
                          {revealed[row.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <CopyButton text={row.key} />
                      </span>
                    </td>
                    <td className="td">{row.unlimited ? '无限制' : fmtUSD(row.quota, 2)}</td>
                    <td className="td">{fmtUSD(row.used_quota)}</td>
                    <td className="td">{fmtTime(row.last_used_at)}</td>
                    <td className="td">
                      <button onClick={() => toggle(row)}>
                        <StatusChip ok={row.status === 1} />
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

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'create' ? '新建 API 令牌' : '编辑令牌'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">令牌名称</label>
            <input
              className="input"
              placeholder="例如:我的翻译应用"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3">
            <div>
              <div className="text-sm font-medium">不限额度</div>
              <div className="text-xs text-ink-mute">关闭后可为该令牌单独设置消费上限</div>
            </div>
            <Switch checked={form.unlimited} onChange={v => setForm(f => ({ ...f, unlimited: v }))} />
          </div>
          {!form.unlimited && (
            <div>
              <label className="label">额度上限(美元)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.5"
                value={form.quota}
                onChange={e => setForm(f => ({ ...f, quota: e.target.value }))}
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {modal?.mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
