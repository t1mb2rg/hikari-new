# HIKARI DESKTOP CONTEXT UNDERSTANDING v0 — 设计研究报告

> **关于本文中指向 `docs/development/current-stage.md` 的行号**：该文件会被持续在文首追加状态行，**它的行号会漂移**——同一份文件里今天同时存在 +8、+84、+1441 等不同偏移，取决于每条引用写下的时间。**本文里的行号是写作当时的位置，不是今天的位置。** 要按今天读，请拿引号里的原文或小节标题去搜那个文件。
>
> 这条限定按 `governance-rules-v1.md` R7.2 加：**正文一个字符都没有改**，只在文首留一条说明，免得读者以为断掉的指针是我们今天写错的。

- **基线**：`9db8d34`（工作树只有未跟踪的 `contextual-experience-reactivation-n1-research.md`）
- **性质**：研究 / 设计。**未修改任何生产代码**，未 commit，未 push。
- **VERDICT**：**NARROW**（见文末）

## 证据分级约定

本文每条结论标注来源，读者可据此判断可信度：

- **【实测】**——本轮在这台 Windows 机器上真实执行并记录了输出。
- **【源码】**——直接读到的当前 `main` 源码，附 `file:line`。
- **【文档】**——仓库既有文档记载，未在本轮重新验证。
- **【未验证】**——推断或已知缺口，本轮**没有**证据支持。

判定纪律沿用 CLAUDE.md：**没有具体失败场景的结论不进入本文**；子代理结论一律重新锚定到源码后才采信。

---

## §0 方法与证据

本轮做了四件事：

1. 读 `src/` 全部与桌面观察、Language 读回路径、模型传输、CLI/常驻组合相关的源码。
2. 两次派只读子代理分别测绘「Language 读回路径与暴露面」与「常驻 / CLI / 配置 / 模型选项」，其结论**逐条回源码复核**后才引用。
3. 在这台机器上**实测** Windows UI Automation 的真实能力与真实延迟（探针脚本只读、只计数、**有意不转录任何窗口正文**，见 §2.1）。
4. 检索确认「浏览器原生接口」与「截图 + 视觉」两条路线在仓库中的现状。

**GitNexus 说明**：本地图数据库被另一 GitNexus 进程占用，`impact` / `detect_changes` 本轮不可用；且 `.gitnexus/meta.json` 的 `lastCommit` 为 `4143499…`，与 HEAD `9db8d34` 不一致。依 CLAUDE.md「graph 与源码冲突时：当前源码和实际执行结果优先」，本轮全部结论建立在**源码直读 + 真实执行**之上。本轮不修改生产代码，故未触发 impact 前置要求。

---

## §1 当前能力与缺口

### 1.1 今天 Hikari 已经知道什么

常驻的 base roster 固定加载 9 个插件【源码】`src/cli/resident.ts:219-273`：

```
continuity · chronicle · foreground · input-activity
desktop-session-world · desktop-session-awareness · desktop-session-awareness-loop
desktop-session-observe · work-focus
```

其中与「桌面是什么」直接相关的事实链是：

- `foreground` —— 前台窗口。载荷 `ForegroundTarget = {kind:'absent'} | {kind:'present', title?, processName?}`【源码】`src/foreground/types.ts`。注意 `title` 可为 `null`，且每个字段带**三态可用性**（source 报告自己观察到了什么）【源码】`src/foreground/windows.ts`。
- `input-activity` —— 输入活动。
- `desktop-session-world` —— 显式 scope 内的事实组合。
- `desktop-session-awareness` —— 与上一次快照比较出的判词：`changed | stable | indeterminate`【源码】`src/desktop-session-awareness/types.ts`。

### 1.2 模型今天能读到什么

Language 插件向模型暴露**三项能力，全部是零参数读取**【源码】`src/language/exposure.ts:114-131`：

| 线名（`tools[*].function.name`） | 指向的 Service |
| --- | --- |
| `work_focus_read` | `work-focus.current@1` |
| `desktop_context_read` | `desktop-session-awareness.peek@1` |
| `repository_ci_relevance_read` | `repository-ci-relevance.current@1`（仅 repository 变体） |

今天用户问「你知道我现在在做什么吗？」时，模型能拿到的最深一层是 `desktop_context_read` 的渲染结果，而该能力的**自述原话**是【源码】`src/desktop-session-awareness/exposure.ts:81-83`：

