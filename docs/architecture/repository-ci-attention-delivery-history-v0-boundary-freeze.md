# REPOSITORY CI ATTENTION — OWNER-LOCAL DELIVERY HISTORY v0 — Boundary Freeze

> 本文是 **L2 边界记录**（R5），不是阶段研究。它只回答「开始实现所必须回答的具体问题」，
> 并且是 N2-01 任务书 §3 那一项的交付。
>
> 效力：与 Human ruling 冲突时以 ruling 为准；本文不新增架构决定。
> 基线：`main` @ `e29198d`（本文开始时 `git status --short` 为空）
> 日期：2026-10-08

## 0. 触发与范围

Human 的产品裁决（N2-01 §1）：

> 同一条 Repository CI failure，如果 Hikari **曾成功投递过**提醒，Resident 重启不应把它重新当作
> 未处理的新提醒。

本轮只有一个 owner（`repository-ci-attention`）、一个事实族、一个消费者——**它自己**的下一次 activation。

---

## 1. 治理分类

### 1.1 R5 级别：L2

两项触发：

- **给既有 contract 加 consumer**：`chronicleService` 新增一个消费者。
- **移动一条默认**：本插件原先明文「不读 Chronicle」，见 §6。

### 1.2 R4 四问（能力增长 vs 管辖扩张）

| # | 问题 | 结论 |
| --- | --- | --- |
| Q1 | owner 开始回答一个它今天不回答的问题？ | **是。** 「我（在过去的 activation 里）是否已经成功投递过这一条失败」——这个量**没有任何 source 报告过**，且是**跨 activation** 这条今天不存在的新轴 |
| Q2 | 在备选项之间做选择 / 排序 / 评分？ | 否。是一次**成员判定**，不做排序、不做优先级、不挑最重要的 |
| Q3 | 解释上游刻意不封闭的词表并升为全局语义？ | 否。词表是本插件自己的（`repository-ci-attention.delivered`），不漏出本模块，无 normalization / alias / 相似度 |
| Q4 | 决定人类与 source 都没给出的事（阈值 / 权重 / 策略）？ | 否。身份是精确的 `(repository, runId)` 复合键，无阈值、无权重 |

Q1 为「是」→ **jurisdiction expansion，走 L2**。按 R5，级别由该改动触及的最高类别决定，与 diff 大小无关。

### 1.3 被移动的冻结属于 R2 哪一类

| 出处 | 原文 | R2 类别 | 谁解除 |
| --- | --- | --- | --- |
| `proactive-repository-ci-v0-implementation-boundary-freeze.md` §1.2 | 「**不读 Chronicle / Memory / 通知历史 / durable queue**（ruling §九）。跨 Runtime 去重**不在本 slice**」 | **NOT-YET**（「还没有真实需求」的逐字形态）+ 其 SHOULD 读法是「本插件不得取得自己的 durable store」 | 真实需求出现即**自动解除**；SHOULD 读法本轮**未被违反**（见下） |
| 同上 §4「明确不做」同条 | 「不读 Chronicle …；不做跨 Runtime 去重」 | 同上，是**转写**，不提供额外规范力（R1 推论） | — |

**关键区分**：被解除的是 NOT-YET 的**范围**，**不是** SHOULD 的**理由**。

- 本插件**没有取得任何 store**。它读的是 composition 已经装载的既有基底，`provides` 仍然为空，
  没有任何新的持久化路径由本模块建立。
- 这两条 R2 类别都**不是 MUST**（来源是 Boundary Review 与 implementation freeze，均不在 R1 的
  前两层）→ 按 R2 规则 3，最高只能是 SHOULD。**不构成 L3 blocker。**

### 1.4 原 review 的两个拒绝理由，逐条对照

`repository-ci-attention-v0-boundary-review.md:428` 拒绝了「把 baseline 写进 Chronicle，重启后读回」，
理由两条。本轮写的是**另一种东西**，两条理由都不适用：

| review:428 的理由 | 本轮是否触犯 |
| --- | --- |
| 「让 Chronicle 变成 **attention 状态的第二个存放处**」 | **否。** 存的是「某次投递成功发生过」这一**不可修订事件**，不是 attention 的 **baseline 状态**。baseline 是每轮 poll 都要被覆盖的量，因此需要 supersession（Chronicle 没有）；一条已投递事实永远只被追加，从不被修订 |
| 「Chronicle **没有** update / delete / supersession，过期 baseline 无法表达」 | **否。** 本条对不可修订命题是**无关**的——不是「绕过」，是命题形态不同 |

