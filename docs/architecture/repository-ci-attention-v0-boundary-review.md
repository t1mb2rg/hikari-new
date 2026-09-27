# REPOSITORY CI ATTENTION v0 — BOUNDARY REVIEW

> **性质**：仅设计。**本文件不实现任何东西**、不修改 Runtime、不创建 Memory、不创建 Salience、不创建 generic Notification Service、不 commit production code。
>
> **本轮没有产生任何代码改动、没有产生任何 contract、没有产生任何测试。**
>
> **裁定：`BLOCKED`。** 阻塞点不在判词侧（判词侧可设计且不越界），而在**主动出站人类通道**：它今天不存在，且它是 C 级边界问题而不是一个 capability slice。详见 §19。

---

## 0. 方法与证据

### 0.1 本轮做什么

本轮的题目是：**Hikari 的第一个主动介入闭环是否成立。**

具体设想是四个条件同时满足时——

```text
(1) 用户明确关注某个 repository
(2) Hikari 观察到该 repository 的 CI
(3) repository 与当前显式 Work Focus 的 relevance 已成立
(4) CI 出现一个「新的失败状态」
```

——Hikari 是否**可以**形成一个 bounded judgement / occurrence「当前明确关注的 repository 出现了新的 CI failure」，并**通过 Hikari 的人类出口主动告诉用户**。

**要回答的不是「什么事情重要」。** 这一点在 §8 会被逐字检验，因为它是本设计最容易偷偷滑进去的地方。

### 0.2 证据等级

本文件的每一条承重结论都锚定到**第一手读取的源码或文档行**。Windows 上无法运行真实模型端点，因此**没有任何模型语义验证**；本轮的对抗性检验全部是**源码/文档/可执行行为**层面的，§15 记录了这一点。

### 0.3 一处必须写明的调查限制

本轮派出了一个只读 docs-sweep 子 Agent 调查「Repository CI 链的文档管辖」。它完成了并返回了可用结论，**但其每一条在本文件被引用前都经过主 Agent 回锚到源文件**。凡主 Agent 未能第一手确认的引用，本文件不写。

### 0.4 本轮不做的判断

- **不**判断 Hikari 是否应当最终变得主动（那是产品方向，且 `docs/vision/hikari-soul.md` §5 已有明确取向，见 §11.4）。
- **不**判断主动通道该由谁拥有（那是 §19 的解锁条件，属于新的 Boundary Decision）。
- **不**替 P4-04 或任何后续阶段发明范围。

---

## 1. Current Repository CI pipeline（现状盘点）

Repository CI 链**由五个成员组成**，**全部已完成并收口**，但**均以 supporting slice / 工作标签存在，不占用任何阶段编号**，链本身**没有独立阶段编号**（`docs/development/current-stage.md:1390`、`:1394`）。其完成被并入 `P4-03 Human-Referenced Repository CI Relevance v1 COMPLETE`。

### 1.1 组合成员与顺序

`current-stage.md:755-763` 逐字：显式给出 `--repository-root` 与 `--repository` 之后，在默认九个成员之后**追加**五个：

```text
10  git-repository
11  github-ci
12  repository-ci-world
13  repository-ci-awareness
14  repository-ci-relevance
```

**这条链只被条件化组合。** `current-stage.md:59` 冻结：配置规则是**原子**的（要么都给、要么都不给），**没有**默认值、**没有** cwd → repository-root 推断、**没有** git remote → GitHub repository 推断、**没有**自动发现；v1 **只允许 0 或 1 个**显式 repository scope。

`current-stage.md:773` 冻结 Resident 的边界：它对这条链**只**知道一件事——那两个配置值有没有一起给。**它不知道 repository 是什么、CI 是什么、两个 commit 串是否相等、relevance 是什么意思。**

### 1.2 五个成员各自拥有的东西

| # | 成员 | 拥有 | 关键性质 |
| --- | --- | --- | --- |
| 1 | `git-repository` | 本地 Git 对象的一次观测 | 具名本地对象，无 relevance、无 identity |
| 2 | `github-ci` | GitHub CI 的一次观测 | 第二具名对象源 |
| 3 | `repository-ci-world` | 同一显式 repository scope 内的**两份 observation + 逐条可用性** | pull-only：没有 `current()` 就没有任何观测发生（`current-stage.md:1444`） |
| 4 | `repository-ci-awareness` | 跨源 commit 比较 | `same` / `different` / `indeterminate` |
| 5 | `repository-ci-relevance` | 逐字相等 relevance | `relevant` / `unknown` |

### 1.3 今天在链上**没有**的东西（逐条冻结）

`current-stage.md:65`（Repository CI Relevance v1 口径更新块内）逐字：

> **仍然全部未进入，且未被预埋：** repository identity、importance、salience、notification、action、Event、持久化、后台 relevance 循环、多 repository 抽象、自动发现、模型匹配。

`current-stage.md:1433`（P4-03 收口后口径）逐字：

> 特别注意三个等式**都不成立**：`relevant ≠ important`、`relevant ≠ salient`、`relevant ≠ should notify`。

`current-stage.md:1932-1945`（P4-03 非目标，冻结）逐字列出 `Notification`、`Interruptibility`、`Action`、`Central Judgement` 等。

**这三处合起来意味着**：本设计想做的第 (4) 步「主动告诉用户」，其**语义坐标**（Notify）与**机制坐标**（Event / 后台循环 / notification）都被逐字写在「未进入，且未被预埋」清单上。

### 1.4 一处链上最接近「主动」的既有物

`current-stage.md:39` 记录：`repository-ci-awareness.current@1` 在**默认组合**中没有 production consumer，但在**显式组合**中**有**——`repository-ci-relevance` 就是它的 production consumer。

**这是 pull 而非 push**：relevance 只在被调用时读它。链上至今**没有任何一分钟是 Hikari 自己发起的**。

### 1.5 全仓库 Event / Loop 的第一手盘点

主 Agent 第一手 `grep`（`src/` 全量）：

```text
grep -rn "defineEvent" src/   → 4 行，其中真正的【契约创建调用点】只有 1 处：

  src/runtime/contracts.ts:22                 函数定义本身
  src/index.ts:1                              再导出
  src/desktop-session-awareness-loop/contracts.ts:1    import
  src/desktop-session-awareness-loop/contracts.ts:12   ← 唯一的创建调用点
      defineEvent<DesktopSessionAwarenessAssessment>('desktop-session-awareness-loop.assessed', 1)

src/ 下名字含 loop 的目录：1
  desktop-session-awareness-loop
```

**整个仓库只有一个 Event contract，只有一个自驱动循环，两者属于同一个模块，且它在生产中零订阅者。** 这是 §9 与 §19 的算术基础。

---

## 2. 现有 judgement / Service / Event 表面

### 2.1 今天落地的 judgement 恰好三个

`docs/architecture/phase-4-p4-03-entry-review.md:163-169` 逐字：

```text
1. 桌面会话 payload 变化比较（P3-04）   changed | stable | indeterminate     有 baseline 状态
2. 跨源 commit 比较（repository-ci-awareness） same | different | indeterminate  零状态
3. 逐字相等 relevance（repository-ci-relevance） relevant | unknown            零状态、无 Service
```

其上方的裁定句逐字为：

