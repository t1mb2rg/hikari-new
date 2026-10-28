# 正常卸载时 cleanup 抛错：Hikari / 裸 Cordis / 契约层 三方对照

脚本 `unload-cleanup.mjs`，读数 `unload-cleanup.json`。运行条件：Node `v24.15.0`、
`@deepseek-ai/cordis` `4.0.5`、DSH `0.2.1-rc.2`、Hikari `main`（`src/` 只读导入，
取自 `dist/`，`npm run build` 后运行）。

不新建 PoC 目录：本文件与脚本都放在合并阶段目录 `experiments/route-c-consolidation/` 下。

## 0. 一句话

资源回收三侧等价；**清理异常的可观察性三侧都不成立**，而且原因是两个不同的原因——
Hikari 是「记录随卸载一起消失」，Cordis 是「`dispose()` 吞掉 cleanup 错误」。级联停用
路径上只有 Hikari 能读到合成的 `AggregateError`，所以问题不在宿主能力，在**契约本身
只在一条路径上保住了错误**。

## 1. 测什么

统一探针：一个提供服务的插件，`setup` 里注册一个 10 ms 间隔的 `setInterval`，并把
cleanup 写成「清定时器 + 计数 + `throw new BoomCleanup('cleanup-boom')`」。

两个停用路径各跑一遍：

- **场景 1（显式卸载）**：`unloadPlugin(id)` / `fiber.dispose()`，然后看资源回收、服务
  注销、状态、错误。
- **场景 2（级联停用）**：A 提供服务 → B 依赖 A。拆掉 A，看 B 的 cleanup 是否执行、
  B 最终状态、B 的错误是否可读。

三侧：

| 侧 | 实现 |
| --- | --- |
| Hikari | 真 `Runtime` + `PluginDefinition`，从 `dist/runtime/runtime.js` 导入 |
| 裸 Cordis | 直接 `app.plugin(async (ctx) => ...)` + `ctx.provide` + `ctx.effect(...)` |
| 契约层 | `experiments/poc-03-contract-layer/contract-layer.mjs` 的 `createContractLayer` |

**为什么不复用 PoC-02 的 `adapter-events.mjs`**：本轮第一版复用了它，得到「裸 Cordis
`providerCleanups: 0`、timer 还在跑」——查下来是那个适配层 `await def.setup(...)` 后
**丢掉了 setup 的返回值**，而 Hikari 的「`setup` 返回 cleanup」正是通过返回值注册的
（`src/runtime/runtime.ts:127-130`）。也就是说那一次读数量的是**适配层的遗漏**，不是
宿主能力。改成 Cordis 原生写法后读数才干净。这件事本身记在 §4。

## 2. 场景 1：显式卸载

| 观察项 | Hikari | 裸 Cordis | 契约层 |
| --- | --- | --- | --- |
| cleanup 执行次数 | 1 | 1 | 1 |
| 定时器是否仍在跑 | 否 | 否 | 否 |
| 服务是否仍可解析 | 否 | 否 | 否 |
| 卸载后状态 | 无记录（`null`） | `DISPOSED`(4) | `disposed` |
| 卸载错误是否可读 | **否**（`null`） | **否**（`_error` undefined） | **否**（`null`） |

三侧资源回收全部正确：cleanup 跑到、定时器停、服务注销。三侧**都读不到**清理异常。

原因各不相同，逐条对应源码：

- Hikari：`unloadPlugin` 成功后会 `this.#plugins.delete(pluginId)`；错误只写进
  `record.error`（`src/runtime/runtime.ts:194-205` 的 `#tearDown`），记录一删，错误随之
  消失。`getPluginState(id)` 与 `getPluginError(id)` 对不存在的 id 都返回 `null`。
- 裸 Cordis：`fiber.dispose()` 的错误被吞，`fiber._error` 保持 `undefined`
  （`_error` 还是私有字段，`node_modules/@deepseek-ai/cordis/lib/types/fiber.d.ts:120`）。
- 契约层：`unloadPlugin` 转发 `fiber.dispose()` 后把记录改成
  `{ state: 'disposed', error: null }`，没有把 cleanup 错误放进去。

## 3. 场景 2：provider 消失导致级联停用

| 观察项 | Hikari | 裸 Cordis | 契约层 |
| --- | --- | --- | --- |
| 依赖方 cleanup 执行次数 | 1 | 1 | 1 |
| 依赖方最终状态 | `failed` | `PENDING`(0) | `waiting` |
| 依赖方错误是否可读 | **是** | 否 | 否 |

Hikari 的错误是：

