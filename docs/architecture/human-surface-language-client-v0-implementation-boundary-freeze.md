# HUMAN SURFACE LANGUAGE CLIENT v0 — IMPLEMENTATION BOUNDARY FREEZE

- 日期：2026-09-29
- 前置：`docs/architecture/human-inbound-v0-boundary-review.md`（verdict **NARROW**，commit `e22ecd2`）。
- 本文只冻结实施边界，**不重开架构问题**。
- **被本文取代的记录**：`docs/architecture/human-surface-v0-implementation-boundary-freeze.md` §12 第一条（「不做 Human → Hikari 对话」）。按 `governance-rules-v1.md` R7.2 的双向指针要求，那一处的正文保留不改，只在同一节留了一条指向本文的指针；本文这条就是它的反指针。

## Human ruling（已冻结，本轮不再讨论）

1. **YES** —— Human Surface 就是 Human 可以主动对 Hikari 说话的 Windows 入口。
2. **形状 A** —— Surface 直接成为现有 **Language-owned endpoint** 的 client。
   - Surface **不再需要**保持「领域无关」；
   - 但**仍然只是 client**：不获得 Language ownership，**不理解任何 domain semantics**；
   - **不选 B**，不增加 composition router，不增加 generic ingress binding。

---

## 1. 这是 client，不是 contract

本 slice **不创建任何跨模块 contract**（review §8 已逐条论证 §16 八问）。C# 侧新增的每一件东西都是**消费既有公开面**：

| C# 侧新增 | 镜像的 TS owner | 该 TS 面为谁导出 |
| --- | --- | --- |
| `LanguageEndpointPath` | `src/language/endpoint-path.ts` | `index.ts:74`，**为 client 导出** |
| `LanguageFraming` | `src/language/protocol.ts` | `index.ts:89-96`，逐字「both ends of the pipe are the owner's own statement」 |
| `PipeLanguageAsker` | `src/cli/ask.ts` | 该文件本身**就是** client |

**Surface 不得**：解析 `reply.lines` 的内容、判断一句话该给谁、缓存/重放、把 `outcome` 合并或改名。`ask.ts:8-11` 逐字：「does not translate an `outcome` word into one of its own……a second copy here would be a second answer to a question that already has one.」

---

## 2. C# Language endpoint path

`hikari-language-<sha256(canonical(rootDir).toLowerCase())[0..16]>`，与 delivery 的推导**逐字节相同，只有前缀不同**（`src/language/endpoint-path.ts:24`）。

- 现有 `DeliveryEndpointPath.cs` 的 `CanonicalRootDir` + kernel32 P/Invoke 是约 60 行；**再抄一份就是它自己的注释警告的那种 copy**（「a real cost rather than a design」）。
- **决定**：抽出 `PipeEndpointPath`（共享推导：`Derive(prefix, rootDir)` + `ServerNameOf(path)`），`DeliveryEndpointPath` 与 `LanguageEndpointPath` 成为两个**只有前缀不同**的具名端点。
- `DeliveryEndpointPath` 的公开签名**不变**，现有测试与调用点零改动。
- `LanguageEndpointPath` 因此**不是**第二个实现，**不需要**自己的 parity 测试——它复用被 parity 测试覆盖的那一份推导。这条必须写进注释，否则下一个读者会以为哪里漏了。

---

## 3. C# Language framing

镜像 `src/language/protocol.ts`，常量逐字一致：

```text
LANGUAGE_PROTOCOL_VERSION = 1
REQUEST_KEYS             = protocol, request, text      （恰好三键）
REPLY_KEYS               = protocol, outcome, lines     （恰好三键）
请求词                    = 'ask'（唯一）
reply outcome            = chatted | answered | refused | failed（四词闭集）
MAX_LANGUAGE_REQUEST_LINE = 64 * 1024
MAX_LANGUAGE_REPLY_LINE   = 64 * 1024 + 4096
```

