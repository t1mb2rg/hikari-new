# 认知—行动闭环 v0 — 边界评审

> **工作标签，不占用阶段编号**。
>
> 本片的触发器是 **Human 在 2026-10-15 晚给出的裁决**：在「继续扩架构」与「回头审架构」之间，他选择**用一次真实闭环来检验现有架构**。原话逐字：
>
> > 「确实这一点让我很担心，没有核心的认知中心确实让整体的实现变得很零碎，没有统一认知。我们确实应该先试试在这个架构通过闭环来验证合理性」
>
> 他要验的不是一个功能，是一句判断：**在保持领域自治的前提下，Hikari 能不能形成一次跨领域、可行动、可反馈、能延续的认知循环。**
>
> 本片**只定义实验，不写代码**。任何一处要触碰冻结字面的改动，都在 §5 逐条列出并给出正式修改路径，由 Human 逐项裁决——**不绕过，不默认**。
>
> 前情：`docs/architecture/answer-shape-v0-boundary-review.md`（回答的形态）、`docs/architecture/read-shuts-the-door-v0-boundary-review.md`（读取一旦发生，回答就只剩读取）、`docs/architecture/capability-reachability-v0-boundary-review.md`（可达 ≠ 被想到）。那三片是被它说的某句不真的话逼出来的；本片问的是那些话共同暴露的那件事。

## §0 结论

**VERDICT = NARROW**（Human 2026-10-15 审阅意见，逐字采纳）

> 同意开展**有界**的架构可行性实验；**里程碑 1 可以在确认具体设计边界后实现**；**里程碑 2、3 仍需分别确认 owner、契约、权限和执行证据**。

本片不修宪法（§5.0），但会越过 owner 边界、给既有 contract 添 consumer（§5.4、§5.7），因此按 R5 落 **L2**——产物是本文件 + 这个 verdict。**这个 verdict 的作用域是这次有界实验，不是三个里程碑一起放行**（§5.7）。

**这条闭环今天缺的不是一个中心，是三格没人认领的事实。** 而且它比听起来小：

1. **卡住「事实相遇」的，是一条没人声明过的绑定，不是一套认知整合机制。** `src/repository-ci-relevance/judgement.ts:53-64` 逐字拒绝把 `hikari-new` 认成 `t1mb2rg/hikari-new`，理由写得是对的（「两个字符串看起来像，不等于来源已证明它们指同一件事」）。问题在下一句：**它没有权做这个判断，而有权做这个判断的 owner 今天不存在。** 所以第一步的最小形态是「人显式声明一次身份 + 一个消费者读它」，不是框架。
   **而且半条闭环已经跑通**：`repository-ci-attention` 今天已经走完「看 → 判断 → 说话 → 投递 → 记回系统 → 下次激活读回来」，它之所以从不遇到 `unknown`，是因为那条路上每个字符串都是 GitHub 自己的拼法（§1.5）。闭环不是从零建，缺的是**「人的本机路径」这一侧没有入口**。
2. **三格缺口的性质各不相同，因此解法不能相同**：身份缺的是**一个有权声明的动作**（`change declare` 已经是这种动作的样板）；「现在」缺的是**一个拥有时间的 owner**（今晚实测：它回答「我没有钟」）；按兴趣读取缺的是**一个有界读契约**（不是「让它随便读 chronicle」）。
3. **第 3 步（真实的行动）在本代是空的，但它的边界与形状已经被裁决过**（§5.1 ②）——**缺的是实现，不是设计**；第 4 步（回执）有先例。今天唯一的「动作」是把话**投递**出去（`delivery.deliver`），没有任何会改变外部世界的动作——所以这一步仍然要正式处理（§5），否则「不为了实验绕过冻结」这条约束在实现时一定会破功。回执的长相已经有样板（§1.5）：`repository-ci-attention.delivered`，且**只在真的写出去时才写**，下次激活读回。另外一条明令要正面处理：`judgement.ts:11-12` 的 `relevant ≠ salient`——主动线**不得**判断重要性，所以「要不要动」必须在别处找到 owner。
4. **验收要同时防两种假验证**：把聊天记录塞进 prompt 冒充「记得」；用一次能跑通的演示冒充「架构成立」。§3 给出可测形式，§6 给出反假判据。
5. **扩展性验证与功能验证同等重要**：只有第一条闭环成功、而加入第二个来源就需要大量特例，那证明的只是一个局部功能。第二个场景建议选**时间**——它与 CI 是**不同种类**的事实，且今天同样没有 owner。
6. **这次实验允许得出「现有架构不适合」的结论**，判据在 §4。实验的价值不取决于它成功，取决于它是否公平而严格。

## §1 证据（2026-10-15 晚实测或亲读）

### 1.1 那个 join 卡在哪（逐字）

`src/repository-ci-relevance/judgement.ts:59-60`：

> `hikari-new` therefore does not match `t1mb2rg/hikari-new`, and `P4-03` matches neither. That is not a v1 shortfall to be closed later; **it is where the truth boundary for this judgement sits**.

`:53-57` 列出它拒绝做的推理（trimming、case folding、取 basename、拆 owner 与 name、改写 remote URL、检测 fork、查别名表、**问模型**），并说明理由：这些每一个都是「这层在断言两个不同字符串指同一个仓库——一次关于意义的推断，不是两个来源报告过的东西，也不是这层有权加进去的东西」。

`:61-64`：唯一能产出 `relevant` 的规则是**逐字相等**。

**所以 `unknown` 不是失败，是设计良好的拒绝。** 缺的是拒绝之后本该有人接手的那一步。

### 1.2 今天真的存在什么（实测）

- **chronicle 全部内容是 3 行**：文件头 + 两条事实。`C:\Users\29719\AppData\Local\Hikari\resident\chronicle\chronicle.jsonl`
  - 行 2 `language.decision-confirmed`，`occurredAt 2026-10-08T16:46:22.568Z`
  - 行 3 `changeable-repositories.declared`，`occurredAt 2026-10-13T17:31:46.887Z`，payload `{"repositories":["G:\\work\\LAB\\code\\hikari-new"]}`
  - Human 在 2026-10-14 19:34 问「`change declare` 的声明存在哪里、重启后为什么还认得」，正确答案就是行 3 + 插件启动时读回内存；**而它当时答不出，因为这句话的事实不在任何已声明为可改的仓库里**。