> **今天仓库里已落地的 judgement 恰好三个**，全部是**比较或查找**，**没有一个做选择**。

**「没有一个做选择」是本节最重要的一句话**，§8 会用它来判定「新的 CI failure」到底落在哪一格。

### 2.2 今天可用的 public Service（第一手读 `contracts.ts`）

```text
github-ci.current@1                    gitHubCiService                  src/github-ci/contracts.ts:12
repository-ci-awareness.current@1      repositoryCiAwarenessService     src/repository-ci-awareness/contracts.ts:13
repository-ci-relevance.current@1      repositoryCiRelevanceService     src/repository-ci-relevance/contracts.ts:47
work-focus.current@1                   （Repository CI Relevance v1 起提供）
desktop-session-awareness.peek@1       （Desktop Inspection Semantics v1 起提供）
desktop-session-awareness.current@1    （仅 Loop 持有）
```

### 2.3 今天可用的 Event

只有 `desktop-session-awareness-loop.assessed@1`，**生产订阅者为 0**。

`docs/development/phase-4-desktop-session-awareness-loop.md:91` 逐字：

> **0 subscriber 是合法状态。** Event 的合法性来自 Producer 拥有的、真实且稳定的 occurrence semantics，不来自 subscriber count。

同一文件 `:475` 逐字给出上限声明：

> 同时必须记住：**0 subscriber 是合法的。** 本轮交付的是一条**可以被订阅**的链路，不是一条**已被消费**的链路。在真实订阅方出现之前，这条链路的端到端价值**尚未被证明**。

**这两句是本轮最危险的先例**，因为它表面上提供了「先建链路、后补消费者」的许可。§15 攻击 4 会检验它是否真的适用于本设计。

### 2.4 `github-ci` 观测的语义边界（第一手读源码）

`src/github-ci/types.ts:27-30` 明确**拒绝**封闭的状态 / 结论集合——`status: string`、`GitHubCiConclusion = { kind: 'reported'; value: string } | { kind: 'absent' }`。这是一个刻意的决定：**把 GitHub 的结论词表搬进这个文件，等于把一个解析失败变成类型失败**。

`src/github-ci/plugin.ts:45-49` 的 `REPOSITORY_PATTERN` 逐字：

```text
^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$
```

**斜杠是必需的。** 因此 `observation.repository` **永远是** `owner/name`。

**这两条合起来给本设计下了两个硬约束**：
1. 「failure」这个词在本设计里必须由**本层自己**给出固定的词表，因为上游刻意不给。
2. 「用户指定了 `hikari-new`」与「observation 报的是 `t1mb2rg/hikari-new`」**不相等**——这正是 `test/repository-ci-relevance.test.mjs:96-97` 钉住的既有真值。

---

## 3. 「新的 CI failure」的定义

### 3.1 先破一个默认假设

任务书的措辞是「CI 出现一个**新的失败状态**」。这句话在被写成代码之前必须回答一个它自己没回答的问题：

```text
「新」是相对于什么？
```

三个候选，语义完全不同：

| 候选 | 「新」的含义 | 后果 |
| --- | --- | --- |
| A. 相对于**上一次 Hikari 看到的东西** | activation-local | 重启后失忆；静默 |
| B. 相对于**这个 run id 是否见过** | 需要跨 activation 记住见过的 run id | 需要持久化，或需要跨重启的存储 |
| C. 相对于**人类上一次被告知** | 需要记住「告诉了谁、什么时候」 | 引入通知账本 |

**C 是 Salience/Notification 的地界**（它要求 Hikari 维护「我打扰过这个人」的模型）。**B 需要持久化**，而持久化在 `current-stage.md:65` 对这条链是未进入项。**只有 A 不需要任何新存储**，且它与既有先例同型。

本设计**只取 A**，并且 §7 会把这个选择的代价写清楚。

### 3.2 A 之下的最小机械规则

需要在一份 activation-local 状态上定义。设每次观测导出三个量：

```text
available  = snapshot.githubCi.kind === 'available'
reported   = observation.latestRun.kind === 'reported'
runId      = reported ? latestRun.run.id : undefined
failed(c)  = c.kind === 'reported' && FAILURE_WORDS.has(c.value)
```

状态（**唯一的一份**）：

```ts
previous: { readonly runId: number | undefined; readonly failed: boolean } | undefined
```

规则（三条，无第四条）：

```text
1. 若 !available
     → 返回「无 occurrence」，且【不动 previous】
       （一次失败的观测不是一次「现在没事」，它是一次没做成的比较；
        把 source 够不着当成状态变化，会让 CI 供应商抖动变成通知风暴。）

2. 若 previous === undefined
     → 令 previous := { runId, failed(current) }
       → 返回「无 occurrence」（这是 baseline）

3. 否则
     fire := failed(current) && !(previous.runId === runId && previous.failed)
     令 previous := { runId, failed(current) }
     → fire ? occurrence : 「无 occurrence」
```

### 3.3 六种情形的逐条覆盖

任务书 §17 要求攻击「新 CI failure」的定义，因此这里把六种情形逐条列出（**这是定义的一部分，不是附录**）：

| # | 情形 | 走哪一步 | 结果 |
| --- | --- | --- | --- |
| A | 首次观测（含每次重启后的首次） | 步 2 | **不**报（baseline） |
| B | 同一个 run，重复轮询，一直失败 | 步 3，`previous.runId === runId && previous.failed` | **不**报 |
| C | 同一个 run id，`in_progress` → `failure` | 步 3，runId 相同但 `previous.failed === false` | **报** |
| D | 新 run id，结论失败 | 步 3，runId 不同 | **报** |
| E | 失败 → 成功 → 又失败 | 步 3，新的失败必然带新 runId | **报** |
| F | 重启后的再次观测 | 步 2 | **不**报 |

### 3.4 三个必须同时写下的边界

**(a) relevance 不得参与 baseline 的推进。**

规则里 `previous` 的更新**与 relevance 判词无关**。理由是直接的：如果 baseline 只在 `relevant` 时推进，那么「先有一个失败，之后人类才 declare 这个 repo」会在 declare 的瞬间报出一句「你的仓库 CI 失败了」——而那是「**现在正在失败**」，不是「**出现了新的失败**」。

任务的第 (4) 条说的是后者。**把前者说成后者就是不诚实的措辞。**

**代价必须同时写明**：一个刚 declare 完焦点就发现 CI 已经红着的人，**永远收不到这条 occurrence**。这是本定义的诚实成本，不是 bug。

**(b) `FAILURE_WORDS` 必须由本层拥有，并且是一个有界的常量表。**

上游刻意不给词表（§2.4）。因此「什么叫 failure」这个解释权**必然**落在本层。这**不是** importance 判断——它是**词表归属**，与 `repository-ci-relevance` 拥有「什么叫逐字相等」、`repository-ci-awareness` 拥有「什么叫同一个 commit」是同一类所有权。

**但它必须被承认是一次解释行为**，而不是被伪装成事实转述。

**(c) `latestRun.kind === 'none'` 的边界。**

此时 `runId === undefined`、`failed === false`。一个从「没有任何 run」变成「有一个失败 run」的 repository 会**报**——这是对的。但一个「run 被删除后重新出现」的也会报，**这是一个已知的假阳性**，必须记录而不是掩盖。

