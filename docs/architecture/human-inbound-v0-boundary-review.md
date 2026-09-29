# HUMAN INBOUND v0 — BOUNDARY REVIEW

- 日期：2026-09-29
- 轮次性质：**只设计**。不实现、不修改 Runtime、不创建 generic Human Input、不创建新通信平面、不创建第二输入面、不 commit production code。
- 前置：`docs/architecture/human-surface-v0-implementation-boundary-freeze.md`（已交付，commit `81842d0`）。
- 本文回答的是**入站问题**，只有一个：

> **人类说的话如何进入运行中的 Hikari —— 以及今天缺的到底是不是「入口」。**

**明确不研究**：「Hikari 该不该相信说话的人。」本文只指出这个事实由谁看守、今天有没有人看守，**不裁决**它该由谁承担。

---

## 0. 方法与证据

本文每条结论锚定到当前工作树的真实源码或已成立文档。三类证据分别标注：

| 标记 | 含义 |
| --- | --- |
| **[源码]** | 主 Agent 亲自读取的文件与行号 |
| **[文档]** | 已冻结 / 已交付文档的逐字引用 |
| **[未测]** | **没有**测到——不得读作通过 |

> **本轮没有任何运行期实测。** 本文全部结论来自源码与文档。凡涉及「运行起来会怎样」的判断，一律标 **[未测]**，不得被读成已验证。

三个只读子 Agent 分别清点：现存人类入口、两份出站 review 对反向方向的论述、三份权威文档对输入面的约束。按 `CLAUDE.md` §八，**其全部承重结论已由主 Agent 用独立 grep / 读文件重新锚定**（见 §1.4、§2、§3.5）。**未重新锚定的结论不进入本文正文。**

一处发现：`human-outbound-v0-boundary-review.md:751` 引用 `plugin.ts:76-81` 的那段 router 判词，实际位置是 `src/language/plugin.ts:96-101`。**引文是真的，行号漂了。** 本文按实际位置引用（§3.4）。

---

## 1. 源码现状：Human → Hikari 今天已经存在

> **结论先行：「入站」不是缺失能力。** 它今天存在，而且形状正是仓库自己反复写下的那一种——**领域自带 endpoint + 引用 owner 协议的 client**。

### 1.1 已有两条通在承载「人打进去的字符串」

| # | 通道 | 携带什么 | owner | 持久化 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | `hikari ask "<text>"` | **人类的整句自然语言**，CLI 不 trim、不折叠、不判意图 | `language` | **不持久化**——本次 activation 的对话轮 | [源码] §1.1.1 |
| 2 | `hikari focus <declare\|replace\|clear\|status> <designation...>` | 人打的任意字符串，但语义是**工作对象的名字**（一个操作数，不是一句话） | `work-focus` | **「集合真的变了」的那次持久化**（Chronicle，fsync） | [源码] §1.1.2 |

其余一切今天进入 Hikari 的都不是人说的话：`status` / `stop` 是无 payload 的固定词；`--data-dir` / `--model-endpoint` / `--repository` 等是配置值；感知类采集是 Hikari 主动向机器发起；SIGINT/SIGTERM 是无值的终止动作。

#### 1.1.1 `ask` —— 今天唯一承载人类自然语言的通道

**[源码]** `src/language/protocol.ts:29`：

```ts
const REQUEST_KEYS: readonly string[] = ['protocol', 'request', 'text'];
```

`:69` 只接受一个词 `'ask'`；`:75` 要求 `text` 是字符串。**信封恰好三个键**，`:134-137` 的 `hasExactlyKeys` 逐字说明「一个会对未知字段耸肩的信封，本身就已经是一个可扩展 schema」。

**[源码]** `src/language/plugin.ts:96-101`（承载它的那条边）：

```
// The endpoint is the plugin's own, over the same named-pipe precedent every other plugin-owned
// ingress uses. The CLI is a transport client: it carries the sentence in and the lines out and forms
// no opinion about either. The Resident's control channel is deliberately not involved — a channel
// whose whole design is two words about the process must not become a place where questions are
// routed to plugins, because the first question it answered would make it the router that design
// refuses to be.
```

**[源码]** `src/language/index.ts:58-61`——Language 自己说明**谁**在用它：

```
// The first had nothing to justify it until `repository-ci-attention` existed —
// "nothing in the composition asks this plugin for anything: the one thing that does is a person,
// arriving over the endpoint" was true when it was written, and a consumer is what made it stop being
// true —
```

