# D0 · G-1 桌面正文授权边界 — Boundary Review

> 基线：`89d363d0394174af55ca721c15009901777bb53c`（`git status --short` 为空）。
>
> 本轮**只做 Boundary Review**。未修改任何生产代码，未 commit，未 push。本轮产出仅此一份文档。
>
> 上轮产物：`desktop-context-understanding-d0-content-reader-boundary-review.md`（第一片 READY: YES / 第二片 BLOCKED / 整体 NARROW），其中 §7 把本轮的题目登记为 G-1：「正文发往 operator endpoint 的授权问题」。
>
> **本文所有结论都以当前源码为准**，不以 `hikari-current.md` 或任何研究快照为依据；每条都给出文件与行号。
> 三份只读探索的发现只作候选，下面每一条都经主 Agent 第一手复核。

---

## §0 结论摘要

**整体判定：NARROW。** 拆开看是两个不同的结论，必须分开记：

| 片 | 内容 | 判定 |
| --- | --- | --- |
| **授权边界本身**（G-1a） | 「人如何对**这一次**正文外发作出明确授权」 | **可设计**，最小形状今天就成立，但需要一次 Human 裁决才可实施 |
| **完整验收链**（§二 六项） | 正文 → 模型 → 自然语言解释 | **BLOCKED**，且阻塞它的**不是**授权 |

本轮最重要的一条发现：

> **G-1 不是一个问题，是三个。** 「授权」只是其中最容易的那个。
>
> 1. **G-1a 授权** —— 人如何授权这一次外发。（本轮的题目。）
> 2. **G-1b 可达性** —— 正文以什么身份进入模型的上下文：作为 **材料**（不是模型可调用的能力）还是作为 **reading**（模型必须调用一个能力）。这一岔路口决定要不要新增 `ServiceContract`、要不要动 `exposure.ts`、要不要触发变体守卫。
> 3. **G-1c 出口** —— 模型说出来的话能不能出现在一条 grounded 答复里。`answer.ts` 的**单向门**规定：一旦读到任何东西，模型的话一律丢弃，除非三个条件同时成立（`answer.ts:229-265`）。验收项 5「Hikari 用自然语言说明观察到的事实及推断」撞的就是这扇门。
>
> 三项互相独立，且 2、3 都比 1 更靠近架构冻结面。**只解决授权，这条链仍然跑不通。**

另外一条同等重要的发现：

> **路线 B（自然语言对话内触发）的障碍不是规则，是通道。** 本仓**不存在**任何「Hikari 向人提问并等待答复」的机制：`human-delivery` 是严格单向的 egress（服务端从不读客户端，`human-delivery/endpoint.ts:7-11`），`confirm` 在源码里被三处明文否认是权限（`language/continuity.ts:17-23`、`language/plugin.ts:20-23`、`options.ts:352-354`）。所以「确认交互」不是「要不要做」的问题，是「今天没有任何东西能做」。

---

## §1 当前完整调用链与实际缺口

### 1.1 正文那条链（已经存在，终点是终端）

```
hikari content status
  main.ts:55                         → contentCommand(parsed.options)
  content-command.ts:27-45           → askRunningHikari → requestDesktopContentRead(dataDir)
  cli/content.ts:56-119              → connect(pipe) → encodeContentReadRequest({word:'status'})
  ── 命名管道 \\.\pipe\hikari-desktop-content-read-<sha256(rootDir)[:16]> ──
                                       endpoint-path.ts:21-30（win32 门；非 win32 返回 undefined）
  desktop-content-read/plugin.ts:196-224  handle()
    :202  samples.current               取最新合格样本（target.ts 的 latestAdmissibleSample）
    :213  toWindowIdentity(sample)      样本自带 observedAt
    :218  walker.walk(sample)           一次有界 UIA 遍历
    :219  decideContentRead(walk, window) → renderContentRead(...)  owner 的渲染器
  ── 回复 {outcome:'ok'|'failed', lines: readonly string[]} ──
  content-command.ts:40-45           → stdout/stderr，退出码 0/1
```

锚点：

- **样本来源**：`plugin.ts:191-194` 订阅 `desktop-session-awareness-loop.assessed`，在事件里起一个探针（不 await、不 reject、最多一个在飞，`plugin.ts:41-56`）。目标窗口**不是**在读取那一刻选的 —— `plugin.ts:29-38` 记录了实测理由：Hikari 在本机没有顶层窗口（CLI/TUI 画在宿主终端里），读取时的 `GetForegroundWindow` 会稳定地报回人正在打字的那个终端。
- **两个时间不合并**：`WindowIdentity.observedAt` 是采样时刻，`ContentRead.readAt` 是遍历时刻（`types.ts:154-161`、`:175-197`）。
- **结果五态**：`read` / `empty` / `truncated` / `refused` / `unreadable`（`types.ts:175-197`）；「没有可归属的窗口」**不是**第六态，它走端点的 `failed`（`plugin.ts:203-211`）。
- **线上只有渲染行**：`ContentRead` 这个联合体**从不跨管道**，跨过去的只有 `renderContentRead` 的 `string[]`（`types.ts:221-224`、`protocol.ts:29`）。
- **上限**：`READ_MAX_DEPTH=32`、`READ_MAX_NODES=2000`、`READ_MAX_CHARS=40_000`（`types.ts`），`MAX_CONTENT_READ_REPLY_LINE = READ_MAX_CHARS*7 + 64*1024 + 1`。
- **`requires: []` / `provides: []`**（`plugin.ts:168-169`），理由写在 `index.ts:21-23`：组合里没有任何东西问它，它的输入是一个 occurrence，输出是一根管道。
- **宿主安全边界由两处声明**：管道对象是 Windows 默认描述符，Everyone 与 ANONYMOUS LOGON 有 `FILE_GENERIC_READ` 而**没有** `FILE_WRITE_DATA`（`endpoint.ts:19-29`）；而「要问就必须先写一行」，于是**实际把关的是 `protocol.ts` 的精确键集解码**，不是传输层（`protocol.ts:8-16`）。这一点对本轮直接相关，见 §7-6。

