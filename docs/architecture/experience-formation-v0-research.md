# EXPERIENCE FORMATION v0 — RESEARCH

状态：**只研究**。无实现、无新 Service、无新 Plugin、无 schema、无持久化实现、
无模型端点、无 Fast Cognition 实现、无 Memory 实现、无 TUI 改动。
基线：`main` @ `90b561c`（本文开始时 `git status --short` 为空）
日期：2026-10-08

上级文档：`docs/architecture/hikari-nervous-system-stage-v0.md`（N0）。
本文回答 N0 §4「完成的含义」能不能被切出第一刀，以及切在哪里。

---

## 1. 当前仓库证据

以下全部来自基线 `90b561c` 的源码与文档，逐条给锚点。

### 1.1 规模

| 项 | 数量 |
| --- | --- |
| Plugin 目录 | 21 |
| Service contract | 16 |
| Event contract | **1**（`desktop-session-awareness-loop.assessed@1`） |
| 生产 Event 订阅者 | **0** |
| 持久化落点 | **3** |
| 主动投递点 | **2** |
| Duplication Chronicle 的生产写入者 | **1**（`work-focus`） |
| ~~`chronicleService.read()`~~ / `get()` 的生产调用者 | ~~**0**~~ → `read()` **1**，`get()` 仍 **0** |

> **注（2026-10-08）：本行的 `read()` 计数已变，原值 0 不再成立，其余各行未变动。**
> 新增的唯一生产调用者是 `repository-ci-attention`（`src/repository-ci-attention/plugin.ts` 的
> history restore），它读回的是**它自己的私有 fact 家族**，不是通用历史查询。
> 见 `docs/architecture/repository-ci-attention-delivery-history-v0-boundary-freeze.md`；
> §1.4「读侧为零」同条另有指针。

三个持久化落点：`<dataDir>/continuity/origin.json`、`<dataDir>/chronicle/chronicle.jsonl`、
`<dataDir>/launch.json`。

### 1.2 唯一一条被写进 Chronicle 的东西

`src/work-focus/session.ts:81` 在 designation 集合**真的移动时**调 `chronicle.append(draft)`；
`src/work-focus/plugin.ts:55` 是它 `requires` Chronicle 的唯一理由。

事实族只有三条（`src/work-focus/facts.ts`）：

```text
work-focus.declared@1 / work-focus.replaced@1 / work-focus.cleared@1
```

`status` 是语义 no-op，产生零事实。

### 1.3 承载这一切的 doctrine

`src/work-focus/facts.ts:8` 与 `:14`：

```text
Only the semantic owner of a concern admits a fact about it, and only the proposition
that owner is entitled to assert.

What is deliberately absent is anything a fact might be *judged* by — no importance,
no salience, no confidence, no relation to another fact, no reading of what a designation
means. Chronicle stores what happened. It does not explain what it means.
```

值得注意：这段英文里 **`experience` 不出现**。整个 `src/` 里 `experience` 作为概念名词
的符号命中为 **0**。

### 1.4 读侧为零

`src/chronicle/contracts.ts` 提供 `append` / `get` / `read`，三者都在。
全仓 `grep '\.read()' src` **零命中**；Chronicle 的唯一生产消费者只调 `append`。

因此今天的准确描述是：

> **Chronicle 是一条只写不读的追加日志。写入侧的 doctrine 已经建立并有测试看守；
> 读侧从未被使用过。**

> **注（2026-10-08）：本节（§1.4「读侧为零」）的结论已在后续 slice 中失效，正文不改写。**
> 上面两处「零命中 / 从未被使用过」是本次研究当时的实测事实，现在**不再成立**：
> `src/repository-ci-attention/plugin.ts` 每个 activation 会 `read()` 一次，读回它自己的历史。
> 取代者：`docs/architecture/repository-ci-attention-delivery-history-v0-boundary-freeze.md`。
> **未变的是本节的用途**——它记录的「写入侧有 doctrine、读侧没有」这一**不对称**在当时成立；
> 今天的读侧使用是 owner-local 的（一个 owner 读自己的 fact 家族），而不是 §1.4 意义上的
> 通用读侧能力：仍然没有 query / 索引 / 跨 owner 的历史查询，`memory-reactivation` 的
> BLOCKED 结论不受影响。

