# Hikari 第二阶段 P2-02 Chronicle v1 Architecture Review

> 结论：**Functional PASS + Architecture PASS**
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体的事实史。
>
> 本文只评审 P2-02。第二阶段整体尚未收口——P2-03 / P2-04 未完成，各自需要单独的 Boundary Review 与 Architecture Review。
>
> 上位原则：`core-architecture-v0.md` §12.10「Chronicle 共享事实，但不共享控制」。本轮没有新增第二套架构原则。

## 1. Functional Review

当前实现已经验证：

- 空目录可以显式创建一个 Header-only 的 Chronicle Store，Header 的 `owner` 为当前主体；
- 已有合法 Store 时拒绝再次创建，且不修改原文件字节；
- 已损坏 / 版本不支持的 Store 会拒绝创建，且不覆盖；
- Store 不存在时 `open` 给出明确的 `NotInitialized`，且不创建任何东西；
- `owner` 不匹配给出 `OwnerMismatch`；
- 版本不支持给出 `UnsupportedVersion`；
- Header 或任意一条 Fact 损坏给出 `InvalidChronicleStore`；
- 最后一行没有完整换行给出 `InvalidChronicleStore`；
- 重复 `factId` 给出 `InvalidChronicleStore`；
- `initialize` 成功后 `open` 可以挂载出可用的 Service；
- `append` 返回并持久化一条由 Chronicle 生成 `factId` / `recordedAt` 的合法 `DurableFact`；
- `read` 按 append 顺序返回，`get` 命中 / 未命中（未命中返回 `undefined`）；
- 非 JSON-native 的 payload 与非法 draft 被拒绝；
- 持久化失败报 `PersistenceError` 且不报告成功；该错误只表示**本次写入未获得可靠持久化确认**，**不**保证事实未落盘（见 §20）；
- Continuity active + Chronicle 正常 → Plugin `active`；
- Continuity 不存在 → Plugin `waiting`；
- Continuity 正常但 Chronicle 不存在 → Plugin `failed`，且不创建 Store；
- 全新 Runtime 生命周期可以读回上一个 Runtime 写下的事实。

本地测试：**56 / 56 PASS**（33 个 Chronicle + 17 个 Continuity + 6 个原有 Runtime）。

**Functional PASS。**

## 2. src/runtime 未修改

`git diff --stat -- src/runtime/` 为空，逐字节未修改。

Chronicle 只依赖 Runtime 的公开表面：

- `runtime/contracts.ts` 的 `defineService`；
- `runtime/plugin.ts` 的 `PluginDefinition`（仅类型导入）。

没有导入 `runtime.ts`、`service-registry.ts`、`event-bus.ts`、`effect-scope.ts`，也没有为 Chronicle 增加任何钩子、分支或特例。

**PASS。**

## 3. Continuity 未修改为依赖 Chronicle

`src/continuity/` 中检索 `chronicle`，**零命中**。Continuity 的 diff 为空，逐字节未修改。

依赖方向是单向的：Chronicle → Continuity，反向不存在任何边。测试对此有直接断言——移除 Chronicle 后 Continuity 的行为与字节完全不变。

**PASS。**

## 4. Chronicle 只依赖 Continuity 公共契约

Chronicle 从 Continuity 只取两样东西：

- `continuity/contracts.ts` 的 `continuityService`（服务标识）；
- `continuity/types.ts` 的 `HikariIdentity`（仅类型导入）。

没有导入 `continuity/origin-record.ts`、`continuity/storage.ts`、`continuity/restore.ts`、`continuity/initialize.ts`。

因此 Chronicle 只知道「当前主体的 `hikariId` 是什么」，不知道身份是怎么被创建、校验和持久化的，也没有复用 Continuity 的存储层。`OriginRecordV1` 对 Chronicle 完全不可见。

**PASS。**

## 5. Chronicle 不是 Runtime Core