---

## 4. 候选 owner

### 4.1 四个候选

| # | 候选 | 结果 |
| --- | --- | --- |
| A | 扩展 `repository-ci-awareness`，让它持有 `previous` | **拒绝** |
| B | 扩展 `repository-ci-relevance`，让它持有 `previous` | **拒绝** |
| C | 新建一个有界插件 `repository-ci-attention` | **可设计，但不授权**（见 §19） |
| D | 扩展 `repository-ci-world` | **拒绝** |

### 4.2 为什么拒绝 A —— 三条独立理由

**(1) 它自己声明了零状态是结构性的。** `current-stage.md:15` 逐字：

> 此前的 `desktop-session-awareness` 比较的是**同一个 facet 的现在与过去**（跨时间，且必须有 baseline 才有话可说）；这一层比较的是**同一次 snapshot 内两个 source 各自报告的 fact**（跨 source），并且**没有任何历史状态**——两次 `current()` 是两个彼此独立的判断。

给它加 `previous` 会让它同时做跨源**和**跨时间两件事。这不是「补上一个缺口」，这是把两个 judgement 塞进一个 owner。

**(2) 它今天有一个 pull 消费者，加 baseline 会复现已实测的缺陷。** `repository-ci-relevance` 的 `requires` 逐字包含 `repositoryCiAwarenessService`（`current-stage.md:39` 第一手确认）。如果 awareness 变成消耗性读取，那么「人类每问一次 relevance」都会推进 attention 的时间线——这正是 `current-stage.md:27` 记录、并由 Desktop Inspection Semantics v1 专门修掉的那个摩擦：

> `desktop-session-awareness.current@1` 是**消耗性读取**，它会推进自己用来比对的 baseline。人工查询因此与 Awareness Loop 的周期在同一字段上交错——loop 的下一次判词覆盖的是更短的窗口。

**修法在桌面侧是引入 `peek@1`（不推进），不是让读的人小心。** 在 CI 侧复现同一个缺陷没有任何理由。

**(3) 任务书冻结的「不要静默改变既有冻结边界」要求这一点被显式说出来。** 结论是：**这个冻结边界不需要重新裁决**。`repository-ci-awareness` 的「无历史状态」是对**它自己那个 judgement** 的陈述（`plugin.ts:45-48` 逐字：「this judgement is put to a single snapshot and needs no history」），它**不**是对整条链的禁止令。因此新建一个有界插件持有自己的 baseline **不构成静默扩边界**——但也**不因此获得授权**（§19）。

### 4.3 为什么拒绝 B

`src/repository-ci-relevance/contracts.ts` 头逐字把「记住上一次答案」写成它**不是**的东西：

> a caller that asks twice gets two independent comparisons of two independent snapshots, **which is the only shape in which "relevance" is a question about now rather than a memory of a previous answer.**

在这上面加 baseline，等于正好推翻这句话。

### 4.4 为什么拒绝 D

`current-stage.md:1444` 逐字冻结 World 的缓存与后台化。World 是 pull-only 的：**没有 `current()` 调用就没有任何观测发生**。给 World 加「变化检测」等于让 World 开始持有时间语义，而 `current-stage.md:1442` 把「判断新旧」明确划给 Awareness。

### 4.5 候选 C 的结构（若有一天解锁）

它必须**同时**是「持有 baseline 的那一个」与「驱动 cadence 的那一个」——这与桌面侧的**两插件**形状不同（那里 `desktop-session-awareness` 持有 baseline、`desktop-session-awareness-loop` 只拥有「什么时候再问一次」，`current-stage.md:719` 逐字：「Loop 自身不持有 baseline……baseline 属于 awareness，它只拥有「什么时候再问一次」这一个问题」）。

**这个形状差异是一个真实的边界决定，不是一个可以顺手选掉的实现细节。** 理由：桌面侧之所以能拆成两个，是因为 awareness 有独立于 loop 的存在理由（`desktop-session-observe` 也在读它）。CI 侧没有第三个读者，拆成两个插件会产生一个「没有非 loop 读者」的 awareness 层——那是一个为对称性而建的层。

**因此这里记录的是一条待裁决项，不是一条结论。**

---

## 5. Judgement composition 合法性

### 5.1 要组成什么

```text
occurrence := relevant(designations, snapshot) ∧ newFailure(previous, snapshot)
```

### 5.2 哪些必须经 public Service 取得

| 输入 | 来源 | 是否合法 |
| --- | --- | --- |
| relevance 判词 | `repository-ci-relevance.current@1` | ✅ public Service |
| CI run 身份 + 结论 | `repository-ci-awareness.current@1` → `assessment.snapshot.githubCi.observation.latestRun` | ✅ public Service |
| designation 集合 | **不需要直接读** —— relevance 已经消费过它 | ✅ 不读 |
| World snapshot | **不需要直接读** —— awareness 已按引用携带 | ✅ 不读 |

**因此 composition 是合法的**：两条边，都是已发布的 public Service，**不穿透任何 provider internals**，**不重新推导** `commitComparison`，**不重新实现** relevance。

这与 `phase-4-explicit-human-reference-review.md:220` 记录的方向一致（未来的层 `requires: [repositoryCiAwarenessService]` **一条边**，读 assessment 里的 `snapshot`，不再 `requires` World）。

### 5.3 一个真实的组成代价：**两次独立 acquisition**

`repository-ci-relevance.current()` **自己会去 acquire 一次**（它的 `requires` 含 `repositoryCiAwarenessService`）。如果 attention 层再调一次 `repositoryCiAwarenessService.current()`，那就是**第二次 acquisition**。

后果不是性能，是**语义**：relevance 判词基于 snapshot₁，run 身份取自 snapshot₂，两者可以不一致——**而 occurrence 的整个意义就是「这个判词和这个失败说的是同一瞬间**」。

`src/desktop-session-observe/plugin.ts` 正是为这个理由拒绝第二次 acquisition 的（该文件 `:8-12`、`:59-61`）。

**三个处置，各有代价：**

| 处置 | 代价 |
| --- | --- |
| (i) 接受两次 acquisition，并且在 occurrence 里同时带上两个时间戳 | occurrence 形状变复杂；「同一个瞬间」变成「两个接近的瞬间」 |
| (ii) 让 attention 层只 `requires` relevance，从它的判词里取 run 身份 | **relevance 判词里今天没有 run 身份**，要扩它的 contract——越过了 §4.3 的拒绝 |
| (iii) 让 attention 层自己算 relevance | **重复实现**，任务书 §6 明确禁止 |

**本轮不选。** 这条被记录为 §17 最小实现切片的前置未决项：**它是第一个必须在实现前裁决的形状问题，而不是实现中顺手定的细节。**

---

## 6. Activation-local continuity

### 6.1 既有先例是完整的、已批准的、有测试的

`src/desktop-session-awareness/plugin.ts:78-87` 逐字：

```ts
// Activation-local by construction: `setup` runs once per activation, so a deactivation and a
// later reactivation get a fresh binding and their first assessment is a baseline again.
let previous: DesktopSessionWorldSnapshot | undefined;

function assess(baseline, current) {
  if (baseline === undefined) return Object.freeze({ kind: 'baseline', current });
  ...
}
```

