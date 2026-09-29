# HIKARI TUI v1 — UNIFIED DAILY SURFACE — IMPLEMENTATION BOUNDARY FREEZE

状态：**FROZEN**（2026-09-30）

上游：`operator-tui-v0-implementation-boundary-freeze.md`（该文件仍然有效，本文件不推翻它的任何结论）
治理依据：`governance-rules-v1.md`
架构底线：`principles.md`、`core-architecture-v0.md`

---

## 1. 级别判定（Governance v1 R4 → R5）

**结论：L1（实现评审）。不修改 `core-architecture-v0.md` / `principles.md`。**

R4 四问，逐条：

| # | 问题 | 判定 | 依据 |
| --- | --- | --- | --- |
| Q1 | 让某个 owner 开始回答它今天不回答的**问题**吗？ | **否** | TUI 不是 owner，是 client。它**没有**算出任何 source 未报告过的新量、新单位、新轴 —— 四种语气、三个 endpoint 的结局词全部是协议里已有的字段 |
| Q2 | 在备选项之间做**选择**吗？ | **否** | 不排序、不评分、不挑「最重要的」。`/status` 原样转述常驻自己写的句子；`/restart` 是操作者下达的动作，不是 TUI 在候选之间裁决 |
| Q3 | 需要解释**上游刻意不封闭的词表**并升成全局语义吗？ | **否** | 反向要求写进了 §5.3 与下面的 §6：把 status 人类文本反解析成结构化事实**被明确禁止** |
| Q4 | 必须决定一件**人类与 source 都没给出**的事吗？ | **否** | `/clear` 的清空范围由 Human 裁决；颜色由协议 `outcome` 字段决定；transcript 上限是本地内存边界，不是产品语义阈值 |

### 1.1 L3 trigger 逐条检查：全部不成立

| L3 判据（`CLAUDE.md` 架构级 / R2 MUST） | 判定 |
| --- | --- |
| Runtime public API | 不触碰。TUI 在 `src/cli/`，Runtime 不认识它 |
| 新 communication plane | **没有**。零新增 wire protocol、零新增 frame、零新增 endpoint。TUI 是三个既有 endpoint 的 client |
| 跨 Runtime | 没有 |
| Memory / Goal / Action 核心语义 | 没有。见 §7 的 transcript 命名纪律 |
| 新全局状态中心 | 没有。transcript 是进程内的，不落盘、不共享、不叫 Memory |
| 新公共基础设施 | 没有 |
| 难撤回的 public contract | 没有。slash 词表是闭集且本地，撤回成本是删几行 |

### 1.2 R5 的另一条触发（「给既有 contract 加 consumer」）也不成立

这是本 slice 唯一值得当场排除的一条，因为它看起来像。

TUI 新增的**不是** contract 的 consumer，是既有 **client 函数**的 caller：

- `requestLanguageAsk`（`ask.ts`）——已经被 `ask-command.ts` 调用
- `requestControl`（`control.ts`）——已经被 `control-command.ts` 与 console 调用
- `subscribeToHumanDelivery`（`subscribe.ts`）——已经被 `subscribe-command.ts` 调用
- `readLaunchProfile` / `launchArguments` / `spawnDetached` —— v0 的 console 已经在用

契约（wire vocabulary）的 consumer 一个字节没有增加：说这些话的人还是那几个 `*-command.ts` 和 console，TUI 只是又有一个地方调用了它们。所以走 L1，不是 L2。

**唯一一个真的需要写下来、且属于产品限制而非边界移动的事实**，是 Human Delivery 的 single-subscriber（§8）。

---

## 2. 组合的是什么：三句话

```
Chat      → 既有 Language endpoint        → reuse `requestLanguageAsk`
System    → 既有 Resident control endpoint → reuse `requestControl`
Start/Restart → 既有 Launch Profile        → reuse `launchArguments` + `spawnDetached`
Proactive → 既有 Human Delivery endpoint   → reuse `subscribeToHumanDelivery`
```

**统一的是 UI，不是协议。** 本 slice **不创建**：Unified Hikari Backend、Generic Human Input、Universal Message、central router、Runtime service locator、Plugin manager、structured health system、第二事实来源、multi-subscriber delivery、新通信平面。

---

## 3. 产品身份变更

`Hikari 操作台` → **`Hikari`**。日常主界面不再自称 Operator Console。

**不删除、不改语义**：`hikari status` / `hikari ask` / `hikari focus` / `hikari subscribe` / `hikari observe` / `hikari profile *` 全部照旧。Human Surface 照旧，本 slice 一个字节不碰它。

