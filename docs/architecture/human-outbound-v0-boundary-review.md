# HUMAN OUTBOUND v0 — BOUNDARY REVIEW

> 本轮**只设计**。不实现、不修改 Runtime、不创建 generic Notification Service、不 commit production code。
>
> 唯一问题：**Hikari 如何第一次合法地主动开口。**
>
> 明确**不研究**：「什么事情值得主动说。」

---

## 0. 方法与证据

本文每条结论锚定到当前工作树的真实源码、真实文档或**本机实测**。三类证据在文中分别标注：

| 标记 | 含义 |
| --- | --- |
| **[源码]** | 主 Agent 亲自读取的文件与行号 |
| **[文档]** | 已冻结的架构文档逐字引用 |
| **[实测]** | 本机真实执行并观察到输出（2026-09-27，Windows 11 Pro 10.0.26200） |
| **[未测]** | **没有**测到——不得读作通过 |

一条来自子 Agent 的 CLI 全量清点报告被采纳，但其**全部承重结论已由主 Agent 用独立 grep / 读文件重新锚定**（见 §1）。

---

## 1. Current human output reality

`src/` 下人类可达的输出**只有两类**，没有第三类。

### 1.1 第一类：CLI 进程自身的 stdout / stderr

`src/cli/main.ts:21` 读一次 `process.argv.slice(2)`，`:31-32` 是整个 CLI 路径**唯一**的写入点：

```ts
process.stdout.write(outcome.stdout);
process.stderr.write(outcome.stderr);
```

`src/cli/resident.ts:331-338` 定义 `PROCESS_IO`，全文件只有三处调用：

| 行 | 内容 |
| --- | --- |
| `resident.ts:409` | `io.out(READY_LINE)` — `'Hikari 常驻已启动。\n'` |
| `resident.ts:411` | `io.out(STOPPED_LINE)` — `'Hikari 常驻已停止。\n'` |
| `resident.ts:448` | `if (failure) io.err(failure)` — 失败文本 |

`resident.ts:453` 返回 `{ exitCode, stdout: '', stderr: '' }`，所以 `main.ts:31-32` 对 resident 命令不追加任何东西。

**[实测]** `src/` 全量检索 `console.` —— **零命中**。检索 `process.stdin` —— **零命中**。

### 1.2 第二类：命名管道上的应答

五个 endpoint，全部 `node:net`，全部 `server.unref()` + `socket.unref()`：

| endpoint | 服务端 | 路径派生 |
| --- | --- | --- |
| Resident 控制 | `src/cli/control-endpoint.ts:42-45` | `control.ts:39-40` |
| work focus | `src/work-focus/endpoint.ts` | `work-focus/endpoint-path.ts` |
| Repository CI relevance | `src/repository-ci-relevance/endpoint.ts` | 同型 |
| desktop session observe | `src/desktop-session-observe/endpoint.ts` | 同型 |
| language | `src/language/endpoint.ts:54-57` | `language/endpoint-path.ts` |

路径一律 `\\.\pipe\hikari-<name>-<sha256(canonicalRoot).slice(0,16)>`，且 `endpoint-path.ts` 首行 `if (process.platform !== 'win32') return undefined;` —— **这套传输本身是 win32-only**。

### 1.3 不是人类出口的三样东西

用户明确警告不要误认。逐条确认：

| 候选 | 为什么不是 |
| --- | --- |
| `resident` 的 stdout | `resident.ts:1-23` 自述它只承担进程语义；两次 `io.out` 都发生在**启动**与**停止**两个时刻，运行期间零写入 |
| internal Event | `desktop-session-awareness-loop/contracts.ts:11-12` 定义了 `desktop-session-awareness-loop.assessed@1`，由 `plugin.ts:85` 发出 |
| endpoint reply | 见 §2——每一次写入都在 `serve()` 内，而 `serve()` 只从 `'data'` 处理器进入 |

关于 internal Event：**[实测]** 全 `src/` 检索 `events.on` —— **零命中**。唯一的订阅定义在 `src/runtime/plugin-context.ts:35-37`，**没有任何生产调用点**。`resident.ts:175-177` 逐字写着：

> 「the resident adds no subscriber of its own: `desktop-session-awareness-loop.assessed` has zero subscribers in production, and that is a property of the design rather than a gap for this file to fill.」

所以那条链路是「可以被订阅但无人订阅」，而**唯一被发出的 Event 落进真空，零人类可达输出**。

### 1.4 结论

**今天不存在任何 unsolicited delivery。** 全 `src/`：

- `console.` 零命中
- `node:http` / `node:https` 零命中
- `readline` / `createInterface` 零命中
- `msg.exe` / `toast` / `notify` / `osascript` / `ShellExecute` 零命中
- `process.exit` 零命中
- `process.on` 只有两处：`resident.ts:633-634` 的 SIGINT / SIGTERM

存在三个 `execFile` 子进程启动点（`foreground/windows.ts:82`、`input-activity/windows.ts:54`、`git-repository/git.ts:144`），**全部是读取，没有一个显示窗口或通知**。

---

## 2. Why current paths are request-driven

不是疏忽，是**结构**。四层证据：

**第一层：写入点被包在请求处理器里。** 每个 endpoint 的 `serve()` 都只从 `socket.on('data', ...)` 进入，且都有一道 `if (served) return;` 守卫（`language/endpoint.ts:70`、`control-endpoint.ts:58`、`observe/endpoint.ts:64`）。**一条连接最多一个应答**，没有会话、没有订阅、没有第二帧。`language/endpoint.ts:22-24` 逐字写：

> 「It stays a one-shot question and answer. There is no session, no subscription, no second frame on an open connection and no state between requests.」

**第二层：客户端形状是 connect-out。** 五个 CLI 客户端（`control.ts:214`、`focus.ts:53`、`relevance.ts:67`、`observe.ts:69`、`ask.ts:115`）全部是「连上 → 写一行 → 首个应答胜出 → `socket.destroy()`」。**发起者永远是人类**。

**第三层：endpoint 被刻意设计成不持有进程。** `language/endpoint.ts:7-12` 与 `control-endpoint.ts:8-12` 都明写 `unref()` 的理由：开放 endpoint 绝不成为进程存活理由，否则 Resident 的 lease 就成了装饰。**一个不持有进程的东西不可能主动推送。**

**第四层——最硬的一层：线上词汇在类型上就无法承载出站。**

`src/language/types.ts`：

```ts
export type LanguageWord = 'ask';
export interface LanguageRequest {
  readonly word: LanguageWord;
  readonly text: string;
}
```

`:4-8` 逐字：

> 「The request is `{ word, text }` and **there is no third field, no field reserved for one, and no shape in which a request without a word would be legal.**」

`answer()` 的唯一调用点是 `plugin.ts:239-245` 的 endpoint handle：

```ts
const endpoint = await listenLanguageEndpoint(
  { handle: (request) => answerer.answer(request.text) },
  path,
);
```

而 `answer.ts:145-150` 把整个循环建立在一个 `{ role: 'user', content: text }` 上。

**结论**：今天不存在任何一条代码路径能在没有 inbound request 的情况下产生人类可见输出。这不是「还没接上」，是「线路的两端都按 request-driven 造的」。

---

## 3. Language activation boundary

必须把两件事分开，用户 §四 的要求在源码里有精确对应物。

### 3.1 Language expression —— **已经存在且完整**

`express.ts` 是确定性渲染层，`:7-9` 逐字：

> 「It does not judge… **Verdicts are printed, not paraphrased.**」

已有的渲染器（`[源码]` grep `^export function render`）：