> 读取 Hikari 当前的桌面会话观察与 awareness assessment，这次读取不会推进 desktop awareness 的时间线。返回的是 Hikari 已经建立的事实与判词本身，不含引申：前台是某个应用不等于用户正在做与之相关的事，stable 不等于什么都没发生，changed 不等于重要，输入活动不等于用户的专注程度。

### 1.3 缺口的准确位置

**缺的不是「知道在做什么」，而是「知道在做什么的内容」。**

今天 Hikari 掌握的是：**哪个进程 + 窗口标题（当 OS 报告时）+ 输入活动 + 与上一刻的差异判词**。它不掌握窗口**内部**的任何可读内容——文档正文、聊天记录、代码、网页。

一个具体对照：用户在 VS Code 里读一份设计文档时，今天的 Hikari 能说出「Code，标题 `desktop-context-understanding-v0-research.md - hikari-new - Visual Studio Code`，输入活动静止，相对上次 stable」。它说不出用户正在读的那一段是什么。

### 1.4 与本轮相关的三条硬约束（均已核到源码）

1. **模型传输层不支持多模态。** `ModelMessage` 的 content 只有 `string`【源码】`src/language/model.ts:186-194`；`readContent` 在应答 content 非字符串时直接抛错【源码】`src/language/model.ts:475-480`；`toWireMessage` 发出的是字符串 content。**请求侧与应答侧都没有图像通道。**
2. **对模型可见的读取内容没有大小上限。** 原话【源码】`src/language/model.ts:233-234`：a capability's tool result is not bounded by this and could not be — the ceiling applies to what the model generates, not to what it is shown。`MODEL_MAX_TOKENS` / `MAX_LANGUAGE_TEXT_LENGTH = 8*1024` 管的是别的地方。
3. **读回路径已经是「owner 自己的渲染 + 逐行防腐」。** 每个读分支都走 `lineSafe(lines) = lines.map(oneLine)`【源码】`src/language/read.ts:139-140`。设计理由写在同一文件【源码】`src/language/read.ts:24-30`：交给模型的是 **owner 自己的渲染函数**——与人类路径调用的**同一个函数**；理由是「模型看到同一读数的**另一种**视图，就等于对同一件事的第二种陈述」。

**第 3 条是本报告最重要的既有先例**：任何新的内容读取若要把文字交给模型，必须由**内容 owner 提供渲染器**，并复用 `oneLine`。这不是本轮新造的约束，是已经成立且被测试固定的模式。

---

## §2 三条感知路线的真实可行性

### 2.1 路线一：Windows UI Automation / Accessibility

#### 实测：能力

本轮写了三个只读探针，**不属仓库、不随本报告提交**，位置是作业临时目录，作业删除即消失：

```
<作业临时目录>/uia-probe.ps1            单窗口能力探查
<作业临时目录>/uia-survey.ps1           跨应用能力调查（下表来源）
<作业临时目录>/measure-uia-latency.mjs  延迟测量（下下表来源）
```

探针枚举「可见、未最小化的有标题顶层窗口」，每个进程名取一个，做**有界**遍历（ControlView ≤800 节点 / 深度 10；RawView ≤3000 节点 / 深度 14），统计元素数、控件类型分布、`TextPattern` 字符总数。**探针有意不转录任何窗口正文**——只报告能力、结构与规模。若需保留以复现，请在作业删除前取走。

当时机器上 12 个进程有符合条件的主窗口，取前 8 个。结果【实测】：

| 进程 | ControlView 节点 | TextPattern 元素 | 字符数 | RawView 节点 | TextPattern 元素 | 字符数 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ChatGPT | 36 | 2 | **9746** | 65 | 2 | 9747 | 347 ms |
| Code (VS Code) | 15 | 0 | **0** | 75 | 19 | **629** | 115 ms |
| QQ | 10 | 0 | 0 | 14 | 1 | 0 | 44 ms |
| Weixin | 3 | 0 | 0 | 3 | 0 | 0 | 7 ms |
| cloudmusic | 5 | 0 | 0 | 5 | 0 | 0 | 8 ms |
| StarPie | 1 | 0 | 0 | 1 | 0 | 0 | 69 ms |
| PowerToys.QuickAccess | 1 | 0 | 0 | 1 | 0 | 0 | 1 ms |
| SystemSettings | 1 | 0 | 0 | 1 | 0 | 0 | 2 ms |

