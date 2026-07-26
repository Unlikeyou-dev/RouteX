import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { api, fmtUSD, fmtNum, fmtTime } from '../api.js'
import { useAuth } from '../store.jsx'
import { PageHeader, Spinner, Empty, Pagination } from '../components/ui.jsx'

export default function Logs() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [model, setModel] = useState('')
  const [status, setStatus] = useState('')
  const [scope, setScope] = useState('mine')

  useEffect(() => {
    const params = new URLSearchParams({ page, page_size: 20 })
    if (model) params.set('model', model)
    if (status) params.set('status', status)
    if (isAdmin && scope === 'all') params.set('scope', 'all')
    api(`/logs?${params}`).then(setData).catch(() => setData({ rows: [], total: 0 }))
  }, [page, model, status, scope, isAdmin])

  return (
    <div className="animate-fade-up">
      <PageHeader title="调用日志" desc="每一笔 API 调用的明细,便于对账与排障。" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            className="input !w-56 !pl-9"
            placeholder="按模型名筛选"
            value={model}
            onChange={e => {
              setModel(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <select
          className="input !w-32"
          value={status}
          onChange={e => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">失败</option>
        </select>
        {isAdmin && (
          <select
            className="input !w-36"
            value={scope}
            onChange={e => {
              setScope(e.target.value)
              setPage(1)
            }}
          >
            <option value="mine">仅我的调用</option>
            <option value="all">全站调用</option>
          </select>
        )}
      </div>

      {!data ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <div className="card">
          <Empty text="没有符合条件的日志" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">时间</th>
                  {isAdmin && scope === 'all' && <th className="th">用户</th>}
                  <th className="th">令牌</th>
                  <th className="th">模型</th>
                  {isAdmin && <th className="th">渠道</th>}
                  <th className="th">输入/输出</th>
                  <th className="th">费用</th>
                  <th className="th">耗时</th>
                  <th className="th">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {data.rows.map(l => (
                  <tr key={l.id} className="transition hover:bg-panel/60">
                    <td className="td">{fmtTime(l.created_at)}</td>
                    {isAdmin && scope === 'all' && <td className="td">{l.username || '—'}</td>}
                    <td className="td">{l.token_name || '—'}</td>
                    <td className="td font-mono text-[13px] text-ink">{l.model}</td>
                    {isAdmin && <td className="td">{l.channel_name || '—'}</td>}
                    <td className="td">
                      {fmtNum(l.prompt_tokens)} / {fmtNum(l.completion_tokens)}
                    </td>
                    <td className="td">{fmtUSD(l.cost)}</td>
                    <td className="td">{l.latency_ms}ms</td>
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
