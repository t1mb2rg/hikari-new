# SHARED EXPERIENCE CONTINUITY v0 — BOUNDARY REVIEW

状态：**已裁决，收窄为 LANGUAGE CONVERSATIONAL CONTINUITY v0，判定 L2，已实施**
基线：`main` @ `b3e64b2`（本文开头部分写作时 `git status --short` 为空；GitNexus `meta.json` 的 `lastCommit` 与 HEAD 一致）
日期：2026-10-08（评审原文）；2026-10-08（Human 裁决、收窄与判定，见 §9 之后）

> **阅读顺序。** §0–§8 是 **Human 裁决之前**的评审原文，**逐字保留**，用来说明「为什么需要一次 Human 裁决」。
> 其中的 **§7 `VERDICT = BLOCKED` 已被 §9–§14 取代**。裁决、L2 判定、Chronicle 准入判定、
> 最小实现面、以及新的 VERDICT 都在 §9 之后。
>
> 取代关系是双向的：§7 指向 §9–§14，§14 指回 §7（`governance-rules-v1.md` R7.2）。

评审原文回答的问题是：**原 Shared Experience Continuity v0 的验收案例，能不能在不越过已经冻结的边界的前提下被切出一刀。**
它当时给出的答案是「不能」，并因此提出三个问题（§5）。Human 对这三个问题作了裁决（§9），
把目标收窄成 **LANGUAGE CONVERSATIONAL CONTINUITY v0**，并授权在 L2 内直接实施。

---

## 0. 一句话结论

> **缺口不在存放处，也不在读侧能力，而在「谁有权承认它」。**
> 一次 Human 与 Hikari 在对话里形成的决定，在今天**没有任何语义 owner** 可以承认它。

存放处够用（Chronicle 的 `payload` 装得下任何形状），读侧形状也有先例（N2-01 已证明
「owner 读回自己的事实」合法）。卡住的是**归属与信任**：这条材料既不是任何一个现有 owner 有权断言的命题，
也不能诚实地归给「人类」。

---

## 1. 验收案例需要四种能力，逐条判定

验收案例（本轮 mandate §1）：Human 与 Hikari 讨论后明确决定 X → 结束并重启 Resident →
Human 说「继续之前的工作」→ Hikari 找到那次决定、理解它、并让它影响回答。

把它拆成四种必须同时成立的能力：

| # | 能力 | 今天是否成立 | 卡在哪 |
| --- | --- | --- | --- |
| C1 | 把这次互动的**含义**durable 记下来 | **否** | 没有语义 owner（§3.1） |
| C2 | 诚实**归属**这条记录 | **否** | `{ kind: 'human' }` 被禁止（§3.2） |
| C3 | 重启后**读回**它 | **否** | 唯一可能承载它的 owner 被明令禁止读回自己的历史（§3.3） |
| C4 | 把过去与**当前情境**关联起来 | **否** | 唯一合法的关联是逐字相等（§3.4） |

**四种能力各自独立地被挡，且各自的挡法都不一样。** 因此不是「换个实现就能过」。

---

## 2. BOUNDARY CHECK A–F

以下每条都重新锚定到基线 `b3e64b2` 的源码。**子代理的发现只作候选，本节的结论以源码为准。**

### A. Language 的对话上下文与生命周期

- `src/language/plugin.ts:371` 的 `requires` 逐字是
  `[workFocusCurrentService, desktopSessionAwarenessPeekService]`；模型可读的能力闭集是
  `src/language/exposure.ts:114-117` 的 `LANGUAGE_EXPOSURES = [workFocusReadExposure, desktopContextReadExposure]`。
  **即：模型今天已经能在一次 `ask` 里读到当前工作焦点**（`src/language/read.ts:80`
  按 `exposure.service === workFocusCurrentService` 派发）。
- 跨调用状态**只有一处**：`src/language/answer.ts:135` 的 `let turn: DialogueTurn | null = null`，
  形状是 `{ reads: readonly string[]; at: string }`（`src/language/dialogue.ts:49-54`）——
  **上一轮 grounded 回答读过哪些能力名**，没有内容、没有历史材料。
  它在 `plugin.ts` 的 `setup` 里构造一次，因此寿命 = 一次 activation；TTL 5 分钟
  （`dialogue.ts:64`），第二轮**替换**第一轮而不是追加（`dialogue.ts:8-9` 逐字：
  「second turn does not append to the first; it replaces it」）。
- **零持久出口**：`src/language/**` 对 `writeFile|appendFile|createWriteStream|Chronicle|\.append\(`
  的命中**全部落在注释里**，每条注释说的都是相反的（`plugin.ts:102-106` 逐字：
  「there is no file, no store and no Chronicle entry anywhere behind this plugin」）。
  唯一的 `node:fs` import 是 `endpoint-path.ts:21` 的 `realpathSync`（只读路径规范化）。
