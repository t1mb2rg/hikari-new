# M2-c 代码事实调查：跨 Session 的记忆发现与修订

> 核对基线：`main` @ `7032589b1330d8d0b993a5eb9d167dd97304bdde`（2026-11-05）。
> 本文只记录代码事实与缺口，不做设计取舍。标注约定：**[事实]** 为可直接在标注位置读到的行为，**[缺口]** 为代码里没有、或语义未冻结的部分。
> 行号取自当前工作树，改动后需重核。

## 0. 本片要回答的问题

M2-b 之后，模型能写记忆、能在同一段上下文里修订自己刚写过的记忆。但**新的 Session 开始时，模型手里没有任何 memoryId**。M2-c 要回答的是：在「不自动注入、不自动提取」的前提下，Hikari 如何在未来重新遇到相关信息时找回过去的记忆、判断新旧关系、并通过追加修订让它继续成为以后判断的依据。

本文先摸清现状：谁持久、谁可见、有没有读入口。

## 1. 现状：写进去之后，谁能再看见它

- [事实] 四个记忆工具全部由 `hikari-native/memory/` 提供：`search_memory`、`read_memory`（`hikari-native/memory/tools.js:11` 的 `MEMORY_TOOL_NAMES`，`installMemoryTools` 在 `:13`）与 `write_memory`、`revise_memory`（`hikari-native/memory/writing.js:363-483` 的 `installMemoryWriteTools`）。
- [事实] 这四者里，**没有任何一个读取 Memory Store**。`search_memory` / `read_memory` 的执行体直接转发给 World 提供的 service（`hikari-native/memory/tools.js:62-64`、`:109-111`），而该 service 读的是 findings。
- [事实] Memory Store 的读口子只被两处使用：`hikari-native/memory/index.js:93`（ready 行里的 `store.size` / `store.lastSeq`）与 `hikari-native/memory/writing.js:264`、`:272`（`assertReviseTarget` 里的 `store.get(targetId)` 与 `store.all().some(...)`）。其余调用点全在测试里。
- [事实] 因此：**记忆一旦写入磁盘，除了「恰好还记得它的 memoryId」的调用方，没有任何代码路径能再把它取出来。** 修订能力实际被限制在同一段上下文内。
- [缺口] G-1：没有「列出/检索记忆」的公开接口。`store.all()` 存在但是全量快照（`hikari-native/memory/store.mjs:259-261`），不是检索。

## 2. 两种持久化，作用域不同

- [事实] Memory Store 是**全局文件**：目录由 `storeDir` 或 `<DSH_HOME>/hikari/memory` 决定（`hikari-native/memory/store.mjs:67-92`），数据在 `memory.jsonl`（`store.mjs:24`），与 Session 无关。同一台机器上的所有项目、所有 Session 共用一个存储（M2 架构已冻结「单一全局 Memory Store」）。
- [事实] World findings **不是全局文件**：它们是 Session 日志里的 `plugin:hikari/finding` 记录（`hikari-native/world/findings.js:20` 的 `FINDING_RECORD_TYPE`），由 `sessionProjections` 从该 Session 的日志派生（`findings.js:379` 注册投影、`:391` `stateOf`），并在每个模型请求通过 `systemPrompt.context()` 注入当前有效发现（`findings.js:396`）。
- [事实] 投影的取数是「当前 Session」：`const currentSession = () => ctx.sessions.get(sessionId)`（`findings.js:387`）。
- [事实] 结论：**findings 的可见范围是 Session（同一 Session 重启可从日志恢复），Memory 的可见范围是机器（跨项目、跨 Session），但 Memory 没有读入口。** 两者不是同一层东西。
- [缺口] G-2：跨 Session 的「重新遇到相关信息」目前没有任何运行时信号——不自动注入（M2 冻结前提 7）意味着新会话启动时上下文里没有记忆摘要，模型只能靠自己（或用户）提到。

## 3. 检索工具的真实作用域

- [事实] `search_memory` 的 schema 只有 `query` / `limit` / `offset`（`hikari-native/memory/tools.js:25-27`；`nextOffset` 只出现在输出 schema `:56`），执行体 `return service.search(args)`（`hikari-native/memory/tools.js:63`），service 是 `hikariWorldFindings`（`hikari-native/memory/index.js:46`）。它检索的是 findings，返回条目形如 `{id, line, chars}`（`findings.js:233` 的 `searchFindings`，条目构造在 `:265-269`）。
- [事实] `read_memory` 只接受 `id`（finding id），返回 `{id, claim, chars/offset...}`（`hikari-native/world/findings.js:287` 的 `readFinding`）。
- [事实] finding id 形如 `f-xxx`（`findings.js` 的 `FINDING_ID_PATTERN`），Memory 的 id 形如 `m-<uuid>`（`store.mjs:44`）。两套 id 空间并存，互不解析。
- [缺口] G-3：`search_memory` 这个**名字**暗示它能搜记忆，实际只搜当前 Session 的 findings。M2-c 要么给它扩一个新目标，要么新增独立工具——这是一个契约决定，不是实现细节。

## 4. Memory Store 的读口子（全部）

