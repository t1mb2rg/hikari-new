# Composition Boundary Review：已授权仓库行动的「能力投放」

写作日期：2026-10-13
触发来源：`src/language/exposure.ts:40-48`、`src/language/plugin.ts:79-82`、`:204-211`、`:509-510`

---

## 0. 本评审回答什么

`changeable-repositories` 的**声明**那一半已经落地：人可以说出哪些代码仓库是被授权可改的，声明持久化，读回可重建。下一件事是**行动**——让 Hikari 真的去改一个已授权的仓库。

这条路要经过 Language：只有 Language 被允许把「人的话」理解成意图。于是问题看起来是组合问题：

> 给模型多投放一个能力（「改某个已授权仓库」），会不会需要第三个 variant、第三份 exposure 字面列表？

`src/language/exposure.ts:40-48` 已经把这个问题预先登记过，并且明确**不是**要求实现者自己发明答案：

> Two named variants are approved for exactly one reason: base Language and repository-aware Language differ by *one* independently optional capability, and one optional capability has two states. A second such capability would make four variants, a third would make eight… **If a second independently optional domain capability ever appears, the answer is not a third literal list here — it is a Composition Boundary Review of whether capability reachability should be decided at composition time at all.**

本评审就是那次 Review。它回答三问，并且三问的答案来自不同的权威层。

---

## 1. 结论

**VERDICT: NARROW — 但 NARROW 落在与提问相反的方向上。**

1. **「改仓库」不是 exposure。** 它是**真实外部副作用**，由 **Action 边界**拥有，不由 Language 拥有。所以它**不进** Language 的 exposures、**不进** variant 轴、**不需要**第三个 factory 或第三份字面列表。Language 这一片**一行都不改**。
2. **variant 轴的问题同时被回答了，而且答案是「不改」。** `exposure.ts:46-47` 担心的「能力可达性是否该由 composition 决定」这个问题**继续搁置**——因为本片新增的能力不是「独立可选」的，而 `exposure.ts` 的守卫针对的是**独立可选**能力，不是能力数量。判据见 §4。
3. **「行动」本身今天不能开：`BLOCKED`。** 不是因为 Language，也不是因为风险偏好，而是因为 **Action Pipeline 在 `src/` 内零实现，且被当前阶段明确排除**。开出第一个真实副作用而不先立治理链，会同时违反三层权威里的 `MUST`。理由见 §5。

三点合起来是一个不讨喜但清楚的结论：**用户想要的「行动」这一片，不能以「给 Language 加个工具」的形式开；它是一整个平面的开工，而不是一个 slice。** §7 给出今天**可以**开的那一半。

---

## 2. 第一问：这个能力是不是 exposure？

### 2.1 三层权威的答案是「不是」

`principles.md:115-119` 定义 Action Pipeline 平面：

> 用于所有真实外部副作用。
> 无论动作来源是**用户、模型**、Awareness、Goal、Forge、定时任务或其他模块，只要会改变外部世界，就必须经过统一行动治理链。

「模型」被逐字列为可能的动作来源之一，并且「必须经过统一行动治理链」。改一个代码仓库会改变外部世界。

`core-architecture-v0.md:421-422`（§12 核心不变量 7、8）：

> 7. **查询信息与改变现实是不同操作。**
> 8. **真实副作用必须经过 Action 边界。**

`plugin-design-spec.md:198`（§5 平面路由表）：

| 语义 | 平面 |
| --- | --- |
| 改变外部现实 | **Action Pipeline** |

`plugin-design-spec.md:202-207` 把它写成 `MUST` 级的禁止：

> **MUST** 禁止以下四种误用：
> …
> - 绕过 Action governance 直接改变外部现实。

### 2.2 `principles.md` §8 点名禁止的正是本片的形状

`principles.md:284-313` 给出整条链，并把四条「不允许」写死：

> - Awareness 直接发消息；
> - Engineering 直接修改系统却不留下行动事实；
> - Memory 直接触发外部动作；
> - **某个模型插件绕过统一治理去调用原始系统资源。**
>
> 模块可以提出 Action Intent，但不能绕开治理链。

Language 是模型插件。让 Language 的工具循环解析出「改这个仓库」并直接执行，**就是第四条**。这一条不是本评审推出的解释，是逐字条文。

### 2.3 与 Language 自己的记录一致

