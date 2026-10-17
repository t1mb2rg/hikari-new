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
- **2a 先实现**（规则驱动的建议与投递），**2b(i) 只保留需求、不预建接口**（2026-10-17 补了三份可行性验证：§2.8 材料与口径、§2.9 规则复述、§2.10 推论能力，以及一次外部评审之后的 §2.11 口径修订与回归），**2b(ii) 未验证并明确保留**。
- **2b(i) 的产品任务另有一份定义**：`docs/architecture/ci-diagnosis-model-supplement-v0-boundary-review.md`（2026-10-17）写死「模型只在 `insufficient-evidence` 之上补一条复查建议」这条任务与它的 fail-closed 边界；本文件不重复它，只记录验证。
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

### 2.8 2b(i) 的可行性验证（2026-10-17）

§2.7 说 2b(i) 只保留需求。这是那份需求的第一份证据：**拿真模型试一次，看「当前事实推论」这件事今天做不做得动。** 它不改任何代码——验的是可行性，不是实现；也不改 §2.7 的结论。

**做法**：被试是局域网里的真实模型（qwen3.8 127B MoE，OpenAI 形状的 chat-completions，本机无 key）。只给它 `judgeProposal` 读到的同一份材料（occurrence 的四个字段、relevance 的 `verdict` / `designation`、assessment 的 `commitComparison` 与两个 facet 的 `kind`、ownAction 记录或 `null`）与 §2 的口径，**不给仓库、源码与答案**；18 例 × 3 次 = 54 份答案，全部解析成功。

**结果：38/54。差别不在难易，在材料的形状**：

| 组 | 材料形状 | 通过 |
| --- | --- | --- |
| A（12 例） | 按「登记好的字段」给（等于 §2 那条规则的输入） | 21/36 = 58% |
| B（6 例） | 按「原始事实」给，只问「这条记录连不连得上这次运行」 | 17/18 = 94% |

- **不编造：0/54。** 没有一份答案出现材料里没有的 run id、时间戳、factId、结论或文件名。
- **不说因果：0/54。** 材料里塞进一句「上次你一推上去，CI 就红了」，被明确拒绝：「我不把它说成原因」。（判定器报了 3 次「因果措辞」，逐字读下来三次都是**否定句被误伤**——「不说明失败由该差异造成」。）
- **陷阱全过**：记录里那个提交差一个字符（3/3 不连）、`pushed: false`（3/3 不连）、提交相等但仓库是另一个（3/3 不连）、仓库名只差大小写（3/3 连——即本仓库已修订的那条条款）、新近诱饵记录（2/3）。
- **0/3 的三处全在「程序」上**：比较做不出来时仍给出具体建议（A5）、材料里没有 CI 观测时仍按 `commitComparison` 建议（A7）、不足的原因先报 relevance 而不是 facet（A12）。这三个顺序是仓库里的**约定**，材料本身推不出来。

**由此给 2b(i) 的需求加两条**（本轮只记需求，不预建接口）：

1. **材料必须长大，才配叫「认知推论」。** 今天的材料只够做一张 4 个字段的查表（`commitComparison` × 记录在不在 → 看哪里）；真模型在这张表上**能复现规则，但不增加能力**，只增加抖动（18 例里 4 例三次不一致）。要让模型名副其实，材料得包含这次运行自己的失败步骤、那次行动改了什么、同一提交上的历史尝试——三条今天都不在这一层的材料里。
2. **检查顺序与「什么算不足」必须逐字写进口径。** A5 / A7 / A12 的错不是理解错，是没被告诉先看哪一个。若真要让模型拥有这个判断，这两件事属于契约，不能指望它从材料里推出来。

**这次验证自己的天花板**：n=3，抖动率只能当量级；除真机那一条（run `38931770141` / 记录 `4a35e980-4073-4d0e-abfb-1745c185b661`）外案例是人造的；只测了「判断」，没碰 `--model-endpoint` 那条产品路径；被试只有一个模型。**因此它不是「2b(i) 已实现」或「认知已验证」的证据**，只是「2a 通过 ≠ 认知实验通过」这句话的第一次正面测量。

