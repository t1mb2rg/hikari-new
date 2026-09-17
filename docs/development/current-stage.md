# Hikari 当前阶段开发说明

> 状态：**Phase 2 已完成最终验收并正式收口**（P2-01 ~ P2-04 全部通过 Functional / Architecture Review，已 push，CI 通过）；**Phase 3 P3-01 已完成、已提交、已 push**（commit `3d910ee`，Functional PASS + Architecture PASS，CI 通过）；**Phase 3 P3-02 已完成、已提交、已 push**（commit `9495f7c`，Functional PASS + Architecture PASS，CI 通过）；**Phase 3 P3-03 已完成、已提交、已 push**（commit `a4f5c94`，Functional PASS + Architecture PASS，CI 通过：154 tests / 149 pass / 5 skipped / 0 fail）；**Phase 3 P3-04 实现完成并通过收口评审**（Functional PASS + Architecture PASS），为 `complete (awaiting commit)`，尚未提交、尚未 push；**P3-05 尚未冻结**
>
> 长期原则以 `docs/architecture/principles.md` 为准；v0 架构边界以 `docs/architecture/core-architecture-v0.md` 为准；第一阶段实现与复盘见 `docs/development/phase-1-runtime.md` 与 `docs/architecture/phase-1-architecture-review.md`；第二阶段 P2-01 实现与复盘见 `docs/development/phase-2-continuity.md` 与 `docs/architecture/phase-2-continuity-architecture-review.md`；P2-02 实现与复盘见 `docs/development/phase-2-chronicle.md` 与 `docs/architecture/phase-2-chronicle-architecture-review.md`；P2-03 实现与复盘见 `docs/development/phase-2-cli.md` 与 `docs/architecture/phase-2-cli-architecture-review.md`；P2-04 实现与复盘见 `docs/development/phase-2-lifecycle.md` 与 `docs/architecture/phase-2-final-architecture-review.md`；第三阶段 P3-01 实现与复盘见 `docs/development/phase-3-foreground.md` 与 `docs/architecture/phase-3-foreground-architecture-review.md`；P3-02 实现与复盘见 `docs/development/phase-3-input-activity.md` 与 `docs/architecture/phase-3-input-activity-architecture-review.md`；P3-03 实现与复盘见 `docs/development/phase-3-desktop-session-world.md` 与 `docs/architecture/phase-3-desktop-session-world-architecture-review.md`；P3-04 实现与复盘见 `docs/development/phase-3-desktop-session-awareness.md` 与 `docs/architecture/phase-3-desktop-session-awareness-architecture-review.md`。

---

## 当前结论

第一阶段完成了新的最小运行生态：

```text
Runtime
+ Plugin
+ Service
+ Event
+ Effect / 资源清理
+ 基础配置验证
```

第二阶段在这套运行生态之上，开始生长第一个真实领域模块。

第二阶段分解为四项，当前进度：

```text
P2-01  Continuity v1       已完成
P2-02  Chronicle v1        已完成
P2-03  启动入口            已完成
P2-04  生命周期验收        已完成
```

第三阶段开始让 Runtime **感知现实**，并首次进入 **World** 层。当前进度：

```text
P3-01  Windows Foreground Perception v1      已完成、已提交、已 push
P3-02  Windows Input Activity Perception v1  已完成、已提交、已 push
P3-03  Desktop Session World v1              已完成、已提交、已 push
P3-04  Desktop Session Awareness v1          已完成、已收口（待提交）

P3-05  尚未冻结
```

**P2-01 已完成的部分**：

```text
Continuity
+ 显式创建长期主体
+ 严格校验的持久化证据
+ 全新 Runtime 生命周期恢复同一主体
+ continuity.current Service
```

**P2-02 已完成的部分**：

```text
Chronicle
+ 显式创建 Store（initializeChronicle）
+ 纯读取挂载（openChronicle，零写入）
+ 严格校验的 JSONL 事实史
+ 全新 Runtime 生命周期读回已有 facts
+ chronicle Service
```

**P2-03 已完成的部分**：

```text
启动入口（CLI）
+ hikari init            → 只创建长期主体
+ hikari chronicle init  → 只创建事实史（Hikari 不存在则失败，不自动创建）
+ hikari start           → 真实 Runtime 启动组合 + 三种结果语义分离
+ 零创建恢复路径（start 前后持久字节不变）
```

**P2-04 已完成的部分**：

```text
生命周期验收（跨 Runtime）
+ Runtime A 恢复主体 → 挂载事实史 → append Fact A → shutdown
+ 全新 Runtime B 恢复同一主体 → 挂载同一事实史 → 读回同一 Fact A
+ hikariId 与 DurableFact 全部字段跨 Runtime 一致
+ 两个 Runtime 不共享 Runtime / Context / Plugin / Service / identity 对象
+ 新 Runtime 读磁盘而非上一个 Runtime 的内存
+ 7 种可检测损坏诚实失败，不创建、不修复、不截断、不重写
```

P2-04 **没有新增任何生产代码**：`src/` 零改动，验收证据由一个不提供任何 Service 的测试专用 Plugin 承担。

第二阶段四项验收全部达到阶段标准，**Phase 2 已完成最终验收并正式收口，已 push，CI 通过**。

**P3-01 已完成的部分**：

```text
Windows Foreground Perception v1
+ 自治 Plugin foreground.windows（requires: []）
+ foreground.current@1 Service 契约
+ 异步 PowerShell 子进程 + 直接 Win32 P/Invoke 的真实前台获取
+ observation 语义：observedAt / source / foreground.kind
+ title 三态、processName 两态，无包装类型
+ absent 是观测、失败不是观测、未知不塌缩成 absent
+ 非 Windows 宿主 → Plugin failed、消费者 waiting（Runtime 零平台判断）
```

P3-01 **没有修改任何已冻结模块**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/cli/`、`src/index.ts` 的 `git diff HEAD --stat` 全部为空，逐字节未改动。全部产物是新增文件。

P3-01 已完成、已提交、已 push（commit `3d910ee`），CI 已对这批测试跑过并通过（run `35053737581`）。

**P3-02 已完成的部分**：

```text
Windows Input Activity Perception v1
+ 自治 Perception Plugin input-activity.windows（requires: []）
+ input-activity.current@1 Service 契约
+ 异步 PowerShell 子进程 + 直接 Win32 P/Invoke 的 GetLastInputInfo 获取
+ observation 语义：observedAt / source / lastInputTick（原始事实，无解释）
+ dwTime = 0 是合法 tick 而非缺失；uint32 两端边界原样保持，较小的后续 tick 不被修正
+ 无后台观测：pull-only，加载 / 空闲 / 卸载零观测
+ 与 Foreground 并列、互不依赖、互不调用，Runtime 不协调二者，无 PerceptionManager
+ 非 Windows 宿主 → Plugin failed、消费者 waiting（Runtime 零平台判断）
```

P3-02 **没有修改任何已冻结模块**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 的 `git diff HEAD --stat` 全部为空，逐字节未改动。全部产物是新增文件。

P3-02 已完成、已提交、已 push（commit `9495f7c`），CI 已对这批测试跑过并通过（run `35200893510`）。

**P3-03 已完成的部分**：

```text
Desktop Session World v1
+ 自治 World Plugin desktop-session-world（requires: 两个感知契约，provider 缺席即 waiting）
+ desktop-session-world.current@1 Service 契约
+ 一次 current() 在同一个同步段内并发组合两次真实感知获取
+ snapshot 语义：snapshotAt + 逐 facet 的 available / unavailable
+ capability 缺席（Runtime 依赖图 → waiting）与 capability 失败
  （World 内 allSettled → unavailable）分属两个不同机制，互不替代
