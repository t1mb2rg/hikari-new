# D0 · G-1 Human 裁决与收窄设计 — Design Ruling

> 基线：`89d363d0394174af55ca721c15009901777bb53c`（本轮开始时 `git status --short` 为空）。
>
> 本轮**不进入 G-1b / G-1c 的生产实现**。除 Q4 明确授权的两处外，未修改任何生产代码，未 commit，未 push。
>
> 上游：`desktop-context-understanding-g1-authorization-boundary-review.md`（整体 NARROW；G-1a 可设计 / G-1b BLOCKED / G-1c BLOCKED；第一片 READY）。本文承接它 §9 的四问，以及 Human 对四问的回答。
>
> **本文所有结论都以当前源码为准**，每条给出文件与行号。凡未实测的，标为【未验证】。

---

## §0 结论摘要

Human 已就 Q1–Q4 给出裁决。本轮的产出是把四条裁决变成一份**精确到 owner、调用路径、回答出口与验收测试**的设计建议，并对本轮研究重点的八项逐一作答。

| # | 研究项 | 结论 |
| --- | --- | --- |
| 1 | Grounded Synthesis 的真实读取与回答链 | 已复核，链路与行号见 §3.2、§3.3 |
| 2 | 单向门的设计原因与已有测试 | 门保护的是两件事，不是一件：**没有第二个判断**、**没有逐句分类负担**（§2） |
| 3 | `desktop-content-read` 在有真实消费者后如何提供带来源的 reading | 提供 `desktop-content-read.read@1`，**返回事实不返回行**；由 Language 调 owner 的渲染器（§3.4） |
| 4 | 能否复用现有 Language 机制 | 能，且只需要复用；清单见 §3.5。不需要新抽象 |
| 5 | 是否需要 Composition Boundary Review | **字面不触发，精神上本文正面作答**（§4）。这是本轮最需要 Human 复核的一条判断 |
| 6 | 一次性授权怎样约束模型调用、端点与内容传输 | 授权是**请求局部量**，永不进入激活状态；它约束的是「读不读」，不是「发给谁」（§6.1） |
| 7 | 如何防止未授权路径触及正文 | 正文**不是 capability**，因此不在 `tools[]` 里；未授权请求在结构上到不了那段代码（§6.2） |
| 8 | 如何确保模型回答不成为新的控制权来源 | 回答出口的形状不变，模型输出与任何 gate 之间**没有边**（§6.3） |

三条最重要的发现：

> **一、正文必须以「材料」进入，不能以「能力」进入。** 这是 G-1b 唯一的岔路口，也是本方案比另外三条候选都小的全部原因。材料不需要新的 `ServiceContract` 语义、不需要动 `exposure.ts`、不需要碰变体守卫、不需要给模型一行新的 `tools[]`。它复用的是**已经存在的那条区分**：`answer.ts:43-48` 已经为「第二种材料」（record）开过一次门。

> **二、正文不能进 system prompt。** `prompt.ts:58-63` 自己点名了失败模式：把外部文本放进 prompt，失败形态是**模型在其中读出一个「请求」**。system message 是承载 Hikari 规则的最高信任位置；窗口正文进那里，等于把注入抬到指令通道。正确的位置是 system message **之下**（§3.3-2）。

> **三、Q4 已实施，且它不构成 G-1b / G-1c 的任何证据。** 描述收窄 + 注入 fixture 是本轮唯一落地的改动（2 个文件 + 2 条测试），全量 845 / 841 pass / 0 fail / 4 skipped，与本轮之前相比只多了这 2 条，skip 数不变（§10）。

---

## §1 裁决落点：四条回答各自变成了哪条约束

| 裁决 | 原文要点 | 变成的设计约束 | 锚点 |
| --- | --- | --- | --- |
| **Q1** | 批准一次性显式命令授权；普通自然语言询问不构成授权；授权命令必须明确表达本次窗口内容将发往用户配置的模型端点，可能是远程端点；限定本次请求、目标窗口与实际配置的端点；不允许持久复用 | 授权载体是**协议词汇里的第三个词**，不是确认交互、不是环境变量、不是持久开关。授权是单个 `answer()` 调用内部的局部量 | §5.1、§5.2-1、§6.1 |
| **Q2** | 选 reading 语义：正文必须作为**有来源、有读取时间、有不确定性标注**的阅读材料进入 Language，不能作为无来源的模型上下文；外部窗口正文仍然是不可信输入 | 正文块 = owner 渲染的 `GroundedBlock`，与 reading 同一条渲染路径；同时因「不可信输入」而**不得**进入 system message | §3.3-1、§3.3-2 |
| **Q3** | 原则批准有界模型回答出口；不得全局取消单向门；必须先分析门保护的行为，提出局部例外的精确边界、测试与失败条件；模型解释不得覆盖 owner reading，不得产生新事实或行动授权 | 门获得**第二个开合条件**，形状（位置、标签、转义、截断闸）全部不变；出口由 §2 的分析推导，边界与失败条件由 §5.3、§5.4 钉死 | §2、§5.3、§5.4 |
| **Q4** | 批准描述收窄与注入 fixture 补测；只修正描述真实性和已有测试缺口，不扩大模型读取能力 | 已实施。见 §10 | §10 |

---

## §2 研究项 2：单向门保护的是什么

Q3 要求先分析门保护的行为。源码里门的设计理由集中写在 `answer.ts:25-30`，把它拆开，它保护的是**两件不同的事**，而这两件事需要分开对待：

**P1 —— 没有第二个判断。** `answer.ts:26-28`：「a model that has seen a reading and is allowed to comment on it is a model forming a judgement about the desktop from a foreground process name, which is exactly the inference `desktop-context.read`'s own description says Hikari never drew.」一个读过判词、又被允许评论它的模型，会做出**同一个事实上的第二个判断**；而这个判断恰恰是 `desktop-session-awareness/exposure.ts` 明文否认 Hikari 做过的那些引申。

**P2 —— 没有逐句分类负担。** `answer.ts:28-30`：「A grounding path where the model's words reach the human would have to answer, per sentence, whether the words were a reading or a claim about one. Keeping the door shut means there is no such sentence to judge.」如果模型的话能进 grounded 回答，构建流程就必须**逐句判断**这句话是「转述」还是「主张」——而它做不到。

这两条的后果不同：**P2 不是靠论证满足的，是靠设计回避的**。所以任何局部例外都不能声称「我们能判断模型这句话是在转述」——它只能让那个判断**不必要时也不成立**。

### 2.1 既有例外为什么没有破坏 P1 / P2

门已经为「第二种材料」开过一次（`answer.ts:248-254`），条件三个同时成立：`recordOnThePage`、`!step.truncated`、`step.content.trim() !== ''`。它安全的理由写在 `answer.ts:43-48`：

> a second kind of material now reaches the model's context. Until a machine has a confirmed statement on file, the readings *are* everything the model was given, so a sentence the model adds to them can only be a sentence about them — the judgement the paragraph above refuses to make. Once there is a record, the model is holding two things, and a person's question can genuinely be about both at once.

即：

- **它没有回答 P2，它取消了 P2 成立的前提。** 标签（`express.ts:94-97`）只声称**形式**上的来源（「下面不是读回来的内容」），从不声称**内容**上的推导关系。逐句分类因此不需要发生。
- **它靠结构而不是靠语义保证 P1。** 模型的话永远在**所有** reading 之后，永远在一段以「这不是读回来的内容」开头的段落里（`prompt.ts:88-93` 的反面表述：模型无法让一行**成为** reading，因为 reading 永远在段落之外）。
- **它由页面事实而非存储事实把关。** `promptListsRecord`（`prompt.ts:230`）问的是「prompt 有没有把 record 摆在模型面前」，不是「store 里有没有 record」；`answer.ts:196-203` 记录了这个选择的原因（`confirm` 可以在等待模型时从另一条连接进来）。

### 2.2 钉住这条门的测试

