# HUMAN SURFACE v0 — IMPLEMENTATION BOUNDARY FREEZE

> 本轮的唯一产物是一句话的实现：**让 Human 不需要开一个 PowerShell 窗口等 Hikari 说话。**
>
> 本文是 R5 意义上的 **L2 产物**（Boundary Review + 明确 verdict），不是新的架构决定，不修改 `core-architecture-v0.md` / `principles.md`。它冻结的范围只到本 slice。

**VERDICT: L2 — LOCAL CONTRACT EVOLUTION（无 L3 trigger）→ 直接实现**

---

## 1. 选定技术栈

**.NET 8 WinForms，framework-dependent，零 NuGet 包。**

```text
apps/human-surface/HumanSurface/        WinExe, net8.0-windows, UseWindowsForms
apps/human-surface/HumanSurface.Core/   类库, net8.0,           无 WinForms 引用
apps/human-surface/HumanSurface.Tests/  控制台测试运行器, net8.0, 无测试框架包
```

**这行 TFM 是刻意的，不是随手写的**（本文件初稿曾把后两者写作 `net8.0-windows`，实现收敛时改成中性目标，此处更正）：`HumanSurface.Core` 不碰窗口、不碰托盘、不碰注册表——管道客户端与 JSON 解码都在 BCL 里——所以它和它的测试**能在仓库已有的 Linux runner 上构建并运行**。只有 `HumanSurface` 自己要 Windows，也只有它这么写。这条分层是 §16 双 job CI 成立的前提。

在本机实测的事实（不是推测）：

- `dotnet build` 一个 WinForms 工程**成功且全程没有取任何 NuGet 包**，用时约 5 秒（本机 SDK 8.0.422 / 10.0.302）。
- 本机已装 `Microsoft.WindowsDesktop.App 8.0.28`，framework-dependent 的 exe **不需要任何安装**即可运行。
- `System.Windows.Forms.NotifyIcon`（托盘）、`System.IO.Pipes.NamedPipeClientStream`（管道）、`System.Drawing`（图标）**全部在框架内**，没有一个第三方依赖。

## 2. 为什么不是其他主要候选

| 候选 | 否决理由 |
| --- | --- |
| **Electron** | 把一个 Chromium 运行时绑进一个**运行时依赖为零**的仓库——`package.json` 根本没有 `dependencies` 键，`node_modules` 只有 `@types` / `typescript` / `undici-types` 三个条目（已核）。§5.9 直接排除。 |
| **Tauri** | 需要 Rust 工具链 + WebView2 + bundler 三套东西，才能得到一个托盘图标。为一个托盘引入第二套编译工具链，复杂度最高。 |
| **WinUI 3 / Windows App SDK** | 需要 NuGet 包，且部署形状天然是 MSIX/打包身份——正是 §13 排除的东西，也是 §6 AUMID 问题的来源。 |
| **WPF** | 与 WinForms 同一个运行时，但对一个只有三个控件的窗口要引入 XAML 与 XAML 编译；换来的是零收益。 |
| **Node + 原生托盘绑定** | Node 自己没有窗口、没有通知、没有托盘，全部要原生模块；`systray2` 一类库自己还要附带一个 helper exe。等于用「加运行时依赖」换「少写 C#」。 |
| **PowerShell + WinForms** | 确实零构建，但**没有真实的测试载体**，调试与错误信息都更差。§19 要状态机测试、§23 要可重复验证——这两条直接否掉它。 |

## 3. Surface 是否独立进程（§3）

**是。Human Surface 不是 Runtime Plugin，本轮 Runtime 零 diff、`src/` 零 diff。**

第一手证据，不是照抄结论：

- Plugin 是 TS 模块，由 `Runtime.loadPlugin` 加载（`src/runtime/plugin.ts`）。WinForms 进程在结构上**无法**成为一个 Plugin。
- 一个「spawn GUI 的 Node Plugin」会让 Runtime 拥有 GUI 的生命周期——而 `src/human-delivery/plugin.ts` 逐字拒绝这种依赖：「A transport whose activation depended on a client would make a human's evening into a composition failure」。
- `src/cli/subscribe.ts` 逐字写着外部 client 模式已经成立：「the resident never knows who is listening」。**把 Surface 做成 Plugin 会是往常驻里增加知识**，方向与 §2 相反。
- `src/human-delivery/index.ts` 逐字说明它导出 framing 的理由就是「让 client 说同一种线格式」，并点名 `src/cli/subscribe.ts` 是那个 client。

→ Surface 是**管道的第二个外部 client**，与 `hikari subscribe` 同类。常驻甚至不知道它在。

## 4. Human Delivery 连接方式（§7 / §14）

- **沿用既有 Windows 命名管道，一个字节不改。** `src/human-delivery/**` 本轮 **0 diff**。
- 管道名由数据目录推导：`\\.\pipe\hikari-human-delivery-<sha256(canonical(rootDir).toLowerCase())[0..16]>`。Surface **必须给 `--data-dir`**（CLI 本来就要求它，没有默认值）。
- 路径规范化必须与 Node 的 `realpathSync.native` **逐字节一致**，否则管道名不同、Surface 永远连不上，而故障现象会指向管道。Surface 用 `CreateFileW(FILE_FLAG_BACKUP_SEMANTICS)` + `GetFinalPathNameByHandleW` 实现同一件事（这正是 `realpathSync.native` 的做法），目录不存在时回落到词法形式——与 `endpoint-path.ts` 的 `readCanonicalPath` 同构。
- **已在实现前实测过 parity**：六种拼写（大小写不同、尾部分隔符、`..` 段、不存在的目录、另一个盘）上，C# 推导与 `humanDeliveryEndpointPath` 输出**逐字相同**。这条 parity 会作为 conformance 测试留在仓库里。
- 单 client 语义不变；**不改 multi-subscriber**（§8）。

