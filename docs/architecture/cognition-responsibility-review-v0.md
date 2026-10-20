# Hikari 认知职责审查 v0

**范围**：`src/` 当前工作区（`main` @ `09410ece76afae824df904582d5da9a365d1f59a`）。四个判断模块 + `src/language/` + `src/chronicle/` + `src/repository-change-executor/`。
**方式**：只读源码。本轮不改产品代码（`git status --short` 见 §10）。行号取自当前工作区。
**配套产物**：`experiments/cognition-responsibility/s1-authorities.md`（四模块权利表原始记录）、`s2-language.md`（Language 层逐项）、`s3-chronicle.md`（历史读取与反馈）。
**VERDICT**：`REVIEWED` — 判断权归属已查清；模型目前**在执行内判断，在感知、取舍、成败判定与事实化里不判断**。最大缺口不是「事实判定被代码抢走」，而是**「值不值得打扰」这个判断没有任何一个 owner**，以及**模型看不到自己上一次行动的结果**。

---

## 0. 结论

1. **四个判断模块里没有任何一处把事实判定交给模型。** `relevance`、`diagnosis-proposal`、`repository-ci-attention`、`desktop-return-attention` 的事实判定全部落在无 I/O 的纯函数或确定性代码上（§2）。模型只在 `supplement.attach` 一处出现，产出 `text` / `cited` 两个字符串字段，**没有任何 verdict 字段可以写回**（`src/repository-ci-diagnosis-proposal/supplement.ts:513`）。
2. **「重要性判断」不是一个被代码抢走的判断，而是一个根本没人行使的判断。** `relevance` 在类型注释里明确拒绝（`src/repository-ci-relevance/types.ts:16-20`：relevant 不表示重要、不表示该行动）；`diagnosis-proposal` 只判「有没有具体建议可给」；`attention` 是固定规则（三词失败集合 + 两个去重集合），无阈值、无权重；`desktop-return` 是**人配的**静默阈值，且无默认值。**产品里不存在「这次值不值得打扰人」这个判断。**
3. **模型确实持有判断权，但在执行之内。** `src/repository-change-executor/loop.ts:108-117` 是一个 `for(;;)` 循环，模型在 run 内直接调 8 个工具（含 `write_file` / `git_commit` / `git_push`，`tools.ts:63-116`）。改哪个文件、写什么内容、怎么提交、什么时候推送全部由模型决定；人给的是「改这个仓库」和一句 mandate。所以「模型有没有判断权」不能一句话回答：**它在执行里判断，在感知与取舍里不判断。**
4. **最能直接回答「该不该交给模型」的缺口有两处，都不在「事实判定」上**：一是「重要性 / 该不该介入」没有 owner；二是 `repository-change-executor.result`（模型自己上一次行动的结果）今天只用于让 `diagnosis` 换一个分支，**不进入任何 prompt**（`src/repository-change-executor/history.ts:101-121`）。模型无法从自己的行动结果里学习。

---

## 1. 分类框架：四种判断权

审查中把「判断」拆成四类，四张权利表都按这个框架标注。这个拆分本身就是结论的一部分：混在一起说「模型有没有判断权」会得到矛盾答案。

| 类型 | 问的是什么 | 今天归谁 | 能不能交给模型 |
|---|---|---|---|
| **A 事实判定** | 世界里发生了什么（这次 run 失败了没有、这个仓库是不是那个仓库、材料齐不齐） | 确定性代码（纯函数） | **不宜**。理由不是「模型不可靠」，而是这类判断有可核验的正确答案，交给模型会把「可查证」变成「不可查证」 |
| **B 重要性判断** | 这件事值不值得打扰人、值不值得花一次模型调用 | **无 owner**（见 §5） | **可以，且是当前最大空缺** |
| **C 行动授权** | 允不允许动这个仓库、动到什么范围 | 人（`cli/act-command.ts:25` 只有人能发起） | 不宜 |
| **D 执行内裁量** | 动的时候改哪个文件、写什么、怎么提交 | **模型**（`loop.ts:142-176`） | 已经是模型了 |

---

## 2. 四个判断模块的权利表

