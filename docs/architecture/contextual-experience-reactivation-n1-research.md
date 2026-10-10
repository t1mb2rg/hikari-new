# CONTEXTUAL EXPERIENCE REACTIVATION — N1 RESEARCH

状态：**只研究**。无实现、无新 Service、无新 Plugin、无 schema、无持久化改动、
无生产代码修改、无 commit、无 push。
基线：`main` @ `9db8d34`（本文开始时 `git status --short` 为空）

上级文档：`docs/architecture/hikari-nervous-system-stage-v0.md`（N0）。
本轮问题由 Human 提出：寻找神经系统「情境性经验再激活」的第一个真实消费者。

```
VERDICT = BLOCKED
```

**BLOCKED 的落点不是「缺当前线索」，也不是「缺可信历史」——两者今天都存在。
缺的是第三样：一个以代码形式拥有「关联」的真实消费者。**
今天唯一被授权做关联的位置是模型（Human 2026-10-08 裁决），不是任何模块。

---

## 0. 方法与被核验的东西

- 通读 Human 指定的五份文档：`hikari-long-term.md`、`hikari-current.md`、
  `hikari-nervous-system-stage-v0.md`、`experience-formation-v0-research.md`、
  `memory-reactivation-v0-boundary-review.md`；另读
  `repository-ci-attention-delivery-history-v0-boundary-freeze.md` 与
  `shared-experience-continuity-v0-boundary-review.md` 的相关章节。
- 对 `src/` 做了一次穷尽清点：**所有「读回过去材料并因此行为不同」的位置**，
  以及**所有能充当「此刻情况」的结构化值**。
- 清点由两个只读子 Agent 分头做，**每一条在本报告中出现前都由主 Agent 重新锚定到
  源码行、契约注释或可执行测试**。子 Agent 的结论未被直接采信。
- 本轮共核验 **12 处读回点**，其中跨 activation 的 **7 处**，与 Chronicle 相接的 **2 处**。

### 0.1 相对上一轮的基线变化（必须先说）

| 事实 | `memory-reactivation-v0` 写作时（2026-09-27） | 今天（`9db8d34`） |
| --- | --- | --- |
| `chronicleService.read()` 生产调用者 | **0** | **2** |
| `chronicleService.get()` 生产调用者 | 0 | **0**（未变） |
| 生产 fact 家族 | 1（`work-focus.*`） | **3** |
| 事实族 | `work-focus.declared/replaced/cleared` | 另加 `repository-ci-attention.delivered`、`language.decision-confirmed` |

新增的两个读点：`src/repository-ci-attention/plugin.ts:161`、`src/language/plugin.ts:403`。
**两者都是 owner 读自己的私有家族；都没有被任何 contract 暴露。**

### 0.2 N0 §2C 的注已经过时（本轮新发现）

N0 §2C 的 2026-10-08 注写着「`read()` 现在有 **1** 个生产调用者」。
今天有 **2** 个，新增的第二个（`language`）是那条注写作时**没有考虑过**的路径。
注的结论「Reactivation 现状：无」本轮**独立复核后仍然成立**（见 §5.2），
但它引用的计数与它考察的路径范围都需要更新——**这是本轮要提请 Human 注意的第一处文档漂移。**

---

## 1. 五个概念，钉在今天的代码上

Human 要求不得把五个概念混为一谈。判据不用定义，用**今天的生产实例**：

| 概念 | 判据（这个实例凭什么算它） | 今天的生产实例 | 锚点 |
| --- | --- | --- | --- |
| **历史查询** | 取回过去材料，材料**不因当前情境被挑选**；取什么由预算/条件决定，不由「现在是什么情况」决定 | `language.decision-confirmed` 进 prompt | `src/language/prompt.ts:178` `continuityParagraph(confirmed)` —— **形参里没有当前问题** |
| **状态恢复** | 过去的**状态**直接成为现在的状态 | `continuity` 的 `hikariId` | `src/continuity/restore.ts:10`；`src/continuity/types.ts:8` |
| **简单去重** | 只判**成员资格**；不带回内容、不做关联、不改变含义 | `repository-ci-attention` 的 `deliveredFailures` | `src/repository-ci-attention/facts.ts:125` → `:144`；判定 `judgement.ts:97-99` |
| **情境性再激活** | 当前情境与过去**产生关联**，相关的过去**重新进入当前 cognition** | **无** | — |
| **可修订的 Memory** | 可修订、带 provenance / confidence / 废弃语义 | **无** | `DurableFact` 无 update / delete / supersession（`src/chronicle/types.ts:21-28`） |

