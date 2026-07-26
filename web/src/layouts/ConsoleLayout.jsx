import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, Navigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, KeyRound, ScrollText, Boxes, Wallet, Waypoints,
  Users, Ticket, Settings, LogOut, BookOpen, ShieldCheck, Menu
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
        `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-ink-dim hover:bg-panel hover:text-ink'
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
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setMobileOpen(false) }, [pathname])
  const current = [...userNav, ...adminNav].find(i =>
    i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== '/console'
  ) || userNav[0]

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">加载中…</div>
    )
  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 移动端遮罩 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* 侧边栏:桌面常驻,移动端抽屉 */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-card transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center px-5">
          <NavLink to="/">
            <Logo size={30} />
          </NavLink>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {userNav.map(item => (
            <NavItem key={item.to} {...item} />
          ))}
          {user.role === 'admin' && (
            <>
              <div className="flex items-center gap-2 px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-widest text-ink-mute">
                <ShieldCheck size={12} /> 管理
              </div>
              {adminNav.map(item => (
                <NavItem key={item.to} {...item} />
              ))}
            </>
          )}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {user.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user.username}</div>
              <div className="text-xs text-ink-mute">{user.role === 'admin' ? '管理员' : '普通用户'}</div>
            </div>
            <button
              className="rounded-lg p-2 text-ink-mute transition-colors hover:bg-panel hover:text-bad"
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
      <div className="flex-1 lg:ml-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-card/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2 text-[13px]">
            <button
              className="mr-1 rounded-lg p-2 text-ink-dim hover:bg-panel lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="打开菜单"
            >
              <Menu size={18} />
            </button>
            <span className="text-ink-mute">控制台</span>
            <span className="text-line">/</span>
            <span className="font-medium text-ink">{current.label}</span>
          </div>
          <NavLink
            to="/console/wallet"
            className="chip border border-line bg-card !px-3 !py-1.5 text-ink-dim shadow-card transition-colors hover:bg-panel hover:text-ink"
          >
            余额
            <span className="font-semibold text-ink">{fmtUSD(user.quota, 2)}</span>
          </NavLink>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
