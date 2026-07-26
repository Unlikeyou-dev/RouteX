import { useEffect, useState } from 'react'
import { X, Copy, Check, Loader2, Inbox, ChevronLeft, ChevronRight, CircleCheck, CircleAlert, Info } from 'lucide-react'
import { onToast } from '../store.jsx'

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose?.()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className={`relative w-full ${width} animate-fade-up rounded-xl border border-line bg-card p-6 shadow-modal`}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-panel hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Toaster() {
  const [items, setItems] = useState([])
  useEffect(
    () =>
      onToast(t => {
        setItems(prev => [...prev, t])
        setTimeout(() => setItems(prev => prev.filter(i => i.id !== t.id)), 3200)
      }),
    []
  )
  const icons = {
    success: <CircleCheck size={16} className="text-ok" />,
    error: <CircleAlert size={16} className="text-bad" />,
    info: <Info size={16} className="text-brand-600" />
  }
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto flex animate-fade-up items-center gap-2.5 rounded-xl border border-line bg-card px-4 py-2.5 text-sm shadow-pop"
        >
          {icons[t.type] || icons.info}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

export function StatusChip({ ok, onText = '启用', offText = '禁用' }) {
  return ok ? (
    <span className="chip bg-okbg text-ok">
      <span className="h-1.5 w-1.5 rounded-full bg-ok" /> {onText}
    </span>
  ) : (
    <span className="chip bg-panel text-ink-mute">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-mute" /> {offText}
    </span>
  )
}

export function CopyButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-panel hover:text-ink ${className}`}
      title="复制"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
    </button>
  )
}

export function Spinner({ className = '' }) {
  return (
    <div className={`flex items-center justify-center py-16 text-ink-mute ${className}`}>
      <Loader2 size={22} className="animate-spin" />
    </div>
  )
}

export function Empty({ text = '暂无数据' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-ink-mute">
      <Inbox size={28} strokeWidth={1.5} />
      <span className="text-sm">{text}</span>
    </div>
  )
}

export function PageHeader({ title, desc, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {desc && <p className="mt-1 text-sm text-ink-mute">{desc}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

export function Switch({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        checked ? 'bg-brand-600' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-3 text-sm text-ink-mute">
      <span>
        第 {page} / {pages} 页 · 共 {total} 条
      </span>
      <button className="btn-ghost !px-2 !py-1" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={15} />
      </button>
      <button className="btn-ghost !px-2 !py-1" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        <ChevronRight size={15} />
      </button>
    </div>
  )
}
