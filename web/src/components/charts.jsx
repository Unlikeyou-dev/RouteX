import { useMemo, useRef, useState } from 'react'

// 单序列面积图(自绘 SVG):细线 2px、渐变填充、悬停十字线 + tooltip
export function AreaChart({ data, xKey, yKey, height = 220, color = '#2a78d6', format = v => v }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  const pad = { top: 14, right: 24, bottom: 26, left: 58 }
  const W = 720
  const H = height

  const { points, ticks } = useMemo(() => {
    const values = data.map(d => Number(d[yKey]) || 0)
    const rawMax = Math.max(...values) || 1
    // 刻度取整
    const mag = Math.pow(10, Math.floor(Math.log10(rawMax)))
    const maxY = Math.ceil(rawMax / mag) * mag
    const innerW = W - pad.left - pad.right
    const innerH = H - pad.top - pad.bottom
    const points = data.map((d, i) => ({
      x: pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
      y: pad.top + innerH - ((Number(d[yKey]) || 0) / maxY) * innerH,
      d
    }))
    const ticks = [0, 0.5, 1].map(t => ({
      y: pad.top + innerH - t * innerH,
      label: format(maxY * t)
    }))
    return { points, ticks }
  }, [data, yKey, H, format])

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${H - pad.bottom} L${points[0].x.toFixed(1)},${H - pad.bottom} Z`
    : ''
  const gid = useMemo(() => 'ag' + Math.random().toString(36).slice(2, 8), [])

  const onMove = e => {
    const rect = ref.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    let best = null
    for (const p of points) {
      if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p
    }
    setHover(best)
  }

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={t.y} y2={t.y} stroke="#eceef1" strokeWidth="1" />
            <text x={pad.left - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="#9aa1ad">
              {t.label}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % Math.ceil(points.length / 7) === 0 || i === points.length - 1 ? (
            <text key={i} x={p.x} y={H - 8} textAnchor="middle" fontSize="11" fill="#9aa1ad">
              {String(p.d[xKey]).slice(5)}
            </text>
          ) : null
        )}
        <path d={areaPath} fill={`url(#${gid})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {hover && (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={pad.top}
              y2={H - pad.bottom}
              stroke="rgba(22,24,29,0.25)"
              strokeDasharray="3 3"
            />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill={color} stroke="#ffffff" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-pop"
          style={{
            left: `${(hover.x / W) * 100}%`,
            top: 0,
            transform: hover.x > W * 0.7 ? 'translateX(-110%)' : 'translateX(12px)'
          }}
        >
          <div className="mb-0.5 text-ink-mute">{hover.d[xKey]}</div>
          <div className="font-semibold text-ink">{format(hover.d[yKey])}</div>
        </div>
      )}
    </div>
  )
}

// 横向条形列表(排名/占比),单色 + 直接标注数值
export function BarList({ items, nameKey, valueKey, format = v => v, color = '#2a78d6' }) {
  const max = Math.max(...items.map(i => Number(i[valueKey]) || 0), 1e-9)
  return (
    <div className="space-y-3">
      {items.map((it, idx) => (
        <div key={idx}>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="font-mono text-ink-dim">{it[nameKey]}</span>
            <span className="font-medium text-ink">{format(it[valueKey])}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(2, ((Number(it[valueKey]) || 0) / max) * 100)}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