- 模型的消息数组是 `answer.ts:146-149` 的**每次请求局部变量**，调用结束即被回收；
  没有 session id / topic / context window 管理（`sessionId|conversationId|contextWindow` 全仓零命中）。
  `LANGUAGE_TOPICS` 已被删除，只剩记录删除原因的注释（`exposure.ts:65-80`）。

**A 的结论**：Language 是一个**表达能力**，不是内容 owner；它没有任何 durable 出口，
而且这是**设计如此**，不是待补的缺口。

### B. Human ingress 的可信来源与身份边界

- 人说的话今天有四条进路，全部终止于两条命名管道（`grep -rn "createServer" src/` 共六处，
  其中接受人类文本的只有两处）：
  `ask`（CLI / TUI / Human Surface，三条客户端）→ language 管道；`focus declare|replace`（CLI）→ work-focus 管道。
  `human-delivery/endpoint.ts:68-85` 的 `createServer` 回调**只注册 `unref`/`setEncoding`/`error`/`close` 四个 handler，没有任何 `'data'` handler**——
  它是**只写出站**，且 `human-inbound-v0-boundary-review.md:416` 明令「不给人 delivery 加反向」。
- **没有任何认证、会话、令牌、调用者身份**。端点回调不做任何身份工作。
  `human-inbound-v0-boundary-review.md:419` 逐字：本轮「**不**裁决『Hikari 能证明什么关于说话者』」，
  且 `:305` 记下该问题「**今天没有 owner**」。
- `src/chronicle/types.ts:8-11` 的 `FactSource` 是
  `{ readonly kind: string; readonly reference?: string }`——
  **`kind` 是自由字符串，不是闭集**。运行期校验（`fact.ts:148-150`）只要求非空字符串。
  因此 `{ kind: 'human' }` **在类型与运行期都拦不住**，它被拦住靠的是教义 + 测试。
- 禁令原文 `docs/development/durable-fact-admission-v0.md:128-130`：
  「`source` **只声称可证明的部分**……`{ kind: 'human' }` **被禁止**——入口没有任何身份认证，
  这条管道上任何本机进程都能声明一个工作焦点，写成 `human` 是在断言一个这里没有任何东西建立过的身份。」
  代码侧同一条：`src/work-focus/facts.ts:26-33`（`WORK_FOCUS_SOURCE_KIND = 'work-focus.endpoint'`），
  并有测试钉住（把它改成 `'human'` 会让测试变红，`durable-fact-admission-v0.md:274` item J）。
- 生产写入者只有两个，`source.kind` 只有两个字面量：
  `work-focus.endpoint` 与 `repository-ci-attention.delivery`。**两者声称的都是「哪条管道」，
  不是「哪个人」。**

**B 的结论**：`Human utterance ≠ 已验证的世界事实` 不是一句谨慎，是**当前 ingress 的机械性质**。
Hikari 能证明的上限是「某个本机进程往我的端点写了这段文本」。

### C. Chronicle 的事实准入规则

- 判据是**语义状态转变**，不是命令到达。`durable-fact-admission-v0.md:82-84` 逐字：
  「Chronicle 记录的是 Work Focus 的**语义状态转变**，不是端点上的命令审计。」
  四类语义 no-op 承认**零**事实（`:86-91`）。
- 只有**语义 owner** 可以承认关于自己 concern 的事实；payload 从刚发生的转变构造，
  不从 `current()` 事后推导（`facts.ts:8-9`、`durable-fact-admission-v0.md:118-136`）。
- **不得加入**：importance / salience / confidence / relation / memory 字段 / 通用认识论 schema / 任何判词
  （`:135-136`）。Chronicle 只保存**发生过什么**，不解释**这意味着什么**。
- 事实**不可修订**；Chronicle 无 update、无哈希链、无序号，`read()` 是**全量 append-order 扫描**，
  无 query / 无过滤 / 无分页（`src/chronicle/contracts.ts:4-8`、`store.ts:67-79`）。
  `get(factId)` 的**生产调用者为 0**。

**C 的结论**：准入规则本身是清楚的，并且**没有任何一条允许「端点收到一段人类文本」被直接承认**。
把对话原样写进 Chronicle，正是 `:82-84` 点名否定的「命令审计」。

### D. Work Focus 已有的持久化与 ownership

- `src/work-focus/` 是**唯一供人写入、且会写 Chronicle 的 owner**。
  事实族只有三条（`src/work-focus/facts.ts`）：`work-focus.declared@1` / `replaced@1` / `cleared@1`，
  payload 分别是 `{designation}` / `{designations}` / `{}`；`status` 是语义 no-op，产生零事实。
- 它**不读回自己的历史**，而且是**刻意的**。`src/work-focus/session.ts:17-19` 逐字：
  「The history cannot restore the state. Nothing here reads a fact back, and a new activation still
  starts from `emptyWorkFocus()` — which is what keeps `chronicle read()` a record of what happened
  rather than a second place the work focus lives.」
