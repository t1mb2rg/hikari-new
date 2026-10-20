# Chronicle 与 Action：历史读取与结果反馈

范围：`src/chronicle/`、`src/repository-change-executor/`，以及所有读写事实的地方。

Chronicle 的接口只有三个方法：`append(draft)` / `get(factId)` / `read()`（`src/chronicle/service.ts:12-29`）。
`read()` 返回**全部**事实，不按家族过滤——每个消费者自己筛类型与版本。这是下面所有「能不能读到」的前提：
**机制上任何事实都能被任何消费者读到，限制来自消费者自己写的筛选条件，不来自存储。**

---

## A. 今天的四个事实家族与五条读取通路

| # | 事实类型 | 谁写 | 谁读 | 用途 | 是否进入模型 prompt | 文件:行号 |
|---|---|---|---|---|---|---|
| 1 | `work-focus.*`（declare / replace / clear） | `work-focus/session.ts` | 启动时重建工作焦点 | 恢复「人在做什么」 | **是**——经 `workFocusReadExposure` | `src/work-focus/plugin.ts:55`、`:75`；`src/work-focus/session.ts` |
| 2 | `changeable-repositories.*`（declared / replaced / cleared） | `changeable-repositories/session.ts:91` | `readChangeableRepositories` | 重建可授权仓库集合 | **是**——经 `authorizedRepositoriesListExposure` | `src/changeable-repositories/history.ts:54-71`；`session.ts:91` |
| 3 | `language.decision-confirmed` | `language/plugin.ts:345` | `readConfirmedDecisions` | 会话连续性（人确认过的句子） | **是**——直接拼进 system message | `src/language/continuity.ts:64`；`plugin.ts:445` |
| 4 | `repository-change-executor.mandate` | `repository-change-executor/plugin.ts:248`（跑之前） | **无读取者** | —— | 否 | `facts.ts:39`、`:101-108`（只筛 result） |
| 5 | `repository-change-executor.result` | 同上（跑之后） | `findPushedCommit` | 判断「这个 commit 是不是 Hikari 自己推的」→ 换 diagnosis 的一个分支 | 否（经 Service 以 `ownAction` 入参传给 diagnosis） | `history.ts:101-121`；`src/repository-ci-diagnosis-proposal/judgement.ts:111-116` |
| 6 | `repository-ci-attention.delivered` | `repository-ci-attention/plugin.ts:372` | `readDeliveredFailures` | 跨激活去重（重启后不重复通知同一个失败） | 否 | `facts.ts:40`；`plugin.ts:236` |

注：`repository-ci-attention` 的 occurrence 本身**不落盘**，只有「已投递」这一条事实（`facts.ts` 只定义 `DELIVERED_FACT_TYPE`）。

---

## B. 写入：谁决定什么算事实

- 写入点是每个 owner 自己的 `facts.ts`：`FactDraft` 由 owner 构造，`createDurableFact(validateFactDraft(draft))` 在 `chronicle/service.ts:16-21` 校验后追加。
- 「是不是一次 occurrence」由 owner 的 session 比较前后状态决定，不由 Chronicle 决定：`changeable-repositories/session.ts:84-79` 用 `sameMembership(before, next)`。
- 没有任何一处是模型决定「这算事实」：四个家族的 payload 构造里没有模型输出。
- 四个家族各自写明「不携带 Hikari 对该结果的理解」——`repository-change-executor/facts.ts:9-13` 原话：`it names one thing the family must not carry: Hikari's interpretation of the result … a fact that explained itself would be a judgement wearing a record's clothes`。

---

## C. Action 的结果反馈

| 阶段 | 执行者 | 产出 | 去向 | 文件:行号 |
|---|---|---|---|---|
| 发起 | 人经 executor 端点发 mandate | 一句话 | `chronicle.append`（**跑之前**写，防中途死亡丢失） | `plugin.ts:204-208`、`:243-254` |
| 执行 | **模型在 run 内调用 8 个工具**（`read_file` / `list_directory` / `git_status` / `git_diff` / `read_ci` / `write_file` / `git_commit` / `git_push`），由 `loop.ts` 逐步执行 | 改动的文件与提交 | 内存中的 `execution.result` | `loop.ts:108-176`；`tools.ts:63-116` |
| 判定 | `outcome.ts` | `changed` / `unchanged` / `unknown` 三态 | `outcome: result.outcome === 'changed' ? 'ok' : 'failed'` | `plugin.ts:210-219` |
| 回写 | 同上 | `repository-change-executor.result` 事实 | Chronicle | `facts.ts:40`、`:108` |
| 再消费 | `findPushedCommit` | `RepositoryChangeActionRecord` | 作为 `ownAction` 传给 diagnosis，只替换 `different` 这一个分支 | `history.ts:101-121`；`judgement.ts:111-116` |

**模型在这条链上的位置**：它**是执行者**——改哪个文件、写什么内容、怎么组织提交、什么时候推送，全部由模型在 run 内决定（`loop.ts:142-176`）；人给的是「改这个仓库」和一句 mandate。它**不是**判定者：是否 changed、是否算失败、写什么事实，全部由确定性代码决定。`git_push` 一旦成功，`pushed = true`（`loop.ts:173`）就进了事实，不可撤销。

---

## D. 必须留在原 owner 的责任（不能变成模型认知材料）

1. **成败判定**：`changed / unchanged / unknown` 三态由 executor 的 `outcome.ts` 决定，是对「世界有没有动」的判断，不是对「这次改动好不好」的判断。
2. **事实的形状与版本**：每家族自己的 `facts.ts` 定义字段与版本号，读者遇到未知版本必须报错而不是猜（`changeable-repositories/history.ts:77-82`）。
3. **「是不是一次 occurrence」**：由 owner 比较前后状态决定，不由读取方判断。
4. **别的家族的事实长什么样**：`repository-ci-diagnosis-proposal/plugin.ts:17` 明确写它「不知道 `repository-change-executor.result` 长什么样」——它通过 Service 拿 `ownAction`，不解析别人的事实。这是本仓库已经成立的跨模块纪律，也是「模型能不能直接读全部 history」这个问题的现成答案。

---

## E. 可作模型认知材料、但目前没有进入模型的

1. **`repository-change-executor.result`**：模型不知道上一次它参与的建议是否导致了改动、改动是否成功。今天这条信息只用于让 diagnosis 换一个分支（`inspect-own-action`），不进入任何 prompt。
2. **`repository-ci-attention.delivered`**：模型不知道该失败是否已经被通知过，也不知道同一仓库最近通知过几次。
3. **`repository-change-executor.mandate`**：写了但无人读，连确定性代码都没消费它。
4. **`language.decision-confirmed` 只被用来恢复对话，不被用来判断**：`continuity.ts:21-23` 原话 `It is not a permission. Nothing in this repository reads this family to decide whether something may happen … The only consumer of a decision in this build is the prompt builder, and a prompt is not an authority.`

这四项合起来是当前最清楚的缺口：**历史事实在存储层面对所有消费者开放，但只有三条进了模型能看见的材料，其余的全部停在确定性代码内部。**
