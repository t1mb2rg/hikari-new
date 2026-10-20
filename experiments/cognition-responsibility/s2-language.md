# Language 层：模型能自主决定什么，不能决定什么

范围：`src/language/`（含 `answer.ts`、`tools.ts`、`exposure.ts`、`prompt.ts`、`model.ts`、`plugin.ts`、`continuity.ts`）。
行号取自当前工作区。

---

## A. 工具选择

模型每轮返回 `tool_calls`；产品逐个解析、执行、把结果作为 `tool` 消息回灌，直到某一轮的 `toolCalls.length === 0`（`src/language/answer.ts:337-345`）。

| 能力 | 模型可否自主决定 | 由谁约束 | 文件:行号 |
|---|---|---|---|
| 这轮调不调工具、调哪一个 | **可以** | 只能从传入的 `tools` 里选 | `answer.ts:298` `toModelTools(dependencies.exposures)`；`answer.ts:340` `dependencies.step({messages, tools})` |
| 发明一个不在清单里的工具 | 不可以——解析不到就是「没听过这个名字」 | `readCall` 返回 `undefined` → 回 `UNRUN_CALL_RESULT` 并停止 | `answer.ts:425-434`；`tools.ts:10-12` 注释「A name that matches no entry is not a rejected name — it is a name this plugin has never heard of」 |
| 参数形状 | 不可以——schema 由 owner 声明重建，不由模型创造 | `DeclaredArgument`（`tools.ts:42-45`）；`additionalProperties: false` 在回程重查（`tools.ts:14-19`） | `tools.ts:59-62` `ArgumentReading = none | given | malformed` |
| 一次交互最多读几次 | 不可以——上限写死 | `Math.max(LANGUAGE_EXPOSURES.length, LANGUAGE_REPOSITORY_EXPOSURES.length) + 3` | `answer.ts:246-247`、`:429` |
| 重复读同一能力（同参数） | 不可以 | `performed.has(reading.key)` → 拒 | `answer.ts:428`、`:443` |
| 哪些能力在清单里 | 不可以 | 插件写死两份固定清单（5 条 / 6 条），composition 只能选变体 | `exposure.ts:155-161`、`:174-181`；注释 `:30-31`「the composition chooses a variant, it does not get to edit one」 |

---

## B. 综合表达

| 能力 | 模型可否自主决定 | 由谁约束 | 文件:行号 |
|---|---|---|---|
| 说什么 | **可以** | 只在有「读到的内容」时被保留为 `synthesis`，并带标签说明这是模型说的、未被核实 | `answer.ts:380-397`；`answer.ts:344-348` 注释「the answer is assembled from the readings and not from the model」 |
| 说多长 | 不可以 | 人输入上限 `MAX_LANGUAGE_TEXT_LENGTH = 8 * 1024`；模型侧有 `max_tokens` | `types.ts:167`；`model.ts` 请求体 |
| 被截断（`finish_reason: length`） | 不可以——截断即拒，不显示半句 | `if (step.truncated) return refused(truncatedLines())` | `answer.ts:382`、`:403` |
| 什么都不说 / 说空 | 不可以——空内容按「未归类」拒 | `chat === ''` → `unclassifiedLines` | `answer.ts:405-408`、`:456-465` |
| 系统提示词 | 不可以——由代码拼 | `buildSystemPrompt(contextUsed, confirmed)` | `answer.ts:288-290` |
| 模型看到的内容 | 不可以——与人看到的是同一份 | `lines.join('\n')` 原样回灌 | `answer.ts:445-448` 注释「The model is shown exactly the lines the human will be shown」 |
| 会话连续性 | 不可以——只由「确认过的句子」恢复 | `usableDialogueTurn` / `promptListsRecord` | `answer.ts:274`、`:286-287`；`continuity.ts:1-39` |

---

## C. 能力暴露边界

- 暴露清单是插件常量，不是运行时发现：`LANGUAGE_EXPOSURES`（5 条：workFocus、desktopContext、authorizedRepositoriesList、authorizedRepositoryRead、authorizedRepositorySearch）与 `LANGUAGE_REPOSITORY_EXPOSURES`（再加 `repositoryCiRelevanceRead`）。行号见上表。
- 增加一个 Service **不会**增加一个能力：`exposure.ts:150-153` 注释与固定长度的测试。
- 模型看不到自己没被暴露的能力——它连名字都没有来源。