### 1.2 问句那条链（已经存在，终点是模型）

```
hikari ask "<text>"
  ask-command.ts:33-57               → requestLanguage(dataDir, {word:'ask', text})
  ── 命名管道 hikari-language-<hash> ──  language/endpoint-path.ts:24
  language/plugin.ts:343-346         → languageRequestHandler(answerer, continuity)
  language/answer.ts:181-336         answer(text)
    :206-210  messages = [system: buildSystemPrompt(contextUsed, confirmed), user: text]
              tools    = toModelTools(dependencies.exposures)
    :221-305  循环：step → 有 toolCalls 就地解析 → 无 toolCalls 就地收敛
    :290       lines = await dependencies.read(exposure)
    :295       blocks.push({name, lines})
    :299       messages.push({role:'tool', content: lines.join('\n')})   ← 模型看到的就是人将看到的那一份
    :329       renderAnswer(blocks, contextUsed)
  ── 回复 {outcome: chatted|answered|recorded|refused|failed, lines} ──  types.ts:109-114
```

锚点：

- **能力清单是字面量**：`LANGUAGE_EXPOSURES` 两条（`exposure.ts:114-117`），`LANGUAGE_REPOSITORY_EXPOSURES` 三条（`:127-131`）。
- **今天三个能力**：`work_focus_read`、`desktop_context_read`、`repository_ci_relevance_read`（三份 owner 各自导出，`exposure.ts` 只选不写）。
- **`desktop_context_read` 是身份读取，不是内容读取**：它指向 `desktopSessionAwarenessPeekService`（`desktop-session-awareness/exposure.ts:83`），渲染器是 `renderAssessment`，输出**进程名 / 窗口标题 / 观测时间 / 变化判词**（`desktop-session-observe/presentation.ts:85-90`）。**它读不到正文，也从来不读。**
- **零参数是结构性的**：`tools.ts:14-19`、`:107-120` 把 `parameters` 恒为「无属性的对象」；`readArguments` 是闭集 `'none' | 'malformed'`（`:37`、`:49-60`）；`readCall` 对未知名字、重复名字、带参数一律返回 `undefined`（`:131-139`），循环把它答成 `UNRUN_CALL_RESULT = '这次调用没有执行。'`（`answer.ts:179`、`:282-286`）并停止。
- **单向门**（`answer.ts:14-60`）：读到任何东西之后，门的另一半关上；模型能做的只剩「读一个还没读过的能力」或「停」。模型的话一律丢弃，**唯一**例外在 `:248-252`，三条件同时成立才开：这个人有已确认语句（且该记录**确实在 prompt 页面上**，`:205`）、这一步未被截断、模型确实写了字。
- **终止不靠步数**：靠「每一次继续都必须消耗一个此前没读过的能力」（`:62-85`），上界由 exposure 清单长度推出（`test/language.test.mjs:848`）。
- **`ask` 不写任何东西**（`plugin.ts:375-386`、`ask-command.ts` 头部）：本轮所有设计都建立在这条上。

### 1.3 实验：今天问「你知道我刚刚在看什么吗」，会发生什么

对着**当前源码**推演（未实跑，见 §5.3 的 NOT RUN）：

1. `hikari ask "你知道我刚刚在看什么吗"` → 语言入口 → 模型收到 system + 这句话 + **三个工具定义**。
2. 模型若调 `desktop_context_read` → `peek()` → `renderAssessment` → `answered`。
   人看到的行是 owner 渲染的：进程名、窗口标题、观测时间、与前一次的对比判词。**这是验收项 1 已经实现的那一半。**
3. 模型若**不**调工具而直接聊天 → `chatted`（`answer.ts:261-264`）→ `renderChat`。
   **注意**：`chatted` 的行就是模型的散文，而 `ask-command.ts:52` 只打印 `reply.lines`，不带 outcome 抬头。所以在终端上，**一次没读任何东西的答复与一次读到了东西的答复，只能靠行文形状区分**。

### 1.4 实际缺口（每条都锚到源码）

