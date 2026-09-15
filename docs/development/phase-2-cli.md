# Hikari 第二阶段 P2-03 启动入口实现

> 状态：**P2-03 已完成**（第二阶段整体进行中，P2-04 未完成）
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体的命令行组合入口。
>
> 本文只覆盖 P2-03。第二阶段其余项不在本文范围内。

## 1. 阶段目标

P2-01 与 P2-02 各自提供了「显式创建」与「纯读取恢复」的领域能力，但都只是可被调用的 API，没有任何真实入口把它们组合成一次可执行的操作。

本阶段只做这一件事：

> 为已经存在的 Continuity 与 Chronicle 建立真实可执行的管理 / 启动入口，**入口负责组合，领域负责语义，Runtime 负责生命周期**。

本阶段不新增领域能力，不扩设计，也不把 CLI 变成新的中心层。

## 2. 阶段边界

本阶段明确不做以下事情，且这些边界已由代码结构保证，而不只是文档约定：

- 不修改 `src/runtime/`；
- 不修改 `src/continuity/` 与 `src/chronicle/` 的任何一行；
- CLI 不读取 `origin.json`，不解析 Origin Record；
- CLI 不读取 `chronicle.jsonl`，不解析 Chronicle Store，不检查 Store owner；
- CLI 不修复任何领域文件；
- CLI 不成为身份真源，也不成为事实史真源；
- 不引入 `HikariCore` / `HikariApplication` / `ApplicationContext` / `GlobalContext` / `BootstrapManager` / `HikariManager` / `SystemManager` / `ServiceContainer`；
- 不建立配置系统、配置文件搜索、环境 Profile、节点配置、用户配置中心；
- 不实现 Resident，不要求常驻；
- 不提前实现 P2-04 的生命周期验收。

## 3. 当前目录

P2-03 新增文件 **6 个**：

```text
src/cli/  (5)
  chronicle-init.ts  init.ts  main.ts  options.ts  start.ts
test/cli.test.mjs                                              (1)
```

修改文件：`package.json`（新增 `bin` 入口）、`docs/development/current-stage.md`。

```text
src/
├─ index.ts                 （未修改）
├─ cli/
│  ├─ chronicle-init.ts
│  ├─ init.ts
│  ├─ main.ts
│  ├─ options.ts
│  └─ start.ts
├─ chronicle/               （未修改）
├─ continuity/              （未修改）
└─ runtime/                 （未修改）

test/
├─ chronicle.test.mjs
├─ cli.test.mjs
├─ continuity.test.mjs
└─ runtime.test.mjs
```

`src/cli/` 与 `continuity/`、`chronicle/` 同级，位于 Runtime **之上**。包根 `src/index.ts` 未做任何改动。

### CLI 依赖的全部外部表面

图谱查询 `src/cli/` 向外的 IMPORTS 边共 **14 条**，全部指向公开入口：

```text
src/cli/init.ts            → src/cli/options.ts        src/continuity/index.ts
src/cli/chronicle-init.ts  → src/cli/options.ts        src/continuity/index.ts
                                                       src/chronicle/index.ts
src/cli/start.ts           → src/cli/options.ts        src/continuity/index.ts
                                                       src/chronicle/index.ts
                                                       src/index.ts
src/cli/main.ts            → src/cli/options.ts        src/continuity/index.ts
                             src/cli/init.ts  src/cli/chronicle-init.ts  src/cli/start.ts
```

反向查询（是否有人导入 `src/cli/`）只返回 `src/cli/` 内部文件：**没有任何 runtime / continuity / chronicle 文件依赖 CLI**，依赖方向严格单向。

`src/cli/` 中检索 `node:fs` / `existsSync` / `readFileSync` / `origin.json` / `chronicle.jsonl` / `resolveOriginPath` / `resolveChroniclePath`，**全部零命中**。

## 4. 冻结命令面

```text
hikari init --data-dir <path>
hikari chronicle init --data-dir <path>
hikari start --data-dir <path>
```

三者语义严格分离，互不代劳：

| 命令 | 只做什么 | 绝不做什么 |
| --- | --- | --- |
| `init` | 调用 `initializeHikari()` 创建长期主体 | 创建 Chronicle、启动 Runtime、自动启动 Plugin、初始化 Memory / World / Goal |
| `chronicle init` | `restoreHikari()` → `initializeChronicle(identity)` | Hikari 不存在时自动 `initializeHikari()` |
| `start` | 构造一次真实 Runtime 启动流程并报告结果 | 创建任何持久主体数据 |

## 5. hikari init

```text
initializeHikari({ rootDir: dataDir })
```

**只创建长期 Hikari 主体**。整个命令体只有两次调用，不构造 Runtime，不加载任何 Plugin，因此「顺手初始化 Chronicle」在这条路径上无法发生。

```text
空白状态        → 创建 origin.json → 成功，exit 0
已有合法主体    → AlreadyInitializedError → exit 1，文件字节不变
```

## 6. hikari chronicle init

