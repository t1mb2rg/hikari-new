# 行动记录的读回 —— 边界评审（里程碑 3 的后半 · 2b(ii) 的最小形态）

> 认知—行动闭环 v0 实验的一部分。它的前置是两份已经生效的文档：
> `docs/architecture/cognition-action-loop-v0-boundary-review.md`（三阶里程碑与五条验收）与
> `docs/architecture/repository-ci-diagnosis-proposal-v0-boundary-review.md`（里程碑 2 的 2a/2b 双路径）。
> 本文不重复它们的内容，只做这一片：**一条已经落盘的行动记录，被它自己之外的消费者读回，并改变下一次领域判断。**

## §0 结论

**VERDICT = NARROW。批准的是最小的一步，不是一类能力。**

- **批准**：执行者（`repository-change-executor`）对外提供**一条有界的读能力**——「我的记录里，有没有一次行动把**这一个**提交推上去了」；仓库 CI 诊断（`repository-ci-diagnosis-proposal`）成为它的第一个真实消费者，并在**一种**情形下给出**不同的**建议；验收包含在克隆的数据副本上做的**对照实验**。
- **不批准**：通用历史查询、按时间或仓库的列表、索引、跨域排序、把行动记录升级成「经验」、任何让判断自动扩张执行权限的东西、任何让消费者自己解释别人事实的做法。
- **它回答的是一个被明确留白的架构问题**（`cognition-action-loop-v0-boundary-review.md:137-142`）：跨 owner 的持久事实，是**由它的语义 owner 讲给对方听**，还是**由消费者自己去读**。本片的答案是前者，理由见 §3。

**本片不写代码。** 这一步按 R5 是 L2（§9），本文档就是那次评审；Human 确认之后才动代码。

## §1 证据（2026-10-16 亲读源码，逐条可核）

**今天真的存在什么：**

| 事实 | 证据 |
| --- | --- |
| 执行者已经写下两族事实：`repository-change-executor.mandate` / `.result` | `src/repository-change-executor/facts.ts:39-40` |
| `result` 的 payload 里，**这次行动结束时 HEAD 是什么**、**它有没有推**、**它记下的 CI run** 都在场 | `src/repository-change-executor/facts.ts:104-128`；`pushed` 是三态 `true/false/null`（`:121-123`） |
| Chronicle 的读面是三个操作：`append` / `get(factId)` / `read()`（**全部**事实） | `src/chronicle/contracts.ts:4-8` |
| 那个自己读历史的先例，读的是**它自己**的事实 | `src/repository-ci-attention/plugin.ts:9-13`（逐字：「Reading is owner-local: this module, and only this module, knows what a `repository-ci-attention.delivered` fact means」），用法在 `:193` |
| 诊断 owner 今天只有一条要求（relevance），并且**明确声明自己不持有任何历史** | `src/repository-ci-diagnosis-proposal/plugin.ts:37-38`；`contracts.ts:15-17`（逐字：「Nothing is held between calls. There is no cache, no last answer and no history」） |
| 它的判断是三选一，第三种**不是**建议 | `src/repository-ci-diagnosis-proposal/judgement.ts:89-96`：`different → check-commit-alignment`、`same → inspect-run-steps`、`indeterminate → insufficient-evidence` |
| 它交给下家的材料里，已经有这次运行用的提交（逐字，来自 GitHub） | `types.ts:28-37` 的 `headSha`；`types.ts:92-95` 的请求形状 |
| 它自己的话由它自己渲染，语言侧只负责包成块 | `render.ts:37-68`；`src/language/express.ts:365-367`；`src/language/contracts.ts:116-119` |
| 组合顺序里，执行者在链上、诊断在它之后，两者都在同一条 CI 链里 | `src/cli/resident.ts:495-549`（执行者 `:511`，诊断 `:546`） |
| 执行者**今天不 provide 任何东西**，而且那是一个决定 | `src/repository-change-executor/plugin.ts:5-8`；`index.ts:3-8` |

**两处必须说出来的偏差（不追认成设计）：**

1. `plugin.ts:5-8` 记下的「该建契约」的触发条件是逐字的：「**The trigger to watch for is a caller inside the composition that needs a change made and is not this plugin's own CLI.**」——现在出现的消费者**不是**要它做事，而是要**读它的记录**。所以这不是那条触发条件被字面满足，而是同一个裁决（`index.ts:3-8`：「a contract published before either of them arrives would be a contract shaped by nobody」）在**另一个能力**上被重新应用。**这一条由 Human 确认，不由本文档追认。**
2. 里程碑 3 的两轮独立评审把「消费者只有敲字的人和它留下的事实」当成事实记录在案；那是**当时**为真。今天多了一个消费者，所以那句话的适用范围变了，而**不是**当时的判断错了。

