import Database from 'better-sqlite3'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { DATA_DIR } from './config.js'

export const db = new Database(path.join(DATA_DIR, 'routex.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  quota REAL NOT NULL DEFAULT 0,
  used_quota REAL NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  quota REAL NOT NULL DEFAULT 0,
  used_quota REAL NOT NULL DEFAULT 0,
  unlimited INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  status INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  models TEXT NOT NULL DEFAULT '',
  model_mapping TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,
  status INTEGER NOT NULL DEFAULT 1,
  last_test_at INTEGER,
  last_test_ok INTEGER,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_id INTEGER,
  channel_id INTEGER,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  stream INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_user_time ON logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(created_at);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused',
  used_by INTEGER,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  handled_by INTEGER,
  handled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resets_status ON password_resets(status, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_prices (
  model TEXT PRIMARY KEY,
  input_price REAL NOT NULL,
  output_price REAL NOT NULL
);
`)

export const now = () => Math.floor(Date.now() / 1000)

// ---- 增量迁移:为既有库补充新列 ----
function ensureColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}
ensureColumn('users', 'group_name', "group_name TEXT NOT NULL DEFAULT 'default'")
ensureColumn('users', 'invite_code', 'invite_code TEXT')
ensureColumn('users', 'invited_by', 'invited_by INTEGER')
ensureColumn('users', 'aff_earned', 'aff_earned REAL NOT NULL DEFAULT 0')
ensureColumn('users', 'aff_count', 'aff_count INTEGER NOT NULL DEFAULT 0')
// 会话版本号:改密码/管理员重置时递增,使已签发的 JWT 立即失效
ensureColumn('users', 'token_version', 'token_version INTEGER NOT NULL DEFAULT 0')
ensureColumn('channels', 'type', "type TEXT NOT NULL DEFAULT 'openai'")
// 第三方网关(如 api.longcat.chat)走 Anthropic 路径但鉴权用的是 Bearer,
// 打开这个开关就把 x-api-key 换成 Authorization: Bearer
ensureColumn('channels', 'bearer_auth', 'bearer_auth INTEGER NOT NULL DEFAULT 0')
ensureColumn('channels', 'auto_disabled', 'auto_disabled INTEGER NOT NULL DEFAULT 0')
ensureColumn('channels', 'fail_count', 'fail_count INTEGER NOT NULL DEFAULT 0')
// 渠道可服务的用户分组(可多组,逗号/换行分隔);用户只会被路由到自己所在组的渠道
ensureColumn('channels', 'group_names', "group_names TEXT NOT NULL DEFAULT 'default'")
ensureColumn('channels', 'used_quota', 'used_quota REAL NOT NULL DEFAULT 0')
ensureColumn('channels', 'request_count', 'request_count INTEGER NOT NULL DEFAULT 0')
// 令牌级模型白名单,留空表示不限
ensureColumn('tokens', 'model_limits', "model_limits TEXT NOT NULL DEFAULT ''")
// 充值订单:对外单号、实付人民币、用户备注、审核痕迹
ensureColumn('topups', 'order_no', 'order_no TEXT')
ensureColumn('topups', 'cny_amount', 'cny_amount REAL NOT NULL DEFAULT 0')
ensureColumn('topups', 'payer_note', 'payer_note TEXT')
ensureColumn('topups', 'submitted_at', 'submitted_at INTEGER')
ensureColumn('topups', 'reviewed_by', 'reviewed_by INTEGER')
ensureColumn('topups', 'reviewed_at', 'reviewed_at INTEGER')
ensureColumn('topups', 'review_note', 'review_note TEXT')
// 缓存命中的输入 token 上游是打折的,这里单独记一笔,既用于计价也让用户看到省了多少
ensureColumn('logs', 'cached_tokens', 'cached_tokens INTEGER NOT NULL DEFAULT 0')
ensureColumn('logs', 'reasoning_tokens', 'reasoning_tokens INTEGER NOT NULL DEFAULT 0')
// 每个模型可单独设缓存倍率(各家差异很大:OpenAI 约 0.5、Anthropic 约 0.1、Gemini 约 0.25);
// 留空则回落到站点默认
ensureColumn('model_prices', 'cache_read_ratio', 'cache_read_ratio REAL')
ensureColumn('model_prices', 'cache_write_ratio', 'cache_write_ratio REAL')
// 单用户对该模型每分钟的请求上限(0 = 用站点默认)。
// 令牌级限频拦不住「一个用户开十把令牌」,贵模型的上游配额还是会被一个人打满。
ensureColumn('model_prices', 'rpm_per_user', 'rpm_per_user INTEGER NOT NULL DEFAULT 0')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_order_no ON topups(order_no)')
db.exec('CREATE INDEX IF NOT EXISTS idx_topups_status ON topups(status, id)')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code)')

// 余额变更流水。
//
// users.quota 只是个「当前值」,没有流水就有两个盲区:管理员在后台直接改余额
// 完全不留痕,以及万一恢复到旧备份,你没法算出某个用户到底该有多少钱。
// 充值有 topups、消费有 logs.cost,中间的手动调整原本是黑洞。
//
// 消费不进这张表(logs 已经一条不落地记了,再记一遍等于把最热的表写两遍),
// 对账公式是:余额 = 流水合计 - 累计消费(users.used_quota,不随日志清理而丢失)。
db.exec(`CREATE TABLE IF NOT EXISTS balance_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  type TEXT NOT NULL,
  note TEXT,
  operator_id INTEGER,
  created_at INTEGER NOT NULL
)`)
db.exec('CREATE INDEX IF NOT EXISTS idx_ledger_user ON balance_ledger(user_id, id)')

// 期初结转:老库里的用户一条流水都没有,不补的话对账会把每个人都报成异常,
// 这个功能在既有安装上就等于不能用。已知的只有「现在的余额」和「累计消费」,
// 反推出历史入账总额 = 余额 + 消费,记成一笔期初 —— 拆不出明细,但从此刻起账是平的。
{
  const hasLedger = db.prepare('SELECT COUNT(*) AS c FROM balance_ledger').get().c > 0
  const olds = hasLedger ? [] : db.prepare('SELECT id, quota, used_quota FROM users').all()
  if (olds.length) {
    const ins = db.prepare(
      `INSERT INTO balance_ledger (user_id, amount, balance_after, type, note, created_at)
       VALUES (?, ?, ?, 'opening', '期初结转(启用流水前的历史入账合计)', ?)`
    )
    const ts = Math.floor(Date.now() / 1000)
    db.transaction(() => {
      for (const u of olds) {
        const opening = Math.round(((u.quota || 0) + (u.used_quota || 0)) * 1e6) / 1e6
        if (opening) ins.run(u.id, opening, u.quota || 0, ts)
      }
    })()
    console.log(`[RouteX] 已为 ${olds.length} 个既有账户补记期初流水`)
  }
}

// 公告。
//
// 原先只有 settings 里一条 announcement 字符串:发新的就把旧的覆盖掉,没有历史、
// 没有日期、没有轻重之分 —— 调价通知和「今晚维护 10 分钟」挤在同一个格子里。
db.exec(`CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'info',
  pinned INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`)
db.exec('CREATE INDEX IF NOT EXISTS idx_ann_pub ON announcements(published, pinned, id)')
// 未读判定用一个时间戳而不是「用户 × 公告」的关联表:小站点上后者只是让行数
// 白白翻倍,而「打开公告页 = 全部已读」在这个体量上完全够用
ensureColumn('users', 'announcement_read_at', 'announcement_read_at INTEGER NOT NULL DEFAULT 0')

// 工单(售后支持)。
//
// 中转站是收钱的服务,用户充值出了问题除了干等没有别的办法找到你 —— 站点没有邮件
// 基础设施,Bark 又只在你手上。工单是唯一一条用户能主动发起、双方都能回溯的通道。
//
// status 只留三态:open 需要你处理 / answered 已回复等用户 / closed 已关闭。
// 更细的状态机(处理中、挂起、升级)对单人运营的站点是负担,不是帮助。
db.exec(`CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
)`)
db.exec(`CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  is_staff INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`)
db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, updated_at)')
db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_msgs ON ticket_messages(ticket_id, id)')

// 渠道兼容性自检结果:按「渠道 + 模型」记一份能力表。
// 我们按模型名猜世代来裁剪参数,但上游是别人的中转站,改版、限制、魔改都可能
// 让某个参数突然被拒 —— 那时用户看到的只是一片 400,没人知道是哪个字段的问题。
db.exec(`CREATE TABLE IF NOT EXISTS channel_caps (
  channel_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  results TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, model)
)`)

// 用户分组(计费倍率按组叠加)
db.exec(`CREATE TABLE IF NOT EXISTS groups (
  name TEXT PRIMARY KEY,
  ratio REAL NOT NULL DEFAULT 1
)`)
db.prepare('INSERT OR IGNORE INTO groups (name, ratio) VALUES (?, ?)').run('default', 1)

export function groupRatio(name) {
  const row = db.prepare('SELECT ratio FROM groups WHERE name = ?').get(name || 'default')
  return row ? row.ratio : 1
}

// ---- seed ----
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
if (userCount === 0) {
  const seeded = db.prepare(
    'INSERT INTO users (username, password_hash, role, quota, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('root', bcrypt.hashSync('123456', 10), 'admin', 100, now())
  // 初始额度也要有流水,否则对账每次都会把 root 报成「余额凭空多出来」。
  // 这里直接写表而不是调 ledger.js —— 那个模块反过来 import 本文件
  db.prepare(
    `INSERT INTO balance_ledger (user_id, amount, balance_after, type, note, created_at)
     VALUES (?, ?, ?, 'signup', '初始管理员额度', ?)`
  ).run(seeded.lastInsertRowid, 100, 100, now())
  console.log('[RouteX] seeded admin account: root / 123456 (请尽快修改密码)')
}

// 补发邀请码 —— 必须排在 seed 之后,否则全新安装的 root 会永远没有邀请码
{
  const missing = db.prepare('SELECT id FROM users WHERE invite_code IS NULL').all()
  if (missing.length) {
    const crypto = await import('node:crypto')
    const upd = db.prepare('UPDATE users SET invite_code = ? WHERE id = ?')
    for (const u of missing) upd.run(crypto.randomBytes(4).toString('hex'), u.id)
  }
}

// 价目表刻意不预置任何模型:站点里有哪些模型由渠道决定,价目表只负责配价。
// 添加渠道后,价目页会把「渠道有但还没定价」的模型高亮出来提示批量补齐。
// (DEFAULT_PRICES 现在只作为定价时的建议值,见 pricing.js 的 suggestPrice)

const defaultSettings = {
  site_name: 'RouteX',
  announcement: '欢迎使用 RouteX API 中转站,新用户注册即送 $1 体验额度。',
  price_ratio: '1',
  // 缓存 token 的默认倍率(相对输入价):读取命中打一折,写入缓存略贵
  cache_read_ratio: '0.1',
  cache_write_ratio: '1.25',
  signup_bonus: '1',
  aff_rebate_percent: '10',
  // 收款与推送(扫码充值:管理员贴自己的个人收款码,到账后人工确认)
  pay_qr_alipay: '',
  pay_qr_wechat: '',
  cny_rate: '7.3',
  topup_min: '1',
  bark_key: '',
  bark_server: 'https://api.day.app',
  // 风控:请求前预扣费时假定的输出 token 数(请求自带 max_tokens 时以它为准)
  precharge_completion_tokens: '4096',
  // 开启思考时额外预留(并预扣)的 token,思考与正文共用 max_tokens
  precharge_thinking_tokens: '8192',
  // 冻结额度的安全边际,覆盖上游分词口径差异
  precharge_margin: '1.2',
  // 自动为原生 Anthropic 请求注入 cache_control 断点
  anthropic_auto_cache: '1',
  // 控制台接口允许的跨域来源(逗号分隔,留空 = 仅同源)。中转入口不受此限制
  cors_origins: '',
  // 单用户在途请求上限,0 = 不限
  max_concurrent_per_user: '10',
  // 单令牌每分钟请求上限,0 = 不限
  relay_rate_limit_per_min: '0',
  // 「单用户 + 单模型」每分钟请求上限的站点默认值,0 = 不限;
  // 价目表里可给单个模型单独设,只卡贵模型
  model_rate_limit_per_min: '0',
  // 单次请求最多尝试几个渠道(故障转移次数)
  relay_retry_channels: '3',
  // 异地备份(S3 兼容对象存储)。本地备份和主库同盘,机器没了就一起没了 ——
  // 这几项是唯一能挡住那种情况的措施
  s3_endpoint: '',
  s3_bucket: '',
  s3_access_key: '',
  s3_secret_key: '',
  s3_region: 'auto',
  s3_prefix: 'routex-backups',
  // 渠道巡检:models 用免费的模型列表接口探活,chat 发真实请求(会产生费用)
  health_check_enabled: '1',
  health_check_mode: 'models',
  health_sweep_minutes: '30',
  // 运维:调用日志保留天数(0 = 永久),数据库每日备份与保留份数
  log_retention_days: '90',
  backup_enabled: '1',
  backup_keep: '7'
}
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
for (const [k, v] of Object.entries(defaultSettings)) insSetting.run(k, v)

// 把旧的单条公告迁进公告列表,否则升级后站长会发现自己写的公告凭空消失了。
// 必须排在默认设置写入之后 —— 否则全新安装时那条欢迎语还没落库,迁移会扑空
{
  const has = db.prepare('SELECT COUNT(*) AS c FROM announcements').get().c > 0
  const old = has ? '' : getSetting('announcement', '').trim()
  if (old) {
    const ts = now()
    db.prepare(
      "INSERT INTO announcements (title, body, level, pinned, published, created_at, updated_at) VALUES (?, '', 'info', 0, 1, ?, ?)"
    ).run(old.slice(0, 200), ts, ts)
    console.log('[RouteX] 已把原有的站点公告迁入公告列表')
  }
}

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}
