# HIKARI GOVERNANCE RULES v1

> **本文的地位**：与 `docs/architecture/plugin-design-spec.md` **同级**（操作规范）。**不是**冻结文档，**不是** fase 记录。
>
> **本文新增零条架构决定。** R1 复述 `plugin-design-spec.md` §20 的权威表；R2 / R3 复述 `core-architecture-v0.md` §13 与 `plugin-design-spec.md` §18.2；R4 / R5 引用既有的判据与 REVIEW TRIGGER；R6 / R7 把已经成立的先例写成规则。
>
> **本文自身不产生 MUST。** 按 `plugin-design-spec.md:25` 与 §18.2（`:604-614`），MUST 仅可来自 `principles.md`、`core-architecture-v0.md`，或 Runtime 已明确强制的不变量。**本文中标为 MUST 的条目，其效力来自它所引用的那两份文档的原文，不是来自本文。**
>
> **来源**：`docs/architecture/hikari-architecture-governance-review-v1.md`（HIKARI ARCHITECTURE GOVERNANCE REVIEW v1，2026-09-28）§4，即该评审 §八 建议 A 的产物。
>
> **适用方式**：遇到「这条冻结能不能动」时，按 **R2 归类 → R3 判断真实 consumer 的效果 → R5 选级别**。出现 R6 任一信号时，**下一步是读源文档，不是加一轮评审**。

---

## R1 — Authority hierarchy（权威层级）

**沿用 `plugin-design-spec.md:5-15` / §20，不重新定义。**

```text
principles.md                 长期最高原则
core-architecture-v0.md       当前冻结核心结构
plugin-design-spec.md         操作规范
phase architecture reviews    历史证据   —— 不作为权威来源
development docs              阶段记录   —— 不作为权威来源
```

**规则**：**一份文档只能行使它自己那一层的规范力。** 低层文档不因更晚、更具体、更好引用而获得高层效力（`plugin-design-spec.md:15`）。

**推论**：一份**汇总表**不能授予它自己没有的权威。`docs/development/current-stage.md` 的 `## 当前明确仍不做` 是**引用面**（citation surface），**不是法源**；其中每一条的规范力来自它**转写自**哪里，而不是它写在这份台账里。转写时**必须保留主语**。

---

## R2 — Freeze semantics（冻结语义）

**冻结必须先被写成三种形态之一，并写明它的主语。**

| 形态 | 含义 | 谁来解除 | 依据 |
| --- | --- | --- | --- |
| **MUST** | 某结构不得存在 | 只能修改 `principles.md` / `core-architecture-v0.md` | `plugin-design-spec.md:25`、§18.2 |
| **SHOULD** | 一个设计默认 | 评审中说明理由即可偏离 | `plugin-design-spec.md:26` |
| **NOT-YET** | 还没有真实需求 | 真实需求出现即**自动解除条件** | `core-architecture-v0.md:429-431` |

**规则**：

1. 每一条冻结必须能写成上面三种之一，并**写明主语**（谁不许做什么）。
2. **一条主语被省略的冻结是不可读的，必须被重写，而不是被遵守。**
3. **MUST 只能来自 R1 的前两层，或 Runtime 已强制的 invariant。** 写在别处的规则**最高只能是 SHOULD**。（`plugin-design-spec.md:604-614`：「不要为了强调而把工程纪律写成 MUST，那会稀释 MUST 的含义。」）

---

## R3 — Real-consumer reopen rule（真实消费者重开规则）

**一个真实有界 consumer 是必要条件，不是充分条件。** 问的不是「有没有 consumer」，而是「**这条冻结属于哪一类，consumer 能否满足它写下的条件**」。

| 冻结类别 | 真实 consumer 的效果 |
| --- | --- |
| **MUST** | **单独不产生任何效果。** 必须先修宪法（`core-architecture-v0.md:431`：先 Boundary Review，再修改本文） |
| **SHOULD** | 开启一次评审；默认**可以**被维持，但须写明理由 |
| **NOT-YET** | **充分。** 它的条件逐字就是「没有真实实现问题」（`current-stage.md` 该节末句），真实需求出现即条件消失 |

**反例（必须同时记住）**：给 `src/input-activity/` 加 `idleForMs`，有一个真实有界 consumer 就能让它合法吗？**不能**——它撞的是 R1 第一层（`principles.md:57`「Perception Provider 只负责『观察到了什么』」）。**consumer 的存在不能治好一条 MUST。**

---

## R4 — Capability growth vs jurisdiction expansion（能力增长 vs 管辖扩张）