## 5. 是否需要抽 reusable subscribe client seam（§7）

**不需要，`src/` 保持 0 diff。** 理由不是偷懒，是 C# 进程无法 import TS：

- 真正共享的机制**已经**被抽出来了，就是 `src/human-delivery/protocol.ts`（framing）与 `endpoint-path.ts`（端点推导），而该 barrel 导出它们的原因逐字写在 `index.ts` 里。
- Surface 做的是**既有协议的第二个实现**，**不是第二套协议**：线格式、端点推导、长度上限（`MAX_DELIVERY_MESSAGE_LINE = 64 KiB`）、三个结局（`ended` / `absent` / `unavailable`）全部照既有定义。
- 代价是真的：`protocol.ts` 自己说过「the second one is the copy nobody re-reads when the first changes」。**对策是把它变成被检查的副本**，不是把它说成不存在：
  - conformance 测试：用**真实的 Node `encodeDelivery`** 产出字节，断言 C# 解码器接受；
  - endpoint-path parity 测试（上面 §4 的那六个用例）；
  - 反向：C# 编码、Node 解码。
- **不抽**：`HumanClientFramework` / `DeliverySDK` / `SurfaceBus` / `GenericIPC` / `UniversalTransport`。
- **`hikari subscribe` 一个字节不改**，它仍是 CLI 的 client（`src/cli/subscribe.ts` + `subscribe-command.ts` 的既有分工不动）。

## 6. tray 行为（§12）

最小菜单，三项：

```text
Hikari — 已连接        （禁用状态行）
打开
退出
```

- 状态行随连接状态在 `已连接` / `未连接` 之间变化，并带未读数。
- **「退出」只退出 Surface。** 不调 `hikari stop`，不碰 Resident，不改变 Runtime 生命周期。Surface 与 Resident 是两个生命周期。
- 托盘图标在运行时用 GDI+ **画出来**，不往仓库里加二进制 `.ico`。

## 7. notification / visible hint 方案（§6）

**不用 Windows Toast。用「NotifyIcon balloon tip + 可观测的托盘未读状态」。**

按 §6 要求重读了 `human-outbound-v0-boundary-review.md`（`grep AUMID` 命中 §7.1–§7.4），那里已经第一手测过：

- **Toast 必须显式传一个 AUMID**，无参调用失败；而本机能解析的那个 AUMID 归属于 `Windows PowerShell`——**身份是借来的**（§7.3(a)）。要署名 Hikari 就要一个指向自己的 Start 菜单快捷方式，也就是**一个安装器**。§13 排除安装器。
- **Toast 的送达失败是静默且结构性的**（§7.3(b)）：`Show()` 返回、exit 0、Action Center 历史里有记录，**三件事都不证明人看见了**；专注助手 / 每应用开关会静默抑制，**没有任何错误面**。

所以 v0 的选择是：

- **可见提示 = `NotifyIcon.ShowBalloonTip`**（shell 原生、不需要 AUMID、不需要安装器、不需要打包身份）。
- **同时始终改变托盘的可观测状态**：tooltip 变为 `Hikari — N 条未读`，窗口顶部显示同样的未读行；打开窗口即清零。这是**确定性**信号，不依赖通知是否被渲染。
- **诚实记录**：balloon 是否真的被渲染、是否被人看见，**本进程无法观测**（与 toast 同一个结构性限制）。因此不写「Human 看到了」，只写「平台收下了」。
- 不用 `ToastNotificationManager`；不建 installer / MSIX / release channel。

## 8. window 最小形状（§11）

一个 `Form`，三个部分：

```text
┌ Hikari ─────────────────────────────┐
│ 未连接 · 2 条未读                    │   ← 状态行（Surface chrome）
├─────────────────────────────────────┤
│ 收到 15:34:55                        │   ← Surface 本地接收时间，明确标注「收到」
│ Desktop return attention：           │
│   观察时间：…                        │
│   已观测到的无输入时长（下界）：…    │
│   触发时的关注对象：…                │   ← 逐行原样，只读、可选中复制
└─────────────────────────────────────┘
```

- 消息正文**逐行原样**，不总结、不润色、不加人格前缀、不加 domain label 解释。
- 时间**只**是 Surface 收到它的本地时间，标签写死「收到」，**不冒充 occurrence 时间**（occurrence 时间本来就在 Language 的正文里）。
- 关窗口 = `Hide()`，回托盘，**Surface 继续运行**。
- **不做**：Markdown 引擎、rich card、settings、plugin dashboard、Memory browser、Work Focus editor、聊天输入框、头像 / 动画、多标签。

UI chrome 用中文（`已连接` / `未连接` / `正在等待 Hikari…` / `打开` / `退出`），与仓库既有的面向人文本一致。这些是 **UI 状态词，不是 domain speech**。

## 9. reconnect 语义（§9）

