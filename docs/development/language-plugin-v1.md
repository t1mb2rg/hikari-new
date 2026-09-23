# Language Plugin v1

> 轮次：**工作标签，不占用任何阶段编号**（不是 P4-04，不是 P4-03 的一部分）
> 状态：**实现完成、已提交、已 push、CI 通过**（含两轮修正：Functional / Architecture Review 一轮，对抗性安全评审一轮；修正内容见 §6 与 §10）
> 前置：`desktop-session-awareness.peek@1`（commit `ee73e17`）与 `work-focus.current@1`（commit `b0ecde2`）均已就位
> 本轮开工时的 `HEAD` = `b1dba7b`（`docs: record desktop inspection semantics state`）
> 边界记录依据：产品 mandate 已由人类冻结 concern 与 v1 范围；本文件是 mandate 要求的 **after-the-fact record**，不是新的设计阶段
> 交付事实（commit / CI run / 测试计数）见 §12
>
> **口径更新（`Language Tool-use Loop v1` 之后，2026-09-23）**：本文件描述的是那一轮**实际交付**的 v1，其内部路由是**固定四选一的 topic**。此后 `Language Tool-use Loop v1` 把它换成了**模型直接调用 capability 的 tool-use loop**，因此本文件下列内容**不再描述当前构建**，只作为那一轮的历史记录：§2.1 的 `readUnderstanding(content) → LanguageTopic`、§2.1 的归一化与整串匹配规则、§2.1 的 `current-context` 行、§7 的三词表（现在是**四个** outcome，多了 `chatted`）、以及 §9 风险 1 里把 `topics.ts` 的 `LANGUAGE_TOPICS` 长度当作触发信号的那一句（`topics.ts` 已删除，触发信号改为 `LANGUAGE_EXPOSURES` 的长度）。**§1 Concern、§3 冻结边界、§4～§6 的架构立场、§10 已知限制的其余各条仍然成立。** 当前形状以 `docs/development/language-tool-use-loop-v1.md` 为准。

---

## 0. 本轮回答的问题

在这之前，操作者与 Hikari 之间**没有任何一句话是双向的**。

Hikari 已经能感知（foreground / input-activity）、能保存（World）、能比较（Awareness）、能被读出来（`hikari observe`、`hikari focus status`、`hikari relevance`）。但这些**全部是人先知道该问哪个命令，再去问**。`hikari observe desktop-session status` 是一条能被执行的命令，不是一句话。

本轮补的就是这一格：

```text
hikari ask "光，你现在看到什么？"
```

**这不是「给 Hikari 加一个大脑」。** 它是一处**出口**：人用自然语言问，Hikari 用已经存在的事实回答。下面的每一条边界都是为了让它保持这么大。

---

## 1. Concern

**concern = 操作者与 Hikari 之间的自然语言交互。**

一个 concern，一个 plugin：`src/language/`。三个部分是**一次行为的三个环节**——人问一句话、得到一句回答——而不是三个 capability：

```text
Understand   一句自然语言  →  闭集里的一个内部 topic
Dialogue     追问所需的短期上下文（一句话的全部）
Express      已有 owner 的事实  →  人可以读的几行
```

**不拆成三个 plugin**，因为拆开会造出两个必须对「这一句问的是什么」达成一致的东西——那是一个没有人要求过的 contract。

---

## 2. v1 的三段分解

### 2.1 Understand — 模型唯一参与的地方

```text
buildUnderstandingPrompt(text, previous)   →  system + user 两条消息
model                                      →  一段自由文本
readUnderstanding(content)                 →  LanguageTopic | undefined
```

`readUnderstanding` 先归一化（trim、小写、剥掉包裹的引号与句末标点），再**整串匹配**闭集。`unclassified` **不是**集合成员，它是「匹配不到」这个结果本身。

**模型的字符串死在 `answer.ts` 的那一行上**：查表，只有集合成员能活下来。`raw` 的任何一个字都没有被保留、引用、记录或渲染，而且**拒绝的文案是固定的**——不随模型写了什么而变化。这就是「模型不能生成最终用户可见散文」的全部实现：不是一条关于模型该说什么的规则，而是一个**它的字必须先变成四个已知值之一、否则什么都不会发生**的位置。

闭集（刻意保持小）：

```text
current-context     Hikari 现在掌握的情况
work-focus          当前被明确声明的关注对象
desktop-state       桌面现在是什么状态
desktop-change      桌面和上一次快照相比有没有变化
```