**operator semantics 保留**：启动 / 停止 / 刷新 / 看状态仍然是 TUI 的能力，只是从单键搬进了 System view + slash command。v0 的 `[s] [x] [r] [q]` 单键表**取消**——理由是可执行的，不是审美：Chat 是默认 view，`s`/`x`/`q` 必须是可输入字符。

---

## 4. 三个 view 与 header

| View | 内容 |
| --- | --- |
| **Chat**（默认） | transcript + 单行输入区 |
| **System** | 常驻 high-level outcome + status lines 原样 + start / stop / restart |
| **Profile** | 现有 Launch Profile 的 typed 字段 |

`Tab` 循环切换。header 恒在，**至少**显示：产品名、常驻状态、当前 data-dir。

### 4.1 header 唯一一次「不显示什么」的判断

**header 不显示 model / repository。**

理由不是省事：这两个值能拿到的**唯一**来源是 Launch Profile，而 Profile 说的是「打算用什么启动」，不是「正在跑的是什么」。一个用 `hikari resident --model X` 直接起、profile 里写着 Y 的常驻，会让 header 稳定地撒谎。协议里没有「你用什么模型」这个字段，系统提示也**不允许为了 header 去新增探针或解析 status 人类文本**——而 status 里确实印着 model 配置（`language/types.ts` 明说了这一点），但那正是 §6 禁止反解析的东西。

所以：header 只放**协议已经说了的**三样；model / repository 放 **Profile view**，在那里它们的身份是诚实的——「这个数据目录记住的启动配置」。

---

## 5. Chat

### 5.1 提交规则

普通文本**逐字**交给 `requestLanguageAsk`。TUI 不判断意图、不做 keyword routing、不改写人类输入、不总结 Language reply、不改写它的任何一行。

显示层只允许加 chrome：`你` / `Hikari` / 本地收到时间。**Language 的 reply lines 原样。**

### 5.2 slash 词表是闭集，且只认 `/`

`/help` `/clear` `/status` `/start` `/stop` `/restart` `/profile` `/quit`。

**「帮我重启」「看看状态」照常发给 Language。** 这是本 slice 最容易被写错的一条：把自然语言当 operator command 需要先做意图判断，而意图判断正是 §1 Q2/Q3 要排除的东西。判据写成可执行的形状：**只有首个字符是 `/` 才是命令**，其余一律是文本。

### 5.3 一次最多一个 ask in-flight

pending 期间：不能再 submit；**但** System refresh 与 proactive delivery 都不被阻塞。这三个是独立的异步线，TUI 不把它们串成一条。

### 5.4 `/clear` 的确切范围

只清 **TUI 当前进程的 transcript**。

不清 Dialogue Context（那是常驻的、在 Language 插件里的）；不清 Chronicle；不清 Memory；不改 Resident。

---

## 6. System view：不反解析

复用既有 `status`。

**禁止**：`xxx 状态：active` 这类正则解析，或任何形式的「把 status lines 读成 Plugin 语义」从而建立**第二套状态模型**。

System view 可以做的全部：
- 显示常驻 high-level outcome —— 取自 `ControlOutcome` 的 `kind` / `outcome`，协议字段
- status lines **原样**显示，不排、不删、不摘要
- 用**既有的、协议级的** `outcome` 上色（沿用 v0 §5.3 的配色红线）
- 提供 start / stop / restart

将来若真需要 Plugin table，由真实需求推动一个 structured inspection contract——**不是本轮**。

---

## 7. transcript

**进程内、有界、不落盘。**

三种 entry：Human / Language reply / Proactive delivery。

命名纪律（这条是硬约束，不是措辞偏好）：它**不叫** Memory、不叫 Conversation History、不叫 Chronicle。

常驻重启后 TUI 屏幕上的 transcript 可以继续存在，因为它属于 TUI 进程——但**不得**因此声称 Hikari 还记得这些内容。这个区别在实现里落成一句用户可见的话（见交付记录），而不只是文档里的一句声明。

---

## 8. Proactive delivery 与 single-subscriber

复用 `subscribeToHumanDelivery`。收到的 lines **逐字**进 transcript，TUI 只加 `PROACTIVE` 与本地时间标记。

**Human Delivery 当前是 single subscriber，本 slice 保持这个事实不变。** 如果 Human Surface 或 `hikari subscribe` 已经占着：TUI **不抢、不踢、不要求 server fan-out**；Chat 与 System 继续正常工作；header / status **如实**显示 delivery 不可用或已结束。

`SubscribeOutcome` 已经把这三种结局分开了（`ended` / `absent` / `unavailable`），TUI 直接转述，不合并、不重命名。