三条读数：

1. **8 个应用里只有 1 个能通过 UIA 读到正文。** 这是本报告最硬的一条事实。
2. **ControlView 会剪掉正文，RawView 才有。** VS Code 在 ControlView 下 0 字符，在 RawView 下 629 字符、19 个 `TextPattern` 元素。**采用哪种 walker 直接决定能不能读到**。
3. **`TextPattern` 覆盖率极低**。多数应用连一个 `TextPattern` 元素都没有。

#### 实测：延迟

4 轮取中位数【实测】：

| 形态 | 中位耗时 |
| --- | ---: |
| 裸 `powershell -NoProfile -NonInteractive -EncodedCommand` 启动 | 154 ms |
| ＋ 加载 `UIAutomationClient` / `UIAutomationTypes` | 198 ms |
| ＋ 对前台窗口做一次有界 ControlView 遍历 | **526 ms** |

即：**UIA 读取自身的成本 ≈ 330 ms**，外加 ≈198 ms 的进程与程序集固定开销。参照系是既有 `foreground` 采集（同样的 `-EncodedCommand` + `Add-Type` P/Invoke 形状，只有 user32 调用），UIA 路线大约是它的两倍。

#### 方法论限制（必须声明）

上表**不能**读作「UIA 只对 1/8 的应用有效」。已知的四项削弱因素：

- 每个进程**只取了一个**窗口，未必是该应用的主内容窗口。
- 遍历**有界**（节点数与深度都有上限）。真实读取应用 `FindAll` / 内容视图，而非暴力深走。
- 只用了 `ControlViewWalker` 与 `RawViewWalker`，没有试 `ContentViewWalker`，也没有用 `TargetedElement` 定向搜索。
- 采样时刻多数应用处于空闲或后台状态，部分窗口本身就没有正文。

**可以站得住的结论是**：UIA 的可达性是**逐应用**的，差异可以从 0 字符到近万字符，**必须逐应用建立，不能假设**。

#### 既有先例【文档】

仓库**在真实 Windows 上对真实应用用过 UIA**，但**只用于验证探针，从未交付**：

- `docs/architecture/human-surface-v0-implementation-boundary-freeze.md:249` —— `TextPattern.DocumentRange.GetText(-1)` 被表述为「唯一能跨进程读 edit control 的方式」。
- 同文 `:275` —— `EM_GETLINECOUNT` 测量；`:291` —— 经 UIA `InvokePattern` 操作托盘菜单。
- 同文 `:359` —— **已测量的副作用**：跨进程 UIA 查询会在目标进程中产生窗口消息和句柄；14 个样本内句柄在 351–402 区间振荡、**非单调**；「12 次重连不累积」经测量，但**数小时 soak 未进行**。
- `docs/development/current-stage.md:201` —— UIA `ValuePattern.SetValue` / `InvokePattern.Invoke` / `TextPattern` 读回在真实 Windows 上验证过。

**已交付的 C# 应用不含 UIA**：`apps/human-surface/` 只用 user32（`TrayIconArt.cs:65`）与 kernel32（`PipeEndpointPath.cs:116,121,125`）。UIA 在本仓库是**验证工具**，不是产品机制。

#### 平台限制

- **只读可以做到。** 本轮的写入侧（`ValuePattern.SetValue` / `InvokePattern.Invoke`）本轮**未使用也未验证**——第一片场景不需要写。
- **UIA 调用会在目标进程产生真实副作用**（上述 `:359` 的实测），且该测量**只覆盖 14 个样本**。长时运行的累积效应【未验证】。
- 目标进程无响应时 UIA 调用可能阻塞。本轮 8 个应用均在 350 ms 内返回，**没有**遇到卡死样本。

### 2.2 路线二：浏览器与应用原生接口

**仓库现状：零。** 检索 `chrome|chromium|browser|cdp|devtools|puppeteer|webdriver|playwright`【实测/源码】在 `src/` 只命中 4 处，全是 TUI 的「界面装饰（chrome）」这个无关词义（`tui-render.ts:84,87,105,704` 等）。

可行性判断：

