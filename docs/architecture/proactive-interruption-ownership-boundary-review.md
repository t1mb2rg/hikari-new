# 主动介入的所有权 — BOUNDARY REVIEW

- 日期：2026-10-13
- 性质：**只做 Boundary Review**。**未修改任何生产代码**，本轮产出仅此一份文档。
- 证据基准：commit `6fbc936`（工作区 `main`，与 `origin/main` 同步）。所有 `file:line` 为当时实测。
- 上游问题（逐字）：
  - `hikari-current.md:622` 待裁决表第 3 行：「**主动介入的总量控制由谁拥有**：两个场景各自判断，合并 / 分层 / 保持独立三条路都自洽」——「本文提出；无既有裁决」；不裁决的后果栏写：「每新增一条主动路径，「喧闹」风险累积一次」。
  - `hikari-long-term.md:370` 未裁决表第 4 行：「主动介入的**总量控制**（预算 / 优先级 / 静默期）由谁拥有？」——归属 `governance-rules-v1.md` R4 的 Q4。

## VERDICT

**NARROW（可裁决）。**

这一问今天不是「缺一个机制」，而是**缺一次裁决**；而且三条路里**只有一条不需要架构扩张**。本评审把选择收窄到一次取舍，并**不实现任何东西**。

---

## 1. 这一问今天的确切形状（实测）

### 1.1 两条路径各自的闸门

**`repository-ci-attention`**（顺序即 `src/repository-ci-attention/judgement.ts:64-70` 自述）：配置整数 `delayMs`；观测不足（run 未完成 / 结论未上报）；非失败结论（`FAILURE_CONCLUSIONS` 只有 `failure` / `timed_out` / `startup_failure`）；**去重一**：activation 内 `handledFailures` 集合（`judgement.ts:98`）；**去重二**：跨 activation 的 `deliveredFailures`，从**它自己**的 Chronicle 历史恢复（`judgement.ts:99`、`plugin.ts:158-167`）；无重试（`plugin.ts:179-191`）。

**`desktop-return-attention`**：配置整数 `delayMs` / `afterMs`；计数器回退则本周期不判定；阈值静默只「上膛」不说话；**只报上升沿**——`silence` 与 occurrence 在同一步内互斥（`judgement.ts:36-42`）；空 designations 不形成 occurrence；**activation-local**，重启看不到跨重启的静默。

两条都**没有**：单次布尔位、冷却期、`delayMs` / `afterMs` 之外的任何限流。

### 1.2 两条路径之间：没有任何协调

- 同时命名两者的唯一位置是组合根 `src/cli/resident.ts:30,44,371,380`。
- 两者的 `requires` / `provides` **无交集**，状态各在自己的闭包。
- 唯一共享物是 transport（`humanDeliveryService` 恰好只有这两个消费者）与 Language。
- 唯一把它们「放在一起看」的陈述在**配置层，而且是否定的**：`src/cli/options.ts:395` 逐字「两个主动播报开关互不推导，各自独立授权。」

**无共享预算、无共享优先级、无共享状态、无路由。**

### 1.3 同时想说话时：没有仲裁

`endpoint.write` 只做一次 `socket.write`，无锁、无优先级入参；两条消息都会写出，顺序＝调用顺序，**代码不做任何排序**。没有人连着时两次都拿 `unavailable`。

### 1.4 「一个人总共多久可以被说一次」这个量**不存在**

实测：`src/` 里**没有任何常数、类型、注释或契约**持有它。只有逐路径的节奏阈值，授权也逐路径（`options.ts:395`）。`human-delivery` 自身也不施加任何全局限制——它做的是单订阅者、不排队、不补发、无重试，这些是**传输语义**，不是注意力预算。

`hikari-current.md:476` 对这一点的措辞是准确的：「两条路径**没有共同的判据、优先级或预算**」；`:478`：「**这看起来像统一的 Attention，实际上是逐场景的**」。

---

## 2. 文档已经说过什么，以及一处没有解开的矛盾

**唯一给出过「归属」的条文**（`outbound-composition-v0-boundary-review.md`）：

- `:595`「`requires` **不能**回答「这一次该不该说」「说了几次了」「现在是安静时段吗」。那些是**抑制规则**，不是可达性。它们属于 decider……**本轮不为它们建任何东西。**」
- `:1066`「即使连接存在，**「这次该不该说」仍然没有 owner**。这条攻击真正要求的是一整套抑制规则（频率、安静时段、去重），而它们今天**一条都不存在，也未被预埋**。」
- `:1272`「| **抑制规则**（频率 / 安静时段 / 去重 / 冷却） | 它们属于 ⑤ 的 owner，而 ⑤ 今天不存在 |」
- 而 `⑤` 自己的状态是 `:902`：「⑤ decider（future；⑤ 的 owner；**今天 BLOCKED**）」。

