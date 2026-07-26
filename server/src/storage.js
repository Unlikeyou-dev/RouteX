// S3 兼容对象存储上传(Cloudflare R2 / 阿里云 OSS / MinIO / 七牛 …)。
//
// 只为一件事存在:把备份挪出这台机器。备份和主库放在同一块盘上,盘坏、误删目录、
// 机器丢失时两份一起没 —— 那等于没有备份。
//
// 自己实现 SigV4 而不是引 @aws-sdk/client-s3:后者是几十兆的依赖树,而我们只需要
// 一个 PUT。签名算法本身是死的,不会变。
import crypto from 'node:crypto'
import { getSetting } from './db.js'

const hmac = (key, str) => crypto.createHmac('sha256', key).update(str, 'utf8').digest()
const sha256hex = buf => crypto.createHash('sha256').update(buf).digest('hex')

export function storageConfig() {
  const endpoint = getSetting('s3_endpoint', '').trim().replace(/\/+$/, '')
  const bucket = getSetting('s3_bucket', '').trim()
  const accessKey = getSetting('s3_access_key', '').trim()
  const secretKey = getSetting('s3_secret_key', '').trim()
  const region = getSetting('s3_region', 'auto').trim() || 'auto'
  const prefix = getSetting('s3_prefix', 'routex-backups').trim().replace(/^\/+|\/+$/g, '')
  return { endpoint, bucket, accessKey, secretKey, region, prefix }
}

export const storageConfigured = () => {
  const c = storageConfig()
  return !!(c.endpoint && c.bucket && c.accessKey && c.secretKey)
}

// path-style(https://endpoint/bucket/key)兼容性最好:
// R2、MinIO、大多数自建网关都支持,而 virtual-host style 在自建上经常不通
function buildUrl(cfg, key) {
  const u = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`)
  return u
}

export async function uploadBackup(fileName, body) {
  const cfg = storageConfig()
  if (!storageConfigured()) return { ok: false, message: '未配置对象存储' }

  const key = cfg.prefix ? `${cfg.prefix}/${fileName}` : fileName
  const url = buildUrl(cfg, key)
  const payloadHash = sha256hex(body)

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260727T031500Z
  const dateStamp = amzDate.slice(0, 8)
  const service = 's3'
  const scope = `${dateStamp}/${cfg.region}/${service}/aws4_request`

  // 签名头必须按名字排序,且和实际发出去的头完全一致,差一个字节就是 403
  const headers = {
    host: url.host,
    'content-type': 'application/octet-stream',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map(h => `${h}:${headers[h]}\n`).join('')

  const canonicalRequest = [
    'PUT',
    url.pathname.split('/').map(s => encodeURIComponent(decodeURIComponent(s))).join('/'),
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, sha256hex(Buffer.from(canonicalRequest, 'utf8'))
  ].join('\n')

  const kDate = hmac(`AWS4${cfg.secretKey}`, dateStamp)
  const kRegion = hmac(kDate, cfg.region)
  const kService = hmac(kRegion, service)
  const signature = hmac(hmac(kService, 'aws4_request'), stringToSign).toString('hex')

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        ...headers,
        Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
      },
      body,
      signal: AbortSignal.timeout(120_000)
    })
    if (resp.ok) return { ok: true, key }
    const text = await resp.text().catch(() => '')
    return { ok: false, message: `HTTP ${resp.status}: ${text.slice(0, 300)}` }
  } catch (e) {
    return { ok: false, message: e.message || '上传失败' }
  }
}
