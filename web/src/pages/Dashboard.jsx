import { useEffect, useState } from 'react'
import { Activity, Coins, Cpu, Wallet } from 'lucide-react'
import { api, fmtUSD, fmtNum, fmtTime } from '../api.js'
import { AreaChart, BarList } from '../components/charts.jsx'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'

const METRICS = [
  { key: 'cost', label: '消耗金额', format: v => fmtUSD(v) },
  { key: 'requests', label: '请求次数', format: v => fmtNum(v) },
  { key: 'tokens', label: 'Tokens', format: v => fmtNum(v) }
]

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-mute">{label}</span>
        <span className="rounded-lg bg-brand-600/15 p-2 text-brand-300">
          <Icon size={16} />
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-mute">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [metric, setMetric] = useState('cost')

  useEffect(() => {
    api('/user/dashboard?days=14').then(setData).catch(() => setData({ error: true }))
  }, [])

  if (!data) return <Spinner />
  if (data.error) return <Empty text="加载失败,请刷新重试" />

  const { today, series, models, recent, user } = data
  const m = METRICS.find(x => x.key === metric)

  return (
    <div className="animate-fade-up">
      <PageHeader title="仪表盘" desc={`欢迎回来,${user.username}。这是你最近 14 天的使用概况。`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wallet} label="账户余额" value={fmtUSD(user.quota, 2)} sub={`累计消耗 ${fmtUSD(user.used_quota)}`} />
        <StatCard icon={Coins} label="今日消耗" value={fmtUSD(today.cost)} />
        <StatCard icon={Activity} label="今日请求" value={fmtNum(today.requests)} sub={`累计 ${fmtNum(user.request_count)} 次`} />
        <StatCard icon={Cpu} label="今日 Tokens" value={fmtNum(today.tokens)} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">近 14 天{m.label}</h3>
            <div className="flex rounded-xl border border-line bg-panel p-1">
              {METRICS.map(x => (
                <button
                  key={x.key}
                  onClick={() => setMetric(x.key)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    metric === x.key ? 'bg-brand-600/30 text-white' : 'text-ink-mute hover:text-ink'
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
          <h3 className="mb-5 font-semibold">模型消耗排行</h3>
          {models.length === 0 ? (
            <Empty text="暂无调用记录" />
          ) : (
            <BarList items={models} nameKey="model" valueKey="cost" format={v => fmtUSD(v)} />
          )}
        </div>
      </div>

      <div className="card mt-5 overflow-hidden">
        <h3 className="border-b border-line px-6 py-4 font-semibold">最近调用</h3>
        {recent.length === 0 ? (
          <Empty text="还没有任何调用,去创建一个 API 令牌开始吧" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">时间</th>
                  <th className="th">模型</th>
                  <th className="th">Tokens</th>
                  <th className="th">费用</th>
                  <th className="th">耗时</th>
                  <th className="th">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {recent.map(l => (
                  <tr key={l.id} className="transition hover:bg-white/[0.02]">
                    <td className="td">{fmtTime(l.created_at)}</td>
                    <td className="td font-mono text-[13px] text-ink">{l.model}</td>
                    <td className="td">{fmtNum(l.total_tokens)}</td>
                    <td className="td">{fmtUSD(l.cost)}</td>
                    <td className="td">{l.latency_ms}ms</td>
                    <td className="td">
                      {l.status === 'success' ? (
                        <span className="chip bg-ok/10 text-ok">成功</span>
                      ) : (
                        <span className="chip bg-bad/10 text-bad">失败</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