### 2.1 Repository CI Relevance

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | GitHub CI facet 这次可观测吗 | A | 确定性 | `src/repository-ci-relevance/judgement.ts:75` | `if (githubCi.kind !== 'available') return UNKNOWN;` |
| 2 | 某条声明串与 observation.repository 是否逐字相等 | A | 确定性 | `judgement.ts:87-88` | `if (designation === repository)` → `via: { kind: 'verbatim' }` |
| 3 | 人给的配对是否存在、其 githubRepository 是否逐字相等 | A | 确定性 | `judgement.ts:96` | `if (declared === undefined \|\| declared.githubRepository !== repository) return UNKNOWN;` |
| 4 | 声明串是否与 declared.localRoot 逐字相等 | A | 确定性 | `judgement.ts:99-108` | `if (designation === declared.localRoot)` |
| 5 | 两条都不成立时给 `unknown`（完成的否定判断） | A | 确定性 | `judgement.ts:112` | `return UNKNOWN;` |
| 6 | rootDir / declared 两半是否非空字符串 | A（配置） | 确定性 | `plugin.ts:160-162`、`:185-192` | `if (typeof localRoot !== 'string' \|\| !localRoot.trim())` |
| 7 | 请求词是否合法、verdict 是否在枚举内 | A（协议） | 确定性 | `protocol.ts:87` | `if (verdict !== 'relevant' \|\| verdict !== 'unknown')` |
| 8 | 端点异常 → `failed`（不折成 `unknown`） | A（判定是否发生） | 确定性 | `endpoint.ts:112`、`:121` | `reply = { outcome: 'failed', lines: [describeFailure(error)] };` |
| — | 这个仓库重不重要、该不该看 | B | **不做** | `types.ts:16-20` | 类型注释明说 relevant 不表示重要、不表示该行动 |
| — | 允不允许对这条观察做事 | C | **不做** | `types.ts:18-20` | 本层不涉及行动 |

**模型参与**：零。模型唯一相邻处是 judgement 的两行渲染（`judgement.ts:129-138`）经 `src/language/read.ts:225` 成为模型可读材料——**模型读得到结论，写不回结论**。

**确定性预定在哪**：verdict 只有两个值，且**没有** `not-relevant` / `unrelated`（`types.ts:26`）。理由写在 `types.ts:22-24`：说「无关」是关于世界的断言，本层只有字符串。反例清单写死一句（`judgement.ts:77-84`）：trim、大小写、basename、拆 owner、改 URL、认 fork、别名表、问模型——全部剔除。判定文件无 I/O、无 lifecycle（`judgement.ts:22-24`）。

### 2.2 Repository CI Diagnosis Proposal

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | snapshot 里有没有 GitHub CI facet | A | 确定性 | `src/repository-ci-diagnosis-proposal/judgement.ts:92` | `if (assessment.snapshot.githubCi.kind !== 'available') return insufficient('no-github-ci-facet');` |
| 2 | relevance 是否 `relevant`（引用上游，不重算） | A | 确定性 | `judgement.ts:97` | `if (relevance.verdict !== 'relevant') return insufficient('relevance-not-established');` |
| 3 | `different` + 无 ownAction → 建议「核对提交」 | A→建议 | 确定性 | `judgement.ts:111-112` | `ownAction === undefined ? { kind: 'check-commit-alignment', evidence }` |
| 4 | `different` + 有 ownAction → 建议「看自己那次行动」 | A→建议 | 确定性 | `judgement.ts:113-116` | `kind: 'inspect-own-action'` |
| 5 | `same` → 建议「看这次运行的步骤」 | A→建议 | 确定性 | `judgement.ts:118` | `return Object.freeze({ kind: 'inspect-run-steps', evidence });` |
| 6 | `indeterminate` → 无可给建议 | A | 确定性 | `judgement.ts:119-120` | `case 'indeterminate': return insufficient('commit-comparison-indeterminate');` |
| 7 | ownAction 查询失败是否等同「记录没说」 | A（降级） | 确定性 | `plugin.ts:66-68` | `.pushedCommit({…}).catch(() => undefined)` |
| 8 | 材料 identity 是否与本次运行相符 | A | 确定性 | `supplement.ts:485` | `if (materials.identity !== 'confirmed') return undefined;` |
| 9 | jobs / changedFiles 是否 pending / missing | A（材料齐备） | 确定性 | `supplement.ts:487-499` | `if (jobs.kind === 'pending') return undefined;` |
| 10 | 模型答案形状是否合法 | A（协议） | 确定性 | `supplement.ts:280-317` | `if (parsed.deficient === true) return ABSTAINED;` |
| 11 | 模型引用的字符串是否在材料里逐字出现 | A（可核验性） | 确定性 | `supplement.ts:445-450` | `const missing = parsed.cited.filter((value) => !corpus.includes(value));` |
| 12 | 输出是否被截断 / 端点可用 / 响应超限 | A（传输） | 确定性 | `supplement.ts:389-405`、`:429-432` | `if (finishReason === 'length')` / `if (body.length > MAX_ANSWER_BYTES)` |
| 13 | **这段材料是否足以给出具体观察（可弃权）** | **B（弱）→ 实为「够不够」** | **模型** | `supplement.ts:134-157`、`:159-177` | `{ deficient: { type: 'boolean', const: true } }` / 提示词规则 5 |
| 14 | 这段材料里最该看哪里（措辞与指向） | **B/表达** | **模型** | `supplement.ts:513` | 返回 `{ text, cited }`，`text` 内容无语义校验 |

