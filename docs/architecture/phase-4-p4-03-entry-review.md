# Hikari 第四阶段 P4-03 Entry Review

> 结论：**P4-03 ENTRY VERDICT: NARROW**
>
> 唯一前提：**P4-03 自始至终没有一份交付定义。** 唯一可称为其定义的那条 vertical slice 已经交付完毕，但交付在六个 supporting slice 名下——因此「P4-03 是否完成」今天**不可判定**。缺的不是工程，是一次人工裁决。
>
> 范围：**只读评审。本轮不实现、不新增 contract、不新增 slice、不授权任何实现。** 本文**没有**创建、也**没有**授权创建：salience Service、importance Service、notification、action、P4-03 core slice、任何新 contract。上列每一项都仍然不在当前已批准范围内。
>
> 上位原则：`principles.md:445-471`（§14 Perception ≠ Awareness）、`core-architecture-v0.md:283-289`（§6.6 Judgement）、`core-architecture-v0.md:391-404`（§11 禁止清单）、`core-architecture-v0.md:361-387`（§10 明确延后）、`core-architecture-v0.md:425-436`（§13 冻结规则）、`plugin-design-spec.md` §16（Contract Creation Gate）。**本轮没有新增第二套架构原则。**

---

## 1. 本轮审查目标

人工给定的真实基线（六个 supporting slice 全部落地），加上一件**由真实用户在 production Resident 中完成的事**：

```text
hikari focus declare "t1mb2rg/hikari-new"
hikari focus declare "P4-03"
hikari relevance repository-ci status
→  Repository CI relevance：relevant
   与工作焦点逐字相同：t1mb2rg/hikari-new
```

本轮回答十一个问题：P4-03 原本想交付什么、六个 slice 满足与未满足哪些前提、relevance 是核心还是入口、若缺一个 core slice 它最小是什么、它是否必然涉及 salience / importance / notification / action、哪些词有证据、是否存在不引入被禁结构的最小 completion condition、P4-03 是否应当正式开始、以及文档表述是否需要修正。

**本轮不落地。** 结论为 NARROW，理由见 §10。

---

## 2. 证据基础与锚定纪律

每条结论锚定到当前工作树的真实源码或真实文档。作为地基的**工作区事实**（写完本文前实测）：

```text
git log --oneline -3   e5dde7f / b78ae57 / e0403ec
origin/main            e5dde7fa40e3b45ed9de27d2c024336f0a181c53
origin/main..HEAD      0
git status --short     空
.gitnexus/meta.json    lastCommit = e5dde7fa40e3b45ed9de27d2c024336f0a181c53（与 HEAD 一致）
```

本文引用 `src/` 的载荷锚点**由主 Agent 亲自复验**，不转述子 Agent 报告：`src/repository-ci-relevance/plugin.ts:37`（`requires: [workFocusCurrentService, repositoryCiAwarenessService]` / `provides: []`）、`:69-71`（只把 `assessment.snapshot` 交给判定）、`src/repository-ci-relevance/judgement.ts:60-65`、`src/repository-ci-relevance/types.ts:25`（`'relevant' | 'unknown'`）、`src/work-focus/contracts.ts:30`（`defineService('work-focus.current', 1)`）、`src/cli/options.ts:100,136,209-221`（relevance CLI 语法）。

**子 Agent 提供的一处结论已被主 Agent 用源码否证**，见 §11 第 2 条。

---

## 3. P4-03 在权威文档中的原始状态：**它没有定义**

这是本轮最重要的发现，也是 verdict 之所以是 NARROW 的原因。逐条锚定：

