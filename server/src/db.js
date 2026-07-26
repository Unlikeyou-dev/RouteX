import Database from 'better-sqlite3'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { DATA_DIR } from './config.js'
import { DEFAULT_PRICES } from './pricing.js'

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

// ---- seed ----
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
if (userCount === 0) {
  db.prepare(
    'INSERT INTO users (username, password_hash, role, quota, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('root', bcrypt.hashSync('123456', 10), 'admin', 100, now())
  console.log('[RouteX] seeded admin account: root / 123456 (请尽快修改密码)')
}

const priceCount = db.prepare('SELECT COUNT(*) AS c FROM model_prices').get().c
if (priceCount === 0) {
  const ins = db.prepare('INSERT INTO model_prices (model, input_price, output_price) VALUES (?, ?, ?)')
  const tx = db.transaction(() => {
    for (const [model, [inp, out]] of Object.entries(DEFAULT_PRICES)) ins.run(model, inp, out)
  })
  tx()
}

const defaultSettings = {
  site_name: 'RouteX',
  announcement: '欢迎使用 RouteX API 中转站,新用户注册即送 $1 体验额度。',
  price_ratio: '1',
  signup_bonus: '1'
}
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
for (const [k, v] of Object.entries(defaultSettings)) insSetting.run(k, v)

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}