`test/language.test.mjs`：`:417`（tool_calls 非空时模型 content 一个字都不进回答）、`:435`、`:449`、`:464`、`:503`、`:974`、`:1018`、`:1123`（一旦读过 capability，之后模型写的散文不进回答也不报错）、`:3037`、`:3105`、`:3116`（无 record 时 grant 句「你负责的事有两件」不得出现）、`:3128`（有 record 时合成段是三行：两行标签 + 一句）、`:3166`（无 record 时 `reply.lines` 逐字等于 `renderFocus([])`）、`:3185`（提问中途落盘的 record 不得改变本次 gate）、`:3230`（标签第一行 ≤24 列、第二行 ≤80 列）、`:3264`（截断）、`:3283`（未执行的调用）。

**门「只开一次、只在这一处」这一点本身，由 `:3166` 和 `:3185` 两条间接钉住**——它们是本轮新增验收测试（§8）必须继续满足的回归面。

---

## §3 研究项 3 + 4：正文以什么身份进入，复用哪些机制

### 3.1 决定性的区分：材料 vs 能力

`answer.ts:165-166` 已经写下这条区分，只是一直只有一个例子：

> the record is **material**, not a reading, and `turn` below is advanced only by reads.

三条候选路线：

| 路线 | 形状 | 代价 |
| --- | --- | --- |
| **C-1 作为 exposure** | 正文成为模型可调用的一项 `tools[]` | 加进 `LANGUAGE_EXPOSURES` ⇒ 每个 `ask` 都能读正文，**直接违反 Q1**；新建第三条列表或第三个变体 ⇒ 触发 `exposure.ts:40-48` 的守卫；且 `test/language.test.mjs:1509/1551/1567/1595/1723` 五处断言会一起断 |
| **C-2 作为 per-request 能力** | 每次请求带一份工具菜单 | 回路的有界性证明（`answer.ts:62-85`：每个迭代轮必须消耗一项尚未读过的能力，列表是闭集）主语从「变体」变成「请求」；这是**第二种可变可达性机制**，比问题大 |
| **C-3 作为材料** | 正文与 record 同类：请求带来的材料，模型不能调用 | 只需扩展现有那条区分 |

**取 C-3。** 理由不只是「更小」：C-1 与 C-2 都让模型获得**对正文的调用权**，而 Q1 的授权是**人**对**这一次**给出的；把决定权交给模型，等于让授权能否兑现取决于模型是否愿意调用——而那使授权不再可核对。

### 3.2 授权载体的形状

`types.ts:68-70` 规定词汇：

> Two words is the whole vocabulary and it is meant to stay small. Each one is a different act by the person at the other end — asking Hikari something, and telling Hikari to keep something they said — and **a third would have to be a third act rather than a third spelling of one of these.**

读窗口正文是否构成第三个「act」？**是**，而且它是这个插件里**唯一一个把环境字节送出这台机器的动作**。`ask` 从不发送环境字节；`confirm` 只写一条本地记录；第三个词是该动作本身。所以第三个词不是「第三种拼法」，是第三个 act，`types.ts` 自己的规则允许它。

**建议词汇：`screen`。**（命名最终由 Human 定；`screen` 短、与 `desktop_content_read` 的领域一致、且不含动词歧义。）请求形状仍是 `{word, text}`，**不加第三个字段**——词本身就是授权，`text` 是问题。

### 3.3 位置的取舍

**3.3-1 正文块是 `GroundedBlock`，进 `blocks`。**

- 人看到的就是 owner 渲染的那几行（`renderAnswer`，`express.ts:128`），因此「模型解释不得覆盖 owner reading」（Q3）有物理保证：解释在最下面，reading 在上面且不可被替换。
- `renderContentRead` 已经对整条数组做 `.map(oneLine)`（`presentation.ts:76/82/87/94`），行伪造防护是既有的。
- 代价是一个命名问题：`GroundedBlock.name` 会经 `advanceDialogue` 进入 referent，并被人看到（`express.ts:139`：`（这一轮是按上一轮读取的内容理解的：${reads.join('、')}…）`）。取 `'desktop_content_read'`，与既有的 `work_focus_read` / `desktop_context_read` 同形。

**3.3-2 位置：system message 之下的 user 消息，不进 system prompt。**

这是本轮需要 Human 复核的第二条判断，理由取自仓库自己的文字：

- `prompt.ts:58-63`：把外部文本注进 prompt 的失败模式，是**模型在其中读出一个「请求」**。
- 若正文进 system message，它就落在承载 Hikari 规则的**最高信任**位置；即使加了「低信任」一句，注入与指令之间也只剩一句话的距离。
- 因此正文放在 system message **之后**、问题之前，作为一条独立的 user 消息。多条 user 消息是常规形状，且它把材料放在结构上正确的层级。

模型面对的说法由 `prompt.ts` 提供（该文件是模型侧措辞的 owner），一条固定句 + 正文块行。**这一条不授予任何权限**，门是另一个问题。

**备选（供 Human 推翻）**：放进 system message 的独立 section，复用 `continuityParagraph` 的机制。它少一条消息形状，代价是上面那条信任层级论证。本文不建议。

### 3.4 研究项 3：`desktop-content-read` 提供的 Service

- 新增 `src/desktop-content-read/contracts.ts`：`desktop-content-read.read@1`，方法 `read(): Promise<ContentRead>`。
- **返回事实，不返回行。** 这条沿用 `language/contracts.ts` 的既有论证：由调用方提供行，等于让调用方决定 Hikari 说什么；由调用方提供事实、owner 渲染，则措辞留在 owner 手里。`renderContentRead` 已在 owner 的 barrel 里导出（`src/desktop-content-read/index.ts`），Language 直接调它。
- **Contract Creation Gate 今天满足。** `index.ts:21-23` 写明「provides none, **because nothing inside the composition calls it**」；本方案让 Language 成为真实调用方，前提因此成立。
- **连带改动**：`plugin.ts` 头部「What makes both empty honest is…」那段论证的前提（无调用方）失效，必须改写；`provides: []` → 一个。**这是新增 public contract，需要 Human 单独批准（F3）。**
- **平台影响是零增量**：`desktop-content-read` 已在默认编队的无条件基础名单里（`cli/resident.ts:289-291`，无平台条件），而 Language 自己已在非 win32 上抛出（`plugin.ts` 的 setup 检查）。**但耦合是新的**：`requires` 是硬依赖（`runtime.ts:109-111` 的 `every`，没有 optional），因此在一台只坏了 content-read 的 Windows 机器上，Language 会从 `active` 变成 `waiting`。这条要写进验收（T13）。

### 3.5 研究项 4：复用的既有机制（清单）

| 复用什么 | 位置 | 新造什么 |
| --- | --- | --- |
| reading 的渲染与转义 | `express.ts:128` `renderAnswer` / `oneLine` | 无 |
| 正文的渲染与来源标注 | `presentation.ts:67` `renderContentRead`（已导出） | 无 |
| 「材料 vs reading」的区分 | `answer.ts:165-166` | 无 |
| 「页面事实」式 gate | `promptListsRecord`（`prompt.ts:230`） | 同名同形的 `screenOnThePage` |
| 合成段的位置、标签、截断闸 | `answer.ts:248-254` + `renderSynthesis`（`express.ts:183`） | 标签第二行按「页面上有哪些材料」组合（§5.3-3） |
| 请求词汇的封闭性 | `LanguageWord`（`types.ts:70`） | 第三个词 |
| 失败的可说出口 | `groundingFailureLines` / `failed` | 无 |
| Service → 事实 → owner 渲染 | `language/contracts.ts:52-66` 的论证 | 一个 ServiceContract |

**不需要**：新的 exposure、新的变体、per-request 工具菜单、权限对象、token、授权台账、路由器、Memory、Experience、持久化。

---

## §4 研究项 5：要不要 Composition Boundary Review

`exposure.ts:40-48` 的守卫原文：