追问（「那刚才那个呢？」）不新增 topic，它**换一个理解对象**：prompt 里多出一句「这个人上一轮问的是：&lt;topic&gt;。如果这一次他是在追问那一轮……就回答同一个词」。

### 2.2 Dialogue Context — 一句话的短期上下文

`dialogue.ts` 里是一句话的状态，并且是全部：**一个 topic，和它被理解的那个时刻**。

- **没有** transcript、turn list、summary、entity graph、topic stack、participant model、durable store。
- **不追加，只替换**：人说的「刚才那个」指的是最后那一件，不是整场对话。
- **5 分钟过期**（`DIALOGUE_CONTEXT_TTL_MS`），过期后不是「陈旧但可用」，而是**不存在**——追问会像任何一句这个构建放不进闭集的话一样被 `refused`。
- **只有一次真正被回答的轮次才会推进它**。`refused` 没有理解任何东西，`failed` 根本没走到模型；让其中任何一个成为新 referent，下一次「刚才那个」就会指向一个 Hikari 从未回答过的问题。
- **激活局部**：state 在一个 answerer 的闭包里。没有文件、没有 store、没有 Chronicle，因此「重启就忘了」是**构造的行为**，不是一条要记得执行的清理。

**为什么这不是 Memory**（写成性质而不是承诺）：Memory 是持久的，携带 provenance / confidence / revision，读到它的人有权把里面的东西当作 Hikari 确立的事实。这里一条都不满足，也一条都不是：它活在某个 plugin 的 activation 闭包里，activation 结束就没了，它承载的不是关于世界的事实，而是一条「刚才有人在问什么」的注记。两者不能合并，而结构上不能合并的理由是：**这里没有任何东西能活过一个进程**。

### 2.3 Express — 确定性的转述

`express.ts` 不做三件事，而它们是同一件事：

1. **不判断**。没有一行代码决定窗口标题看起来像不像编辑器、一次变化重不重要、某个 source 的沉默是不是猜测。`changed` / `stable` 在这里是**打印出来**的，不是被解释的。
2. **不重新渲染**。桌面那一块**不是在这里写的**：它是 `desktop-session-observe` 的 `renderAssessment`，作用在 peek 契约交回来的 assessment 上。因此 `hikari ask "桌面现在怎么样？"` 与 `hikari observe desktop-session status` 打印**同一块**——这不是以后要去掉的巧合，而是「两边都没有自己编」最强的可得证据。
3. **不新增**。每一行要么是固定标签，要么是 contract 逐字交回来的值；来到这里自由文本只有两种：人写的 designation，或者某个 owner 已经渲染过的东西。

**刻意没有组合句子。** mandate 允许「你当前明确关注 hikari-new，前台窗口是 VS Code」这样的句子，而那句组合是被**拒绝**、不是被忽略：本仓库不上报「VS Code」，它上报一个进程名和一个窗口标题，而在这两者里挑一个是「那个窗口」、或者从一个标题里读出一个产品名，正是这个 slice 被禁止对前台标题做的那类判断。组合句只能由**穿着值的外衣的猜测**搭出来。lead-in 携带同样的信息而不断言任何东西：它说被问的是什么，下面那块说 Hikari 确立了什么。

---

## 3. 冻结边界（逐条对照）

| # | 冻结要求 | 本轮的实现事实 |
| --- | --- | --- |
| 1 | concern 是人与 Hikari 的自然语言交互，不是大脑 / planner / registry / global context / memory / model router | ✅ 全文头注释逐条列出「它不是」；`ask` 是它唯一说的词，上面每一个角色都需要第二个词 |
| 2 | v1 只支持 `ask`，只读 | ✅ 协议只有一个词；全仓无一处写入路径 |
| 3 | 不做 work-focus 变更、不做 git / fs / shell / process 变更、不执行 Claude Code、不做 Action / Notification / 主动沟通 | ✅ `ask` 的 reply 只有 `answered` / `refused` / `failed` 三种结果，没有任何一种能改变状态 |
| 4 | 能力依赖只有 `work-focus.current@1` 与 `desktop-session-awareness.peek@1` | ✅ `requires` 逐字是这两个，有测试 deep-equal 钉住 |
| 5 | Repository CI 不在 v1 | ✅ 见 §4，理由是**结构性**的，不是编辑取舍 |
| 6 | `provides: []` | ✅ 见 §5 |
| 7 | 不建立 capability registry / 不做通用 `createLanguagePlugin({topics, requires})` 表 / 不改 Runtime service lookup | ✅ `src/runtime/` 零改动 |
| 8 | 模型只参与 Understand | ✅ 见 §6 |
| 9 | `refused` 与 `failed` 不合并 | ✅ 见 §7 |
| 10 | 不做 Session Manager | ✅ 见 §2.2 |