| 渲染器 | 位置 | 输入 |
| --- | --- | --- |
| `renderAnswer(blocks, contextUsed)` | `express.ts:75` | `GroundedBlock[]` + `DialogueTurn \| null` |
| `renderChat(content)` | `express.ts:111` | 模型自由散文 |
| `renderFocus(designations)` | `express.ts:131` | owner 的 designation 数组 |
| `renderJudgement(judgement)` | `repository-ci-relevance/judgement.ts:76` | owner 的判词 |
| `renderAssessment(assessment)` | `desktop-session-observe/presentation.ts:51` | owner 的评估 |
| `renderWorkFocus(state)` | `work-focus/state.ts:119` | owner 的状态 |

**关键观察**：其中三个活在 **owner 自己的模块里**，由 `read.ts` 调用（`createExposureReader` → `lineSafe(renderFocus(...))`、`createRepositoryExposureReader` → `lineSafe(renderJudgement(...))`）。**「owner 渲染自己的契约，Language 传递 lines」这个模式今天已经成立。**

### 3.2 Language activation —— **不存在**

今天 Language 的「获得一次说话回合」的触发条件，字面上就是 socket 的 `'data'` 事件。没有第二个触发路径：

- `plugin.ts:189` 是 `provides: []`，且两个 variant 共用这一份 definition（`:184-190`）
- **[实测]** 全 `src/` 检索 `events.on`：零命中 → Language **不订阅任何东西**
- `answer.ts:135` 的 `let turn: DialogueTurn | null = null;` 是 activation-local 的对话态，不是激活来源

### 3.3 「谁有资格让 Language 获得一个 speaking turn？」

今天：**唯一的资格来源是「有人通过管道问了」。** 这是一个 **occurrence-scoped grant**——一次提问授权一次回答，回答完即失效。

主动说话需要的是一个 **standing grant**。**今天仓库里不存在任何 standing grant。**

这一点不能用「Language 自己判断」绕过：`plugin.ts:69-74` 逐字拒绝过 Language 自作主张地对外提供能力：

> 「**No Service is provided by either variant**, and by the Contract Creation Gate there is nothing to provide. Nothing in the composition asks this plugin for anything: the one thing that does is a person, arriving over the endpoint below. Publishing a Service for that would be publishing one for nobody, and **the day a real consumer exists is the day this line gets an argument rather than a guess.**」

注意最后半句：它不是禁令，**它是条件**。真正的 consumer 出现的那天，这条线会拿到一个论证而不是一个猜测。本轮的工作正是判断那个 consumer 是否已经出现。

---

## 4. Speaking Sovereignty impact

### 4.1 现有的不变量

`language-tool-use-loop-v1.md:213-220`（§8 结构不变量）：`tool_calls` 非空时模型 `content` 不进入 human-visible answer；一旦成功读取 capability，后续没有自由 prose 的 grounded 出口；grounded answer 仅由 deterministic renderer 产生；**`Domain Plugin 不获得 user-facing speaking turn`**。

`principles.md:475-495`（§15）：`Domain Result → Presentation → RenderedMessage → Transport`；`:495`「领域模块不应自行绕过 Presentation 直接向用户说话。」

### 4.2 主动说话是否破坏它 —— 不破坏，但要看清楚它在保护什么

不变量保护的是**「谁写这些字」**，不是**「谁先开口」**。

- 今天：人类开口 → Language 写字。
- 主动：domain 持有 occurrence 与授权 → **请求**一次回合 → **Language 写字**。

domain 仍然一个字都不写。所以方向反转了，**所有权没有反转**。这是本报告最重要的一条判断，也是最容易被读错的一条。

### 4.3 但如果实现走偏，它会立刻破坏

用户 §五 特别点名的失败态：`repository-ci-attention → Windows Toast text` 直接跨过 Language。

这个失败态之所以危险，是因为**它今天做起来比正确做法更容易**：`foreground/windows.ts` 已经示范了「PS 脚本 + `execFile`」的完整写法，而 Language 的说话路径要绕一大圈。**工程上的最短路径恰好是架构上的错误路径。** 必须显式写进不变量，不能靠自觉。

---

## 5. Mandate / authorization ownership

用户 §六 要求把四件事分开：A. Domain judgement / B. Mandate-authorization / C. Expression / D. Delivery。

| | 今天有没有 owner | 证据 |
| --- | --- | --- |
| A. Domain judgement | **有** | `repository-ci-relevance/judgement.ts`、`desktop-session-awareness` 的比较判词 |
| B. Mandate-authorization | **没有** | 见下 |
| C. Expression | **有** | `express.ts` + 三个 owner renderer |
| D. Delivery | **没有** | §1：零 unsolicited 出口 |

### 5.1 授权问题在文档里被命名过，但从未落地

`principles.md:225`：

> Capability existence ≠ Exposure ≠ Authorization ≠ Execution。

`exposure.ts:56-63` 逐字说明这个骨架今天只实现到第二问：

> 「**What an entry does not carry: any permission.** An exposure says a capability may be *offered*, and says nothing about whether a particular caller may use it or whether this particular act is allowed. `principles.md` §5 keeps those apart — **existence, exposure, authorization and execution are four questions** — and this slice answers exactly the second one.」

**所以 B 是一个被原则命名、被代码显式让出、至今无人认领的位置。** 这不等于「B 必须由新架构承载」——只等于「B 不能靠假装它已经存在来绕过」。

### 5.2 仓库是否已有 standing mandate 能承载 B

逐项检查，**没有**：

| 候选 | 判定 |
| --- | --- |
| 配置文件 / 持久授权记录 | 不存在。`resident.ts` 没有读取任何授权文件 |
| Runtime 层 policy | `plugin-context.ts:22-39` 只有 `services.get/provide` 与 `events.on/emit`，无 policy 钩子 |
| Chronicle 事实 | `resident.ts:179-183` 逐字：Resident「never appends to it, never reads its store, and never turns an observed assessment into a fact.」 |
| 「人类问了一次」 | 这是 occurrence-scoped，不是 standing（§3.3） |

### 5.3 唯一一个已经真实发生、语义上真的是 standing 的人类行为

`resident.ts:164-165` 的组合注释把产品需求写得很清楚：「a human who has explicitly named a repository scope」。这个人**已经做过一次明确、可审计、不可撤销（对本次进程而言）的声明**：

```
hikari resident --data-dir <p> --repository-root <r> --repository <owner/name> ...
```

这是仓库里**唯一一个**语义上属于 standing 的人类授权行为。

**但它不能直接拿来当 B，理由必须写死**：`--repository` 今天的含义是「**观察**这个仓库的 CI」，不是「**打断**我」。把一个既有参数的语义悄悄升级成「授权主动通知」，是在人类没有这么说的情况下改变一个已成立 contract 的含义。

**→ 这是本轮唯一一个必须由 Human 裁决、主 Agent 无权自决的点。见 §19。**

### 5.4 攻击用户 §十二 的假设

用户提出并**要求攻击**的假设：

> 「对于用户明确关注 repository 的新 CI failure，Hikari 被授权主动告知一次。」这条 rule 属于 specific product mandate 而非 universal importance judgement。

**攻击尝试**：`relevant ≠ salient`（`current-stage.md:1433` 冻结），而这条规则要在「新失败」与「不新失败」之间做选择，看起来像 judgement。

**攻击失败，三个理由**：

1. **它不比较备选项。** `phase-4-p4-03-entry-review.md:163` 冻结：「今天仓库里已落地的 judgement 恰好三个，全部是**比较或查找**，**没有一个做选择**」。这条规则是 `newFailure ∧ relevance === relevant`——**两次比较的合取**，仍然是比较，不是选择。它不排优先级、不排序、不说「这个比那个重要」。
2. **重要性是人类预先给的。** 是人主动写了 `--repository t1mb2rg/hikari-new`。Hikari 没有判断「这个仓库重要」，它只判断「这个名字相等吗」——这正是 `judgement.ts:59-60` 已经确立的 truth boundary。
3. **它没有「该不该打扰」的自由度。** 规则完全确定：满足即告知一次，不满足即不告知。没有阈值、没有动态权重、没有 learned policy。

