# PoC-02 · 两侧运行时契约清单

> 目的：把「Hikari Runtime 承诺了什么」与「Cordis 承诺了什么」并排放好，标出哪些是**源码可读的事实**、哪些**只能实测**。下表不写结论，只摆事实；判定在 `event-cordis.md` / `key-collision.md` / `service-reject.md`。
>
> 对象：Hikari `f44cb2f`、Cordis `4.0.5`（`G:\work\LAB\code\_poc\poc01\node_modules\@deepseek-ai\cordis`）、DSH `0.2.1-rc.2`。

## 表 1 · 事件面语义

| # | 语义 | Hikari EventBus | Cordis EventsService | 来源 | 状态 |
|---|---|---|---|---|---|
| E1 | 发布是否等待订阅者 | `emit` 是 `async`，`await Promise.allSettled(...)` 后才返回 —— 调用方 `await` 即等到全部 settle | `emit()` 是同步的，`.map(cb => cb(...args))` **不等**返回的 Promise；`parallel()` 才 `await Promise.allSettled` | `src/runtime/event-bus.ts:38-43`；`cordis/lib/index.js:271-274`（parallel）、`:277-279`（emit） | 源码事实，实测复核 |
| E2 | 多订阅者并发 | `handlers.map(handler => handler(payload))` 一起发起，再 `allSettled` —— 并发 | `dispatch(...).map(async cb => cb(...args))` 一起发起 —— 并发 | `src/runtime/event-bus.ts:41-43`；`cordis/lib/index.js:272` | 源码事实 |
| E3 | 失败聚合 | 失败项收集后 `throw new AggregateError(errors, \`Event ${key} had failing subscribers.\`)` —— **有 message，含事件键** | `parallel` 收集 rejected 后 `throw new AggregateError(errors.map(r => r.reason))` —— **没有 message 参数**，`AggregateError.message` 为空字符串 | `src/runtime/event-bus.ts:45-51`；`cordis/lib/index.js:271-274` | 源码事实，实测复核 |
| E4 | 退订与 owner | `subscribe(contract, ownerId, handler)` 返回 cleanup；`plugin-context.ts:35-37` 把 cleanup 交给 `scope.defer`，插件卸载时执行 | `ctx.on(name, listener)` 返回 disposer，并作为 effect 记在 fiber 上，**fiber 卸载自动清理** | `src/runtime/event-bus.ts:14-36`、`src/runtime/plugin-context.ts:35-37`；`cordis/lib/types/events.d.ts:79-97,186-197` | 源码事实，实测复核 |
| E5 | 重新激活 | 重新 `loadPlugin` 得到**新的 PluginContext**，`setup` 重新执行，重新 `subscribe`；旧的 cleanup 已在卸载时执行 | 重新装载得到新 fiber，effect 重新注册；旧 fiber 的 effect 已在 dispose 时执行 | 由 E4 推导 | **待实测** |
| E6 | 事件键 | `eventKey = \`${id}@${version}\`` —— 名字里带版本 | 事件名是任意 `string \| symbol`，**无版本概念**；`dispatch` 用原始名查 `_hooks` | `src/runtime/contracts.ts:32-34`；`cordis/lib/types/events.d.ts:118-129` | 源码事实 |
| E7 | 分派模式 | 只有一种：全并发 + 等全部 + 聚合失败 | 五种：`emit`（同步不等）/ `parallel`（等全部 + 聚合失败）/ `serial`（顺序，遇 bail 停）/ `bail`（同步，遇 bail 停）/ `waterfall`（围绕 next 组合） | `src/runtime/event-bus.ts:38`；`cordis/lib/types/events.d.ts:25,35-79` | 源码事实 |

## 表 2 · 服务解析语义