| # | 缺口 | 证据 |
| --- | --- | --- |
| 1 | **正文没有任何离开本进程的路径**。无 Service、无 exposure、无 CLI 转交 | `desktop-content-read/plugin.ts:168-169`；`exposure.ts:114-131`（只有三个能力，都与正文无关） |
| 2 | **语言入口的请求承载不了「本次授权」**。`{word, text}`，且注释明说「没有第三个字段」 | `language/types.ts:4-8`、`:80-83`；`LanguageWord='ask'\|'confirm'` `:70` |
| 3 | **正文若经 CLI 转交语言入口，会撞上请求行上限**。正文上限 40,000 字符，JSON 转义最坏 6 字节/字符；而语言请求行是 64 KB | `types.ts:146`、`:155`；`MAX_CONTENT_READ_REPLY_LINE = READ_MAX_CHARS*7 + 64KB + 1`（content-read `types.ts`） |
| 4 | **模型对 reading 不能说话**。单向门丢弃模型的一切散文 | `answer.ts:14-34`、`:229-265` |
| 5 | **没有任何 Hikari → 人的提问通道**（若要「确认交互」） | `human-delivery/endpoint.ts:7-11`（服务端从不读客户端）；全 `src/` 无 readline/prompt，只有 `cli/tui.ts` 读 stdin |
| 6 | **无法判断模型端点是本机还是远程**。三份独立检索在 `src/` 零命中，且源码明说不猜 | `language/plugin.ts:192-199`（「does not know which endpoint is on the other end and must not guess」）；`options.ts:23-28`（不设默认端点的理由） |
| 7 | **`desktop_context_read` 的描述没有说「这不是窗口正文」**。它逐条否认了四种引申，唯独没说「Hikari 没有读你窗口里的内容」 | `desktop-session-awareness/exposure.ts:79-84` |
| 8 | **注入 fixture 测试不存在** | 上轮 D0 评审 §5.3-3 自认；本轮复核仍未新增 |

---

## §2 路线 A / B 的最小实现候选及权衡

### 2.1 路线 B：先说结论

**B 在当前仓库形态下 BLOCKED，且这个结论不需要 G-1 裁决就能下。**

理由链，逐条锚回源码：

1. 人的自然语言请求到达语言入口时是 `{word:'ask', text}`（`plugins.ts` 的 handler 只认这个词）。
2. 「这一句构不构成授权」只能由两种东西判：
   - **模型判** —— 即「模型调用了工具所以有授权」，**mandate 明文禁止**；
   - **Hikari 从句子里做意图/关键词匹配** —— 这是一个新机制、脆弱，且本质上是**把推断提升为事实**（`principles.md` §12 的口径），还要决定「哪些句式算授权」，而这个决定没有任何 owner。
3. 即使授权判出来了，「授权后获得回答」还要求 Hikari 能在**读之前**向人问一次 —— 而本仓**没有带返回路径的提问通道**（§1.4-5）。新建它是一条新的通信面，属于架构级工作。

**B 的一个可行过渡形态（记为 B′）**：模型请求正文 → Hikari **拒绝**并说明原因。这不需要新通道，因为拒绝本身就是既有行为（`UNRUN_CALL_RESULT` + `unclassifiedLines`，`answer.ts:283`、`:313`）。B′ 满足验收项 6（不编造），不满足项 5。**但 B′ 也需要正文能力先出现在模型面前**（否则模型连请求都发不出）—— 所以 B′ 不是「不做」，是「做一半」。

### 2.2 路线 A 的三个候选

**A-1 · CLI 侧串联（不新增 Service）**

```
hikari ask --data-dir <p> --screen "<question>"
  options.ts       解析新开关
  cli/content.ts   既有客户端，取一次 {outcome, lines}
  cli/language.ts  把 {question, lines} 发给语言入口
  language/*       正文以「材料」身份进入 prompt；不新增能力
```

- 新增：一个 CLI 开关；语言入口请求词汇长大（第三词或第三字段）。
- **不新增 `ServiceContract`**；**不新增 exposure**；**不动变体轴** —— `test/language.test.mjs:1509 / 1720 / 1723 / 1582` 全部保持绿。
- 优点：模型看到的行与人看到的行**是同一个数组**，这正好延续 `answer.ts:296-298` 那条不变量。
- 代价一：**撞请求行上限**（§1.4-3）。要么把 `MAX_LANGUAGE_REQUEST_LINE` 从 64 KB 提高（该注释说明它的用途是「不让对端决定本进程缓冲多少」），要么改分帧。
- 代价二：**语言入口开始接受调用方提供的行**。这与 `language/contracts.ts:52-66` 反对的形状（「A caller that supplied the lines could make Hikari say anything」）同形。缓解办法是把它标为**材料**而不是 reading —— 而这恰好是既有先例：`confirm` 家族就是「调用方提供的文本，作为低信任材料进 prompt，带标签」。

**A-2 · 内容 owner 提供 Service（不新增 exposure）**

```
desktop-content-read/contracts.ts   新增 desktopContentReadService（'desktop-content-read.read'@1）
desktop-content-read/plugin.ts      provides 加上它；read() 返回 ContentRead 值
language/read.ts                    新增一条分派分支 → renderContentRead（owner 的渲染器）
language/plugin.ts                  requires 加上它 —— 照 chronicle 的位置：variant 之外
language/*                          正文以「材料」身份进入 prompt；不作为 exposure
```

