import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { api } from '../api.js'
import { PageHeader, Spinner, Empty, StatusChip } from '../components/ui.jsx'

export default function Models() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    api('/models').then(setRows).catch(() => setRows([]))
  }, [])

  const filtered = rows?.filter(r => r.model.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="animate-fade-up">
      <PageHeader title="模型价格" desc="所有价格为每 100 万 tokens 的费用,按实际用量计费。">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input className="input !w-56 !pl-9" placeholder="搜索模型" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </PageHeader>

      {!rows ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty text="没有匹配的模型" />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">模型</th>
                  <th className="th">输入价格 / 1M</th>
                  <th className="th">输出价格 / 1M</th>
                  <th className="th">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filtered.map(r => (
                  <tr key={r.model} className="transition hover:bg-panel/60">
                    <td className="td font-mono text-[13px] text-ink">{r.model}</td>
                    <td className="td">${r.input_price.toFixed(2)}</td>
                    <td className="td">${r.output_price.toFixed(2)}</td>
                    <td className="td">
                      <StatusChip ok={r.available} onText="可用" offText="未上架" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
