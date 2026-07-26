import { useEffect, useRef, useState } from 'react'
import { Wallet as WalletIcon, Ticket, CreditCard, Clock, UserPlus, CheckCircle2, Loader2 } from 'lucide-react'
import { api, fmtUSD, fmtTime } from '../api.js'
import { useAuth, toast } from '../store.jsx'
import { PageHeader, Modal, Empty, CopyButton } from '../components/ui.jsx'

const STATUS_META = {
  pending: { label: '待支付', cls: 'bg-warnbg text-warn' },
  submitted: { label: '待确认', cls: 'bg-brand-50 text-brand-700' },
  paid: { label: '已到账', cls: 'bg-okbg text-ok' },
  rejected: { label: '已驳回', cls: 'bg-badbg text-bad' },
  expired: { label: '已过期', cls: 'bg-panel text-ink-mute' }
}

export default function Wallet() {
  const { user, refresh } = useAuth()
  const [cfg, setCfg] = useState(null)
  const [amount, setAmount] = useState(10)
  const [method, setMethod] = useState('')
  const [code, setCode] = useState('')
  const [orders, setOrders] = useState([])
  const [order, setOrder] = useState(null)   // 当前正在支付的订单
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(0)        // 支付倒计时(秒)

  const loadOrders = () => api('/topup/orders').then(setOrders).catch(() => {})

  useEffect(() => {
    api('/topup/config')
      .then(c => {
        setCfg(c)
        if (c.methods.length) setMethod(c.methods[0].key)
      })
      .catch(() => setCfg({ methods: [], cny_rate: 0, min: 1, amounts: [5, 10, 30, 50, 100, 200] }))
    loadOrders()
  }, [])

  // 订单弹窗打开期间:每 3 秒查一次状态,管理员一确认这边立刻变「已到账」
  const orderRef = useRef(null)
  orderRef.current = order
  useEffect(() => {
    if (!order || order.status === 'paid') return
    const timer = setInterval(async () => {
      try {
        const fresh = await api(`/topup/${orderRef.current.id}`)
        if (fresh.status !== orderRef.current.status) {
          setOrder(fresh)
          loadOrders()
          if (fresh.status === 'paid') {
            toast(`充值成功,已到账 ${fmtUSD(fresh.amount, 2)}`, 'success')
            refresh()
          }
          if (fresh.status === 'rejected') toast('订单被驳回,请联系管理员', 'error')
        }
      } catch { /* 轮询失败静默重试 */ }
    }, 3000)
    return () => clearInterval(timer)
  }, [order?.id, order?.status])

  // 待支付倒计时
  useEffect(() => {
    if (!order?.expires_at) return setLeft(0)
    const tick = () => setLeft(Math.max(0, order.expires_at - Math.floor(Date.now() / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [order?.expires_at])

  const createOrder = async () => {
    if (!method) return toast('管理员还没有配置收款方式', 'error')
    setBusy(true)
    try {
      const data = await api('/topup', { method: 'POST', body: { amount, method } })
      setOrder(data)
      setNote('')
      loadOrders()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitPaid = async () => {
    setBusy(true)
    try {
      const data = await api(`/topup/${order.id}/submit`, { method: 'POST', body: { note } })
      setOrder(data)
      loadOrders()
      toast('已通知管理员,确认后额度立即到账', 'success')
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

  const amounts = cfg?.amounts || [5, 10, 30, 50, 100, 200]
  const qr = cfg?.methods.find(m => m.key === order?.method)?.qr_image
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')

  return (
    <div className="animate-fade-up">
      <PageHeader title="钱包充值" desc="扫码支付或使用兑换码为账户充值。" />

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
        {/* 扫码充值 */}
        <div className="card p-6">
          <h3 className="card-title mb-1 flex items-center gap-2">
            <CreditCard size={17} className="text-brand-600" /> 扫码充值
          </h3>
          {cfg && cfg.methods.length === 0 ? (
            <>
              <p className="mb-5 text-xs text-ink-mute">管理员尚未配置收款方式,请先使用兑换码充值。</p>
              <Empty text="暂未开放在线充值" />
            </>
          ) : (
            <>
              <p className="mb-5 text-xs text-ink-mute">
                扫码付款后点「我已完成支付」,管理员核对到账即时上额度。
                {cfg?.cny_rate ? ` 当前汇率 1 USD ≈ ${cfg.cny_rate} CNY。` : ''}
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                {amounts.map(a => (
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
                {(cfg?.methods || []).map(m => (
                  <button
                    key={m.key}
                    onClick={() => setMethod(m.key)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm transition ${
                      method === m.key
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-line bg-card text-ink-dim hover:border-brand-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <button className="btn-primary mt-5 w-full !py-3" onClick={createOrder} disabled={busy || !cfg}>
                充值 ${amount}
                {cfg?.cny_rate ? <span className="opacity-80">≈ ¥{(amount * cfg.cny_rate).toFixed(2)}</span> : null}
              </button>
            </>
          )}
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
              {orders.slice(0, 5).map(o => {
                const meta = STATUS_META[o.status] || STATUS_META.pending
                return (
                  <button
                    key={o.id}
                    onClick={() => ['pending', 'submitted'].includes(o.status) && setOrder(o)}
                    className="flex w-full items-center justify-between rounded-xl border border-line bg-panel px-3.5 py-2.5 text-left text-sm transition hover:bg-white"
                  >
                    <span className="text-ink-mute">{fmtTime(o.created_at)}</span>
                    <span className="font-medium tabular-nums">{fmtUSD(o.amount, 2)}</span>
                    <span className={`chip ${meta.cls}`}>{meta.label}</span>
                  </button>
                )
              })}
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
          好友通过你的专属链接注册后,其每次充值你都能按比例获得返利,自动到账。
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

      {/* 支付弹窗 */}
      <Modal
        open={!!order}
        onClose={() => setOrder(null)}
        title={order?.status === 'paid' ? '充值成功' : '扫码支付'}
      >
        {order?.status === 'paid' ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 size={44} className="text-ok" />
            <div className="text-lg font-semibold">已到账 {fmtUSD(order.amount, 2)}</div>
            <div className="text-sm text-ink-mute">订单 {order.order_no}</div>
            <button className="btn-primary mt-3" onClick={() => setOrder(null)}>完成</button>
          </div>
        ) : order?.status === 'submitted' ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 size={40} className="animate-spin text-brand-600" />
            <div className="text-base font-semibold">已提交,等待管理员确认</div>
            <p className="max-w-sm text-sm leading-6 text-ink-mute">
              管理员核对到账后额度会立即上账,这个页面会自动刷新。
              你也可以先关掉,到账后在订单列表里能看到。
            </p>
            <div className="text-xs text-ink-mute">订单 {order.order_no}</div>
            <button className="btn-ghost mt-2" onClick={() => setOrder(null)}>知道了</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              {qr ? (
                <img
                  src={qr}
                  alt="收款码"
                  className="h-56 w-56 rounded-xl border border-line object-contain p-2"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-line text-sm text-ink-mute">
                  收款码未配置
                </div>
              )}
              <div className="text-center">
                <div className="text-[26px] font-semibold leading-9 tabular-nums">¥{order?.cny_amount}</div>
                <div className="text-xs text-ink-mute">对应额度 {fmtUSD(order?.amount || 0, 2)}</div>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-panel px-4 py-3 text-[13px] leading-6 text-ink-dim">
              <div className="flex items-center justify-between">
                <span>订单号</span>
                <span className="flex items-center gap-1 font-mono text-ink">
                  {order?.order_no}
                  <CopyButton text={order?.order_no || ''} />
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>剩余支付时间</span>
                <span className="tabular-nums text-ink">{left > 0 ? `${mm}:${ss}` : '已过期'}</span>
              </div>
              <p className="mt-2 text-xs text-ink-mute">
                请务必按上面的金额支付,并在付款备注里填订单号,便于快速核对。
              </p>
            </div>

            <div>
              <label className="label">付款备注(选填,如支付宝订单号后 6 位)</label>
              <input
                className="input"
                placeholder="填了能更快确认"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setOrder(null)}>稍后再说</button>
              <button className="btn-primary" onClick={submitPaid} disabled={busy}>我已完成支付</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
