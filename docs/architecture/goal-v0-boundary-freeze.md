# Goal v0 边界冻结：她自己知道还有什么没做完

日期：2026-11-06
状态：已实施并真机验证（2026-11-06）；边界文本本身仍未经独立评审
前置：`docs/architecture/core-architecture-v0.md` §6.5、`docs/architecture/hikari-end-state.md` §4 的「未决事项 → 领域模型」一行。

本文只冻结 Goal 的第一版边界，不重开架构问题。范围是一个插件、一张文件、三个工具、一段注入。

## 1. 它回答什么问题

> 「什么期望状态需要跨时间持续推进？」

冻结文档对 Goal 的定义只有两句（`docs/architecture/core-architecture-v0.md:275-281`）：表示长期承诺；**不负责自己查询世界、自己决策下一步或自己执行动作**。

所以 v0 只做一件事：**把她自己许下的、还没做完的事记下来，并在她每次开口前摆回她眼前**。推进、拆解、排期都不在这里。

## 2. 所有权

| 问题 | 结论 | 依据 |
|---|---|---|
| 谁拥有 | Hikari 全局，跨 Session 唯一 | 与 Memory 同级（`docs/architecture/core-architecture-v0.md:241-281`） |
| 存在哪 | `~/.dsh/hikari/goal/goals.jsonl`（与 `hikari/memory/` 并列） | 沿用 Memory 的 `DSH_HOME` 约定：`hikari-native/memory/store.mjs:67-92` 不看 `process.cwd()`，这里照抄 |
| 谁写 | 只有模型经 `set_goal` / `change_goal` 触发；工程负责 id、时间、校验、持久化 | 与 Memory 同一分工（`docs/architecture/m2b-memory-writing-architecture-review.md` §3） |
| 谁读 | 每个模型请求（注入）；模型主动查询（`list_goals`） | 注入先例：`hikari-native/world/findings.js:396-401` |
| 是否导出 Service | **不导出**。现在没有第二个消费者，不为未来预留 | 冻结原则「不为协调方便增加结构」（`docs/architecture/core-architecture-v0.md:308`） |

## 3. 记录形状

只追加，一行一条；同一个 `goalId` 出现多次时，**最后一次状态为准**，历史行全部保留（与 Memory 的 append-only 一致，但不做 `supersedes` 链——状态不是新版本，是同一条目标的变更）。

```json
{"goalId":"g-3f1c…","text":"把 memory.jsonl 的损坏恢复路径补上测试","status":"open","note":null,"at":1793900000000}
```

| 字段 | 谁写 | 判据 | 依据 |
|---|---|---|---|
| `goalId` | 工程 | `g-` + UUID v4 | 与 `memoryId`（`hikari-native/memory/store.mjs:44`）同形，前缀不同以免混用 |
| `text` | 模型 | trim 后 1–300 字，超过报错**不截断** | 截断等于替她改话 |
| `status` | 模型 | `open` / `done` / `dropped` | 三态；`done` = 做完了，`dropped` = 不做了（都要她明说） |
| `note` | 模型 | 可省；字符串 ≤200 字；缺省 `null` | 变状态时留一句为什么 |
| `at` | 工程 | Unix epoch 毫秒 | 与 Memory 的 `recordedAt` 同口径 |

文件不存在 = 空清单。尾部半行（写一半断电）读取时**当未写完丢弃并计数**；中间坏行 → 报错并拒绝启动（fail-closed），因为静默丢一条目标比启动失败更糟——与 Memory 对中间坏行的处理一致（`docs/development/m2a-memory-store.md` §2 损坏分类表）。

## 4. 三个工具

统一在 `hikari-native/goal/index.js` 注册，`additionalProperties: false`，错误一律 `throw new Error('<CODE>: …')`（先例：`hikari-native/memory/writing.js` §5）。

### 4.1 `set_goal({ text, note? })`

返回 `{ goalId, status: 'open', at, chars }`。

错误：`GOAL_TEXT_EMPTY`（`text is empty; write what you intend to do.`）、`GOAL_TEXT_TOO_LONG`（`{n} characters; keep it under 300 (nothing was truncated).`）、`GOAL_NOTE_TOO_LONG`、`GOAL_INVALID_INPUT`（`stateDir` / `DSH_HOME` 不是绝对路径、`note` 不是字符串）。写盘失败（磁盘满、权限）不在这里，会以 Node 原始 `Error` 冒泡——v0 没有消费者需要统一码，所以不包装。

### 4.2 `change_goal({ goalId, status, note? })`

> 名字不是 `update_goal`：DSH 宿主已经用 `create_goal` / `get_goal` / `update_goal` 占住了这三个名字（会话级任务目标），真机上第一次加载就是因为重名而整条插件不激活（`tool "update_goal" is already registered`）。Hikari 的清单是另一件东西（跨 Session 长期承诺），所以必须换名，并在 description 里写明两者的区别。

返回 `{ goalId, status, previousStatus, at }`（四个键都必填：目标不存在会先报 `GOAL_UNKNOWN_ID`，所以 `previousStatus` 不会是 null）。允许任何三态之间转换（包括 `done` → `open`：她可以说"这条其实没做完"），每次转换都追加一行，历史不丢。

错误：`GOAL_UNKNOWN_ID`（`no goal "{id}"; use list_goals to see what you have.`）、`GOAL_INVALID_STATUS`（schema `enum` 之外的运行期兜底）、`GOAL_UNKNOWN_ID`（`goalId` 缺失也报这个码）。

### 4.3 `list_goals({ status?, limit? })`

