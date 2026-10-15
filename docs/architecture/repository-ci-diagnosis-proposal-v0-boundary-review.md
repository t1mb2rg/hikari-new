# 仓库 CI 诊断建议 v0 —— 边界评审（里程碑 2）

> 这份文件回答一个问题：**能不能在不造第二条链的前提下，给 Hikari 加一个「对这一次已确认相关的 CI 失败，我有没有依据提出一次具体的复查建议」的领域判断？**
>
> 它是 Cognition–Action Loop v0 实验的**里程碑 2** 的 L2 评审。上一份是 `cognition-action-loop-v0-boundary-review.md`（里程碑 1 的设计与验收），本文件不重复它的内容。
>
> 级别判定依据 `governance-rules-v1.md` R5；冻结语义与权威层级依据同一份 R1/R2。

## §0 结论

**VERDICT = NARROW（L2）** —— 批准一个**只有一条链**的领域判断能力：它**被既有的播报者询问**，回答「对这一次失败，我有没有一句有依据的复查建议」；**播报、去重、投递、回执仍然只有一份**，都在 `repository-ci-attention` 手里。

- **依赖方向与上一版草稿相反**：不是新建一个自己轮询、自己去重、自己投递、自己写回执的主动插件；而是新 owner **提供一条契约**，由**已经存在的唯一主动线**在说话之前问它一句。
- **新 owner 从第一天就有真实消费者**（attention 自己），所以这条契约不是预先建好的接口。
- **零配置**：策略写在代码里，没有任何用户可声明的规则语言。
- **2a 先实现**（规则驱动的建议与投递），**2b(i) 只保留需求、不预建接口**，**2b(ii) 未验证并明确保留**。
- **两项在实现前必须关闭的 finding 均已关闭**：Finding 1（职责与投递关系）见 §2；Finding 2（判断必须来自同一组事实）见 §3.2 与 §4 的 ②。

**为什么是 L2**：新 owner + 新契约 + 一条新的表达契约 + 消费既有出站（R5 的 L2 判据）。

**不触及任何 MUST**：

- `core-architecture-v0.md` §12 不变量 11（不存在中央判断器或超级协调器）禁的是**中央**判断；本 owner 只有**一条链**（一个仓库、一种失败、一类建议），它不是任何领域的路由器，也不为别的领域提供排序。
- 不变量 8（真实副作用必须经过 Action 边界）管的是**改变外部世界**；本片**只说，不做**——唯一的对外动作是经由既有的 `human-delivery` 说一句话，与今天第一条主动线走的是同一条出站边界。
- 「Salience 不在本阶段」是**阶段性裁决**，按 R2 属 NOT-YET 一侧；真实需求出现即解除条件，本次的解除由 Human 的阶段裁决完成（§1.1）。

## §1 证据

### 1.1 Human 的阶段裁决（2026-10-15）

> 同意将有界的领域重要性判断纳入 Cognition–Action Loop v0 实验范围。这次开放仅针对已明确关联的 Repository CI 场景，不批准通用 Salience、中央 Judgement 或跨领域统一排序。里程碑 2 采用 2a / 2b 双路径：2a 先验证规则驱动的建议与投递；2b 保留为独立的认知验收目标，可以先使用当前具名事实形成可追溯推论，涉及过去行动结果的连续性留待真实回执产生后验证。2a 通过不等于认知实验通过。任何判断都不得自行扩张执行权限。具体 owner、契约和出站边界按 R4/R5 进行 L2 评审，必要时重新判级。

### 1.2 既有链的逐字形状（本文件写作时逐条核过）

`src/repository-ci-attention/plugin.ts`：

- `:1` ——「The one plugin in this repository that speaks without being asked.」
- `:92` —— `requires: [gitHubCiService, languageSpeakingService, humanDeliveryService, chronicleService],`
- `:169` —— `const observation = await ci.current();`
- `:176` —— `const occurrence = detectNewFailure(observation, handledFailures, deliveredFailures);`
- `:203` —— `const outcome = await delivery.deliver(speaking.speak(occurrence));`
- `:209-215` —— 只有 `outcome.outcome === 'delivered'` 才 `await chronicle.append(deliveryFactDraft(occurrence));`，事实 kind `repository-ci-attention.delivered`
- `:232` —— `scheduleCycle(config.delayMs)`：它是唯一按节奏看的人。

`src/repository-ci-attention/judgement.ts`：

- `:10-12` ——「Neither of them is allowed to ask whether the failure *matters*: `relevant ≠ salient`, and the moment this file grew a notion of importance it would have become the generic attention framework the ruling forbids.」
- `:84-88` —— `detectNewFailure(observation: GitHubCiObservation, handledFailures, deliveredFailures)`
- `:89`、`:97`、`:108` —— 它从观测里取的只有三处：`observation.latestRun`、`observation.repository`、`observation.observedAt`。
- `:52-55` —— `deliveredFailures` 的强度：「an entry here means the bytes were written, not merely that a delivery was attempted.」