**系统里还没有什么：** 没有任何模块读过 `repository-change-executor.*` 这两族事实；执行者的 `provides` 是空的；诊断 owner 的输入里没有任何历史。

## §2 第一个真实消费者，与它要改变的那一个判断

### 2.1 谁是消费者（Human 已点名，2026-10-16）

Human 的裁决逐字：

> 我们直接进L2评审，先以「历史结果改变下一次领域判断」为真实消费者；「人问过去发生了什么」保留为后续自然扩展，不在本轮抢先建设

所以消费者是**仓库 CI 诊断**：它是已经存在的领域 owner（里程碑 2 的 2a），它的职责恰好是「对这一次已确认相关的失败，我有没有依据提出一次具体的复查建议」。它要改变的不是别的，是**它自己那一个判断**。

「人问过去发生了什么」（`cognition-action-loop-v0-boundary-review.md:133` 的后半句）**不在本轮**：那需要另一个消费者（说话的 surface）与另一条边，本片不预建（§8）。

### 2.2 可验证的关联（逐字相等，三条）

§3 第 5 条的判据要求「出现一个新的 CI run，它的失败与过去某次有**可验证的关联**」。本片用的关联是三条**逐字**比较，不含任何推断：

1. 这次失败运行的仓库（`occurrence.repository`，GitHub 自己的拼法）**逐字等于**那条记录里的 `repository`；
2. 这次失败运行用的提交（`occurrence.headSha`，GitHub 报的）**逐字等于**那条记录里的 `headAfter`；
3. 那条记录说**它推了**（`pushed === true`）。

三条同时成立时，能站得住的话是：**「这次运行跑的那个提交，是这个执行者在某一次行动里推上去的。」** 它**不**等于「这次失败是那次行动造成的」——一个字符串相等永远不构成因果，这句话在任何渲染里都不许出现（§5 的失败表把它钉住）。

### 2.3 判断怎么变：新增一支，只改 `different` 那一支

今天的 `different` 支说：「这次运行用的提交与工作树报告的提交逐字不同——这是一个字符串比较，不代表差异就是失败的原因。可以先确认正在看的是同一次提交。」

当 §2.2 的三条同时成立时，这一支**换**成新的一支 `inspect-own-action`：这次运行用的提交是**我们自己**推上去的那一个（时间与事实 id 都在证据里），所以「本地与它不同」不再是一件来源不明的事；要看的不是「我正在看哪个版本」，而是**那次行动自己的记录**。

**为什么只改这一支**：`same` 那一支今天的建议（看这次运行自己失败的步骤）在有记录在场时**仍然是对的**建议，改它只是把一条事实多贴一遍；`indeterminate` 那一支的诚实答案仍然是「没有具体建议」。`different` 是唯一**在缺少记录时会指向一个更弱问题**的一支——它把一次有来源的差异说成了需要人工对齐的差异。**本片只改它，多改一支就多一份没有需求支撑的面。**

### 2.4 明令不许的那条

`cognition-action-loop-v0-boundary-review.md:142` 逐字：「明确**不允许**的是：任何消费者随意解释**别人的**事实——那会把『owner 才知道自己的事实意味着什么』这条既有纪律拆掉。」

所以本片**不允许**诊断 owner 自己去 `chronicle.read()` 挑出 `repository-change-executor.result` 再解释它。它只能**问**那条事实的语义 owner（§3）。

## §3 架构考题的答案：由语义 owner 讲，不由消费者读

`cognition-action-loop-v0-boundary-review.md:139-142` 把两个方向都留在了桌上。本片选 **(a) 由事实的语义 owner 提供一个有界的读取能力**，理由三条：

1. **(b) 与既有纪律冲突。** 方向 (b) 的措辞是「由消费者自己读 Chronicle，但只解释它需要的那一部分」，而它引的先例（`repository-ci-attention`）读的是**它自己**的事实（`plugin.ts:9-13`）。执行者的事实不是诊断 owner 的事实，让诊断去解释它，正是 §2.4 禁止的那件事。
2. **裁决已经为这件事留了门。** 执行者建立时 `provides` 为空，理由是「a contract published before either of them arrives would be a contract shaped by nobody」（`index.ts:3-8`）。今天消费者出现了，而且是 Human 点名的——**建契约的时机是现在，不是当初**。
3. **(a) 把解释权留在唯一知道含义的地方。** 什么算「我们推过这个提交」，只有写这条事实的 owner 说得出来（它的 `pushed` 是三态、它的 `headAfter` 来自 git）；消费者拿到的应该是一个**答案**，不是一份需要它自己判断的原始材料。