Surface 本地状态机，只有两个状态与一条重试节奏：

```text
Disconnected ──尝试连接──▶ Connected
      ▲                        │
      └────────断开────────────┘
      重试节奏：1s → 2s → 4s → 8s → 上限 10s；连上即重置
```

- **不 spin、不崩 GUI、不积压离线消息、不假装断线期间的消息被收到。**
- **不要求 Human Delivery 增加 queue / history / retry**（它本轮 0 diff）。
- **Surface reconnect ≠ message retry。** 这是 transport availability，不是 delivery guarantee。
- 连接被判 `absent` 与 `ended` **都**回到 Disconnected 并重试；`unavailable`（例如第二个订阅者被服务端销毁、或帧不可解析）同样回到 Disconnected，**Surface 不退出**。

## 10. transient message list（§10）

```text
owner      = Human Surface
lifetime   = Surface 进程
durability = none
bound      = 有界（最近的 N 条，超出丢最旧）
```

- **不 durable、不落盘、不写 Chronicle、不叫 Memory、不叫 Conversation History、不引入数据库。**
- Surface 退出即丢；Resident 重启不恢复；重连**不伪造**断线期间的消息。

## 11. lifecycle ownership

| 东西 | owner | 生命周期 |
| --- | --- | --- |
| Surface 进程 | Human（手工启动，§13） | 到人点「退出」为止 |
| 托盘图标 / 窗口 | Surface | 同进程 |
| 消息列表 | Surface | 同进程 |
| 连接 | Surface | 随 Resident 起落 |
| Resident / Runtime | 不变 | 与 Surface **无关** |

§13：不要求 Windows Service、installer、MSIX、开机自启、self update、release channel。**手工启动 exe**。后续真实日常使用证明需要 auto-start 再说。

## 12. explicit non-goals

- 不做 Human → Hikari 对话（v0 只有 Hikari → Human）。
- 不做显著性 / 重要性 / 是否该通知的判断——Surface **不是 judgement owner**。
- 不改写 Language 输出；不重解释 occurrence；不读 repository / input activity / Work Focus；不订阅任何 domain plugin；不调模型。
- 不建 Salience / Presence / Memory / Chronicle reader。
- 不改 Human Delivery 语义，不改 Runtime，不改任何 domain plugin。
- 不把单 client 改成 multi-client。
- 不建 installer / identity / release infrastructure。
- 不为 GUI 建第二套 delivery protocol。

## 13. 为什么是 Level 1 / Level 2

按 R4 四问（`governance-rules-v1.md`）：Q1 新问题？**否**。Q2 在备选之间选择？**否**。Q3 需要解释未封闭词表并升成全局语义？**否**。Q4 决定人类与 source 都没给出的事？**否**。

四条全否 ⇒ **capability growth**。

但 R5 的 L2 触发里有一条命中：**「给既有 contract 加 consumer」**——Surface 是投递管道这一既有边界的**新 consumer**，且它落在 `src/` 之外、跨语言。因此本轮按 **L2** 处理，产物就是本文。

## 14. 是否存在 Level 3 trigger（§17）

逐条对照，**全部为否**：

| L3 判据 | 本 slice |
| --- | --- |
| 修改 Runtime public API | **否**，Runtime 0 diff |
| 新 communication plane | **否**，连的是既有管道 |
| Human Delivery 语义需要重写 | **否**，0 diff |
| multi-subscriber 需要成为公共机制 | **否**，单 client 不变（§8） |
| installer / identity 成为必需架构前提 | **否**，正因如此否掉 Toast 与 MSIX |
| Surface 需要开始理解 domain semantics | **否** |
| Surface 需要获得 judgement / speaking ownership | **否** |

**没有 L3 trigger ⇒ 直接实现，不等待 Human 二次批准。**

---

## 15. 真实 Windows E2E 记录（§20）

**在真机上一次连续跑完 §20 的十二步，不是分步拼出来的。** 数据目录 `%TEMP%\hikari-surface-e2e`，端点 `\\.\pipe\hikari-human-delivery-99f7b5a7ca1fe881`。

### 15.1 进程形态

三样东西，三个进程，各自独立：

| 进程 | PID | 启动方式 |
| --- | --- | --- |
| Hikari 常驻 | 38292 | `hikari resident --data-dir … --desktop-awareness-delay-ms …` 加主动播报参数（起之前先跑一次 `hikari start` 做 init 预检） |
| Human Surface | 31068 | 手工起 `HumanSurface.exe --data-dir …` |
| (假模型端点) | 46072 | 本机 loopback，仅因 `--proactive-return-after-ms` 强制要求 `--model-endpoint` 而存在 |

> **一处容易写错的用法，记下来**：`hikari start` **不是**启动常驻——它只做 init / chronicle 预检，且**不接受** `--desktop-awareness-delay-ms` 一类的组合参数。常驻是 `hikari resident`。把它写成 `hikari start` 会得到一个「未知参数」的用法错误，而那个错误看起来像配置问题。

Surface **不被常驻启动、不被常驻感知、不被常驻终止**。常驻侧没有任何一行代码知道它在。

### 15.2 十二步的连接状态变化（真实观测值）