### 1.3 观测面：为什么「两次读恰好一致」不能算证据

- `src/github-ci/plugin.ts:39` —— `current: async () => toObservation(await acquirer.acquire())`：**每次调用都是一次新的获取**，没有游标、没有基线，也不消耗任何东西。
- `src/repository-ci-awareness/plugin.ts:52-60` —— 每次 `current()` 都 `await world.current()` 重新组装，再 `compareCommits(snapshot)`。
- 同一文件 `:45-48` ——「Two calls in a row are two independent judgements, not two steps of a sequence.」

把这两条放在一起就是 Finding 2 的根：**两次独立获取可以看见不同的 run**。所以「只读一次」不是优化，是**判断可追溯的前提**。

### 1.4 表达面：第三条契约不是零成本复用

- `src/language/contracts.ts:67-74` —— `LanguageSpeakingService { speak(occurrence: RepositoryCiAttentionOccurrence): readonly string[] }`，契约名 `language.speaking@1`。
- `src/language/plugin.ts:386` —— `context.services.provide(languageSpeakingService, { speak: renderSpokenOccurrence });`
- `src/language/contracts.ts:11-26` 逐字记着为什么是**两条**而不是一条带两个方法的契约、也不是一个联合类型：一条带 `speakRepositoryCi` 与 `speakDesktopReturn` 的 Service 会让 `requires: [languageSpeakingService]` 一次授予两个 owner 的说话权；而两个 occurrence 都没有判别字段，联合类型只能靠结构猜。`:22-23` 还记着由此产生的命名不对称（`language.speaking@1` 其实就是 Repository CI 那条）是**记录在案而不是修掉**的。

结论：诊断建议**不能塞进 `language.speaking@1`**（它的参数是 occurrence，只有事实、没有建议的位置），正确的形状是**第三条有界 speaking 契约**，与既有两条同形：参数是新 owner 的**事实类型**（不是字符串、不是 lines），渲染器在 Language 一侧。

## §2 设计：依赖方向反转

### 2.1 三方角色

| 角色 | 今天 | 本片之后 |
| --- | --- | --- |
| `repository-ci-attention` | 唯一周期驱动者；拥有失败识别、按 run 去重（`handledFailures` + `deliveredFailures`）、表达、投递、回执、重启读回回执 | **不变**——它只是**在说话之前多问一句**；它仍然是唯一说话的人 |
| 新的领域判断能力 | 不存在 | **被询问的一方**：拿到一份证据，回答「有没有依据提出一次具体的复查建议」，或「依据不足」 |
| `repository-ci-relevance` | 拥有身份相关性判断 | **判断本身不变**；新增一条「判这一份观测」的契约形式（§3.2） |

「没有第二套轮询、没有第二份去重历史、没有第二个投递者」——这是本片最重要的结构结论，也是 Finding 1 的答案。

### 2.2 一个周期的数据流

```text
attention: assessment = await awareness.current()     ← 本周期唯一的观测
attention: occurrence  = detectNewFailure(assessment…)
attention: relevance   = await relevanceJudge(assessment.snapshot)   ← 判「这一份」
attention: proposal    = await proposal.propose({ occurrence, assessment, relevance })
attention: lines       = proposal 有依据
                            ? speaking2.speak(proposal)      ← 说建议那一条
                            : speaking.speak(occurrence)     ← 照旧说普通失败
attention: await delivery.deliver(lines)              ← 一次投递
attention: 只有 delivered 才写既有的 delivered 回执     ← 没有新事实族
```

### 2.3 新 owner 的契约

| 项 | 值 |
| --- | --- |
| 插件 id（建议） | `repository-ci-diagnosis-proposal` |
| 它 own 的问题 | 「对**这一次已经确认相关**的 CI 失败，我有没有依据提出**一次具体的**复查建议？」 |
| `requires` | 无（它的输入全部由调用方传进来：occurrence + assessment + relevance 判定） |
| `provides` | **一条真实契约**（被 attention 询问），与 attention 今天的 `provides: []` 不同——它不是唯一说话的人，它是被问的人 |
| 配置 | **零配置**。策略写在代码里；没有任何用户可声明的规则语言 |
| 它不 own | CI 是什么、relevance 怎么算、commit 怎么比、什么时候看、说没说过、话怎么说、人有没有看到 |
| 它不持有 | 没有轮询、没有定时器、没有去重集合、没有自己的历史、没有投递 |

它的判断是**纯函数**并导出（照 `judgeRelevance` / `renderJudgement` 的先例），所以 CI 不需要命名管道就能钉住规则。

### 2.4 建议的内容必须随领域事实变化