**这段写法在本文件中恰好出现一次**——它就是这个形状的定义。

### 6.2 baseline reset 是派生性质，不是机制

`current-stage.md:1293` 逐字：

> **baseline 的 reset 是派生性质，不是新增机制**：`previous` 声明在 `setup` 作用域内，于是 World 消失 → `#deactivateTree` → 再激活时 `setup` 重跑 → 第一次 `current()` 自然回到 `baseline`。**本阶段为此没有写一行代码。**

CI 侧可以直接复用这条：`previous` 声明在 `setup` 闭包内，「重启后为空」因此是**结构性质**而不是一条需要记得执行的规则。

### 6.3 一处不可照抄的地方：`current()` / `peek()` 的划分

桌面侧有**两个**契约（`current()` 推进、`peek()` 不推进），是 Desktop Inspection Semantics v1 为修 §4.2(2) 那个摩擦而加的。

CI 侧如果只有**一个**消费者（attention 自己），就**不需要** `peek`。但这也意味着：**任何未来的 pull 读者（例如一个 `hikari attention repository-ci status`）一旦出现，必须立刻面对同一个问题**——它是消耗性读取还是非消耗性读取？

**这一条必须写进 §14 的不可泛化清单**，因为它是桌面上已经付过一次学费的东西。

---

## 7. Restart 语义

### 7.1 任务书的假设与实际的差别

任务书 §17 的假设 5 是：「restart duplicate 可以先不管」是否仍可诚实地称为 "new failure"。

**在 §3.2 的规则下，restart 不会产生 duplicate。** 步 2 让每次激活的第一次观测都回到 baseline，因此：

```text
重启前：CI 已经红着
重启后：第一次观测 → baseline → 不报
```

**因此本设计的 restart 后果不是「重复」，而是「静默」。** 一个持续失败、而人类从未被告知过的 repository，在 Hikari 重启之后**永远不会**产生 occurrence。

**攻击因此部分成功，但方向与假设相反**：不是「是否会重复通知」的诚实性问题，而是「是否会永远不说」的诚实性问题。

### 7.2 因此这个 occurrence 的诚实名字是什么

它**不是**「你的仓库 CI 出现了新的失败」。

它是：**「在你的这一次关注期间，Hikari 观察到这个 repository 的 CI 从『不是失败』变成了『失败』。」**

**两者的差别是真实的**，而且第二句更弱。任何人类可见的措辞都必须建立在这个更弱的 claim 上；把它写成第一句，就是在人类从未被告知第一次失败的情况下，声称一个刚刚发生的新鲜事件。

**这是 §16 与 §19 的共同输入。**

### 7.3 三个被明确拒绝的「解法」

| 解法 | 为什么拒绝 |
| --- | --- |
| 把 baseline 写进 Chronicle，重启后读回 | 让 Chronicle 变成「attention 状态的第二个存放处」；且 Chronicle **没有** update / delete / supersession（`phase-4-explicit-human-reference-review.md:184`），过期 baseline 无法表达 |
| 把 baseline 写进某个 data 目录文件 | 引入本链第一个持久化；`current-stage.md:65` 逐字把「持久化」列为未进入 |
| 让重启后的第一次观测也报 | 那么每一次重启都会报一条已经报过的事；「新」这个词就彻底不成立了 |

---

## 8. 为什么这是 / 不是 Salience

这是本轮最需要诚实的判定，因此拆成两个方向分开做。

### 8.1 判定 1：**transition detection 本身不是 Salience**

**证据一：它在既有链路里有自己的格子，名字叫 Contextualization。**

`current-stage.md:1429` 逐字：

> 其链路为 Contextualization → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act。**P3-04 落实了这条链路的第一个最小 contextualization slice**（相邻两个 World snapshot 的 payload 变化比较）

`changed` / `stable` / `baseline` / `indeterminate` 是**跨时间比较**，落在 Contextualization，**不是** Salience。§3.2 的规则与它**同型**：读一份 activation-local `previous`，比较，输出一个二值+indeterminate 的判词。

**证据二：它不做选择。** `phase-4-p4-03-entry-review.md:163` 的裁定句是「全部是**比较或查找**，**没有一个做选择**」。§3.2 的规则里没有排序、没有候选之间的比较、没有分数、没有优先级、没有「最相关的是哪个」。

**证据三：composition 保持二值。** `phase-4-explicit-human-reference-review.md:164` 逐字：

> **二值判词是集合得以廉价的原因**——若判词是分级（如「最相关的是哪个」），集合就会立刻迫使排序。这条依赖关系必须在后续实现中保持。

`relevant ∧ newFailure` 仍然是二值的，因此**不迫使排序 / 优先级 / scheduler**。

**结论：判词侧可以停在 Contextualization 格，不进入 Salience。这一半是设计得出来的。**

### 8.2 判定 2：**「告诉用户」这一步进入了 Salience 格**

`phase-4-p4-03-entry-review.md:195` 逐字：

> **关键的结构性发现**：链路的三格之间**没有中间格**。所以「在判词层闭合」与「往上走」之间不存在第三个选项——**更低层就是现在这一层**。若 P4-03 要越过今天所在的位置，它必然进入 Salience / Importance Judgement 格；而 `Ignore / Remember / Ask / Notify / Act` 是再上一格，**不被蕴含**。

**主动告诉用户是 Notify。** Notify 在 Salience/Importance 的**上一格**。所以走 Notify **必然穿过** Salience 格。

`current-stage.md:19` / `:43` 逐字冻结：

> Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act **仍然均未进入，且未被预埋**。

`current-stage.md:65` 逐字冻结（本链范围内）：`notification`、`Event`、`后台 relevance 循环` 全部未进入且未被预埋。

`current-stage.md:1433` 逐字：`relevant ≠ should notify`。

### 8.3 一处必须自我检验：这会不会是「偷偷的 Salience」

任务书的冻结原则写着「`relevant ≠ salient`、`changed ≠ important`」。**本设计有没有偷偷把 changed 变成 important？**

逐条检验：

| 检查 | 结论 |
| --- | --- |
| occurrence 里有没有 importance / salience / priority 字段？ | **没有**（§12 逐字给出形状） |
| 有没有在两个失败之间比较哪个更值得说？ | **没有**——所有新失败同等对待 |
| 有没有对「docs workflow 失败」与「test workflow 失败」区别对待？ | **没有** |
| 有没有因为人类「更关注」某个 repo 而提高它的待遇？ | **没有**——relevance 是二值的，集合内不排序 |
| 有没有维护「已经告诉过这个人」的状态？ | **没有**（§3.1 拒绝了候选 C） |
| **那么「只报新的失败」这件事本身算不算一条介入策略？** | **算。** 这就是 §8.2 说的那一格 |

**最后一行是本设计最诚实的一行。** 前面五条成立，说明**判词侧**没有滑进 Salience；但第六条的答案是「算」，说明**「该不该说」这个决定确实已经做了一次** —— 只是它做的是一条**固定的、无参数的、单规则的**策略。

**单规则不等于零判断。** `desktop-session-awareness-loop/plugin.ts:16-18` 逐字记录了同型的推理（关于 `delayMs`）：

