/**===================================================== */
// 工具函数
/**===================================================== */

/**
 * 对象转 JSON 字符串
 * @param data 数据
 * @returns JSON 字符串
 */
export function objectToJsonString(data: unknown): string {
    if (typeof data === 'string') {
        return data
    }
    if (data == null || typeof data !== 'object') {
        throw new TypeError('signData 必须是 JSON 字符串或对象')
    }
    const serialized = JSON.stringify(data)
    if (typeof serialized !== 'string') {
        throw new TypeError('signData 序列化失败')
    }
    return serialized
}

/**
 * 延迟
 * @param ms 延迟时间（ms）
 * @returns 延迟后的 Promise
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}


/**
 * 从系统字符串中解析 iOS 主版本
 * @param system 系统字符串
 * @returns iOS 主版本
 */
export function parseIosMajorFromSystemString(system: string): number {
    const m = /iOS\s+(\d+)/i.exec(system)
    if (m) {
        return Number.parseInt(m[1], 10)
    }
    return Number.parseInt(system, 10)
}

/**
 * 按段比较语义化版本号（如 `2.19.2`）。
 * @returns `1` 大于，`-1` 小于，`0` 相等；非法输入为 `0`
 */
export function compareVersion(_v1: string, _v2: string): number {
    if (typeof _v1 !== 'string' || typeof _v2 !== 'string')
        return 0

    const v1 = _v1.split('.')
    const v2 = _v2.split('.')
    const len = Math.max(v1.length, v2.length)

    while (v1.length < len) {
        v1.push('0')
    }
    while (v2.length < len) {
        v2.push('0')
    }

    for (let i = 0; i < len; i++) {
        const num1 = Number.parseInt(v1[i], 10)
        const num2 = Number.parseInt(v2[i], 10)

        if (num1 > num2) {
            return 1
        }
        else if (num1 < num2) {
            return -1
        }
    }

    return 0
}