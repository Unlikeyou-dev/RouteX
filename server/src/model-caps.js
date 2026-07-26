// Anthropic 模型能力判定。
//
// 同一个 /v1/messages 接口,不同世代的模型接受的参数**完全不同**,传错直接 400:
//   · temperature / top_p / top_k 在 Opus 4.7 及更新的模型上被移除
//   · thinking.budget_tokens 同样在 4.7+ 上被移除,取而代之的是
//     thinking:{type:'adaptive'} + output_config.effort
// 中转站不能假设用户用的是哪一代模型,所以按模型名解析世代来裁剪参数。
//
// 解析不出版本时一律按「新模型」处理 —— 少传参数最多是行为略有差异,
// 多传参数是整个请求失败。

// claude-opus-5 / claude-sonnet-4-6 / claude-opus-4-5-20251101 / claude-3-5-haiku-...
const NAME_RE = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?/i
// 也兼容老式的 claude-3-5-sonnet-... 写法(世代号在模型族之前)
const LEGACY_RE = /^claude-(\d+)(?:[-.](\d+))?-(opus|sonnet|haiku)/i

export function anthropicGeneration(model) {
  const name = String(model || '').toLowerCase()
  let m = NAME_RE.exec(name)
  if (m) {
    return { family: m[1], major: Number(m[2]), minor: m[3] === undefined ? 0 : Number(m[3]) }
  }
  m = LEGACY_RE.exec(name)
  if (m) {
    return { family: m[3], major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) }
  }
  return null
}

// 4.7 及以上(含 5 代、fable、mythos)= 新一代
function isModern(gen) {
  if (!gen) return true // 认不出来就按新的处理,宁可少传参数
  if (gen.family === 'fable' || gen.family === 'mythos') return true
  if (gen.major >= 5) return true
  return gen.major === 4 && gen.minor >= 7
}

// 4.6 起支持 adaptive thinking 与 output_config.effort
function supportsAdaptive(gen) {
  if (!gen) return true
  if (gen.family === 'fable' || gen.family === 'mythos') return true
  if (gen.major >= 5) return true
  return gen.major === 4 && gen.minor >= 6
}

export const supportsSampling = model => !isModern(anthropicGeneration(model))

// 只有 4.6 及更早才认 thinking.budget_tokens;更新的模型传了就是 400
export const supportsThinkingBudget = model => !isModern(anthropicGeneration(model))

export const supportsAdaptiveThinking = model => supportsAdaptive(anthropicGeneration(model))

// xhigh / max 两档是 4.7 才加的
export function normalizeEffort(model, effort) {
  const e = String(effort || '').toLowerCase()
  if (!e) return null
  // OpenAI 侧的 minimal / none 归到最低档
  if (e === 'minimal' || e === 'none') return 'low'
  if (['low', 'medium', 'high'].includes(e)) return e
  if (['xhigh', 'max'].includes(e)) return isModern(anthropicGeneration(model)) ? e : 'high'
  return null
}

// 缓存最小可缓存 token 数(低于此值上游会静默忽略断点,也不产生写入费用)。
// 只用于 UI 提示,注入断点本身不需要判断 —— 忽略是安全的。
export function cacheMinimumTokens(model) {
  const gen = anthropicGeneration(model)
  if (!gen) return 1024
  if (gen.family === 'fable' || gen.family === 'mythos') return 512
  if (gen.major >= 5) return gen.family === 'opus' ? 512 : 1024
  if (gen.major === 4) {
    if (gen.minor >= 8) return 1024
    if (gen.minor === 7) return 2048
    if (gen.minor >= 5) return 4096
  }
  return 2048
}