```text
restoreHikari({ rootDir: dataDir })          ← 只读取
↓ 得到 HikariIdentity
initializeChronicle({ rootDir: dataDir, identity })
```

**只为已经确认存在的 Hikari 显式创建 Chronicle Store**。

```text
Hikari 不存在   → NotInitializedError → exit 1，不创建任何东西
Hikari 存在     → 创建仅含 Header 的 Store → exit 0
已有 Store      → ChronicleAlreadyInitializedError → exit 1，文件字节不变
```

标识从哪里来：**从 Continuity 的公开 API 拿**。CLI 自己不读 `origin.json`，不解析 Origin Record，不生成 id（`src/cli/` 中检索 `randomUUID` 零命中）。

这条命令不修改 Origin：`restoreHikari` 是纯读取路径，测试断言了执行前后 `origin.json` 字节完全一致。

## 7. hikari start

只负责构造**一次真实的 Runtime 启动流程**：

```text
new Runtime()
↓
loadPlugin(continuityPlugin)
↓
loadPlugin(chroniclePlugin)
↓
检查插件最终状态
↓
输出启动结果
↓
runtime.shutdown()   ← finally，无论成功失败都执行
```

不是 Resident，不常驻，不进入事件循环等待。它是 Phase 2 的真实启动组合入口。

### 三种启动结果

**情况 A：`continuity = active` 且 `chronicle = active`**

```text
Hikari 启动成功。
continuity 状态：active
chronicle 状态：active
```

exit 0。

**情况 B：`continuity = failed`，`chronicle = waiting`**

```text
Hikari 未启动：无法确认长期主体。
continuity 状态：failed
chronicle 状态：waiting
Hikari origin record does not exist.
请先运行：hikari init --data-dir <path>
```

exit 非 0。

最后一行只在错误是 `NotInitializedError` 时出现。**启动失败不等于「Hikari 不存在」的通用结论**，它只表示当前恢复流程未能确认长期主体；如果 Origin 存在但损坏，输出的是真实领域错误，`hikari init` 也不会被提示——因为那不是一个可以靠 init 解决的问题。

**情况 C：`continuity = active`，`chronicle = failed`**

```text
Hikari 未启动：长期主体已恢复，但事实史不可用。
continuity 状态：active
chronicle 状态：failed
Chronicle store does not exist.
请运行：hikari chronicle init --data-dir <path>
```

exit 非 0。

当前 Phase 2 的最小运行配置要求 Continuity + Chronicle，所以这仍然是失败。但输出**保留「主体已恢复 / 事实史拒绝挂载」的区别**，绝不描述成「Hikari 不存在」。提示行同样只针对 `ChronicleNotInitializedError`；owner mismatch、Store 损坏等错误按真实领域错误语义原样输出：

```text
Chronicle store belongs to <actual>, not to <expected>.
Chronicle store is invalid: header is not valid JSON.
```

### 启动顺序不是 CLI 决定的

CLI 只调用两次 `loadPlugin`，**不轮询、不重试、不等待、不强制激活**任何插件。插件最终状态由 Runtime 的 `requires` 依赖图收敛得出。

可观察的证据就在情况 B：Continuity 失败时，CLI 并没有「跳过」Chronicle，是 Runtime 判定 `chronicle@1` 的依赖未满足，因此 Chronicle 停在 `waiting` 而不是 `failed`。CLI 只是把这个结论读出来报告。

## 8. 参数、退出码与输出约定

只提供一个参数：

```text
--data-dir <path>    数据根目录，必填，没有默认值
```

没有隐式默认值是有意的：Continuity 与 Chronicle 都要求调用方显式提供 `rootDir`，CLI 不自行发明一个——否则在任意工作目录执行 `hikari init` 就会往那里写入。路径按调用方给出的原样透传，CLI 不做解析、不做规范化。

不建立配置系统：没有配置文件搜索、没有环境 Profile、没有节点配置、没有用户配置中心。

退出码：

```text
0    成功
1    领域失败或启动失败
2    用法错误（缺参数、未知命令、未知参数、空路径）
```

输出分流：成功走 `stdout`，失败走 `stderr`。

`main.ts` 只做四件事：解析 argv → 选择 command → 调用对应 command 函数 → 设置 `process.exitCode`。它不含领域逻辑，也不在深层函数里 `process.exit()`——**这一点有实际后果**：`process.exit()` 会截断尚未 flush 的管道输出，而设置 `exitCode` 后 Node 会等标准输出排空再正常退出。

## 9. 错误处理

command 函数**返回明确结果或抛出领域错误**，由最外层 `main.ts` 翻译成人类可读文本：

```text
UsageError                    → exit 2 + 用法全文
NotInitializedError           → 原文 + 「请先运行：hikari init」
其他领域错误                  → 原文
未识别错误                    → 原文（Error.message 或 String(error)）
```

判断基于现有具体错误类，不把所有错误压成一句「Startup failed」。未识别错误保留原始信息并返回非 0：

```text
$ hikari init --data-dir <一个普通文件>
ENOTDIR: not a directory, mkdir '...\continuity'
exit 1
```

### 新增的唯一错误类型