| 步骤 | 动作 | Surface 状态行实际观测值 |
| --- | --- | --- |
| 1 | Resident 未启动 | — |
| 2 | 起 Surface | 窗口可见 |
| 3 | | `未连接 · 正在等待 Hikari…` |
| 4 | 起带主动能力的 Resident | — |
| 5 | | `已连接`（轮询 **46 ms** 内命中） |
| 6 | 真实输入活动发生（真 `GetLastInputInfo`，silence 63687 ms → 125 ms） | — |
| 7 | | `已连接 · 1 条未读`（事件后 **908 ms** 内） |
| 8 | 全程**没有** `hikari subscribe` 在跑 | — |
| 9 | `hikari stop` | 立刻 `未连接 · 正在等待 Hikari…`，**进程存活**，transcript 保留（2 条） |
| 10 | 重新起 Resident | `已连接 · 2 条未读`，约 **1407 ms** |
| 11 | 经托盘菜单「退出」 | Surface 进程退出 |
| 12 | | Resident 38292 **仍在运行**，`hikari status` 全部 13 个插件 `active` |

步骤 6 的触发不是合成事件：走的是 `input-activity.windows` 的既有采集路径（`user32!GetLastInputInfo`），探针只做了一次**零位移**鼠标移动（`mouse_event(0x0001,0,0,0,0)`，不按键、不点按、指针不动）。

### 15.3 逐字比对：Surface 显示的 == Human Delivery 的 payload

这是 §20 唯一一条不能用「看起来对」敷衍的检查，因此两侧都取了原始字符。

**Surface 侧**（UI Automation `TextPattern.DocumentRange.GetText(-1)`，唯一能跨进程读 edit control 的方式）：

```text
收到 11:31:25
Desktop return attention：
  观察时间：2026-09-29T03:31:25.784Z
  已观测到的无输入时长（下界）：63797 ms
  触发时的关注对象：
    hikari-new
```

**`hikari subscribe` 侧**（同一管道上的原始帧，`JSON.stringify` 后的字节）：

```text
"Desktop return attention：\n  观察时间：2026-09-29T03:30:11.168Z\n  已观测到的无输入时长（下界）：52890 ms\n  触发时的关注对象：\n    hikari-new\n\n"
```

**逐行逐字相同。** 只有两处差异，两处都是 Surface 自己的 chrome，不是对正文的改写：

1. Surface 在每条消息前加一行 `收到 HH:mm:ss`——即 §8 冻结的那个本地接收时间标签，它**不冒充** occurrence 时间（occurrence 时间本来就在正文里）。
2. 行分隔符：Surface 窗口里是 `\r\n`（见 §15.4），管道上是 `\n`。

正文本身**零改动**：没有总结、没有润色、没有加人格前缀、没有加 domain label 解释。

### 15.4 本轮实机撞出来的唯一缺陷：LF 在这个控件里不是换行

**它不是猜的，是量出来的。** 窗口里 transcript 渲染成整整一段没有换行（截图证据），源码看上去完全正确。用 `EM_GETLINECOUNT` 对同一段三行文本实测：

| 分隔符 | `EM_GETLINECOUNT` |
| --- | --- |
| `\n` | **1** |
| `\r\n` | **3** |
| `\r` | **1** |

Windows 的 edit control **只在 `\r` / `\r\n` 处断行**，裸 `\n` 被当作普通字符。治法落在 `SurfaceChrome.Transcript`（`NewLine = "\r\n"`），且刻意**落在构建该控件文本的那一处**，而不是落在 session 交给它的 snapshot 里——行分隔符是**这个控件**的要求，不是消息的性质。

### 15.5 假模型端点收到 **0 个请求**

`model-requests.jsonl` 为空（0 字节）。desktop-return 的消息由 Language plugin 的 `desktop-return-speaking@1` **确定性渲染**（`renderSpokenReturn`），**不是模型产出**。配置上必须给 `--model-endpoint`，但整个 E2E **没有连过任何外部服务**。

### 15.6 托盘

托盘菜单三项，实际读到的是 `已连接`（禁用状态行）/ `打开` / `退出`。「退出」经 UI Automation 的 `InvokePattern` 触发——**与会用鼠标的人走的是同一条路径**，不是 `Stop-Process`。

> 托盘图标本身**不在** UIA 树里（Explorer 只在溢出浮出层里实体化它），因此菜单是从 `NotifyIcon` 持有的窗口上按 shell 的方式打开的：PostMessage `WM_USER+1024` / lParam `WM_RBUTTONUP`。

### 15.7 一条不可观测的东西，照 §7 记下来

**balloon 是否真的被渲染、是否被人看见，本进程无法观测。** 因此本节不写「Human 看到了提示」，只写**平台收下了**。可见提示的**确定性**那一半是托盘 tooltip 与窗口未读行——它们不依赖通知有没有被渲染。

---

## 16. CI（§23）

`.github/workflows/runtime-tests.yml` 由单 job 改为双 job：

- **`test`（ubuntu-latest）**：`npm test` + `dotnet run --project apps/human-surface/HumanSurface.Tests`。C# 侧之所以能在这里跑，是因为分层是按「需不需要 Windows」切的：`HumanSurface.Core` 与它的测试**不碰窗口、不碰注册表**。
- **`surface`（windows-latest）**：`npm run build` → `dotnet build HumanSurface.csproj` → `dotnet run --project HumanSurface.Tests`。**WinForms shell 只能在 Windows 上构建，而一个只在作者机器上发生过的构建不算已知能工作的构建。** 这个 job 同时是那些 Windows-only 用例（kernel32、命名管道、真实的 TypeScript 解码器）**停止 self-skip 并真正执行**的地方。