---

## 4. 为什么 Repository CI 不在 v1（结构性理由）

不是「这轮先不做」。**Runtime 没有 optional requirement**：`#requirementsSatisfied` 是一个 `every`，所以一个 require 了没人提供的契约的插件**永远停在 `waiting`**；而一个成员 `waiting` 的常驻 `isReady` 为假，**直接 exit**。

因此 require relevance 契约的后果是：**一个默认常驻根本加载不了 Language**。要让那条路走通，只有两个办法——给 Runtime 加一个 optional-require 机制，或者加一个 capability registry——而这两样都是这个 slice 不允许添加的 Runtime 架构。

结论是一句更小也更诚实的话：**Language 能回答关于工作焦点本身和关于桌面的问题，不能回答关于 CI 的问题。** 这是一条限制，记下来，而不是用一层功能把它糊过去。

---

## 5. 为什么没有 Service

按 Contract Creation Gate，**没有东西可以提供**。

组合里没有任何模块向这个插件要东西：唯一向它要东西的是**一个人**，经端点到达。为此发布 contract 等于**为零个人发布**。真正出现 consumer 的那一天，这一行会得到一个论证，而不是一个猜测。

端点因此是插件自己的（沿用每个 plugin-owned ingress 的命名管道先例），CLI 是**传输客户端**：把句子带进去、把行带出来，对两者都不形成意见。**Resident 的控制通道刻意不参与**——一个整个设计就是关于进程的两个词的通道，不能变成一个把问题路由给插件的地方，因为它回答的第一个问题就会让它成为那个设计拒绝成为的 router。

---

## 6. 模型的位置：能解释语言，不能编写现实

模型是 **plugin 的实现材料，不是 Hikari 的架构层**。

| 模型可以 | 模型不可以 |
| --- | --- |
| 读一句自然语言，从闭集里选一个词 | 生成任何用户可见的散文 |
| 在追问时被告知上一轮的主题 | 让它的输出绕过闭集查表 |
| — | 决定哪些事实被读、被读多少 |
| — | 改变任何状态、触发任何 Action |

**传输是唯一被注入的 seam，且是最窄的那个**：一个 OpenAI-compatible endpoint；`endpoint` 与 `model` 都**显式、无默认值、成对出现**（只给一个 = 配置错误，明确拒绝启动并指出缺的是哪一个）；credential **可选**，经一个**环境变量名**给出。

**secret 不许进入**：domain fact / Chronicle / stdout / stderr / 渲染出的答案 / status。credential 只在 `setup` 里解析一次，进入 classifier 的闭包，进 `Authorization: Bearer` 头，此外任何地方都没有。这条有四层证据（测试三处 + 现场核验，见 §11）。

**评审发现并修掉的一处真实泄漏（本轮修正轮）**：credential 的唯一去处是 `Authorization` 头，而 HTTP 层拒绝某些头值时会**把它拒绝的那个值原样引用进错误消息**。实测（不是推断，且三种形状的答案并不相同）：

```text
开头或中间有换行    Headers.append: "Bearer <完整 secret>" is an invalid header value  ← 泄漏
结尾有换行          接受，换行按头值的空白规则被剥掉                                      ← 不泄漏
非 ASCII 字节       接受                                                                    ← 不泄漏
```

第一行的消息经由 `modelFailureLines` 的「细节」行**打到了 stderr**。（初稿把例子写成「结尾带 `\n`」，那是**错的**——结尾换行恰恰是不泄漏的那一行；修正后的实测记录在 `src/language/model.ts` 与 `test/language-model.test.mjs` 的注释里。）

