import { useEffect, useState } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import { api, fmtUSD, fmtNum, fmtTime } from '../api.js'
import { useAuth } from '../store.jsx'
import { PageHeader, Spinner, Empty, Pagination } from '../components/ui.jsx'

// 默认只看最近一天。日志是排障用的,绝大多数时候要找的就是刚刚那次调用;
// 一上来铺开全部历史,既慢又得自己翻。要看更早的再往后选。
const RANGES = [
  { key: '1d', label: '最近一天', days: 1 },
  { key: '7d', label: '最近 7 天', days: 7 },
  { key: '30d', label: '最近 30 天', days: 30 },
  { key: 'all', label: '全部', days: 0 },
  { key: 'custom', label: '自定义' }
]

const emptyFilters = {
  model: '', status: '', scope: 'mine', username: '', token_name: '', channel_id: '',
  range: '1d', start: '', end: ''
}

// <input type="date"> 的 YYYY-MM-DD → 当天起点 / 终点的秒级时间戳
const dayStart = d => Math.floor(new Date(`${d}T00:00:00`).getTime() / 1000)
const dayEnd = d => Math.floor(new Date(`${d}T23:59:59`).getTime() / 1000)

// 预设区间取的是滚动窗口(此刻往前 N 天),不是自然日 ——
// 「最近一天」在凌晨一点该包含昨天下午的调用,按自然日切会把它切掉
function rangeParams(f) {
  if (f.range === 'custom') {
    return {
      ...(f.start ? { start: dayStart(f.start) } : {}),
      ...(f.end ? { end: dayEnd(f.end) } : {})
    }
  }
  const preset = RANGES.find(r => r.key === f.range)
  if (!preset?.days) return {}
  return { start: Math.floor(Date.now() / 1000) - preset.days * 86400 }
}

