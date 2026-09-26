# MEMORY REACTIVATION v0 — BOUNDARY REVIEW

状态：**只设计**。无实现、无 Runtime 改动、无 Memory 创建、无 commit。
基线：`main` @ `1b9021a`（review 开始时 `git status --short` 为空）
日期：2026-09-27

---

## Human Ruling（本 review 的处置结果）

本 review 的 `BLOCKED` verdict **已被 Human 接受**，并正式裁决：

> **MEMORY REACTIVATION v0 = BLOCKED**

三项 blocker 全部接受（即 §16 的三条理由）。额外冻结：

- **Memory 不再主动推进。**
- 重新开启 Memory Boundary Review 需要下列条件**同时**出现（见 §14）。
- **不要为了 Memory 主动创建**：Salience / Importance Judgement、Awareness capability、historical consumer、generic recall substrate、memoryService、semantic association、confidence、embeddings、vector DB。
- **也不要为了给 Chronicle 找 reader 而创造需求。**
- 严格保持三者区分（见 §2）：

  ```
  Historical Query  ≠  Memory Reactivation  ≠  State Restoration
  ```

  Historical Query 可以在未来出现真实用户需求时**独立进入**，但它**不自动构成 Memory**。

**本轮交付为纯文档**：无实现、无 Runtime 改动、无 Memory contract、未修改 production / tests。

---

## 0. 本轮方法，以及对抗验证的如实说明

本轮先做五面取证（Chronicle 契约 / Contract Creation Gate / consumer 面 / 冻结规则 / 记录族），再把全部承重结论重新锚定到源码与可执行行为。承重结论一共十二条，逐条读过原文。

原计划有两条对抗验证由 subagent 承担（逐字相等是否足够；「不存在真实 consumer」是否成立）。**两个 subagent 都停滞了**——transcript 行数在约 19 分钟内完全不变，journal 停在 5/7，没有产出任何结论。我没有替它们编造结果，也没有把「多数同意」当成证据：按 CLAUDE.md「subagent finding 只是候选结论，主 Agent 必须重新锚定到 source」，这两条对抗验证由我本人对源码重做，结论写在 §6 与 §8。

顺带发现一处**文档引用漂移**（非本轮产生、非本轮修复）：
`docs/architecture/phase-4-explicit-work-focus-review.md:117` 引 `current-stage.md:17` 作为「本仓库对 consumer 的门槛是模块级的」出处；该句实际在 `current-stage.md:41`。已第一手核对。属既有文档完整性问题，本轮**只报告不修改**。

---

## 1. Existing Memory semantics in repo

Memory 在本仓库是一个**有定义、有 owner、有禁令、无实现**的语义位。冻结文本如下（均已第一手核对）：

| 出处 | 内容 |
| --- | --- |
| `principles.md:394` | 「Memory 不等于 Chronicle。」 |
| `principles.md:398-401` | 「Chronicle = 发生过什么」／「Memory = Hikari 从经历中理解出了什么」 |
| `principles.md:404-410` | Memory 可以被「修订 / 重新解释 / 降低置信度 / 合并 / 废弃」 |
| `principles.md:412-418` | 「重要记忆应尽可能保留：来源 / 依据 / 时间 / 置信度 / 修订关系」 |
| `principles.md:420` | 「避免把 LLM 一次推断直接升级成不可质疑事实。」 |
| `principles.md:718`（top-10 第 7 条） | 「**Memory 是解释，不是绝对真源。**」 |
| `core-architecture-v0.md:271` | Memory 回答「过去的经历让我理解了什么？」 |
| `core-architecture-v0.md:273` | 「Memory 是可修订解释，不是事实真源。」 |
| `core-architecture-v0.md:257` | Chronicle「可以成为共享事实基底，但不能成为统一解释中心。」 |
| `core-architecture-v0.md:285` | 「**不建立中央 Judgement Domain。**」 |

Owner 与禁令：