+ current() 永不 reject：两个 source 都失败仍 resolve 出两个 unavailable facet
+ available + absent 与 unavailable 不塌缩
+ unavailable 不携带原因：World 不读 reason、不检查 error 类型
+ 无平台实现：模块内零 process.platform / 零 PowerShell / 零 Win32 字样
+ pull-only、零持久化、零后台机制、零 Manager、零新依赖
```

P3-03 **没有修改任何既有文件**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部零改动，全部产物是新增文件。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

P3-03 已完成、已提交、已 push（commit `a4f5c94`），CI 已对这批测试跑过并通过（154 tests / 149 pass / 5 skipped / 0 fail）。

**P3-04 已完成的部分**：

```text
Desktop Session Change Awareness v1
+ 自治 Awareness Plugin desktop-session-awareness（requires: World 契约，provider 缺席即 waiting）
+ desktop-session-awareness.current@1 Service 契约
+ 第一次 current() 返回 baseline，第二次起返回 comparison
+ 三个判定值：facet 级 changed / unchanged / indeterminate，整体级 changed / stable / indeterminate
+ 只比较相邻两次 snapshot；不比较 snapshotAt / observedAt（否则恒为 changed）
+ 任一 facet 任一侧 unavailable → 该 facet indeterminate，绝不伪装成 unchanged
+ 不对称优先级：changed 压过 indeterminate；stable 仅在两个 facet 都 unchanged 时成立
+ title 的 omitted / undefined、null、string 三态用 === 保持可分，不做归一化
+ lastInputTick 只比较相等性：不推断方向、时长、活跃度
+ World rejection 原样传播，且失败调用不推进 baseline
+ baseline 是 activation-local（setup 作用域），停用再激活自然回到 baseline
+ pull-only、零持久化、零后台机制、零 Manager、零新依赖、零平台实现
```

P3-04 **没有修改任何既有文件**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/desktop-session-world/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部零改动（`git diff --name-only` 输出为空），全部产物是新增文件。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

P3-04 尚未提交、尚未 push。

第二阶段**已全部 push**：P2-01 ~ P2-04 共 4 个提交（`194987c` / `e430358` / `86aa3fc` / `58bb596`）全部在远端，CI 已对这批测试跑过并通过。第二阶段没有未结项。P3-01 ~ P3-03 也已 push，`origin/main` 现为 `a4f5c94`（已比对确认与本地 HEAD 逐字符相同）。

**第二阶段不新增架构地图（已决定，非未结项）**：第一阶段的图存在，是因为那一步要固定「Runtime 不带领域语义」这条边界本身；第二阶段的产物是接线与验收——P2-01 / P2-02 / P2-03 的因果与边界已由各自的实现文档与架构评审完整保存，P2-04 **没有新增任何生产结构**。此时硬画一张图只会复述已有文字，不增加信息，因此**不以架构图作为第二阶段收口条件**。后续若出现真实的结构变化，再按那时的需要决定是否建图。

另有一条已记录的格式限制随第二阶段进入下一阶段：**Chronicle v1 没有完整性标记**，因此「fact 行被删光、header 完好」的 store 与全新 store 在结构上无法区分，会被报告成空历史。它不影响关闭判断，但是任何后续 Chronicle 完整性工作的明确输入（详见 P2-04 实现文档 §9 与架构评审 §11）。

三个阶段都没有迁移旧 Hikari，也没有实现完整 Awareness、Memory、Goal 或多节点系统。

第三阶段第一次让 Runtime **感知现实**：Foreground 报告「谁在前台、什么时候看到的」，InputActivity 报告「系统记录的最后一次输入发生在哪个 tick」，**都不**判断这些意味着什么。P3-03 在此之上首次进入 **World** 层，回答「在这个 scope 内，我现在掌握了哪些事实」。

三层分工与当前落点（**领域定义**，以 `principles.md` §14 为准，继续冻结）：

```text
Perception   我观察到了什么？                      P3-01 / P3-02 已交付
World        在某个 scope 内现在掌握哪些事实？     P3-03 已交付
Awareness    这些事实意味着什么 / 什么值得在意？   P3-04 首次进入（仅最小切片）
```

**P3-04 并不实现完整 Awareness。** 它只是 Awareness 层的**第一个最小 contextualization primitive**，当前只回答：

> 相邻两个 DesktopSessionWorld snapshot 的**可比较 payload** 有没有变化？

对照 `principles.md` §14 给出的推荐链路：

```text
世界变化 → Perception → Observation → 事实标准化 / Contextualization
         → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act
