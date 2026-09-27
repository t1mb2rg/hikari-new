# OUTBOUND COMPOSITION v0 — BOUNDARY REVIEW

- 日期：2026-09-27
- 轮次性质：**只设计**。不实现、不修改 Runtime、不创建 registry、不创建 optional requires、不创建 generic Notification Service、不 commit production code。
- 前置：`docs/architecture/human-outbound-v0-boundary-review.md`（裁决 **NARROW**）。
- 本文回答的是**组合问题**，不是「要不要做主动出站」——后者已由 Human 裁决。

## Human ruling（已冻结，本轮不再讨论）

1. Work Focus / repository scope **不承担** interruption authority。
2. 第一 concrete outbound transport 选择 **long-lived local subscriber**。
3. Human Outbound implementation 前**必须**先完成 Composition Boundary Review（**本文**）。
4. Windows Toast 保留为 future transport candidate，**不进入** v0 first slice。
5. Repository CI Attention **继续保持 BLOCKED**，直到 Human Outbound path 合法成立。

---

## Human ruling（第二轮 · 本文交付并经过反锚后作出）

> **本节的效力高于上文与正文。** 上文 ruling #5，以及正文 §9.4 / §15.7 / §16.2 / §17.2 / §19 中的若干**判断**（**不是**源码事实）被本节覆盖。**正文原样保留、不修改**，以便追溯本文当时究竟说了什么。

### R1. 执行次序修订 —— Repository CI Attention 与 Human Outbound 联合进入

**修订上文 ruling #5。**

原裁决要求 Repository CI Attention 等待 Human Outbound 完成。该次序**正式作废**，原因是它构成死锁：

```text
Human Outbound 的 public speaking contract
  需要第一个真实 consumer，才满足 Contract Creation Gate（本文 §14.3）；
Repository CI Attention
  又因缺 Human Outbound 而无法独立完成（上文 ruling #5）。
```

两者不再按先后独立实现，而作为**同一个 slice 联合进入**：

```text
PROACTIVE REPOSITORY CI v0 — JOINT SLICE
```

**这不是对 cosmetic provider 的让步，方向恰好相反：**

- Language speaking capability **只有**因为 Repository CI Attention 在同一 implementation slice 中成为**真实 consumer**，才允许建立；
- Subscriber transport **只有**因为该 speaking path 在同一 slice 中**被真实使用**，才允许建立。

**不得先实现任一空壳等待未来。** 本文 §17.1「没有可以诚实切出的第一片」在**单独立项**的前提下**仍然成立**——它的解除条件是**联合立项**，不是时间流逝。

### R2. `decider` 与 `subscriber` 不属于同一个 variant axis

**冻结：**

```text
Repository CI Attention membership
  = static structural authorization   （组合期决定，静态）

Subscriber connected / disconnected
  = transient transport availability  （运行期状态，瞬态）

authorized ≠ connected
connected  ≠ authorized
```

由此直接得出：

- subscriber transport plugin 在**没有 Human client 时仍应 `active`**；
- client absence **只能**成为 `deliver` 的 outcome，**不得**造成：
  - Language `waiting`
  - transport plugin `waiting`
  - Runtime failed
  - composition invalid
- **不得**为 connection state 创建 Language variants。

这回答了本文 §16.2 末段登记的「**一个授权轴还是两个**」：**不是两个轴**——因为 connection state 根本不产生轴，它不是组合期的可选性，而是运行期的瞬态。

### R3. Speaking authorization 规范化 —— supersede 不变量 #4 的歧义解释

**superseding earlier ambiguous interpretations.**

本文 §9.4 记录了本轮与 `repository-ci-attention-v0-boundary-review.md:559` 对不变量 #4 的**相反读法**，并把该分歧列为必须由 Human 处理。**本节直接覆盖这一歧义**——两份文档的旧读法都不再被用来推断 speaking authority。

规范化后的语义：

```text
Transport opt-in 只意味着：
  「当前 Human client 愿意接收 unsolicited Hikari output。」

它不授予任何 Domain concern speaking authority。
```

```text
Domain speaking authority 仅当以下两条同时成立才存在：
  1. 一个 bounded consumer 有明确 product mandate；
  2. composition 显式让该 consumer requires speaking capability。
```

两者严格分离，合起来才可能产生一次投递：

```text
Domain authorization  +  Transport availability  →  possible delivery
```

**以下任何一条都不单独产生 speaking authority：**

| 不产生授权的项 | 依据 |
|---|---|
| Work Focus | 上文 ruling #1 |
| `--repository` scope | 上文 ruling #1 |
| subscriber connected | R2 —— 那是 transient availability |
| Language speaking capability **存在** | 本文 §4.4 —— capability existence ≠ authorization |
| transport Service **存在** | 同上 |

**Runtime 不理解 authorization semantics。Runtime 只执行 `requires` / `provides`。**（本文 §4.4、§6）

### R4. Material shape 暂不泛化

本文 §5.3 已经建立：简单 `speak(exposure)` **不能**被视为已证明能承载第一个真实 judgement output。

**禁止现在创建：**

```text
SpeakMaterial / GenericGrounding / EpistemicPayload /
UniversalMessage / generic prompt envelope
```

第一 consumer 已经明确（**Repository CI Attention**），因此 material shape **必须由这个真实 consumer 反向推出**。硬约束：

- 不能是 arbitrary string
- 不能是 arbitrary prompt
- Domain 不生成 conversational prose
- Language 不重新做 repository / CI judgement
- Transport 不理解 Domain semantics
- 不创建 universal epistemic object

允许调查：**A.** owner-specific structured material；**B.** owner-specific read handle；**C.** repo precedent 支持的更小形状。

**若不存在一个窄形状**——除非让 Language import repository-specific semantics、或建立 universal envelope——**立即停止并报告 blocker。不要为了继续实现而突破这个边界。**

---

### 本节对本文其余部分的效力

| 本文的 | 状态 |
|---|---|
| **源码事实**（带 `file:line`） | **不变**，仍可复核 |
| §3 / §4 / §10 / §12 E 的**方向结论** | **不变**，与 R1–R4 一致 |
| §16.2 末段「一个授权轴还是两个」 | **由 R2 回答**：不是两个轴 |
| §9.4 的不变量 #4 读法 | **由 R3 supersede**，两份文档的相反读法不再承重 |
| §15.7 对 standing grant 的限定 | **由 R3 取代**，且方向一致（授予通道，不授予判断） |
| §17.2 的次序冲突 | **由 R1 解除**：两者联合立项，不再互为前提 |
| §19.1「READY 还差第二件事」（material 开口） | **仍然成立**，由 R4 约束其解决方式 |
| 本文标题行「**只设计**」 | 描述的是**本文写作时的轮次性质**；R1 之后进入 JOINT SLICE 实现 |

---

## 0. 方法与证据

### 0.1 本轮的问题是什么

本轮被要求回答的核心问题只有两个，其余各节都是它们的分支：

```text
核心问题一（§一）：Repository capability 与 Outbound speaking capability
                  是否真的是同一种 composition dimension？

核心问题二（§十四）：named variant guard 被触发后，答案是不是「抽象 variants」？
                    还是「不要把反向 dependency 错当成 variant」？
```

两条都**不得预设**。本轮的做法是：先把「组合今天是什么」用源码钉死（§1），再把 guard 的判据逐字取出来（§2），然后才允许给出答案（§3、§14）。

### 0.2 第一手读取过的承重材料

本轮所有结论都建立在下表之上。凡未在下表的，本文不作断言。

| 材料 | 位置 | 本轮取到的事实 |
|---|---|---|
| Runtime 跨插件机制 | `src/runtime/plugin-context.ts:17-41` | 只有 `services.get/provide` 与 `events.on/emit` 两种；闸门分别是消费者自己的 `requires`、provider 自己的 `provides`；`events.on` **无闸门** |
| Service 注册表 | `src/runtime/service-registry.ts:13-45` | `has()` 只看 registry 里有没有这个 key，与「谁在用它」无关 |
| Runtime 调度 | `src/runtime/runtime.ts:84-111` | `#requirementsSatisfied` = 每个 `requires` 的 key 都在 registry 里；`#reconcile` 只在 `requires` 不满足时失活，**从不因「没有 consumer」失活** |
| Runtime 供给校验 | `src/runtime/runtime.ts:134-139` | `provides` 在 setup 之后被逐个核对，`isProvidedBy` 只校验 owner 身份 |
| Language variant 形状 | `src/language/plugin.ts:148-161` | `LanguageVariant = { requires, exposures, makeReader }`——**三个字段，没有第四个** |
| Language definition | `src/language/plugin.ts:183-247` | 两个 variant **共用**这一份 definition；`id`/`version`/`provides`/`config`/`setup` 全在共用部分 |
| Language 唯一说话路径 | `src/language/plugin.ts:239-245` | `listenLanguageEndpoint({ handle: (request) => answerer.answer(request.text) }, path)` + `context.defer(() => endpoint.close())` |
| base variant | `src/language/plugin.ts:323-335` | `requires: [workFocusCurrent, desktopSessionAwarenessPeek]`，`exposures: LANGUAGE_EXPOSURES` |
| repository variant | `src/language/plugin.ts:370-388` | base 两个 + `repositoryCiRelevance`，`exposures: LANGUAGE_REPOSITORY_EXPOSURES` |
| variant guard（源码落点一） | `src/language/exposure.ts:40-48` | 见 §2.1 逐字 |
| variant guard（源码落点二） | `src/language/plugin.ts:58-61`、`:320-321` | 见 §2.1 逐字 |
| exposure 不带权限 | `src/language/exposure.ts:56-63` | 「**What an entry does not carry: any permission.**」 |
| Language barrel | `src/language/index.ts:40-46` | 「**There is still no Service to export, in either variant.**」 |
| 人类可见输出的既有形状 | `src/language/types.ts:74-78` | `LanguageReply = { outcome: 'chatted'\|'answered'\|'refused'\|'failed'; lines: readonly string[] }` |
| 既有表达函数 | `src/language/express.ts:57-60, 75-97` | `GroundedBlock { name, lines }`；`renderAnswer(blocks, contextUsed)`——**没有 `contextUsed === null` 分支**，null 是 `:79` 的 `if (contextUsed !== null)` 的 fall-through，落到 `:96` |
| 既有读取器 | `src/language/read.ts:76, 78, 110` | `ExposureReader = (exposure) => Promise<readonly string[]>`；两个工厂 |
| domain 侧先例：Service 为何被扣留 | `src/repository-ci-relevance/contracts.ts:4-18` | 「`hikari relevance` is a *client*, not a consumer」；「nothing called this judgement」 |
| domain 侧先例二：先建、后接 | `git log -S chronicleService -- src/` | `e430358`(2026-09-15) provides → `0ee95a5`(2026-09-24) 首个 consumer，**9 天 / 55 commits** 无 in-composition consumer |
| consumer 侧先例：无 Service 的出口 plugin | `src/desktop-session-observe/plugin.ts:59-61, 85-86, 102-115` | `requires: [desktopSessionAwarenessPeekService]`（`:85`）、`provides: []`（`:86`）、自持端点 + `handle()` 返回 `{ outcome: 'ok', lines }` |
| 唯一「主动」先例 | `src/desktop-session-awareness-loop/plugin.ts:43-120` | `requires: [desktopSessionAwarenessService]`（`:47`）、`provides: []`（`:50`）、发一个 **0 订阅者**的 Event（`:85`） |
| cosmetic provides 禁令 | `docs/architecture/plugin-design-spec.md:240`、`:499` | **MUST** 不得为「看起来有输出」声明没有真实消费者的 Service——§14.3 与 §17.1 的承重依据 |
| Contract Creation Gate 的三条独立判据 | `docs/architecture/plugin-design-spec.md:287`、`:530`、`:547-550` | SHOULD「测试方便不是扩大 public API 的充分理由」；「若主要理由是『以后可能有用』，默认不创建」；Service 平面要求真实 callable need |
| 0 订阅者合法 | `docs/development/current-stage.md:693` | 「**0 个订阅者是合法状态**——Event 是通知，不是待办。」 |
| 组合根纪律 | `src/cli/resident.ts:113-192, 198-252, 265-323` | 四种合法组合（`:117-122`）、base 九成员 roster（`:198-252`）、chain 五成员 roster（`:289-312`）、「deliberately not a Profile system…」（`:162-166`）、组合角色不得拥有 domain opinion（`:186-190`） |
| Contract Creation Gate | `docs/architecture/plugin-design-spec.md:519-569` | §16.1 / §16.2 逐字，见 §14 |
| 能力四层分离 | `docs/architecture/principles.md:207-227`（§5） | `Existence ≠ Exposure ≠ Authorization ≠ Execution` |
| Presentation 独占表达 | `docs/architecture/principles.md:475-495`（§15） | `Domain Result → Presentation → RenderedMessage → Transport` |
| Speech Sovereignty | `docs/development/language-tool-use-loop-v1.md:213-220`（§8） | 四条不变量，第四条：**Domain Plugin 不获得 user-facing speaking turn** |
| variant guard 的设计记录 | `docs/development/judgement-reachability-v0.md:104-118`（§4.1） | 见 §2.2 |

