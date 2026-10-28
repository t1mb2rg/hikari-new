# 路线 C 迁移前置条件与兼容性结论

> 依据 PoC-01 ～ PoC-04 四轮实测（`experiments/poc-01-dsh-cordis/`、`poc-02-runtime-contract/`、
> `poc-03-contract-layer/`、`poc-04-cascade-lifecycle/`）以及合并阶段新增的卸载对照
> （`experiments/route-c-consolidation/`）。
>
> 本文只汇总已经落盘的读数，不引入新实验；没有读数的判断一律标成「未覆盖」，不留含糊。

## §0 结论

**路线 C（以 Cordis/DSH 为 Hikari 的目标运行底座）在「Runtime 契约」这一层是可工程的，
但它的等价性不是零成本换来的：约 350 行适配层，其中有 9 项能力是宿主原本没有的。**

三句话：

1. **领域代码零改动**这一点已经被四次独立实验反复确认——Hikari 的领域插件原样装载进
   Cordis，`src/` 与 `test/` 四轮全部零改动（`git diff --stat -- src test` 为空）。
2. **等价的部分是真的等价**：依赖级联、重装、事件五项、失败回滚、契约键单射，全部有
   对照读数，且不靠提示词或约定。
3. **不等价的部分集中在「宿主没有的语义」**：定义验证、配置解析、Service 声明检查、
   错误可观察性——这四项在 Cordis 上不是「适配」而是「新增」。适配层补上了它们，因此
   迁移的前置条件不是「接线」，而是**把这四项新增能力当成 Runtime 的一部分来维护**。

## §1 证据基线与版本锁

| 项 | 值 |
| --- | --- |
| Hikari | `main` @ `d718287`；领域与 Runtime 代码四轮零改动 |
| DSH | `0.2.1-rc.2`（隔离安装于 `G:/work/LAB/code/_poc/poc01`，`DSH_HOME` 指向其下 `dsh-home`） |
| Cordis | `@deepseek-ai/cordis` `4.0.5` |
| Node | `v24.15.0` |
| 真实契约面 | **24 个 service（全部 version 1）+ 1 个 event**（`desktop-session-awareness-loop.assessed@1`） |
| 适配层 | `experiments/poc-03-contract-layer/contract-layer.mjs`，单文件，约 350 行 |

**版本锁是硬要求，不是卫生习惯。** 本文与四份报告里的所有读数都绑定 Cordis `4.0.5` 的
具体实现：`_getState()` 的状态映射（`lib/index.js:1287-1292`）、`await()` 的 rethrow
（`lib/index.js:1396-1402`）、`inject` 的停用语义、`emit` 不等 / `parallel` 才等的分派
差异。宿主升版必须重跑 p03 的 `error-channel`、`three-layers`、`discipline`、`rollback`
与 p04 的 `cascade`、`race`、`partial-fail`、`event-final` 八个脚本。

## §2 已验证契约（可以直接表达）

### 2.1 Service 获取与声明

| 契约 | 验证 | 依据 |
| --- | --- | --- |
| 依赖未满足时插件不启动，且不是失败 | Cordis `inject` 原生暂停（`PENDING`），适配层映射为 `waiting` | p03 `discipline.md` R2 |
| 未声明的 `get` 被拒绝 | 适配层补检查，消息逐字一致 | p03 R1 |
| 未声明的 `provide` 被拒绝 | 同上 | p03 R3 |
| 声明了 `provides` 却没在 `setup` 里提供 → 装载失败 | 同上 | p03 R4 |
| 重复 `provide` → 后者失败 | 适配层 + 宿主双保险 | p03 R5 |
| 契约键 `id@version` 单射且可逆 | 25 个真实契约 + 13 条构造用例 + 42 组分隔符 + 38 键合并，0 碰撞 | p03 `key-codec.md` |

五条纪律的消息**逐字一致**（模板直接取自 `src/runtime/errors.ts`），但成立的原因不同：
R2 与 R5 是宿主原生拦的，R1/R3/R4 是适配层补的约 20 行检查。