`src/language/exposure.ts:56-59` 已经写清楚 exposure 不携带权限，并按 `principles.md` §5 把四件事分开：

> What an entry does not carry: any permission. An exposure says a capability may be *offered*, and says nothing about whether a particular caller may use it or whether this particular act is allowed. `principles.md` §5 keeps those apart — existence, exposure, authorization and execution are four questions — and this slice answers exactly the second one.

`principles.md:207-227` §5 的五层是：

```text
系统是否拥有某项能力
↓
当前 Scope 是否能访问
↓
某个行为循环是否能消费
↓
模型是否能看到
↓
本次动作是否被允许执行
```

「改仓库」要回答的是**最后一层**，而 Language 这一套机制按设计只回答**第四层**。把一个执行能力塞进 exposures，等于让第四层顺带回答了第五层——正是 §5 结尾那句「这几个层次不得合并成一个布尔开关」所禁止的。

### 2.4 结论

「改仓库」不是 exposure。它是 action。**本片不改 Language。**

---

## 3. §5 四问逐问归属

按 `principles.md` §5 与 §6（Provider 怎么做 / Policy 允不允许 / Consumer 如何暴露 / Runtime 怎么活）：

| 问题 | 今天的 owner | 今天的状态 |
| --- | --- | --- |
| 存在 | `changeable-repositories` 提供写入能力 | **不存在**——没有任何 Service 执行仓库修改 |
| 暴露 | Language（`src/language/exposure.ts`） | **不该由它回答**，见 §2 |
| 授权 | 声明集合（已落地，持久化） | **已存在**，但它回答的是「哪些仓库」，不回答「这一次动作是否被允许」 |
| 执行 | **Action 边界**（`plugin-design-spec.md:198`） | **不存在**——`src/` 内零 Action、零 Receipt |

第三行那半句是容易读漏的关键：**声明集合回答了「范围」，没有回答「本次」**。`principles.md:264-280` §7 要求权限是交集而不是单点：

```text
可见能力集合
∩ Scope Restriction
∩ Authority Policy
∩ Safety Guard
∩ User Approval
=
最终可执行集合
```

声明集合是其中的 `Scope Restriction`。它**不能**兼任 `Authority Policy` / `Safety Guard` / `User Approval`——`principles.md:280` 还要求「一个具有约束力的拒绝不能被后来的普通 Allow 覆盖」，这条单调性今天没有任何代码在守。

---

## 4. 第二问：variant 轴要不要改？

**不改。而且这里有一个此前没有写下来的判据。**

`exposure.ts:40-48` 的守卫逐字针对的是**独立可选（independently optional）**能力：

> base Language and repository-aware Language differ by *one* **independently optional** capability, and one optional capability has two states. A second **such** capability would make four variants…

「such」指的是**独立可选**。一个能力的数量增加到三，并不必然产生第三个 variant；产生组合爆炸的是**每个能力各自可开可关**。由此得到本评审要留下的判据：

> **判据：一个能力是否落在 variant 轴上，取决于它在「加载了 Language 的每一个组合」里是否都可用。**
> 都可用 → 它属于两份列表的**公共前缀**，variant 数不变。
> 可开可关 → 它是**独立可选**能力，第二个这样的能力就会把 variant 数变成 4。

今天两份列表的公共前缀是两个读（`src/language/plugin.ts:512-524` 与 `:559-577`：`workFocusCurrentService` + `desktopSessionAwarenessPeekService`），只有 Repository CI relevance 是可选的——**恰好一个**，所以恰好两个 variant。这与 `exposure.ts:24-30` 的描述一致。

这条判据同时解释了一个已经存在的做法：`src/language/plugin.ts:496-499` 说 `confirm` 那条要求被追加到 `buildLanguagePlugin` 而不是 variant，理由是

> the variant axis is about **what a model may read** rather than about what this plugin keeps

也就是说，这个仓库已经区分了「variant 轴上的东西」和「插件级别的东西」，本评审只是把判据写实。

**因此 `exposure.ts:46-47` 那个更大的问题（能力可达性该不该由 composition 决定）继续搁置**，没有被这次 Review 触发。触发它需要的是**第二个独立可选**能力，不是第二个能力。

---

## 5. 第三问：「行动」今天能不能开？

**不能。四条理由，各自独立成立。**

### 5.1 Action Pipeline 零实现

`principles.md` §8 要求一切真实副作用走治理链，`§9:317-346` 要求 Receipt：

