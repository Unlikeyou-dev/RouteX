import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = process.env.ROUTEX_DATA_DIR || path.join(__dirname, '..', 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

export const PORT = Number(process.env.PORT || 3000)

// JWT secret: env override, otherwise generated once and persisted alongside the DB
const secretFile = path.join(DATA_DIR, '.jwt-secret')
export const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim()
  const s = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(secretFile, s, { mode: 0o600 })
  return s
})()

export const RELAY_TIMEOUT_MS = Number(process.env.ROUTEX_RELAY_TIMEOUT_MS || 300_000)