- **`hikari ask` 一个字都不写**：跑前 3 行，跑后仍 3 行。（`src/cli/options.ts:405` 逐字：「只有 confirm 会写，hikari ask 不写任何东西」。）
- **没有每回合日志**：本代常驻 stdout 只有一行「Hikari 常驻已启动。」；`resident.log` 里是**上一代（Python）Hikari** 的启动行。每回合唯一的痕迹是进程内 `DialogueTurn`：只记工具名，5 分钟 TTL，进程一退就没。
- **没有钟**：见 1.3 第 4 问。
- **有两条主动线，不是一条**：`repository-ci-attention`（服务那一侧）与 `desktop-return-attention`（人自己机器那一侧）。**CI 投递结果的回流已经部分实现**——`repository-ci-attention.delivered` 下次激活会被读回（§1.5）。所以本实验**不得**把「反馈为零」当作基线来描述成果。
- **18 个插件全部 `active`**：真相的所有者是齐的，缺的是相遇。

### 1.3 五个探针的实测回答（2026-10-15 晚，用他自己的常驻与模型，跑完已停）

全部原文在 `G:\work\LAB\hikari-test\probe-*.txt`，整理稿 `probe-report.md`。五问 32 秒。

| 问 | 它答了什么 | 性质 |
| --- | --- | --- |
| 记得上次聊什么 | 只举出一条（一条 2026-10-08 确认过的话），并说「除此之外我没有别的留档……那会是我编的」 | **诚实，但只有一行记忆** |
| 现在在看着什么 | 桌面观察（前台进程与窗口标题）、授权的仓库路径、CI relevance `unknown`；并指出「这个工具里根本不含 CI 状态」 | 观察是真的，关联是空的 |
| 上一句话读了什么 | 报出三个**工具名**，并说明读回的内容没有留在上下文里 | 过程可见，内容不留 |
| 现在几点 / 聊了多久 | 「我没有钟」「说了就是编的」 | **格子无人拥有** |
| 记下了哪些东西 | 四本账（工作焦点空 / 桌面观察 / 授权仓库 / CI relevance）+ 人 confirm 过的那句，且分开「观察」与「你说过的话」 | 分类正确 |

**结论：它不编。** 这条品质是做闭环最要紧的起点——先把它从「诚实地说不知道」变成「有东西可说，且说的每条都能追溯」。

### 1.4 已经成立的相遇样板（可复用）

`desktop-session-world`（前台 + 输入活动）与 `repository-ci-world`（git 观察 + github-ci 观察）都是「多个生产者的事实在一个 world 消费者那里相遇」。**所以缺的不是中心，是几个没人认领的格子。**

### 1.5 本代已经跑通的**半条闭环**（这条最关键，它改变了实验的形状）

`repository-ci-attention` 是**第一条**不被问就说话的主动线（`src/repository-ci-attention/plugin.ts:1` 自称 "The one plugin in this repository that speaks without being asked"——**这句话今天已经过期**：`src/desktop-return-attention/plugin.ts:1-2` 自称 "The second plugin in this repository that speaks without being asked, and the first whose subject is the human's own machine rather than a service somewhere else."）。它今天已经完整走过：**看 → 判断 → 说话 → 投递 → 记回系统 → 下次激活读回来**：

- **它拥有什么 / 不拥有什么**（`:3-7` 逐字）：own——「when Hikari looks at the CI of the repository an operator named, and whether what it found is something it has not already said」；not own——「what CI is (that is `github-ci`), how a failure is worded (that is `language`), whether a human is there to receive it (that is `human-delivery`), or what a durable fact is (that is `chronicle`). **It requires all four and provides nothing**」（`:92-93`：四个 service，`provides: []`）。
- **授权的既有定义**（`:84-85` 逐字）：「The composition grants the first by having a repository scope, the next two by loading the two providers, and the last by loading the store — **which is the whole of what "authorization" means here**」（引 `principles.md` §5：能力存在不等于许可）。
- **有界读取的既有样板**（`:9-13` 逐字）：「**the first plugin in this repository to read its own durable history back**, and that is the whole of what it uses Chronicle for. **Reading is owner-local: this module, and only this module, knows what a `repository-ci-attention.delivered` fact means.**」实际动作在 `:161`：`readDeliveredFailures(await chronicle.read())`——它读整个 chronicle，但**只解释自己那一种事实**。
- **动作与回执**（`:203`、`:215`）：`await delivery.deliver(speaking.speak(occurrence))` → 仅当结果 `delivered` 才 `chronicle.append(deliveryFactDraft(occurrence))`。它就是第 4 条验收「行动结果能反馈」的既有先例。
- **它拒绝越界的地方**（`judgement.ts:11-12` 逐字）：「Neither of them is allowed to ask whether the failure *matters*: **`relevant ≠ salient`**, and the moment this file grew a notion of importance it would have become the generic attention framework the ruling forbids.」

**它为什么不需要身份关联？** 因为这条路上每一个字符串都是 **GitHub 自己的拼法**：`types.ts:31`「GitHub's own `owner/name` spelling, exactly as `github-ci` reported it」；`judgement.ts:97` 的键就是 `failureKey(observation.repository, run.id)`。**同一种拼法之间不需要推断，所以这里从来没有出现过 `unknown`。**

**第二条主动线（`desktop-return-attention`）多给了两个证据**（Human 审阅意见点出过期事实后，我亲自读了 `src/desktop-return-attention/plugin.ts:1-22`）：

- **这个形状是可复制的**：`:10-11` 逐字「The shape is `repository-ci-attention`'s, deliberately and almost line for line, because the two are the same kind of thing」——第二条主动线几乎是照抄第一条长出来的。这既是「领域自治成本可控」的正面证据，也**正是 §3 第 5 条必须排除「普通去重」的原因**。
- **两条线的防重复机制不一样**：`repository-ci-attention` 用一条**落盘事实**（`delivered`）在下次激活时早退；`desktop-return-attention` 的重复规则「falls out of the temporal state instead of being enforced against a record」（`:14-16`）。**同一种「别重复说」在这个仓库里已经有两种实现**，所以「第二次不说了」本身**不能**用来证明认知成长。

**这给出了本实验的准确形状**：闭环不是从零建，它已经有一半——**在「GitHub 拼法」这一侧全部跑通，在「人的本机路径」那一侧没有入口**。缺的两步因此非常具体：

1. 人在**本机路径**上声明的东西（可改仓库、工作焦点）与 CI 观察使用的 **GitHub 拼法**之间，**没有任何人被授权建立绑定** → 这就是 `unknown`。
2. 主动线走到「播报」就停了：`relevant ≠ salient` 那条裁决明令它**不得**判断重要性，于是「要不要动、动什么」今天**没有 owner**。

