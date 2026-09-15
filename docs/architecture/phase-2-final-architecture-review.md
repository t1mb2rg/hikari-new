# Hikari 第二阶段 P2-04 生命周期验收 Architecture Review

> 结论：**Phase 2 Final Architecture Review: PASS**（P2-04 Functional PASS + Architecture PASS）
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体的跨 Runtime 生命周期验收。
>
> 本文评审 P2-04，并给出**第二阶段整体关闭条件**的评估（§14）。第二阶段已完成本地最终验收并正式收口。
>
> 上位原则：`core-architecture-v0.md` §12.2「Runtime 负责机制，不理解领域意义」。本轮没有新增第二套架构原则。

## 1. Functional Review

当前实现已经验证：

- Runtime A 通过依赖图恢复主体、挂载事实史、追加 Fact A，随后 shutdown；
- 一个全新的 Runtime B 通过同一条依赖图恢复**同一个** Hikari，并读回**同一条** Fact A；
- `DurableFact` 的 7 个字段跨 Runtime 逐一相同；
- Runtime A 的 shutdown 不删除、不修改 Origin 与 Chronicle；
- Runtime B 的纯恢复在整棵文件树上 byte-for-byte identical，且文件集合精确等于两个领域文件；
- Runtime A / B 不共享 Runtime、Context、Plugin、Service 或 identity 对象实例；
- 新 Runtime 读的是磁盘而不是上一个 Runtime 的内存（事实内容被改写后读到改写值，磁盘被改坏时直接失败）；
- 7 种可检测的 Chronicle 损坏全部诚实失败，不创建、不修复、不截断、不重写；
- store / origin 被删除后不会被重新创建，损坏后不会被修复；
- 真实 CLI 二进制创建的数据能被 Runtime 生命周期恢复。

本地测试：**98 / 98 PASS**（16 个 P2-04 + 26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

**Functional PASS。**

有一项**必须与结论同时阅读**的限制，见 §11：Chronicle v1 的存储格式没有完整性标记，因此「所有 fact 行被删光、header 完好」这一种形状的损坏不可检测，会被报告成空历史。它不是实现缺陷，是 P2-02 冻结格式时就存在的事实，本轮第一次把它测出来并写成 `documented limit` 测试。

## 2. src/runtime 未修改

`git diff HEAD --stat -- src/runtime/` 为空，逐字节未修改。

本轮**没有为测试修改 Runtime API**。这是本阶段的一条硬约束，因为 Runtime 至今没有公共 Service 读取接口，而 Probe 需要拿到 Service。被拒绝的两条捷径是：

```text
给 Runtime 加 getService() / getServices()      ← 修改已冻结的公开表面
让 Runtime 暴露内部 ServiceRegistry             ← 穿透封装
```

实际采用的是第三条路径：Probe 是普通 Plugin，通过**普通 Plugin Context**（`context.services.get`）拿它有资格拿的 Service，再用测试闭包交给测试代码。Runtime 因此一行未改，而且 Probe 拿到的东西与任何真实 Plugin 拿到的东西没有区别。

**PASS。**

## 3. src/continuity 未修改

`git diff HEAD --stat -- src/continuity/` 为空，逐字节未修改。

验收中对 Continuity 的使用只有公开入口：`initializeHikari()`（建档）、`restoreHikari()`（**仅用于独立计算期望值**，不在观测路径上）。观测路径上的 identity 全部来自 `runtime.loadPlugin(continuityPlugin)` 之后的 `continuity.current@1`。

Continuity 不知道 Chronicle 存在，也不知道本阶段存在。

**PASS。**

## 4. src/chronicle 未修改

`git diff HEAD --stat -- src/chronicle/` 为空，逐字节未修改。

验收中对 Chronicle 的使用只有公开入口：`initializeChronicle()`（建档，与 CLI `chronicle init` 同一条路径）。读取与写入全部经 `chronicle@1` Service 完成，即先经过 Chronicle Plugin 在 Runtime 中的 `setup`。

**PASS。**

## 5. src/cli 未修改

`git diff HEAD --stat -- src/cli/` 为空，逐字节未修改。