**机械核对**：`grep -rln language src/repository-ci-relevance src/work-focus src/desktop-session-awareness src/chronicle` → **零命中**。全 `src/` 只有 `src/cli/resident.ts:37` 与 `src/cli/ask.ts:45` 导入 language。**没有任何 domain plugin 引用 Language。** 这条事实在 §4、§5、§16 反复承重。

### 0.3 本轮未测事项（不得读成 PASS）

- **没有跑测试**。本轮零源码改动，`test/` 下 29 个测试文件未被触发；本文任何「既有行为如此」都是**读源码**得出，不是执行得出。
- **没有真实模型端点**。本机无法访问外部模型 endpoint，任何与模型语义相关的判断在本轮**未验证**（这是既有事实，不是本轮新增限制）。
- **没有跑 `detect_changes` 作为「已验证」的证据**。本轮唯一产物是**未跟踪**文档，`git diff` 按定义看不见它；若跑，得到的 0 必须读作「**未看见**」而不是「无影响」。收口时如实报告。
- **没有做 Windows toast 实测**。Human ruling #4 已把它移出 v0，本轮不测。

### 0.4 本文经过只读对抗性评审，初稿的错误逐条改在正文里

初稿完成后，本文按 CLAUDE.md §九 做了一轮 **fan-out 对抗性评审**：六个**只读**子 Agent，各自负责一个独立研究面（variant 机制 / Runtime 机制 / Contract Creation Gate / 表达层形状 / 组合与前例 / 红队攻击裁决），互不重复调查，主 Agent 负责综合。

**纪律：子 Agent 的结论只是候选，必须由主 Agent 重新锚定到源码、git history 或可执行行为才进入正文。** 没有 concrete failing scenario 的发现一律不采纳。本轮据此做了两件事：

- **采纳并改在正文里**（每处都标注了「初稿……评审打掉了」）：§2.3 的判据归因、§3.2 的射程、§5.3 的 material 开口、§7.2 的理由二与理由四、§9.4 的不变量读法分歧、§12 D 的拒斥判据、§13.1 的链路画法、§13.3 的对称性推理、§14.3 的机制依据与 `chronicleService` 反例、§15.7 的 standing grant、§16.2 的轴数、§16.3 的 waiting、§17.1/§17.2/§17.3 与 §19 的多处。
- **明确不采纳**：有一条子 Agent 发现称「`repository-ci-attention-v0-boundary-review.md` §14.3 说过两条链『互为前提』」——**该引文在源文档中不存在**（grep 零命中），据此不采纳，正文也没有据此改写。

**因此本文有两类句子，读的时候要分开**：一类是**源码事实**（带 `file:line`，可复核）；一类是**本轮的判断**（例如 §9.4 对不变量 #4 的读法、§15.7 对 standing grant 的限定），它们**不因为写在这里就成立**，已在各节标明，并在 §19.3 汇总成待 Human 处理的分歧。

### 0.5 术语

- **入站（inbound）**：组合里的别人 → Language。今天只有一种：`Language requires <domain service>`。
- **出站（outbound）**：Language → 组合里的别人。今天**为零**（`provides: []`）。
- **speaking capability**：本轮的候选名，指「让 Language 形成一句 human-facing 的话」的契约。**本轮不创建它。**
- **decider**：将来回答「这件事值得说吗」的那个 owner。**它今天不存在**，且 `current-stage.md` 把 Salience / Notify 整条链冻结为「未进入，且未被预埋」。本文用它作占位符，不用它作设计承诺。

---

## 1. Current Language composition model

### 1.1 两个具名 variant，一份共用 definition

```text
baseLanguageVariant        requires: [workFocusCurrent, desktopSessionAwarenessPeek]
                           exposures: LANGUAGE_EXPOSURES（2 项）
repositoryLanguageVariant  requires: [workFocusCurrent, desktopSessionAwarenessPeek,
                                      repositoryCiRelevance]
                           exposures: LANGUAGE_REPOSITORY_EXPOSURES（3 项）
```

两者经 `buildLanguagePlugin(createModel, variant)`（`plugin.ts:179-248`）装配成**同一份** `PluginDefinition`：

```ts
id: 'language',
version: '1.0.0',
requires: variant.requires,   // ← variant 决定
provides: [],                 // ← 共用，variant 不参与
config: { parse: readConfig },
async setup(context, config) { … }
```

`setup` 的内部也**只有两处**读 variant：`variant.makeReader(context)`（`plugin.ts:226`）与 `variant.exposures`（`plugin.ts:236`）。连同 definition 上的 `requires: variant.requires`（`plugin.ts:188`），整个共用 body 一共只有**三处**。其余（平台门、凭据、model connection、endpoint、cleanup 顺序）两个 variant **逐字相同**。

### 1.2 variant 到底承载什么（§三 要求不得混称）

**答案是 A 与 B 并列，各是一份「写下来的字面清单」，A 受 B 单向约束。不是「A 由 B 派生」。**

> **本节的初稿写成「A 由 B 派生、一个 exposure 能被列出来当且仅当它在 requires 里」，该陈述已被对抗性评审推翻，此处逐字更正。**

- **B. dependency set** —— `requires` 是 variant 的第一字段：「这个 Language 实例读哪些 Service」。
- **A. model tool exposure policy** —— `exposures` 是 variant 的第二字段，它是一份**写下来的字面清单**（`exposure.ts:114-117`、`:127-131`），**不是**从 `requires` 推出来的。`exposure.ts:34-38` 逐字否认派生：「**each list is a fixed set, written down, in the order a model is shown it. The derivation would save three lines and cost the only claim either list makes. This is also not a master table plus a filter: there is no table, no predicate and no capability that is in one list by virtue of anything other than being written there.**」
- **两者之间真实存在的约束是单向的**：`test/language.test.mjs:1444`（断言在 `:1453-1456`）遍历 `variant.exposures`，逐项断言 `variant.requires.includes(exposure.service)`，即 **exposures ⊆ requires**。**反方向没有任何东西保证**——一个 variant 完全可以 `requires` 了某个 Service 却不在 `exposures` 里列出它，测试照样通过，也没有任何地方会抛错。
- **`read.ts` 从不读 `requires`。** 初稿把 `read.ts:86` 的抛出说成「对不在 `requires` 里的 exposure 抛错」，这是错的：那个 throw 在 `createExposureReader`（`read.ts:78-88`）里，判据是「**这个 build 能不能读这个 capability**」；`createRepositoryExposureReader`（`:110-121`）的最后一条分支是 `return readBase(exposure);`（`:118`），不是抛错。两处都不曾看过 `requires`。
- **不是 C. product profile** —— `resident.ts:162-166` 逐字：「This is deliberately **not a Profile system**, a capability registry, an optional-plugin mechanism or a conditional-composition framework, and it should not become one.」选 variant 的输入**只有 repository 配置**（`resident.ts:255`、`:275`）；model 配置只决定「这次组合里要不要加载 Language」，不参与 variant 选择（`:278`、`:321-323`）。不存在「产品模式」这个东西。
- **不是 D. 其他** —— `LanguageVariant` 只有三个字段（`plugin.ts:148-161`），没有第四个可以承载别的东西。

**一句话**：**variant = 「这个 Language 读什么、以及在此基础上把其中哪几项摆给模型看」的一份具名答案。A 与 B 是两份并列的字面清单，约束是单侧的（A ⊆ B），而 `provides` 不在其中任何一个里。**

**这个更正不影响 §3 的结论**：无论 A 是派生的还是写下来的，`provides` 都不在 variant 的三个字段里，出站仍然进不了 variant 机制。

### 1.3 组合如何选 variant

`resident.ts:275-278` 与 `:321-323`：

```ts
if (repositoryCi === undefined) {
  return model === undefined ? base : [...base, languageMember(languagePlugin, model)];
}
…
return model === undefined
  ? [...base, ...chain]
  : [...base, ...chain, languageMember(repositoryLanguagePlugin, model)];
```

即：**repository 配置存在 → 选 repository-aware variant**。四种合法组合（`resident.ts:117-122`）：

```text
base                        九成员
base + language             当且仅当 --model-endpoint + --model
base + chain                当且仅当 --repository-root + --repository
base + chain + language     四者齐全
```

### 1.4 Language 今天对组合的唯一「接口」是它自己的端点

`plugin.ts:239-245`：Language 起一个命名管道 server，`handle` 里调用 `answerer.answer(request.text)`。谁连上来谁就是**人**，不是 plugin。`index.ts:44-46` 逐字：

> **There is still no Service to export, in either variant.** Offering a capability to a model is the opposite direction from providing one to the composition, and nothing in the composition asks this plugin for anything: **the one thing that does is a person, arriving over the endpoint.**

---

## 2. Existing variant guard

### 2.1 两处源码落点，逐字

`src/language/exposure.ts:40-48`：

> The variant mechanism is the guard on this design, and it is recorded here rather than in a note somewhere else because this file is where the temptation would reappear. Two named variants are approved for exactly one reason: base Language and repository-aware Language differ by *one* independently optional capability, and one optional capability has two states. A second such capability would make four variants, a third would make eight, and `CalendarLanguage` / `MailLanguage` / `RepositoryCalendarLanguage` is the shape that arrives in. **If a second independently optional domain capability ever appears, the answer is not a third literal list here — it is a Composition Boundary Review of whether capability reachability should be decided at composition time at all.** This slice does not solve that, and deliberately does not prepare for it.

`src/language/plugin.ts:58-61`：

> …the mechanism is approved for exactly two variants differing by **one independently optional capability**. **A second such capability is the trigger for a Composition Boundary Review** — not for a third factory here, and not for a `CalendarLanguage` beside these two.

`src/language/plugin.ts:320-321`：

> Two named objects rather than a table of them. **A third variant is the trigger for a Composition Boundary Review** — see `exposure.ts` — and not a third entry here.

### 2.2 设计记录里的同一条

`docs/development/judgement-reachability-v0.md:104-118`（§4.1）：

> **具名 variant 只对「base + repository-aware Language」这一种情形批准。**
> base 与 repository-aware 之间只差**一个**独立可选的 domain capability。第二个这样的 capability 会让 variant 变成四个，第三个变成八个……
> **因此：** 如果将来出现**第二类**独立可选的 domain capability，答案**不是**在这里加第三份字面清单，**也不是**加第三个具名工厂——而是做一次 **Composition Boundary Review**，重新审查「能力可达性是否应当在组合时决定」这件事本身。

### 2.3 guard 的判据必须逐字读

**三处文字并不完全一致，必须逐字读，不得合并成同一句判据。** 本节初稿把三者写成同一个条件（「第二类独立可选的 **domain** capability」），评审打掉了——**只有一处有 domain 这个词**：

| 落点 | 逐字 | 含「domain」限定吗 |
|---|---|---|
| `exposure.ts:44-49` | 「If a second independently optional **domain** capability ever appears…」 | **含** |
| `plugin.ts:58-61` | 「differing by **one independently optional capability**. **A second such capability** is the trigger…」 | **不含** |
| `plugin.ts:320-321` | 「**A third variant** is the trigger…」 | **不含**（且它数的是 variant，不是 capability） |

**这不是抠字眼，它决定了 guard 该被读成什么。** 只有 `exposure.ts` 一处把限定词写成 **domain capability**；`plugin.ts` 两处说的是更宽的「**第二类独立可选的 capability**」。按那个更宽的读法，一个**多提供**了一样东西的 Language **字面上就落进去了**。

**因此 §3.3 的处理是「承认触发、回答原理」，不是「靠 domain 这个词把自己排除掉」**——初稿那样读，是把一处措辞当成了三处。

至于**方向**：`exposure.ts` 那处预言的失败形状是 `CalendarLanguage` / `MailLanguage`——**都是「Language 多读了一个 domain」**，即它设想的永远沿 **Language ← Domain**。`provides` 侧的情形它**没有设想过**。但按上表，**没设想过 ≠ 被判据排除**，它只是**没有先例**。出站进不了 variant 机制的真原因在别处：`provides` 根本不在 variant 里（§1.1）。

---

## 3. Whether outbound is truly a second variant axis

### 3.1 结论

**不是。两者不是同一个 composition dimension。**

### 3.2 论证（三层，每层都是源码事实）

**第一层：mechanism。** variant 的三个字段是 `requires` / `exposures` / `makeReader`（`plugin.ts:148-161`）。`provides` 不在这三个里，它写在共用的 definition 上（`plugin.ts:189`）。**一个只改变 `provides` 而不改变 `requires`/`exposures` 的东西，对今天这个 `LanguageVariant` 接口而言没有可表达的字段**——要把它做进 variant，必须给 `LanguageVariant` 加第四个字段，也就是改 guard 本身的形状。

**这条的射程必须说清**：它陈述的是**今天的接口形状**，不是「出站不是一类 capability」。按 §2.3 的表，出站**字面上**可以落进 `plugin.ts:58-61` 那个更宽的判据。两句话不矛盾——一句说出站**能不能进 variant**（不能），一句说 guard **要不要因此被触发**（要，见 §3.3）。