**→ 假设成立。这不是 Salience。** 本轮的出站设计因此不需要 Salience，也不得借机建立它。

**但攻击暴露了一个真实代价**，必须一并记录：这条规则的**唯一**输入是人类事先给的 scope。**如果人类从没说过 `--repository`，Hikari 永远不被授权开口。** 这不是缺陷，这是这个 mandate 的形状——而它恰好是 §5.3 那个裁决点的另一面。

---

## 6. Candidate first outbound transport

用户要求比较、**不做排名**。逐项按七个工程性质过一遍。

### A. Windows 桌面通知 / toast

| 性质 | 值 |
| --- | --- |
| 真正 unsolicited | **是**——进程主动调用平台 API，无 inbound 依赖 |
| 是否要求 Human 已发起 request | **否** |
| 能否在 resident background 下存在 | **能**——一次性子进程，无长连接 |
| 是否支持自然语言文本 | **是**（`ToastGeneric` 的 `<text>` 支持任意 Unicode） |
| 是否需要保持连接 | **否** |
| 是否 Windows-only | **是** |
| 是否泄漏业务语义进 transport | **不必然**——但见 §7.3 的身份问题 |
| 是否适合第一块 proving ground | 见 §16 |

### B. 长驻本地客户端 / named-pipe 订阅者

| 性质 | 值 |
| --- | --- |
| 真正 unsolicited | **是**（服务端 push） |
| 是否要求 Human 已发起 request | **需要一次订阅连接**——之后服务端才推送 |
| 能否在 resident background 下存在 | **能**，但需要一条长连接 |
| 是否支持自然语言文本 | 是 |
| 是否需要保持连接 | **是**——与现有全部 endpoint 的 `unref()` 设计相反 |
| 是否 Windows-only | **是**（`endpoint-path.ts:29`） |
| 是否泄漏业务语义进 transport | 不必然 |
| 是否适合第一块 proving ground | 客户端不存在，需要新写一个；且长连接与「endpoint 不持有进程」的既有纪律冲突 |

**注意**：这条通道的「人类先连上」是**一次真正的 standing grant**——比 §5.3 的配置参数更显式。本轮不选它，但它是 §19 裁决时值得一并考虑的形态。

### C. Resident console / stdout

| 性质 | 值 |
| --- | --- |
| 真正 unsolicited | **否** |
| 是否要求 Human 已发起 request | 形式上需要人类启动进程 |
| 能否在 resident background 下存在 | 能 |
| 是否支持自然语言文本 | 是 |
| 是否需要保持连接 | 否 |
| 是否 Windows-only | 否 |
| 是否泄漏业务语义进 transport | **是**——stdout 会把进程状态与领域话语混在一条流里 |
| 是否适合第一块 proving ground | **否** |

用户逐字警告：「**stdout 如果没人正在看，不等于可靠的人类出口。**」今日 `resident.ts` 的 stdout 恰好说三件事（启动 / 停止 / 失败），全部是**进程语义**。加进去的领域话语会让同一个流承载两种性质的东西——这本身就是一种语义泄漏。

### D. 其他仓库已有可复用的人类通道

**没有。** §1 已穷尽。CLI 是 pull；五个 endpoint 是 request/reply；Event 零订阅者。

用户逐字警告：「**request/reply pipe 也不等于 unsolicited outbound。**」——§2 从结构上确认了这一点。

### 6.1 比较后的一个结构性观察

**A 是唯一一个「不需要人类先做任何事就能送达」的通道。** B 需要一次订阅连接，C 需要有人在看，D 不存在。

但 A 的独特性同时是它的代价：它**不产生任何回报**。管道通道至少能让 Hikari 知道「对方收到了」；toast 连这个都没有（§7.3）。**这是 §11 失败语义的核心约束。**

---

## 7. Windows toast feasibility

用户要求「优先研究 Windows toast，但不要强行采用」「如果 Windows toast 本身需要过重基础设施，如实判定」。

本节给出**本机实测**结果。

### 7.1 实测记录

环境：Windows 11 Pro 10.0.26200，`powershell.exe` 5.1.26100.9444。

| 探测 | 结果 |
| --- | --- |
| `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]` 类型加载 | **成功** |
| `Get-Module -ListAvailable BurntToast` | **0**——未安装，且不需要 |
| `CreateToastNotifier()` 无参 → `Show()` | **抛异常** `HRESULT 0x80070490`（`ERROR_NOT_FOUND`，「找不到元素」） |
| `CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe')` → `Show()` | **成功**，进程 exit 0 |
| `History.GetHistory($appId).Count` | **1**，且 `Content.GetXml()` 逐字等于发送的 XML |
| `%APPDATA%\...\Start Menu\Programs\Windows PowerShell\Windows PowerShell.lnk` | **存在** |
| 清理 `History.Clear($appId)` | `BEFORE=1 AFTER=0` |

**第三条是关键**：无参调用失败，**必须显式传一个 AUMID**。而实际能解析的那个 AUMID 归属于 `Windows PowerShell`。

**第五条比「`Show()` 没抛异常」强得多**：通知进入了平台的 Action Center 持久历史，说明**平台确实接受了它**，不是静默丢弃。

### 7.2 工程重量：极轻，且仓库已有完全同构的先例

`src/foreground/windows.ts` 已经示范了完整写法（`[源码]`）：

```ts
const ENCODED_ACQUISITION_SCRIPT = Buffer.from(ACQUISITION_SCRIPT, 'utf16le').toString('base64');

execFile(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_ACQUISITION_SCRIPT],
  { windowsHide: true, timeout: ACQUISITION_TIMEOUT_MS, maxBuffer: MAX_ACQUISITION_OUTPUT_BYTES },
  callback,
);
```

- `-EncodedCommand`（utf16le base64）：**从构造上消除引号 / 注入问题**——通知文本是人类或领域产生的自由文本，这一点在本 slice 里是决定性的
- `windowsHide: true`：不闪窗口
- `timeout` + `maxBuffer`：有界
- `inflight` Set + `dispose()` + `terminate()`：**in-flight 子进程在 shutdown 时被真实拆掉**，且 `foreground-windows.test.mjs:74-113` 有一条测试专门验证「in-flight 的获取在插件关闭时被诚实拆除，且不被误报为超时」

注入接缝也是现成的（`foreground/plugin.ts:7-28`）：

```ts
export function createForegroundPlugin(createAcquirer: () => ForegroundAcquirer): PluginDefinition<undefined>
export const foregroundPlugin = createForegroundPlugin(createWindowsAcquirer);
```

**→ 一个 toast adapter 可以逐字复用这套模式。工程重量：一个小文件 + 一个注入接缝。**

### 7.3 但有两件事必须挑明

**(a) 身份是借来的。**

AUMID 能解析，是因为 Windows 自己为 `powershell.exe` 装了 Start 菜单快捷方式（§7.1 第七行）。**通知归属于「Windows PowerShell」，不是 Hikari。**

要让通知署名 Hikari，Hikari 需要一个**自己注册的 AUMID**，而这要求一个指向自己的 Start 菜单快捷方式——也就是**一个安装器**。

对第一块 proving ground 来说，**这是过重基础设施**。诚实的处理是二选一，且必须显式裁决：

- 接受「署名 PowerShell」这个不体面但完全真实的事实，写进文档，不假装它不存在；
- 或者第一片不用 toast。

**(b) toast 的送达失败是静默的，而且是结构性的。**

`Show()` 返回、exit 0、历史里有记录——**这三件事都不证明人看见了**。Windows 会因专注助手 / 每应用通知开关静默抑制，**且没有任何错误面**。进程能观测到的最强事实只是「平台收下了」。