- mandate 把这条状态写成**正确行为**而不是缺口。`docs/development/current-stage.md:151` 逐字：
  「**历史也不能恢复状态**——重启之后 Work Focus 仍然从空开始（state 在 activation 闭包里），
  而 `chronicle read()` 仍然读得到上一轮生命周期写下的事实。
  **这两者同时成立是本轮的正确行为，不是待修的缺口，有一张测试同时钉住两半。**」
- 「让 work-focus 读回自己的历史」已经被一份冻结裁定逐字否掉：
  `docs/architecture/memory-reactivation-v0-boundary-review.md:189` 的候选 (e) → **不成立**，
  理由「直接撞 `session.ts:17-19` 与 mandate 冻结禁令」。

**D 的结论**：唯一能承载「人类声明过的东西」的 owner，**被明文禁止把它读回来**。

### E. 已有的历史读取、存储与时间语义

- **读侧先例是存在的，而且是我方先例。** N2-01（`b3e64b2`）让
  `repository-ci-attention` 在每个 activation 开始读回**自己私有 fact 家族**：
  `src/repository-ci-attention/plugin.ts:161` 是 `src/` 里**唯一**的 `.read()` 生产调用点。
- 它的边界是**形状白名单**，不是时间窗：`src/repository-ci-attention/facts.ts:125-148` 逐条要求
  `type === 'repository-ci-attention.delivered'`、`version === 1`、`payload.repository` 是 string、
  `payload.runId` 是 safe integer，然后**只返回 `ReadonlySet<string>`**（键而非对象），
  理由是「handing back the objects would invite a caller to start reading payloads this owner's
  vocabulary does not cover」。**没有时间窗、没有 limit、没有 cursor、没有分页。**
- 时间语义：`occurredAt` 由写入方在**发生时刻**读一次（`work-focus/facts.ts:52`、
  `repository-ci-attention/facts.ts:94`）；`recordedAt` 由 Chronicle core 在**写入时刻**设
  （`src/chronicle/fact.ts:33`）。两者都是严格 UTC ISO-8601 毫秒，有校验（`fact.ts:18,218-222`）。
- 失败方向：读失败**不抛错、不猜**，退化为空集，且方向是「偏向说话，绝不偏向沉默」
  （`plugin.ts:149-153`）。

**E 的结论**：**「owner 读自己的过去」这个形状是合法的、有先例的、有测试的。**
它不在冻结之外——它已经是既有架构的一部分。

### F. 可复用的 bounded consumer

- 可复用的是**模式**，不是组件：`readDeliveredFailures` 的「类型 + 版本 + 载荷形状白名单 → 键集合」
  是今天唯一被验证过的有界读法。
- 但把它套用到本轮**没有落点**：它要求一个「有自己的私有 fact 家族、且需要读回来的 owner」。
  验收案例里的那条材料**不属于任何现有 owner 的 fact 家族**（见 §3.1）。
- 缺席证据（`src/` 内，排除注释）：`experience` **0**、`recall` **0**、
  `memoryService` / `decisionService` **0**。全仓没有第二个事实族。

**F 的结论**：没有一个可以现成复用的 bounded consumer；而且**不能为了给它找材料而制造需求**
（`memory-reactivation-v0-boundary-review.md:20,393` 逐字：**「也不要为了给 Chronicle 找 reader 而创造需求。」**）。

---

## 3. 四种能力各自撞上哪条冻结

### 3.1 C1 —— 这条材料没有语义 owner

对话的内容是关于**Hikari 自身神经系统怎么开发**的决定。今天没有任何 Plugin 的 concern 覆盖它：

- `language` 的 concern 是**表达**，不是内容；它零 durable 出口是设计（§2A）。
- `work-focus` 的 concern 是**人类指定的当前工作对象**；一次讨论留下的理由不是一条 designation。
- 其余 owner 各管自己的域，没有一个跨域。

**新建一个 owner 来收集这类材料，正是禁止清单上的东西**：`core-architecture-v0.md` §11
（中央 AI Brain / 中央 Judgement / Super Orchestrator / GlobalWorldState / 万能 Service /
万能消息对象 / 所有交互必经的统一通信层），也正是本轮 mandate §4 NON-GOALS 明列的
「全局记忆中心 / 通用 Memory API / 全量聊天记录注入 / 全局模型 Router」。

### 3.2 C2 —— 归属只能要么不真、要么不载义

两条路，各自关门：

- 写成 `{ kind: 'human' }` → **被禁止**（§2B）。这不是偏好，是入口没有认证这一机械事实。
- 走 work-focus 端点写成 `{ kind: 'work-focus.endpoint' }` → 归属**诚实**，
  但它承载的命题变成「这条管道收到过一个 designation」，**不是**「我们决定了 X」。
  一次讨论留下的理由**被丢掉了**，剩下的东西不足以支撑验收案例的「准确理解之前已经确定的方向」。

### 3.3 C3 —— 读回被明文禁止

即便接受 §3.2 的窄化（只记 designation），跨重启读回仍然撞两条：