Chronicle 与 Continuity 同级，位于 `src/chronicle/`，从独立入口 `dist/chronicle/index.js` 导入。包根 `src/index.ts` 的 diff 为空。

在 `src/runtime/` 与 `src/index.ts` 中检索 `chronicle` / `hikari` / `continuity` / `identity`，**零命中**。Runtime 依然不知道「Chronicle」这个词。

Chronicle 也不是所有 Plugin 的强制依赖：只有显式声明 `requires: [chronicle@1]` 的消费者才会等待它。

**PASS。**

## 6. Plugin 不自动创建 Chronicle

`src/chronicle/plugin.ts` 中检索 `initialize`，**零命中**——该文件不导入 `initialize.js`，因此在结构上不具备创建能力，而不只是「被约定不要创建」。

`setup` 只做：读取 `continuity.current` → `openChronicle(...)` → `provide chronicle@1`。

- Continuity 缺失 → `waiting`（连尝试都不会发生）；
- Continuity 正常但 Chronicle 缺失 → `failed`，错误类型为 `ChronicleNotInitializedError`；
- 测试断言此时目录中**没有被创建出任何 Chronicle Store**。

**PASS。**

## 7. openChronicle 零写入

`open.ts` 只有 4 个导入，其中与存储相关的只有一个：

```ts
import { readStoreForOwner } from './store.js';
```

`readStoreForOwner` 是纯读取路径（`readFileSync`），不导入 `write` / `rename` / `mkdir` / `append` 能力。

需要如实说明的一点：`open.ts` 同时导入了 `createChronicleService`，而 `service.ts` 确实导入了写入函数 `appendStoreLine`。因此「零写入」不能像 Continuity 的 `restore.ts` 那样仅凭导入列表证明，必须看调用路径：

- `createChronicleService` 只构造并返回一个 frozen 对象，**自身不执行任何 I/O**；
- `appendStoreLine` 在整个仓库中只被 `service.ts` 导入，且只在调用方显式调用 `service.append()` 时才执行；
- `openChronicle` 的函数体只有两步：`readStoreForOwner(...)`（读）+ `createChronicleService(options)`（构造）。

因此「打开」这个动作本身不产生任何字节。测试断言了 `openChronicle` 前后目录清单与文件字节完全一致。

残留 `.tmp` 对 `open` 也是惰性的：`open` 只读精确路径 `chronicle/chronicle.jsonl`，不扫描目录，因此残留临时文件既不影响打开，也不会被当作 Store——这一点由测试覆盖。

**PASS（证据来自调用路径，而非仅导入图）。**

## 8. initialize / open 完全分离

两者是两个独立模块、两套独立错误面：

- `initialize.ts` 返回 `void`，且从不调用 `openChronicle`；
- `open.ts` 不具备任何创建能力。

在 `src/chronicle/` 中检索 `getOrCreate` / `openOrCreate`，**零命中**。

`initializeChronicle` 返回 `void` 是刻意的：它不返回 Header（持久化格式不外泄），也不返回 Service，因此调用方无法把「创建」的结果直接当成「打开」来用——两个动作在返回值上就无法收口成一个。

**PASS。**

## 9. owner 只存在 Store Header

`owner` 只出现在 `ChronicleStoreHeaderV1` 中，作为**整个 Chronicle Store 的主体绑定**。

- `FactDraft` / `DurableFact` 的字段集合里没有 `owner`，也没有 `hikariId`；
- Header 不记录 `createdAt`：Chronicle v1 不解释「这个 Store 从何时开始存在」；
- `open` 校验 Header 的 `owner` 与当前 `hikariId` 一致，不一致即 `OwnerMismatch`。

**PASS。**

## 10. Fact 不重复 hikariId

`FACT_FIELDS` 精确等于：

```text
factId  type  version  occurredAt  recordedAt  source  payload
```

不含 `hikariId`，也不含 `owner`。测试断言了在 draft 中传入 `hikariId` 会被当作**未知字段**拒绝。