**[未测]** 我没有视觉确认。本机 `NOC_GLOBAL_SETTING_TOASTS_ENABLED` 未设置（默认开启），这提高了「确实渲染了」的可能性，但**不构成看见的证据**。

**→ 这条约束直接决定 §11。**

### 7.4 一个必须记录的 CI 事实

`.github/workflows/*.yml`：`runs-on: ubuntu-latest`。

`foreground-windows.test.mjs:15,19,76` 的模式是 `{ skip: onWindows ? false : 'requires a win32 host' }`——**任何 Windows-only 的 adapter 在 CI 上是 100% 未验证的**。

但仓库已经给出了正确的应对形状，**这不是 blocker**：

| 层 | 在哪验证 |
| --- | --- |
| **逻辑**（把什么文本交给谁） | 注入 fake adapter，**全平台**验证（`test/foreground.test.mjs` 独立存在） |
| **adapter**（真的调用了平台） | 只有 win32 上跑（`foreground-windows.test.mjs`） |

`desktop-session-observe/presentation.ts:26-28` 把这条纪律说得很直白：

> 「That is why it is exported and tested on every platform rather than only where there is a pipe — the same argument `judgement.ts` makes in the relevance plugin, and the same reason this repository has already been bitten by a rule pinned only where the pipes are.」

**一个 toast slice 必须把「决定说什么」与「怎么送到 Windows」严格分层**，否则它会成为这个仓库第四次被同一个问题咬到。

---

## 8. Occurrence → Language path

用户 §九 的四条约束：occurrence owner 不生成 prose；Language 不重新做 domain judgement；Language 能看到足够 owner-owned material；transport 不看到 domain internals。以及两条禁令：不要用 Runtime 做 broker；不要让 Resident 理解 occurrence semantics。

### 8.1 决定性的结构事实：Runtime 只提供两种跨插件机制

`[源码]` `src/runtime/plugin-context.ts:20-41` 是 `PluginContext` 的**全部**：

```ts
services: { get, provide }
events:   { on, emit }
defer
```

**没有第三种。** 没有直接的 plugin-to-plugin 引用，没有把活的插件实例注入另一个插件，没有 capability 发现。

所以这一跳**只能是 Service 或 Event**，二者之一的工程后果必须被接受：

| | Service | Event |
| --- | --- | --- |
| 方向 | consumer 主动调用 | producer 广播 |
| 谁决定「说」 | **持有 occurrence 与授权的那一方** | **订阅的那一方** |
| 与 §六「不要让 Language 自己决定」 | **一致** | **冲突**——订阅本身就成了授权 |
| 失败如何返回 | 同步抛回调用者 | `EventBus.emit` 抛 `AggregateError`（见 §8.3） |
| 是否引入 router / event sink | 否 | 风险见 §15 攻击 4 |

### 8.2 两者的准入闸门在哪里——一个必须看清的事实

**[源码]** `plugin-context.ts:23-32`：

```ts
get: (contract) => {
  const key = serviceKey(contract);
  if (!required.has(key)) throw new UndeclaredServiceDependencyError(definition.id, key);
  return services.get(contract);
},
provide: (contract, provider) => {
  const key = serviceKey(contract);
  if (!provided.has(key)) throw new UndeclaredServiceProviderError(definition.id, key);
  ...
}
```

以及 `:35-37`：

```ts
on: (contract, handler) => { scope.defer(events.subscribe(contract, definition.id, handler)); }
```

**`services.get` 的闸门是「消费者自己声明的 `requires`」；`events.on` 的闸门是「什么都没有」。**

也就是说：**Runtime 不提供「谁有权调用谁」的机制。** 可及性的闸门在**组合文件**（`resident.ts` 的 roster 是手写、可评审的），这正是 `exposure.ts:45-48` 已经写下的纪律：

> 「If a second independently optional domain capability ever appears, the answer is not a third literal list here — it is a **Composition Boundary Review** of whether capability reachability should be decided at composition time at all.」

**这不是本 slice 新造成的洞**：`workFocusCurrentService` 今天就是同样的形状——任何插件声明 `requires` 就能读人类声明的焦点。仓库已经接受「Service 可及性是组合级约定」这一前提。

### 8.3 Event 路线的额外结构性代价

**[源码]** `src/runtime/event-bus.ts`：`emit` 收集所有 handler 的 `Promise.allSettled`，把 rejected 的拼成 `AggregateError` **抛出**。无持久化、无队列、无重试。

后果：如果出站走 Event，**一次 toast 送达失败会把异常抛回 occurrence producer**，也就是抛回感知循环的那次 `emit`。**一次人类通知的失败将变成一个领域循环的失败。** 这是不可接受的耦合。

### 8.4 推荐形状（本轮的结论）

**这是一条 Service 调用，不是 Event。**

```
owner（持有 occurrence + 授权）
    │  requires: [ speakingTurnContract ]
    │  把 owner 自己的事实交给 Language
    ▼
Language（拥有措辞与回合表达）
    │  确定性渲染 → lines
    ▼
transport adapter（只看 lines）
    ▼
Human
```

它满足 §九 全部四条：

- **owner 不生成 prose**：owner 只交出它自己契约里的值，与 `renderJudgement` 今天做的事同型
- **Language 不重做 domain judgement**：它只渲染，不判定
- **Language 看到足够 owner-owned material**：见 §9
- **transport 不看到 domain internals**：adapter 的输入类型就是 `readonly string[]`

它满足 §六：**Language 不决定**，它是被调用的。
它满足 §五：**domain 不抢回合**，它请求，Language 渲染。
它不引入 router、event sink、broker、Global Brain。

**它需要一个新的 public contract**——这一点的代价与准入在 §14 诚实评估。

---

## 9. Language proactive input shape

用户 §十：主动 speaking turn 没有 user text。研究最小需要接收什么。禁止 Universal Epistemic Object / Generic Prompt Envelope / Universal Agent Message。

### 9.1 最小的东西可能是「已经存在的东西」

`answer.ts:145-150` 的整个循环建立在 `{ role: 'user', content: text }` 上。主动回合**没有这个**。而且循环唯一的动作是「读一个我还没读过的东西」（`plugin.ts:20-22` 逐字：「the loop's only move is "read a thing I have not read"; it does not plan, it cannot write, and it cannot act」）——**主动场景下，读取已经由 domain 发生过了**。

所以主动路径**不能复用 `answer()`**，也不需要。用户 §十六 攻击 6 问的正是这个，答案是否定的：**主动说话不是另一种 `answer()`。**

### 9.2 但表达层几乎不需要新东西

`[源码]` `express.ts:75`：

```ts
export function renderAnswer(
  blocks: readonly GroundedBlock[],
  contextUsed: DialogueTurn | null,
): readonly string[]
```

`:79` 是 `if (contextUsed !== null)` —— **`null` 分支已经被支持**，它只是不加那行上下文注记。

`GroundedBlock` 是：

```ts
export interface GroundedBlock {
  readonly name: string;
  readonly lines: readonly string[];
}
```

**→ Language 已经有一个渲染器，它的输入恰好是「若干 owner lines 的块，且没有对话回合」。**

这是本轮最有价值的发现之一：**主动 speaking turn 不需要新的表达机制。** 需要的是：

1. 一个新的**入口**（不是 `answer()`，因为主动回合没有 question）
2. 一个**授权**（§5）
3. 一个**送出方向**（§8）

### 9.3 最小的输入形状

诚实的答案是：**`readonly string[]` 已经在仓库里了。**

`read.ts:76` 的 `ExposureReader` 就是 `(exposure: LanguageExposure) => Promise<readonly string[]>`——**返回 lines**。`express.ts:52-55` 逐字：

