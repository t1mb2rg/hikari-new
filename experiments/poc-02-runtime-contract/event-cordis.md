# Cordis 侧同样五项（s3）与逐项对照

**被测事件**：`desktop-session-awareness-loop.assessed@1`，同一个真实发布者（`desktop-session-awareness-loop` 插件，`plugin.ts:85` `await context.events.emit(...)`），config `{ delayMs: 100 }`。
**宿主**：Cordis `4.0.5`（`@deepseek-ai/cordis`），隔离目录 `G:/work/LAB/code/_poc/poc01`。
**适配层**：`experiments/poc-02-runtime-contract/adapter-events.mjs`——在 PoC-01 的服务桥接之上补两条映射：`events.emit → ctx.parallel`、`events.on → ctx.on`。
**订阅者**：隔离测试订阅者，**不是生产消费者**（生产里 `assessed` 只由 `desktop-content-read` 订阅，本实验未装载它）。
**运行**：`node experiments/poc-02-runtime-contract/event-cordis.mjs` → `event-cordis.json`

## 与 Hikari 的逐项对照

| # | 语义 | Hikari 实测（s2） | Cordis 实测（s3） | 判定 |
|---|---|---|---|---|
| C1 | 发布等待订阅者 | 间隔 **831 / 790 ms**（订阅者睡 300，`delayMs=100`） | 间隔 **823 / 793 ms** | **等价**（前提：`events.emit` 映射到 `ctx.parallel`；用 `ctx.emit` 则**不等待**，C1 直接不成立） |
| C2 | 多异步订阅者并发 | `startDeltaMs=0`，跨度 **314 ms** | `startDeltaMs=0`，跨度 **311 ms** | **等价** |
| C3 | 失败聚合 | `AggregateError`，`message = "Event <key> had failing subscribers."`，errors 两条 | 原生 `ctx.parallel` 抛 `AggregateError` 但 **`message = ""`**；适配层补 message 后与 Hikari **逐字一致** | **需适配** |
| C4 | 卸载退订 | 卸载后 450 ms 内 0 次 | `probeFiber.dispose()` 后 450 ms 内 **0** 次 | **等价** |
| C5 | 重新装载 | 重装后 450 ms 内 1 次 | 重新 `root.plugin(...)` 后 450 ms 内 **1** 次 | **等价** |

原始读数摘录：

```json
"waitsForSubscribers": { "gapsMs": [823, 793], "verdict": "waits", "mapping": "events.emit → ctx.parallel" },
"parallelSubscribers": { "startDeltaMs": 0, "spanMs": 311, "verdict": "concurrent" },
"failureAggregation": {
  "rawParallel":  { "thrownType": "AggregateError", "message": "", "reasons": ["boom-a", "boom-b"] },
  "adaptedEmit":  { "thrownType": "AggregateError",
                    "message": "Event desktop-session-awareness-loop.assessed@1 had failing subscribers.",
                    "reasons": ["boom-a", "boom-b"] }
},
"unsubscribeAndReactivate": { "hitsWhileLoaded": 1, "hitsInFirst450msAfterUnload": 0, "hitsAfterReload": 1 }
```

## 第三条读数：插件内 emit 失败时，错误去哪了（两侧不同）

| | Hikari | Cordis |
|---|---|---|
| 插件 setup 内 `await emit` 抛错 | `loadPlugin` 把错误**抛给调用方**（`Runtime.#activate` → `#failActivation`） | fiber 置 **`FAILED`（state=3）**，`fiber.error` 为 `null`，**不抛给 `root.plugin()` 的调用方** |

实测：`pluginSetupFailure = { fiberState: 3, fiberError: null, threwToCaller: false }`。`FiberState` 枚举见 `cordis/lib/types/fiber.d.ts:67-72`（`PENDING=0, ACTIVE=2, FAILED=3, DISPOSED=4`）。

这是**本次唯一一处行为差异**：Cordis 把失败放在 fiber 状态里，Hikari 把失败抛给装载者。两侧都能观察到失败，但**观察方式不同**——上层若依赖 `await loadPlugin()` 的异常做回滚，搬到 Cordis 下必须改成轮询 fiber 状态或监听 `internal/status`。

## 三条必须一起读的限定

1. **C1 的等价值依赖适配层的选择。** Cordis 有五种分派模式（`emit` / `parallel` / `serial` / `bail` / `waterfall`，`cordis/lib/types/events.d.ts:25`）；只有 `parallel` 是「全部 await 且都跑」。适配层选错一个，C1 与 C3 同时改变。
2. **真实插件把错误吞掉了。** `plugin.ts:86-95` 的 `try/catch {}` 意味着产品运行中订阅者抛错**不会**传到任何地方——所以 C3 的聚合语义在**产品路径上不可观察**，本实验是直接对宿主分发器测的。这一点在 Hikari 与 Cordis 两边都成立，但 Cordis 多一个 `FAILED` 状态可供观察。
3. **事件键没有版本概念。** Cordis 的事件名是任意 string，本实验用 `desktop-session-awareness-loop.assessed@1` 全文当名字（`adapter-events.mjs` 的 `eventName`）。`@1` 在这里只是字符串的一部分，宿主**不解释**它——版本语义由适配层约定，不由宿主保证。