- **关键先例**：`plugin.ts:261` 的 `requires: [...variant.requires, chronicleService]`，其注释（`:249-260`）表明「一个被 requires 但**不属于任何变体轴**的 Service」是被明确设计过的形状。**这就是本轮问题的答案**：不新增变体轴是可行的。
- 优点：正文**不跨语言管道**，请求行上限不动；读由 owner 做，归属清楚；渲染器仍是 owner 的（`read.ts:9-17` 的规矩）。
- 代价一：`requires` 是**硬依赖**（`runtime/runtime.ts:109-111` 的 `every`，无降级）。而 `desktop-content-read` 的 `setup` 在非 win32 直接 throw（`plugin.ts:176-182`）→ 该 Service 永不提供 → **语言插件停在 waiting，常驻起不来**。要接受这个耦合，或把 `provide` 提到平台门之前（那又意味着「能力存在但本机读不了」，语义要另说）。
- 代价二：多一份契约。按 Contract Creation Gate 的口径，它需要一个**真实发生的调用者** —— 而这个调用者只在授权存在时才调用。这是本轮要请 Human 裁的口径问题。

**A-3 · 把正文做成模型可调用的能力（新增 exposure）** —— **不推荐，且它与 G-1 的目标相反**

- 它把「读不读正文」的决定权交给模型，而那正是 mandate 禁止的：「模型调用了工具」不是授权。
- 它把能力加进哪份清单都要付代价：加进共同前缀 → 任何一次 `ask` 都可能读到正文（授权失效）；做成第三份清单或第三个变体 → **触发 §三 守卫**（`exposure.ts:40-48`），需要一次独立的 Composition Boundary Review（即 G-2）。
- 列为候选只为把「最省事的那条路」写下来并说明它为什么不行。

### 2.3 A / B 权衡对照

| 维度 | A-1 CLI 串联 | A-2 Service | A-3 exposure | B 自然语言 |
| --- | --- | --- | --- | --- |
| 新增 ServiceContract | 否 | **是** | 是 | 是 |
| 动 exposure 清单 | 否 | 否 | **是** | 是 |
| 触发变体守卫 | 否 | **否** | **是** | 是 |
| 撞请求行上限 | **是** | 否 | 否 | 不适用 |
| 需要新通信面 | 否 | 否 | 否 | **是**（提问通道） |
| 授权由谁判 | 人的命令 | 人的命令 | **模型** ✗ | 无解 |
| fail-closed | 是 | 是 | 否 | — |
| 改动面 | CLI + 语言请求词汇 | 内容插件 + 语言 | 全面 | 新架构 |

---

## §3 G-1 授权边界的可行设计

逐条回答 mandate §三 的九问。以下**推荐设计记为 D-A**（= A-2 为载体，授权走人的显式命令）。

### 3.1 谁能够发起内容读取？

**只有两条路，且必须互相独立：**

- **人**：通过 CLI 的显式命令发起（`hikari content status` 已经如此）。这是客户端 → 内容入口的既有链路。
- **语言插件**：**只在同一次请求携带人的显式授权时**发起一次读取。除这一次之外，语言插件没有任何路径能读到正文 —— 它没有 exposure，模型无法点名它。

**模型永远不是发起者。** 在 D-A 下模型甚至不知道正文能力存在（它不在 exposure 清单里）。

### 3.2 什么才算用户对本次内容传输的明确授权？

**一次把「问题」和「读屏幕」写进同一条命令的显式调用。**

这不是新发明的形状，是 `ask` 已经有的形状：`hikari ask` 的用法文本今天就写着「会把你说的话原文发送到 `--model-endpoint` 指定的模型端点」（`options.ts:347`）。人打这句话，就是对自己这段文字的披露与授权。**本轮的增量只是同一句话里再加上「本次读取到的窗口正文」这几个字。**

授权语必须满足：

1. **是人打的**，不是任何被读取的文本产生的；
2. **在读取之前就成立**（命令解析阶段），而不是读完之后补一句「要发吗」；
3. **命名了数据去向**（沿用 `options.ts:347` 的披露口吻）。

### 3.3 endpoint 可能是远程的，授权如何与实际接收方关联？

**关联方式：同一句话里的命名，而不是代码里的判断。**

- 源码**不允许**更精确的说法：`src/` 全域没有任何本地/远程判定（三份独立检索零命中），且 `language/plugin.ts:192-199` 明文写「这个插件不知道另一端是谁，也不许猜」。
- 因此披露文本只能说「发往**你配置的** `--model-endpoint`」，**不能**说「留在本机」。任何「本机就放行、远程才要授权」的写法都是在做本仓明令禁止的猜测。
- 这一点必须在文档与 help 文本里如实写，不得含糊。

### 3.4 授权是否只能覆盖一次请求？

**是，而且是结构性的，不需要额外的烧毁逻辑。**

- 语言入口是一问一答、无会话：「It stays a one-shot question and answer. There is no session, no subscription, no second frame on an open connection and no state between requests」（`language/endpoint.ts:20-24`）。
- 授权是**该次请求的一个字段**，随请求生随请求灭。进程里不留痕。
- 因此**不需要**「一次性令牌」「消费后作废」之类的机制 —— 没有可作废的持久状态。