- **`protocol.ts:11` 的形状必须保真**：信封**恰好三键**——「an envelope that shrugged at an unknown field would already be an extensible schema」。C# 侧必须同样拒绝多一个键，否则两端对「什么是一条合法请求」不一致。
- 结构 vs 语义的界线照抄（`protocol.ts:48-57`）：**空或过长的 question 能解码**，由 plugin 拒绝；**不是本协议的信封才 decode 失败**，端点答 `failed`。
- 长度上限**属于 domain owner**。Surface **不得**自行预检（`ask.ts:4-6`）。
- **编码结果不与 `JSON.stringify` 逐字节相同，这一点实施时实测确认，并如实记录。** C# 用 `UnsafeRelaxedJsonEscaping`：CJK 与 JS 一样原样上线，但 `U+3000` 与 emoji 的代理对仍被转义，控制字符用大写十六进制而 JS 用小写。**两种都是合法 JSON，`JSON.parse` 读回同一个字符串**——协议要求的是服务端读回同一个问题，不是两端写出同一串字节。因此 conformance **不断言字节相等**（那是把非要求变成红灯）；被断言的是两条不同的主张：「真解码器读回的是同一个问题」与「真 line reader 把它框成恰好一行」。

---

## 4. ask/reply 状态机

**唯一 owner 是 `SurfaceSession`**，理由是可证的正确性而非对称：

> 人的输入行、Language 的应答行、Human Delivery 的主动行**必须落在同一个 transcript 里**。若分两个列表，「ask pending 时主动消息仍能进入」就必须靠人工维护顺序；合在一个列表里，它是**构造上成立**的。

```text
Idle ──TryAsk(text)──► Pending ──replied(refused|failed|chatted|answered)──► Idle
                            └────unavailable / absent ─────────────────────► Idle
```

- **一次只允许一个 ask in-flight。** 规则由 **session** 强制（返回 `false`），**不是**只靠 UI 禁用按钮——UI 是表现，session 是 owner。
- Pending 期间到达的 delivery 消息**照常 `Accept`**：走的是既有 `Accept` 路径，**没有任何新代码**。这就是「主动消息不被 ask 阻塞」的全部机制。
- 终态四词（`replied` / `refused` / `failed` / `unavailable`，外加 `absent`）**一律回到 Idle**，不做区别对待：transport 不假装知道哪一种是「可重试」的（`outbound-composition` §18.2 已冻结 retry/queue/history 为非目标）。
- **不排队、不重试、不取消**：Pending 里没有第二个槽位。

---

## 5. async + timeout

- **保留 Language 的既有 client upper bound，不自行缩短。** 该界是**推导出来的**（`src/cli/ask.ts:102-103`）：

  ```text
  REPLY_TIMEOUT_MS = (LONGEST_EXPOSURE_COUNT + 1) * MODEL_TIMEOUT_MS + READ_AND_FRAMING_BUDGET_MS
                   = (3 + 1) * 15_000 + 90_000 = 150_000 ms
  ```

- **C# 侧允许写死这三个来源常量**（`15_000` / `90_000` / `3`），**理由是并有且只有一个**：`conformance.mjs` 从 `dist/cli/ask.js` 读**真实的 `REPLY_TIMEOUT_MS`**，测试断言 C# 推导与之相等。capability 增加导致 owner 的界变化时，**C# 会红，而不是静默漂移**。这正是 `ask.ts:17-21` 反对「写死」的那条理由的合法例外，且必须写在注释里。
- **WinForms 全程异步。** `AskAsync` 是 `async Task`；UI 线程只做 `_ = session.AskAsync(...)`，**没有任何 `.Wait()` / `.Result` / 阻塞读**。
- **pending 时只禁用再次发送**：发送按钮禁用 + Enter 不发送；**不冻结窗口**（transcript 可滚动、tray 可开、窗口可关可开）。
- 超时结算为 `Unavailable`，**语言与 `src/cli/ask.ts:130` 一致**：`语言入口在 <n>ms 内没有应答`。

---

## 6. transcript presentation

`SurfaceMessage` 增加 **origin**，取值三个：

| origin | 谁写 | 渲染 |
| --- | --- | --- |
| `Human` | Surface 自己（**只有它知道**） | `SurfaceChrome` 的标签 + **原始文本** |
| `Hikari` | 经管道到达 | 既有 `收到 <HH:mm:ss>` + **lines 原样** |
| `Surface` | Surface 自己，**关于自己** | 提示标签 + 本程序自己的话 |

