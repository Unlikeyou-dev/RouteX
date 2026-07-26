import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, PlugZap, Loader2 } from 'lucide-react'
import { api, fmtTime } from '../api.js'
import { toast } from '../store.jsx'
import { Modal, PageHeader, Spinner, Empty, StatusChip } from '../components/ui.jsx'

const emptyForm = {
  name: '', base_url: '', api_key: '', models: '',
  model_mapping: '{}', priority: 0, weight: 1, type: 'openai'
}

const TYPE_META = {
  openai: { label: 'OpenAI 兼容', cls: 'bg-panel text-ink-dim' },
  anthropic: { label: 'Claude 原生', cls: 'bg-brand-50 text-brand-700' },
  gemini: { label: 'Gemini 原生', cls: 'bg-okbg text-ok' }
}

export default function Channels() {
  const [rows, setRows] = useState(null)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState({})

  const load = () => api('/channels').then(setRows).catch(e => toast(e.message, 'error'))
  useEffect(() => { load() }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setModal({ mode: 'create' })
  }
  const openEdit = row => {
    setForm({
      name: row.name, base_url: row.base_url, api_key: row.api_key,
      models: row.models, model_mapping: row.model_mapping,
      priority: row.priority, weight: row.weight, type: row.type || 'openai'
    })
    setModal({ mode: 'edit', row })
  }

  const submit = async () => {
    setBusy(true)
    try {
      if (modal.mode === 'create') {
        await api('/channels', { method: 'POST', body: form })
        toast('渠道已添加', 'success')
      } else {
        await api(`/channels/${modal.row.id}`, { method: 'PUT', body: form })
        toast('渠道已更新', 'success')
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
      await api(`/channels/${row.id}`, { method: 'PUT', body: { status: row.status ? 0 : 1 } })
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const remove = async row => {
    if (!confirm(`确定删除渠道「${row.name}」吗?`)) return
    try {
      await api(`/channels/${row.id}`, { method: 'DELETE' })
      toast('已删除', 'success')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const test = async row => {
    setTesting(t => ({ ...t, [row.id]: true }))
    try {
      const data = await api(`/channels/${row.id}/test`, { method: 'POST', body: {} })
      if (data.ok) toast(`连通正常,延迟 ${data.latency_ms}ms`, 'success')
      else toast(`测试失败:${data.message}`, 'error')
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTesting(t => ({ ...t, [row.id]: false }))
    }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="animate-fade-up">
      <PageHeader title="上游渠道" desc="接入上游中转站或官方 API,按优先级与权重智能调度。">
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={16} /> 添加渠道
        </button>
      </PageHeader>

      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty text="还没有渠道,添加一个上游开始分发" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">渠道</th>
                  <th className="th">类型</th>
                  <th className="th">Base URL</th>
                  <th className="th-r">模型数</th>
                  <th className="th-r">优先级 / 权重</th>
                  <th className="th-r">连通性</th>
                  <th className="th">状态</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(row => {
                  const modelCount = row.models.split(',').filter(m => m.trim()).length
                  return (
                    <tr key={row.id} className="transition hover:bg-panel/60">
                      <td className="td font-medium text-ink">{row.name}</td>
                      <td className="td">
                        <span className={`chip ${(TYPE_META[row.type] || TYPE_META.openai).cls}`}>
                          {(TYPE_META[row.type] || TYPE_META.openai).label}
                        </span>
                      </td>
                      <td className="td max-w-[220px] truncate font-mono text-[13px]">{row.base_url}</td>
                      <td className="td-r">{modelCount}</td>
                      <td className="td-r">{row.priority} / {row.weight}</td>
                      <td className="td-r">
                        {row.last_test_at == null ? (
                          <span className="text-ink-mute">未测试</span>
                        ) : row.last_test_ok ? (
                          <span className="text-ok">{row.latency_ms}ms</span>
                        ) : (
                          <span className="text-bad" title={fmtTime(row.last_test_at)}>异常</span>
                        )}
                      </td>
                      <td className="td">
                        {row.status === 1 && row.auto_disabled === 1 ? (
                          <span className="chip bg-warnbg text-warn" title="连续失败自动熔断,巡检恢复后自动上线">熔断中</span>
                        ) : (
                          <button onClick={() => toggle(row)}>
                            <StatusChip ok={row.status === 1} />
                          </button>
                        )}
                      </td>
                      <td className="td text-right">
                        <button
                          className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-brand-600"
                          title="测试连通性"
                          onClick={() => test(row)}
                          disabled={testing[row.id]}
                        >
                          {testing[row.id] ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
                        </button>
                        <button className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-ink" onClick={() => openEdit(row)}>
                          <Pencil size={15} />
                        </button>
                        <button className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-bad" onClick={() => remove(row)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'create' ? '添加上游渠道' : '编辑渠道'}
        width="max-w-xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">渠道名称</label>
              <input className="input" placeholder="例如:某某中转站" value={form.name} onChange={set('name')} autoFocus />
            </div>
            <div>
              <label className="label">接口协议</label>
              <select className="input" value={form.type} onChange={set('type')}>
                <option value="openai">OpenAI 兼容(中转站/官方)</option>
                <option value="anthropic">Claude 原生(Anthropic API)</option>
                <option value="gemini">Gemini 原生(Google API)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Base URL{form.type === 'openai' ? '(不含 /v1)' : ''}</label>
            <input className="input font-mono" placeholder="https://api.example.com" value={form.base_url} onChange={set('base_url')} />
          </div>
          <div>
            <label className="label">上游 API Key(支持多把,每行一把,请求时随机轮询)</label>
            <textarea
              className="input min-h-[56px] resize-y font-mono !text-[13px]"
              placeholder={'sk-xxxx\nsk-yyyy'}
              value={form.api_key}
              onChange={set('api_key')}
            />
          </div>
          <div>
            <label className="label">支持的模型(逗号分隔)</label>
            <textarea
              className="input min-h-[72px] resize-y font-mono !text-[13px]"
              placeholder="gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514"
              value={form.models}
              onChange={set('models')}
            />
          </div>
          <div>
            <label className="label">模型映射(可选,JSON:请求名 → 上游名)</label>
            <textarea
              className="input min-h-[56px] resize-y font-mono !text-[13px]"
              placeholder='{"gpt-4o": "gpt-4o-2024-11-20"}'
              value={form.model_mapping}
              onChange={set('model_mapping')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">优先级(大者优先)</label>
              <input className="input" type="number" value={form.priority} onChange={set('priority')} />
            </div>
            <div>
              <label className="label">权重(同优先级内分流)</label>
              <input className="input" type="number" min="1" value={form.weight} onChange={set('weight')} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {modal?.mode === 'create' ? '添加' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