```

P3-04 落在链路中的 **Contextualization** 这一格，并且只落在这一格的最窄面：它把「本次事实」与「上一次事实」放进同一个上下文（相邻两次比较）从而给事实一个坐标。**它不进入 Salience / Importance Judgement，更不进入 Ignore / Remember / Ask / Notify / Act。**

因此本阶段的三条语义分界必须与上面的领域定义同时阅读：

```text
changed       不蕴含「重要」
stable        不蕴含「无事发生」；它是关于观测值的陈述，不是关于世界的陈述
indeterminate 不蕴含「出了问题」；它只蕴含「这一项没法比」
```

这正是 §14 那句「不应把 Foreground、Calendar、DeviceActivity 等传感器集合本身称为完整 Awareness」的同型纪律：**P3-04 是 Awareness 的一个 slice，不是 Awareness。** 把它读成完整的 Awareness，与把一组感知读成完整 Awareness 是同一类错误。

**准确的说法是**：P3-04 **首次让 Perception → World → Awareness 三层在真实代码中贯通**——在此之前，第三层从未有过任何真实实现，"三层"只是文档里的分工。但**贯通不等于完整实现 Awareness**；P3-04 只落实了 Awareness 的**最小 change-contextualization slice**。三层在代码中贯通，与第三层被实现完整，是两件不同的事，不得互相替代。

（本轮更正的一处口径：上一版本文档把 Awareness 的领域定义改写为「这些事实之间有没有差别」，并把「意味着什么」划出 Awareness 层。那是**错误的范围收窄**——§14 定义的 Awareness 明确包含「值不值得在意 / 是否需要记住、提醒或行动」。「有没有差别」是 P3-04 这个 primitive 的能力边界，不是 Awareness 层的定义。）

四步的架构增量都不在于新增能力：

```text
P3-01  证明了一个感知可以存在
P3-02  证明了第二个感知不需要先长出协调层
P3-03  证明了组合两个感知也不需要先长出协调层
P3-04  证明了在组合之上做变化判断，仍然不需要协调层，也不需要 Memory
```

P3-02 的证明方式是：两个感知 Plugin 各自 `requires: []`、各自提供自己的 Service 契约、各自拥有自己的平台判断，Runtime 侧仍然零平台知识、零协调代码。

P3-03 的证明方式是：World 是最容易长成 `PerceptionManager` / `ObservationBus` / `GlobalWorldState` 的地方，而它没有。它**没有为「我是组合者」这个身份要求任何特殊待遇**——取得两个 source 的方式与任何消费者取得任何 capability 的方式完全相同（`requires` 声明、`setup` 里 `get`、调用时 `await`），Runtime 也没有给它任何特殊待遇。Runtime 侧仍然零改动、零新 API。

P3-04 的证明方式是：Awareness 是最容易长成 `AwarenessManager` / `GlobalAwareness` / Super Orchestrator 的地方（「我知道所有事实，所以由我来协调」），而它没有；它也是**第一次出现「需要记住上一次」的诱因**的地方，而它只用一个 `setup` 作用域内的局部变量解决，没有长成 Memory。它取得 World 的方式同样与任何消费者取得任何 capability 的方式完全相同。Runtime 侧仍然零改动、零新 API。

**P3-04 同时确立了一条进入后续阶段的语义分界**：`stable` **是关于观测值的陈述，不是关于世界的陈述**。它只说「两次 snapshot 之间两个可比的 payload 没有差别」，**不表示**用户空闲、不表示用户离开、不表示没有活动、不表示现实世界没有变化。这条分界由模块内的禁用词表在结构上守住（`isIdle` / `isAway` / `userPresent` / `userAway` / `idleFor` 出现即测试失败）。

当前已经证明：

> 新的 Plugin 运行基础可以稳定工作，并且没有重新长成中央大脑、万能通信层或业务类型树；同时 Runtime 之上可以生长真实领域模块，而 Runtime 完全不需要知道该领域的语义。

---

## 已实现

### Runtime

负责：

- Plugin 加载、启动、等待、停止与卸载；
- Service 注册、发现与硬依赖满足；
- Event 注册与派发；
- Effect / 资源归属与自动清理；
- Plugin 基础配置验证。

### Plugin

Runtime 只认识一种 `PluginDefinition`。

当前最小声明：

```text
id
version
requires
provides
config schema（可选）
setup
```

不建立 AgentPlugin / VoicePlugin / SensorPlugin 等业务继承树。

### Service

- Service 承担主要有返回值的数据调用；
- Consumer 只能使用自己声明的 `requires`；
- Provider 只能提供自己声明的 `provides`；
- 缺失依赖时 Consumer 等待；
- Provider 出现后自动激活；
- Provider 消失时依赖关系自动收敛；
- Provider 恢复后 Consumer 可以重新激活。

当前第一版故意只允许一个 Service 契约存在一个活动 Provider。

### Event

- Event 只承担实时通知；
- 支持多个订阅者；
- 订阅随 Plugin 生命周期自动清理；
- 不承担普通查询，也不模拟 Service 请求 / 响应。

### Continuity

回答 `core-architecture-v0.md` §6.1 的问题：

> “这些经历属于谁？”

本阶段只实现其中的最小生命线：一个 Hikari 可以被显式创建，并在一次全新的 Runtime 生命周期中恢复为同一个长期主体。

- 创建只能通过显式调用 `initializeHikari()`；
- 恢复只能通过 `restoreHikari()`，且为纯读取；
- 身份以 `continuity/origin.json` 持久化，写入采用临时文件 + 原子替换；
- 对外只通过 `continuity.current@1` 暴露 `HikariIdentity`；
- `OriginRecordV1` 持久化格式不暴露给消费者。

Continuity 是 Runtime **之上**的模块，从独立入口导入，`src/index.ts` 未修改。

Continuity **不**负责 Memory、World、Goal、设备认证或权限判断，也不知道 Chronicle。

### Chronicle

回答 `core-architecture-v0.md` §6.2 的问题：

> “真实发生过什么？”

本阶段只实现其中的最小事实史：一个 Hikari 可以把一条已经发生的事实追加进自己的事实史，并在一次全新的 Runtime 生命周期中读回它。

- 创建只能通过显式调用 `initializeChronicle()`；
- 打开只能通过 `openChronicle()`，且为纯读取、零写入；
- 缺失 Chronicle **不会**被解释为首次初始化——没有 `openOrCreateChronicle()`；
- 事实以 `chronicle/chronicle.jsonl` 持久化，第一行是 Store Header，之后每行一条 `DurableFact`；
- 对外只通过 `chronicle@1` 暴露 `append` / `get` / `read`；
- `factId` 与 `recordedAt` 由 Chronicle 生成；`type` / `version` / `occurredAt` / `source` / `payload` 由调用方提供；
- `owner` 只存在于 Store Header，是整份事实史的主体绑定，事实内不重复 `hikariId`。

Chronicle 同样是 Runtime **之上**的模块，从独立入口导入，`src/index.ts` 未修改。

Chronicle **不**负责判断「什么值得长期记录」，**不**接管 Event、Memory、World、Goal、Action 或状态恢复，也**不是**所有 Plugin 的强制依赖。它只依赖 Continuity 的公开身份语义，且 Continuity 不知道 Chronicle 的存在。

### 启动入口（CLI）

回答一个很朴素的问题：

> 已经存在的这些能力，怎么真正跑起来？

```text
hikari init --data-dir <path>            只创建长期主体
hikari chronicle init --data-dir <path>  只为已确认存在的主体创建事实史
hikari start --data-dir <path>           构造一次真实 Runtime 启动流程
```

`start` 的三种结果严格区分：

```text
A  Continuity active + Chronicle active   → 启动成功，exit 0
B  Continuity failed + Chronicle waiting  → 无法确认长期主体
C  Continuity active + Chronicle failed   → 主体已恢复，但事实史不可用
```

B 与 C 都返回非 0，但**都不等于「Hikari 不存在」**：B 描述的是本次恢复流程的结果，C 明确保留「主体在、能力不在」的区别。

- CLI 只使用 Continuity / Chronicle / Runtime 的**公开 API**，不读 `origin.json`、不读 `chronicle.jsonl`、不检查 Store owner、不修复任何领域文件；
- CLI 不是身份真源，也不是事实史真源；
- `start` 是持久化意义上的**零创建路径**，前后所有文件字节不变；
- 插件最终状态由 Runtime 的 `requires` 依赖图收敛得出，CLI 不轮询、不重试、不强制激活；
- 没有引入 `HikariCore` / `ApplicationContext` / `BootstrapManager` 等中心对象，也没有新增全局可变状态。

CLI 同样是 Runtime **之上**的模块，`src/index.ts` 未修改。

**CLI 不拥有被组合者**：它不知道身份怎么创建、事实怎么落盘、Store 长什么样。如果实现 CLI 需要读一个领域文件，那说明该领域缺少一个公开 API——正确做法是补 API，而不是让入口下沉去读文件。

### Foreground（P3-01）

回答一个 Runtime 此前完全没有能力回答的问题：

> 此刻人正在看什么？

```text
foreground.windows  Plugin（自治，requires: []）
↓
foreground.current@1
↓
current(): Promise<ForegroundObservation>
```

**Observation 语义**：

```ts
{
  observedAt: string,                       // 核心目标被取得的时刻
  source: 'foreground.windows',
  foreground: { kind: 'absent' }
            | { kind: 'present', title?: string | null, processName?: string }
}
```

三条语义是本阶段冻结的核心：

```text
Absence is an observation.           → kind: 'absent' 是成功观测，resolve
Failure to observe is not.           → 获取失败一律 reject，绝不 resolve 成 absent
Unknown must not collapse into absence. → 元数据取不到只省略字段，不改 kind
```

- 一次 `current()` = 一次新的真实获取，无缓存 / 无复用 / 无去重；
- 加载、空闲、卸载期间**零后台观测**；
- `title` 三态由 `exactOptionalPropertyTypes` + JSON key 存在性表达，**没有** `ObservedValue<T>` 包装类型；
- `observedAt` 由真正执行获取的一方（PowerShell 侧）在 `GetForegroundWindow()` 之后立即产生，父 Node 进程只透传、不重打；
- `source` 是独立字面量常量，**不引用** Plugin ID，Plugin 改名不会静默改变已发出的观测；
- 公开表面恰好 7 个符号；acquisition seam、`createForegroundPlugin`、原始 Windows 类型、HWND、PID 均**不公开**。

**Perception 边界（本阶段冻结）**：

> **Foreground 是 witness，不是 interpreter。**

它只报告「谁在前台、什么时候看到的」，**不**判断这件事是否重要、是否正常、是否值得记住。因此本阶段明确没有实现：语义分类、重要性判断、新鲜度、模型调用、Chronicle 写入、World、Awareness、Judgement，也**没有**过滤 Explorer / 任务栏 / 自身进程。采集侧同样沉默——PowerShell 脚本里没有任何启发式回退，核心获取只有 `GetForegroundWindow()`。

> **现实很奇怪就报告奇怪的现实。**

对应 `principles.md` §14「Perception ≠ Awareness」：感知 Provider 只回答「我观察到了什么」，不回答「这件事意味着什么」。

**平台语义归属**：生产 Plugin 在 `setup` 中做**且仅做一次** `process.platform === 'win32'` 检查。非 win32 时 Plugin `failed`、消费者 `waiting`。**Runtime 不理解 Windows 是冻结边界**；「我的实现能否在当前宿主上工作」是 Plugin ownership 的内部问题，不应泄漏给每一个消费者。`setup` 中不探测前台窗口、不探测 PowerShell 可用性、不探测桌面会话与权限——那些属于运行时观测失败，不属于启动前提。

Foreground 是 Runtime **之上**的模块，从独立入口 `src/foreground/index.ts` 导入，`src/index.ts` 未修改。

Foreground **不**依赖 Continuity，**不**依赖 Chronicle，**不**写任何文件，**不**创建目录，也**没有**新的 Manager。资源所有权沿用既有的 `context.defer()`。

### DesktopSessionWorld（P3-03）

回答 World 层的第一个问题：

> 在这个 scope 内，我现在掌握了哪些事实？

```text
desktop-session-world  Plugin（自治，requires: 两个感知契约）
↓
desktop-session-world.current@1
↓
current(): Promise<DesktopSessionWorldSnapshot>
```

**Snapshot 语义**：

```ts
{
  snapshotAt: string,                    // World 组装完这次 snapshot 的时刻
  foreground:    { kind: 'available', observation } | { kind: 'unavailable' },
  inputActivity: { kind: 'available', observation } | { kind: 'unavailable' }
}
```

四条语义是本阶段冻结的核心：

```text
Observed is observed.               → source 的 observation 按引用透传，不重建、不复制
Failure to observe is not.          → 失败的 source 得到 unavailable，绝不伪造 observation
The snapshot carries no interpretation. → 不做跨 facet 比较、关联、对齐或推断
The snapshot is one instant.        → 两个 source 同段启动，snapshotAt 在两者都 settle 之后产生
```

**两套时间轴同时可见且不被比较**：`observation.observedAt` 是感知时刻，`snapshot.snapshotAt` 是组合时刻。World 不重打 source 的时间戳，也不声称两者是同时刻的事实。

**Dependency 语义（本阶段最容易做错的一处）**：capability **缺席**与 capability **失败**分属两个不同机制，互不替代：

```text
capability 缺席（该感知根本没加载）  → Runtime 依赖图  → World waiting，current() 不可达
capability 在位但本次获取失败        → World 内 allSettled → World 保持 active，该 facet unavailable
```

World **不**自己检查 Provider 是否存在，**不**把依赖声明成可选，**不**用运行时动态发现绕过依赖图。它不会在缺 provider 的情况下假装 `active`，也不会为了拿到 partial world 去绕过 Runtime 的依赖模型。provider 消失时走既有的 `#deactivateTree` 收敛回 `waiting`。

**失败边界**：

```text
desktopSessionWorldService.current() 永不 reject
→ 两个 source 同时失败时仍 resolve，返回两个 unavailable facet
→ 「一条事实都没有」是 World 的一个合法答案，不是 World 自身的失败
```

World **不是错误总线**：不聚合、不转发、不分类 error，不读 `result.reason`，不检查 error 类型。同步抛出与 promise rejection 落到完全相同的位置（由 `Promise.resolve().then(...)` 折叠）。`unavailable` **不携带原因**——World 不拥有它所组合的 source 的失败分类学，把 transport 细节写进这个契约等于把 PowerShell 退出码提升成 World 层公开语义。

**`available + absent` ≠ `unavailable`**：Foreground 的 `{ kind: 'absent' }` 是一次**成功的观测**（观测到「此刻没有前台目标」），与「没能观测」是两条完全不同的事实，实现上不可能塌缩——`available` 只由 `fulfilled` 分支产生，`unavailable` 只由 `rejected` 分支产生。

**并发**：两个 source 在**同一个同步段**内启动，因此 snapshot 覆盖的是单次获取所能提供的最窄窗口。真实路径实测一次组合约 **386ms**，而同轮两个感知各自单独运行为 638ms / 674ms——串行应在 1300ms 量级。同段启动是真的在起作用。

**Perception → World 边界（本阶段冻结）**：

> **World 是 composer，不是 interpreter。**

它只回答「我手里有什么」，不回答「这代表什么」。因此本阶段明确没有实现：`GlobalWorldState`、`WorldManager`、`PerceptionManager`、Awareness、Judgement、Salience、Importance、Attention、User Presence、Idle Detection、Activity Classification、freshness / stale / TTL / `ageMs`、缓存、latest snapshot、polling、timer、watcher、event、history、retry framework、dedup、debounce、rate limiting、Chronicle 集成、模型调用、跨 runtime / 跨 session 聚合。