**确定性预定在哪**：kind 封闭为四个（`types.ts:86-90`），缺席原因封闭为三个（`types.ts:64-67`），可渲染的建议类型是 `Extract` 出的三臂（`types.ts:102-105`）；类型里没有 `lines`/`text`/`message`/`summary`（`types.ts:8-10`）。数量上限写死：text ≤ 600 字、cited ≤ 5、每项 ≤ 200 字、答案 ≤ 64 KiB、completion ≤ 4096 token（`supplement.ts:112-118`）。零配置（`plugin.ts:28-32`）。

**模型参与**：**只有** `supplement.attach` 一条路，且被门夹住——只有 `insufficient-evidence` + `missing === 'commit-comparison-indeterminate'` 才可能调模型（`supplement.ts:110`、`:461-463`）。**需要如实说明的边界**：过闸之后 `text` 是**原样**追加的（`supplement.ts:513` → `src/repository-ci-attention/plugin.ts:351`），「这段话说得对不对」没有任何确定性判定；能约束它的只有「引用必须在材料里出现过」与长度上限。准确说法是：**模型不能说 Hikari 的判定，但能在带标签的附加块里说它自己的话，而这段话的正确性由引用可核验性 + 提示词约束，不由代码判定。**

### 2.3 Repository CI Attention

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | 最新 run 是否被报告 | A | 确定性 | `src/repository-ci-attention/judgement.ts:90` | `if (latest.kind !== 'reported') return undefined;` |
| 2 | run 是否已完成 | A | 确定性 | `judgement.ts:93` | `if (run.status !== 'completed') return undefined;` |
| 3 | conclusion 是否被报告 | A | 确定性 | `judgement.ts:94` | `if (run.conclusion.kind !== 'reported') return undefined;` |
| 4 | conclusion 是否属于失败三词 | A | 确定性 | `judgement.ts:32`、`:95` | `new Set(['failure', 'timed_out', 'startup_failure'])` |
| 5 | 本激活是否已处理过这次失败 | A（去重） | 确定性 | `judgement.ts:98` | `if (handledFailures.has(key)) return undefined;` |
| 6 | 之前是否已投递成功过 | A（去重） | 确定性 | `judgement.ts:99` | `if (deliveredFailures.has(key)) return undefined;` |
| 7 | 「同一次失败」的同一性 = `repository#runId` | A（身份） | 确定性 | `facts.ts:73-75` | ``return `${repository}#${runId}`;`` |
| 8 | facet 不可用即整轮沉默 | A→沉默 | 确定性 | `plugin.ts:262` | `if (githubCi.kind !== 'available') return;` |
| 9 | 说哪句：有建议用诊断渲染，没有用普通宣告 | **C（呈现选择）** | 确定性 | `plugin.ts:335-338` | `proposal === undefined \|\| proposal.kind === 'insufficient-evidence' ? speaking.speak(occurrence) : suggestionSpeaking.speak(proposal)` |
| 10 | 补充块能否附加（标签冒用即整块拒绝） | **C（内容准入）** | 确定性 | `supplement-block.ts:37` | `if (lines.some((line) => line.trim() === label)) return undefined;` |
| 11 | 投递成功才记事实 | A（记录闸门） | 确定性 | `plugin.ts:366`、`:372` | `if (outcome.outcome !== 'delivered') return;` |
| — | 这次失败重不重要、现在该不该说 | B | **不做** | `judgement.ts:120-124` | `renderOccurrence` 明说不评判「重不重要」 |

**确定性预定在哪**：失败结论是**一个字面量集合**，不是映射表也不是开放谓词（`judgement.ts:27-32`：加宽就是改这一处）；`handled` 与 `delivered` 是两个集合、语义不等（`judgement.ts:42-60`）；事实类型/来源/版本全常量（`facts.ts:40`、`:51`）；读历史时不认识的形状一律跳过不抛错（`facts.ts:129-142`）。