| 事实 | 锚点 |
| --- | --- |
| P4-03 首次出现在仓库时，是一句**拒绝规划** | `docs/development/phase-4-resident.md:276`（`0db5516`）逐字：「**本文件不规划 P4-03。** 下一阶段的范围与取舍不在本轮决定。」 |
| 它在进度表中首次出现时**没有名字**，只有一个状态 | `e23d382` 的 `docs/development/current-stage.md:55`：`P4-03    未开始                                  not started` |
| 至今仍然没有名字 | `docs/development/current-stage.md:94` 同型，条目仍只有编号与 `not started` |
| 仓库中不存在任何 roadmap / 阶段规划文件 | `git ls-files` 无 `docs/plans/*`；顶层无 `README.md`；`docs/` 下无规划类 artifact |
| 同阶段其它编号**都有名字** | `:90-93`：P4-01 Desktop Session Awareness Loop v1、P4-01.1 Awareness Loop timer 上界正确性修正、P4-02 Resident Process Composition v1、P4-02.1 Resident Local Control v1 |

唯一把 P4-03 当作**有内容的对象**处理的，是两份 Boundary Review 的标题与正文。它们把 P4-03 当作**一个开放问题**逐步压窄：

```text
87605c6  P4-03 Explicit Human Reference Frame Boundary Review        verdict BLOCKED
72a0ce4  P4-03 Explicit Work Focus Vertical Slice Boundary Review    verdict NARROW
```

而 `72a0ce4` §1 给出的四步，是仓库内**唯一**可称为 P4-03 定义的东西：

```text
Human explicit work focus
      ↓
current explicit focus state
      ↓
Repository CI relevance judgement
      ↓
relevant | unknown
```

**结论**：问「P4-03 原本真正想交付什么」，诚实答案是——**在权威文档里 P4-03 没有「原本」**。它是一个**保留编号**加一个**被两份评审逐步压窄的开放问题**。这不降低本轮结论，反而决定了它：一个没有交付定义的编号，不能「正式开始」。

---

## 4. 六个 supporting slice 对前提的覆盖

把 §3 的四步拆成七条前提（P1–P7），逐条对照：

| slice | 交付物 | 覆盖 | 关键锚点 |
| --- | --- | --- | --- |
| Git Repository Perception v1 | `git-repository.current@1`，config `{ repositoryRoot }`，显式、无默认、无 cwd 回退 | **P1** 具名本地对象源 | `src/git-repository/plugin.ts:40-42`；`docs/development/phase-4-git-repository-perception.md:3-9` |
| GitHub CI Perception v1 | `github-ci.current@1`，config `{ repository }`，观测值是 **GitHub API 报的规范拼写** | **P2** 第二个源，且是 relevance 判据的**唯一词汇来源** | `src/github-ci/types.ts:47-56`；`docs/development/current-stage.md:1263` |
| Repository CI World v1 | `repository-ci-world.current@1`：两份 observation 进同一 snapshot + 逐条可用性 | **P3** 同一 scope | `src/repository-ci-world/plugin.ts:29-60`；`docs/development/phase-4-repository-ci-world.md:29-40` |
| Repository CI Awareness v1 | `repository-ci-awareness.current@1`：跨源 commit 比较，`snapshot` 按引用透传 | **P4** 判定的唯一合法输入通道 | `src/repository-ci-awareness/plugin.ts:25,49-61`；`docs/development/current-stage.md:13` |
| Explicit Work Focus Local Ingress v1 | `work-focus` Plugin：本机端点 + `declare` / `replace` / `clear` / `status`，state 在 activation 闭包内 | **P5** human ingress（步骤 A） | `src/work-focus/plugin.ts:60,69-74`；`docs/architecture/phase-4-explicit-work-focus-review.md:105-131` |
| Repository CI Relevance v1 | ① `work-focus.current@1` 被翻转创建；② `repository-ci-relevance` Plugin（端点 + 纯函数判定）；③ `hikari relevance repository-ci status` | **P6** 状态可读契约、**P7** 判词与出口（步骤 B/C/D） | `src/work-focus/contracts.ts:30`；`src/repository-ci-relevance/plugin.ts:37-38,69-71`；`src/repository-ci-relevance/judgement.ts:60-65`；`src/cli/options.ts:209-221` |