CLI 在本轮只被当作**被测对象的一部分**：测试用 `spawnSync` 拉起真实 `dist/cli/main.js` 创建数据，再用 Runtime 生命周期去恢复同一份数据，最后再跑一次 `hikari start` 确认它仍然 `exit 0` 且字节不变。CLI 本身没有为 P2-04 改动任何一行。

**PASS。**

## 6. 禁止新增的机制：零命中

在 `src/` 与 `test/` 中检索下列标识符，**全部零命中**：

```text
LifecycleManager   RecoveryManager   IdentityManager   HikariCore
ProcessJournal     Resident          Profile           ServiceContainer
ApplicationContext federation       synchronization
```

测试文件里定义的两个 Plugin 都带有明确的测试命名空间，且 `provides` 为空：

```text
test.continuity-observer    requires: continuity.current@1
test.probe                  requires: continuity.current@1 + chronicle@1
```

两者都不提供任何 Service，因此**不可能改变依赖图的形状**——它们只能观察，不能影响。

**PASS。**

## 7. Probe 只存在于测试代码

`test/phase-2-lifecycle.test.mjs` 是本轮唯一的代码文件，且是新建文件。`src/` 中检索 `phase-2-lifecycle` 无命中——生产代码不知道验收测试的存在。

测试文件的导入面只有三个公开入口与 Node 内置模块：

```text
../dist/index.js                （Runtime）
../dist/continuity/index.js     （continuityPlugin / continuityService / 领域 API 与错误类型）
../dist/chronicle/index.js      （chroniclePlugin / chronicleService / 领域 API 与错误类型）
node:assert/strict  node:child_process  node:fs  node:os  node:path  node:test
```

**没有任何一条指向内部模块路径**（`dist/runtime/service-registry.js`、`dist/continuity/storage.js`、`dist/chronicle/store.js` 等一律零命中）。

**PASS。**

## 8. 生命周期独立性的证据

独立性不是靠「新建了一个对象」推断的，而是靠三条互相独立的证据：

**证据一（对象同一性）**：Runtime 实例、PluginContext、两个 Service 对象、`HikariIdentity` 对象在两轮之间全部 `!==`。值相同的只有 `hikariId` 与 `createdAt`——即**同一个主体，不是同一个对象**。

**证据二（内容取自磁盘）**：Runtime A 结束、其 Service 对象**仍被测试代码持有**的情况下，把 store 里那条 fact 改写成**另一条仍然合法**的 fact（只动 payload），全新 Runtime B 报出的是**改写后的值**。改写后的值只有磁盘上有——若 B 从内存重建了事实，它只会报出 A 写下的那个值。这条证据把「不是同一个对象」升级为「没有可复用的内存恢复状态」。

**证据二之补充（校验亦取自磁盘）**：同样条件下把 fact 行改**坏**（不再合法），全新 Runtime C 立刻 `failed`，连 Service 都不给出。

**证据三（收敛结论来自 Runtime）**：两轮中 `probe` 与 `continuity-observer` 的最终状态都不是测试设置的，而是依赖图收敛出来的。失败路径上 `probe = waiting` 而 `continuity-observer = active` 这个组合，恰好无法由测试「编排」出来——因为 Probe 没有 `provides`，它无法让任何东西激活。

**证据本身经过变异测试**：向 `dist/chronicle/service.js` 注入模块级共享缓存（精确模拟「跨 Runtime 复用内存恢复状态」，`src/` 未改动、事后已重建恢复）后，**3 个用例失败**。第一次变异只触发 2 个——当时还只有「改坏 store」这一条，而它证明的是「校验读磁盘」，不是「内容读磁盘」，对内存缓存**没有判别力**。补上证据二之后重新变异，判别力才成立。这条发现记录在实现文档 §10。

**PASS。**

## 9. 纯恢复性与诚实失败

**纯恢复性**由整棵文件树快照断言（文件集合 + 每个文件字节），而不是只比对两个已知文件。因此任何残留的 `.tmp`、任何被新建的目录都会被捕获。

已覆盖场景：全空、只有 Continuity、Continuity + Chronicle 完整、7 种 store 损坏、store 缺失、origin 缺失、origin 损坏。全部不变。