- `memory-reactivation-v0-boundary-review.md:189` 候选 (e) → **不成立**。
- `current-stage.md:151` → 「重启之后 Work Focus 仍然从空开始……**是本轮的正确行为，不是待修的缺口**」。
- `src/work-focus/session.ts:17-19` 的实现级理由：读回会让 `chronicle read()` 变成
  「a second place the work focus lives」。

**注意这里有一个真实的反例张力，必须如实记录**：N2-01 已经证明「owner 读回自己的过去」合法
（§2E）。因此 §3.3 的禁止**不是形状禁止，而是对 `work-focus` 这一位 owner 的具体裁定**。
两者不是同一条规则的两种读法，而是两次分别作出的裁定——**这正是需要 Human 重新裁决的地方**，
不能由执行 Agent 自行选择读哪一条。

### 3.4 C4 —— 关联没有 owner

`memory-reactivation-v0-boundary-review.md:379-388` 的三条解锁条件**必须同时**成立，其中第 3 条是
「过去材料与当前 cue 之间的 association / relevance ownership 明确」。
今天**唯一合法的关联是逐字相等**（`repository-ci-relevance`，已冻结、已有测试，
`current-stage.md:1432`）。任何语义层面的「这段过去和现在这个问题相关」都要求一个
新的比较机制；而那个机制无论叫 relevance 还是 association，跨域即是中央判断。

---

## 4. 反事实检查：为什么最小的候选也不成立

本轮 mandate §3 要求「保留历史时回答受其影响；移除历史时不再表现出记得」。逐一检验候选：

| 候选 | 能否通过反事实 | 卡点 |
| --- | --- | --- |
| 把对话原文写进 Chronicle | 能（有/无历史会不同） | 撞 §3.1（无 owner）+ §3.2（归属不真）+ C 的「命令审计」禁令 |
| 把模型对对话的解读写进 Chronicle | 能 | 撞 `experience-formation-v0-research.md:133-142`（**模型不是任何东西的 owner**），且撞本轮 mandate §2 本身 |
| 用 work-focus 承载 + 读回 | 能 | 撞 §3.3 的两条冻结；且丢了理由，答不出「准确理解已确定的方向」 |
| 每次把全部历史塞进 prompt | 能，但**不是**「关联」 | 撞 `experience-formation-v0-research.md:395-397` 的 F5（它明确说这**不是** reactivation） |
| 新建 Experience / Memory owner | 能 | 撞 §11 禁止清单 + mandate §4 NON-GOALS |

**五个候选全部不成立。本轮没有可以诚实切出的实现切片。**

---

## 5. 需要 Human 裁决的最小问题

只有三个问题。**前两个不定，第三个无法回答。**

### Q1（信任/身份 —— 本轮 mandate §2B 直接指向的那一个）

**Hikari 可以 durable 记录关于「人说过的一句话」的什么，凭谁的授权？**

- (a) **什么都不记。** 保持 `{ kind: 'human' }` 禁止不变，接受「对话内容永不成为 durable 材料」。
  → 本轮验收案例**无法满足**，只能在「owner 自己的过去」这条线上另找真实需求。
- (b) **批准一条更窄但为真的来源。** 不引入身份机制，只承认「某个显式的人类动作经某条既有端点到达」
  ——这正是 `work-focus.endpoint` 今天的形状。代价：**只记动作，不记理由**。
- (c) **授权一个真实的身份机制。** 让入口能证明说话者是谁。这是**新的信任基础设施**，
  架构级别 C（新公共基础设施 + 难以撤回的 public contract）。
  `human-inbound-v0-boundary-review.md:419` 明确记下这个问题**今天没有 owner**，
  本轮 mandate §2 也点名要求先明确「最小需求及对应的架构级别」。

### Q2（owner）

**哪一位 owner 有权承认「一次对话里形成的决定」？**

今天**没有**。可选形态只有两类：
work-focus 的窄化（人类显式的 declaration 就是那次承认动作），或者由 Human 明确裁决新建一位 owner
（后者与 §11 / mandate §4 直接冲突，需要显式豁免而非默认）。

### Q3（具体冻结是否解除）

**`work-focus` 读回自己历史的那条冻结，是否解除？**

需要的裁决形态是明确的：`memory-reactivation-v0-boundary-review.md:189` 候选 (e) 与
`current-stage.md:151` 对一个**具体的、有界的、只读的、明确标注为「过去」**的能力是否放行，
还是原样维持。**N2-01 的先例（另一个 owner 读回自己的过去）是否构成可类推的依据，
必须由 Human 说，不由执行 Agent 类推。**

---

## 6. 已经成立的部分（不夸大）

必须如实记下：**这条回路在一次 activation 内今天已经通了。**

```text
hikari focus declare "<designation>"      → work-focus 端点 → 真的改变集合 → 写 durable fact
hikari ask "..."                          → language → 模型调用 work_focus_read
                                          → 读 work-focus.current@1 → 回答可受影响
```

