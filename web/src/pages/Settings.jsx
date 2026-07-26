import { useEffect, useRef, useState } from 'react'
import { Save, Plus, Trash2, Upload, Bell, X } from 'lucide-react'
import { api } from '../api.js'
import { toast, useAuth } from '../store.jsx'
import { PageHeader, Spinner } from '../components/ui.jsx'

// 收款码截图动辄好几 MB,统一压到 600px / JPEG 再转 base64 存进设置,
// 免得每次拉设置都拖上几兆。
function fileToCompressedDataUrl(file, max = 600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片格式不支持'))
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.88))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function QrPicker({ label, value, onChange }) {
  const inputRef = useRef(null)
  return (
    <div>
      <label className="label">{label}</label>
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt={label} className="h-32 w-32 rounded-xl border border-line object-contain p-1" />
          <button
            className="absolute -right-2 -top-2 rounded-full border border-line bg-card p-1 text-ink-mute shadow-card hover:text-bad"
            title="移除"
            onClick={() => onChange('')}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          className="flex h-32 w-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-xs text-ink-mute transition hover:border-brand-300 hover:text-brand-600"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={18} />
          选择收款码
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try {
            onChange(await fileToCompressedDataUrl(file))
          } catch (err) {
            toast(err.message, 'error')
          }
        }}
      />
    </div>
  )
}

