import { useEffect, useState } from 'react'
import { Megaphone, Plus, Pencil, Trash2, Pin, EyeOff, Loader2 } from 'lucide-react'
import { api, fmtTime } from '../api.js'
import { toast, useAuth } from '../store.jsx'
import { PageHeader, Modal, Spinner, Empty, Switch } from '../components/ui.jsx'

const LEVELS = {
  info: { label: '通知', cls: 'bg-panel text-ink-dim', bar: 'border-l-line' },
  warning: { label: '提醒', cls: 'bg-warnbg text-warn', bar: 'border-l-warn' },
  important: { label: '重要', cls: 'bg-badbg text-bad', bar: 'border-l-bad' }
}

const emptyForm = { title: '', body: '', level: 'info', pinned: false, published: true }

export default function Announcements() {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const [rows, setRows] = useState(null)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)

  const load = () => api(`/announcements${admin ? '?all=1' : ''}`).then(setRows).catch(() => setRows([]))

  useEffect(() => {
    load()
    // 打开这一页就算全部读过了 —— 逐条点「已读」在这个体量上是多余的仪式
    api('/announcements/read', { method: 'POST', body: {} }).catch(() => {})
  }, [admin])

  const openCreate = () => { setForm(emptyForm); setModal({ mode: 'create' }) }
  const openEdit = a => {
    setForm({ title: a.title, body: a.body, level: a.level, pinned: !!a.pinned, published: !!a.published })
    setModal({ mode: 'edit', id: a.id })
  }

  const submit = async () => {
    if (!form.title.trim()) return toast('请填写标题', 'error')
    setBusy(true)
    try {
      if (modal.mode === 'create') await api('/announcements', { method: 'POST', body: form })
      else await api(`/announcements/${modal.id}`, { method: 'PUT', body: form })
      toast('已保存', 'success')
      setModal(null)
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async a => {
    if (!confirm(`确定删除公告「${a.title}」吗?`)) return
    try {
      await api(`/announcements/${a.id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={admin ? '公告管理' : '通知公告'}
        desc={admin ? '维护、调价这类通知发在这里,用户在控制台顶部和公告页都能看到。' : '站点的维护、调价与功能更新都会发布在这里。'}
      >
        {admin && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={15} /> 发布公告
          </button>
        )}
      </PageHeader>

      {!rows ? (
        <Spinner />
      ) : !rows.length ? (
        <div className="card p-6"><Empty text="暂无公告" /></div>
      ) : (
        <div className="space-y-3">
          {rows.map(a => {
            const meta = LEVELS[a.level] || LEVELS.info
            return (
              <div key={a.id} className={`card border-l-[3px] p-5 ${meta.bar}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {/* 未读用小圆点而不是「NEW」标签 —— 一列公告全挂着红标签反而看不出重点 */}
                  {a.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" title="未读" />}
                  <h3 className="text-[15px] font-semibold text-ink">{a.title}</h3>
                  <span className={`chip ${meta.cls}`}>{meta.label}</span>
                  {!!a.pinned && (
                    <span className="chip flex items-center gap-1 bg-brand-50 text-brand-700"><Pin size={11} /> 置顶</span>
                  )}
                  {admin && !a.published && (
                    <span className="chip flex items-center gap-1 bg-panel text-ink-mute"><EyeOff size={11} /> 草稿</span>
                  )}
                  {admin && (
                    <div className="ml-auto flex gap-1">
                      <button className="rounded-lg p-1.5 text-ink-mute hover:bg-panel hover:text-ink" onClick={() => openEdit(a)}>
                        <Pencil size={14} />
                      </button>
                      <button className="rounded-lg p-1.5 text-ink-mute hover:bg-panel hover:text-bad" onClick={() => remove(a)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {a.body && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink-dim">{a.body}</p>
                )}
                <p className="mt-2 text-xs tabular-nums text-ink-mute">
                  {fmtTime(a.created_at)}
                  {a.updated_at > a.created_at && <> · 修改于 {fmtTime(a.updated_at)}</>}
                </p>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'create' ? '发布公告' : '编辑公告'}
        width="max-w-xl"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="label">标题</label>
              <input
                className="input"
                maxLength={200}
                placeholder="一句话说清楚发生了什么"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">级别</label>
              <select className="input" value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))}>
                {Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">正文(可选)</label>
            <textarea
              className="input min-h-[140px] resize-y"
              maxLength={8000}
              placeholder="补充细节。标题写不下的内容放这里,列表里会完整展开。"
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3">
            <div>
              <div className="text-sm font-medium">置顶</div>
              <div className="text-xs text-ink-mute">一直排在最前,不会被后来的日常通知顶下去</div>
            </div>
            <Switch checked={form.pinned} onChange={v => setForm(f => ({ ...f, pinned: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3">
            <div>
              <div className="text-sm font-medium">立即发布</div>
              <div className="text-xs text-ink-mute">关掉则存为草稿,只有你自己看得到</div>
            </div>
            <Switch checked={form.published} onChange={v => setForm(f => ({ ...f, published: v }))} />
          </div>
          <p className="text-xs leading-5 text-ink-mute">
            修改已发布的公告不会重新提醒用户 —— 改错别字不该让所有人再收到一次。真要重新提醒,删掉重发。
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setModal(null)}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Megaphone size={15} />}
              {modal?.mode === 'create' ? '发布' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