**模型参与**：唯一入口 `plugin.ts:345`，仅当 `proposal !== undefined`；返回块追加在**确定性句子之后**（`plugin.ts:347-353`）；任何异常回到原消息（`plugin.ts:355-357`）。**模型文本不进 Chronicle**：投递事实的 payload 只有 `{ repository, runId }`（`facts.ts:96`）。

### 2.4 Desktop Return Attention

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | 计数器是否倒退（重启 / 32 位回绕）→ 忘掉 silence | A | 确定性 | `src/desktop-return-attention/judgement.ts:96-98` | `if (observedTick < watch.observedTick)` → `silence: undefined` |
| 2 | 无输入时长（含回绕） | A | 确定性 | `judgement.ts:100` | `const silence = (observedTick - lastInputTick) >>> 0;` |
| 3 | 是否达到阈值 | A + **人配阈值** | 确定性 | `judgement.ts:102-104` | `if (silence >= afterMs)` |
| 4 | 静默是否结束 | A | 确定性 | `judgement.ts:106` | `endedSilenceMs: watch.silence` |
| 5 | 有没有任何关注对象可告知 | **B（弱）/ 存在性** | 确定性 | `judgement.ts:134` | `if (designations.length === 0) return undefined;` |
| 6 | 阈值与节拍是否在合法整数范围 | A（配置） | 确定性 | `plugin.ts:77-96` | `afterMs > MAX_SILENCE_MS` / `delayMs > MAX_TIMER_DELAY_MS` |

**确定性预定在哪**：两个上界写死（`MAX_TIMER_DELAY_MS = 2_147_483_647`、`MAX_SILENCE_MS = 0xffff_ffff`，`plugin.ts:54`/`:60`）；**没有默认值**——默认节拍与默认阈值都算这个插件替人做决定（`plugin.ts:62-65`）；`silentForMs` 是**下界**并把「（下界）」写进标签（`judgement.ts:177`、`types.ts:14-27`）。

**模型参与**：无。只调 Language 的确定性渲染器（`plugin.ts:183`）。阈值回答的是「多久算离开」，不是「重不重要」。

### 2.5 横向：四个模块的判定结构

| 模块 | 事实判定 | 重要性判断 | 行动授权 | 结构特征 |
|---|---|---|---|---|
| relevance | 确定性（纯函数，无 I/O） | 明确不做 | 不涉及 | 封闭二值 + 逐字比较 |
| diagnosis-proposal | 确定性（引用上游，不重算） | 不做「重不重要」，只判「有没有建议可给」 | 不涉及 | 三臂 `Extract` 类型 |
| attention | 确定性 | **不做** | 呈现选择（确定性） | 字面量集合 + 两个去重集合 |
| desktop-return | 确定性 | 弱（空集则不说）+ 人配阈值 | 不做 | 阈值 + 回绕 |

---

## 3. Language 的能力边界

范围：`src/language/`（`answer.ts`、`tools.ts`、`exposure.ts`、`prompt.ts`、`model.ts`、`plugin.ts`、`continuity.ts`）。

### 3.1 模型已能自主决定

| 能力 | 边界 | 文件:行号 |
|---|---|---|
| 这轮调不调工具、调哪一个 | 只能从传入的 `tools` 里选 | `answer.ts:298`、`:340` |
| 多轮读的顺序与组合 | 受读预算与去重约束（见 3.2） | `answer.ts:337-345` |
| 带什么参数读 | 参数形状由 owner 声明 | `tools.ts:42-45` |
| 最后那句话说什么 | 只在有「读到的内容」时保留为 `synthesis`，带「模型说的、未核实」标签 | `answer.ts:380-397`、`:344-348` |

### 3.2 模型不能自主决定

| 能力 | 由谁约束 | 文件:行号 |
|---|---|---|
| 发明一个不在清单里的工具 | `readCall` 返回 `undefined` → 回 `UNRUN_CALL_RESULT` 并停止 | `answer.ts:425-434`；`tools.ts:10-12` |
| 参数形状 | `DeclaredArgument` + `additionalProperties: false` 回程重查 | `tools.ts:14-19`、`:59-62` |
| 一次交互最多读几次 | `Math.max(LANGUAGE_EXPOSURES.length, LANGUAGE_REPOSITORY_EXPOSURES.length) + 3` | `answer.ts:246-247`、`:429` |
| 重复读同一能力（同参数） | `performed.has(reading.key)` → 拒 | `answer.ts:428`、`:443` |
| 哪些能力在清单里 | 插件写死两份固定清单（5 条 / 6 条），composition 只能选变体 | `exposure.ts:155-181`；注释 `:30-31` |
| 说多长 | 人输入上限 `MAX_LANGUAGE_TEXT_LENGTH = 8 * 1024` + `max_tokens` | `types.ts:167` |
| 被截断时说半句 | `if (step.truncated) return refused(truncatedLines())` | `answer.ts:382`、`:403` |
| 什么都不说 | `chat === ''` → `unclassifiedLines` | `answer.ts:405-408`、`:456-465` |
| 系统提示词 | `buildSystemPrompt(contextUsed, confirmed)` | `answer.ts:288-290` |
| 模型看到的内容与人不同 | 同一份 `lines.join('\n')` 原样回灌 | `answer.ts:445-448` |
| 会话连续性由什么恢复 | 只由「确认过的句子」 | `answer.ts:274`、`:286-287`；`continuity.ts:1-39` |

