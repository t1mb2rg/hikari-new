# 未声明的 Service get / provide 是否保持原拒绝语义（s5）

**运行**：`node experiments/poc-02-runtime-contract/service-reject.mjs` → `service-reject.json`
**两侧**：Hikari 原 `Runtime`（`dist/runtime/runtime.js`）；Cordis `4.0.5` 配两版适配层——
- `loose`：PoC-01 的 `adapter.mjs` 原样，只转发 `services.get/provide`，不做声明检查；
- `strict`：在 `loose` 之上补回 Hikari 的四条声明检查（本轮产物，用来证明「可以做到」）。

## 五个场景的实测

| # | 场景 | Hikari | Cordis · loose（当前适配层） | Cordis · strict（补检查后） |
|---|---|---|---|---|
| R1 | 未在 `requires` 声明就 `get` | **failed** · `UndeclaredServiceDependencyError`：`Plugin p-reader tried to use undeclared service dependency poc02.reject.foo@1.` | **active（放行）** | failed · 错误对象丢失 |
| R2 | 声明了 `requires` 但没人提供 | **waiting**（不是失败） | **PENDING**（不是失败） | PENDING |
| R3 | 未在 `provides` 声明就 `provide` | **failed** · `UndeclaredServiceProviderError`：`Plugin p-sneaky tried to provide undeclared service poc02.reject.foo@1.` | **active（放行）** | failed · 错误对象丢失 |
| R4 | 声明了 `provides` 但 setup 里没提供 | **failed** · `MissingDeclaredServiceError`：`Plugin p-silent declared service poc02.reject.foo@1 but did not provide it during setup.` | **active（放行）** | failed · 错误对象丢失 |
| R5 | 两个插件提供同一个 service | **failed**（第二个）· `ServiceAlreadyProvidedError`：`Service poc02.reject.foo@1 is already provided by p-one.` | **failed**（Cordis 原生就拒绝） | failed · 错误对象丢失 |

## 三条结论

1. **当前适配层丢了 5 条拒绝语义里的 3 条。** R1 / R3 / R4 在 `loose` 下全部放行，插件保持 `ACTIVE`。也就是说：把 Hikari 的插件搬到 Cordis 上，**今天不会有任何东西阻止一个插件读取或提供它没声明的服务**。这不是理论风险——PoC-01 的适配层就是这样，只是 PoC-01 的插件恰好都声明正确，所以没暴露。
2. **补回检查可以做到状态一致，但错误信息拿不回来。** `strict` 版把 R1/R3/R4 都变成 `failed`（fiber `state=3`），与 Hikari 的 `failed` 同构；但四处 `fiber.error` 全是 `null`，**三种不同的声明错误在外观上完全相同**。Cordis 把失败原因放在 `internal/status` 事件里，不在 fiber 上——上层要区分错误类型，必须自己订阅那条事件或在自己的插件里保存错误。
3. **R2 两侧本来就一致，而且是「等待」不是「拒绝」。** Hikari 的 `loadPlugin` 对「依赖未满足」返回 `'waiting'`，Cordis 的 `inject` 让 fiber 停在 `PENDING`。两者都把「等依赖」当成正常状态，装齐依赖后自动转入激活（PoC-01 的 P2 已实测过这一段的恢复行为）。

## 一条必须修正的前置判断

PoC-02 立项时我把差异描述为「Hikari 把失败抛给装载者，Cordis 不抛」。实测**这个描述是错的**：Hikari 的 `loadPlugin` 也**不抛**（只有 `DuplicatePluginError` 抛），它同样用「状态 + 错误对象」上报，失败时 `state='failed'`、`getPluginError(id)` 可取。

真正的差异只有一处：

| | Hikari | Cordis |
|---|---|---|
| 失败的状态标记 | `state='failed'` | `fiber.state=3`（`FAILED`） |
| 失败的错误对象 | **`getPluginError(id)` 能拿到类型与逐字消息** | **`fiber.error === null`**，原因在 `internal/status` 事件里 |

这条已作为未解释项 `u-nmmq8v` 的更正依据：它不是「抛不抛」的差异，是「错误对象可不可取」的差异。

## 对 C 路线的意义

「统一 Cordis 宿主」在服务契约上需要**自己实现一层**：声明检查（`requires`/`provides` 集合）与错误对象保存，宿主两条都不提供。这层不是可选的装饰——不加它，Hikari 现有的「未声明即失败」纪律在迁移后就没了。