**所以里程碑 2 不是「发明主动性」，而是「在既有播报之后补上被明确留空的那一步」；里程碑 1 也不是「造认知整合」，而是「给一个已经存在的相遇补上人声明的那条绑定」。**

## §2 场景与三阶里程碑

### 2.1 场景（第一条完整验证对象）

**工作焦点 + Git 仓库 + GitHub CI + 历史事实**：Hikari 能不能理解「我正在关注的那个仓库，它的 CI 现在怎么样了」，并在异常时**提出**一次有依据的判断、在授权后**执行**一次真实动作、把结果**记回系统**、让下一次判断因此不同。

选它的理由：它是 Human 自己的真实问题（2026-10-14 19:34 那问的同一族）；它的每一格今天都存在**真的生产者**（Git 观察真的跑了、github-ci 真的读了、工作焦点真的有一张表）；它唯一的缺口正好是「相遇」。

### 2.2 里程碑 1 — 事实正确相遇

**要看到的行为**：当 Human 显式声明「我现在的仓库是 X」，Hikari 能依据**这份声明**把工作焦点与 CI 观察连起来；能确认就确认，不能确认就保留 `unknown`（并说清为什么不能确认）。

**要补的那条绑定说得更准**：缺的不是「一个仓库的身份」，是**人的本机路径 ↔ GitHub 的 `owner/name`** 这一条对应关系（§1.5：CI 那一侧全部用 GitHub 自己的拼法，所以它那边从来没有 `unknown`）。

**不做什么**：不引入任何自动身份推断（trimming / 别名表 / 问模型），也不为这个判断新建一个全局 Identity Resolver。**优先复用已经存在的「人显式声明」动作**（`change declare` / `focus declare` / 常驻启动时 `--repository` 那类命名），而不是发明第二套声明机制。

**一处必须继承的边界**（`docs/architecture/hikari-nervous-system-stage-v0.md:214-217` 逐字）：

> `source` 只声称可证明的部分。`{ kind: 'human' }` **被禁止**——入口没有任何身份认证，这条管道上任何本机进程都能写入，写成 `human` 是在断言一个无法证明的事实。

既有的声明动作已经证明过怎么避开它：`source` 是 owner 自己的 kind，不是 `human`（`src/changeable-repositories/facts.ts:66`：`const source = { kind: CHANGEABLE_REPOSITORIES_SOURCE_KIND } as const;`）。新声明照此办理。

### 2.3 里程碑 2 — 判断产生行为

**要看到的行为**：相关 CI 失败时，它能**自己**（不是被问）形成一个局部决定：要不要提这件事、提什么；在拿到授权后，做一次**范围明确的真实动作**，而不是只说「CI 失败了」。

**要补的那一步说得更准**：**播报已经存在**（`repository-ci-attention`），缺的是播报**之后**那一步——而「这次失败是否要紧、要不要提议动手」**不能**放进 `repository-ci-attention`，它被明令不得判断重要性（`judgement.ts:11-12`：`relevant ≠ salient`）。所以这一步要么属于工作焦点那一侧的消费者，要么属于一个新的、职责写得出来的消费者——**这正是 §4 第 3 条失败判据要盯的地方**。

**不做什么**：不做通用 Action 框架；不做「模型可以自己发起动作」。授权形态沿用现有定义（`plugin.ts:84-85`：composition 就是授权；`principles.md` §5：能力存在不等于许可）；真实动作取 §5.1 ② 那条**已经被裁决过**的形状——**人的原句就是这一轮唯一的 mandate**。

### 2.4 里程碑 3 — 行动结果回到系统

**要看到的行为**：被授权的真实动作产生一条**可追溯的事实**（这一轮做了什么、结果是什么、push 之后的 CI run 号、来源与时间），之后 Human 问「刚才那个 CI 问题怎么样了」，它依据那条事实回答；**并且下一次遇到同类情形时，它的选择与第一次不同。**

**这次要证明的是跨 owner 的连续性**：回执先例已经有了（`repository-ci-attention.delivered`），但它**只服务它自己**（`plugin.ts:9-13`：Reading is owner-local）。实验要看到的是那条事实能被**它自己之外的**消费者读出并改变判断——这一条才是「统一认知」在可验证意义上的最小形态。

**这一条是本次实验最值得观察的架构压力点，本文件不预先规定怎么实现**（Human 2026-10-15 审阅意见，逐字采纳：「我希望这一步保留为真正的架构考题」）。两个方向都还在桌面上：

- **(a) 由事实的语义 owner 提供一个有界的读取能力**——谁解释这条事实，谁负责把它讲给别的领域听；
- **(b) 由消费者自己读 Chronicle，但只解释它需要的那一部分**——`repository-ci-attention` 今天是这么做的（`plugin.ts:9-13`：「Reading is owner-local: this module, and only this module, knows what a `repository-ci-attention.delivered` fact means」）。

**最终选哪一个，由具体交互需求决定。** 明确**不允许**的是：任何消费者随意解释**别人的**事实——那会把「owner 才知道自己的事实意味着什么」这条既有纪律拆掉。这个问题答成什么样，正是判断「领域自治能否以合理成本形成跨领域连续认知」的第一批硬证据。

**证据的形状不是我们新发明的**：§5.1 ② 那条 2026-10-13 裁决已经写死了配套要求——**证据栏必须包含 push 之后的 CI run 号，且记录必须写明「它 push 了」**（因为一旦 push，本地回退不等于世界回退）。

**里程碑 1 与里程碑 3 必须分开**（Human 2026-10-15 审阅意见，逐字采纳）：

- **里程碑 1 解决的是认知问题**：「本地路径与 GitHub 仓库的关系有什么可靠依据」。它产生的是**身份关联**。
- **里程碑 3 才做行动目标解析**：拿这条关系去解析「这次动作落在哪个仓库上」，并**重新检查**授权范围与仓库的实际当前状态。绑定事实可以复用，但**不得因为曾经建立过绑定就跳过最新状态检查**。
- 依据是 `core-architecture-v0.md:423` 不变量 9 逐字：「**改变现实必须基于当前状态，而不是旧判断。**」在 commit / push / CI 回执这条路径上尤其要紧：一旦 push，本地回退不等于世界回退。
- 在 §5.2 那条链上，这两件事落在**不同的两步**：里程碑 1 是 **Normalize / Resolve**（把名字归一成可判断的目标）；里程碑 3 还要过 **Monotonic Guards**（用当前状态而不是旧判断再校一次）。