**能力暴露边界**：增加一个 Service **不会**增加一个能力（`exposure.ts:150-153` 注释与固定长度测试）。模型看不到自己没被暴露的能力——连名字都没有来源。

**全仓库模型调用点穷举**：`fetch(` 只出现在 `src/github-ci/github.ts`、`src/github-ci/materials.ts`、`src/language/model.ts`、`src/repository-ci-diagnosis-proposal/supplement.ts`。前两个是 GitHub API，因此模型路径只有两条：Language 对话、CI 补充段。

### 3.3 第二个模型循环：`repository-change-executor`

**这一节推翻了「模型只持有表达权」的说法。**

| 事实 | 内容 | 文件:行号 |
|---|---|---|
| 调用点 | `model.step({ messages, tools })` 在 `for(;;)` 里，最多 `stepBudget` 步、`runBudgetMs` 毫秒 | `src/repository-change-executor/loop.ts:108-117`、`:30`、`:179` |
| 工具集（写死 8 个） | `read_file` / `list_directory` / `git_status` / `git_diff` / `read_ci` / **`write_file`** / **`git_commit`** / **`git_push`** | `tools.ts:63-116` |
| 三类效果 | read 不动任何东西；write 改工作树；两个 git 工具改「别人能看到的东西」，`git_push` **不可撤销** | `tools.ts:10-14` |
| 模型输出如何落地 | `performTool(...)` 直接执行，成功即生效 | `loop.ts:163-175` |
| 路径约束 | 每个写目标先过 `containTarget`：相对路径、落在声明仓库根内、按真实路径（含符号链接与 Windows 短名）判定 | `containment.ts:41-45`、`:1-22` |
| 触发 | **只有人**能发起：CLI `act` → 命名管道 → executor 端点 | `src/cli/act-command.ts:25`；`plugin.ts:186-227` |
| 授权链 | mandate 非空 → 先写 mandate 事实 → 仓库在人声明的可改集合里 → 必须是 git 根 → runner 存在 | `execute.ts:99-170` |
| 模型不能做什么 | 不能自己发起新的 run；工具集里没有 `shell` / `run_command` / `delete` / `network`，也不存在运行时扩充 | `tools.ts:15-19`、`:1-8` |

**准确的分工**：

- **感知与判断层**：模型不参与任何事实判定或重要性判断，也没有行动权。
- **行动层**：模型持有**执行内的行动裁量权**——改哪个文件、写什么内容、怎么提交、什么时候推，全部由模型决定；人给的是「改这个仓库」和一句 mandate。
- **表达层**：模型持有措辞权，且措辞在版面上始终带「这是我的组织，没核实过」的标签。

**单看 Language 层**：最小集合是「在固定清单里挑一个读，或者一个都不读」；最大集合是「多轮读、带参数读、在去重与 8/9 次读预算内自由安排顺序，最后用自己的一句话领起页面上的读数」。

---

## 4. Chronicle 与 Action：历史读取与结果反馈

Chronicle 的接口只有三个方法：`append(draft)` / `get(factId)` / `read()`（`src/chronicle/service.ts:12-29`）。`read()` 返回**全部**事实，不按家族过滤——每个消费者自己筛类型与版本。**机制上任何事实都能被任何消费者读到，限制来自消费者自己写的筛选条件，不来自存储。**

