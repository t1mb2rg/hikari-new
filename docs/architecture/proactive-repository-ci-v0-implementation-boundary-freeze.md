# PROACTIVE REPOSITORY CI v0 — Implementation Boundary Freeze

> 本文是 **实现边界冻结**，不是又一份 Boundary Review。它只回答「开始实现所必须回答的具体问题」，
> 并且是 `docs/architecture/outbound-composition-v0-boundary-review.md` 的 Human ruling（第二轮）
> §六 那一项的交付。
>
> 效力：与 Human ruling 冲突时以 ruling 为准；本文不新增架构决定，不重新开已经答过的问题。

## 0. 方法与范围

- 所有依赖方向、加载次序、既有 contract 都**用源码逐条核验**，不照抄 ruling 里的预期图（ruling §七 明确要求）。
- 本 slice 只实现一个整体：`PROACTIVE REPOSITORY CI v0 — JOINT SLICE`。
  Repository CI Attention 与 Human Outbound **同时**进入，因为前者需要后者才满足 Contract Creation Gate，
  后者需要前者才满足「不得先建空壳」。任一单独进入都是不成立的。
- 本 slice **不修改 Runtime**。`src/runtime/` 一个字节都不改。

## 1. 冻结项

### 1.1 Repository CI Attention 的 owner 与 dependency

- owner：新模块 `src/repository-ci-attention/`，唯一 Runtime extension unit 是该模块导出的一个 plugin。
- `requires: [gitHubCiService, languageSpeakingService, humanDeliveryService]`
- `provides: []` —— 与 `desktop-session-awareness-loop` 同型：它是纯消费者，驱动 capability 并
  **主动说话**，自己没有 capability 可以给出去。它不 emit Event（`src` 里目前唯一的生产 `events.emit`
  在 awareness loop，而这里没有订阅者可言，发事件只会把「投递」重新变成「广播」）。
- **不 require `repositoryCiRelevanceService`。** 源码依据：`src/repository-ci-relevance/contracts.ts`
  的注释逐字写明该 contract 「It does not expose the world snapshot, the designations or the awareness
  assessment it was computed from」——它答不了「哪一个 run 失败了」。更要紧的是语义：relevance 答的是
  「这与人类声明的工作焦点有关吗」，把「有关」当作「值得打断」正是 `relevant ≠ salient`
  （`current-stage.md:1433` 冻结的三个等式全假）。Attention 的 mandate 是固定的产品授权，不是通用重要性判断。
- CI 事实来源：`gitHubCiService`（`github-ci.current@1`）。它在 `resident.ts` 的 chain 里
  （`src/cli/resident.ts:295-298`），因此只在给出 `--repository-root` / `--repository` 时加载。

### 1.2 activation-local "new failure" identity

- 身份是**本次 activation 的一个 `Set<number>`**（已通告过的 run id），闭包作用域，随 activation 消失。
  deactivate 后再 activate 从空集开始 —— 沿用 awareness loop「no token is needed to tell activations apart」
  的处理（`src/desktop-session-awareness-loop/plugin.ts:56-58`）。
- 候选条件（全部满足才算一次新的失败）：

  | 条件 | 依据 |
  | --- | --- |
  | `latestRun.kind === 'reported'` | `GitHubCiLatestRun` 的 `none` 分支没有 run 可言 |
  | `run.status === 'completed'` | 只有跑完的 run 才有 conclusion |
  | `run.conclusion.kind === 'reported'` | `absent` 是「GitHub 没报」，不是失败 |
  | `FAILURE_CONCLUSIONS.has(run.conclusion.value)` | 本 plugin 的产品判断，见下 |
  | `!announced.has(run.id)` | 本次 activation 还没说过 |

- `FAILURE_CONCLUSIONS` 是**一处字面量**：`'failure'` / `'timed_out'` / `'startup_failure'`。
  `cancelled` / `skipped` / `neutral` / `action_required` 不在此列：取消通常是人类自己做的，
  `action_required` 是在等人批，都不是「CI 失败了」。值来自 GitHub 自己的词，不做映射表。
- **通告后，无论 delivery 结果如何都加入 `announced`。** 依据 ruling §十：delivery 失败不回滚 Domain
  judgement、不假装 occurrence 未发生、不无限 retry。不加入就等于每轮 poll 重投一次，那是没有写出来的 retry loop。