> **现实很奇怪就报告奇怪的现实**；解读属于第三层，不属于 P3-03。

**命名**：模块名为 `desktop-session-world` 而非 `windows-session-world`，理由是结构性的——本模块**没有任何 Windows 专属实现**。把平台写进 World 的公开身份，会把「当前 provider 的实现平台」误固化成「World 的定义范围」。

DesktopSessionWorld 是 Runtime **之上**的模块，从独立入口 `src/desktop-session-world/index.ts` 导入，`src/index.ts` 未修改。

World **不**依赖 Continuity，**不**依赖 Chronicle，**不**写任何文件，**不**创建目录，**没有**新的 Manager，也**没有** `context.defer()`——它不拥有任何资源。与 P3-01 / P3-02 不同，World **没有内部 seam**：它的两个依赖就是两个 capability，二者都经 Runtime 的 service registry 取得，因此测试直接加载**生产 Plugin**，无需具名内部 import。

---

## 验收状态

### P2-01 Continuity v1

本次新增文件：**12 个**。

```text
src/continuity/  (9)
  contracts.ts  errors.ts  index.ts  initialize.ts  origin-record.ts
  plugin.ts  restore.ts  storage.ts  types.ts
test/continuity.test.mjs                          (1)
docs/development/phase-2-continuity.md            (1)
docs/architecture/phase-2-continuity-architecture-review.md  (1)
```

修改文件：`package.json` 与 `package-lock.json`（新增 `@types/node` devDependency，工具链依赖）、`docs/development/current-stage.md`。

`src/runtime/` 与 `src/index.ts` 未修改。

本地自动化测试：**23 / 23 PASS**（17 个 Continuity + 6 个 Runtime）。

编译：`tsc` 无错误。

P2-01 Architecture Review：**PASS**。

图谱变更分析（`git add` 后执行，实际覆盖 Continuity 新文件）：**15 files / 124 symbols / 18 flows，risk critical，无 partial / truncated**。critical 构成已定位——45 个为文档标题符号，79 个为 Continuity 代码符号，18 条受影响流程全部是本阶段新增流程，无任何 `src/runtime/` 符号或 Runtime 流程受影响。详见 P2-01 架构评审 §14。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**。

本机图谱工具限制：MCP `detect_changes` 因 LadybugDB 被其他 GitNexus 进程锁定而不可用，改用 CLI 兜底；`query()` 的关键词 / 语义检索因 FTS 扩展加载失败而不可用。二者均不影响图遍历能力。

### P2-02 Chronicle v1

本次新增文件：**13 个**。

```text
src/chronicle/  (10)
  contracts.ts  errors.ts  fact.ts  index.ts  initialize.ts
  open.ts  plugin.ts  service.ts  store.ts  types.ts
test/chronicle.test.mjs                                       (1)
docs/development/phase-2-chronicle.md                         (1)
docs/architecture/phase-2-chronicle-architecture-review.md    (1)
```

修改文件：`docs/development/current-stage.md`。

`src/runtime/`、`src/continuity/` 与 `src/index.ts` 未修改。

本地自动化测试：**56 / 56 PASS**（33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

编译：`tsc` 无错误。

P2-02 Architecture Review：**PASS**。

图谱变更分析（`git add` 后执行，实际覆盖 Chronicle 新文件）：**14 files / 205 symbols / 46 flows，risk critical，无 partial / truncated**。critical 构成已定位——57 个为文档标题符号，148 个为 Chronicle 代码符号，46 条受影响流程全部是本阶段新增流程，无任何 `src/runtime/` 或 `src/continuity/` 符号、也无任何 Runtime / Continuity 流程受影响。详见 P2-02 架构评审 §21。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**。

本机图谱工具限制：索引中存在一处假阳性（`test/runtime.test.mjs ACCESSES test/chronicle.test.mjs` 三条边，而该文件实际零引用 Chronicle）；分析器自报流程分析未穷尽（24 个入口未追踪、7 条流程因 maxProcesses 丢弃、58 个 callee 因 maxBranching 跳过），因此受影响流程数只应读作下界。`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P2-03 启动入口

本次新增文件：**6 个**。

```text
src/cli/  (5)
  chronicle-init.ts  init.ts  main.ts  options.ts  start.ts
test/cli.test.mjs                                            (1)
```

修改文件：`package.json`（新增 `bin` 入口）、`docs/development/current-stage.md`。

`src/runtime/`、`src/continuity/`、`src/chronicle/` 与 `src/index.ts` 未修改（`git diff HEAD --stat` 对这四个路径输出为空，逐字节未改动）。

本地自动化测试：**82 / 82 PASS**（26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

CLI 测试用 `spawnSync` 拉起 `dist/cli/main.js`，断言的是**真实进程退出码与真实 stdout / stderr**。

编译：`tsc` 无错误。

P2-03 Architecture Review：**PASS**。

图谱变更分析（`git add` 后执行，实际覆盖 CLI 新文件）：**10 files / 120 symbols / 27 flows，risk critical，无 partial / truncated**。critical 构成已定位——48 个为文档标题符号，72 个为 CLI 代码符号（`src/cli/` 60 个 + `test/cli.test.mjs` 12 个），无任何 `src/runtime/`、`src/continuity/`、`src/chronicle/` 或 `src/index.ts` 符号，27 条受影响流程全部是 CLI 自身流程。CLI 向外的 IMPORTS 边 14 条，全部指向公开入口，无一条指向存储模块。详见 P2-03 架构评审 §17。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**。

本机图谱工具限制：分析器自报流程分析未穷尽（33 个入口未追踪、10 条流程因 maxProcesses 丢弃、70 个 callee 因 maxBranching 跳过），因此受影响流程数只应读作下界；索引元数据自报落后一个提交，但 `src/cli/` 符号确实已在图内；跨语言字段解析不完整（`.code` / `.stdout` / `.stderr` 等字段的引用查询会返回空结果，空不等于无人使用）。`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P2-04 生命周期验收

本次新增文件：**3 个**。

```text
test/phase-2-lifecycle.test.mjs                                   (1)
docs/development/phase-2-lifecycle.md                             (1)
docs/architecture/phase-2-final-architecture-review.md            (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/` 零改动**（`git diff HEAD --stat -- src/` 输出为空）。本轮没有新增任何生产代码，也没有为测试修改 Runtime API。

本地自动化测试：**98 / 98 PASS**（16 个 P2-04 + 26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

验收本身经过变异测试：向 `dist/chronicle/service.js` 注入模块级共享缓存（模拟跨 Runtime 复用内存状态，`src/` 未改动、事后重建恢复）后 **3 个用例失败**。首次变异只触发 2 个，暴露出当时的磁盘测试对「内容是否来自内存」没有判别力，据此补写了真正有判别力的用例（`test/phase-2-lifecycle.test.mjs` 第 3 条）。详见 P2-04 实现文档 §10。

P2-04 Architecture Review：**PASS**。

图谱变更分析（`git add` + 重建索引后执行）：**4 files / 113 symbols / 0 flows，risk low，无 partial / truncated**。构成为测试代码 69 个 + 三份文档标题 44 个，`src/` 零符号，受影响流程 0 条。

第一次执行返回 `changed_count: 0` 而 `changed_files: 1`——新文件从未被索引，没有符号可供映射。重建索引后才是有效结果，这一点已记入评审 §12。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**（run `34955475103`，commit `58bb596`）。

本机图谱工具限制：**图谱不解析 `.mjs` 的 IMPORTS 边**（全图 89 条 import 边全部来自 TypeScript scope），因此针对测试文件的导入查询返回空——这个空结果不是「没有依赖」的证据，本轮该结论改用文本检索获得；分析器自报流程分析未穷尽（29 个入口未追踪、74 个 callee 因 maxBranching 跳过、4 条 walk 被预算截断），因此受影响流程数只应读作下界；跨语言字段解析不完整（113 处），`.code` / `.stdout` / `.stderr` 等字段的引用查询会返回空结果，空不等于无人使用。`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P3-01 Windows Foreground Perception v1

本次新增文件：**11 个**。

```text
src/foreground/  (7)
  acquisition.ts  contracts.ts  errors.ts  index.ts  plugin.ts  types.ts  windows.ts