**分层是干净的**：`work-focus`（`requires: []` 的叶子）→ 恰好一条边 `work-focus.current@1` → `repository-ci-relevance`（`provides: []`）→ 一条边 `repository-ci-awareness.current@1` → `repository-ci-world.current@1` → 两个源。没有任何插件越过自己的层。

> **一处必须如实标注**：`src/repository-ci-relevance/judgement.ts:18` 有一行 `import type { RepositoryCiWorldSnapshot }`。它是 **type-only import**，编译后擦除，不产生运行时边、不在 `requires` 里、不参与 Runtime 依赖图，且它拿到的 `Snapshot` 正是 awareness 已经按引用携带的那个对象。它与本文「恰好一条边」的结论不冲突（`src/repository-ci-awareness/types.ts:1` 是同一写法的既有先例），但它确实以 World 的类型名出现在 relevance 层，因此在此显式说明，不默认它显然成立。

**结论**：§3 那条 slice 的**机制面（P1–P7）已被六个 slice 全部覆盖，代码路径端到端闭合**。判词的两个值由 `judgeRelevance` 唯一产出，元数由类型钉死（`types.ts:25`），并有闭包测试证明输入空间里只有这两个词可达。

---

## 5. 「已发生」面：本轮由真实用户闭合

`docs/architecture/phase-4-explicit-human-reference-review.md:290-294` 列出四条重新审查触发条件。本轮逐条落地：

| 触发条件 | 状态 |
| --- | --- |
| 出现真实 runtime human ingress | **已满足**（slice 5，机制面） |
| 出现真实 reader 会读取该判词 | **已满足**（本轮：真实用户在 production Resident 中读取，见 §1） |
| 人工对无 consumer contract 作出针对本 slice 的裁决 | **已发生**（`docs/development/current-stage.md:35`，Contract Gate 由「不创建」翻转为「创建」） |
| 出现一个**已真实持有 designation 的 composition** | **已满足**（本轮：用户对 production Resident 声明了两个 designation） |

`phase-4-explicit-human-reference-review.md:248` 记的唯一 blocker 是「尚未出现真实 human designation 与真实 reader 所形成的已发生跨模块语义」。**这条 blocker 在本轮已经不存在。**

> **证据等级（必须与结论同时读）**：`relevant` 在**完整生产组合**上的证明是**人工的、依赖网络与真实仓库的**，因此不可能被自动化测试钉住。仓库内自动化证据的最长链路是「生产 Plugin + 生产端点 + 生产客户端 + **注入的两个 provider**」；而完整生产组合的自动化测试只走到 `unknown`（因为它用一个不存在的 GitHub 仓库名且新数据目录没有任何 designation）。**不得**把本轮的验证转述为「已端到端自动化验证过 `relevant`」。

---

## 6. relevance 在 §14 链路中的位置：**从未被指派**

`principles.md:457-469`（§14）的链路是三格：

```text
事实标准化 / Contextualization  →  Salience / Importance Judgement  →  Ignore / Remember / Ask / Notify / Act
```

仓库对前两格的记账是明确的：

- `docs/development/current-stage.md:270`：P3-04 **落在 Contextualization 这一格**，且只落在最窄面；
- `docs/development/current-stage.md:1306`：`repository-ci-awareness` 是**第二个 comparison slice**，二者「都**只**做比较」；
- 同处紧接着写「链路其余部分——Salience / Importance 判断、Ignore / Remember / Ask / Notify / Act——**均未进入，且未被预埋**」。

**但 relevance 从未被放进任何一格。** 它既不在 `:270` 的 Contextualization 记账里，也不在 `:1306` 的「其余部分」清单里，`:1305` 的「感知的语义解读」条目也没有提它。全仓检索「relevance」与「Salience / Importance / Contextualization」的同现，只找到把它**排除**在 importance / salience 之外的句子（`current-stage.md:1309`）。

这不是一处遗漏，而是一处**尚未作出的分类裁决**。它之所以要紧，是因为它直接决定 Q4：

```text
若 relevance ∈ Contextualization 格   → P4-03 的 judgement 格尚未开始
若 relevance ∈ Salience/Importance 格 → P4-03 的 judgement 格已经有第一个真实实现
```

