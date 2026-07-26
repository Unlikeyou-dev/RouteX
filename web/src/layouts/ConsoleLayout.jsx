import { NavLink, Outlet, useNavigate, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, KeyRound, ScrollText, Boxes, Wallet, Waypoints,
  Users, Ticket, Settings, LogOut, BookOpen, ShieldCheck
} from 'lucide-react'
import Logo from '../components/Logo.jsx'
import { Toaster } from '../components/ui.jsx'
import { useAuth } from '../store.jsx'
import { fmtUSD } from '../api.js'

const userNav = [
  { to: '/console', icon: LayoutDashboard, label: '仪表盘', end: true },
  { to: '/console/tokens', icon: KeyRound, label: 'API 令牌' },
  { to: '/console/logs', icon: ScrollText, label: '调用日志' },
  { to: '/console/models', icon: Boxes, label: '模型价格' },
  { to: '/console/wallet', icon: Wallet, label: '钱包充值' },
  { to: '/console/docs', icon: BookOpen, label: '接入文档' }
]

const adminNav = [
  { to: '/console/channels', icon: Waypoints, label: '上游渠道' },
  { to: '/console/users', icon: Users, label: '用户管理' },
  { to: '/console/redemptions', icon: Ticket, label: '兑换码' },
  { to: '/console/settings', icon: Settings, label: '站点设置' }
]

function NavItem({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
          isActive
            ? 'bg-gradient-to-r from-brand-600/25 to-glow/10 text-white shadow-[inset_0_0_0_1px_rgba(129,140,248,0.25)]'
            : 'text-ink-dim hover:bg-white/[0.05] hover:text-ink'
        }`
      }
    >
      <Icon size={17} className="shrink-0" />
      {label}
    </NavLink>
  )
}

export default function ConsoleLayout() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">加载中…</div>
    )
  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 背景光晕 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-brand-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-glow/10 blur-[120px]" />
      </div>

      {/* 侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-line bg-panel/80 backdrop-blur-xl">
        <div className="flex h-16 items-center px-5">
          <NavLink to="/">
            <Logo size={30} />
          </NavLink>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {userNav.map(item => (
            <NavItem key={item.to} {...item} />
          ))}
          {user.role === 'admin' && (
            <>
              <div className="flex items-center gap-2 px-3.5 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-widest text-ink-mute">
                <ShieldCheck size={12} /> 管理
              </div>
              {adminNav.map(item => (
                <NavItem key={item.to} {...item} />
              ))}
            </>
          )}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-glow text-sm font-bold text-white">
              {user.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.username}</div>
              <div className="text-xs text-ink-mute">{user.role === 'admin' ? '管理员' : '普通用户'}</div>
            </div>
            <button
              className="rounded-lg p-2 text-ink-mute transition hover:bg-white/5 hover:text-bad"
              title="退出登录"
              onClick={() => {
                logout()
                navigate('/')
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="ml-60 flex-1">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-end gap-3 border-b border-line bg-bg/70 px-6 backdrop-blur-xl">
          <NavLink to="/console/wallet" className="chip border border-line bg-card/60 !px-3 !py-1.5 text-ink-dim hover:text-ink">
            余额
            <span className="font-semibold text-ok">{fmtUSD(user.quota, 2)}</span>
          </NavLink>
        </header>
        <main className="relative mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