### 1.5 唯一的「把过去放进当前 prompt」

`src/language/dialogue.ts:90-91` 的 `DIALOGUE_CONTEXT_TTL_MS` 是全仓**唯一**的 TTL。
它挂在「人类提问」的请求路径上，保留**上一轮**的 referent，内容是**能力名清单**，
不是历史材料。它不跨越进程。

除此之外，没有任何机制把过去送回当前 cognition。

### 1.6 TUI transcript

`src/cli/tui.ts` 的 transcript 是**内存态**（200 条上限），并有面向人类的显式标记：
Hikari 不记得这段对话。这是正确的诚实，同时也是 §2B 的直接证据。

---

## 2. 定义与区分

这一节是本文的地基。**如果区分守不住，后面每一条建议都会退回成「加一层抽象」。**

### 2.1 八个概念

| # | 概念 | 定义 | 判据：它是不是 Experience？ |
| --- | --- | --- | --- |
| 1 | **Raw Observation** | 一个 source 报告它看到了什么 | **否。** 没有 owner 承认，没有归属 |
| 2 | **Meaningful Change** | 某个 owner 所辖之物发生了一次转变 | **否。** 一次比较的结论，不是一段经历 |
| 3 | **Experience** | owner 承认「这是发生在我身上的事」，可归属、可命名、跨 activation 存续 | — |
| 4 | **Durable Fact** | 已承认并写入 Chronicle 的一条命题 | **是 Experience 的载体，不是同义词** |
| 5 | **Chronicle** | 添加式基底 | **否。** 它是存放处 |
| 6 | **Memory** | 可修订的解释 | **否。** 且需要 Chronicle 之外的基底 |
| 7 | **Concern** | owner 持续持有、有生命周期的关注对象 | **否。** 它是经历的对象，不是经历 |
| 8 | **Judgement** | 比较 / 查找 / 选择 | **否** |
| 9 | **Action Result** | 改变现实的操作的 outcome + receipt | **可以是**（目标 F） |

### 2.2 四条必须守住的区分

```text
Observation  ≠ Experience    source 报告了什么，不等于 Hikari 承认自己经历了什么
Experience   ≠ Chronicle     经历是内容，Chronicle 是基底；换基底不改变经历的含义
Durable Fact ≠ Memory        不可修订的命题 ≠ 可修订的解释
Query        ≠ Reactivation  查历史 ≠ 过去的材料重新进入当前 cognition
```

第二条最容易被违反：把「Experience」实现成一个新的 store，等于承认
「Chronicle 存不下经历」——而实际上 Chronicle 能存下任何形状的 `payload`，
真正的缺口**不在存放处**。

### 2.3 「模型输出」能不能直接成为 Experience

**默认 NO。** 依据两条已经在仓库成立的规则：

- doctrine（§1.3）：只有语义 owner 可以承认关于它自己的事。模型不是任何东西的 owner。
- `language` 的既有行为：当 owner 已经给出措辞时，**模型的行文被丢弃**
  （`src/language/express.ts` 的 grounded block 路径），即模型输出今天已经不被当作事实源。

例外只有一种形态：**模型输出先经过 owner 的语义接纳，再成为该 owner 的命题。**
这时成为 Experience 的是 owner 的接纳结果，不是模型输出本身。

### 2.4 「人类说的话」能不能直接成为 Experience

**今天不能。** 这不是本文的推论，是仓库已经裁定过的：

`docs/development/durable-fact-admission-v0.md:120-121` 逐字：

> `source` **只声称可证明的部分**：`{ kind: 'work-focus.endpoint' }`。`{ kind: 'human' }` **被禁止**
> ——入口没有任何身份认证，这条管道上任何本机进程都能声明一个工作焦点，写成 `human` 是在断言一个
> 无法证明的事实。

这条直接卡住 Human correction（见 §4 案例 D），且**不能靠 Experience Formation 绕开**。

---

## 3. 已经接近但不够的机制

按「离 Experience 多近」排序。**每一个都被认真考虑过，每一个都有具体的不足。**

### 3.1 `durable-fact-admission-v0` —— 最近的一个，但只是写侧的一半

它是全仓唯一一条已经落地的「owner 承认自己的事」的规则，事实族的建立、
payload 从转变而非从 `current()` 派生、append 失败不回滚不重试不抛错、
`source` 只声称可证明的部分——这些**正是 Experience Formation 需要的地基**。