- **能力**：对 Chromium 系（Chrome / Edge / Electron 应用）经 CDP 可拿到**精确、结构化、带新鲜度**的页面内容，质量远高于 UIA。对 Firefox 需另一套协议。对原生应用（Office、记事本、微信）**完全不适用**。
- **成本**：需要按浏览器家族各写一份 provider；需要目标进程以调试端口启动（或注入），**改变用户既有启动方式**；需要维持连接与生命周期。
- **与现有 Plugin 所有权的关系**：会引入「按应用家族分裂」的 provider 集，且每个 provider 的 contract 语义互不相同。
- **本轮结论**：**不采用**。不是做不到，是**没有需求证明**它值得——第一片场景的验收可以在单一路线上完成，而路线二把「读什么应用」变成「装了什么浏览器」。

### 2.3 路线三：屏幕截图与视觉模型

**仓库现状：零。** 全仓检索 `screenshot|BitBlt|CopyFromScreen|Graphics.FromImage|PrintWindow|GetDC|data:image`【实测/源码】：

- `src/` —— **无任何屏幕捕获**。
- `apps/human-surface/HumanSurface/TrayIconArt.cs:30` —— 唯一的 `Graphics.FromImage`，用于画 16×16 托盘图标。
- 其余命中全是 `docs/diagrams/*.html` 里的 SVG data URI 与导出按钮。

**阻塞点**：`ModelMessage.content` 只有 `string`【源码】`src/language/model.ts:186-194`。要让视觉模型看到截图，**必须修改 Language 的模型传输契约**——而本轮 mandate §5 明确要求「不为了支持视觉输入而提前重构整个 Language」。

另有数据边界问题：截图是**整个窗口的完整像素**，无法按字段裁剪，且必然发往远程模型。这比「读文本」的边界大一个量级。

**本轮结论**：**排除**。技术上被传输层挡住，策略上被 mandate §5 挡住。

---

## §3 推荐的第一片产品场景

**采用路线一（UIA），场景收窄为一个具名的、可读的应用类别。**

Mandate 给的产品场景是准确的，但「用户正在使用某个应用」这句话的**验收含义**必须固定下来，否则第一片无法判定成败。理由见 §2.1：可达性是逐应用的，8 个真实应用里只有 1 个读得到。

建议的第一片：

> 用户在前台使用一个**能够通过 UIA 报道正文的应用**，向 Hikari 提问「你知道我现在在做什么吗？」。
> Hikari 读该窗口的可读文本，据此作出自然语言解释，**并明确区分**：它读到的原话、它自己的解释、以及它无从判断的部分。
> 当窗口**读不到正文**时，Hikari 明确说出读不到，而不是改用窗口标题猜测。

这个收窄是**诚实的**，而且它把 §2.1 的「6/8 读不到」从缺陷变成了**必须覆盖的验收路径**——mandate §4.4 要求「对看不到或无法判断的部分明确说明」，§4.5 要求「验证……不可读取内容……时的行为」。仓库已有现成的三态约定（`titleAvailable` / `processAvailable`、`indeterminate`）可以直接承接。

**第一片不做**（与 mandate §4 一致）：不做全程后台截图、不做屏幕内容长期存储、不做 Memory Reactivation。

### 关键：模型怎么读到内容

**不需要新的机制。** 现成的 tool-use 回路已经精确地表达了 mandate §3 想要的语义：

- 模型**自己决定**要不要读（capability 是被 *offered* 的）【源码】`src/language/exposure.ts:56-58`：暴露不携带任何许可，它只说某项能力**可以被提供**。
- 读取结果作为 tool result 回到模型，**模型看到的正是人类将看到的那些行**（同一渲染函数，见 §1.4 第 3 条）。
- **没有任何工具能把 tool result 变成 Chronicle 事实、Memory 或行动**——见 §6.1。

---

## §4 最小架构边界

### 4.1 结构

最小形态（**本轮不实现，仅描述边界**）：

```
新增：桌面内容的 on-demand 读取 provider（一个 Plugin）
  ├─ 拥有：经 UIA 从一个具名窗口取可读文本；三态可用性；新鲜度语义
  ├─ 复用：src/foreground/acquisition.ts 的 seam 形状
  │        （可注入 acquirer 的工厂 + context.defer(dispose)）
  ├─ 提供：一个「读取」契约，语义仿 desktop-session-awareness.peek
  │        —— 读取不推进任何时间线、不改变任何基线
  └─ 不提供：不做后台循环、不写 world、不落盘、不缓存

Language 侧：
  ├─ 在 exposure 列表里新增一项，线名过 `^[a-zA-Z0-9_-]+$`
  ├─ 读回路径新增一个分支，走 owner 自己的渲染器 + lineSafe/oneLine
  └─ 不新增任何自动注入——模型要读才读
```