> Hikari 声称"我做了"必须有可验证回执。
> … Receipt 可以包含：provider；external id；timestamp；**revision / commit id**；result fingerprint…
> Hikari 对外表达完成状态时，应基于这些事实，而不是基于模型意愿。

而 `src/` 内**零 Action、零 Receipt**。这不是推测——本评审在 `src/` 全量搜索 `action-pipeline|ActionPipeline|ActionIntent|actionIntent|receipt|Receipt`，**零命中**。`docs/architecture/phase-4-p4-03-entry-review.md:165` 的词汇证据表已独立记下同一件事（`Act / Action`：代码证据「无」，冻结 contract「无」，不在任何判词里）。

### 5.2 当前阶段明确排除它

`docs/architecture/hikari-nervous-system-stage-v0.md:205-207`：

> **Action Pipeline。** `principles.md` §8 要求「所有真实行动统一进入 Action Pipeline 并产生 Receipt」，而 `src/` 内**零 Action、零 Receipt**。这是真实的架构欠账，但**它不在本阶段**——本阶段只记录它，不补它。

这是本阶段的范围决定，白纸黑字。开这一片等于走出当前阶段。

### 5.3 「没有治理链」此前是正确顺序，不是欠债——而本片会让那句话失效

`docs/architecture/hikari-current.md:560`：

> 今天没有权限系统的原因不是「还没做」：今天所有能力要么是只读查询，要么是自己内部的事实写入；**没有统一治理链，也没有 Action Pipeline**，因此也没有需要它们治理的动作。**这条顺序是正确的，不是欠债。**

这句话今天为真，因为它有一个前提：**没有真实副作用**。开出第一个仓库修改，这个前提当场消失——于是「先有没有副作用、再有治理链」的正确顺序被反过来，变成「先有副作用、治理链以后补」。这正是 §8 与 `plugin-design-spec.md:207` 用 `MUST` 禁止的事。

### 5.4 入口没有身份认证，而行动比事实更需要它

`docs/architecture/hikari-nervous-system-stage-v0.md:214-217` 记下一条必须继承的边界：

> `source` 只声称可证明的部分。`{ kind: 'human' }` **被禁止**——入口没有任何身份认证，这条管道上任何本机进程都能写入，写成 `human` 是在断言一个无法证明的事实。

今天连「写一条事实」都不允许声称它来自人，因为入口无法证明。而**行动**要求的是「有一个已认证的人让我这么做」——比事实更高的一档断言。`docs/architecture/hikari-nervous-system-stage-v0.md:210-211` 也把「多 Human / 身份认证」列为本阶段不解决。

需要说清楚的是**这不是本片否决的决定性理由**，因为声明路径今天的信任强度与它相同（同一条管道）。决定性理由是 §5.1–§5.3。它是一条必须被记录、并且在设计里被正面处理的约束，而不是可以绕过的细节。

### 5.5 结论

「行动」是一个**平面的开工**，不是给现有插件加能力。它的第一片至少要同时立起：Action Intent、Authority Policy、单调守卫、Approval（如需要）、Provider、Receipt、Durable Fact，外加 §5.4 那条身份约束的正面回答。这属于 C 级架构工作，需要人的 mandate，且应当自己有一份 Boundary Review。

---

## 6. 若将来要开：一条必须遵守的形状约束

这一节不设计实现，只记录一条从既有条文直接推出的约束，供下一份评审不必重新推导。

`core-architecture-v0.md:423`（§12 不变量 9）：

> 9. **改变现实必须基于当前状态，而不是旧判断。**

对「按一次对话的结论去改仓库」这件事，这条的直接含义是：**模型读到的状态不能作为落笔依据。** 从「模型看过」到「执行」之间状态可能已经变了（人自己改了文件、另一个进程改了、分支被推过）。因此执行时必须对**当前**状态重新核对，核对不通过时结果不得塌缩成一个成功。

这与既定裁决里的三态是同一件事：`docs/architecture/authorized-repository-action-v0-boundary-review.md` 已裁定结果为 `changed | unchanged | unknown`，且 `unknown` 不得塌缩。§12.9 给它提供了权威层依据。

同时，`core-architecture-v0.md:394-407` §11 的禁止清单仍然管着这条链的**形状**：

> 不得引入：中央 AI Brain；中央 Judgement；Super Orchestrator；GlobalWorldState；GlobalStateManager；万能 Service；万能消息对象；所有交互必经的统一通信层；所有 Provider 的通用智能调度器；按业务类型不断扩张的 Plugin 基类树。