**不够的地方**：它只批准了 `work-focus` **一个** owner，只批准了**一条**事实族，
而且它处理的是**写入**。它从未处理「这个 owner 后来读了它自己写的东西，并因此不同」。

### 3.2 `work-focus` —— 最接近 Ongoing Concern，但没有生命周期

它是一个**被持有的集合**（`WorkFocusState { designations }`，`src/work-focus/state.ts:16-25`），
不是一次性判断——这一点与「持续关注」同形。

**不够的地方**（逐条有锚点）：
- 没有领域生命周期：没有 `enteredAt` / `updatedAt` / `expiry` / `revision`，
  且其中多项被 review 明列禁止（`docs/architecture/phase-4-explicit-work-focus-review.md:233`）。
- **没有定时器。** 全 `src/work-focus/*` 零 `setTimeout` / `setInterval`。它是纯被动的：
  只在被问时读。
- 状态是内存态，重启后从 `emptyWorkFocus()` 开始（`session.ts:17-19` 注释逐字承认）。
- 写出去的事实**没有读者**（`src/work-focus/index.ts:19-21`：`Nothing reads them back`）。

### 3.3 `repository-ci-attention` 的 `handledFailures` —— 最接近「我记得我做过什么」

`src/repository-ci-attention/plugin.ts:98` 是 `const handledFailures = new Set<number>()`，
`judgement.ts:79` 用它做去重：`if (handledFailures.has(run.id)) return undefined;`

注意它的形状：这是一个**关于自己过去行为的记录**——「这个 run id 本激活期已经处理过」。
这正是目标 F 想要的东西的原型。

**不够的地方**：它活在 `setup` 闭包里，activation 结束即消失。
`judgement.ts:36` 的自述逐字承认：`this activation's own record`。

### 3.4 `desktop-session-awareness` 的 baseline —— 唯一「被维持」的状态

`plugin.ts:78` 的 `let previous` 是唯一跨 Plugin 被共享的状态变量，
`current()` 推进它，`peek()` 不推进它（`desktop-session-observe` 用后者，
理由是「人正在看的时候不能让时间线移动」）。

**不够的地方**：按构造它只能描述「上一次看是什么样」。它不携带任何跨 activation 的东西，
且 awareness 的 Event 在**生产环境零订阅者**（`src/cli/resident.ts:196-197` 逐字承认），
所以事件平面实际上是空转的。

### 3.5 `language` 的一轮指代 —— 唯一的「过去进入当前」

见 §1.5。**不够的地方**：只有一轮、只有 5 分钟、只有能力名、不跨进程。

### 3.6 TUI transcript —— 唯一的「连续对话」，且明确声明自己不是记忆

见 §1.6。

### 3.7 小结

把它们排在一起看，会看到一个清晰的形状：

> **仓库里已经有四处在做「记得点什么」这件事**（work-focus 的集合、attention 的 run id 集、
> awareness 的 baseline、language 的一轮指代），
> **但没有一处跨 activation，也没有一处被自己读回。**

---

## 4. 四个真实案例

### 案例 A — Repository CI

**链路事实（必须先说清楚）**：这条链在 `github-ci` 处**一分为二，不是一条直线**。

- 主动支：`repository-ci-attention` 的 `requires` 是
  `[gitHubCiService, languageSpeakingService, humanDeliveryService]`（`plugin.ts:76`）——
  **不含** `repositoryCiWorldService` / `repositoryCiAwarenessService` / `repositoryCiRelevanceService`。
  即 **relevance 判词不参与主动投递**。
- pull 支：relevance 是 `repository-ci-awareness` 唯一的 production consumer，
  服务于 `hikari relevance repository-ci status` 与 model 的读取能力。

**这条链上没有任何 CI 事实被持久化**（6 个模块零磁盘写入）。
一次失败被处理之后，系统里除了「本激活期说过这个 run id」，没有任何痕迹。重启即彻底消失。

**没有 episode 概念。** 人类修好 CI 之后，下一次观测到成功 → `detectNewFailure` 返回
`undefined` → 什么都不发生。没有「已恢复」、没有结算。全链 grep
`episode|resolved|recover|previousRun|lastSeen` **零命中**。

**一处已确认的源码 / 文档反转**（本文最重要的单条发现）：