| 出处 | 内容 |
| --- | --- |
| `principles.md:54` | 「Memory 拥有记忆语义、写入规则、检索与修订」 |
| `principles.md:138` | Runtime 「不得理解」 Memory |
| `principles.md:164` | Runtime 不得含 `if memory.should_store ...` |
| `principles.md:166` | Runtime 不得含 `if awareness.important ...` |
| `principles.md:310` | Memory 直接触发外部动作 **不允许** |
| `principles.md:532`、`:718-719` | Memory God Object 禁止 |
| `principles.md:695` | 自检问题：「有没有把 Memory 当成事实？」 |
| `core-architecture-v0.md:71` | Runtime 不负责 Memory |
| `core-architecture-v0.md:249` | Continuity 不负责 Memory |
| `core-architecture-v0.md:393-404` | §11 明确禁止重新引入的结构清单 |

**代码层唯一的 Memory 边界**在 `src/language/dialogue.ts`：它把「进程内、不落盘、无 provenance、无 confidence、无修订」的对话态与 Memory 划开，并给出结构性理由——「nothing here outlives a process — there is no file, no store and no Chronicle entry behind it, so there is nothing that could survive to be mistaken for one」。

**小结**：`principles.md:412-418` 是一段 **requirement-without-contract**：它要求记忆保留来源/依据/时间/置信度/修订关系，但今天没有任何东西消费这五项中的任何一项。

---

## 2. Chronicle vs 历史查询 vs Memory vs 恢复

四件事，今天的状态完全不同：

| 概念 | 含义 | 今天的状态 |
| --- | --- | --- |
| **Chronicle** | 发生过什么 | **已实现**。有 store、有 header、有契约、有一个生产事实族 |
| **历史查询** | 从 Chronicle 里按条件取 | **未实现且明令不做**。`read()` 是全量扫；无 query DSL / 全文 / 向量搜索（`current-stage.md:1424`） |
| **Memory** | Hikari 从经历中理解出了什么 | **未实现**。语义位已定义、owner 已定、禁令已立 |
| **恢复** | 把过去的状态搬回现在 | **明确禁止**。`session.ts:17-19`；mandate 亦明列 |

**Human 额外冻结的三者严格区分**（见 Human Ruling）：

```
Historical Query  ≠  Memory Reactivation  ≠  State Restoration
```

Historical Query 可以在未来出现真实用户需求时独立进入；**它不自动构成 Memory**。三者的 owner 不同（§9），且今天的实现状态不同（上表）。

**Memory ≠ Chronicle 是结构事实，不是口号。**
`phase-4-explicit-human-reference-review.md:184` 已裁定：Chronicle 事实「**不成立**——且 Chronicle **不支持 update / delete / supersession**」，所以 §8 的替换语义在它上面无法表达。而 `principles.md:404-410` 恰恰要求 Memory 可修订 / 合并 / 废弃。

→ 推论有两面，两面都要记住：
1. 不能把 Chronicle 直接当 Memory 用（修订语义无法表达）。
2. 反过来，**建 Memory 需要一个 Chronicle 之外的 durable substrate**——这是新增公共基础设施，属 C 级架构工作，不是本轮的 B 级 capability。

---

## 3. First real durable substrate

**唯一的一个：Chronicle。**

```ts
export interface ChronicleService {
  append(draft: FactDraft): Promise<DurableFact>;
  get(factId: string): Promise<DurableFact | undefined>;
  read(): Promise<readonly DurableFact[]>;
}
export const chronicleService = defineService<ChronicleService>('chronicle', 1);
```

- `FactDraft { type, version, occurredAt, source, payload }`；`DurableFact` 追加 `factId`、`recordedAt`；`FactSource { kind, reference? }`。
- `ChronicleStoreHeaderV1 { kind: 'hikari-chronicle', version: 1, owner }`——**owner 是 store 级的**，不是事实级的。
- 无 update / delete / supersession。事实不可变。`read()` 是全量、append-order 扫描。

**唯一的生产事实族**（`src/work-focus/facts.ts`）：

| type | payload | source.kind |
| --- | --- | --- |
| `work-focus.declared` v1 | `{ designation: string }` | `work-focus.endpoint` |
| `work-focus.replaced` v1 | `{ designations: string[] }` | `work-focus.endpoint` |
| `work-focus.cleared` v1 | `{}` | `work-focus.endpoint` |