**「CI 不跑 Surface」不是完成状态**，因此第二点不是可选：至少有一种可重复验证 Surface 构建的方式，而现在有两种（CI 的 windows job，与本机跑**同一条**命令）。

两条命令在本机与 Linux 上都实跑过，不是照抄。**两次 CI 实跑的读数也在表里**——CI 是这个 workflow 真正的执行者，它的数字比本机复现更有分量：

| 环境 | 结果 |
| --- | --- |
| **CI `surface`（windows-latest）**，run `36518505311` | `Build succeeded.` + **38 passed / 0 failed / 0 skipped** |
| **CI `test`（ubuntu-latest）**，同一 run | Node 侧 655 tests / 563 pass / **0 fail** / **92 skipped**；C# 侧 **28 passed / 0 failed / 10 skipped** |
| 本机 Windows | **38 passed / 0 failed / 0 skipped**（与 CI 逐字相同） |
| Linux（WSL，.NET 8.0.425，暂存副本实跑） | **28 passed / 0 failed / 10 skipped**（每个 skip 带书面理由） |
| 本机 Node 侧 `npm test` | 655 tests / 651 pass / **0 fail** / 4 skipped（三个 `*.live.test.mjs`，需真实模型端点） |

**同一份 Node 套件在两处跳过的数量不同（本机 4，CI Linux 92），这不是不一致，是同一套 skip 规则在两个平台上各自生效**：那 88 个差额是命名管道相关的用例——它们在本机真的跑，在 Linux 上 skip 并写明理由。`pass` 数随之从 651 降到 563，而 `fail` 两边都是 **0**。

Linux 侧被跳过的是真的需要 Windows 的东西——命名管道端点的四个 live 用例、端点推导的路径用例——它们**说得出自己为什么被跳过**，而不是静默消失。CI 的 `surface` job 正是这些用例**停止 self-skip 并真正执行**的地方，所以它与 `test` job 不是重复劳动：两个 job 合起来才是「38 个全部真的跑过」，其中任何一个单独都不足以这么说。

## 17. Functional Review（§21）

逐条对任务书 §21 的七项，**每一条都给证据，不给印象**。

| # | 判据 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 人类不再需要 PowerShell `subscribe` | **通过** | §15.2 步骤 8：整个 E2E 期间**没有任何** `hikari subscribe` 在跑，消息仍然完整抵达窗口。单订阅者语义下这本身就是证明——管道只有一个订阅位，消息出现在 Surface 上就说明占据它的是 Surface。 |
| 2 | Surface 独立长期运行 | **通过（有量程，不夸大）** | 全程独立于任何终端窗口存活，跨过 resident 的停止与重启。**量程分两段报**：§15 的 E2E 连续跑约 6 分钟；soak 另计（§17.1）——连续驻留约 **14 分钟**，其中含 **12 次** resident 停/起重连循环，**12/12 次 Surface 均未退出**，句柄在预热后走平。**不把 6 分钟说成长期，也不把 14 分钟说成长期**：本条的强度来自**重复压力下的行为**，不来自时长。 |
| 3 | Resident / Surface 生命周期独立 | **通过** | 步骤 9：`hikari stop` 之后 Surface **进程存活**；步骤 12：Surface 退出之后 resident **仍在运行**，13 个插件仍 `active`。「退出」只调 `ExitThread()`，源码里**没有**任何通往 `hikari stop` / Runtime 的路径（`TrayApplication.Quit`）。 |
| 4 | 重连可用 | **通过** | 步骤 10：新 resident 进程起来到 Surface 报 `已连接 · 2 条未读` 约 **1407 ms**。节奏 1→2→4→8→10s 有单元测试逐级钉住。 |
| 5 | 消息不被改写 | **通过** | §15.3 的逐字比对。附加的只有一行 `收到 HH:mm:ss` 与行分隔符，正文零改动。`SurfaceChrome` 这个文件存在的唯一目的就是让「这个程序被允许断言的每一个字」可以被一眼读完。 |
| 6 | 无隐含持久化 / 无隐藏队列 | **通过** | 见 §17.2 的结构证明。 |
| 7 | GUI 不成为领域所有者 | **通过** | `SurfaceSession` 只存「交给它的行」并报告它们到了——不解析内容、不判断显著性与否、不决定是否打断（这一条逐字写在它的类注释里，且是行为：`Accept` 除了记时间与计数什么也不做）。全部可断言的词集中在 `SurfaceChrome`，且全部是**接口状态词**（连没连上、这个进程几点读到的），没有一句是关于世界的。 |

### 17.1 关于「长期运行」，与 soak

**不把 6 分钟说成「长期」。** 因此本轮另起了一次 soak（`soak-start.ps1`）并让它自己跑：Surface 进程 `3288`、启动于 `2026-09-29T11:40:18+08:00`、停止于约 `11:54`，**连续驻留约 14 分钟**；resident 带 `--proactive-return-after-ms 20000`，另有一个后台采样器每 30s 记一次驻留资源（共 14 个样本）。

**结构上**它是无界的：消息列表 200 条封顶（`MessageLimit`），transcript 每次从快照整体重建（不追加、不累积），重连循环每次迭代只做一次连接尝试再加一个上限 10s 的等待。**「结构上有界」与「实测跑了多久」是两件事，本节不混写。**