| | 说的是什么 | 锚点 |
| --- | --- | --- |
| 设计 review | 重启后的再次观测 → **不报**；「restart 的后果不是『重复』，而是『静默』」 | `repository-ci-attention-v0-boundary-review.md:246,410,709` |
| 设计 review 明令拒绝 | 「让重启后的第一次观测也报」 | 同文件 `:430` |
| 实现 | 重启后**会重新播报**当前红着的运行 | `test/repository-ci-attention.test.mjs:622-640` |
| freeze 文档 | 声称这是「沿用此前 review 已裁定的 v0 语义」 | `proactive-repository-ci-v0-implementation-boundary-freeze.md` §1.2 |

**三份文档里有两份说 A，实现做的是 B。** 原因在源码里很清楚：review 设想的
`previous: { runId, failed }` baseline（`:215`）在实现里不存在，实现改用
`handledFailures: Set<number>`——即 review §:192-193 表格里的 **B 方案的记忆形状，
配了 A 方案的存储寿命**。结果既不是 A 也不是 B：一个持续失败、人类从未被告知的
repository，在 Hikari 重启后会**被播报**——这是 review 在 `:430` 逐字拒绝的两个行为之一。

**诚实评估**：这不是一个代码 bug（行为有测试钉住），而是一次**未被真正作出的决定**。
它也没有明确伤害人类（重启后重报一条仍然红着的 CI，可能有用）。
但它是一个**具体的、可复现的失败场景**：一个真实 consumer 的真实行为，
因为「它没有自己的过去」，落到了一个**两个设计文档都反对**的位置上。

**Experience 是不是这里的答案？** 是，但答案是**比他想要的更小**——
这里需要的是「我记得我做过这件事」，不是「我经历了一件事」。见 §5 与 §7。

### 案例 B — Desktop Return

`desktop-return-attention` 的 `watch.silence` 同样是 activation-local。
它的形状与案例 A 同源（`judgement.ts:42` 自述：`a silence is a fact about this activation's own history`）。

**但影响近乎为零，本文据此把它记为「非 finding」。** 理由是 `judgement.ts:74` 的注释逐字写明了设计意图：

```text
silence under threshold  either no silence was being watched — the baseline case at activation,
                         ... : `watch.silence` is what tells the two apart.
```

即**激活起点被有意当作 baseline**：重启后若人类仍在离开中，重启后的**第一拍**就观察到
`silence >= afterMs` 并立即重新 arm，不需要重走阈值。

唯一丢失的窗口是：**某次 return 恰好发生在最后一次重启前采样与第一次重启后采样之间**——
一个 cadence 宽。这个窗口太小，不构成任何真实产品问题，**不构成本轮的 consumer**。

**这一条是本文主动撤回的一个候选**（初稿曾按「重启后需要重走整段阈值」写，与源码不符）。

### 案例 C — TUI 开发 → commit → 后来 CI 失败 → 想听到「这可能和昨天刚完成的 TUI 改动有关」

**这个案例不是 Experience 缺口，是感知缺口。** 理由是源码级的：

`src/git-repository/types.ts` 报告的全部内容是 `workTreeRoot`、`head`
（`branch+commit` / `detached+commit` / `unborn`）、`workTree`
（`changed` / `unchanged`）、`remotes`。

**没有 commit 的 subject，没有时间，没有 log。** 也就是说：

> Hikari 今天**无法知道「昨天刚完成的 TUI 改动」这件事发生过**。

给它再好的 Experience 机制，它也没有材料可以关联——因为**它从来没感知到那个改动**。
把这个案例归到 Experience Formation 名下，会得到一个错误的结论
（「我们缺一个关联层」），而真实的缺口在**感官**这一侧。

**记录判断**：案例 C 应交给 Sensory Expansion 讨论，**不进入本轮的 implementation slice**。
如果将来要推进它，第一件事是问「repository 内容观测」是否是一个真实的、有边界的感官，
而不是先建关联。

### 案例 D — Human correction（「不是这个原因，是 X」）

**这是目标 F 最重要的内容，也是本组案例中唯一被硬 blocker 卡住的一个。**

今天的路径：人类输入 → `language` → 对话回复。`src/language/*.ts` 全文件
**零 Chronicle、零 `append`、零 `writeFile`**——这条路径没有任何持久出口。