「统一行动治理链」很容易被实现成一个 Super Orchestrator。「统一」在这里是**每个动作路径都必须满足的一组性质**，不是**一个必须经过的中央组件**。§8 的措辞也支持这个读法——它说的是「应统一经过**类似**」这样一条链，而不是「应统一向某个模块注册」。下一份评审要正面回答这个问题，不能默认前者。

---

## 7. 今天可以开的那一半：提议，而不是落笔

本片被 `BLOCKED` 的是**落笔**。用户目标里「通过自然对话识别我需要什么、然后修改我授权的代码仓库」这句话，前半段**不越过 Action 边界**：

> Hikari 可以读一个已授权仓库，把它当作**材料**框定给模型，产出一份**改动提议**交给那个人；由那个人决定要不要采纳。Hikari 自己不落笔。

为什么这一半是干净的：

- 它**不产生外部副作用**——产出的是给人和模型看的文字，以及（可选）一条持久事实。落笔的是人。
- 它走的是仓库**已经建立的**形状：`desktop-content-read` 就是「人给一个授权字 → 读一份外部材料 → 框定后交给模型」，并且已有注入测试（`test/language.test.mjs` 的「注入 fixture：正文伪造不出框定，也买不走回答出口」）。
- 它**不越过** §8：没有动作，所以没有绕过治理链的动作。`hikari-current.md:560` 那句话继续为真。
- 它不需要 Goal、Memory、Salience、身份认证——这些都不在链上。
- 它是**可逆的**：提议错了，人看见的是文字，不是被改坏的仓库。

一条必须同时成立的边界，否则这一半会自己滑回被禁的形状：**提议不得落笔到仓库里。** 写到 `docs/`、写一个 `.patch` 文件、改一个工作区文件，都是「改变外部现实」，因此都越过 Action 边界。提议只能以**对话里的文字**（或一条持久事实）交付，由人自己去落笔。这条不是措辞讲究——「先写一个 patch 文件」正是最容易把这一片变成 §2.2 那个被点名禁止形状的路径。

它要回答的问题只有一个，而且是 §4 那条判据的直接应用：**「读一个已授权仓库」是不是独立可选的能力？**

答案取决于 provider 在组合里的位置。`changeable-repositories` 今天是**无条件基础成员**（`src/cli/resident.ts:306-310`），而源码里为这个位置写下的理由，恰好是本判据最直接的支撑：

> It provides nothing, deliberately, and that is why it belongs in this composition rather than behind a flag the way the Repository CI chain is: an endpoint exists for exactly as long as its plugin is activated, so being here is what gives the ingress its lifetime. It also means every resident has the command, which is honest — **naming a directory as changeable authorizes nothing by itself, and there is nothing for it to be gated behind until the check that reads it exists.**
> —— `src/cli/resident.ts:298-302`

「there is nothing for it to be gated behind **until the check that reads it exists**」正是说：声明那一半被有意做成无条件的，**为的就是等一个读它的检查出现**。若这个读能力确实出现，它在每一个加载了 Language 的组合里都可用 → 它属于**公共前缀** → variant 数**仍然是 2**，`exposure.ts:46-47` 那个更大的问题继续搁置。

同一段注释还确认了另一半：Repository CI 链是**在 flag 后面**的那个（`the way the Repository CI chain is`），与本评审 §4 认定的「唯一一个独立可选能力」一致。

**这条推论是本评审最可操作的产出**：它说明「给 Language 加第二个能力」本身**不需要**触发 variant 爆炸，只要那个能力不是独立可选的。而「改仓库」之所以仍然被挡住，与这条判据无关——挡住它的是 §2 的平面归属。

---

## 8. 本评审新增了什么、没有新增什么

**新增：**

- 一条判据：能力是否落在 variant 轴上，取决于它在**每个**加载 Language 的组合里是否都可用（§4）。
- 一次平面归属判定：「改仓库」属于 Action 边界，不属于 exposure（§2），附三层权威的逐条锚点。
- 一条从 §12.9 推出的形状约束：落笔必须基于当前状态重新核对，不得以模型读到的状态为依据（§6）。
- 一次范围判定：「行动」是一片平面的开工，不是 Language 的 slice（§5）。

**没有新增：**

