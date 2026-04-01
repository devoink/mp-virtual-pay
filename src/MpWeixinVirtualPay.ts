import { DEBUG_PREFIX, VIRTUAL_PAY_ERR_USER_CANCEL } from './constant'
import {
  VirtualPaymentError,
  computeVirtualPayAvailabilitySnapshot,
  isMpWeixinRuntime,
  normalizeToVirtualPaymentError,
} from './core'
import type { PollOrderOptions, PollOrderRoundOutcome, PrepareVirtualPaymentFn, VirtualPayAvailabilitySnapshot } from './types'
import { delay, objectToJsonString } from './utils'

export interface CreateVirtualPaymentListeners {
  onBeforeComplete?: (payload: {
    status: 'success' | 'canceled' | 'not_supported' | 'failed'
    result?: WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult
    error?: VirtualPaymentError
  }) => void | Promise<void>
  onSuccess?: (result: WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult) => void | Promise<void>
  onCanceled?: (error: VirtualPaymentError) => void | Promise<void>
  onNotSupported?: (error: VirtualPaymentError) => void | Promise<void>
  onFailed?: (error: VirtualPaymentError) => void | Promise<void>
}

export type CreateVirtualPaymentResult =
  | { status: 'success', result: WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult }
  | { status: 'canceled', error: VirtualPaymentError }
  | { status: 'not_supported', error: VirtualPaymentError }
  | { status: 'failed', error: VirtualPaymentError }

export interface MpWeixinVirtualPayOptions {
  /** 为 `true` 时在控制台输出 `[MiniProgram Virtual Pay]` 前缀的调试日志（流程节点、轮询、`isVirtualPayAvailable` 依据）。 */
  debug?: boolean
  /** 可选。在通过 `isVirtualPayAvailable` 之后、`transaction` 之前执行（如登录、埋点、风控）。 */
  beforePay?: () => Promise<unknown>
  /** 返回 `orderid` 及 `mode` / `paySig` / `signData` / `signature`。 */
  transaction: PrepareVirtualPaymentFn
  /**
   * 可选。`success` 之后按间隔调用 `query`，直至 `end()`、抛错或超出 `maxAttempts`。
   * 不传则微信成功即结束。
   */
  pollOrder?: PollOrderOptions
}

/**
 * 微信小程序虚拟支付封装，对应微信客户端 API {@link https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html | wx.requestVirtualPayment}。
 *
 * **你需要做的**：在 `transaction` 里请求自己的服务端，返回订单号与签名等字段；本库不发起业务 HTTP，也不内置下单逻辑。
 *
 * **可选配置**：`beforePay`（发起支付前的钩子）、`pollOrder`（支付成功后按你的接口轮询订单是否终态）、`debug: true`（输出带 `[MiniProgram Virtual Pay]` 前缀的排查日志）。
 */
export class MpWeixinVirtualPay {
  private readonly debug: boolean
  private readonly beforePay?: () => Promise<unknown>
  private readonly transaction: PrepareVirtualPaymentFn
  private readonly pollOrder?: PollOrderOptions

  constructor(options: MpWeixinVirtualPayOptions) {
    this.debug = options.debug ?? false
    this.beforePay = options.beforePay
    this.transaction = options.transaction
    this.pollOrder = options.pollOrder
  }

  private dbg(...args: unknown[]): void {
    if (!this.debug) {
      return
    }
    console.warn(DEBUG_PREFIX, ...args)
  }

