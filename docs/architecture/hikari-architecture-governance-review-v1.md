# HIKARI ARCHITECTURE GOVERNANCE REVIEW v1

> **对象**：Hikari 的**架构治理规则本身**，不是任何一个 feature。
>
> **基线**：HEAD `23d6fac`，branch `main`。
>
> **性质**：治理审查（governance review）。**不是** feature 设计，**不是** 对实现的 architecture review，**不是** Runtime 变更。
>
> **本轮改了什么**：**零**。本文件是新写入的一份文档；仓库其余部分一个字节未动。§八 的文档修改方案**只报告，不实施**。
>
> **工作语言**：中文（协议标记 `BLOCKED` / `NARROW` / `PASS` 保留英文）。

---

## 0. 后记：实施记录（**本节晚于正文，读本文请先读本节**）

评审交付后，Human 裁决：**§8 的建议 A 到 D 全部执行**。已于 2026-09-28 执行完毕。**正文（§1–§9）原样保留、不修改**，以便追溯本评审当时究竟说了什么；其中「本轮改了什么：零」「§8 只报告，不实施」等表述**由本节取代**。

| 建议 | 落地 | 复核 |
| --- | --- | --- |
| **A** | 新建 **`docs/architecture/governance-rules-v1.md`**（R1–R7）。它与 `plugin-design-spec.md` **同级**，并在文件头明写**它自身不产生 MUST**——标为 MUST 的条目，效力来自其所引的 `principles.md` / `core-architecture-v0.md` 原文 | 文件存在；§8 建议 A 的两条约束（同层、不动冻结文档）均满足 |
| **B** | `current-stage.md` 的 `## 当前明确仍不做`：**节首**加一段 citation-surface 说明（新 `:1402`）；**节末**就地追加分类与引用规则（`:1458`，**不新增行**，原句保留） | 两处**均不改动任何条目内容** |
| **C** | `current-stage.md` 原 `:1434` 的兜底子句**补回主语**：「以及 **Input Activity 内部**对这些量的任何阈值比较」；并就地加一条 **口径修正**注记，写明改了什么、没改什么 | 现 `:1436-1437`。**六个导出量不得进入 Perception 的 MUST 一字未动** |
| **D** | `phase-4-explicit-work-focus-review.md` 两处加**修订指针**：`:145` 条目 17 内联指针；「本轮严禁创建」清单后 +1 段注记 | 清单**其余条目**与**本文件其余正文原样保留** |

**行号重基（R7 第 4 条的第一次生效）**：B 与 C 在台账节内插入了 3 行，**本节及以下所有 `current-stage.md` 行号引用已重算**——旧 `≤1434` 的 `+2`，旧 `≥1435` 的 `+3`。旧 `:1434`（Input Activity 一条）现在是 **`:1436`**。

> **这次重基本身就是 R7 第 4 条的证据。** 该条说「行号不是身份」——如果引用带的是条目名或原文片段，这次重基**根本不需要发生**。本节选择重算而不是改写引用风格，是**当下最小、可复核**的做法；下一次修订时应优先按条目名引用。

**状态**：A–D **全部是文档改动**——**零代码改动、零 Runtime 改动、零行为改动**。未提交（按约定由 Human 处理）。

---

## 1. 问题陈述

用户提出的失败链：

```text
real bounded product need
→ existing contract slightly insufficient
→ hits historical / current-stage freeze
→ Boundary Review
→ freeze reopen review
→ another architecture review
→ feature still not implemented
```

要回答的问题只有一个：

> **这是不是把阶段性 non-goal 错误升级成了永久 architecture prohibition？**

本轮的判断**不是**从这条链的形状出发的——形状本身可以是健康的（真正的架构边界本来就该反复被审）。判断必须从**仓库自己写下的规则**和**这些规则的实际执行记录**出发。

---

## 2. 第一手审计

### 2.1 权威层级：仓库**早已写明**，且写得很完整

`docs/architecture/plugin-design-spec.md:5-15`（并在 §20 `:700-710` 重复一遍）：

| 文档 | 地位 | 是否可被本规范修改 |
| --- | --- | --- |
| `principles.md` | 长期最高原则 | **否** |
| `core-architecture-v0.md` | 当前冻结核心结构 | **否** |
| `plugin-design-spec.md`（本规范） | Plugin 设计与 code review 操作规范 | — |
| phase architecture reviews | 历史设计与实现证据 | **不作为权威来源** |
| development docs | 具体阶段实现记录 | **不作为权威来源** |

> **低层文档不得反向覆盖高层。**

`CLAUDE.md:52` 独立给出同一张表的三行版本（`principles.md` / `core-architecture-v0.md` / `plugin-design-spec.md`），**未列入前两者之外的任何文档**。

**`docs/development/current-stage.md` 属于 development docs——按仓库自己的表，它「不作为权威来源」。**

### 2.2 规范词汇表：仓库**早已写明**，且有一条关键的来源限制

`plugin-design-spec.md:23-27`：

- **MUST** — 违反即为架构缺陷。**仅可来自 `principles.md`、`core-architecture-v0.md`，或 Runtime 已明确强制的不变量。**
- **SHOULD** — 成熟、重复出现，但不是上位冻结原则的工程纪律。**偏离需在评审中说明理由。**
- **REVIEW TRIGGER** — 出现后要求显式重新审查，**不代表自动违规**。

`§18.2`（`:604-614`）把它写成一条硬规则：

> 任何没有上述来源的规则，**最高只能是 SHOULD**。……**不要为了强调而把工程纪律写成 MUST**，那会稀释 MUST 的含义。

### 2.3 freeze 生命周期：机制**双向都跑通过**

不是推演，是已发生的记录。

**解冻方向（真实发生过）**：