因此「secret 不进 stderr」不可能靠「错误消息不会提到 header」来保证，它必须是**值的性质**：`readModelCredential` 现在**在它进入进程的那一处**拒绝整个补集——凭据只能是可打印 ASCII、不含空格。这个集合比传输层实际拒绝的集合**更严**：结尾换行与非 ASCII 本来能通，现在也被拒（前者会让 `$(cat secret.txt)` 这种常见写法在启动时失败）。这是刻意的，理由写在 `model.ts` 里：守卫问的是「这是不是一个 bearer token」，而不是「这个传输库今天拒绝什么」——按后者枚举，既会拒绝能用的、也会放过没测过的，而且会随库的行为改变而失效。拒绝只发生在启动处、失败即关闭（fail-closed）、消息点名变量并提示常见成因。拒绝的话**只说变量名与规则**，不引用值、也不指出是哪一个字符——会指认那个字节的诊断，本身就是它要报告的那次泄漏。回归测试在 `test/language-model.test.mjs`。

---

## 7. `refused` 与 `failed` 是三个词，不是两个

```text
answered   这个构建理解了问题，读了它据以立论的事实，并回答了
refused    这个构建理解了【请求】，但【不回答这一句】：问题是空的、长得超过任何问句该有的长度、
           或者模型没能把它放进这个构建知道怎么回答的闭集里
failed     这个构建自己没能走到结论：模型够不着，或者回答所需的一个契约在途中拒绝了
```

`refused` 与 `failed` **不是「不」的两种拼法**。拒绝是 Hikari 说它不回答这个；失败是 Hikari 说它没做完。合并两者会告诉一个人他的问题超纲了，而事实上是模型挂了——**而两者的修法不同**：一个是「换一个问法」，另一个是「过一会儿再来」。

文案上也是分开的，并且**不共用词**：「这句话我没有听懂它在问哪一件事」与「模型没有答上来，所以这个问题没有被理解，也没有被回答」。

---

## 8. 明确不做（v1 冻结）

```text
Action / Notification / 主动沟通
执行 Claude Code 或任何外部 agent
Memory（任何形式的持久化）
Tool Registry / Capability Registry / Model Router / Central Brain
Global Context / GlobalWorldState / Session Manager
通用 Human Input / 通用 Message 类型 / 共享 RPC 框架
REPL / 多轮会话协议
改变工作焦点或任何其他状态
```