> 「The lines are the whole of what a human is shown, and they are also the whole of what the model is shown… **there is one array, and two readers of it.**」

所以最小形状不是一个新的 envelope，而是**已经存在的东西加一件事**：让 Language 知道「这是一次被授权的主动回合」。

**不得**变成的东西（用户 §十 / §十七 禁令）：Universal Epistemic Object、Generic Prompt Envelope、Universal Agent Message、`Attention<T>`。

**建议的最小形状**（仅供裁决，非实现）：

```
一个由 owner 构造、由 Language 消费的回合请求，携带：
  - owner 自己契约里的 values（不是 prose）
  - 没有 priority / confidence / routing / type tag / expiry
  - 没有「这是哪种通知」的枚举
```

**任何试图在这个形状里加入「这条有多重要」「该走哪条通道」「什么时候过期」的字段，都是 §18 要禁止的泛化。**

### 9.4 谁把 values 变成 lines

两条路：

- (i) owner 自己渲染（`renderJudgement` 模式），Language 只传递
- (ii) Language 渲染 owner 的 values

**推荐 (i)**，理由是第一手的：仓库里**三个**人类可见渲染器（`renderJudgement` / `renderAssessment` / `renderWorkFocus`）**全部活在 owner 模块里**，由 `read.ts` 调用。这是已成立的 precedent。

同时它解决了一个真实风险：若走 (ii)，Language 就必须理解「repository」「CI」「failure」这些词，**那正是 Global Brain 的第一块砖**。走 (i)，Language 的词表里只有 lines。

---

## 10. Grounding implications

用户 §十一：Language 不得把「new failed CI occurrence」扩写成「你的项目出大问题了」。研究现有 deterministic grounded answer 机制能否复用，或是否需要新的 Language-private path。**不要重新打开完整 Grounded LLM Expression 除非它真的成为 blocker。**

### 10.1 现有机制能否复用 —— 能，而且这是最强的答案

`express.ts` 的整个纪律就是这件事：

- `:7-9`「It does not judge… **Verdicts are printed, not paraphrased.**」
- `:11-18`「It does not re-render」（复用 `renderAssessment`）
- `:20-23`「**It does not add.** Every line is a fixed label and values taken from a contract verbatim, and the only free text that reaches a line is text a human wrote (a work focus designation), text an owner already rendered, or… the model's own conversational reply, which is not a claim about Hikari and is never mixed with one that is.」

**→ 如果主动路径完全绕开模型，走确定性渲染器，「扩写」在结构上不可能发生。**

### 10.2 最强的结论：第一片主动切片不需要模型

这不是妥协，是三个独立理由的交点：

1. **不需要**：§9.2 已证明表达层就位；§9.4 的 owner-render 模式已就位。
2. **不该要**：主动场景下没有 question，循环的唯一动作（「读一个没读过的东西」）已由 domain 完成——模型在这里没有可做的事。
3. **不能要**（对第一片而言）：引入模型就把 §11 的失败语义从「一次确定的送达」变成「一次可能失败的推断」，而第一片的价值恰恰是证明**链路成立**，不是证明**措辞好**。

`plugin.ts:24-28` 给出了这条纪律的第一手理由：

> 「Those are in `answer.ts`, as a plain function, because CI runs on Linux where none of this file's machinery exists: a rule that could only be reached through a named pipe would be a rule CI never checks.」

**同一个论证在这里适用**：把「决定说什么」放进一个不依赖模型、不依赖管道、不依赖平台位置的纯函数，CI 才能验证它。

### 10.3 模型将来在哪里进入

不在本 slice。留路即可：

- 确定性路径是**默认**，模型是**可选增强**
- 一旦主动回合引入模型，`answer.ts:12-31` 的**单向门**（一旦一次 read 成功，模型散文永久丢弃）必须同样适用
- `language-tool-use-loop-v1.md:231` 的边界不变：「**模型可以决定「还需要读什么？」，模型不能决定「这些事实意味着什么？」**」

**[未测]** 本机无法访问真实模型端点，所以主动路径的模型语义验证在这台机器上是 **NOT RUN**。本报告不给出它的结论。

---

## 11. Delivery failure semantics

用户 §十三：Domain occurrence 已发生、Language 已形成 utterance、transport delivery 失败，分别意味着什么。

### 11.1 三件事各自的状态

| | 失败后是否成立 |
| --- | --- |
| Domain occurrence 已发生 | **仍然成立**——它是对世界的判断，不是对送达的判断 |
| Language 已形成 utterance | **仍然成立**——它是确定性的，不依赖送达 |
| 人类是否被告知 | **不知道**，且**可能永远不知道** |

### 11.2 禁止的四件事（用户逐字）

- 把 Domain judgement 回滚——**禁止**。世界没有因为通知失败而改变。
- 把 occurrence 当作没发生——**禁止**。这正是 `phase-4-desktop-session-awareness-loop.md:91` 的同一条纪律：「Event 的合法性来自 Producer 拥有的、真实且稳定的 occurrence semantics，不来自 subscriber count。」
- 无限 retry——**禁止**。
- 立即创建 durable notification queue——**禁止**。

### 11.3 第一片最诚实的失败语义

**fire-and-forget，失败可见但不重试，且不假装送达。**

具体到三条：

1. **调用者知道失败**（走 Service 而非 Event，§8.3）：adapter 的失败同步抛回 owner，owner 可以记录、可以计数、**不可以重试**。
2. **不产生任何 durable 状态**：没有队列、没有待发箱、没有失败重试表。进程结束即遗忘。
3. **措辞上不许声称送达**：Hikari 可以说「我尝试告知」，**不可以说「我已经告诉你了」**。§7.3(b) 已实测：toast 的抑制是静默的，进程能观测到的最强事实是「平台收下了」。

### 11.4 一个来自实测的硬约束

`[实测]` toast 的失败**没有错误面**。所以：

- adapter 返回成功 ⇏ 人看见了
- adapter 返回失败 ⇔ 连平台都没收下（子进程启动失败、超时、异常 exit）

**这是一个不对称的、诚实的信号。** 它的价值在于**不撒谎**：Hikari 永远不声称超出它观测范围的事。

**对照**：管道通道至少有一半的确认（对端读到了）。toast 没有。这是 §6.1 所说的代价，在失败语义里第一次真正体现出来。

---

## 12. Lifecycle / duplicate responsibility

用户 §十四的四条，逐条确认边界：

| 事项 | owner | 本 slice 是否触碰 |
| --- | --- | --- |
| 「这条 CI failure 是否已经通知过」 | **Repository CI Attention concern** | **不触碰** |
| duplicate suppression | 同上 | **不触碰** |
| Transport 保存 semantic notification history | **不做** | **不触碰** |
| Language 保存 domain dedup state | **不做** | **不触碰** |

### 12.1 一个真实存在、但属于别人的诱惑

`[实测]` §7.1 第五条：平台通知历史里存着那条 toast，且 `Tag` 字段为空。

Windows 的 `ToastNotification` 确实支持 `Tag` / `Group`，可用于**平台级替换**（同 Tag 的新通知替换旧的）。这是一个**看起来像是** duplicate suppression 的现成机制。

**必须显式拒绝它**，两个理由：

1. **它是平台的历史，不是 Hikari 的语义状态。** §14 逐字：「不要借 outbound slice 偷偷实现 cross-runtime notification history。」
2. **它做的是错的事。** 替换 ≠ 抑制：用户可能**根本没看见**上一条，替换会让它彻底消失。这是「更少的告知」，而 duplicate suppression 想要的是「不重复的告知」。

### 12.2 本 slice 唯一持有的状态

**零。** 与 Language 今天的状态纪律同型——`plugin.ts:83-86`：