**被否掉的备选（记录在案，先不做）：**

| 备选 | 为什么否掉 |
| --- | --- |
| 消费者自己读 Chronicle 并解释别人的事实（方向 b） | §2.4 禁止；会把 owner-local 这条纪律拆掉 |
| 由 attention 读 Chronicle 再把原始 payload 转交给诊断 | 同样是把别人的事实交给第三方解释，只是多了一跳；而且会把投递者变成事实的解释者 |
| 用**运行 id** 相等做关联（记录里的 `ciRunId` == 这次的 `runId`） | 更窄，而且**在一次重跑上就失效**：同一个提交被重跑时会是一个新的 run id，可那次运行跑的仍然是**我们推上去的那个提交**。提交相等是对的那条 |
| 让诊断 owner 自己去问 git（这个提交是不是本机推的） | 它没有那个能力，也不该有；而且 git 只知道提交的**内容与作者**，不知道**哪一次行动把它推了上去**——那正是记录存在的理由 |

## §4 要改的是什么（逐处，四处 + 一处注释）

1. **新文件 `src/repository-change-executor/contracts.ts`**：定义 `repositoryChangeActionsService = defineService<RepositoryChangeActionsService>('repository-change-executor.actions', 1)`，一个操作：

   ```ts
   pushedCommit(input: { readonly repository: string; readonly commit: string })
     : Promise<RepositoryChangeActionRecord | undefined>;
   ```

   答案的形状只有两个字段：`{ readonly occurredAt: string; readonly factId: string }`——**它回答的是「有，这是哪一次」，不是「这是全部历史」**。`undefined` 的含义要在注释里写死：**「我的记录没有这么说」**，它同时覆盖「没有这样一条事实」与「有事实但那条事实没说推过」两种情形；本片**故意不区分**它们，因为区分需要一个消费者，而今天没有（这条注释是给下一个人的，不是给今天的）。

2. **新文件 `src/repository-change-executor/history.ts`**：把规则写成**纯函数**并导出，照 `judgement.ts` 的先例（测试不必起管道）：

   ```ts
   export function findPushedCommit(
     facts: readonly DurableFact[],
     query: { readonly repository: string; readonly commit: string },
   ): RepositoryChangeActionRecord | undefined;
   ```

   规则就是 §2.2 那三条逐字相等，另外两条读法纪律：**只读 `version === 1` 的 `repository-change-executor.result`**（别的版本不猜它的形状，`facts.ts:29` 的先例）；某一条同类型事实的 payload 取不到那几个字段时**跳过它**，不作数也不抛——一条坏行不应该让整次读取沉默（与 attention 读自己历史时的降级方向一致：**失败方向朝向说话，不朝向沉默**）。

3. **`src/repository-change-executor/plugin.ts`**：`provides` 从 `[]` 变成 `[repositoryChangeActionsService]`；`setup` 里用**已经拿到**的 `chronicle`（`:101`）提供 `Object.freeze({ pushedCommit })`。**两个 definition 都提供它**（它们的差异仍然只在 `requires`，`plugin.ts:85-88` 那条形状不动）。文件头那段「provides 为空是一个决定」的注释要**改写**，把「触发条件出现的方式与当初写下的不完全一样」如实记进去（§1 偏差 1）。

4. **`src/repository-ci-diagnosis-proposal/`**：
   - `plugin.ts`：`requires` 从一条变成两条（多 `repositoryChangeActionsService`）；`propose()` 里多一次 `await actions.pushedCommit({ repository: request.occurrence.repository, commit: request.occurrence.headSha })`，把结果交给 `judgeProposal`。
   - `judgement.ts`：`judgeProposal` 多收一个参数（那条记录或 `undefined`）；**只有** `commitComparison === 'different'` **且**记录在场时，返回新的一支 `inspect-own-action`；其余情形**逐字不动**。
   - `types.ts`：`RepositoryCiDiagnosisProposal` 多一支 `{ kind: 'inspect-own-action'; evidence: RepositoryCiDiagnosisOwnActionEvidence }`，其中 `RepositoryCiDiagnosisOwnActionEvidence = RepositoryCiDiagnosisEvidence & { readonly ownAction: RepositoryChangeActionRecord }`。**既有两支的证据形状一个字不改**，所以它们今天的行为断言不需要改。
   - `render.ts`：为新的一支写它自己的句子（引时间与事实 id，并**明说它不知道成因**）。
   - `contracts.ts` / `plugin.ts` 的文件头注释：写上「它仍然不持有任何东西；它的材料多了一条**问来的**历史」——不然「no history」那句话在文件里变成谎话。