### 3.5 用户拒绝或授权状态不明确时如何 fail-closed？

三层，都是既有的：

1. **开关不给 → 读取根本不发生**。语言插件不调用内容 Service，模型也拿不到任何正文。这不依赖模型配合。
2. **没有合格样本 → 内容入口回答失败**，原文是「Hikari 还没有观测到可以归给人类的窗口，这次读取没有目标。」（`plugin.ts:203-211`）。这不是五态之一，因为五态都是「关于某个窗口」的。
3. **读取本身失败（超时/不可读/空）→ 五态如实回报**（`types.ts:163-174`：`refused` 与 `unreadable` 永不合并，`empty` 与 `truncated` 永不同形）。

**「不明确」= 视同没有。** 授权是一个布尔事实（命令里有没有那个词），本仓不允许它变成「也许」。

### 3.6 是否需要确认交互？现有界面是否支持？

**不需要，而且现有界面也不支持。**

- **不必要**：D-A 的授权是命令式的 —— 人主动打出的那条命令就是那次确认。这与 `ask` 今天的处理完全同形，不需要在流程中间插入一次问答。
- **不支持**：本仓**没有**任何 Hikari → 人的提问通道：
  - `human-delivery` 是严格单向 egress，服务端**从不读**客户端（`human-delivery/endpoint.ts:7-11`），协议刻意只有「一串字符串」而没有回帧；
  - `confirm` 家族被三处明文否认是权限（`continuity.ts:17-23`、`language/plugin.ts:20-23`、`options.ts:352-354`），且它是**过去时**的记录、入口无认证、启动时一次性读入后冻结；
  - 常驻控制通道只有 `status` / `stop` 两个词，且明说不承载任何领域问题（`cli/control.ts:6-13`）；
  - TUI 与 Human Surface 都只能 `ask`，没有任何通道能把「是/否」送回 Hikari。

**所以：如果 Human 要求一次「Hikari 问、人答」的确认交互，那是一整条新通信面，属于架构级工作，不是本 slice 的一部分。**

### 3.7 如何防止模型或网页正文自行触发授权？

**靠「授权不是模型可触及的词汇」。**

- **模型**：正文能力不在 exposure 清单里 → 模型写不出它的名字；即使写了一个像的名字，`readCall` 返回 `undefined`（`tools.ts:131-139`），循环答 `UNRUN_CALL_RESULT` 并停止（`answer.ts:282-286`），**不读任何东西**。
- **窗口正文/网页正文**：授权来自 CLI argv，不来自任何被读取的文本。正文进不了控制流 —— 它只能成为**材料**，而材料在本仓里没有驱动任何分支的能力。
- **本地其他进程**：管道入口无认证（`continuity.ts:11-17` 已经承认同一件事适用于 `confirm`；`desktop-content-read/protocol.ts:8-16` 同样承认）。一个本机进程可以伪造一次「人打了命令」。**这一点本轮不掩盖**：本仓的端点在传输层不是人机身份边界，它从来不是。**这不新增风险类别** —— `ask` 今天已经允许任何本机进程把任意文本发往模型端点。

### 3.8 怎样避免原始窗口正文进入日志、Chronicle 或持久记忆？

**靠结构，不靠纪律：**

- `ask` 不写任何东西（`language/plugin.ts:375-386`、`ask-command.ts` 头部「什么也不保留」）；只有 `confirm` 写，而 `confirm` 只写**人自己打的字**。
- `desktop-content-read` 不写盘：「没有任何代码能写到磁盘，卸载时清空样本窗口」（`plugin.ts:71-75`）。
- 样本只在内存里留最近两个，`clear()` 在 teardown 调用（`plugin.ts:101-156`）。
- **必须新增的一条**：正文**不得**成为 `confirm` 家族的一员、不得成为任何 durable fact。这是本轮建议里唯一一条需要写进代码注释的禁令（因为「人可以确认一次读取」听起来很自然，但那条路会把正文永久落盘）。

### 3.9 如何约束最大内容量及上下文范围？

**今天可用的界**（都是 owner 的，且都是为「人读终端」定的）：

- `READ_MAX_CHARS = 40_000`、`READ_MAX_DEPTH = 32`、`READ_MAX_NODES = 2000`，超界显式标 `truncatedBy`，且 `scanned` 与 `matched` 一起上报。
- 输出侧：`MODEL_MAX_TOKENS = 4096`、`MODEL_TIMEOUT_MS = 15_000`（`language/model.ts:220`、`:235`）。

**必须显式作出的一个决定**：`READ_MAX_CHARS` 是为人读终端选的，**不是**为模型上下文选的。40,000 字符（约 1–2 万 token）进一次请求，成本与上下文占用都远超一次普通 `ask`。本轮**不建议**在复用与另定之间自行拍板 —— 见 §9-Q3。

---

## §4 Composition / Language / Plugin 责任归属