`review:430` 拒绝「让重启后的第一次观测也报」，理由是「每一次重启都会报一条**已经报过**的事；
『新』这个词就彻底不成立了」。**Human 裁决逐字回答了这条反对**：只有当它**已经被报过**时才不该再报。
本 slice 因此不是推翻 review，而是**满足 review 自己的反对**——review 缺的那一样东西，是
「上一次到底有没有投递成功」的诚实记录。

现有实现与三方的距离（精确表述，不夸大收敛）：

| | 重启后对「持续红着」的 run |
| --- | --- |
| review §7（`:241`/`:246`/`:709`） | **全静默**（每次 activation 首次观测回到 baseline） |
| 冻结文本 + 已交付实现 | **全部重报**（`handledFailures` 随 activation 消失） |
| **Human 裁决（本轮）** | **已成功投递过的静默；从未投递过的仍然说** |

---

## 2. Boundary Check（任务书 §3 A–F）

### A. Chronicle 的 read / write contract 能否支持 owner-local 历史读取？

**能，但有一个必须写明的限制。**

`src/chronicle/contracts.ts` 给出 `append` / `get` / `read`。本插件用 `append` 与 `read`。

- `get(factId)` **不可用**：它需要一个 `factId`（UUID），而 owner 无法预知自己过去写的那条的 id。
- `read()` **返回整个文件、全量解析**，且**没有任何 filter / type / 时间范围参数**
  （`src/chronicle/service.ts`：`readStoreForOwner(...).facts`）。

**因此任务书 §4 的「不得把 Chronicle 历史整体导入内存」，在既有 API 下只能实现为
「owner 不**保留**整体」，无法实现为「不**读取**整体」。** 具体限制逐条：

1. 每次调用 `read()` 都会把 `chronicle.jsonl` 全文读入并逐行解析；
2. **任何一行格式损坏都会让整个 `read()` 抛错**（`src/chronicle/store.ts` 的 `parseStoreFacts`），
   不只是那一条——所以「读失败」是一个真实可达的状态，不是理论顾虑；
3. 因此**读取成本随 chronicle 总量线性增长**，且**不受本模块控制**。

本 slice 的处理：把 `read()` 的结果**立即归约成一个 `Set<string>`**，只保留 `(repository, runId)`
复合键，不保留 fact 对象、不保留 payload、不保留类型不是本族的条目。**归约后的驻留量由
本插件自己过去成功投递过的失败条数决定，有界且与 chronicle 总量解耦；而读取本身的成本没有解耦，
这一点在 §5 记为已知限制，不假装成立。**

### B. 事实结构是否足够承载 repository / run identity / 成功投递 / 出处 / 发生时间？

**足够。** `FactDraft { type, version, occurredAt, source{kind, reference?}, payload }`
（`src/chronicle/types.ts`）：

| 要求 | 承载方式 |
| --- | --- |
| repository | `payload.repository` |
| run identity | `payload.runId` |
| **成功投递** | **由事实类型名承载**（`repository-ci-attention.delivered`）——只有投递返回 `delivered` 才会走到 append，所以「这条事实存在」与「那次投递成功」是同一件事。不在 payload 里再写一个 `delivered: true`：那是一个只能取一个值的字段（`work-focus/facts.ts` 对同形态字段的既有判断） |
| 出处 | `source.kind = 'repository-ci-attention.delivery'`，即「这条命题的出处是本插件自己的投递路径」——**不是** `human`（入口无认证，`durable-fact-admission-v0.md:120-121` 明禁），也不是 GitHub |
| 发生时间 | `occurredAt` |

`payload` 必须是严格 `JsonValue`（`src/chronicle/fact.ts` 的 `rebuildJsonValue` 拒绝 undefined /
非有限数 / 非 plain prototype 等）。两个字段都是字符串与整数，合法。

### C. composition 能否把 Chronicle 供给这个 owner？