> 「Nothing durable is held… there is no file, no store and no Chronicle entry anywhere behind this plugin, so "Hikari forgot the conversation because it restarted" is a structural fact rather than a cleanup somebody has to remember to run.」

**一个不持有状态的出站路径，「重启后会不会重复通知」是一个不属于它的问题**——这正是本 slice 边界最干净的地方。

---

## 13. Runtime / Resident boundary

用户 §十三（原 §九 末）：「不要用 Runtime 做 broker。不要让 Resident 理解 occurrence semantics。」

### 13.1 Runtime 侧：**零改动**

本 slice 需要的全部机制**已经存在**（§8.1）：`services.provide` / `services.get` / `defer`。

- 不需要新的 Runtime API
- 不需要新的 communication plane 实现
- 不需要 optional-require、service locator、capability registry、dynamic discovery

`plugin.ts:43-49` 逐字记录过这四样为什么**不得**被引入：

> 「the alternative would be an optional-require mechanism, a service locator, a capability registry, dynamic discovery or a generic optional-plugin framework — four pieces of Runtime architecture this slice is explicitly not allowed to add, and none of which the problem actually needs.」

### 13.2 Resident 侧：只做组合，且只多知道一件事

`resident.ts:1-23` 逐字划定 Resident 的职责边界，其中两条直接相关：

- `:14-17`「no plugin is added for it, no service or event is defined for it, and it holds no domain state」
- `:186-190`「It does not know what a repository is, what CI is, whether two commit strings match, or what relevance means… hand-writing a call sequence here, or reading a value out of one member to decide what to load next, would be this file acquiring an opinion about the domain it composes — which is the one thing a composition role is not allowed to have.」

**本 slice 让 Resident 多知道的全部内容是**：新成员在 roster 里的位置（因为依赖顺序）。

**不增加**：它不需要知道 occurrence、不需要知道授权语义、不需要判断「该不该说」。**授权通过被组合成员的 `requires` 声明承载**（§8.2），Resident 只是按顺序 load——与它今天对 `repository-ci-relevance` 做的事完全同型。

### 13.3 一条必须重申的既有禁令

`plugin.ts:76-81` 逐字：

> 「The Resident's control channel is deliberately not involved — a channel whose whole design is two words about the process must not become a place where questions are routed to plugins, because **the first question it answered would make it the router that design refuses to be.**」

**推论**：出站通知**绝不能**走控制通道。控制通道今天只回答 `status` / `stop`（`control-endpoint.ts:100-116`），增加第三种词就是把它变成 router。这是 §15 攻击 5 的直接判据。

---

## 14. Public contract impact

诚实评估：**本 slice 需要一个新的 public contract。** 这是它最大的成本。

### 14.1 为什么需要

§8.1 已证明：跨插件只有 Service / Event 两条路。不论选哪条，都必须先有一个契约对象，而 `defineService` / `defineEvent` 产出的就是 public contract（`runtime/contracts.ts:16-26`）。

### 14.2 它能否通过 Contract Creation Gate

`plugin-design-spec.md` §16（`:519-569`）逐条：

| 问题 | 回答 |
| --- | --- |
| 真实的跨模块交互语义是否已发生？ | **是**——一个 owner 持有 occurrence 与授权，必须把一次回合交给 Language |
| 是否要求已存在 Consumer implementation？ | **不要求**（§16.1 逐字：「**必须存在真实、已发生的跨模块交互语义。不要求已经存在具体的 Consumer implementation。**」） |
| Service 判据：谁需要**主动调用**？ | **owner 需要**（§16.2） |
| 是否为了测试 / 对称 / 未来可能性？ | **否** |
| 是否泄露实现细节？ | 可控——契约只承载 values 与回合，不承载 transport |
| 生命周期是否明确？ | 明确：activation-scoped，`defer` 清理，与现有全部 Service 同型 |
| Runtime 是否因此理解业务？ | **否**——Runtime 只做 key 匹配，与今天完全一致 |

**→ 它通过 Gate。** 且通过的方式值得记录：这是 `plugin.ts:69-74` 那句「**the day a real consumer exists is the day this line gets an argument rather than a guess**」所指的那一天第一次到来。

### 14.3 但「通过 Gate」不等于「现在就建」

一个诚实的下限：本节的全部论证建立在**上游 occurrence owner 尚未存在**这一事实上。

用户 §十五 明确：「不要实现上游 CI Attention」。而 `docs/architecture/repository-ci-attention-v0-boundary-review.md` 已判 **BLOCKED**。

**所以本 slice 存在一个顺序问题**：出站路径的 consumer 是 attention owner；attention owner 的 blocker 是出站路径缺失。两者互为前提。

**本报告不解决这个循环**——它只指出：出站侧的 blocker 已被本轮消解（§7 实测 + §8 结构 + §9 零新表达机制），**剩下的一半在上游**。见 §19。

### 14.4 是否触发 Composition Boundary Review

`plugin.ts:58-61` 逐字：

> 「the mechanism is approved for exactly two variants differing by one independently optional capability. **A second such capability is the trigger for a Composition Boundary Review** — not for a third factory here, and not for a `CalendarLanguage` beside these two.」

**精确判定**：这一条讲的是 Language 的 **exposure**（提供给模型的 capability），触发条件是「第二个独立可选的**领域** capability」。

本 slice **不增加 exposure**：主动路径不经过模型（§10.2），`LANGUAGE_EXPOSURES` 与 `LANGUAGE_REPOSITORY_EXPOSURES` 都不变，也不新增第三个 factory。

**→ 字面上不触发。**

但必须如实指出：**它触碰的是同一类问题（capability reachability）**，只是从「模型能读什么」换成了「哪个插件能说话」。`exposure.ts:45-48` 把后者的裁决权交给 Composition Boundary Review。**这是一个判断，不是一条引用的结论**——如果 Human 认为主动说话能力属于同一问题域，那么本 slice 应当先做 Composition Boundary Review。**这一点一并列入 §19 待裁决项。**

---

## 15. Adversarial findings

用户 §十六 要求攻击至少六个假设。逐个攻击，**不预设结论**。

### 攻击 1：「Language 提供一个 `speak()` Service 就行。」

**检查：是否会变成任何 Plugin 都能让 Hikari 随便说话。**

**攻击成立，但结论是「需要限定形状」而非「不可行」。**

`[源码]` `plugin-context.ts:23-27`：`services.get` 的闸门是消费者**自己声明的 `requires`**。所以一个 `speak(text)` Service 一旦发布，**任何插件写一行 `requires: [languageSpeakService]` 就能让 Hikari 说话**。

但必须精确：**这不是新洞。** `workFocusCurrentService` 今天完全同型——任何插件声明 `requires` 就能读人类声明的焦点。仓库已经接受「Service 可及性的闸门在组合文件」这一前提（§8.2）。

**真正的问题不是闸门，是形状。** `speak(text: string)` 让调用者**直接提供人类可见文本**——那正是 §4.3 的越界：domain 写 prose，Language 只是转发。

**→ 修正后的形状**：Service 不接收 text，接收**一次被授权的回合 + owner 自己的 values**。措辞权留在 Language。

**攻击的净结果**：假设「提供一个 Service 就行」**不成立**；但「提供一个 Service」是必要的，只是形状必须限制为「回合 + values」，不能是「文本」。

### 攻击 2：「Event subscriber 直接调用 Language。」

**检查：mandate / ownership / dependency direction。**

**攻击成立且更严重。**

三处：

1. **订阅即授权。** `events.on` 无任何声明闸门（`plugin-context.ts:35-37`）。谁订阅谁就获得了说话权——**而 §六 逐字禁止「Language 自己决定」**。
2. **§8.3 的失败耦合**：`EventBus.emit` 在任一 subscriber 拒绝时抛 `AggregateError`。一次通知失败会变成感知循环的失败。
3. **方向**：Event 让 producer 不知道 consumer，但在这里 producer **必须**知道它把话交给了谁——因为「谁有权说」是本 slice 的核心问题，把它变成匿名的就失去了唯一的闸门。