| 被冻结的东西 | 解冻它的事件 | 机制 | 结果 |
| --- | --- | --- | --- |
| Repository CI Attention 整条链（`repository-ci-attention-v0-boundary-review.md:7` 判 **BLOCKED**） | Human Outbound 通道被裁决可建 | 两轮 Boundary Review（`human-outbound-v0` → `outbound-composition-v0`） | **已实现并完成真实 E2E 验收** |
| `work-focus.current@1`「本轮严禁创建」（`phase-4-explicit-work-focus-review.md:209`） | 出现真实 callable need（`repository-ci-relevance`） | Contract Gate **重新裁决** | `current-stage.md:57` 记为「**现在被提供**」；`src/work-focus/contracts.ts:30` 存在 |
| `repository-ci-relevance` 自身的 relevance judgement | supporting slice 论证 | 新 Boundary Review | 已交付 |

**重申方向（同样真实发生过）**：

- `repository-ci-attention-v0-boundary-review.md:295` 重新检视了 `repository-ci-awareness` 的冻结，结论是**「不需要重新裁决」**——冻结被审过、被维持，且是显式记录的。
- **MEMORY REACTIVATION v0 判 BLOCKED 并被 Human 接受**，且该文档 `:435` 逐字写下 BLOCKED 的准确含义：

  > **BLOCKED 不等于永远不做。** 它意味着：**当前不存在一个能被诚实切出的第一片。**

**而且这套机制是成文的、自觉的，不是碰巧跑通的**——三处直接的规范声明：

| 机制 | 原文 |
| --- | --- |
| **冻结文件的效力低于 Human ruling** | `proactive-repository-ci-v0-implementation-boundary-freeze.md:7`：「**效力：与 Human ruling 冲突时以 ruling 为准**；本文不新增架构决定，不重新开已经答过的问题」 |
| **同一份文档内部可以有更高效力的一节，且原正文保留不改** | `outbound-composition-v0-boundary-review.md:20`：「**本节的效力高于上文与正文。** 上文 ruling #5……被本节覆盖。**正文原样保留、不修改**，以便追溯本文当时究竟说了什么」 |
| **人类裁决可以正式作废更早的人类裁决** | 同上 `:22-26`：「原裁决要求 Repository CI Attention 等待 Human Outbound 完成。该次序**正式作废**，原因是它构成死锁」 |

**解冻的规范形式（仓库自述，`current-stage.md:143`）**：

> **本轮解除的是两处具体冻结，不是那份文档。** ……**解除的是条目，不是它背后的理由** …… **旧守卫被替换（带注释记录它原来在防什么），不是被删掉**。

**最后，仓库对「两份文档互相矛盾」的处置也是对的**：`outbound-composition-v0-boundary-review.md:1329` 把一处未消解的不变量读法分歧**逐字写下**——「两份文档不能同时都对。本文给出自己的读法与依据……**但不代为裁定**；它必须由 Human 一并处理」——而不是自行发明一条优先级规则。

**结论**：freeze 生命周期在本仓库**不是**永久禁止，而且**它有成文机制、双向先例、以及正确的分歧处置方式**。**这一层没有坏。**

### 2.4 台账审计：`current-stage.md:1400-1458`「## 当前明确仍不做」

本节机械核验的事实（每条都可复算）：

| 事实 | 值 | 核验方式 |
| --- | --- | --- |
| 顶层 bullet 数 | **39** | `awk 'NR>=1400&&NR<=1456 && /^- /'` |
| 带**显式重新评估触发条件**的 bullet | **1**（仅 `:1444`） | `awk … /重新评估触发条件/` |
| 被后续「口径澄清/修正/更新」就地纠正的 bullet | **7 条 / 10 处注解**（`:1407 :1416 :1418 :1421 :1433 :1434 :1435 :1440 :1451 :1453`） | `awk` 两式合计 |
| 已被就地撤销状态但仍留在表里的 bullet | **2**（`:1420` 删除线划掉；`:1450` 被自己的 `:1451` 逐字写「**已经被遵守，不是仍待做**」） | `awk … /~~/`；通读 |
| 该区间最后一次被修改 | commit `a2bb80e` | `git log -L 1400,1456:docs/development/current-stage.md` |

**最后一行是本节的实质发现**：`a2bb80e` 之后，Language Plugin v1 / Tool-use Loop / Judgement Reachability / Durable Fact Admission **四个 slice 全部只改写了本文档的头部块（L3–L157），一次都没有回写这份台账**。

节末唯一一句规制（`:1458`）：

```text
这些问题继续服从冻结规则：没有真实实现问题，不提前增加抽象。
```

它是 `core-architecture-v0.md` §13 冻结规则（`:425-437`）的下沉引用，逻辑形式是 `¬p → ¬q`（p = 出现真实实现问题，q = 提前增加抽象）。**它的逆否命题 `q → p` 才是可行动的**：一旦出现真实实现问题，这条禁令的**前提就消失**——而 §13 的下一句（`:431`）「如果现有架构无法表达真实需求，**先做 Boundary Review，再修改本文**」把落点接回评审，而不是接回禁止。

### 2.5 升级清单：多重 review **不是**仓库常态

`docs/architecture/` 下 19 份 review + 1 份 freeze。**17 份是「每 feature 一份」**。真正拿到多份的只有两条链：

- **P4-03**：3 份（BLOCKED → NARROW → entry NARROW）；
- **Human Outbound**：2 份 boundary review + 1 份 freeze。

其余（Phase 1 除 `v0-boundary-review`、P2-01~P2-04、P3-01~P3-05、P4-01、P4-02、P4-02.1，以及 5 个 P4-03 supporting slice）**全部只有一份或零份**。

**含义**：反复升级**不是**一个弥漫全仓库的流程病。它集中在**出站链**——也就是宪法（salience / notify / 领域模块能不能说话）真正承重的那个位置。**在那里多审几轮是对的。**