| 决定 | 归属 | 依据 |
| --- | --- | --- |
| **维持哪个窗口的样本、怎么归因** | 仍是 `desktop-content-read` | `target.ts` 是唯一有归属规则的地方 |
| **把读取渲染成行** | 仍是 `desktop-content-read` | `read.ts:9-17`：模型与人是同一份 owner 渲染；`language/contracts.ts:52-66`：渲染器留在 owner，调用方只提供事实，永远看不到渲染输出 |
| **`oneLine` 转义** | 既有两处（`presentation.ts` 内 `.map(oneLine)`；`read.ts:139-140`） | 上轮 D0 评审 §5.3-1 已定为纪律 |
| **授权的书写** | 人的 CLI 命令 | 与 `options.ts:347` 对 `ask` 的既有披露同形 |
| **授权的承载** | 语言入口的请求词汇（owner = `language`） | 它是「一次交互的属性」，不是任何领域的事实 |
| **读的触发** | 语言插件，且只在该次请求携带授权时 | 它是唯一知道「这次交互有没有授权」的地方 |
| **正文在 prompt 里的位置与标签** | `language`（沿用 `prompt.ts` 与 `express.ts` 的标签先例） | 与 `confirm` 家族同一处理方式 |

**明确不归属：**

- **不新增 Service 也能做（A-1），新增 Service 也不触发守卫（A-2）** —— 两条路都不需要新的变体轴。**可以做到「不新增独立变体轴」**，这是本轮对本仓问题「是否可以在不新增独立变体轴的前提下实现」的答案：**可以。**
- **不新增全局授权中心**。授权是一次请求的属性，不进任何跨插件状态。
- **不建 Generic Evidence Bus / Model Router / 中央 Judgement Domain / Service Locator**（mandate 明令）。A-1/A-2 都不需要它们。
- **不把正文塞进 `desktop-session-world`**（不建 GlobalWorldState）。

**会触发 G-2 的做法（本轮不做）**：把正文能力做成第三份 exposure 清单、第三个变体工厂，或加进某个变体而不是共同前缀（`exposure.ts:40-48` 的守卫原文）。

---

## §5 第一条可验收的自然语言理解链路

### 5.1 今天已经成立的一半（验收项 1、4 部分、5 事实部分、6）

`hikari ask "你知道我刚刚在看什么吗"`：

1. 模型可调 `desktop_context_read`（`desktop-session-awareness/exposure.ts:79-84`）；
2. 得到 `renderAssessment` 的行：**进程名 / 窗口标题 / 观测时间 / 与前一次的对比判词**（`desktop-session-observe/presentation.ts:85-90`）；
3. `answered`，人看到的就是那些行。

这满足「用已有桌面采样信息确定目标窗口」。**但模型在此不能说话**（单向门），所以验收项 5 的「推断」那一半不在其中。

### 5.2 需要裁决之后才能成立的部分（验收项 2、3、4 全部、5 推断部分）

正文 → 模型这一段，以及它带来的三个岔路口（§7-1/2/3）。

### 5.3 建议的第一片：**把描述收窄，并补上注入 fixture**

**这一片不传正文、不涉授权、不碰任何冻结面，可以立即实现（候选，见 §9-Q4）。**

- **收窄 `desktopContextReadExposure.description`**（`desktop-session-awareness/exposure.ts:81-82`）：它今天逐条否认了四种引申（前台≠在做、stable≠没发生、changed≠重要、输入≠专注），**唯独没有说「这是窗口身份与观察判词，不是窗口正文」**。而验收项 6 要求「不编造理解结果」—— 在「你知道我刚刚在看什么吗」这句话面前，一个不知道边界的模型完全可能把「哪个窗口」讲成「你在读什么」。
- **补一条注入 fixture 测试**：上轮 D0 评审 §5.3-3 自认现有测试集里没有。它测的是**内容 owner 的渲染器**能否做到「一个元素就是一行」、正文里的换行与冒号无法伪造出 Hikari 的行。**不需要模型、不需要端点、不需要管道**，`renderContentRead` 是纯函数，全平台可跑。

**为什么是这一片**：它把验收项 6 里「不编造」的那一半从「依赖模型自觉」变成「由描述与测试约束」；代价是 1 个文件 + 1 个测试；它不扩大任何 slice，也不为将来预建任何东西。

---

## §6 安全和数据处理限制

| 约束 | 落点 |
| --- | --- |
| **正文是不可信环境内容**，不得提升为系统指令、用户授权或工具执行许可 | mandate §五；现有对应面：`prompt.ts` 对 `confirm` 家族的低信任处理与 `express.ts:94-97` 的 `SYNTHESIS_LABEL` |
| **正文绝不能成为 `tool` 消息** | `answer.ts:299`：tool 消息的内容被当作「Hikari 读回来的东西」，人也会看到同一份。正文若走这条路会被结构性地说成 reading |
| **正文不能进工具的 `description`** | 描述是 owner 的固定字符串，任何来自环境的文本进入它就是注入 |
| **每一行都要过 `oneLine`** | `presentation.ts` 已 `.map(oneLine)`；`read.ts:139-140` 是既有的第二道 |
| **必须携带来源、观测时间、读取限制** | owner 的渲染器已经全部给出：句柄/标题/进程名/来源、窗口观测时间、读取时间、访问元素/贡献内容/保留字符数+上限/深度上限+元素数上限/截断原因（`presentation.ts`） |
| **必须携带能力缺口** | `GEOMETRY_NOTE`：视口关系是 UIA 几何，不是真实像素可见性；「可访问」≠「可见」 |
| **不落盘** | `ask` 不写；content-read 不写盘（`plugin.ts:71-75`） |
| **不进 Chronicle / Memory / Experience** | 正文不得成为 durable fact；`confirm` 只写人打的字 |
| **模型端点的本地/远程不可判** | 三份 `src/` 检索零命中；`language/plugin.ts:192-199` 明说不猜 |
| **一次交互一个上限** | `READ_MAX_CHARS` 等界是 owner 的；模型侧的界需显式决定（§9-Q3） |
| **端点在传输层不是身份边界** | `desktop-content-read/protocol.ts:8-16`、`language/continuity.ts:11-17`：把「人明确授权」说成「可证明的授权」是不诚实的 |