**→ 假设不成立。** 这是 §8.4 选择 Service 的第二个理由。

### 攻击 3：「Windows toast 就是 Notification subsystem。」

**检查：是否其实只需要一个 concrete adapter。**

**攻击不成立——确实只需要一个 concrete adapter**，且 §7.2 已证明：`foreground/windows.ts` 的写法可以直接复用，注入接缝已存在。

但**攻击顺带暴露了两个真实成本**，必须记录：

1. **身份**：通知署名 Windows PowerShell，不是 Hikari（§7.3(a)）。这不是 adapter 能修的，需要安装器。
2. **静默抑制**：失败无错误面（§7.3(b)）。

**→ 结论**：假设「它就是 subsystem」**不成立**（它只是一个 adapter），但「有了 adapter 就等于有了可靠的人类出口」**同样不成立**。**这是本节最重要的一条负面结论。**

### 攻击 4：「Language 自己订阅所有 domain Events。」

**检查：是否会变成 Global Brain / Event sink。**

**攻击成立，且这是本轮最需要防的失败态。**

- `[实测]` 全 `src/` 检索 `events.on`：**今天零调用点**。Language 目前不订阅任何东西——**这个「零」是资产，不是欠债。**
- 一旦 Language 订阅「所有 domain Events」，它立刻成为：领域的汇点（event sink）、决定哪些事件值得变成话的人（Global Brain 的第一块砖）、以及 §六 禁止的「Language 自己决定」。
- `core-architecture-v0.md:391-404` §11 的「所有交互必经的统一通信层」「中央 AI Brain」直接命中。

**→ 假设必须被明确禁止。** 见 §18。

### 攻击 5：「Resident 做 glue 最方便。」

**检查：是否让 composition host 开始理解业务语义。**

**攻击成立，且有两条既有禁令直接命中。**

1. `resident.ts:186-190` 逐字：composition「does not know what a repository is, what CI is, whether two commit strings match, or what relevance means」；「hand-writing a call sequence here, or reading a value out of one member to decide what to load next, would be this file acquiring an opinion about the domain it composes — which is the one thing a composition role is not allowed to have.」
2. `plugin.ts:76-81` 逐字：控制通道「must not become a place where questions are routed to plugins, because **the first question it answered would make it the router that design refuses to be.**」

**但必须精确区分两种 glue**：

| 形态 | 判定 |
| --- | --- |
| Resident 写调用序列 / 判断「该不该说」/ 读成员的值决定下一步 | **禁止** |
| Resident 按 roster 顺序 load 成员，顺序由成员的 `requires` 决定 | **允许**——它今天就在这么做 |

**→ 假设不成立，但修正后的形态可行**（§13.2）。这正是「多大程度的 glue 是可以的」的边界。

### 攻击 6：「主动说话只是另一种 `answer()`。」

**检查：没有 Human request 时，conversation / dialogue / grounding semantics 是否真的相同。**

**攻击不成立——它们是不同的东西，理由在源码里是决定性的。**

1. **`answer()` 的第一件事就是检查 question**（`answer.ts:138-143`）：空文本 → `refused/emptyQuestionLines`；超长 → `refused/longQuestionLines`。主动回合**没有 question 可检查**。
2. **整个循环建立在 `{ role: 'user', content: text }` 上**（`answer.ts:145-150`）。
3. **循环唯一的动作是「读一个我还没读过的东西」**（`plugin.ts:20-22`）——主动场景下读取已由 domain 完成，模型无事可做。
4. **对话态**：`answer.ts:235-238` 只有 grounded answer 才推进 `turn = advanceDialogue(...)`。主动回合若推进对话态，人类的下一个提问会莫名其妙地「接着」一次它不知道的对话——**`dialogue.ts` 的 `DIALOGUE_CONTEXT_TTL_MS` 语义会因此被污染**。

**→ 假设不成立，且这是一个真实的设计约束**：主动路径必须**不触碰** `answer.ts` 的对话态，也不复用 `answer()`。§9.2 的 `renderAnswer(blocks, null)` 是纯渲染，恰好满足。

### 攻击总结

| # | 假设 | 结果 |
| --- | --- | --- |
| 1 | `speak()` Service 就行 | **不成立**（形状必须限制为「回合 + values」） |
| 2 | Event subscriber 直接调用 Language | **不成立**（订阅即授权 + 失败耦合 + 失去闸门） |
| 3 | toast 就是 Notification subsystem | **不成立**（只是 adapter，且出口不可靠） |
| 4 | Language 订阅所有 domain Events | **不成立**（Global Brain / event sink） |
| 5 | Resident 做 glue 最方便 | **不成立**（但受限形态可行） |
| 6 | 主动说话只是另一种 `answer()` | **不成立**（无 question、无循环、不可碰对话态） |

**六个假设全部不成立。** 这不是坏消息——它意味着本 slice 的形状**不能被现有任何模式直接套用**，而这恰恰是它值得一次独立 Boundary Review 的理由。

---

## 16. Smallest proving ground

用户 §七 的八个比较维度已在 §6 列出，用户要求**不排名**。本节只回答一个问题：**哪个通道能最小地证明「Hikari 主动送达一句话给人类」这件事成立。**

### 16.1 判定

**Windows toast 是唯一满足「不需要人类先做任何事」的通道**（§6.1）。其余三个：B 需要一次订阅连接，C 需要有人在看，D 不存在。

所以：**如果第一片要证明的是「unsolicited」，toast 是唯一候选。**

### 16.2 但它证明的东西比看起来少

必须把 proving ground 的**主张**缩到实测支持的范围内：

| 能证明 | 不能证明 |
| --- | --- |
| 一条领域事实可以变成人类可读文本 | 人类**看见了** |
| 一个后台进程可以无需 inbound request 发起送达 | 送达是**可靠**的 |
| 平台接受了这条通知（Action Center 有记录，实测） | 通知**署名 Hikari**（实测：署名 PowerShell） |
| 整条链路在 win32 上跑通 | 整条链路**在 CI 上被验证**（`ubuntu-latest`） |

**一句诚实的表述**：toast 能证明「Hikari 能把一句话送出进程」，**不能**证明「Hikari 说的话到达了人类」。

### 16.3 一个值得一并考虑的替代

§6 的 B（长驻本地客户端 / 订阅者）有一个 toast 没有的性质：**人类的「订阅」是一次显式、standing、可撤销的授权行为**——比 §5.3 那个有歧义的 `--repository` 参数干净得多。

它的代价是工程重量（需要新客户端 + 长连接，且与现有 endpoint 的 `unref()` 纪律相反）。

**两条路对应两种不同的第一片**：
- 走 A：第一片证明**技术可达性**，授权问题被推迟
- 走 B：第一片证明**授权模型**，技术可达性被推迟

**本节不做排名。** 这是一个应当由 Human 裁决的产品判断。

---

## 17. Smallest implementation slice

**本轮不实现。** 本节只定义边界，供裁决。

### 17.1 最小切片（假设 Human 裁决走 toast）

**只包含**：

1. **一个 owner-render 的确定性函数**：把 occurrence 的 values 变成 `readonly string[]`。**纯函数、零依赖、零 IO**——放在能被 CI 验证的地方（§10.2 的纪律）。
2. **一个 concrete toast adapter**：照 `foreground/windows.ts` 逐字复用 `execFile` + `-EncodedCommand` + `windowsHide` + `timeout` + `maxBuffer` + `inflight`/`dispose` 模式，挂在一个 `createXPlugin(createAdapter)` 注入接缝上。
3. **一次 Service 调用**：owner → Language 回合 → adapter。
4. **测试**：逻辑层用 fake adapter 全平台验证；adapter 层 win32-only skip（照 `foreground-windows.test.mjs` 的既有形状）。

