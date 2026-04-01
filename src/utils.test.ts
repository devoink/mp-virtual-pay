import { describe, expect, it } from 'vitest'
import { compareVersion, objectToJsonString, parseIosMajorFromSystemString } from './utils'

describe('compareVersion', () => {
  it('compares semantic versions', () => {
    expect(compareVersion('2.19.2', '2.19.2')).toBe(0)
    expect(compareVersion('2.20.0', '2.19.2')).toBe(1)
    expect(compareVersion('2.18.0', '2.19.2')).toBe(-1)
  })

  it('returns 0 when either operand is not a string', () => {
    expect(compareVersion(null as unknown as string, '1.0.0')).toBe(0)
  })
})

describe('parseIosMajorFromSystemString', () => {
  it('parses iOS N from iOS N.x', () => {
    expect(parseIosMajorFromSystemString('iOS 16.2')).toBe(16)
  })

  it('falls back to parseInt of whole string', () => {
    expect(parseIosMajorFromSystemString('15')).toBe(15)
  })
})

describe('objectToJsonString', () => {
  it('returns string as-is', () => {
    expect(objectToJsonString('{"a":1}')).toBe('{"a":1}')
  })

  it('serializes object', () => {
    expect(objectToJsonString({ a: 1 })).toBe('{"a":1}')
  })

  it('throws on invalid signData', () => {
    expect(() => objectToJsonString(null)).toThrow(TypeError)
    expect(() => objectToJsonString(1)).toThrow(TypeError)
  })
})