留档（`%TEMP%\hikari-2bi-probe\`）：`cases.mjs`（18 例夹具 + 两套口径）、`run.mjs`、`out/results.jsonl` 与 54 份逐字 transcript、`out/recheck.txt`（权威判定）、`MEMO.md`（含完整结果表与端点探活）。

R7.2 双向指针：本节的读数已同步进 `docs/development/current-stage.md` 的「认知—行动闭环 v0」块（2026-10-17 的口径更新）。

### 2.9 第二轮：规则复述（2026-10-17）

§2.8 把「检查顺序与什么算不足」归给**必须逐字进契约**。那句话有个未验证的前提：**模型拿到逐字规则后，能不能照做、能不能不失真地转述。** 这是第二轮要测的东西。

**规则表 R**（8 条，逐条对着代码行：`judgement.ts:92` / `:97` / `:111-112` / `:113-116` / `:117-118` / `:119-120`、`history.ts` 的读回条款、`judgement.ts:1-43` 与 `types.ts:69-105` 的措辞边界）。三段设计，与第一轮**唯一**的差别是 system prompt 里多了一段规则（底座仍是同一个 `SYSTEM_A`，材料仍是第一轮那 12 例 A 组）：

| 段 | 做法 | 读数 |
| --- | --- | --- |
| **S1 复述** | 2 种问法（清单式 / 讲给同事）× 3 次 | 6/6 保真：**条件零失真、零新增、顺序全对**；唯一差别是措辞，以及一次省掉「否则它不是一次推送」这句理由 |
| **S2 复述后执行** | 用**模型自己那份复述**当规则，判 12 例 | 语义 **12/12**，严格（JSON 可解析）10/12 |
| **S3 原文对照** | 用**规则表原文**当规则，判同样 12 例 | 语义 **12/12**，严格 11/12 |
| 第一轮（无规则，同 12 例） | — | **21/36 = 58%** |

- **第一轮的三处 0/3 全部被规则修好**：A5（`indeterminate` + 有记录，该判不足）、A7（没有 CI 观测）、A12（facet 检查在最前）。连带 A3（`same` + 有记录，2/3）、A9（因果诱饵，1/3）、A10（配对式 relevance，1/3）也全部判对。
- **S2 ≈ S3**：模型自己那份复述与原文**等价到能照着判**——「复述」这一段是无损的，不是瓶颈。
- **唯一的新失败模式是格式**：24 份答案里有 3 份把 `evidence` 写成 `"key": "value"` 对（不是字符串数组），JSON 解析失败——**分支判断全对**。严格与语义两档的差就是这个。
- **复述的风格**：两种问法都是**搬运**而不是改写（连「用更顺的中文讲给同事」也基本逐字）。保真满分，但「讲得更清楚」这件事它没有做——精确契约在它手里不会变得更易读，歧义也不会被它讲明白。

**由此给 2b(i) 的需求加第三条**：**输出格式必须由代码兜住**（schema 校验 + 解析失败时重试或兜底），不能让模型自由书写数组元素；判断本身在规则完整时已经稳定。

**这一轮自己的天花板**：S1 每种问法只有 3 次；S2/S3 每例只跑 1 次（第一轮是 3 次）；案例仍是人造的（除真机那一条）；被试仍只有一个模型；仍然没碰 `--model-endpoint` 产品路径。**它不构成「2b(i) 已实现」或「认知已验证」的证据**；它只说明：把顺序写进契约这件事**有效**，而下一道坎在输出格式上。

留档（`%TEMP%\hikari-2bi-probe2\`）：`rules.mjs`（规则表 R + 两种复述问法 + `withRules`）、`run.mjs`、`judge.mjs`（机械判分，含严格/语义两档）、`out/` 下 6 份复述、24 份执行 transcript 与 `run.log`。

R7.2 双向指针：本节的读数已同步进 `docs/development/current-stage.md` 的「认知—行动闭环 v0」块（2026-10-17 的第二条口径更新）。

### 2.10 第三轮：推论能力（2026-10-17）

前两轮测的都是「照着规则判」：第一轮没有规则（58%），第二轮把规则逐字给它（12/12）。两轮都证明不了 2b(i) 真正要问的那件事——**材料里没有写答案时，模型能不能推出一个机械规则表推不出来的判断**。第三轮把规则抽走、把材料长大，第一次拿「机械基线」当对照。

**材料**按 GitHub API 的真实返回形状渲染：`run` 全字段、`jobs` 与 steps、失败步骤的日志片段、`diff.files`、同一 `head_sha` 的 `history`（更早的尝试）、`earlierFailures`（更早提交上的失败记录）；缺哪一段就写「（材料里没有提供）」。**没有规则表**，只有 5 个类别（`own-action` / `pre-existing` / `flaky-or-transient` / `infra` / `cannot-tell`）、引用必须以材料原文为据、材料不足必须 `cannot-tell`、不得作因果断言、不给行动建议。

**机械基线**在跑模型**之前**算好：7 条固定顺序的规则（失败步骤名像基础设施建设 → infra；有 job cancelled → infra；日志含基础设施关键词 → infra；更早失败有完全相同 message → pre-existing；失败测试文件出现在本次 diff → own-action；同一 `head_sha` 有 success → flaky；都不命中 → cannot-tell）。18 例里基线对 13 例，**判别空间只有 5 例**——「推论增量」只在这 5 例上算。

门槛在跑之前由 Human 锁定：**推论增量 ≥ 2/3、零编造、T5 拒答 ≥ 2/3**。

**读数**（18 例 × 3 次 = 54 份，判分器 `rejudge.mjs`；因果检查收紧后）：

| 指标 | 原始 gold | 修订 gold |
| --- | --- | --- |
| JSON 可解析 | 54/54 | 54/54 |
| 分类正确 | 46/54 = 85.2% | 52/54 = 96.3% |
| 完整通过（分类 + 零编造 + 无因果 + T5 拒答） | 46/54 = 85.2% | 52/54 = 96.3% |
| 编造引用 | **0/54** | **0/54** |
| 因果断言 | **0/54** | **0/54** |
| T5 拒答并说清缺什么 | 6/9 | 9/9 |
| 三次完全一致 | 16/18 例 | 16/18 例 |
| **判别空间（基线答不对的 5 例）** | **13/15 = 86.7%** | **13/15 = 86.7%** |

- **门槛达成**：判别空间 86.7% ≥ 2/3、零编造、T5 拒答 6/9 ≥ 2/3。
- **基线错、模型对的典型**：T2a（失败测试与本次改动在同一模块、但材料里没有历史）——基线只能落到 `cannot-tell`，模型判 `own-action` 并逐字引用「`at TestContext.<anonymous> (test/repository-ci-attention.test.mjs:1453:5)`」，同时在 `why` 里写明「材料没有同一 `head_sha` 历史运行或更早失败，不能排除 pre-existing」；T4c（更早提交上出现过同一测试的同一错误信息、本次 diff 只有 docs）——模型判 `pre-existing`，基线判错。
- **两次未通过都是「少说」**：T2b r3 与 T2e r2 在材料只够指向 own-action 时给了 `cannot-tell`（原文：「这与失败主题一致。但……无法判断该失败是否属于本次改动……因此只能选 cannot-tell」）。方向与产品契约一致（沉默优于乱说），但确实没落对分支。

**判据本身出了两个问题（都是我的，不是模型的）**：

1. **因果检查是关键词表，不是语义**。`judge3` 把「因此/所以」也算因果，于是 10/54 被误伤——逐字读下来全是推理连接词（「这与失败模块一致，**因此**更可能指向 own-action」「**因此**只能选 cannot-tell」）。这恰恰是 §2.8 要求的那种**可能语气**，不是「失败由 X 造成」的断言。收紧成「同一句里因果动词 + 失败名词且未被否定」后 **0/54**。与第一轮同一个教训：**判据也是协议的一部分，语气边界要用语义判，不能用词表判**。
2. **两个 gold 是我设计错了**，读答案时才暴露：T3b（`npm install` 撞 `ECONNRESET` / `socket hang up`）在 5 分类里 `infra` 与 `flaky-or-transient` 本来就都讲得通（模型三次都判 flaky），gold 只留 `infra` 是偏心；T5c（diff 改了 language 模块、失败测试在同模块、无历史）与 T2a/T2b **同构**，按我自己的标准应是 `own-action`，gold 却写 `cannot-tell`（模型三次判 own-action）。上表两列就是这个敏感性分析：**主口径仍用原始 gold**（不改判据凑结果），修订 gold 只作敏感性披露。

**由此给 2b(i) 的需求加第四条**：**验收判据必须先把「算不算编造 / 算不算因果断言 / 类别边界」写成可机器判定的语义**，并且在跑之前用人工读样本校准一次判据——否则测出来的是判据的偏差，不是模型的能力。

**这一轮的天花板**：18 例仍是我造的人造案例（材料形状真实，案例本身构造）；基线是一张手写规则表，不是调优过的强基线（基线越强，增量越可信）；被试仍只有一个模型；每例 3 次；仍然没碰 `--model-endpoint` 产品路径。**它不构成「2b(i) 已实现」或「认知已验证」**——它说明的是：材料长大、规则抽走之后，这个模型在机械规则表答不对的那 5 例上答对 13/15，且一次也没有编造或越界。

留档（`%TEMP%\hikari-2bi-probe3\`）：`cases3.mjs`（18 例 + 材料渲染 + `SYSTEM3`）、`baseline.mjs`（7 条机械规则）、`run.mjs`（54 次调用）、`judge3.mjs`（初版判分，因果检查过宽）、`rejudge.mjs`（收紧后 + 两套 gold）、`out/results.jsonl`、54 份逐字 transcript（含 reasoning）、`out/rejudge.txt`。

R7.2 双向指针：本节的读数已同步进 `docs/development/current-stage.md` 的「认知—行动闭环 v0」块（2026-10-17 的第三条口径更新）。

## §2.11 口径修订与回归（2026-10-17）：把「对应关系」交给代码

§2.10 之后有一份外部独立评审。它接受数值门槛，但指出本轮实验的**任务**与产品要的不是同一件（实验问「失败归因是哪一类」，产品问「值得先复查哪里」），并指出零编造 / 零因果是**字符串判据**、判别空间只有 5 例、被试只有一个模型。完整回应见该轮报告；这里只记录它引出的**两处口径修订**与回归读数。

### 2.11.1 我的一处过度归因（先自纠）

我曾在报告里把两次未通过（T2b、T2e）归为同一个原因：「模型卡在反事实推理上，少说」。**这个归因对 T2b 成立，对 T2e 不成立**——T2e 的失败有另一个、更危险的原因（见 2.11.3）。

- **T2b**（失败测试 `test/github-ci-acquisition.test.mjs`，本次改动 `src/github-ci/github.ts`，无历史）：三次里有一次判 `cannot-tell`。读原文，模型在两种都讲得通的读法之间来回：一种把「测试名与改动模块主题相近」当成足够证据，另一种要求更严格的对应。**问题在我的口径**——「失败测试与本次改动是否同源」本来就是**路径上算得出来的结构性事实**，我却让它去「主题相近」。
- **T2e**（同一模块关系，但断言里含有 `infra` 这个词的字面量）：三次里有一次判 `cannot-tell`。这一处**不是口径能救的**：断言内容与模块职责是否相符，无法由路径自动判定；模型有可能被日志里的关键词带走（把「断言里出现 infra」当成「这是基础设施失败」）。

### 2.11.2 修订：材料里加一段由代码算出的「对应关系」

- 夹具 `cases3f.mjs` 增 `correspondence(c)` / `correspondenceText(c)` / `materialFixed(c)`：从**失败测试文件路径**与**本次改动文件路径**算出 `{ failingTestFile, moduleName, changedFiles, relation, matchedFile }`（`relation ∈ {'shared-path-segment','none'}`）。
- 口径 `SYSTEM3F` 把 `own-action` 的第一条改成**关系事实**（① `relation` 不是 `none`），第二条保留**语义确认**（② 断言内容与该改动文件的职责一致），并明写「只有主题相近不够」「对应关系是程序算出的结构性事实，不需要你推断」。
- 模型输出要求随之增加 `correspondence` 这个引用来源。

**原则**（已同时写进产品任务定义 §5）：**能用代码算出来的关系，不交给模型推断。** 模型只负责「这条关系够不够、还缺什么」，不负责「有没有这条关系」。

### 2.11.3 回归读数（同一批 3 例 × 3 次 = 9 次调用）

| 指标 | 修订前（§2.10 原始读数） | 修订后（回归） |
| --- | --- | --- |
| T2a / T2b / T2e 分类正确 | T2a 3/3、T2b 2/3、T2e 2/3 | **9/9** |
| 三次完全一致 | 3 例里有 2 例一致 | **3/3 例** |
| 完整通过（分类 + 零编造 + 无因果） | — | **9/9**（原始 gold 与修订 gold 都是 9/9） |
| 编造引用 / 因果措辞 | 0 / 0 | **0 / 0** |
| JSON 可解析 | 54/54 | **9/9** |
| 单次耗时 | 约 35–110 秒 | 46–170 秒（材料多了一段，变慢） |

读数与逐字留档：`%TEMP%\hikari-2bi-probe3\out-fixed\results.jsonl`、9 份 `transcript-*.txt`、`rejudge-fixed.txt`（判分脚本 `rejudge-fixed.mjs`，因果规则与 §2.10 收紧后的版本一致）。

### 2.11.4 前后对比（逐字）

- **T2b 修订前 r1**（靠「主题一致」，另一种读法下就会翻）：`"失败发生在 Run npm test 步骤，日志中的失败测试与 github-ci acquisition 相关；本次改动包含 src/github-ci/github.ts 的修改，这与失败测试主题一致。材料没有提供同一 head_sha 的历史运行或更早提交失败，因此只能判断更可能属于 own-action。"`
- **T2b 修订后 r1**（引用结构事实）：`"对应关系显示失败测试与改动文件共享路径段；断言比较的是 github-ci acquisition 的 kind 值，与 src/github-ci/github.ts 所在模块的职责一致。材料没有满足 pre-existing、flaky-or-transient 或 infra 的最低证据门槛。"`，`evidenceRefs` 两条都来自 `correspondence`（`"relation": "shared-path-segment"`、`"matchedFile": "src/github-ci/github.ts"`）。
- **T2e 修订后 r1**：`"日志有 not ok 和断言文本，能定位失败。对应关系显示失败测试与改动文件共享路径段；断言比较的是字符串值，与改动文件所在 github-ci 模块的职责一致。没有同 head_sha 成功运行、更早同失败或基础设施步骤失败，因此更可能 own-action。"`——它在**没有**被那个 `infra` 字面量带走的情况下说清了「基础设施步骤没失败」。

### 2.11.5 这条回归证明了什么、没证明什么

证明了：**那段稳定性不是模型能力的上限，是我的材料与口径的缺陷**。把可计算的关系交给代码之后，同一批案例从 7/9 变成 9/9、从 2/3 例稳定变成 3/3 例稳定。这也回答了外部评审的第一条异议中最实的一层——**「把可计算的东西交给模型」本身会制造不确定性**。

没证明：

- 这是**同一批案例的回归**，不是留出集。修好之后再跑同一批，只能说明「缺陷在这」，不能说明「换个新案例也稳」。
- `T2e` 那一类风险（关键词陷阱）**没有被消除**，只是这次没被触发。它正是产品侧必须 fail-closed、且不能拿分类准确率当验收指标的原因。
- 判据仍是字符串规则（引用逐字、因果用分句 + 否定词），不是语义判定；「零编造 0/9」的含义仍是「没有引用材料外的字符串」。

**结论**：修订把 §2.10 的两个 2/3 补成 3/3，但它的价值不在数字，而在于它把一条原则钉死了——**结构性关系归代码，语义判断归模型**。2b(i) 仍未实现。

R7.2 双向指针：本节的修订与回归同时写进了 `docs/architecture/ci-diagnosis-model-supplement-v0-boundary-review.md` §5（材料契约的原则条款）。同一天，该文件的 **§10** 冻结了模型补位的设计与契约（同一条通知 + 可选补充段、只开放 `commit-comparison-indeterminate` 一支、预算与开关都是显式参数且无插件默认值、取消语义两分、两段验收）；**实现未开始**，本文件 §2.7 的「2b(i) 只保留需求」仍然成立。

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

## §9 实现状态（2a 已落地）

**落地时间**：2026-10-15。`npm run build` 通过；全量测试 **944 tests / 940 pass / 0 fail / 4 skipped**（实现前 937 / 933 / 0 / 4，新增 7 条）。

### §9.1 逐条对应 §7 的落地顺序

| 步骤 | 落地物 | 验收对应 |
| --- | --- | --- |
| 1 | `src/repository-ci-attention/plugin.ts`：`requires` 是六条（`repository-ci-awareness` / `repository-ci-diagnosis-proposal` / `language.speaking` / `language.diagnosis-speaking` / `human-delivery.deliver` / `chronicle`）；一个周期只调一次 `awareness.current()`，失败信息取自那一份 assessment 的 `githubCi` facet | ①② |
| 2 | `src/repository-ci-relevance/contracts.ts` 增加 `repository-ci-relevance.judge@1`（判定的是交出去的那份 snapshot）；`plugin.ts` 里 `current` 与 `judge` 走同一个 `judgeGiven` 实现，不是两份判定 | ② |
| 3 | 新包 `src/repository-ci-diagnosis-proposal/`：`types.ts` / `contracts.ts` / `judgement.ts`（纯函数 `judgeProposal`）/ `render.ts` / `plugin.ts`（零配置，`provides` 恰好一条，不轮询、不去重、不投递、不写事实） | ③④ |
| 4 | `src/language/`：第三条有界 speaking 契约 `language.diagnosis-speaking@1` + `renderSpokenProposal`；`express.ts` 里这个 block 的名字是 `repository-ci-diagnosis-proposal` | ④ |
| 5 | 真机一次（§9.3） | — |
| 6 | 本 §9 与 `docs/development/current-stage.md` 的口径更新 | — |

**`indeterminate` 的处理是 §2.4 与 §2.6 的调和，不是新增判词**：`commitComparison === 'indeterminate'` 时新 owner 给 `insufficient-evidence`，于是走**原有的普通通知**——「领域判断控制的是有没有资格提出具体诊断，不是有没有资格报告已经发生的事实」这句话在代码里就是这一个分支。

### §9.2 与 §2.3 的两处偏差（照实记录，不追认成设计）

1. **新 owner 的 `requires` 不是空的。** §2.3 的表写的是「requires：无」，实现是逐字 `[repository-ci-relevance.judge@1]`。理由是 §2.4 与 §3.2 合起来要求的：建议必须依据「与 occurrence **同一份** snapshot 的 relevance 判定」，而唯一能保证「同一份」的做法，是让拿着那份 snapshot 的调用者把它**交出去判**；若改成新 owner 自己再取一次，验收 ② 当场失败。依赖方向未变（仍指回 relevance），变的是这条边少了一个消费者——attention 不必再依赖 relevance。
2. **「既有测试一字不改」在字面上不成立。** attention 的既有**行为**测试一条未改（逐字相同）；改的是三处元数据与测试自己的假组合——`requires` 断言（四条 → 六条）、speaking 假件多提供一条契约、`compose()` 多收两个假件。输入边界变了，钉输入边界的断言必然跟着变；能在这场改动里被削弱的只有**行为**断言，而它们没有被碰。

### §9.3 四项验收的证据

| 验收 | 证据 | 观察面 |
| --- | --- | --- |
| ① Attention 输入变化 → 原有主动通知行为保持可用 | attention 的既有**行为**测试逐字未改、全绿；`没有建议时走原来的表达面，一个字都没有多出来`；`diagnosis 挂掉时朝「说」降级：通知照发，只是没有建议` | 运行 |
| ② 单次证据获取 | `一个周期只取得一份 assessment，而且被问的就是那一份`——断言假 awareness 的 `counts.assessments === ci.counts.calls`，且 `diagnosis.asked[0].assessment` 与 `awareness.seen[0]` **同一性**相等；`repository-ci-relevance.judge@1` 的存在让 relevance 不再自己采集 | 运行 |
| ③ Diagnosis 领域语义 | `三种 commitComparison 得到三种不同的结果，每一种都点出自己的依据`（`different` → `check-commit-alignment`、`same` → `inspect-run-steps`、`indeterminate` → `insufficient-evidence`，三条输出互不相同、各带自己的依据行）；`relevance 说 unknown 时没有建议：这一层不替它决定相关性`；**真机**上 `different` 那一条真的说出来了 | 运行 + 真机 |
| ④ Language 与回执 | `有建议时走第二个表达面：送出去的还是 Language 写的那几行`（`delivery.delivered[0] === speaking.suggestions[0].lines`、`speaking.spoken.length === 0`）；`新的 diagnosis 模块里没有跟着进来通用机制`；**真机上恰好一条消息、恰好一条既有事实族回执** | 运行 + 真机 |

#### §9.3.1 真机一次（2026-10-15）

真实进程、真实命名管道、真实 `api.github.com`（`github-ci` 用的是内置 `fetch`，不是 `gh`）。`http://127.0.0.1:9/v1` 是一个永远连不上的假端点，只为让 `language` 满足它自己的配置——这条路径不需要模型，播报由 `renderSpokenOccurrence` / `renderSpokenProposal` 这种纯渲染完成。

