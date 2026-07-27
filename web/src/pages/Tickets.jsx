import { useEffect, useRef, useState } from 'react'
import { LifeBuoy, Plus, Send, CheckCircle2, RotateCcw, Loader2, ArrowLeft, ShieldCheck } from 'lucide-react'
import { api, fmtTime, fmtUSD } from '../api.js'
import { toast, useAuth } from '../store.jsx'
import { PageHeader, Modal, Spinner, Empty } from '../components/ui.jsx'

const CATEGORIES = {
  topup: '充值问题', api: '接口报错', billing: '计费疑问', account: '账号问题', other: '其他'
}

const STATUS = {
  open: { label: '待处理', cls: 'bg-warnbg text-warn' },
  answered: { label: '已回复', cls: 'bg-brand-50 text-brand-700' },
  closed: { label: '已关闭', cls: 'bg-panel text-ink-mute' }
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '待处理' },
  { key: 'answered', label: '已回复' },
  { key: 'closed', label: '已关闭' }
]

export default function Tickets() {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('all')
  const [scope, setScope] = useState('all')      // 管理员:all = 所有人的,mine = 我自己提的
  const [open, setOpen] = useState(null)          // 当前打开的工单详情
  const [creating, setCreating] = useState(false)

  const load = () => {
    const q = new URLSearchParams()
    if (filter !== 'all') q.set('status', filter)
    if (admin) q.set('scope', scope)
    api(`/tickets?${q}`).then(setRows).catch(e => toast(e.message, 'error'))
  }
  useEffect(load, [filter, scope])

  if (open) {
    return <Detail id={open} admin={admin} onBack={() => { setOpen(null); load() }} />
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={admin ? '工单管理' : '售后支持'}
        desc={admin ? '用户提交的问题都在这里,回复后会回到「已回复」。' : '有问题在这里提单,站长回复后你会在这里看到。'}
      >
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> 提交工单
        </button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              filter === f.key ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-mute hover:bg-panel hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
        {admin && (
          <select className="input ml-auto !w-auto !py-1.5 !text-[13px]" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="all">所有用户</option>
            <option value="mine">只看我提的</option>
          </select>
        )}
      </div>

      {!rows ? (
        <Spinner />
      ) : !rows.length ? (
        <div className="card p-6">
          <Empty text={filter === 'all' ? '还没有工单' : '这个状态下没有工单'} />
          {!admin && filter === 'all' && (
            <p className="mt-2 text-center text-xs text-ink-mute">
              充值没到账、接口报错、计费看不懂 —— 都可以在这里提单。
            </p>
          )}
        </div>
      ) : (
        <div className="card divide-y divide-line/60 overflow-hidden">
          {rows.map(t => {
            const meta = STATUS[t.status] || STATUS.open
            return (
              <button
                key={t.id}
                onClick={() => setOpen(t.id)}
                className="flex w-full items-start gap-4 px-6 py-4 text-left transition hover:bg-panel/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{t.subject}</span>
                    <span className="chip bg-panel text-ink-dim">{CATEGORIES[t.category] || t.category}</span>
                    {admin && <span className="text-xs text-ink-mute">{t.username}</span>}
                  </div>
                  {t.last_message && (
                    <p className="mt-1 truncate text-[13px] text-ink-mute">
                      {t.last_message.is_staff ? '客服:' : ''}{t.last_message.body}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={`chip ${meta.cls}`}>{meta.label}</span>
                  <span className="text-xs tabular-nums text-ink-mute">{fmtTime(t.updated_at)}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <CreateModal open={creating} onClose={() => setCreating(false)} onDone={id => { setCreating(false); setOpen(id) }} />
    </div>
  )
}

function CreateModal({ open, onClose, onDone }) {
  const [form, setForm] = useState({ subject: '', category: 'other', body: '' })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!form.subject.trim()) return toast('请填写标题', 'error')
    if (!form.body.trim()) return toast('请描述你的问题', 'error')
    setBusy(true)
    try {
      const data = await api('/tickets', { method: 'POST', body: form })
      setForm({ subject: '', category: 'other', body: '' })
      toast('已提交,站长收到推送后会尽快回复', 'success')
      onDone(data.id)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="提交工单" width="max-w-xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="label">标题</label>
            <input
              className="input"
              placeholder="一句话说清楚是什么问题"
              maxLength={100}
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">分类</label>
            <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">问题描述</label>
          <textarea
            className="input min-h-[160px] resize-y"
            placeholder="充值问题请附上订单号;接口报错请贴上完整报错和调用时间 —— 有这些能少来回好几轮。"
            maxLength={4000}
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          />
          <p className="mt-1.5 text-right text-xs text-ink-mute">{form.body.length} / 4000</p>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 提交
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Detail({ id, admin, onBack }) {
  const [data, setData] = useState(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  const load = () => api(`/tickets/${id}`).then(setData).catch(e => { toast(e.message, 'error'); onBack() })
  useEffect(load, [id])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [data?.messages?.length])

  const send = async () => {
    if (!reply.trim()) return
    setBusy(true)
    try {
      await api(`/tickets/${id}/reply`, { method: 'POST', body: { body: reply } })
      setReply('')
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async action => {
    try {
      await api(`/tickets/${id}/${action}`, { method: 'POST', body: {} })
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  if (!data) return <Spinner />
  const { ticket, messages } = data
  const meta = STATUS[ticket.status] || STATUS.open
  const closed = ticket.status === 'closed'

  return (
    <div className="animate-fade-up">
      <button className="btn-ghost mb-4" onClick={onBack}>
        <ArrowLeft size={15} /> 返回列表
      </button>

      <div className="card mb-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-semibold">{ticket.subject}</h2>
          <span className={`chip ${meta.cls}`}>{meta.label}</span>
          <span className="chip bg-panel text-ink-dim">{CATEGORIES[ticket.category] || ticket.category}</span>
          <div className="ml-auto flex gap-2">
            {closed ? (
              <button className="btn-ghost !px-3 !py-1.5 !text-[13px]" onClick={() => setStatus('reopen')}>
                <RotateCcw size={14} /> 重新打开
              </button>
            ) : (
              <button className="btn-ghost !px-3 !py-1.5 !text-[13px]" onClick={() => setStatus('close')}>
                <CheckCircle2 size={14} /> 问题已解决
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs tabular-nums text-ink-mute">
          #{ticket.id} · 创建于 {fmtTime(ticket.created_at)}
          {/* 处理工单时顺手能看到余额和分组,省得再去用户页翻 */}
          {admin && ticket.username && (
            <> · 提单人 <b className="text-ink-dim">{ticket.username}</b>(余额 {fmtUSD(ticket.user_quota, 2)},{ticket.user_group} 组)</>
          )}
        </p>
      </div>

      <div className="card mb-4 space-y-4 p-6">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.is_staff ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${m.is_staff ? 'bg-panel' : 'bg-brand-50'}`}>
              <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-mute">
                {m.is_staff && <ShieldCheck size={12} className="text-brand-600" />}
                <span className="font-medium">{m.is_staff ? '客服' : m.username}</span>
                <span className="tabular-nums">{fmtTime(m.created_at)}</span>
              </div>
              {/* 按纯文本渲染:工单里常有报错原文和 JSON,当 HTML 解析既不安全也会显示错乱 */}
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{m.body}</p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="card p-6">
        {closed && (
          <p className="mb-3 text-xs text-ink-mute">这张工单已关闭 —— 直接回复即可重新打开,不用另开一张。</p>
        )}
        <textarea
          className="input min-h-[100px] resize-y"
          placeholder="输入回复内容…"
          maxLength={4000}
          value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={e => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && send()}
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-ink-mute">Ctrl + Enter 发送</span>
          <button className="btn-primary" onClick={send} disabled={busy || !reply.trim()}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 发送
          </button>
        </div>
      </div>
    </div>
  )
}