**不做什么**：不把「结果」存在聊天记录里冒充经验。

## §3 五条验收的可测形式

| # | 验收 | 今天的值 | 可测判据 |
| --- | --- | --- | --- |
| 1 | **事实能够关联** | ❌ `unknown`：人声明的本机路径与 CI 观察的 GitHub 拼法之间没有任何绑定 | 显式声明身份后，CI relevance 从 `unknown` 变为**有依据**的判断；判据：同一串字符**不再是靠相似性匹配**（源码里没有新增推断规则），且理由可被打印 |
| 2 | **能够自主形成局部决定** | ⚠️ 有一条主动线（CI 播报），但它被明令**不得**判断重要性（`judgement.ts:11-12`） | CI 失败时**没有本轮提问**也会产生一条提议；判据：从常驻日志/事实里能看出这次决定不是由一次 `ask` 触发的，且这个「该不该提」的判断有一个说得出的 owner |
| 3 | **可以完成受约束的真实行动** | ⚠️ 只有「投递字节」，没有任何会改变外部世界的动作 | 动作有**明文的 mandate**（人的原句）、**明确的范围**（已声明的可改仓库）、**真实的执行结果**；判据：动作前后系统外部状态可分别观测（`git` 状态 + push 之后的 CI run 号），且失败也算证据 |
| 4 | **行动结果能够反馈** | ✅ 有先例：`repository-ci-attention.delivered`（下次激活读回，但只服务它自己） | 动作产生一条事实；判据：进程重启后这条事实仍在，且能被**它自己之外的**消费者读出并引用 |
| 5 | **过去真正改变后续行为** | ❌ | **出现一个新的 CI run，它的失败与过去某次有可验证的关联**；Hikari 因为**读到了此前行动的结果**而选择了**不同的后续处理方式**；判据：在**克隆的数据副本**里移除那条事实、其余输入不变，行为退回基线 |

第 5 条的判据是这次实验里最值钱的一条：**它把「记得」从叙述变成可对照的因果。**

**但第 5 条必须先排除「普通去重」造成的假成功**（Human 2026-10-15 审阅意见，逐字采纳）：

- 「第一次通知了、第二次不通知」**不能**当证据：那正是 `repository-ci-attention` 今天已经会做的事（`deliveredFailures` 早退，§1.5），而 `desktop-return-attention` 甚至用了另一种实现（时间状态，不靠记录）。**同一个 run 不重复播报是既有功能，不是认知成长。**
- 所以判据必须落在**新 run + 可验证的关联 + 不同的处理方式**上：变化的是**它怎么处理**，不是「它有没有再说一遍」。
- **对照实验只在克隆的数据副本里做**：生产 Chronicle 是追加式历史（`src/chronicle/store.ts:24-26`），**不得为了实验删除生产事实**；实验用可重复的测试环境与数据副本。

## §4 架构失败判据（何时该回头改原则）

实验过程中出现以下任一情况，即认为**现有边界本身**值得正式重新审查（而不是继续加实现）：

1. 为了一条普通认知链，必须制造**大量只用于传递数据的插件**。
2. 信息关联必须穿过**多个没有实际语义价值的中间层**。
3. 一个**真正合理的领域判断找不到能够承担责任的 owner**（第 1 步的 `unknown` 就是这种形状——如果它无法通过「人显式声明」解决，那就是这一条）。
4. 现有规则迫使实现者**绕过契约**才能完成基本功能。
5. 加入第二个事实来源时，协作成本**显著超过**它带来的价值（§0 第 5 条）。

同时明确：**实现过程中需要扩展契约，不等于架构失败。** 真正值得质疑的是扩展之后仍然分不清职责，或维护边界的复杂度明显超过它带来的价值。

## §6 反假验证判据

1. **连续性不能来自上下文**：不接受「把聊天记录塞进 prompt 所以显得记得」。判据用 §3 第 5 条的对照实验。
2. **诚实不能退化**：探针里它今天不编（§1.3）。闭环实现后要重跑同一组探针；**如果它开始编造它读不到的事，那这次实验就是失败的**，无论功能多好看。
3. **关联不能来自模型**：身份关联如果由模型「看出来」的，不算通过（`judgement.ts:53-57` 已经把它列为无权推断）；必须来自人显式声明的事实。
4. **演示不算证据**：判据必须能在**重启之后**、在**没有我在旁边看着**的情况下复现。

## §5 会触碰的冻结裁决与正式修改路径

> 方法：按 `docs/architecture/governance-rules-v1.md` 的 **R2**（冻结三形态：MUST / SHOULD / NOT-YET）归类，按 **R5**（L1 实现评审 / L2 Boundary Review / L3 架构修订）选级别。本节**不引用任何未逐字核实的条款**——两份只读侦察的原始报告在仓库外：`G:\work\LAB\hikari-test\recon-frozen-clauses.md`、`recon-authorization-precedents.md`。按 R5，**级别由改动触及的最高类别决定，不由 diff 大小决定**。

### 5.0 先给结论：这次实验不修宪法

- 需要修改 `principles.md` / `core-architecture-v0.md` 的 **MUST**：**0 条**。
- 需要 Human 拍板的**阶段裁决**：**2 条**（5.1）。
- 需要新建的文档：**0 份**（本文件即那次 Boundary Review）。
- 需要顺手补的指针：**1 处**（5.3）。

理由：实验**不新建平面、不改不变量**，它第一次**使用**一条已经被裁决过的平面。那三条 MUST——

- `core-architecture-v0.md:421-423` 的不变量 7 / 8 / 9：「**查询信息与改变现实是不同操作。**」「**真实副作用必须经过 Action 边界。**」「**改变现实必须基于当前状态，而不是旧判断。**」（同节 `:424-425` 还有不变量 10「Chronicle 共享事实，但不共享控制」与 11「不存在中央判断器或超级协调器」）
- `principles.md:115-119`：**Action Pipeline 用于所有真实外部副作用**，逐字「无论动作来源是用户、模型、Awareness、Goal、Forge、定时任务或其他模块，只要会改变外部世界，就必须经过统一行动治理链。」——它把「模型」列为动作来源之一，但**不授权任何来源**，它对所有来源要求的是同一件事：走那条链。
- `principles.md:306-313`：四条「不允许」逐字含「**某个模型插件绕过统一治理去调用原始系统资源**」，并给出正面表述：「**模块可以提出 Action Intent，但不能绕开治理链。**」

——要求的正是「真实副作用必须经过 Action 边界」。**实验按这个要求做，所以它是在遵守 MUST，不是在改 MUST。**