**矛盾（本评审发现，此前无一处解释）**：该表把「**去重**」列入「属于 ⑤、而 ⑤ 今天不存在」的抑制规则，但去重**今天已经由两条已交付路径各自持有**：

- `desktop-return-attention-v0-implementation-boundary-freeze.md:152`：「**去重不复制 CI 的 runId Set**：`silence` 字段本身就是去重」；`:153`「**不建通用 dedup 工具。**」
- `proactive-repository-ci-v0-implementation-boundary-freeze.md:36`：`handledFailures` 是本次 activation 的一个 `Set<number>`。

**两份文档都没有说这构成越界，也没有说这些逐场景去重为何不算「抑制规则的 owner」。** §6 给出本评审的判断。

---

## 3. 约束这个答案的冻结条文

| 条文 | 原文要点 |
| --- | --- |
| `core-architecture-v0.md:285` | 「**不建立中央 Judgement Domain。**」 |
| `core-architecture-v0.md` §7（`:291`） | `:304`「每个自治过程只读取自己需要的视图和 Service，做**局部判断**，并产生有限输出。」`:306`「**没有任何自治插件天然拥有"全 Hikari 控制权"。**」`:308`「**禁止为了协调方便增加 Super Orchestrator。**」 |
| `core-architecture-v0.md` §11（`:391-404`） | 禁止重新引入：中央 AI Brain / 中央 Judgement / Super Orchestrator / GlobalWorldState / GlobalStateManager / 万能 Service / **所有交互必经的统一通信层**。`:420`「**不存在中央判断器或超级协调器。**」 |
| `principles.md:495`（§15） | 「**领域模块不应自行绕过 Presentation 直接向用户说话。**」 |
| `principles.md` §3 | 「Runtime owns mechanism, never policy」。 |
| `governance-rules-v1.md` R4（`:72`、`:74`、`:76-77`） | Q2「它在**备选项之间做选择**吗？（排序 / 优先级 / 评分 / 挑最重要的）」；Q4「它必须决定一件**人类和 source 都还没给出**的事吗？（阈值 / 权重 / 策略）」；「**四条全「否」→ capability growth**，走 L1。**任一为「是」→ jurisdiction expansion**，走 L2」 |

**注意最后一行**：R4 判的是**「这个改动让某个 owner 开始回答一个它今天不回答的问题吗」**。一条**跨路径**的总量控制，对任何现有 owner 而言都是新问题——所以问题不在于形状好不好，而在于**它落在谁的管辖里**。

---

## 4. R4 判级：为什么「合并」与「分层」都不是能力增长

**「合并」（一个地方统一决定谁可以不说话）**：

- Q2 = **是**——它必须在多条候选之间排序 / 取舍，这正是「挑最重要的」。
- Q4 = **是**——频率、静默期、优先级都是**人类与 source 都没有给出过**的量。
- 任一为「是」即 **jurisdiction expansion，走 L2**；且它同时撞上 §11（中央 Judgement）与 §7（Super Orchestrator 被逐字禁止「为了协调方便」）。

**「分层」（下层各自判断，上层设一条总闸）**：上层那一条闸仍然要回答 Q2 与 Q4。**分层只是把中央判断挪高一层，不改变判级**——除非那一层拥有的不是「判断」，而是**事实**（见 §7 的第三条）。

**「保持独立」**：四问全否——没有任何 owner 开始回答新问题，今天也没有任何东西被新建。因此它是 **capability growth，L1**，是三条路里唯一不扩张管辖的一条。

---

## 5. 三条路逐条评估（本评审的结论）

| 路 | R4 判级 | 是否撞冻结条文 | 代价 | 结论 |
| --- | --- | --- | --- | --- |
| **合并** | L2，jurisdiction expansion | **是**——§11 中央 Judgement、§7 Super Orchestrator | 一次新公共基础设施 + 一次宪法级裁决 | **建议明确否决并写入文档**，以免下一个实现者顺手做出来 |
| **分层** | L2（等同于合并） | 取决于上层拥有的是判断还是事实 | 同合并 | 只有把上层做成**事实**而非判断时才成立 |
| **保持独立** | **L1，capability growth** | 否 | 喧闹风险随路径数线性累积，且**没有任何东西在看总量** | **今天的正确状态**，但必须把风险显式登记 |

---

## 6. 一个解开 §2 矛盾的判断（**这是判断，不是引用**）