**可执行判据。四条问题，任一为「是」即为 jurisdiction expansion：**

| # | 问题 | 依据 |
| --- | --- | --- |
| **Q1** | 这个改动让 owner 开始回答一个它今天不回答的**问题**吗？（不是「多报告一点同一个 concern」，而是**算出没有任何 source 报告过的新量 / 新单位 / 新轴**） | `phase-4-p4-03-entry-review.md:163`：「已落地的 judgement 恰好三个，全部是**比较或查找**，**没有一个做选择**」 |
| **Q2** | 它在**备选项之间做选择**吗？（排序 / 优先级 / 评分 / 挑最重要的） | 同上；`relevant ≠ important`、`relevant ≠ salient`、`relevant ≠ should notify` |
| **Q3** | 它需要解释**上游刻意不封闭的词表**、并把这个解释升成**全局语义**吗？ | `current-stage.md` 的 14 项 repository-identity 禁止清单（normalization / alias / embedding / 语义相似度 …）就是这条的实例 |
| **Q4** | 它必须决定一件**人类和 source 都还没给出**的事吗？（阈值 / 权重 / 策略） | `human-outbound-v0-boundary-review.md:265-271` 的 fixed product mandate 三问 |

**四条全「否」→ capability growth**，走 L1。
**任一为「是」→ jurisdiction expansion**，走 L2，且**不得**用「加一个字段」的形式完成。

**两条辅助的仓库形状**：

- **源事实 / 结论的分界**已有逐字原则可引：「Perception records what the source says, not what Hikari concludes from it」（`phase-3-input-activity-architecture-review.md:141`）。
- **新 concern 的既有形状是新建独立 Plugin，不是给既有插件加参数**（`current-stage.md` 「World 的 scope」条下的口径修正：第二个 scope 的 World 是**独立的新 Plugin** `repository-ci-world`，`desktop-session-world` 一个字节未动）。

---

## R5 — Review escalation ladder（评审升级阶梯）

| 级别 | 触发条件 | 产物 |
| --- | --- | --- |
| **L1 实现评审** | 有界 capability 落在**既有 owner、既有 contract** 内部（R4 四条全否） | 测试 + Functional Review + Architecture Review。**不新增文档** |
| **L2 Boundary Review** | 越过 owner 边界 / 给既有 contract 加 consumer / 移动一条 SHOULD 默认 / R4 任一为「是」 | 一份评审文档 + 明确 verdict |
| **L3 架构修订** | 触及 R2 的 MUST；或 `CLAUDE.md:162` 的架构级判据（Runtime public API / 新通信平面 / 跨 Runtime / 新全局状态中心 / 难撤回的 public contract） | Boundary Review **然后**修改 `core-architecture-v0.md` / `principles.md`（`core-architecture-v0.md:431`） |

**规则（这一条是反 friction 的那一条）**：

> **级别由 R2 中该改动触及的最高类别决定——不由 diff 大小决定，也不由「已经审过几轮」决定。**
>
> 已经跑过 L2 不构成再跑一次 L2 的理由；只有**新的、尚未被上一轮回答过的问题**才是。

---

## R6 — Architecture friction smell（治理摩擦信号）

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

> **为什么**：台账里**带重新评估触发条件的那一条会自己沉默地继续有效**，**不带触发条件的那一条会逼出一次 Human 裁决**。同一节里两种文本形式，产生两种治理成本。**差的是文本形态，不是架构难度。**

---

## R7 — Documentation authority rule（文档权威规则）

1. **汇总不授予权威。** 引用 `current-stage.md` 的条目时，必须引到它**转写自**的源文档；引不到源的条目，按 R2 的 NOT-YET 处理，或先补源。
2. **修订必须留下双向指针。** 解除 / 收窄一条冻结时，**不要求改写源冻结的正文**（`current-stage.md:143` 规定「解除的是**条目**，不是它背后的理由」「旧守卫**被替换**，不是被删掉」）；要求的是：**源冻结处留一条指向取代它的那份记录的指针**，**消费方记录里留反指针**。
3. **发生过的裁决必须落纸。** 一份被引用为立项依据的 Boundary Review，必须在仓库里有文件。裁决真实发生过但没有文档，等于下一次评审无法引用它。
4. **行号不是身份。** development docs 会被前置追加，按行号引用必然漂移。引用应带**条目名或原文片段**。

---

## 明确不做什么

本文**不**建立：审批状态机、治理 service、RFC 流程、任何治理自动化。

**这些规则的正确载体是文档与人的判断，不是代码。**