可以按 bounded backoff 重试；**不得疯狂 spin**。TUI 退出后进程自然释放 subscription（`subscribe.ts` 对取消的立场写在它自己的文件里，本 slice 不新增第二个取消机制）。

---

## 9. 失败语义：每个 endpoint 只陈述自己知道的事

| 事实 | 来源 | 禁止说成 |
| --- | --- | --- |
| 常驻 absent | `ControlOutcome.kind === 'absent'` | —— |
| 常驻控制通道 unavailable | `ControlOutcome.kind === 'unavailable'` | 「常驻已停止」 |
| Language absent | `LanguageOutcome.kind === 'absent'` | 「常驻已停止」 |
| Language unavailable | `LanguageOutcome.kind === 'unavailable'` | —— |
| Language replied | `LanguageOutcome.reply.outcome` ∈ chatted / answered / refused / failed | refused 与 failed 不合并 |
| Delivery connected / ended / unavailable | `SubscribeOutcome` | 「Hikari 离线」 |

`LanguageOutcome.absent` 真的是两件事（没有常驻 / 常驻没配 model），`askFailureLines` 已经把两件事都说了而不是猜一个——TUI **复用那句话，不重写**。

---

## 10. 明确不做（本轮）

Memory · transcript 落盘 · Markdown renderer · 语法高亮 · 图片 · 文件上传 · 语音 · 多会话 · streaming tokens · model selector · profile editor · Plugin manager · 单独启停 Plugin · logs 子系统 · structured Plugin inspection · multi-resident · remote nodes · mobile · installer · auto-start · updater。

同样不引入：Ink / blessed / React / Electron。零运行时依赖（`package.json` 仍然没有 `dependencies`）。

---

## 11. Boundary check

- [x] concern 在正确 owner：全部组合逻辑在 `src/cli/`，Runtime 不认识 TUI
- [x] Runtime 没有开始理解业务
- [x] 无 speculative abstraction：三个 view 对应三个既有 endpoint，没有「以后可能有用」的层
- [x] 未越过 frozen boundary：未触碰 `core-architecture-v0.md` / `principles.md`
- [x] 未偷偷实现「明确不做」的条目
- [x] 未新增 `GlobalWorldState` / Service Locator / Central Judgement Domain / Generic Human Input / Universal Message / Model Router
- [x] 协议零改动：`control.ts` / `language/*` / `human-delivery/*` 的 wire vocabulary 未动

---

## 12. 交付记录

### 12.1 落盘的东西

**新增**

| 文件 | 内容 |
| --- | --- |
| `src/cli/tui.ts` | 终端循环：raw mode、帧重绘、按键分发、一次 detached spawn，以及让三个既有 client 并排跑起来的接线 |
| `src/cli/tui-state.ts` | 纯状态与决策：view 顺序、transcript 边界、`decideSubmit`、`afterClear`、`memoryMarkerNeeded`、六种语气的名字 |
| `src/cli/tui-input.ts` | 纯输入：单行编辑器（按码点）、闭集 slash 词表、三个非文本键、中断判定 |
| `src/cli/tui-render.ts` | 纯渲染：帧、宽度感知裁剪、宽字符、SGR、擦除 |
| `test/tui.test.mjs` | 46 条测试 |

**改动**

| 文件 | 改动 |
| --- | --- |
| `src/cli/main.ts` | `consoleCommand` → `tuiCommand`；`hikari` 不带命令时进 TUI |
| `src/cli/options.ts` | `ConsoleOptions` → `TuiOptions`；`CliCommand` 的 `'console'` → `'tui'`；`readConsoleCommand` → `readTuiCommand`；USAGE 重写 |
| `src/cli/control.ts` | 只改注释：它列的第四个 client 从 `console.ts` 换成 `tui.ts` |
| `test/tui.test.mjs` | 补回被删掉的真实进程启动测试（见 12.3） |
| `docs/architecture/hikari-tui-v1-implementation-boundary-freeze.md` | 本文件 |

**删除**

`src/cli/console.ts`、`test/console.test.mjs`。

**一处用户可见的行为变化，必须写下来：`hikari console` 不再是命令。** 它现在是一条未知命令，退出码 2，错误信息是 `未知命令：console`。v0 那个名字没有被留成别名——留别名就等于把「操作台」这个名字只留在一个 nobody reads 的地方，而 §3 说的是这个界面不再自称 Operator Console。有测试钉住它（`tui 不是可以打出来的命令字，console 也不再是`）。

### 12.2 自动验证到的

```
npx tsc -p tsconfig.json --noEmit   →  干净
node --test test/tui.test.mjs       →  46 tests / 46 pass / 0 fail
node --test test/*.test.mjs         →  724 tests / 720 pass / 0 fail / 4 skipped
```

