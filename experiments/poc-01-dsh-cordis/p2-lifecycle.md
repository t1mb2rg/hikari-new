# P2：卸载后 Service、依赖方与资源的行为

判定：**PASS**（一处口径需要说明，见 §5）。

## 1. 做了什么

两个宿主执行同一序列：装载四层 → **卸载最底层 provider**（`foreground.windows`）→ 观察 → 重新装载。

选择卸载底层而不是顶层，是因为底层消失会把整条依赖链拖进来，正好能看出宿主对「provider 走了，依赖方怎么办」的处理是否与 Hikari 一致。

原始读数：`experiments/poc-01-dsh-cordis/p2-result.json`；脚本：`p2-lifecycle.mjs`，共享适配层 `adapter.mjs`（每次 `provide` 与 `defer` 都记一条 trace）。

## 2. 对照表

| 观测点 | Hikari 原 Runtime | Cordis |
| --- | --- | --- |
| 装载后四层状态 | 全 `active` | 全 `ACTIVE`（2） |
| 卸载 `foreground.windows` 后：被卸载者 | 记录被删除（`getPluginState` 返回 `undefined`） | `DISPOSED`（4） |
| 同上：依赖方 `desktop-session-world` | `waiting` | `PENDING`（0） |
| 同上：依赖方 `desktop-session-awareness` | `waiting` | `PENDING`（0） |
| 同上：无关插件 `input-activity` | `active`（不受影响） | `ACTIVE`（2，不受影响） |
| 同上：从宿主**重新取** peek 服务 | 取不到（探针插件已 `waiting`） | `undefined`（`serviceGone: true`） |
| 同上：**旧引用**调用 `peek()` | 返回 `baseline` | 返回 `baseline` |
| 重装 `foreground.windows` 后 | 五层全部回 `active` | 五层全部回 `ACTIVE` |
| 重装后 `peek()` | `baseline` | `baseline` |
| 重装后是否同一个服务实例 | 否（`sameInstance: false`） | 否（`sameInstance: false`） |

## 3. 结论：依赖失效语义两边**行为一致**

Hikari 的 `#deactivateTree`（`src/runtime/runtime.ts:159-172`）做两件事：把 `requires` 命中被卸载契约的依赖方**递归卸载**，然后卸载自己；卸载后状态回 `waiting`（`:186`、`:200`），不是终止。

Cordis 的表现是：被卸载 fiber → `DISPOSED`；依赖它的 fiber → `PENDING`。**`waiting` 与 `PENDING` 是同一个概念**——「现在没在跑，等依赖重新满足就起来」。重装后两边都自动恢复，且都拿到新实例。

这一条可以直接写进报告：**Hikari 的级联失效语义在 Cordis 下可以等价表达**，不需要额外适配代码——`inject` 已经承担了「依赖不满足就等待」的那一半。

## 4. 资源释放

Cordis 侧每次 `provide` 与 `defer` 都写一条 trace。卸载后：

| 插件 | 注册的 provide | 注册的 defer | trace 中 `ran` 条数 |
| --- | --- | --- | --- |
| `foreground.windows` | 1 | 1 | 2 |
| `desktop-session-world` | 1 | 0 | 1 |
| `desktop-session-awareness` | 2 | 0 | 2 |
| `input-activity.windows`（未卸载，仍 ACTIVE） | 1 | 0 | 0 |

`ran` 条数 = provide disposer + defer cleanup，全部按逆序执行。也就是说 `src/foreground/plugin.ts:18` 那句 `context.defer(() => acquirer.dispose())` 在 Cordis 的 fiber 释放时**真的被调用了**，Hikari 的资源清理约定被完整保留。整体 dispose 后每条 trace 的 `ran` 都等于其注册总数。

## 5. 一个必须如实说明的口径

**「监听器清零」这一项没能观测。** 被装载的四个插件都不注册事件（`desktop-session-awareness`、`desktop-session-world` 只提供 service，不发不收事件），所以没有监听器可清。适配器里 `events.on/emit` 是故意未实现的（抛错），本次也没触发。

这不影响 P2 的其余结论，但它意味着：**Hikari 的事件面（`EventBus`）在 Cordis 下是否等价，本轮没有证据。** 报告里要把它列为未覆盖项。

## 6. 一处容易被误读的现象

卸载后**旧引用**仍能调用 `peek()` 并返回 `baseline`——两边都是这样。这不是 Cordis 的缺陷，也不是 Hikari 的缺陷，而是两边共同的设计：卸载只撤销**注册**，不追溯销毁已经交出去的对象。真正的约束是「下次要拿服务必须重新解析，而那时会拿不到」。

如果有人指望「卸载后旧引用会失效」来防泄漏，两个宿主都不提供这个保证。