### 本轮最重要的单一事实

**`chronicleService.read()` 在生产代码里零调用者。**

第一手取证（`Grep` over `src/**/*.ts`，pattern `chronicleService|chronicle/index|\.read\(\)`）：

- `chronicleService` 只出现在：它自己的定义（`chronicle/contracts.ts:10`）、`chronicle/plugin.ts` 的 `provides`、`work-focus/plugin.ts:55` 的 `requires` 与 `:75` 的 `services.get`。
- **`.read()` 零命中。**
- 写入侧唯一调用点：`src/work-focus/session.ts:81` 的 `await chronicle.append(draft)`。
- CLI 侧（`cli/start.ts`、`cli/resident.ts`、`cli/chronicle-init.ts`）只接触 `chroniclePlugin`（组合）与 `initializeChronicle`（建 store），**不读事实**。

`src/work-focus/index.ts:16-21` 对此已有自觉陈述：

> 「The three type names are this owner's statement about its own occurrences, and they travel in exactly one direction: this plugin writes them into Chronicle. **Nothing reads them back** — not this module, which starts empty in a new Runtime regardless of what the history holds, and not any other, since there is still no reader that asks what this plugin's durable history says.」

**所以：durable substrate 已经存在，读侧则完全空转。** 这不是缺陷——`work-focus/index.ts:20-21` 说明这是有意拒绝「提前发布词汇表」（`plugin-design-spec.md` §16）。但它决定了本轮的起点：讨论 Memory 之前，先要有一个读侧的需求。

---

## 4. Missing information

Reactivation 需要而今天**不存在**的东西，逐条：

1. **没有「cue」的概念。** 没有任何 contract 描述「当前 context」，可以被拿去与过去比对。`repository-ci-relevance` 是把 `work-focus.current@1` 与 CI snapshot 临时接起来，**不留痕、不缓存**——它是两值的临时比较，不是一个可复用的「现在」表示。
2. **没有 subject key。** `DurableFact` 只有 `factId / recordedAt / occurredAt / type / version / source / payload`。`type` 是唯一的族标识，但它回答「**谁**发生的」，不回答「**关于什么**的」。
3. **`cleared` 的 payload 是 `{}`。** 一条 clear 事实**连 designation 都没有**——「清掉了什么」不在事实里。任何按 payload 字符串的关联都碰不到它。
4. **同族内 payload 形状不一致。** `declared` 是 `{ designation: string }`；`replaced` 是 `{ designations: string[] }`——键名不同（单复数）、类型不同（string vs array）。**generic 匹配在族内就已经不成立**，这不是实现细节，是数据的形状。
5. **没有 salience。** 没有任何字段说「这条值得重新激活」。这不是遗漏：`facts.ts` 头注释明确写了**故意**没有——「What is deliberately absent is anything a fact might be *judged* by — no importance, no salience, no confidence, no relation to another fact, no reading of what a designation means.」
6. **没有 consumer**（§8）。

第 5 条尤其重要：**writer 已经明确拒绝写判断。** 任何在读侧事后补 salience 的方案，要么需要更新已写入的事实（Chronicle 不支持 update），要么需要在读侧现算——而现算需要一个 owner，而那个 owner 是 Awareness（§9）。

---

## 5. Memory admission alternatives

按 `plugin-design-spec.md` §2.1 四准则 / §16.1 / §16.2 逐条判。§16.2 的判据是「**真实的可调用需求**」；§14 的默认是「『以后可能有用』**默认不建**」。

| # | 候选 | 判定 | 理由 |
| --- | --- | --- | --- |
| a | `MemoryService`（append / read / revise） | **不成立** | 无 consumer（§16.2）。且「revise」要求 Chronicle 之外的 durable substrate → 新增公共基础设施，C 级 |
| b | `Memory<T>` 泛型 | **不成立** | 没有第二个 `T`。今天只有一个事实族，泛型是为不存在的多样性付抽象税 |
| c | Chronicle 读侧包装（「semantic search wrapper」） | **不成立** | 正是 mandate 明列禁止的形态；且属 §16「以后可能有用」默认不建 |
| d | 一个只回答「有没有与 X 相关的过去」的 Service | **不成立——它已经存在** | 就是 `repository-ci-relevance`。见 §12：增量是零 |
| e | 让 work-focus 读回自己的历史 | **不成立** | 直接撞 `session.ts:17-19` 与 mandate 冻结禁令 |