  /**
   * 发起虚拟支付。
   *
   * `isVirtualPayAvailable` => 判断是否支持虚拟支付
   *           ↓
   * `beforePay`（若有） => 在准备虚拟支付之前执行
   *           ↓
   * `transaction` => 准备虚拟支付
   *           ↓
   * `wx.requestVirtualPayment` => 发起虚拟支付
   *           ↓
   *（若配置了 `pollOrder`）轮询 `query` 直至终态 => 轮询订单状态
   *           ↓
   * 返回微信 `success` 入参
   *
   * 可选 `listeners`：在 `resolve` / `reject` **之前**按结果调用对应回调（可只传部分字段）；**不改变** Promise 语义，失败仍会 `reject`。若同时使用监听器与 `try/catch`（或 `.catch`），注意不要重复处理业务逻辑（监听器适合埋点等）。
   *
   * @returns 成功 resolve 为微信 `success` 入参；失败 reject 为 `VirtualPaymentError`。
   */
  public async createVirtualPayment(
    listeners?: CreateVirtualPaymentListeners,
  ): Promise<WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult> {
    try {
      const result = await this.runCreateVirtualPayment()
      try {
        await invokeBeforeComplete(listeners, { status: 'success', result })
        await invokeListener(listeners?.onSuccess, result)
      }
      catch (listenerErr) {
        throw normalizeToVirtualPaymentError(listenerErr)
      }
      return result
    }
    catch (e) {
      const err = normalizeToVirtualPaymentError(e)
      try {
        await invokeBeforeComplete(listeners, { status: err.reason, error: err })
        await dispatchErrorListeners(listeners, err)
      }
      catch (listenerErr) {
        throw normalizeToVirtualPaymentError(listenerErr)
      }
      throw err
    }
  }

  /**
   * 与 `createVirtualPayment` 相同流程，但以判别联合返回，**不因业务原因 reject**（`canceled` / `not_supported` / `failed` 均体现在 `status`）。
   */
  public async createVirtualPaymentResult(): Promise<CreateVirtualPaymentResult> {
    try {
      const result = await this.runCreateVirtualPayment()
      return { status: 'success', result }
    }
    catch (e) {
      const err = normalizeToVirtualPaymentError(e)
      switch (err.reason) {
        case 'canceled':
          return { status: 'canceled', error: err }
        case 'not_supported':
          return { status: 'not_supported', error: err }
        case 'failed':
          return { status: 'failed', error: err }
      }
    }
  }