链条两端都在源码里（`exposure.ts:114-117`、`plugin.ts:371`、`read.ts:80`、`focus-command.ts`），
**唯一断掉的是重启那一步**（`session.ts:17-19`）。

这意味着：**如果 Human 在 Q3 上放行，本轮的实现面会非常小**——它落在
「work-focus 暴露一个有界的、明确标注为过去的只读面」这一条边上。
但在 Q1/Q2 裁决之前，这条边**不能建**：它会让 Hikari 在重启后表现出「记得」，
而它记得的东西的来源今天无法诚实声称。**失败时不伪装记忆**（mandate §5）要求先解决归属，再解决读回。

---

## 7. Verdict

> **本节已被取代。** 它是 2026-10-08 Human 裁决**之前**的判定，原文保留，是 §9 存在的原因。
> 取代它的记录在 **§14**，那里也是本文件当前有效的 VERDICT。反指针：§14 → §7。

```text
VERDICT = BLOCKED
```

**BLOCKED 的含义**：本轮**不实现任何代码**。验收案例所需的四种能力各自独立地撞在一条**已经冻结**的
边界上，且其中三条（`{ kind: 'human' }` 禁令、work-focus 读回禁令、`§11` 禁止清单）
**不能由执行 Agent 自行放宽**。

**为什么不是 NARROW**：NARROW 的前提是存在一个「更小但仍然真实」的切片。
本轮的每一个更小候选都**同时**丢失了验收案例的必要成分（§3.2 丢理由、§3.3 撞冻结），
或者本身就是禁止形态（§4 表格）。**本轮不存在一个能通过反事实验证的诚实切片。**

**为什么不是 READY**：见 §3。

---

## 8. 解锁条件（记录，不是批准）

本轮要重新开启，需要**同时**出现：

1. **Q1 有裁决**，且形态是 (b) 或 (c)——(a) 意味着本轮验收案例作废，需要重新提一个真实需求。
2. **Q2 有裁决**：明确哪一位 owner 承认这类材料，或明确「不存在这样的 owner，本轮不做」。
3. **Q3 有裁决**：work-focus 的读回冻结解除或维持，二者都是合法答案。
4. 若 Q1 选 (c)：还需要一次针对**身份机制**的独立 Boundary Review
   （新的信任基础设施 = C 级架构工作，不在本轮范围内）。

**明确不做**：不为促成解锁而创建 Salience / Importance Judgement、generic recall substrate、
`memoryService`、semantic association、confidence、embeddings / vector DB，
**也不为了给 Chronicle 找 reader 而创造需求**
（`memory-reactivation-v0-boundary-review.md:20,393` 逐字）。

---

## 9. Human 裁决（2026-10-08）

Human 收到本文的 BLOCKED 报告后作出正式裁决。**§5 的三个问题由此全部关闭**，
目标被收窄为 **LANGUAGE CONVERSATIONAL CONTINUITY v0**。裁决要点如下（按裁决自身的主语逐条落纸）：

| # | 裁决 | 本文中被它关闭的问题 |
| --- | --- | --- |
| 1 | **对话历史的保存，不等于可信人类身份认证。** 允许记录：本地 Language ingress 收到过的对话材料；经明确交互确认的决定陈述；对应的来源、时间和信任等级。**不得**把这些内容宣称为：已认证 Human 身份 / 已验证世界事实 / 自动授予的执行权限 / 其他 domain 的权威状态。 | §5 Q1 |
| 2 | **Language 可以拥有 bounded conversational continuity。** 它保存和恢复自己负责的对话连续性材料；**不得**获得其他 domain 的判断权，**不得**升级为通用 Memory / Experience 中心。 | §5 Q2 |
| 3 | **Work Focus 的现有重启语义保持不变。** 不得为了对话连续性恢复 Work Focus current state。 | §5 Q3（**维持**冻结，见 §10.3） |
| 4 | **原 Shared Experience Continuity 的目标过宽**，收窄为 LANGUAGE CONVERSATIONAL CONTINUITY v0。第一版只验证：明确交互确认的决定陈述 → 有来源的持久记录 → Resident 重启 → 相关对话重新使用该记录 → 当前回答受到正确影响。不要求自动提炼所有对话。 | §1、§4 全表 |
| 5 | 检查 Chronicle 准入语义是否允许把「经本地对话确认的决定陈述」记录为来源受限的历史事实。**如果允许，优先复用 Chronicle。如果不允许，不得伪造 `FactSource.kind` 或绕过 Durable Fact Admission。** 评估最小的 Language-owned 持久化是否更合适，**但不得默认新建通用 Memory Store**。 | §11 |
| 6 | 历史材料重新进入 Language 时，**必须作为低信任来源内容处理**，不能被解释为新的系统指令或授权。 | §12.3 |
| 7 | 若收窄后的方案能在 Governance v1 允许的 **L2** 范围内实施，**更新本文并直接完成最小实现**；若仍有真正的 L3 blocker，只报告具体触碰的 MUST 条款及最低必要裁决。**不要重新发散为完整认证平台设计。** | §10 |
| 8 | **十项验证要求**（见 §13）。 | §13 |
| 9 | 另记一个独立产品待办 **HIKARI BOOTSTRAP / LAUNCH EXPERIENCE v1**（§15）。 | —— |