---

## 3. 诊断：friction 的真实形状

### 3.1 不在宪法层

`principles.md` / `core-architecture-v0.md` 没有坏：§13 本来就规定「先 Boundary Review，再修改本文」，`principles.md:7` 本来就规定「**应先解释为什么需要修改原则**，而不是在代码里绕过它」。**Boundary Review 是修改的闸门，不是否决权。** 2.3 的解冻记录证明这条路径可走通。

### 3.2 台账在事实上获得了它**未被授予**的权威

重复出现于下游的是同一种引用方式：

- `desktop-return-attention-v0-boundary-review.md:776`：`:1436`「被这条**逐字禁止**两次」；
- `memory-reactivation-v0-boundary-review.md:242`：`:1430` 标为「（**standing do-not-do**）」；`:89` 称 `:1426`「**未实现且明令不做**」；`:195` 引 `:1435` 为「冻结」。

而这份台账属于 development docs——按 2.1 它**不作为权威来源**。于是形成一处**没有仲裁文字的落差**：

```text
节末 :1455 把 39 条降格为「同一全局谓词下的可驳回推定」
                 ↓   （无仲裁）
下游把同 39 条当作「逐条硬禁令」
```

### 3.3 `:1436` 的逐字证据：一条规则的**主语在转写中丢失了**

原始冻结（`phase-3-input-activity-architecture-review.md:141-150`）：

```text
固定原则：
> Perception records what the source says, not what Hikari concludes from it.
`lastInputTick` 是一个 source fact。以下都没有进入 Perception，也不应当进入：
lastInputAt      idleForMs      idleSeconds
isActive         isIdle         userPresent
```

**主语是 Input Activity（Perception）。被禁的事是「这些导出量进入 Perception」。**

同一语义的全部其他落点，主语一致：

- `phase-3-input-activity-architecture-review.md:139`：「**采集侧**同样保持沉默……**不比较阈值**、不计算差值」；
- `phase-3-input-activity.md:86`：「**The value carries no interpretation.** | 不计算 idle duration，不判断在场 / 离场，**不比较任何阈值**」；
- `phase-3-input-activity.md:270`、`:321`：主语均为「它」= input-activity。

而 `current-stage.md:1436` 的转写：

```text
- **Input Activity 的在场解读**——`lastInputAt` / `idleForMs` / `idleSeconds` / `isActive` /
  `isIdle` / `userPresent`，以及任何阈值比较。`lastInputTick` 是 source fact，不是结论；
```

六个具名量仍是 Perception 的职责边界（**这是对的，且应继续硬**）。但兜底子句「**以及任何阈值比较**」在 `## 当前明确仍不做` 这个「每条都是全仓库禁令」的语域里**失去了主语**——它可以被读成「任何人不许比较任何阈值」。

**两半的可切分性是本条的全部要害**：

| 半 | 内容 | 类别 | 是否有宪法归宿 |
| --- | --- | --- | --- |
| (a) | 六个导出量不得**进入 Perception** | MUST | **有**：`principles.md:57`「Perception Provider 只负责『观察到了什么』」 |
| (b) | 以及**任何阈值比较** | **无归宿** | **没有**。`grep` 全仓库（`docs/` `src/` `test/`）：此短语在 `current-stage.md` 之外的**每一次**出现，都是对 `:1436` 的**引用**（`desktop-return-attention-v0-boundary-review.md:752 / :773 / :776`，以及本文件）——它没有任何一份架构文档把它独立写下过 |

按 2.2 的 §18.2，(b) **最高只能是 SHOULD**。它今天却以 MUST 的语域被引用，并因此逼出了一次 Human 裁决请求（`desktop-return-attention-v0-boundary-review.md:796`）。

**这条歧义不是推演出来的——它有实测受害者，而受害者就是本仓库自己最近的一轮评审。**

`desktop-return-attention-v0-boundary-review.md`（同一 Agent 的前一轮）逐字写下：

- `:776`：「§一 链的第一环是 `input inactive >= threshold`。那是**施加在由 Input Activity 导出的量上的阈值比较**。它被这条**逐字禁止两次**：一次被点名……一次被**兜底子句**（「以及任何阈值比较」）」；
- `:796`：解锁条件之一是「**对 `current-stage.md:1436` 的一次 Human 裁决**——明确解除或收窄该条」。

**也就是说：一个已经通读了 `phase-3-input-activity-architecture-review.md` 全文的读者，仍然把 (b) 读成了外延覆盖到 consumer 侧。** 这不是「某个读者粗心」——这正是「主语被省略的规则不可读」的**实证**，而且它的代价是一次被推给 Human 的裁决请求。

> **这不是「冻结太严」。这是一条宪法级规则和一条无归宿子句被压在同一个 bullet 里，而这份台账没有提供区分它们的手段。**

### 3.4 解冻是对的，**指向它的路**是缺的

**先纠正本评审自己的一处初判。** 初读时我把下面这件事记成「解冻只记在消费方，源文档不回写，所以两条矛盾陈述无人仲裁」。**第一手复核后这个判断不成立**——仓库有成文的解冻形式，且 `work-focus.current@1` 这一次**完全照做了**：

`work-focus.current@1` 的全链路：

| 环节 | 落点 | 状态 |
| --- | --- | --- |
| 源冻结 | `phase-4-explicit-work-focus-review.md:145`「17. **不创建 work-focus Service。**」、`:206`「本轮严禁创建：」、`:209` 首项 `work-focus.current@1` | 原文**保留**（按 `:143` 是有意为之） |
| 触发 | 真实 callable need 到达：`repository-ci-relevance` 必须读工作焦点集合（`src/work-focus/plugin.ts:4-7` 逐字记录） | ✅ |
| 消费方记录 | `current-stage.md:57`：「一处 Contract Gate 的**重新裁决，而不是豁免**」 | ✅ |
| 守卫**被替换而非删除** | `test/work-focus.test.mjs:549-552`：原断言 `'waiting'` 反转为 `'active'`，并留注释「the contract resolved, which is the only thing the gate was ever asking about」 | ✅ |
| 实现落地 | `src/work-focus/plugin.ts:56` `provides: [workFocusCurrentService]`；`src/work-focus/contracts.ts:30` | ✅ |