**第二层：behavior。** 就算硬加进去，它也不改变 Language 的行为。repository variant 之所以必须存在，是因为 Language 的**行为**变了：它多读一个 Service（`makeReader` 多 pull 一次），模型多看到一个能力（3 tools 而不是 2）。而「Language 能否说话」不改变 Language 的任何既有行为：今天没有任何人能问它要一句话（`provides: []`），加不加一个 speaking capability，`ask`、`observe`、`relevance` 三条人类路径**一个字节都不变**。

**第三层：arity。** 把 outbound 塞进 variant 会立刻得到 4 个 variant（`base` / `base+repo` / `base+outbound` / `base+repo+outbound`），正是 guard 花整段文字要阻止的那个数。这不需要论证——它就是 guard 的字面结论。

### 3.3 但 guard 被触发是对的

Human ruling #3 要求先做这次 Composition Boundary Review，而**它确实是正确的工具**，理由不是 guard 的字面前提成立，而是**它的原理被触碰了**：

> 「能力可达性是否应当在**组合时**决定？」

出站涉及的正是这个问题的另一面：**不是「Language 能读到谁」，而是「谁能读到 Language」**。这是同一族问题的**反向**，因此仍然必须在这个层面上回答一次——而不是在 `plugin.ts` 里加个字段了事。

所以 §3 的完整结论是：

```text
guard 的字面前提（第二类独立可选的 domain capability）—— 不成立。
guard 的原理（reachability 是否在组合时决定）—— 被触碰，本次 review 即为回应。
```

---

## 4. Dependency-direction analysis

用户 §四 要求逐项证明四件事。四项都成立。

### 4.1 repository capability 的 dependency direction —— 入站

```text
repository-ci-relevance    requires: [workFocusCurrent, repositoryCiAwareness]
                           provides: [repositoryCiRelevanceService]
        ↓ 方向向下（provider 不知道谁在消费）
language（repository variant）  requires: [ …, repositoryCiRelevanceService ]
```

证据：
- `src/repository-ci-relevance/plugin.ts:49, 55` —— `requires: [workFocusCurrentService, repositoryCiAwarenessService]`，`provides: [repositoryCiRelevanceService]`。
- `src/language/plugin.ts:370-375` —— repository variant 的 `requires` 里第三个就是它。
- **`grep -rln language src/repository-ci-relevance` → 零命中。** provider 完全不知道 Language 存在，更不知道谁在消费它的判词。

**方向：Domain → Language（Language 是 consumer）。**

### 4.2 outbound speaking capability 的 dependency direction —— 出站

出站的形状是「某个 consumer 消费 Language 提供的东西」：

```text
language                   provides: [ ??? ]
        ↓ 方向向下
<某个 domain / decider>     requires: [ 那个合约 ]
```

**方向：Language → Consumer（Language 是 provider）。**

### 4.3 sink presence 是否影响 Language readiness —— 会，而且这正是错处

如果把出站建模成 `Language requires <sink>`：

- `runtime.ts:109-111`：`#requirementsSatisfied` = **每个 `requires` 的 key 在 registry 里**。
- `runtime.ts:94-105`：不满足 → 停在 `waiting`，**不会被激活**。
- 于是：**没有 client 连上来的那一刻，Language 就是一个 waiting 的插件。** 人问不了问题，`observe` 不受影响但 Language 整个不工作。

这不是理论推演——`plugin.ts:353-359` 逐字描述了同一机制在 repository variant 上的效果：

> Because it is a hard requirement, a composition that got the order wrong does not come up degraded: **this plugin stays `waiting`**, the resident reports it, and an operator sees which member is missing…

**结论：`Language requires sink` 会把「有没有人在听」变成「Hikari 能不能说话」的唯一开关。** 这是 §8、§10 要拒的东西的结构性理由。

### 4.4 consumer authorization 是否发生在 Language 侧 —— 不，永远不

- `plugin-context.ts:23-27`：`services.get` 的第一件事是查 `required` 集合，不在里面就抛 `UndeclaredServiceDependencyError`。**这个集合来自 consumer 自己的 `definition.requires`。**
- `service-registry.ts:17-24`：`get()` 拿到的只是一个值，**没有调用方身份**。
- Language 的 setup 里**没有任何**「谁在调我」的信息：`context.services.get(...)` 是被动取用，endpoint handler 只拿到 `request.text`。

**结论：Runtime 里不存在「谁有权调用谁」的机制。授权的闸门是 (a) consumer 自己写的 `requires` 字面量，(b) 组合文件里那条 roster。Language 侧不参与，也无从参与。**

这一点在 §6 会被重新捡起来：它决定了「structural authorization」这句话能说到多满。

---

## 5. Language speaking capability feasibility

### 5.1 用户要求回答的问题

> Language 是否应 provides 主动 speaking capability？是否满足 Contract Creation Gate？

### 5.2 结论：**今天不满足，因此不应该。**

`plugin-design-spec.md:549-550`（§16.2 **Service** 补充判据）：

> - 谁需要**主动调用**这个 capability？
> - **若不存在真实的 callable need，默认不创建 Service。**

`plugin-design-spec.md:532`：

> **若主要理由是「以后可能有用」，默认不创建。**

§16.1 放宽的只是「consumer implementation 是否**已存在**」：

> **必须存在真实、已发生的跨模块交互语义。**
> **不要求已经存在具体的 Consumer implementation。**

**今天的事实**：

| 问题 | 答案 |
|---|---|
| 组合里有没有东西在问 Language 要一句话？ | **没有**。`grep` 证明零 domain plugin 引用 Language。 |
| 有没有「真实、已发生的跨模块交互语义」？ | **没有**。人类说话的路径是 `ask` → 端点 → `answer()`，那条路径上的对端是**人**，不是模块。 |
| 有没有人可以合法地写这个 consumer？ | **没有**。它的语义是「这件事值得说」——`current-stage.md` 把 Salience / Importance / Notify 整条链冻结为「**未进入，且未被预埋**」。 |
| 唯一候选 consumer（Repository CI Attention）现在什么状态？ | Human ruling #5：**继续 BLOCKED**。 |

**这四条合起来，与 `repository-ci-relevance` 当初被扣留整整一轮的情形完全同型。** 那份契约自己的注释（`contracts.ts:4-18`）逐字写着：

> What decides a contract here is whether something in the composition actually calls it… **`hikari relevance` is a *client*, not a consumer**, and it reaches this plugin over the plugin's own endpoint. **A Service published to the whole composition in order to serve a client arriving through a pipe would have been published for nobody.**

Language 今天的处境**逐字相同**：它有一个 endpoint，对端是人；它**没有**组合内的调用方。

**§16.1 的那半条豁免，本轮为什么用不上——这是本结论最脆的一处，必须正面答。**

`contracts.ts:4-18` 记录的正是本仓库**唯一一次实际使用** §16.1 豁免的过程，值得逐字读：

> What §16.1 adds is only that the need does not have to be satisfied by a consumer that already exists — **a consumer may be written in the same slice**. So the obstacle was never "no consumer has been written yet"; it was that **nothing called this judgement**.

这句话把判据钉死为：**「有没有东西在调用这个判词」**，而不是「consumer 的实现写没写」。

`repositoryCiRelevanceService` 通过，是因为**写它的同一个 change 里就有 Language 真的去读它**——consumer 的**语义**（「把 relevance 判词当作一项能力提供给模型」）在当时已经存在且已经冻结，缺的只是实现，所以同一个 slice 里补上实现即可。

**出站这边缺的不是实现，是语义本身。**「这次该不该说」这件事今天**没有任何 owner、没有任何冻结的判据**——`current-stage.md:1433` 逐字：三个等式**都不成立**（`relevant ≠ important`、`relevant ≠ salient`、`relevant ≠ should notify`）。同一个 slice 里写不出一个 consumer，**因为它要回答的那个问题本身还没有答案**；硬写出来的那个 consumer，其全部内容就是本报告 §18.4 拒绝的那组抑制规则。

**关键差别一句话**：`repositoryCiRelevanceService` 是「**语义已定、consumer 未写**」；出站是「**consumer 的语义未定**」。§16.1 豁免的是前者，不是后者。§16.2 在两种情形下都保持 binding。

**并且 `plugin.ts:69-74` 已经把这条规则预先写在了那一行上**：

> Publishing a Service for that would be publishing one for nobody, and **the day a real consumer exists is the day this line gets an argument rather than a guess.**

### 5.3 形状（若将来成立），以及它为什么不是 `speak(string)`

**本节是形状可行性研究，不是建约批准。** 用户 §七 明确禁止 `speak(text: string)` / `speak(prompt: string)` / `speak(any)`，理由是「会让任何 consumer 绕过 semantic ownership」。这个理由在源码上是成立的：

- 若输入是自由字符串，则 consumer 可以让 Hikari 说**任何话**，而 Language 的全部防线（`exposures` 闭集、`read.ts` 的 renderer 分派、`renderAnswer` 的「不加」规则）全部被绕过。
- `exposure.ts:12-17` 逐字把这条边界写成消费方/提供方分工：「the provider owns how the thing is done and what it means, the consumer owns the question of what to do with it」——但「Hikari 说什么」不是 consumer 拥有的东西。

**最小的、诚实的输入形状是 owner 自己的 export。** `exposure.ts:104-107` 逐字：

> Both entries are the owners' exports rather than equal-looking copies of them, and a test asserts the **identity** rather than the content.

即：一个 `LanguageExposure` 条目**就是** owner 导出的 `{ name, description, service }`（`exposure.ts:97-100` 的 union 直接由三个 owner 的类型构成）。这个名字**不是**「Universal Epistemic Object」，也不是新对象——它是**已经存在**的三个 owner 导出的联合。

因此将来若成立，最小形状是：

```ts
interface LanguageSpeakingService {
  /** 按 owner 自己的渲染，说一件本构建能读的事。 */
  speak(exposure: LanguageExposure): Promise<LanguageReply>;
}
```

- **输入**：闭集里的一项，指向 owner 自己的 export。consumer **不能**提供文字，只能指定**读哪一件**。
- **输出**：`LanguageReply`（`types.ts:74-78`，**已经存在、已经导出**）——不新建 Message 对象。
- **实现**：`read.ts` 的 `ExposureReader` 读出 owner 渲染的行 → 包成一个 `GroundedBlock` → `renderAnswer([block], null)`。措辞要准：`express.ts:79` 是 `if (contextUsed !== null) {`，**没有 `contextUsed === null` 这个分支**——null 是它的 fall-through，落到 `:96` 的 `return lines.map(oneLine);`。所以准确的说法是「**不加东西就已经是这个行为**」，不是「有一条分支为它写好了」。

**这个形状有一个开口，评审打出来了，必须写在这里而不是留给 §17.3。**

`LanguageExposure` 恰好是**三个"读"exposure**（`exposure.ts:97-100`：`WorkFocusReadExposure | DesktopContextReadExposure | RepositoryCiRelevanceReadExposure`）。因此 `speak(exposure)` 能表达的只有一句：

> 「**读这一件，按 owner 的渲染说出来。**」

它**不能**表达「**把发生的这件事说出来**」。而链路 ⑤ 产出的恰恰是一次**迁移**（「出现了一个新的 CI 失败」），不是一次**状态读取**——三个 exposure 里没有一个渲染迁移：`repository-ci-relevance` 的 `renderJudgement`（`judgement.ts:76-79`）只印 `relevant` / `unknown` 两行加 designation。

**所以 §17.3 第 3 条写的「取 owner 的 material → `speak` → 原样 `deliver`」与本节这个签名不对型**：「material」（一次 occurrence）与「exposure」（一个读句柄）不是同一种东西。要合上这个开口只有两条路，**两条都不在本轮权限内**：

- 为 attention 契约加**第四个 exposure**——而它必须同时在同一个 variant 的 `requires` 里（`read.ts:110-121`；由 `test/language.test.mjs:1452-1455` 钉住）→ **第三个具名 variant**，正是 §2.3 那个更宽判据的字面触发；
- 或者引入一个新的 occurrence 输入类型——而那正是 `repository-ci-attention-v0-boundary-review.md` §12.3 明确**拒绝冻结**的东西。

**因此这个开口不关闭，只登记。** 它使 §19.2 的「组合问题已经答清」必须降级为「**边的方向答清了，跨 speaking 边的 material 形状没有**」。

**并且这仍然只是「最小形状可行」的证据，不是「今天该建」的理由。** §5.2 的结论优先：**今天 `provides` 保持 `[]`。**

### 5.4 一个必须说清的区别：`speak()` 不是 `read()` 改名

| | `read()`（今天存在） | `speak()`（候选） |
|---|---|---|
| 受众 | **模型** | **人** |
| 谁在问 | `answer.ts` 循环内部 | 组合里的 consumer |
| 是否经过表达层 | 否——返回原始 owner 行给模型当 tool result | 是——经过 `renderAnswer` |
| 是否携带 outcome | 否 | 是（`LanguageReply`） |