> 默认节奏会是该插件决定 Hikari 查看桌面的频率，而那是 mandate 而非实现细节

**「只在新的失败上打扰人」就是一条 mandate。** 因此它必须由人类给出，不能由实现者顺手定下——这正是 §11 要处理的问题。

---

## 9. 当前出站人类通道现实

### 9.1 逐条盘点（第一手）

| # | 出口 | 方向 | 触发者 |
| --- | --- | --- | --- |
| 1 | `hikari observe desktop-session status` | Hikari → 人（stdout） | **人**（命令行） |
| 2 | `hikari focus declare/replace/clear/status` | 人 → Hikari → 人 | **人**（本地端点） |
| 3 | `hikari relevance repository-ci status` | Hikari → 人 | **人**（本地端点） |
| 4 | `hikari ask "…"` | 人 ⇄ Hikari（双向） | **人**（本地端点 → Language） |

**四个出口，零个由 Hikari 发起。**

### 9.2 Language 侧的结构证明

`src/language/plugin.ts` 的 `answer` 只有一条到达路径：

```ts
const endpoint = await listenLanguageEndpoint(
  { handle: (request) => answerer.answer(request.text) },
  path,
);
```

**`answer()` 的调用点在 endpoint 的 `handle` 里。** 没有 timer、没有 Event 订阅、没有第三个调用者。`provides: []`（该文件 `:186-189`）。

**这不是「Language 目前恰好没做主动」，而是「Language 结构上不可能主动」**——它的说话能力只在一个入站请求的处理过程中存在。

### 9.3 唯一「可以被订阅」的链路，以及它的真实状态

`desktop-session-awareness-loop` 是仓库里唯一的 Event producer。它在生产中的订阅者数量，由 `src/cli/resident.ts:175-177` 逐字记录：

> In particular the resident adds no subscriber of its own: `desktop-session-awareness-loop.assessed` has **zero subscribers in production**, and that is a property of the design rather than a gap for this file to fill.

**「是设计的性质，不是这个文件要填的缺口。」**

**因此：仓库今天不存在任何一条路径，能让 Hikari 在没有人提问的时候说出一句话。**

---

## 10. Language activation / Speech Sovereignty 边界

有四条**相互独立**的理由，任何一条单独成立就足以封住这条路。四条都成立。

### 10.1 Presentation 独占最终自然语言表达

`docs/architecture/principles.md:475-495`（§15）逐字给出 `Domain Result → Presentation → RenderedMessage → Transport`，并且 `:495` 逐字：

> 领域模块不应自行绕过 Presentation 直接向用户说话。

**attention 是一个领域模块。** 它不能说话；它至多能把一个 Domain Result 交给 Presentation。**而 Presentation 今天只有被请求时才渲染。**

### 10.2 Speech Sovereignty 是结构不变量

`docs/development/language-tool-use-loop-v1.md:213-220`（§8）逐字列出四条不变量，第四条是：

> **Domain Plugin 不获得 user-facing speaking turn**。

同文件 `:215` 说明这条是**当作结构不变量来验证的**，由自动化测试证明。

**注意这条的措辞**：它不区分「主动说」与「被动说」——它说的是 Domain Plugin **不获得 speaking turn**。今天 Language 之所以合法，是因为说话的是 **Language Plugin 自己**，而 Domain 的判词只是被它转述的材料。

### 10.3 Language 结构上无法被激活

§9.2 已证：`answer()` 只能在一个入站请求的 `handle` 里被调用。

### 10.4 没有任何东西能触发它

Language `provides: []`。**一个不提供 Service、不订阅 Event 的插件，在 Runtime 里没有任何可被唤醒的入口。**

### 10.5 因此缺的不是「一个通道」，而是「一次裁决」

要让「Hikari 主动说话」成立，必须有人回答：

```text
· 谁有权发起一次 speaking turn？
· 它在什么 authority 下发起？
· 它受什么抑制规则约束（不能每 30 秒说一次）？
· 它走 Presentation 的哪条路径？
· 它说出来的东西，与「人问、Hikari 答」在 provenance 上如何区分？
```

**这是一组新的 communication plane 的问题。** 按 `CLAUDE.md` §六的工作强度分级，出现「新 communication plane」即**升级为 C 级架构级工作**，必须先做 Hikari Architecture / Boundary Review。

**本轮任务书写的是「只设计」。因此本轮不能替它做这个裁决。**

---

## 11. Mandate / authority

### 11.1 人类确实给了一条 mandate

任务书本身给出了产品意图。这与先例一致：`current-stage.md:51` 逐字记录了「产品 mandate 使 runtime human declaration 成为真实需求」被接受为真实需求的先例。

**因此「有没有 mandate」这一项的答案是：有，但见下。**

### 11.2 这条 mandate **今天无法从产品里表达出来**

这是本节的核心发现。

`current-stage.md:47` 逐字冻结了 `declare` 的语义：

> 它是 **Hikari 第一次拥有一处人类主动写入的入口**：`declare` / `replace` / `clear` / `status` 四个词经由本地端点，把一个 designation 集合写在 Plugin 自己的闭包里。**这是 ingress，不是 Judgement**——它记录人说了什么，**不解释**这句话意味着什么，**不**判断任何 repository 是否相关，**不**产生 importance / salience，**不**触发 Remember / Ask / Notify / Act。

**「不触发 Remember / Ask / Notify / Act」是逐字冻结的。**

因此今天一个人类能做的最接近的动作是：

```text
hikari focus declare t1mb2rg/hikari-new
```

而这句话在系统里的全部含义是「把 `t1mb2rg/hikari-new` 放进一个集合」。**它不是**「CI 红了告诉我」。

`phase-4-explicit-human-reference-review.md:159` 里确实出现过「CI 红了告诉我」这个短语，但那是一句**论证多 designation 合法性的举例**，同文件 `:157` 逐字写着该结构「不包含：timestamp、`statedAt`、authority、priority、confidence、source 字符串」，`:305` 明确「未引入 salience / importance / notify / interruptibility / action」。

**结论：把「用户声明了焦点」读成「用户要求被通知」，是对一条已冻结语义的静默改写。**

### 11.3 那个「真实的 callable need」到了吗

本仓库对 Contract Gate 的既有裁定是：**真实 callable need 到达时可以重新裁决**，而不是豁免。`current-stage.md:57` 逐字记录了 `work-focus.current@1` 的那次重新裁决：

> **一处 Contract Gate 的重新裁决，而不是豁免** …… **真实的 callable need 已经到达**——`repository-ci-relevance` 就是那个 consumer——因此该测试被**反转**（钉住「它确实被登记、且依赖它的插件 `active`」）而**不是被删除**。

本轮的情形**不同**：

| | `work-focus.current@1` 那次 | 本轮 |
| --- | --- | --- |
| need 来自 | 组合内一个**已存在**的插件要读它 | 一个**尚不存在**的通道 |
| 判据 | 「有没有 callable 在调」 | 「人类想不想要」 |
| 可验证性 | 可（源码里有 `requires`） | 不可（没有任何产品动作能表达它） |

**因此本轮不能引用那次先例。**

### 11.4 一处必须说清的愿景张力

`docs/vision/hikari-soul.md:159-189`（§5 Proactivity）逐字：