5. **组合与测试元数据**：诊断的 `requires` 断言 +1；`test/resident-cli.test.mjs` 里执行者的两个 definition 的 `provides` 断言从 `0` 改成 `1`；顺序断言不变（执行者本来就在诊断之前，`src/cli/resident.ts:511` 在 `:546` 之前）。

**不需要改的**：`src/language/**`（`express.ts:365-367` 已经是委派给这个 owner 自己的渲染器，新的一支自动流过去）；`src/runtime/**`（0 diff）；Chronicle；github-ci；relevance；awareness；attention（它只是拿 `RepositoryCiDiagnosisProposal` 的第三个结果当第一/第二个处理——**这一点要在实现时确认**：`insufficient-evidence` 之外的新支必须走「有建议」那条路，不能被当成「没有建议」而退回普通通知）。

## §5 验收（可测；对齐 §3 第 4、5 条）

| # | 验证对象 | 完成条件 | 怎么观察（正面） | 什么情况算失败（反面） |
| --- | --- | --- | --- | --- |
| ① | 关联是逐字的 | 三条相等同时成立才认 | 纯函数测试：仓库改一个字符 → `undefined`；提交改一个字符 → `undefined`；`pushed` 为 `false` 或 `null` → `undefined` | 源码里出现 trim / 大小写折叠 / 前缀比较 / 遍历提交图；或「相近」被当成「相等」 |
| ② | 只改一支 | `same` 与 `indeterminate` 逐字不动 | 既有的三支用例全绿且期望未被修改；新增：记录在场 + `same` → 仍是 `inspect-run-steps` | 为了让新代码通过而改了既有三支的期望；或新支在 `indeterminate` 上也出现 |
| ③ | 记录不在场即退回基线 | 没有那条事实时，行为与今天完全一样 | 同一输入、无事实 → `check-commit-alignment` | 没有记录也给出新支（凭别的材料猜） |
| ④ | 跨重启读回（§3 第 4 条） | 进程重启后那条事实仍在，且被**它自己之外**的消费者读出并引用 | 真机：写一次真行动 → 重启常驻 → 让同一个运行再次成为「新的失败」→ 建议里出现**同一条** `factId` 与 `occurredAt` | 引用只出现在测试的桩里；或重启后读不到 |
| ⑤ | 对照实验（§3 第 5 条） | **在克隆的数据副本里**移除那条事实、其余输入不变 → 行为退回基线 | 复制数据目录 → 从副本的 `chronicle/chronicle.jsonl` 删掉那一行 → 用副本重启 → 同一运行 → 建议回到 `check-commit-alignment` | 在生产 Chronicle 上删事实；或删掉之后行为没变（说明变的不是它） |
| ⑥ | 排除「普通去重」这条假成功 | 变化的是**处理方式**，不是「有没有再说一遍」 | 两次实验里**都**投递了一条消息（投递计数都是 1），变的是建议本身 | 拿「第二次没通知」当证据 |
| ⑦ | 组合 | 诊断存在 ⇒ 执行者存在；一次投递仍然只有一条 | 常驻的每一种 roster 上断言这条蕴含关系；投递计数恰好 1；没有新事实 kind | 出现第二个投递者；或某个 roster 里诊断能起来而执行者不在 |

**每次真机动作都要留输出**：起一次真实常驻、造一次真实失败、数消息条数、把 Chronicle 的那一行与对照实验的副本一起留下来。

## §6 失败与边界（都必须有测试）

| 情形 | 结果 |
| --- | --- |
| 有事实、但 `pushed` 是 `null`（读不到推没推） | 不算「推过」→ 退回基线；**不得**当成「推过」 |
| 那一次行动的 `outcome` 是 `unknown` / `halt` 在场 | 本片**不看** `outcome`：关联说的是「它推了哪个提交」，不是「它成功没有」；这一点要写进注释，免得下一个人以为成功与否被忽略了 |
| 同一条提交被两次行动都记过 | 取**最近**的一条（按 `occurredAt`，平局取 `factId` 字典序大的）——纯函数里定死，测试钉住 |
| Chronicle 读失败 | 读取失败**不**让诊断抛：`pushedCommit` 的失败按「没有这么说」处理，建议退回基线；失败方向朝向**说话**（打普通通知），不朝向沉默。这一点与 attention 读自己历史时的选择同向 |
| payload 形状不认识（版本不同 / 字段缺失） | 跳过那一条；不猜 |