> **If a second independently optional domain capability ever appears, the answer is not a third literal list here — it is a Composition Boundary Review of whether capability reachability should be decided at composition time at all.**

**字面判定：不触发。** 守卫的主语是**模型可调用的能力**在**组合期**的可达性。本方案：`tools[]` 一个名字都不加；`LANGUAGE_EXPOSURES` 仍是 2、`LANGUAGE_REPOSITORY_EXPOSURES` 仍是 3（`exposure.ts:114-131`）；变体轴仍是「有 repository scope / 没有」，仍是 2 个变体。守卫那句「a second such capability would make four variants」描述的乘法在这里不发生，因为没有第二个轴。

**精神判定：本文正面作答，不躲在字面后面。** 守卫真正关心的是「可达性该不该只在组合期用一份字面量决定」。本方案确实引入了**第二个 gate**——决定什么**材料**到达模型的那个 gate。它是新东西，必须交代清楚：

> 它不是「能力可达性」的第二个机制。它是**已经存在的那条材料/散文区分**（`answer.ts:43-48`）的**第二个实例**：record 由「这一次激活里有没有已确认的话」把关，正文由「这一次请求有没有授权」把关。两者都不是 capability，两者都不可被模型调用，两者都只在**请求局部**存在。守卫要防的是 2ⁿ 个变体，而这里变体数没动。

**需要 Human 复核的地方**：如果 Human 认为「请求期的材料 gate」也算守卫所说的 reachability，那结论就要翻转成「先做一次 Composition Boundary Review，再做本方案」。**本文的意见是：守卫的字面与精神都不要求这样做，但这条判断是本轮最容易被读成特殊申辩的一条，所以单独列出来。**

---

## §5 最小方案 D1（完整、可测试）

### 5.1 三个新增的名字（其余全部复用）

| 名字 | owner | 形状 |
| --- | --- | --- |
| `'screen'` | `language/types.ts` | `LanguageWord` 的第三个值 |
| `desktop-content-read.read@1` | `desktop-content-read/contracts.ts` | `read(): Promise<ContentRead>` |
| `'desktop_content_read'` | `language/express.ts` | 正文块的 `GroundedBlock.name` |

### 5.2 调用路径（逐段）

1. **入口。** CLI 新增一个授权命令（`hikari ask --about-screen "…"` 或独立动词，命名待定）。usage 文本必须写明：**本次读取到的窗口正文会发送到 `--model-endpoint` 指定的模型端点，可能是远程端点**。这与 `ask` 现有做法一致（`ask` 的披露同样只在 usage 文本里，`src/cli/options.ts:347` 一带），不开新的披露形状。
2. **协议。** 请求 `{word: 'screen', text: '<问题>'}`，仍是两个字段。
3. **`languageRequestHandler`（`plugin.ts:388-395`）。** 现在是 `'confirm' ? … : …` 的二元式，注释写明「A `switch` with a default here would be a second statement of the vocabulary」。改为**三分支、无 default** 的穷尽式。
4. **`Answerer`。** `answer(text)` 逐字不变（现有调用方与测试因此不受影响），新增 `answerScreen(text)`。两者的公共体抽成一个私有函数，授权是它的一个参数，**从不落到闭包外的任何地方**。
5. **正文读取，在模型被调用之前。** `answerScreen` 先 `await` 那个 Service；失败即返回 `failed`，**模型一次都不调用**（§5.4-3）。成功后：
   - 把 `renderContentRead(read)` 组成正文块推入 `blocks`；
   - 把同一份行推进模型消息序列（§3.3-2）；
   - **此时 `blocks` 已非空**，因此后续任何一步都走 grounded 分支。
6. **模型回路本身一行不改。** `tools` 仍是 `toModelTools(dependencies.exposures)`，模型看不到正文能力。
7. **回答出口。** 门获得第二个开合条件（§5.3）。
8. **不写任何东西。** 与 `ask` 相同：零 Chronicle 追加，零持久化。

### 5.3 回答出口：局部例外的精确边界

**5.3-1 门的条件（`answer.ts:248`）。**

```ts
if (blocks.length > 0) {
  const screenOnThePage = blocks.some((block) => block.name === SCREEN_BLOCK_NAME);
  if ((recordOnThePage || screenOnThePage) && !step.truncated) {
    const spoken = step.content.trim();
    if (spoken !== '') synthesis = spoken;
  }
  break;
}
```

`screenOnThePage` 是**关于页面的问题**，与 `promptListsRecord` 同形：它问的是「正文块在不在这一页上」，而不是「这次请求授没授权」。它只可能为真——正文块只在授权路径里被播种。

**5.3-2 四条边界，全部不变。** 位置（在所有 reading 之后）、转义（`renderSynthesis` 逐行 `oneLine`）、截断闸（`!step.truncated`）、空话闸（`trim() !== ''`）。

**5.3-3 标签。** 第一行**不变**（`（下面不是读回来的内容。`）——它是这个出口的承重句，且与模型写了什么无关地固定。第二行按**页面上实际存在的材料**组合，闭集三种情况：

| 页面材料 | 第二行 |
| --- | --- |
| 只有 record（今天的行为） | `Hikari 自己说的、没有核实过的话；你以前说的也一样。）` |
| 正文块在页面上 | `Hikari 自己说的、没有核实过的话；它读到的窗口正文也一样。）` |
| 两种材料同时在场（人以前说过话 **且** 这一轮读了窗口） | `Hikari 自己说的、没有核实过的话；你以前说的、和它读到的窗口正文也一样。）` |

理由：`express.ts:74-76` 指出第二行是读者**唯一**得知「关于自己过去的话的一句不是 record」的地方，所以那句话不能删；同理，正文在场时读者唯一得知「关于窗口的一句不是 reading」的地方也是这里。**两种材料同时在场时，前两条字符串各自会漏掉一种在场的材料**——`record` 那条不提窗口正文，`正文` 那条不提人以前说过的话——所以用其中任何一条都会让免责声明**少报**，也就是从一句真话变成一句不完整的话。

- **标签只随材料变，绝不随模型写了什么变**（`express.ts:70-71` 的既有禁令）。
- 三种页面的标签宽度都要满足 `test/language.test.mjs:3230` 的 24 / 80 列；验收测试要把该断言扩到三种情况。
- 这一条是**人可见的文案**，属冻结面（F5）。

> **Amendment（2026-10-13，Human 裁决）。** 本节原写「闭集**两种**情况」并只给两行表；F5 批准的也是「§5.3-3 的**两种**字符串」。实现发出三条（`SYNTHESIS_LABEL_REST`，`src/language/express.ts:122-126`），第三条 `both` 由 `answer.ts:332-336` 的三岔选择可达。Human 裁决**批准第三条**，理由即上段那条：第三行不是便利，它是两种材料同时在场时唯一完整的字面。本节表格、上一条宽度断言与 §12 的 F5 行均由本次裁决更新；这是本文唯一的「Human 裁决改写已批准设计文本」的处所，因此在此登记而不是静默改写。

**5.3-4 模型的话不能冒充 reading。** 结构保证不变：合成段永远在最后，永远以那个标签开头，永远不是 `blocks` 的一项，永远不进 referent。

### 5.4 失败条件（Q3 明确要求）

| # | 条件 | 行为 |
| --- | --- | --- |
| 1 | 模型什么都没写 | 无合成段（不变） |
| 2 | 这一步被截断 | 无合成段（不变） |
| 3 | **正文读不出来**（无目标窗口 / UWP / 超时 / 未读） | `failed`，**模型一次都不调用**。fail-closed：读都没读到，就没有把问题发出去的理由 |
| 4 | **没有授权** | 正文那条分支根本不执行；模型菜单里也没有它 |
| 5 | **授权被复用** | 不可能：授权是单次 `answerScreen` 调用的局部量。第二次 `ask` 既不带授权，也拿不到上一次的正文（测试 T7） |
| 6 | 授权字 + 空问题 | `refused`，**且不读正文**（先拒后读与先读后拒是不同的行为，取 fail-closed） |
| 7 | 模型点名 `desktop_content_read` | 不在 `tools[]` 里 ⇒ 未执行的调用 ⇒ `UNRUN_CALL_RESULT` 并结束（不变路径） |
| 8 | 正文 Service 缺失（Language `waiting`） | 现有 readiness 路径，不新增机制 |

