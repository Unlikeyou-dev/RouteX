import { useEffect, useState } from 'react'
import { UserPlus, Gift, Link2, Share2 } from 'lucide-react'
import { api, fmtUSD, fmtTime } from '../api.js'
import { useAuth } from '../store.jsx'
import { PageHeader, Spinner, Empty, CopyButton } from '../components/ui.jsx'

export default function Invite() {
  const { user } = useAuth()
  const [percent, setPercent] = useState(null)
  const [rebates, setRebates] = useState(null)

  useEffect(() => {
    api('/settings/public').then(d => setPercent(Number(d.aff_rebate_percent) || 0)).catch(() => setPercent(0))
    // 返利在余额流水里是 type=rebate,直接从流水里筛,不用另开接口
    api('/user/ledger?page_size=100')
      .then(d => setRebates(d.rows.filter(r => r.type === 'rebate')))
      .catch(() => setRebates([]))
  }, [])

  const link = `${location.origin}/register?aff=${user?.invite_code || ''}`

  return (
    <div className="animate-fade-up">
      <PageHeader title="邀请好友" desc="分享你的专属链接,好友每次充值你都能拿返利。" />

      <div className="card mb-5 p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <h3 className="card-title mb-1 flex items-center gap-2">
              <Link2 size={17} className="text-brand-600" /> 你的专属邀请链接
            </h3>
            <p className="mb-4 text-xs leading-5 text-ink-mute">
              好友通过这个链接注册后就和你绑定了。之后 TA 每次充值或兑换,你都按
              {percent === null ? ' … ' : <b className="text-ink-dim"> {percent}% </b>}
              自动拿到返利,直接进你的余额,不用手动领。
            </p>
            <div className="flex items-center gap-2">
              <input className="input flex-1 font-mono !text-[13px]" readOnly value={link} onFocus={e => e.target.select()} />
              <CopyButton text={link} className="btn-ghost !p-2.5" />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-mute">
              <Share2 size={12} /> 邀请码 <code className="rounded bg-panel px-1.5 py-0.5 font-mono">{user?.invite_code || '—'}</code>
              ,也可以让好友注册时手动填。
            </p>
          </div>

          <div className="flex gap-8 lg:flex-col lg:justify-center lg:border-l lg:border-line lg:pl-8">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-mute"><UserPlus size={13} /> 已邀请</div>
              <div className="mt-1 text-[26px] font-semibold leading-9 tabular-nums">{user?.aff_count ?? 0}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-ink-mute"><Gift size={13} /> 累计返利</div>
              <div className="mt-1 text-[26px] font-semibold leading-9 tabular-nums text-ok">
                {fmtUSD(user?.aff_earned ?? 0, 2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <h3 className="card-title border-b border-line px-6 py-4">返利记录</h3>
        {!rebates ? (
          <div className="p-6"><Spinner /></div>
        ) : !rebates.length ? (
          <div className="p-6">
            <Empty text="还没有返利到账" />
            <p className="mt-2 text-center text-xs text-ink-mute">好友通过你的链接注册并充值后,返利会自动出现在这里。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">时间</th>
                  <th className="th-r">返利金额</th>
                  <th className="th">来源</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rebates.map(r => (
                  <tr key={r.id} className="transition hover:bg-panel/60">
                    <td className="td whitespace-nowrap tabular-nums text-ink-dim">{fmtTime(r.created_at)}</td>
                    <td className="td-r font-medium text-ok">+{fmtUSD(r.amount, 2)}</td>
                    <td className="td text-xs text-ink-mute">{r.note || '好友充值'}</td>
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