### 5.1 两件必须由 Human 拍板的事（阶段裁决，不是修宪）

> **2026-10-15 Human 审阅意见（两问已答）**：① **支持**本次有界实验纳入第一条执行路径；② 既有 10 月 13 日的 Action 授权「已得到源码与文档支持」——**确认有效**。**但里程碑 3 的实际写入、commit 和 push 仍需单独授权**（§7 第 0 条）。

**① 把「行动第一片」纳入本阶段。**

- 现状，逐字（`docs/architecture/hikari-nervous-system-stage-v0.md:205-207`）：

  > **Action Pipeline。** …而 `src/` 内**零 Action、零 Receipt**。这是真实的架构欠账，但**它不在本阶段**——本阶段只记录它，不补它。

- 归类：按 R2，这是 **NOT-YET**（措辞是「不在本阶段」，不是「不得存在」）。NOT-YET 的定义是「还没有真实需求；**真实需求出现即自动解除条件**」。
- 那个真实需求**已经出现**：Human 2026-10-15 的原句（本文件抬头引文）+ 一次实测的口径（它读不到自己的手，§1.2）。
- 另一条相关裁决（`docs/development/current-stage.md:2179-2187`）记着本期唯一开闸条件，逐字：「只有在出现**新的真实产品问题**时，再由该问题驱动下一阶段定义」。**本实验就是那个问题驱动的一次定义**——但它需要 Human 明确说「开始」。
- **要 Human 答的一句**：是否把「执行者的第一片」纳入本阶段（而不是等 Phase 4 收口）。同时明确：**不创建 P4-04、不开始 Salience research**（`current-stage.md:2179-2187`）。

**② 确认 2026-10-13 那条 (iii) 裁决仍然有效。**

- `docs/architecture/authorized-repository-action-v0-boundary-review.md:187` §8 裁决第 5 条逐字：

  > **执行者第一次被允许做到 (iii)：commit + push + 看 CI。** 配套要求（否则记录在说一件比实际小的事）：**证据栏必须包含 push 之后的 CI run 号，且记录必须写明「它 push 了」**——因为一旦 push，本地回退不等于世界回退。

- 同文件 `:190-192` §8.1 的形状（Human 同日确认）逐字：

  > **能力承认是常设的、由外部给的；授权是逐轮的、由 Human 的句子给的；而「不可回退」与「改变边界」这两类动作要单独过一道人的关。而在授权范围之内，模型自己决定怎么做——这正是它能干活的原因。**

- 同文件 `:194` 说明这条形状的参照实现是一个**真实工作的 agent**：原句作为这一轮唯一的 mandate 到达 → 工具集事先承认、模型加不了工具 → 模型自决调用顺序与改法、无逐动作的人在环 → 安全来自「能力集有限 + 动作大多可回退 + 边界处停下来问 + 账本完整」→ 模型不能自己扩权。**`:194` 逐字：「本片照抄这个形状。」**
- 同文件 `:235-245` §8ter.1 又加了一条配套不变量（见 5.6 的层级说明）与「机械兜底」的对应物：**可改仓库的声明（范围）+ git（可回退）+ 执行者的进程边界（只能在那个目录里、只能做那三个动词）**。
- **风险（侦察发现，我复核）**：这条裁决在 `docs/development/current-stage.md` 里**零引用**。按 R7「**发生过的裁决必须落纸**」，它已经落在那份评审里；但阶段记录没有指向它，所以它的有效性需要一个明确回答。
- **要 Human 答的一句**：这条 (iii) 裁决是否仍然有效？（若有效，§5.3 顺手补上双向指针。）**已答（2026-10-15）：有效——§5.3 的指针照做。**

### 5.2 已经有材料的部分（侦察的正面结论）

> **本节只说哪些材料已经存在**，**不构成对 §2.4 那个跨 owner 读取问题的裁定**，也不预先宣布「三个缺口都不需要新机制」。按 Human 2026-10-15 审阅意见，那一步**保留为真正的架构考题**，由具体交互需求决定。

这三条让实验比原以为的小：

1. **持久化机制不用新建**：复用 Chronicle（append-only，`src/chronicle/store.ts:24-26`）；写入口的形状复用 `changeable-repositories` 的 `declare / replace / clear`（`src/changeable-repositories/facts.ts:90-91`，写入 `src/changeable-repositories/session.ts:69`），并遵守它已经立下的两条纪律——「一条不持久的授权不是授权」（`session.ts:15`）、写失败即不采纳（`session.ts:50`）。
2. **「一次性授权」已有样板**：`hikari screen "<text>"` 是全仓库唯一的「词即授权、用完即弃、不落盘」形态（`src/cli/screen-command.ts:1-6`）；桌面正文的门也是这一个词，且**只在一处接线**（`src/language/plugin.ts:417-420`），词表封闭（`src/language/types.ts:91`），**拒绝先于读**（`src/language/answer.ts:516-522`），授权靠参数传、**不能比调用活得长**（`src/language/answer.ts:264-268`）。里程碑 3「授权后执行」可以照这个形状，不必发明第二套。
3. **读回自己写过的事实 ≠ Memory**：`principles.md:392`/`:394`/`:718` 与 `core-architecture-v0.md:257`/`:271`/`:273` 逐字区分「**Chronicle = 发生过什么**」/「**Memory = Hikari 从经历中理解出了什么**」，并写明「Memory 是可修订解释，不是事实真源」。因此本实验「读回事实改变下一次判断」走的是 **Chronicle 读侧**，**不落进** `memory-reactivation-v0-boundary-review.md:13-33` 的 `MEMORY REACTIVATION v0 = BLOCKED`；同文件 `:31` 也逐字保留了出口：「Historical Query 可以在未来出现真实用户需求时**独立进入**，但它**不自动构成 Memory**」。
   **代价与红线**：正因如此，实验**不得**长出任何解释 / 修订 / 置信度层。同文件 `:394-407` 逐字：「**也不要为了给 Chronicle 找 reader 而创造需求。**」「**明确不做**：任何 0→1 的 Memory 抽象。」
