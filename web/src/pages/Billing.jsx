import { useEffect, useState } from 'react'
import { Receipt, ArrowLeftRight, Wallet as WalletIcon, TrendingDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, fmtUSD, fmtTime } from '../api.js'
import { useAuth } from '../store.jsx'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'

const ORDER_STATUS = {
  pending: { label: '待支付', cls: 'bg-warnbg text-warn' },
  submitted: { label: '待确认', cls: 'bg-brand-50 text-brand-700' },
  paid: { label: '已到账', cls: 'bg-okbg text-ok' },
  rejected: { label: '已驳回', cls: 'bg-badbg text-bad' },
  expired: { label: '已过期', cls: 'bg-panel text-ink-mute' }
}

const LEDGER_LABEL = {
  topup: '扫码充值', redeem: '兑换码', rebate: '邀请返利',
  signup: '注册赠送', admin: '管理员调整', refund: '退款', opening: '期初结转'
}

const TABS = [
  { key: 'ledger', label: '余额流水', icon: ArrowLeftRight },
  { key: 'orders', label: '充值订单', icon: Receipt }
]

export default function Billing() {
  const { user } = useAuth()
  const [tab, setTab] = useState('ledger')
  const [ledger, setLedger] = useState(null)
  const [orders, setOrders] = useState(null)

  useEffect(() => {
    api('/user/ledger?page_size=100').then(d => setLedger(d.rows)).catch(() => setLedger([]))
    api('/topup/orders').then(setOrders).catch(() => setOrders([]))
  }, [])

  return (
    <div className="animate-fade-up">
      <PageHeader title="账单" desc="余额的每一笔变动与充值订单记录。">
        <Link to="/console/wallet" className="btn-primary">
          <WalletIcon size={15} /> 去充值
        </Link>
      </PageHeader>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="当前余额" value={fmtUSD(user?.quota ?? 0, 2)} />
        <Stat label="累计消费" value={fmtUSD(user?.used_quota ?? 0)} icon={TrendingDown} />
        <Stat label="累计返利" value={fmtUSD(user?.aff_earned ?? 0, 2)} accent="text-ok" />
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-line bg-panel p-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${
              tab === t.key ? 'bg-card font-medium text-ink shadow-card' : 'text-ink-mute hover:text-ink'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'ledger' ? <LedgerTable rows={ledger} /> : <OrderTable rows={orders} />}
    </div>
  )
}

function Stat({ label, value, accent, icon: Icon }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-1.5 text-xs text-ink-mute">
        {Icon && <Icon size={13} />} {label}
      </div>
      <div className={`mt-1.5 text-[22px] font-semibold leading-8 tabular-nums ${accent || ''}`}>{value}</div>
    </div>
  )
}

function LedgerTable({ rows }) {
  if (!rows) return <Spinner />
  if (!rows.length) {
    return (
      <div className="card p-6">
        <Empty text="还没有余额变动" />
        <p className="mt-2 text-center text-xs text-ink-mute">
          这里只记充值、兑换、返利、赠送等入账;每次调用的花费请看「调用日志」。
        </p>
      </div>
    )
  }
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-line px-6 py-3 text-xs leading-5 text-ink-mute">
        这里记的是余额的<b className="text-ink-dim">入账与调整</b>。每次 API 调用扣了多少,在「调用日志」里可以看到每一条。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className="th">时间</th>
              <th className="th">类型</th>
              <th className="th-r">变动</th>
              <th className="th-r">变动后余额</th>
              <th className="th">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map(r => (
              <tr key={r.id} className="transition hover:bg-panel/60">
                <td className="td whitespace-nowrap tabular-nums text-ink-dim">{fmtTime(r.created_at)}</td>
                <td className="td"><span className="chip bg-panel text-ink-dim">{LEDGER_LABEL[r.type] || r.type}</span></td>
                <td className={`td-r font-medium ${r.amount > 0 ? 'text-ok' : 'text-bad'}`}>
                  {r.amount > 0 ? '+' : ''}{fmtUSD(r.amount, 2)}
                </td>
                <td className="td-r tabular-nums text-ink-dim">{fmtUSD(r.balance_after, 2)}</td>
                <td className="td text-xs text-ink-mute">{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OrderTable({ rows }) {
  if (!rows) return <Spinner />
  if (!rows.length) return <div className="card p-6"><Empty text="还没有充值订单" /></div>
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className="th">下单时间</th>
              <th className="th">订单号</th>
              <th className="th-r">金额</th>
              <th className="th-r">实付</th>
              <th className="th">状态</th>
              <th className="th">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map(o => {
              const meta = ORDER_STATUS[o.status] || ORDER_STATUS.pending
              return (
                <tr key={o.id} className="transition hover:bg-panel/60">
                  <td className="td whitespace-nowrap tabular-nums text-ink-dim">{fmtTime(o.created_at)}</td>
                  <td className="td font-mono text-xs text-ink-mute">{o.order_no || '—'}</td>
                  <td className="td-r font-medium tabular-nums">{fmtUSD(o.amount, 2)}</td>
                  <td className="td-r tabular-nums text-ink-dim">{o.cny_amount ? `¥${o.cny_amount}` : '—'}</td>
                  <td className="td"><span className={`chip ${meta.cls}`}>{meta.label}</span></td>
                  {/* 驳回原因一定要让用户看到,否则他只会来问你「为什么没到账」 */}
                  <td className="td text-xs text-ink-mute">{o.review_note || o.payer_note || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