- **不新增任何 `MUST`。** 本文件是评审（历史证据面），按权威层级**不是**权威来源。§2、§5 引用的每一条 `MUST` 都来自 `principles.md` / `core-architecture-v0.md` / `plugin-design-spec.md` 的既有条文。
- **不修改 §11 禁止清单，不新增禁止项。**
- **不改动任何既有文本。** 本片尚未实施任何代码改动，因此没有需要按 R7.2 保留的旧文本。
- **不改 Language。** 本评审的结论之一就是它一行都不该改。

---

## 9. 待裁决事项

1. **是否接受「行动属于 Action 边界、不属于 Language」这个平面归属？** 若接受，Language 的 variant 轴本次不动。
2. **是否开 §7 的「提议而不落笔」这一片？** 它是今天唯一不越过 Action 边界、且直接服务于用户目标的前进方向。
3. **若开，`changeable-repositories` 是否保持无条件基础成员？** 这决定 §4 的判据落在哪一边（公共前缀 vs 第二个独立可选能力）。
4. **「行动」是否要立项为一次独立的 Action Pipeline Boundary Review？** 若是，它是 C 级工作，且需要先回答 §5.4 的身份约束与 §6 的「统一而不中央」。

---

## 10. 证据索引

| 主张 | 锚点 |
| --- | --- |
| Action Pipeline 平面定义、「模型」是动作来源之一 | `docs/architecture/principles.md:115-119` |
| §5 存在 ≠ 暴露 ≠ 授权 ≠ 执行 | `docs/architecture/principles.md:207-227` |
| §6 Provider / Policy / Consumer / Runtime 四分 | `docs/architecture/principles.md:231-241` |
| §7 权限是交集、单调收缩 | `docs/architecture/principles.md:264-280` |
| §8 治理链与四条「不允许」 | `docs/architecture/principles.md:284-313` |
| §9 Receipt 与 commit id、不以模型意愿表达完成 | `docs/architecture/principles.md:317-346` |
| 不变量 7 / 8 / 9 | `docs/architecture/core-architecture-v0.md:421-423` |
| §11 禁止重新引入的结构 | `docs/architecture/core-architecture-v0.md:394-407` |
| §13 冻结规则：先 Boundary Review | `docs/architecture/core-architecture-v0.md:430-441` |
| 平面路由表与 `MUST` 禁止绕开 Action governance | `docs/architecture/plugin-design-spec.md:189-207` |
| variant 守卫与「第二个独立可选能力」 | `src/language/exposure.ts:40-48` |
| exposure 不携带权限、§5 四问 | `src/language/exposure.ts:56-59` |
| 第二份列表是 Repository CI relevance | `src/language/exposure.ts:24-30` |
| 第二个这样的能力 = 本 Review 的触发条件 | `src/language/plugin.ts:79-82` |
| 第三个 variant = 同一触发条件 | `src/language/plugin.ts:204-211`、`:509-510` |
| variant 轴是「模型可读什么」，不是「插件留什么」 | `src/language/plugin.ts:496-499` |
| 两个 variant 的 requires / exposures / reader | `src/language/plugin.ts:512-524`、`:559-577` |
| Action Pipeline 不在本阶段 | `docs/architecture/hikari-nervous-system-stage-v0.md:205-207` |
| 入口无身份认证、`{kind:'human'}` 被禁止 | `docs/architecture/hikari-nervous-system-stage-v0.md:214-217` |
| 「正确顺序，不是欠债」 | `docs/architecture/hikari-current.md:560` |
| Action Pipeline 无实现 | `docs/architecture/hikari-current.md:574` |
| `Act / Action` 无代码、无 contract、不在判词 | `docs/architecture/phase-4-p4-03-entry-review.md:165` |
| 三态与不变量 4 | `docs/architecture/authorized-repository-action-v0-boundary-review.md` |
| 声明那一半的六条冻结 | `docs/architecture/changeable-repositories-v0-implementation-boundary-freeze.md` |
| `changeable-repositories` 是无条件基础成员，及其被记下的理由 | `src/cli/resident.ts:289-310`，理由逐字在 `:298-302` |
| Repository CI 链是 flag 后面的那一个 | `src/cli/resident.ts:299` |
| `src/` 内零 Action / 零 Receipt | 本评审全量搜索 `action-pipeline\|ActionPipeline\|ActionIntent\|actionIntent\|receipt\|Receipt`，零命中 |