### 9.1 三项判定对 §5 三个问题的回答

- **Q1 → (b) 的更窄形态，且不触及身份机制。** 裁决不引入 (c)（身份基础设施），也不选 (a)（什么都不记）。
  它允许记录的是**人类自己作出的、明确的确认动作**，并且**只按能证明的东西归属**（§11.2）。
  §5 里"只说动作、不记理由"的代价被裁决显式接受并**重新划定了边界**：记的是**人类确认的那句话本身**，
  不是 Hikari 对那次对话的解读。
- **Q2 → Language 本人。** §3.1 说「这条材料没有语义 owner」——裁决**指定了 owner**：
  Language 自己的 concern 就是它的**对话连续性**。这不是新建中央 owner，而是把
  「一次对话留下的连续性材料」归给**说出那些话的那个 surface**。
  §3.1 点名的禁止形态（Global Memory / 通用 Memory API / 中央 Judgement）**一条都没有被建**。
- **Q3 → 维持。** 裁决第 3 条原样保留 Work Focus 的读回禁令。`src/work-focus/session.ts:17-19` 与
  `current-stage.md:151` **一个字节不改**，§3.3 的两条冻结**继续有效**。
  本轮因此**不触碰**任何工作焦点状态，也就不需要 R7.2 意义上的「解除指针」。

---

## 10. L2 判定

### 10.1 级别 = L2

按 `governance-rules-v1.md` R5 的 L2 行，**「给既有 contract 加 consumer」**本身就触发 L2，
与本轮的 diff 大小无关。本轮两处都踩在这一行上：

1. Language 成为 `chronicleService`（`src/chronicle/contracts.ts`）的**新 consumer**。
2. Language **新增一条自己的事实族**（`language.decision-confirmed@1`），
   即 Language 的 concern 从「表达」扩到「表达 + 自己对话连续性的持久化」。

这与裁决第 7 条的预期一致（「能够在 Governance v1 允许的 L2 范围内实施」）。

### 10.2 R4 四条管辖扩张判据：全否

L2 已由 R5 决定，但四条判据仍要逐条记，因为它们决定了**实现形态**（不得用「加一个字段」完成）：

| # | 问题 | 判定 | 理由 |
| --- | --- | --- | --- |
| Q1 | 让 owner 回答一个它今天不回答的问题吗？（算出没有任何 source 报告过的**新量 / 新单位 / 新轴**） | **否** | 记录的内容是**人类逐字写下的一句话**，不计算任何量，不产生新单位。裁决 §9 第 1 条明令它**不得**成为「已验证世界事实」。 |
| Q2 | 在备选项之间做**选择**吗？（排序 / 优先级 / 评分 / 挑最重要的） | **否** | 有界读的截断**只按 append 顺序取尾部**——那是记录**自己的**顺序（Chronicle 无序号、无哈希链，顺序即发生顺序），不是这里形成的判断。没有任何按内容排序的机制。**若将来改成按任何内容属性排序，本条立即翻成「是」。** |
| Q3 | 解释**上游刻意不封闭的词表**并升为全局语义吗？ | **否** | 陈述是自由文本，**只被逐字搬运**，从未被解释。类型名与版本是闭集，`payload` 只有一个字段。 |
| Q4 | 决定一件**人类和 source 都没给出**的事吗？（阈值 / 权重 / 策略） | **否** | 陈述是人的原话；来源是「哪条管道」这一机械事实；时间是记录自己的时钟。没有阈值、没有权重、没有策略。有界读用的界是**既有的** `MAX_LANGUAGE_TEXT_LENGTH`，**不新增可调量**。 |

### 10.3 触碰到的 R2 类别

**零条 MUST 被触碰**，因此**没有 L3**：

- `{ kind: 'human' }` 禁令（§3.2）：**维持**。本轮不写 `human`，写 `language.endpoint`（§11.2）。
- `work-focus` 读回禁令（§3.3）：**维持**（裁决第 3 条）。
- `core-architecture-v0.md` §11 禁止清单：**一条都没有被建**（§12.4 逐条核对）。
- Chronicle 准入教条：**遵守**，未绕过（§11）。

---

## 11. Chronicle 准入判定：允许，且优先复用

### 11.1 结论

**允许。** 因此按裁决第 5 条**优先复用 Chronicle**，**不新建**最小的 Language-owned 持久化，
**更不新建**通用 Memory Store。

### 11.2 为什么这不是 §3.1 / §C 点名否定的「端点上的命令审计」

§3.1 与 §2C 否掉的是「把对话原文写进 Chronicle」。裁决第 4 条把目标收窄之后，
被记录的**不是对话**，而是**人类在明确交互里确认过的那一句决定陈述**。四条理由，逐条可核对：