**五个环节一个不缺**，完全符合 `current-stage.md:143` 自述的形式：「解除的是**条目**，不是它背后的理由……**旧守卫被替换（带注释记录它原来在防什么），不是被删掉**」。

**那么真正缺的是什么？缺的只是「配对关系」在源头不可见。**

一个读者如果先落在 `phase-4-explicit-work-focus-review.md`，他看到的是「本轮严禁创建」和**零条**解除标注（`grep -c '口径' = 0`）——文档里**没有指向消费方记录的指针**，而消费方记录里也没有反向指针。今天唯一写着「这几条已经不可再引用」的地方，是 `desktop-return-attention-v0-boundary-review.md:833`——**第三份文档**：

> 子代理另报告了两处**已被后续 slice 推翻、不可再引用的旧冻结项**（引用时必须只引最新裁决）：`phase-4-explicit-work-focus-review.md:145` / `:209` 曾把 `work-focus.current@1` 列入严禁创建，今天已 provides；……

**这就是缺陷的准确形状**：不是「解冻没被记录」（它被记录了），而是**「A 已被 B 取代」这件事，A 和 B 都不说，只有 C 说过一次——而 C 今天还是 untracked。**

**修法也因此比初判小得多**：不是「回写源文档、补纠正」，而是**在源冻结处加一个指针**（「本条已被 `<consumer-doc>:<条目>` 取代」）。按仓库自己的先例，**不要**发明优先级规则——`outbound-composition-v0-boundary-review.md:1329` 已经示范了正确处理：把分歧写下来，交给 Human，而不是自己裁定谁赢。

### 3.5 被引用但**不存在**的 Boundary Review

三份实现记录的「立项依据」指向一份仓库里没有文件的评审：

| 引用处 | 引用的文档 | 文件是否存在 |
| --- | --- | --- |
| `docs/development/judgement-reachability-v0.md:7` | `JUDGEMENT REACHABILITY v0 Boundary Review` | **否** |
| `docs/development/agent-callable-capability-surface-v0.md:7` | `Agent-callable Capability Surface v0 Boundary Review` | **否** |
| `docs/development/language-tool-use-loop-v1.md:5` | `LANGUAGE TOOL-USE LOOP v1 Boundary Review` | **否** |

核验：`ls docs/architecture/ \| grep -i review` 与 `find . -iname "*judgement*reach*"` 均无对应文件。

这三份记录的措辞是「结论**已由人类裁决并冻结**」「5 项 NARROW **已由人类全部裁决**」。**裁决真实发生过，只是没有落成文档。** 这是三片已交付 slice 的授权闸门——**闸门开过，但没有留下可被下一次评审引用的工件**。

**注意这条的方向与 3.2 相反**：它不支持「少做 review」，它支持「做了的 review 要落纸」。

---

## 4. Governance Rules v1

> 本节是核心产物。**七条全部是既有规则的收敛与补口，不新增架构决定**——第 1、2、4 条基本是仓库已写规则的复述，第 3、5 条把已成立的先例写成规则，第 6、7 条补上今天空缺的那一处接口。

### R1 — Authority hierarchy（权威层级）

**沿用 `plugin-design-spec.md:5-15` / §20，不重新定义。**

```text
principles.md           长期最高原则
core-architecture-v0.md 当前冻结核心结构
plugin-design-spec.md   操作规范
phase architecture reviews   历史证据   —— 不作为权威来源
development docs             阶段记录   —— 不作为权威来源
```

**规则**：**一份文档只能行使它自己那一层的规范力。** 低层文档不因更晚、更具体、更好引用而获得高层效力（`plugin-design-spec.md:15`）。

**仓库已经在实践这条规则——而且是自己声明效力范围，不是靠层级表倒推**：

| 文档自己写下的效力声明 | 出处 |
| --- | --- |
| 「**效力：与 Human ruling 冲突时以 ruling 为准**；本文不新增架构决定，不重新开已经答过的问题」 | `proactive-repository-ci-v0-implementation-boundary-freeze.md:7` |
| 「**本节的效力高于上文与正文。**……正文**原样保留、不修改**，以便追溯本文当时究竟说了什么」 | `outbound-composition-v0-boundary-review.md:20` |
| 「该次序**正式作废**」（一条 Human ruling 作废更早的一条） | 同上 `:22-26` |
| 「**解除的是条目，不是它背后的理由**……旧守卫**被替换**（带注释记录它原来在防什么），**不是被删掉**」 | `current-stage.md:143` |

**推论（本条是新的措辞，不是新的规则）**：一份**汇总表**不能授予它自己没有的权威。`current-stage.md` 的 `## 当前明确仍不做` 是**引用面**（citation surface），不是法源；其中每一条的规范力来自它**转写自**哪里，而不是它写在这份台账里。

### R2 — Freeze semantics（冻结语义）

**冻结必须先被写成三种形态之一，并写明它的主语。**

| 形态 | 含义 | 谁来解除 | 依据 |
| --- | --- | --- | --- |
| **MUST** | 某结构不得存在 | 只能修改 `principles.md` / `core-architecture-v0.md` | `plugin-design-spec.md:25`、§18.2 |
| **SHOULD** | 一个设计默认 | 评审中说明理由即可偏离 | `plugin-design-spec.md:26` |
| **NOT-YET** | 还没有真实需求 | 真实需求出现即**自动解除条件** | `core-architecture-v0.md:429-431` |