## §7 代价与本片没有交付什么

- **多一次跨 owner 的异步调用**（每个诊断周期一次）。它读的是整条 Chronicle（`read()` 今天没有过滤面），代价随事实条数增长。本片**不建索引、不建缓存**——那是另一个设计；但如果真机上诊断周期因此变慢，那属于下一次评审的材料。
- **执行者的公开面不再是空的**。它的第一条边是给历史用的，不是给「让别人指挥它做事」用的——本片不提供任何能发起改动的操作，`mandate` 仍然只能来自人的原句。
- **它只证明一条边**：一个 owner 讲，一个消费者读，一条有界的读能力。第二个领域要读同一族事实时，需要**第二次**同样的判断，而不是把这条边扩成通用接口。
- **它不证明**「Hikari 记得」：它证明的是**一次可对照的读回**。人问过去发生了什么、语言回合的留痕、把结果当经验使用，都还在后面。
- **2a 的那条能力边界不变**：同一个 run 仍然只有一次主动表达机会。

## §8 明确不做

- 不做「人问过去发生了什么」的通路（Human 已裁定保留为后续自然扩展）。
- 不做通用历史查询：不接受时间范围、不接受 limit、不做列表、不做索引、不做「最近 N 次」。
- 不做通用 Memory / Experience / 中央 Judgement / 跨领域排序 / 跨域路由器。
- 不让任何消费者解释别人的事实；不把原始 payload 交给第三方转手。
- 不让判断扩张执行权限：本片只说，不做；诊断仍然没有发起动作的能力。
- 不新增事实 kind；不改两族事实的 payload；不删生产事实（对照实验只在副本上做）。
- 不改 `same` 与 `indeterminate` 两支；不改执行者的工具表；不给模型新工具。
- 不修改任何冻结文档；不为让实验好看而绕过通道。

## §9 级别与流程（R5）

- 新增一条**公共契约** + 一条 `requires` 边 + 一个判断支的语义扩展 → **L2**。本文档即那次评审。
- 不触及 R2 的 MUST（不改 Runtime、不改 core 不变量、不新增全局状态中心），因此**不 L3**，也不修改 `principles.md` / `core-architecture-v0.md`。
- 与 `core-architecture-v0.md:423`（不变量 9：改变现实必须基于当前状态，而不是旧判断）的关系：本片加的是一条**只供建议使用**的历史读取，它**不参与**任何「能不能动手」的判断——执行者的范围与当前状态检查（`execute.ts` 的 `resolveDeclaredRoot` / `isRepositoryRoot`）一个字不动。这句话要出现在实现处的注释里。

## §10 落地顺序

0. 本文档落盘 + 双向指针（`docs/development/current-stage.md` 的「认知—行动闭环 v0」一段；`cognition-action-loop-v0-boundary-review.md` §2.4 末尾的后续指针）+ 提交/推送/CI。**先评审，后代码。**
1. 执行者侧：`contracts.ts` + `history.ts`（纯函数）+ `provides` + 注释改写；纯函数测试先行。
2. 诊断侧：`types.ts` 的新支 + `judgement.ts` 的一条分支 + `render.ts` 的句子 + `plugin.ts` 的第二次调用；① ② ③ 的测试。
3. 组合：`requires` 断言、`provides` 元数据断言、蕴含关系测试。
4. 真机：④ 跨重启读回（真实常驻、真实失败、真实投递）。
5. 对照实验：⑤ ⑥ 在克隆的数据副本上。
6. 记录：`current-stage.md` + 本文档的落地段；**不得宣布认知实验通过**。
7. 独立的只读评审（Functional + Architecture），findings 逐条复现后才动手。

## §11 它证明什么、不证明什么（诚实标注）

- **证明**：一条持久事实可以被**它自己之外的** owner 读出、被引用，并**改变一次领域判断**；而且这个改变是可对照的（移除那条事实，行为退回基线）。
- **不证明**：不证明任何形式的通用记忆或经验；不证明判断因此更**准**（它只证明更**有依据**）；不证明这条边的形状对别的领域也适用；不证明执行权限与它有任何关系。
- **可逆性**：把执行者的 `provides` 与诊断的那条 `requires` 去掉，系统回到今天的行为——读能力没人问，判断退回两支。数据不需要回滚（没有新事实 kind）。