**「the one thing that does is a person, arriving over the endpoint.」** 这是架构对 `Human → Language` 的既有定性：**人就是一个经端点到达的 client，不需要为它注册任何东西。**

**[源码]** `src/language/index.ts:74`：`export { languageEndpointPath } from './endpoint-path.js';`——端点派生**为 client 而导出**；`:1-7` 逐字写明「a client imports the endpoint derivation and the wire vocabulary, **so that both ends of the pipe are the owner's own statement of what the pipe means rather than two copies of it**」。

#### 1.1.2 `focus` —— 同一个形状的第二个实例

**[源码]** `src/work-focus/plugin.ts:3` 逐字：

```
// The human who declares a focus reaches this plugin over its own endpoint; that is a client, and it
// is not a reason to register anything.
```

**[源码]** `src/work-focus/index.ts:29`：`export { workFocusEndpointPath } from './endpoint-path.js';`；`:3-5` 逐字：「a client imports the endpoint derivation and the wire vocabulary」。

**两个独立领域、同一个形状。** 这不是巧合，是仓库已经成立的 precedent：**入站由领域自己拥有，client 引用 owner 的协议，中间没有第三方。**

#### 1.1.3 这条边被刻意写成「可证的最窄事实」

**[源码]** `src/work-focus/facts.ts:26-33` 逐字：

```
/**
 * What is provable about where this fact came from, and it is less than "a human".
 *
 * The ingress has no authentication: anything on this host that can open the pipe can state a work
 * focus, so a fact claiming `human` would be asserting an identity that nothing here established.
 * What this plugin can actually prove is that the request arrived through its own endpoint, and that
 * is what it says. A narrower claim that is true is worth more than a larger one that is not.
 */
const WORK_FOCUS_SOURCE_KIND = 'work-focus.endpoint';
```

**这是本文最重要的一处既成事实。** 见 §5。

### 1.2 出站平面是**故意领域无关**的

**[源码]** `src/human-delivery/protocol.ts:16-18` 逐字：

```
// What is deliberately absent: any schema beyond "an array of strings". This transport does not know
// what a line is about, and a decoder that validated content would be this module acquiring exactly
// the understanding its contract refuses.
```

出站帧是**一行上的一个 JSON 字符串数组**。没有 domain 字段，没有类型标签，没有优先级，没有路由。

### 1.3 Surface 今天有**零**个输入面

**[源码]** `apps/human-surface/` 全部 23 个 `.cs` 文件已清点（不含 `obj/`、`bin/`）：

- 唯一的 `TextBox` 在 `HumanSurface/SurfaceWindow.cs:26`，第 45 行逐字：`_transcript.ReadOnly = true;`
- 无 `KeyDown` / `KeyPress` 处理，无第二个输入控件。
- 全部领域词命中只有注释（`SurfaceChrome.cs:18` 提到「Language wrote it」是在说明**文本从哪来**，不是代码依赖）。
- **[源码]** `HumanSurface.Core/SurfaceSession.cs:12` 逐字：「it does not ask for the things it missed, and **it cannot produce them**.」

**Surface 是一个纯 transport client：它只认识 `human-delivery` 这条平面，不认识任何领域。**

### 1.4 穷举：全仓六个 server，没有第七个

主 Agent 独立执行的结果（`grep -rn "createServer\|\.listen(" src/ --include='*.ts'`，排除测试）：

| # | 文件 | `createServer` 行 | 收不收人类输入 |
| --- | --- | --- | --- |
| 1 | `src/cli/control-endpoint.ts` | `:45` | 否——两个词，无 payload |
| 2 | `src/work-focus/endpoint.ts` | `:68` | **是**（领域端点） |
| 3 | `src/desktop-session-observe/endpoint.ts` | `:51` | 否——无 payload |
| 4 | `src/language/endpoint.ts` | `:57` | **是**（领域端点） |
| 5 | `src/human-delivery/endpoint.ts` | `:68` | **否——出站专用，只写** |
| 6 | `src/repository-ci-relevance/endpoint.ts` | `:54` | 否——无 payload |

同时独立确认：`process.stdin|readline|createInterface` **0 命中**；`fs.watch|watchFile` **0 命中**；`process.env` **1 命中**（`src/language/model.ts:268`，凭据，变量名只能由 `--model-credential-env` 指认，不是通用通道）。