- §九 的三条语义由同一集合自然满足：
  - 同一个 failed run 重复 poll → id 已在集合里 → 不重复；
  - 新的 run id 又失败 → 不在集合里 → 新候选（「同 run 从 in_progress → failure」也走这条：
    `in_progress` 时不是候选、不入集合，后来 completed+failure 首次入集）；
  - restart → 集合随 activation 消失，沿用此前 Repository CI Attention review 已裁定的 v0 语义。
- **不读 Chronicle / Memory / 通知历史 / durable queue**（ruling §九）。跨 Runtime 去重不在本 slice。

### 1.3 Attention → Language 的 material shape（本 freeze 的核心决定）

material 是**一个 owner-specific 的结构化事实值**，不是字符串、不是 prompt、不是通用信封：

```ts
// src/repository-ci-attention/types.ts —— owner 是 attention
export interface RepositoryCiAttentionOccurrence {
  readonly repository: string;
  readonly runId: number;
  readonly workflow: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly conclusion: string;   // GitHub 的原词，逐字带出
  readonly observedAt: string;
}
```

- 它**不携带 lines**。渲染是 attention 自己的纯渲染器 `renderOccurrence(occurrence): readonly string[]`，
  owner-owned、无规则、逐字转写（先例：`desktop-session-observe/presentation.ts` 的 `renderAssessment`、
  `repository-ci-relevance/judgement.ts` 的 `renderJudgement`）。
- Language 侧 `speak(occurrence)` 自己调用这个 owner 渲染器，**与 `read.ts` 调用 `renderJudgement`、
  `express.ts` 调用 `renderAssessment` 完全同型**：consumer 拿到 owner 的值，用 owner 的确定性序列化，
  自己不写第二个说法。

**被明确拒绝的形状：把 `GroundedBlock`（或任何 `{ name, lines }`）当作 speaking material。**
理由不是它不通用，而是它**没有关上那个洞**：调用方提供 `lines` 就意味着调用方可以决定 Hikari 说什么，
这正是 `plugin-design-spec.md` 拒 `speak(string)` 的同一个理由（`outbound-composition-v0-boundary-review.md`
§5.3），只是外面多包了一层。本形状之所以安全，是因为 occurrence 携带的是**事实**、不是**措辞**：
调用方可以让事实是假的，但不能让 Hikari 说出调用方选好的话。

这满足 ruling §五 的 **A（owner-specific structured material）**，不需要 B，也不需要 C。

### 1.4 Language expression capability contract

新文件 `src/language/contracts.ts`：

```ts
export interface LanguageSpeakingService {
  speak(occurrence: RepositoryCiAttentionOccurrence): readonly string[];
}
export const languageSpeakingService = defineService<LanguageSpeakingService>('language.speaking', 1);
```

三个形状决定，各有理由：

1. **同步，不返回 Promise。** 第一 slice 不调 model（ruling §十一），`speak` 的全部工作是
   `renderAnswer([{name, lines: renderOccurrence(occurrence)}], null)` —— 纯函数。为一个纯函数造
   `Promise` 是空仪式，而且会把「以后可能要调模型」当成今天的理由。
2. **不返回 `LanguageReply`。** `types.ts:15` 逐字定义 `answered` 为「at least one capability was read,
   and the answer is what was read」。主动说话**什么都没读**，套用 `answered` 是让一个词承担两个含义。
   这里返回的就是人类要读的 lines，与 Attention 随后逐字转交的那一份是同一个数组。
3. **放在共用 definition 的 `provides`。** `plugin.ts:189` 的 `provides` 本来就不属于任何 variant；
   两个 variant 都提供它，哪个组合里真有 consumer 由 roster 决定。先例：`repositoryCiRelevancePlugin`
   在「有仓库 scope、无 model」的组合里正是 provides 而无人消费，`plugin.ts:52-54` 明确说这是
   Runtime 的性质、不是该文件要处理的 case。cosmetic-provides MUST 判的是「有没有真实可调用需求」，
   不是「这一次组合里有没有人调用」。

对 `src/language/index.ts:44-46`「There is still no Service to export, in either variant …
the one thing that does is a person, arriving over the endpoint」的修订：**本 slice 之后多了一个组合成员**。
这句话本来描述的状态被真实需求改了，contract 因此有存在的理由。

第一 slice 的表达走既有 `renderAnswer(blocks, null)`（`express.ts:75`），不重新打开 Grounded LLM Expression，
不调用 model，不新建 Message / Reply 类型。