### 5.5 owner 归属

| concern | owner | 明确不属于 |
| --- | --- | --- |
| 授权命令的措辞与披露 | `cli` | Language、content-read |
| 「第三个 act」的词汇 | `language/types.ts` | Runtime |
| 正文的读取与渲染 | `desktop-content-read` | Language |
| 材料进入模型的措辞 | `language/prompt.ts` | content-read |
| 门的第二个条件 | `language/answer.ts` | Runtime |
| 出口的形状与标签 | `language/express.ts` | content-read |
| 端点 | 无新概念：仍是唯一 endpoint，仍是不透明字符串，仍无本地/远程之分 | — |

---

## §6 研究项 6 / 7 / 8

### 6.1 一次性授权约束什么（研究项 6）

- **约束「读不读」**：授权是请求的一部分，请求之外不存在。
- **约束「不复用」**：授权是 `answerScreen` 调用的局部量，**永不进入激活状态**。`turn`（referent）是唯一跨请求状态，而它只记录**读过什么**，不记录**被授权过什么**。因此一次 `screen` 之后的一次 `ask`，模型看到的是 referent 里有一个 `desktop_content_read` 的名字，而**没有正文**——人必须重新授权（Q1 的「不允许持久复用」，同时它也是 fail-closed 的默认）。
- **不约束端点**：仓库里**不存在**本地/远程端点的区分（`src/` 全文无此概念，端点字符串只校验非空后原样交给 `fetch`）。因此「本次窗口内容将发往用户配置的模型端点，可能是远程端点」这句话只能由**命令的 usage 文本**说，不能由代码区分。**这是本方案诚实承认的天花板**，也是 Q1 的原文措辞所对应的做法。
- **约束目标窗口**：目标是 Hikari 自己观测到的那个窗口；端点**不携带操作数**，命令行上没有地方能指名窗口、进程或区域。这是 D0 已成立的性质，本方案不改变它。

### 6.2 未授权路径为何够不到正文（研究项 7）

| 路径 | 为什么到不了 |
| --- | --- |
| 普通 `ask` | 正文分支只在 `answerScreen` 里，`answer()` 里没有那段代码 |
| 模型自己 | 正文**不在 `tools[]`**：`toModelTools(dependencies.exposures)`，而 `desktop_content_read` 不是 exposure（T11） |
| `confirm` | 与正文无任何边 |
| 事件/订阅 | `desktop-content-read` 的采样只捕获窗口身份，不读正文（D0 已钉住） |
| 常驻控制通道 | content-read 的端点独立，且不携带操作数 |
| 落盘 | 本方案不写任何东西；无 Chronicle 家族、无 Memory |
| 其他插件 | 唯一新调用方是 Language，且它只在一处调用 |

### 6.3 模型回答为何不成为新的控制源（研究项 8）

- 模型输出与**任何** gate 之间没有边：它不进 `blocks`、不进 referent、不写 Chronicle、不触发读取、不产生授权。
- 唯一去向是 `renderSynthesis` 的那一段，位置在最后、标签固定、逐行转义。
- 注入的结构性缓解（`research §6.1`：工具回路里没有任何能行动的 capability）**在本方案下不变**：不加工具、不加行动路径。
- 因此一次成功的注入改变的仍然只是「Hikari 说什么」，不是「Hikari 做什么」。

---

## §7 为什么它比通用权限系统 / 模型路由器小

| | 通用权限系统 | 模型路由器 | **D1** |
| --- | --- | --- | --- |
| 新类型 | 权限对象、被授权者、授予记录 | 路由表、目标、策略 | **无**（三个名字，其余复用） |
| 新状态 | 授权台账 / 持久授予 | 路由注册中心 | **无**（授权是调用局部量） |
| 新契约 | 权限契约族 | 路由契约 | **一个**（`desktop-content-read.read@1`） |
| 模型可见面 | 新能力进入工具箱 | 新能力 / 新目标 | **零变化**（`tools[]` 逐字不变） |
| 变体轴 | 通常要多一轴 | 通常要多一轴 | **不变**（仍 2 个变体） |
| 冻结面 | 多 | 多 | 2 处词汇/门 + 1 个新契约 + 1 处文案（§9） |
| 撤回成本 | 台账需迁移 | 路由需迁移 | **删掉第三个词即可**，无残留状态 |

三条具体理由：

1. **授权不需要是对象，因为它是单次的。** 一次性、不持久、不跨请求的授权，其最小表示就是一个词。做成对象只会引入「谁能读这个对象」「它存在哪里」「过期怎么办」三个新问题，而它们都不存在。
2. **不需要路由器，因为没有第二个消费者。** `Provider 不决定 Consumer`，而这里只有一个 Consumer（Language），且它是通过**明确 contract** 直接读的——与它今天读 `work-focus.current` 用的是同一种机制。
3. **不需要新能力，因为模型不需要决定。** 「读不读窗口」这个问题由**人**在命令行上回答了；把它交给模型，等于让授权能否兑现取决于模型的选择。

---

## §8 验收测试（T1–T15）

| # | 测什么 | 钉什么 |
| --- | --- | --- |
| T1 | 未授权：`ask` 对正文 Service 的调用次数为 0 | Q1 结构性成立，不是靠分支顺序 |
| T2 | 授权请求的回答里，正文块逐字等于 `renderContentRead(read)` | Q2「有来源的阅读材料」 |
| T3 | 模型看到的那段与人在回答里看到的那段**逐字相同** | 既有不变式（「模型看到的工具结果，就是人被展示的那些行」）在正文路径上继续成立 |
| T4 | 正文块带来源：断言含窗口句柄、窗口标题、进程名、`窗口观测时间`、`读取时间`、截断原因，及 `GEOMETRY_NOTE` 的特征子串 | 验收项 4 的「来源 / 观测时间 / 读取限制」 |
| T5 | 门：授权请求且模型写了话 ⇒ 合成段在**所有** reading 之后，且以标签领起 | Q3 的出口边界 |
| T6 | 门不外溢：无授权 ⇒ 模型写了话也不出现（`:3166` 的正文变体） | 局部例外**是局部的** |
| T7 | 授权不跨请求：一次 `screen` 后一次 `ask` ⇒ 第二次零正文读取，回答里无正文 | Q1「不允许持久复用」 |
| T8 | 授权不跨激活：重启后无残留（沿用 `:3305` 的形状） | 无持久状态 |
| T9 | 读取失败 ⇒ `failed`，**且模型零调用** | §5.4-3 fail-closed |
| T10 | 空问题 + 授权字 ⇒ `refused`，**且零正文读取** | §5.4-6 先拒后读 |
| T11 | `tools[]` 的名字集合不含 `desktop_content_read`；模型写这个名字走 `UNRUN_CALL_RESULT` | 研究项 7 |
| T12 | 正文块 + 模型读取块同时在页面上 ⇒ 合成段在两块之后 | 位置不变式 |
| T13 | `desktop-content-read` 未激活 ⇒ Language `waiting`，且 readiness 说出缺哪个契约 | §3.4 的新耦合是**可见**的 |
| T14 | 授权请求零 Chronicle 追加 | 不落盘 |
| T15 | 截断的模型话在正文路径上也不出现；标签两行宽度在两种页面下都满足 `:3230` | 既有两个闸门与文案宽度 |

另需保持绿的回归面：`test/language.test.mjs:1509/1551/1567/1595/1723`（exposure 列表数量与名字不变）、`:3116`（无 record 时 grant 句不出现）、`:3185`（中途落盘不改 gate）。

