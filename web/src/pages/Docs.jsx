import { PageHeader, CopyButton } from '../components/ui.jsx'

function Code({ children, copy }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-line bg-panel p-4 font-mono text-[13px] leading-relaxed text-ink-dim">
        <code>{children}</code>
      </pre>
      {copy && <CopyButton text={copy} className="absolute right-2 top-2" />}
    </div>
  )
}

export default function Docs() {
  const base = location.origin

  const curl = `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer sk-你的令牌" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "你好!"}]
  }'`

  const python = `from openai import OpenAI

client = OpenAI(
    base_url="${base}/v1",
    api_key="sk-你的令牌",
)

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "你好!"}],
)
print(resp.choices[0].message.content)`

  const node = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}/v1",
  apiKey: "sk-你的令牌",
});

const resp = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "你好!" }],
});
console.log(resp.choices[0].message.content);`

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="接入文档"
        desc="RouteX 完全兼容 OpenAI 协议,替换 base_url 与 api_key 即可完成迁移。"
      />

      <div className="space-y-5">
        <div className="card p-6">
          <h3 className="card-title mb-3">接口地址</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-[13px] text-brand-600">
              {base}/v1
            </span>
            <CopyButton text={`${base}/v1`} />
            <span className="text-ink-mute">支持 /chat/completions、/completions、/embeddings、/models</span>
          </div>
        </div>

        <div className="card p-6">
          <h3 className="card-title mb-3">cURL</h3>
          <Code copy={curl}>{curl}</Code>
        </div>

        <div className="card p-6">
          <h3 className="card-title mb-3">Python(openai SDK)</h3>
          <Code copy={python}>{python}</Code>
        </div>

        <div className="card p-6">
          <h3 className="card-title mb-3">Node.js(openai SDK)</h3>
          <Code copy={node}>{node}</Code>
        </div>

        <div className="card p-6">
          <h3 className="card-title mb-3">第三方客户端</h3>
          <p className="mb-4 text-[13px] leading-6 text-ink-dim">
            Cherry Studio、ChatBox、LobeChat、NextChat 等客户端都支持自定义 OpenAI 接口,
            在设置里找到「OpenAI」或「自定义模型服务」,按下面两项填写即可:
          </p>
          <div className="space-y-2.5">
            {[
              { k: 'API 地址 / Base URL', v: `${base}/v1`, note: '部分客户端要求填到 /v1,少数只需填域名' },
              { k: 'API Key', v: 'sk-你的令牌', note: '在「API 令牌」页面创建' },
              { k: '模型名', v: '见「模型价格」页面', note: '只有标记为「可用」的才能调用' }
            ].map(row => (
              <div key={row.k} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-panel px-4 py-3">
                <span className="w-40 text-[13px] font-medium text-ink">{row.k}</span>
                <span className="font-mono text-[13px] text-brand-600">{row.v}</span>
                <span className="ml-auto text-xs text-ink-mute">{row.note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="card-title mb-3">关于输出长度</h3>
          <div className="rounded-xl border border-amber-200 bg-warnbg px-4 py-3.5 text-[13px] leading-6 text-warn">
            为了在请求前准确冻结额度,<b>如果你没有指定 <code className="font-mono">max_tokens</code>,
            我们会自动补上一个默认上限</b>(通常是 4096)。需要更长的回复时,请在请求里显式指定
            <code className="font-mono"> max_tokens</code>,系统会按你指定的值冻结额度并放行。
          </div>
        </div>

        <div className="card overflow-hidden">
          <h3 className="card-title border-b border-line px-6 py-4">错误码对照</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <th className="th">HTTP</th>
                  <th className="th">code</th>
                  <th className="th">含义与处理</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {[
                  ['401', 'invalid_api_key', '令牌无效或已被禁用,请检查 Authorization 头'],
                  ['401', 'expired_api_key', '令牌已过期,请新建一个'],
                  ['403', 'account_disabled', '账户被封禁,请联系管理员'],
                  ['403', 'model_not_allowed', '该令牌设置了模型白名单,不含此模型'],
                  ['403', 'model_not_in_group', '站点有这个模型,但未对你所在的分组开放'],
                  ['429', 'insufficient_quota', '余额不足以支撑本次请求,请充值'],
                  ['429', 'rate_limit_exceeded', '该令牌每分钟请求数超限,请降速'],
                  ['429', 'too_many_requests', '并发请求数超限,请减少同时发起的请求'],
                  ['503', 'no_available_channel', '当前没有渠道支持该模型'],
                  ['502', 'upstream_error', '所有渠道都失败了,通常是上游故障,稍后重试'],
                  ['403', 'upstream_auth_error', '上游渠道密钥有问题,请联系管理员']
                ].map(([http, code, desc]) => (
                  <tr key={code + http} className="transition hover:bg-panel/60">
                    <td className="td tabular-nums">{http}</td>
                    <td className="td font-mono text-[13px] text-ink">{code}</td>
                    <td className="td whitespace-normal">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-6 text-sm leading-relaxed text-ink-dim">
          <h3 className="card-title mb-3">常见问题</h3>
          <ul className="list-disc space-y-2 pl-5">
            <li>流式输出:请求体中设置 <code className="font-mono text-brand-600">"stream": true</code> 即可,与 OpenAI 行为一致。</li>
            <li>可用模型列表:调用 <code className="font-mono text-brand-600">GET /v1/models</code>,返回的就是你当前能调的模型(已按你的分组和令牌白名单过滤)。</li>
            <li>计费口径:按实际用量结算。请求前会先冻结一笔预估额度,响应后多退少补,所以余额可能短暂偏低,请求结束即恢复。</li>
            <li>密钥泄露:在「API 令牌」页面禁用或删除对应令牌即可,即时生效。</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