- **不区分 proactive 与 reply。** 用户裁决要求两者都「原样显示」；Surface 能确证的区分只有**「这句话是不是我自己打进去的」**。一件事是主动推送还是一次问答的答复，是 Hikari 内部的事，加上第三个标签等于 Surface 替 Hikari 主张一个它没做的区分。
- **`Surface` 是实施时被迫加的第三个值，如实记录在这里，不是事后追认。** 本 freeze 初稿写「只有两个」，实现时发现 `absent` / `unavailable` 必须由 Surface 用自己的话说：否则要么把「我没够到 Hikari」冒充成 Hikari 说的话（违反 §1「不得合并/改写 outcome」），要么人打出一句话后屏幕上什么都没有。它与 `Human` 的区别是主语（我说的话 vs 我关于自己的话），两者**都不是到达**——不计 unread、不触发 balloon，见下条。
- 人的那行是 **Surface chrome + 原始文本**（裁决逐字允许）：标签是本程序自己的词，文本一字不动——与 `SurfaceChrome` 现有纪律一致（「Every word this program puts on screen that Hikari did not say」）。
- **只有真正的到达计 unread / 触发 balloon。** `Append(message, isArrival)` 把两件事分开：`Hikari` 的行是到达；人刚打的字、以及本程序关于自己的提示都不是——「有未读」是关于人的注意力的主张，不该被这两者占用。
- **仍然仅 process-local**：不落盘、不追加 Chronicle、**不叫 Memory / Conversation History**。`SurfaceSession.MessageLimit = 200` 的既有边界覆盖新条目。
- 滚动与重建策略不变（每次从 snapshot 全量重建，CRLF）。

---

## 7. cross-language protocol conformance

既有模式，扩展而非新建：

1. **纯函数层**：`node-helpers/conformance.mjs` 增加 language 段落（`languageEndpointPath` / `decodeLanguageRequest` / `decodeLanguageReply` / `LanguageLineReader` / `REPLY_TIMEOUT_MS` 及其三个组成常量 / 四个长度上限），C# 用 `NodeBridge` 读回并逐条断言。
   - **请求方向不对称，所以走 stdin**：C# 写请求、Node 读请求，因此待解码的行是 **C# 编码出来**的，以 JSON 数组经标准输入交给 helper（`NodeBridge.RunToCompletionWithInputAsync`）；其余方向仍是 helper 侧产出、C# 侧断言。
   - 被断言的是：**真解码器读回同一个问题**、**真 line reader 框成恰好一行**（含最大长度问题），以及回复方向的**接受/拒绝一致 + 接受时 payload 相等**。拒绝的 **reason 文本不逐字比对**——两种语言对同一条非法行的措辞不同不构成 drift。
2. **运行期层**：新增 `LiveLanguageEndpoint`（镜像既有 `LiveDeliveryEndpoint`），一个**真实 Node 命名管道 server** 说真协议，供 `PipeLanguageAsker` 做真实 client 的往返——**不需要真实模型**。
3. `NodeBridge` 的可用性探测从「`dist/human-delivery` 存在」扩展为「delivery **与** language 都存在」，使缺失原因准确。

---

## 8. 最终必须真实证明（Windows E2E）

```text
Human 在 Surface 输入一句话
  → existing Language endpoint（真实命名管道）
  → Language（真实 plugin）
  → reply
  → 同一个 Surface
```

**并且**：ask **pending** 期间，Hikari 的 proactive message **仍能进入同一个 Surface**。

两条都要在真实 Windows 上跑出来，**不是**读源码得出的。本机无真实模型端点，语言侧用**本地假 endpoint**（既有做法，见记忆 `live-harness-fake-endpoint-verification`）；**不得写成对真实模型的 PASS**。

---

## 9. 明确不做

- 不新建 communication plane；不给控制通道加词；不给 `human-delivery` 加反向。
- 不创建 Service、不创建 generic Human Input / HumanStatement。
- 不建 retry / queue / history / ack / 多问题并发。
- 不做停止/取消 in-flight ask 的 UI。
- ~~不改 `current-stage.md`~~（按裁决，等实现与真实 E2E 完成后再记录已发生事实）。**条件已满足，已按裁决记录**——见 §11.4 与 `docs/development/current-stage.md` 新增的 HUMAN SURFACE LANGUAGE CLIENT v0 块。
- **不做**任何 Shape B 的 composition 绑定。