差别不在实现，在**谁被授予了「形成一句对人说的话」这件事**。`read()` 今天只被 Language 自己调用；`speak()` 一旦提供，被授予的就是**别人**。这就是为什么它不能由「read 已经有了」推出来。

---

## 6. Structural authorization via `requires`

### 6.1 用户要求攻击的假设

> 某 bounded plugin 只有在 composition 明确赋予它 Language speaking Service dependency 时才具有结构授权。

### 6.2 回答：`requires` 是 **reachability**，不是 **permission**；但在 fixed product mandate 下它已经够用。

**逐条回答用户 §八 的四个小问：**

**(a) `requires` 只是 dependency 还是能诚实承担 authorization 语义？**

源码给出的精确答案是**前者，但要分成两句话**：

- `plugin-context.ts:23-27` 的闸门是**可达性**闸门：不在 `required` 集合里就 `throw UndeclaredServiceDependencyError`。它回答的是「这个 plugin 能不能拿到这个值」。
- `service-registry.ts:17-24` 的 `get()` **不接收调用方身份**。Runtime 里根本不存在「谁被允许做什么」这个概念。
- `exposure.ts:56-63` 逐字：「**What an entry does not carry: any permission.** An exposure says a capability may be *offered*, and says nothing about whether a particular caller may use it or whether this particular act is allowed.」
- `principles.md:207-227`（§5）把两层并排冻结：`Capability existence ≠ Exposure ≠ Authorization ≠ Execution`，「这几个层次不得合并成一个布尔开关」。

**所以诚实的说法是**：`requires` 表达的是「**这个 plugin 被组合授予了到达这个 capability 的路**」。授权语义在这里的**全部内容**就是这一条——不多也不少。

**(b) 是否已是 repo precedent？**

**是，而且是唯一 precedent。** 每一个跨模块调用点都是这个形状：`chronicle requires continuityService`、`work-focus requires chronicleService`、`desktop-session-observe requires desktopSessionAwarenessPeekService`、`repository-ci-relevance requires workFocusCurrentService`。仓库里**没有任何第二套授权机制**。

**(c) Provider 是否因此选择 Consumer？**

**不。** 反向证据三条：
- `LanguageVariant` 里没有任何 consumer 信息（`plugin.ts:148-161`）。
- `repository-ci-relevance` 源码里零处提到 Language（§4.1）。
- `resident.ts:186-190` 逐字：「Each chain member declares its own requires and provides and the Runtime reconciles them; **hand-writing a call sequence here … would be this file acquiring an opinion about the domain it composes**.」

**(d) Runtime 是否因此理解 authority？**

**不。** Runtime 的全部 authority 相关代码就是三行集合成员检查（`plugin-context.ts:17-18, 25, 30`）。它不知道 `work-focus.current@1` 是什么，也不知道谁该被允许调用。

**(e) 是否需要额外 Policy / Authority layer？**

**不需要——只要 fixed product mandate 成立。** 用户 §八 已经给了这个判据：「如果 fixed product mandate + requires 已足够，不要创建 generic Authority framework。」

**判据在这里如何落地**：组合文件（`resident.ts`）是**人手写的 roster**，写进 roster 的 plugin 只有 `--repository-root` / `--repository` / `--model-endpoint` / `--model` 这几种**人类显式给出的配置**作依据。也就是说：**「谁被授予了 speaking 路」这件事，由人手写的一次组合决定，而这次组合的输入是人明确给出的配置。** 在 fixed product mandate 下，这就是授权的全部——再加一层 Authority framework 会是一个**没有第二个消费者的抽象**，正是 `currentStage` 反复拒绝的形状。

**但必须写明它的边界**：`requires` **不能**回答「这一次该不该说」「说了几次了」「现在是安静时段吗」。那些是**抑制规则**，不是可达性。它们属于 decider，不属于 Language，也不属于这套 dependency 机制。**本轮不为它们建任何东西。**

---

## 7. Transport Service shape

### 7.1 用户要求研究的问题

> `deliver(...) -> outcome` 的最小语义。不预设参数。Transport 不理解 Domain，只接收已经 human-facing 的 material。研究接受 string / readonly lines / Language-owned utterance type / 其他现有形状哪一个最小。

### 7.2 结论：**输入 `readonly string[]`，输出 `{ outcome: 'delivered' | 'unavailable' | 'failed' }`。**

**理由一：这是 `renderAnswer` 今天已经产出的形状。** `express.ts:75` 的返回类型就是 `readonly string[]`。用 `readonly string[]` 意味着**零新对象**——不需要 `RenderedMessage`、不需要 `Utterance`、不需要 `DeliveryEnvelope`。

**理由二：`{ outcome, lines }` 是本仓库 plugin / endpoint reply 层的既有信封。** `desktop-session-observe/plugin.ts:111` 返回 `{ outcome: 'ok', lines: renderAssessment(assessment) }`；`language/answer.ts` 的九个返回点全部是 `{ outcome, lines }`；`endpoint.ts:128, 136` 亦然。

**但「这是每一条人类出口的信封」不成立，本节初稿那样写过，收回。** 反例至少三个：`cli/options.ts:94-98` 的 `CommandOutcome { exitCode, stdout, stderr }`（它直接写到人，见 `cli/main.ts:31-32`）、`language/types.ts:96-99` 的 `LanguageOutcome { kind }`、`cli/ask.ts:178-181` 的 `askFailureLines(): readonly string[]`。信封是**多数**形状，不是**唯一**形状——说成唯一会让「复用既有形状」这句话显得比实际强。

**并且「两边都不需要新类型」只对一半。** **输入侧**确实零新类型：`readonly string[]` 就是 `renderAnswer` 的返回类型（`express.ts:75`）。**输出侧需要一个新的 union**：`DeliveryOutcome` 的 `'delivered'` 在 `src/` 中**零命中**（今天唯一的 `delivered` 是 `desktop-session-observe/plugin.ts:40` 的散文注释），`'unavailable'` 今天只作为 `kind` 出现，从不作为 `outcome`。所以输出是**新的三值 union**，不是复用——它的依据在理由四与 §7.3。

**理由三：`LanguageReply` 虽然是「更丰富」的既有类型，但它是错的输入。** 它携带 `chatted | answered | refused | failed` ——那是 **Language 对「刚才发生了什么」的判断**，是供给方告诉**提问者**的。transport 不需要它：把 `refused` 或 `failed` 的文本主动推到人面前，是一件 transport 没有立场做的事。让 transport 只拿 lines，它就没有机会对 outcome 有意见。

**理由四：provenance 不由类型保证——这个结论对，但初稿的论证方式错了，而且错在本文最敏感的那一点上。**

一个 consumer 只要同时持有 speaking 与 delivery，理论上可以自己拼一串字符串交给 `deliver`。**这是真的。** 但初稿写「除非引入一个只有 Language 能构造的 brand 类型，而那正是用户要求避免的『新建 Message 对象』」——**这句是错的**：brand 可以打在**已经存在、已经导出**的 `LanguageReply`（`types.ts:74-78`，`index.ts:85-90` 已导出）上，那不是新建对象。用户与本系列禁止的是**通用信封**（`repository-ci-attention-...md` §18 的 `Attention<T>` / `Notification<T>`；`human-outbound-...md:578` 的 Universal Epistemic Object / Generic Prompt Envelope / Universal Agent Message），不是「给既有类型加 nominal 标记」。

**比 brand 更轻、也更符合仓库取向的一条**：让 `deliver` 收**整个 reply** 而不是 `.lines`，由 Language 侧做 nominal 标记——这样 §17.3 列的那条纪律（「交给 `deliver` 的 lines 逐字等于 `speak` 返回的 lines」）就**结构上不必要**，而不必靠测试去证明。

**本轮不采用它，理由是时机不是形状**：它要求 transport 契约能命名一个 Language-owned 类型，而 transport 契约今天不存在（§14）。**但它必须记在这里，因为它指出一件真事**：§9.4 把不变量 #4 的 enforcement 从 Language 的 answer 路径**移到了 Language 观测不到的地方**，而仓库自己的取向是结构优先于行为——`desktop-session-observe/plugin.ts:31-35` 逐字：「Requiring the peek contract rather than the current one makes that **structural instead of behavioural**. This plugin is not given the ability to advance the baseline, so no test has to prove it declines to」。§9.4 因此必须保留它的代价声明，不得写成已解决。

**减轻这一条的事实也要一起说**：`language-tool-use-loop-v1.md:215` 自己声明这些不变量是**由测试验证**的，所以「纪律 + 测试」对这个不变量并非无先例；`test/language.test.mjs:463` 今天就是它的落点——**只是那个测试只在 answer 路径之内成立**，而 §9.4 把路径搬到了外面。

### 7.3 最小语义（将来）

```ts
interface HumanDeliveryService {
  /**
   * 把已经 human-facing 的行送到本地人的连接上。
   * 没有连接 = unavailable。写失败 = failed。写成功 = delivered。
   * delivered 只表示「写到了 socket」，不表示「有人读了」。
   */
  deliver(lines: readonly string[]): Promise<DeliveryOutcome>;
}

type DeliveryOutcome =
  | { readonly outcome: 'delivered' }
  | { readonly outcome: 'unavailable' }
  | { readonly outcome: 'failed' };
```

**`delivered` 的含义必须写死**：它是**写入成功**，不是**送达确认**。这不是保守，是仓库已经立过的前例——`desktop-session-observe/plugin.ts:40-43` 逐字：

> A query that is never delivered still acquires. The endpoint serves the question to completion whatever the client does…

同一个诚实标准反过来用：**transport 不假装知道自己把话送到了一个人的眼睛里。**

---

## 8. Subscriber absence semantics

### 8.1 用户要求攻击的假设

> **重点攻击**：Language requires sink Service → sink 没 client → Language waiting。这很可能是错误建模。

### 8.2 结论：**是错误建模。三重理由，任何一条单独成立。**

**理由一：Language 今天没有自己的 trigger，因此没有「可送之物」。**

`plugin.ts:239-245` 是 Language 唯一能产出语言的地方，它只从一个入站请求的 `handle` 里进入。`answer.ts` 的循环建立在一条 user message 上（`answer.ts:140-142` 检查 `text.trim() === ''`）。

**一次 reading 只在有人问的时候才存在。** 所以一个持有 transport 的 Language，会持有一样**它永远不会用到的东西**——按 §16.2 的对称读法，这同样是「没有真实 callable need 的能力」。

**理由二：它把 expression 的「存在」绑到了 delivery 上。**

`runtime.ts:109-111` + `:94-105`：`requires` 不满足 = `waiting` = **没有 endpoint** = **人问不了问题**。

也就是说：`Language requires sink` 意味着「**没有人在听的时候，人也不能问**」。这不是一个可接受的退化，是一个因果倒置——让**配送**决定**能不能说话**。

**理由三：它制造第二个 2^n 轴。**

即使 sink 不是 domain capability（guard 的字面前提不成立），mechanism 上的后果和 repository variant 一模一样：base / +sink / +repo / +repo+sink = 4 个 variant。**guard 存在的理由就是阻止这个数**，所以它在这里以原理而非字面被引用。

### 8.3 更诚实的形状

```text
transport plugin     —— 一直 active。它的存在不以「有人连着」为条件。
deliver(lines)       —— 无 client 时返回 { outcome: 'unavailable' }，不是 wait、不是 throw。
client 断开          —— 普通 transient state。不失败、不退避、不重试。
```

**结构性依据（不是约定）**：

- `runtime.ts:84-107` 的 `#reconcile` **只在 `requires` 不满足时失活**，从不因「没有 consumer / 没有订阅者」失活。
- `current-stage.md:693` 逐字：「**0 个订阅者是合法状态**——Event 是通知，不是待办。」——同一个判断在 Service 侧同样成立，而且 `desktop-session-awareness-loop` 就是这个判断的活实例：它发出的事件生产环境**零订阅者**（`desktop-session-awareness-loop/plugin.ts:85` 是 `src/` 中唯一的 `events.emit`，而 `grep -rn "events\.on(" src` 命中 **0**），而它自己一直 `active`。**「一直 active」不是它自己声明的**，是 Runtime 的机制（`runtime.ts:110` 的 `requires` 一满足即激活，§14.3 末段解释过这条），`resident.ts:175-177` 逐字承认这是「**a property of the design rather than a gap**」。

**这就是本题的答案**：让「没人听」成为一个**返回值**，而不是一个**状态**。

### 8.4 不得引入的东西

按用户 §九 的明令与 v0 最小原则：**不创建 durable queue、不创建 retry、不创建 history、不创建 delivery guarantee。** 理由不是省事，而是这三个东西每一个都需要一个**没有 owner 的判断**：重试几次？什么时候过期？重复的被丢掉还是补发？这些是 delivery policy，而 delivery policy 的 owner 今天不存在（§5.2）。

---

## 9. Expression vs delivery boundary

### 9.1 两条路径

```text
路径 A：consumer → Language.speak(exposure)
                 → Language 内部调 transport.deliver(lines)
                 → 返回 delivery outcome

路径 B：consumer → Language.speak(exposure)
                 → 拿到 LanguageReply
                 → consumer 自己调 transport.deliver(reply.lines)
```

