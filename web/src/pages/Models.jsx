import { useEffect, useState } from 'react'
import { Search, Pencil, Plus } from 'lucide-react'
import { api } from '../api.js'
import { useAuth, toast } from '../store.jsx'
import { PageHeader, Spinner, Empty, StatusChip, Modal } from '../components/ui.jsx'

export default function Models() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null) // {model, input, output, isNew}
  const [busy, setBusy] = useState(false)

  const load = () => api('/models').then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])

  const openEdit = r => setModal({
    model: r.model, isNew: false,
    input: r.base_input_price ?? r.input_price,
    output: r.base_output_price ?? r.output_price
  })
  const openCreate = () => setModal({ model: '', isNew: true, input: 1, output: 2 })

  const submit = async () => {
    if (!modal.model.trim()) return toast('请填写模型名', 'error')
    setBusy(true)
    try {
      await api('/models/price', {
        method: 'PUT',
        body: { model: modal.model.trim(), input_price: Number(modal.input), output_price: Number(modal.output) }
      })
      toast('定价已保存', 'success')
      setModal(null)
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const filtered = rows?.filter(r => r.model.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="animate-fade-up">
      <PageHeader title="模型价格" desc="所有价格为每 100 万 tokens 的费用,按实际用量计费。">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input className="input !w-56 !pl-9" placeholder="搜索模型" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={16} /> 添加定价
          </button>
        )}
      </PageHeader>

      {!rows ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty text="没有匹配的模型" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">模型</th>
                  <th className="th-r">输入价格 / 1M</th>
                  <th className="th-r">输出价格 / 1M</th>
                  <th className="th">状态</th>
                  {isAdmin && <th className="th text-right">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filtered.map(r => (
                  <tr key={r.model} className="transition hover:bg-panel/60">
                    <td className="td font-mono text-[13px] text-ink">{r.model}</td>
                    <td className="td-r">${r.input_price.toFixed(2)}</td>
                    <td className="td-r">${r.output_price.toFixed(2)}</td>
                    <td className="td">
                      <StatusChip ok={r.available} onText="可用" offText="未上架" />
                    </td>
                    {isAdmin && (
                      <td className="td text-right">
                        <button className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-ink" onClick={() => openEdit(r)}>
                          <Pencil size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.isNew ? '添加模型定价' : `编辑定价:${modal?.model}`}>
        <div className="space-y-4">
          {modal?.isNew && (
            <div>
              <label className="label">模型名</label>
              <input
                className="input font-mono"
                placeholder="例如 gpt-4o-2024-11-20"
                value={modal.model}
                onChange={e => setModal(m => ({ ...m, model: e.target.value }))}
                autoFocus
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">输入基础价($ / 1M)</label>
              <input
                className="input text-right tabular-nums"
                type="number"
                step="0.01"
                min="0"
                value={modal?.input ?? 0}
                onChange={e => setModal(m => ({ ...m, input: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">输出基础价($ / 1M)</label>
              <input
                className="input text-right tabular-nums"
                type="number"
                step="0.01"
                min="0"
                value={modal?.output ?? 0}
                onChange={e => setModal(m => ({ ...m, output: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-xs text-ink-mute">这里填基础价;用户实际看到的价格会再乘以站点倍率与其分组倍率。</p>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>保存</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