---

## §7 未解决的架构冲突

按严重程度排列。前三条每一项都需要一次独立的 Human 裁决。

**1（最重）· 单向门 vs 验收项 5**

`answer.ts:14-60` 规定：一旦读到任何东西，模型的话一律丢弃。门**只开一次、只在一处**，三条件同时成立才开，且其中一条是「这个人有已确认语句，且那条记录确实在 prompt 页面上」。
验收项 5 要的是「Hikari 用自然语言说明观察到的事实及**推断**」。**在今天的答复形状里，模型没有位置说这句话。**
开门的第二次理由与第一次同构（「第二种材料进入了模型的上下文」），所以它是一个**可以论证**的改动 —— 但它改动的是一个被明确定为「只开一次」的不变量，属于架构级决定，不是实现细节。

**2 · 正文以什么身份进入上下文（材料 vs reading）——这是本轮的真正岔路口**

- **材料**：不进 exposure 清单 → 不触发守卫 → **用 A-1 或 A-2 都能做到**。代价：模型很可能以 `chatted` 应答，而 `chatted` 的行是**无标注的模型散文**，`ask-command.ts:52` 只打印行、不带 outcome 抬头 —— 人**看不到**读到了什么，也分不清哪句是事实哪句是推断。
- **reading**：要一个 exposure → 触发守卫（需 G-2 评审）→ 而且模型的话会被单向门丢弃 —— 于是「模型用自然语言说明」这件事**反而更远**。

两条路都不通顺，这正是本轮的结论：**授权（G-1a）不是瓶颈，这个岔路口（G-1b）才是。**

**3 · 授权怎么承载 —— `LanguageRequest` 没有第三个字段**

`language/types.ts:4-8`、`:70` 都明确写着「没有第三个字段」，并且 `LanguageWord` 的注释给了新词的门槛：「第三个词必须是一个第三种**行为**，而不是已有的某一种的另一种拼法」。
「读一次屏幕并就它问我一个问题」是不是第三种行为？本轮的判断是**是**（`ask` 从不引起任何进程外读取，也从不把内容发往端点），但这是措辞级裁决，应由 Human 定。

**4 · 请求行上限（仅 A-1 路线）**

`MAX_LANGUAGE_REQUEST_LINE = 64 * 1024`（`types.ts:155`），而正文上限 40,000 字符、JSON 转义最坏 6 字节/字符。A-1 要么提高这个界（它的注释说它存在的意义是「不让对端决定本进程缓冲多少」），要么改分帧。**A-2 没有这个问题。**

**5 · `requires` 是硬依赖（仅 A-2 路线）**

`runtime/runtime.ts:109-111` 的 `every`，没有降级。而 `desktop-content-read` 在非 win32 直接 throw（`plugin.ts:176-182`）→ Service 永不提供 → **语言插件停在 waiting，常驻起不来**。要接受这个耦合，或调整 `provide` 与平台门的先后（那意味着「能力存在但本机读不了」，是一个新的语义）。

**6 · 端点在传输层不是人机身份边界**

`desktop-content-read/protocol.ts:8-16` 与 `language/continuity.ts:11-17` 都明文承认：本机任何能打开管道的进程都能发请求。所以「人明确授权」在实现上只能保证**「这条请求经过了本插件的入口」**，不能保证**「这条请求来自人」**。本仓接受这个口径（`confirm` 就是这么做的），本轮沿用，但**不把它说成更强的保证**。

**7 · 没有提问通道**

若要「确认交互」，需要新建一条带返回路径的通道。这是新的通信面，不是本 slice 的事。

**8 · `chatted` 在终端上没有可见标签**

`ask-command.ts:52` 只打印 `reply.lines`。一次没读任何东西的答复与一次读到了东西的答复，人在终端上只能靠行文形状区分。在正文进入之前这是个既有性质；正文进入之后它会变成「模型可能在没人看得到来源的情况下谈你的屏幕」。

---

## §8 READY / NARROW / BLOCKED 判定

### 8.1 分片判定

| 片 | 内容 | 判定 |
| --- | --- | --- |
| **G-1a 授权边界** | 人显式命令即授权；一次请求承载；fail-closed；不需要确认交互 | **NARROW**（可设计，最小形状有既有先例，但需一次裁决才可实施） |
| **G-1b 可达性** | 正文以材料还是 reading 进入上下文 | **BLOCKED**（两条路各有硬代价，需 Human 选定一条） |
| **G-1c 出口** | 模型能否对 reading 说话（单向门） | **BLOCKED**（改动的是「只开一次」的不变量，属架构级） |
| **第一片（§5.3）** | 描述收窄 + 注入 fixture | **READY**（不传正文、不涉授权、不碰冻结面），待 Human 点头 |