### 9.2 结论：**A 被拒，B 有条件接受。**

### 9.3 为什么拒 A

**A 就是 §10 要拒的 `Language requires transport`**，理由是 §8.2 的三条，外加一条：A 让 Language 直接依赖**具体**的 transport。用户的 Human ruling #2 已经选了 long-lived local subscriber 作为**第一**个 transport；若 Language 依赖它，那么第二个 transport（toast，ruling #4 保留为 candidate）到来时，Language 就必须再长一个 variant——**第二类 2^n**。这是 §7 之外最硬的一条否决理由。

### 9.4 为什么接受 B，以及 B 的代价必须写明

**接受的理由**：`principles.md:475-495`（§15）给出的是一条**管道**：

```text
Domain Result → Presentation → RenderedMessage → Transport
```

这条管道**没有标注「谁来执行这些箭头」**。仓库对「谁执行一个箭头」的既有答案是：**在 `requires` 里同时声明两端的那个 consumer**。`repository-ci-relevance` 就是这么做的（同时 requires work-focus 与 repository-ci-awareness 并把两个结果合成一个判词）。B 与这条 precedent 同型。

**代价（必须写明，不得掩饰）**：

1. consumer 拿到了 `LanguageReply`——一份**已经形成**的 user-facing 文本。类型上它能改这串文字。
2. 因此 B 成立的前提是一条**纪律**，不是一条类型：**consumer 必须原样转交，不得增删一个字、不得重新换行、不得重新排序。**
3. 这条纪律**没有**被 enforcement 覆盖。它靠 review + 测试。这与仓库对 `oneLine`（`read.ts:139-141` + `renderAnswer` 的二次转义）、对 `exposures`/`requires` 一致性（`test/language.test.mjs`）的处置方式一致——**承认它是纪律，并给它写测试**，而不是假装类型拦住了。

**B 是否破坏 Speech Sovereignty？**

`language-tool-use-loop-v1.md:213-220`（§8）的四条不变量，第四条逐字是「**Domain Plugin 不获得 user-facing speaking turn**」，且说明它是「当作结构不变量来验证的」。

**判断：B 不破坏它，前提是那条纪律成立。** 因为这条不变量的内容，从 §8 的另外三条可以读得很清楚——都在说**谁形成文字**：

- `tool_calls` 非空时 model `content` 不进 answer；
- 一旦成功读取 capability，后续没有自由 prose 的 grounded 出口；
- grounded answer **仅由 deterministic renderer 产生**。

**「形成」是这条不变量的对象，不是「搬运」。** 在 B 里，形成文字的是 owner 的 renderer + Language 的 `renderAnswer`；consumer 拿到的是成品，它只有搬运的手，没有造句的嘴。

**但这个读法与紧邻的上一份 review 相反，必须正面对上，不能装作没看见。** `repository-ci-attention-v0-boundary-review.md:559` 逐字：

> **注意这条的措辞**：它不区分「主动说」与「被动说」——它说的是 Domain Plugin **不获得 speaking turn**。

按那个读法，「形成 vs 搬运」的区分**不成立**：不变量说的是 Domain Plugin 不获得 speaking turn，与文字由谁形成无关。**两份文档不能同时都对，本文必须表态。**

**本轮的读法及依据**：`language-tool-use-loop-v1.md:213-220` 的四条不变量是一个整体，**四条都在描述「文字如何被形成」**（`:217` tool_calls 非空则 content 不进 answer；`:218` 没有自由 prose 的 grounded 出口；`:219` grounded answer 仅由 deterministic renderer 产生；`:220` Domain Plugin 不获得 speaking turn）。第四条与前三條并列，因此**它约束的是「谁造句」**：`:219` 已保证句子只能由 renderer 产生，`:220` 补的是「那个 renderer 不得属于 Domain」。**上一份 review 把第四条孤立出来读，得到了一个比它所在段落更强的主张。**

**但这是本轮的判断，不是源码上的既成事实。** 如果 Human 采纳上一份 review 的读法，后果是明确的：§12 A 的字面表述（「**Domain** requires」）变成非法，而 §16 的形状只有在一个条件下存活——**`decider` 不被算作 Domain Plugin**（它不拥有任何领域事实，拥有的是 ⑤ 这个 salience 判断）。**这需要 Human 裁决，本文不代为裁定**，因此写进 §19.1。

**但这条判断有一个前提必须一起写下来**：**B 只在 consumer 不修改文本时成立。** 一旦 consumer 增删一个字，它就在那一行上获得了 speaking turn，§8 的第四条就在那一行上被破坏。所以 §17 的测试要求里必须有一条：**consumer 交给 deliver 的 lines，逐字等于 speak 返回的 lines。**

---

## 10. Whether Language must depend on transport

### 10.1 结论：**不必，且不得。**

四条理由，前三條已在 §8、§9 给出：

1. Language 没有 trigger，持有 transport 是没有 callable use 的能力（§8.2 理由一）。
2. 它把 expression 的存在绑到 delivery 上（§8.2 理由二）。
3. 它制造第二个 2^n 轴，且每加一个 transport 就再加一轴（§8.2 理由三、§9.3）。
4. **它让 Language 的 config 变成 transport 的 config。** `LanguagePluginConfig`（`plugin.ts:124-138`）今天是 `{ rootDir, endpoint, model, credentialEnv, reasoningEffort }`——全部关于「问模型」。一个依赖 transport 的 Language 需要再收一个 transport 的配置（一个 socket 名、一个客户端身份、一个送达策略），而 `readConfig`（`:254-304`）是**逐字段显式校验**的。这会直接把两个无关的配置面缝在一起。

### 10.2 那么谁依赖谁

```text
decider requires languageSpeakingService   ← 授权边
decider requires humanDeliveryService      ← 配送边
```

**两条边都从 consumer 出发**，因为 `plugin-context.ts:23-27` 的闸门就在 consumer 那一侧。Language 与 transport **互相不知道对方存在**——这正是 `resident.ts:186-190` 要的那种形状。

---

## 11. Resident boundary

### 11.1 可以做的（§十三 前半）

`resident.ts` 今天已经在做的、且**将来仍然可以做的**：

- **选成员**：`productionComposition` 手写四个 roster（`resident.ts:117-122`）。
- **选具名 composition**：`repositoryCi === undefined ? base : chain`（`:275-278`）。
- **传构造依赖**：`languageMember(languagePlugin, model)` 把 `{ rootDir, endpoint, model, credentialEnv, reasoningEffort }` 递给 `loadPlugin`（`:265-273`）。
- **决定是否启动一个 concrete plugin**：`model === undefined` 时不加载 Language（`:275-278`），理由逐字写着「it would be a plugin with nothing to ask」。

**将来同理**：Resident 可以决定「这次组合里要不要加载 subscriber plugin」，依据只能是**人显式给出的配置**——就像今天依据 `--repository-root + --repository` 一样。

### 11.2 不可以做的（§十三 后半）

`resident.ts:186-190` 逐字：

> It does not know what a repository is, what CI is, whether two commit strings match, or what relevance means. Each chain member declares its own requires and provides and the Runtime reconciles them; **hand-writing a call sequence here, or reading a value out of one member to decide what to load next, would be this file acquiring an opinion about the domain it composes** — which is the one thing a composition role is not allowed to have.

映射到出站：

| 禁止 | 为什么 |
|---|---|
| 判断 CI failure / relevance 的 domain 意义 | 那是 relevance 与（未来的）Attention 的判词 |
| 判断「这次该不该说」（speaking authorization） | 那是 decider 的，且今天不存在（§5.2） |
| 根据 event type 手工路由 | 就是上面逐字禁止的「hand-writing a call sequence」 |
| 拼 human-facing prose | §15；Resident 不是 Presentation |

**并且有一条 Resident 今天已经做对、将来必须继续做对的事**：`resident.ts:175-177` 逐字——「the resident adds no subscriber of its own: `desktop-session-awareness-loop.assessed` has zero subscribers in production, and **that is a property of the design rather than a gap for this file to fill**.」**出站链路不构成让 Resident 去补这个洞的理由。**

---

## 12. Candidate composition shapes

用户 §六 要求分析至少五种方向，并且**不得按对称性选择**。逐个给结论。

### A. Language provides speaking Service + Domain requires

**接受，且是 §16/§17 采用的形状——但今天不得建立（§5.2）。**

理由见 §4.2、§10.2。它是唯一让「谁读 Language」由 consumer 决定的形状。

**一处限定必须挂在「接受」两个字上**：这个「接受」依赖 §9.4 对不变量 #4 的读法（「形成 vs 搬运」）。**而 §16 采用的 consumer 是 `decider`，不是 Domain Plugin**——所以即使 Human 采纳上一份 review 的更严读法，§16 的形状仍可存活，**被排除的是「由 Domain Plugin 自己 requires speaking」这个变体**。两条的差别写在 §9.4 末段，裁决时按那里处理。

### B. Domain publishes Event + Language subscribes

**拒绝。**

1. `plugin-context.ts:34-39`：`events.on` **没有任何闸门**——任何 plugin 都能订阅任何 Event。这与 §6 的整个论证相反：Service 侧至少有「消费者自己声明 requires」这道可达性闸门（`:23-27` 的 `UndeclaredServiceDependencyError`），Event 侧连这道都没有。**补一条机械事实**：`grep -rn "events\.on(" src` 在**整个生产 `src/` 中命中 0**——今天没有任何 plugin 订阅过任何 Event。**B 会引入仓库的第一个 Event 消费者**，因此「先例如何」这个问题在这里没有先例可援。
2. **订阅即授权。** 如果 Language 订阅了「CI 变化」事件，那么**是 Language 决定了「这件事值得说」**——而这正是 §5.2 证明今天无人拥有的那个判断。Language 订阅 = Language 自己做 salience。
3. `event-bus.ts:41-51` 的 `EventBus.emit` 用 `Promise.allSettled` 后对任一拒绝抛 `AggregateError`。**一个投递失败会变成发出者那一侧的失败**——`desktop-session-awareness-loop/plugin.ts:86-92` 已经为这个写过注释。把通知失败变成感知循环失败，是把两个无关的失败面缝在一起。**措辞要准**：`AggregateError` 那条路径**只覆盖 async rejection**；订阅者**同步抛错**时逃逸为普通 `Error`。两种情况下「投递失败 = 发出者失败」这个结论都成立，但机制不同，不能混说。
4. 用户 §十七 明令「**Language 不订阅所有 Events**」。B 是最容易滑向那条的形状。

### C. Language requires outbound sink + Domain 通过其他 contract 请求 turn

**拒绝。** 这就是 §8 攻击的那个形状，两条都要拒：`Language requires sink`（§10）与「Domain 请求 turn」（Domain 获得了 speaking turn 的发起权，§9.4）。

### D. 新的 bounded intermediary plugin（同时 consumes Domain occurrence + Language Service + sink）

**拒绝——按用户 §十二 自己给的判据。**

§十二 明令：「只有在它有独立 concern 且不是 generic router 时才允许」，并且要求特别攻击「为了不让 Language require transport，加一层 coordinator」。

**判据必须写准，否则它会连 §16 接受的形状一起拒掉。** 本节初稿给的判据是「它的全部 body 是两行定序，既没有状态，也没有判断」——**那个判据是错的**，因为 §17.3 被接受的 `decider` 的 body **同样是两行定序**。评审打掉了这个自相矛盾，此处按「**它是因为什么被创建的**」重写：

| | D（被拒） | §16.2 的 `decider`（被接受） |
|---|---|---|
| 它为什么存在 | **为了让 Language 不必 require transport**——先有形状，再找理由 | **因为 ⑤ 需要一个 owner**——先有 concern，形状跟着它走 |
| 它自己的语义 | **没有。** 它不回答任何问题 | **有。** 它回答「这件事值得说吗」 |
| 创建的判据 | 「让两个已有成员不必直接相连」 | 「链路上有一跳今天没有归属」 |

**一句话**：D 是**作为管路被发明的**，`decider` 是**因为一个语义位置空缺才被允许的**。用户 §十二 要求警惕的逐字是「**为了不让 Language require transport**，加一层 coordinator」——D 正是这句话的字面实例。

**在这个判据下 D 仍然被拒，实质理由不变**：它没有自己的语义 owner，是换名字的 NotificationService，也是 `core-architecture-v0.md` §11 禁止清单里「所有交互必经的统一通信层」的形状。

**并且它有害**：它会把「N 个 domain × M 个 transport」的连线关系吸进一个中心，而从那里到 capability registry 只有一步。

### E. 其他 repo evidence 支持的更小形状

**用户在 §十四 提出的那个，本文确认它成立**：

> Language provider 可以**始终** provides 一个 bounded speaking capability；**是否有人 requires 由 composition 决定。**

**为什么它成立**：`provides` 是**共用的**（`plugin.ts:189`），它不属于任何 variant；「这次组合里有没有人 require 它」由 `productionComposition` 的 roster 决定，不由 Language 决定。**Provider 不决定 Consumer**——这正是这条规则的正向用法。

