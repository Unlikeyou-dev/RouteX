// 测试用的隔离环境:每个测试文件跑在自己的临时数据目录上,
// 绝不碰真实的 server/data。必须在 import 任何 src 模块之前设置好环境变量,
// 因为 db.js 在被导入时就会按 DATA_DIR 打开数据库。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function useTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routex-test-'))
  process.env.ROUTEX_DATA_DIR = dir
  process.env.JWT_SECRET = 'test-secret'
  return dir
}
