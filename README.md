# RouteX

<p align="center">
  <b>稳定 · 快速 · 优惠的大模型 API 中转站</b><br/>
  聚合多个上游渠道,OpenAI 协议全兼容,按量计费,一键分发。
</p>

## ✨ 功能特性

- **OpenAI 全兼容中转** — `/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`、`/v1/models`,支持流式输出(SSE)
- **多协议上游** — 除 OpenAI 兼容渠道外,支持 **Claude(Anthropic)/ Gemini(Google)原生 API** 自动协议转换,流式一并转换
- **多渠道智能调度** — 优先级 + 权重加权分流,故障自动切换;**连续失败自动熔断**,后台定时探活、恢复后自动上线
- **渠道多 Key 轮询** — 一个渠道可挂多把上游 Key(每行一把),请求时随机轮询分摊限额
- **精确按量计费** — usage 优先,缺失时用 **gpt-tokenizer 分词器精确计数**;金额收敛到微美元精度防浮点漂移
- **用户分组倍率** — 按组差异化定价(如批发组更低倍率),最终价 = 基础价 × 站点倍率 × 分组倍率
- **邀请返利** — 专属邀请链接,被邀请人每次兑换充值,邀请人按可配置比例自动得返利
- **模型映射** — 每个渠道可配置「请求模型名 → 上游模型名」映射
- **令牌管理** — 每个 API Key 独立限额、独立启停、随时吊销
- **钱包体系** — 余额、兑换码(批量生成/即时到账)、在线充值(支付占位,待接入)
- **完整控制台** — 用量仪表盘、调用日志、模型价目(管理员可视化改价)、用户/分组管理、站点设置,移动端自适应
- **精致 UI** — 浅色专业主题、系统化排版、思源黑体本地化、自绘 SVG 图表
- **安全加固** — 登录/注册按 IP 限流、安全响应头、参数化查询、JWT 鉴权

## 🚀 快速开始

```bash
# 1. 安装依赖
npm run install:all

# 2. 构建前端
npm run build

# 3. 启动(默认 3000 端口)
npm start
```

访问 `http://localhost:3000`,默认管理员账号 **root / 123456**(请登录后立即修改密码)。

### 开发模式

```bash
npm run dev:server   # 后端 :3000
npm run dev:web      # 前端 :5173(已配置代理)
```

## 📖 使用流程

1. 管理员在「上游渠道」添加你对接的上游中转站(Base URL + Key + 支持的模型),可一键测试连通性
2. 在「兑换码」批量生成充值码分发给用户
3. 用户注册 → 创建 API 令牌 → 替换 `base_url` 即可调用:

```bash
curl http://your-domain/v1/chat/completions \
  -H "Authorization: Bearer sk-你的令牌" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "你好"}]}'
```

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `JWT_SECRET` | 自动生成 | JWT 签名密钥(自动生成并持久化) |
| `ROUTEX_DATA_DIR` | `server/data` | SQLite 数据目录 |
| `ROUTEX_RELAY_TIMEOUT_MS` | `300000` | 上游请求超时 |

## 🧱 技术栈

- **后端**:Node.js + Express + better-sqlite3(WAL),JWT 鉴权
- **前端**:React 18 + Vite + TailwindCSS,自绘 SVG 图表,单套深色主题

## 📌 说明

- 在线支付为**占位实现**:下单会生成 pending 订单并提示使用兑换码/联系管理员,后续接入支付网关后在回调中完成到账即可
- 计费价格表内置主流模型,可通过管理接口调整,未知模型走兜底价