返回 `{ goals: [{ goalId, text, status, note, at, ageDays }], total }`——就是记录本身的五个字段（`note` 可能为 null）加一个 `ageDays`；`total` 是该状态的全量条数，不受 `limit` 影响。缺省只看 `open`，按 `at` 升序（先立的在前，**不是按重要性排序**——重要性由她判断）。`limit` 1–50，缺省 20。

错误：`GOAL_INVALID_STATUS`、`GOAL_INVALID_LIMIT`。

三个工具都不接受 `goalId` 由模型自填（`set_goal` 的参数里没有这个键），工程字段不可伪造——与 M2-b 的验收第 4 项同一条纪律。

码表全貌（实现为准）：`GOAL_TEXT_EMPTY` / `GOAL_TEXT_TOO_LONG` / `GOAL_NOTE_TOO_LONG` / `GOAL_INVALID_INPUT` / `GOAL_INVALID_STATUS` / `GOAL_INVALID_LIMIT` / `GOAL_UNKNOWN_ID` / `GOAL_CORRUPT`（读盘时中间行坏了，fail-closed）/ `GOAL_STORE_CLOSED`（实例已关闭）。**没有** `GOAL_STORE_REJECTED`：写盘异常原样冒泡。

## 5. 注入

用 `ctx.systemPrompt.context({ name: 'hikari:goals', order: 160, text })`，与 findings（`order: 150`）同一机制、排在它后面。

规则：

1. **只列 `open`**；`done` / `dropped` 不进注入。
2. 最多 5 条，按 `at` 升序；超出时末尾加一行「（还有 K 条没列出，用 `list_goals` 看全部）」。
3. 每条一行：`- g-xxxx（今天立的 / 立了 N 天）：<text 前 120 字>`——括号里是她自己立下这条的时间线索，不是工程对她的评价。
4. 空清单**不注入**（不输出「你没有目标」这种替她下的结论）。
5. 不排序、不标优先级、不给下一步建议、不写任何她没写下的话——**注入是她的原话的回放**，不是工程对形势的解读。

开销：5 条 × 一行 ≈ 60 token/请求；上限就是这个预算。

为什么这不违反「不自动注入长期记忆」：那条约束的对象是 Memory——检索结果必须由模型主动要（`docs/architecture/m2c-memory-discovery-interface-freeze.md` §7）。Goals 不是检索结果，是她自己的承诺，注入的只有她写下的原文。这与 World 注入当前有效 findings（`hikari-native/world/findings.js:171`、`:396-401`）是同一种做法：**scope 内的自陈事实，不是替她推断**。

## 6. 与 findings 的分工

| | Goal | Finding |
|---|---|---|
| 记什么 | 她决定去做的事 | 她对世界的假设 |
| 状态 | `open` / `done` / `dropped` | `open` / `confirmed` / `refuted` / `resolved`（`hikari-native/world/findings.js:69`） |
| 存哪 | `~/.dsh/hikari/goal/goals.jsonl` | Session 日志里的 `plugin:hikari/finding`（`hikari-native/world/findings.js:20`、`:379`） |
| 跨 Session | 是 | 否（各自 Session 投影） |
| 终止方式 | 她说不做了 / 做完了 | 证据支持、被推翻、已解决 |

一句话判据：**「我要去做」写 Goal，「我观察到」写 Finding。** 同一句话可以两边都写（先假设、再决定去做），但两张表互不读写。

## 7. 明确不做

1. 不自动创建目标（她不写就没有）。
2. 不自动推进：不拆解、不排期、不建依赖图、不算进度百分比。
3. 不判断完成：只有她说 `done` 才算。
4. 不做优先级排序（注入不排、`list_goals` 只按时间）。
5. 不与 DSH 宿主的 `goal` 工具联动（那是会话级任务清单，不是她的承诺）。
6. 不把目标推进对话流（不进 `followup`；只在 system context 里）。
7. 不删记录、不做历史压缩。
8. 不导出 Service、不发事件（v0 没有消费者）。

## 8. 验收

1. 新建目标返回 `g-` 开头的 id，文件多一行，字段齐全。
2. 关闭实例重开，目标仍在（跨进程持久）。
3. 状态从 `open` 改 `done` 后，历史两行都在，`list_goals` 默认不再列它。
4. 未知 id → `GOAL_UNKNOWN_ID`，不落盘。
5. 空正文 / 超 300 字 → 报错且不落盘。
6. 并发新建 10 条 → 10 行、id 互不相同。
7. 注入段只含 `open`、最多 5 条、每条是她原文的前 120 字，且不排序。
8. 空清单不产生注入段。
9. 写目标只落 `hikari/goal/goals.jsonl`：`stateDir` 下只出现 `hikari/`，`hikari/` 下只有 `goal/`，`goal/` 下只有 `goals.jsonl`；插件只注册三个工具与一个注入段（结构断言，见 `hikari-native/test/goal.test.mjs` 的「目录只写自己的文件」）。
10. 卸载插件后三个工具消失，其余工具不受影响。

## 9. 已知局限

- 没有「进度」概念：一条目标要么在做、要么做完。她要说"做到一半"，只能写进 `note` 或另立一条。
- 没有提醒：写了不等于会想起来，除非她读到注入段——注入在每请求都在，所以实际上很难忘掉；代价是每条目标每次都在花 token。
- 不做去重：同一件事可以立两条，靠她自己收敛。
- 文件与 Memory 目录并列但互不校验，用户手改 `goals.jsonl` 不会被检测（与 Memory 对明文的态度一致）。