`UsageError` 定义在 `src/cli/options.ts`，**不进入 Continuity 也不进入 Chronicle 的错误面**。它表达的是「命令行长什么样」而不是「领域状态如何」，因此留在 CLI 内部；领域错误面一个都没有增加。

## 10. 纯恢复约束

`hikari start` 在持久化意义上是**零创建路径**：

- `new Runtime()` 不接触文件系统（`src/runtime/` 中检索 `node:fs` 零命中）；
- Continuity 插件的 `setup` 只调用 `restoreHikari`（纯读取）；
- Chronicle 插件的 `setup` 只调用 `openChronicle`（纯读取，零写入，见 P2-02 §7）；
- CLI 自己没有任何文件写入能力。

测试以「文件树快照」的方式断言：`start` 前后，数据目录下的**文件集合与每个文件的字节**完全一致，因此残留 `.tmp` 也会被这个断言捕获。已覆盖的场景：全空、只有 Continuity、Continuity + Chronicle 完整、owner mismatch、Store 损坏、Origin 损坏。

## 11. 当前测试

本地自动化测试：**82 / 82 PASS**（26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime，原有测试全部保持通过）。

CLI 测试通过 `spawnSync(process.execPath, [dist/cli/main.js, ...])` **驱动真实可执行入口**，因此退出码与 `stdout` / `stderr` 都是真实进程行为，不是在进程内模拟的返回值。

CLI 测试覆盖：

1. 空目录 `init` 成功，且 `stdout` 里出现真正落盘的 `hikariId`；
2. `init` 不创建 Chronicle（目录清单只有 `continuity`）；
3. 重复 `init` 失败，且 `origin.json` 字节不变；
4. Hikari 未初始化时 `chronicle init` 失败，并提示 `hikari init`；
5. 该失败路径不创建任何东西（快照为空）；
6. Hikari 存在时 `chronicle init` 成功，Store 的 `owner` 等于 Continuity 恢复出的 `hikariId`；
7. `chronicle init` 不修改 `origin.json`；
8. 重复 `chronicle init` 失败，且 Store 字节不变；
9. 全空状态 `start` 失败，输出「无法确认长期主体」并提示 `hikari init`；
10. 全空状态 `start` 不创建任何持久数据（快照为空）；
11. 只有 Continuity 时 `start` 失败，输出「长期主体已恢复，但事实史不可用」，且**不含**「无法确认长期主体」；
12. 只有 Continuity 时 `start` 不自动创建 Chronicle；
13. Origin 被删除后 `start` 失败，且**不会**把它重建出来；
14. Continuity + Chronicle 完整时 `start` 成功，两个插件状态均为 `active`；
15. `start` 前后所有持久字节不变，且文件集合精确等于 `chronicle/chronicle.jsonl` + `continuity/origin.json`；
16. 连续两次 `start` 恢复同一个 `hikariId`，持久字节全程不变；
17. Chronicle 中已有 Fact 时，两次 `start` 后该 Fact 逐字节不变，且仍能被读回；
18. owner mismatch 时 `start` 拒绝，保留「长期主体已恢复」的区别，且输出中**不出现「不存在」**；
19. Store 损坏时 `start` 拒绝，同样保留该区别；
20. Origin 损坏时 `start` 报「无法确认长期主体」+ 真实领域错误，且**不提示** `hikari init`；
21. 缺 `--data-dir` → exit 2 + 用法全文；
22. 未知命令 → exit 2；
23. `chronicle` 缺少 `init` 子命令 → exit 2；
24. 未知参数 → exit 2；
25. 空白 `--data-dir` → exit 2；
26. 用法错误不触碰数据目录。

## 12. 本阶段明确没有实现

仍然没有：

- Resident 常驻模式、守护进程、后台服务；
- 配置文件、环境 Profile、节点配置、用户配置中心；
- `hikari stop` / `hikari status` / `hikari log` 等运维命令；
- 多 Hikari、多数据目录、多节点；
- 任何领域文件的直接读取、校验、修复或迁移；
- 启动失败后的自动重试、自动修复、自动创建；
- Memory / World / Goal 的初始化入口。

也没有提前实现 P2-04：

```text
Runtime A
append Fact A
shutdown
完全创建 Runtime B
恢复主体
恢复事实
验证长期存在
```

本阶段只验证到「重复 `start` 不破坏已有事实」，完整的跨 Runtime 生命周期验收仍属于 P2-04。

## 13. 实现原则

`core-architecture-v0.md` §1 与 §12.2 的「Runtime 负责机制，不理解领域意义」是本阶段的上位原则，没有新增第二套架构原则。CLI 是这条原则在入口侧的延伸：

> **启动器只负责组合，不拥有被组合者。**

CLI 不知道身份是怎么创建的，不知道事实是怎么落盘的，不知道 Store 长什么样。它只知道「调用哪个公开函数」「读哪个插件状态」「怎么说人话」。如果 P2-03 的实现需要读一个领域文件才能完成，那说明那个领域缺少一个公开 API——正确的做法是补 API，而不是让入口下沉去读文件。