---

## §9 需要 Human 单独批准的冻结面改动

| # | 改动 | 为什么是冻结面 | 建议 |
| --- | --- | --- | --- |
| **F1** | `LanguageWord` 2 → 3（`types.ts:70`） | 协议词汇；`types.ts:68-70` 明文规定第三个必须是第三个 act；`plugin.ts:388-395` 的二元分派要改成穷尽三分支 | `screen` 是否是正确的 act 与正确的词 |
| **F2** | `answer.ts` 门增加第二个开合条件 | 门「只开一次、只在这一处」是承重不变式 | 精确形状见 §5.3；Q3 是**原则**批准，这里要的是**具体**批准 |
| **F3** | `desktop-content-read` 提供第一个 ServiceContract | 新增 public contract；`plugin.ts` 头部与 `index.ts:21-23` 的论证前提失效，必须改写 | Gate 今天满足（真实调用方将存在） |
| **F4** | `Answerer` 增加 `answerScreen` | 导出接口的加宽 | 非破坏性；也可改为第二个参数，但两个方法让 `answer` 逐字不变 |
| **F5** | `SYNTHESIS_LABEL` 第二行按材料组合 | 人可见文案，且被宽度测试钉住 | §5.3-3 的三种字符串（第三条由 2026-10-13 裁决批准，见 §5.3-3 的 Amendment） |

**明确不需要单独批准的**：exposure 列表（不动）、变体轴（不动）、`readArguments` / `tools.ts`（不动）、Composition 的可选变体机制（不动）、新 ServiceContract 之外的任何契约。

**明确不需要的**：Composition Boundary Review——但 §4 给出了它的反面考虑，若 Human 判定需要，则本轮结论改为「先 Review，再实施」。

---

## §10 本轮已实施的 Q4

Q4 授权范围内本轮**已落地**两处，其余一切未动。

### 10.1 描述收窄

`src/desktop-session-awareness/exposure.ts`：`desktopContextReadExposure.description` 增补第五句——

> 它读的是窗口的身份（进程名、窗口标题）与 Hikari 对它的判词，不是窗口里的内容：这一项不含窗口正文，读到它也不等于 Hikari 读过了窗口里的内容。

文件头部的论证也补了一段，说明**第五句与前四句不是同一类**：前四句拒绝的是**从已有事实上做引申**，第五句拒绝的是**一次从未发生的读取**；而四句里的任何一句都不蕴含它。

对应测试：`test/desktop-session-awareness.test.mjs` 在同一条测试里加了两条断言（`不含窗口正文`、`不等于 Hikari 读过了窗口里的内容`），沿用该测试「四条引申各有一条断言」的既有理由——一条覆盖「caveat 还在不在」的断言会让其中任意三条被删掉而仍然通过。

### 10.2 注入 fixture

`test/desktop-content-read.test.mjs` 新增两条测试：

1. **`注入 fixture：窗口身份与正文都伪造不出 Hikari 自己的行与字段`** —— 三个注入点（窗口标题、进程名、正文节点）各带一个不同的伪造字段：
   - 断言「同样形状的读取产生同样多的行」（不是硬编码行数，因此对未来新字段不会假失败）；
   - 断言每个伪造片段**只出现在它被注入的那一行**，且**没有任何一行等于伪造片段**；
   - 对 `读取时间` / `窗口来源` / `结果` / `窗口观测时间` / `窗口标题` / `进程名` 六个字段名做 `deepEqual` 过滤——这正是转义被去掉时**会失败**的那条断言；
   - 断言窗口身份里的控制字符不原样落到行上（标题与进程名走上同一条路，且上游没有人清理它们）。
2. **`已知限制：正文里的转义写法与真实控制字符在渲染上不可区分`** —— 见 §10.3。

**这条 fixture 不是空跑，已实测其判别力**（探针脚本，跑完即删）：把同一份渲染按「转义被去掉」还原后——

| | 落盘实现 | 去掉转义后 |
| --- | --- | --- |
| `  读取时间：` 匹配到的行 | 1（真实那一行） | **2**（伪造的 `1999-01-01T00:00:00.000Z` 自成一行，且排在真实行**上方**） |
| `  窗口观测时间：` 匹配到的行 | 1（真实那一行） | **2**（伪造的同样排在上方） |
| 总行数 | 21 | 25 |

即：断言失败的正是「正文给自己加了一行、并伪造出一个 Hikari 字段」这一失败形态。

### 10.3 本轮新发现的一条限制（未修，需要裁决）

