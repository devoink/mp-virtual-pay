/// <reference types="miniprogram-api-typings" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VIRTUAL_PAY_ERR_USER_CANCEL } from './constant'
import { MpWeixinVirtualPay } from './MpWeixinVirtualPay'

function installWxForPay(): { requestVirtualPayment: ReturnType<typeof vi.fn> } {
  const requestVirtualPayment = vi.fn(
    (opts: {
      success?: (r: WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult) => void
      fail?: (e: WechatMiniprogram.RequestVirtualPaymentFailCallbackErr) => void
    }) => {
      opts.success?.({ errMsg: 'ok' } as WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult)
    },
  )
  ;(globalThis as { wx?: unknown }).wx = {
      getAccountInfoSync: () => ({ miniProgram: {} }),
      canIUse: () => false,
      getAppBaseInfo: () => ({ SDKVersion: '3.0.0', version: '8.0.70' }),
      getDeviceInfo: () => ({ platform: 'android', system: 'Android 12' }),
      requestVirtualPayment,
    }
  return { requestVirtualPayment }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'wx')
  vi.restoreAllMocks()
})

describe('MpWeixinVirtualPay', () => {
  it('createVirtualPayment resolves on wx success', async () => {
    const { requestVirtualPayment } = installWxForPay()
    const pay = new MpWeixinVirtualPay({
      transaction: async () => ({
        orderid: 'o1',
        mode: 'm',
        paySig: 'p',
        signData: {},
        signature: 's',
      }),
    })
    const result = await pay.createVirtualPayment()
    expect(result.errMsg).toBe('ok')
    expect(requestVirtualPayment).toHaveBeenCalledTimes(1)
  })

  it('createVirtualPaymentResult returns success discriminant', async () => {
    installWxForPay()
    const pay = new MpWeixinVirtualPay({
      transaction: async () => ({
        orderid: 'o1',
        mode: 'm',
        paySig: 'p',
        signData: {},
        signature: 's',
      }),
    })
    const r = await pay.createVirtualPaymentResult()
    expect(r.status).toBe('success')
    if (r.status === 'success') {
      expect(r.result.errMsg).toBe('ok')
    }
  })

  it('createVirtualPayment reject maps user cancel', async () => {
    const requestVirtualPayment = vi.fn(
      (opts: { fail?: (e: WechatMiniprogram.RequestVirtualPaymentFailCallbackErr) => void }) => {
        opts.fail?.({ errMsg: 'cancel', errCode: VIRTUAL_PAY_ERR_USER_CANCEL })
      },
    )
      ; (globalThis as { wx?: unknown }).wx = {
        getAccountInfoSync: () => ({ miniProgram: {} }),
        canIUse: () => false,
        getAppBaseInfo: () => ({ SDKVersion: '3.0.0', version: '8.0.70' }),
        getDeviceInfo: () => ({ platform: 'android', system: 'Android 12' }),
        requestVirtualPayment,
      }
    const pay = new MpWeixinVirtualPay({
      transaction: async () => ({
        orderid: 'o1',
        mode: 'm',
        paySig: 'p',
        signData: {},
        signature: 's',
      }),
    })
    await expect(pay.createVirtualPayment()).rejects.toMatchObject({
      reason: 'canceled',
    })
  })

  it('invokes onSuccess before resolve', async () => {
    installWxForPay()
    const onSuccess = vi.fn()
    const pay = new MpWeixinVirtualPay({
      transaction: async () => ({
        orderid: 'o1',
        mode: 'm',
        paySig: 'p',
        signData: {},
        signature: 's',
      }),
    })
    await pay.createVirtualPayment({ onSuccess })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess.mock.calls[0][0]).toMatchObject({ errMsg: 'ok' })
  })

  it('listener throw becomes failed VirtualPaymentError', async () => {
    installWxForPay()
    const pay = new MpWeixinVirtualPay({
      transaction: async () => ({
        orderid: 'o1',
        mode: 'm',
        paySig: 'p',
        signData: {},
        signature: 's',
      }),
    })
    await expect(
      pay.createVirtualPayment({
        onSuccess: () => {
          throw new Error('listener boom')
        },
      }),
    ).rejects.toMatchObject({
      reason: 'failed',
      message: 'listener boom',
    })
  })


  it('pollOrder single-round timeout continues to next round', async () => {
    installWxForPay()
    let calls = 0
    const pay = new MpWeixinVirtualPay({
      transaction: async () => ({
        orderid: 'o1',
        mode: 'm',
        paySig: 'p',
        signData: {},
        signature: 's',
      }),
      pollOrder: {
        intervalMs: 0,
        queryTimeoutMs: 10,
        maxAttempts: 3,
        query: ({ end }) => {
          calls += 1
          if (calls === 1) {
            return new Promise<void>(() => {
              // keep pending to trigger single-round timeout
            })
          }
          end()
        },
      },
    })

    const result = await pay.createVirtualPayment()
    expect(result.errMsg).toBe('ok')
    expect(calls).toBe(2)
  })

  it('pollOrder reaches maxAttempts after repeated single-round timeout', async () => {
    installWxForPay()
    let calls = 0
    const pay = new MpWeixinVirtualPay({
      transaction: async () => ({
        orderid: 'o1',
        mode: 'm',
        paySig: 'p',
        signData: {},
        signature: 's',
      }),
      pollOrder: {
        intervalMs: 0,
        queryTimeoutMs: 10,
        maxAttempts: 2,
        query: () => {
          calls += 1
          return new Promise<void>(() => {
            // always pending, every round times out then continues
          })
        },
      },
    })

    await expect(pay.createVirtualPayment()).rejects.toMatchObject({
      reason: 'failed',
      message: '订单状态查询超时',
    })
    expect(calls).toBe(2)
  })
})