**五个候选全部不成立。今天没有任何抽象满足 Contract Creation Gate。**

注意判据的性质：「测试方便」「对称」「以后可能有人用」在这个仓库里**从来不是充分理由**（§16.2 与 §14），所以上表的「不成立」不是保守，是照章。

---

## 6. Association alternatives

### 6.1 唯一被冻结、且已实现的关联规则

`current-stage.md:1432`：人类 designation 与 `snapshot.githubCi.observation.repository` **逐字相等** → `relevant`，否则 `unknown`。**没有 `unrelated`。**

同段明令禁止：trim / 大小写折叠 / basename / owner 拆分 / 路径解析 / remote URL 推断 / repository identity 推断 / fork 检测 / **模糊匹配** / **alias** / **模型匹配** / **embedding** / **语义相似度**。

`current-stage.md:1433`：「三个等式**都不成立**：`relevant ≠ important`、`relevant ≠ salient`、`relevant ≠ should notify`。」

### 6.2 对抗验证：逐字相等**不足**，而且不足的方式已被仓库自己固化

我按「找出一个逐字相等会产出错误或无用关联的具体案例」攻击了这条结论，**攻击成功**，且反例不是假想的——它在仓库自己的测试里：

`test/repository-ci-relevance.test.mjs:29`：`const CANONICAL = 't1mb2rg/hikari-new';`

真值表（`:87-108`）：

| 行 | designations | repository | verdict |
| --- | --- | --- | --- |
| `:96` | `['hikari-new']` | `t1mb2rg/hikari-new` | `unknown` — 「只有仓库名（basename）不算命中」 |
| `:97` | `['t1mb2rg']` | `t1mb2rg/hikari-new` | `unknown` — 「只有 owner 不算命中」 |
| `:99` | `['T1MB2RG/Hikari-New']` | `t1mb2rg/hikari-new` | `unknown` — 大小写不同 |
| `:100` | `[' t1mb2rg/hikari-new']` | `t1mb2rg/hikari-new` | `unknown` — 空白不同 |
| `:101` | `['t1mb2rg//hikari-new']` | `t1mb2rg/hikari-new` | `unknown` — 重复斜杠 |

而 **work-focus 自己的测试允许裸名作为合法 designation**：`test/work-focus.test.mjs:215` 写入 `{ word: 'replace', designations: ['DesktopAgent', 'hikari-new'] }`，`:361` 写入 `'t1mb2rg/hikari-new'`，`:389` 写入 `'只有一个'`。

并且 `github-ci` 的 config **强制 `owner/name` 形态**（`src/github-ci/plugin.ts:49`：`REPOSITORY_PATTERN = ^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$`——斜杠是必需的），所以 `observation.repository` 永远是 `owner/name`，不会退化成裸名。

**结论**：仓库允许写下的 designation 词汇表，与仓库允许建立关联的词汇表，**是两套**。任何「把过去和现在接起来」的机制必须先面对这个缝隙，而 `current-stage.md:1432` **明令禁止填这个缝隙**（禁 trim、禁 basename、禁 owner 拆分、禁模糊匹配）。

### 6.3 备选：按 `type` 相等

技术上可行（`work-focus.*` 三个 type 名逐字可比），但它是**极小的**：`type` 相等只能回答「这个 plugin 过去发生过事」，**不能**回答「和你现在说的这件事有关」。对 reactivation 的贡献是零，甚至是负——它会让每一次「有过 declaration」都看起来像一次命中。

### 6.4 结论

**不存在一个「比逐字相等松一点」的中间档。** 冻结文本已经把这一档显式堵死（`:1432` 的禁止清单），而 `:1433` 又同时关掉了往上的路（`relevant` 不等于 salient）。可用的关联机制在**上下两个方向都被冻结封死**。

