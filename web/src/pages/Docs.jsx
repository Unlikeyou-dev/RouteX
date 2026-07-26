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

        <div className="card p-6 text-sm leading-relaxed text-ink-dim">
          <h3 className="card-title mb-3">常见问题</h3>
          <ul className="list-disc space-y-2 pl-5">
            <li>流式输出:请求体中设置 <code className="font-mono text-brand-600">"stream": true</code> 即可,与 OpenAI 行为一致。</li>
            <li>可用模型列表:调用 <code className="font-mono text-brand-600">GET /v1/models</code>,或查看「模型价格」页面。</li>
            <li>返回 429 表示余额或令牌额度不足,请前往「钱包充值」。</li>
            <li>密钥泄露:在「API 令牌」页面禁用或删除对应令牌即可,即时生效。</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
