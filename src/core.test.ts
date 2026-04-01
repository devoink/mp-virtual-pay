import { afterEach, describe, expect, it } from 'vitest'
import { VIRTUAL_PAY_ERR_USER_CANCEL } from './constant'
import {
  VirtualPaymentError,
  computeVirtualPayAvailabilitySnapshot,
  isFailedError,
  isMpWeixinRuntime,
  isNotSupportedError,
  isUserCancelError,
  isVirtualPayAvailable,
  normalizeToVirtualPaymentError,
} from './core'

function setMinimalMpWx(overrides: Record<string, unknown> = {}): void {
  (globalThis as { wx?: unknown }).wx = {
    getAccountInfoSync: () => ({ miniProgram: {} }),
    canIUse: () => false,
    getAppBaseInfo: () => ({ SDKVersion: '3.0.0', version: '8.0.70' }),
    getDeviceInfo: () => ({ platform: 'android', system: 'Android 12' }),
    ...overrides,
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'wx')
})

describe('isMpWeixinRuntime', () => {
  it('false without wx', () => {
    expect(isMpWeixinRuntime()).toBe(false)
  })

  it('false when getAccountInfoSync missing', () => {
    (globalThis as { wx?: unknown }).wx = {}
    expect(isMpWeixinRuntime()).toBe(false)
  })

  it('true when miniProgram present', () => {
    setMinimalMpWx()
    expect(isMpWeixinRuntime()).toBe(true)
  })
})

describe('computeVirtualPayAvailabilitySnapshot', () => {
  it('not ok when not in miniprogram', () => {
    expect(isMpWeixinRuntime()).toBe(false)
    const s = computeVirtualPayAvailabilitySnapshot({
      sdkVersion: '3.0.0',
      osName: 'android',
      weixinVersion: '8.0.70',
      osVersion: 'Android 12',
    })
    expect(s.ok).toBe(false)
    expect(s.canIUseRequestVirtualPayment).toBe(false)
  })

  it('ok on android when sdk gate passes', () => {
    setMinimalMpWx({ canIUse: () => false })
    const s = computeVirtualPayAvailabilitySnapshot({
      sdkVersion: '3.0.0',
      osName: 'android',
      weixinVersion: '8.0.70',
      osVersion: 'Android 12',
    })
    expect(s.ok).toBe(true)
    expect(s.baseGateOk).toBe(true)
  })

  it('ios requires wechat and system version', () => {
    setMinimalMpWx({ canIUse: () => false })
    const bad = computeVirtualPayAvailabilitySnapshot({
      sdkVersion: '3.0.0',
      osName: 'ios',
      weixinVersion: '8.0.67',
      osVersion: 'iOS 14.0',
    })
    expect(bad.ok).toBe(false)

    const good = computeVirtualPayAvailabilitySnapshot({
      sdkVersion: '3.0.0',
      osName: 'ios',
      weixinVersion: '8.0.68',
      osVersion: 'iOS 15.0',
    })
    expect(good.ok).toBe(true)
  })
})

describe('isVirtualPayAvailable', () => {
  it('false without runtime', () => {
    expect(isVirtualPayAvailable()).toBe(false)
  })

  it('true when snapshot ok', () => {
    setMinimalMpWx()
    expect(isVirtualPayAvailable()).toBe(true)
  })
})

describe('VirtualPaymentError helpers', () => {
  it('isUserCancelError', () => {
    expect(isUserCancelError(new VirtualPaymentError('canceled', 'x', null))).toBe(true)
    expect(isUserCancelError(new VirtualPaymentError('failed', 'x', null))).toBe(false)
    expect(isUserCancelError({ errCode: VIRTUAL_PAY_ERR_USER_CANCEL } as unknown as Error)).toBe(true)
  })

  it('isNotSupportedError', () => {
    expect(isNotSupportedError(new VirtualPaymentError('not_supported', 'x', null))).toBe(true)
    expect(isNotSupportedError(new Error('x'))).toBe(false)
  })

  it('isFailedError', () => {
    expect(isFailedError(new VirtualPaymentError('failed', 'x', null))).toBe(true)
    expect(isFailedError(new VirtualPaymentError('canceled', 'x', null))).toBe(false)
  })
})

describe('normalizeToVirtualPaymentError', () => {
  it('returns same VirtualPaymentError', () => {
    const e = new VirtualPaymentError('canceled', 'u', null)
    expect(normalizeToVirtualPaymentError(e)).toBe(e)
  })

  it('wraps Error', () => {
    const w = normalizeToVirtualPaymentError(new Error('boom'))
    expect(w.reason).toBe('failed')
    expect(w.message).toBe('boom')
  })
})

describe('isMpWeixinRuntime getAccountInfoSync throws', () => {
  it('returns false', () => {
    (globalThis as { wx?: unknown }).wx = {
      getAccountInfoSync: () => {
        throw new Error('x')
      },
    }
    expect(isMpWeixinRuntime()).toBe(false)
  })
})