1. **被承认的是一次语义状态转变，不是命令到达。** `durable-fact-admission-v0.md:82-84` 的口径是
   「记录语义状态转变，不是端点上的命令审计」。这里的状态就是 Language 自己的对话连续性：
   **确认之前这条决定不属于它，确认之后属于它**。这与 work-focus 的 `declare` 移动集合是同一种转变。
   与 work-focus 一样，**只问不记的那个词产生零事实**：`ask` 永不写入（§13 item 2），
   正如 `status` 产生零事实（`facts.ts:47`）。
2. **payload 从刚发生的转变构造，不从 `current()` 事后推导。** 载荷只有一个字段 `statement`，
   逐字来自**本次确认请求**的文本。这是一条只有五个字段的封闭 `payload`，它不说"某个命令到达了"——
   没有 word 字段、没有调用者、没有参数回显。
3. **语义 owner 就是承认它的人。** 裁决第 2 条把「自己对话连续性」的 concern 判给 Language；
   记录它的事实族因此属于 Language，而不是借用别的 owner 的词汇。
4. **归属只说能证明的事。** `source.kind` 逐字是 `language.endpoint`——
   与 `WORK_FOCUS_SOURCE_KIND = 'work-focus.endpoint'`（`src/work-focus/facts.ts`）
   同一条规则：**声称的是哪条管道，不是哪个人**。`{ kind: 'human' }` **不被写、不被伪造、不被绕过**。

### 11.3 禁止字段：零命中

`durable-fact-admission-v0.md:135-136` 的清单逐条核对：无 importance、无 salience、
无 confidence、无 relation、无 memory 字段、无通用认识论 schema、无任何判词、无 owner 字段。
`payload` 是 `{ statement: string }`，仅此一项。

### 11.4 「来源、时间和信任等级」怎么被承载（裁决第 1 条）

- **来源**：`source.kind = 'language.endpoint'`（结构性，唯一的读法就是"经 Language 自己的入口到达"）。
- **时间**：`occurredAt` 在确认发生的那一刻读一次；`recordedAt` 由 Chronicle core 在写入时设。
- **信任等级**：由**事实族本身**承载——类型名说的是"一次经本地显式动作确认过的陈述"，
  且它是这个家族里**唯一**的成员。**没有 confidence 一类标量**：加一个就是 §11.3 禁止清单上的东西。
  信任等级在这里是一个**名词**，不是一个分数。

---

## 12. 最小实现面

### 12.1 一条新的词：`confirm`

`LanguageWord` 从 `'ask'` 变成 `'ask' | 'confirm'`。第二个词是**最小的诚实形态**：

- 裁决第 4 条要求「**明确**交互确认」。把确认折进 `ask` 会让「问一句话」和「确认一条决定」共用一个词，
  而 §13 item 2 要求 `ask` **永不写入**——两者共用一个词时那件事就无法从形状上保证。
- 它沿用本仓库既有的形状：**一个词，一个动词，一个端点**（`focus declare|replace|clear|status`、
  `work-focus/types.ts` 与 `desktop-session-observe/types.ts` 都是这个形状）。
- 客户端沿用 `hikari focus declare` 的三段失败面（`answered` / `absent` / `unavailable`，见 `src/cli/focus.ts`）。

### 12.2 第五种 reply outcome：`recorded`

写入既不是 `chatted`（模型说了话）、也不是 `answered`（`answered` 的定义是"至少读过一个 capability"，
这里一个都没读），更不是 `refused` / `failed`。因此新增 `recorded`，
并同步 `types.ts` 的联合与 `protocol.ts` 里那份**手写的** outcome 清单
（那份清单本来就是「a fifth outcome fails to decode loudly rather than silently」的落点）。

**确认失败怎么落**：追加失败时**不**沿用 work-focus 的 `ok` + UNCONFIRMED 行。理由是可核对的：
work-focus 的状态变化**先于**追加且独立于它（集合已经动了），所以「变化成立 + 记录未确认」是诚实的；
这里**追加本身就是那件事**，追加失败意味着**什么都没发生**。所以走 `failed`——
它逐字就是「a contract the answer is grounded in rejected on the way」。**不写「已记下」这类话。**

### 12.3 读回路径：activation 时一次有界读 → 低信任 prompt 材料

**做法**：Language 在 activation 时读回自己的私有事实族一次（N2-01 的
`repository-ci-attention` 先例，`src/repository-ci-attention/facts.ts` 的
「类型 + 版本 + 载荷形状白名单 → 识别不了就跳过」），结果留在 activation 闭包内，
每次回答时以一个**低信任、带来源**的段落进入**模型上下文**。

**为什么不做新 exposure**（三个理由，缺一不可）：

1. **Runtime 硬事实。** `src/runtime/runtime.ts` 的 `#requirementsSatisfied` 对 `requires` 做 `every`，
   而 `#services` 只在 `setup` 期间由 `context.services.provide` 填充——
   **插件不能 require 自己 provide 的 Service，会永久停在 `waiting`**。
   因此"Language 暴露一条指向自己的 exposure"这条设计**不可实现**。