| 成员 | 位置 | 语义 |
| --- | --- | --- |
| `all()` | `store.mjs:259-261` | 按 seq 顺序返回全部记录的快照（冻结浅拷贝） |
| `get(memoryId)` | `store.mjs:263` | 按 id 取一条，缺失返回 undefined |
| `size` | `store.mjs:231` | 记录条数 |
| `lastSeq` | `store.mjs:235` | 最后一条的 seq |
| `damage` | `store.mjs:247` | 启动时的损坏信息 |

- [事实] 没有 `has()`、没有按时间/文本/来源检索、没有 supersedes 反向索引（M2-a 文档 §3 已把「反向索引」列为未实现的优化，`hikari-native/memory/writing.js:272` 用 `store.all().some(...)` 代替）。
- [缺口] G-4：`all()` 是 O(n) 全量物化。当前存储规模小（本机测试 0–20 条）时无所谓，但它是「检索」的唯一现有素材。是否在此之上做检索、还是维持「不检索」的边界，需要判断。

## 5. 注入面

- [事实] `systemPrompt.context()` 只被 findings 使用（`hikari-native/world/findings.js:396`）；Memory 插件没有注册任何 `systemPrompt` 注入（`hikari-native/memory/index.js:20` 的 `inject` 只有 `tools` 与 `hikariWorldFindings`）。
- [事实] Memory 插件对 World 的依赖只有一处：借用 `hikariWorldFindings` 这个只读 service 来实现两个检索工具的转发（`index.js:46`）。
- [缺口] G-5：Memory 与 findings 之间没有任何关联记录。写入记忆时不会记「这条记忆来自哪条 finding」（`source.kind:'finding'` 是模型手填的字符串，工程不校验它真的存在）。

## 6. 会话边界

- [事实] Session 由宿主（`sessions` / `sessionProjections` 服务）管理，插件只能拿到「当前 Session」（`findings.js:387`）。
- [事实] 本仓库没有任何代码遍历其它 Session 的日志。
- [缺口] G-6：**没有跨 Session 的读取能力**。若 M2-c 想让模型「在新会话里发现旧记忆」，入口只能是 Memory Store（全局文件）或由用户/模型显式提供的信息，不能指望去翻别的会话日志。

## 7. 与冻结前提的关系

> 编号沿用立题时冻结的十条前提（1–10）。`docs/architecture/m2c-memory-discovery-architecture-review.md` 的对照表把第 8、9、10 条合并为一行，因此那张表只有八行——两处指的都是同一批前提，这里不重复合并。

| 前提 | 现状 | M2-c 的约束 |
| --- | --- | --- |
| 6. append-only | 已遵守：`store.mjs:510` 唯一写路径 | 修订仍只能是新行 + `supersedes` |
| 7. 不自动注入长期记忆 | 已遵守：Memory 无 `systemPrompt` 注入 | 新增能力必须是**模型主动调用**才会发生 |
| 8. 不自动提取对话内容 | 已遵守：只有工具调用写记忆 | 检索不能顺带写 |
| 9. 不自动判断记忆过期 | 已遵守：没有任何过期计算 | 检索只给 `supersededBy` 这一结构事实，不给「过期」判断 |
| 10. 不改变 World Findings 所有权 | 已遵守：Memory 只借用只读 service | 不得把 finding 的检索语义搬进 Memory 存储 |

## 8. 缺口清单（待 Functional / Architecture Review 回答）

| 编号 | 缺口 | 影响 |
| --- | --- | --- |
| G-1 | 没有记忆检索/列举接口 | 跨 Session 发现无从谈起 |
| G-2 | 新会话没有任何「重新遇到」的信号 | 发现必须由模型或用户主动发起 |
| G-3 | `search_memory` 名字与作用域不一致 | 扩它 or 新增工具，是公开契约决定 |
| G-4 | 只有 `all()` 全量快照可用 | 检索若做，成本与语义都要说清 |
| G-5 | 记忆与 finding 无工程级关联 | `source.kind:'finding'` 只是自述 |
| G-6 | 插件无法读其它 Session | 跨会话发现只能落在 Memory Store 上 |
| G-7 | `supersedes` 无反向索引，链头判定是 O(n) 扫描 | 检索结果里如何呈现「已被修订」需要决定 |
| G-8 | 模型没有时钟（`docs/architecture/cognition-action-loop-v0-boundary-review.md:68`） | 检索若支持时间过滤，模型构造不了绝对时间 |

## 9. 三条待检验判断的当前读数

1. **持久面唯一**：证据支持。findings 在 Session 日志（`findings.js:20`/`:379`/`:387`），Memory 在全局 jsonl（`store.mjs:24`/`:67-92`），没有交叉。
2. **发现需要读入口**：证据支持。四工具中无读 store 者，且无注入路径。
3. **修订闭环不改写入契约**：尚未检验。需要先回答「检索结果要携带什么信息才能让模型完成判断与修订」，才能判断十字段是否够用。

## 10. 本文没有回答的

- 检索按什么匹配（子串 / 词 / 时间窗 / source）——是实现与产品问题，留给 Functional Review。
- 是否允许 `search_memory` 同时检索 findings 与 memories（一个名字两个目标）——契约决定。
- 记忆之间是否要有「相关」关系（M2 架构只冻结了 `supersedes` 一条链）。