> 主动性并不意味着随意行动。
>
> 真正成熟的主动性应该同时具备：
> - 能发现机会与问题；
> - **能判断是否值得介入**；
> - 能理解当前权限边界；
> - 能在需要时请求确认；
> - 能在不该行动时克制。

**注意第二项。** 愿景定义的主动性**本身就包含**「判断是否值得介入」——那正是 Salience / Importance 格。

**因此愿景与架构在这件事上并不冲突**：愿景要求的主动性**不是**一条机械通道，而是一次判断。任务书里那个「只判断变化、不判断重要」的机械化版本，**既不满足愿景对主动性的定义，也不满足架构对它的授权**。

**两者缺的是同一个东西**：`current-stage.md:19` 逐字说的「Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act 仍然均未进入，且未被预埋」。

---

## 12. 候选 occurrence 形态

### 12.1 若解锁，形状上可能包含什么

| 字段 | 为什么它可能是必要的 |
| --- | --- |
| `repository: string` | occurrence 必须能被人指向一个具体对象；取自 observation（GitHub 自己的拼法） |
| `runId: number` | 这是**去重身份本身**（§13） |
| `headSha: string` | 失败发生在哪个 commit 上——不写它，人无法行动 |
| `workflow: string` | `types.ts` 的注释指出，多 workflow 仓库里这是「CI failed」与「the docs job ran last」的全部差别 |
| `conclusion: string` | 上游给的是不封闭的字符串；本层不翻译它 |
| `observedAt: string` | 这次观测的时刻 |
| relevance basis | 命中的那个 designation（`RepositoryCiRelevanceJudgement.relevant` 已携带） |
| transition basis | `previous.runId` 与 `previous.failed` |

### 12.2 明确**不**包含什么

```text
importance / salience / priority / score / confidence
severity / category / 失败分类
「是否已被告知」/ deliveredAt / acknowledgedAt
任何 rendered prose / 任何人类可读句子
任何 recommendation / next action
任何跨 repository 的排序依据
```

**前两行是 §8 的冻结原则；第三行是 §3.1 拒绝的候选 C；第四行是 Speech Sovereignty（§10）；第五行是 Action 边界。**

### 12.3 一处必须写明的不确定性

**这个形状不应该在本轮被冻结。** 按 `phase-4-p4-03-entry-review.md:191`：

> 判词留在自治插件内、**不为没有 reader 的判词发布 contract**、不把判词层说成 Awareness 层、将来若做副作用必须走 Action 边界。

**今天没有 reader。因此今天冻结 schema 正是这句话禁止的形状**——它会把一个没人读的形状固定下来，而真正的消费者（那条尚未存在的通道）会拥有更好的信息来决定要什么字段。

---

## 13. 重复抑制语义

### 13.1 去重身份是什么

**`runId` + 一个布尔（上一次是否已知为失败）。** 不是字符串拼接，不是 `headSha`，不是时间窗。

**为什么不导出第二份「已发送集合」**：那会让本层维护「我告诉过谁」的模型，即 §3.1 的候选 C，即 Salience/Notification 地界。**去重状态就是比较状态本身**，不是额外的一本账。

### 13.2 逐条覆盖任务书列出的五种情形

| # | 情形 | 结果 | 由哪一步保证 |
| --- | --- | --- | --- |
| 1 | 同一个 failed run，重复轮询 | **不报** | 步 3 的 `previous.runId === runId && previous.failed` |
| 2 | 结论相同但 run 变了 | **报** | runId 不同 |
| 3 | run id 相同但结论变了 | **报** | `previous.failed === false` |
| 4 | Work Focus 变化后，同一个 failed run | **不报** | baseline 与 relevance 无关（§3.4(a)）——它本来就没被报过 |
| 5 | `relevant → unknown` / `unknown → relevant` | **不报** | **发生在这个判断之外**；变化的是第 (3) 条件，不是第 (4) 条件 |
| 6 | 重启 | **不报** | 步 2（§7） |

**第 5 条需要单独强调**：relevance 的翻转**不产生 occurrence**。occurrence 的题目是「出现了新的失败」，不是「焦点变了」。把 relevance 变化也接进来，会让这层开始回答一个它没有被授权回答的问题。

### 13.3 必须同时写下的两个残留

**(a) 步骤 1 的「不动 previous」是抑制语义的一部分。** 如果 source 够不着时把 `previous` 推成 `{undefined, false}`，那么 source 恢复后的第一个失败观测会**因为 runId 不同而误报**……不，实际上它会报，但那条报告是**对的**。真正的问题在相反方向：如果 source 够不着时把 `previous` **清空**，那么 source 恢复后第一次观测会回到 baseline，于是**真实的失败迁移被吃掉**。因此规则是「不动」：一次没做成的比较不是一次观测。

**(b) 「同一 run 的多次重跑」是一个已知的边界。** GitHub 对 re-run 是否复用 run id 不由本层决定；`types.ts:27-30` 已明确拒绝把它封闭成词表。**本层因此对「重跑产生的新失败」的行为依赖于上游事实，而不是本层的语义**——这一点必须记录为依赖，而不是被说成已解决。

---

## 14. Chronicle / Memory 影响

### 14.1 结论：**零影响，且必须是零影响**

| 问题 | 答案 |
| --- | --- |
| occurrence 要写 Chronicle 吗？ | **不** |
| baseline 要写 Chronicle 吗？ | **不** |
| 要读 Chronicle 吗？ | **不** |
| 要创建 Memory 吗？ | **不** |
| 要创建 Salience 吗？ | **不** |
| 要创建 generic Notification Service 吗？ | **不** |

### 14.2 三条独立理由

**(1) baseline 是本 activation 的事实，不是发生过的事实。** `current-stage.md:1293` 逐字把 baseline reset 定为「派生性质，不是新增机制」。把它持久化会把这个性质抹掉。

**(2) Chronicle 无法表达 baseline 的生命周期。** Chronicle **没有** update / delete / supersession（`phase-4-explicit-human-reference-review.md:184`）。一条「上次见到 run 12345」的记录一旦写入就永久为真，而它**很快就不是真的了**。

**(3) occurrence 一旦写 Chronicle，就会立刻复现 Memory 的 BLOCKED。** `chronicleService.read()` 至今**生产代码零调用者**（前一轮第一手确认），这正是 MEMORY REACTIVATION v0 判 BLOCKED 的第一条 blocker。**给 attention 写一条无人读的 durable fact，等于为了给 Chronicle 找 reader 而制造需求**——这是用户在前一轮裁决里明确冻结的。

### 14.3 与前一轮冻结的关系

用户的正式裁决逐字包含：「**不要为了给 Chronicle 找 reader 而创造需求。**」

**本设计不写 Chronicle，因此不触碰这条。** 这是刻意的，也必须被记为本设计的一个**优点而非遗漏**。

---

## 15. Adversarial findings

按任务书 §17，逐条攻击五个假设。**每一条都给出「攻击是否成功」，成功的必须收紧设计。**

### 攻击 1：「CI failure 天然值得提醒」是否偷偷等价于 Salience

**攻击**：本设计声称不判断重要性，只判断变化。但「只把新的失败告诉人」这件事**本身就是一次介入决策**。

**结果：部分成功。设计被收紧，但未致命。**