---

## 7. Reactivation semantics

Mandate 的核心问句「过去什么东西，在当前 context 下值得重新进入认知？」是**两个判断的合成**：

**(a) 关联判断**：过去 X 与现在 Y 有关系。—— 已有冻结答案，且是逐字相等（§6）。
**(b) 显著判断**：值得重新进入认知。—— **owner 不是 Memory，是 Awareness。**

`principles.md:451-453`：「Awareness 才负责：这件事意味着什么？**值不值得在意？是否需要记住、提醒或行动？**」
`principles.md:466` 的流：`Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act`。

而这条语义的当前状态是冻结的**未开启**：

- `current-stage.md:19` 与 `:43`：「Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act **仍然均未进入，且未被预埋**」。
- `current-stage.md:1428`（standing do-not-do）：「感知的语义解读——Salience / Importance / freshness 判断……『什么值得记住』的判断」。

其余两条碰撞：

- **Language 的 read-once 不变量**（`src/language/answer.ts:35`，`principles.md` 之外的实现层约束）：

  > 「**every iteration that continues must have consumed a capability that had not been read yet in this interaction.**」

  `:198` 的 `alreadyRead` 让重复读直接进入 stop 路径。**「重新激活」若发生在 Language 内，字面上要求「重复读一个有意义的旧东西」，与该不变量直接冲突。** 而且该文件自己在 `:55-56` 写了这个前提：「When a capability that needs to be read twice exists, this is the code that has to be revisited, and it will say so.」——即：要动这条，必须**先立论**。
- **恢复禁令**：`src/work-focus/session.ts:17-19`：

  > 「The history cannot restore the state. Nothing here reads a fact back, and a new activation still starts from `emptyWorkFocus()` — which is what keeps `chronicle read()` a record of what happened rather than a second place the work focus lives.」

**结论**：reactivation 作为一个**动作**（把过去拉进现在）在本仓库没有合法落点；作为一个**判断**，它属于尚未开启的 Awareness 语义。它今天既不是 Memory 的子问题，也不是 Memory 能回答的问题。

---

## 8. Candidate first consumer

对抗验证第二项：我按「找出一个真正需要『过去的经历因为当前 context 而重新变得相关』的模块」攻击了「不存在真实 consumer」这一结论，**攻击失败——结论成立**。逐候选：

| # | 候选 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | **work-focus 自己** | **禁止** | `session.ts:17-19` 明写「The history cannot restore the state」；mandate 亦明列「Work Focus Chronicle history → 自动恢复 Work Focus current()」为禁止项 |
| 2 | **Language（base / repository-aware）** | **禁止** | 四条独立理由，见 §11 |
| 3 | **repository-ci-relevance** | **禁止** | 它已经有一个判据（`work-focus.current@1` + CI snapshot）。其 `contracts.ts` 头把「记住上一次答案」明确写成它**不是**的东西：「a caller that asks twice gets two independent comparisons of two independent snapshots, **which is the only shape in which "relevance" is a question about now rather than a memory of a previous answer.**」把输入换成 `chronicle.read()` 会正好推翻这句话 |
| 4 | **desktop-session-awareness / observe** | **禁止** | `phase-3-desktop-session-awareness-architecture-review.md:485`：一个「记得住历史」的 Awareness「会立刻变成 Memory 的雏形」，其全部后果（保留多久、多少、何时丢弃、落盘、格式迁移）「全部是**未批准范围**」。`:856` 又把「Awareness 是否该有历史窗口」立为**独立设计决定** |
| 5 | **CLI `hikari status` / 人类** | **不成立** | 按 `current-stage.md:41` 的**模块级** consumer 门槛，人类是 client，不是 consumer |

**五个候选全部不成立。今天不存在真实的 bounded consumer。**

---

## 9. Ownership