2. **指向 `chronicleService` 是范畴错误。** 那条 capability 的 owner 是 Language（裁决第 2 条），
   不是 Chronicle；而且它会把 Chronicle 变成任何插件都能读的通用入口。
3. **"把全部记录做成一个 grounded block"会把「相关时重用一个记录」变成「倾倒全部记录」。**
   exposure 的语义是「模型可以读的一个 capability」，不是「一份上下文材料」。

**裁决第 6 条因此是结构性满足的，不是靠承诺**：在 Hikari 里，**没有任何代码把一条已确认记录
读作决定、授权或门禁**。这条记录的唯一消费者是 prompt 构造函数。它不参与任何判断、
不改变任何状态、不解锁任何东西。

**有界**：单一派生预算 = 既有的 `MAX_LANGUAGE_TEXT_LENGTH`，**最近优先**，
被丢弃的条数**在段落里明说**（不做静默截断）。

**失败降级**：读失败 → 空集，**不阻断激活**（`repository-ci-attention` 同向：
「偏向说话，绝不偏向沉默」）。

### 12.4 明确不做（逐条对照 §12.4 要防的形态）

- **不新建** Memory Store / `memoryService` / Experience 中心 / 通用 recall substrate。
- **不建立**任何关联机制：不排序、不打分、不做语义相似度、不做 relevance——**关联由模型判断**，
  它是循环里唯一本来就在决定「这句话要不要读什么」的东西（`prompt.ts` 的 referent 段是同一条思路）。
- **不恢复** Work Focus current（裁决第 3 条）；`src/work-focus/**` **一个字节不改**。
- **不给** delivery 加反向（`human-inbound-v0-boundary-review.md:416`）。
- **不做**自动提炼：不扫描对话、不做摘要、不从 `ask` 里推断决定。
- **不新增** exposure、不新增 Service、不新增 variant、不改 Runtime。

---

## 13. 十项验证要求（裁决第 8 条）与落点

| # | 要求 | 怎么被验证 |
| --- | --- | --- |
| 1 | 明确确认后才记录决定 | `confirm` 写一条；`ask` **永不写**（脚本化假端点 + 读 chronicle 行数） |
| 2 | 未确认不能成为已确认决定 | 同上的反面：只问不确认时，事实族**零行** |
| 3 | 不声称身份已认证 | 断言 `source.kind === 'language.endpoint'`；断言 `human` 永不出现 |
| 4 | 跨 Resident 重启有效 | 真实进程三段反事实（见 item 7） |
| 5 | 相关历史能影响回答 | 假端点捕获**实际发出的 system message**，断言记录在上下文里 |
| 6 | 无关历史不能随意污染回答 | 记录**永不**出现在人类可见的行里（`chatted` 是模型原话、`answered` 是 owner 渲染）；段落明确标注它不是指令、不是已核实事实 |
| 7 | 删除对应历史后不伪装记忆 | 三段反事实：新建 / 有记录 / 删掉记录行（保留 header）→ 第三段必须回到第一段的样子 |
| 8 | Work Focus current 不被恢复 | 重启后的新激活读工作焦点的次数为 **0**；同一条测试随后问一个真的要读焦点的问题，把计数推到 1，证明这个 0 不是「计数器根本没接线」 |
| 9 | 不产生任何副作用授权 | 除 prompt 外**零消费者**；工作焦点、主动播报行为不变 |
| 10 | 有界读取与失败降级 | 超过预算时截断且**明说**丢弃条数；chronicle 读失败 → 空集且激活继续 |

---

## 14. Verdict（当前有效）

> 反指针：本节取代 **§7**；§7 的 `BLOCKED` 是裁决之前的判定，原文保留。

```text
目标：LANGUAGE CONVERSATIONAL CONTINUITY v0（原 Shared Experience Continuity v0 已按裁决收窄）
级别：L2  —— governance-rules-v1.md R5「给既有 contract 加 consumer」
裁决：Human 2026-10-08，九条，见 §9
准入：复用 Chronicle（§11）；未新建通用 Memory Store，未伪造 FacetSource.kind
VERDICT = READY（最小实现已按 §12 完成）
```

**这不是对原验收案例的放行。** 原 Shared Experience Continuity v0 的目标仍然过宽（§4 全表仍然成立）：
本文件不声称任何跨 domain 的经验共享、不声称自动提炼、不声称 Hikari 认证了说话者。
被放行的只有 §12 那一条边。

---

## 15. 独立待办（记录，不在本轮实现）

**HIKARI BOOTSTRAP / LAUNCH EXPERIENCE v1**（裁决第 9 条）。目标：

> `hikari` 自动解析默认目录、复用 Launch Profile、连接或按既有启动规则启动 Resident，
> 直接进入统一 TUI。

**明确不创建**：常驻 Launcher、新 Runtime、配置发现平台。本轮只记录，不实现。