### 1.5 concrete long-lived subscriber delivery contract

新模块 `src/human-delivery/`：

```ts
export type DeliveryOutcome =
  | { readonly outcome: 'delivered' }
  | { readonly outcome: 'unavailable' }
  | { readonly outcome: 'failed' };

export interface HumanDeliveryService {
  deliver(lines: readonly string[]): Promise<DeliveryOutcome>;
}
export const humanDeliveryService = defineService<HumanDeliveryService>('human-delivery.deliver', 1);
```

与冻结设计 §7.3 逐字一致：三值，无 payload —— transport 不拥有 failure taxonomy。

- plugin：`requires: []`、`provides: [humanDeliveryService]`，**无 client 时仍然 active**
  （ruling §三：`authorized ≠ connected`，client 缺席只能是 deliver outcome，不能让 transport
  plugin waiting / Runtime failed / composition invalid）。
- 传输：本地 named pipe，路径由数据目录派生（`humanDeliveryEndpointPath(dataDir)`），
  与 `language` / `desktop-session-observe` / `repository-ci-relevance` 的 endpoint 派生同型。
  **至多一个** client 长连接；新连接取代旧连接还是被拒，属于普通实现细节，实现时取更小的一种并记录。
  **实现取值：拒绝**（不取代）——理由与理由的位置见 `src/human-delivery/endpoint.ts` 文件头。
  「更小的一种」是拒绝，因为取代需要先关掉正在服务的连接，那是一个关于「谁有资格继续听」的策略，
  而拒绝只需要一句 `destroy`，且不会让一个正在收到投递的人类静默地失去它。
- human 侧 client：新命令 `hikari subscribe --data-dir <path>` —— connect、按行打印、连接结束即退出。
  理由：本仓库每一个 capability 都有一个人类真的能运行的 client（`ask` / `observe` / `relevance` / `focus`），
  一个没有 client 的 transport 是没人能用的 transport，也就拿不到 ruling §十二 要求的真实投递证据。

### 1.6 delivery unavailable / failed semantics

- `delivered` 只表示**写入成功**，不表示送达、更不表示被读过（冻结设计 §7.3）。
- `unavailable` = 此刻没有 client。**不排队、不重试、不留历史**（ruling §十）。
- `failed` = 有 client 但写入失败。**不回滚 Attention 的判断、不假装 occurrence 未发生、不无限 retry、
  不让感知循环因 transport 失败而崩溃** —— 后者沿用 awareness loop 的 catch 边界
  （`desktop-session-awareness-loop/plugin.ts:86-95`）：一次 cycle 失败就是一次 cycle 失败。
- transport 不理解 Domain semantics：它的输入输出都是 string 行，它不知道 CI 是什么。

### 1.7 composition membership

- 新选项 `--proactive-ci-delay-ms <integer>`（正整数，毫秒）。**值存在这件事本身就是那个显式的人类行为**：
  人类授权 Hikari 在无人提问时说话，并同时给出节奏。它**不是** `--repository` 的副作用
  （Human ruling #1：`--repository` scope 不承担 interruption authority）。
- `options.ts` 按既有纪律拒绝半配置：给了该 flag 但缺 `--repository-root/--repository`，或缺
  `--model-endpoint/--model` 时，报出缺的那一对（先例：`--model-credential-env` 的拒绝文案，
  `options.ts:506-515`）。
- roster：`[...base, ...chain, <repositoryLanguage>, humanDelivery, repositoryCiAttention]`。
  次序由真实依赖决定：Attention 需要 Language 的 speaking 与 transport 的 delivery，
  所以它必须排在两者之后（先例与理由：`resident.ts:140-149`）。
- **为什么必须有这个新 flag，而不是随 chain 无条件加载**：若 Attention 随 chain 加载，则现有合法调用
  `hikari resident --data-dir D --desktop-awareness-delay-ms N --repository-root X --repository Y`
  （无 model）会让 Attention 因缺 `languageSpeakingService` 而 `waiting`，于是 `isReady` 为假、
  常驻拒绝启动。那是破坏既有 contract，不是新功能。
