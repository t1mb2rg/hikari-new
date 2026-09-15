# Hikari 当前阶段开发说明

> 状态：**Phase 2 已完成本地最终验收并正式收口**（P2-01 ~ P2-04 全部通过 Functional / Architecture Review）；远端 CI 验证仍待 push 后执行
>
> 长期原则以 `docs/architecture/principles.md` 为准；v0 架构边界以 `docs/architecture/core-architecture-v0.md` 为准；第一阶段实现与复盘见 `docs/development/phase-1-runtime.md` 与 `docs/architecture/phase-1-architecture-review.md`；第二阶段 P2-01 实现与复盘见 `docs/development/phase-2-continuity.md` 与 `docs/architecture/phase-2-continuity-architecture-review.md`；P2-02 实现与复盘见 `docs/development/phase-2-chronicle.md` 与 `docs/architecture/phase-2-chronicle-architecture-review.md`；P2-03 实现与复盘见 `docs/development/phase-2-cli.md` 与 `docs/architecture/phase-2-cli-architecture-review.md`；P2-04 实现与复盘见 `docs/development/phase-2-lifecycle.md` 与 `docs/architecture/phase-2-final-architecture-review.md`。

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

第二阶段四项验收全部达到阶段标准，**Phase 2 已完成本地最终验收并正式收口**。

收口后仍有一个未结项：全部工作**尚未 push**（P2-01 / P2-02 / P2-03 已本地提交，P2-04 共 4 个文件待提交），因此**远端 CI 从未跑过这批测试**。

**第二阶段不新增架构地图（已决定，非未结项）**：第一阶段的图存在，是因为那一步要固定「Runtime 不带领域语义」这条边界本身；第二阶段的产物是接线与验收——P2-01 / P2-02 / P2-03 的因果与边界已由各自的实现文档与架构评审完整保存，P2-04 **没有新增任何生产结构**。此时硬画一张图只会复述已有文字，不增加信息，因此**不以架构图作为第二阶段收口条件**。后续若出现真实的结构变化，再按那时的需要决定是否建图。

另有一条已记录的格式限制随第二阶段进入下一阶段：**Chronicle v1 没有完整性标记**，因此「fact 行被删光、header 完好」的 store 与全新 store 在结构上无法区分，会被报告成空历史。它不影响关闭判断，但是任何后续 Chronicle 完整性工作的明确输入（详见 P2-04 实现文档 §9 与架构评审 §11）。

两阶段都没有迁移旧 Hikari，也没有实现完整 Awareness、Memory、Goal、Chronicle 或多节点系统。

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

P2-01 尚未在 CI 上验证（尚未推送）。

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

P2-02 尚未在 CI 上验证（尚未推送）。

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

P2-03 尚未在 CI 上验证（尚未推送）。

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

P2-04 尚未在 CI 上验证（全部工作尚未推送）。

本机图谱工具限制：**图谱不解析 `.mjs` 的 IMPORTS 边**（全图 89 条 import 边全部来自 TypeScript scope），因此针对测试文件的导入查询返回空——这个空结果不是「没有依赖」的证据，本轮该结论改用文本检索获得；分析器自报流程分析未穷尽（29 个入口未追踪、74 个 callee 因 maxBranching 跳过、4 条 walk 被预算截断），因此受影响流程数只应读作下界；跨语言字段解析不完整（113 处），`.code` / `.stdout` / `.stderr` 等字段的引用查询会返回空结果，空不等于无人使用。`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

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

---

## 当前明确仍不做

- 跨 Runtime 通信；
- 节点网络协议；
- 远程 Provider；
- Capability 第二注册表；
- Provider 智能选择；
- 全局状态中心；
- 完整权限系统；
- Memory / World / Goal 的领域实现；
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
- 完整 Skill / Tool 体系；
- 音视频流式资源框架；
- 旧 Hikari 大规模迁移。

这些问题继续服从冻结规则：没有真实实现问题，不提前增加抽象。

---

## 第二阶段的收尾项

Phase 2 已完成本地最终验收并正式收口。收口后仍有一个未结项：

```text
全部工作尚未 push
P2-01 / P2-02 / P2-03 已本地提交（194987c / e430358 / 86aa3fc）
P2-04 共 4 个文件待提交
origin/main 停在 b4e588b，因此远端 CI 从未跑过这批测试
```

第二阶段**不新增架构地图**，这是决定而非未结项：第二阶段没有新增生产结构（P2-04 的 `src/` 零改动），因果与边界已保存在各阶段实现文档与架构评审中，此时建图只复述已有文字。远端 CI（`.github/workflows/runtime-tests.yml`，push 到 main 时执行 `npm test`）将在 push 后复核整套测试。

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
