import type { VirtualPayAvailabilitySnapshot, VirtualPaymentFailureReason } from './types'
import { compareVersion, parseIosMajorFromSystemString } from './utils';
import { VIRTUAL_PAY_ERR_USER_CANCEL } from './constant'




/**
 * 虚拟支付错误
 */
export class VirtualPaymentError extends Error {
  /**
   * 虚拟支付失败原因
   */
  reason: VirtualPaymentFailureReason;
  /**
   * 错误消息
   */
  message: string;
  /**
   * 原始错误
   */
  originalError: WechatMiniprogram.RequestVirtualPaymentFailCallbackErr | Error | null;

  constructor(reason: VirtualPaymentFailureReason, message: string, originalError: WechatMiniprogram.RequestVirtualPaymentFailCallbackErr | Error | null) {
    super(message)
    this.reason = reason
    this.message = message
    this.originalError = originalError
  }
}

export function isUserCancelError(error: VirtualPaymentError | Error): boolean {
  if (error instanceof VirtualPaymentError) {
    return error.reason === 'canceled' ? true : false
  }
  return (error as { errCode?: number })?.errCode === VIRTUAL_PAY_ERR_USER_CANCEL
}

export function isNotSupportedError(error: unknown): error is VirtualPaymentError {
  return error instanceof VirtualPaymentError && error.reason === 'not_supported'
}

export function isFailedError(error: unknown): error is VirtualPaymentError {
  return error instanceof VirtualPaymentError && error.reason === 'failed'
}

/**
 * 将任意异常规范为 `VirtualPaymentError`（与 `createVirtualPayment` 主流程 catch 一致）。
 * 供包内使用（如监听器 `throw` 后的统一 reject）；**不**从包入口 `mp-virtual-pay` 导出。
 */
export function normalizeToVirtualPaymentError(e: unknown): VirtualPaymentError {
  if (e instanceof VirtualPaymentError) {
    return e
  }
  const message = e instanceof Error ? e.message : (e as WechatMiniprogram.RequestVirtualPaymentFailCallbackErr)?.errMsg ?? '虚拟支付失败'
  return new VirtualPaymentError('failed', message, e instanceof Error ? e : (e as WechatMiniprogram.RequestVirtualPaymentFailCallbackErr))
}

/**
 * 运行时判断是否为微信小程序：依赖微信原生 `wx`。
 * `wx.getAccountInfoSync().miniProgram` 仅在小程序运行环境存在，可区分于仅注入 JSSDK `wx` 的 WebView 等场景。
 * @see https://developers.weixin.qq.com/miniprogram/dev/api/open-api/account-info/wx.getAccountInfoSync.html
 */
export function isMpWeixinRuntime(): boolean {
  try {
    const wxApi = (typeof globalThis !== 'undefined'
      ? (globalThis as { wx?: { getAccountInfoSync?: () => { miniProgram?: unknown } } }).wx
      : undefined)
    if (!wxApi || typeof wxApi.getAccountInfoSync !== 'function') {
      return false
    }
    const account = wxApi.getAccountInfoSync()
    return account != null && account.miniProgram != null
  }
  catch {
    return false
  }
}

export function computeVirtualPayAvailabilitySnapshot(input: {
  sdkVersion: string
  osName: string
  weixinVersion: string
  osVersion: string
}): VirtualPayAvailabilitySnapshot {
  const { sdkVersion, osName, weixinVersion, osVersion } = input
  const sdkCompare2192 = compareVersion(sdkVersion, '2.19.2')
  const iosMajorParsed = parseIosMajorFromSystemString(osVersion)
  const iosWechatOk = compareVersion(weixinVersion, '8.0.68') >= 0
  const iosSystemOk = iosMajorParsed >= 15

  let canIUseRequestVirtualPayment = false
  if (isMpWeixinRuntime()) {
    canIUseRequestVirtualPayment = wx.canIUse('requestVirtualPayment')
  }

  const baseGateOk = sdkCompare2192 >= 0 || canIUseRequestVirtualPayment

  let ok = false
  let reason = ''

  if (!isMpWeixinRuntime()) {
    ok = false
    reason = '当前非微信小程序运行时（无微信原生 wx 或 wx.getAccountInfoSync().miniProgram），不包含微信小程序虚拟支付能力'
  }
  else if (!baseGateOk) {
    ok = false
    reason = `基础库门槛未通过：需 SDKVersion ≥ 2.19.2（与 2.19.2 比较为 ${sdkCompare2192}，≥0 为通过）或 canIUse('requestVirtualPayment') 为 true；当前 canIUse(requestVirtualPayment)=${canIUseRequestVirtualPayment}`
  }
  else if (osName === 'ios') {
    ok = iosWechatOk && iosSystemOk
    reason = ok
      ? `iOS：基础库 gate 通过，且微信版本 ≥8.0.68（与 8.0.68 比较为 ${compareVersion(weixinVersion, '8.0.68')}）且系统主版本 ≥15（解析为 ${iosMajorParsed}）`
      : `iOS 额外条件未通过：需微信 ≥8.0.68（与 8.0.68 比较为 ${compareVersion(weixinVersion, '8.0.68')}）且系统主版本 ≥15；当前微信=${weixinVersion}，系统串=${osVersion}，主版本=${iosMajorParsed}`
  }
  else {
    ok = true
    reason = `非 iOS（osName=${osName}），基础库 gate 已通过即可使用虚拟支付`
  }

  return {
    ok,
    reason,
    sdkVersion,
    sdkCompare2192,
    canIUseRequestVirtualPayment,
    baseGateOk,
    osName,
    weixinVersion,
    osVersion,
    iosMajorParsed,
    iosWechatOk,
    iosSystemOk,
  }
}

/**
 * 判断当前环境是否支持微信小程序虚拟支付能力。
 *
 * 仅做能力检测，不会发起支付请求。判定口径与 `createVirtualPayment` 一致。
 */
export function isVirtualPayAvailable(): boolean {
  if (!isMpWeixinRuntime()) {
    return false
  }
  try {
    const app = wx.getAppBaseInfo()
    const device = wx.getDeviceInfo()
    return computeVirtualPayAvailabilitySnapshot({
      sdkVersion: app.SDKVersion,
      osName: device.platform,
      weixinVersion: app.version,
      osVersion: device.system,
    }).ok
  }
  catch {
    return false
  }
}