两条辅助判据，用来排除看似符合的实例：

- **`work-focus` 不是状态恢复。** `src/work-focus/session.ts:16-18` 明确写「history cannot
  restore the state」，且 `test/language.test.mjs:3350` 用 `focusReads() === 0` 钉住
  「重启时读回记录**不会**恢复工作焦点」。这条不是推测，是一个会移动的计数器。
- **`DialogueTurn` 不是 Memory，而且它自己说了理由。** `src/language/dialogue.ts:17-22`
  逐字：「Why this is not Memory, stated as a property rather than a promise… it lives in one
  plugin's activation closure, it is gone when that activation ends… nothing here outlives a
  process — there is no file, no store and no Chronicle entry behind it.」**理由是存续性，不是语义。**

---

## 2. 全量读回地图：今天所有「读回过去材料并因此行为不同」的位置

按类别排列。**「跨 activation」是本表最重要的列**：N0 §4 判据 2 要求认知性状态跨
activation 存活，activation 内的 baseline 不构成过去材料。

| # | 位置 | 读什么 | 类别 | 跨 activation | 关键测试 |
| --- | --- | --- | --- | --- | --- |
| A-1 | `src/repository-ci-attention/plugin.ts:161`（+ `facts.ts:125`、`judgement.ts:97-99`） | `repository-ci-attention.delivered` → `deliveredFailures` | 简单去重 | **是** | `test/repository-ci-attention.test.mjs:1007, 986, 1049, 1200` |
| A-2 | `src/repository-ci-attention/plugin.ts:122, 191` | `handledFailures` | 简单去重 | 否 | 同上 `:722, 763` |
| A-3 | `src/desktop-return-attention/plugin.ts:164-165`（+ `judgement.ts:89-107`） | `watch.observedTick` / `silence` | 去重 + 匹配 | 否 | `test/desktop-return-attention.test.mjs:135, 859` |
| A-4 | `src/chronicle/store.ts:180-191` | 已落盘 `factId` | 去重 | 是 | `test/chronicle.test.mjs:318` |
| A-5 | `src/continuity/initialize.ts:19`；`src/chronicle/initialize.ts:21` | 既有 origin / chronicle 文件 | 幂等守卫 | 是 | `test/continuity.test.mjs:119` |
| B-1 | `src/continuity/restore.ts:10`（+ `storage.ts:22`、`chronicle/store.ts:74-77`） | `hikariId` | **状态恢复** | 是 | `test/continuity.test.mjs:93, 108, 192` |
| B-2 | `src/cli/launch-profile.ts:44`（+ `bootstrap.ts:127-135`、`tui.ts:347, 506, 771`） | `launch.json` | **状态恢复** | 是 | `test/launch-profile.test.mjs:194, 233, 247` |
| B-3 | `src/cli/chronicle-init.ts:6`；`src/cli/start.ts:16-21` | origin + 插件状态 | 状态恢复 | 是 | `test/cli.test.mjs:101, 217` |
| C-1 | `src/language/plugin.ts:403`（`:325-329` 调用；+ `continuity.ts:134`、`answer.ts:204-207`、`prompt.ts:178-215`） | `language.decision-confirmed` | **历史查询** | **是** | `test/language.test.mjs:3003, 3037, 3305, 3323, 3368` |
| D-1 | `src/desktop-session-awareness/plugin.ts:78, 110-112, 126`；下游 `language/read.ts:83-84` | 上一帧 `DesktopSessionWorldSnapshot` | 匹配（activation 内） | **否** | `test/desktop-session-awareness.test.mjs:194, 304, 533, 800` |
| D-2 | `src/desktop-return-attention/plugin.ts:135, 164-165` | 上一次 `observedTick` | 匹配（activation 内） | **否** | `test/desktop-return-attention.test.mjs:153, 172, 564` |
| D-3 | `src/language/answer.ts:182, 192, 319-322`（+ `dialogue.ts:64, 87-93`、`prompt.ts:133-141`） | `DialogueTurn`（上一轮读过的 capability） | 匹配（activation 内） | **否** | `test/language.test.mjs:1172, 1238, 1256` |
| U-1 | `src/chronicle/service.ts:17`（+ `open.ts:13`、`store.ts:74-78`） | store header | 写入前守卫 | 是 | `test/chronicle.test.mjs:202, 214, 450` |