#### 光坐着不够，因此加了重连循环

只待在「已连接」稳态的 soak 测不到最该测的东西：**重连路径才是句柄、定时器、socket 会累积的地方**，也正是人每次重启 Hikari 都会走的路径。因此本轮额外做了 **12 次「停掉 resident → 7 秒后重启」循环**（`soak-cycle.ps1`，只按**这一轮自己起的确切 PID** 停止，绝不用名称或通配匹配）。

| 循环 | Surface 状态 | 内存 (MB) | handles | threads |
| --- | --- | --- | --- | --- |
| 起 | UP | 55.8 | 360 | 10 |
| 1–4 次重连后 | UP ×4 | 56.4 → 59.6 | 371 → 379 | 13–14 |
| 5–12 次重连后 | UP ×8 | 56.6 → 60.6（震荡） | **375 → 379（走平）** | 13–17 |

**结论有两条，第二条比第一条重要：**

1. **12/12 次循环 Surface 从未退出。** 每次 resident 消失它都如实显示未连接，每次新 resident 起来它都自己爬回已连接。这是「两个生命周期互不拥有」在**重复**压力下而不只是一次之下的读数。
2. **前 4 次的 handle 增长（360→379，约 +4.75/次）是预热，不是泄漏**——第 5 到第 12 次循环里它在 **375–379 之间震荡、不再单调上升**，内存同样从「爬升」变成「在 56.6–60.6 MB 之间震荡」。**如果当时只看前 4 个样本就下结论，得到的是相反的答案。** 这正是 soak 存在的理由，也说明为什么 4 个样本不足以宣称趋势。

**但本节不宣称「没有泄漏」，因为 14 分钟不够。** 稳态采样那 14 个样本的 handle 序列是 `351 → 357 → 357 → 357 → 371 → 360 → 360 → 360 → 378 → 378 → 378 → 375 → 370 → 402`：**全程在 351–402 之间震荡，没有单调上升**，但 402 这个末值是采样里最高的一个，且它出现在我跑过几次 UIA 探针之后（跨进程 UI Automation 查询本身会在目标进程里产生窗口消息与句柄）。**「12 次重连不累积」是测出来的；「长时间绝不泄漏」不是。** 后者需要一个以小时计的 soak，本轮没有做，也不假装做过。

**顺带钉住的一条**：12 次重连之后未读数仍然是 **2**——**重连没有重放任何消息**。resident 每次是全新进程，未读没有翻倍，`reconnect ≠ message retry` 在重复压力下依然成立。整个 soak 期间假模型端点**仍然是 0 字节**。

那两条消息本身也值得看，因为它们把「重连不重放」从计数变成了内容。soak 结束时从窗口里读出的 transcript（UIA `TextPattern`，逐字）：

```text
收到 11:45:06
Desktop return attention：
  观察时间：2026-09-29T03:45:06.360Z
  已观测到的无输入时长（下界）：296406 ms
  触发时的关注对象：
    hikari-new

收到 11:47:56
Desktop return attention：
  观察时间：2026-09-29T03:47:56.037Z
  已观测到的无输入时长（下界）：163219 ms
  触发时的关注对象：
    hikari-new
```

**两条不是同一条的重放**：下界一个是 296406 ms、一个是 163219 ms，是两次真实的独立观测。第二条落在 soak 开始后约 **7.6 分钟**，不是启动瞬间的产物。**这些字符也顺带在 soak 里第二次验证了 §15.4 的 LF/CRLF 修复**——窗口里是断行正常的四行正文，不是一整段。正文与 `SurfaceChrome` 之外的东西**一个字都没被改过**。

### 17.2 「无持久化」的结构证明

不是「我没看到写文件」，是**整个 surface 的源码里只有一处 IO，就是那根管道**：

```text
$ grep -rn "System\.IO\|File\.\|Directory\.\|Registry\|Process\.\|HttpClient\|Socket\|Environment\." \
    --include=*.cs HumanSurface HumanSurface.Core
HumanSurface.Core/DeliveryEndpointPath.cs:43:  ...NamedPipeClientStream...（注释）
HumanSurface.Core/PipeDeliveryConnector.cs:1:  using System.IO.Pipes;
```

没有 `File`、没有注册表、没有环境变量读取、不 spawn 进程、没有 HTTP 客户端。**它没有能力持久化任何东西**——这比「它选择不持久化」强，因为后者是一条要记得遵守的规则。

队列那一半在**服务端**：`src/human-delivery/**` 本轮 **0 diff**，单个订阅者按字面强制，`write` 在无人连接时返回 `unavailable`。步骤 10 顺带证明了「重连不重放」：未读数停在 2，没有补投。

### 17.3 一条**不可观测**，因此不作为通过项

**托盘 balloon 是否真的被渲染、是否被人看见，本进程无法观测**（§7 已定：只写「平台收下了」）。因此第 5 条判据的通过依据是**窗口里的字符**，不是 balloon。「可见提示」的确定性那一半是托盘 tooltip 与窗口未读行——它不依赖通知有没有被渲染。

## 18. Architecture Sanity Check（§22）

只报告**真实的边界差异**，逐项对照。