- **命令与选项的最终名字**（本文件起草时用的是 `hikari listen` / `--proactive-repository-ci`，
  实现发布的是 `hikari subscribe` / `--proactive-ci-delay-ms`）：本文件为两者给出的**理由**
  （§1.5「必须有一个人类真能跑的 client」、§1.7「值存在本身就是那个显式的人类行为」）
  没有被改名触动，改的只是拼写，所以按「取更小、可逆的一种」改本文件的拼写而不是改代码——
  改代码要动四个文件与它们的测试，且 `--proactive-ci-delay-ms` 与既有
  `--desktop-awareness-delay-ms` 同型，是有先例的一侧。

## 2. 停止条件闸门（ruling §十四，逐条结论）

| # | 条件 | 结论 | 依据 |
| --- | --- | --- | --- |
| 1 | material 只能通过 generic universal envelope 表达 | **不成立** | §1.3：owner-specific occurrence + owner renderer，无新信封类型 |
| 2 | Language 必须 import repository-specific semantics | **不成立** | §1.3/§1.4：Language import 的是 owner 的**事实类型**与**纯渲染器**，与 `read.ts`→`renderJudgement`、`express.ts`→`renderAssessment` 同型；Language 不判断失败是否重要、不判断 relevance、不判断是否重复 |
| 3 | subscriber presence 必须改变 Runtime readiness | **不成立** | §1.5/§1.6：`requires: []`，无 client 仍 active，缺席只成为 `unavailable` |
| 4 | speaking authorization 不能通过现有 explicit composition 在不改 Runtime 的情况下表达 | **不成立** | §1.7：新 flag 是组合层的事，`src/runtime/` 未改；Attention 的 `requires` 就是那条授权边，capability 存在本身不授权（ruling §四） |

四条全部不成立，**Boundary Freeze 成立，进入实现**。

## 3. 实际 dependency graph（源码核验）

```
git-repository ─┐
                ├─→ repository-ci-world ─→ repository-ci-awareness ─┐
github-ci ──────┘                                                    │
                                                                     ↓
work-focus ────────────────────────────────────────────────→ repository-ci-relevance
                                                                     │
                                                                     ↓
                                                        repository-language (variant)
                                                          provides: language.speaking@1  ← 新增
                                                                     │
                                          human-delivery  ───────────┤
                                        provides: human-delivery.deliver@1  ← 新增
                                                                     ↓
                                                     repository-ci-attention  ← 新增
                                                       requires: [github-ci.current@1,
                                                                  language.speaking@1,
                                                                  human-delivery.deliver@1]
                                                       provides: []
```

与 ruling §七 预期图的差异：**一处**。ruling 预期的图里 Attention 与 Language、Transport 并列；
实际实现中 Attention 位于两者**之后**，因为它 requires 两者的 provides。这不是「层次更漂亮」，
是加载次序必须让 requirement 先被满足（`resident.ts:113-115`）。

ruling §七 禁止的中间物**一个都没有出现**：无 OutboundCoordinator、无 NotificationService、
无 Global Router、无 Event sink Language、无 Runtime broker、无 Resident domain routing。
两条边仍然**都从 consumer（Attention）出发**：`requires [speaking]` 是授权边，`requires [delivery]` 是配送边；
Language 与 transport 互不知情。

## 4. 明确不做

- 不建 generic Attention / Salience / Importance / proactive framework。Attention 保持
  「explicit repository scope + activation-local new CI failure → 一次有界主动 occurrence」，
  `relevant ≠ salient` 继续成立。
- 不建 `SpeakMaterial` / `GenericGrounding` / `EpistemicPayload` / `UniversalMessage` / generic prompt envelope。
- 不为 connection state 建 Language variant（ruling §三）。
- 不读 Chronicle / Memory / 通知历史 / durable queue；不做跨 Runtime 去重。
- 不做 queue / retry / history / guaranteed delivery / 多平台抽象 / Windows Toast / installer / AUMID。
- 不建 Authority framework；不改 Runtime；不建 Service Locator / capability registry / optional requires。
- 不重开 Grounded LLM Expression；第一 slice 不调用 model。

## 5. 已知代价（记录，不在本轮解决）

主动出站要求配置 model：Language 只在同时给出 `--model-endpoint` 与 `--model` 时加载
（`resident.ts:254-278`, `language/plugin.ts` 的 `readConfig`），因此 Attention 的 speaking 依赖
把 model 配置带成了前提，尽管本 slice **不调用** model。这是
`outbound-composition-v0-boundary-review.md` §16.3 已经记录过的耦合，本轮原样继承，不扩大 slice 去解它。
