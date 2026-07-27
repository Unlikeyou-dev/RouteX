import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Save, Plus, Trash2, Upload, Bell, X, ShieldCheck, HardDrive, Loader2, CloudUpload } from 'lucide-react'
import { api, setToken } from '../api.js'
import { toast, useAuth } from '../store.jsx'
import { PageHeader, Spinner, Switch } from '../components/ui.jsx'

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
  const [backups, setBackups] = useState([])
  const [backingUp, setBackingUp] = useState(false)
  const [storageTesting, setStorageTesting] = useState(false)

  const testStorage = async () => {
    setStorageTesting(true)
    try {
      const data = await api('/settings/storage-test', { method: 'POST', body: {} })
      toast(`上传成功 → ${data.key}`, 'success')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setStorageTesting(false)
    }
  }

  const loadGroups = () => api('/groups').then(setGroups).catch(() => {})
  const loadBackups = () => api('/settings/backups').then(setBackups).catch(() => {})
  useEffect(() => {
    api('/settings').then(setForm).catch(e => toast(e.message, 'error'))
    loadGroups()
    loadBackups()
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
      const data = await api('/user/me', { method: 'PUT', body: pwd })
      // 改密码会吊销所有已签发的登录态,后端顺手换发了一张新的,存下来免得自己被踢
      if (data?.token) setToken(data.token)
      toast('密码已修改,其他设备上的登录已失效', 'success')
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

  const runBackup = async () => {
    setBackingUp(true)
    try {
      const info = await api('/settings/backup', { method: 'POST', body: {} })
      toast(`已备份 ${info.file}(${(info.size / 1024 / 1024).toFixed(2)} MB)`, 'success')
      loadBackups()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBackingUp(false)
    }
  }

  const runPrune = async () => {
    const days = Number(form.log_retention_days) || 0
    if (!days) return toast('保留天数为 0(永久保留),无需清理', 'info')
    if (!confirm(`确定删除 ${days} 天以前的调用日志吗?此操作不可撤销。`)) return
    try {
      const r = await api('/settings/prune-logs', { method: 'POST', body: {} })
      toast(r.removed ? `已清理 ${r.removed} 条日志` : '没有需要清理的日志', 'success')
    } catch (e) {
      toast(e.message, 'error')
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
            {/* 公告已经独立成一页。留在这里等于有两个地方能写公告,迟早各写各的 */}
            <p className="text-xs leading-5 text-ink-mute">
              站点公告请到
              <Link to="/console/announcements" className="mx-1 font-medium text-brand-600 hover:underline">公告管理</Link>
              发布 —— 支持多条、分级别、可置顶,用户在控制台顶部和公告页都能看到。
            </p>
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">缓存读取默认倍率</label>
                <input className="input" type="number" step="0.05" min="0" value={form.cache_read_ratio} onChange={set('cache_read_ratio')} />
              </div>
              <div>
                <label className="label">缓存写入默认倍率</label>
                <input className="input" type="number" step="0.05" min="0" value={form.cache_write_ratio} onChange={set('cache_write_ratio')} />
              </div>
            </div>
            <p className="text-xs leading-5 text-ink-mute">
              最终价格 = 基础价 × 计费倍率 × 用户分组倍率;被邀请人每次兑换充值,邀请人按比例得返利。
              命中上游缓存的输入 token 按「输入价 × 缓存倍率」计价,可在「模型价格」里为单个模型单独设定。
            </p>
            <button className="btn-primary" onClick={save} disabled={busy}>
              <Save size={15} /> 保存设置
            </button>
          </div>

          <div className="card space-y-4 p-6">
            <h3 className="card-title flex items-center gap-2">
              <ShieldCheck size={16} className="text-brand-600" /> 风控
            </h3>
            <p className="-mt-2 text-xs leading-5 text-ink-mute">
              每次调用会在请求前按「输入 token + 预估输出 token」先冻结额度,响应后按实际用量多退少补。
              这是防止用户并发白嫖的关键,无法关闭。
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">输出上限 tokens</label>
                <input
                  className="input"
                  type="number"
                  step="256"
                  min="0"
                  value={form.precharge_completion_tokens}
                  onChange={set('precharge_completion_tokens')}
                />
              </div>
              <div>
                <label className="label">安全边际</label>
                <input
                  className="input"
                  type="number"
                  step="0.05"
                  min="1"
                  value={form.precharge_margin}
                  onChange={set('precharge_margin')}
                />
              </div>
              <div>
                <label className="label">并发上限</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  value={form.max_concurrent_per_user}
                  onChange={set('max_concurrent_per_user')}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">单令牌每分钟请求上限</label>
                <input
                  className="input"
                  type="number"
                  step="10"
                  min="0"
                  value={form.relay_rate_limit_per_min}
                  onChange={set('relay_rate_limit_per_min')}
                />
              </div>
              <div>
                <label className="label">思考额外预留 tokens</label>
                <input
                  className="input"
                  type="number"
                  step="1024"
                  min="0"
                  value={form.precharge_thinking_tokens}
                  onChange={set('precharge_thinking_tokens')}
                />
              </div>
            </div>
            <div>
              <label className="label">单用户单模型每分钟请求上限</label>
              <input
                className="input"
                type="number"
                step="1"
                min="0"
                value={form.model_rate_limit_per_min}
                onChange={set('model_rate_limit_per_min')}
              />
              <p className="mt-1.5 text-xs leading-5 text-ink-mute">
                所有模型的默认值,0 = 不限。上面的令牌限频拦不住一个用户开十把令牌,
                这一道按「用户 + 模型」计数;贵模型可以在价目页单独设更严的值覆盖这里。
              </p>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3">
              <div>
                <div className="text-sm font-medium">Anthropic 自动缓存</div>
                <div className="text-xs leading-5 text-ink-mute">
                  自动注入 cache_control 断点。Anthropic 的缓存必须显式标记,不注入就永远不会命中;
                  内容长度不够时上游会静默忽略,不产生额外费用。
                </div>
              </div>
              <Switch
                checked={form.anthropic_auto_cache === '1'}
                onChange={v => setForm(f => ({ ...f, anthropic_auto_cache: v ? '1' : '0' }))}
              />
            </div>
            <div>
              <label className="label">控制台跨域白名单</label>
              <input
                className="input"
                placeholder="留空 = 仅同源(推荐);多个用逗号分隔,如 https://panel.example.com"
                value={form.cors_origins}
                onChange={set('cors_origins')}
              />
              <p className="mt-1.5 text-xs leading-5 text-ink-mute">
                只影响控制台接口(/api)。留空时其他网站无法借用户浏览器里的登录态调管理接口。
                中转接口(/v1、/v1beta)不受此项限制,始终对所有来源开放 —— 客户端拿自己的 Key 直连。
              </p>
            </div>
            <p className="text-xs leading-5 text-ink-mute">
              请求未指定 max_tokens 时,我们会按「输出上限」注入给上游,让冻结额度成为真正的上界。
              安全边际用于兜住上游分词口径与我们的差异(1.2 = 上浮 20%)。并发与频率上限填 0 表示不限。
            </p>
            <button className="btn-primary" onClick={save} disabled={busy}>
              <Save size={15} /> 保存设置
            </button>
          </div>

          <div className="card space-y-4 p-6">
            <h3 className="card-title flex items-center gap-2">
              <HardDrive size={16} className="text-brand-600" /> 数据与备份
            </h3>
            <p className="-mt-2 text-xs leading-5 text-ink-mute">
              调用日志只增不删会把磁盘吃满;余额、订单全在一个 SQLite 文件里,没有备份就是单点。
              系统每天自动清理过期日志并热备份一次,下面也可以手动触发。
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">日志保留天数</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  value={form.log_retention_days}
                  onChange={set('log_retention_days')}
                />
                <p className="mt-1.5 text-xs text-ink-mute">0 = 永久保留</p>
              </div>
              <div>
                <label className="label">备份保留份数</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="1"
                  value={form.backup_keep}
                  onChange={set('backup_keep')}
                />
                <p className="mt-1.5 text-xs text-ink-mute">超出的旧备份自动删除</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3">
              <div>
                <div className="text-sm font-medium">每日自动备份</div>
                <div className="text-xs text-ink-mute">
                  备份存放于 server/data/backups,备完立刻校验(integrity_check + 关键表行数),校验不过会报警
                </div>
              </div>
              <Switch
                checked={form.backup_enabled === '1'}
                onChange={v => setForm(f => ({ ...f, backup_enabled: v ? '1' : '0' }))}
              />
            </div>

            <div className="border-t border-line pt-4">
              <div className="mb-1 text-sm font-medium">异地备份(S3 兼容对象存储)</div>
              <p className="mb-3 text-xs leading-5 text-ink-mute">
                本地备份和数据库在同一块盘上,盘坏、误删目录、机器丢失时两份一起没 ——
                这是<b className="text-ink-dim">唯一能挡住那种情况</b>的措施。Cloudflare R2、阿里云 OSS、MinIO 等都可以,
                留空则只留本地备份。
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Endpoint</label>
                  <input
                    className="input"
                    placeholder="https://xxx.r2.cloudflarestorage.com"
                    value={form.s3_endpoint || ''}
                    onChange={set('s3_endpoint')}
                  />
                </div>
                <div>
                  <label className="label">Bucket</label>
                  <input className="input" value={form.s3_bucket || ''} onChange={set('s3_bucket')} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Access Key</label>
                  <input className="input" value={form.s3_access_key || ''} onChange={set('s3_access_key')} />
                </div>
                <div>
                  <label className="label">Secret Key</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="已保存则显示为星号,不改就别动"
                    value={form.s3_secret_key || ''}
                    onChange={set('s3_secret_key')}
                  />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Region</label>
                  <input className="input" placeholder="auto" value={form.s3_region || ''} onChange={set('s3_region')} />
                </div>
                <div>
                  <label className="label">路径前缀</label>
                  <input className="input" placeholder="routex-backups" value={form.s3_prefix || ''} onChange={set('s3_prefix')} />
                </div>
              </div>
              <button className="btn-ghost mt-4" onClick={testStorage} disabled={storageTesting}>
                {storageTesting ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
                测试上传
              </button>
              <p className="mt-1.5 text-xs leading-5 text-ink-mute">
                配错了不该等到某天真出事才发现 —— 先保存,再点这里传一个小文件试试。
              </p>
            </div>

            <div className="border-t border-line pt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">渠道定时巡检</div>
                  <div className="text-xs text-ink-mute">熔断的渠道每 5 分钟探一次,恢复即自动上线</div>
                </div>
                <Switch
                  checked={form.health_check_enabled === '1'}
                  onChange={v => setForm(f => ({ ...f, health_check_enabled: v ? '1' : '0' }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">探活方式</label>
                  <select className="input" value={form.health_check_mode} onChange={set('health_check_mode')}>
                    <option value="models">拉模型列表(免费)</option>
                    <option value="chat">真实对话(会计费)</option>
                  </select>
                </div>
                <div>
                  <label className="label">全量巡检间隔(分钟)</label>
                  <input
                    className="input"
                    type="number"
                    step="5"
                    min="0"
                    value={form.health_sweep_minutes}
                    onChange={set('health_sweep_minutes')}
                  />
                </div>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-ink-mute">
                定时巡检默认用模型列表接口探活,不消耗任何 token。切成「真实对话」能确认 chat 链路真的通,
                但每次巡检都会按输入 token 计费,渠道多了是一笔持续支出。间隔填 0 表示不做全量巡检。
                渠道页手动点「测试连通性」始终走真实对话。
              </p>
            </div>

            {backups.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
                  最近备份({backups.length})
                </div>
                {backups.slice(0, 5).map(b => (
                  <div key={b.file} className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-[13px]">
                    <span className="font-mono text-ink-dim">{b.file}</span>
                    <span className="tabular-nums text-ink-mute">{(b.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={save} disabled={busy}>
                <Save size={15} /> 保存设置
              </button>
              <button className="btn-ghost" onClick={runBackup} disabled={backingUp}>
                {backingUp ? <Loader2 size={15} className="animate-spin" /> : <HardDrive size={15} />} 立即备份
              </button>
              <button className="btn-ghost" onClick={runPrune} disabled={busy}>
                <Trash2 size={15} /> 清理过期日志
              </button>
            </div>
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