| # | 事实家族 | 谁写 | 谁读 | 进入模型 prompt | 可作认知材料？ | 文件:行号 |
|---|---|---|---|---|---|---|
| 1 | `work-focus.*` | `work-focus/session.ts` | 启动时重建焦点 | **是** | 可以（已进入） | `src/work-focus/plugin.ts:55`、`:75` |
| 2 | `changeable-repositories.*` | `changeable-repositories/session.ts:91` | `readChangeableRepositories` | **是** | 可以（已进入） | `src/changeable-repositories/history.ts:54-71` |
| 3 | `language.decision-confirmed` | `language/plugin.ts:345` | `readConfirmedDecisions` | **是**（拼进 system message） | 可以（已进入，但只用于恢复对话） | `src/language/continuity.ts:64`、`plugin.ts:445` |
| 4 | `repository-change-executor.mandate` | `repository-change-executor/plugin.ts:248`（跑之前） | **无读取者** | 否 | **可以，但目前连确定性代码都没消费** | `facts.ts:39`、`:101-108` |
| 5 | `repository-change-executor.result` | 同上（跑之后） | `findPushedCommit` | 否（经 Service 以 `ownAction` 入参） | **可以，是最大缺口** | `history.ts:101-121`、`diagnosis/judgement.ts:111-116` |
| 6 | `repository-ci-attention.delivered` | `attention/plugin.ts:372` | `readDeliveredFailures` | 否 | **可以**（「这件事通知过几次」） | `facts.ts:40`、`plugin.ts:236` |

注：attention 的 occurrence 本身**不落盘**，只落「已投递」这一条。

### 4.1 必须留在原 owner 的责任

1. **成败判定**：`changed / unchanged / unknown` 三态由 `outcome.ts` 决定，是「世界有没有动」的判断，不是「这次改动好不好」的判断。
2. **事实的形状与版本**：每家族自己的 `facts.ts` 定义字段与版本号；读者遇到未知版本必须报错而不是猜（`changeable-repositories/history.ts:77-82`）。
3. **「是不是一次 occurrence」**：由 owner 比较前后状态决定，不由读取方判断。
4. **别的家族的事实长什么样**：`diagnosis-proposal/plugin.ts:17` 明确写它「不知道 `repository-change-executor.result` 长什么样」——它通过 Service 拿 `ownAction`，不解析别人的事实。这是本仓库已成立的跨模块纪律。

四个家族各自写明「不携带 Hikari 对该结果的理解」——`repository-change-executor/facts.ts:9-13` 原话：`it names one thing the family must not carry: Hikari's interpretation of the result … a fact that explained itself would be a judgement wearing a record's clothes`。

### 4.2 可作模型认知材料、但目前没有进入模型的

1. **`repository-change-executor.result`**：模型不知道上一次它参与的建议是否导致改动、改动是否成功。
2. **`repository-ci-attention.delivered`**：模型不知道这个失败是否已通知过、同一仓库最近通知过几次。
3. **`repository-change-executor.mandate`**：写了但无人读。
4. **`language.decision-confirmed` 只被用来恢复对话，不被用来判断**：`continuity.ts:21-23` 原话 `It is not a permission. Nothing in this repository reads this family to decide whether something may happen … a prompt is not an authority.`

**这四项合起来是当前最清楚的缺口：历史事实在存储层对所有消费者开放，但只有三条进了模型能看见的材料，其余全部停在确定性代码内部。**

---

## 5. 判断被确定性预定的七种方式

把「确定性代码预先决定」按机制归类。这个分类的用处是：它说明哪些「预定」是可辩护的（有可核验答案），哪些是**用规则冒充了判断**。

| # | 机制 | 例子 | 可辩护性 |
|---|---|---|---|
| 1 | **枚举 / 字面量集合** | `FAILURE_CONCLUSIONS = new Set(['failure','timed_out','startup_failure'])`（`attention/judgement.ts:32`） | 高：GitHub 的 conclusion 就是封闭枚举 |
| 2 | **封闭二值（连否定都不给）** | verdict 只有 `relevant` / `unknown`，没有 `not-relevant`（`relevance/types.ts:26`） | 高：说「无关」是世界断言，本层只有字符串 |
| 3 | **集合成员 / 去重** | `handledFailures.has(key)`、`deliveredFailures.has(key)`（`attention/judgement.ts:98-99`） | 高：这是记录，不是判断 |
| 4 | **身份相等** | `repository#runId`（`attention/facts.ts:73-75`）、逐字字符串比较（`relevance/judgement.ts:87-88`） | 高 |
| 5 | **人配阈值（无默认）** | `afterMs`、`delayMs`（`desktop-return/plugin.ts:62-65`、`:87-96`） | 中：阈值是可辩护的，但**「多久算离开」被固定成一个数之后，「这次离开值不值得说」仍然没人判断** |
| 6 | **存在性 / 齐备性** | 材料 `pending`/`missing` 即不附加（`supplement.ts:487-499`）；`designations.length === 0` 则不说（`desktop-return/judgement.ts:134`） | 中：这是「有没有材料」，常被误当成「值不值得说」 |
| 7 | **协议与可核验性** | `json_schema` + `strict: true`、`cited` 逐字命中（`supplement.ts:371-374`、`:445-450`）、标签冒用拒绝（`supplement-block.ts:37`） | 高：管形状与可核验性，**不管语义正确性** |

