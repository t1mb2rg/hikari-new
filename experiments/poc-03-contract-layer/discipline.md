# s4 · 五条 requires/provides 纪律逐条对照

**运行**：`node experiments/poc-03-contract-layer/discipline.mjs`
**原始读数**：`discipline.json`
**被测适配层**：`experiments/poc-03-contract-layer/contract-layer.mjs`

## 结果

| 纪律 | Hikari 原语义 | Hikari 实测 | 契约层实测 | 判定 |
|---|---|---|---|---|
| **R1** 未声明 get 拒绝 | `src/runtime/plugin-context.ts:22-32` | `state=failed`，`Error: Plugin poc03.r1-consumer tried to use undeclared service dependency poc03.alpha@1.` | `state=failed`，`UndeclaredDependencyError`，**同一句消息** | PASS |
| **R2** 依赖缺失保持 waiting | `src/runtime/runtime.ts:98-110` | `state=waiting`，无错误，`setup` 未执行 | `state=waiting`，无错误，`setup` 未执行 | PASS |
| **R3** 未声明 provide 拒绝 | `src/runtime/plugin-context.ts:22-32` | `state=failed`，`Error: Plugin poc03.r3-provider tried to provide undeclared service poc03.alpha@1.` | `state=failed`，`UndeclaredProvisionError`，同一句消息 | PASS |
| **R4** 声明 provides 未提供则失败 | `src/runtime/runtime.ts:134-138` | `state=failed`，`Error: Plugin poc03.r4-liar declared service poc03.alpha@1 but did not provide it during setup.` | `state=failed`，`MissingDeclaredServiceError`，同一句消息 | PASS |
| **R5** 重复 provide 拒绝 | `src/runtime/service-registry.ts` | 先者 `active`、后者 `failed`，`Error: Service poc03.alpha@1 is already provided by poc03.r5-first.` | 先者 `active`、后者 `failed`，`ServiceAlreadyProvidedError`，同一句消息 | PASS |

五条全过：状态一致、消息逐字一致、被拦住的都是同一个插件。

## 消息为什么逐字一致

因为契约层的错误消息是照 Hikari 的原文抄的——`src/runtime/errors.ts` 里那五句模板，我一条没改。这不是巧合，是刻意的：**消息是调用方能看到的契约**，改写会让迁移后的日志与旧日志对不上。

## 一处如实的差异：错误类不同

Hikari 抛的是**通用 `Error`**（`errors.ts` 里的错误类只在部分路径用，R1/R3/R4/R5 这四条走的是 `new Error(...)`）。契约层抛的是**专用类**（`UndeclaredDependencyError` / `UndeclaredProvisionError` / `MissingDeclaredServiceError` / `ServiceAlreadyProvidedError`）。

这算是比 Hikari 更细，但它带来一个迁移风险：**任何 `error.constructor === Error` 的判断在迁移后会失效**。本轮的立场是「消息与状态是契约，类名不是」，把这个差异记在这里而不是抹平。

## R2 靠的是宿主原生行为，不是契约层

依赖缺失保持 PENDING 这一点，契约层只做了一件事：把 `requires` 映射成 Cordis 的 `inject`（`contract-layer.mjs` 的 `plugin.inject = ...`）。之后是 Cordis 自己让 fiber 停在 `state=0`，`await fiber.await()` 不抛、`apply()` 不执行。

这与 Hikari 的 `#requirementsSatisfied` + `#reconcile` 是**两套不同机制得出同一个结果**。相同结果是实测的，机制等价不是——Hikari 有 `#reconcile` 的级联重算（依赖失效时把已激活的下游拆掉），Cordis 是 fiber 自己的 epoch 刷新。这一点 s5 会再碰一次。

## 与 PoC-02 的对照

PoC-02 的 P4 判定是「当前适配层下 5 条丢 3 条（R1/R3/R4 放行）」。本轮补了三个检查点，全部落在契约层而非宿主：

1. `services.get` 里查 `declared`（R1）
2. `services.provide` 里查 `declaredProvides`（R3）
3. `setup` 返回后查 `providedBy` 是否登记了本插件（R4）

R5 由契约层自己的 `providedBy` map 先拦一次，Cordis 原生也会拦（错误消息不同），两层都在。

所以任务书那句「适配层不会放行原 Runtime 禁止的 Service 操作」在本轮的实现里成立——但**成立的原因是我补了三个检查，不是宿主变强了**。这三处检查代码量合计约 20 行，位于 `contract-layer.mjs`。