**`chronicle.get(factId)` 仍无任何调用者**（全仓仅 `src/chronicle/contracts.ts:5` 与
`src/chronicle/service.ts:22` 的定义）。不存在「按 id 取回某条过去事实来影响当前判断」的位置。

**结论一：与 Chronicle（即 N0 §3 意义上的「过去」）相接的读回点，只有 2 处。
其余全部是 identity、配置、或 activation 内的记账。**

---

## 3. 代码里真的存在「匹配步骤」的位置，一共两处

「情境性」的全部重量压在「匹配」上。把 `src/` 里**所有**「一个当前值被拿去与一个更早的值比对」
的位置列出来，只有两处：

### M1 — `failureKey` 相等：现在 vs Chronicle 里的过去

```
现在侧：src/repository-ci-attention/judgement.ts:97
        const key = failureKey(observation.repository, run.id);
过去侧：src/repository-ci-attention/plugin.ts:161
        for (const key of readDeliveredFailures(await chronicle.read())) deliveredFailures.add(key);
规则：  src/repository-ci-attention/facts.ts:73  `${repository}#${runId}`
```

**这是全仓唯一一处「现在」被拿去与「回顾在 Chronicle 里的过去」比对。**
它的形状值得逐条说清：

- **有 cue**（当前 CI 观察算出的 key）、**有可信历史**（owner 自己写入的 durable fact）、
  **有 owner**（同一个 Plugin）、**有跨 activation 的测试**，而且**读了之后行为确实不同**
  （`judgement.ts:98-99` 返回 `undefined` → `plugin.ts:203` 的 `speak` 与 `deliver` 都不发生）。
- 但它**不带回内容**。`facts.ts:96` 的 payload 只有 `{ repository, runId }`；`facts.ts:121-123`
  明说返回 `Set<string>` 而非 facts，理由是「the caller's whole need is membership」。
- 它**不改变含义**，只抑制一次重复动作。`judgement.ts:44-48` 逐字：「What the set is for is the
  duplicate rule, and the duplicate rule is about this activation **not doing the same work twice**,
  not about what the work achieved.」

N0 §2C 的 2026-10-08 注已经对这条下过裁定，逐字：

> 该调用者是**一个 owner 读自己私有的 fact 家族**（「我成功投递过这条 CI failure 的提醒」），
> 不是「当前情境与过去产生关联」——没有情境匹配、没有关联、没有 salience，
> 也没有把过去重新送进 cognition。

**本轮独立复核的结论：M1 的形状是「cue → 过去 → 行为不同」，但过去被压缩成成员资格，
差异表现为抑制而非含义。裁定为简单去重，成立。**

### M2 — 时间窗：现在 vs 进程内的上一轮

```
现在侧：src/language/answer.ts:192   usableDialogueTurn(turn, now)
过去侧：src/language/answer.ts:182   let turn  （activation closure）
规则：  src/language/dialogue.ts:64   DIALOGUE_CONTEXT_TTL_MS（5 分钟）
```

**匹配的是时间，不是内容。** 一个「刚才那个呢」的问题与上一轮读过的 capability 之间，
代码只判定「上一轮是不是够近」；「这句话是不是在接着说上一轮」由模型判定
（`prompt.ts:22-23` 逐字：「the model is the only thing in the loop that can tell the two apart」）。
且它**不跨 activation**（`answer.ts:182` 是闭包变量），因此不构成 N0 §4 判据 2 意义上的状态。

**结论二：代码拥有的匹配只有这两处。M1 是去重（已裁定），M2 匹配的是时间且不跨 activation。
没有第三处。**

---

## 4. 候选消费者与反事实对照

对每个候选回答 Human 的六问。**反事实一律写成可执行的形式**，不是描述。

### 候选 1 — `repository-ci-attention` 读自己的 `delivered` 家族

| # | 问题 | 答案 |
| --- | --- | --- |
| 1 | 当前情境是什么？谁拥有？ | 一次 CI 观察算出的失败身份 `failureKey(repo, runId)`；owner `repository-ci-attention`。 |
| 2 | 过去材料是什么？真实存在吗？ | `repository-ci-attention.delivered` durable fact；**存在**，落盘 `chronicle.jsonl`。 |
| 3 | 谁拥有关联和判断的语义？ | 同一 Plugin，规则是 `failureKey` 逐字相等。 |
| 4 | 不用过去会怎样？用了具体不同在哪？ | 不用：同一失败在新 activation 被重新播报一次。用了：不播报。 |
| 5 | 如何用测试证明差异？ | 已证明：`test/repository-ci-attention.test.mjs:1007`（新 activation 不再播报）、`:1049`（不误消另一仓库同号 run）。 |
| 6 | 是否跨越冻结或授权边界？ | 否。owner 读自己的私有家族，`provides: []`（`plugin.ts:93`）。 |

**裁定：不成立（作为情境性再激活）。** 它是简单去重：带回的是成员资格，不是内容；
差异是抑制，不是判断改变。N0 §2C 注已裁定，本轮复核同意（§3 M1）。

### 候选 2 — `language` 把 `decision-confirmed` 读回进 prompt

| # | 问题 | 答案 |
| --- | --- | --- |
| 1 | 当前情境是什么？谁拥有？ | 一次 `ask` 的文本与这一轮的 exposure 读数；owner `language`。 |
| 2 | 过去材料是什么？真实存在吗？ | `language.decision-confirmed`（这个人逐字确认过的句子）；**存在**，跨 activation，测试 `test/language.test.mjs:3003`。 |
| 3 | 谁拥有关联和判断的语义？ | **模型。** 逐字见下。 |
| 4 | 不用过去会怎样？用了具体不同在哪？ | 不用：`answer.ts` 的单向门不打开，人类拿到的是读数块。用了：模型自己的合成句可以交给人类（`answer.ts:248-253`）。注释逐字：「A machine with no record has no route in its prompt and no exception to exercise: it gets an answer that is byte-for-byte what it got before this existed.」 |
| 5 | 如何用测试证明差异？ | 已证明：`test/language.test.mjs:3037`（段落用途）、`:3305`（没确认过的重启不回来）、`:3323`（删掉记录后不装作记得）。 |
| 6 | 是否跨越冻结或授权边界？ | **否——它就是边界本身。** 2026-10-08 Human 裁决九条，`VERDICT = READY`。 |

第 3 问是全部要害，三处逐字证据：

- `src/language/continuity.ts` 的 `selectConfirmedDecisions` 头注释：
  「There is no ranking, no filtering by subject, **no relevance to the question being asked**
  and no scoring of any kind — those would each be this plugin deciding which of a person's own
  statements matters, which is a judgement nothing here is entitled to make and which
  **the model is the only thing in the loop already positioned to make**.」
- `src/language/prompt.ts` 段末：「which of them is relevant to the question on the table is
  **not decided here**, because the model is the only thing in the loop already positioned to
  decide it」。
- `src/language/prompt.ts:178` 的函数签名 `continuityParagraph(confirmed)` ——
  **连当前问题的形参都没有**。选择与问题无关，这是结构事实，不是注释承诺。

`shared-experience-continuity-v0-boundary-review.md` §12.4 亦逐字：**关联由模型判断**。

**裁定：不成立（作为「以代码拥有情境关联」的消费者）。**
它是一个真实、已授权、有测试的反事实：**过去材料跨 activation 回来，行为确实不同。**
但**挑选与关联不在代码里**——代码带回来的是一段与问题无关的连续尾部，
真正的情境关联发生在模型的 context 里。按 N0 §2C 的定义原文，这正是被列为对照项的那一半
（§5.2）。

### 候选 3 — `language` 的对话指代 `DialogueTurn`

1. 当前情境：这一轮的问题文本；owner `language`。
2. 过去材料：上一轮 grounded 回答读过的 capability 名 + 时刻；**存在，但在进程内**。
3. 关联 owner：**模型**（`prompt.ts:22-23`）+ 代码只判时间窗（`dialogue.ts:64`）。
4. 差异：不用→「那现在呢」无主语，模型重新决定读什么；用了→带着上一轮的 capability 继续读。
5. 测试：`test/language.test.mjs:1172, 1238, 1256`。
6. 边界：`dialogue.ts:17-22` 自我声明这不是 Memory，理由是**不跨进程**。

**裁定：不成立。** 匹配的是时间而非内容，且不跨 activation，
不满足 N0 §4 判据 2 对「过去」存续性的要求。

### 候选 4 — `desktop-session-awareness` 的 baseline

1. 当前情境：本帧 `DesktopSessionWorldSnapshot`；owner `desktop-session-awareness`。
2. 过去材料：上一帧快照；**进程内闭包变量** `plugin.ts:78`。
3. 关联 owner：该 Plugin，规则是 `compareForeground` / `compareInputActivity` 的字段相等。
4. 差异：无 baseline → `kind: 'baseline'`（不判定）；有 → `changed` / `stable` / `indeterminate`。
5. 测试：`test/desktop-session-awareness.test.mjs:194, 304, 533, 800`。
6. 边界：`contracts.ts:76-77` 逐字「The baseline belongs to the plugin instance and is
   **activation-local**」。

**裁定：不成立。** 它确实是「与上一次比」，但那一次不跨 activation
（`contracts.ts:77`：reload 后回到 `baseline`）。这是**序列内的比较**，不是过去材料。

### 候选 5 — `desktop-return-attention` 的 `watch`

1. 当前情境：本帧 `InputActivityObservation`；owner `desktop-return-attention`。
2. 过去材料：上次的 `observedTick` / `silence`；**进程内**（`plugin.ts:135`）。
3. 关联 owner：该 Plugin，规则是 counter 相减（`judgement.ts:100`）。
4. 差异：无 watch → 无法识别「沉默结束」；有 → 形成 occurrence 并投递。
5. 测试：`test/desktop-return-attention.test.mjs:135, 153, 172, 564, 859`。
6. 边界：`judgement.ts:22-25` 明说这个文件**不被允许**问「这段沉默是否长到值得在意」；
   `judgement.ts:40-42` 明说不需要 dedup，理由是「a silence is a fact about **this activation's
   own history**」。

**裁定：不成立。** 设计上主动拒绝了跨 activation 的过去材料。
`experience-formation-v0-research.md` §4 案例 B 已把它的影响面评估为接近零并主动撤回该候选。

### 候选 6 — `work-focus` 的 designation 集合被 `repository-ci-relevance` 消费

1. 当前情境：当前 CI 观察（`repository-ci-awareness`）；owner `repository-ci-relevance`。
2. 过去材料：`work-focus.*` 三个 fact 家族——**存在，且今天没有任何读者**。
3. 关联 owner：**没有。** `judgement.ts:63` 只有 `designation === repository`。
4. 差异：见下。
5. 测试：`test/repository-ci-relevance.test.mjs:96-101`（真值表证明逐字相等不足）。
6. 边界：**是。** `memory-reactivation-v0` §8 已明确封死此路。

**裁定：不成立，且是被明确禁止的一条。** 把输入从 `work-focus.current@1`
改为 `chronicle.read()` 会推翻契约自己的头注释——`repository-ci-relevance/contracts.ts:27-29`
逐字：「There is no cache, no stored last answer, and no second judgement…
which is the only shape in which "relevance" is a question about **now** rather than
**a memory of a previous answer**.」同样的话在 `repository-ci-awareness/contracts.ts` 里再出现一次
（「nothing is remembered between calls」）。

### 候选 7 — 「同一分支上 CI 恢复了」这一类尚未建成的候选（反例，列出来是为了说明它为什么必然失败）

这是最容易想到、也最像「情境性」的一个：当前情境是「CI 现在是绿的」，
过去材料是「我告诉过你这个分支红过」，差异是「说一句已恢复」。

它失败在两处，两处都不是实现细节：

- **关联不存在，且无权建立。** delivered 的 key 是 `repo#runId`。恢复意味着一个**新的 run id**。
  「run 124 取代 run 123」这条规则**今天在任何地方都不存在**，建立它就是在
  「逐字相等」之外新开一条关联机制——`memory-reactivation-v0` §14.1 第 3 条的正面违反。