**但它今天仍然不能做**，因为 §5.2 的 Contract Creation Gate 判断优先：**「始终 provides」不改变「今天没有 callable need」这个事实。** 「始终」描述的是**将来不需要 variant**，不是**今天可以建**。

**因此 E 的完整答案是**：

```text
E = 「不需要 OutboundLanguage variant」——成立。
E ≠ 「今天就可以 provides」——不成立。
```

---

## 13. Future Repository CI Attention chain

用户 §十七 要求把这条链当作 proving ground，**不实现**，并逐条确认。逐边给出。

### 13.1 链路与每一跳的 requires/provides

```text
①  Repository CI facts
      git-repository            provides: gitRepositoryService
      github-ci                 provides: gitHubCiService
          ↓ 谁 requires：下一个成员
②  repository-ci-world         requires: [gitRepositoryService, gitHubCiService]
                               provides: [repositoryCiWorldService]
          ↓
③  repository-ci-awareness     requires: [repositoryCiWorldService]
                               provides: [repositoryCiAwarenessService]
          ↓
④  repository-ci-relevance     requires: [workFocusCurrent, repositoryCiAwareness]
                               provides: [repositoryCiRelevanceService]

      ── 以上 ①②③④ 今天全部存在。以下是将来的形状，今天既未实现也未预埋。──

⑤  decider（future；⑤ 的 owner；今天 BLOCKED）
                               requires: [languageSpeakingService]   ← 授权边
                               requires: [humanDeliveryService]      ← 配送边
          ↓
⑧  Human（人，不是 plugin）—— ⑤ 自己写 socket，不经 plugin 边
```

**注意 ⑤ 以下的画法与初稿不同，初稿画成 ⑤→⑥→⑦ 的串联，那是错的。** 按 §10.2 与 §16.2，`languageSpeakingService`（"⑥"）与 `humanDeliveryService`（"⑦"）**不是 ⑤ 的下一跳，而是被同一个 ⑤ 同时 requires 的两个兄弟**：两条边都从 consumer 出发，Language 与 transport 互不知道对方存在。**初稿的线性画法把 §13.3 的论证建立在一个错误的结构上，已按 §10.2/§16.2 重画。**

**今天真实存在的部分只到 ④。** ⑤ 之后全部是**将来的形状**，不是设计承诺——它们今天既没有被实现，也没有被预埋。

### 13.2 五条禁令的逐条核对

| 禁令 | 在这条链上意味着什么 | 依据 |
|---|---|---|
| **Runtime 不 broker** | Runtime 只做 `requires`/`provides` 的集合对账（`runtime.ts:109-111`）；它不知道 CI、不知道 relevance、不知道「该不该说」 | `runtime.ts:84-107` |
| **Language 不订阅所有 Events** | Language 只有出站 `provides`，`events.on` 一次都不用；它不需要知道 Attention 存在 | `plugin.ts:239-245` 今天已经是这样 |
| **Resident 不 route domain messages** | 组合只按配置选 roster，不读任何成员的值来决定下一步（`resident.ts:186-190`） | §11.2 |
| **Transport 不理解 CI** | `deliver(readonly string[])` 的入参里没有 repository、没有 commit、没有 verdict | §7.3 |
| **Attention 不生成 prose** | Attention 提供**判词 / occurrence**，由 Language 用自己的 `exposures` 闭集 + owner 的 renderer 形成文字 | §5.3、§9.4 |

### 13.3 链上唯一的新东西是 ⑤

②③④ 已经证明了一件事：**一条多跳的 domain 链可以完全靠 `requires`/`provides` 组织起来，Runtime 与 Resident 都不参与。**

**但这条类比必须立刻止住，初稿在此处推得太远。** ②③④ 是一条**线性** requires 链（每个成员 requires 前一个）。出站**不是**：按 §10.2 与 §16.2，「⑥」「⑦」是**同一个 ⑤ requires 的两个兄弟**，不是 ⑤→⑥→⑦ 的串联。**拿 ②③④ 的线性去论证「⑤⑥⑦ 没有理由做不到同一件事」，是用一个结构不同的先例作类比——那正是用户 §六 明令禁止的对称性推理。** 初稿这样写，收回。

**线性类比唯一还站得住的那一句更弱，但已经够用**：一个成员可以同时 requires 两个兄弟并把它们的结果合成——`repository-ci-relevance` 自己就是（它同时 requires work-focus 与 repository-ci-awareness）。`decider` 与它同型，**这条同型关系是真实的证据，不是对称性**。

**而 ⑤ 恰好是今天唯一空缺的位置**：它要回答「这件事值得说吗」，而那正是 §5.2 表格里的第三行——`current-stage.md` 把 Salience / Notify 整条链冻结为「**未进入，且未被预埋**」。

**所以 §13 的结论是**：出站链路**每条边的方向**已经答清（两条边都从 consumer 出发，§10.2），链路接不上的原因是 **⑤ 没有 owner**——这是 §5.2 的同一个事实换了个说法。**但「结构问题已经答清」这句必须留下 §5.3 那个开口**：跨 speaking 边的 **material 形状**没有答清（`speak(exposure)` 携带读句柄，不是 occurrence），见 §19.2。

---

## 14. Contract Creation Gate checks

用户 §十四 要求按 gate 判断。8 个通用问题逐字在 `plugin-design-spec.md:523-530`；§16.1 的读法在 `:535-542`，两句引文在 **`:538-539`**；§16.2 的 **Service** 补充判据在 **`:547-550`**——**注意不是「以后可能有人感兴趣」所在的 Event 平面**，`:545` 逐字禁止把某个平面的判据套到另一个平面上；「若主要理由是『以后可能有用』，默认不创建」在 `:532`。gate 本体范围 `:519-569`。

> **初稿把 §16.1 引作 `:539-542`、把 §16.2 Service 规则引作 `:553-556`，两处都错，已按源码回锚。** 后者的 `:553-556` 实际是 **Event** 平面，属于 spec 明令不得混淆的那一类。

### 14.1 `languageSpeakingService`（候选）

| # | 问题 | 答案 | 判定 |
|---|---|---|---|
| 1 | 谁拥有这个语义？ | Language（它拥有 human-facing 表达，`principles.md:475-495`） | 成立 |
| 2 | 是否存在真实跨模块 interaction need？ | **否**。今天零 domain plugin 引用 Language；**没有任何跨模块交互语义发生过** | **不成立** |
| 3 | Service / Event / Fact / Action？ | Service（要主动调用） | — |
| 4 | 现有 contract 能否正确表达它？ | 不能（今天 Language `provides: []`） | — |
| 5 | 是否泄露实现细节？ | 否 | 成立 |
| 6 | 生命周期语义是否明确？ | 是（provider 生命周期，`service-registry.ts:40-44`） | 成立 |
| 7 | Runtime 是否因此开始理解业务？ | 否 | 成立 |
| 8 | 真实需要，还是为了测试 / 对称 / 未来可能性？ | **未来可能性** | **不成立** |

`§16.2 Service`（`plugin-design-spec.md:549-550`）补充判据：「谁需要**主动调用**这个 capability？」→ **没有。**「**若不存在真实的 callable need，默认不创建 Service。**」

**判定：REFUSED。**

### 14.2 `humanDeliveryService`（候选）

| # | 问题 | 答案 | 判定 |
|---|---|---|---|
| 1 | 谁拥有这个语义？ | subscriber transport plugin | 成立 |
| 2 | 是否存在真实跨模块 interaction need？ | **否**。没有任何组合内的模块要送东西——`desktop-session-observe/plugin.ts:59-61` 已经为同型情形写过判词：**「the one thing that does is a client arriving through a pipe」** 不构成 Service 的理由 | **不成立** |
| 3 | Service / Event / Fact / Action？ | Service | — |
| 4 | 现有 contract 能否正确表达它？ | 不能（今天仓库里没有任何 transport 契约可复用） | — |
| 5 | 是否泄露实现细节？ | 否（只暴露 lines → outcome） | 成立 |
| 6 | 生命周期语义是否明确？ | 是 | 成立 |
| 7 | Runtime 是否因此开始理解业务？ | 否 | 成立 |
| 8 | 真实需要，还是为了测试 / 对称 / 未来可能性？ | **未来可能性** | **不成立** |

**判定：REFUSED。**

### 14.3 两个 REFUSED 的后果——以及必须先排除的两个反例

**本节初稿在这里出了本轮最重的两个错误，都是评审打掉的，此处按源码与 git history 重写。**

**反例一：§16.1 的 same-slice 豁免。** 本仓库唯一一次**记录在案**地用它的是 `repositoryCiRelevanceService`（`contracts.ts:4-18`）——「**a consumer may be written in the same slice**」。**它在这里不适用**，理由见 **§5.2 末段**：那一次缺的是 consumer 的**实现**（语义已冻结），这一次缺的是 consumer 的**语义**本身。

**反例二：先建、后接。初稿说「仓库拒绝先建、后接」——这是假的。**

```text
$ git log -S chronicleService --oneline -- src/
0ee95a5  feat(work-focus): wire Chronicle into the plugin and answer asynchronously   (2026-09-24)
e430358  feat: 完成 P2-02 事实史 v1                                                  (2026-09-15)
```

`chronicleService` 在 `e430358` 就被 `provides` 出去，**9 天、55 个 commit** 之后才在 `0ee95a5` 等到第一个组合内 consumer（`src/work-focus/plugin.ts:55` 的 `requires: [chronicleService]`）。这中间唯一引用它的是 `test/chronicle.test.mjs`。**它今天是一条承重契约。**（次级实例：`desktopSessionAwarenessService` 有约 24 小时 / 5 个 commit 的无 consumer 窗口。）

**所以「先建、后接」在本仓库发生过，而且被接受了。** 初稿 §17.1 逐字写的「先建、后接 = 把猜测写进 `provides`，正是那两句话拒绝的」——**撤回**。

**那么两个 REFUSED 还站得住吗？站得住，但理由必须换成更窄的一条。** `chronicleService` 与两个候选契约的差别**不是**「有没有 consumer」，而是：

| | `chronicleService`（被接受） | `languageSpeakingService` / `humanDeliveryService` |
|---|---|---|
| 建它的时候，**将来那个 consumer 要回答的问题**存在吗？ | **存在。** facts history 要解决的是「work focus 怎么记住自己」——一个**已经指定**的需求 | **不存在。** 要回答的是「这件事值得说吗」，`current-stage.md:1433` 把它列为「未进入，且未被预埋」，Human ruling #5 又把它冻在 BLOCKED |
| §16.2 问「谁需要主动调用这个 capability」 | 答案**当时未知，但可命名**——future work-focus | 答案**不可命名**——候选 caller 的判据本身还不存在 |

**一句话：`chronicleService` 是「consumer 未写、但需求已指定」；出站是「consumer 的需求未指定」。** 前者仓库证明可以等；后者不是「等」的问题——**没有东西可等**。

**而 `work-focus` 自己的文件头就是这个差别的源码形态**（`src/work-focus/plugin.ts:2-7`）：「What *is* a reason arrived later and separately: the Repository CI relevance judgement compares this set against a perception, which makes it a real reader inside the composition. **So this plugin now provides `work-focus.current`, and provides it for that one caller**」——它是在真实 reader 到达时才 provides 的。

**后果仍然明确，但依据必须换掉——初稿的依据是错的：**

```text
今天，outbound 方向不能新增任何一个跨模块 contract。
因此今天，outbound 不能新增任何一个 plugin 成员。
```

**初稿说理由是「一个既不 provides、又不订阅 Event 的 plugin 在 Runtime 里没有任何入口」，并引 `human-outbound-v0-boundary-review.md` §10.4。评审打掉了这一条，而且打得对。**

**先澄清一处**：§10.4 那一节**确实存在**（在该文档第 565 行），原文说的是「**可被唤醒的入口**」——那是一个比「被激活」更窄的说法，而初稿把它扩大成了「激活」。**引用为真、转述为假**，这一类错误比引错行更难发现：

- `requires: []` 时 `#requirementsSatisfied` **平凡为真**（`runtime.ts:110` 是 `every`），`#reconcile` 当次即激活（`:98→101→122`），`record.state = 'active'`（`:139`），而 `provides: []` 对激活无影响（`:134` 是空循环）。`config.parse` 更早，在 `:38`。
- **`test/language.test.mjs:1991` 存在的意义恰恰是钉住「没有 consumer 的 provider 仍然 active、Service 也真的可被调用」。**
- 而且这与本文 **§16.2/§16.3 自相矛盾**：那里写着 `outbound-subscriber` 是 `requires: []` 且 `active`。

**真正的依据是一条设计 MUST，比 Runtime 机制硬，也早就写在仓库里**——`plugin-design-spec.md:240`：

> **MUST** 不得虚构 cosmetic `provides`——为了"看起来有输出"而声明一个没有真实消费者的 Service。

以及它针对本情形的逐字版，`plugin-design-spec.md:499`：

> **MUST** Plugin 不需要为了"有输出接口"虚构 `status` / `latest` / `trigger` 之类的 Service。这类 Service 在缺少真实消费者时是 cosmetic provides（§6.2），会污染依赖图并制造虚假的契约承诺。