**规则**：

1. 每一条冻结必须能写成上面三种之一，并**写明主语**（谁不许做什么）。
2. **一条主语被省略的冻结是不可读的，必须被重写，而不是被遵守。**（← 3.3 的 `:1436` 兜底子句正是这种情况）
3. **MUST 只能来自 R1 的前两层或 Runtime 已强制的 invariant。** 写在别处的规则最高是 SHOULD。（`plugin-design-spec.md:604-614`）

### R3 — Real-consumer reopen rule（真实消费者重开规则）

**一个真实有界 consumer 是必要条件，不是充分条件。** 问的不是「有没有 consumer」，而是「**这条冻结属于哪一类，consumer 能否满足它写下的条件**」。

| 冻结类别 | 真实 consumer 的效果 |
| --- | --- |
| **MUST** | **单独不产生任何效果。** 必须先修宪法（`core-architecture-v0.md:431`：先 Boundary Review，再修改本文） |
| **SHOULD** | 开启一次评审；默认**可以**被维持，但须写明理由 |
| **NOT-YET** | **充分。** 它的条件逐字就是「没有真实实现问题」（`current-stage.md:1458`），真实需求出现即条件消失 |

**反例（必须同时记住）**：`src/input-activity/` 的 `idleForMs` 有一个真实有界 consumer 就能让它合法吗？**不能**——它撞的是 R1 第一层（`principles.md:57`「Perception 只负责观察到了什么」）。**consumer 的存在不能治好一条 MUST。**

### R4 — Capability growth vs jurisdiction expansion（能力增长 vs 管辖扩张）

**可执行判据**。四条问题，**任一为「是」即为 jurisdiction expansion**：

| # | 问题 | 依据 |
| --- | --- | --- |
| **Q1** | 这个改动让 owner 开始回答一个它今天不回答的**问题**吗？（不是「多报告一点同一个 concern」，而是**算出没有任何 source 报告过的新量 / 新单位 / 新轴**） | `phase-4-p4-03-entry-review.md:163`「已落地的 judgement 恰好三个，全部是**比较或查找**，**没有一个做选择**」 |
| **Q2** | 它在**备选项之间做选择**吗？（排序 / 优先级 / 评分 / 挑最重要的） | 同上；`relevant ≠ important` / `≠ salient` / `≠ should notify`（`current-stage.md:1435`） |
| **Q3** | 它需要解释**上游刻意不封闭的词表**、并把这个解释升成**全局语义**吗？ | `current-stage.md:1434` 的 14 项禁止清单就是这条的实例 |
| **Q4** | 它必须决定一件**人类和 source 都还没给出**的事吗？（阈值 / 权重 / 策略） | `human-outbound-v0-boundary-review.md:265-271` 的 fixed product mandate 三问 |

**四条全「否」→ capability growth**，走 L1（§R5）。
**任一「是」→ jurisdiction expansion**，走 L2，且**不得**用「加一个字段」的形式完成。

**两条辅助的仓库形状**：

- **源事实 / 结论的分界**在仓库里已有一条逐字原则可引：「Perception records what the source says, not what Hikari concludes from it」（`phase-3-input-activity-architecture-review.md:141`）。
- **新 concern 的既有形状是新建独立 Plugin，不是给既有插件加参数**（`current-stage.md:1450-1451`：第二个 scope 的 World 是新插件，`desktop-session-world` 一个字节未动）。

### R5 — Review escalation ladder（评审升级阶梯）

| 级别 | 触发条件 | 产物 |
| --- | --- | --- |
| **L1 实现评审** | 有界 capability 落在**既有 owner、既有 contract** 内部（R4 四条全否） | 测试 + Functional Review + Architecture Review。**不新增文档** |
| **L2 Boundary Review** | 越过 owner 边界 / 给既有 contract 加 consumer / 移动一条 SHOULD 默认 / R4 任一为「是」 | 一份评审文档 + 明确 verdict |
| **L3 架构修订** | 触及 R2 的 MUST；或 `CLAUDE.md:162` 的架构级判据（Runtime public API / 新通信平面 / 跨 Runtime / 新全局状态中心 / 难撤回的 public contract） | Boundary Review **然后**修改 `core-architecture-v0.md` / `principles.md`（`core-architecture-v0.md:431`） |

**规则（这一条是反 friction 的那一条）**：

> **级别由 R2 中该改动触及的最高类别决定——不由 diff 大小决定，也不由「已经审过几轮」决定。**
>
> 已经跑过 L2 不构成再跑一次 L2 的理由；只有**新的、尚未被上一轮回答过的问题**才是。

### R6 — Architecture friction smell（治理摩擦信号）

出现**任一条**，下一步动作是**读源文档**，**不是**升级评审：

```text
· 一条冻结被按行号引用，而那个行号已经漂移
· 一条冻结被引用时，没有写明它的 R2 类别与主语
· 同一条冻结被同一文档内 ≥2 处后续注解就地纠正
· 同一句话被 ≥3 份评审当作「停」的理由引用
· 一份 development doc 的措辞被当作宪法的措辞引用
· 一份评审判 BLOCKED，但列举的 blocker 全是流程要求而非架构事实
· 一条冻结已被解除，但源冻结处找不到指向取代它的那份记录的指针
· 一份实现记录引用一份仓库里不存在的评审
```

**规则**：**信号的含义是「去核对源文档」，而不是「再加一轮评审」。**

> 这条的直接证据（2.4）：台账里**带触发条件的那一条会自己沉默地继续有效**，**不带触发条件的那一条逼出了一次 Human 裁决**。同一节里两种文本形式，产生两种治理成本。**差的是文本形态，不是架构难度。**

### R7 — Documentation authority rule（文档权威规则）