**能。** 生产上只有一个加载点：`src/cli/resident.ts:342`，而 `chroniclePlugin` 在
`:226` 加载——**在它之前**，因此 `requires` 追加 `chronicleService` 不会让插件停在 `waiting`。
（文本核验：`repositoryCiAttentionPlugin` 在 `src/` 内的加载点只有这一处。）

### D. 前两层权威文档里有没有 MUST 挡住？

**没有。** 逐条核对：

- `principles.md` / `core-architecture-v0.md` 没有一条 MUST 规定「attention 类插件不得读取任何历史」。
- 相反，**owner-admission doctrine 支持本改动**：
  「Only the semantic owner of a concern admits a fact about it, and only the proposition that owner is
  entitled to assert」（`src/work-focus/facts.ts` 头部）。本轮的写入者**正是**这个 concern 的语义 owner，
  写入的命题**正是**它有权断言的那一条（「我成功投递过这条失败的提醒」）。
- 「只有 work-focus 可以写 Chronicle」不是 MUST，两条独立理由都指向同一结论：
  a. 按 R1，它的出处 `durable-fact-admission-v0.md` 属 development docs → 最高 SHOULD；
  b. 即使不按文档分级、把它当作一条 Human ruling 看待，**R1 的层级之外还有时序**：N2-01 §1/§2 是
     **更晚的** Human 裁决，并且直接授权了这个 consumer（「Consumer = 同一个 owner 的下一次 activation」）。
     两条 ruling 不是冲突，是**范围与理由的分离**——后者解除了前者的范围，没有解除前者防的东西。
  其 doctrine 本身是**按 owner 授权**，不是把写入权钉死在一个模块名上（原处已留指针，见 §6.2）。
- `provides: []` **保持不变**——本插件没有取得任何 capability，也没有新增 public contract。

**不是 L3 blocker。**

### E. Human Delivery 协议能否保持不变？

**能，一个字节都不改。** 只读它**已经返回**的 `DeliveryOutcome`
（`src/human-delivery/types.ts`：`{ outcome: 'delivered' } | { outcome: 'unavailable' } | { outcome: 'failed' }`，
是**对象**不是裸字符串）。该 contract 的既有注释已经写明返回值「must *not* be used for retrying」，
本轮不触碰这条语义：不重试、不排队、不保证送达。

### F. 有没有真实历史数据或兼容冲突？

**没有冲突。** 现有 `chronicle.jsonl` 只含 `work-focus.*` 事实。新类型是**追加**的，老记录不解释、
不迁移、不删除。读侧必须**跳过**不认识的东西而不能因它抛错：

- `type` 不是本族 → 跳过；
- `version !== 1` → 跳过（`src/chronicle/fact.ts` 的 `readVersion` **只校验「正整数」，
  不拒绝未知版本**，所以版本过滤是**读方的责任**）；
- `payload` 形状不符 → 跳过。

---

## 3. 冻结项（本 slice）

1. **owner 不变**：`repository-ci-attention`；`provides: []` 不变；不新建 plugin、不新建 service。
2. **事实族是本模块私有的**：类型 `repository-ci-attention.delivered`，版本 `1`，
   `source.kind = 'repository-ci-attention.delivery'`，`payload = { repository, runId }`。
   **不建立** ExperienceService / MemoryService / CognitiveBus / GlobalExperienceStore /
   CentralCognition / Generic Historical Query Router / Generic Deduplication Framework。
3. **身份是复合键** `(repository, runId)`。Chronicle 属于 **Hikari**（`hikariId`）而不是某个 repository，
   多个 repository 的历史因此**落在同一个文件里**——只用 run id 去重会把两个仓库的 41 号 run 判成同一条。
4. **两个集合，语义不同**：
   - `handledFailures`（activation-local）：本 activation 已经处理过，**无论投递结果**——
     既有语义不变，仍是不重试的根据；
   - `deliveredFailures`（从 Chronicle 恢复）：**只有投递返回 `delivered`** 才在里面。
   `handled ≠ delivered ≠ human observed` 三条仍然互不等价，本轮**不新增**任何声称人类看到过的机制。