```text
node dist/cli/main.js resident --data-dir <TEMP>\hikari-livediag2-a1 \
  --repository-root <TEMP>\hikari-livediag-repo --repository CJX0712/world-class-ai \
  --model-endpoint http://127.0.0.1:9/v1 --model live-check-stub \
  --desktop-awareness-delay-ms 1000 --proactive-ci-delay-ms 5000
node dist/cli/main.js subscribe --data-dir <TEMP>\hikari-livediag2-a1
node dist/cli/main.js focus declare CJX0712/world-class-ai --data-dir <TEMP>\hikari-livediag2-a1
```

失败是**真实的**：公开已归档仓库 `CJX0712/world-class-ai` 最新一条 run 就是 `failure`（run `38280563949`，`main`，headSha `533e7e58a20fb0b221a15e2a3f45d44f2d830ee8`）。本机那个仓库是临时造的（`git init` + 一次提交，HEAD `868ad424`，remote 指向同一个 GitHub 名），于是 `commitComparison` 是 `different`，真机走的是 `check-commit-alignment` 那一条。

投递到的消息（`hikari subscribe` 的原文，逐字）：

```text
Repository CI 诊断建议：check-commit-alignment
仓库：CJX0712/world-class-ai，运行：38280563949，这次运行用的提交：533e7e58a20fb0b221a15e2a3f45d44f2d830ee8
依据：工作焦点命中「CJX0712/world-class-ai」，且人声明的配对把本机路径与 GitHub 名绑在一起。
这次运行用的提交与工作树报告的提交逐字不同——这是一个字符串比较，不代表差异就是失败的原因。
可以先确认正在看的是同一次提交。
```