主体归属是 Store 级别的属性，不逐条重复写在每个事实里。

**PASS。**

## 11. Fact type 不需要注册

`type` 只是一个非空字符串。`src/chronicle/` 中没有类型注册表、没有类型枚举、没有允许列表。

测试直接断言：**未知 `type` 不是错误**，可以正常 `append` 并读回。

Chronicle 不拥有业务 Fact 类型注册表——那会立刻把 Chronicle 变成所有领域的中央模式权威，正是本轮要避免的 Core 化。

**PASS。**

## 12. Event 不自动转 Fact

在 `src/chronicle/` 中检索 `events` / `emit` / `publish` / `subscribe`，**零命中**。

Chronicle 不订阅任何 Event，也没有任何「Event 落库」的通路。一条事实进入 Chronicle 的唯一方式是调用方显式调用 `append()`。

`Event` 与 `DurableFact` 之间在代码中不存在任何边。

**PASS。**

## 13. Chronicle 不决定「什么值得记录」

Chronicle 没有：

- 「重要度」「保留策略」「采样」之类的字段或判断；
- 自动筛选、自动聚合、自动摘要；
- 对 `type` 的语义解释；
- 任何隐式的写入触发点。

`append(draft)` 是唯一入口，写什么完全由调用方决定。Chronicle 只回答「这条已经发生的事实能不能被可靠地记下来」，不回答「它值不值得记」。

**PASS。**

## 14. Chronicle 不拥有 Memory / World / Goal / Action

在 `src/chronicle/` 中检索 `memory` / `world` / `goal` / `action`，**零命中**。

Chronicle 只提供「追加 + 按 id 取 + 全量读」这一组事实史能力，不对外提供任何领域的读模型、快照或当前状态查询。

**PASS。**

## 15. 不承担其他领域状态恢复

Chronicle 的恢复语义只有一条：**打开自己的 Store 并验证它**。

它不恢复 Memory、不恢复 World、不恢复 Goal、不恢复 Action，也不恢复 Continuity 的身份——`initializeChronicle` / `openChronicle` 都要求调用方传入**已经确认的** `HikariIdentity`，Chronicle 自己不去读 `continuity/origin.json`。

**PASS。**

## 16. 没有 update / delete / query DSL

Service 契约只有三个方法：

```ts
append(draft: FactDraft): Promise<DurableFact>;
get(factId: string): Promise<DurableFact | undefined>;
read(): Promise<readonly DurableFact[]>;
```

没有 `update`、没有 `delete`、没有过滤器、没有条件查询、没有排序参数、没有全文搜索、没有向量搜索。

`read()` 是「按 append 顺序全量返回」，`get()` 是「按精确 id 取一条」。事实一旦写入即不可变。

> 说明：在 `src/chronicle/` 中检索 `delete` 会命中 `fact.ts` 的两处 `seen.delete(value)`。这是循环引用检测时对 `Set<object>` 的记账操作，不是数据删除能力。

**PASS。**

## 17. 没有通用 Persistence 抽象

没有 `Repository`、没有 `Adapter`、没有 `Manager`、没有 `Store<T>` 泛型接口、没有序列化策略层。

`src/chronicle/` 中检索 `Manager` / `Repository` / `Adapter` / `WriteQueue` / `AsyncMutex`，**零命中**。

存储就是 `store.ts` 里的一组具体函数，服务于 `chronicle.jsonl` 这一种具体格式。没有为「将来可能换存储」而预留的间接层——那属于没有真实需求就提前抽象。

**PASS。**

## 18. 没有自动 repair / truncate

在 `src/chronicle/` 中检索 `repair` / `truncate` / `migrat` / `compact`，**零命中**。

具体行为：