| # | 场景 | Hikari Runtime | Cordis | 来源 | 状态 |
|---|---|---|---|---|---|
| S1 | 未在 `requires` 声明就去读 | `throw new UndeclaredServiceDependencyError(pluginId, serviceId)`，消息 `Plugin ${pluginId} tried to use undeclared service dependency ${serviceId}.` | **没有这层检查**。`ctx.get(name, strict)` 直接查 store：`_getImpl` 找不到就返回 `undefined`，`get` 返回 `getTraceable(ctx, undefined)`；`ctx[name]` 走 `internal/get` waterfall | `src/runtime/plugin-context.ts:22-26`、`src/runtime/errors.ts:21-25`；`cordis/lib/index.js:763-771` | 源码事实，实测复核 |
| S2 | 声明了但没人提供 | `throw new ServiceUnavailableError(key)`，消息 `Service is unavailable: ${key}` | `ctx.get(name)` → `undefined`（不抛）；`ctx.get(name, true)` 亦只按 fiber 状态过滤，未提供仍是 `undefined` | `src/runtime/service-registry.ts:20-27`、`src/runtime/errors.ts:16-19`；`cordis/lib/index.js:763-771` | 源码事实，实测复核 |
| S3 | 未在 `provides` 声明就去提供 | `throw new UndeclaredServiceProviderError(pluginId, serviceId)`，消息 `Plugin ${pluginId} tried to provide undeclared service ${serviceId}.` | 无声明面：`ctx.provide(name, value)` 即可，只要名字没被占用 | `src/runtime/plugin-context.ts:27-32`、`src/runtime/errors.ts:27-31`；`cordis/lib/types/reflect.d.ts:41-43` | 源码事实，实测复核 |
| S4 | 重复提供同名服务 | `throw new ServiceAlreadyProvidedError(key, existing.ownerId)`，消息 `Service ${key} is already provided by ${ownerId}.` | `throw new Error(\`service "${name}" has been registered at <${fiber.name}>\`)` | `src/runtime/service-registry.ts:33-38`、`src/runtime/errors.ts:11-14`；`cordis/lib/index.js`（reflect.provide 内） | 源码事实，实测复核 |
| S5 | 依赖方在提供方卸载后读取 | 提供方的 cleanup 从 registry 删除记录 → 后续 `get` 抛 `ServiceUnavailableError`；依赖方本身**不会**被自动卸载或回到 waiting（卸载由 Runtime 的依赖失效流程处理） | `_getImpl` 在 `strict` 且 `impl.fiber.state !== 2` 时返回 `undefined`；fiber 状态变化与 `ctx.inject` 的重新激活是两套机制 | 见 PoC-01 P2 实测 + `cordis/lib/index.js:765-769` | **待实测**（本轮 s5 取错误原文） |
| S6 | 依赖声明与激活 | `requires` 是**准入检查**（不声明直接拒绝），服务在 `setup` 里同步取 | `inject` 是**激活条件**（依赖变化会重新运行回调），不构成读取许可 | `src/runtime/plugin-context.ts:22`；`cordis/lib/types/registry.d.ts:104-111` | 源码事实 |

## 表 3 · 契约键与名字规则

| # | 项 | Hikari | Cordis / PoC-01 适配层 | 来源 |
|---|---|---|---|---|
| K1 | 契约标识 | `{id: string, version: number}`，`defineService`/`defineEvent` 校验 id 非空、version 为正整数 | 名字是**单个字符串**，无版本字段 | `src/runtime/contracts.ts:16-26,36-45` |
| K2 | 键格式 | `serviceKey` / `eventKey` = `` `${id}@${version}` `` | 事件名 `string \| symbol`；服务名任意字符串 | `src/runtime/contracts.ts:28-34`；`cordis/lib/types/events.d.ts:197` |
| K3 | 现有编码 | — | `id.replace(/[^A-Za-z0-9]/g, '_') + '_v' + version` | `experiments/poc-01-dsh-cordis/adapter.mjs:6-7` |
| K4 | 编码的天然风险 | — | `.`、`-`、`_`、空格、`@` **全部映射成同一个 `_`**；`_v<version>` 与 id 自身内容无分隔约定 | 由 K3 直接读出 |

### 真实契约全集（供 s4 套编码）

由 `collect-contracts.mjs` 扫 `src/` 得到：**24 个 service 契约，全部 version 1**；**1 个事件契约**。

```
changeable-repositories.read, chronicle, continuity.current, desktop-content-read.read,
desktop-session-awareness.current, desktop-session-awareness.peek, desktop-session-world.current,
foreground.current, git-repository.current, github-ci.current, github-ci.run-materials,
human-delivery.deliver, input-activity.current, language.desktop-return-speaking,
language.diagnosis-speaking, language.speaking, repository-change-executor.actions,
repository-ci-awareness.current, repository-ci-diagnosis-proposal.propose,
repository-ci-diagnosis-proposal.supplement, repository-ci-relevance.current,
repository-ci-relevance.judge, repository-ci-world.current, work-focus.current
```

事件：`desktop-session-awareness-loop.assessed@1`（全集只有这一个）。

> 口径说明：`docs/architecture/hikari-current.md:181` 记的是「17 个 Service」。本表按 `defineService<...>` 调用点实数得到 24 个，差额来自文档口径的分组方式（该文档把同一插件的多个契约算作一项）。两者不冲突，但**碰撞检查以本表为准**——编码只关心字面 id。