### 4.2 明确不做

- **不建 GlobalWorldState / Global Desktop World。** 内容**不进入** `desktop-session-world`。world 保存的是前台与输入这类事实；内容是按需读取的另一次读，读时取得、用完即弃。
- **不建 Generic Sensory Bus。** 不新增统一感知通道；不把「读窗口内容」泛化成「读任意来源」。
- **不建 Central Brain / 模型路由器。**
- **不做后台采集循环。** mandate §4 明确第一版不要求；`desktop-session-awareness-loop` 的节奏与内容读取**无关**。
- **不落盘、不做 Memory。** 屏幕内容不长期存储。
- **不把内容推进 prompt。** 走既有 exposure/tool 机制，由模型决定读不读。
- **不提前重构 Language 以支持视觉。**（mandate §5）

### 4.3 与现有 Plugin 所有权的关系 —— 本报告最尖锐的一处

「谁拥有内容读取」有两条路，**它们不是等价的**：

**路线 A：扩展 `desktop-session-awareness`。**
内容读取成为该插件的一个新契约。因为该插件在 base **无条件加载**，新增能力**同时进入两个 exposure 列表**，变体数**仍是 2**。
代价：把「窗口内容采集」放进一个当前 concern 是「时间线上的移动判词」的插件里。该插件的 exposure 文件【源码】`src/desktop-session-awareness/exposure.ts:22-26` 明确主张：observe 拥有渲染而「**不持有任何自己的事实**」，读桌面的语义**住在这里**。内容采集是不是「读桌面的语义」，是可以辩论的。

**路线 B：新建一个插件拥有内容采集。**
所有权更干净。但**新插件是否被无条件加载**决定了代价：
- 若无条件加载 → 仍不是新的独立可选轴 → 变体数**仍是 2**，只是两个列表各多一项。
- 若由 composition 决定加载 → 它成为**第二个独立可选的能力** → 变体数 **2 → 4**。

而 `src/language/exposure.ts:40-48` 给出的**已冻结的**守卫原话是：

> 两个具名变体被批准，理由恰好只有一个：base Language 与 repository-aware Language 相差**一个**独立可选的能力，而一个可选能力有两种状态。**第二个**这样的能力会变成四个变体，第三个会变成八个……**如果第二个独立可选的领域能力出现，答案不是这里的第三个字面量列表——而是一次 Composition Boundary Review**，审查能力可达性到底应不应该在 composition 时决定。

**因此：只要新插件是可选的，本轮就撞上了一个已记录的架构守卫，必须先做 Composition Boundary Review，而不是照着现有形态直接加一行。**

依据双 CLAUDE.md 的决策优先级，这条守卫属于「已冻结原则 / 已成立 precedent」层级，**不能由执行 Agent 自行决定**。→ 进入 §8 的 Human 裁决问题 1。

（本轮不在两条路线中替 Human 选择，因为选择本身受制于一条冻结守卫；但我记录一条判断：**路线 A 的语义摩擦是真实的，路线 B 的架构代价取决于一个尚未决定的事实（新插件是否可选）**。把「是否可选」先定下来，两条路线的高下才有意义。）

### 4.4 新鲜度语义（必须显式）

内容**不是**「当前内容」，而是「**本次读取那一刻的内容**」。落在契约与渲染文本里，措辞必须是后者。理由与 `repository-ci-relevance` 同构【源码】`src/repository-ci-relevance/contracts.ts:27-29`：

> 两次调用之间不保存任何东西。没有缓存、没有上次答案、没有第二次判断：调用两次的调用者得到的是两次独立快照的两次独立比较——这是「relevance」成为关于**现在**的问题、而不是关于上次答案的记忆的唯一形态。

---

## §5 模型与部署要求

### 5.1 传输层：不需要任何改动

**这是路线一最大的部署优势。** 读取窗口正文产出的是**文本**，`ModelMessage.content` 是 `string`，现成可用。**不需要多模态、不需要改 Language 的传输契约、不需要换模型。**

### 5.2 端点要求（既有，非本轮新增）