| # | 判据 | 结论 |
| --- | --- | --- |
| 1 | Runtime 零领域差异 | **成立**。`git diff --stat -- src/` 为空（含 `src/runtime/`）；Surface 不是 Plugin、不 import 任何 TS、常驻不知道它存在。 |
| 2 | Human Delivery 仍仅传输 | **成立**。`src/human-delivery/**` 0 diff。没有为 Surface 加队列、历史、重试、多订阅者，也没有加任何 Surface 专属分支。 |
| 3 | Language 仍拥有最终自然语言 | **成立**。Surface 逐行原样显示 `speak()` 的产出，不做模板、不加前缀、不重新断句。它**没有**能力改写——它收到的已经是字符串数组。 |
| 4 | Surface 仅是「人类客户」 | **成立**。与 `hikari subscribe` 同类：管道的第二个外部 client。它 `provides` 不了任何东西，因为它在 Runtime 之外。 |
| 5 | 无新中心对象 | **成立**。新增类型全部是 Surface 进程私有的本地类型（`SurfaceSession` / `SurfaceSnapshot` / `SurfaceMessage`），没有一个进入 Runtime、没有一个跨模块共享。 |
| 6 | 无第二传输真相源 | **成立，但代价是真的**——见 §18.1。 |
| 7 | 无过早的多客户端框架 | **成立**。没有 `HumanClientFramework` / `DeliverySDK` / `SurfaceBus` / `GenericIPC` / `UniversalTransport`；Surface 直接实现既有线格式。单订阅者语义未动。 |
| 8 | 未进入 Memory / Salience / Presence | **成立**。不读 Chronicle、不写 Chronicle、不接触 Work Focus、不判断重要性、不判断该不该打断——`SurfaceSession` 里没有任何一个字段可以承载判断，`Accept` 的全部动作是记时间、入队、计数。 |
| 9 | 无无根据的安装程序 / 发布基础设施 | **成立**。不做 MSIX、不做 installer、不做 AUMID、不做 auto-start、不做 release channel、不做 self-update。零 NuGet（`grep PackageReference` 三个 csproj 全空）。手工起一个 exe，就是全部。 |
| 10 | **不因为加了 GUI 项目就自动升级 Architecture Review** | **不升级**。本轮仍按 **L2**（§13/§14）处理，产物就是本文。加了一个 C# 项目不是 L3 trigger——trigger 问的是「有没有碰到 Runtime public API / 新 communication plane / 跨 Runtime / 新全局状态中心 / 难撤回的 public contract」，逐条仍为否。 |

### 18.1 第 6 条的真实代价，写清楚而不是绕过去

`DeliveryFraming`（C#）是 `protocol.ts`（TS）的**第二份实现**——不是第二套协议，是同一个协议的第二个解码器。**这一点不能靠措辞变成免费**：`protocol.ts` 自己逐字写下了这个代价——「a client that wrote its own decoder would be a second statement of what this pipe means, and **the second one is the copy nobody re-reads when the first changes**」。一个 .NET 进程确实 import 不了 TS，所以这一份必须存在；能做的是**让它成为被检查的副本**：

1. **前向**：conformance 测试用**真实的 Node `encodeDelivery`**（从 `dist/` import，即上线行为而非重述）产出的字节喂给 C# 解码器，断言它接受。
2. **反向差分**：同一份 helper 输出 **15 条** Node 的 `decodeDelivery` 判定（含 `[1,2]` / `["ok",null]` 这类宽松解码器会接受的、`'  ["padded"]  '` 这类边界、`'["unterminated"'` / `''` / `'null'` 这类非帧），C# 必须**接受与拒绝得一模一样**。
3. **端点推导**：6 种拼写（大小写、尾部分隔符、`..` 段、两个不存在的目录）两侧逐字相同。

**残余风险照实说**：(a) C# 只实现了**读**的一半，因为 Surface 从不写管道——一条没人调用的编码器是穿着对称外衣的死代码；(b) conformance 的用例表是**有限枚举**，TS 侧若改变 framing 且新行为落在枚举之外，这些测试不会红。**第 (b) 条没有对症的治法**（治法会是「让 C# 去读 TS 的测试用例表」，那本身就是一条新的跨语言构建依赖），因此它是记录在案的残余风险，不是已修项。

### 18.2 GitNexus：一次**自己的**误判，与更正后的真实读数

**本节初稿写错过一次，原样留下更正，因为它正好是仓库纪律警告的那种错误。**

初稿写的是：「`apps/human-surface/**` 不在图内——索引覆盖的是 TS 仓库，`apps/` 是一个未被索引的新目录。实测 `context({name: "TrayApplication"})` 返回 `Symbol 'TrayApplication' not found`」，并据此断定 GitNexus 对本轮**不可答**。

**那条推断是错的。** 真正的原因是**索引自 `494de2b` 之后就没再重建过**，而 `apps/human-surface/**` 是那之后才出现的目录——它不是「图看不见 C#」，是「图还没被要求看」。`analyze --index-only` 重建之后（`added=29`）：

```text
context({name: "TrayApplication", repo: "hikari-new"})
  status: "found"
  uid: Class:apps/human-surface/HumanSurface/TrayApplication.cs:TrayApplication
  epistemic: "exact"
```

**把这处错误记下来的价值大于抹掉它**：CLAUDE.md 的纪律是「空结果不是证据」，而这次错的正是我自己——把一个**过期索引的静默**读成了**工具的结论**，再在上面盖了一条结构性判断。这和「`risk: UNKNOWN` 不许当成安全」是同一条纪律的两种写法。