**诚实失败**的判据是「错误类型 + 错误原因 + 无副作用」三件套，而不是「返回码非 0」：每一种损坏都断言到具体的领域错误类与具体的原因文本，同时断言文件字节不变、文件集合不变、没有拿到任何 Chronicle Service。

**失败是局部的**：事实史不可用时主体仍然恢复。这条结论只有 `test.continuity-observer`（只 require continuity）能观察到——`test.probe` 在这种情形下根本不会激活。这是本阶段的一个真实设计发现，记录在实现文档 §4。

**PASS。**

## 10. 禁止的语义区分仍然保持

本轮没有让「恢复失败」退化成「创建」：

```text
origin 被删除 → 不重新创建 origin，也不创建 store
store  被删除 → 不重新创建 store
origin 损坏   → 不修复、不重写
store  损坏   → 不修复、不截断、不重写，不新建 .tmp
```

「记录不存在」与「记录读不出来」仍然是两类不同的失败，且都不触发任何写入。

**PASS。**

## 11. 记录的限制：Chronicle v1 无完整性标记

**这一条不构成 PASS 的一部分，是与 PASS 并列的已知边界，必须一起读。**

Chronicle v1 store 的结构是「一行 header + N 行 fact」，没有事实计数、没有链式哈希、没有墓碑。因此：

> **fact 行被删光、header 完好的 store，与 `initializeChronicle()` 刚写出来的 store，在结构上无法区分。**

实测行为：新 Runtime 正常收敛（`chronicle = active`），`read()` 返回 `[]`，文件字节不变。

这意味着要求 8 的「不伪装成空历史」在**这一种形状**上不成立。原因不在 Runtime，也不在 Chronicle 的实现，而在 v1 格式本身不具备分辨能力。要分辨它必须给格式加东西，而本轮明确禁止新增生产领域机制——**因此本阶段不做，也不应做**。

处理方式是：不跳过、不弱化、不假装它不存在，而是写成一个命名为 `documented limit` 的测试，断言**实际行为**（报告空历史）与**实际不发生的事**（Runtime 不写入、不删除、不"修复"）。

它是 P2-02 冻结格式时的既有事实，P2-04 的贡献是**把它第一次暴露成一个可执行的断言**。

## 12. 图谱变更验证

在 `git add` 本阶段文件之后执行图谱变更分析。

**第一次运行返回 `changed_count: 0` / `risk: low`，但 `changed_files: 1`。** 这是索引滞后：新文件从未被索引过，没有符号可供 diff 映射。按 CLAUDE.md 重建索引（`analyze --index-only`）后重跑，得到：

```text
Changes:        4 files, 113 symbols
Affected:       0 execution flows
Risk level:     low
partial:        无
truncated:      无
```

构成（最终一次运行，覆盖本阶段全部 4 个文件）：

```text
test/phase-2-lifecycle.test.mjs                         69     测试代码符号
docs/architecture/phase-2-final-architecture-review.md  17     文档标题符号
docs/development/phase-2-lifecycle.md                   16     文档标题符号
docs/development/current-stage.md                       11     文档标题符号
```

- **没有任何一个符号位于 `src/`**——`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/cli/`、`src/index.ts` 零命中；
- 受影响执行流 **0 条**；
- 风险等级 **low**（本轮没有出现前几阶段的 critical，因为没有新增生产模块；P2-01/02/03 的 critical 都来自「新增了一整个生产模块」）。

独立的字节级证据：`git diff HEAD --stat -- src/` 输出为**空**。

即：本阶段变更是**纯测试 + 文档增量**，对生产代码零侵入。

需要留意的一次假信号：图内符号总数在重建后由 1,066 增至 1,106（边 2,166 → 2,229，流程 92 → 95），**这个增量本身不是证据**——它来自索引重建覆盖到的文档与测试文件，与「生产代码是否被改动」无关。真正的判据是上面那条 `src/` 零命中和 `git diff` 空输出。

## 13. 工具限制（如实记录）