**明确排除**（用户 §十七 禁令的完整清单）：NotificationService、NotificationRegistry、HumanTransportRegistry、generic SpeakService、generic `Attention<T>`、Global Outbox、Global Event Router、Central Proactivity、Central Salience、Central Authority、Global Brain、Memory、notification history、retry queue、跨平台通知抽象、mobile / email / QQ / Slack。

### 17.2 本切片最大的成本

**一个新 public contract**（§14）。它在 Gate 上成立，但它是**难以撤回**的。CLAUDE.md §六 把「难以撤回的 public contract」列为 C 级架构工作——**这是本 slice 应当被当作 C 级对待的第一个理由。**

### 17.3 本切片最大的未知

**上游 occurrence owner 不存在**（§14.3），而它自己判 BLOCKED。本切片无法独立端到端验证——**它只能验证「给一段 owner 文本，Hikari 能主动送达」。** 这仍然是一个真实、可验证、有意义的第一片，但必须诚实地把它标为**半条链路**。

---

## 18. What must NOT be generalized

用户 §十七 的完整禁令清单，逐条给出**本 slice 语境下的具体理由**（不是重复清单）：

| 禁止 | 为什么在这个 slice 里特别容易发生 |
| --- | --- |
| NotificationService / NotificationRegistry | 第一个 adapter 出现时，「顺便抽象一下平台」的诱惑最大 |
| HumanTransportRegistry | 同上——只有一个 transport 时，注册表是纯负担 |
| generic SpeakService | 攻击 1 已证明：形状必须是「回合 + values」，泛化成 `speak(text)` 就是越界 |
| generic `Attention<T>` | §9.3 已划界：不得出现 priority / confidence / routing / type tag |
| Global Outbox / retry queue | §11.2 逐字禁止；§12.2 本 slice 状态为零 |
| Global Event Router | §15 攻击 4；`plugin.ts:76-81` 的 router 禁令 |
| Central Proactivity / Central Salience | §5.4 已攻击并证明本 mandate 不是 Salience——**正因如此它不需要这两个东西** |
| Central Authority | §5.3 的裁决点若被绕过，第一个产物就是这个 |
| Global Brain | §15 攻击 4；`core-architecture-v0.md:391-404` §11 |
| Memory | 记忆 `memory-reactivation-v0-blocked`：Memory 判 BLOCKED 并已封箱，**不得借出站 slice 重新打开** |
| notification history | §12.1：平台的 `Tag`/历史是诱惑，已显式拒绝 |
| retry queue | §11.2 |
| 跨平台通知抽象 | §7.4：CI 在 ubuntu 上，平台差异无法被验证，抽象只会掩盖这个事实 |
| mobile / email / QQ / Slack | 无任何真实需求；`plugin-design-spec.md:532`「若主要理由是『以后可能有用』，默认不创建」 |

### 18.1 一条额外的不变量（本 slice 特有）

**§4.3 的失败态必须被写成不变量**：

> 任何一个持有 occurrence 的 plugin，都不得直接调用 `execFile` / toast / 任何 transport。
> 它只能把 values 交给 Language。**transport 的输入类型必须只是 `readonly string[]`。**

理由是工程性的，不是审美性的：**今天走偏的路径比走对的路径短。** `foreground/windows.ts` 已经把 PS + `execFile` 的完整写法摆在那里，而正确的路径要绕一个 Service、一个回合、一个渲染器。**不变量必须显式写下来，因为最短路径是错的。**

---

## 19. Verdict

### VERDICT: **NARROW**

不是 READY，因为有三个诚实的前提尚未确立。
不是 BLOCKED，因为本轮的调查**消解了上一轮判 BLOCKED 的那个 blocker**。

### 19.1 本轮确实消解的东西

`repository-ci-attention-v0-boundary-review.md` 判 BLOCKED 的核心 blocker 是：「当前不存在真正的 Hikari → Human unsolicited outbound path」。**本轮把这个 blocker 拆开了**：

| 上一轮的 blocker 组成 | 本轮结论 | 证据 |
| --- | --- | --- |
| 「没有 unsolicited 出口」 | **有，且实测可行** | §7：toast 平台接受 + Action Center 有记录 |
| 「Language 无法主动获得 speaking turn」 | **有解** | §8.4：Service 形状 + 成员 `requires` 承载授权 |
| 「需要新的表达机制」 | **不需要** | §9.2：`renderAnswer(blocks, null)` 已支持 |
| 「模型语义未知」 | **第一片不需要模型** | §10.2：三个独立理由的交点 |

### 19.2 为什么仍是 NARROW 而不是 READY —— 三个前提

**前提一：授权从哪来，需要 Human 裁决。**

§5.3。仓库里唯一语义上 standing 的人类行为是 `hikari resident --repository ...`，但 `--repository` 今天的含义是「**观察**」，不是「**打断**」。

- 把它升级为授权 = 在人类没这么说的情况下改变既有 contract 的含义
- 不升级 = 需要一个新的、显式的授权行为

**这是「真实产品意图无法推断」，按 CLAUDE.md §三，属于必须询问用户的类别。主 Agent 无权自决。**

**前提二：第一片走哪个通道，是产品判断。**

§16.3。A（toast）证明技术可达性但出口不可靠、身份是借的；B（长连接订阅者）证明授权模型但工程更重。**两条对应两种不同的第一片。本节不排名。**

**前提三：是否需要先做 Composition Boundary Review。**

§14.4。字面上不触发 `plugin.ts:58-61` 的规则，但**触碰同一类问题**（capability reachability）。`exposure.ts:45-48` 把这类裁决交给 Composition Boundary Review。**这是一个判断，不是引用。**

### 19.3 三个必须一并接受的负面结论

1. **「有了 adapter 就等于有了可靠的人类出口」不成立。** toast 的抑制是静默的，失败无错误面（§7.3(b) **[实测]**）。
2. **第一片是半条链路。** 上游 occurrence owner 不存在且自判 BLOCKED（§17.3）。出站侧无法独立端到端验证。
3. **CI 永远验不到 adapter。** `ubuntu-latest`；分层是唯一诚实的应对（§7.4）。

### 19.4 本轮**没有**做出的决定

- 没有决定 `--repository` 是否构成授权（前提一）
- 没有决定第一片走 A 还是 B（前提二）
- 没有定义新 contract 的具体形状（§9.3 只给边界，不给 schema）
- 没有打开上游 Repository CI Attention（用户 §十五 逐字禁止）
- 没有重新打开 Memory（记忆 `memory-reactivation-v0-blocked` 封箱）
- 没有重新打开完整 Grounded LLM Expression（用户 §十一 逐字禁止，且 §10.2 证明第一片不需要）

### 19.5 READY 的条件

Human 就 §19.2 的三个前提各给出裁决，且第一个前提的答案是「存在一个显式、standing、语义明确的授权行为」——

**在那一刻，本 slice 可以按 §17.1 的最小边界实施，并且它的实施不会引入 §18 清单里的任何一项。**

---

## 附：本轮未测事项（诚实清单）

| 事项 | 状态 |
| --- | --- |
| toast 是否**被人类看见** | **[未测]** 无视觉确认。仅测到平台接受并使用历史持久化留存 |
| 主动路径接入模型端点后的语义 | **[未测]** 本机无法访问真实模型端点，**NOT RUN** |
| 上游 occurrence owner 的端到端行为 | **[未测]** owner 不存在 |
| 非 win32 平台上的任何出站行为 | **[未测]** 现有全部 endpoint 均为 win32-only；本轮未在其它平台运行 |

**以上四项均不得读作 PASS。**