- **判断是 salience。** 「这次恢复值不值得说」正是 `repository-ci-attention/judgement.ts:10-12`
  与 `desktop-return-attention/judgement.ts:22-25` 都逐字拒绝去问的问题。

**裁定：不成立，且它同时说明了一件事——今天所有「看起来像情境性再激活」的未建成候选，
卡点都收敛到同一个位置：关联语义没有代码 owner。**

---

## 5. 裁定汇总

### 5.1 七个候选，两条独立理由

```
候选 1（delivered 去重）      不成立：简单去重（N0 §2C 注已裁定，本轮复核同意）
候选 2（decision-confirmed）  不成立：关联 owner 是模型，不是代码
候选 3（DialogueTurn）        不成立：匹配的是时间，且不跨 activation
候选 4（awareness baseline）  不成立：activation 内的序列比较
候选 5（return watch）        不成立：设计上拒绝跨 activation
候选 6（work-focus → relevance）不成立：被 §8 明确禁止
候选 7（CI 恢复类）           不成立：关联无权建立 + 判断是 salience
```

### 5.2 N0 §2C 的「现状：无」，本轮独立复核后成立

§2C 的定义原文把两件事对照着写：

> **行为**：当前情境与过去产生关联时，相关的过去可以重新进入当前 cognition，
> **而不是「过去永远塞进 prompt」。**