- **判词侧攻击失败**：transition detection 与 `desktop-session-awareness` 的 `changed` 同型，落在 **Contextualization** 格（`current-stage.md:1429` 逐字），不做选择（`phase-4-p4-03-entry-review.md:163` 逐字），保持二值（`phase-4-explicit-human-reference-review.md:164` 逐字）。
- **「说」这一侧攻击成功**：`phase-4-p4-03-entry-review.md:195` 逐字确立「没有中间格」，走 Notify 必然穿过 Salience 格。**这正是 §19 的阻塞点。**

**收紧**：设计被明确切分为「判词侧（可设计）」与「通知侧（越界）」两半，不再混为一谈。

### 攻击 2：「relevance + failed 就足够」是否会重复通知

**攻击**：朴素规则 `relevant ∧ failed → 报` 会在每次轮询重复。

**结果：攻击成功，且暴露出一个比重复更严重的问题。**

- 重复本身被 §3.2 的 baseline 修掉。
- **但修复引入了一个必须同时裁决的语义问题**：baseline 是否随 relevance 推进？

**收紧**：确立 §3.4(a)「relevance 不得参与 baseline 推进」，并同时写下代价——**刚 declare 焦点就发现 CI 已经红着的人，永远收不到这条 occurrence**。这是「new failure」与「currently failing」不可兼得的必然结果，必须由人类在解锁时选择，不能由实现者顺手定。

### 攻击 3：「repository-ci-awareness 可以直接扩展」违反其冻结管辖

**攻击**：给它加 `previous` 是最省事的做法。

**结果：攻击成功，候选 A 被拒绝。**

三条独立理由（§4.2）：(1) 它自己声明零状态是结构性的；(2) 它今天有一个 pull 消费者，加 baseline 会**精确复现** `current-stage.md:27` 记录、Desktop Inspection Semantics v1 专门修掉的那个实测缺陷；(3) 其 `plugin.ts:45-48` 的「needs no history」是对**它自己那个 judgement** 的陈述，不是对整条链的禁止令。

**收紧**：任何 attention baseline 必须住在一个**新的** owner 里，且**不得被任何 pull 路径读取**（否则同一个缺陷重来）。

### 攻击 4：「Language 已经能主动说话」

**攻击**：既有的 Language Plugin 或许已经具备主动出口。

**结果：攻击失败——该假设被证伪，且是结构性地被证伪。**

四条独立理由（§10）：`principles.md:495` 禁止领域模块直接说话；`language-tool-use-loop-v1.md:220` 把「Domain Plugin 不获得 user-facing speaking turn」列为**结构不变量**；`answer()` 的调用点只在 endpoint 的 `handle` 里；Language `provides: []`。

**但这条攻击反过来产生了本轮最危险的诱饵**：`desktop-session-awareness-loop` 的「**0 subscriber 是合法状态**」（`:91`）似乎提供了「先建链路、后补消费者」的许可。

**对诱饵的单独检验**——**它不适用于本设计**，理由有三：

1. 那条链路发布的是**已经被消费的 awareness** 的一个新出口（`desktop-session-observe` 已在读同一份 assessment）；本设计要建的是一个**连判词都还不存在**的层。
2. 那条链路的文档**自己**写了上限声明（`:475`）：「在真实订阅方出现之前，这条链路的端到端价值**尚未被证明**」——**它未被证明，不是被证明没问题。**
3. 本设计的 mandate **明确要求端到端**（「通过 Hikari 的人类出口主动告诉用户」）。用一条**自认端到端未证明**的先例去满足一条**要求端到端**的 mandate，是偷换。

**收紧**：不得引用「0 subscriber 合法」来为「先建后补」辩护。

### 攻击 5：「restart duplicate 可以先不管」是否仍可诚实地称为 "new failure"

**攻击**：activation-local 的 baseline 会在重启后重复通知。

**结果：攻击成功，但方向与假设相反。**

§7 已证：在 §3.2 的规则下 restart **不产生 duplicate**，**产生 silence**。

**收紧**：occurrence 的诚实措辞被下调为**「在你的这一次关注期间，Hikari 观察到它从『不是失败』变成了『失败』」**，而不是「你的仓库出现了新的失败」。§7.3 逐条记录了三个被拒绝的「解法」（写 Chronicle / 写文件 / 重启后也报）。

---

## 16. 最小 proving ground

### 16.1 本轮的核心困难：**没有 proving ground**

一个 proving ground 的成立条件是「有东西能观察到它」。本设计要证明的那句话是：

```text
「Hikari 主动告诉了一个人一件事。」
```

**这句话的证明需要「一个人被告诉」这个事件。而今天没有任何机制能产生这个事件**，§9 已逐条证明。

### 16.2 因此可以证明的最多是什么

如果只做判词侧，能证明的是：

```text
· 六种情形（§3.3）各自产出正确的二值结果；
· restart 回到 baseline；
· source 够不着时 previous 不动；
· relevance 翻转不产生 occurrence。
```

**这些都是真的、可测的、有价值的。** 但它们证明的是**一个比较函数**，不是**一个主动闭环**。

**把「比较函数被正确测试」说成「主动介入闭环成立」，是本轮最大的诚实风险。**

### 16.3 一处必须同写的证据等级上限

即使判词侧全部实现并通过测试，本仓库今天**不存在**任何一条自动化路径能证明「人被告知了」。既有的最长自动化链路止于「生产 Plugin + 生产端点 + 生产客户端 + 注入的 provider」（`current-stage.md:1930`），**它证明的是请求-应答，不是通知**。

`current-stage.md:1930` 同时逐字警告：

> **不得**把它转述为「已端到端自动化验证」。

---

## 17. 最小实现切片

### 17.1 本轮的最小实现切片是：**无**

不是「很小的一片」，是**零片**。理由不是判词侧做不了，而是**the mandate 的交付物在没有通道的情况下无法被交付**，而通道是一个独立的 C 级裁决（§10.5、§11、§19）。

**如果强行切一片，那就是「为了避免 BLOCKED 发明基础设施」**——正是任务书禁止的事。

### 17.2 如果在未来解锁，最小的那一片会是什么形状

记录在这里，是为了让解锁时**不必重新设计**，不是为了让今天多切一片。

```text
新插件（名字待定，形态参考 desktop-session-awareness，但持有 baseline）
  requires:
    repository-ci-relevance.current@1      ← relevance 判词（不重算）
    repository-ci-awareness.current@1      ← run 身份 + 结论
  provides:
    待裁决 —— 见下
  内部:
    activation-local previous（setup 闭包，零持久化）
  行为:
    每次调用做一次 §3.2 的四步
```

**四个必须在实现前裁决的未决项**（本轮**不**裁决）：

1. **§5.3 的两次 acquisition。** 必须选 (i)/(ii)/(iii) 之一；本轮记录为未决，因为它是一个形状问题。
2. **输出形态。** 不提供 Service（无 reader → `:191` 禁止）；那它怎么被看到？——这一问直接落回通道问题。
3. **driver 归属。** 持有 baseline 与驱动 cadence 是同一个插件还是两个（§4.5）。
4. **baseline 与 relevance 的关系。** §3.4(a) 给出语义上一致的选择，但它是一条 mandate，需要人类确认。

### 17.3 一处明确不做的事