今天证据不足以替人工作这个裁决，本文也不替它作。

---

## 7. 词汇证据表：哪些有证据，哪些只是概念

| 词 | 权威定义锚点 | 代码证据 | 冻结 contract | 出现在哪个判词 |
| --- | --- | --- | --- | --- |
| **Contextualization** | `principles.md:464`；`current-stage.md:270` | **有** —— `src/desktop-session-awareness/plugin.ts` | **有** —— `defineService('desktop-session-awareness.current', 1)` | **是** —— P3-04，`changed \| stable \| indeterminate` |
| **Salience** | `principles.md:466` | **无** | **无** | 否（且被测试列为禁止词） |
| **Importance Judgement** | `principles.md:466` | **无** | **无** | 否 |
| **Significance** | 无独立定义，只作为**被拒绝的理由**出现在注释里 | **无** | **无** | 否 |
| **Ignore** | `principles.md:468` | **无** | **无** | 否 |
| **Remember** | `principles.md:468`、`:453` | **无** | **无** | 否（被显式声明为判词所不蕴含） |
| **Ask** | `principles.md:468` | **无** | **无** | 否 |
| **Notify / Notification** | `principles.md:468`；`:519` 仅作为未来节点能力名 | **无** | **无** | 否（被显式声明为判词所不蕴含） |
| **Act / Action** | `principles.md:284-313`（§8 Action Pipeline）；`core-architecture-v0.md:417`（§12.8） | **无** —— `src/` 内零 Action / 零 Receipt | **无** | 否 |

**今天仓库里已落地的 judgement 恰好三个**，全部是**比较或查找**，没有一个做选择：

```text
1. 桌面会话 payload 变化比较（P3-04）   changed | stable | indeterminate     有 baseline 状态
2. 跨源 commit 比较（repository-ci-awareness） same | different | indeterminate  零状态
3. 逐字相等 relevance（repository-ci-relevance） relevant | unknown            零状态、无 Service
```

**一处精确性更正**：`Generic Reference Frame` 与 `Service Locator` **不在** `core-architecture-v0.md:391-404`（§11）的逐字清单里——该清单列的是中央 AI Brain / 中央 Judgement / Super Orchestrator / GlobalWorldState / GlobalStateManager / 万能 Service / 万能消息对象 / 统一通信层 / 通用智能调度器 / Plugin 基类树。前两个名词的出处是 `CLAUDE.md:233-243` 对同一禁令域的展开命名。二者效力同源，但**字面不同**，引用时不应混为一谈。

---

## 8. 是否「必然」要往上做 salience / importance / notification / action

**不必，而且冻结原则要求的方向相反。**

1. **§14 的链路是「推荐」，不是「必须」。** `principles.md:455` 逐字为 `推荐思路：`，其后才是链路块。§14 全文没有一句要求实现链路全部环节。
2. **最高优先级的冻结规则要求停。** `core-architecture-v0.md:427-432`（§13）：「不再因为纯理论问题继续增加核心抽象；**新概念必须由至少一个真实实现问题驱动**」。`:363`（§10）「当前冻结，不继续展开」，`:381-387` 的触发条件是「**真实实现已经出现无法被当前模型正确表达的问题**」，而不是「未来可能会有」。
3. **判词层闭合是被 §6.6 明确允许的形状。** `core-architecture-v0.md:285-287`：禁的是中央 Judgement Domain；「判断是自治插件内部的局部活动」。第 §4 节的分层图正是这个形状。
4. **唯一带「必须」的条款不构成向上要求。** `core-architecture-v0.md:417`（§12.8）「真实副作用必须经过 Action 边界」是**条件式**约束——若做动作则须走 Action 边界，不是「必须做动作」。今天 `src/` 内零 Action，该条无约束对象。

**因此两个判断必须分开**：