- 文件最后一行没有完整 `\n` → `InvalidChronicleStoreError`，**不截断**；
- 任意一条 Fact 损坏 → `InvalidChronicleStoreError`，**不跳过、不修补**；
- Store 已损坏时 `append` 先重新验证，因此**拒绝向坏尾巴继续追加**；
- 重命名失败 → `ChronicleAmbiguousStateError`，**不重试**（重试属于自动修复）；
- Header 版本不支持 → `UnsupportedChronicleVersionError`，**不迁移**。

损坏一律向外报错，交由调用方决定怎么处理。

**PASS。**

## 19. 没有跨进程锁或分布式机制

在 `src/chronicle/` 中检索 `lock` / `lease`，**零命中**。没有网络、IPC、租约、选举或共识。

跨进程并发不做处理，这是 v1 的有意边界。

单进程内因为 `append` 的「重新验证 Store」与「追加写入」之间没有 `await` 交错（内部全部使用同步 I/O），检查与写入天然原子——这也是 Service 对外保持异步契约、内部却不需要 `AsyncMutex` / `WriteQueue` 的原因。

**PASS。**

## 20. 当前刻意保留的限制

以下是本阶段的有意限制，不作为缺陷提前抽象：

- 单进程内不使用异步 I/O，因此 `append` 会同步阻塞调用线程（事实史写入频率低，v1 接受）；
- 跨进程并发不做处理；
- 目录未做 `fsync`（Windows 不支持），断电场景下重命名的持久化存在理论窗口；
- 重命名失败不做重试；
- 只支持 `version: 1`，没有多版本共存或迁移路径；
- 未知多余字段被拒绝，格式漂移需要显式改版本；
- 事实一旦写入不可修改、不可删除，写错的事实只能靠新事实覆盖语义；
- `read()` 全量读取整个 Store，没有分页、没有索引，事实量增大后需要重新做 Boundary Review；
- JSONL 文本容错 `\r`（`JSON.parse` 容忍行尾的 `\r`），没有额外拒绝 CRLF——本机 Windows 环境下这避免了一类无谓失败，代价是 CRLF 与 LF 在 v1 中被视为等价；
- `owner` 只做非空字符串校验，不复验 UUID 形状（UUID 语义属于 Continuity）；
- `ChroniclePersistenceError` 只表示「本次写入未获得可靠持久化确认」，**不**保证目标 Fact 未落盘——调用方不得仅凭该错误判定事实不存在，也**不得**据此假定重试是安全的；错误消息为 `Chronicle fact was not confirmed as persisted: <reason>`，措辞与语义对齐；
- 写入失败后的重试幂等语义（去重、幂等键、补偿读取、自动重试）**不属于 P2-02**：Chronicle v1 一个都不提供，这是刻意留给调用方的责任；
- 上述失败语义是**声明**而非**断言**：「已落盘但未确认」只在失败发生于写入之后时出现，本地无法确定性构造，测试只覆盖「打开即失败」这一种。

这些限制只有在真实需求被阻塞时才触发新的 Boundary Review。

## 21. 图谱变更验证

在 `git add` 本阶段文件之后，重新执行了图谱变更分析。**本次输出实际覆盖了 Chronicle 新文件**，因此可以作为图谱侧证据使用。

```text
Changes:        14 files, 205 symbols
Affected:       46 execution flows
Risk level:     critical
partial:        无
truncated:      无
```

`risk_level` 为 **critical**，未做降级处理。其构成已定位：

- 205 个变更符号中，**57 个是文档标题**（GitNexus 把 Markdown 标题也索引为 `Section` 符号）：架构评审 25、实现文档 23、阶段说明 9；
- 其余 **148 个为代码符号**，全部位于 `src/chronicle/` 与 `test/chronicle.test.mjs`；
- **变更集中没有任何一个符号位于 `src/runtime/`、`src/continuity/` 或 `src/index.ts`**（已按文件路径逐一核对，结果为 0）；
- 46 条受影响执行流**全部**是 Chronicle 自身的流程，共 11 个根：`Append`、`Get`、`Read`、`Setup`、`InitializeChronicle`、`ParseFactLine`、`InspectFactDraft`、`RebuildJsonValue`、`ReadSource`、`AppendStoreLine`、`WriteStoreAtomically`；
- **没有任何 Runtime 或 Continuity 执行流受影响。**