**能不能让它成为 Durable Fact？不能**，理由不是设计偏好，是 §2.4 引的
`durable-fact-admission-v0.md:120-121`：入口没有身份认证，写成 `{ kind: 'human' }`
是在断言一个无法证明的事实。

**因此**：在身份问题解决之前，Human correction **可以影响当前这一轮对话**，
**不能成为任何 owner 的事实**。这不是本轮能解的，也不应该用 Experience Formation 的名义绕过去
（绕过去的最诱人的形态，就是建一个「人类说了什么」的通用输入结构——
那正是 `core-architecture-v0.md` §11 禁止的 `Generic Human Input` / `HumanStatement`）。

### 4.5 四个案例的横向结论

| 案例 | 缺口在哪 | Experience 是答案吗 | 有具体失败场景？ |
| --- | --- | --- | --- |
| A Repository CI | 没有跨 activation 的自我记录 | **是，但比要求的更小** | **有**（有测试钉住的重启语义分歧） |
| B Desktop Return | 同源，但第一拍即重新 arm | 否（影响可忽略） | **无——已撤回** |
| C TUI → CI | **感知**：没有 commit subject / 时间 / log | **否。这是感官问题** | 有，但不属本轮 |
| D Human correction | **认证**：入口无法证明来源 | **否，被硬 blocker 卡住** | 有（`durable-fact-admission:120`） |

**四个案例里，只有案例 A 同时满足「指向 Experience Formation」与「有具体失败场景」。**
这四个案例的横切结论因此是：

> **本轮只有一个有证据的 consumer，且它要的东西比 Experience 小一级。**

---

## 5. 候选 ownership 形态

### 形态 1 — 域内自证（domain-local self-admission）

每个 owner 承认自己的事，读自己的事，因此行为不同。**没有新的 Plugin、没有新的 Service。**

- 与 doctrine（§1.3）一致：owner 承认它有权断言的那一条命题。
- 与 `durable-fact-admission-v0` 的已确立先例一致。
- 新增的机制只有一条：**owner 在 activation 开始时读回自己的事实**。
- 风险：每个 owner 各写一套，可能重复。**这个风险本轮不处理**——
  先有一个，再谈抽象（`principles.md` 的取向：今天的实现足够简单）。

### 形态 2 — 跨域 Experience 拥有者（一个收集所有经历的服务）

- **默认拒绝。** 它要求一个组件理解多个领域，这正是
  `core-architecture-v0.md` §6.6 `不建立中央 Judgement Domain` 与 §11 禁止清单要挡的东西。
- 名字换成 `NervousSystemService` / `CognitiveMeshService` 不改变它的形状。

### 形态 3 — 复用 Chronicle，不新增任何 owner

- 最窄。但**今天的 Chronicle 已经支持这件事**——`payload: JsonValue` 能装任何形状。
  也就是说：**如果只需要「存下来」，那这件事今天已经能做，缺口不在存放处。**
- 这个形态的价值在于它证明了：**本轮不需要任何新的存储抽象。**

### 关于「在哪里读」

| 位置 | 评价 |
| --- | --- |
| owner 自己在 activation 开始时 | **可行。** 与所有权一致，读的是自己的事实 |
| owner 在判断发生的那一刻 | 也可行，但需要每次判断都 IO，边界更模糊 |
| 一个中央读者，事后把经历推给各个 owner | **拒绝。** 这就是中央认知的雏形 |

---

## 6. 失败模式

按「最可能真的发生」排序。每一条都给出它能通过什么检查、卡在什么检查。

**F1 — Experience 变成换了名字的 telemetry。**
把每个 Event / 每次状态变化都记成 Experience。它能通过「有 Experience 了」的检查，
卡在「系统行为有任何不同吗」——没有任何不同。

**F2 — 只写不读。**
写了一份漂亮的经历，没有任何 owner 读回。这与今天的 Durable Fact
**在系统可观测行为上无法区分**（§1.2 已经就是这样）。
本轮最需要防的就是这个。

**F3 — Experience 成为 Memory 的后门。**
一旦 Experience 带上了 importance / confidence / relation，它就已经是 Memory，
只是避开了 `memory-reactivation-v0` 的 `BLOCKED` 裁决。