**不做一个 pull 版本（例如 `hikari attention repository-ci status`）来「先有个 reader」。** 三条理由：

- 它**不是** mandate 要的东西（mandate 要主动，它给被动），属于交付物替换；
- 它会让 attention 的 baseline 变成**消耗性读取**，精确复现 §4.2(2) 那个已被修过一次的缺陷；
- 「先给判词找个 reader」正是用户前一轮冻结的「不要为了给 X 找 reader 而创造需求」的同型动作。

---

## 18. 不得泛化的内容

以下每一项在**没有新的、真实的、无法用现有模型表达的**实现问题出现之前，**不得**建立。

```text
Central Salience                    Importance Service
Attention Registry                  Attention<T>
Global Proactivity                  Global Notification Brain
Central Judgement                   Notification<T>
GlobalWorldState                    通用 Event envelope
Generic Notification Service        通用 Attention / Notice 抽象
通知账本 / deliveredAt / ack 状态    跨 repository 的排序或优先级
failure 分类 / severity 分级         通用 CI 状态机
后台 attention scheduler / 通用轮询框架
把 attention occurrence 写 Chronicle
把 baseline 持久化到任何地方
给 repository-ci-awareness 加 baseline
给 repository-ci-relevance 加 baseline
给 repository-ci-world 加变化检测
```

### 18.1 三处最容易被顺手泛化的地方，单独点名

**(1) 不要抽象出「第二个变化检测器」。** `current-stage.md:1441` 对感知层有过同型裁定：两个实例不足以判定共享边界，且错误的抽象比重复更难撤销。CI 侧今天只有**一个**候选变化检测，**连两个都不到**。

**(2) 不要引入 `Attention<T>` 这类泛型信封。** occurrence 的字段（§12）是**这个**判断的字段；泛型化会把「还没有第二个消费者」伪装成「已经有两个消费者」。

**(3) 不要把 `FAILURE_WORDS` 提升成公共词表服务。** 它属于**这一层**对上游不封闭字段的解释（§3.4(b)）；把它做成 Service 就是把一次局部解释变成全局语义。

---

## 19. Verdict

# `BLOCKED`

### 19.1 阻塞点（一个，不是三个）

**主动出站人类通道不存在，且它的建立是一个 C 级架构裁决，不是本 capability 可以实现的一部分。**

逐条证据：

| # | 事实 | 出处（第一手） |
| --- | --- | --- |
| 1 | 四个出口，零个由 Hikari 发起 | §9.1 |
| 2 | `answer()` 只能在一个入站请求的 `handle` 里被调用 | `src/language/plugin.ts:239-245` |
| 3 | Language `provides: []`，无可唤醒入口 | `src/language/plugin.ts:186-189` |
| 4 | 「Domain Plugin 不获得 user-facing speaking turn」是**结构不变量** | `language-tool-use-loop-v1.md:220` |
| 5 | 「领域模块不应自行绕过 Presentation 直接向用户说话」 | `principles.md:495` |
| 6 | 整个 `src/` 只有 1 个 Event contract、1 个自驱动循环，且生产订阅者为 0 | §1.5、§9.3 |
| 7 | `notification` / `Event` / `后台 relevance 循环` 对本链**未进入且未被预埋** | `current-stage.md:65` |
| 8 | `Salience / Importance Judgement` 与 `Notify` **仍然均未进入，且未被预埋** | `current-stage.md:19`、`:43` |
| 9 | `relevant ≠ should notify` | `current-stage.md:1433` |
| 10 | 走 Notify 必然穿过 Salience 格（**没有中间格**） | `phase-4-p4-03-entry-review.md:195` |
| 11 | `declare` 逐字**不触发** Notify —— mandate 无法从产品里表达 | `current-stage.md:47` |
| 12 | **不为没有 reader 的判词发布 contract** | `phase-4-p4-03-entry-review.md:191` |

**第 12 条单独构成一道硬闸**：它禁止「先把判词建好、以后再补消费者」。而第 11 条禁止「先借用 `declare` 的语义当作已经获得了通知授权」。

### 19.2 不是阻塞点的部分（必须与裁定同时读）

**判词侧是可设计的，且不越过任何冻结边界。**

- 「新的 CI failure」有一份完整的机械定义（§3.2）与六种情形的逐条覆盖（§3.3）。
- owner 可以是一个新的有界插件，**不需要**改动任何既有模块（§4）。
- composition 合法：两条边，都是 public Service，不穿透 internals（§5）。
- activation-local continuity 有已批准的先例可以逐字复用（§6）。
- 去重语义完整，五种情形全部覆盖（§13）。
- **Chronicle / Memory 零影响**（§14）。

**因此本轮判 BLOCKED，判的**不是**「这件事做不了」，而是**「它的交付物在今天无法被交付」**。

### 19.3 五种攻击的结果汇总

| # | 假设 | 结果 | 后果 |
| --- | --- | --- | --- |
| 1 | CI failure 天然值得提醒 = Salience？ | **部分成功** | 设计被切为判词侧（合法）/ 通知侧（越界） |
| 2 | relevance + failed 就足够？ | **成功** | baseline 与 relevance 的关系成为一条必须由人类给的 mandate |
| 3 | repository-ci-awareness 可直接扩展？ | **成功** | 候选 A/B/D 全部拒绝；任何 pull 读取会复现已修缺陷 |
| 4 | Language 已能主动说话？ | **证伪**（假设为假） | 但暴露了「0 subscriber 合法」这个诱饵，已在 §15 攻击 4 单独拆掉 |
| 5 | restart duplicate 可先不管？ | **成功，方向相反** | 真实后果是 **silence 而非 duplicate**；occurrence 的措辞必须下调 |

**五条里没有一条是「没问题」。** 这本身就是 BLOCKED 的旁证。

### 19.4 解锁条件

**必须是一条 Hikari Architecture / Boundary Review 级别的裁决**，至少回答 §10.5 的五个问题：

```text
· 谁有权发起一次 speaking turn？
· 它在什么 authority 下发起？
· 它受什么抑制规则约束？
· 它走 Presentation 的哪条路径？
· 它说出来的东西，与「人问、Hikari 答」在 provenance 上如何区分？
```

**并且必须同时裁决 §17.2 的四个未决项**（两次 acquisition / 输出形态 / driver 归属 / baseline 与 relevance 的关系）。

**在这些裁决出现之前，本设计不得进入实现。**

### 19.5 本轮交付边界（自检）

| 任务书要求 | 状态 |
| --- | --- |
| 只设计 | ✅ 零代码改动 |
| 不实现 | ✅ |
| 不修改 Runtime | ✅ |
| 不创建 Memory | ✅ |
| 不创建 Salience | ✅ |
| 不创建 generic Notification Service | ✅ |
| 不 commit production code | ✅ 本轮**未 commit 任何东西** |
| 全程中文 | ✅（协议标记 `BLOCKED` 保留英文） |
| 输出 19 节 | ✅ §1–§19 |

**一处诚实的自我限制**：本文件的判词侧设计（§3、§5、§6、§13）**未经任何可执行验证**——本轮是纯设计，没有写测试、没有跑代码。它们在解锁后实现时必须被实际验证，**不得**因为本文件的表述完整而被当作已验证结论。