- **图谱不解析 `.mjs` 的 IMPORTS 边**：全图 89 条 import 边的 `reason` 全部是 `typescript-scope: import`，没有任何一条来自 `.mjs` 测试文件。因此针对 `test/phase-2-lifecycle.test.mjs` 的导入查询返回空，**这个空结果不是「没有依赖」的证据，而是分析器没有建边**。本轮该结论改用文本检索获得（见 §7），不引用图谱的空结果。
- **受影响流程是下界，不是全集**：索引重建时分析器自报 `95 flows reported, but whole flows are MISSING: 29 ranked entry point(s) never traced, 74 callee(s) skipped at maxBranching, 4 walk(s) cut by the per-entry trace budget`。因此「0 条受影响流程」只应读作「本次分析没有发现」，不构成「已证明不存在」。
- **跨语言字段解析不完整**：分析器自报 `113 property read/write site(s)` 因定义锚点在另一种语言而未能链接，受影响字段包含 `code` / `createdAt` / `current` / `factId` / `hikariId` / `kind` / `owner` / `recordedAt` 等。本轮测试是 `.mjs`，其中读取的 `code` / `stdout` / `stderr` 属于这一情形，**针对这些字段的引用查询返回空，而空不等于无人使用**。
- **`query()` 的关键词与语义检索仍不可用**：FTS 扩展在本机加载失败。图遍历能力（`context` / `cypher` / `detect_changes` / `impact`）不受影响。
- **索引跳过了 1 个超过 512KB 的文件**（`docs/diagrams/phase-1-runtime.html`），它是生成物，不属于本阶段变更。
- 本次证据由**两个前置条件共同成立**才取得：索引重建（使新文件符号进入图谱）+ `git add`（使新文件进入 diff）。缺少任一个，`detect_changes` 都会给出误导性的 `0`。

## 14. 最终结论

**Phase 2 Final Architecture Review: PASS**

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

P2-04 三项均满足。逐字节的保证来自 `git diff`（`src/` 零改动），图谱侧结论连同 §13 的不完备性一起读时应表述为「**未发现**侵入」，而**不是**「**已证明不存在**侵入」。

### 第二阶段整体关闭条件

| 阶段标准 | P2-01 | P2-02 | P2-03 | P2-04 |
| --- | --- | --- | --- | --- |
| Functional PASS | ✅ | ✅ | ✅ | ✅ |
| Architecture PASS | ✅ | ✅ | ✅ | ✅ |
| Docs / Contracts updated | ✅ | ✅ | ✅ | ✅ |

四项验收全部达到阶段标准，**Phase 2 已完成本地最终验收并正式收口**。

### 收口后仍有一个未结项

```text
全部工作尚未 push
→ P2-01 / P2-02 / P2-03 已在本地提交（194987c / e430358 / 86aa3fc）
→ P2-04 共 4 个文件待提交
→ origin/main 停在 b4e588b，因此 CI（.github/workflows/runtime-tests.yml）从未跑过这批测试
→ push 后由 CI 复核整套测试
```

### 不新增第二阶段架构地图（决定，不是未结项）

第一阶段建图，是因为那一步要固定「Runtime 不带领域语义」这条边界**本身**——那是结构。

第二阶段没有新增生产结构：P2-04 的 `src/` 零改动，P2-01 / P2-02 / P2-03 的因果与边界已由各自的实现文档与架构评审完整保存。此时再画一张图只会复述已有文字而不增加信息，**因此不以架构地图作为第二阶段的收口条件**，也不把它记作未结项。后续若出现真实的结构变化，再按当时的需要决定是否建图。

另有一条**已记录的格式限制**（§11）随第二阶段一起进入下一阶段：Chronicle v1 无法分辨「fact 行被删光」与「全新 store」。它不影响本阶段的关闭判断，但它是任何后续 Chronicle 完整性工作的明确输入。

> P2-04 已经证明：一个完全独立的 Runtime 生命周期可以恢复出同一个 Hikari 与同一条事实，跨 Runtime 的长期存在成立；同时恢复路径是零创建的，失败是诚实且局部的，而承担这些证据的是**一个不提供任何 Service 的测试 Plugin**——Runtime 与两个领域模块为此一行未改。
