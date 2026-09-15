# Hikari 第二阶段 P2-03 启动入口 Architecture Review

> 结论：**Functional PASS + Architecture PASS**
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体的命令行组合入口。
>
> 本文只评审 P2-03。第二阶段整体尚未收口——P2-04 未完成，需要单独的 Boundary Review 与 Architecture Review。
>
> 上位原则：`core-architecture-v0.md` §12.2「Runtime 负责机制，不理解领域意义」。本轮没有新增第二套架构原则。

## 1. Functional Review

当前实现已经验证：

- `hikari init` 在空目录创建长期主体并在 `stdout` 报告 `hikariId`；重复执行被拒绝且不改字节；
- `hikari init` 不创建 Chronicle、不构造 Runtime、不加载 Plugin；
- `hikari chronicle init` 在 Hikari 不存在时失败，且**不**自动创建 Hikari、不创建任何文件；
- `hikari chronicle init` 在 Hikari 存在时创建 Store，`owner` 等于 Continuity 恢复出的 `hikariId`，且不修改 Origin；
- 三种 `start` 结果与冻结语义一致（情况 A / B / C）；
- 情况 B 与情况 C 的语义保持区分，输出中不出现「Hikari 不存在」的表述；
- owner mismatch / Store 损坏 / Origin 损坏按真实领域错误原样输出；
- `start` 是持久化意义上的零创建路径，全部已测场景下文件集合与字节不变；
- 重复 `start` 恢复同一个 `hikariId`，已有 Fact 逐字节不变且仍可读回；
- 用法错误 exit 2，领域失败 exit 1，成功 exit 0；
- 未识别的底层错误保留原始信息并返回非 0。

本地测试：**82 / 82 PASS**（26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

CLI 测试驱动的是**真实可执行入口**（`spawnSync` 拉起 `dist/cli/main.js`），断言的是真实进程退出码与真实 `stdout` / `stderr`，不是在进程内模拟的返回值。

**Functional PASS。**

## 2. src/runtime 未修改

`git diff HEAD --stat -- src/runtime/` 为空，逐字节未修改。

CLI 对 Runtime 的使用只有四个公开表面：

```ts
new Runtime()                    // src/index.ts 导出
runtime.loadPlugin(...)          // 返回 PluginState
runtime.getPluginError(id)       // 读取失败原因
runtime.shutdown()               // 生命周期收尾
```

没有为 CLI 增加任何钩子、分支或特例，没有访问 `service-registry` / `event-bus` / `effect-scope` 等内部模块——`src/cli/start.ts` 对 Runtime 的唯一导入是 `src/index.ts` 这个包根入口。

**PASS。**

## 3. Continuity 核心语义未为 CLI 修改

`git diff HEAD --stat -- src/continuity/` 为空，逐字节未修改。

CLI 从 Continuity 只取两样东西：

- `initializeHikari()`（`hikari init`）；
- `restoreHikari()`（`hikari chronicle init`）。

两者都是 P2-01 已经冻结的公开 API，签名、返回值与错误语义一个都没有动。`src/cli/` 没有导入 `continuity/storage.ts`、`continuity/origin-record.ts`、`continuity/initialize.ts` 或 `continuity/restore.ts` 中的任何一个模块路径——导入目标是 `src/continuity/index.ts`。

**PASS。**

## 4. Chronicle 核心语义未为 CLI 修改

`git diff HEAD --stat -- src/chronicle/` 为空，逐字节未修改。

CLI 从 Chronicle 只取一样东西：`initializeChronicle()`（`hikari chronicle init`）。CLI 从不调用 `openChronicle()`——挂载 Chronicle 是 Chronicle Plugin 在 `start` 中的职责，CLI 不越位。

`src/cli/` 没有导入 `chronicle/store.ts`、`chronicle/open.ts`、`chronicle/service.ts`，导入目标是 `src/chronicle/index.ts`。