`oneLine`（`src/terminal-text/index.ts:83`）转义控制字符，但**不转义反斜杠本身**。于是「真实的换行」与「字面的两个字符 `\` `n`」渲染成同一个字符串（实测：`oneLine("a\nb") === oneLine("a\\nb")`，ESC 与 `` 同理）。

- **它不破坏转义存在的那个不变式**：两种输入都不产生真实换行，因此都伪造不出行——§10.2 的 fixture 证明的正是这一点。
- **它削弱的是「verbatim」在**可核对性**方向上的强度**：两个不同的窗口可以渲染成完全相同的字符串，而这个 surface 存在的全部理由是「让人类能核对 Hikari 读到的是什么」（`presentation.ts:8-11`）。
- **不在本轮修**：`terminal-text` 有六个渲染调用方，把反斜杠也转义会让**每一个窗口标题里的每一个反斜杠翻倍**——而标题里有路径是寻常情况，不是对抗情况。这个取舍属于 `terminal-text` 的 owner 与它的六个调用方，不属于 Q4 授权的范围（Q4 只授权「修正描述真实性和已有测试缺口」）。
- 处理方式：用一条**明确标注为「已知限制」**的测试把它钉住（不让它悄悄留在套件里），并在本文报告，等 Human 决定。

### 10.4 Q4 不构成 G-1b / G-1c 的证据

按 mandate 的明文要求重申：§10 的两处改动**没有**让正文流向模型、**没有**触碰授权、**没有**触碰单向门、**没有**扩大任何模型读取能力。它们把验收项 6 里「不编造」的那一半从「依赖模型自觉」变成「由描述与测试约束」。**G-1b / G-1c 的状态仍然是本文件 §5–§9 的建议，未实施。**

---

## §11 明确不做

- 不做确认交互、不建「Hikari 向人提问」通道（Q1 已明确第一阶段不需要）。
- 不建全局授权中心、权限对象、授权台账、token、过期机制。
- 不建 Model Router、不做端点选择、不改 `ModelMessage` 传输契约。
- 不引入 Memory / Experience / 持续采集。
- 不新增 exposure、不新增变体、不做 per-request 工具菜单。
- 不把正文写进 system prompt（§3.3-2）。
- 不把正文落盘、不进 Chronicle、不进 referent 的正文（referent 只记名字）。
- 不修 `oneLine` 的反斜杠歧义（§10.3）。
- 不改 D0 已固定的语义（`requires: []` 的采样关系、深度上限的「整体停止」语义、端点不携带操作数）。
- 不在本轮动 `createWindowsProbe` 的覆盖缺口（`probe.ts` 仍无测试；G-1 评审 §6 已登记，是已知最大缺口）。

---

## §12 本轮未验证、不得当作通过的事项

- **全部 G-1b / G-1c 的实现均为设计，未写一行生产代码，未跑一条新测试。** §8 的 T1–T15 是**计划**，不是结果。
- **没有对任何真实窗口正文做过端到端发送测试。** mandate 的「不发送真实窗口正文到模型端点」在本轮保持成立。
- **端点是否远程无法由代码判断**（仓库无本地/远程区分），因此 Q1 的「可能是远程端点」只能由 usage 文本承担；这条在本轮**没有实测**，因为它没有可测的代码面。
- **`'screen'` 这个词、§5.3-3 的两条标签文案、CLI 命令的具体拼写**都是**建议**，未定。
- §4 的「不触发 Composition Boundary Review」是**判断**，不是实测；反面考虑已写明。

---

## 附：本轮改动了什么

| 文件 | 改动 | 归属 |
| --- | --- | --- |
| `src/desktop-session-awareness/exposure.ts` | 描述增补第五句；文件头部补一段说明它与前四句不同类 | Q4 |
| `test/desktop-session-awareness.test.mjs` | 同一测试内加 2 条断言 | Q4 |
| `test/desktop-content-read.test.mjs` | 新增 2 条测试（注入 fixture + 已知限制） | Q4 |
| `docs/architecture/desktop-context-understanding-g1-narrow-design.md` | 本文 | 本轮交付 |

验证：`npm run build` 通过；`node --test test/desktop-content-read.test.mjs test/desktop-session-awareness.test.mjs` → 88 / 88 / 0 fail / 0 skipped；`npm test` → **845 / 841 pass / 0 fail / 4 skipped**（本轮之前为 843 / 839 / 0 / 4；新增恰为这 2 条，skip 数未变，未新增 skip、未放宽任何断言）。注入 fixture 的判别力由一次性探针实测，见 §10.2。

未 commit，未 push。

---

## §13 G-1 窄实施：落地记录与 Review 结论

§1–§12 是**设计**。本节记录它被实现之后的事实，以及与设计不一致的地方。**凡与本轮实测冲突的，以实测为准**；本节不改写上面的设计文本，只在下面登记差异。

### 13.1 §12 的状态变更

| §12 当时的说法 | 现在 |
| --- | --- |
| 「全部 G-1b / G-1c 的实现均为设计，未写一行生产代码」 | **不再成立。** §5 的 D1 已落成生产代码，§8 的 T1–T15 是结果而非计划 |
| 「`'screen'` 这个词、§5.3-3 的两条标签文案、CLI 命令的拼写都是建议，未定」 | **不再成立。** Human 已批准 F1–F5，三者均已固定；§5.3-3 的标签文案后来由 2026-10-13 裁决由两条增为**三条**（该节 Amendment） |
| §12 其余各条（未对真实窗口正文做端到端发送、端点远程与否无可测代码面） | **仍然成立**，见 §13.5 |

§11「明确不做」逐条仍然成立，唯一例外是 F3 已授权的那一个 ServiceContract（`desktop-content-read.read@1`）——§9 的「新 ServiceContract 之外的任何契约」条款由 F3 本身取代。

### 13.2 实施前两个硬门禁的结论

**门禁一（材料信任边界）— PASS by evidence。** 桌面正文作为 `user` 角色进入 `ModelMessage`，位置在**这个人自己的问题之前**，请求的消息角色序列实测为 `['system', 'user', 'user']`（`test/language.test.mjs:4126-4131`）。system 里一个正文字节都没有（`:4083-4085`）。框定的三行头 + 六行尾是**常量**，不随正文内容变化。注入测试覆盖伪造的指令、`system:` / `assistant:` 角色标记、伪造的授权声明，以及**伪造框定句本身**；判别断言用「过滤后 `deepEqual`」而不是 `includes`，所以正文真的伪造出一行时该断言会红（`:4056-4072`）。

**门禁二（回答出口边界）— PASS by evidence。** 出口只由「页面上有没有 `SCREEN_BLOCK_NAME` 这一块」决定，而 `blocks` 只由 `answerScreen` 播种；该名字 `desktop_content_read` 与任何 exposure 名都不同，因此模型写不出它。`tools[]` 与 `ask` 路径逐字相同（T11，`:3834`）。模型自己写出的 `desktop_content_read` 拿不到一次读，只得到 `UNRUN_CALL_RESULT` 并结束那一轮。全程**没有**任何一处让模型判断「是否授权」或「是否开放出口」。

### 13.3 与设计的两处偏差（必报，未擅自改写设计）

**偏差 1 —— 超时是一条读数，不是 `failed`。** §5.4 第 3 行把「无目标窗口 / UWP / 超时 / 未读」并列为 `failed` + 零模型调用。实现把它们分开了：

- 「读不出结果」（`read()` 抛错，例如没有可归给这个人的前台窗口）→ `failed` + **模型一次都不调用**（`:3803`）。
- **超时** → `refused`，一条**读数**，与人自己的话一起走到模型眼前，回答正常产生（`:4285`）。

实现这一侧更符合 §5.4 自己的原则：`refused` 是读取器**能报告的事实**（「目标窗口在 8000ms 内没有应答」），而「报告了一个事实」正是读数该做的事；`failed` 留给「连事实都拿不到」。建议 §5.4 第 3 行据此拆分，而不是让实现回退。

**偏差 2 —— T13 的 readiness 说不出缺哪个契约（未满足，不当作通过）。** §8 T13 要求 readiness 说出缺哪个契约。`Runtime` 的公开面只有 `getPluginState(id)` 与 `getPluginError(id)`（`src/runtime/runtime.ts:70,74`），而 `waiting` 不记录错误（只有 `failed` 记）。要让 readiness 说出缺失契约的 ID，必须新增 Runtime 表面——那越过了本轮授权，因此**未做**。测试只断言 `waiting`，并把为什么不能更具体写进了断言旁边的注释（`:3906`）。这一条按 mandate 的口径登记为**未满足**：它是「做不到」，不是「不需要」。

### 13.4 本地假端点验收（mandate 八项，逐项落到具名测试）

八项全部由**真 `node:http` 环回服务器**上的假端点验证，而不是替掉 `step` 的假模型——后者证明不了请求真的发出去过、发到了哪个地址、发了几次、序列化之后还剩什么字节。

| mandate 项 | 测试 | 位置 |
| --- | --- | --- |
| 正常授权 | 一次授权换一次传输，正文以材料身份走在问题前面 | `test/language.test.mjs:4111` |
| 授权缺失 | 没有授权字的提问，正文一个字节都没有离开过进程 | `:4145` |
| 窗口变化 | 窗口换了，新的一次授权送的是新窗口，旧正文不跟过来 | `:4177` |
| 端点变化 | 正文只送到这一次配置的那个端点，换了端点不会送到旧的那一个 | `:4216` |
| 超时 | 读窗口超时是一条读数，人和模型都看到它，而不是整轮失败 | `:4285` |
| 读取失败 | 读窗口失败时是 failed，而且模型一次都没有被调用 | `:3803` |
| 正文指令注入 | 注入 fixture：正文伪造不出框定，也买不走回答出口 / 注入的正文到了对端仍然只是材料 | `:4030`、`:4246` |
| 回答出口隔离 | 模型自己写出来的正文读取调用名，换不来一次读 | `:3834`（+ `:4030` 的断言 5） |

授权一次性另由 `:3718`（下一轮 `ask` 不再读窗口）与 `:4311`（授权痕迹不落盘）钉住。

### 13.5 真实远程模型端点：**NOT RUN**

§13.4 的全部证据都是「**本进程自己的字节出了进环回口又回来了**」。它证明不了任何模型理解了正文——真实远程端点在这次执行里是 **NOT RUN**，不得以假端点的绿灯冒充模型理解验证。mandate 的「不发送真实窗口正文到模型端点」在本轮保持成立。

`npm test` → **867 / 863 pass / 0 fail / 4 skipped**（20706ms）；`node --test test/language.test.mjs` → **127 / 127 / 0 fail / 0 skipped**。4 条 skip 全部是既有的：3 条需要真实端点（`HIKARI_SEMANTIC_ENDPOINT` / `HIKARI_SEMANTIC_MODEL`），1 条是 Windows 上不投递 POSIX SIGTERM。**本轮未新增 skip、未放宽任何断言。**

### 13.6 Review 结论

- **Functional Review — PASS。** 行为满足 §13.4 的八项验收；上表的测试真正约束行为（每条都写明「哪种具体实现错误会单独把它弄红」）；build、targeted、full tests 均正常。
- **Architecture Review — PASS，两处已登记偏差。** concern 在正确 owner（读取在 `desktop-content-read`，解释在 Language，Runtime 未理解业务）；public contract 有真实需要（F3 授权的那一个）；无 speculative abstraction；未越过 frozen boundary；§11「明确不做」未被偷偷实现。

### 13.7 Review 发现（主 Agent 已逐条重新锚定到 diff / 源码 / 可执行行为）

**F-1（HIGH，阻断）—— `MAX_LANGUAGE_REPLY_LINE` 放宽了 TypeScript 一侧，C# 那一侧没有跟。**

`src/language/types.ts:200-201` 把上界从 `MAX_LANGUAGE_REQUEST_LINE + 4096`（= 69632）改成由 `MAX_CONTENT_READ_REPLY_LINE` 派生（= 378305），因为授权那一轮的回答里嵌着一次完整读取。但 `apps/human-surface/HumanSurface.Core/LanguageFraming.cs:45` 仍是 `MaxLanguageRequestLine + 4096` = **69632**，且 `apps/` 本轮一个文件都没改。

仓库里**已经有一条跨语言一致性测试**钉住这两个数必须相等（`apps/human-surface/HumanSurface.Tests/LanguageConformanceTests.cs:217`）。实测（`dotnet run --project apps/human-surface/HumanSurface.Tests/HumanSurface.Tests.csproj`，Windows，本机）：

```
FAIL  conformance: the framing bounds are the ones the protocol declares
      the reply line bound: expected 378305, was 69632