```json
{
  "name": "AggregateError",
  "message": "One or more plugin resources failed to clean up.",
  "marker": null
}
```

（`marker: null` 是因为我读的是 `error.message` 与 `error.name`，没有去翻
`error.errors` —— `AggregateError` 的元素里才是原始 `BoomCleanup`。）

这一格是本轮最有信息的差异：**同样是「provider 消失 → 依赖方被拆」，Hikari 把它标成
`failed` 并给出合成错误，契约层把它标成 `waiting`，什么都读不到。**

而且这不是 Cordis 做不到——Hikari 能读到，说明这条路本身是可表达的；是契约层在
`#reconcile` 等价物里没有做这件事（契约层目前只映射 `PENDING → 'waiting'`）。

## 4. 四项区分（任务书要求的「区分资源回收、异常可观察性、原有契约」）

**1）资源回收 —— 等价，成立。** 两个路径、三侧，cleanup 都跑到、定时器都停、服务都注销。
这一项没有发现任何缺口。

**2）异常可观察性 —— 不等价。** 显式卸载路径三侧都读不到；级联停用路径只有 Hikari 能
读到。所以「cleanup 抛错可观察」在 Hikari 里不是一条稳定契约，而是**取决于走哪条停用
路径**。

**3）原有契约 —— 状态语义不同，且契约层丢掉了一条。** Hikari 的语义是「清理失败 ⇒ 目标
插件进 `failed` 并携带合成错误」；契约层在同一条路径上给的是「依赖没了 ⇒ `waiting`」。
两者对「这个插件现在是什么」的回答不一样：`failed` 是「它坏了」，`waiting` 是「它在等」。
这是真实的语义降级，不是措辞差异。

**4）顺带发现的适配层缺陷（PoC-02 产物，已记录未修）。** `experiments/poc-02-runtime-contract/adapter-events.mjs`
的 `toCordisPlugin` 在 `await def.setup(hikariContext, config)` 之后**丢弃返回值**，
所以「`setup` 返回 cleanup」这条 Hikari 契约在那个适配层里根本没生效——cleanup 不会执行。
`experiments/poc-03-contract-layer/contract-layer.mjs` 没有这个问题（它把返回值交给了
`ctx.effect`），本轮也实测到底层 cleanup 确实执行了一次。这一条不影响 PoC-03/04 的结论，
但**PoC-02 的 P4 判定是建立在一个漏掉 cleanup 的适配层上的**，阅读旧结论时要知道这一点。

## 5. 判断改判与限定

本轮检验的判断是「卸载清理错误不可观察」。

- 在**显式卸载**这条路径上：**支持**，三侧都读不到。
- 在**级联停用**这条路径上：**不支持**，Hikari 能读到合成的 `AggregateError`。

所以准确的说法是：**「清理异常可观察」在 Hikari 里是一条路径相关的属性，不是全局属性；
契约层在两条路径上都丢了它。** 判断按字面（「正常卸载时」= 显式卸载）成立，但不能外推成
「Hikari 普遍不报告清理失败」。

## 6. 这一格对路线 C 的意义

要保住这条契约，契约层需要补两件事，都很小：

1. `unloadPlugin` 在转发 `dispose()` 前后捕获 cleanup 错误，写进 `record.error`，并且
   **不因记录被删而丢弃**（Hikari 自己在这一点上也不一致，若要等价必须比它做得更好，
   或明确接受「卸载后不再可查」）。
2. 级联停用路径上，依赖方被拆时若 cleanup 抛错，状态应为 `failed` 并携带合成
   `AggregateError`，而不是 `waiting`。

第 2 条是必须补的（属于语义等价）；第 1 条需要 Human 定：是**照抄 Hikari 的不一致**，
还是**比 Hikari 多保住一点**。这是设计判断，不是兼容性问题。

## 7. 影子状态：卸载后必须自愈（同一脚本的第三个读数）

契约层除了 `records`（按插件 id）还维护一份 `providedBy`（契约键 → 提供者 id）。这是
一份**派生状态**，一旦卸载时没清干净，下一次同名装载就会误报「服务已被占用」。

实测（`inspect()` 前后对照）：

| 时点 | `records` | `providedBy` |
| --- | --- | --- |
| 装载后 | 1 条，`state: active`，`provided: [route-c.shadow.svc@1]` | 1 条映射 |
| 卸载后 | **空** | **空** |
| 同名重装后 | 1 条，`active` | 1 条映射（新提供者，无残留） |

重装没有抛 `ServiceAlreadyProvidedError`（`reinstall: "ok"`），说明影子状态在卸载路径上
确实自愈了。这是判断「影子状态须自愈」成立的直接读数。