**PASS。**

## 5. CLI 不读取领域存储文件格式

这是本轮最核心的边界，因此用三重独立证据确认。

**证据一（导入图）**：图谱查询 `src/cli/` 向外的 IMPORTS 边共 14 条，全部指向 `src/cli/*`、`src/continuity/index.ts`、`src/chronicle/index.ts`、`src/index.ts`。**没有一条指向存储模块**。

**证据二（文本检索）**：`src/cli/` 中检索下列符号，全部零命中：

```text
node:fs   existsSync   readFileSync
origin.json   chronicle.jsonl
resolveOriginPath   resolveChroniclePath
```

CLI 连 `node:fs` 都没有导入，因此在结构上不具备读写任何文件的能力。

**证据三（行为断言）**：测试断言 `chronicle init` 前后 `origin.json` 字节不变、`start` 前后整棵文件树不变——如果 CLI 参与任何领域文件的读写，这些断言会失败。

`origin.json` 与 `chronicle.jsonl` 对 CLI 是完全不可见的两个字符串。

**PASS。**

## 6. CLI 不成为身份真源

`src/cli/` 中检索 `randomUUID`，**零命中**。

身份只有两个来源，都是领域给的：

- `initializeHikari()` 的返回值（由 Continuity 生成并落盘）；
- `restoreHikari()` 的返回值（由 Continuity 从既有记录恢复）。

CLI 只把拿到的 `hikariId` **打印出来**，从不构造、不猜测、不推断。`hikari chronicle init` 甚至不自己决定「用哪个主体创建 Store」——它把 Continuity 恢复出的 identity 原样交给 Chronicle。

**PASS。**

## 7. CLI 不成为事实史真源

`src/cli/` 中检索 `append` / `factId` / `DurableFact` / `FactDraft`，**全部零命中**。

CLI 不写事实、不读事实、不判断「什么值得长期记录」。`start` 只检查 Chronicle 插件是否挂载成功，从不触碰事实内容。整个 CLI 里没有一行代码知道一条 Fact 长什么样。

**PASS。**

## 8. hikari init 只创建 Hikari

`init.ts` 的整个命令体只有一次领域调用：

```ts
const identity = initializeHikari({ rootDir: options.dataDir });
```

没有 `new Runtime()`，没有 `loadPlugin`，没有 `initializeChronicle`，没有 Memory / World / Goal。

测试直接断言：执行 `init` 后数据目录里只有 `continuity`，`chronicle` 目录不存在。

**PASS。**

## 9. hikari chronicle init 只创建 Chronicle

`chronicle-init.ts` 的整个命令体只有两次领域调用：

```ts
const identity = restoreHikari({ rootDir: options.dataDir });
initializeChronicle({ rootDir: options.dataDir, identity });
```

第一次是**纯读取**，第二次只写 Chronicle Store。

「Hikari 不存在时不得自动创建」由**控制流**保证而不是由约定保证：`restoreHikari` 在缺失时抛 `NotInitializedError`，异常直接穿透 `chronicleInitCommand`，`initializeChronicle` 那一行根本不会被执行。这里没有 `try` / `catch`，因此「捕获失败后自动初始化」这一被禁止的模式在该文件里无法写出。

测试断言：该失败路径下数据目录快照为空。

**PASS。**

## 10. hikari start 不创建任何持久主体数据

`start` 的领域调用链只有两条，都是纯读取：

```text
loadPlugin(continuityPlugin) → 插件 setup → restoreHikari()   ← 读
loadPlugin(chroniclePlugin)  → 插件 setup → openChronicle()   ← 读（P2-02 §7 已证明零写入）
```

Runtime 自身不接触文件系统（`src/runtime/` 中检索 `node:fs` 零命中），CLI 也没有写入能力。

测试用文件树快照（文件集合 + 每个文件字节）断言，已覆盖六个场景：全空、只有 Continuity、完整、owner mismatch、Store 损坏、Origin 损坏。**全部不变**，且不产生任何 `.tmp` 残留。