即：本次变更对既有代码是纯增量，critical 由「变更体量 + 文档标题计入符号」共同推高，而非由对既有结构的破坏推高。这是对风险来源的判断，不是对告警的豁免——工具本身没有给出 low。

### 依赖方向的图侧确认

从图谱问「谁依赖 Chronicle」，只返回两类边：

```text
src              CONTAINS  src/chronicle
test             CONTAINS  test/chronicle.test.mjs
```

Chronicle 向外的 IMPORTS 边只有 6 条，全部指向 Runtime 或 Continuity 的公开表面：

```text
chronicle/contracts.ts   → runtime/contracts.ts
chronicle/plugin.ts      → runtime/plugin.ts
chronicle/plugin.ts      → continuity/contracts.ts
chronicle/initialize.ts  → continuity/types.ts
chronicle/open.ts        → continuity/types.ts
chronicle/service.ts     → continuity/types.ts
```

反向查询（`src/runtime/`、`src/continuity/` 是否导入 Chronicle）返回空。

### 工具限制（如实记录）

- **索引中的一处假阳性**：符号级查询会返回 `test/runtime.test.mjs ACCESSES test/chronicle.test.mjs` 三条边。但 `test/runtime.test.mjs` 中检索 `chronicle` 的实际命中数为 **0**——该文件从不引用 Chronicle。这是索引器在共享模块解析上的产物，**不是真实依赖**。此处记录以免后续被误当作耦合证据。
- **受影响流程是下界，不是全集**：本次分析器自报 `71 flows reported, but whole flows are MISSING: 24 ranked entry point(s) never traced, 7 deduplicated flow(s) dropped at maxProcesses, 58 callee(s) skipped at maxBranching, 1 walk(s) cut by the per-entry trace budget`。因此 §21 列出的 46 条流程只应读作「至少这些」，**不构成「仅这些受影响」的证明**。变更符号集本身没有 truncation 标记，且其中不含任何 Runtime / Continuity 文件。
- **`query()` 的关键词与语义检索仍不可用**：FTS 扩展在本机加载失败；本次重建使用 `GITNEXUS_FTS_CJK_SEGMENTATION=bigram` 规避 CJK 分词不匹配。图遍历能力（`context` / `cypher` / `impact` / `trace` / `detect_changes`）不受影响。
- 索引跳过了 1 个超过 512KB 的文件（`docs/diagrams/phase-1-runtime.html`），它是生成物，不属于本阶段变更。
- 本次证据由**两个前置条件共同成立**才取得：索引重建（使 Chronicle 符号进入图谱）+ `git add`（使新文件进入 diff）。缺少前者，符号无从映射；缺少后者，未跟踪文件不在 diff 中。

## 22. 最终结论

图谱**没有发现** P2-02 对既有 Runtime / Continuity 产生任何结构性侵入，也没有发现对 `core-architecture-v0.md` 的结构性穿透。

但必须连着 §21 已记录的不完备性一起读：索引存在一处假阳性，分析器自报流程分析未穷尽，`query()` 的关键词与语义检索不可用。因此这个结论的准确读法始终是「**未发现**侵入」，而**不是**「**已证明不存在**侵入」——前者是本次分析的输出，后者超出本次分析的能力。

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

因此 **P2-02 Chronicle v1** 可以正式收口。

第二阶段整体**不能**据此收口：P2-03 启动入口 / P2-04 生命周期验收未完成，本文的结论不覆盖它们。

> P2-02 已经证明：一个 Hikari 可以把真实发生过的事实追加进自己的事实史并在全新的 Runtime 生命周期中读回，而 Runtime 与 Continuity 都不需要知道「Chronicle」这个词；同时 Chronicle 也没有长成第二个中央大脑——它共享事实，但不共享控制。