本评审认为：**那两条已实现的去重，回答的是「关于 occurrence 的问题」，不是「关于注意力的问题」。**

- `desktop-return-attention` 的 `silence` 去重，就是 occurrence 本身的形状——「刚刚发生了一次新的 return 吗」。它不回答「说了几次了」。
- `repository-ci-attention` 的 `deliveredFailures`，回答的是「这一条失败是不是已经报告过了」——一个关于**那条失败**的命题，用的是**它自己的**过去（`repository-ci-attention-delivery-history-v0-boundary-freeze.md:34` 已把这条轴判为 Q1=是 → L2，并已由 Human 裁决 N0-… 授权）。

所以 `outbound-composition` 那张表**没有说错**：它列的「去重」指的是**跨路径的、关于注意力总量的**去重，而那一条今天确实不存在、也没有 owner。**缺的不是「去重」这个动作，是「跨路径的那个量」。** 这条判断建议写回 `outbound-composition-v0-boundary-review.md` 或 `hikari-current.md`，消除那处歧义。

---

## 7. 建议

1. **今天就维持「保持独立」，并把它写成一条有名字的现状判断**，而不是让它继续以「还没决定」的形式存在。依据：它是三条路里唯一的 L1。
2. **明确否决「中央总量控制」**，并写进 `core-architecture-v0.md` §11 的语境（不必新增条文——§11 与 §7 已经覆盖，缺的是**有人把它点名到这里**）。
3. **把「总量成为可读的事实、而不是可决策的判断」登记为一条带触发条件的 NOT-YET**。它的形状是：有一个 owner 拥有「Hikari 对人说过哪些话」这条**事实**（最自然的所有者是 `human-delivery`——它是唯一出口，所有主动说话都经过它），但它**只记录、不判断**；每条 decider 自己决定要不要读它、读到之后怎么办。**没有中央判断器，没有 Super Orchestrator**；符合 §11 与 §7。代价是真实的：一条新的跨模块契约 + 一次「谁有权读别人的事实」的边界决定 → 按 R4 是 **L2**，所以它**不是**现在能顺手做的东西。
4. **触发条件（按 R3 的真实 consumer 规则）**：出现**第三条**主动路径，**或**出现一条真实的、来自人的抱怨。在那之前不做。

---

## 8. 裁决（2026-10-13，已作出）

三条全部按 §7 的建议裁决。**本轮仍然没有改任何生产代码**——裁决的落点是文档，不是实现。

| # | 裁决 | 落点 |
| --- | --- | --- |
| 1 | **「保持独立」正式成为结论**，理由记为 R4 四问全否 → L1 capability growth；风险（喧闹随路径数累积，且没有东西在看总量）随之登记 | `hikari-current.md` §13：该行移入「已经裁决并已实施的」块，其后的条目重新编号；`hikari-long-term.md` §6 第 4 行标为**已关闭** |
| 2 | **「中央总量控制」点名否决**，采用 §7 第 2 条的写法：**点名而非新增条文** | `core-architecture-v0.md` §11：在禁止清单后加一条**点名指针**，写明它不新增结构、不新增 MUST |
| 3 | **NOT-YET 成立**，「总量成为可读的**事实**而不是可决策的**判断**」登记为带触发条件；触发条件取**「第三条主动路径，或一条真实的、来自人的抱怨」——任一即触发** | `core-architecture-v0.md` §10：加入延后清单，并把该条的触发条件**具体化**（§10 原来的触发条件是通用的那一句） |

**这次裁决没有做、也不应被读成做过的事**：没有建立任何抑制规则的 owner，没有建 Attention Registry / 通知账本，没有给任何 decider 增加跨路径的输入，没有改 Runtime，没有新增契约。`outbound-composition-v0-boundary-review.md:902` 那个「⑤ 今天 BLOCKED」的位置**仍然是 BLOCKED**——本条裁决没有解冻它。

§2 那处矛盾（「去重」被列入 ⑤ 的辖地却由两条已交付路径各自持有）的解法记在 §6，属**本评审的判断**，尚未写回那一份文档。

---

## 9. 本轮刻意不做

- **不实现任何抑制规则**（频率 / 安静时段 / 冷却 / 跨路径去重），一条也不建。
- **不建** Salience / Importance / Attention Registry / 通知账本 / `deliveredAt` / ack 状态。
- **不改 Runtime**，**不改任何 plugin**，**不新增任何契约**。
- **不创建新的阶段编号**，不把本评审读成「Salience 研究的开始」——`current-stage.md:2053` 逐字：「**不创建 P4-04。不开始 Salience research。**」