```text
「必须继续往上做 Salience / Importance / Notification / Action」
  —— 没有任何冻结原则这样要求。§13 / §10 / §18 共同要求：没有真实实现问题就停在这里。

「在判词层闭合」
  —— 允许。条件是：判词留在自治插件内、不为没有 reader 的判词发布 contract、
     不把判词层说成 Awareness 层、将来若做副作用必须走 Action 边界。
```

**关键的结构性发现**：链路的三格之间**没有中间格**。所以「在判词层闭合」与「往上走」之间不存在第三个选项——**更低层就是现在这一层**。若 P4-03 要越过今天所在的位置，它必然进入 Salience / Importance Judgement 格；而 `Ignore / Remember / Ask / Notify / Act` 是再上一格，**不被蕴含**。

---

## 9. 最小 completion condition：存在，且已经被满足

不引入中央 Judgement / Generic Reference Frame / GlobalWorldState 的最小 P4-03 completion condition 是：

```text
一个 domain-local judgement plugin，
经恰好一条边读取 human designation 与一个 machine observation，
产生一个二值判词，
且该判词有一个真实 reader。
```

逐项对照今天的事实：domain-local plugin ✅（`repository-ci-relevance`，`provides: []`，判词留在插件内）、恰好一条边 ✅（`work-focus.current@1`，§4）、二值判词 ✅（`relevant | unknown`，`types.ts:25`）、真实 reader ✅（§5）。**全部满足，且没有引入任何被禁结构。**

---

## 10. 结论

```text
P4-03 ENTRY VERDICT: NARROW
```

**唯一前提：P4-03 需要一份交付定义——这是一次人工裁决，不是一次实现。**

拆开说，因为它容易被读成「还差工程」：

- **不缺机制**——§4 的 P1–P7 全部覆盖，代码路径端到端闭合；
- **不缺 reader**——§5，真实用户已在 production Resident 中读取判词；
- **不缺完成条件**——§9 的最小 completion condition 已经满足；
- **不缺架构许可**——§8，判词层闭合被 §6.6 允许，且 §13 冻结规则要求不为想象的需求继续加抽象；
- **缺的是：P4-03 到底是什么。**

因为 §3 已经证明 P4-03 从未有过交付定义，而**唯一可称为其定义的那条 vertical slice，已经被六个 supporting slice 交付完毕**。一个没有定义的编号不能「正式开始」——那会是替人工裁决做掉决定，并把已经交付的东西重新包装成一个待办的 slice。

**两条正当的下一步，均属人工裁决，本文不替选：**

```text
(a) 收口——承认 P4-03 的内容已由六个 supporting slice 交付，编号不再保留，
    并把这件事如实记进 current-stage.md（含「它不是以 P4-03 的名义交付的」）。

(b) 定义——人工给出 P4-03 的**新**内容。那不是「开始 P4-03」，那是「定义 P4-03」。
```

若走 (b)，按 §8 的结构性约束，最小 core slice 只能是**第一个 Salience / Importance Judgement**——因为链路中没有中间格；而它**不必**涉及 notification 或 action。

---

## 11. 需要修正的文档陈述（本轮实测发现，不在本轮修改）

1. **`docs/development/current-stage.md:94` 的进度表**把 P4-03 记为 `not started`。它与 `:98-102` 刻意一致，**不是自相矛盾**；但若被读成「P4-03 想做的那件事还没做」，就是**错的**。应区分「编号未被占用」与「其被期待的内容已交付」。
2. **`docs/development/current-stage.md:19` 已失效。** 该行逐字写着「`repository-ci-awareness.current@1` 当前没有 production consumer」。**本轮由主 Agent 用源码否证**：`src/repository-ci-relevance/plugin.ts:37` 的 `requires` 里就包含 `repositoryCiAwarenessService`——在**显式启用 Repository CI 的组合**中，`repository-ci-relevance` 就是它的 production consumer。（上一轮子 Agent 的一处相反说法据此被否证。）默认组合中仍然没有 consumer，因此准确写法需要区分两种组合。
3. **`docs/architecture/phase-4-explicit-work-focus-review.md:57` 的锚点位移只追到一半。** 它记到「`src/cli/resident.ts` 的『Exactly eight plugins, and nothing else.』」，而**现行源码已不再有这句话**：现在是 `src/cli/resident.ts:115-116` 的两条组合描述。计数纪律的落点仍是 `productionComposition`。

