import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, fmtUSD, fmtTime } from '../api.js'
import { toast } from '../store.jsx'
import { Modal, PageHeader, Spinner, Empty, CopyButton } from '../components/ui.jsx'

export default function Redemptions() {
  const [rows, setRows] = useState(null)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ amount: 5, count: 10 })
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/redemptions').then(setRows).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])

  const submit = async () => {
    setBusy(true)
    try {
      const data = await api('/redemptions', { method: 'POST', body: form })
      setCreated(data)
      setModal(false)
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async row => {
    try {
      await api(`/redemptions/${row.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="兑换码" desc="批量生成兑换码,分发给用户完成充值。">
        <button className="btn-primary" onClick={() => setModal(true)}>
          <Plus size={16} /> 批量生成
        </button>
      </PageHeader>

      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty text="还没有兑换码" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">兑换码</th>
                  <th className="th">面额</th>
                  <th className="th">状态</th>
                  <th className="th">使用者</th>
                  <th className="th">创建时间</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(row => (
                  <tr key={row.id} className="transition hover:bg-white/[0.02]">
                    <td className="td">
                      <span className="inline-flex items-center gap-1 font-mono text-[13px] text-ink">
                        {row.code}
                        <CopyButton text={row.code} />
                      </span>
                    </td>
                    <td className="td">{fmtUSD(row.amount, 2)}</td>
                    <td className="td">
                      {row.status === 'unused' ? (
                        <span className="chip bg-ok/10 text-ok">未使用</span>
                      ) : (
                        <span className="chip bg-white/5 text-ink-mute">已使用</span>
                      )}
                    </td>
                    <td className="td">{row.used_by_name || '—'}</td>
                    <td className="td">{fmtTime(row.created_at)}</td>
                    <td className="td text-right">
                      {row.status === 'unused' && (
                        <button className="rounded-lg p-2 text-ink-mute hover:bg-white/5 hover:text-bad" onClick={() => remove(row)}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="批量生成兑换码">
        <div className="space-y-4">
          <div>
            <label className="label">单张面额(美元)</label>
            <input
              className="input"
              type="number"
              min="0.5"
              step="0.5"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="label">数量(最多 100)</label>
            <input
              className="input"
              type="number"
              min="1"
              max="100"
              value={form.count}
              onChange={e => setForm(f => ({ ...f, count: Number(e.target.value) }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setModal(false)}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>生成</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title={`已生成 ${created?.codes.length} 张兑换码`}>
        <div className="space-y-4">
          <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-panel p-4 font-mono text-[13px] leading-relaxed text-ink-dim">
            {created?.codes.map(c => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <CopyButton text={created?.codes.join('\n') || ''} className="btn-ghost !p-2" />
            <button className="btn-primary" onClick={() => setCreated(null)}>完成</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