4. **动作那条链本身已经写好了，实验只是第一次走它。** `principles.md:284-304`（§8 的标题逐字：「**所有真实行动统一进入 Action Pipeline**」）给出的链是：

   ```text
   Action Intent
   ↓
   Normalize / Resolve
   ↓
   Authority Policy
   ↓
   Monotonic Guards
   ↓
   Approval（如需要）
   ↓
   Capability Provider
   ↓
   Result / Receipt
   ↓
   Durable Fact
   ```

   **三阶里程碑不是三件新东西，是同一条已经被 MUST 要求、却一次都没有走过的链的第一遍。** 对应关系：

   | 实验里的东西 | 链上的哪一步 |
   | --- | --- |
   | 里程碑 1 那条绑定（人的本机路径 ↔ GitHub 拼法） | **Normalize / Resolve** |
   | 「可改仓库」的声明（范围）+ 低信任来源不得自我升权 | **Authority Policy** |
   | 不变量 9「改变现实必须基于当前状态，而不是旧判断」 | **Monotonic Guards** |
   | 人的原句（这一轮唯一的 mandate） | **Approval** |
   | 执行者（改文件 / commit / push） | **Capability Provider** |
   | push 之后的 CI run 号 | **Result / Receipt** |
   | chronicle 里那条事实 → 下次激活读回 | **Durable Fact** |

   这张表也解释了为什么里程碑 1 **不是**可选的铺垫：那条绑定就是链的第二步。缺了它，链在第一格就断了——这正是 `unknown`（§1.1）。

### 5.3 一条要补的指针（R7）

`docs/architecture/authorized-repository-action-v0-boundary-review.md:187` 的那条裁决今天在 `docs/development/current-stage.md` 里没有任何引用。按 R7「**修订必须留下双向指针**」，5.1 ② 已确认它有效，本次一并补上（本版已做）：阶段记录指向该条裁决，该裁决指向本阶段记录。**这是文档工作，不需要新裁决。**

### 5.4 「把两半串起来」这件事本身没有被裁决过（本文件的定位）

- 侦察的空白结论：认知侧每一半都有裁决（关联规则 `docs/development/current-stage.md:55`：v1 冻结且刻意极窄——**逐字相等**；ingress 不是 Judgement `:47`），行动侧也有（`principles.md` §8、不变量 7/8），**但没有任何条款裁决过「把它们串成一次闭环」**。
- 按 R4 四问（Q1 回答新问题 / Q2 在备选项之间做选择 / Q3 解释上游不封闭的词表 / Q4 决定人等都没给出的事），这很可能触发 **Q1 与 Q2** → 落 **L2**（一份 Boundary Review + 明确 verdict）。**本文件即那次 L2 评审。**
- 级别由 R5 决定：**当前设计预计不是 L3**——它不触及 R2 的 MUST（§5.0 已说明本实验是在**遵守** MUST），也不引入 `CLAUDE.md:162` 那组架构级判据（Runtime public API / 新通信平面 / 跨 Runtime / 新全局状态中心 / 难撤回的 public contract）。
- **但这不能预先保证后续实现都只需 L2**（Human 2026-10-15 审阅意见，逐字采纳）。R5 的规则是「**级别由 R2 中该改动触及的最高类别决定——不由 diff 大小决定**」，所以**每个里程碑按它自己的设计重新判级**；最需要重判的是里程碑 3——它第一次引入真实副作用，若它的设计需要新的公共契约或新的状态中心，级别就跟着升。

### 5.5 明确不做（照抄既有纪律，防止实验顺手扩权）