**六条边，两条收人的话。** 没有中央入口，也没有一个「所有交互必经」的地方。

---

## 2. 权威文档里**没有**的东西

这一节记的是**空白**，不是判决。空白与禁止必须分开写，否则会重演 `hikari-architecture-governance-review-v1.md` 记下的那个缺陷——**阶段性 non-goal 被读成永久 architecture prohibition**。

### 2.1 三份权威文档里没有「输入面」这一节

对 `principles.md`（747 行）、`core-architecture-v0.md`（436 行）、`plugin-design-spec.md`（787 行）逐文件检索 `ingress` / `input surface` / `输入面` / `输入入口` / `入口` / `router` / `路由` / `输入`：

| 文档 | 结果 |
| --- | --- |
| `principles.md` | `ingress` `输入面` `入口` `input surface` `router` `路由` `输入` 全部 **0 命中** |
| `core-architecture-v0.md` | 同上全 **0**（`输入` 唯一命中是 `:203` 的 Service 契约字段，不是入口概念） |
| `plugin-design-spec.md` | `ingress` `input surface` `输入面` `输入入口` **0** |

**三份权威文档**都定义了出站（`principles.md` §15：Domain Result → Presentation → RenderedMessage → Transport），**没有一份为入站写过任何条款**。

### 2.2 两份出站 review 也没有覆盖反向方向

对 `human-outbound-v0-boundary-review.md` 与 `outbound-composition-v0-boundary-review.md` 检索 `反向` `入站` `inbound` `reply` `feedback` `ack` `回应` `回复` `回执` `双向` `输入面` `Surface` `界面` `键盘` `鼠标` `语音` `打字` `键入`：

- `Surface` / `界面` / `输入面` / `输入端` / `键盘` / `鼠标` / `语音` / `双向` / `feedback` / `回复` / `回执` —— **两份文档全部 0 命中**。
- 唯一给出双向定义的地方是 `outbound-composition-v0-boundary-review.md:229-230`，而它把两个方向都定义成「**Language ↔ 组合里的别人**」：

```
- **入站（inbound）**：组合里的别人 → Language。今天只有一种：`Language requires <domain service>`。
- **出站（outbound）**：Language → 组合里的别人。今天**为零**（`provides: []`）。
```

**`Human → Hikari` 既不在这个「入站」里，也不在这个「出站」里。** 它在两份文档的坐标之外——**这是定义性空白，不是判决。**

- 两份文档的**待裁决项**（`human-outbound` §19.2 三个前提、`outbound-composition` §19.1/§19.3）**全部关于「谁有权主动说」**，没有一条关于反向方向的授权。
- 两份文档的**非目标清单**（`human-outbound` §17.1/§18、`outbound-composition` §18 四张表）**没有任何一项指向前向的反向路径**。最近的一条是 `outbound-composition:1254` 的 `| **ack / 二次 frame 协议** | v0 无；人有没有读到不由 transport 声称 |`，它在清单里的理由是「不由 transport 声称」，不是「人不能回话」。

> **一句话：上一轮没有禁止 Human → Hikari，上一轮没有看见它。**

---

## 3. 有约束力的判词（逐字）

以下五条是**今天真正有约束力**的，全部为 **[源码]** 或 **[文档]** 原文。

### 3.1 禁止重新引入的结构

**[文档]** `core-architecture-v0.md:391-404`：

```
## 11. 明确禁止重新引入的结构

除非重新进行架构审查，否则不得引入：

- 中央 AI Brain；
- 中央 Judgement；
- Super Orchestrator；
- GlobalWorldState；
- GlobalStateManager；
- 万能 Service；
- 万能消息对象；
- 所有交互必经的统一通信层；
- 所有 Provider 的通用智能调度器；
- 按业务类型不断扩张的 Plugin 基类树。
```

同族另有三处：`core-architecture-v0.md:68-76`（Runtime 不负责「用户语义 / 人格与最终表达 / 全局判断」）、`:139`（「Hikari **没有万能通信层、万能消息对象或统一通信信封**」）、`principles.md:527-548`（§17 God Object 审查信号，含「**成为所有调用的必经中转**」）。

### 3.2 「reaching another module is what a router does」

**[源码]** `src/cli/control.ts:5-11` 逐字：

```
// ... The vocabulary below is closed, and it is closed because both of its words are the Resident's
// own: process lifetime (`stop`) and what an operator is told (`status`). A kind whose semantics
// belonged to another module would have to reach that module through here, and reaching another
// module is exactly what a router does — such a request belongs in that module's own endpoint
// instead.
```