| 关注点 | Owner | 状态 |
| --- | --- | --- |
| 发生过什么 | **Chronicle** | 已实现 |
| 记忆语义、写入规则、检索与修订 | **Memory**（`principles.md:54`） | 语义位已定义，**未进入** |
| 联想与比较本身 | 各自的 realm：work-focus 拥有 designation 的语义，github-ci 拥有 repository 的语义，`repository-ci-relevance` 拥有这条比较 | 已实现且**不缓存** |
| 值不值得在意 / 是否需要记住 | **Awareness**（`principles.md:451-453`, `:466`） | **未进入，且未被预埋** |
| Runtime | 以上一个都不拥有 | `principles.md:138`, `:164`, `:166` |

**关键观察**：mandate 的措辞「reactivation」把 §7 的 (a) 关联 与 (b) 显著 **合成一个词**。拆开之后：

- (a) 的 owner 各自在位，且已经被实现、已被冻结、已被测试。
- (b) 的 owner 是 Awareness，位子上**有人，但那个人今天不准开口**。

**没有任何 owner 空缺需要 Memory 来填。** 本仓库的纪律是先在 owner 上出现空缺、再谈结构；这里是「有人但未获批」，不是「无人」。

---

## 10. Confidence question

- `principles.md:412-418` 要求重要记忆尽量保留来源 / 依据 / 时间 / 置信度 / 修订关系——**这是 requirement，不是 contract**。
- 今天 `DurableFact` 没有 `confidence` 字段，且这是**故意的**。`src/work-focus/facts.ts` 头注释：

  > 「What is deliberately absent is anything a fact might be *judged* by — no importance, no salience, no confidence, no relation to another fact, no reading of what a designation means. Chronicle stores what happened. It does not explain what it means.」

- 所以加置信度**不是补一个字段**。加它会把 Chronicle 从「事实的记录」变成「可判断的主张」——那是 Memory 的语义，不是 Chronicle 的。而这个转换需要两个前提：**(1) 有读者；(2) 有修订语义**。两者都不存在。
- 「generic confidence scale」在 mandate 的禁止清单里。**本轮不发明标度。**

**结论**：置信度问题今天无法被有意义地回答，因为它没有读者。记录为**已知缺口，非本轮可解**。这也解释了为什么 `principles.md:420`（「避免把 LLM 一次推断直接升级成不可质疑事实」）在今天是一条**尚不可违反的约束**——因为还没有任何地方可以把推断升级成事实。

---

## 11. Language boundary

Language 不得接 Memory，**四条相互独立的理由**：

1. **自我描述**（`src/language/plugin.ts:9`）：它「is not a brain, a planner, an action orchestrator, a tool registry, a capability registry, a global context, **memory**, a model router or a reasoning service」。
2. **暴露面**（`src/language/plugin.ts:184-189`）：变体只发布自己的清单，「What is *absent* from both variants is the argument: **no Memory, no Chronicle, no Runtime service that would make this a place other plugins reach in.**」，且 `provides: []`。
3. **代码级边界**（`src/language/dialogue.ts`）：对话态不落盘、不出进程，所以「there is nothing that could survive to be mistaken for one」。
4. **read-once 不变量**（`src/language/answer.ts:35`, `:198`）：记忆式重读在结构上不可表达（§7）。

再叠加一层：即使 Language 想看历史，它也只能通过 exposure 看——即某个 owner 自己声明的真实 capability。而今天**没有任何 owner 提供「历史」exposure**，`work-focus/index.ts:20-21` 还明确拒绝导出事实族名字，理由正是「there is still no reader that asks what this plugin's durable history says」。

**结论**：Language 的边界是**四重冗余**的。任何 Memory 路径要么穿过这四层（全部否决），要么绕开它们——而绕开等于另立一个面向模型的口子，属 C 级架构工作，不是本轮可批准的。

---

## 12. Smallest proving ground

Mandate 设想的那个最小试验场——「过去的设计ation 与当前 context 逐字相等 → 值得重新进入认知」——**已经存在，已经上线，已经冻结**：

**`src/repository-ci-relevance/`**，它已经具备：

