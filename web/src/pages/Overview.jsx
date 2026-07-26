import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Coins, Activity, Users, Wallet, AlertTriangle, Waypoints } from 'lucide-react'
import { api, fmtUSD, fmtNum } from '../api.js'
import { AreaChart, BarList } from '../components/charts.jsx'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'

const METRICS = [
  { key: 'revenue', label: '消耗额度', format: v => fmtUSD(v) },
  { key: 'requests', label: '请求次数', format: v => fmtNum(v) },
  { key: 'tokens', label: 'Tokens', format: v => fmtNum(v) }
]

function StatCard({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-mute">{label}</span>
        <span className={`rounded-lg p-2 ${tone === 'ok' ? 'bg-okbg text-ok' : 'bg-brand-50 text-brand-600'}`}>
          <Icon size={16} />
        </span>
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-9 tracking-[-0.01em] tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs tabular-nums text-ink-mute">{sub}</div>}
    </div>
  )
}

export default function Overview() {
  const [data, setData] = useState(null)
  const [metric, setMetric] = useState('revenue')
  const [days, setDays] = useState(14)

  useEffect(() => {
    setData(null)
    api(`/admin/overview?days=${days}`).then(setData).catch(() => setData({ error: true }))
  }, [days])

  if (!data) return <Spinner />
  if (data.error) return <Empty text="加载失败,请刷新重试" />

  const { today, series, users, top_users, top_models, channels, todo } = data
  const m = METRICS.find(x => x.key === metric)
  const successRate = today.requests > 0
    ? (((today.requests - today.errors) / today.requests) * 100).toFixed(1)
    : null

  // 需要动手的事,合并成一条横幅放最上面
  const todos = [
    todo.pending_topups > 0 && { to: '/console/topups', text: `${todo.pending_topups} 笔充值待确认` },
    todo.broken_channels > 0 && { to: '/console/channels', text: `${todo.broken_channels} 个渠道已熔断` },
    todo.unpriced_models > 0 && { to: '/console/models', text: `${todo.unpriced_models} 个模型未定价` }
  ].filter(Boolean)

  return (
    <div className="animate-fade-up">
      <PageHeader title="全站总览" desc="站点整体经营与健康状况。">
        <div className="flex rounded-xl border border-line bg-panel p-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                days === d ? 'bg-card text-ink shadow-card' : 'text-ink-mute hover:text-ink'
              }`}
            >
              {d} 天
            </button>
          ))}
        </div>
      </PageHeader>

      {todos.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-warnbg px-4 py-3">
          <AlertTriangle size={17} className="shrink-0 text-warn" />
          <span className="text-sm font-medium text-warn">待处理</span>
          <div className="flex flex-wrap gap-2">
            {todos.map(t => (
              <Link
                key={t.to}
                to={t.to}
                className="chip border border-amber-200 bg-card text-warn transition hover:bg-white"
              >
                {t.text} →
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Coins}
          label="今日消耗额度"
          value={fmtUSD(today.revenue)}
          sub={`${fmtNum(today.tokens)} tokens`}
        />
        <StatCard
          icon={Wallet}
          label="今日到账充值"
          value={fmtUSD(today.topup_amount, 2)}
          sub={`${today.topup_count} 笔`}
          tone="ok"
        />
        <StatCard
          icon={Activity}
          label="今日请求"
          value={fmtNum(today.requests)}
          sub={successRate ? `成功率 ${successRate}%` : '暂无调用'}
        />
        <StatCard
          icon={Users}
          label="活跃用户"
          value={fmtNum(users.active)}
          sub={`共 ${users.total} 人 · 账上余额 ${fmtUSD(users.balance, 2)}`}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="card-title">近 {days} 天{m.label}</h3>
            <div className="flex rounded-xl border border-line bg-panel p-1">
              {METRICS.map(x => (
                <button
                  key={x.key}
                  onClick={() => setMetric(x.key)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    metric === x.key ? 'bg-card text-ink shadow-card' : 'text-ink-mute hover:text-ink'
                  }`}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <AreaChart data={series} xKey="day" yKey={metric} format={m.format} />
        </div>

        <div className="card p-6">
          <h3 className="card-title mb-5">消耗最高的用户</h3>
          {top_users.length === 0 ? (
            <Empty text="暂无调用记录" />
          ) : (
            <BarList items={top_users} nameKey="username" valueKey="revenue" format={v => fmtUSD(v)} />
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="card p-6">
          <h3 className="card-title mb-5">模型消耗排行</h3>
          {top_models.length === 0 ? (
            <Empty text="暂无调用记录" />
          ) : (
            <BarList items={top_models} nameKey="model" valueKey="revenue" format={v => fmtUSD(v)} />
          )}
        </div>

        <div className="card overflow-hidden lg:col-span-2">
          <h3 className="card-title flex items-center gap-2 border-b border-line px-6 py-4">
            <Waypoints size={16} className="text-brand-600" /> 渠道健康
          </h3>
          {channels.length === 0 ? (
            <Empty text="还没有渠道" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line">
                  <tr>
                    <th className="th">渠道</th>
                    <th className="th-r">近 {days} 天请求</th>
                    <th className="th-r">成功率</th>
                    <th className="th-r">延迟</th>
                    <th className="th-r">累计消耗</th>
                    <th className="th">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {channels.map(c => {
                    const rate = c.recent_requests > 0
                      ? ((c.recent_requests - c.recent_errors) / c.recent_requests) * 100
                      : null
                    return (
                      <tr key={c.id} className="transition hover:bg-panel/60">
                        <td className="td font-medium text-ink">{c.name}</td>
                        <td className="td-r">{fmtNum(c.recent_requests)}</td>
                        <td className="td-r">
                          {rate === null ? (
                            <span className="text-ink-mute">—</span>
                          ) : (
                            <span className={rate >= 95 ? 'text-ok' : rate >= 80 ? 'text-warn' : 'text-bad'}>
                              {rate.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="td-r">{c.latency_ms ? `${c.latency_ms}ms` : '—'}</td>
                        <td className="td-r">{fmtUSD(c.used_quota || 0)}</td>
                        <td className="td">
                          {c.status !== 1 ? (
                            <span className="chip bg-panel text-ink-mute">已禁用</span>
                          ) : c.auto_disabled ? (
                            <span className="chip bg-warnbg text-warn">熔断中</span>
                          ) : (
                            <span className="chip bg-okbg text-ok">正常</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
