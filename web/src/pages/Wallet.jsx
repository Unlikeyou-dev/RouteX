import { useEffect, useState } from 'react'
import { Wallet as WalletIcon, Ticket, CreditCard, Clock, UserPlus } from 'lucide-react'
import { api, fmtUSD, fmtTime } from '../api.js'
import { useAuth, toast } from '../store.jsx'
import { PageHeader, Modal, Empty, CopyButton } from '../components/ui.jsx'

const AMOUNTS = [5, 10, 30, 50, 100, 200]
const METHODS = [
  { key: 'alipay', label: '支付宝' },
  { key: 'wxpay', label: '微信支付' },
  { key: 'usdt', label: 'USDT' }
]

export default function Wallet() {
  const { user, refresh } = useAuth()
  const [amount, setAmount] = useState(10)
  const [method, setMethod] = useState('alipay')
  const [code, setCode] = useState('')
  const [orders, setOrders] = useState([])
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadOrders = () => api('/topup/orders').then(setOrders).catch(() => {})
  useEffect(() => { loadOrders() }, [])

  const topup = async () => {
    setBusy(true)
    try {
      const data = await api('/topup', { method: 'POST', body: { amount, method } })
      setPending(data)
      loadOrders()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const redeem = async () => {
    if (!code.trim()) return toast('请输入兑换码', 'error')
    setBusy(true)
    try {
      const data = await api('/redemptions/redeem', { method: 'POST', body: { code } })
      toast(`兑换成功,已到账 ${fmtUSD(data.amount, 2)}`, 'success')
      setCode('')
      refresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="钱包充值" desc="通过在线支付或兑换码为账户充值。" />

      {/* 余额卡 */}
      <div className="card p-7">
        <div className="flex items-center gap-3 text-ink-mute">
          <WalletIcon size={17} />
          <span className="text-sm">当前余额</span>
        </div>
        <div className="mt-2 text-[34px] font-semibold leading-10 tracking-[-0.01em] tabular-nums">{fmtUSD(user?.quota ?? 0, 2)}</div>
        <div className="mt-2 text-[13px] tabular-nums text-ink-mute">累计消耗 {fmtUSD(user?.used_quota ?? 0)}</div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* 在线充值 */}
        <div className="card p-6">
          <h3 className="card-title mb-1 flex items-center gap-2">
            <CreditCard size={17} className="text-brand-600" /> 在线充值
          </h3>
          <p className="mb-5 text-xs text-ink-mute">支付通道接入中,下单后请联系管理员完成到账。</p>
          <div className="grid grid-cols-3 gap-2.5">
            {AMOUNTS.map(a => (
              <button
                key={a}
                onClick={() => setAmount(a)}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                  amount === a
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-line bg-card text-ink-dim hover:border-brand-300'
                }`}
              >
                ${a}
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2.5">
            {METHODS.map(mth => (
              <button
                key={mth.key}
                onClick={() => setMethod(mth.key)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition ${
                  method === mth.key
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-line bg-card text-ink-dim hover:border-brand-300'
                }`}
              >
                {mth.label}
              </button>
            ))}
          </div>
          <button className="btn-primary mt-5 w-full !py-3" onClick={topup} disabled={busy}>
            充值 ${amount}
          </button>
        </div>

        {/* 兑换码 */}
        <div className="card p-6">
          <h3 className="card-title mb-1 flex items-center gap-2">
            <Ticket size={17} className="text-brand-600" /> 兑换码充值
          </h3>
          <p className="mb-5 text-xs text-ink-mute">输入兑换码,额度即时到账。</p>
          <input
            className="input font-mono uppercase"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={code}
            onChange={e => setCode(e.target.value)}
          />
          <button className="btn-primary mt-4 w-full !py-3" onClick={redeem} disabled={busy}>
            立即兑换
          </button>

          <h4 className="mb-2 mt-7 flex items-center gap-2 text-sm font-medium text-ink-dim">
            <Clock size={14} /> 最近充值订单
          </h4>
          {orders.length === 0 ? (
            <Empty text="暂无订单" />
          ) : (
            <div className="space-y-2">
              {orders.slice(0, 5).map(o => (
                <div key={o.id} className="flex items-center justify-between rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm">
                  <span className="text-ink-mute">{fmtTime(o.created_at)}</span>
                  <span className="font-medium">{fmtUSD(o.amount, 2)}</span>
                  <span className={`chip ${o.status === 'paid' ? 'bg-okbg text-ok' : 'bg-warnbg text-warn'}`}>
                    {o.status === 'paid' ? '已到账' : '待支付'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 邀请返利 */}
      <div className="card mt-5 p-6">
        <h3 className="card-title mb-1 flex items-center gap-2">
          <UserPlus size={17} className="text-brand-600" /> 邀请返利
        </h3>
        <p className="mb-5 text-xs text-ink-mute">
          好友通过你的专属链接注册后,其每次兑换充值你都能按比例获得返利,自动到账。
        </p>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">你的专属邀请链接</label>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 font-mono !text-[13px]"
                readOnly
                value={`${location.origin}/register?aff=${user?.invite_code || ''}`}
              />
              <CopyButton text={`${location.origin}/register?aff=${user?.invite_code || ''}`} className="btn-ghost !p-2.5" />
            </div>
          </div>
          <div className="flex items-end gap-8 sm:justify-end">
            <div>
              <div className="text-[22px] font-semibold leading-8 tabular-nums">{user?.aff_count ?? 0}</div>
              <div className="mt-0.5 text-xs text-ink-mute">已邀请</div>
            </div>
            <div>
              <div className="text-[22px] font-semibold leading-8 tabular-nums text-ok">{fmtUSD(user?.aff_earned ?? 0, 2)}</div>
              <div className="mt-0.5 text-xs text-ink-mute">累计返利</div>
            </div>
          </div>
        </div>
      </div>

      <Modal open={!!pending} onClose={() => setPending(null)} title="订单已创建">
        <div className="space-y-4 text-sm text-ink-dim">
          <div className="rounded-xl border border-amber-200 bg-warnbg px-4 py-3 text-warn">
            {pending?.message}
          </div>
          <p>
            订单号 <span className="font-mono text-ink">#{pending?.order_id}</span>
            ,你也可以先使用兑换码为账户充值。
          </p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setPending(null)}>知道了</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