---

## 10. Boundary check

| 检查 | 结论 |
| --- | --- |
| 有新的 L3 trigger 吗？ | **没有。** 无新 public contract、无新通信平面、无跨 Runtime、无新全局状态、不碰 Memory/Goal/Action 核心语义。 |
| 是否越过 frozen boundary？ | 否。Surface 是 app，不是 Runtime 模块；它 import 的是 owner 明确为 client 导出的面。 |
| Runtime 是否开始理解业务？ | 否。一个字节都不进 Runtime。 |
| 是否需要 Architecture Review？ | **不需要**——按裁决，无新 L3 trigger 直接实现。 |

---

## 11. 真实 Windows E2E 记录（§8 的两条主张）

**跑在将要提交的这棵树上**：C# 侧 `69 passed / 0 failed / 0 skipped`，WinForms 外壳 `0 警告 0 错误`，`src/` 本轮 0 diff。

四个真实进程，全部按**本轮自己起的确切 PID** 停止（绝不用名称或通配匹配）：假模型端点 `45668`、常驻 `34488`、Surface `34324`。数据目录是新初始化的（`hikari init` + `hikari chronicle init`），常驻命令带 `--desktop-awareness-delay-ms 1000`、`--model-endpoint http://127.0.0.1:8793/v1`、`--model local-fake-endpoint`、`--proactive-return-delay-ms 1000`、`--proactive-return-after-ms 20000`。

所有输入与读取都走 **UI Automation**（`drive.ps1`）：句子的塞入是 `ValuePattern.SetValue`，发送是 `InvokePattern.Invoke`，读回是 `TextPattern` / `ValuePattern`。**没有任何一步调用应用自己的类型**——直接调 `Session.AskAsync` 会是关于 session 的证据，不是关于窗口的。

### 11.1 主张一：一句话出去，同一句回来

输入框里打的是（UTF-8 文件读出，逐字）：

```text
端到端第一句：请把这句话原样回给我 🙂 还有引号 " 和反斜杠 \
```

窗口读回（`\r\n` 为本控件要求的换行）：

```text
你说 14:10:10
端到端第一句：请把这句话原样回给我 🙂 还有引号 " 和反斜杠 \

收到 14:10:10
回执（本地假端点，非真实模型）：你说的是「端到端第一句：请把这句话原样回给我 🙂 还有引号 " 和反斜杠 \」
```

- 断言的判据是**包含**而非相等（端点把问题拼进了答复），`questionReadBackVerbatim = true`。
- 等待 `9096 ms`，`sendEnabledAfterAnswer = true`——回执到达后重新可以发送。
- 未读从 0 变成 **1**：**只有到达计未读**，人自己刚打的那行不计（§6 最后一条在真机上的样子）。

### 11.2 主张二：ask pending 期间，主动消息仍能进来

`delay:12000` 让答复被故意压住十二秒，中间注入一次**真实输入事件**（指针移动一像素再移回，`inject.ps1` 上报 OS 是否登记：`changed: true`，注入前无输入时长下界 `45828 ms`）。

```text
A  14:11:13 发送之后        Hikari 正在回复… · 已连接 · 2 条未读     sendEnabled: false
B  14:11:18 注入之后        Hikari 正在回复… · 已连接 · 3 条未读     sendEnabled: false
C  14:11:25 十二秒之后      已连接 · 4 条未读                        sendEnabled: true
```

B 时刻的 transcript 多出的那一行，逐字是：

```text
收到 14:11:18
Desktop return attention：
  观察时间：2026-09-29T06:11:18.372Z
  已观测到的无输入时长（下界）：45125 ms
  触发时的关注对象：
    t1mb2rg/hikari-new
```

于是时间顺序是**人那句 → 主动那句 → 答复**，而 B 时刻发送按钮**仍然是禁用的**：窗口没有被冻结（transcript 可读、状态行在更新），被禁用的只有「再发一条」。这两件事同时成立，正是本 slice 的全部内容。