前半句今天**没有任何实例**。后半句——被明列为**反面**的那一半——
今天有一个几乎逐字对应的实例：`language` 把一段**与当前问题无关**的连续尾部
无条件下进 prompt，把「哪一条与这个问题相关」交给模型（§4 候选 2，三处逐字证据）。

**这正是本轮最需要 Human 注意的地方**：N0 写下这句对照时，`language` 的这条路径还不存在
（§0.2）。所以「§2C 现状：无」这个结论在本轮复核后仍然成立，
但它成立的理由已经从「没有人在读过去」变成了「读过去的那条路径，关联归模型」——
**理由变了，结论没变，而这个变化本身需要被记下来而不是被淹没。**

### 5.3 这条 BLOCKED 与 `memory-reactivation-v0` 的 BLOCKED 不是同一条

| | `memory-reactivation-v0` | 本轮 N1 |
| --- | --- | --- |
| 读侧 | 完全为零 | 有 2 处，且跨 activation |
| 关联 owner | **不存在，且未被预埋** | **存在，但被指派给了模型**（Human 2026-10-08） |
| 结论 | BLOCKED | BLOCKED |

**这是本轮唯一实质性的新信息：缺的不是一个尚未出现的能力，而是一个已经做出的指派。**
因此本轮不能像上一轮那样，把 BLOCKED 归因于「语义位尚未进入」；
它必须归因于「语义位已经进入，但进在了模型里」。