- 逐字比较（`current-stage.md:1432`）；
- 三态但只有两值（`relevant` / `unknown`，无 `unrelated`）；
- **不缓存、不留痕**——`plugin.ts:25-27`：「There is no watcher, no loop, no cache, no Event and nothing written down: two calls a second apart are two independent judgements of two independent snapshots」；
- Service 与 endpoint **同一条代码路径**（`plugin.ts:76` 的 `judge`），不是两份今天恰好一致的副本；
- 全表测试（`test/repository-ci-relevance.test.mjs:87-108` 的真值表 + `:130-138` 的全输入穷举，断言只可能到达 `['relevant', 'unknown']`）。

Memory 能给它的唯一增量 = 把输入从 `work-focus.current@1` 换成 `chronicle.read()` 过滤 `work-focus.*`。而**这个替换正好是它 contract 头注释所否定的东西**（§8 候选 3）。

**所以「最小试验场」不是一个试验场，是一个已经结案的场。** 在它上面再叠一层不产生新知识，只产生一个新的失败面。

真正的下一个试验场必须先有两样东西：
1. 一个**「现在」**的表示（今天无名——§4 第 1 条）；
2. 一个能表达**「值得重新激活」**的 owner（今天是 Awareness，未开启——§9）。

**两者都不存在。**

---

## 13. What must NOT be generalized

本轮明确**不得**从既有实现里推广出：

1. 不得从 `work-focus.declared/replaced/cleared` 三个 type 名推广出「事实族框架」——**没有第二个族**。
2. 不得从 `repository-ci-relevance` 的两态推广出「通用 relevance」——它自己写明只读两个字符串；`current-stage.md:1432/1433` 冻结了边界。
3. 不得把 Chronicle 的 `read()` 推广成 query / index / subject key——`current-stage.md:1424` 明令不做。
4. 不得把「**provenance 因此是结构性的**」（`phase-4-explicit-human-reference-review.md:190`：reference 位于某 plugin 自己的 `config`，任何其它模块都写不进去）推广成 provenance **数据字段**。
5. 不得把 salience 从 Awareness 搬到 Memory，也不得把 Memory 的解释权搬到 Awareness。**两个方向都是越界。**
6. 不得为了「以后可能有用」预先导出事实族 type 名——`work-focus/index.ts:20-21` 已经拒绝过一次，那次拒绝是有理由的。
7. 不得让 durable fact 的写入路径产生任何「判断」——`facts.ts` 头注释。
8. 不得把 `cleared` 的 `{}` payload 事后补成带 designation——那要求**更新一条已写入的事实**，而 Chronicle 不支持 update。
9. 不得把「人类问过一次」当成 consumer 的证据——`current-stage.md:41` 的模块级门槛。

---

## 14. Unlock conditions，然后才是 implementation order

**本轮没有可实施项。**

### 14.1 Unlock conditions（Human 冻结）

重新开启 **Memory Boundary Review** 需要下列条件**同时**出现：

1. **一个真实 bounded consumer 无法仅靠 current facts 完成职责。**
   （模块级门槛，`current-stage.md:41`。注意「无法完成」是实质判据，不是「会更方便」。）
2. **该 consumer 拥有明确的 current cue。**
   （今天不存在任何「现在」的表示——§4 第 1 条。）
3. **过去材料与当前 cue 之间的 association / relevance ownership 明确。**
   （今天逐字相等是唯一合法关联且已被冻结，任何其它机制都是重新打开 `current-stage.md:1432`。）

**三者必须同时。** 部分满足不构成解锁。

### 14.2 不得为了促成解锁而做的事

- 不要为了 Memory 主动创建：Salience / Importance Judgement、Awareness capability、historical consumer、generic recall substrate、`memoryService`、semantic association、confidence、embeddings、vector DB。
- **也不要为了给 Chronicle 找 reader 而创造需求。**
- 不得把 historical query 当成 Memory 的入口——它可以在真实用户需求下独立进入，但不自动构成 Memory（§2）。

### 14.3 解锁之后的顺序（依赖关系记录，**不是批准**）

1. 先立**「现在」（cue）**与**「过去」（subject）**的命名——今天两者都无名（§4）。
2. 若需跨 owner 关联，**先做 Boundary Decision**。
3. 才谈**记忆的读侧 contract**。
4. **写入侧的修订 / 置信度 / 废弃语义**（`principles.md:404-410`, `:412-418`）必须**晚于**读侧——它需要 Memory 语义位先被批准，且需要 Chronicle 之外的 substrate（C 级）。