### 2.2 生命周期

| 契约 | 验证 | 依据 |
| --- | --- | --- |
| A → B → C 多级依赖 + 无关插件 D | D 的 tick 序列 `12→16→20→24` 全程不受影响 | p04 `cascade.json` |
| 拆掉 A，B/C 停用、资源释放、订阅失效、计时器停 | B/C 的 `cleanupCount` 0→1、计时器归 0、再 emit 不增 | p04 |
| 重新提供 A，B/C 复活并拿到**新实例** | `setupCount` 1→2，一次 emit 恰好 +1（残留订阅会 +2） | p04 |
| **依赖方不会拿到旧实例** | 重装后 B 解出的 service 是新 `setup` 造的那个 | p04 §3 |
| setup 不可取消 | 装载中卸载只标 `unloading`，不打断 `setup` | p02 §2、p04 |
| 对 `PENDING` 插件 `await()` 不阻塞 | 0–1 ms 返回；`inertia` 只表示「有生命周期工作在跑」，与依赖是否满足无关 | p04 `race.json` |
| 部分初始化后抛错 → 资源全释放 | 服务注销、订阅失效、cleanup 执行、错误可读 | p04 §6 F1、p03 `rollback.md` |
| setup 与 cleanup 都抛错 → 合成 `AggregateError` | 与 Hikari **逐字同形**（只有插件 id 不同） | p04 §6 F2 |

### 2.3 事件面

被测事件是真实的 `desktop-session-awareness-loop.assessed@1`，映射为
`events.on → ctx.on`、`events.emit → await ctx.parallel`、`eventName = id + '@' + version`。

| 语义 | 读数 | 依据 |
| --- | --- | --- |
| 发布者等待订阅者 | 订阅者各 300 ms、间隔 100 ms → 实际间隔 **421 ms** | p04 `event-final.json` E1 |
| 多个订阅者并发收到 | 启动时差 **0 ms** | E2 |
| 失败聚合 | `AggregateError`，`message` 与 `errors` 双保真 | E3 |
| 卸载后不再收到 | 调用数 1 → 1 | E4 |
| 重装后恰好再收一次 | 1 → 2 | E5 |

**这里有一条必须记住的测法教训**：E1 第一次被判 FAIL，原因不是适配层——是测试自己用
`setInterval(async () => await emit())`，而 `setInterval` 不等 async 回调，量到的是定时器
节奏。**量「是否等待」只能由「上游完成后再排下一次」的节奏来测。**

### 2.4 错误可观察性

三条通道的实测（p03 `error-channel.md`）：

| 通道 | 能拿到什么 |
| --- | --- |
| `internal/status` 事件 | **只有 fiber 与旧状态**；五次状态迁移全部 `argCount=2`、`carriesError=false` |
| `fiber.await()` | **rethrow 原错误对象**，`marker` 保留，可重复调用；但是 async |
| 适配层转存 | `getPluginError(id)` 同步返回原对象，失败后与卸载前都可读 |

结论：可观察性靠**转存**，不是靠重建。适配层 `try { await fiber.await() } catch (e) { record.error = e }`
即可，成本极低，但这一步不能省。

### 2.5 状态语义

| Hikari | Cordis | 适配层映射 |
| --- | --- | --- |
| `waiting` / `active` / `failed` | `PENDING(0)` / `ACTIVE(2)` / `FAILED(3)` / `DISPOSED(4)` | 同上表（`LOADING(1)`/`UNLOADING(5)` 是过渡态） |

四种观测情形上一一对应；但这不是**全映射承诺**（见 §4.3）。

## §3 需要适配层补的能力（九项）

这九项在 Cordis 上**不存在**，不是「换个写法」。它们合计构成迁移的真正成本。