5. **降级方向**：读历史失败时，**朝「说」降级，不朝「沉默」降级**。Chronicle 不该有能力让 Hikari 失声。
   读失败时行为回落到 activation-local，并且这一点**不对外声称**为「以前一定没通知过」。
   > **注（2026-10-08，实现中实测补正）**：「读失败」在真实组合里分成两种状态，本条只覆盖第一种。
   > 第二种（store 打开时就已经坏）会让本 decider 停在 `waiting`——**完全沉默**。逐条见 §5.6。
   > 本条的范围因此收窄为「**已经打开**的 store 读失败时」，而不是任何 store 故障。
6. **不重试**：读历史在**每个 activation 只尝试一次**（不因失败而在后续轮次重试）；append 失败不回滚、
   不重试、不抛出、不声称成功。当前 activation 内不重投的既有语义保持不变。
7. **写入时机**：判定后先记 `handledFailures`（既有顺序，保持不重试语义），再投递；
   **只有** `outcome.outcome === 'delivered'` 才 append。`unavailable` / `failed` **不写任何成功记录**。
8. **本轮不做的事**：不把本轮自己的投递写回 `deliveredFailures`——那是同一件事实的第二份记录。

---

## 4. 明确不做

- 不实现 Experience / Memory / Reactivation / Semantic Association / Salience。
- 不实现 Fast Cognition / Small Model Provider / **共享模型路由器**。
- 不实现补发、重试、送达保证、投递队列。
- 不改 Human Delivery 协议，不改 Language，不改 Runtime，不改 Chronicle 的任何 contract。
- 不新建感知来源，不改 TUI，不改 conversation persistence。
- 不做跨 domain 的历史查询；不给任何其他 owner 读别人的历史。

---

## 5. 已知限制（记录，不掩盖）

1. **读取成本不有界。** `read()` 无过滤参数，必须全量解析（§2A）。归约后的**驻留**有界，
   **读取**无界，且随 chronicle 增长而增长。这是既有 API 的形状，本 slice 不改它，也不假装
   §4 的「有界」在读取侧成立。
2. **一行损坏 → 整次读取失败**（`src/chronicle/store.ts`），且 **store 的 `read()` 每次调用都重新
   解析整个文件**（`src/chronicle/service.ts:27`），不是打开时快照。
3. **`delivered` 只声称「字节被写下了」**（`src/human-delivery/types.ts` 的原文）。它是
   「投递成功」能诚实声称的全部，**不代表人类看见或读过**。因此本 slice 的静默保证也是这个强度：
   「Hikari 投递成功过的，不重复投递」，而不是「人类知道的，不重复说」。
4. **同一 activation 内 append 失败后重启，会重报。** 事实没写进去，下一次 activation 看不到它。
   这是 append 失败的诚实后果，不是可以补的洞——补它需要重试或补偿，两者本轮都不做。
5. **append 失败当前不可观测。** 与 `plugin.ts` 既有的 catch 边界记录同一个已知限制：
   v1 没有 public surface 报它。
6. **「读失败朝说降级」只在 store 已经打开的前提下成立，实现中被实测分成两种状态**
   （原本文只写了一种，实测后补正）：

   | store 状态 | 实际发生 | 降级方向 |
   | --- | --- | --- |
   | 打开时有效，之后被写坏 | 本插件读历史抛错 → 空集 → **照常播报** | 朝说 ✅ |
   | 打开时就已经坏 | `openChronicle` 在 open 时即 `readStoreForOwner`（`src/chronicle/open.ts`）→ **`chronicle` 插件自身 failed** → `chronicleService` 从未提供 → 本 decider 停在 **`waiting`** | **完全沉默** ⚠️ |

   第二行不是本 slice 引入的缺陷（`work-focus` 同样 `requires` 该 service，同样会 `waiting`），
   但它是本 slice 的 `requires` 带来的**新增耦合**，因此记录而不是省略：**只要 store 打不开，
   Hikari 连 CI 都不看。** 另一种形状是「可选依赖」，而 Runtime 没有 optional `requires`
   （`plugin.ts` 注释已记）。两者都有真实测试钉住（见实现记录）。

   **第二行的后果，在常驻进程里比上表多一步，而且方向相反。** 对故障排查很重要，所以单独写：
   `chroniclePlugin` 在 resident 里是**无条件加载**的（`src/cli/resident.ts:224-227`），而
   `isReady` 要求**每一个**已加载成员都是 `active`（`src/cli/resident.ts:590`），不 ready 即
   `exitCode = 1`（`:518-520`）。因此「启动时 store 已损坏」这条路径在常驻里**根本走不到本插件**：
   chronicle 先 `failed`，resident 以 **exit 1** 结束并打印 `renderNotReady`。

   这有两个直接推论，都必须说清，否则上表会被读得比实际更严重：

   - **resident 的 exit 1 不是本 slice 引入的。** 它在本次改动之前就是这样：chronicle 那时已经
     无条件加载、已经在 readiness 门内。本 slice 没有让它变好，也没有让它变坏。
   - **本 slice 新增的 `waiting` 在 resident 里不可达**——resident 在到达本插件之前就已经不 ready 了。
     它只在**加载了本 decider 却没有 store 的组合**里可达（测试即这样的组合）。也就是说，这条耦合的
     实际暴露面是「别人自己拼的组合」，不是 `hikari start` 的常规路径。

   代价那一条仍然成立：第一行里「说过了」被忘掉，同一条失败会被重复播报——这是诚实的后果，
   不是可以补的洞。