**最后半句是本文的正向判据**：不属于本模块的语义，**belongs in that module's own endpoint instead**——这恰恰是 `ask` 和 `focus` 今天已经在做的事。

### 3.3 transport 不拥有它所运送的东西的语义

**[源码]** `src/human-delivery/protocol.ts:16-18`（§1.2 已引）：「This transport does not know what a line is about.」
**[源码]** `src/desktop-session-observe/plugin.ts:59-61` 逐字：

```
// There is no Service, and by the Contract Creation Gate there should not be: nothing in the
// composition asks this plugin for anything, and the one thing that does is a client arriving through
// a pipe. Publishing a Service for that would be publishing one for nobody.
```

### 3.4 控制通道不接收第三种词

**[源码]** `src/language/plugin.ts:98-101`（§1.1.1 已引整段）：「must not become a place where questions are routed to plugins, because **the first question it answered would make it the router that design refuses to be.**」

**[文档]** `human-outbound-v0-boundary-review.md:751` 由此得出的推论逐字：「出站通知**绝不能**走控制通道……**增加第三种词就是把它变成 router。**」

### 3.5 「可达性 ≠ 授权」

**[文档]** `principles.md:225-227`：「> Capability existence ≠ Exposure ≠ Authorization ≠ Execution。这几个层次不得合并成一个布尔开关。」
**[文档]** `outbound-composition-v0-boundary-review.md:1072` 逐字：「`standing grant` 成立的范围是**「人可以收到」**，不是**「Hikari 可以决定什么时候说」**……**一条 standing grant 授予的是通道，不是判断。**」

### 3.6 契约创建门禁

**[文档]** `plugin-design-spec.md:519-569` §16：八问，任一指向「不成立」则不创建；「**若主要理由是「以后可能有用」，默认不创建。**」
**[文档]** `plugin-design-spec.md:569`（§16 收尾 REVIEW TRIGGER）：「特别地，第 7 问若答案为"是"，这不是一次 contract 新增，而是一次架构变更，必须升级审查。」

---

## 4. 形状空间：三种，两种合法

**问题被证据改写成了这个：** 人的话要从 Surface 出去，**必须有人回答「这句话是说给哪个领域的」**。只有三种可能。

### 形状 A —— Surface 直接成为某个领域端点的 client

Surface（或它的一个子窗口）自己 import `language` 的端点派生与线协议，直接把 `text` 写到语言端点。**形状上逐字镜像 `src/cli/ask.ts`。**

- **合法律**：复用既有 contract；不新增平面；不新增 contract；不引入 router。`src/cli/ask.ts:1-6` 是现成模板，`src/language/index.ts:1-7` 逐字说明这些导出**就是为 client 而存在的**。
- **代价**：**Surface 不再是领域无关的。** 它从一个纯 transport client 变成「Language 的 client」。今天是「谁连上来谁就是人」，明天是「这个窗口说的是 Language 的话」——**这是一个产品判断，被硬编码进 app。**
- **「哪个领域」由谁回答**：由 Surface 自己。今天只有一个答案（Language），所以不疼；`work-focus` 已经是第二个可寻址领域，所以**第二个输入框出现的那天**，Surface 要在自己内部决定怎么摆它们。

### 形状 B —— Surface 保持领域无关，绑定发生在组合期

Surface 的输入走一条新的、领域无关的边；**「这条边通向哪个领域」由常驻启动时的配置决定**，不由 Surface 决定。

- **合法律**：`phase-4-explicit-human-reference-review.md` 已记「composition-time config 存在且有 precedent」；`outbound-composition` 的结论也记「两条边都从 consumer 出发」。
- **代价**：Surface 仍然要在**不知道对面是谁**的前提下说话——而不同领域的线协议**结构不同**（`ask` 是三键信封带 `text`；`focus` 是词 + designation）。一个领域无关的 Surface 要想说两种话，就得在 app 内部按目标选编码器——**那正好是在 app 里造一个小 router。** 要避免它，就得让「通向谁」同时决定「说什么形状」，即一个可配置的 client 集合，工程量显著大于 A。

### 形状 C —— 新建「人的输入」平面，由中间层分发

一条新边承载「人说话了」，再由某个中间层把话送给相应领域。