---

## 6. 最有希望的一个候选

**就 Human 六问全部满足而言：一个也没有。**

最接近的是**候选 2（`language` 读回 `decision-confirmed`）**：它满足第 1、2、4、5、6 问——
有真实当前情境、有真实可信历史、有可测的反事实差异、不越过任何冻结边界。
它只在第 3 问上不同：**关联的 owner 是模型。**

这是**唯一一个「差一项」的候选**，而且差的这一项不是缺能力，是缺代码所有权。
它的反面（M1，候选 1）差的则是「内容」：有 cue、有 owner、跨 activation，
但过去被压成成员资格，差异是抑制不是含义。

**两个「差一项」的候选，差的是两个不同的项。没有任何一个同时具备两者。**

---

## 7. 需要 Human 裁决的最小问题

**一个问题，一个判读：**

> N0 §2C 的「情境性再激活」，是否要求**关联步骤由代码拥有**？
>
> - **若「否」**（模型做关联即可）：**N1 的消费者已经存在**，就是 `language` 对
>   `decision-confirmed` 的读回，且它已于 2026-10-08 被裁决（L2，`VERDICT = READY`）。
>   N1 无需 Boundary Review，也无需任何新代码；剩下的事情是把 §2C 的措辞与其
>   2026-10-08 注更新到位。
> - **若「是」**（关联必须由某个模块拥有）：**N1 = BLOCKED**，缺的是关联 owner。
>   而今天唯一合法的关联是逐字相等（`repository-ci-relevance`，取值 `relevant | unknown`，
>   已冻结），唯一落成代码的实例是去重（M1，已裁定不算）。
>   此时下一步不是实现，而是 Human 决定**是否授权在「逐字相等」之外开启一条关联机制**——
>   那是 `memory-reactivation-v0` §14.1 第 3 条的对象，不是本报告的对象。

**为什么这不是可以自己决定的事**：`CLAUDE.md` §二把「已冻结的架构原则」放在最高位，
而 N0 §2C 的定义原文与 Human 2026-10-08 的九条裁决，在这一点上**指向相反方向**且都属高位。
两个高位来源冲突时，只能由 Human 裁决，不能由执行 Agent 选一个。