---

## 6. 与既有冻结的双向指针（R7.2）

本节列出**全部**受本 slice 影响的既有记录，分两类。两类的做法相同：**原文一字不改写，只加日期化指针**；
区别只在本 slice 与它们的关系——一类解除了某条结论，另一类只是让某个被引用的**事实前提**失效。

### 6.1 被取代的条目（三条来源，原处均已留指针）

1. `proactive-repository-ci-v0-implementation-boundary-freeze.md` §1.2 末条
   （「不读 Chronicle / Memory / 通知历史 / durable queue；跨 Runtime 去重不在本 slice」）
   与 §4「明确不做」中的同一条。
   本 slice 与它的关系：**解除一条 NOT-YET 的范围，不解除其 SHOULD 读法**（§1.3）。

2. `docs/development/durable-fact-admission-v0.md` 开头的 NARROW 范围（「只批准 `work-focus` 这一个
   owner 承认它自己的那一条事实」）与 §10 首条。
   本 slice 与它的关系：**解除范围，不解除理由**——「Plugin 普遍获得写 Chronicle 的权利」、
   Memory、Runtime 机制三者仍然都不成立；新增的第二个写入者写的是**它自己的**命题。

   > 该文 §10 另有一条（「不建立 Chronicle → state 的恢复」）**未被解除**。本 slice 也不需要解除它：
   > 本 slice 从历史折出的是**只增不变的成员集合**，不是会被覆盖的 state。该处也留了一次划界指针。

3. `docs/architecture/repository-ci-attention-v0-boundary-review.md` §14（Chronicle / Memory 影响）。
   **这是最直接的一份，而且最初被漏掉了**——它是**本插件自己**的 v0 边界评审，其 §14.1 逐字写着
   「要读 Chronicle 吗？**不**」，§14.3 更是逐字引用了 Human 的正式裁决
   「**不要为了给 Chronicle 找 reader 而创造需求。**」，并把它记为 v0 设计的**优点而非遗漏**。
   本 slice 正是把这条改了，所以这里的指针不是形式，是义务。三处（§14.1 表格行、§14.2 理由 (3)、
   §14.3）各有一个日期注，说明：
   - **被顶掉的只有「不写 / 不读」这一条结论**，授权来自 N2-01 的 Human 任务书（其 §1 产品决策
     与 §2 的 consumer 定义）；
   - **它当时防的东西没有被绕过**：裁决引用的那句话仍然有效，且本次遵守——reader 是 owner 自己
     在后续 activation 里读回自己的历史，不是为 Chronicle 新造的 consumer；
   - **理由 (1)(2) 不受影响**：occurrence 与 baseline 至今不写 Chronicle、baseline 仍不跨 activation；
     新增的 `repository-ci-attention.delivered` 是只增不变的命题，没有 update / delete 需求，
     因此恰好不触碰理由 (2)「Chronicle 无法表达 baseline 的生命周期」。

### 6.2 只是事实前提失效的条目（四份文档，原处均已留指针）

本 slice 让 `chronicleService.read()` 第一次有了生产调用者。**这一个事实**被四份文档当作**现在时的
证据**引用过，全部因此失效。这些文档的**结论**没有被本 slice 改变，所以指针只更正前提、不改结论：