1. **汇总不授予权威。** 引用 `current-stage.md` 的条目时，必须引到它**转写自**的源文档；引不到源的条目，按 R2 的 NOT-YET 处理，或先补源。
2. **修订必须留下双向指针。** 解除 / 收窄一条冻结时，**不要求改写源冻结的正文**（`current-stage.md:143` 明确原文保留）；要求的是：**源冻结处留一条指向取代它的那份记录的指针**（形如「本条已被 `<消费方文档>:<条目>` 取代」），**消费方记录里留反指针**。（3.4）
3. **发生过的裁决必须落纸。** 一份被引用为立项依据的 Boundary Review，必须在仓库里有文件。（3.5 的三例）
4. **行号不是身份。** development docs 会被前置追加，按行号引用必然漂移（`memory-reactivation-v0-boundary-review.md:40` 已记录过一例：引 `:17`，实际在 `:41`）。引用应带条目名或原文片段。

---

## 5. Desktop Return Attention v0 的重新分类

**只重新分类，不继续设计。** 设计内容见 `docs/architecture/desktop-return-attention-v0-boundary-review.md`（本轮未改动它）。

| | 旧分类 | 新分类 |
| --- | --- | --- |
| Desktop Return Attention v0 | **BLOCKED** | **eligible for local contract evolution** |

**理由（按 R1–R3 逐条走）**：

1. **它撞的不是 R1 第一层。** 那条链需要的是**一个 consumer 计算**「在 wall-clock 窗口上未观测到输入」——一个**消费者侧**的量。input-activity 本身不需要任何改动，它的 jurisdiction 不需要移动。
2. **`current-stage.md:1436` 的两半必须分开（§3.3）。**
   - 六个导出量不得进入 Perception → **MUST，继续有效，不被本轮改变。**
   - 「以及任何阈值比较」→ 无宪法归宿 → 按 §18.2 **最高是 SHOULD / NOT-YET**。它**不构成** L3 阻断。
3. **因此它不再满足 BLOCKED 的定义**（`memory-reactivation-v0-boundary-review.md:435`：「当前不存在一个能被诚实切出的第一片」）。第一片**已经被切出**（旧评审 §15），机制也被 §3.4 的最小 activation-local 规则确立。
4. **但它也还不是 READY。** 剩下两条**不是**文档缺陷，是真实未决项：
   - **Language 契约形状**——`outbound-composition-v0-boundary-review.md:531-536` 已把「加第二个 owner 类型」登记为**不在那一轮权限内**的边界变更；
   - **mandate 形状**——`--proactive-return-after-ms` 那类 flag 是不是一个独立于 `--desktop-awareness-delay-ms` 的显式配置。

**新分类的准确含义**：

```text
· 不需要 L3 架构修订（不触及 MUST）。
· 不需要为了它再开一轮冻结重开评审——它的 blocker 不是冻结，是两条已登记的未决项。
· 阻塞它的最后一道文本是 :1434 的兜底子句；按 R2 第 2 条，
  那一条应当被「重写」而不是被「遵守」——即把它写回成带主语的形态。
· 在这两条未决项被裁决之前，它不进入实现。这与 R5 的 L2 一致，不与 BLOCKED 一致。
```

> **一句话**：它从「被宪法挡住」变成「被两条已登记的未决项挡住」。

---

## 6. 案例回顾

**不把所有过去的 review 判成错误。** 但也不把「摩擦」当成一个桶——**先把两种摩擦分开**：

- **合法的摩擦**：等一个人类产品裁决（`CLAUDE.md` §三：只有「真实产品意图无法推断」才询问用户），或等一次真实架构事实被建立。这是设计要的行为，不是缺陷。
- **用户 §一 描述的那个缺陷**：**阶段性 non-goal 被读成永久 architecture prohibition**（冻结的规范力被错误升级）。

| # | 案例 | 裁决 | blocker 的真实性质（逐字锚点） | 属于那个缺陷吗 |
| --- | --- | --- | --- | --- |
| 1 | Memory Reactivation v0 | **BLOCKED** | 读侧**没有任何已经存在的东西**：没有 cue、没有 consumer、没有 owner 授权（`memory-reactivation-v0-boundary-review.md:435-437`） | **否**（无真实 consumer） |
| 2 | Judgement Reachability v0 | **NARROW** | Contract Creation Gate 的正确拒绝——「为它发布 contract 等于**为零个人发布**」（`judgement-reachability-v0.md:57`）；本轮**第一次出现了真实的 callable need**（`:59`），闸门因此被**重新裁决**而非豁免 | **否** |
| 3 | Durable Fact Admission v0 | **NARROW → READY** | 写入**资格归属**：谁有资格承认一条 durable fact。旧冻结的理由「**没有被推翻，它今天仍然成立**」，变的是世界（真实 occurrence 出现了）（`durable-fact-admission-v0.md:44-48`） | **否** |
| 4 | Human Outbound v0 | **NARROW** | 三个前提待 Human 裁决，逐字：「**这是「真实产品意图无法推断」，按 CLAUDE.md §三，属于必须询问用户的类别。主 Agent 无权自决。**」（`human-outbound-v0-boundary-review.md:1006-1008`、`:1022` 前提一、`:1031` 逐字引用） | **否**（合法的裁决等待） |
| 5 | Proactive Repository CI v0 | 先 **BLOCKED**，后**交付** | 复合：一条**真实架构事实**（「主动出站人类通道不存在」）＋ 一条**任务书范围**（「这是一组新的 communication plane 的问题……**本轮任务书写的是「只设计」。因此本轮不能替它做这个裁决。**」，`repository-ci-attention-v0-boundary-review.md:581-583`） | **否**——一次**正确的** C 级升级，并且完整跑完 BLOCKED → 解锁 → 交付 |
| 6 | Desktop Return Attention v0 | **BLOCKED** | **两半，必须分开**：`:1436` 点名六个量的那一半是**活的 MUST**（两个模块的禁用词测试把它做成了会失败的断言）；兜底子句「以及任何阈值比较」那一半**无宪法归宿**。另加两条**已登记的未决项**（Language 契约形状、mandate 形状） | **是（部分）——只有兜底子句那一半** |