  private async runCreateVirtualPayment(): Promise<WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult> {
    this.dbg('createVirtualPayment 开始')
    if (!isMpWeixinRuntime()) {
      this.dbg('非微信小程序运行时，createVirtualPayment 直接 not_supported')
      throw new VirtualPaymentError('not_supported', '虚拟支付仅支持微信小程序', null)
    }
    try {
      const availability = this.computeVirtualPayAvailabilitySnapshot()
      this.dbg('isVirtualPayAvailability 判定', availability)
      if (!availability.ok) {
        throw new VirtualPaymentError('not_supported', '当前环境不支持虚拟支付', null)
      }

      if (this.beforePay) {
        this.dbg('beforePay 执行前')
        await this.beforePay()
        this.dbg('beforePay 执行完毕')
      }

      this.dbg('transaction 请求中…')
      const { orderid, mode, paySig, signData, signature } = await this.transaction()
      const signDataStr = objectToJsonString(signData)
      this.dbg('transaction 完成', {
        orderid,
        mode,
        paySigLength: typeof paySig === 'string' ? paySig.length : 0,
        signDataLength: signDataStr.length,
        signatureLength: typeof signature === 'string' ? signature.length : 0,
      })

      const wxResult = await new Promise<WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult>((resolve, reject) => {
        this.dbg('wx.requestVirtualPayment 发起')
        wx.requestVirtualPayment({
          mode,
          paySig,
          signData: signDataStr,
          signature,
          success: (result: WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult) => {
            this.dbg('requestVirtualPayment success', result)
            resolve(result)
          },
          fail: (err: WechatMiniprogram.RequestVirtualPaymentFailCallbackErr) => {
            this.dbg('requestVirtualPayment fail', err)
            if (err?.errCode === VIRTUAL_PAY_ERR_USER_CANCEL) {
              reject(new VirtualPaymentError('canceled', err?.errMsg ?? '用户取消支付', err))
              return
            }
            reject(new VirtualPaymentError('failed', err?.errMsg ?? '虚拟支付失败', err))
          },
        } as unknown as WechatMiniprogram.RequestVirtualPaymentOption)
      })

      if (this.pollOrder) {
        const { query, intervalMs = 1500, queryTimeoutMs = 10000, maxAttempts = 60 } = this.pollOrder
        this.dbg('pollOrder 开始', { orderid, intervalMs, queryTimeoutMs, maxAttempts })

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          this.dbg(`pollOrder 第 ${attempt + 1}/${maxAttempts} 次 query 调用前`)
          const outcome = await this.runPollRound({
            orderid,
            query,
            queryTimeoutMs,
          })

          this.dbg(`pollOrder 第 ${attempt + 1}/${maxAttempts} 次 outcome`, outcome)

          if (outcome === 'end') {
            this.dbg('pollOrder 结束（end），返回微信 success 结果')
            return wxResult
          }

          if (attempt < maxAttempts - 1) {
            this.dbg(`pollOrder 等待 ${intervalMs}ms 后下一轮`)
            await delay(intervalMs)
          }
        }

        this.dbg('pollOrder 已达 maxAttempts，仍未 end，判定为订单状态查询超时')
        throw new VirtualPaymentError('failed', '订单状态查询超时', null)
      }

      this.dbg('createVirtualPayment 成功（未配置 pollOrder 或流程结束）')
      return wxResult
    }
    catch (e) {
      if (e instanceof VirtualPaymentError) {
        throw e
      }
      const message = e instanceof Error ? e.message : (e as WechatMiniprogram.RequestVirtualPaymentFailCallbackErr)?.errMsg ?? '虚拟支付失败'
      throw new VirtualPaymentError('failed', message, e instanceof Error ? e : (e as WechatMiniprogram.RequestVirtualPaymentFailCallbackErr))
    }
  }

  /**
   * 计算当前环境是否具备虚拟支付能力，并给出与 `MpWeixinVirtualPay` 内判断逻辑一致的依据字段。
   * 非微信小程序运行时为 `ok: false`。
   */
  private computeVirtualPayAvailabilitySnapshot(): VirtualPayAvailabilitySnapshot {
    const runtime = this.getRuntimeInfo()
    return computeVirtualPayAvailabilitySnapshot({
      sdkVersion: runtime.sdkVersion,
      osName: runtime.osName,
      weixinVersion: runtime.weixinVersion,
      osVersion: runtime.osVersion,
    })
  }

  private getRuntimeInfo(): { sdkVersion: string, osName: string, weixinVersion: string, osVersion: string } {
    try {
      const app = wx.getAppBaseInfo()
      const device = wx.getDeviceInfo()
      return {
        sdkVersion: app.SDKVersion,
        weixinVersion: app.version,
        osName: device.platform,
        osVersion: device.system,
      }
    }
    catch {
      throw new VirtualPaymentError('not_supported', '当前环境不支持虚拟支付', null)
    }
  }

  private async runPollRound(input: {
    orderid: string
    query: PollOrderOptions['query']
    queryTimeoutMs: number
  }): Promise<PollOrderRoundOutcome> {
    const { orderid, query, queryTimeoutMs } = input
    return new Promise<PollOrderRoundOutcome>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        // 单轮超时不视为整体失败，按 next 进入下一轮。
        resolve('next')
      }, queryTimeoutMs)

      const finish = (result: PollOrderRoundOutcome) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }

      const fail = (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        reject(new VirtualPaymentError('failed', (error as Error)?.message ?? '订单状态查询失败', error as Error))
      }

      const end = () => {
        finish('end')
      }
      const next = () => {
        finish('next')
      }

      Promise.resolve(query({ orderid, end, next }))
        .then((result) => {
          if (result === 'end' || result === 'next') {
            finish(result)
            return
          }
          if (!settled) {
            fail(new Error('pollOrder.query 必须调用 end()/next() 或返回 "end"/"next"'))
          }
        })
        .catch(fail)
    })
  }
}

async function invokeListener<A extends unknown[]>(
  fn: ((...args: A) => void | Promise<void>) | undefined,
  ...args: A
): Promise<void> {
  if (!fn) {
    return
  }
  await Promise.resolve(fn(...args))
}

async function dispatchErrorListeners(
  listeners: CreateVirtualPaymentListeners | undefined,
  err: VirtualPaymentError,
): Promise<void> {
  if (!listeners) {
    return
  }
  switch (err.reason) {
    case 'canceled':
      await invokeListener(listeners.onCanceled, err)
      break
    case 'not_supported':
      await invokeListener(listeners.onNotSupported, err)
      break
    case 'failed':
      await invokeListener(listeners.onFailed, err)
      break
  }
}

async function invokeBeforeComplete(
  listeners: CreateVirtualPaymentListeners | undefined,
  payload: {
    status: 'success' | 'canceled' | 'not_supported' | 'failed'
    result?: WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult
    error?: VirtualPaymentError
  },
): Promise<void> {
  await invokeListener(listeners?.onBeforeComplete, payload)
}
