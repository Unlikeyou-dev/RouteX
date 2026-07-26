import { useEffect, useState } from 'react'
import { Search, Pencil, Plus, AlertTriangle, Wand2 } from 'lucide-react'
import { api } from '../api.js'
import { useAuth, toast } from '../store.jsx'
import { PageHeader, Spinner, Empty, StatusChip, Modal } from '../components/ui.jsx'

export default function Models() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')
  const [modal, setModal] = useState(null)   // {model, input, output, isNew}
  const [batch, setBatch] = useState(null)   // 批量定价:待定价行数组
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

  const openBatch = async () => {
    try {
      const list = await api('/models/unpriced')
      if (!list.length) return toast('所有模型都已定价', 'success')
      setBatch(list.map(r => ({ model: r.model, input: r.suggested_input, output: r.suggested_output })))
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const saveBatch = async () => {
    setBusy(true)
    try {
      const res = await api('/models/price/batch', {
        method: 'PUT',
        body: {
          items: batch.map(r => ({
            model: r.model, input_price: Number(r.input), output_price: Number(r.output)
          }))
        }
      })
      toast(`已为 ${res.saved} 个模型定价`, 'success')
      setBatch(null)
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const unpriced = rows?.filter(r => isAdmin && !r.priced && r.channel_count > 0) || []
  const orphans = rows?.filter(r => isAdmin && r.orphan) || []

  const byTab = (rows || []).filter(r => {
    if (!isAdmin) return true
    if (tab === 'unpriced') return !r.priced && r.channel_count > 0
    if (tab === 'orphan') return r.orphan
    return true
  })
  const filtered = byTab.filter(r => r.model.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="animate-fade-up">
      <PageHeader title="模型价格" desc="模型清单来自各渠道实际提供的模型;价格为每 100 万 tokens 的费用。">
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

      {/* 未定价预警:这些模型正在按兜底价计费,卖亏了都不知道 */}
      {isAdmin && unpriced.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-warnbg px-4 py-3.5">
          <AlertTriangle size={18} className="shrink-0 text-warn" />
          <div className="flex-1 text-sm leading-6 text-warn">
            有 <b>{unpriced.length}</b> 个模型渠道已提供但还没定价,正在按兜底价 <b>$1 / $2</b> 计费 ——
            如果其中有贵模型,每一次调用都在亏。
          </div>
          <button className="btn-primary !py-2" onClick={openBatch}>
            <Wand2 size={15} /> 批量定价
          </button>
        </div>
      )}

      {isAdmin && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: 'all', label: `全部 ${rows?.length ?? 0}` },
            { key: 'unpriced', label: `未定价 ${unpriced.length}` },
            { key: 'orphan', label: `无渠道 ${orphans.length}` }
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                tab === t.key ? 'bg-brand-600 text-white' : 'border border-line bg-card text-ink-dim hover:bg-panel'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!rows ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty text={rows.length === 0 ? '还没有模型 —— 先去「上游渠道」添加渠道并选择模型' : '没有匹配的模型'} />
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
                  {isAdmin && <th className="th-r">渠道数</th>}
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
                    {isAdmin && (
                      <td className="td-r">
                        {r.channel_count > 0 ? r.channel_count : <span className="text-ink-mute">0</span>}
                      </td>
                    )}
                    <td className="td">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusChip ok={r.available} onText="可用" offText="未上架" />
                        {isAdmin && !r.priced && r.channel_count > 0 && (
                          <span className="chip bg-warnbg text-warn" title="没有定价,正在按兜底价计费">未定价</span>
                        )}
                        {isAdmin && r.priced && r.price_source === 'prefix' && (
                          <span className="chip bg-panel text-ink-mute" title={`继承自定价规则「${r.matched_price_rule}」`}>
                            继承 {r.matched_price_rule}
                          </span>
                        )}
                      </span>
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

      {/* 单个定价 */}
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

      {/* 批量定价 */}
      <Modal open={!!batch} onClose={() => setBatch(null)} title="批量定价" width="max-w-2xl">
        <div className="space-y-4">
          <p className="text-[13px] leading-6 text-ink-dim">
            下面是渠道已提供但还没定价的模型。价格是按模型名从内置价格库猜的<b>建议值</b>,
            请逐个核对再保存 —— 猜错了就是真金白银。
          </p>
          <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-line">
            <table className="w-full">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  <th className="th">模型</th>
                  <th className="th-r">输入价 / 1M</th>
                  <th className="th-r">输出价 / 1M</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {(batch || []).map((r, i) => (
                  <tr key={r.model}>
                    <td className="td font-mono text-[13px] text-ink">{r.model}</td>
                    <td className="td-r">
                      <input
                        className="input !w-24 !px-2 !py-1 text-right tabular-nums"
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.input}
                        onChange={e => setBatch(b => b.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))}
                      />
                    </td>
                    <td className="td-r">
                      <input
                        className="input !w-24 !px-2 !py-1 text-right tabular-nums"
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.output}
                        onChange={e => setBatch(b => b.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setBatch(null)}>取消</button>
            <button className="btn-primary" onClick={saveBatch} disabled={busy}>
              保存 {batch?.length} 个定价
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