**归因**：**friction 不是弥漫的，它集中在「台账转写丢失主语」这一个机制上**，六例里只有一例部分落在它上面。第 1–5 例的 blocker 全部是**真实的架构事实或合法的人类裁决等待**。

**一处必须自我校正的读法**（本评审的复核结论）：第 6 例的**两半不能合并成一个「禁令太严」**。第一手核对禁用词测试后确认，`test/desktop-session-awareness.test.mjs:600-618` 与 `test/desktop-session-awareness-loop.test.mjs:480-505` 扫描的是 **`src/desktop-session-awareness/` 与 `src/desktop-session-awareness-loop/`** 两个**消费方模块目录**，token 是 `isIdle` / `isAway` / `userPresent` / `userAway` / `idleFor`。也就是说被机械强制的规则是「**这两个层不得长出这套 policy 词汇**」——这是六量禁令的**层内**一半，**不是**「任何地方都不得做阈值比较」这条对外延。**兜底子句没有机械守卫**，它的效力只来自被引用。

**这直接决定了 verdict 的量级。** 不是「REVISION REQUIRED」，也不是「KEEP CURRENT GOVERNANCE」。

---

## 7. 对抗性检查

七条攻击，每条要求一个**具体的失败场景**。结论按「是否被驳倒」记录。

| # | 被攻击的命题 | 结果 |
| --- | --- | --- |
| 1 | 「只要写过 freeze，就永远不能动」 | **被驳倒。** 反例是活的：`repository-ci-attention-v0` BLOCKED → 已交付；`work-focus.current@1`「严禁创建」→ 已提供 |
| 2 | 「有真实 consumer 就什么都可以改」 | **被驳倒。** 反例：给 input-activity 加 `idleForMs`——consumer 存在也治不好 `principles.md:57` |
| 3 | 「capability 增强就是 jurisdiction 扩张」 | **被驳倒。** 反例：verbatim 投影既有 source fact 的字段是 capability growth；而**不加字段**却改变「谁回答哪个问题」才是 jurisdiction（R4 的四问） |
| 4 | 「只要没改 Runtime 就不是 architecture change」 | **被驳倒。** 反例：`src/language/contracts.ts` 的改动、给一个 transport 加第二个 consumer、`src/cli/resident.ts` 的组合变更——都不碰 `src/runtime/`，都是架构级 |
| 5 | 「所有历史设计记录都有同样规范权威」 | **被驳倒，且有活的反例。** `work-focus.current@1` 今天在 `current-stage.md:57`（被提供）与 `phase-4-explicit-work-focus-review.md:209`（严禁创建）**给出相反的指令** |
| 6 | 「为了减少 friction，以后不做 review」 | **被驳倒。** 反例：3.5 的三份 slice 的授权来自真实发生过的 Human 裁决；L2 本轮仍发现了 `contracts.ts` 值叶子这条无人看守的不变量 |
| 7 | 「第二个 consumer 出现就必须抽象」 | **被驳倒。** 仓库逐字写下相反判据：「**两个实例不足以判定共享边界**」（`current-stage.md:1444`），并在第 2、第 4 个实例出现后仍然不抽（`:1453`） |

**七条全部被驳倒。** 这**强化**了 R1–R7 的保守取向：**仓库的架构底线是对的，坏的不是「边界太硬」。**

---

## 8. 最小文档修改建议（**只报告，不实施**）

按用户 §十三 的优先级排序。**本轮未实施任何一条；下面每一条都需要 Human 确认后才动。**

### 建议 A（首选）——新增一份短治理文档

**新建** `docs/architecture/governance-rules-v1.md`，正文即本文件的 §4（R1–R7，约 1–2 页正文等价）。

- 它属于 `plugin-design-spec.md` 的**同一层**（操作规范），**新增零条架构决定**：R1 复述 §20 的表，R2/R3 复述 §13 与 §18.2，R4 引用既有的三处判据，R5 引用既有的三组 REVIEW TRIGGER。
- **不在 `principles.md` / `core-architecture-v0.md` 里加任何东西**——那两份是冻结文档，本轮没有需要修改它们的真实需求。

### 建议 B —— `current-stage.md` 只加必要的 authority / freeze clarification

**改两处，都不改条目内容**：

1. 在 `## 当前明确仍不做` 的**节首**加一段说明（约 5 行）：本表是 **citation surface**，不是法源；每条 bullet 的规范力来自它转写自的源文档；转写时**必须保留主语**。
2. 在**节末 `:1458` 之前**加一句：本表条目按 `governance-rules-v1.md` R2 分为 MUST / SHOULD / NOT-YET 三类，**未标类别的条目按 NOT-YET 处理**。

**不建议**在本轮给 39 条逐一贴标签——那是 39 次判断，应该按需增量做，而不是一次性完成。

### 建议 C —— 修 `:1436` 的兜底子句（**这是唯一一条改到条目内容的建议**）

把

```text
`isIdle` / `userPresent`，以及任何阈值比较。`lastInputTick` 是 source fact，不是结论；
```

按 R2 第 2 条「重写为带主语的形态」。**两个可选写法，本评审建议后者**：

```text
(a) 删去「以及任何阈值对比」——六个具名量已经完整表达该条；
(b) 补回主语——「以及 Input Activity 内部对这些量的任何阈值比较」。
```

**注意**：这一条**只改主语，不改禁令的实质**。六个导出量不得进入 Perception 这条 MUST **一个字都不动**。改完之后，Desktop Return 链那条 consumer 侧的阈值比较就不再落在它的外延之内——这也正是 §5 重新分类的依据。