---

## 12. 本轮明确未做

- 未实现任何代码，未新增任何 contract，`src/` 零改动；
- 未新增 supporting slice，未创建 P4-03 core slice；
- 未引入 salience / importance / significance / notification / action；
- 未创建 Service、Event、端点、CLI command；
- 未修改 `current-stage.md` 或任何既有文档（§11 只是记录，不是修改）；
- 未创建 `docs/plans`，未新建 feature branch，未 commit。

---

## 13. 已知限制

- 本文的 NARROW 是**关于「P4-03 是否具备正式开始的条件」的判定**，**不是**「P4-03 无法继续」。
- §5 的「已发生」证据是**人工的、依赖网络与真实仓库**的，不可被自动化测试复现；仓库内自动化证据的最长链路止于注入 provider。
- §6 的「relevance 的链路位置未被指派」是**记账事实**，不是本文提出的分类建议；本文不替人工作该分类。
- §8 的结论绑定当前冻结文档（`principles.md` §14 的「推荐思路」措辞与 `core-architecture-v0.md` §13 冻结规则）；若这些文本被重新审查，本节需要重读。
- 本文不构成任何 contract 的授权，也不构成对「未来会有 salience」「未来会有 action」这类假设的认可。

---

## Human Stage Decision

> **本节由人工阶段裁决追加，写于 §1–§13 完成之后。**
> **上面的研究结论不改写**：本文的研究结果是 `NARROW`，其唯一缺口是**人工阶段定义**。
> 本节记录的是**该缺口如何被裁决**——不是对研究结论的修订。

### 裁决

**人工选择「收口」。**

```text
- 不为 P4-03 定义新的 core slice
- 不进入 Salience / Importance
- 不进入 Notification / Action
- 将已经交付的实际能力正式收口为 P4-03
- P4-03 正式名称：Human-Referenced Repository CI Relevance v1
```

**P4-03 正式定义为：**

```text
P4-03 Human-Referenced Repository CI Relevance v1     COMPLETE
```

### 定义的性质

**这是基于已经实际交付的六个 supporting slices 和真实 production 验证，在阶段收口时形成的定义。**

必须明确记录，且**不得**写成别的样子：

```text
P4-03 在此前【没有】预先冻结的交付定义。
它的实际边界是在六个 supporting slice 的现实实现问题中逐步收敛出来的。
```

**不得**写作「P4-03 原本就计划做这个」，也**不得**写作「这是最初设计目标」。§3 的考据已经证明：它首次出现时是一句拒绝规划，此后长期只是一个保留编号加一个被两份 Boundary Review 逐步压窄的开放问题。

### 两条结论的关系

```text
研究得出 NARROW  →  人工阶段治理裁决使其得以收口
```

两者不冲突，也不互相改写：**NARROW 说的是「在既有定义下无法开始」，裁决做的是「给出定义」。** 研究结论保留原样，收口记录作为其后续治理动作追加。

### 本裁决不改变的事

- 不改变 §6 的记账事实（relevance 在 `principles.md` §14 链路中的位置**仍然未被指派**）；
- 不改变 §7 的词汇证据表（Salience / Importance / Notification / Action **仍然零代码、零 contract**）；
- 不改变 §8 的结构性结论（链路三格之间**没有中间格**）；
- 不改变 §11 记录的文档修正项——其中第 1、2、3 条已在 `docs/development/current-stage.md` 与本文档体系内完成最小事实修正；
- **不构成**对任何未落地 contract、Service、Event 的授权，也**不构成**对 Salience / Importance / Notification / Action 的立项。

### 落地位置

P4-03 的正式交付定义、completion condition、非目标与 Phase 4 状态，记录在 `docs/development/current-stage.md` 的「**P4-03 收口**」一节。
