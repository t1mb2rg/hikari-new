# s5 · 失败回滚验证

**运行**：`node experiments/poc-03-contract-layer/rollback.mjs`
**原始读数**：`rollback.json`

## 场景

一个插件在 `setup` 里依次做三件事，然后抛错：

1. `context.services.provide(SVC, …)` —— 注册一个 Service
2. `context.events.on(EVT, …)` —— 订阅一个 Event
3. `throw new BoomSetup()` —— 中途失败（错误对象带 `marker: 'rollback-marker-42'`）

然后检查四件事：失败原因能不能拿到、Service 有没有注销、Event 有没有退订、卸载后重装同 id 会不会撞旧注册。

## 读数

| 检查项 | Hikari 原 Runtime | Cordis + 契约层 |
|---|---|---|
| `loadPlugin` 是否向调用者抛错 | **不抛** | **不抛** |
| 状态 | `failed` | `failed`（另记 `layer='setup'`） |
| 失败原因 | 原 `BoomSetup`，`marker` 保留 | 原 `BoomSetup`，`marker` 保留 |
| Service 是否释放 | 是（探针插件 `waiting`） | 是（探针插件 `waiting`） |
| Event 订阅是否退订 | 是（失败后 `emit` 触发 **0** 次） | 是（**0** 次） |
| 卸载失败记录 | 成功 | 成功 |
| 卸载后重装同 id | `active` | `active` |

四项判据两侧全 `true`。

## 三个值得记的细节

**1. 「不抛给调用者」是跟随 Hikari 的选择，不是宿主默认。**
Cordis 原生 `ctx.plugin()` 在 setup 抛错时会让 `fiber.await()` 抛（s1 实测过）。契约层把那个 `await` 包在 `try/catch` 里、存进 `records`，对外保持 Hikari 的语义：`loadPlugin()` 正常返回，失败体现在状态与 `getPluginError()`。这是一个**有意的方向选择**——迁移时不改变调用方的错误处理方式。

**2. 重装必须先卸载，两侧一致，且这是各自的真实语义。**
失败的插件记录仍占着 id。Hikari 抛 `DuplicatePluginError`（`src/runtime/runtime.ts:36`），契约层同样。所以「重新装载不残留旧注册」的正确测法是**先 `unloadPlugin` 再装**，装载本身不负责清理上一条失败记录。这一点在 PoC-01 排查 `DuplicatePluginError` 时也撞到过。

**3. 契约层多给了一样东西：失败的层次。**
`getPluginLayer(id)` 返回 `'definition' | 'config' | 'setup'`。Hikari 只有状态 `failed` 与错误对象，没有「哪一层失败」的字段——它是靠错误类型区分的，而 R1/R3/R4/R5 这四条恰恰都抛通用 `Error`，所以从 Hikari 的错误对象上**分不出**是定义错、配置错还是 setup 错。这是本层相对原 Runtime 的一处增补，不是等价物。

## 一处未覆盖

`setup` 返回的 cleanup 函数在**失败路径**上没有被验证——因为 `setup` 抛错时没有返回值，cleanup 根本注册不上。Hikari 的 `#failActivation` 里那条 `AggregateError([error, cleanupError], 'Plugin … failed during setup and cleanup.')` 分支（`src/runtime/runtime.ts:145-157`）在本轮构造里走不到。要覆盖它需要让 `scope.dispose()` 本身抛错，那是另一种场景，不在任务书第六项范围内。

本层对 cleanup 的处理只在**成功→卸载**路径上有效，s3 的三层对照里没有涉及，PoC-02 的 P2 测过卸载方向的逆序释放。