### 11.3 假端点一共收到 3 个请求，主动消息 0 个

`model2.log` 逐条：`06:10:10`（第一句）、`06:10:27`（第二句第一次）、`06:11:13`（第二句第二次）——**一次 ask 一个请求**，而 `06:11:18` 那条主动消息**没有产生任何请求**。`desktop-return-speaking@1` 仍然由 `renderSpokenReturn` 确定性渲染，与上一轮记录一致。

### 11.4 第一次尝试失败了，失败原因值得留档

主张二的**第一次**没有跑出来：B 时刻 transcript 没有变化，未读停在 1。原因不是 Surface，也不是 pending 语义——**那个数据目录里从来没有声明过工作焦点**。语言插件自己的措辞是「没有声明关注对象时它不说；声明集为空的那次不会形成播报」；`hikari focus declare` 之后重跑，同一条路径一次就出来了。

**这条记在本文里，因为它是一条独立的证据**：那次播报不是 harness 能催出来的东西，它是一个由真实「声明 + 真实输入事件」共同决定的条件式输出。一个能凭空造出这句话的假 harness 不会先失败一次。

### 11.5 不得读成的东西

- **语言侧是本地假 endpoint，不是真实模型。** 本机没有真实模型端点（见记忆 `no-external-model-endpoint`）。本节证明的是**路径**——Surface → 语言端点 → Language → Surface——**不是**任何关于模型的行为。**不得写成对真实模型的 PASS。**
- **「主动消息不被 pending 阻塞」这条机制上的证据在单元测试那一层**：`AskSessionTests` 有一条「a proactive delivery still lands while a question is outstanding」，注入的是真实 `Accept` 路径。本节的真机记录与它是两条证据，不互相冒充。
- 数据目录在整轮之后**仍然只有 `chronicle/chronicle.jsonl` 与 `continuity/origin.json` 两个文件**：Surface 没有落任何盘。

---

## 12. Functional Review

| # | 判据 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 人打进去的一句话到达既有 Language endpoint | **通过** | §11.1：答复里的问题逐字是输入框里那句（含 emoji、引号、反斜杠），而答复只能来自端点。 |
| 2 | 答复回到**同一个** Surface | **通过** | §11.1：`drive.ps1` 按 PID 找到那一个窗口，从它的只读 edit control 里读出答复。 |
| 3 | 一次只允许一个 ask in-flight | **通过** | A 时刻 `sendEnabled: false`；且规则由 `SurfaceSession.AskAsync` 在锁内 `if (_asking) return false;` 强制，**不是**只靠 UI 禁用——`AskSessionTests` 有一条从 session 层直接打第二个 ask 的用例。 |
| 4 | pending 时只禁用再次发送，不冻结窗口 | **通过** | §11.2：B 时刻按钮禁用**而**状态行从「2 条未读」变到「3 条未读」——窗口在继续工作。 |
| 5 | tray / 窗口 / 主动消息继续正常工作 | **通过** | §11.2 的 B 就是这一条：一个 pending 中的 ask 没有挡住 Human Delivery 的到达路径，走的是既有 `Accept`，**零新代码**。 |
| 6 | 150s 上界没有被自行缩短 | **通过** | `PipeLanguageAsker.ReplyTimeoutMilliseconds` 由 `(3+1)*15000+90000` 推导；`conformance: the client's wait bound is the one the TypeScript client computes` 从 `dist/cli/ask.js` 读**真实的** `REPLY_TIMEOUT_MS` 并断言相等。 |
| 7 | reply / refused / failed / unavailable 到达后恢复发送 | **通过** | §11.1 与 §11.2 的 C 两次 `sendEnabled: true`；四词与 `absent` 一律回 Idle，由状态机保证（§4）。 |
| 8 | transcript 三种来源各自原样 | **通过** | §11.1 与 §11.2 的逐字记录：Hikari 的行原样（`收到` + 正文），人的行是 chrome + 原始文本，Surface 自己的提示不计未读。 |
| 9 | 仅 process-local，不持久化 | **通过** | §11.5 末条：整轮之后数据目录仍只有两个文件。 |