4 条 skipped 是需要真实模型 endpoint 的 live 测试，本机照旧跳过。

**真实进程的证据。** `启动路径真的能把常驻拉起来，而且 TUI 不持有那个进程`（Windows 上运行，非 Windows 跳过）：`init` + `chronicle init` 起一个真实数据目录，`writeLaunchProfile` 写下启动配置，把 `launchArguments` 的结果交给 `spawnDetached`，然后**用常驻自己的控制端点**等到 `answered` / `ok`、断言 status lines 非空且含 `Hikari 常驻状态：`，再经同一个 client `stop` 并等到 `absent`。这是本轮唯一一条跑过真实常驻的提交测试；它证明的是 profile → 参数 → detached spawn → 常驻起来并应答 → 能被停掉这条链路，**不证明**任何模型行为。

**假 TTY 驱动的真实产物。** 本机没有第二个终端，所以交互那一半用 fake TTY shim（伪造 `isTTY` / `columns` / `rows` / `setRawMode` / `resume` / `pause` / `setEncoding`，替换 `process.exit`，捕获 `process.stdout.write`）驱动**真实编译产物 `dist/cli/tui.js`**，而不是它的拷贝。它在临时探针里（不进仓库）覆盖了：不带 `--data-dir` 时先问数据目录、Tab 依次切过三个 view、`/help` `/clear` `/status` `/profile` 的分发、「帮我重启」照常走语言入口（假 endpoint 收到的是原句）、粘贴带前导空行、emoji 上的光标、窄窗口重画。退出那条链单独验过：Ctrl+Q 之后 `setRawMode` 的调用序列是 `[true, false]`、`LEAVE_SCREEN` 写出、退出码 0。

**假 endpoint 的证据。** 语言入口的四种结局与投递的三种结局用本地假 endpoint / 假命名管道分别触发过（更早的轮次已经建立的做法），语言侧**不是**模型——它证明的是路径，不是任何模型的行为。

### 12.3 对抗性审查：四条采纳、两条不实施

本轮跑过两路对抗性审查。按 `CLAUDE.md` 的纪律，**子代理的发现只是候选**，每条都重新锚定到源码 / 可执行行为之后才处置。**没有具体失败场景的发现不进入结论**——下面「不实施」的两条就是被这条规则挡下的。

**已修（采纳）**

1. **粘贴的第一行是空的时，整句话静默消失。** 锚定结果：`editLine` 里「任何换行都意味着提交」把 `'\n在吗'` 读成「提交它前面那一行」，而前面没有行，于是 `head` 为空、`text` 为空、`dropped: true`，上层 `decideSubmit` 判 `empty` 并在任何提示之前 return——屏幕上什么都不会出现。**改为**先剥掉「后面还有真实内容」的前导空行，再走原逻辑；发送语义一个字没动。有提交的测试，并且**把旧行为补回 `dist` 再跑**验证过它抓得住（`actual: { kind: 'submitted', text: '', dropped: true }`）。
2. **光标停在代理对上时，画出去的是半个代理对。** 锚定结果：逐 span 检测（不能先 join——join 会把两半重新拼成合法代理对，这正是第一次探针测错的原因）在旧切片上得到 `["\ud83d", "\ude00在吗"]`。**改为**按码点取「光标下那个字符」再切片。有提交的测试，同样用旧行为补回 `dist` 验证过。
3. **退出恢复没有保护（HIGH）。** 锚定结果：`finish()` 先把 `finished = true`，再调 `process.stdin.setRawMode(false)`——而 `setRawMode` 是这段里唯一会同步抛的调用。它一抛，`process.on('exit')` 那个兜底（第一句就是 `if (finished) return`）就地失效，`LEAVE_SCREEN` 永远不写，人被留在 alternate screen + raw mode 里，那正是兜底存在的理由。**改为**把这一次调用单独包进 `try/catch`。
   **对照证据同样是自己跑的**：驱动真实产物，让 `setRawMode(false)` 抛（模拟控制台已经没了），Ctrl+Q 退出。

   | 跑的是哪一版 | 结果 |
   | --- | --- |
   | 当前实现 | `LEAVE_SCREEN` 写出 1 次，退出码 0 |
   | 去掉 `try/catch`（= 修复前） | 抛出**逃出** `onKey` → 未捕获异常，进程带栈直接死；`LEAVE_SCREEN` 一次都没写，兜底因为 `finished` 已置位而按第一句 return |

   栈是 `setRawMode ← finish ← onKey ← emit`，与上面那段 `finished = true` 先置位的锚定逐字吻合。