第一版取 `commitComparison`（`repository-ci-awareness` 已有的事实）：

| 当前事实 | 可以提出的建议 | 不能断言 |
| --- | --- | --- |
| `different` | 建议先核对本地 HEAD 与该次运行对应的提交，避免针对错误的代码版本排查 | 不能说提交差异就是失败原因 |
| `same` | 可以建议检查该次运行的具体失败步骤，**并说明当前没有读取日志** | 不能说已经找到了失败步骤 |
| `indeterminate` | 保留不确定性：两个来源之一没有被观察到，无法比较 | 不能当作 `same` 或 `different` |

三种情况输出同一句话 = 这一片失败（那是通知模板，不是领域判断）。这一条写进验收（§4 ③）。

### 2.5 表达

- 新 owner 返回**结构化结果**，例如 `{ kind: 'check-commit-alignment' | 'inspect-run-steps' | 'insufficient-evidence', … }`，**不拼自然语言**。
- Language 新增**第三条有界 speaking 契约**，参数是这个结构（`insufficient-evidence` 不进这条契约：依据不足时根本不说话，见 §2.6）。
- **不引入通用 `speak(string)`**；也不把建议塞进 `RepositoryCiAttentionOccurrence`（那会让一个 occurrence 同时携带两个 owner 的事实）。
- 表达必须**准确保留建议的推论性质**：它是「建议看哪里」，不是「问题是什么」。

### 2.6 投递行为表（Finding 1 的落地）

| 判断结果 | 行为 |
| --- | --- |
| 有明确诊断建议 | 投递**包含建议的一条**消息 |
| 没有充分诊断依据 | **保留原有的普通 CI 失败通知**（不是沉默） |
| CI 失败事实本身无法成立 | 不投递 |
| 同一个 run 已完成投递 | 按既有机制去重 |

原则句：**领域判断控制的是「有没有资格提出具体诊断」，不是「有没有资格报告已经发生的事实」。**

### 2.7 2b 的位置

- **2b(i)（当前事实推论）**：本轮**只保留需求**，不预建接口。文档写下它需要什么（一个可读的判断出口 + 带依据的判断记录），等真实消费者出现再建契约。
- **2b(ii)（基于过去经历调整判断）**：**未验证**。它缺的材料是：跨 owner 读回历史、语言回合的留痕、里程碑 3 的真实回执。本轮不假装它有。

## §3 实现前必须关闭的三个答案

### 3.1 Attention 如何取得唯一 assessment

- `requires` 里的 `gitHubCiService` **换成** `repositoryCiAwarenessService`（其余三项不动）。本文件写作时核过：`gitHubCiService` 在这个包里只有两处——`plugin.ts:96` 取服务、`:169` 调 `current()`——换掉是完整的。
- 一个周期里恰好一次 `const assessment = await awareness.current();`，这一份就是**本周期唯一的观测**：要播报的失败 run、`commitComparison`、以及 relevance 要判的那份 snapshot，全部取自它。
- 失败信息从 assessment 的 `githubCi` facet 取，字段仍是那三处（`latestRun` / `repository` / `observedAt`），所以 `detectNewFailure` 的**判定形状不动**，只有它的第一个参数类型变了。
- **组合影响**：`repository-ci-awareness` 与 `repository-ci-world` 已经在显式组合里（它们今天就是 relevance 的上游），所以这是给 attention 加一条 `requires`，不新增插件、不新增轮询。
- **硬规则**：一个诊断周期里 `awareness.current()` 只调用一次；出现第二次获取即测试失败（§4 ②）。

### 3.2 Relevance 如何针对同一份 snapshot 判断

- `repository-ci-relevance.current@1` 今天只有一个操作：`current(): Promise<RepositoryCiRelevanceJudgement>`（`src/repository-ci-relevance/contracts.ts:44`），它自己拉 focus 与 awareness。
- 新增**第二条契约**（例如 `repository-ci-relevance.judge@1`），语义是「判这一份观测」：它接受调用方给的那份 snapshot，**不再自己获取**。
- **身份相关性仍由 Relevance 判断**：`judgeRelevance` 是这个 owner 的纯函数，新 owner **不得重新实现**它，只是消费它的结论。
- **焦点也要固定**：工作焦点可以在运行时改变，所以这一条里必须带上**本次实际使用的 designation**——`RepositoryCiRelevanceJudgement` 的 relevant 支路已经携带 `designation`（verbatim 与 declaration 两条都带），不需要新字段。
- `current()` 的语义与既有消费者**一个字都不改**。

### 3.3 依据不足时普通通知是否继续投递

- 按 §2.6 的四行表执行：**依据不足 → 照旧投递普通的 CI 失败通知**。
- 依据不足必须**可观察**，且必须能区分于「插件没启动 / 读取失败 / 抛异常」：判断是纯函数并导出，测试直接断言 `{ kind: 'insufficient-evidence', missing: … }`。