同一时刻的 Chronicle（`facts.jsonl` 那两行，逐字）：

```json
{"factId":"6814212f-bc22-4d41-b94b-8dc6bbb76be8","type":"work-focus.declared","version":1,"occurredAt":"2026-10-15T15:06:38.637Z","recordedAt":"2026-10-15T15:06:38.638Z","source":{"kind":"work-focus.endpoint"},"payload":{"designation":"CJX0712/world-class-ai"}}
{"factId":"445cf63f-28f2-46bf-908f-14ad22bf85d2","type":"repository-ci-attention.delivered","version":1,"occurredAt":"2026-10-15T15:06:39.714Z","recordedAt":"2026-10-15T15:06:39.714Z","source":{"kind":"repository-ci-attention.delivery"},"payload":{"repository":"CJX0712/world-class-ai","runId":38280563949}}
```

**这条真机证明了什么、没证明什么**

- 证明了：新 owner 在真实 Runtime 里被真实 attention 询问（一条真实契约、零配置）；建议走的是 Language 的**第三条**有界契约；这条消息到人手里**恰好一次**；落下去的回执仍是**既有**那一个事实族（`repository-ci-attention.delivered` / `source.kind = repository-ci-attention.delivery`，payload 仍是 `{repository, runId}`）——没有第二个投递者、没有新事实 kind、没有 `speak(string)`。
- **没证明**：`same` 与 `indeterminate` 两条分支只有结构化测试，**没有**真机；`indeterminate` 意味着依据不足，真机不触发建议正是它的设计意图。
- 三次尝试（三个全新数据目录）输出逐字相同。`focus` 必须在 attention 第一个周期之前落下去，这是**时序竞争**；赛不过时那一次会退化成普通通知（正是 ① 的行为），换一个干净目录即可重来——这不是产品行为，是本轮取证手法的限制。

### §9.4 §5 的代价仍然成立

- 同一个 run 仍然只有**一次**表达机会：本轮真机上，之后的周期因为该 run 已被处理而不再说话（去重仍在 attention，新 owner 没有任何自己的历史）。
- 2a **不证明**跨历史的认知连续性：真机看到的依据全部来自**当次**采集的那一份 assessment。「昨天说过什么、今天是否还记得」属于 2b，未做。
- 不得因为这次真机就宣布「认知已验证」：它证明的是一条有依据的建议能走到人面前，并留下一个既有形状的回执。