test/foreground.test.mjs                                            (1)
test/foreground-windows.test.mjs                                    (1)
docs/development/phase-3-foreground.md                              (1)
docs/architecture/phase-3-foreground-architecture-review.md         (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/cli/`、`src/index.ts` 与 `package.json` 全部未修改**（`git diff HEAD --stat` 对这几个路径输出为空，逐字节未改动）。`dependencies` 仍为 `null`。

本地自动化测试：**118 / 118 PASS**（18 个 Foreground 确定性 + 2 个 Windows 真实 smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

P3-01 Architecture Review：**PASS**。

**边界验证暴露并修复了两个真实 bug**（均位于本轮新增文件内，未触碰任何冻结模块）：

```text
1. readAcquisition 的 absent 分支冻结 target、present 分支不冻结
   → 两条同层分支行为不一致；公开契约未破坏（toObservation 无条件冻结），
     但任何未来改动 toObservation 都会让 present 路径静默泄漏可变对象
   → 改为对称冻结

2. dispose() 杀死飞行中的子进程时被描述成 "did not finish in time"
   → 根本没有超时发生，那是 shutdown；人类会去追一个不存在的超时
   → 改为按 disposed 标志给出真实描述

3. 拆除路径此前无任何自动化覆盖 —— 上述消息正是这样活下来的
   → 已在 Windows smoke 新增一条真实回归测试（断言消息不得声称超时）
   → 本轮唯一新增的仓库测试
```

**66 条探针断言的性质（必须与结论同时阅读）**：

```text
probe-parsers 31 + probe-transport 17 + probe-runtime 18 = 66，全绿

但它们是：会话临时目录中的一次性探针，不在仓库内、不进 CI、不可复现
它们不是：可复现的回归覆盖

价值在于验证对象是从 dist 取出的真实生产常量，而非手写副本：
  - ENCODED_ACQUISITION_SCRIPT 被断言解码后与 ACQUISITION_SCRIPT 字节一致
  - absent 分支由对真实常量做一处 token 替换（$handle = [IntPtr]::Zero）得到
  - 字符保真断言 79 个码点逐码点一致，含 U+2000B 与 U+1F600 两个星形面字符
```

不把探针写回仓库是**决定**，不是遗漏：那意味着新增测试代码，超出纯文档收口的范围。若希望这 66 条变成持久证据，需要单独决定（代价是扩大测试面或增加第二处内部 import）。

**PowerShell v1 limitation**：

```text
每次 current() ≈ 370–455 ms（PowerShell 进程启动 + Add-Type 编译 P/Invoke）
对照 loadPlugin ≈ 0–1 ms
```

选择异步子进程而非 `spawnSync` 是**架构性**理由而非性能优化：Runtime 未来承载多个自治 Plugin，不应为了单次前台观测长时间整体阻塞 event loop。代价是本阶段刻意保留的 v1 实现限制，不设 SLA、不预先优化。它决定了 **Foreground 目前只能被显式调用，不能作为高频采样源**——任何高频前台感知需求都必须先解决这个成本。

P3-01 已完成、已提交、已 push（commit `3d910ee`），CI 已跑过并通过（run `35053737581`）。

**P3-01 收口轮未做图谱变更分析**：`detect_changes({scope: "all"})` 返回 `changed_count: 0`，但该轮全部产物是未跟踪新文件，不进 `git diff`，索引也早于该轮改动——**这个 0 必须读作「未看见」，不是「无影响」**（与 P2-04 §12 记录的是同一类）。该轮为纯文档收口、未执行 `git add`，因此**没有可引用的图谱证据**。「无侵入」的结论由 `git diff HEAD --stat` 为空逐字节支撑，不依赖索引新鲜度。

本机图谱工具限制：**图谱不解析 `.mjs` 的 IMPORTS 边**，针对测试文件的导入查询返回空——本轮涉及测试对 `dist/foreground/plugin.js` 的 import，属同一情形，空结果不是「没有依赖」的证据；`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P3-02 Windows Input Activity Perception v1

本次新增文件：**11 个**（此前写作 10，与 `9495f7c` 的 `--name-status` 实际不符：7 个 src + 2 个 test + 2 个 docs 为新增，`current-stage.md` 为修改，合计 12 项改动。本轮一并更正）。

```text
src/input-activity/  (7)
  acquisition.ts  contracts.ts  errors.ts  index.ts  plugin.ts  types.ts  windows.ts
test/input-activity.test.mjs                                      (1)
test/input-activity-windows.test.mjs                              (1)
docs/development/phase-3-input-activity.md                        (1)
docs/architecture/phase-3-input-activity-architecture-review.md   (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部未修改**（`git diff HEAD --stat` 对这几个路径输出为空，逐字节未改动）。全部产物是新增文件。

本地自动化测试：**137 / 137 PASS，0 skipped**（16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

P3-02 Functional Review：**PASS**。P3-02 Architecture Review：**PASS**。

**本阶段的主要架构结果**：多个自治 Perception Plugin 可以**并列存在，而无需中央 Perception Manager**。两个感知互不 `requires`、互不调用、互不持有内部对象，Runtime 不协调二者；全 `src/` 中 `process.platform` 只出现两处，都在各自的平台实现内，`src/runtime/` 零命中。

**与 P3-01 最尖锐的不对称：P3-02 没有 absent 分支。** `GetLastInputInfo` 只有成功 / 失败两种返回，而 `dwTime = 0` 是**合法 tick**（约等于系统启动时刻），不是「从未有输入」的哨兵。把 `0` 当作缺失正是冻结原则所禁止的无依据解释，因此 `0` / `1` / `0xFFFFFFFF` 一律原样报告，`isUint32` 只拒绝结构上不可能的值。代价已如实记入限制：本模块无法区分「自启动以来没有输入」与「tick 恰好很小」。

**142 条探针断言的性质（必须与结论同时阅读）**：

```text
A 脚本往返 2 + B 调用顺序 3 + C readAcquisition 6 + D describeFailure 3 + E 无解释 4 + F 真实传输 3
= 21 组 / 142 条断言，全绿

但它们是：会话临时目录中的一次性探针，不在仓库内、不进 CI、不可复现
它们不是：可复现的回归覆盖
```

价值在于验证对象是从 dist 取出的真实生产常量，而非手写副本：`ENCODED_ACQUISITION_SCRIPT` 被断言解码后与 `ACQUISITION_SCRIPT` 字节一致；`ok: false` 分支由对真实常量做一处 token 替换（`$info.cbSize = 0`）得到，实测 exit code 1、`killed: false`、**stdout 为空字符串**；uint32 两端悬崖 `4294967295` 接受 / `4294967296` 拒绝。本轮探针**未发现实现缺陷**。

**已知 coverage gap（watch item）**：`windows.ts` 的 parser rejection branches 不在 `npm test` 内，由探针覆盖。P3-01 已采用相同取舍，**现在该缺口已涉及两个模块**。本轮结论仍是不为测试覆盖扩大 public API、不改 seam；若未来出现第三个同型 parser，应重新评估 test seam 与 transport seam。

**P3-01 的 teardown bug 在 P3-02 中没有重新出现**，且这次有持久回归覆盖：Windows smoke 断言拒绝为 `InputActivityObservationError` 且消息不得包含 `did not finish in time`。

**已知限制**：

```text
每次 current() ≈ 523 ms（PowerShell 进程启动 + Add-Type 编译 P/Invoke）
两个感知并列使用时是两个独立子进程，无摊薄、无预热、无常驻
单次 observation 本身不提供 idle duration —— 这是冻结边界，不是缺陷
传输外壳与 P3-01 重复 68 行逐字相同的非平凡行，本轮刻意不抽公共 helper
```

重复的理由是架构性的：两个实例不足以判定「稳定共享机制」与「各自 acquisition semantics」的边界在哪里，且错误的抽象比重复更难撤销——它一旦被两个已交付模块依赖，就获得事实上的冻结地位。重新评估触发条件是客观的：**出现第三个同型 Windows Perception，或 P3-01 因独立需求解冻**。

P3-02 已完成、已提交、已 push（commit `9495f7c`），CI 已跑过并通过（run `35200893510`）。

**P3-02 收口轮未做图谱变更分析**：`detect_changes({scope: "all"})` 返回「未检测到变更」，但该轮全部产物是未跟踪新文件，不进 `git diff`——**这个 0 必须读作「未看见」，不是「无影响」**。该轮为纯文档收口、未执行 `git add`，因此**没有可引用的图谱证据**。「无侵入」的结论由 `git diff HEAD --stat` 为空逐字节支撑。

### P3-03 Desktop Session World v1

本次新增文件：**7 个**（实现轮 6 个 + 收口轮新增架构评审文档 1 个）。

```text
src/desktop-session-world/  (4)
  contracts.ts  index.ts  plugin.ts  types.ts
test/desktop-session-world.test.mjs                                 (1)
docs/development/phase-3-desktop-session-world.md                   (1)
docs/architecture/phase-3-desktop-session-world-architecture-review.md  (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部未修改**（`git diff HEAD --stat` 对这几个路径输出为空，逐字节未改动）。全部产物是新增文件。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

本地自动化测试：**154 / 154 PASS，0 skipped**（17 个 DesktopSessionWorld + 16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。全量为 137（既有）+ 17（本阶段）。

编译：`tsc --noEmit` 无错误。

P3-03 Functional Review：**PASS**。P3-03 Architecture Review：**PASS**。

**本阶段的主要架构结果**：World 是最容易长成 `PerceptionManager` / `ObservationBus` / `GlobalWorldState` 的地方，而它没有。组合是**在没有协调层的情况下**发生的——没有事件总线、没有通用 Observation 框架、没有中心注册表、没有 scope 注册表。World 取得两个 source 的方式与任何消费者取得任何 capability 的方式完全相同，Runtime 没有为它新增任何 API。

**本阶段最重要的契约不变量**：`current()` 永不 reject。两个 source 同时失败时仍 resolve 出两个 `unavailable` facet。「一条事实都没有」是 World 的一个合法答案，不是 World 自身的失败。World 不是错误总线——不聚合、不转发、不分类 error，不读 reason，不检查 error 类型。

**capability 缺席与 capability 失败分属两个机制**：缺席走 Runtime 依赖图（World `waiting`，`current()` 不可达），失败走 World 内的 `allSettled`（World 保持 `active`，该 facet `unavailable`）。World 不自己检查 Provider 是否存在，不把依赖声明成可选，不用运行时动态发现绕过依赖图。

**本阶段拿到真实图谱证据（与前两轮收口不同）**。前两轮的收口是纯文档、未执行 `git add`，全部产物是未跟踪新文件，`changed_count: 0` 必须读作「未看见」。本轮先 `git add` 5 个代码 / 测试文件并重建索引，因此数字有效：

```text
detect_changes --scope staged
  51 changed symbols / 5 files / affected_processes: [] / risk_level: low
  无 partial，无 truncated，无 HIGH / CRITICAL

changed_symbols 构成：
  src/desktop-session-world/  16 个（contracts 3 + plugin 7 + types 6）
  test/desktop-session-world.test.mjs  35 个

IMPORTS 边：对外 12 条，外部目标恰好 4 个
  runtime/contracts.ts、runtime/plugin.ts、foreground/index.ts、input-activity/index.ts
  全部是公开入口；到任何内部模块的边 0 条
指向 src/desktop-session-world/ 的入边：0 条
```

**17 条确定性测试中有 2 条（并发、`snapshotAt` 时序）的判别力由一次性变异探针验证**，因为「测试通过」不等于「测试有判别力」：

```text
基线                        17 pass / 0 fail
两次获取改为串行            1 fail（测试 14）
snapshotAt 上提到 await 之前 1 fail（测试 6）
同上 + 加强前的弱断言        17 pass / 0 fail   ← 关键对照
```

最后一行是关键：同一个被破坏的实现，在换回弱断言后**重新变绿**，证明加强是承重的而非文字润色。**`snapshotAt` 测试的初始写法几乎没有判别力**——整个 snapshot 在远小于 1 毫秒内跑完，两个时间戳落在同一毫秒，`>=` 照样成立；改为等待**时钟本身**跨过毫秒边界（`nextMillisecond()`）后才真正生效。

**已知 coverage gap 未加剧**：P3-01 / P3-02 的 `windows.ts` parser rejection branches 不在 `npm test` 内，该缺口仍涉及两个模块、无变化；P3-03 没有 parser、没有平台分支、没有内部 seam，其全部分支都在仓库测试覆盖内。本轮**没有**新增第二处具名内部 import——World 没有需要被替换的内部实现。

**已知限制**：

```text
unavailable 不携带原因 → 只看 snapshot 无法区分超时 / 权限拒绝 / 无法启动
World 结构上平台中立，但今天只在 Windows 上跑得起来（两个 provider 都是 Windows-only）
snapshot 不判断新鲜度 —— 两套时间轴都在，但不比较
两次子进程成本未被摊薄：World 没有让感知变快，只是没有让它更慢
snapshot 原子性只到「单次获取的最窄窗口」，不声称两个 observation 同时刻
World 不校验 observation 形状 → 其契约保真度依赖两个感知的契约保真度
```

P3-03 已完成、已提交、已 push（commit `a4f5c94c5987b51a3c2439742c39158f7f70686c`）。CI 已对这批测试跑过并通过：**154 tests / 149 pass / 5 skipped / 0 fail**（同样 5 条 Windows smoke 在 `ubuntu-latest` 上自我 skip）。

### P3-04 Desktop Session Awareness v1

本次新增文件：**6 个**（实现轮 5 个 + 收口轮新增架构评审文档 1 个）。

```text
src/desktop-session-awareness/  (4)
  contracts.ts  index.ts  plugin.ts  types.ts
test/desktop-session-awareness.test.mjs                                 (1)
docs/architecture/phase-3-desktop-session-awareness-architecture-review.md  (1)
```

修改文件：`docs/development/current-stage.md`（本轮），以及 `docs/development/phase-3-desktop-session-awareness.md` 的三处最小事实修正（术语、并发语义、限制 6）。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/desktop-session-world/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部未修改**（`git diff --name-only` 输出为空，逐字节未改动）。全部产物是新增文件。**特别注意：P3-03 的 `src/desktop-session-world/` 一个字节都没动**，本阶段只消费它的公开契约。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

本地自动化测试：**176 / 176 PASS，0 skipped**（22 个 DesktopSessionAwareness + 17 个 DesktopSessionWorld + 16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。全量为 154（既有）+ 22（本阶段）。

编译：`tsc --noEmit` 无错误。

P3-04 Functional Review：**PASS**。P3-04 Architecture Review：**PASS**。

**本阶段的主要架构结果**：P3-04 **首次让 Perception → World → Awareness 三层在真实代码中贯通**，三层第一次**同时**运行在同一个 Runtime 中，而 Runtime 对三层语义的知晓量仍是 0——`baseline` / `changed` / `stable` / `indeterminate` 这四个词没有出现在 `src/runtime/` 的任何一行。**贯通不等于完整实现 Awareness**；P3-04 只落实了 Awareness 的最小 change-contextualization slice（详见上文「三层分工与当前落点」）。Awareness 是第一个消费 World 的模块，它消费的是 World 的**结论**，不是 World 的**原料**；它没有直连 Foreground / InputActivity（源码 allowlist + 图谱 IMPORTS 边 + Serena 符号引用三层证据一致）。

**本阶段最重要的语义不变量**：**没有数据 ≠ 没有变化。**「没拿到数据」写成 `unchanged` 会让调用方以为「确认过，没变」，实际是「根本没看」——这两种情形语义相反。因此任一 facet 任一侧 `unavailable` → 该 facet 是 `indeterminate`，绝不伪装成 `unchanged`。

**判定代数是刻意不对称的**：`changed` 优先于 `indeterminate`，`stable` 仅在两个 facet 都 `unchanged` 时成立。理由是 `changed` 是**存在性**断言（「至少有一处不同」），可以由局部证据支撑；`stable` 是**全称**断言（「没有任何一处不同」），必须覆盖所有可比项。

**baseline 的 reset 是派生性质，不是新增机制**：`previous` 声明在 `setup` 作用域内，于是 World 消失 → `#deactivateTree` → 再激活时 `setup` 重跑 → 第一次 `current()` 自然回到 `baseline`。**本阶段为此没有写一行代码**。

**`title` 的三态保持是刻意的**：`exactOptionalPropertyTypes: true` 下 `title?: string | null` 在生产环境有三个可观察状态（omitted / `undefined`、`null`、`string`），三者都真的会发生，比较用 `===` 使它们两两可分。折叠（`?? null`）会把「读不到标题」与「读到了，是空标题」这两种不同事实判为 `unchanged`。

**关于 `detect_changes`：本轮的 0 必须读作「未看见」，且比 P3-03 更强**。本轮未执行 `git add`（收口纪律禁止 stage），全部产物是**未跟踪**文件，`detect_changes` 读的 `git diff` 按定义看不见它们——**重建索引后重测仍然是 0**，证明与索引新鲜度无关。这与 P3-03 那一轮（先 `git add` 因此拿到有效的 51 changed symbols）的差别，是收口纪律的直接后果，不是退步。本阶段的边界结论因此改由**源码 allowlist 断言 + 图谱 IMPORTS 边 + Serena 符号引用**三层证据支撑。

**`staleness.commitsBehind` 不可按数值采信（本轮拿到比 P3-03 更硬的证据）**：重建索引后 `.gitnexus/meta.json` 的 `lastCommit` 与 HEAD **逐字符相同**（已用 `git rev-parse HEAD` 比对），而该字段**仍报 `commitsBehind: 4`**——它很可能在服务进程启动时被缓存，重建之后没有重读。判定索引新鲜度只能靠 `meta.json` 与 `git rev-parse HEAD` 的直接比对。

**22 条确定性测试中有 3 条关键性质的判别力由一次性变异探针验证**，因为「测试通过」不等于「测试有判别力」：

```text
基线                                        22 pass / 0 fail
M1  title 比较改用 ==                        1 fail（测试 10）
M2  overallChange 让 indeterminate 优先      1 fail（测试 13）
M3  let previous 上提到模块作用域            9 fail（含测试 16）
```

M1、M2 各自**只**打翻应当打翻的那一条，说明两条性质被精确钉住。探针自身出过一次错误：第一版三次变异**全报 MISSED 且零失败**，原因是脚本用行首锚点 `^✖` 匹配 Node reporter 输出而 `✖` 前带 ANSI 色码，**探针把「有失败」读成了「无失败」**。修正后才得到上表。教训：**一个会把自己读错的探针比没有探针更危险。**

**已知 coverage gap 未加剧**：`src/foreground/windows.ts` 与 `src/input-activity/windows.ts` 的 parser rejection branches 不在 `npm test` 内（P3-01 / P3-02 已记录），缺口仍涉及两个模块、无变化；P3-04 没有 parser、没有平台分支、没有子进程、没有内部 seam，其全部分支都在仓库测试覆盖内，**也没有新增第二处具名内部 import**。

**已知限制**：

```text
不区分「变了」的种类 → title 改了与进程换了都是同一个 changed
stable 在真人使用下偏少 → 只要用户有输入，inputActivity 就是 changed
indeterminate 不携带原因 → 与 World 的 unavailable 同源决定
只比较相邻两次 → 「A → B → A」在第三次报 changed，不报「回到原状」
previous / current 是引用 → 靠快照已冻结的约定，本层不做防御性拷贝
并发下不保证 invocation-order baseline → baseline 按【成功 World acquisition
  的完成顺序】前进，不按调用发起顺序。v1 明确不增加 mutex / queue / serialization
本层不校验 World 返回的快照形状 → 契约保真度依赖 World，World 又依赖两个感知
```

**并发语义（须与限制同时阅读，勿读作保证）**：v1 不保证 concurrent `current()` 的调用顺序与 baseline 推进顺序一致。先被调用、但 World 后返回的那次，会成为后一次比较的 `previous`。单个 assessment 不受影响——每一次 `current()` 自身仍然完整、自洽、可引用；受影响的只是「哪两次读数被拿来配对」。理由：v1 的调用方只需要「拿两次读数做个比较」，在出现真实需求之前引入排队，是为想象中的调用方付协调成本。

P3-04 尚未提交、尚未 push。

### 第一阶段

第一阶段 Architecture Review：**PASS**。

第一阶段正式架构地图已纳入仓库：

```text
docs/diagrams/phase-1-runtime.architecture.json
docs/diagrams/phase-1-runtime.html
```

其中 `.architecture.json` 是 Archify 可维护的架构源模型，`.html` 是独立、可交互的人类可读架构视图。

Archify `showcase` 校验结果：**9 / 9 checks PASS，0 errors，0 warnings，repository evidence verified**。

自动浏览器 `visual-check` 当前不作为阶段阻塞条件；现有机器上的 Edge DevTools 自动检查仍有兼容性问题，但确定性 `validate` / `deliver` 已通过，HTML 已人工打开并可正常交互。

### 阶段标准

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

第一阶段：**已满足**。

第二阶段：**已满足**——P2-01 / P2-02 / P2-03 / P2-04 四项全部达到该标准，已正式收口。

第三阶段 P3-01：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push。

第三阶段 P3-02：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push。

第三阶段 P3-03：**已满足**——Functional PASS + Architecture PASS + Docs updated，**等待提交**。

---

## 当前明确仍不做

- 跨 Runtime 通信；
- 节点网络协议；
- 远程 Provider；
- Capability 第二注册表；
- Provider 智能选择；
- 全局状态中心；
- 完整权限系统；
- Memory / Goal 的领域实现，以及 **World 层的完整实现**——P3-03 只落地了一个 scope 的最小局部视图（一个桌面会话、两个来源、逐条可用性），没有 `GlobalWorldState`、没有 scope 注册表、没有跨 scope / 跨 runtime / 跨 session 聚合；
- Chronicle 的完整领域实现（P2-02 只落地了最小事实史，P2-04 只验收了它的跨 Runtime 生命周期）；
- **Chronicle v1 存储格式的完整性标记**（事实计数 / 链式哈希 / 墓碑）——因此「fact 行被删光、header 完好」的 store 与全新 store 无法区分，会被报告成空历史。这是已记录的格式限制，不是实现缺陷；
- Resident 常驻模式、守护进程、信号处理、后台服务；
- 配置文件、环境 Profile、节点配置、用户配置中心——CLI 只有一个必填参数 `--data-dir`；
- `hikari stop` / `hikari status` / `hikari log` 等运维命令；
- 启动失败后的自动重试、自动修复、自动创建；
- Event 自动转 Durable Fact，以及任何「什么值得长期记录」的自动判断；
- 事实的 `update` / `delete` / 查询 DSL / 全文搜索 / 向量搜索；
- 事实写入失败后的重试幂等语义（去重、幂等键、补偿读取、自动重试）——`ChroniclePersistenceError` 只表示本次写入未获得可靠持久化确认，**不**保证事实未落盘，调用方不得仅凭它判定事实不存在；
- `getOrCreate` / `openOrCreate` 与任何全局身份中心；
- 身份迁移、备份、修复、升级；
- **感知的语义解读**——Salience / Importance / freshness 判断、基于标题的语义分类、模型调用、「什么值得记住」的判断。P3-01 / P3-02 只交付 witness，P3-03 只交付 composer，P3-04 只交付 comparator，**都不**交付 interpreter；
- **Awareness 的完整实现**——`principles.md` §14 定义 Awareness 负责「这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？」，其链路为 Contextualization → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act。**P3-04 只落实了这条链路的第一个最小 contextualization slice**（相邻两个 World snapshot 的 payload 变化比较），链路其余部分——Salience / Importance 判断、Ignore / Remember / Ask / Notify / Act——**均未进入，且未被预埋**；
- **跨 source 的推断**——把「前台是 X」与「刚有输入」合起来推出「某人正在打字」这类结论。P3-03 把两条事实放进同一个信封，但**不**解释它们的关系；P3-04 只比较相邻两次信封的 payload 是否变化，同样**不**解释它们的关系；那是 Awareness 的句子，而 P3-04 只说出了其中最短的一句；
- **Input Activity 的在场解读**——`lastInputAt` / `idleForMs` / `idleSeconds` / `isActive` / `isIdle` / `userPresent`，以及任何阈值比较。`lastInputTick` 是 source fact，不是结论；
- **感知结果的过滤**——过滤 Explorer / 任务栏 / 自身进程，或任何「这不像正常用户程序」的启发式；
- **感知的后台化**——watcher、`changed` Event、轮询、订阅、缓存、保活、队列、速率限制、去重；
- **感知的持久化**——把观测写进 Chronicle 或任何文件；
- **非 Windows 的感知实现**——macOS / Linux 宿主上 Plugin 直接 `failed`，这是设计意图；
- **PowerShell 子进程成本的优化**（常驻子进程 / 预编译程序集 / 原生绑定）——两个感知都受此限制，任何高频感知需求都必须先解决它，但优化本身属于新工作；
- **通用 Perception / Sensor 框架**——第二个感知 Provider 已经出现（P3-02），**结论仍然是不抽公共抽象**：两个实例不足以判定共享边界，且错误的抽象比重复更难撤销。重新评估触发条件已记录为「出现第三个同型 Windows Perception，或 P3-01 因独立需求解冻」（详见 P3-02 架构评审 §16）；
- **World 的时间语义**——freshness / stale / TTL / `ageMs`、过期判断、`latest snapshot`、history。P3-03 同时暴露 `observedAt` 与 `snapshotAt` 两套时间轴但**不比较它们**：判断新旧属于 Awareness，不属于 World；
- **World 的失败分类**——`unavailable` 不携带 reason。让 World 转述 source 的失败形态（退出码 / 超时 / 权限）等于把感知实现的细节提升成 World 层公开语义。需要诊断的调用方应当去问那个感知；
- **World 的缓存与后台化**——缓存、latest snapshot、watcher、polling、timer、`changed` Event、重试框架、去重、限流。World 是 **pull-only** 的：没有 `current()` 调用就没有任何观测发生；
- **World 的持久化**——把 snapshot 写进 Chronicle 或任何文件；
- **World 的平台实现**——`desktop-session-world` 内零 `process.platform`。它是**结构上**平台中立的；「运行在 Windows 上」是它当前两个 provider 的事实，不是它的事实；
- **第二个 scope 的 World**——第二个 scope 应当是一个**新 Plugin**，而不是给 `desktop-session-world` 加一个 scope 参数或一张 scope 注册表；
- **facet 抽象**——两个 facet 类型的 `available | unavailable` 外壳重复是**刻意接受**的。用泛型 `Facet<T>` 消除它需要先说明两个 observation 之间的关系，而它们在本层**没有**关系；
- 完整 Skill / Tool 体系；
- 音视频流式资源框架；
- 旧 Hikari 大规模迁移。

这些问题继续服从冻结规则：没有真实实现问题，不提前增加抽象。

---

## 第二阶段的收尾项

Phase 2 已完成最终验收并正式收口，**没有未结项**：

```text
P2-01 ~ P2-04 共 4 个提交全部已 push
  194987c  feat: 完成 P2-01 连续性 v1
  e430358  feat: 完成 P2-02 事实史 v1
  86aa3fc  feat: 完成 P2-03 启动入口
  58bb596  test: 完成 P2-04 生命周期验收
收口时 origin/main = 58bb596
CI（.github/workflows/runtime-tests.yml）: success，run 34955475103
```

（`origin/main` 此后已随 P3-01 / P3-02 前进到 `9495f7c`——见「第三阶段的收尾项」。）

第二阶段**不新增架构地图**，这是决定而非未结项：第二阶段没有新增生产结构（P2-04 的 `src/` 零改动），因果与边界已保存在各阶段实现文档与架构评审中，此时建图只复述已有文字。

以及一条随第二阶段进入下一阶段的**已记录格式限制**：

```text
Chronicle v1 无完整性标记
→ 「fact 行被删光、header 完好」与「全新 store」结构上不可区分
→ 该形状的损坏会被报告成空历史而非失败
→ 要分辨它必须改格式，属于新工作，不属于当前已批准范围
```

P2-01 刻意只覆盖了「身份是谁」这一条最小生命线，P2-02 刻意只覆盖了「发生过什么」这一条最小事实史，P2-03 刻意只覆盖了「怎么把它们组合成一次真实启动」，P2-04 刻意只覆盖了「一次全新的 Runtime 生命周期能不能恢复出同一个主体与同一条事实」。任何超出它们的扩展——多主体、身份迁移、设备绑定、Memory、事实的修改与检索、Event 自动落库、常驻运行、多节点——都不属于当前已批准范围。

优先目标应该是：

> 继续用真实 Hikari 需求检验这套基础，而不是从纯理论中扩展 Runtime、Continuity 或 Chronicle。

---

## 第三阶段的收尾项

P3-01 已完成、已提交、已 push，**没有未结项**：

```text
3d910ee  feat: 完成 P3-01 Windows 前台感知
CI（.github/workflows/runtime-tests.yml）: success，run 35053737581
```

P3-02 已完成、已提交、已 push，**没有未结项**：

```text
9495f7c  feat: 完成 P3-02 Windows 输入活动感知
origin/main = 9495f7c（当前 HEAD）
CI（.github/workflows/runtime-tests.yml）: success，run 35200893510
```

P3-03 已完成、已提交、已 push，**没有未结项**：

```text
a4f5c94  feat: 完成 P3-03 桌面会话 World v1
origin/main = a4f5c94（已比对确认与本地 HEAD 逐字符相同）
CI（.github/workflows/runtime-tests.yml）: success，154 tests / 149 pass / 5 skipped / 0 fail
```

P3-04 已完成本地验收、写好评审文档并通过收口评审，**尚未提交、尚未 push**：

```text
待提交：6 个新增文件
  （4 个 src/desktop-session-awareness + 1 个 test + 1 个 docs）
  另修改 docs/development/current-stage.md
  以及 docs/development/phase-3-desktop-session-awareness.md（3 处最小事实修正）
CI 尚未跑过本阶段的测试
```

**CI 与本机测试数会不同，这是预期而非异常**：CI 运行在 `ubuntu-latest`，五条 Windows 真实 smoke 测试会自我 skip（P3-01 的 2 条 + P3-02 的 3 条）。下面每一个数字都**已由 CI 或本机实际跑过并确认**，没有预期值：

```text
CI（ubuntu-latest，P3-02，run 35200893510）:  137 tests / 132 pass / 5 skipped / 0 fail
CI（ubuntu-latest，P3-03）:                  154 tests / 149 pass / 5 skipped / 0 fail
本机（Windows 11，P3-02）:                   137 pass / 0 skipped
本机（Windows 11，P3-03）:                   154 pass / 0 skipped
本机（Windows 11，P3-04）:                   176 pass / 0 skipped
```

P3-04 在 CI 上的**预期**值为 **171 pass / 5 skipped / 0 fail**（总数 176，仍是同样 5 条 Windows smoke 自我 skip）。该数字是**预期值**——本轮未 push，尚未由 CI 实际跑过，不得当作已确认值引用。

有一条**随第三阶段进入下一阶段**的实现限制：**PowerShell 异步子进程 v1 的单次观测成本为 370–674 ms**（P3-01 实测 370–455 ms，P3-02 实测 523 ms，P3-03 同轮单独实测 638 / 674 ms）。它决定了两条感知目前都只能被显式调用，**不能作为高频采样源**。任何高频感知需求都必须先解决这个成本，而优化本身属于新工作。

P3-03 给出了这条限制在组合层的第一个真实数据点：World 在**同一个同步段**内并发启动两次获取，一次组合 snapshot 实测 **386 ms**，而同轮两个感知各自单独运行是 638 / 674 ms——串行应在 1300ms 量级。**并发让组合的墙钟约等于较慢的那个 source，但系统总开销仍是两个子进程**：World 没有让感知变快，只是没有让它更慢。

以及三条**随 P3-03 进入下一阶段**的评审注意事项：

```text
1. 一次性探针的证据等级（累计）
   P3-01 的 66 条 + P3-02 的 142 条断言都是会话内一次性探针
   P3-03 的判别力探针（4 行变异的结果）同样是会话内一次性
   不在仓库内、不进 CI、不可复现
   → 证明「当时确实验过」，不证明「以后不会被改坏」

2. 「测试通过」不等于「测试有判别力」
   P3-03 的 snapshotAt 测试初版几乎没有判别力：
   整个 snapshot 在远小于 1 毫秒内跑完，两处时间戳落在同一毫秒，
   原 >= 断言在正确实现与错误实现下都成立
   → 改为等待时钟本身跨过毫秒边界后才真正生效
   → 凡断言「A 发生在 B 之后」而 A、B 都很快，都应警惕这一类失效

3. parser coverage gap 仍涉及两个模块（本轮未加剧）
   windows.ts 的 parser rejection branches 不在 npm test 内
   P3-03 没有加剧它：World 没有 parser、没有平台分支、没有内部 seam，
   其全部分支都在仓库测试覆盖内，也没有新增第二处具名内部 import
   结论仍是不为测试覆盖扩大 public API、不改 seam
   若出现第三个同型 parser，应重新评估 test seam 与 transport seam
```

以及四条**随 P3-04 进入下一阶段**的评审注意事项：

```text
1. 一次性探针的证据等级（累计，本轮新增一条反例）
   P3-01 的 66 条 + P3-02 的 142 条断言是会话内一次性探针
   P3-03 / P3-04 的判别力探针同样是会话内一次性
   不在仓库内、不进 CI、不可复现
   → 证明「当时确实验过」，不证明「以后不会被改坏」

   本轮新增的反例不是「探针无用」，而是【探针会把自己读错】：
   P3-04 第一版探针三次变异全报 MISSED 且零失败，原因是
   用行首锚点 ^✖ 匹配 Node reporter 输出，而 ✖ 前带 ANSI 色码，
   脚本把「有失败」读成了「无失败」。
   → 一个会把自己读错的探针比没有探针更危险：
     它既给假警报，也给假安心。
   → 凡探针报「全部 MISSED」，应先怀疑探针，再怀疑测试
     （这是 P3-03「先怀疑变异，再怀疑测试」的同型镜像）

2. 并发语义不是保证，已知限制
   v1 不保证 concurrent awareness.current() 的
   invocation-order baseline：baseline 按【成功 World acquisition
   的完成顺序】前进，不按调用发起顺序。
   单个 assessment 不受影响（每次调用自身完整、自洽、可引用），
   受影响的只是「哪两次读数被拿来配对」。
   v1 明确【不】增加 mutex / queue / serialization。
   → 若将来出现需要「第 N 次与第 N-1 次配对」的调用方，
     那应是一次独立的语义变更，而不是在本层顺手加锁。

3. detect_changes 在未跟踪文件上不可用（本轮为收口纪律的直接后果）
   P3-04 收口轮按纪律不 stage，全部产物是未跟踪文件，
   detect_changes 读的 git diff 按定义看不见它们，返回 0。
   【重建索引后重测仍是 0】，证明与索引新鲜度无关。
   → 这个 0 必须读作「未看见」，不是「无影响」，不得当 clean 用。
   → 另：staleness.commitsBehind 在本轮被证伪 ——
     重建索引后 meta.json 的 lastCommit 与 HEAD 逐字符相同，
     该字段仍报 commitsBehind: 4（疑似进程启动时缓存、之后不重读）。
     判定索引新鲜度只能靠 meta.json 与 git rev-parse HEAD 直接比对。

4. parser coverage gap 仍涉及两个模块（本轮未加剧）
   windows.ts 的 parser rejection branches 不在 npm test 内
   P3-04 没有加剧它：无 parser、无平台分支、无子进程、无内部 seam，
   其全部分支都在仓库测试覆盖内，也没有新增第二处具名内部 import
   结论仍是不为测试覆盖扩大 public API、不改 seam
   若出现第三个同型 parser，应重新评估 test seam 与 transport seam
```

P3-01 / P3-02 / P3-03 / P3-04 各自只覆盖一条最小线——「此刻人正在看什么」、「系统记录的最后一次输入发生在哪个 tick」、「在这个 scope 内我现在掌握了哪些事实」、「这些事实之间有没有差别」——且始终**只交付 witness / composer / comparator，不交付 interpreter**：它们不判断什么重要、什么正常、什么值得记住。任何超出它们的扩展——语义解读、跨 source 推断、过滤、后台化、持久化、非 Windows 实现、通用 Perception 框架、`GlobalWorldState`、通用 Comparison 框架——都不属于当前已批准范围。

**P3-05 尚未冻结**，本轮不对它做任何命名或规划。

有一条由 P3-04 产生、应作为下一阶段输入的观察，此处只记录、不规划：

> Awareness 是第一个消费 World 的模块。若将来出现**第二个 World 消费者**，或出现需要**跨快照历史**判断的需求（例如「A → B → A 算不算回到原状」），则「Awareness 是否该有历史窗口」必须作为一次**独立的设计决定**被提出，而不是搭在某个消费者身上顺手长出来。现在样本仍然只有一例，因此**不提前抽象**。

第三阶段的优先目标与第二阶段一致：

> 继续用真实 Hikari 需求检验这套基础，而不是从纯理论中扩展 Runtime、Perception、World 或 Awareness。

---

## 开发纪律

继续遵循：

```text
Boundary Review
↓
实现 + 测试
↓
Architecture Review
↓
文档 / 契约更新
```

如果真实实现暴露当前边界不成立，不允许用隐藏依赖或临时特例绕过，应暂停实现并重新审查架构。

> 当前策略：让真实代码继续反过来教育架构。