额外断言：Origin 被删除后 `start` 不会把它重建出来——「恢复失败」绝不退化成「创建」。

**PASS。**

## 11. start 通过 Plugin 依赖图恢复，不手工模拟启动顺序语义

CLI 对插件只做一件事：调用 `loadPlugin` 两次。它**不轮询、不重试、不等待、不强制激活、不读取中间状态后做补偿动作**。

插件最终状态完全由 Runtime 的 `requires` 依赖图收敛得出。可观察的证据就在情况 B：

```text
continuity 状态：failed
chronicle 状态：waiting      ← 不是 failed，也不是缺失
```

Continuity 失败时，CLI 并没有「跳过」Chronicle；是 Runtime 判定 `chronicle@1` 的依赖未满足，因此 Chronicle 停在 `waiting`。**这个 `waiting` 是依赖图的结论，不是 CLI 的编排**——CLI 只是把结论读出来报告。

换一个方向看也一样：CLI 从未把 `continuity.current@1` 手工传给 Chronicle。`chroniclePlugin` 自己声明 `requires: [continuityService]`，自己从 `context.services.get` 取。

**PASS。**

## 12. 没有 HikariCore / BootstrapManager / GlobalContext

在 `src/` 中检索下列全部标识符，**零命中**：

```text
HikariCore   HikariApplication   ApplicationContext   GlobalContext
BootstrapManager   HikariManager   SystemManager   ServiceContainer
```

CLI 的共享词汇只有 `options.ts` 里的四个普通类型与三个普通函数：

```text
CliOptions  CommandOutcome  CliCommand  ParsedCommandLine
parseCommandLine  readCommand  readOptions
```

传递 `dataDir`、`Runtime`、命令结果用的都是**普通函数参数**，没有引入容器、上下文对象或应用框架。

**PASS。**

## 13. 没有新的全局可变状态

`src/cli/` 中检索模块级 `let` / `var`，**零命中**。

- 三个 command 函数都是 `(options) => outcome` 的形状，不读写任何模块级可变状态；
- `start` 每次调用 `new Runtime()`，Runtime 实例是局部变量，随命令结束被 `shutdown()` 并丢弃；
- 模块级常量只有字符串（`USAGE`、两个提示语）；
- 唯一一处进程级副作用是 `main.ts` 顶层的 `process.exitCode` 赋值——那是进程退出码本身，不是应用状态。

不存在跨命令残留的单例、缓存或注册表。

**PASS。**

## 14. 「运行配置失败」与「Hikari 不存在」语义保持区分

三种结果各自有独立的输出契约，且**没有任何一条输出声称「Hikari 不存在」**：

| 情况 | headline | 是否提示后续命令 |
| --- | --- | --- |
| A：两个插件都 active | `Hikari 启动成功。` | — |
| B：Continuity failed | `Hikari 未启动：无法确认长期主体。` | 仅当错误是 `NotInitializedError` → 提示 `hikari init` |
| C：Continuity active、Chronicle failed | `Hikari 未启动：长期主体已恢复，但事实史不可用。` | 仅当错误是 `ChronicleNotInitializedError` → 提示 `hikari chronicle init` |

两个关键设计：

- **失败不等于不存在**：情况 B 的措辞是「无法确认长期主体」——它描述的是**本次恢复流程的结果**，不是对磁盘状态的断言。Origin 损坏时输出的是真实领域错误 `Hikari origin record is invalid: ...`，此时**不提示** `hikari init`，因为那不是一个 init 能解决的问题；
- **失败不等于主体不存在**：情况 C 明确写出「长期主体已恢复」，把「主体在、能力不在」这个区别保留下来。owner mismatch 与 Store 损坏同样保留该 headline，领域错误原样附在后面。