### 建议 D —— 补两处指针（R7 第 2、3 条）

- **在 `phase-4-explicit-work-focus-review.md:145` / `:209` 各加一条指针**（**正文不改**）：「本条已被 `current-stage.md:57` 的 Contract Gate 重新裁决取代；`work-focus.current@1` 现已 provides」。这是 R7 第 2 条的**首次应用**——今天这个配对只出现在 `desktop-return-attention-v0-boundary-review.md:833`，一份**第三方的、且当前 untracked 的**文档里。
- 三份引用了不存在评审的实现记录（3.5）：或补上评审文档，或把引用改写成不指向具体文件的表述。

**不建议**新增审批状态机、治理 service、RFC 流程或任何治理自动化。**这些规则的正确载体是文档与人的判断，不是代码。**

---

## 9. Verdict

# NARROW GOVERNANCE REVISION

**不是 `KEEP CURRENT GOVERNANCE`** —— 因为存在一处**已定位、可复算、且已真实产生成本**的缺陷：development doc 的汇总表在事实上行使了超出其层级的权威，其机制是**转写时丢失主语**（§3.3），其活标本是**「A 已被 B 取代」这件事 A 与 B 都不说，只有第三方文档说过一次**（§3.4），其可观测代价是一次 Human 裁决（§2.4）。

**不是 `GOVERNANCE REVISION REQUIRED`** —— 因为：

- 权威层级**已经写对**（`plugin-design-spec.md:5-15`、§20）；
- 规范词汇表**已经写对**（MUST / SHOULD / REVIEW TRIGGER，§18.2）；
- freeze 生命周期**双向都跑通过**（2.3），包括一轮完整的 BLOCKED → 解锁 → 交付；
- 六例回顾中**五例的 blocker 完全是真实的架构事实或合法的人类裁决等待**，只有第六例的一部分触到该缺陷（§6）；
- 七条对抗性攻击**全部被驳倒**（§7）——尤其「有真实 consumer 就什么都可以改」与「所有历史记录权威相同」。

**修的是接口，不是宪法。** 建议 A–D 全部是**把仓库已有的规则应用到一处没有应用它们的地方**，加上两条历史上遗漏的指针。

### 目标自检

用户给的目标是：*真正的 architecture boundary 继续很硬；阶段性 freeze 不再伪装成 architecture constitution；真实需求能够推动 owner 内部正常演化。*

| 目标 | 本规则集如何满足 |
| --- | --- |
| 真边界继续很硬 | R2 第 3 条（MUST 来源限制）+ R3 的 MUST 行（consumer 单独不产生效果） |
| 阶段性 freeze 不再伪装成宪法 | R1 的「汇总不授予权威」+ R2 第 2 条（无主语即重写）+ R7 第 1 条 |
| 真实需求推动 owner 内部演化 | R3 的 NOT-YET 行（条件逐字就是「没有真实实现问题」）+ R5（级别由类别决定，不由轮次决定） |

---

## 附：证据限制与未做的事

1. **本轮零代码改动、零 Runtime 改动、零文档修改。** §8 全部是建议。
2. **台账的 39 条分类**（MUST / SHOULD / NOT-YET 的占比）是本评审**自己的判断**，不是仓库的成文事实——原表不给每条贴标签。建议 B 因此**不**要求逐条贴标签。
3. **`core-architecture-v0.md:431` 的「先 Boundary Review，再修改本文」**在本轮被作为既有规则引用，**不是**本轮新增。
4. **本轮未裁决**：`current-stage.md:1436` 的最终写法（建议 C 的两个选项）、Language 契约形状、mandate 形状——这三项仍属 Human 裁决面。
5. **本文件引用 `desktop-return-attention-v0-boundary-review.md`，该文件当前在工作区 untracked。** 若它不被提交，本文件的 §5 与 §3.3 的引用会指向一份不存在的文件——**正是 §3.5 记录的那类缺陷**。这一点在提交前必须处理。
6. **一个反向的证据缺口**（3.5）：三份已交付 slice 的授权评审没有文件。本轮**只报告，不补写**——补写需要 Human 确认当时的裁决内容，Agent 不得代笔。
7. **方法**：并行调查用了 13 个只读子代理（6 个调查面：台账审计 / 权威审计 / 冻结生命周期 / capability-vs-jurisdiction / 升级清单 / 六例回顾；7 个对抗面，各攻一条命题并要求给出具体失败场景）。**13/13 完成，0 错误；7/7 攻击返回 `refuted: true`。**
8. **子代理结论只作候选，主 Agent 逐条重新锚定。** 本轮有三处因此被改写：
   - **§3.4 被推翻重写**——初判「解冻只记在消费方」，第一手读 `current-stage.md:143` 后确认这是**成文策略**且 `work-focus.current@1` **照做了全部五个环节**；残留缺口缩小为「源与消费方之间没有指针」。
   - **§6 第 6 例的两半被拆开**——子代理主张不采用 FRICTION-STALE-DOC（理由是禁令「恰好命中」且有测试守卫）。第一手读测试后确认：守卫扫描的是 `src/desktop-session-awareness/` 与 `...-loop/` 两个**消费方模块目录**，强制的是「这两个层不得长出 policy 词汇」，**不覆盖**兜底子句。故采纳其一半（点名那一半是活的 MUST）、驳回其结论（兜底子句仍无归宿）。
   - **一条子代理结论被整体驳回**：把 `phase-3-input-activity-architecture-review.md:405` 的「第三个同型 **parser**」与台账的「第三个同型 **Windows Perception**」描述为「用词漂移」。第一手读原文：二者是**同一文档内两条不同接缝**（`:405` 测/传输接缝、`:526` 抽取接缝）上的两个不同触发条件，不构成漂移，不予采纳。