4. **两次 `/restart` 造出两个 detached 常驻（MEDIUM）。** 锚定结果：`launch()` 是同步的、`launching` 只在 spawn **之后**才置位，而这条序列最长要等 15 秒；旧闸门读的正是 `launching`，所以那个窗口里它根本拦不住，而且两秒一次的状态轮询每轮都会重写 `launching`。**改为**新增独立的 `restarting` 字段（不渲染、只做闸门）+ `try/finally`。
   **这一条的对照证据是我自己跑出来的，不是采信报告**：用假命名管道服务端冒充一个「`stop` 之后还要活一会儿」的常驻，把第二次 `/restart` 打在等它退出的那 2.5 秒里，数**真实到达端点的 `stop` 请求条数**：

   | 跑的是哪一版 | `stop` 到达次数 | 闸门提示 |
   | --- | --- | --- |
   | 当前实现 | **1** | 出现 |
   | 把闸门整段去掉 | **2** | 不出现 |
   | 闸门改回读 `launching`（= 修复前） | **2** | 不出现 |

   第 3 行是修复前那一版的可执行复现；第 1 行是它被拦住。**先前一版探针的结论（「已证明并发」）不予采信**：那一版在空数据目录上跑，`stop` 与第一次 `status` 都立刻失败，整条序列几毫秒内走完，所以第二次按下是**合法的全新一次重启**、不是竞态——它观察到的两轮是先后完成的，不是重叠的。

**不实施（记录为残留风险，本轮不改）**

- **stdin 的 `end` / `close` 没有出口。** 若 stdin 被关闭（而不是收到 Ctrl+C/Ctrl+D 字节），TUI 不会退出。**没有已证的触发路径**：本机是 Windows 控制台，Ctrl+D 不是 EOF，而这个界面拒绝在非 TTY 里运行。
- **`asking` 理论上可能卡住。** 若 `guard` 吞掉一个异常而不是走到回复分支，`asking` 会停在 `true`，此后任何一句话都被判 `busy`。**没有已证的触发路径**：`guard` 吞的是 `requestLanguageAsk` 抛出的异常，而那个 client 的契约是把所有结局作为返回值给出、不抛。两条都属于「有具体场景才进结论」规则挡下的东西——记在这里，不假装不存在，也不为一个没有复现路径的假设改代码。

### 12.4 §14 的 NOT RUN 清单

**这两组步骤本轮没有跑，不得写成 PASS。**

**依赖真实 TTY / 手工交互（第 1、14、15、16、17 步）**——本机是后台会话，没有可交互终端。这一半的**判定逻辑**由 46 条纯函数 / 纯渲染测试覆盖，**终端那一半**（真键盘、真窗口、真 resize 事件、真 alternate screen）**没有自动证据**。这正是 §13 要求「决策与 terminal IO 分开」的原因，也是 `tui-state.ts` 开头那段话说明的理由。**人需要手工 smoke 一遍**，并且**手工 smoke 不等于回归保护**。

**依赖真实模型 endpoint（第 4、5、8、9 步）**——本机无法访问真实模型端点（这一条是环境的既有事实，不是本轮的选择）。语言侧全部证据来自本地假 endpoint，**不得**读作关于任何模型行为的 PASS。**另外：不记录任何 credential 值**——Profile view 只显示凭据环境变量的**名字**，有测试钉住这一点。

### 12.5 残留风险

- 交互那一半（`finish` / `onKey` / 轮询定时器 / 投递重试）**没有自动化覆盖**，只有 §12.2 描述的一次性假 TTY 探针。探针脚本是临时的，不进仓库；做法写在上面，可以重建。
- §15 的 single-subscriber 仍然是产品的**已知限制**：Human Surface 或 `hikari subscribe` 占着投递端点时，TUI 拿不到主动投递。TUI 不抢不踢，header 如实说。
- `/restart` 的闸门有对照证据但**没有提交的回归测试**——要驱动它需要假 TTY + 假命名管道，本仓库的既有做法是把这一半记为未覆盖而不是造一个只在这一台机器上成立的测试。

### 12.6 一处刻意不做的文档动作

**`docs/development/current-stage.md` 本轮未更新。** 这是决定，不是遗漏。两个相反的先例都在：operator TUI v0（`02a414b`，同一个界面、上一轮）没有改它，human-surface（`5dc1bc1`）改过。取更小的一个，理由是：该文件记的是 Phase 4 各 slice 与它们的 CI 运行，而 TUI **不是 Phase 4 slice**——它是 `src/cli/` 里的一个 client surface，没有进入任何 composition，没有新增 capability。本轮的交付记录就是本文件。