- **不合法，且是本轮最危险的一条。** 那个中间层要按领域分发，**它就是 `core-architecture-v0.md:393` 禁止的「所有交互必经的统一通信层」**，也正是 §3.2 判词里「reaching another module is what a router does」的教科书形态。它还会立刻催生一个「人说话了」的通用消息对象——`§11` 的「万能消息对象」。
- **判据在仓库里已经写死过两次**（§3.2 控制通道、§3.3 出站平面）。**不存在需要新裁决的空间：C 与冻结原则直接冲突。**

> **结论：形状空间是 A 与 B，C 不是选项。** 而 A 与 B 的区别不是「哪个更好」，是**「Surface 要不要成为一个领域的 client」——这是产品判断，不是架构推论。**

---

## 5. 一个今天没有人看守的事实

**[源码]** `src/work-focus/facts.ts:26-33`（§1.1.3 已引全文）说得很清楚：

> 「The ingress has no authentication: **anything on this host that can open the pipe can state a work focus**, so a fact claiming `human` would be asserting an identity that nothing here established.」

**今天，Hikari 无法证明说话的是人。** 它能证明的最强事实是「这个请求经由我的端点到达」——`WORK_FOCUS_SOURCE_KIND = 'work-focus.endpoint'`。

这不是缺陷，是**已被做出的、正确的克制**（「A narrower claim that is true is worth more than a larger one that is not.」）。但它决定了入站方向真正的中心问题：

> **入站的中心问题不是「接哪根管子」，是「Hikari 能证明什么关于说话者」。**

这个问题在今天的 `ask` 上**没人回答过**——`src/language/plugin.ts` 的处理是「谁连上来谁就是人」（`outbound-composition-v0-boundary-review.md:303` 逐字：「谁连上来谁就是**人**，不是 plugin」），而 `ask` **不持久化任何事实**（`src/language/plugin.ts:103-106`：「no file, no store and no Chronicle entry anywhere behind this plugin」）。所以「假定是人也无所谓」——**不留下可被引用的错误事实。**

`focus` 会留下事实，所以它**拒绝**写 `human`。

**推论**：形状 A 若把 Surface 接到 `ask` 上，**不引入新的诚实问题**（不持久化）；若接到 `focus` 上，**也不引入**（已按最窄事实记）。但**任何**未来要持久化「人说了一句话」的设计，都必须先回答 §5 这个问题，而它**今天没有 owner**。

---

## 6. 具体失败场景

按 `CLAUDE.md` §八「没有具体失败场景的 finding 不进入最终结论」，本节写出可检查的失败形状。

### 6.1 今天的失败（产品缺口，真实且可复现）

```text
人坐在 Surface 前面 → Hikari 刚说完一句 → 人想回一句
→ Surface 全部 23 个 .cs 文件里，唯一的 TextBox 是 ReadOnly（SurfaceWindow.cs:45）
→ 人必须去开 PowerShell，打 `hikari ask "..."`
```

**后果**：`human-surface-v0` 的交付结论是「Hikari 能主动找到人」，但**人在那里答不了**。Surface 是**喇叭，不是在场**。
**[未测]** 本场景未经运行期复现（本轮无实测）；但它的依据是 `SurfaceWindow.cs:45` 的一行编译期常量，不依赖运行时行为。

### 6.2 形状 C 的失败（可检查的越界形状）

```text
新增 src/human-input/ 一条边，resident 收到人打的 text
→ resident 必须决定这段话给哪个 plugin
→ 第二个领域要收人的话时，这段决定逻辑必须扩展
→ 那一刻它就是「所有交互必经的统一通信层」（core-architecture-v0.md:393）
```

**判据是现成的**：这就是 §3.2 里「the first question it answered would make it the router that design refuses to be」说的是同一件事。**C 不需要新证据就能否掉。**

### 6.3 形状 A 的失败（要人接受的代价，不是 bug）

```text
Surface 接了 language 端点
→ Surface 的代码里出现 languageEndpointPath 的 C# 副本
→ 该副本与 src/language/endpoint-path.ts 之间没有 parity 测试 → 静默漂移
```

**这个失败形状仓库里已有对策**（见 §7），所以它是**可管理的**，不是否决理由。

### 6.4 一个具体的 UI 后果（数字，不是修辞）

**[源码]** `src/cli/ask.ts:102-103`：

```ts
export const REPLY_TIMEOUT_MS =
  (LONGEST_EXPOSURE_COUNT + 1) * MODEL_TIMEOUT_MS + READ_AND_FRAMING_BUDGET_MS;
```