端点必须支持 **OpenAI 兼容的原生 tool calling**【源码】`src/cli/options.ts:339-340`。模型名、端点 URL、凭据环境变量名、`reasoningEffort`（闭集 `none | high`）全部由 operator 给出，**没有默认值**——`options.ts:52-55` 的原话是「没被告知问哪个模型的 Hikari 就不问，也不回落到公共端点或环境里翻出来的凭据」，理由是默认模型等于「这个文件替人类把话发到没人指定的地方」。

### 5.3 必须处理的新问题：读取内容没有上限

【源码】`src/language/model.ts:232-234` 明确写了 tool result **不受**上限约束，**也不可能受**。这对现有的三项能力无害（它们返回的是渲染后的判词，天然短），但**对窗口正文是真实的危险**：一份长文档、一个聊天记录滚动的窗口，取回来可以是数 MB。

**结论**：上限必须由**提供方（读取侧）**施加，**不能**指望回路兜底。这是实现前必须定下数值的一项。→ §8 问题 4。

### 5.4 时间预算的现状

- `MODEL_TIMEOUT_MS = 15_000`（单次模型调用）【源码】`src/language/model.ts`。
- `READ_AND_FRAMING_BUDGET_MS = 90_000`（读与成文的整体预算）。
- UIA 读取自身实测 ≈330 ms，占整体预算的 0.4%——**延迟不是这条路的瓶颈**。

### 5.5 这台机器上能验证到哪一步（诚实声明）

真实模型端点在这台机器上**不可达**（向外站发模型请求会被拦）。因此：

- **可以验证**：UIA 真实读取（已做）、请求装配（`ModelRequest` 的内容）、工具回路逻辑（本地假端点）、读回渲染、三态与失败路径。
- **本轮 NOT RUN**：对真实模型的端到端语义验证。**不得**写成 PASS。
- 依既有做法，验收应建立在**本地假端点**上，断言「假端点收到的请求里有什么」，而不是断言「模型答得好不好」。

---

## §6 可靠性与数据边界

### 6.1 提示注入：现状与本轮的真实暴露面

**检索结果【实测/源码】：`src/` 中没有任何 `injection` / `untrusted` / `adversarial` 字样，也没有任何注入测试。** 现有防御是两条，**都不是内容过滤**：

1. **信任分层**——`prompt.ts:43-44` 把材料标为「低信任来源，且 prompt 必须自己说出来，不能指望模型推断出来」；`prompt.ts:49-51` 点名了确切的失败模式：把它们注入 prompt 的失败模式，是**模型在其中读出了一个「请求」**（原文举例：一句「记住我现在只关注 X」被当成对 X 采取行动的指令）。
2. **行伪造防护**——每个读分支走 `lineSafe` / `oneLine`（§1.4）；`express.ts` 对模型输出**再次转义**，理由是「模型也不是受信任的布局来源」。

另有一层**架构性的**缓解，比上面两条更强：

> **工具回路里没有任何能行动的 capability。** 三项暴露全部是零参数读取（§1.2），`answer.ts` 里没有行动路径，TUI 明确拒绝提供 `confirm` 命令（`tui.ts:24-29`：一个既能提问又能确认的输入行，会让这个界面里**唯一留下痕迹的那个动作**，变成取决于一句话是怎么打出来的）。

**因此一次成功的注入，改变的只是 Hikari「说什么」，不是 Hikari「做什么」**——今天没有可被注入触发的动作。

**引入窗口正文改变了什么**：外部内容第一次成为**被展示给模型的材料**，而非 Hikari 自己的判词。mandate §3 的要求「外部内容只能作为被观察的材料，不得变成对 Hikari 的控制指令」在今天的架构里**由结构保证**（无行动工具），但仍需两件事：

- 新增的读分支**必须**走 `lineSafe` / `oneLine`——这是既有纪律，不是可选项。
- 渲染文本必须把内容**标注为来源材料**，而不是 Hikari 的陈述。此处可复用 `SYNTHESIS_LABEL` 的既有思路【源码】`src/language/express.ts:95-98`：「（下面不是读回来的内容。Hikari 自己说的、没有核实过的话；你以前说的也一样。）」
- 需要一个**注入 fixture 测试**——现有测试集里没有。【未验证】注入在当前架构下的实际效果，本轮没有构造验证。

### 6.2 数据边界 —— 仓库里没有任何一层

**诚实结论：`src/` 中不存在用户同意机制、隐私边界或脱敏。** 全仓检索 `consent|privacy|redact|隐私|同意|sanitiz|敏感|脱敏|不发送`【实测/源码】在 `src/` **零命中**。仓库自己的治理文档已记录该缺口：`docs/architecture/hikari-current.md:527` 写作「权限 / 授权层 无」【文档】。