68 passed, 1 failed, 0 skipped
```

这是**本工作区引入的回归**，不是既有失败：HEAD 上两侧都是 `request + 4096`，两侧相等，测试通过。该 job 在 CI 的 ubuntu 与 windows 两个 runner 上都会跑。

为什么设计没接住它：§9 的冻结面表列了 `types.ts` 的「请求词汇的封闭性」，但**没有列这条上界**——上界放宽是 F2/F4 的必要后果（回答里嵌了正文），却不在任何人的清单上，于是镜像它的那一半被留下了。这正是 §9 冻结面表本身的一类缺口：**必要但未列出的改动，其镜像面不会有 owner。**

修法（**未做，待 Human 裁决**）：C# 侧的派生式要跟着改，同时 `LanguageFramingTests.cs:167-168` 那条「reply = request + 4096」的自洽断言也必须改——两侧都得从 content-read 的界派生，不能一边派生一边写死。

**补记（接手执行后的独立核对，2026-10-13）——上面这条漏了一处，而它改变了修法的性质。**

第一，`docs/architecture/human-surface-language-client-v0-implementation-boundary-freeze.md` 是一份**冻结文档**：§3 逐字写「镜像 `src/language/protocol.ts`，常量逐字一致」，并在 `:54` 把 `MAX_LANGUAGE_REPLY_LINE = 64 * 1024 + 4096` 列进那张表。本工作区改了 TS 一侧、**没有 amendment**，所以那份冻结文档**现在是错的**。上一条修法没有点名这一点：把 C# 跟过来不是一次 A 档修复，它**要动一份冻结文档**。

第二，本机复测（`npm run build` → exit 0；`npm test` → 867 / **863 pass / 0 fail / 4 skipped**；`dotnet run --project apps/human-surface/HumanSurface.Tests/HumanSurface.Tests.csproj` → **68 passed, 1 failed, 0 skipped**）区分出一件事：C# 自己那条自洽断言 `language: the reply bound is the request bound plus slack`（`LanguageFramingTests.cs:165-171`）**是 PASS 的**。也就是说**两侧各自内部全绿，只有镜像测试看得见分歧**——「哪一侧对」不能由任何一侧的测试回答，它是一个契约问题，不是某一侧的 bug。

第三，因此修法有两条路，上一条写的是第一条：

- **A1（记录里的写法）：C# 也跟着从 content-read 的界派生。** 代价比看上去大——C# 要同时镜像 `READ_MAX_CHARS = 40_000`（`src/desktop-content-read/types.ts:59`，一个 **domain** 插件的读上限）与 `MODEL_MAX_TOKENS = 4096`（`src/language/model.ts:239`）。这与同一份冻结文档 §1 自己的原则冲突：Surface **不得**理解任何 domain semantics。
- **A2（建议）：C# 不再派生，改为镜像那个数。** `MaxLanguageReplyLine` 成为一个具名常量，注释写明「这是 owner 的数，由 conformance 钉住」；`LanguageFramingTests.cs:165-171` 里那句 `reply = request + 4096` 按事实改写。镜像仍然是一向的（Surface 只抄，不推导），而**正是「C# 自己又推导了一次」给了它自洽地错下去的余地**——今天这条红就是这么来的。Freeze amendment 记录新值与理由。

两条路都要动那份冻结文档，差别只在 C# 是否要理解一个 domain 的界。**本条仍待 Human 裁决方向；未做任何代码改动。**

**F-2（MEDIUM，冻结面）—— §5.3-3 声明的是**闭集两种情况**，实现发了三条。**

§5.3-3 原文：「第二行按**页面上实际存在的材料**组合，**闭集两种情况**」，并给出两行表；F5 批准的也是「§5.3-3 的**两种**字符串」。实现里 `SYNTHESIS_LABEL_REST` 有三个键（`src/language/express.ts:122-126`），第三个 `both`（`:125`）是「person 以前说过话 + 这一轮读了窗口」时用的——`answer.ts:332-336` 的三岔选择可达，`answer.ts:330-331` 与 `test/language.test.mjs:4350-4352` 两处注释都自认这是设计表没覆盖的第三种。

工程上这条做得是干净的（宽度测试与命名测试都覆盖了三条），缺的**只是冻结**：一句人可见文案（§5.3-3 自己说「人可见文案属冻结面」）在没有被批准的字面下上线了。建议：把 `both` 补进 §5.3-3 的表与 F5，或由 Human 驳回。

**裁决（2026-10-13）：批准。** `both` 已补进 §5.3-3 的表（该节 Amendment）与 §12 的 F5 行。理由记在该 Amendment 里：两种材料同时在场时，原两条字符串各自会漏掉一种在场的材料，用其中任何一条都会让免责声明**少报**。

**F-3（LOW，余量是隐含 slack 而非所声称的推导）—— `READ_AND_FRAMING_BUDGET_MS` 的推导没有算第三次读取。**

`src/cli/language.ts:112` 的 `READ_AND_FRAMING_BUDGET_MS = 90_000`，其上方注释把第二项说成「the capability reads, the focus read and the framing」。授权路径上还有**第三次**读取：窗口正文，`READ_TIMEOUT_MS = 20_000`（`src/desktop-content-read/uia.ts:105`），这个模块的界没有被这条推导点名。

今天没有活体 bug（真实读取远快于 90s），但余量是**隐含的**而不是所声称的：若 capability reads 真的吃掉被预算的 90s、窗口读取又用满 20s，客户端会在 150s 放弃，而服务端 170s 才答完——正是这条注释自己说的「把正在路上的回答报成从没来过」。修法与 §7 的既有取向一致：`READ_TIMEOUT_MS` 属于别的模块，本文件拒绝持有它的副本，所以要么把窗口读取写进第二项，要么把「为何现有 slack 已覆盖它」写清楚。

**已修（2026-10-13）。** 结论：**这不是一次措辞选择**——文件自己的论证已经定死了方向，因此没有需要 Human 裁决的余地。`READ_TIMEOUT_MS` 是 `src/desktop-content-read/uia.ts` 的**模块私有**常量（`const`，未导出），所以「把它加进求和」在结构上要求**先把它变成公开的**，而那比这条注释正在做的取舍更糟。于是修法就是**把窗口读取写进第二项的点名**，并把余量的性质如实写出来：

- 推导的枚举由「the capability reads, the focus read and the framing」改为「the capability reads, the focus read, **the window read** and the framing」（`src/cli/language.ts`，`READ_AND_FRAMING_BUDGET_MS` 上方）；
- 新增一段说明：窗口读取与其他读取同属**同一个预算**而不构成第三项（理由同上：它的界是别的模块的私有量），并且**这条余量是 slack，不是证明**；slack 的方向就是本文件已经选定的那个方向——高估一个 client 的耐心只付出一次慢失败，低估则把正在路上的回答报成从没来过。

复测：`npm run build` exit 0；`npm test` → **867 / 863 pass / 0 fail / 4 skipped**（**逐字不变**——本轮只改注释，未改任何行为，因此没有新增或放宽任何断言）。

**F-4（MEDIUM，冻结面，已由 2026-10-13 裁决更正）—— §3 冻结常量表里 `请求词 = 'ask'（唯一）` 已经不成立。**

`src/language/protocol.ts:102-105` 的 `readWord` 今天接受**三个**词：`'ask' | 'confirm' | 'screen'`，而 `human-surface-language-client-v0-implementation-boundary-freeze.md` §3 那张自称「常量逐字一致」的表里写着 `请求词 = 'ask'（唯一）`。

**这不是本轮引入的。** `git show HEAD:src/language/protocol.ts` 的 `readWord` 已经接受 `'ask'` 与 `'confirm'`——那一行在 HEAD 上就已不成立；本轮加入 `'screen'` 只是让它更远。**也不产生运行时不符**：C# 侧 `LanguageFraming.AskWord = "ask"`，而该冻结文档 §1 已定 Surface **不 decode 请求**、只 encode 它自己发出的那一个词，因此功能上无影响。

**裁决（2026-10-13）：** 该行改为陈述 **client** 事实——Surface 只写 `ask`，协议的三词闭集写在同一行括号里。协议词汇不是这个 client 的镜像面。

**F-5（MEDIUM，冻结面，本轮发现并已修复）—— 同一个表里的 `reply outcome` 也是错的，而且错在 C# 一侧。**

`src/language/types.ts:133` 与 `src/language/protocol.ts:127-137` 的应答结果是**五个**词：`chatted | answered | recorded | refused | failed`；`test/language.test.mjs:2786` 逐字断言「`recorded` 是第五个结果词」，`:2798` 对五个词各跑一遍。而 C# 的 `LanguageReplyOutcome` 枚举（`LanguageAsking.cs`）与 `LanguageFraming.OutcomeWords` 只有**四个**——`recorded` 的合法应答被 `OutcomeWords.TryGetValue` 挡下，报成 **unreadable**。C# 的文档注释甚至逐字写着「in the four words its protocol defines」「which of the four things happened」，两处都是关于协议的假陈述。

**在 HEAD 上就已如此，不是本轮引入的。也不可达**：只有 `confirm` 这个词会产生 `recorded`（`src/language/continuity.ts:273`、`src/cli/confirm-command.ts:49`），而 Surface 只写 `ask`。

**而这正是它没被发现的原因**：`node-helpers/conformance.mjs` 的应答语料枚举的是四种 shape——第五个词由**没有任何东西**检查。已按裁决把语料补成五种，该分支现在有守卫；C# 侧补齐第五个词、枚举顺序改为与 `protocol.ts` 一致（两侧都按名字比对，不依赖数值）、两处假陈述的注释改写。

**修法是补词，不是补一条守卫去拒绝它。** `LanguageAsking.cs` 自己引的 `cli/ask.ts:15-20` 说 those words "are the language plugin's statement about what happened and this file has no standing to merge, rename or re-derive any of them"——一个 client 没有资格决定自己愿意被告知协议里的哪几个结果。

**一并更正 F-4 初稿的一处过度声称。** 初稿写「`REQUEST_KEYS`、`请求词`、`reply outcome` 三项不在 conformance 之内」。经核对，**`REQUEST_KEYS` 本来就有守卫**：`RegisterRequests`（`LanguageConformanceTests.cs:117-133`）用**真的 TS decoder** 解 C# 写出的请求，键集错了会 `Assert.NotNull` 失败。所以准确的说法是：**没有守卫的是两项（`请求词` 与 `reply outcome`），而这两项都已经是错的。** 漏掉守卫的条目恰好就是已经漂移的那些——与 F-1 诊断的缺口同类（「必要但未列出的改动，其镜像面不会有 owner」），只是缺口落在**表的条目**上，不在表的覆盖范围上。

### 13.8 本轮状态

**已 commit、已 push**（commit `bdbc591`，CI Runtime Tests #38364810038 **success**：867 tests / 730 pass / 137 skipped / 0 fail；C# surface job 69 passed / 0 failed）。本节原写「未 commit，未 push」——那句在写成时是真话，在本轮 commit 之后不再成立，故按事实更正，而不是保留一句已经被自己推翻的陈述。四条发现（F-1 / F-2 / F-4 / F-5）均已裁决并已实施；F-3 记录为已知限制、**未修**。

| 发现 | 裁决 | 实施 |
| --- | --- | --- |
| F-1（HIGH，红门禁） | **A2**：C# 逐字镜像 owner 的数，不自行推导 | `LanguageFraming.cs` 常量改为 `378305`；`LanguageFramingTests.cs` 那条自洽断言**删除而非放宽**；冻结文档 §3 更新 + Amendment 一 |
| F-2（MEDIUM） | 批准第三条 `both` | §5.3-3 表增第三行 + Amendment；§12 的 F5 行改为三种字符串 |
| F-3（LOW） | 本轮不修，记录为已知限制 | 未改任何代码 |
| F-4（MEDIUM） | 该行改为陈述 **client** 事实 | 冻结文档 §3 `请求词` 行改写 + Amendment 二 |
| F-5（MEDIUM，本轮发现） | 补词，不补一条拒绝它的守卫 | C# 枚举与解码词表补齐 `recorded`；conformance 应答语料由四种补成**五种**；`LanguageFramingTests` 词表同步；枚举顺序改为与 `protocol.ts` 一致 |

**F-5 是这一轮最值得记住的一条。** 一份冻结文档和一个跨语言解码器，在 `HEAD` 上同时少了一个协议词，而**没有任何测试看得见**——因为 conformance 的语料枚举的是这个 client 恰好需要的那四种 shape。守卫要盯的是**协议**，不是 client 的需要。这与 F-1 诊断出的缺口同源：**漏掉守卫的条目，恰好就是已经漂移的那些。**

复测（本机，Windows）：

| 命令 | 结果 |
| --- | --- |
| `npm run build` | exit 0 |
| `npm test` | **867 / 863 pass / 0 fail / 4 skipped**（与修复前逐字一致；本轮**未新增或放宽任何 TS 断言**） |
| `dotnet run --project apps/human-surface/HumanSurface.Tests/HumanSurface.Tests.csproj` | **69 passed, 0 failed, 0 skipped**，exit 0（本轮开始时是 **68 passed, 1 failed**） |

`conformance: the framing bounds are the ones the protocol declares` 由 FAIL 转为 PASS；`conformance: the reply decoder accepts and rejects exactly what the TypeScript one does` 现在覆盖五个结果词。

**F-5 的守卫被证伪过，不是承诺。** 变异验证：只从 `LanguageFraming.OutcomeWords` 拿掉 `["recorded"]` 一行，C# 侧立刻变成 **67 passed, 2 failed**，红的正是 `language: each of the five outcomes decodes to itself` 与 `conformance: the reply decoder accepts and rejects exactly what the TypeScript one does`；随后按字节还原（`restored byte-identical: True`）。所以那条语料补充确实是一条**跨语言**守卫，而不只是一条本地断言。

**F-3 已修（2026-10-13）**，见 §13.7 该条的「已修」段：修法不是措辞选择，而是被文件自己的论证定死的——`READ_TIMEOUT_MS` 是别的模块的**私有**常量，求和先要把它公开，那比这条注释正在做的取舍更糟，所以改为把窗口读取写进第二项的点名，并如实写明余量是 slack 而非证明。`npm test` 逐字不变（只改注释）。