export default function Logs() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [f, setF] = useState(emptyFilters)
  const [channels, setChannels] = useState([])

  useEffect(() => {
    if (isAdmin) api('/channels').then(setChannels).catch(() => setChannels([]))
  }, [isAdmin])

  useEffect(() => {
    const params = new URLSearchParams({ page, page_size: 20 })
    if (f.model) params.set('model', f.model)
    if (f.status) params.set('status', f.status)
    if (f.token_name) params.set('token_name', f.token_name)
    for (const [k, v] of Object.entries(rangeParams(f))) params.set(k, v)
    if (isAdmin && f.scope === 'all') {
      params.set('scope', 'all')
      if (f.username) params.set('username', f.username)
    }
    if (isAdmin && f.channel_id) params.set('channel_id', f.channel_id)
    api(`/logs?${params}`).then(setData).catch(() => setData({ rows: [], total: 0 }))
  }, [page, f, isAdmin])

  // 任何筛选变化都回到第一页,否则会停在越界的空页
  const set = (k, v) => {
    setF(prev => ({ ...prev, [k]: v }))
    setPage(1)
  }
  const reset = () => {
    setF(emptyFilters)
    setPage(1)
  }

  const dirty = Object.keys(emptyFilters).some(k => f[k] !== emptyFilters[k])
  const s = data?.summary
  const showUser = isAdmin && f.scope === 'all'

  return (
    <div className="animate-fade-up">
      <PageHeader title="调用日志" desc="每一笔 API 调用的明细,便于对账与排障。" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            className="input !w-48 !pl-9"
            placeholder="按模型名筛选"
            value={f.model}
            onChange={e => set('model', e.target.value)}
          />
        </div>
        <input
          className="input !w-40"
          placeholder="按令牌名筛选"
          value={f.token_name}
          onChange={e => set('token_name', e.target.value)}
        />
        <select className="input !w-32" value={f.status} onChange={e => set('status', e.target.value)}>
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">失败</option>
        </select>
        {isAdmin && (
          <select className="input !w-36" value={f.scope} onChange={e => set('scope', e.target.value)}>
            <option value="mine">仅我的调用</option>
            <option value="all">全站调用</option>
          </select>
        )}
        {showUser && (
          <input
            className="input !w-36"
            placeholder="按用户名筛选"
            value={f.username}
            onChange={e => set('username', e.target.value)}
          />
        )}
        {isAdmin && (
          <select className="input !w-40" value={f.channel_id} onChange={e => set('channel_id', e.target.value)}>
            <option value="">全部渠道</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <select className="input !w-32" value={f.range} onChange={e => set('range', e.target.value)}>
          {RANGES.map(r => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        {/* 具体日期只在真要精确定位时才露出来,平时挤在筛选栏里既占地方又不好看 */}
        {f.range === 'custom' && (
          <div className="flex items-center gap-2">
            <input className="input !w-[150px]" type="date" value={f.start} onChange={e => set('start', e.target.value)} />
            <span className="text-ink-mute">→</span>
            <input className="input !w-[150px]" type="date" value={f.end} onChange={e => set('end', e.target.value)} />
          </div>
        )}
        {dirty && (
          <button className="btn-ghost !py-2" onClick={reset}>
            <RotateCcw size={15} /> 重置
          </button>
        )}
      </div>

      {s && s.count > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SumTile label="调用次数" value={fmtNum(s.count)} />
          <SumTile label="消耗 tokens" value={fmtNum(s.tokens)} />
          <SumTile label="总费用" value={fmtUSD(s.cost)} />
          {s.cached > 0 ? (
            <SumTile label="缓存命中" value={fmtNum(s.cached)} tone="ok" />
          ) : (
            <SumTile label="失败次数" value={fmtNum(s.errors)} tone={s.errors > 0 ? 'bad' : ''} />
          )}
        </div>
      )}

      {!data ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <div className="card p-6">
          <Empty text="没有符合条件的日志" />
          {/* 默认只看最近一天,不说清楚的话老日志「不见了」会让人以为被清掉了 */}
          {f.range !== 'all' && (
            <p className="mt-2 text-center text-xs text-ink-mute">
              当前只看
              <b className="text-ink-dim">{RANGES.find(r => r.key === f.range)?.label}</b>
              的记录,更早的调用请把时间范围调大。
            </p>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">时间</th>
                  {showUser && <th className="th">用户</th>}
                  <th className="th">令牌</th>
                  <th className="th">模型</th>
                  {isAdmin && <th className="th">渠道</th>}
                  <th className="th-r">输入/输出</th>
                  <th className="th-r">费用</th>
                  <th className="th-r">耗时</th>
                  <th className="th">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {data.rows.map(l => (
                  <tr key={l.id} className="transition hover:bg-panel/60">
                    <td className="td tabular-nums">{fmtTime(l.created_at)}</td>
                    {showUser && <td className="td">{l.username || '—'}</td>}
                    <td className="td">{l.token_name || '—'}</td>
                    <td className="td font-mono text-[13px] text-ink">{l.model}</td>
                    {isAdmin && <td className="td">{l.channel_name || '—'}</td>}
                    <td className="td-r">
                      {fmtNum(l.prompt_tokens)} / {fmtNum(l.completion_tokens)}
                      {l.cached_tokens > 0 && (
                        <span className="ml-1 text-ok" title={`其中 ${l.cached_tokens} 个输入 token 命中缓存,按折扣价计费`}>
                          ⚡{fmtNum(l.cached_tokens)}
                        </span>
                      )}
                      {l.reasoning_tokens > 0 && (
                        <span className="ml-1 text-ink-mute" title={`包含 ${l.reasoning_tokens} 个思考 token`}>
                          🧠{fmtNum(l.reasoning_tokens)}
                        </span>
                      )}
                    </td>
                    <td className="td-r">{fmtUSD(l.cost)}</td>
                    <td className="td-r">{l.latency_ms}ms</td>
                    <td className="td">
                      {l.status === 'success' ? (
                        <span className="chip bg-okbg text-ok">成功{l.stream ? ' · 流式' : ''}</span>
                      ) : (
                        <span className="chip bg-badbg text-bad" title={l.error || ''}>失败</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} total={data.total} pageSize={data.page_size} onChange={setPage} />
        </div>
      )}
    </div>
  )
}

function SumTile({ label, value, tone = '' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : 'text-ink'}`}>
        {value}
      </div>
    </div>
  )
}