---

## D. 模型当前被调用的全部路径

| 路径 | 触发 | 模型产出什么 | 产出如何被处置 | 文件:行号 |
|---|---|---|---|---|
| Language 对话 | 人发一问（`ask`）或带窗口授权的提问（`answerScreen`） | 工具调用序列 + 一句自然语言 | 工具调用被确定性执行；句子只在有读到的内容时保留为 `synthesis` 并加标签 | `answer.ts:269-454`；`model.ts:353` 请求体 |
| CI 补充段 | attention 每轮周期，且确定性诊断为 `insufficient('commit-comparison-indeterminate')` | 一段 ≤600 字中文 + cited | 过 schema + cited 逐字校验；通过则拼成一行追加，不通过则整段丢弃 | `src/repository-ci-diagnosis-proposal/supplement.ts:338`、`:445-449`、`:507` |

除这两处外，`src/` 里没有第三个模型调用点（`fetch(` 只出现在 `github-ci/github.ts`、`github-ci/materials.ts`、`language/model.ts`、`supplement.ts`，前两个是 GitHub API）。

---

## E. 第二个模型循环：`repository-change-executor`（本条最重要）

`src/language/` 之外还有一处模型调用，形态比 Language 强得多：**模型在 run 内部直接改文件、提交、推送。**

| 事实 | 内容 | 文件:行号 |
|---|---|---|
| 调用点 | `model.step({ messages, tools: modelTools })`，在 `for (;;)` 循环里，最多 `stepBudget` 步、`runBudgetMs` 毫秒 | `src/repository-change-executor/loop.ts:108-117`、`:30`、`:179` |
| 工具集（写死 8 个） | `read_file` / `list_directory` / `git_status` / `git_diff` / `read_ci` / **`write_file`** / **`git_commit`** / **`git_push`** | `src/repository-change-executor/tools.ts:63-116` |
| 三类效果 | read 不动任何东西；write 改工作树；两个 git 工具改「别人能看到的东西」，`git_push` **不可撤销** | `tools.ts:10-14` 注释 |
| 模型输出的落地 | `performTool(...)` 直接执行，成功即生效；`git_push` 成功置 `pushed = true` | `loop.ts:163-175` |
| 路径约束 | 每个写目标先过 `containTarget`：必须是相对路径、必须落在声明仓库根内、按真实路径（含符号链接与 Windows 短名）判定 | `containment.ts:41-45`、`:1-22` |
| 触发 | **只有人**能发起：CLI `act` → 命名管道 → executor 端点 | `src/cli/act-command.ts:25`；`plugin.ts:186-227` |
| 授权链 | mandate 原句非空 → 先写 mandate 事实 → 仓库必须在人声明的可改仓库集里 → 必须是 git 根 → runner 存在 | `execute.ts:99-170` |
| 模型不能做什么 | 不能自己发起一次新的 run；工具集里没有 `shell` / `run_command` / `delete` / `network`，也不存在运行时扩充 | `tools.ts:15-19`、`:1-8` |

**这一节推翻了「模型只持有表达权」的说法。** 准确的分工是：

- **感知与判断层**（四个 attention/relevance/proposal 模块）：模型不参与任何事实判定或重要性判断，也没有行动权。
- **行动层**（executor）：模型持有**执行内的行动裁量权**——改哪个文件、写什么内容、怎么提交、什么时候推——全部由模型决定；人给的是「改这个仓库」和一句 mandate，不是逐条指令。
- **表达层**（Language 对话 + CI 补充）：模型持有措辞权，且措辞在版面上始终带「这是我的组织，没核实过」的标签。

所以「模型有没有判断权」不是一个能一句话回答的问题：它在**执行**里判断，在**感知与取舍**里不判断。

**单看 Language 层**：最小集合是「在固定清单（base 5 条 / repo 6 条）里挑一个读，或者一个都不读」；最大集合是「多轮读、带参数读、在去重与 8/9 次读预算内自由安排顺序，最后用自己的一句话领起页面上的读数」。工具集合、参数形状、读预算、读数的含义、版面上的标签、拒绝话术、截断与转义全部由代码决定。