| # | 能力 | 为什么宿主没有 | 适配层现状 |
| --- | --- | --- | --- |
| 1 | **定义验证**（id 非空、version 非空、requires/provides 重复、既 require 又 provide） | 裸 Cordis 不校验 `PluginDefinition`，非法定义会被静默接受 | 已实现，同步抛，`layer='definition'` |
| 2 | **配置解析**（`definition.config.parse`） | 宿主走自己的 `Config['~standard'].validate`，**根本不调 domain 的 parse** | 已实现，同步抛，`layer='config'` |
| 3 | **Service 声明检查**（R1/R3/R4） | 宿主无 requires/provides 概念 | 已实现，约 20 行 |
| 4 | **契约键编码** | 宿主服务名是任意字符串，无版本概念 | 已实现，`id@version`，单射可逆 |
| 5 | **错误转存与同步查询** | 只有 async 的 `await()`；`internal/status` 不带错误 | 已实现 |
| 6 | **状态实时读取** | —— | 已实现；**踩过坑**：早期缓存装载期结论，级联停用后仍报 `active`（p04 §7.1） |
| 7 | **簿记自愈** | —— | 已实现 `reconcile()`；**踩过坑**：级联停用绕过 `unloadPlugin`，`providedBy` 会留死条目并误拒后来者（p04 §7.2） |
| 8 | **cleanup 错误合成** | 宿主的 effect 清理错误进自己的日志流，不进 fiber 的 `_error` | 已实现；**踩过坑**：F2 修复前只读到 setup 原因（p04 §7.3） |
| 9 | **事件名版本化** | 宿主事件名无版本概念 | 已实现，`id@version` |

**第 6/7/8 三项是 PoC-04 才暴露的**——这说明「契约适配层」的完整形状不是一次能定下来的，
后续每加深一层验证都可能再长出一项。**这一条本身就是前置条件：迁移必须接受适配层继续
生长的可能性。**

## §3.5 状态所有权原则（三方状态，一个权威）

这条原则是 PoC-04 §7.1 与 §7.2 两个缺陷直接逼出来的，不是设计偏好。

**今天有三方各自记着「插件现在是什么状态」**：

| 记在哪 | 谁写 | 什么时候变 |
| --- | --- | --- |
| 宿主 fiber 的 `_getState()`（`lib/index.js:1287-1292`） | Cordis | 真实状态迁移时 |
| 适配层 `records: Map<id, {state, error, layer, provided}>` 与 `providedBy` | `contract-layer.mjs` 的 `loadPlugin` / `unloadPlugin` | **只在适配层自己的两个入口** |
| Hikari 原 Runtime 的 `record.state`（`src/runtime/runtime.ts`） | `#activate` / `#failActivation` / `#reconcile` | 每次 reconcile |

**问题出在第二行**：Cordis 做的很多事**不经过适配层**。依赖失效导致级联停用、依赖恢复导致
自动复活，这两件事都由宿主自己完成，适配层根本不在调用栈上。于是适配层的记录会停在
装载时的旧值——PoC-04 实测到两种残留：状态缓存仍报 `active`（宿主真实是 `PENDING`），
`providedBy` 留着属主已死的条目并让后来者被误拒。

**原则**：

1. **宿主状态是唯一权威。** 「这个插件现在是 PENDING 还是 ACTIVE」只允许读
   `fiber.state`（或它的官方等价物），不允许读任何缓存字段。
2. **适配层的簿记只能是派生量，必须能从宿主状态重算。** `providedBy` 的判据是
   `app.get(key, false) !== undefined`，`records[i].provided` 随之同步——这两者在
   `loadPlugin` 入口与 `inspect()` 入口都要自愈（PoC-04 的 `reconcile()`）。
3. **唯一允许保留的装载期事实是「失败结论」。** 宿主的 `FAILED(3)` 会被后续重试覆盖，
   而「这一次装载失败了、原因是什么」是一次性事实，必须留在适配层。判别方式：
   `record.state === 'failed'` 优先返回，其余状态一律实时读宿主。