测试对此有直接断言：owner mismatch 与 Store 损坏两个场景下，`stderr` 必须匹配「长期主体已恢复」，且必须**不匹配**「不存在」。

**PASS。**

## 15. P2-03 没有实现 Resident / Profile 系统

在 `src/` 中检索 `Resident` / `resident` / `Profile` / `profile`，**全部零命中**。

`start` 执行完 `runtime.shutdown()` 即返回，进程随即退出。没有常驻循环、没有信号处理、没有守护进程、没有配置文件加载、没有环境 Profile 切换。

本阶段只有三个命令与一个参数（`--data-dir`）。

**PASS。**

## 16. 当前刻意保留的限制

以下是本阶段的有意限制，不作为缺陷提前抽象：

- CLI 输出文本使用中文，而领域错误消息保持英文：CLI 是给人看的一层翻译，领域错误是给程序判断的一层契约，两者不混同；翻译层只加 headline 与提示，永远附上领域原文；
- `--data-dir` 必填且无默认值：宁可让用户多打一个参数，也不让入口自行发明一个可能往意外位置写入的路径；
- 只支持 `--data-dir <path>` 这一种写法，不支持 `--data-dir=<path>`，也不支持短选项；
- 退出码只用 0 / 1 / 2 三个值，没有为每类领域错误分配独立退出码；
- `start` 不打印 `hikariId`：Runtime 没有公开的 Service 访问器，要在插件图之外拿到 identity 只能自己再调一次 `restoreHikari`（会让 CLI 变成第二个身份读取者），或额外加载一个观察者插件（超出冻结的两插件组合）。因此 `start` 只报告插件状态，身份一致性的验证由测试用公开 API 完成；
- `start` 只做一次启动尝试，失败后**不重试、不修复、不降级**——那属于自动修复，是本阶段禁止的；
- 没有 `hikari stop` / `status` / `log` 等运维命令；
- 数据目录路径按原样透传，CLI 不做解析或规范化；
- 当 `--data-dir` 指向一个普通文件时，`init` 会把底层 `ENOTDIR` 原样抛出；`start` 与 `chronicle init` 在 Windows 上表现为 `ENOENT`，因而被 Continuity 判定为「记录不存在」。这是 Continuity 既有的平台行为，CLI 按原样转发，不做二次解释，也不在本阶段修正。

这些限制只有在真实需求被阻塞时才触发新的 Boundary Review。

## 17. 图谱变更验证

在 `git add` 本阶段文件之后，重新执行了图谱变更分析。**本次输出实际覆盖了 CLI 新文件**，因此可以作为图谱侧证据使用。

```text
Changes:        10 files, 120 symbols
Affected:       27 execution flows
Risk level:     critical
partial:        无
truncated:      无
```

`risk_level` 为 **critical**，未做降级处理。其构成已定位：

- 120 个变更符号中，**48 个是文档标题**（GitNexus 把 Markdown 标题也索引为 `Section` 符号）：架构评审 21、实现文档 18、阶段说明 9；
- 其余 **72 个为代码符号**，全部位于 `src/cli/`（60 个）与 `test/cli.test.mjs`（12 个）；
- `changed_files: 10` 与 `git diff HEAD --name-only` 的 10 个文件精确一致：`package.json` + 5 个 `src/cli/` 文件 + `test/cli.test.mjs` + 3 个文档（`package.json` 不产生符号）；
- **变更集中没有任何一个符号位于 `src/runtime/`、`src/continuity/`、`src/chronicle/` 或 `src/index.ts`**；
- 独立的字节级证据：`git diff HEAD --stat` 对这四个路径的输出为**空**；
- 27 条受影响执行流**全部**是 CLI 自身的流程（`RunCommandLine → *`、`Execute → *`、`StartCommand → *`、`ChronicleInitCommand → *`），**没有任何 Runtime / Continuity / Chronicle 执行流受影响**。

