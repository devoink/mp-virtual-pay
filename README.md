# mp-virtual-pay

微信小程序虚拟支付（[`wx.requestVirtualPayment`](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)）的轻量封装。可作为依赖包在**微信原生小程序**与 UniApp 等场景中使用。

本库**不包含业务 HTTP**：下单、拉取签名等由你在 `transaction` 中自行实现。微信客户端支付成功**不等于**服务端订单已终态，可通过可选的 `pollOrder` 轮询你的订单接口后再结束流程。

## 特性

- 仅依赖微信原生全局 `wx`，通过 `wx.getAccountInfoSync().miniProgram` 判断是否在小程序运行时，不依赖 UniApp 条件编译。
- 统一失败结构（`not_supported` / `failed` / `canceled`），便于区分环境与用户取消。
- 可选支付后订单轮询（`end` / `next` 语义清晰）。
- `debug: true` 时输出 `[MiniProgram Virtual Pay]` 前缀日志，便于排查可用性判定。

## 安装

```bash
yarn add mp-virtual-pay
# 或: npm install mp-virtual-pay
```

**仅需安装本包即可**，运行时不依赖其它 npm 包（微信客户端提供全局 `wx`）。

若你在 **TypeScript** 中开发，且项目里还没有微信小程序的全局类型，可再安装（多数微信开发者工具 / UniApp 模板工程已自带，无需重复装）：

```bash
yarn add -D miniprogram-api-typings
# 或: npm install miniprogram-api-typings --save-dev
```

本库源码通过 `/// <reference types="miniprogram-api-typings" />` 关联 `WechatMiniprogram.*` 等类型；未装该包时，仅影响你侧 TS 能否解析这些全局类型，不影响 JS 运行。

## 环境可用性说明

库内部会判断是否支持虚拟支付，大致规则如下：

- 须在**微信小程序**运行时（有微信原生 `wx` 且 `getAccountInfoSync().miniProgram` 存在）。
- 基础库：`SDKVersion >= 2.19.2`，或 `wx.canIUse('requestVirtualPayment')` 为 `true`（满足其一即可通过「基础门槛」）。
- **iOS** 额外要求：微信版本 `>= 8.0.68`，且系统主版本 `>= 15`。

不满足时 `createVirtualPayment` 会 reject，错误为 `VirtualPaymentError`，其中 `reason` 为 `not_supported`。

## 使用方法

### 基础示例

```ts
import { MpWeixinVirtualPay, VirtualPaymentError, isUserCancelError } from "mp-virtual-pay";

const virtualPay = new MpWeixinVirtualPay({
  debug: false,
  transaction: async () => {
    // 在此请求你的服务端，拿到微信虚拟支付所需的五元组
    const res = await yourApi.createVirtualPayOrder();
    return {
      orderid: res.orderid,
      mode: res.mode,
      paySig: res.paySig,
      signData: res.signData, // 对象或已是 JSON 字符串均可
      signature: res.signature,
    };
  },
});

try {
  const result = await virtualPay.createVirtualPayment();
  // result 为微信 success 回调入参 WechatMiniprogram.RequestCommonPaymentSuccessCallbackResult
} catch (err) {
  if (isUserCancelError(err as Error)) {
    // 用户取消
  } else if (err instanceof VirtualPaymentError && err.reason === "not_supported") {
    // 当前环境不支持
  } else {
    // 失败或其它
  }
}
```

### 支付前钩子 `beforePay`

在通过可用性校验之后、调用 `transaction` 之前执行（例如登录校验、埋点）：

```ts
new MpWeixinVirtualPay({
  beforePay: async () => {
    await ensureLogin();
  },
  transaction: async () => {
    /* ... */
  },
});
```

### 支付成功后轮询订单 `pollOrder`

微信 `success` 后，按间隔调用 `query`；在回调里调用 `end()` 表示业务订单已终态、整体成功；调用 `next()` 表示继续下一轮；`throw` 则整体失败。
也支持直接返回 `"end"` / `"next"`。若回调既不调用 `end()/next()`，也不返回 `"end"/"next"`，将视为协议错误并抛错。

```ts
new MpWeixinVirtualPay({
  transaction: async () => {
    /* ... */
  },
  pollOrder: {
    intervalMs: 1500, // 默认 1500
    queryTimeoutMs: 10000, // 默认 10000，单轮 query 超时则失败
    maxAttempts: 60, // 默认 60，最后一轮仍 next 则报「订单状态查询超时」
    query: async ({ orderid, end, next }) => {
      const status = await yourApi.getOrderStatus(orderid);
      if (status === "paid") {
        end();
      } else {
        next();
      }
    },
  },
});
```

未配置 `pollOrder` 时，微信 `success` 后即 resolve，不再轮询。

## API 摘要

| 项                                          | 说明                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `new MpWeixinVirtualPay(options)`           | 构造实例；构造阶段不触发支付能力判断。                                               |
| `createVirtualPayment()`                    | 发起虚拟支付；成功返回微信 `success` 结果；失败 reject `VirtualPaymentError`。        |
| `isVirtualPayAvailable()`                   | 仅检测当前环境是否支持虚拟支付（不发起支付）。                                       |
| `isUserCancelError(err)`                    | 是否用户取消（兼容 `VirtualPaymentError.reason === 'canceled'` 与 `errCode === -2`）。 |

### `VirtualPaymentError`

- `reason`: `'not_supported' | 'failed' | 'canceled'`
- `message`: 可读说明
- `originalError`: 底层错误，可能为 `null`

## 调试

将 `debug` 设为 `true` 后，会通过 `console.warn` 输出带前缀 `[MiniProgram Virtual Pay]` 的日志（流程节点、轮询、`isVirtualPayAvailability` 判定依据等）。

## 本地开发与构建

本仓库使用 **Yarn**（`node_modules` 模式，见根目录 `.yarnrc.yml`）。

```bash
yarn install
yarn build
```

产物输出到 `dist/`。发布前 `prepublishOnly` 会自动执行 `yarn build`。

## 许可证

MIT