**一句话：出站第一片不是「装不上」，是「不许装」。** 引用层的差别不是措辞洁癖——把一条 MUST 说成 Runtime 做不到，会让读者以为换个 Runtime 就能绕过它。

---

## 15. Adversarial findings

用户 §十八 列了七个攻击。**七个全部不成立**，逐个给出反证。

### 15.1 把所有 optional capability 都做成 Language variants

**不成立。** variant 承载 `requires` + `exposures`（`plugin.ts:148-161`），`provides` 不在其中（`plugin.ts:189`）。出站不改变 Language 读什么、给模型看什么，**在类型上就进不了 variant 机制**（§3.2 第一层）。硬塞会得到 4 个 variant，正是 guard 逐字要阻止的数。

### 15.2 Language 永久 provides speaking Service 就万事大吉

**不成立。** 两处：
- §5.2 的 Contract Creation Gate：今天没有 callable need，**默认不创建**。「永久 provides」不改变这一点。
- §6 与 `principles.md:207-227`：**provides ≠ 授权**。能力存在、被暴露、被授权、被执行是四个问题（`exposure.ts:56-63` 对 exposure 说过同一句话，provides 侧同理）。

### 15.3 `speak(string)` 足够

**不成立。** 自由字符串让 consumer 绕过 Language 的全部防线（exposures 闭集、renderer 分派、`renderAnswer` 的「不加」规则），直接让 Hikari 说任何话。用户 §七 已明令禁止；§5.3 给出了替代形状（输入是 owner 自己的 export，不是 text）。

### 15.4 Language requires subscriber transport

**不成立。** 四条：Language 无 trigger、无可送之物（§8.2 理由一）；把 expression 的存在绑到 delivery（理由二）；制造第二个 2^n 轴且每加一个 transport 再加一轴（理由三、§9.3）；把 transport config 缝进 `LanguagePluginConfig`（§10.1 理由四）。

### 15.5 做一个 generic OutboundCoordinator

**不成立。** 它的 body 是两行定序，没有独立 concern、没有状态、没有判断、没有自己的语义 owner。这正是用户 §十二 给的判据所拒绝的形状，也是 `core-architecture-v0.md` §11 禁止清单里「所有交互必经的统一通信层」与「万能 Service」的形状。

### 15.6 Resident 手工 glue 最简单

**不成立。** `resident.ts:186-190` 逐字禁止「hand-writing a call sequence」并给出理由：那会让组合文件获得对它组合的领域的意见。且它会把 Resident 变成 router——`language/plugin.ts:76-81` 已经为控制通道写过同一条判词：「**the first question it answered would make it the router that design refuses to be.**」

### 15.7 subscriber connected = 用户允许任何主动通知

**不成立，而且是最危险的一条。** 三层：
- `principles.md:207-227` 的 §5 逐字：**可达性 ≠ 授权**。一个 socket 连着，说的是「有一条路」，不是「这次允许」。
- Human ruling #1 已冻结：**repository scope 不承担 interruption authority**。「人配了 repository」不构成「人可以被打断」。
- §5.2：即使连接存在，**「这次该不该说」仍然没有 owner**。这条攻击真正要求的是一整套抑制规则（频率、安静时段、去重），而它们今天**一条都不存在，也未被预埋**。

**但必须正面处理一个反驳——初稿躲开了它，评审打了回来。** `human-outbound-v0-boundary-review.md:307` 对这条通道写过逐字：

> **注意**：这条通道的「人类先连上」是**一次真正的 standing grant**——比 §5.3 的配置参数更显式。

而 Human ruling #2 选的**正是**这条通道。按那个说法，「连上」不是可达性，而是**授权本身**。

**本轮的答复是限定，不是回避**：`standing grant` 成立的范围是**「人可以收到」**，不是**「Hikari 可以决定什么时候说」**。前者确实由连接显式给出，而且确实比配置参数强——**这一点上一份 review 是对的，本文收回「连通性只是可达性」那种一刀切说法**。但攻击 15.7 主张的是后者：连上 = 允许**任何**主动通知。**这一步仍然不成立**，因为「什么时候说」不是连接能回答的问题——那正是 §5.2 证明今天无主的那个判断，也是 ruling #1 把 repository scope 排除掉的那个位置。**一条 standing grant 授予的是通道，不是判断。**

---

## 16. Smallest legal composition

### 16.1 今天的最小合法 composition：**今天的组合，一个字不改。**

```text
base 九成员        continuity, chronicle, foreground, input-activity,
                  desktop-session-world, desktop-session-awareness,
                  desktop-session-awareness-loop, desktop-session-observe, work-focus
+ language         当且仅当 --model-endpoint + --model
                  （有 repository scope 时选 repositoryLanguageVariant）
+ chain 五成员      git-repository, github-ci, repository-ci-world,
                  repository-ci-awareness, repository-ci-relevance
                  当且仅当 --repository-root + --repository
```

**这里的两个名字是简称，不是 `id`**：运行期 id 是 `foreground.windows`（`src/foreground/plugin.ts:11`）与 `input-activity.windows`（`src/input-activity/plugin.ts:11`）。按简称去找成员会找不到。

**`provides` 全部照旧，Language 仍然 `provides: []`。** 这不是保守，是 §14 的两个 REFUSED 的直接后果。

### 16.2 当 ⑤ 有 owner 时的最小合法 composition（**将来的形状，不是承诺**）

```text
                              ┌──────────────────────────────┐
   始终存在 ─────────────────►│ base 九成员                    │
                              └──────────────────────────────┘
                              ┌──────────────────────────────┐
   按 model 配置存在 ────────►│ language（仅 provides 增加）    │
                              └──────────────────────────────┘
                              ┌──────────────────────────────┐
   按 repository 配置存在 ───►│ chain 五成员                   │
                              └──────────────────────────────┘
                              ┌──────────────────────────────┐
   按 future 授权配置存在 ────►│ decider（⑤ 的 owner）          │
                              │   requires: [speaking]   ← 授权边│
                              │   requires: [delivery]   ← 配送边│
                              └──────────────────────────────┘
                              ┌──────────────────────────────┐
   按 future 授权配置存在 ────►│ outbound-subscriber            │
                              │   requires: []                 │
                              │   provides: [delivery]         │
                              └──────────────────────────────┘
```

**这张图里有一件事必须被点出来，初稿没点。** 今天 `resident.ts:117` 逐字说「There are four legal compositions, and they are **two independent branches**」。上图给 `decider` 与 `outbound-subscriber` 各加了一个「按 future 授权配置存在」的轴——**那是把两个轴变成四个轴、四个组合变成十六个。**

`resident.ts:162-166` 逐字：

> This is deliberately **not a Profile system, a capability registry, an optional-plugin mechanism or a conditional-composition framework**, and **it should not become one**. It is the local implementation of one product need … and a general facility built ahead of a second such need would be an architecture layer invented for a need that has not arrived.

**所以上图右边的两个新轴不是可以随手加的。** 它们要么被证明是**同一个**授权配置的两个成员（一轴，不是两轴），要么这一片就撞上了 resident 逐字禁止的那件事。**本文没有回答这个，因为回答它需要先知道那个授权配置是什么——而那正是 §17.2 留给 Human 的第 1 条。** 记在这里，作为 §16.2 被标成「将来的形状，不是承诺」的第二个理由（第一个是 §5.3 的开口）。

### 16.3 六个问题的逐条回答

| 问题 | 答案 |
|---|---|
| **哪些成员始终存在** | base 九成员（roster 在 `resident.ts:198-252`，`resident.ts:146-148` 说它「the base nine are still the common prefix of all four compositions … still a literal prefix of every larger one」） |
| **哪些按 scope 存在** | `language` 按 model 配置；`chain` 五成员按 repository 配置；`decider` 与 `outbound-subscriber` 按**将来那个授权配置** |
| **谁 waiting** | 今天：`requires` 未满足者（`runtime.ts:94-105`）。将来：`decider`。**但初稿说「只有 `decider`」是错的，评审打了出来**：`language` 只在 `--model-endpoint` 与 `--model` **同时**给出时才加载（`resident.ts:275-278`），而 `readConfig` 缺任一项就 throw（`plugin.ts:270-275`）。**所以组合里没有 model 配置时 `language` 根本不在，`decider` 照样 waiting，resident 起不来。** 出站路径**因此继承了 model 配置这个前提**——而 `speak` 的实现（`renderAnswer`）是确定性的、并不用模型。这是一个真实的耦合代价，记录在此，本轮不解决 |
| **谁在 subscriber absent 时仍 active** | **Language 与 base 全体。** 这是 §8 的核心：subscriber 的缺失**不得**让任何既有成员失活。而 `decider` 会 `waiting`——这是**诚实的**：没有配送就没有出站。**Language 不得 waiting。** |
| **哪个 dependency 表达 authorization** | `decider.requires(languageSpeakingService)`。它说的是「这个 plugin 被组合授予了到达 Language 表达能力的路」。按 §6，在 fixed product mandate 下这就是授权的**全部内容**；它**不**回答「这一次该不该说」 |
| **哪个 dependency 只是 delivery dependency** | `decider.requires(humanDeliveryService)`。它只说「话往哪走」，与「谁被允许说话」无关 |

### 16.4 一句话的形状

```text
两条边都从 consumer 出发；Language 与 transport 互相不知道对方存在。
Language 的 requires 不因出站而改变。provides 只加一项，且不与 variant 发生关系。
```

---

## 17. Smallest implementation slice

### 17.1 今天：**没有可以诚实切出的第一片。**

理由就是 §14.3：

```text
languageSpeakingService  —— REFUSED（无 callable need）
humanDeliveryService     —— REFUSED（无 callable need）
```

两个契约都建不了，就没有任何成员可以加载——**依据是 `plugin-design-spec.md:240` / `:499` 的 cosmetic-provides MUST，不是「Runtime 装不上」**（§14.3 末段）。

**「先建 transport，将来接上」为什么不成立——初稿的理由是错的，这里是正确的那个。**

初稿说那会是一个「只有测试能用的 plugin」，并引 `contracts.ts` 的「published for nobody」与 `plugin.ts:69-74` 的「the day a real consumer exists is the day this line gets an argument rather than a guess」。**这两条引文本身都对，但它们支撑不了初稿那个结论**——§14.3 的反例二已经证明：`chronicleService` 正是**先建、后接了 9 天**，期间唯一调用者是测试，而它今天承重。**「先建、后接」不是被禁止的。**

**正确的差别只有一条：**

```text
chronicleService：建的时候，「将来要回答什么问题」已被指定   → 可以先建。
出站的两个契约：建的时候，「将来要回答什么问题」正是 Human ruling #5 冻结的那件事 → 没有东西可以预先满足。
```

**这不是「不能等 consumer」，是「没有可指定的 consumer 行为」。** 一个 `HumanDeliveryService` 今天可以写出类型，但它**没有任何一条能被写下来的语义**——「什么情况下该 deliver」「谁决定该 deliver」全部空缺。**先建它，建的不是一个等待中的契约，是一个没有含义的空壳。**

**次一级、方向一致但单独不够的依据**：`plugin-design-spec.md:287` 逐字「**SHOULD** 测试方便**不是**扩大 public API 的充分理由」；`:530` 逐字「若主要理由是"以后可能有用"，默认不创建」。两条都是 SHOULD / 默认，**单独都拦不住**，与上面那条合起来才是完整依据。

### 17.2 解锁条件（唯一一条）

```text
⑤ 必须有一个真实的 owner —— 某个 bounded plugin 回答「这件事值得说吗」，
    并且它的授权来自一次人类显式给出的、可撤回的配置（Human ruling #1 已经
    排除了 repository scope 承担这件事的可能）。
```

**但这里有一个次序冲突，初稿没有面对它，评审打了出来。**

本文开头逐字引了 Human ruling #5：

> Repository CI Attention **继续保持 BLOCKED，直到 Human Outbound path 合法成立**。

按这条，**attention 等 outbound**。而 §17.2 初稿把 outbound 的门槛写成「第 ⑤ 跳有没有 owner」——若 ⑤ 就是 Repository CI Attention，那就成了 **outbound 等 attention**。两句话不能同时成立，而 ruling #5 已经把方向定死了。

**本文不推翻 ruling #5，因此 ⑤ 与 Repository CI Attention 必须分开读：**

- **⑤ 是位置，不是名字。** 它是「这一次值不值得说」这个判断在链路上的**位置**；Repository CI Attention 是**今天唯一被命名过的候选人**，不是这个位置的唯一可能。
- **ruling #5 排除的是「拿 attention 当 outbound 的前提」**，不是排除这个位置本身。
- **所以门槛必须重述为不依赖任何具体候选人的一条**：出站的第一个 consumer 必须**自己**拥有 ⑤ 的语义（不论它叫什么）——而**今天仓库里不存在任何这样的 consumer**（§14.3 的反例二已把这个差别说清）。

**这条不是本轮能决定的，也不是本文能规定的。** 它属于 Human——与 `human-outbound-v0-boundary-review.md` §19.2 的前提 #1 是同一个问题，只是现在位置更精确了。