即：本次变更是**纯增量**，critical 由「新增了一整个入口模块」推高，而非由对既有结构的破坏推高。这是对风险来源的判断，不是对告警的豁免——工具本身没有给出 low。

### 依赖方向的图侧确认

`src/cli/` 向外的 IMPORTS 边共 14 条，全部指向公开入口（`src/cli/*`、`src/continuity/index.ts`、`src/chronicle/index.ts`、`src/index.ts`），**没有一条指向存储模块或 Runtime 内部模块**。

反向查询（谁导入 `src/cli/`）只返回 `src/cli/` 内部文件——**运行时、Continuity、Chronicle 都不知道 CLI 的存在**。

### 工具限制（如实记录）

- **受影响流程是下界，不是全集**：本次索引重建时分析器自报 `85 flows reported, but whole flows are MISSING: 33 ranked entry point(s) never traced, 10 deduplicated flow(s) dropped at maxProcesses, 70 callee(s) skipped at maxBranching, 4 walk(s) cut by the per-entry trace budget`。因此 §17 列出的 27 条流程只应读作「至少这些」，**不构成「仅这些受影响」的证明**。变更符号集本身没有 truncation 标记，且字节级的 `git diff` 已独立证明四个既有模块未被触碰。
- **索引元数据自报落后一个提交**：多处查询返回 `staleness: {status: "behind", commitsBehind: 1}`。但 `src/cli/` 的符号确实已在图内（同一批查询能按文件返回 65 个符号，`detect_changes` 也能映射出 72 个变更符号），因此这是元数据滞后，不影响本轮结论。此处记录，避免后续被误读为「索引未包含 P2-03」。
- **跨语言字段解析不完整**：索引器自报 `88 property read/write site(s) name a field that IS defined in this workspace, but only in another language, so per-language inference declined to link them`，受影响字段包含 `code` / `name` / `createdAt` / `current` / `error` / `events` / `factId` / `hikariId` / `kind` / `owner`。本轮 CLI 测试是 `.mjs`，其中读取的 `.code` / `.stdout` / `.stderr` 属于这一情形，因此**针对这些字段的引用查询会返回空结果，而空结果不等于「无人使用」**。
- **`query()` 的关键词与语义检索仍不可用**：FTS 扩展在本机加载失败；本次重建使用 `GITNEXUS_FTS_CJK_SEGMENTATION=bigram` 规避 CJK 分词不匹配。图遍历能力（`context` / `cypher` / `impact` / `trace` / `detect_changes`）不受影响。
- 索引跳过了 1 个超过 512KB 的文件（`docs/diagrams/phase-1-runtime.html`），它是生成物，不属于本阶段变更。
- 本次证据由**两个前置条件共同成立**才取得：索引重建（使 CLI 符号进入图谱）+ `git add`（使新文件进入 diff）。

## 18. 最终结论

图谱**没有发现** P2-03 对既有 Runtime / Continuity / Chronicle 产生任何结构性侵入，也没有发现对 `core-architecture-v0.md` 的结构性穿透。

但必须连着 §17 已记录的不完备性一起读：分析器自报流程分析未穷尽，索引元数据自报滞后，跨语言字段解析不完整，`query()` 的关键词与语义检索不可用。因此这个结论的准确读法始终是「**未发现**侵入」，而**不是**「**已证明不存在**侵入」——前者是本次分析的输出，后者超出本次分析的能力。真正逐字节的保证来自 `git diff`，不来自图谱。

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

因此 **P2-03 启动入口** 可以正式收口。

第二阶段整体**不能**据此收口：P2-04 生命周期验收未完成，本文的结论不覆盖它。

> P2-03 已经证明：Continuity 与 Chronicle 可以被一个真实可执行入口组合起来，而入口不需要读任何一个领域文件、不需要知道任何一种持久化格式、也不需要成为身份或事实的真源；同时它也没有长成第二个中心——它只负责组合，不拥有被组合者。