4. **迁移后不能出现第四方。** 若 Hikari 的 `record` 与适配层 `records` 并存，两者必须
   有明确的上下游（一个有权威、另一个派生），不允许各说各话。**这一条是硬要求**——
   PoC-04 的两个缺陷都是「两份状态各自维护」的直接后果，不是偶发 bug。

**对迁移的含义**：适配层不是「一层转发」，它是一份**状态副本**。副本必须声明自己是副本，
并且随时可被原始状态覆盖。任何「装载时算一次、之后不再更新」的字段都是潜在缺陷。

## §4 已知限定与不等价项

### 4.1 同名不同版本并存 —— 编码层已隔离，真实多版本装载未覆盖

Hikari 的 `serviceKey` 是 `id@version`，允许 `foo@1` 与 `foo@2` 并存；Cordis 是「一个
服务名一个实例」。适配层把完整的 `id@version` 编成宿主的服务名（`foo@1` 与 `foo@2`
编成两个**不同的名字**），所以两个版本是两个不同的服务身份、互不覆盖。

**版本隔离在适配层是被保留的，不是「只剩一个语义标签」。** 三条边界要分清：

- **保留**：完整 `id@version` 是契约身份，单射可逆（PoC-03 §2 的证明与 38 键合并实测）。
- **不做**：自动版本兼容协商。声明 `foo@2` 的插件不会因为场内只有 `foo@1` 而被满足，
  也不存在「相近版本自动匹配 / 升级 / 降级」。
- **未覆盖**：真实多版本插件并发装载。24 个真实 service 全部 version 1，并存路径只有
  构造用例（`experiments/poc-03-contract-layer/key-codec.mjs`）覆盖过。

性质：这是一条**未验证的路径**，不是能力退化，也不是当前 bug（今天没有第二版本）。
Human 2026-10-28 裁决：接受 Cordis 不原生理解版本号，但不接受丢失版本隔离；保留完整
`id@version` 作为契约身份，不做自动版本协商，真实多版本场景继续列为未覆盖。

### 4.2 Event 无版本概念 —— 已在适配层补偿

宿主事件名是任意 `string | symbol`，Hikari 的 `id@version` 由适配层拼进名字。真实集只有
1 个事件，**多事件、跨插件事件链未测**。

### 4.3 状态映射不是全承诺

只在四种观测情形上验证过（`waiting/active/failed/disposed`）。`LOADING`/`UNLOADING` 两个
过渡态在 Hikari 侧没有对应语义，适配层目前直接映射数字。若将来有代码依赖「启动中」这个
中间态，需要单独定语义。

### 4.4 正常卸载时 cleanup 抛错的可见性 —— 两侧都不成立，且原因不同

`experiments/route-c-consolidation/unload-cleanup.md` 的实测：

- 显式卸载路径上，**Hikari / 裸 Cordis / 契约层三侧都读不到清理异常**。
- Hikari 的原因：`unloadPlugin` 在 `#tearDown` 记下错误后立即 `#plugins.delete(pluginId)`
  （`src/runtime/runtime.ts:194-205`），记录连同错误一起消失。
- Cordis 的原因：`dispose()` 吞掉 cleanup 错误，`fiber._error` 保持 `undefined`。
- 级联停用路径上 Hikari **能**读到合成的 `AggregateError`（`One or more plugin resources
  failed to clean up.`），契约层只给 `waiting` 且错误不可读。

所以「清理失败可观察」在 Hikari 里是**路径相关**的属性，不是全局契约。要等价，契约层
必须补两件事：①级联停用路径上给 `failed` + 合成 `AggregateError`（**必须补**，属语义
等价）；②显式卸载路径上是照抄 Hikari 的不一致，还是比它多保住一点。