代入 `src/language/model.ts:220`（`MODEL_TIMEOUT_MS = 15_000`）、`src/cli/ask.ts:100`（`READ_AND_FRAMING_BUDGET_MS = 90_000`）、`src/cli/ask.ts:91-94` 的 `LONGEST_EXPOSURE_COUNT = max(2, 3) = 3`（`LANGUAGE_EXPOSURES` 2 条 / `LANGUAGE_REPOSITORY_EXPOSURES` 3 条，本机 `dist/` 实测导入确认）：

```text
REPLY_TIMEOUT_MS = 4 × 15_000 + 90_000 = 150_000 ms = 2 分 30 秒
```

`ask.ts:55-75` 逐字说明这个界**是算出来的、不是挑的**，且「A timeout here is a claim about how long the human waited」。

> **一个 GUI 输入框不能继承一个同步 150 秒的等待。** 形状 A 落地时必然要回答：输入后是禁用整窗、显示进度、还是「答复晚些到达」——**这是一个真实的 UI 设计决定，本轮不替它决定**，但它证明「把 CLI client 换成 GUI client」不是零成本平移。

另：`src/language/types.ts:110` `MAX_LANGUAGE_TEXT_LENGTH = 8 * 1024`；`:119` `MAX_LANGUAGE_REQUEST_LINE = 64 * 1024`。**长度上限属于 domain owner，client 不得自行预检**（`src/cli/ask.ts:4-6` 逐字：「does not pre-check its length against the plugin's bound」）。

---

## 7. 一个**近似**先例，不是判决先例

**[源码]** `apps/human-surface/HumanSurface.Core/DeliveryEndpointPath.cs` 逐字自述：

```
/// This is <b>a second implementation of a derivation that already exists</b>, and that is a real
/// cost rather than a design. <c>src/human-delivery/protocol.ts</c> warns about exactly this shape:
/// "a client that wrote its own decoder would be a second statement of what this pipe means, and the
/// second one is the copy nobody re-reads when the first changes." A .NET process cannot import that
/// file, so the copy is unavoidable; what is avoidable is the copy going unchecked. The mitigation
/// lives in <c>HumanSurface.Tests</c>, which runs the real TypeScript function and asserts this one
/// agrees with it byte for byte
```

**它证明了什么**：Surface 在 C# 里重新推导一个 TS owner 的端点路径，**已有先例，且有 parity 测试兜底**（`HumanSurface.Tests/DeliveryEndpointPathTests.cs` 的 `RegisterConformanceAsync`，经 `NodeBridge` 跑真 TS 函数做逐字节比对）。

**它没有证明什么**：`DeliveryEndpointPath` 是**transport 平面自己的**路径——`human-delivery` 本身就是那条平面，不是一个领域。**Surface 知道 transport 的地址，与 Surface 知道某个领域的地址，是两件事。** 所以这个先例**降低**了形状 A 的工程风险（C# 端推导路径的机制、测试机制都现成），**但不回答**「Surface 是否可以是领域 client」这个规范问题。

**这是一个近失（near-miss）先例，不得当作判决先例引用。** 这一点必须写明，否则下一轮会有人把它当成「已经这么干过」。

---

## 8. Contract Creation Gate 逐条

对**形状 A**（唯一可能新增 public 面的一条）逐条回答 `plugin-design-spec.md:519-569` 的八问：

| # | 问题 | 回答 |
| --- | --- | --- |
| 1 | 谁拥有这个语义？ | **Language 拥有 `ask`**。不新建 owner。 |
| 2 | 是否存在真实跨模块 interaction need？ | **否。** 对端是**人**，不是组合内的模块（`outbound-composition-v0-boundary-review.md:469` 逐字：「那条路径上的对端是**人**，不是模块」）。 |
| 3 | Service / Event / Durable Fact / Action 哪一种？ | **都不是。** 是 endpoint 的**第二个 client**，不产生新契约。 |
| 4 | 现有 contract 能否正确表达？ | **能。** `ask` 的线协议、端点派生、长度上限、超时界**全部已导出且已为 client 而导出**（`src/language/index.ts:1-7, 74-96`）。 |
| 5 | 是否泄露实现细节？ | 否——client 只 import 已导出的公开面。 |
| 6 | 生命周期语义是否明确？ | 明确：与 `cli/ask.ts` 相同的 connect → 一行请求 → 一行应答 → 关闭。 |
| 7 | Runtime 是否因此开始理解业务？ | **否。** 一个字节都不进 Runtime。 |
| 8 | 真实需要，还是测试/对称/未来可能？ | **这是本文唯一无法自答的一问——见 §10。** |