**仓库级证据**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/desktop-session-*/`、`src/work-focus/`、`src/repository-ci-*/`、`src/git-*/`、`src/github-*/` 全部**零改动**（`git status` 对这几个路径无任何条目）。

---

## 9. 两条长期风险（记录，不是本轮的问题）

### 风险 1：Language 会长成跨越所有领域的超级插件

v1 已经有 4 个 topic、2 个 `requires`，而这个数字只会涨。风险不在 v1 的实现里，**在 v1 的成功模式里**：让 Hikari 能回答关于 X 的问题，**最便宜的一条路就是给 `language` 加一个 topic、加一个 requires**——比新写一个出口便宜得多，而且立刻就有用户可见的效果。

如果每个领域都这样进入，`language` 最终会 `requires` 全仓，而 §3 第 4 条那条「只有两个依赖」的边界就名存实亡了。**注意这条边界现在的强度来自哪里**：不是来自一条规则，而是来自它**在结构上只能拿到它被给的东西**。

**触发信号（可观察，不需要等到出事）**：`src/language/plugin.ts` 的 `requires` 数组长度；`topics.ts` 的 `LANGUAGE_TOPICS` 长度；以及「某个新 capability 的第一次用户可见」是不是发生在 `src/language/` 里。

### 风险 2：Language 会长成所有 capability 的唯一出口

同样是最省事的那条路：任何插件想让自己可读，**不需要提供 contract，只要让 language 渲染它**——不用设计契约、不用想 consumer 是谁、不用发布任何东西，改一个 switch 就完了。

这会同时废掉两件已经成立的事：**Consumer 与 Provider 之间的直接契约**（Provider 不应该决定 Consumer，但也不应该由第三方代替 Consumer 去读 Provider），以及**「出口是 CLI」这条已成立的模式**——`desktop-session-observe` 就是 CLI 出口，它**没有**经过 language。

若所有出口都经过 language，那么 language 事实上变成了一个 central rendering domain，而它本来只是一次问答。**本轮已经存在的反例值得保持在视线里**：桌面那一块不是 language 渲染的，是 `desktop-session-observe` 的 `renderAssessment`，language 只是调用它。**这就是正确形状**：出口可以复用别人的渲染，但不接管别人的事实。

**触发信号**：某个已被 `desktop-session-observe` / `focus` / `relevance` 覆盖的能力，其 CLI 出口被改成经 `ask` 转发；或者出现「为了让 language 能念出 X，往 language 里加一个 X 的渲染函数」。

---

## 10. 已知限制（记录，不是本轮的缺陷）

1. **跨客户端共享一个 referent。** dialogue context 属于 plugin activation，因此两个终端同时提问会共享同一个「刚才那个」。要按客户端分开，需要一个这个构建没有其他用途的 session identity——为一个五分钟的指针发明一个会话框架，是这个 slice 明确不做的。`dialogue.ts` 的头注释里明写为 **v1 的已知限制**。
2. **`hikari focus` 自己的输出不转义。** `renderWorkFocus`（`src/work-focus/state.ts`）逐字返回 designation，`focus-command.ts` 用 `'\n'` join 后直接打印，而 `work-focus` 对 designation 的唯一条法规则是「非空白」——它**不**拒绝换行，也**不**拒绝 ESC。

   范围比初稿写的大，**修正如下**：不是 `status` 一个子命令，而是**回显 designation 的三个**——`declare` / `replace` / `status` 共用同一个 `renderWorkFocus`，这正是该函数自己的注释所声明的设计（「One renderer, so the answer cannot differ by which command happened to print it」）；`clear` 没有 designation，不受影响。后果也不是「多打印一行」：**C0 与 ESC 完全没有过滤**，`declare $'写 Hikari\e[2J\e[H…'` 会真的清屏并归位，随后可以伪造任意行——与本 slice 的 `src/terminal-text/index.ts` 存在理由所防的是同一类失败。

   这条修正有一条旁证，说明它不是「历史遗留的小瑕疵」：**同一个 designation 字符串**，`hikari ask` 会转义（`renderAnswer` 对整个答案 `map(oneLine)`，含 work-focus 那几行），`hikari focus status` 不转义。同一个终端、同一个字符串，两个命令给出不同保证。

   本轮**仍然不去修它**，理由是：治法属于 work-focus 的渲染出口归属，而 `focus` 出口不是本 slice 的关切；在本 slice 里顺手改它，等于这个 slice 去改一个它只被要求**读**的模块的输出格式（mandate §8 也正是要求「记录为一条独立缺口」而不是顺手修）。**它是一条独立的小缺口，记在这里**，`language` 这条路上不成立。
3. **每次问答一次模型调用。** 没有缓存、没有关闭开关；问多少次就调多少次，token 消耗属于操作者。
4. **模型返回空回答时，本构建说「refused」而不是「failed」。** 这是评审提出、**主 Agent 重新锚定后判定不改**的一条判断，记下两边的理由而不是把它写成结论。

   支持改的一边：空的模型回答是**模型侧**的状况（内容过滤、`max_tokens` 被推理吃光、代理吞掉 body），把它说成「这句话我没有听懂它在问哪一件事」是把模型侧的状态说成对人的问题的判断，正是 mandate §4 禁止的那类混淆；而 `failed` 的文案（「模型没有答上来」）在任何情况下都不会说错。

   判定不改的一边：本条**不在 mandate §13 的 19 条行为项里**；本文件 §7 的 `refused` 定义**逐字包含**「模型没能把它放进这个构建知道怎么回答的闭集里」，而空回答确实是「没能放进去」；`src/language/model.ts` 的 `readContent` 注释已经就 `''` 明确记过一次判断（「一个字符串是模型可以合法回答出来的东西」）；并且「refused 的判词可能对问题的范围说错」并不是空回答特有的——模型把在范围内的句子归错类，同样会有这个后果，而那按冻结定义就是 `refused`。

   **两边都成立，且没有任何已冻结的权威能裁决它**，因此按 CLAUDE.md §3「更小、可逆、不扩架构」保持现状，并把分歧记在这里等人工裁决。它是一条**判断**，不是本轮发现的缺陷。
5. **`oneLine` 起初只覆盖 `renderAnswer` 那条路。** 三条失败文案（`modelFailureLines` / `groundingFailureLines` / `askFailureLines`）不经过 `renderAnswer`——它们**就是**答案本身——因此本轮的修正轮**在插值处**对 `detail` 施加了 `oneLine`，让「一个元素就是一行」成为这个插件**全部**输出的性质，而不只是其中一条路的性质。

   同一条覆盖缺口还有**第二处，由对抗性评审发现**：本 slice 新加进 `hikari status` 的三行——`语言插件模型端点` / `语言插件模型` / `语言插件凭据：来自环境变量 …`——把**操作者自己给的**字符串原样插值。它们是 `renderStatus` 里唯一打印操作者输入的地方（`--repository-root` / `--repository` 不进状态），因此这是本 slice 第一次让命令行字符串进入状态报告。后果是具体的：`--model-endpoint $'http://…\n判词：stable'` 会伪造一行状态，`--model $'m\e[2J'` 会清屏。同轮对三处插值施加 `oneLine`，并有 Windows 侧测试钉住「三个值各占一行、值里的控制字符写成码点、文本本身不被删掉」。

   本 slice 自己的两条出口（常驻状态、`ask`）现在都在 `oneLine` 之下；**仍然不在其下的只有 `focus` 出口**，见上一条。

   同轮修掉的相关冗余：`answer.ts` 里 `desktop-state` 与 `desktop-change` 两条**函数体逐字相同**的分支，以及两个零调用者的导出（`isLanguageTopic`、未被使用的 `LanguageWord`）。

---

## 11. 测试事实

**CI 跑在 `ubuntu-latest` 上，那里没有命名管道。** 因此本 slice 的**全部判断**都在 `src/language/answer.ts` 里，写成一个接收四个注入依赖的**普通函数**——不是因为它更优雅，而是因为写进 `setup` 闭包的版本**只能经命名管道到达，而 CI 会跳过它**。`desktop-session-observe` 已经栽过一次，它自己的 barrel 里写着这句话。

```text
判断层（CI 可见）      test/language.test.mjs 前半（20 条）+ test/language-model.test.mjs（10 条）
端点 / 线路层（仅 Windows）  test/language.test.mjs 后半（8 条，{ skip: NO_PIPES }）
CLI 用法层（CI 可见）  test/resident-cli.test.mjs 的模型参数配对与归属（2 条）
```

**修正轮补上的四条覆盖**，每一条都是评审发现的缺口而不是对称性：模型端点与模型的配对在 CLI 上**只有一半算配置错误**（`--model-endpoint` 与 `--model` 只给一个是用法错误并指出缺的是哪一个；只给 `--model-credential-env` 同样是），此前**零覆盖**，而它的前例（Repository CI 的同一对参数）有一条；未配置模型时状态行的那一句「语言插件未加载」此前**只由手工验证覆盖**，现在也由测试钉住；本构建不接受的凭据在读取处被拒绝，见 §6；状态行里三个操作者给出的值各占一行、控制字符写成码点，见 §10.5。

`test/language-model.test.mjs` 直接 import `../dist/language/model.js`，头注释里写明「**Internal on purpose** —— 这些测试检查的 seam 不是配置」。用的是一个真实的 `node:http` server（绑定 `127.0.0.1:0`），不是一个 mock：被测的是「credential 到底去哪了」，而 mock 会让这个问题由写 mock 的人来回答。

**本机实测（不是单元测试）**：真实常驻 + 真实命名管道 + 一个只会关键词匹配的假模型端点，跑通了十条成员在没有 CI 配置下全部 active、grounded 回答、桌面块与 `observe desktop-session status` 逐字相同、追问端到端解析到上一轮主题、`refused`（exit 1，stdout 0 字节）、模型停掉时的 `failed`（常驻存活并在模型回来后恢复）、`absent` 的诚实措辞，以及默认常驻（不给模型参数）打印「语言插件未加载……」。

**secret 三处现场核验**：status 显示「语言插件凭据：来自环境变量 &lt;名字&gt;」；canary 只出现在假模型的 `Authorization` 头上；对常驻自身输出、`hikari status`、以及答案做 `grep -c` 全部为 0。

---

## 12. 交付

```text
实现      commit 2dc1ed1  feat: add language plugin
CI        Runtime Tests #35748199236  success
          ubuntu-latest / Node 24      493 tests / 418 pass / 75 skipped / 0 fail
本机      Windows 11 / Node 24        493 tests / 492 pass /   1 skipped / 0 fail
```

CI 上多跳过的 74 条全部是依赖命名管道的用例，与本 slice 之前的每一个出口相同；本 slice 自己贡献其中 8 条（`test/language.test.mjs` 的后半），判断层因此被刻意写成不依赖管道的形式，理由见 §11。

状态行见 `docs/development/current-stage.md` 文首（同一组事实逐字记录），本文件是它们的展开。