**②已由 Human 2026-10-28 裁决**：显式卸载后**不增加历史错误转存**，沿用 Hikari 当前
行为；级联停用时仍须保留失败结论与错误原因，这是 Hikari 原有的可观察语义。**不得为此
建立第二套生命周期状态机**——Cordis fiber 仍是生命周期权威，适配层的失败记录只能是
从宿主状态重算的派生量。

**2026-10-28 实测后更新：这条要求做不到。**

探针（Provider `P` + 依赖方 `D`，D 的 cleanup 必抛）在两侧跑出
（`experiments/route-c-cascade-cleanup/report.md`）：

| 判定项 | Cordis | Hikari |
| --- | --- | --- |
| cleanup 执行 | 是 | 是 |
| 清理错误留在宿主 | 否（`_error` 为 `null`） | 是（合成 `AggregateError`） |
| 停用后状态 | `PENDING` | `failed` |
| **Provider 恢复后** | **自动重装，setup 1→2，回到 `ACTIVE`，Service 可用** | **不重启，setup 仍 1，仍 `failed`** |

差异不在状态翻译，而在生命周期语义：Hikari 把失败当**终态**，Cordis 把失败当**过程**。
要在 Cordis 上报 `failed`，就必须让适配层维护一份与宿主不同的生命周期事实——这与
§3.5 第 3 条的「簿记只能是从宿主重算的派生量」直接冲突。三种修法（代理 fiber、记录
重放、空壳 fiber）已逐个实测失败，见该报告 §3。

**因此本项判为不可等价表达。** 处置只能三选一：接受 Cordis 语义（依赖方自动恢复）、
在契约层拦住宿主重激活（需 Cordis 提供钩子，当前没有）、或把「有 cleanup 且会失败」的
插件留在 Hikari Runtime。留待 Human 裁决。

### 4.5 失败记录占位 —— 适配层新增的概念

重装前必须先 `unloadPlugin`（失败记录仍占着 id），两侧行为一致；但「记录残留」这个概念
在 Cordis 侧不存在，是适配层加的。迁移后任何依赖「失败后可原地重装」的代码都要改。

### 4.6 PoC-02 的旧判定建立在一个漏掉 cleanup 的适配层上

`experiments/poc-02-runtime-contract/adapter-events.mjs` 的 `toCordisPlugin` 在
`await def.setup(...)` 后**丢弃返回值**，而 Hikari 的「`setup` 返回 cleanup」正是靠返回值
注册（`src/runtime/runtime.ts:127-130`）。也就是说 PoC-02 的探针 cleanup 根本没有注册上。

这**不影响** PoC-02 五项判定（它们测的是事件面与服务拒绝语义，不测 cleanup），但阅读
PoC-02 的 P4 结论时要知道：那个适配层的资源回收行为是不可信的。PoC-03 的
`contract-layer.mjs` 没有这个问题（返回值交给 `ctx.effect`，本轮已实测 cleanup 确实执行）。

## §5 未覆盖领域

按「迁移前必须补验」的优先级排列：

1. **带配置的插件**。四轮全部用探针或纯只读无配置的领域插件。`repository-ci-attention`
   这类带钳制式阈值、`desktop-return-attention` 这类带人配阈值的插件，其配置解析失败
   路径在 Cordis 下未验（适配层已实现 `layer='config'`，但没有真实插件跑过）。
2. **带写入/Action 的插件**。`repository-change-executor` 的八个工具、`human-delivery`
   的投递路径，全部未在 Cordis 下装载过。
3. ~~真实四层插件在级联下的表现~~ —— **已在 `experiments/route-c-first-domain/awareness-chain.md` 实测**。
   本节原先写「桌面感知那四层之间没有 `requires` 链」，**这句话是错的**：链真实存在三段——
   `src/desktop-session-world/plugin.ts:12-15` requires `foreground` + `input-activity`，
   `src/desktop-session-awareness/plugin.ts:65-68` requires `desktop-session-world`，
   `src/desktop-session-awareness-loop/plugin.ts:43-51` requires `desktop-session-awareness`。
   实测：五层按上述顺序装载全部 `active`；卸掉最上游 `foreground.windows` 后，下游三层
   全部 `waiting`、`assessed` 事件计数停止增长、与之无关的 `input-activity.windows` 不受
   影响；重装后五层自行恢复 `active`，事件间隔未减半（无残留定时器或旧订阅）。
   要区分两件事：**依赖链存在**（读源码即得）与**该生产链的级联卸载已被实测**（需要跑）。
