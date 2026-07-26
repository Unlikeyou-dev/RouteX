import { useState } from 'react'
import { Plus, X, ArrowRight, Download, Sparkles, Loader2, Eraser } from 'lucide-react'
import { api } from '../api.js'
import { toast } from '../store.jsx'

export const splitList = s => String(s || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean)

// ---- 支持的模型:可搜索的多选 chips ----
// 候选来自「从上游获取」(调上游 /v1/models)、「填入常用」(内置清单),
// 也保留手打回车追加 —— 很多小中转站没有标准的模型列表接口。
export function ModelPicker({ value, onChange, channel }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState('')
  const [candidates, setCandidates] = useState([])

  const selected = splitList(value)
  const has = m => selected.includes(m)
  const setSelected = list => onChange([...new Set(list)].join('\n'))

  const toggle = m => setSelected(has(m) ? selected.filter(x => x !== m) : [...selected, m])

  const addTyped = () => {
    const list = splitList(input)
    if (!list.length) return
    setSelected([...selected, ...list])
    setInput('')
  }

  const fetchFrom = async source => {
    setLoading(source)
    try {
      if (source === 'upstream') {
        const data = await api('/channels/fetch-models', {
          method: 'POST',
          body: { id: channel?.id, type: channel.type, base_url: channel.base_url, api_key: channel.api_key }
        })
        setCandidates(data.models)
        toast(`上游返回 ${data.models.length} 个模型,点选即可加入`, 'success')
      } else {
        const data = await api(`/channels/preset-models?type=${channel.type}`)
        setCandidates(data.models)
      }
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setLoading('')
    }
  }

  // 候选里去掉已选的,避免看着重复
  const unpicked = candidates.filter(m => !has(m))

  return (
    <div>
      <label className="label">支持的模型(用户调用时写的名字)</label>

      <div className="mb-2 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-[13px]" onClick={() => fetchFrom('upstream')} disabled={!!loading}>
          {loading === 'upstream' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          从上游获取
        </button>
        <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-[13px]" onClick={() => fetchFrom('preset')} disabled={!!loading}>
          {loading === 'preset' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          填入常用
        </button>
        {selected.length > 0 && (
          <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-[13px]" onClick={() => setSelected([])}>
            <Eraser size={14} /> 清空
          </button>
        )}
        <span className="ml-auto self-center text-xs text-ink-mute">已选 {selected.length} 个</span>
      </div>

      <div className="min-h-[64px] rounded-lg border border-line bg-panel p-2.5">
        {selected.length === 0 ? (
          <div className="py-2 text-center text-xs text-ink-mute">还没有选模型 —— 先点「从上游获取」,或在下面手动输入</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selected.map(m => (
              <span key={m} className="chip bg-brand-50 font-mono !text-[12px] text-brand-700">
                {m}
                <button type="button" className="opacity-60 hover:opacity-100" onClick={() => toggle(m)} title="移除">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="input font-mono !text-[13px]"
          placeholder="手动输入模型名,回车添加(可用逗号分隔多个)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTyped()
            }
          }}
        />
        <button type="button" className="btn-ghost !px-3" onClick={addTyped} disabled={!input.trim()}>
          <Plus size={15} />
        </button>
      </div>

      {unpicked.length > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-card p-2.5">
          <div className="mb-1.5 flex items-center justify-between text-xs text-ink-mute">
            <span>可选模型({unpicked.length})</span>
            <button type="button" className="text-brand-600 hover:underline" onClick={() => setSelected([...selected, ...unpicked])}>
              全部加入
            </button>
          </div>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {unpicked.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => toggle(m)}
                className="chip bg-panel font-mono !text-[12px] text-ink-dim transition hover:bg-brand-50 hover:text-brand-700"
              >
                <Plus size={11} /> {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 模型重定向:请求名 → 上游名 的行编辑器 ----
// 底层仍然存 JSON(库和路由都不用改),这里只做「JSON ↔ 行数组」的互转。
// 调用方需要按渠道 key 掉这个组件(key={row.id ?? 'new'}),让它随弹窗重新挂载,
// 否则切换渠道时下面的 draft 会残留上一个渠道的行。
export function MappingEditor({ value, onChange, models }) {
  const modelList = splitList(models)

  // 行允许暂时为空(用户正在输入一半),所以用本地数组做中转,提交时才收敛成 JSON
  const [draft, setDraft] = useState(() => parseRows(value))

  const commit = next => {
    setDraft(next)
    const obj = {}
    for (const r of next) {
      const from = r.from.trim()
      if (from) obj[from] = r.to.trim()
    }
    onChange(JSON.stringify(obj))
  }

  return (
    <div>
      <label className="label">模型重定向(可选)</label>
      <p className="mb-2 text-xs leading-5 text-ink-mute">
        把用户调用的名字翻译成上游真实的模型名。左边必须是上面「支持的模型」里的名字,
        否则用户根本调不到它。
      </p>

      {draft.length > 0 && (
        <div className="mb-2 space-y-2">
          <div className="flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wider text-ink-mute">
            <span className="flex-1">用户调用的名字</span>
            <span className="w-4" />
            <span className="flex-1">实际发给上游的名字</span>
            <span className="w-7" />
          </div>
          {draft.map((row, i) => {
            const orphan = row.from.trim() && !modelList.includes(row.from.trim())
            return (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    className={`input flex-1 font-mono !text-[13px] ${orphan ? '!border-warn' : ''}`}
                    placeholder="grok"
                    list="routex-channel-models"
                    value={row.from}
                    onChange={e => commit(draft.map((r, j) => (j === i ? { ...r, from: e.target.value } : r)))}
                  />
                  <ArrowRight size={15} className="shrink-0 text-ink-mute" />
                  <input
                    className="input flex-1 font-mono !text-[13px]"
                    placeholder="doubao-pro-32k"
                    value={row.to}
                    onChange={e => commit(draft.map((r, j) => (j === i ? { ...r, to: e.target.value } : r)))}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-lg p-1.5 text-ink-mute hover:bg-panel hover:text-bad"
                    onClick={() => commit(draft.filter((_, j) => j !== i))}
                    title="删除这条"
                  >
                    <X size={15} />
                  </button>
                </div>
                {orphan && (
                  <p className="mt-1 pl-1 text-xs text-warn">
                    「{row.from.trim()}」不在支持的模型里,保存会被拒绝 —— 请先把它加进上面的模型列表
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 左侧输入框的候选,就是这个渠道支持的模型 */}
      <datalist id="routex-channel-models">
        {modelList.map(m => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <button
        type="button"
        className="btn-ghost !px-3 !py-1.5 !text-[13px]"
        onClick={() => commit([...draft, { from: '', to: '' }])}
      >
        <Plus size={14} /> 添加一条
      </button>
    </div>
  )
}

function parseRows(json) {
  try {
    const obj = JSON.parse(json || '{}')
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
    return Object.entries(obj).map(([from, to]) => ({ from, to: String(to ?? '') }))
  } catch {
    return []
  }
}