更正后，索引覆盖 `apps/human-surface` 全部 **32 条路径**（每个 `.cs`、两个 `.csproj`、两个 `.mjs` helper），共 **245 个 symbol**。于是 §22 的边界主张第一次**有图可查**：

**查法一：两个方向都查跨目录边。** 之所以两个方向都查，是因为只查一个方向时「空」可能只是「查反了」：

```text
MATCH (a)-[r]->(b) WHERE a.filePath STARTS WITH 'apps/human-surface'
                      AND b.filePath STARTS WITH 'src/'      → []

MATCH (a)-[r]->(b) WHERE a.filePath STARTS WITH 'src/'
                      AND b.filePath STARTS WITH 'apps/'      → []
```

**这个「空」是非空洞的**：apps 那一侧有 245 个 symbol 垫底，不是「没有节点所以没有边」。图里**两个方向都没有任何一条边**跨过 `apps/ ↔ src/`。

**查法二：`Quit` 的 upstream。** §22 第 3 条说「退出没有通往 `hikari stop` 的路径」，这可以直接查：

```text
impact({target: "Quit", file_path: "…/TrayApplication.cs", direction: "upstream", includeTests: true})
  impactedCount: 2   risk: LOW   epistemic: "exact"
  d1: TrayApplication 构造函数
  d2: Program.Main
  affected_processes: [Main]
  affected_modules:   [HumanSurface.Tests] （indirect）
```

**`Quit` 的全部上游都在 `apps/` 内部**，两步就到顶（构造函数 → `Main`），没有任何一条走出去。这是图对「Surface 关不掉常驻」这条架构主张的直接支持，而不是本文件的自述。

**图到此为止，剩下的它查不到，必须说清楚。** 图看见的是 calls / imports。而 Surface 与 Runtime 之间**真实的耦合是一根命名管道的路径字符串**——一个 .NET 进程 `new NamedPipeClientStream` 到某个拼出来的名字。**这种耦合静态图本来就看不见**，所以「0 条边」支持的是「没有代码级耦合」，**不能**独自支持「没有运行期耦合」。后者由另外两条证据承担：§17.2 的源码级结构证明（整个 surface 只有一处 IO），以及 §15 的十二步真机 E2E（常驻停了、Surface 不知道）。**三条证据各管一段，不互相冒充。**

`detect_changes({scope: "all"})`（`partial` / `truncated` 均**未**置位，即干净运行）：

```text
changed_count: 12   affected_count: 0   changed_files: 2   risk_level: low
changed_symbols: 全部是 Section —— human-surface-v0-…-freeze.md 与 current-stage.md
affected_processes: []
```

这一次它看到的是**文档**，changed symbol **全是 markdown Section，没有一个是代码 symbol**。（`changed_count` 就是本文件自己的 Section 数，因此它随本文件的编辑而变——这也是为什么这里只写它的**性质**，不把某个具体数字当成稳定事实。）`apps/` 的源码此时已经干净地落在 `8e143fe` 里，所以不出现在 diff 中是**对的**，不是又一次「看不到」——**同一次运行里既验证了「看得到」也验证了「这次确实没有代码改动」**。

---

## 附录：本轮实测到的、写进本文的事实

本文里每一句「实测」都可以在这张表里找到它的来源。**没进这张表的东西，就是没测过的东西**——不靠措辞补。

| 事实 | 怎么来的 |
| --- | --- |
| `package.json` 没有 `dependencies` 键；`node_modules` 只有 3 个条目 | 直接读 |
| 零 NuGet 的 WinForms 工程能构建（~5s） | 本机跑了一次 hello-world 探针 |
| `Microsoft.WindowsDesktop.App 8.0.28` 已安装 | `dotnet --list-runtimes` |
| C# 端点推导与 Node 在 6 种拼写下逐字相同 | 两侧各跑一次 probe 并对比输出 |
| 第二个 subscriber 会被服务端当场销毁 | 读 `endpoint.ts`（`if (client !== undefined) socket.destroy()`） |
| `write` 在无人连接时返回 `unavailable`，无队列 | 读 `endpoint.ts` |
| CI 曾完全是 `ubuntu-latest`、不含 Windows runner | 读 `.github/workflows/runtime-tests.yml`（**本轮已改为双 job**，见 §16） |
| edit control 只在 `\r` / `\r\n` 断行 | `EM_GETLINECOUNT`：`\n`→1、`\r\n`→3、`\r`→1 |
| `GetWindowTextW` **无法**跨进程读 edit control（返回空串），static 可以 | 探针两种控件各读一次，对照 |
| desktop-return 的正文不是模型产出 | 假端点 `model-requests.jsonl` 0 字节，而消息完整到达 |
| `apps/human-surface` 的 **32 条路径 / 245 个 symbol** 在图里 | `analyze --index-only` 后查图（§18.2） |
| `apps/ ↔ src/` **两个方向都没有边** | 两个方向的 `MATCH (a)-[r]->(b) … STARTS WITH …` 均为 `[]` |
| 12 次重连循环句柄走平（375–379） | `soak-cycle.ps1` 逐次采样，**前 4 个样本给的答案与后 8 个相反** |
| soak 里两条消息不是重放 | 从窗口 UIA 读出正文，两次「无输入时长下界」不同（§17.1） |