**测试**：C# `69 passed / 0 failed / 0 skipped`（含 3 条真命名管道的 live-language 用例）；WinForms 外壳 `0 警告 0 错误`；Node 全量 `655 tests / 651 pass / 0 fail / 4 skipped`（4 个 skip 是需要真实模型端点的 `*.live.test.mjs`，与 §11.5 第一条同源）。

## 13. Architecture Review

| 检查 | 结论 | 证据 |
| --- | --- | --- |
| concern 在正确 owner | **通过** | 端点路径归 `endpoint-path.ts`，线格式归 `protocol.ts`，等待界归 `cli/ask.ts`——C# 侧**没有一处**自己决定这三件事中的任何一件。`LanguageFraming` 的常量逐条镜像，`PipeLanguageAsker` 的文案与 `ask.ts` 逐字一致。 |
| 是否出现新的跨模块 contract | **否** | 本轮 `src/` **0 diff**。C# 消费的是 `index.ts:74` 与 `index.ts:89-96` 明确为 client 导出的面。 |
| Runtime 是否开始理解业务 | **否** | Runtime 一个字节未动；Surface 是**管道的第二个外部 client**，常驻不知道它在。 |
| public contract 是否真有需要 | **是，且已存在** | 语言端点本来就是为 `hikari ask` 这个 client 造的；Surface 是第二个同类消费者，不是为它新增的接口。 |
| 是否出现 speculative abstraction | **否** | `PipeEndpointPath` 是**去重**而非抽象：抽它的唯一理由是 `DeliveryEndpointPath` 的注释自己写着「a real cost rather than a design」。 |
| 是否越过 frozen boundary | **否** | 见 §10；唯一被解除的是源冻结 §12 的第一条 non-goal，已按 R7.2 双向留指针。 |
| 是否偷偷实现了「明确不做」 | **否** | §9 逐条：无 queue / retry / history / cancel UI / Shape B；`SurfaceSession` 里没有第二个 ask 槽位。 |
| `Surface` 这个第三个 origin 值 | **记录在案，不是追认** | §6 已写明它是实施时被迫加的；本轮**没有**因此新增任何判定语义——它只影响「是不是到达」，而那是人的注意力记账，不是关于世界的判断。 |

**GitNexus**：`detect_changes({scope: "all"})` 无 `partial` / `truncated`；改动全部落在 `apps/human-surface/**` 与本轮文档，`src/` 零改动。图上的 `apps/ ↔ src/` 两个方向**都是 0 条边**（上一轮已核，本轮未新增任何跨目录引用）。

## 14. 两条 finding，以及它们的处理

评审把两条候选 finding 锚定到源码后都确认成立，severity 均为 **LOW**，**两条都已修**：

1. **`LanguageLineReader` 与自己声称镜像的那份 TS reader 有第二处未写明的差异。** C# 在返回一行时消费缓冲区（`_buffer = _buffer[(newline + 1)..]`），`src/language/protocol.ts` 不消费（`slice` 之后从不回写 `#pending`）。原来的注释只声明了「与 `DeliveryLineReader` 的唯一差异是 overflow latch」，于是它同时**声称自己是 TS reader 的对应物**又**隐瞒了一处差异**。产品路径不可观察（`endpoint.ts` 的 `served` 保证一行之后不再 push），因此**不改行为**——消费是对的，改的是注释：两个方向的差异现在都写在类注释里，并写明为什么不可观察。
2. **`ReadObject` 不 dispose `JsonDocument`，而它给出的理由是假的。** 注释说「elements 被交出去，document 必须活过这次调用」，但那些 element 从不逃出 `DecodeReply`（返回的只有 `string` 与 `LanguageReply`），而同目录的 `DeliveryFraming.Decode` 用的是 `using`。`JsonDocument.Parse(string)` 从 `ArrayPool<byte>.Shared` 租缓冲，不 dispose 就不归还。**已修**：`using` + `property.Value.Clone()`——原注释还断言「复制出来会更费代码」，实际上那是一行。

**两条都不改变任何 C# 侧可观察行为**，修完之后 C# 全套仍 `69 passed / 0 failed`，§11 的真机记录是在修完之后的树上重跑的。