**这七种里，没有一种在回答「这次值不值得打扰人」。** 第 5 种最接近，但它回答的是「多久算离开」，不是「该不该说」；第 6 种回答的是「有没有材料」，也不是「该不该说」。

---

## 6. 缺口：模型看不到自己的行动结果

这是审查中最实的发现，也是最容易在「加一个 prompt 字段」和「加一个中央判断层」之间走错的地方。

**事实**：`repository-change-executor.result` 记录了一次 run 的 outcome（`changed` / `unchanged` / `unknown`），但唯一的读取者是 `findPushedCommit`，它只回答一个问题：「这个 commit 是不是 Hikari 自己推的」（`history.ts:101-121`）。这个答案只让 `diagnosis` 在 `different` 分支上换一句话（`judgement.ts:111-116`）。**模型从不知道自己上一次行动的结果。**

**后果**：模型无法从「我上次建议看 X，结果 X 是真的」这类经验里调整。它能读到的历史只有：工作焦点、可改仓库集合、人确认过的句子。这三样都是**人的状态**，不是**它自己的行动结果**。

**为什么不能靠「加一个中央认知层」解决**：`docs/architecture/core-architecture-v0.md` §11 明确禁止中央 AI Brain / 中央 Judgement / Super Orchestrator / 万能 Service / 所有交互必经的统一通信层；2026-10-13 裁决进一步点名「中央总量控制 / 中央注意力预算 / 主动介入的全局仲裁」不得重新引入。缺口的正确补法是在**现有 owner 的边界内**把已有事实接进模型材料，不是新建一个层。

---

## 7. 最小对照实验设计

目标不是证明「模型更好」，而是**在同一个事实上，测出「确定性规则的结论」与「模型在有/无某项历史时的结论」差在哪里**，从而给「哪类判断该交给模型」提供读数。

### 7.1 共同环境事实（三组完全相同）

复用已冻结的五个历史真失败 run 材料（`experiments/ci-supplement-triangulate/samples.json` 已冻结，`identity` 全 `confirmed`），覆盖四种失败形态：`surface` 单独失败、`Setup Node` 环境失败、旧 8 步 workflow 分支失败、常规测试失败（宽/窄改动各一）。

### 7.2 三组任务

| 组 | 任务性质 | 输入 | 输出 | 今天的对应物 |
|---|---|---|---|---|
| **R 组（受限 + 规则）** | 受限任务 | 只有确定性链路能产出的东西 | 今天的 `proposal` 三臂或 `insufficient` | 产品路径（`diagnosis.propose`） |
| **M0 组（受限 + 模型，无历史）** | 受限任务 | 材料 JSON + 日志（`messages = 3`，与今天一致） | `{ text, cited }` | 产品路径（`supplement.attach`） |
| **M1 组（开放 + 模型，带一项历史）** | 开放认知任务 | 材料 + 日志 + **那一项历史事实** | 自由文本 + 指向的结构化字段 | **今天不存在** |

### 7.3 要改变的那一项历史事实

**`repository-change-executor.result`**：该仓库上一次由 Hikari 发起的改动，其结果（`changed` / `unchanged` / `unknown`）与推送的 commit sha。

选择理由：
- 它**今天已经存在**（`facts.ts:40`），不需要新建事实家族；
- 它的唯一消费者只用一个分支（`judgement.ts:111-116`），**把它接给模型不改变任何现有确定性判定**；
- 它正好落在「模型能不能从自己的行动结果里学习」这个缺口上（§6）。

对照法：M1 组每对样本跑两次，只改这一项历史（有 / 无），其余输入逐字相同。

### 7.4 每步判据与推翻条件

