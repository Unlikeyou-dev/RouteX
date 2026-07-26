// 个人收款码 + 人工确认。
// 管理员在站点设置里贴自己的微信/支付宝收款码,用户扫码付款后点「我已支付」,
// 管理员在后台核对到账并确认 —— 零费率、零资质、无第三方参与。
import { getSetting } from '../db.js'

export const auto = false

const METHOD_META = {
  alipay: { label: '支付宝', setting: 'pay_qr_alipay' },
  wxpay: { label: '微信支付', setting: 'pay_qr_wechat' }
}

export const METHODS = Object.keys(METHOD_META)

// 只返回管理员已经配好收款码的方式,避免用户点进去看到空白
export function listMethods() {
  return METHODS.filter(m => !!getSetting(METHOD_META[m].setting, '').trim()).map(m => ({
    key: m,
    label: METHOD_META[m].label
  }))
}

export function qrOf(method) {
  const meta = METHOD_META[method]
  return meta ? getSetting(meta.setting, '').trim() : ''
}

export function createOrder(order) {
  const qr = qrOf(order.method)
  if (!qr) throw new Error('该收款方式暂未开放,请换一种或联系管理员')
  return { qr_image: qr, qr_text: '', pay_url: '', auto: false }
}