**因此本轮的诚实结论是**：第一片的门槛**不在组合层**。组合层能给的全部答案已经在 §16 给出，剩下的**两条**都归 Human：

1. **谁是第一个 consumer，它的 ⑤ 语义是什么**（本文不能替它命名）；
2. **§9.4 那个不变量 #4 的读法分歧**（「形成 vs 搬运」）——它决定 §12 A 的哪一部分合法。

**在 ruling #5 的字面下还有一条附加事实必须写明**：Repository CI Attention 今天**不能**被拿来充当这个 consumer，因为 ruling #5 让它等 outbound。**这不是本文的漏洞，是 ruling #5 的直接后果**——两者要能互相解锁，得先有一次 Human 裁决改变这个次序。

### 17.3 门开之后的第一片（形状已定，供将来直接用）

按最小原则，且全部使用**已经存在**的形状：

1. **`outbound-subscriber`**（新 plugin，一个）
   - `requires: []`，`provides: [humanDeliveryService]`
   - 自持一个命名管道 endpoint（照 `language/endpoint.ts` 的连接管理 + `desktop-session-observe/plugin.ts` 的平台门）
   - **一个 client / 无 queue / 无 retry / 无 history / 无 delivery guarantee**
   - client 断开 = 普通 transient state；无 client 时 `deliver` 返回 `{ outcome: 'unavailable' }`
   - `active` 与 client 是否连着**解耦**（依据：`current-stage.md:693`）
2. **`language`**：`provides` 从 `[]` 变成 `[languageSpeakingService]`。`requires` / `exposures` / `makeReader` **不变，因此不产生新 variant**（§3、§12 E）。
   **但「一个字节不改」不准确**：`provides` 本身被两个断言钉住——`test/language.test.mjs:1363`（`assert.deepEqual(languagePlugin.provides, [])`）与 `:1571`（`assert.deepEqual(repositoryLanguagePlugin.provides, [])`）。**这一片必须同时改这两处，并且改完之后仍要能证明「不产生新 variant」**（variant 只由 `requires`/`exposures` 区分）。§17.3 初稿漏掉了它们。
3. **`decider`**：`requires: [languageSpeakingService, humanDeliveryService]`。
   **它的 body 不是初稿写的「取 owner 的 material → `speak` → 原样 `deliver`」——那句话与 §5.3 的签名不对型**（`speak` 收的是 exposure 读句柄，不是 occurrence）。**这个不对型就是 §5.3 末段登记的那个开口，它必须在第一片动工之前先被合上，而合上它的两条路都不在本轮权限内。**

**必须在测试里约束的性质**（不是实现细节，是 §9.4 与 §8 的承重点）：

- **consumer 交给 `deliver` 的 lines 逐字等于 `speak` 返回的 lines**（§9.4 的纪律）——**除非**采用 §7.2 理由四记下的更轻形状（`deliver` 收整个 reply），那时这条性质变成结构性的，测试不再承重；
- **`deliver` 在无 client 时返回 `unavailable`，且 subscriber 仍 `active`**（§8.3，落点参照 `test/language.test.mjs:1991`）；
- **`languageSpeakingService` 的输入不是字符串**（§15.3）。

---

## 18. What must NOT be generalized

本轮的「不做」清单。每一条都标明它防的是什么。

### 18.1 组合机制层

| 不建 | 防的是 |
|---|---|
| **Global Capability Bundle** | 「所有 optional capability 塞进一个 bundle」——用户 §一 明确点名不得预设 |
| **Universal Language Profile** | 会得到 guard 预言的 `CalendarLanguage` / `MailLanguage` 家族 |
| **Notification Registry / Speak Registry / HumanTransport Registry** | 注册表是「按业务类型不断扩张」的入口（`core-architecture-v0.md` §11） |
| **Central Authority / Central Proactivity / Global Brain** | `core-architecture-v0.md` §11 禁止清单 |
| **optional requires** | Runtime 的 `requires` 是**硬要求**（`runtime.ts:88-107`）。让它变可选就是在 Runtime 里加一个 policy，而 `resident.ts:153-154` 逐字说：「Teaching the Runtime to keep an invariant of the *composition* would be **moving a policy into the mechanism**。」 |
| **generic OutboundCoordinator** | §15.5 |
| **OutboundLanguage variant / 第三个具名工厂** | §3；`plugin.ts:320-321` |

### 18.2 传输层

| 不建 | 防的是 |
|---|---|
| **durable queue** | 排队需要「重试几次 / 何时过期」——没有 owner 的判断（§8.4） |
| **retry** | 同上；且重复送达需要 dedup 语义，而它今天不存在 |
| **history** | 需要持久化决策，属于 Chronicle 的领域，不是 transport 的 |
| **delivery guarantee** | `delivered` 只表示写入成功（§7.3） |
| **multi-client / fan-out** | 需要队列与顺序规则，v0 无 |
| **ack / 二次 frame 协议** | v0 无；人有没有读到不由 transport 声称 |

### 18.3 表达层

| 不建 | 防的是 |
|---|---|
| **`speak(text: string)` / `speak(prompt)` / `speak(any)`** | §15.3；会让任何 consumer 绕过 semantic ownership |
| **新建 Message / Utterance / RenderedMessage 类型** | `renderAnswer` 已经产出 `readonly string[]`；`LanguageReply` 已经存在（§7.2） |
| **在 transport 里做换行 / 包装 / 拼接** | transport 不理解 Domain（用户 §十）；且会与 `oneLine` 的「一个元素一行」不变量冲突 |
| **Grounded LLM Expression**（让模型解释已读到的事实） | `language-tool-use-loop-v1.md:235` 早已记录为后续独立 slice，**本轮不因出站而解冻** |

### 18.4 判断层（最要紧的一组）

| 不建 | 防的是 |
|---|---|
| **salience / importance / 「值得说吗」判断** | `current-stage.md:1433` 冻结为「未进入，且未被预埋」；`relevant ≠ important`、`relevant ≠ salient`、`relevant ≠ should notify` 三个等式**都不成立** |
| **抑制规则**（频率 / 安静时段 / 去重 / 冷却） | 它们属于 ⑤ 的 owner，而 ⑤ 今天不存在 |
| **用 subscriber 连接状态推导通知许可** | §15.7；违反 `principles.md` §5 与 Human ruling #1 |
| **为 Memory 借出站重新开口** | `memory-reactivation-v0-blocked.md`：Memory 已封箱，不得借出站 slice 重开 |

---

## 19. Verdict

### **NARROW**

### 19.1 为什么不是 READY

第一片**今天切不出来**，而且原因不是没想清楚：

```text
两个候选契约都被 Contract Creation Gate 判 REFUSED（§14）：
  languageSpeakingService —— 无真实 callable need
  humanDeliveryService    —— 无真实 callable need
没有任何成员可以加载
  —— 依据是 plugin-design-spec.md:240 / :499 的 cosmetic-provides MUST。
     （不是「Runtime 装不上」；初稿在此处说错过一次，见 §14.3 末段。）
→ 没有可实现的 slice。
```

**门槛不在组合层，也不在任何一条具体的链路跳上。** 初稿把它写成「链路第 ⑤ 跳有没有 owner」，**评审指出这与 Human ruling #5 的次序冲突**（ruling #5 让 attention 等 outbound，不是反过来），已按 §17.2 重述为不依赖任何具体候选人的一条：

> 出站的第一个 consumer 必须**自己**拥有「这一次值不值得说」的语义——**而今天仓库里不存在任何这样的 consumer。**

Human ruling #1 把 repository scope 从 interruption authority 里排除，ruling #5 又让 Repository CI Attention 等 outbound。**两个裁决合起来，意味着那个语义必须由一次新的人类显式行为来指定——那是 Human decision，不是本文能做的。**

**READY 还差第二件事，同样是评审打出来的**：§5.3 末段登记的那个开口——`speak(exposure)` 携带的是**读句柄**，而 ⑤ 产出的是**一次迁移**；跨 speaking 边的 material 形状没有答清，而合上它的两条路（加第四个 exposure → 第三个具名 variant；或引入新 occurrence 类型）都不在本轮权限内。**因此「形状已定、照着做即可」这句话对 §17.3 第 3 条不成立。**

### 19.2 为什么不是 BLOCKED

**因为组合问题在「边的方向」这一层已经答清，答案不与任何冻结边界冲突。**

本轮给出四个确定的、有源码支撑的结论：

1. **不是同一 composition dimension**（§3）：入站 vs 出站，方向相反；variant 机制承载的是 `requires` + `exposures`，出站不进入它。**（射程限定见 §3.2 第一层）**
2. **guard 触发是对的，但答案是「不要把反向 dependency 错当成 variant」**（§12 E、§3.3）：`provides` 一侧的「可选性」由**组合里有没有 consumer** 表达，不由 Language variant 表达。**不需要抽象 variants，也不需要新机制。**
3. **`Language requires transport` 是错误建模**（§10）：Language 无 trigger、无可送之物；且会把「有没有人在听」变成「能不能说话」的开关。
4. **两条边都从 consumer 出发，且互不知情**（§10.2、§16.4）：authorization 边是 `decider.requires(speaking)`，delivery 边是 `decider.requires(delivery)`。**不需要 Authority framework**（§6）。

**但「答清」的准确范围必须写明——初稿写得太宽，评审打掉了三处：**

| 答清了 | 没答清 |
|---|---|
| 两条边的**方向**（都从 consumer 出发） | 跨 speaking 边的 **material 形状**（§5.3 末段：`speak(exposure)` 载读句柄，不是 occurrence） |
| `provides` 的可选性**不进 variant** | `decider` 与 `outbound-subscriber` 是**一个**授权轴还是**两个**（§16.2 末段：两个就撞上 `resident.ts:162-166` 逐字禁止的 conditional-composition framework） |
| 不需要 Authority framework | 不变量 #4 的**读法**（§9.4 末段：本轮的读法与上一份 review 相反，两份文档不能同时都对） |

**所以 BLOCKED 仍然不是正确的裁决**：这三个开口**没有一个是架构障碍**——它们全是「要一次 Human 裁决才能定」的问题，而 NARROW 的定义正是「形状确定，有一个决策属于 Human」。**判 BLOCKED 会把它说成「路走不通」；路是通的，只是终点要 Human 指定。**

### 19.3 与上一轮裁决的关系

`human-outbound-v0-boundary-review.md` 判 **NARROW**，三个待裁决前提之一是「是否需先做 Composition Boundary Review」。**Human 已裁决要（ruling #3），本轮即为回应。** 本轮把那一轮模糊的「授权从哪来」问题**定位到了链路 ⑤ 这个位置**（§17.2），并把「第一 transport」这个已裁决项（ruling #2）的形状写定（§7.3、§16.2）。

**本轮的 NARROW 与上一轮的 NARROW 是同一个决策的两面**：上一轮说「形状确定，有一个决策属于 Human」；本轮说「**那个决策现在有精确的位置了**」。

**但本轮与上一轮之间有一处未消解的分歧，必须在这里写明，不能藏进正文。** §9.4 对不变量 #4 的读法（「形成 vs 搬运」）**与 `repository-ci-attention-v0-boundary-review.md:559` 的读法相反**——那一份逐字说该不变量「**不区分**「主动说」与「被动说」」。两份文档不能同时都对。**本文给出自己的读法与依据（§9.4 末段），但不代为裁定**；它必须由 Human 一并处理，因为它决定 §12 A 的哪一部分合法。§15.7 对 `human-outbound-...md:307`「standing grant」的处理同理：本文收回了自己的一刀切说法并给出限定（**授予的是通道，不是判断**），但那个限定也是本轮的判断。

### 19.4 下一轮的门槛

**本轮的结论不构成对 ⑤ 的任何推进。** Repository CI Attention **继续保持 BLOCKED**（Human ruling #5），本轮没有为它创造任何解锁条件，也没有为它预留任何接口。

要往前推，需要的是一次 **Human 裁决**：**「这件事值得说吗」由谁回答，在什么可撤回的人类行为授权下回答。** 在此之前，`src/` **一个字节都不应该改**。

---

## 附：本轮未测事项（不得读成 PASS）

- 未跑任何测试；本轮零源码改动。
- 未接触真实模型端点（本机不可达）。
- 未做 Windows toast 实测（Human ruling #4 已移出 v0）。
- 未跑 `detect_changes` 作为「已验证」的证据——本轮唯一产物是未跟踪文档，`git diff` 看不见它；若有输出，必须读作「**未看见**」。
- 本文所有「既有行为如此」均为**读源码**得出，不是执行得出。**唯一的例外是 §14.3 反例二**：那是 `git log -S` 的执行输出，是执行得出的事实，不是阅读得出。
- **对抗性评审只做了只读检查**：六个子 Agent 只读文件、跑只读命令，未改任何源码或测试；它们的结论已由主 Agent 逐条回锚（§0.4）。**「多个 Agent 都同意」不是证据**，本文每条承重结论都指到 `file:line` 或 git 输出。
- **本文不构成对 ⑤ 的任何推进，也不改变任何裁决**：Repository CI Attention 仍然 BLOCKED，`src/` 仍然一个字节都不应改。
