# s1 · Cordis 4.0.5 的错误报告机制：四条通道实测

**运行**：`node experiments/poc-03-contract-layer/error-channel.mjs`
**原始读数**：`error-channel.json`
**环境**：Cordis `4.0.5`（`node_modules/@deepseek-ai/cordis/package.json`）、DSH `0.2.1-rc.2`、Node `v24.15.0`
**夹具**：一个 `apply()` 里直接 `throw new BoomA()` 的插件，错误对象带自定义 `marker = { code: 'E_POC03_SETUP', at: 'poc-03' }`——用来判断通道带回的是**原对象**还是被重新包装过的东西。

任务书要求「先观察，后决定是否补自己的错误记录」。这一节只观察。

## 四条通道各拿到什么

| 通道 | 事件/调用形态 | 能否拿到错误对象 | 能否重复读取 | 是否公开接口 |
|---|---|---|---|---|
| `internal/status` 事件 | `(fiber, oldValue)` | **不能**：参数里没有 Error | 每次状态变化都发，但错误不在参数里 | 公开事件，`lib/types/events.d.ts:220` |
| `fiber._error`（事件触发时点） | 字段读 | **能**：已是 `BoomA` 实例，`marker` 保留 | 能 | **私有字段**，`lib/types/fiber.d.ts:120` |
| `await fiber.await()` | 返回 Promise | **能**：抛出的就是原 `BoomA`，`ctor`/`marker` 全保留 | **能**：第二次调用仍抛同一对象 | **公开方法**，`lib/types/fiber.d.ts:175-178` |
| `ctx.logger.error` | 日志流 | **能**：拿到原对象 | 只有一次 | 公开但语义是日志，不是错误通道 |

## 关键读数

**`internal/status` 事件本身不带错误**。四次状态变化（`0→1`、`1→5`、`5→3`、`3→5`、`5→4`）里，每次 `argCount=2`、`carriesError=false`，`fiber.error` 字段在实例上 `absent`（`'error' in fiber === false`）。

**但事件触发的那一刻，`fiber._error` 已经填好了**。`1→5` 那条事件里读到 `_error = { ctor: 'BoomA', name: 'BoomA', message: 'setup exploded on purpose', hasMarker: true }`。也就是说监听者能读，但读的是私有字段——`lib/types/fiber.d.ts:120` 明写 `private _error;`，官方不承诺稳定。

**`await fiber.await()` 是唯一「公开 + 带原对象 + 可重复」的通道**。它抛出的对象 `ctor` 是 `BoomA`、`message` 逐字、自定义 `marker` 完整保留，第二次调用同样抛出。实现见 `lib/index.js:1396-1402`：

```js
async await() {
  while (this.inertia) await this.inertia;
  if (this._error) throw this._error;
  return this;
}
```

**`logger.error` 也拿到原对象**，但它是日志流（`lib/index.js:1358` `this.ctx.logger.error(reason)`），不适合当程序可读接口——程序要读它就得劫持 logger。

## 状态码

`_getState()`（`lib/index.js:1287-1292`）：`uid === null` → `4`（DISPOSED）；`_error` → `3`（FAILED）；epoch 已激活 → `2`（ACTIVE）；否则 `0`（PENDING）。`1`（LOADING）与 `5`（UNLOADING）是过渡态，只在 `internal/status` 里出现。

这条对适配层有直接影响：**光看 `state === 3` 分不出是哪一层失败**——定义错误、配置错误、`apply()` 抛错，最后都是 `_error` + `state 3`。

## 结论：适配层要不要自存错误

**要一层映射，但不要自己包装错误对象。**

理由：
1. Hikari 的对外 API 是同步的 `getPluginError(pluginId)`（`src/runtime/runtime.ts:74-76`），而 `fiber.await()` 是异步一次性——加载时必须捕获并存起来，否则调用方拿不到。
2. 但**错误的来源应该是 `await fiber.await()` 抛出的原对象**，不是适配层重新构造的 `Error`。这样类型、`instanceof`、自定义字段、堆栈全部保留。
3. 不依赖 `fiber._error`：它是私有字段，跨版本不保证。

所以适配层的错误记录是「**转存**」而不是「**重建**」：

```
let failure;
try { await fiber.await(); } catch (error) { failure = error; }
errorStore.set(pluginId, failure);
```

`getPluginError(id)` 直接返回存下来那个对象本身。

## 对后续步骤的约束

- s3（三层区分）必须自己判断失败发生在哪一层，不能靠 Cordis 的 `state`：适配层在 `ctx.plugin()` **之前**跑定义验证与 `config.parse`，只有 `apply()` 抛出的错误才进 `await()` 那条路。
- s5（回滚）验证 cleanup 时要小心：`_failActivation` 的等价物在 Cordis 侧是 `_unload()`，错误发生在 `apply()` 中途时，`ctx.effect` 注册的 disposer 由 fiber 自己清理——这一点要单独测，不能假定。