**本轮没有为了绕开这个问题而做的事**：没有把模型关联改写成代码关联、
没有扩充 prompt 特例、没有给 `decision-confirmed` 加 relevance 字段、
没有动 `repository-ci-relevance`、没有新建任何 Service / Plugin / fact 家族。

---

## 8. N1 是否具备进入 Boundary Review 的条件

```
READY: NO
```

**理由：Boundary Review 的对象是一个待冻结的边界；本轮没有找到需要冻结的边界。**

`memory-reactivation-v0` 的 §14.1 三条解锁条件，本轮的逐条结果：

| 条件 | 本轮结果 |
| --- | --- |
| 1. 一个真实 bounded consumer 无法仅靠 current facts 完成职责 | **未出现。** 七个候选全部仅靠 current facts 即可完成职责 |
| 2. 该 consumer 拥有明确的 current cue | **已出现**（M1 的 `failureKey`；`language` 的问题文本） |
| 3. 过去材料与当前 cue 之间的 association / relevance ownership 明确 | **部分**：已建成路径上明确归模型；未建成路径上无 owner |

**三条不同时成立，§14.1 的解锁条件未满足。** 与上一轮不同的是，第 2 条本轮**已经出现**——
这是相对 `memory-reactivation-v0` 基线的真实进展，值得记录，但它单独不构成解锁。

**唯一可能的 Boundary Review 对象，是「授权一条新关联机制」本身**（§7 的第二个分支）。
在那之前，本报告不提出任何实现切片。

---

## 9. 本轮明确不做的事（与约束逐条对照）

| Human 约束 | 本轮执行 |
| --- | --- |
| 不开发 Memory / Experience Store / 新认知框架 | 未开发。全文零新增代码 |
| 不预设神经系统必须有代码实体 | 未预设。§8 明确未找到需要冻结的边界 |
| 不增加全局 Salience / Model Router / Central Brain | 未增加。§4 候选 7 反而用 salience 禁令否掉了候选 |
| 不为找消费者而虚构需求 | 候选 6、7 是被否掉的，不是被包装成成立的 |
| 不通过追加 Prompt 特例制造关联能力 | 未追加。§4 候选 2 是把现状**如实报出**，不是提议加特例 |
| 不默认解除 Memory Reactivation 既有冻结 | 未解除。§4 候选 6 明确引用 §8 的封死 |
| 不修改生产代码 | 未修改。`src/` 与 `test/` 零改动 |
| 允许 BLOCKED | `VERDICT = BLOCKED`（§5.3 说明了它与上一轮 BLOCKED 的不同） |
| 缺什么就指出缺口，不制造实现任务 | §6 指出无候选全满足；§7 只提一个问题；§8 不给实现切片 |

---

## 10. 本报告确立的事实清单（供后续轮次直接引用）

1. 基线 `main` @ `9db8d34`，`src/` 与 `test/` 零改动。
2. `chronicleService.read()` 生产调用者 **2**（`repository-ci-attention/plugin.ts:161`、
   `language/plugin.ts:403`）；`get()` **0**。
3. 生产 fact 家族 **3**。
4. 全仓「读回过去材料并影响当前行为」的位置 **12 处**（§2 表），
   其中跨 activation **7 处**，与 Chronicle 相接 **2 处**。
5. 全仓代码拥有「匹配步骤」的位置 **2 处**（§3）：M1 `failureKey` 相等（去重，已裁定），
   M2 时间窗（不跨 activation）。
6. 全仓「现在」与「Chronicle 里的过去」相接的位置 **1 处**（M1），
   且它刻意不发布 contract（`provides: []`）。
7. `language` 的 record 段选择**与当前问题无关**，是结构事实：
   `continuityParagraph(confirmed)` 没有问题的形参（`prompt.ts:178`）。
8. 关联语义在已建成路径上归**模型**，三处逐字证据（`continuity.ts`、`prompt.ts` ×2）
   + Human 裁决（`shared-experience-continuity-v0` §12.4）。
9. N0 §2C 的 2026-10-08 注引用的 `read()` 计数（1）已过时，且它未考察 `language` 这条路径。
10. `work-focus` 的读回禁令有测试钉住：`test/language.test.mjs:3350`，
    判据是 `focusReads()` 计数器，激活时 `0`、显式问焦点后 `1`。