> **第 4 问的意义**：形状 A **不创建任何 contract**。`plugin-design-spec.md` §2.1 的四条判据、§7 的「每一次新增导出」REVIEW TRIGGER、§16 的门禁，**约束的都是 owner 发布什么**；**client 消费既有公开面不需要许可。** `src/cli/ask.ts` 从来没有为「成为语言端点的 client」申请过批准，`focus-command.ts` 也没有。
>
> **因此：形状 A 的规范难点不在契约层，只在「Surface 是否该成为领域 client」这一条。**

---

## 9. 明确**不做**什么

- **不**新建 communication plane。
- **不**创建 generic Human Input / HumanStatement / 万能消息对象。
- **不**给控制通道增加第三个词（`src/language/plugin.ts:98-101`）。
- **不**给 `human-delivery` 加反向：它是**出站专用、只写**。**[源码]** `src/human-delivery/endpoint.ts:68-85` 的 `createServer` 回调只注册 `unref` / `setEncoding` / `error` / `close` 四个 handler，**没有任何 `'data'` 处理器**；写入路径只有 `write(lines)`。且其契约逐字拒绝理解「一行是什么」（§1.2）。**让它收话就是让它变成 router。**
- **不**创建 Service（`src/desktop-session-observe/plugin.ts:59-61` 判词：「a client arriving through a pipe」不构成 Service 的理由）。
- **不**为 Surface 的输入建 retry / queue / history / ack（沿用 `outbound-composition` §18.2 已冻结的非目标）。
- **不**裁决「Hikari 能证明什么关于说话者」（§5）——本轮只指出它没有 owner。
- **不**把本轮的结论读成对 `work-focus` / `language` 任何实现的授权。**`src/` 一个字节都不改。**

---

## 10. Verdict

### **NARROW**

**理由（逐条）：**

1. **能力已经存在**（§1）。`ask` 与 `focus` 是两条**形状正确**的领域入站边：领域自带 endpoint、client 引用 owner 的协议、中间没有第三方。**本轮没有发现任何缺失的架构能力。**
2. **缺口是 client，不是入口**（§1.3）。Surface 有零个输入面（`SurfaceWindow.cs:45`）。
3. **形状空间是 A 与 B，C 不合法**（§4），而 C 的不合法性**由冻结原则直接判定，不需要新裁决**。
4. **A 不新增 contract**（§8），所以它**不触碰** Contract Creation Gate 的任何一条 v0.5 new-contract 审查。
5. **但第 8 问本文答不了**（§8）：**「人要不要在 Surface 里回话」是真实产品意图，不是架构推论。** 证据（`ask` 存在、Surface 无输入、150 秒界）**支持不了**「所以要建」这个结论——它同样支持「Surface 就该是喇叭」。
6. 按 `CLAUDE.md` §三，第 5 条属**必须询问用户**的类别。**主 Agent 无权自决。**

**与既有 verdict 的关系：**

| 文档 | verdict | 与本文的关系 |
| --- | --- | --- |
| `human-outbound-v0-boundary-review.md` | NARROW | 方向相反（人对 Hikari ← → Hikari 对人）；其**待裁决项全部关于出站授权**，不覆盖本文。 |
| `outbound-composition-v0-boundary-review.md` | NARROW | 同上；其 §0.5 的「入站/出站」定义**不含** `Human → Hikari`（§2.2）。 |
| `phase-4-explicit-human-reference-review.md` | BLOCKED | **不同问题**（那条是「真实 human designation 与真实 reader 的已发生跨模块语义」）。本文不重启它，也不重开 Memory。 |
| `desktop-return-attention-v0-boundary-review.md` | BLOCKED | 无关。本轮的入站 Client 不触碰它。 |

**本文没有做出的决定：**

- 没有决定 Surface 是否该有输入面（§10.5）。
- 没有决定 A 还是 B（§4）。
- 没有定义任何新 contract 的形状——**因为不需要新 contract**（§8）。
- 没有裁决「Hikari 能证明什么关于说话者」（§5）。
- 没有决定输入框的 UI 形态（§6.4）。
- **没有为任何后续实现创造 general license。**（对照 `phase-4-explicit-human-reference-review.md` 的解封条件：「而非作为一般许可」。）