**F4 — 关联成为跨域判断的入口。**
「这条经历和当前情境相关」需要一个比较，而这个比较一旦跨越领域，
就已经是一个中央判断——无论它叫 relevance 还是 association。
**仓库已有的先例**：`repository-ci-relevance` 的关联是**逐字相等**，
且 review 已裁定它不能被升级（`memory-reactivation-v0` blocker 3）。

**F5 — 「过去永远塞进 prompt」。**
把历史材料塞进每一次模型调用当作「重新唤起」。这会让延迟、成本、噪音同时上升，
且**不是** reactivation——它没有「当前情境与过去产生关联」这一步。

**F6 — Experience 成为与 Observation 竞争的第二事实源。**
同一个事实在两个地方各有一份，且没有规则决定谁优先。
`repository-ci-world` 的注释已经挡过这个形状：World 不许「先得出结论再当作事实交出去」。

**F7 — 模型悄悄拿到准入权。**
让模型判断「这件事值不值得记住」。短期看效果最好，长期看它同时违反了
§2.3 与 N0 §7 的四条权威清单。

---

## 7. 最小可行的 Experience 语义

这一节是本文的结论性定义。七条，每条都可判定。

**E1 — 有 owner。** 一条 Experience 必须属于一个具体的、已存在的语义 owner。
没有「Hikari 的经历」这种不属于任何人的东西。

**E2 — 可归属。** 它必须是这个 owner 有权断言的那一条命题，不多也不少。
沿用 `durable-fact-admission-v0:120` 的 `source` 规则：只声称可证明的部分。

**E3 — 是承认，不是派生。** payload 从**刚刚发生的转变**构造，
不从 `current()` 事后推导（`work-focus/facts.ts` 的既有做法）。

**E4 — 域内。** 不携带跨域关联。关联如果需要，由读者在自己域内做。

**E5 — 被读回。** **这是本轮新增的唯一一条，也是全部价值所在。**
一条 Experience 只有在**它的 owner 后来读了它、并因此行为不同**时才成立。
在此之前，它与 Durable Fact 无法区分。

**E6 — 不携带重要性。** 没有 importance / salience / priority / confidence / rank。
这些字段一旦出现，Experience 就已经越过了 §2.2 的第三、四条区分。

**E7 — 不可修订。** 已写入的 Experience 不可改。它若要被重新理解，那是 Memory 的事，
需要 Chronicle 之外的基底（`core-architecture-v0.md` §6.4）。

**由 E5 得到本文最锋利的一句**：

> **一条写了但没被读过的 Experience，与一条 Durable Fact 无法区分。
> 因此 Experience Formation 不是一个存储问题，是一个「谁读自己的过去」的问题。**

**推论**：目标 B 措辞里的「影响**可能性**」（N0 §2B）**不足以**支撑成立一条 Experience。
如果它是本轮唯一的要求，那么 Chronicle 今天已经满足它，本轮零增量。
真正要做判断的是目标 F——**一次 action / speaking 的结果要改变后续行为**。
「改变行为」是可判定的，「留有可能性」不是。

---

## 8. 开放问题

**Q1 — 谁读？** 本文只找到一个有具体证据的候选：`repository-ci-attention`
读回它自己的 `handledFailures` 形态记录。这需要 Human 确认这是不是一个真实的产品需求。

**Q2 — 重启后应该沉默还是重报？** 这是案例 A 的核心分歧，
且**三份文档已经互相矛盾**（§4 案例 A 表格）。
本文**不替 Human 决定这一点**——它同时是产品意图问题（重启后重报是否有用）
和技术问题（记忆的寿命）。

**Q3 — 「影响的可能性」算不算？** 见 §7 推论。如果算，本轮的结论会退回到 BLOCKED。

**Q4 — Human correction 在没有认证的情况下能诚实记录什么？**
今天只能记「某个本机进程往这条管道写了一段文本」。这不足以支持任何 owner 的命题。
**本阶段不解，但必须记下它是目标 F 的一个真实 blocker。**

**Q5 — Experience 需不需要类型体系？** 今天的事实族用 `type` + `version`
（`work-focus.declared@1`）。这个形状是否够用，本文认为够——但**没有证据**，
因为只有一个事实族。**不预先设计。**