export default function Settings() {
  const { refresh } = useAuth()
  const [form, setForm] = useState(null)
  const [pwd, setPwd] = useState({ old_password: '', new_password: '' })
  const [groups, setGroups] = useState([])
  const [newGroup, setNewGroup] = useState({ name: '', ratio: 0.9 })
  const [busy, setBusy] = useState(false)

  const loadGroups = () => api('/groups').then(setGroups).catch(() => {})
  useEffect(() => {
    api('/settings').then(setForm).catch(e => toast(e.message, 'error'))
    loadGroups()
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      await api('/settings', { method: 'PUT', body: form })
      toast('设置已保存', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const changePwd = async () => {
    if (!pwd.old_password || !pwd.new_password) return toast('请填写完整', 'error')
    setBusy(true)
    try {
      await api('/user/me', { method: 'PUT', body: pwd })
      toast('密码已修改', 'success')
      setPwd({ old_password: '', new_password: '' })
      refresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveRatio = async (name, ratio) => {
    try {
      await api(`/groups/${name}`, { method: 'PUT', body: { ratio: Number(ratio) } })
      toast(`分组 ${name} 已更新`, 'success')
      loadGroups()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const addGroup = async () => {
    try {
      await api('/groups', { method: 'POST', body: newGroup })
      toast('分组已创建', 'success')
      setNewGroup({ name: '', ratio: 0.9 })
      loadGroups()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const testBark = async () => {
    if (!form.bark_key?.trim()) return toast('请先填写 Bark Key 并保存', 'error')
    setBusy(true)
    try {
      await api('/settings/bark-test', { method: 'POST', body: {} })
      toast('测试推送已发出,看看手机', 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeGroup = async name => {
    if (!confirm(`删除分组「${name}」?其中的用户将回到 default 组。`)) return
    try {
      await api(`/groups/${name}`, { method: 'DELETE' })
      loadGroups()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  if (!form) return <Spinner />
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="animate-fade-up">
      <PageHeader title="站点设置" desc="配置站点信息、计费倍率、分组与邀请返利。" />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="card space-y-4 p-6">
            <h3 className="card-title">基础信息</h3>
            <div>
              <label className="label">站点名称</label>
              <input className="input" value={form.site_name} onChange={set('site_name')} />
            </div>
            <div>
              <label className="label">公告(展示在首页)</label>
              <textarea className="input min-h-[72px] resize-y" value={form.announcement} onChange={set('announcement')} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">计费倍率</label>
                <input className="input" type="number" step="0.1" min="0.1" value={form.price_ratio} onChange={set('price_ratio')} />
              </div>
              <div>
                <label className="label">注册赠送($)</label>
                <input className="input" type="number" step="0.1" min="0" value={form.signup_bonus} onChange={set('signup_bonus')} />
              </div>
              <div>
                <label className="label">邀请返利(%)</label>
                <input className="input" type="number" step="1" min="0" value={form.aff_rebate_percent} onChange={set('aff_rebate_percent')} />
              </div>
            </div>
            <p className="text-xs leading-5 text-ink-mute">
              最终价格 = 基础价 × 计费倍率 × 用户分组倍率;被邀请人每次兑换充值,邀请人按比例得返利。
            </p>
            <button className="btn-primary" onClick={save} disabled={busy}>
              <Save size={15} /> 保存设置
            </button>
          </div>

          <div className="card space-y-4 p-6">
            <h3 className="card-title">修改密码</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">原密码</label>
                <input
                  className="input"
                  type="password"
                  value={pwd.old_password}
                  onChange={e => setPwd(p => ({ ...p, old_password: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">新密码(至少 6 位)</label>
                <input
                  className="input"
                  type="password"
                  value={pwd.new_password}
                  onChange={e => setPwd(p => ({ ...p, new_password: e.target.value }))}
                />
              </div>
            </div>
            <button className="btn-primary" onClick={changePwd} disabled={busy}>修改密码</button>
          </div>
        </div>

        <div className="space-y-5">
        <div className="card space-y-4 p-6">
          <h3 className="card-title flex items-center gap-2">
            <Bell size={16} className="text-brand-600" /> 收款与通知
          </h3>
          <p className="-mt-2 text-xs leading-5 text-ink-mute">
            贴上你的个人收款码,用户扫码付款后点「我已完成支付」,Bark 会推送到你手机,
            在「充值订单」页确认即刻上额度。不配置收款码则充值页只显示兑换码入口。
          </p>
          <div className="flex gap-5">
            <QrPicker
              label="支付宝收款码"
              value={form.pay_qr_alipay}
              onChange={v => setForm(f => ({ ...f, pay_qr_alipay: v }))}
            />
            <QrPicker
              label="微信收款码"
              value={form.pay_qr_wechat}
              onChange={v => setForm(f => ({ ...f, pay_qr_wechat: v }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">汇率(1 USD = ? CNY)</label>
              <input className="input" type="number" step="0.1" min="0.1" value={form.cny_rate} onChange={set('cny_rate')} />
            </div>
            <div>
              <label className="label">最低充值($)</label>
              <input className="input" type="number" step="1" min="0" value={form.topup_min} onChange={set('topup_min')} />
            </div>
          </div>
          <div>
            <label className="label">Bark Key(iOS App 里那串 Key)</label>
            <input className="input font-mono !text-[13px]" placeholder="留空则不推送" value={form.bark_key} onChange={set('bark_key')} />
          </div>
          <div>
            <label className="label">Bark 服务器</label>
            <input className="input font-mono !text-[13px]" placeholder="https://api.day.app" value={form.bark_server} onChange={set('bark_server')} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save} disabled={busy}>
              <Save size={15} /> 保存设置
            </button>
            <button className="btn-ghost" onClick={testBark} disabled={busy}>
              <Bell size={15} /> 测试推送
            </button>
          </div>
        </div>

        <div className="card p-6">
          <h3 className="card-title">用户分组与倍率</h3>
          <p className="mb-4 mt-1 text-xs text-ink-mute">
            按分组差异化定价:批发客户可给更低倍率。用户的分组在「用户管理」中指派。
          </p>
          <div className="space-y-2.5">
            {groups.map(g => (
              <div key={g.name} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-2.5">
                <span className="w-28 truncate text-sm font-medium">{g.name}</span>
                <span className="text-xs text-ink-mute">{g.user_count} 人</span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-ink-mute">倍率 ×</span>
                  <input
                    className="input !w-20 !px-2 !py-1 text-right tabular-nums"
                    type="number"
                    step="0.05"
                    min="0.05"
                    defaultValue={g.ratio}
                    onBlur={e => Number(e.target.value) !== g.ratio && saveRatio(g.name, e.target.value)}
                  />
                  {g.name !== 'default' && (
                    <button
                      className="rounded-lg p-1.5 text-ink-mute hover:bg-white hover:text-bad"
                      onClick={() => removeGroup(g.name)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
            <input
              className="input flex-1"
              placeholder="新分组名,如 wholesale"
              value={newGroup.name}
              onChange={e => setNewGroup(g => ({ ...g, name: e.target.value }))}
            />
            <input
              className="input !w-24 text-right tabular-nums"
              type="number"
              step="0.05"
              min="0.05"
              value={newGroup.ratio}
              onChange={e => setNewGroup(g => ({ ...g, ratio: e.target.value }))}
            />
            <button className="btn-primary !px-3" onClick={addGroup} disabled={!newGroup.name.trim()}>
              <Plus size={15} />
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