现存与「秘密」相关的只有**凭据不外泄**（`--model-credential-env` 只收**变量名**不收值；传输失败只报状态码/socket 错误，绝不带请求体、请求头或应答体），这与「发什么内容出去」是**两个不同的问题**。

**出站目的地共两个**【源码/实测】：
1. operator 指定的模型端点（`src/language/model.ts:343`）——**无默认、无硬编码 URL**。
2. `https://api.github.com`（`src/github-ci/github.ts:5,47`），仅在配置了仓库范围时，匿名只读。

无遥测、无更新检查、无分析上报；`package.json` 无运行时依赖。

**这意味着**：一旦引入窗口正文，**正文将按现有行为直接发往 operator 指定的端点**（可能是远程），而**现有代码里没有任何东西会拦截、询问或脱敏**。mandate §5 要求「若涉及……内容发送到远程模型，必须明确用户授权和数据处理边界」。→ §8 问题 3，这是可能把 NARROW 推向 BLOCKED 的唯一一处。

### 6.3 读取失败与不可读

三态是仓库的既有习惯（`titleAvailable` / `processAvailable`；`changed|stable|indeterminate`）。新增读取必须延续：**读不到是一个必须能说出口的答案**，而不是沉默或用标题猜。§7 的验收条件 3 与 5 直接测这一条。

---

## §7 可执行的验收条件

全部可在**本地假端点 + 真实 Windows**上执行；对真实模型的语义验证标注为 NOT RUN（§5.5）。

| # | 场景 | 判据 |
| --- | --- | --- |
| 1 | 具名可读应用在前台，`hikari ask "你知道我现在在做什么吗？"` | 假端点捕获到的请求中，存在一次内容读取的 tool result，且其中包含该窗口的真实可读文本 |
| 2 | 内容来源可说明 | 该 tool result 明确带出：进程名、窗口标题、以及「这是本次读取时刻的内容」 |
| 3 | 前台应用**读不到正文**（实测 8 个中有 6 个属此类） | 读取结果明确报告读不到；Hikari 的回答**不**改用窗口标题编造内容 |
| 4 | 提问与读取之间发生窗口切换 | 读取报告的是**读取时刻**的窗口；回答不声称是先前那个 |
| 5 | 读取失败（UIA 抛错 / 超时） | 三态可用性正确落位；不崩溃；不产生任何虚构正文 |
| 6 | 注入 fixture：窗口正文内含指令形状的句子 | 该句以**材料**身份出现在 tool result（已过 `oneLine`），且**没有**触发任何动作（回路中本就无行动工具） |
| 7 | 内容超长窗口 | 读取侧按自身上限截断，**并如实报告已截断**（上限不依赖回路，见 §5.3） |
| 8 | 人类路径与模型路径一致 | 同一份内容，人类侧命令能看到**与模型相同的渲染**（§1.4 第 3 条先例） |

**回归测试纪律**：这些必须是**真正约束行为**的测试，而不是「跑通」。1 / 3 / 5 / 7 各自对应一条**会失败的路径**，缺一不可。

---

## §8 进入实现前需要 Human 裁决的问题

按尖锐程度排序。前三个我认为**必须在实现前**有答案。

1. **【架构守卫】内容读取插件是否可选？**
   若是 → 出现第二个独立可选能力 → 变体 2→4 → `src/language/exposure.ts:40-48` 记录的冻结守卫要求先做 **Composition Boundary Review**。若否（无条件加载，无论走路线 A 还是 B）→ 变体数不变，可按现有形态直接加一项。
   **这个问题不回答，就无法判断 §4.3 的路线 A/B 哪个更小。**

2. **【场景具名】第一片的「某个应用」具体是哪一个类别？**
   实测可达性是逐应用的（8 个里 1 个）。若不指定一个**期望可读**的具名类别，验收条件 1 无法判定成败。

3. **【数据边界】窗口正文发往 operator 指定的端点，是否需要新的用户授权 / 脱敏机制？**
   今天的代码里**一层都没有**（§6.2）。mandate §5 要求这一点「必须明确」。若答案是「需要」，则本轮从 NARROW 变为 BLOCKED——因为那是一个新的、跨领域的公共基础设施，超出「第一片」的范围。