**Q6 — 增长边界。** `handledFailures` 只 `add` 从不 `delete`（全模块无 `clear`），
一个长跑的 resident 会按 run id 无限积累。若它变成 durable，这个界就成了一个真实问题。
本文不解决，只记录。

**Q7 — 读的时机？** activation 开始时一次，还是每次判断时？见 §5 末表。

**Q8 — 一个 owner 的过去，会不会让它的判断越过自己的领域？**
（即 `handledFailures` 从「我做过」滑向「这件事重要」。）这是 F3/F4 的具体形态，
需要在实现级 review 里被钉住。

---

## 9. 建议

### 9.1 建议的下一轮（不是实现）

本文**不建议直接实现**。建议的是**一轮针对单个 owner 的 Boundary Review**，
范围严格限定为：

```text
一个 owner（repository-ci-attention）
× 一个事实族（它自己的一次投递行为）
× 一条边（activation 开始时读回自己的事实）
```

**明确不包含**：
- 不建立 Experience Service / Store / Manager；
- 不建立任何跨域经历收集；
- 不建立 Salience / Importance Judgement；
- 不建立 Memory；
- 不修改 Chronicle 的契约；
- 不让 `work-focus` 恢复状态（`memory-reactivation-v0` §15 明令禁止）；
- 不为 Chronicle 找 reader 而创造需求。

### 9.2 为什么是这个 owner

它是唯一有**具体证据**的候选（§3.3、§4 案例 A）：

1. 它的「过去」今天已经以 `Set<number>` 的形式存在——只是寿命只有一次 activation。
2. 它的行为后果今天可以被观察到（`test/repository-ci-attention.test.mjs:622-640`）。
3. 它的重启语义**从未被真正决定过**（三份文档互相矛盾）。
4. 它需要的是**自我记录**，不是「经历」——这是本轮能找到的、最小的真实需求。

### 9.3 必须先问 Human 的问题

- **Q2**（重启后沉默还是重报）必须先有裁决，否则这一刀的验收条件无法写出。
- **Q1**（这是不是真实产品需求）决定本轮是 NARROW 还是 BLOCKED。

### 9.4 如果 Human 认为「重启后重报」是正确的产品行为

那么案例 A 的动机消失，本轮没有第二个有证据的候选，
**verdict 应下调为 BLOCKED**，并记下「Experience Formation 的解锁条件 =
出现一个真实 bounded consumer，它的职责无法只靠 current facts 完成」。
（这个形状与 `memory-reactivation-v0` §14.1 的三条解锁条件同构。）

---

## 10. Verdict

```text
VERDICT = NARROW
```

**NARROW 的含义**（沿用 `durable-fact-admission-v0` 的用法）：

- **只**批准下一轮针对**一个 owner、一个事实族、一条边**做 Boundary Review；
- **不是**批准 Experience 抽象、不是批准新 Service、不是批准 Memory、
  不是批准任何跨域机制；
- 本轮的这一刀**切的是「读回」这一侧**——它是仓库从未有过的能力，
  也是本轮唯一的真实增量。

**为什么不是 READY：**
因为「Experience」这个词所要求的语义（N0 §2A：高于 raw observation 的一级）
在仓库里**没有被任何 consumer 提出需求**。真实存在的需求是「我记得我做过这件事」，
它比 Experience 小一级。按 `principles.md`「不为了更完整、更对称、以后可能有用扩大 slice」，
本轮**不应该**在需求之上多建一层。

**为什么不是 BLOCKED：**
写入侧有真实发生源（`repository-ci-attention` 的投递行为今天就在发生）、
有已确立的 doctrine（`durable-fact-admission-v0`）、有可观察的行为后果（重启语义）、
有一个明确 entitlement 的 owner。这与 `memory-reactivation-v0` 的
「读侧没有任何已经存在的东西」不同——这一侧有一个具体候选。

**下一步（三选一，由 Human 裁决）：**

1. **批准 9.1 的 Boundary Review 范围** → 进入针对单个 owner 的只设计一轮；
2. **裁定 Q2 为「重启后重报是正确的」** → verdict 下调为 BLOCKED，
   记下解锁条件（§9.4）；
3. **认为候选太窄、要求重新找 consumer** → 本轮退回研究，
   但**不得**为此创建 Salience / Awareness capability / generic recall 来凑需求。

**本轮不实现任何代码。** `git status --short` 应只有本文与 N0 两处新增文档。
