import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, PlugZap, Loader2, Zap, Eraser, ListChecks, Check, X, Minus } from 'lucide-react'
import { api, fmtTime, fmtUSD, fmtNum } from '../api.js'
import { toast } from '../store.jsx'
import { Modal, PageHeader, Spinner, Empty, StatusChip } from '../components/ui.jsx'
import { ModelPicker, MappingEditor } from '../components/ModelFields.jsx'

const emptyForm = {
  name: '', base_url: '', api_key: '', models: '',
  model_mapping: '{}', priority: 0, weight: 1, type: 'openai', group_names: 'default'
}

const TYPE_META = {
  openai: { label: 'OpenAI 兼容', cls: 'bg-panel text-ink-dim', official: 'https://api.openai.com' },
  anthropic: { label: 'Claude 原生', cls: 'bg-brand-50 text-brand-700', official: 'https://api.anthropic.com' },
  gemini: { label: 'Gemini 原生', cls: 'bg-okbg text-ok', official: 'https://generativelanguage.googleapis.com' }
}

// 逗号/换行分隔的列表(与后端 splitList 口径一致)
const splitList = s => String(s || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean)

export default function Channels() {
  const [rows, setRows] = useState(null)
  const [groups, setGroups] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState({})
  const [testingAll, setTestingAll] = useState(false)
  const [selected, setSelected] = useState([])
  const [compat, setCompat] = useState(null)

  const load = () =>
    api('/channels')
      .then(data => {
        setRows(data)
        // 丢掉已不存在的选中项,避免批量操作打到幽灵 id
        setSelected(sel => sel.filter(id => data.some(r => r.id === id)))
      })
      .catch(e => toast(e.message, 'error'))

  useEffect(() => {
    load()
    api('/groups').then(setGroups).catch(() => setGroups([]))
  }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setModal({ mode: 'create' })
  }
  const openEdit = row => {
    setForm({
      name: row.name, base_url: row.base_url, api_key: row.api_key,
      models: row.models, model_mapping: row.model_mapping,
      priority: row.priority, weight: row.weight, type: row.type || 'openai',
      group_names: row.group_names || 'default'
    })
    setModal({ mode: 'edit', row })
  }

  const submit = async () => {
    if (!splitList(form.group_names).length) return toast('请至少选择一个服务分组', 'error')
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

  const openCompat = async row => {
    const models = splitList(row.models)
    setCompat({ row, model: models[0] || '', features: [], items: [], loading: true })
    try {
      const data = await api(`/channels/${row.id}/compat`)
      setCompat(c => (c?.row.id === row.id ? { ...c, ...data, loading: false } : c))
    } catch (e) {
      toast(e.message, 'error')
      setCompat(c => (c ? { ...c, loading: false } : c))
    }
  }

  const runCompat = async () => {
    if (!compat?.model) return toast('先选一个模型', 'error')
    setCompat(c => ({ ...c, running: true }))
    try {
      const data = await api(`/channels/${compat.row.id}/compat`, { method: 'POST', body: { model: compat.model } })
      setCompat(c => ({
        ...c,
        running: false,
        items: [...c.items.filter(i => i.model !== data.model), data].sort((a, b) => a.model.localeCompare(b.model))
      }))
      toast(data.results.baseline?.ok ? '自检完成' : '基线未通过,请先检查地址与 Key', data.results.baseline?.ok ? 'success' : 'error')
    } catch (e) {
      toast(e.message, 'error')
      setCompat(c => ({ ...c, running: false }))
    }
  }

  const testAll = async () => {
    setTestingAll(true)
    try {
      const data = await api('/channels/test-all', { method: 'POST', body: {} })
      toast(`测活完成:${data.ok}/${data.total} 个渠道连通正常`, data.ok === data.total ? 'success' : 'info')
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setTestingAll(false)
    }
  }

  const batch = async action => {
    const labels = { enable: '启用', disable: '禁用', delete: '删除' }
    if (action === 'delete' && !confirm(`确定删除选中的 ${selected.length} 个渠道吗?`)) return
    try {
      const data = await api('/channels/batch', { method: 'POST', body: { action, ids: selected } })
      toast(`已${labels[action]} ${data.affected} 个渠道`, 'success')
      setSelected([])
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const purgeDisabled = async () => {
    if (!confirm('确定删除所有「已禁用」的渠道吗?此操作不可撤销。')) return
    try {
      const data = await api('/channels/disabled', { method: 'DELETE' })
      toast(data.affected ? `已清理 ${data.affected} 个禁用渠道` : '没有已禁用的渠道', 'success')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  // 分组多选:点击切换,至少保留一个
  const toggleGroup = name => {
    const cur = splitList(form.group_names)
    const next = cur.includes(name) ? cur.filter(g => g !== name) : [...cur, name]
    setForm(f => ({ ...f, group_names: next.join(',') }))
  }

  const allSelected = rows?.length > 0 && selected.length === rows.length
  const toggleSelectAll = () => setSelected(allSelected ? [] : rows.map(r => r.id))
  const toggleSelect = id =>
    setSelected(sel => (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]))

  return (
    <div className="animate-fade-up">
      <PageHeader title="上游渠道" desc="接入上游中转站或官方 API,按分组、优先级与权重智能调度。">
        <button className="btn-ghost" onClick={testAll} disabled={testingAll || !rows?.length}>
          {testingAll ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 一键测活
        </button>
        <button className="btn-ghost" onClick={purgeDisabled} disabled={!rows?.length}>
          <Eraser size={16} /> 清理禁用
        </button>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={16} /> 添加渠道
        </button>
      </PageHeader>

      {selected.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <span className="text-ink-dim">已选中 {selected.length} 个渠道</span>
          <div className="flex-1" />
          <button className="btn-ghost !py-1.5" onClick={() => batch('enable')}>批量启用</button>
          <button className="btn-ghost !py-1.5" onClick={() => batch('disable')}>批量禁用</button>
          <button className="btn-ghost !py-1.5 !text-bad" onClick={() => batch('delete')}>批量删除</button>
          <button className="btn-ghost !py-1.5" onClick={() => setSelected([])}>取消选择</button>
        </div>
      )}

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
                  <th className="th w-10">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="全选"
                    />
                  </th>
                  <th className="th">渠道</th>
                  <th className="th">类型</th>
                  <th className="th">分组</th>
                  <th className="th">Base URL</th>
                  <th className="th-r">模型</th>
                  <th className="th-r">优先级 / 权重</th>
                  <th className="th-r">用量</th>
                  <th className="th-r">连通性</th>
                  <th className="th">状态</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(row => {
                  const modelCount = splitList(row.models).length
                  const rowGroups = splitList(row.group_names)
                  return (
                    <tr key={row.id} className="transition hover:bg-panel/60">
                      <td className="td">
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={selected.includes(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          aria-label={`选择 ${row.name}`}
                        />
                      </td>
                      <td className="td font-medium text-ink">{row.name}</td>
                      <td className="td">
                        <span className={`chip ${(TYPE_META[row.type] || TYPE_META.openai).cls}`}>
                          {(TYPE_META[row.type] || TYPE_META.openai).label}
                        </span>
                      </td>
                      <td className="td">
                        <span className="flex flex-wrap gap-1">
                          {(rowGroups.length ? rowGroups : ['default']).map(g => (
                            <span key={g} className="chip bg-panel text-ink-dim">{g}</span>
                          ))}
                        </span>
                      </td>
                      <td className="td max-w-[220px] truncate font-mono text-[13px]" title={row.base_url || '未填写,直连官方 API'}>
                        {row.base_url || <span className="font-sans text-ink-mute">官方地址</span>}
                      </td>
                      <td className="td-r" title={row.models}>{modelCount}</td>
                      <td className="td-r">{row.priority} / {row.weight}</td>
                      <td className="td-r" title={`累计 ${row.request_count || 0} 次调用`}>
                        {fmtUSD(row.used_quota || 0)}
                        <span className="ml-1 text-ink-mute">/ {fmtNum(row.request_count || 0)}</span>
                      </td>
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
                        <button
                          className="rounded-lg p-2 text-ink-mute hover:bg-panel hover:text-brand-600"
                          title="兼容性自检"
                          onClick={() => openCompat(row)}
                        >
                          <ListChecks size={15} />
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
            <label className="label">服务分组(可多选,只有组内用户会被路由到该渠道)</label>
            <div className="flex flex-wrap gap-2">
              {(groups.length ? groups : [{ name: 'default', ratio: 1 }]).map(g => {
                const on = splitList(form.group_names).includes(g.name)
                return (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => toggleGroup(g.name)}
                    className={`chip transition ${on ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-600/30' : 'bg-panel text-ink-mute'}`}
                  >
                    {g.name} <span className="opacity-60">×{g.ratio}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-ink-mute">
              例如把高价渠道只给 vip 组,批发渠道给 default 组。分组在「用户分组」页维护。
            </p>
          </div>
          <div>
            <label className="label">代理地址(选填,留空直连官方)</label>
            <input
              className="input font-mono"
              placeholder={`默认 ${(TYPE_META[form.type] || TYPE_META.openai).official}`}
              value={form.base_url}
              onChange={set('base_url')}
            />
            <p className="mt-1.5 text-xs text-ink-mute">
              对接第三方中转站时填其地址即可;结尾的 /v1 会自动处理,不必纠结。
            </p>
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
          <ModelPicker
            value={form.models}
            onChange={v => setForm(f => ({ ...f, models: v }))}
            channel={{ id: modal?.row?.id, type: form.type, base_url: form.base_url, api_key: form.api_key }}
          />
          <MappingEditor
            key={modal?.row?.id ?? 'new'}
            value={form.model_mapping}
            onChange={v => setForm(f => ({ ...f, model_mapping: v }))}
            models={form.models}
          />
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

      <Modal
        open={!!compat}
        onClose={() => setCompat(null)}
        title={`兼容性自检 — ${compat?.row?.name || ''}`}
        width="max-w-3xl"
      >
        <div className="space-y-4">
          <p className="text-xs leading-5 text-ink-mute">
            我们按模型名猜世代来裁剪参数,但上游多半是别人的中转站,改版或魔改都可能让某个参数突然被拒 ——
            那时你只会看到一片 400,没有线索指向具体字段。自检会把参数逐项单独发一遍:先跑一次基线确认链路本身通,
            再在基线之上一次只加一个特性。探到被拒的参数,以后的真实请求会直接剔掉,不再每次撞一次 400。
            <b className="text-ink-dim">每项探测都是一次真实调用,会产生少量费用</b>(max_tokens 已压到 16)。
          </p>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">探测模型</label>
              <select
                className="input"
                value={compat?.model || ''}
                onChange={e => setCompat(c => ({ ...c, model: e.target.value }))}
              >
                {splitList(compat?.row?.models).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <button className="btn-primary" onClick={runCompat} disabled={compat?.running}>
              {compat?.running ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />}
              {compat?.running ? '探测中…' : '开始自检'}
            </button>
          </div>

          {compat?.loading ? (
            <Spinner />
          ) : !compat?.items?.length ? (
            <Empty text="还没有自检记录" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">模型</th>
                    {(compat.features || []).map(f => (
                      <th key={f.key} className="th text-center">{f.label}</th>
                    ))}
                    <th className="th">检测时间</th>
                  </tr>
                </thead>
                <tbody>
                  {compat.items.map(item => (
                    <tr key={item.model} className="border-t border-line">
                      <td className="td font-mono text-xs">{item.model}</td>
                      {(compat.features || []).map(f => (
                        <td key={f.key} className="td text-center">
                          <CapMark r={item.results?.[f.key]} />
                        </td>
                      ))}
                      <td className="td whitespace-nowrap text-xs text-ink-mute">{fmtTime(item.checked_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

// 失败原因挂在 title 上 —— 「不支持」本身没用,能落到具体字段才有用
function CapMark({ r }) {
  if (!r) return <span className="text-ink-mute">—</span>
  if (r.skipped) return <Minus size={15} className="mx-auto text-ink-mute" title={r.message} />
  if (r.ok) return <Check size={15} className="mx-auto text-ok" title={`${r.latency}ms`} />
  return <X size={15} className="mx-auto text-bad" title={`${r.status ? `HTTP ${r.status} ` : ''}${r.message || ''}`} />
}