**明确不做**：任何 0→1 的 Memory 抽象。

---

## 15. Smallest implementation slice

**不存在。**

最小切片需要**同时**满足三个条件：

| 条件 | 今天 |
| --- | --- |
| 有一个真实 consumer | ✗（§8，五个候选全灭） |
| 有一个明确的「现在」表示 | ✗（§4 第 1 条） |
| 有一个不被冻结规则禁止的关联机制 | ✗（§6，上下两向都被封死） |

任何今天被提交的「最小 Memory」只可能是三种东西之一，**三种都不是切片，是越界**：

- 为不存在的消费者建一个 Service（违反 §16.2）；
- 把已结案的 relevance 换一个输入（§12，零增量）；
- 让 work-focus 恢复状态（明令禁止）。

---

## 16. Verdict

# **BLOCKED**

三条理由，**每条独立充分**：

1. **无真实 consumer。** `chronicleService.read()` 生产代码零调用者（§3，第一手 grep + `work-focus/index.ts:16-21` 的自述）；§8 逐条否决五个候选；人类是 client 不是 consumer（`current-stage.md:41`）。

2. **核心问题的 owner 不在 Memory 名下。** 「值不值得重新进入认知」是 Awareness 的 Salience / Importance Judgement（`principles.md:451-453`, `:466`），而该语义位被 `current-stage.md:19`/`:43` 冻结为「**仍然均未进入，且未被预埋**」，并在 `:1428` 列入 standing do-not-do。**谁来做这件事已经定了，只是还没批准它开始做。**

3. **设想的关联机制已经上线，且仓库已裁定它不能升级。** 逐字相等 = `repository-ci-relevance`，已冻结、已测试。`current-stage.md:1433` 明说 `relevant ≠ salient`。§6.2 的对抗验证进一步显示：该机制连「仓库自己允许写下的 designation」都覆盖不全（`:96`/`:97`），而 `:1432` 明令禁止补这个缝隙。

**附带结构事实**：Memory 所要求的修订语义在 Chronicle 上**无法表达**（无 update / delete / supersession，`phase-4-explicit-human-reference-review.md:184`）。所以 Memory ≠ Chronicle 不是一句口号，是结构事实——但也正因为如此，建 Memory 需要一个 **Chronicle 之外的新 durable substrate**，属 **C 级架构工作**，本轮明确不批准。

---

### BLOCKED 的准确含义

**BLOCKED 不等于永远不做。** 它意味着：**当前不存在一个能被诚实切出的第一片。**

这与 `durable-fact-admission-v0` 当时的 `NARROW` 有本质区别——那一轮能切，因为写入侧有一个真实的、已经存在的发生源（人类通过 endpoint 声明工作焦点），切片是「把已经发生的事记下来」。本轮的读侧**没有任何已经存在的东西**：没有 cue、没有 consumer、没有 owner 授权。**NARROW 需要有一个能切的面；这里没有面。**

解除条件见 §14。**在解除之前，任何 Memory 的代码都是为不存在的需求建的。**

---

### 本轮交付边界

- 未实现任何东西。
- 未修改 Runtime。
- 未创建 Memory，未创建任何 Memory contract。
- 未修改 production / tests。
- 发现的文档引用漂移（§0）只报告、未修改——这是独立 docs concern，本 commit 不处理。

### 本文件必须记录的内容（自查清单）

| 要求 | 位置 |
| --- | --- |
| Verdict = BLOCKED | §16，以及 Human Ruling |
| 三项 blocker | §16 的三条编号理由 |
| 两项 adversarial findings | **Finding 1**（逐字相等不足）见 §6.2；**Finding 2**（不存在真实 consumer，攻击失败）见 §8；方法说明见 §0 |
| Memory ≠ Chronicle 的结构原因 | §2（Chronicle 无 update / delete / supersession） |
| Unlock conditions | §14.1（三条**同时**满足） |
| 本轮无实现 / 无 Runtime / 无 Memory contract | 本表上方四条 + Human Ruling |
