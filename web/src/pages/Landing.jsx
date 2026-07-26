import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Zap, ShieldCheck, Coins, Waypoints, ArrowRight, Sparkles,
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
    <div className="relative min-h-screen overflow-hidden bg-bg">
      {/* 背景装饰 */}
      <div className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-[720px]" />
      <div className="pointer-events-none absolute -top-48 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-brand-600/20 blur-[140px]" />
      <div className="pointer-events-none absolute right-[-120px] top-[420px] h-72 w-72 rounded-full bg-glow/15 blur-[120px]" />

      {/* 导航 */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-ink-dim md:flex">
          <a href="#features" className="transition hover:text-ink">核心能力</a>
          <a href="#models" className="transition hover:text-ink">支持模型</a>
          <a href="#quickstart" className="transition hover:text-ink">快速接入</a>
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
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-16 text-center md:pt-24">
        {site.announcement && (
          <div className="mx-auto mb-8 inline-flex max-w-full items-center gap-2 rounded-full border border-brand-500/30 bg-brand-600/10 px-4 py-1.5 text-[13px] text-brand-300">
            <Sparkles size={14} className="shrink-0" />
            <span className="truncate">{site.announcement}</span>
          </div>
        )}
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
          一个密钥,直连
          <span className="bg-gradient-to-r from-brand-400 via-glow to-cyan-400 bg-clip-text text-transparent">
            全球大模型
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-dim md:text-lg">
          {site.site_name} 是新一代大模型 API 中转平台 —— 聚合 GPT、Claude、DeepSeek、Gemini 等主流模型,
          OpenAI 协议全兼容,更低价格、更高可用、按量计费。
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link to={user ? '/console' : '/register'} className="btn-primary !px-6 !py-3 !text-base">
            立即开始 <ArrowRight size={17} />
          </Link>
          <a href="#quickstart" className="btn-ghost !px-6 !py-3 !text-base">
            <TerminalSquare size={17} /> 查看接入示例
          </a>
        </div>

        {/* 代码卡片 */}
        <div id="quickstart" className="card mx-auto mt-16 max-w-2xl overflow-hidden text-left animate-fade-up">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-bad/70" />
            <span className="h-3 w-3 rounded-full bg-warn/70" />
            <span className="h-3 w-3 rounded-full bg-ok/70" />
            <span className="ml-3 text-xs text-ink-mute">terminal — 30 秒接入</span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-ink-dim">
            <code>
{`curl `}<span className="text-cyan-400">{`${location.origin}/v1/chat/completions`}</span>{` \\
  -H "Authorization: Bearer `}<span className="text-brand-300">sk-你的令牌</span>{`" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": `}<span className="text-ok">"gpt-4o"</span>{`,
    "messages": [{"role": "user", "content": "你好, RouteX!"}]
  }'`}
            </code>
          </pre>
        </div>
      </section>

      {/* 特性 */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight">为分发而生的中转引擎</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink-mute">
          稳定压倒一切。渠道调度、计费、密钥管理,一站式全部搞定。
        </p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(f => (
            <div key={f.title} className="card group p-6 transition hover:border-brand-500/40 hover:shadow-glowsm">
              <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-brand-600/25 to-glow/20 p-3 text-brand-300 transition group-hover:scale-110">
                <f.icon size={22} />
              </div>
              <h3 className="mb-2 font-semibold">{f.title}</h3>
              <p className="text-sm leading-relaxed text-ink-mute">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 模型跑马灯 */}
      <section id="models" className="relative z-10 border-y border-line bg-panel/50 py-14">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-xl font-bold">支持的主流模型</h2>
            <Link to={user ? '/console/models' : '/register'} className="flex items-center gap-1 text-sm text-brand-400 hover:text-brand-300">
              查看完整价目 <ChevronRight size={15} />
            </Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {MODELS.map(m => (
              <span key={m} className="chip border border-line bg-card/70 !px-4 !py-2 font-mono !text-[13px] text-ink-dim transition hover:border-brand-500/40 hover:text-ink">
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
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24 text-center">
        <div className="card relative overflow-hidden p-12">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full bg-brand-600/20 blur-[100px]" />
          <h2 className="relative text-3xl font-bold tracking-tight">准备好开始了吗?</h2>
          <p className="relative mx-auto mt-3 max-w-md text-ink-mute">
            注册即送体验额度,一分钟完成接入,让你的应用立刻拥有全球大模型能力。
          </p>
          <Link to={user ? '/console' : '/register'} className="btn-primary relative mt-8 !px-8 !py-3 !text-base">
            免费创建账号 <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="relative z-10 border-t border-line py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-ink-mute">
          <Logo size={24} textClass="text-sm" />
          <span>© {new Date().getFullYear()} {site.site_name} · 稳定 · 快速 · 优惠的大模型 API 中转</span>
        </div>
      </footer>
    </div>
  )
}