### 8.2 整体判定：**NARROW**

NARROW 而不是 READY 的理由是**范围**：真正可立即实施的只有 §5.3 那片，而 mandate §二 的六项验收属于**完整验收链**，它被 G-1b 与 G-1c 挡住 —— 这两项**独立于授权问题**，不是「授权解决了就能跑」。

NARROW 而不是 BLOCKED 的理由是：**授权这一项本身是通的**，最小形状今天就有，且不需要任何新的架构机制（不需要全局授权中心、不需要提问通道、不需要一次性令牌）。

### 8.3 本轮未验证、不得当作通过的事项

- **真实模型端点的端到端语义验证** —— **NOT RUN**（本机不可达，见既有记录）。§1.3 的推演是**读源码推的**，不是跑出来的。
- **真实窗口上的正文读取 + 模型** —— **NOT RUN**。
- **`createWindowsProbe`（`src/desktop-content-read/probe.ts`）仍然没有任何测试** —— 本轮复核仍未改变，是已知最大覆盖缺口。
- **`MAX_LANGUAGE_REQUEST_LINE` 提高之后的实际行为**（A-1 路线）—— **NOT RUN**。
- **前台窗口探针、独立常驻端到端验收** —— **NOT RUN**（承接上一轮）。

### 8.4 NARROW 的边界条件

本轮的 NARROW **不蕴含**：

- 不蕴含「正文可以发往模型」—— 恰恰相反，那一整段仍然 BLOCKED。
- 不蕴含「签个开关就能做」—— G-1b/G-1c 未定之前，开关造出来也无处可用。
- 不蕴含端点是否本机 —— 不可判，且不得猜。
- 不蕴含「模型调用了工具因此有授权」—— 这正是本轮要排除的读法。

---

## §9 需要 Human 裁决的最少问题

四问。前两问不定，实现无从开始。

**Q1 · 授权载体**
「一次显式命令（在 `ask` 上增加一个明确命名的开关/词）是否构成本轮要求的『明确授权』？」
还是 Human 要求**一次「Hikari 问、人答」的确认交互** —— 若是，那需要新建一条带返回路径的通道（§7-7），属架构级工作，本轮不能并进来。
*建议：前者。理由：它与 `options.ts:347` 对 `ask` 的既有披露同形；后者在本仓没有载体。*

**Q2 · 正文以什么身份进入上下文（本轮真正的岔路口）**
- **(a) 材料** —— 不进 exposure 清单、不触发守卫（A-1 或 A-2 均可实现）。代价：模型大概以 `chatted` 应答，人看不到来源行。
- **(b) reading** —— 要 exposure → **触发变体守卫** → 需先做一次独立的 Composition Boundary Review（G-2）；且模型的话仍被单向门丢弃。

*建议：(a)。但必须先接受它的代价，或同时裁决 Q3。*

**Q3 · 单向门是否允许为「正文」这第二种材料再开一次**
若**不允许** → 验收项 5 的「模型用自然语言说明推断」在 v1 无法满足，需要**下调验收**（改为：人看到 owner 渲染的事实，模型不说话）。
若**允许** → 这是一次与 G-1 同量级的架构决定，需要单独一轮，且要写清第二次开门的三个条件。
*这是本轮最需要 Human 表态的一条。*

**Q4 · §5.3 的第一片是否现在就做**
（描述收窄 + 注入 fixture；1 个文件 + 1 个测试；不传正文、不涉授权。）
*建议：做。它把验收项 6 的「不编造」从依赖模型自觉变成由描述与测试约束。*

---

## §10 明确不做的事项（本轮与近期）

**本轮（Boundary Review）：**
- 不修改任何生产代码，不 commit，不 push。
- 不修改任何架构冻结文档。
- 不实跑任何需要真实模型端点或真实窗口正文的实验。

**在 Q1–Q3 裁决之前，不做：**
- 不给 `desktop-content-read` 加 `ServiceContract`。
- 不碰 `exposure.ts` / `language/plugin.ts` 的变体 / `tools.ts` / `readArguments` 的任何清单断言。
- 不新增变体、不新增第三份 exposure 清单。
- 不给语言入口加第三个词或第三个字段。
- 不新建 Service Locator、全局授权中心、Generic Evidence Bus、Model Router、中央 Judgement Domain。
- 不把正文写进 Chronicle / Memory / Experience / Salience / `desktop-session-world`。
- **不把「配置过 endpoint」「用户曾经用过模型」「模型调用了工具」当成传输授权。**
- 不新建 Hikari → 人的提问通道。
- 不做截图、像素验证、视觉模型、OCR。
- 不把「读到的」表述为「用户看到的」。

---

## 附：本轮未修改任何生产代码

- `git status --short` 为空（基线 `89d363d`）。
- 本轮产出仅此一份文档。
- 等待 Human 审阅，**不自动进入编码**。
