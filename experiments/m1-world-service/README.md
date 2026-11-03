# M1 探针：World 只读 Service 与真 tools 链路

这组脚本是 M1-a / M1-b 的取证，不是产品代码。全部不调模型。

| 脚本 | 验什么 | 关键读数 |
|---|---|---|
| `probe.mjs` | Cordis 的 service 命名与 `inject` 时序 | 点分名可取但反直觉，弃用；单段名 + 消费者先注册时 `inject` 会等；同名 service 由 Cordis 抛错兜底 |
| `probe-world.mjs` | `hikariWorldFindings` 的契约 | 7/7：单段名、排在三个工具注册之后、`search`/`read` 与 `searchFindings`/`readFinding` 逐字段相等、`Object.freeze` 生效、改返回值不影响 World、`describe()` 的 `available` 正确、fail-closed 下 Service 仍存在 |
| `probe-lifecycle.mjs` | `ctx.effect` 与 `ctx.provide` 是否随 fiber 回滚 | `fiber.dispose()` 触发 `effect-disposed`、service 变 undefined、重装后两者重建 |
| `probe-real-tools.mjs` | **真** `@deepseek-ai/dsh-tools` 的 `ToolRuntime` 上的可见集与回滚 | 装载后三工具齐；`memoryFiber.dispose()` 后只剩 `record_finding`；`sameDefinition: true`（Memory 提供与 World 直接提供的定义逐字相同） |

`probe-real-tools.mjs` 只把与本次验证无关的 `systemPrompt` / `sessions` / `sessionProjections` 换成最小桩，`tools` 用的是真实现。这一条是为了回答「不能只靠 mock」：真 `ToolRuntime` 的 `register()` 走 `ScopedLayers.effect`，disposer 绑在**调用者插件**的 fiber 上（Cordis 的 `Service` 基类会把 `this.ctx` 重绑定到消费者），所以工具注册自动跟随插件生命周期。

## 相关文档

- `docs/development/m1-memory-retrieval-plan.md`：细纲、验证清单、探针读数
- `docs/architecture/hikari-base-plugin-architecture-v0.1.md`：四域职责与 Memory/World 边界