| 文档 | 失效的那句话 | 结论是否仍成立 |
| --- | --- | --- |
| `experience-formation-v0-research.md` §1（统计表 + §1.4「读侧为零」） | 「`read()` 生产调用者为 0」「全仓 `grep '\.read()' src` 零命中」 | 是（§1.4 只是当时实测事实的失效） |
| `hikari-nervous-system-stage-v0.md` §2C（Reactivation） | 「`read()` 与 `get()` 生产调用者为 0」 | 是（「现状：无」不变） |
| `memory-reactivation-v0-boundary-review.md` §3 与 §16 理由 1 | 「`read()` 在生产代码里零调用者」 | **是，BLOCKED 不解除** |
| `desktop-return-attention-v0-boundary-review.md` §11 的括注 | 「全仓库没有 `chronicleService.read()` 的生产调用者」 | 是（「没有任何地方读回 work-focus 的 facts」至今逐字有效） |

**这份指针清单的来历值得记一行**：它最初只有两条（本 §6.1 的前两条），是**对抗性评审**指出
`memory-reactivation` 三处引用失效之后，我才按同一类断言在 `docs/` 全量扫了一遍，扫出共六处、
其中最关键的一处（§6.1 第 3 条，管本插件的那份）**两边都没有想到**。
只修被点名的那几条、不做同类扫描，会正好漏掉最该修的那一条。

---

## 7. Verdict

**PROCEED。**

A–F 全部通过；无 L3 blocker；唯一的 MUST 级相邻约束（`{ kind: 'human' }` 禁用、
Chronicle 不存解释）本轮**未被触及**。改动落在既有 owner、既有 contract 内部，
新增的只有一个**私有事实族**和**它自己的读回**。

两项必须在实现与记录中保持诚实：§2A 的**读取成本不有界**，与 §5.3 的
**`delivered` 不等于人类看见**。

---

## 8. 实现记录（短）

**落地形状**（三个文件，一个新增）：

| 文件 | 内容 |
| --- | --- |
| `src/repository-ci-attention/facts.ts`（新） | 事实族私有常量 + 三个纯导出：`failureKey` / `deliveryFactDraft` / `readDeliveredFailures` |
| `src/repository-ci-attention/judgement.ts` | `detectNewFailure` 增加第三个参数 `deliveredFailures` 与一条抑制检查 |
| `src/repository-ci-attention/plugin.ts` | `requires` 增加 `chronicleService`；每 activation 首次 cycle 读一次历史；投递返回 `delivered` 后 append |
| `src/repository-ci-attention/index.ts` | 导出上述三个纯函数；头部注释补上事实族的定位 |

`types.ts` 与 `language` 侧**一个字节都没改**（occurrence 形状不变 → `renderOccurrence` 不变）。

**实现中新发现并已记录的一件事**（§5.6）：真实组合里「store 读失败」分成两种状态。
`openChronicle` 在 open 时即解析全文，因此**打开时就已损坏的 store** 会让 `chronicle` 插件
`failed` → 本 decider 停在 `waiting` → **完全沉默**。这与 §3.5 冻结文本的宽读法不符，已按
R7.2 的做法在 §3.5 留下收窄指针（冻结文本不改写），并在 §5.6 展开。两种状态各有真实 store 测试。

**验证**：

| 项 | 结果 |
| --- | --- |
| `npm run build`（`tsc` strict） | 通过 |
| `npm test`（全量） | **744 tests / 740 pass / 0 fail / 4 skipped**（4 skip 是既有的 live harness 默认跳过） |
| 本 slice 测试文件 | **41 tests / 41 pass**（纯函数 / 假 provider 策略 / 真实 Chronicle 四段） |
| 本 slice 测试文件稳定性 | 连续 3 次运行均 41/41 |
| `impact`（`detectNewFailure`） | `LOW`，唯一调用者是同模块的 `runCycle` |
| `impact`（`repositoryCiAttentionPlugin`） | `UNKNOWN` → 按纪律用文本核验：`src/` 内加载点只有 `src/cli/resident.ts:342` |
| `detect_changes`（`scope: all`） | 完整（无 `partial` / `truncated`），`risk_level: high`，5 个 tracked 文件；两个未跟踪文件不在 git diff 内，为已知边界 |

**变异验证**（证明测试真的约束行为，不是「跑通」）：