4. **多层（>3）与分叉依赖图**；同一插件被两个 ctx 重复装载；`dispose()` 异步完成与
   `unloadPlugin` 返回之间的竞态。
5. **24 个 service 中已有 6 个被真实载入过 Cordis**（桌面感知五层 + `human-delivery`），
   其余 18 个只做了契约键编码验证。`human-delivery` 是第一个带真实副作用的插件（真建
   命名管道、真投递、真超时失败、真资源消失），`desktop-session-awareness-loop` 是第一个
   跑通真实 `config.parse` 的插件。详见 `experiments/route-c-first-domain/`。
6. **DSH 会话侧**：session 是重放而非可检索事实库。跨会话的持久认知 DSH 给不了，
   要另建——这块不属于 Runtime 兼容性，但属于迁移后的真实成本。

## §6 迁移前置条件清单

在动 `src/runtime/` 之前，这些应当成立：

- [ ] **适配层被当成 Runtime 的一部分维护**：有测试、有版本锁、有升级回归脚本（八条）。
- [ ] **状态所有权被写死**（§3.5）：宿主状态是唯一权威，适配层簿记是派生量，装载期只允许
      保留「失败结论」；迁移后不允许出现两份各自维护的状态。
- [ ] **九项新增能力各有归属**：哪些进适配层、哪些进领域包、哪些必须由宿主提供。
- [ ] **§4.1 / §4.2 的能力退化被明确接受**（或补齐：同名多版本、事件多版本）。
- [ ] **§4.4 的两条路径给出决定**：级联停用补 `failed`；显式卸载是照抄还是改进。
- [ ] **§5 第 1、2 项补验**：带配置、带写入的插件各至少一个真实装载。
- [ ] **错误类型差异被记录**：Hikari 抛通用 `Error`，契约层抛专用类；迁移后任何
      `error.constructor === Error` 的判断会失效。
- [ ] **`waiting` 的语义被写进文档**：它是适配层对 `PENDING` 的映射，不是宿主承诺。

## §7 版本锁与回归要求

- Cordis 固定 `4.0.5`。升版必须重跑：p03 的 `error-channel` / `three-layers` /
  `discipline` / `rollback`，p04 的 `cascade` / `race` / `partial-fail` / `event-final`，
  以及 `route-c-consolidation/unload-cleanup`。
- 每个脚本都自带「判定 + 读数」，重跑后应逐项对照，不接受「脚本没报错」作为通过。
- Hikari 侧 `npm run build` 必须在脚本之前执行（适配层从 `dist/` 导入已构建的
  `validatePluginDefinition`）。

## §8 对下一步的建议

**不建议现在开始替换 `src/runtime/`。** 建议顺序：

1. **先补 §5 第 1、2 项**（带配置、带写入的插件各一个真实装载）。这两项是「领域代码
   零改动」这个核心卖点唯一还没被检验的地方——今天所有 PASS 都建立在只读、无配置、
   无事件的插件上。
2. **再定 §4.4 与 §4.1/§4.2 的取舍**。这三条是设计判断，不是技术障碍，但会决定适配层
   的形状。
3. **然后才谈「适配层进 `src/`」**。今天的适配层在 `experiments/` 下，它是实验产物；
   一旦进 `src/`，它就成了 Runtime 的一部分，需要按 Runtime 的标准维护（测试、版本
   锁、失败语义）。

一句话：**路线 C 的兼容性问题已经问清楚了，剩下的是「愿不愿意长期维护那 350 行加上它
还会继续长出来的部分」。**