- **不做**「它自己决定要不要动」；**不做**任何**没有人的句子**的动作；**不把**执行者的自述记成已核实事实（`authorized-repository-action-v0-boundary-review.md:170-177`）。
- **不新增模型侧的写工具。** 侦察实测：模型侧 6 个工具 **6/6 全是读**（`src/language/exposure.ts` 与各 owner 的 `exposure.ts`），无 side-effect 字段。第 3 步的触发权今天只在人手里——**这正是代码自己说的那句话**（`src/cli/change-command.ts:15-18` 逐字）：

  > **It is also not the half that changes anything.** Naming a directory as changeable authorizes nothing on its own: the check that reads this set belongs to the action slice, and until that exists the only thing this command can do is record what a human said. That is deliberate rather than unfinished — the authorization is the part that has to be true before anything acts on it.

  同一件事在 `src/changeable-repositories/read.ts:66-69` 被点名，并指名它被哪份评审挡住：

  > What this file deliberately does not decide: whether the caller was entitled to the read (`§5`'s fifth question), **whether a change to what was read would be allowed (the Action half, which the composition boundary review left `BLOCKED`)**, and whether the directory is a repository at all.

  **这两处是本实验第 3 步存在的理由，也是 §5.1 ① 要解除的那一条。**
- **不做**自动重试 / 自动修复 / 自动回滚；**不做**多执行者抽象；**不做**跨设备（同上 `:173-174`）。
- **不做**（2）「模型套用人写的授权规则」与（3）「模型自己写授权规则」——`authorized-repository-action-v0-boundary-review.md:200-221` 逐字记着：(2) 是**下一片的方向**、(3) **需要新前提**；两者「都不得由本片或后续实现顺手默认掉」。
- **不**为给 Chronicle 找 reader 而创造需求；**不做**任何 0→1 的 Memory 抽象（`memory-reactivation-v0-boundary-review.md:394-407`）。
- **不创建 P4-04、不开始 Salience research**（`docs/development/current-stage.md:2179-2187`）。
- **不替 Phase 4 发明完成条件**（`docs/development/current-stage.md:2177`）。
- **不建立任何跨域认知路由器**（`docs/architecture/hikari-nervous-system-stage-v0.md:208` 逐字：「**跨域关联 / 中央重要性排序。** 不建立任何跨域认知路由器。」）。**这条直接约束里程碑 2**：那个「要不要动」的 owner 必须是**领域内的**、职责写得出来的 consumer，不能是一个中央排序器——否则实验会在第 3 步顺手造出被明令禁止的结构。
- **新声明不得把 `source` 写成 `{ kind: 'human' }`**（`docs/architecture/hikari-nervous-system-stage-v0.md:214-217` 逐字：「`source` 只声称可证明的部分。`{ kind: 'human' }` **被禁止**——入口没有任何身份认证，这条管道上任何本机进程都能写入，写成 `human` 是在断言一个无法证明的事实。」）。既有样板是 owner 自己的 kind（`src/changeable-repositories/facts.ts:66`）。

### 5.6 一处需要标注层级含糊的地方

`authorized-repository-action-v0-boundary-review.md:235-243` 的「**不变量 4：低信任来源不得自我升权**」自称不变量，但按 R2 规则 3（**MUST 只能来自 R1 的前两层** `principles.md` / `core-architecture-v0.md`），它**最高只能是 SHOULD**——侦察未找到它被吸收进前两层的记录。本实验仍会遵守它（它与不变量 8 同向，且三条都可测），但**引用时按 SHOULD 引，不按 MUST 引**。

### 5.7 级别与流程（本次实验走哪一档）

| 项 | 归类 | 级别 | 动作 |
| --- | --- | --- | --- |
| 人显式声明一条绑定（里程碑 1） | NOT-YET（关联规则仍冻结为逐字相等；声明不新增推断） | **L2** | 一份评审（本文件）+ 明确 verdict |
| 补上播报之后那一步（里程碑 2） | SHOULD / 新 consumer | **L2** | 同上；owner 必须写得出来（§4 第 3 条） |
| 执行者第一片（里程碑 3） | 第一次**使用** MUST 所要求的 Action 边界 | **L2（动笔前按 R5 重判）** | 定义 + 实现 + 功能评审 + 架构评审 |
| 阶段纳入（5.1 ①） | 阶段裁决 | — | **Human 的一句话**（已答：支持纳入有界实验） |
| 补双向指针（5.3） | 文档纪律（R7） | — | 本片顺手做 |

**VERDICT = NARROW 的作用域**：它同意的是**这次有界实验**，不是三个里程碑一起放行——里程碑 1 在它自己的设计边界被确认后实现；里程碑 2、3 各自在**确认 owner、契约、权限与执行证据**之后再动。

按 `docs/development/current-stage.md:2191-2207` 的四段式执行：**Boundary Review → 实现+测试 → Architecture Review → 文档/契约更新**；并且照那条纪律——「如果真实实现暴露当前边界不成立，**不允许用隐藏依赖或临时特例绕过，应暂停实现并重新审查架构**」。

## §7 落地顺序

0. **§5.1 两问已由 Human 回答**（2026-10-15 审阅意见）：① 支持把第一条执行路径纳入本阶段的有界实验；② (iii) 裁决**仍然有效**。**但里程碑 3 的实际写入、commit、push 仍需逐轮单独授权。**
1. **先把里程碑 1 的设计边界确认下来**（谁的声明、哪个 owner、什么契约、`unknown` 怎么变成有依据的判断、失败时长什么样）→ 确认后实现 → 重跑 §3 第 1 条判据。
2. **里程碑 2**：补上被留空的那一步 → §3 第 2 条判据（不是被 `ask` 触发）；**动笔前先确认 owner**（§4 第 3 条）。
3. **里程碑 3**：执行者的第一片，按 §5.1 ② 已裁决的形状（原句即 mandate；证据栏含 push 之后的 CI run 号）→ §3 第 3、4 条判据；**动笔前按 R5 重判级别，并重新检查授权范围与仓库的当前状态**（§2.4）。
4. **对照实验**：在**克隆的数据副本**里移除第 3 步那条事实（生产 Chronicle 只追加、不删除），其余输入不变，看行为是否退回第一次的形态 → §3 第 5 条判据；**并排除「普通去重」解释**。
5. **重跑**：§1.3 的五问 + §6 四条反假判据。
6. **结论**：闭环成立 → 第二个场景（时间，§0 第 5 条）；或按 §4 回头正式审查原则。

**本片到此不写代码。** Human 已于 2026-10-15 给出审阅意见，本版按意见小修（VERDICT = NARROW、第 5 条排除普通去重、跨 owner 读取保留为架构考题、两处过期事实更正、里程碑 1 与 3 分开、L3 触发条件补全、补双向指针）。下一步是**确认里程碑 1 的设计边界**（§8）——确认之后再动代码。

## §8 里程碑 1 的设计边界（Human 已确认 2026-10-15；已实现，落地记录见 §8.8）

> VERDICT = NARROW 允许「里程碑 1 在确认具体设计边界后实现」。这一节就是那份设计边界。**它只提一个方案 + 两个被否掉的备选**，因为它的目标是**最小、可逆、不新增结构**。

### 8.1 一句话

**那条没人声明过的绑定，其实已经被声明过——只是从来没有被这个判断读到。** 人启动常驻时写的 `--repository-root <本机路径>` 与 `--repository <owner/name>` 是**成对出现**的（`src/cli/options.ts:1102-1115` 的 `readRepositoryCiPairing`：缺一个就是用法错误；写进 `launch.json`，见 `src/cli/launch-profile.ts:166`、`:205`），**它们就是人自己的身份声明**。今天这两半被喂给了两个不同的插件（`src/cli/resident.ts:456` → `git-repository` 拿本机路径；`:460` → `github-ci` 拿 GitHub 名），**而没有任何消费者把「这两半指同一个仓库」这件事读进去**——`repository-ci-relevance` 的配置里只有管道目录（`plugin.ts:39-41` 的 `{ rootDir }`）。

### 8.2 要改的是什么（四处，全部在既有 owner 内部）

1. **`src/cli/resident.ts`**：把已经算好的那个配对（`:456`/`:460` 用的是同一个 `repositoryCi`）多传一份给 relevance 插件。
2. **`src/repository-ci-relevance/plugin.ts`**：配置从 `{ rootDir }` 变成 `{ rootDir, localRoot, githubRepository }`；`judge()` 多取一个输入，仍是一次判断、两条入口共用（`:76-87` 那条「同一个 `judge`」的结构不动）。
3. **`src/repository-ci-relevance/judgement.ts`**：`judgeRelevance(designations, snapshot, declared)` 多**一条规则**——当**某条 designation 与 `declared.localRoot` 逐字相等**、**且 `observation.repository` 与 `declared.githubRepository` 逐字相等**时，判 `relevant`，并在结果里标明**依据是哪一条**（`via: 'declaration'` 与既有的 `via: 'verbatim'`）。今天 `types.ts` 里的判断形状只有 `verdict` + `designation`（`judgement.ts:63`），这个 `via` 字段是它唯一的形状变化。
4. **`renderJudgement`**：`relevant` 多一种理由行，把**人写下的那句对应关系**原样说出来（例：「人声明的配对：`G:\work\LAB\code\hikari-new` ↔ `t1mb2rg/hikari-new`（工作焦点指名了前者，CI 观察报告了后者）」）。

### 8.3 为什么这不是「加了一条推断」（这一节是这次设计的全部要害）

`judgement.ts:53-57` 拒绝的八件事（trimming / case folding / basename / 拆 owner 与 name / 改写 URL / fork 检测 / 别名表 / 问模型）都有一个共同点：**它们是这一层在断言两个不同字符串指同一个仓库**。这次新增的规则**不做那个断言**——两条比较仍然**逐字**，唯一的桥是**人自己写下的那条对应关系**，这一层只是**引用它**。

用那八条自己的标准检验：新规则里没有一条相似性、没有一条改写、没有一次问模型；**如果人没写过这条配对，判断还是 `unknown`**（8.5 第 1 条）。

同时它保住这个插件自己的章程（`plugin.ts:24-27` 逐字）：没有 watcher、没有循环、没有缓存、不写任何东西——**配对是输入，不是记忆**；两次相隔一秒的调用仍然是两次独立判断（配对的来源是启动配置，不是上一次的答案）。

### 8.4 它证明什么、不证明什么（诚实标注）

- **证明**：一次跨两个名字空间的相遇，可以**只靠人显式声明的对应关系**完成，不需要任何推断，也不需要新中心——这正是 §3 第 1 条要测的东西。
- **不证明**：不证明「跨 owner 的持久事实会被读回并改变行为」（那是里程碑 3/5，§3 第 4、5 条）；**也不解决 §2.4 那个跨 owner 读取问题**——本方案**不新建任何事实**，所以它天然不碰那道题（这也是选它的理由之一：先证明最小的一步，再让真正的架构考题留在它该在的里程碑）。
- **不改变**「`relevant` 是唯一能有依据的肯定判断」这个形态：`unknown` 仍然是一个完成的判断，不是缺失。

### 8.5 失败与边界（都必须有测试）

| 情形 | 结果 |
| --- | --- |
| 没配置配对（常驻没带那两个参数） | **`unknown`**（与今天一致；配对缺失就是「没人声明过」） |
| 配对在，但工作焦点的任何一条都不等于 `localRoot` | **`unknown`** |
| 工作焦点等于 `localRoot`，但 CI 观察报告的仓库不是声明的那个（例如 fork） | **`unknown`**（这正是「不是靠相似性」的证据） |
| 工作焦点逐字等于 GitHub 名（老规则） | 仍然 **`relevant`**（`via: 'verbatim'`，行为不变） |

一处**待你顺手定的小决定**：`unknown` 的文案今天是一句话，且刻意在三种成因下都为真（`judgement.ts:69-74` 写了理由）。加了配对之后「没人声明过配对」是第四种成因——**我倾向不改 `unknown` 文案**（保持一句话、不为某一种成因单独说话），`relevant` 那边才说明依据。你若希望 `unknown` 也说清是哪种，我再改。

### 8.6 验证方式（确认后照此做）

- 单测：`test/repository-ci-relevance.test.mjs` 增四条（对应 8.5 的四行），并保留既有的「Service 与 endpoint 给出同一个判断」的钉法（`plugin.ts:18-22`）。
- 真机：`hikari relevance`（`src/cli/relevance.ts`）在有 / 无配对两种启动下各跑一次，正反两面都留输出；`npm test` 全绿 + `npm run build` + CI。
- 可逆性：**把两个参数从启动命令里去掉，判断就退回 `unknown`**——一行配置，不需要回滚代码。

### 8.7 两个备选（记录下来，先不做）

- **(A) 新建一个持有身份绑定的插件 + 一条持久事实**：只有当绑定必须**跨重启、跨不同启动参数**存在时才值得。里程碑 3 如果真需要「上次那个仓库是哪个」的持久依据，再按 R5 重开一次设计——**本次不预先建**。
- **(B) 扩展 `hikari change declare` 带上 GitHub 名**：会把「哪些目录可以改」（授权）与「这个目录是哪个 GitHub 仓库」（身份）合成一个主语，并让 CI 相关性判断依赖可改仓库那份授权。语义上更重，收益不明显——**先不做**。

### 8.8 落地（2026-10-15 深夜，Human 确认之后）

**已实现。四处改动，全部在既有 owner 内部**：`src/repository-ci-relevance/types.ts`（新增 `DeclaredRepositoryPairing`，judgement 的 `relevant` 臂多一个 `via` 判别）、`src/repository-ci-relevance/judgement.ts`（第二条逐字相等的规则 + 两行渲染）、`src/repository-ci-relevance/plugin.ts`（启动配置多一个可选的 `declared`）、`src/cli/resident.ts`（把既有的 `--repository-root` 与 `--repository` 作为配对传给插件）。**没有**新插件、**没有**新契约、**没有**新存储、**没有**模型侧新工具、**没有**碰控制通道协议。

**测试**：`test/repository-ci-relevance.test.mjs` 现有 **32 条**全绿，其中九条是本次新增（真值表六行 + 端到端三条：配对命中并逐字说出两半、配对在但两半都对不上时仍是那一句 `unknown`、配对是启动配置而不是记忆）。真值表新增的两行值得单独点名——「没有配对时本机路径不算命中（v1 行为不变）」与「配对里 GitHub 名对上了、本机根不同，仍然不算命中（两半都要对）」。`test/language.test.mjs` 的两处 judgement fixture 按类型补齐 `via`，135/135。全库 `npm test`：**937 tests / 933 pass / 0 fail / 4 skipped**。

**真机（真实常驻、真实命名管道、真实 GitHub 观测；18 个插件全 `active`）**：

```text
$ hikari relevance repository-ci status
Repository CI relevance：relevant
人声明的配对：G:\work\LAB\code\hikari-new ↔ t1mb2rg/hikari-new（工作焦点指名了前者，CI 观察报告了后者）

$ hikari focus clear && hikari relevance repository-ci status
Repository CI relevance：unknown
未能在当前工作焦点与 Repository CI observation 之间建立逐字相等关系。
```

**`unknown` 的文案未改**（Human 的决定）：第四种成因不为它单独措辞，`relevant` 那边才说明依据——`judgement.ts` 里那句「一句话、在四种成因下都为真」的注释现在覆盖四种，文字一个字没动。

**它证明什么**：一条只存在于人手写的启动参数里的对应关系，可以让两个此前无法相遇的事实（本机路径、GitHub `owner/name`）产生一次有依据的 `relevant`——而整条链上没有任何一处做过推断，两半的相等都是逐字的，对应关系是人说的。

**它不证明什么**（照 §8.4 的标准）：不证明身份问题解决了——配对跨重启不保留、换启动参数即消失（要持久绑定得走 §8.7 的备选 A，按 R5 重开设计）；不证明判断重要——`relevant ≠ salient` 原样成立，这一层仍然无权问「要不要紧」；不证明有任何行动发生——里程碑 2 / 3 未开始。可逆性照 §8.6：把两个参数从启动命令里去掉，判断退回 `unknown`，不需要回滚代码。
