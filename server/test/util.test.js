import test from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir } from './helpers.js'

useTempDataDir()

const {
  redactSecrets, splitModels, splitList, normalizeBaseUrl, channelBaseUrl,
  channelGroups, channelServesGroup, usd
} = await import('../src/util.js')

test('脱敏:抹掉各家的密钥格式', () => {
  const cases = [
    ['Incorrect API key provided: sk-ABCDEFGHIJKLMNOP.', 'ABCDEFGHIJKLMNOP'],
    ['x-api-key sk-ant-api03-SECRETVALUE1234 invalid', 'SECRETVALUE1234'],
    ['API key not valid: AIzaSyD1234567890abcdef', '1234567890abcdef'],
    ['token gsk_aB3dEfGhIjKlMnOpQrSt bad', 'EfGhIjKlMnOpQrSt'],
    ['xai-abcd1234567890efgh rejected', '1234567890efgh']
  ]
  for (const [input, secret] of cases) {
    const out = redactSecrets(input)
    assert.ok(!out.includes(secret), `未抹掉密钥: ${out}`)
    assert.ok(out.includes('***'), `没有留下脱敏标记: ${out}`)
  }
})

test('脱敏:JSON 里的 api_key 字段也要抹', () => {
  const out = redactSecrets('{"api_key": "sk-proj-VERYSECRETVALUE", "model": "gpt-4o"}')
  assert.ok(!out.includes('VERYSECRETVALUE'))
  // 不能把无关字段也毁掉
  assert.ok(out.includes('gpt-4o'))
})

test('脱敏:普通消息原样保留,不误伤', () => {
  const msg = '模型 gpt-4o 当前不可用,请稍后重试'
  assert.equal(redactSecrets(msg), msg)
})

test('脱敏:空值不炸', () => {
  assert.equal(redactSecrets(null), '')
  assert.equal(redactSecrets(undefined), '')
})

test('列表解析:兼容换行与逗号,自动去空白', () => {
  assert.deepEqual(splitModels('gpt-4o\n gpt-4o-mini ,claude-3\n\n'), ['gpt-4o', 'gpt-4o-mini', 'claude-3'])
  assert.deepEqual(splitList(''), [])
  assert.deepEqual(splitList(null), [])
})

test('地址归一化:剥掉结尾的 /v1 与多余斜杠', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com')
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com')
  assert.equal(normalizeBaseUrl('https://api.example.com///'), 'https://api.example.com')
  assert.equal(normalizeBaseUrl('https://api.example.com/v1beta'), 'https://api.example.com')
  assert.equal(normalizeBaseUrl(''), '')
})

test('地址归一化:不会误伤路径中间的 v1', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/proxy'), 'https://api.example.com/v1/proxy')
})

test('渠道地址:留空时按协议回落官方地址', () => {
  assert.equal(channelBaseUrl({ type: 'openai', base_url: '' }), 'https://api.openai.com')
  assert.equal(channelBaseUrl({ type: 'anthropic', base_url: '' }), 'https://api.anthropic.com')
  assert.equal(channelBaseUrl({ type: 'gemini', base_url: '' }), 'https://generativelanguage.googleapis.com')
  assert.equal(channelBaseUrl({ type: 'openai', base_url: 'https://relay.test' }), 'https://relay.test')
})

test('渠道分组:留空按 default,避免历史数据变成谁都路由不到', () => {
  assert.deepEqual(channelGroups({ group_names: '' }), ['default'])
  assert.deepEqual(channelGroups({ group_names: 'vip,default' }), ['vip', 'default'])
  assert.ok(channelServesGroup({ group_names: '' }, 'default'))
  assert.ok(channelServesGroup({ group_names: 'vip' }, 'vip'))
  assert.ok(!channelServesGroup({ group_names: 'vip' }, 'default'))
  // group 传空时按 default 判定
  assert.ok(channelServesGroup({ group_names: 'default' }, null))
})

test('金额:收敛到微美元', () => {
  assert.equal(usd(0.1 + 0.2), 0.3)
  assert.equal(usd(1 / 3), 0.333333)
  assert.equal(usd('abc'), 0)
})
