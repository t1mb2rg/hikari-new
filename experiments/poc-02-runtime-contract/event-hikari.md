# Hikari Runtime 的事件面基线（s2）

**被测事件**：`desktop-session-awareness-loop.assessed@1`（`src/desktop-session-awareness-loop/contracts.ts:12`）
**发布者**：真实的 `desktop-session-awareness-loop` 插件（`plugin.ts:85` `await context.events.emit(...)`），config `{ delayMs: 100 }`
**订阅者**：**隔离测试订阅者**，不是生产消费者。生产里 `assessed` 的唯一订阅者是 `desktop-content-read`（`src/cli/resident.ts:431` 明确记录），本实验没有装载它。
**运行**：`node experiments/poc-02-runtime-contract/event-hikari.mjs`（从 `dist/` 导入，与产品同一份代码）
**读数**：`event-hikari.json`

## 五项语义的实测

| # | 语义 | 实测读数 | 判定 |
|---|---|---|---|
| E1 | 发布是否等待订阅者 | 订阅者 `await sleep(300)` 时，相邻两次事件到达间隔 **831 ms / 790 ms**（`delayMs=100`）。若发布方不等，间隔应 ≈ `delayMs + cycle 耗时`。差值 300+ 说明**发布方真的等到了订阅者返回** | **等待** |
| E2 | 多异步订阅者并发 | 两个订阅者各自 `sleep(300)`：`startDeltaMs = 0`，总跨度 **314 ms**（串行应为 ~600） | **并发** |
| E3 | 失败聚合 | 两个订阅者各抛 `Error('boom-a'/'boom-b')`：抛出 **`AggregateError`**，`message = "Event desktop-session-awareness-loop.assessed@1 had failing subscribers."`，`errors` 里两条原因都在 | **聚合，且消息含事件键** |
| E4 | 卸载退订 | 探针插件装载期收到 1 次；`unloadPlugin` 之后 450 ms 内收到 **0** 次 | **退订生效** |
| E5 | 重新装载 | 卸载后再 `loadPlugin` 同名探针，450 ms 内收到 **1** 次 | **重新订阅生效** |

原始读数摘录：

```json
"waitsForSubscribers": { "subscriberSleepMs": 300, "gapsMs": [831, 790], "verdict": "waits" },
"parallelSubscribers": { "startDeltaMs": 0, "spanMs": 314, "verdict": "concurrent" },
"failureAggregation": {
  "thrownType": "AggregateError",
  "message": "Event desktop-session-awareness-loop.assessed@1 had failing subscribers.",
  "reasons": ["boom-a", "boom-b"], "verdict": "aggregated"
},
"unsubscribeAndReactivate": { "hitsWhileLoaded": 1, "hitsInFirst450msAfterUnload": 0, "hitsAfterReload": 1 }
```

## 三条必须一起读的限定

1. **E3 测的是 EventBus 本身，不是插件路径。** 真实插件把 `await emit` 包在 `try/catch {}` 里（`src/desktop-session-awareness-loop/plugin.ts:86-95`），注释自己写明「The Runtime does not turn a rejection from an active plugin's background work into a failed state」。所以**产品运行中订阅者抛错是静默的**：这一轮的 cycle 被吞掉，下一轮照常排。若 Cordis 适配层把 `parallel` 的异常直接向上抛，反而会**改变产品行为**——这是 s3 要盯的点。
2. **E1 的间隔不是纯等待时间。** 831 ms 里还含 `awareness.current()` 读窗口的真实耗时（本机约 400 ms）与 `delayMs`。判据只看「是否 ≥ 订阅者睡眠时间」，不看绝对值。
3. **E5 的「重新订阅」是新实例。** 重新 `loadPlugin` 得到新的 `PluginContext` 与新的探针对象，旧的 cleanup 已在卸载时执行（PoC-01 的 P2 也观察到 `sameInstance: false`）。

## 与 s3 对照时要盯的三处

- `emit` → Cordis 侧必须换成 `parallel` 才有 E1；若用 `emit` 则 E1 直接不成立。
- E3 的 `AggregateError` 在 Cordis 侧**没有 message**（`cordis/lib/index.js:273` 只传了 errors 数组）。适配层要补 message 才等价。
- E4/E5 在 Cordis 侧靠 fiber 的 effect 生命周期，需要实测确认「卸载后不再收到」与「重装后重新收到」。