| 步 | 判据 | 推翻条件 |
|---|---|---|
| S1 冻结 | 三组的材料、提示词、模型配置、评分规则在**任何模型调用之前**写入 `samples.json` | 冻结文件晚于第一次调用 |
| S2 R vs M0 | 在 `insufficient('commit-comparison-indeterminate')` 的样本上，M0 给出的指向（job/step/文件）与材料真值一致率 ≥ R 组（R 组在此场景为 0，因为它没有建议） | M0 的指向出现与材料真值矛盾（指向不存在的 job/step/文件） |
| S3 M0 vs M1 | 有历史的 M1 与无历史的 M0 在**指向**上有差异，且差异方向被材料支持 | 所有样本 M0 = M1（说明该项历史对模型无影响，即「接进来也没用」） |
| S4 可核验性 | 三组每个被采纳的指向都能在材料里逐字找到 | 出现材料里查不到的标识 |

**这个设计能回答什么**：如果 S3 显示 M1 与 M0 有稳定差异且方向正确，则「行动结果进模型材料」这一项**有读数支撑**；如果没有差异，则说明「模型不需要这项历史」，缺口应改写为「不需要补」，而不是「补了但没用」。

**这个设计不能回答什么**：不能证明「模型该不该拥有重要性判断权」——那需要一个「该不该打扰人」的对照，本设计里三组都只回答「失败在哪里」，不回答「值不值得说」。后者需要另一次实验，且先要 Human 决定要不要让 Hikari 拥有这个判断（因为它会直接改变打扰人的次数）。

---

## 8. 与既有架构原则的关系

| 原则 | 本次审查的结论 |
|---|---|
| `Code guards truth; models interpret meaning`（`CLAUDE.md`） | **现状符合**：事实判定全在确定性代码，模型只解释与措辞 |
| Runtime 不理解业务 | 符合：四个模块各自实现自己的 judgement，Runtime 只做 lifecycle |
| Provider 不决定 Consumer；无中央路由图 | 符合：没有中央判断层；`relevance` 的判定经 Service 被 `diagnosis` 引用，是显式 contract |
| §11 禁止中央 Judgement / Super Orchestrator / 万能 Service | **当前未违反**；§7 的实验设计也刻意不新增层 |
| 「明确不做」的纪律 | 现状大量体现：`relevance` 拒绝说「无关」，`attention` 拒绝判「重不重要」，`desktop-return` 拒绝给默认阈值 |

**一处需要 Human 注意的张力**：`desktop-return` 的「没有默认阈值」是刻意的（`plugin.ts:62-65`：默认阈值算这个插件替人做决定）。但 `attention` 的失败三词集合与去重规则同样是「替人决定什么时候说话」，只是它写成了代码常量、没有配置项。**这两处的纪律不一致**：一处认为「替人决定何时说话」需要人显式配，另一处认为可以用字面量定死。这不是 bug，但是一个需要明确裁决的口径。

---

## 9. 待 Human 裁决

**Q1｜「值不值得打扰」要不要有 owner？**
现状：无。三词失败集合 → 通知；静默超过人配阈值 → 通知。中间没有任何「这次值不值得说」的判断。
- 选项 A：保持无 owner（固定规则就是产品口径）。
- 选项 B：把这个判断交给模型，但**只给建议、不直接决定投递**（模型输出一个 `should-interrupt` 字段，由确定性代码决定是否采纳）。
- 选项 C：把判断交给人（每次通知前问人一次）——不符合常驻语义。
- 推荐：**A 或 B，不建议 C**。若选 B，必须先解决「模型说不要打扰时，误判的代价是什么」。

**Q2｜`repository-change-executor.result` 要不要接进模型材料？**
- 选项 A：接（按 §7 的 S3 先测有没有差异）。
- 选项 B：不接，缺口改写成「不需要补」。
- 推荐：**先做 §7 的 S3，用读数决定**。

**Q3｜`attention` 与 `desktop-return` 的「替人决定何时说话」口径要不要统一？**
- 推荐：统一为「凡直接影响是否打扰人的量，都必须人显式声明」——但这会让 `attention` 增加一个必需配置，属于契约变化，需要单独裁决。

---

## 10. 范围与验证

- **本轮未改产品代码**：`git status --short` 显示 `src/` 零改动（仅 `?? clear/`、`?? experiments/`、`?? docs/architecture/cognition-responsibility-review-v0.md`）。
- **未读到的部分（如实标注）**：`src/repository-ci-awareness/`、`src/github-ci/`、`src/human-delivery/`、`src/language/` 的渲染实现细节未逐行审；它们只作为依赖/调用方出现在本表的行号里。`supplement.ts` 第 1-94、225-239 行（选项类型与材料投影前半）只读到片段。
- **行号基准**：全部取自 `main` @ `09410ec` 的工作区。
- **可复核方式**：本文每张表的每一行都能用 `文件:行号` 回到源码；`experiments/cognition-responsibility/` 下三份原始记录含更细的逐项清单。
