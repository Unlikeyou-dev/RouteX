import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, Navigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, KeyRound, ScrollText, Boxes, Wallet, Waypoints,
  Users, Ticket, Settings, LogOut, BookOpen, ShieldCheck, Menu, Receipt, PieChart,
  Megaphone, X, UserPlus, UserCog, LifeBuoy
} from 'lucide-react'
import Logo from '../components/Logo.jsx'
import { Toaster } from '../components/ui.jsx'
import { useAuth } from '../store.jsx'
import { api, fmtUSD } from '../api.js'

// 顶部横幅只展示**最重要的那一条**:置顶优先,否则就是最新的一条。
// 一次铺开全部公告等于什么都没说,详情让用户点进公告页看。
// 关闭状态按公告 id 记住,发了新的会重新出现。
const BANNER_TONE = {
  important: 'border-red-200 bg-badbg text-bad',
  warning: 'border-amber-200 bg-warnbg text-warn',
  info: 'border-brand-100 bg-brand-50 text-brand-700'
}

function Announcement() {
  const [item, setItem] = useState(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    api('/announcements')
      .then(list => {
        const top = list?.[0]
        setItem(top || null)
        setDismissed(top ? localStorage.getItem('routex_ann') === String(top.id) : true)
      })
      .catch(() => {})
  }, [])

  if (!item || dismissed) return null
  const tone = BANNER_TONE[item.level] || BANNER_TONE.info
  return (
    <div className={`flex items-start gap-3 border-b px-4 py-2.5 sm:px-6 ${tone}`}>
      <Megaphone size={15} className="mt-0.5 shrink-0 opacity-80" />
      <div className="flex-1 text-[13px] leading-6">
        <NavLink to="/console/announcements" className="font-medium hover:underline">{item.title}</NavLink>
        {item.body && <span className="ml-2 opacity-80">{item.body.split('\n')[0].slice(0, 80)}</span>}
      </div>
      <button
        className="shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
        title="不再提示"
        onClick={() => {
          localStorage.setItem('routex_ann', String(item.id))
          setDismissed(true)
        }}
      >
        <X size={15} />
      </button>
    </div>
  )
}

// 分组而不是十几项平铺 —— 平铺到十项以上,用户就不看了,只会记住前三个
const userGroups = [
  {
    title: '用量',
    items: [
      { to: '/console', icon: LayoutDashboard, label: '仪表盘', end: true },
      { to: '/console/tokens', icon: KeyRound, label: 'API 令牌' },
      { to: '/console/logs', icon: ScrollText, label: '调用日志' },
      { to: '/console/models', icon: Boxes, label: '模型价格' }
    ]
  },
  {
    title: '账户',
    items: [
      { to: '/console/wallet', icon: Wallet, label: '钱包充值' },
      { to: '/console/billing', icon: Receipt, label: '账单' },
      { to: '/console/invite', icon: UserPlus, label: '邀请好友' },
      { to: '/console/account', icon: UserCog, label: '账号设置' }
    ]
  },
  {
    title: '帮助',
    items: [
      { to: '/console/announcements', icon: Megaphone, label: '通知公告', badge: 'announcements' },
      { to: '/console/docs', icon: BookOpen, label: '接入文档' },
      { to: '/console/tickets', icon: LifeBuoy, label: '售后支持' }
    ]
  }
]

const adminGroups = [
  {
    title: '管理',
    icon: ShieldCheck,
    items: [
      { to: '/console/overview', icon: PieChart, label: '全站总览' },
      { to: '/console/channels', icon: Waypoints, label: '上游渠道' },
      { to: '/console/users', icon: Users, label: '用户管理' },
      { to: '/console/topups', icon: Receipt, label: '充值订单' },
      { to: '/console/redemptions', icon: Ticket, label: '兑换码' },
      // 工单和公告对管理员是「要动手做的事」,放在「帮助」里找不到 —— 归到管理组
      { to: '/console/tickets', icon: LifeBuoy, label: '工单', badge: 'tickets' },
      { to: '/console/announcements', icon: Megaphone, label: '公告' },
      { to: '/console/settings', icon: Settings, label: '站点设置' }
    ]
  }
]

const flatNav = [...userGroups, ...adminGroups].flatMap(g => g.items)

// 管理员的工单/公告入口在管理组,「帮助」里就不用重复出现一遍
const ADMIN_MOVED = ['/console/tickets', '/console/announcements']
const navFor = admin =>
  admin
    ? [
      ...userGroups.map(g => ({ ...g, items: g.items.filter(i => !ADMIN_MOVED.includes(i.to)) })),
      ...adminGroups
    ]
    : userGroups

// 角标分色:待办(工单)用红色催人处理,未读(公告)用主色只做提示 ——
// 全用红色的话真正需要你动手的事就淹了
function NavItem({ to, icon: Icon, label, end, count, tone = 'bad' }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand-50 text-brand-700 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-600'
            : 'text-ink-dim hover:bg-panel hover:text-ink'
        }`
      }
    >
      <Icon size={17} className="shrink-0" />
      {label}
      {count > 0 && (
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white ${
          tone === 'brand' ? 'bg-brand-600' : 'bg-bad'
        }`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </NavLink>
  )
}

export default function ConsoleLayout() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pendingTickets, setPendingTickets] = useState(0)
  const [unreadAnn, setUnreadAnn] = useState(0)
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // 角标跟着路由变化刷新就够了 —— 定时轮询在这个体量上是白费请求
  useEffect(() => {
    if (!user) return
    api('/announcements/unread-count').then(d => setUnreadAnn(d.count)).catch(() => {})
    if (user.role === 'admin') {
      api('/tickets/pending-count').then(d => setPendingTickets(d.count)).catch(() => {})
    }
  }, [user?.id, user?.role, pathname])
  const current = flatNav.find(i =>
    i.end ? pathname === i.to : pathname.startsWith(i.to) && i.to !== '/console'
  ) || flatNav[0]

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
          {navFor(user.role === 'admin').map((group, gi) => (
            <div key={group.title}>
              <div className={`flex items-center gap-2 px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-ink-mute ${gi ? 'pt-5' : 'pt-1'}`}>
                {group.icon && <group.icon size={12} />} {group.title}
              </div>
              {group.items.map(item => (
                <NavItem
                  key={item.to}
                  {...item}
                  count={item.badge === 'tickets' ? pendingTickets : item.badge === 'announcements' ? unreadAnn : 0}
                  tone={item.badge === 'announcements' ? 'brand' : 'bad'}
                />
              ))}
            </div>
          ))}
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
        <Announcement />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}
