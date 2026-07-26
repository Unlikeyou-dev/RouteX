// 支付渠道适配层。
//
// 每个 provider 只需实现 createOrder(order) → { qr_image, qr_text, pay_url, auto }:
//   qr_image  直接可渲染的图片地址(URL 或 data URI)—— 收款码模式用这个
//   qr_text   需要前端自己画成二维码的文本 —— 网关模式用这个(如 weixin://wxpay/bizpayurl?pr=xx)
//   pay_url   需要跳转的收银台地址
//   auto      是否自动到账(false 表示需要人工确认)
//
// 目前只有 manual(个人收款码 + 人工确认)。以后接易支付/官方直连时,
// 在同目录新增 epay.js 实现同一个接口并注册进来即可,订单状态机与前端都不用改。
import * as manual from './manual.js'

const PROVIDERS = { manual }

export function getProvider(name = 'manual') {
  return PROVIDERS[name] || PROVIDERS.manual
}

// 当前启用的收款方式,由站点设置决定
export { listMethods } from './manual.js'
