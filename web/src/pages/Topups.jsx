import { useEffect, useState } from 'react'
import { Check, X, RefreshCw } from 'lucide-react'
import { api, fmtUSD, fmtTime } from '../api.js'
import { toast } from '../store.jsx'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'

const STATUS_META = {
  pending: { label: '待支付', cls: 'bg-warnbg text-warn' },
  submitted: { label: '待确认', cls: 'bg-brand-50 text-brand-700' },
  paid: { label: '已到账', cls: 'bg-okbg text-ok' },
  rejected: { label: '已驳回', cls: 'bg-badbg text-bad' },
  expired: { label: '已过期', cls: 'bg-panel text-ink-mute' }
}

const TABS = [
  { key: 'submitted', label: '待确认' },
  { key: '', label: '全部' },
  { key: 'paid', label: '已到账' },
  { key: 'rejected', label: '已驳回' }
]

const METHOD_LABEL = { alipay: '支付宝', wxpay: '微信支付', usdt: 'USDT' }

export default function Topups() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('submitted')
  const [busy, setBusy] = useState({})

  const load = () =>
    api(`/topup/admin/orders${tab ? `?status=${tab}` : ''}`)
      .then(setData)
      .catch(e => toast(e.message, 'error'))

  useEffect(() => { setData(null); load() }, [tab])

  // 待确认列表 30 秒自动刷新一次,免得盯着页面手动刷
  useEffect(() => {
    if (tab !== 'submitted') return
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [tab])

  const act = async (row, action) => {
    if (action === 'reject' && !confirm(`确定驳回 ${row.username} 的 ${fmtUSD(row.amount, 2)} 充值吗?`)) return
    setBusy(b => ({ ...b, [row.id]: true }))
    try {
      const res = await api(`/topup/admin/${row.id}/${action}`, { method: 'POST', body: {} })
      if (action === 'approve') {
        toast(
          `已为 ${res.username} 到账 ${fmtUSD(res.amount, 2)}` +
            (res.rebate > 0 ? `,邀请人返利 ${fmtUSD(res.rebate, 2)}` : ''),
          'success'
        )
      } else {
        toast('已驳回', 'success')
      }
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(b => ({ ...b, [row.id]: false }))
    }
  }

  const rows = data?.rows || []

  return (
    <div className="animate-fade-up">
      <PageHeader title="充值订单" desc="用户扫码付款后在这里核对到账并确认,确认即刻上额度。">
        <button className="btn-ghost" onClick={load}>
          <RefreshCw size={15} /> 刷新
        </button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              tab === t.key ? 'bg-brand-600 text-white' : 'border border-line bg-card text-ink-dim hover:bg-panel'
            }`}
          >
            {t.label}
            {t.key === 'submitted' && data?.pending_count > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${tab === t.key ? 'bg-white/25' : 'bg-bad text-white'}`}>
                {data.pending_count}
              </span>
            )}
          </button>
        ))}
      </div>

      {!data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty text={tab === 'submitted' ? '没有待确认的订单' : '暂无订单'} />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">提交时间</th>
                  <th className="th">用户</th>
                  <th className="th">订单号</th>
                  <th className="th-r">实付</th>
                  <th className="th-r">到账额度</th>
                  <th className="th">方式</th>
                  <th className="th">用户备注</th>
                  <th className="th">状态</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map(row => {
                  const meta = STATUS_META[row.status] || STATUS_META.pending
                  const canAct = row.status !== 'paid' && row.status !== 'rejected'
                  return (
                    <tr key={row.id} className="transition hover:bg-panel/60">
                      <td className="td tabular-nums">{fmtTime(row.submitted_at || row.created_at)}</td>
                      <td className="td font-medium text-ink">{row.username || '—'}</td>
                      <td className="td font-mono text-[13px]">{row.order_no || `#${row.id}`}</td>
                      <td className="td-r font-medium text-ink">¥{row.cny_amount}</td>
                      <td className="td-r">{fmtUSD(row.amount, 2)}</td>
                      <td className="td">{METHOD_LABEL[row.method] || row.method}</td>
                      <td className="td max-w-[160px] truncate" title={row.payer_note || ''}>
                        {row.payer_note || <span className="text-ink-mute">—</span>}
                      </td>
                      <td className="td">
                        <span className={`chip ${meta.cls}`}>{meta.label}</span>
                        {row.reviewer && (
                          <div className="mt-0.5 text-[11px] text-ink-mute">by {row.reviewer}</div>
                        )}
                      </td>
                      <td className="td text-right">
                        {canAct ? (
                          <div className="flex justify-end gap-1.5">
                            <button
                              className="btn-primary !px-3 !py-1.5 !text-[13px]"
                              onClick={() => act(row, 'approve')}
                              disabled={busy[row.id]}
                            >
                              <Check size={14} /> 确认到账
                            </button>
                            <button
                              className="btn-ghost !px-2.5 !py-1.5 !text-bad"
                              title="驳回"
                              onClick={() => act(row, 'reject')}
                              disabled={busy[row.id]}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-ink-mute">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