4. **【上限】模型可见的内容上限取多少，由谁定义？**
   tool result 无上限是源码里写明的（§5.3），必须由读取侧施加。

5. **【所有权】内容采集属于 `desktop-session-awareness`，还是一个独立 owner？**（§4.3）

---

## §9 约束合规

| Mandate §5 约束 | 状态 |
| --- | --- |
| 本轮只做研究和设计，不修改生产代码 | ✅ 未改任何 `src/` / `apps/` 文件 |
| 不新增 Central Brain | ✅ 未建议 |
| 不新增 Global Desktop World | ✅ 内容**明确不进入** `desktop-session-world`（§4.2） |
| 不新增 Generic Sensory Bus | ✅ 未建议（§4.2） |
| 不新增通用模型路由器 | ✅ 未建议 |
| 不新增未经需求证明的 Experience / Memory 框架 | ✅ 未建议；明确不落盘（§4.2） |
| 不为支持视觉输入而提前重构 Language | ✅ 视觉路线本轮**排除**（§2.3） |
| 不得预设必须采用三种感知路线中的某一种 | ✅ 三路线分别评估，二、三明确排除并给出理由（§2.2 / §2.3） |
| 不得把整个桌面变成 GlobalWorldState | ✅ §4.2 显式禁止 |
| 若涉及截图或内容发送到远程模型，必须明确授权与数据边界 | ⚠️ **已指出为必须由 Human 裁决的缺口**（§6.2 / §8 问题 3），本轮未自行决定 |
| 不 commit、不 push | ✅ 未 commit、未 push |

---

## VERDICT

**NARROW**

- **可做**：路线一（UIA）在本机真实可用，读取延迟 ≈330 ms，**不需要改动模型传输层、不需要多模态、不需要重构 Language**。读取结果经既有的 exposure / tool-use 回路回到模型，**无需新机制**。
- **必须收窄**：
  1. 场景固定为「一个**具名可读**的应用类别」，同时把「读不到」纳入必测路径（实测 8 个应用中 6 个读不到）。
  2. 路线二（浏览器原生接口）与路线三（截图 + 视觉）本轮**排除**——前者无需求证明，后者被传输层与 mandate §5 双重挡住。
  3. 内容**不入 world、不落盘、不后台采集**，只做按需读取。
- **阻塞在 Human 裁决**：§8 的问题 1（架构守卫：是否触发 Composition Boundary Review）与问题 3（数据边界：是否需要新的授权 / 脱敏层）。**问题 3 若答「需要」，本轮的 NARROW 应改判 BLOCKED。**
- **NOT RUN**：对真实模型端点的端到端语义验证（本机不可达，§5.5）。此项**不得**记为 PASS。

---

## 附：本轮证据清单

**实测（本机，2026-10-09）**
- UIA 跨 8 应用能力调查：可达性 1/8；ControlView vs RawView 差异；各应用耗时
- UIA 路线延迟：裸启动 154 ms / +程序集 198 ms / +遍历 526 ms（各 4 轮中位数）
- `src/` 检索：无浏览器自动化、无截图、无注入过滤、无同意/隐私/脱敏

**源码锚点**
- `src/language/model.ts:186-194, 233-234, 475-480` —— 传输层仅字符串；tool result 无上限
- `src/language/exposure.ts:40-48, 114-131` —— 变体守卫；三项目录
- `src/language/read.ts:24-30, 139-140` —— owner 渲染 + `oneLine`
- `src/language/prompt.ts:43-44, 49-51` —— 低信任分层；注入失败模式
- `src/language/express.ts:95-98` —— `SYNTHESIS_LABEL`
- `src/desktop-session-awareness/{contracts,exposure,types}.ts` —— peek/current 与模型自述
- `src/foreground/{types,windows,acquisition}.ts` —— 三态可用性；PowerShell 采集形状；可注入 seam
- `src/repository-ci-relevance/contracts.ts:27-29` —— 无记忆的读取语义
- `src/cli/options.ts:52-55, 339-340` —— 端点无默认；tool calling 要求
- `src/cli/tui.ts:24-29` —— 不提供 `confirm`
- `src/cli/resident.ts:219-273` —— base roster

**文档先例**
- `docs/architecture/human-surface-v0-implementation-boundary-freeze.md:249, 275, 291, 359`
- `docs/development/current-stage.md:201`
- `docs/architecture/hikari-current.md:527`