## §4 验收（Human 锁定：只有这四项）

| # | 验证对象 | 完成条件 | 怎么观察（正面） | 什么情况算失败（反面） |
| --- | --- | --- | --- | --- |
| ① | Attention 输入变化 | 原有主动通知行为保持可用 | **既有测试一字不改仍全绿**；依据不足时照旧收到普通 CI 失败通知；真机起常驻能看到它照旧说话 | 为了让新代码通过而修改了 attention 既有测试的期望 |
| ② | 单次证据获取 | 同周期只取得一份 assessment，Relevance 不再次采集 | 计数用的假 awareness：一个诊断周期 `current()` **恰好 1 次**；让假 awareness **每次返回不同的 run**（#123 → #124），断言建议的 run、`commitComparison`、relevance 判定的 facet **三者同一个** | 出现第二次获取；或三者靠「两次读恰好一致」对上 |
| ③ | Diagnosis 领域语义 | 三种 `commitComparison` 产生**不同且有依据**的复查建议 | `different` → 先核对本地 HEAD 与该 run 的提交；`same` → 检查该次运行的具体失败步骤（并说明没有读日志）；`indeterminate` → 保留不确定性。每种都带它依据的具名事实 | **三种情况输出同一句话** → 失败（防通知模板冒充领域判断） |
| ④ | Language 与回执 | 有界结构化表达，仍只有一次投递和既有回执 | 表达入口只接受**结构化的领域结果**；一次 run 的投递计数**恰好 1**；回执仍是既有的 `repository-ci-attention.delivered`，**没有新事实族** | 出现第二个投递者／两条消息；出现通用 `speak(string)`；出现新的事实 kind |

每次真机动作都要留输出：起一次真实常驻、造一次真实失败、数消息条数。

## §5 代价与本里程碑没有交付什么

- **同一个 run 只有一次主动表达机会**：复用既有的 `delivered` 历史意味着，如果第一次因为依据不足发了普通通知，之后即便有了更好的依据也不会再补一条诊断建议。2a 接受这个限制，并把它**记为明确的能力边界**。
- **既有投递事实只证明「某个 run 的消息已经写出」**，不能证明系统保存了当时的诊断建议及其依据。所以 **2a 不具备跨历史认知连续性的证据**。
- **2b(ii) 未验证**：涉及「过去真正改变后续行为」的部分不在本轮。
- **表达契约确实要动**（第三条 speaking 契约）。这不是零成本复用，但它是**有界的**：不是 `speak(string)`，不是通用表达框架。
- **2a 通过 ≠ 认知实验通过**。本里程碑不宣布「Hikari 已经会自己判断重要性」。

## §6 修改路径与级别

- 按 R5：新 owner + 新契约 + 新表达契约 + 消费既有出站 → **L2**（本文档即那次评审）。
- 不触及 R2 的 MUST，因此不走 L3，也不修改 `principles.md` / `core-architecture-v0.md`。
- R7.2 双向指针：本文件 ↔ `docs/development/current-stage.md` 的「认知—行动闭环 v0」块里那条 **「里程碑 2 的 L2 评审已落盘」** 的口径更新；上一份评审（`cognition-action-loop-v0-boundary-review.md` §8）是本文件的前置。
- 若在实现中发现必须复制整条轮询/表达/投递/历史链才能形成一句有依据的建议，**那不是「再加一个插件也没关系」**——按 Human 的原话，那是协作成本第一次在真实工程里露出形状，本文件把它记为**架构失败判据**。

## §7 落地顺序

0. 本评审落盘 + 双向指针 + 提交/推送/CI（**先评审，后代码**）。
1. attention 输入边界：`requires` 换 awareness、一次 `current()`、失败信息取自 assessment；既有测试一字不改仍全绿。
2. relevance 第二条契约：判给定 snapshot；测试钉住「不再自己获取」。
3. 新 owner：纯函数 + 契约 + 零配置；三种 `commitComparison` 的规则测试；`insufficient-evidence` 可观察。
4. Language 第三条 speaking 契约 + 渲染；投递计数恰好 1 的测试。
5. 真机一次：真实常驻、真实失败、数消息（恰好一条）。
6. 记录：`current-stage.md` + 本文件；**不得宣布认知已验证**。

## §8 明确不做

- 不建通用 Salience、不做中央 Judgement、不做跨领域统一排序。
- 不复制第二条轮询、第二份去重历史、第二个投递者、第二个回执事实族。
- 不引入通用 `speak(string)`，不让新 owner 拼最终自然语言。
- 不新增事实 kind；不给 2b(i) 预建没有消费者的接口。
- 不让判断自动扩张执行权限（本片只说，不做）。
- 不修改任何冻结文档；不为让实验好看而绕过通道。