| 变异 | 结果 |
| --- | --- |
| M1 把 `delivered` 守卫反过来 | fail 8 |
| M2 不读历史（退回 activation-local） | fail 4（正是四条跨 activation 的那几条） |
| M3 身份只用 `runId`，丢掉仓库 | fail 18 |
| M4 读失败时朝「沉默」降级 | fail 2 |
| M5 读历史每轮重试 | fail 1 |
| M6 不校验 fact version | fail 1 |
| M7 不校验 payload 形状 | fail 1 |
| M8 忽略 `fact.type`（把别人的事实当自己的） | **首轮存活** → 补测后 fail 1（见下） |
| M9 去掉 attempt-once 标志 | fail 1 |

M8 首轮存活是第一次变异验证的收获，也已经修掉：原来的「兄弟事实」用例 payload 与本族不同，
payload 检查先把它挡住了；而如果 payload 恰好相同，`Set` 会把它去重掉。补上一条
「type 是别人的、payload 合法、runId 不同」的用例之后，删掉 type 检查就会让阅读器把一条
**从未投递过的**失败判成已投递——测试现在咬得住了。

**第二轮变异**（对抗性评审之后补的三条断言，各自只杀死预测的那一条）：

| 变异 | 针对性 | 结果 |
| --- | --- | --- |
| A 把 `occurredAt` 从「投递时刻」改成 `occurrence.observedAt` | 草稿的时间戳语义 | KILLED：`写进 Chronicle 的就是那条命题…` 变红 |
| B 让读失败逃出本轮 cycle（降级晚一个 cadence） | 同一轮降级 | KILLED：`…同一轮就朝「说」降级` 变红，耗时 **2015 ms** = `until` 的 deadline，即它是被**超时**咬住的 |
| C 在 append 前加 `if (stopped) return;` | 收尾途中仍要落盘 | KILLED：`投递在激活收尾途中才返回…` 变红 |

三条在补测之前**全部存活**——这正是对抗性评审报告的三个覆盖缺口。harness 每次从原件备份出发、
跑完还原并逐字节核对哈希，因此三个数字互不污染（第一次变异验证曾在 M3/M4 间漏了还原，
那次数字是累积的，已废弃重做）。

**对抗性评审的处置**（子 Agent 结论按纪律逐条重新锚定，无一句直接采纳）：

- 报告未发现 HIGH / MEDIUM 级运行时缺陷；能构造出具体失败场景的**全部来自测试与文档**。
- 上面三条变异即报告的三条 LOW 覆盖缺口，**逐条补测并用变异确认咬住**。其中 LOW-2
  （`occurredAt`）与 LOW-3（收尾落盘）是**本 slice 自己新写的规则**，LOW-1 是既有降级方向的**时序**部分。
- 报告关于「启动时 store 已损坏 → resident **exit 1**」的说法**已重新锚定并更精确地记入 §5.6**：
  exit 1 属实（`resident.ts:518-520` + `:590`），但它是**本 slice 之前就存在**的行为，
  且本 slice 新增的 `waiting` 在常驻路径上**不可达**。报告建议的「改成惰性读」（改 `open.ts`）
  属于 chronicle 的改动，**本轮不做**（越界，且不是本 slice 的问题）。
- 报告说它观察到的一次失败是「dist 陈旧构建产物」——**该归因不成立**，真实根因见 §5.6 两种状态。
  按纪律不采纳，只采纳可复现的部分。
- 报告列为「非发现」的项（`failureKey` 单射性、无成功投递却被永久沉默、append 失败被伪装成成功、
  顺序与竞态等）与我的独立核验一致，未进入结论。

**文档改动**：本文件（新增）+ 本 §6 列出的**六份**既有文档各留一处或多处日期化指针（原文均未改写，
只加注；其中 `durable-fact-admission-v0.md` 三处、`repository-ci-attention-v0-boundary-review.md` 三处）。
指针的判定标准是：**只要本 slice 让某句现在时的断言变假，就留指针**——不是只修被评审点名的那几条
（§6.2 末段记了这条教训）。

**没有做**（§4 逐条）：没有 queue / retry / 补发 / 送达保证 / 补偿；没有改 Runtime、Language、
Human Delivery、Chronicle 的任何 contract；`provides` 仍然为空；没有新增 plugin 或 service。
