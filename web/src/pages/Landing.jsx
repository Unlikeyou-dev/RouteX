import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Zap, ShieldCheck, Coins, Waypoints, ArrowRight, Megaphone,
  Gauge, Blocks, TerminalSquare, ChevronRight
} from 'lucide-react'
import Logo from '../components/Logo.jsx'
import { useAuth } from '../store.jsx'

const MODELS = [
  'gpt-4o', 'gpt-4.1', 'o3', 'claude-sonnet-4', 'claude-opus-4',
  'deepseek-r1', 'deepseek-v3', 'gemini-2.5-pro', 'qwen-max', 'glm-4-plus'
]

const FEATURES = [
  {
    icon: Zap,
    title: '毫秒级智能路由',
    desc: '多上游渠道按优先级与权重自动调度,单渠道故障秒级切换,可用性拉满。'
  },
  {
    icon: Coins,
    title: '透明按量计费',
    desc: '按 token 精确计费,价格公开透明,用多少付多少,余额实时可查。'
  },
  {
    icon: Blocks,
    title: 'OpenAI 全兼容',
    desc: '一行代码替换 base_url 即可接入,任何支持 OpenAI 协议的 SDK / 应用开箱即用。'
  },
  {
    icon: ShieldCheck,
    title: '密钥安全隔离',
    desc: '每个令牌独立限额、独立启停、随时吊销,泄露也不怕,用量尽在掌控。'
  },
  {
    icon: Gauge,
    title: '实时用量看板',
    desc: '请求数、Token 消耗、费用曲线一目了然,每一笔调用都有据可查。'
  },
  {
    icon: Waypoints,
    title: '多模型一站聚合',
    desc: 'GPT、Claude、DeepSeek、Gemini…主流大模型一个密钥全搞定。'
  }
]

export default function Landing() {
  const { user } = useAuth()
  const [site, setSite] = useState({ site_name: 'RouteX', announcement: '' })
  useEffect(() => {
    fetch('/api/settings/public')
      .then(r => r.json())
      .then(d => d?.data && setSite(d.data))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-card">
      {/* 导航 */}
      <header className="sticky top-0 z-30 border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm text-ink-dim md:flex">
            <a href="#features" className="transition-colors hover:text-ink">核心能力</a>
            <a href="#models" className="transition-colors hover:text-ink">支持模型</a>
            <a href="#quickstart" className="transition-colors hover:text-ink">快速接入</a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Link to="/console" className="btn-primary">
                进入控制台 <ArrowRight size={15} />
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost">登录</Link>
                <Link to="/register" className="btn-primary">免费注册</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-20 text-center md:pt-28">
        {site.announcement && (
          <div className="mx-auto mb-8 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-panel px-4 py-1.5 text-[13px] text-ink-dim">
            <Megaphone size={14} className="shrink-0 text-brand-600" />
            <span className="truncate">{site.announcement}</span>
          </div>
        )}
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-[56px] md:leading-[1.15]">
          一个密钥,直连
          <span className="text-brand-600">全球大模型</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-dim md:text-lg">
          {site.site_name} 是新一代大模型 API 中转平台 —— 聚合 GPT、Claude、DeepSeek、Gemini 等主流模型,
          OpenAI 协议全兼容,更低价格、更高可用、按量计费。
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link to={user ? '/console' : '/register'} className="btn-primary !px-6 !py-3 !text-base">
            立即开始 <ArrowRight size={17} />
          </Link>
          <a href="#quickstart" className="btn-ghost !px-6 !py-3 !text-base">
            <TerminalSquare size={17} /> 查看接入示例
          </a>
        </div>

        {/* 代码卡片:浅色页面上的深色终端,保持专业对比 */}
        <div id="quickstart" className="mx-auto mt-16 max-w-2xl overflow-hidden rounded-xl border border-line bg-[#16181d] text-left shadow-pop">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-[#fc625d]" />
            <span className="h-3 w-3 rounded-full bg-[#fdbc40]" />
            <span className="h-3 w-3 rounded-full bg-[#34c749]" />
            <span className="ml-3 text-xs text-white/40">terminal — 30 秒接入</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-white/70">
            <code>
{`curl `}<span className="text-sky-300">{`${location.origin}/v1/chat/completions`}</span>{` \\
  -H "Authorization: Bearer `}<span className="text-brand-300">sk-你的令牌</span>{`" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": `}<span className="text-emerald-300">"gpt-4o"</span>{`,
    "messages": [{"role": "user", "content": "你好, RouteX!"}]
  }'`}
            </code>
          </pre>
        </div>
      </section>

      {/* 特性 */}
      <section id="features" className="border-t border-line bg-bg py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight">为分发而生的中转引擎</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-ink-mute">
            稳定压倒一切。渠道调度、计费、密钥管理,一站式全部搞定。
          </p>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(f => (
              <div key={f.title} className="card p-6 transition-shadow hover:shadow-pop">
                <div className="mb-4 inline-flex rounded-lg bg-brand-50 p-3 text-brand-600">
                  <f.icon size={22} />
                </div>
                <h3 className="mb-2 font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-ink-mute">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 模型 */}
      <section id="models" className="border-t border-line bg-card py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-xl font-bold">支持的主流模型</h2>
            <Link
              to={user ? '/console/models' : '/register'}
              className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              查看完整价目 <ChevronRight size={15} />
            </Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {MODELS.map(m => (
              <span
                key={m}
                className="chip border border-line bg-bg !px-4 !py-2 font-mono !text-[13px] text-ink-dim transition-colors hover:border-brand-300 hover:text-ink"
              >
                {m}
              </span>
            ))}
            <span className="chip border border-dashed border-line !px-4 !py-2 !text-[13px] text-ink-mute">
              持续新增中…
            </span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-line bg-bg py-20">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <div className="card mx-auto max-w-3xl p-12">
            <h2 className="text-3xl font-bold tracking-tight">准备好开始了吗?</h2>
            <p className="mx-auto mt-3 max-w-md text-ink-mute">
              注册即送体验额度,一分钟完成接入,让你的应用立刻拥有全球大模型能力。
            </p>
            <Link to={user ? '/console' : '/register'} className="btn-primary mt-8 !px-8 !py-3 !text-base">
              免费创建账号 <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="border-t border-line bg-card py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-ink-mute">
          <Logo size={24} textClass="text-sm" />
          <span>© {new Date().getFullYear()} {site.site_name} · 稳定 · 快速 · 优惠的大模型 API 中转</span>
        </div>
      </footer>
    </div>
  )
}