---

## 11. READY 的条件

本 slice 转 READY，需要 Human 给出**两条**裁决。**本文不代为裁定。**

### 裁决 1（产品意图，不可由架构推出）

> **Surface 是否要成为人可以对 Hikari 说话的地方？**

- **答「否」** → 本 slice **就此收口，标为 non-goal**。**这是完全合法的答案**，且与今天的实现完全一致（Surface 是喇叭）。此时应当做的是把「入站今天存在、形状是领域自带 endpoint」这件事写进 `current-stage.md`，**不写任何代码**。
- **答「是」** → 进入裁决 2。

### 裁决 2（形状与代价）

> **若「是」，Surface 是否接受不再是领域无关的 client？**

- **答「是」** → **形状 A**：Surface 或它的子窗口成为 `language` 端点的 client，逐字镜像 `src/cli/ask.ts`。工程风险已被 `DeliveryEndpointPath.cs` + parity 测试证明可控（§7）。**落地时仍需单独裁决 §6.4 的 150 秒 UI 问题。**
- **答「否」** → **形状 B**：Surface 保持领域无关，绑定发生在组合期。**代价是 Surface 内部会出现一个小 router 的倾向（§4.B），必须在实施前单独审查。**

### 两条裁决的**共同前置**（无论选哪条）

**入站不得经过控制通道，不得新增通信平面，不得引入按领域分发的中间层。** 这是 §3.2 / §3.3 / §4.C 已经判定的，**不需要 Human 再确认**。

### 附：本轮**不**构成对以下任何一项的推进

Memory（记忆 `memory-reactivation-v0-blocked` 已封箱）、`phase-4-explicit-human-reference-review` 的 BLOCKED、`outbound-composition` 的 §19.3 未消解分歧、Repository CI Attention。**本文与它们无交集。**

---

## 附录：本轮**没有**测到的事

| 事项 | 状态 |
| --- | --- |
| Surface 加输入面后的真实行为 | **[未测]** 本轮不实现，无实测 |
| 150 秒等待在 GUI 里的真实体验 | **[未测]** 数字是源码算出来的（§6.4），不是观察到的 |
| `ask` 端到端（含真实模型） | **[未测]** 本机无真实模型端点（见记忆 `no-external-model-endpoint`） |
| 非 Windows 平台行为 | **[未测]** 全部六条边都依赖命名管道 |
| CI | **[未测]** 本轮只新增一个 `.md`，未触发任何构建 |

**本轮未修改任何源码、未执行任何 git 写操作。**

---

## 附录二：本文的承重结论与锚定方式

按 `CLAUDE.md` §八，子 Agent 结论只作候选；下表为本轮承重结论的**独立锚定**记录。

| 承重结论 | 锚定方式 |
| --- | --- |
| 六条 `createServer`，没有第七个 | 主 Agent 独立 `grep -rn "createServer\|\.listen(" src/` |
| 无 stdin / 无 fs.watch / 一处 `process.env` | 主 Agent 独立 grep（0 / 0 / 1） |
| `ask` 承载人类整句 | 主 Agent 读 `src/language/protocol.ts` 全文 + `src/language/plugin.ts:88-109` |
| Surface 零输入面 | 主 Agent 读 `SurfaceWindow.cs:26,45` + 全 23 个 `.cs` 的领域词 grep |
| 出站平面领域无关 | 主 Agent 读 `src/human-delivery/protocol.ts:1-60` |
| Surface 已重推 TS 端点路径且有 parity 测试 | 主 Agent 读 `DeliveryEndpointPath.cs` 全文 |
| `facts.ts` 拒绝写 `human` | 主 Agent 读 `src/work-focus/facts.ts:20-40` |
| `ask.ts` 是 client 模板 / 150 秒界 | 主 Agent 读 `src/cli/ask.ts` 全文 + `MODEL_TIMEOUT_MS` 独立确认 |
| router 判词原文与位置 | 主 Agent 独立 grep 定位到 `src/language/plugin.ts:96-101`（**更正了 `human-outbound:751` 的行号引用**） |
| 三份权威文档无输入面章节 | 子 Agent 全量检索 + 主 Agent 抽查复核 |
| 两份出站 review 无反向方向论述 | 子 Agent 全量检索；承重项（§2.2 定义节、§3.5 的 §15.7）由主 Agent 读原文复核 |
