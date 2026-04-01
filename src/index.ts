export { MpWeixinVirtualPay } from './MpWeixinVirtualPay'
export type {
  CreateVirtualPaymentListeners,
  CreateVirtualPaymentResult,
  MpWeixinVirtualPayOptions,
} from './MpWeixinVirtualPay'

export {
  isVirtualPayAvailable,
  VirtualPaymentError,
  isUserCancelError,
  isNotSupportedError,
  isFailedError,
} from './core'