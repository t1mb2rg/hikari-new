# Hikari Native — 第一条认知反馈闭环：边界设计

状态：**最终审阅点**（已吸收首轮裁决，未实现）。

**审阅裁决（2026-10-30，Human）**：

- 接受 `appendPluginRecord`（实验性 Session API）。
- `resolved` 记录保留，不裁剪。
- Context 预算：3 条 / 1200 字符。
- 修正 Finding 稳定身份与状态更新规则（同一 `findingId` 追加完整记录，projection 按 id 覆盖）。
- 明确「证据存在 ≠ 结论正确」：provenance 分 `model-claim` / `tool-evidenced` / `verified`，第一片只实现前两种。
- Context 按 Turn 投放：同 Turn 不重复，下 Turn 可再投，状态变化投更新版本，重启后允许重投。
- 不扩成通用记忆系统；只证明「过去的认识改变现在的调查行为」。

范围：一个项目、一个有归属的发现、一次跨 Turn 与重启的可见性。不做通用记忆、不做 Attention 改造、不动正式实例。

---

## 1. 事实基线（已核对真实代码）

以下全部来自本机安装的 DSH 0.2.1-rc.3 源码，不是推断。

### 1.1 写 Session 日志的 API

`@deepseek-ai/dsh-session/lib/index.js`

- `Session#append(type, data, ...opts)`（:1517）——公开，但对**未知 type** 的持久化读路径不友好：读路径「refuses to interpret a log containing a type outside this set unless the event carries the envelope's `ignorable` marker」（`KNOWN_SESSION_EVENT_TYPES` 注释，:79-142）。普通 `append` 不带 `ignorable`，所以新 type 只能靠下面这条。
- `appendPluginRecord(session, type, data)`（:1295）——导出函数，写入 `{type, seq, time, data, ignorable: true}`（`#appendRecord` :1548），返回 seq。
  - type 语法：`/^plugin:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u`（`PLUGIN_RECORD_TYPE` :1248）。
  - 文档原文：「a reader that does not recognize the type retains and skips the record, which **never enters the model-visible surface**, and fork and resume carry it with the rest of the log」（:1271-1279）。
  - 约束原文：「**Only production source under `packages/experimental/` may call this function**; the `verify-plugin-record-callers` gate rejects any other production caller in this repository」（:1281-1283）。gate 只扫 DSH 仓库自身；Hikari 是仓库外插件，不会被扫，但语义上这是实验 API。
  - 读回：`pluginRecordOf(event)`（:1306）——`ignorable === true` 且 type 符合语法的记录返回 `{type, seq, time, data}`。
- 提交路径：`commit()`（:1579）对 attached session 触发 `session/event`；detached session 只入 log 不通知。`ctx.sessions.get(id)` 返回的是 attached session。

### 1.2 从日志派生认识

`@deepseek-ai/dsh-session-projection/lib/index.js`

- `register({ key, stateSchema, init(header, inheritedEventCount), apply(state, event), wire?, stateVersion })`（:68-102）：注册即 effect，refs 计数，同 key 共享。
- 构造时订阅 `session/created`（仅 seq===0 时 init）与 `session/event`（`drive` 逐事件 apply）。
- 关键语义（:109-131 区段注释）：cells 是 **lazy** 的——「a unit registered after events flowed, or a session older than the registry, folds `init` over the in-memory log on first touch」。
- `stateOf(session, key)`（:126）同步返回 live state；`snapshot(session, keys)`（:141）返回 `{asOfSeq, values}`。
- checkpoint / restoreFloor / restore / hydrate（:195-361）是**冷启动性能优化**，不是恢复的必要条件；重启后带完整日志的 session 靠 lazy fold 即可重建状态。
- 依赖声明：读者必须在插件 `inject` 里写 `sessionProjections`，否则显式失败。

### 1.3 把认识送进下一次请求

`@deepseek-ai/dsh-system-prompt/lib/index.js`

- `context({ name, order, text: string | (context) => string, interpolate?, required? })`（:279-282）：注册动态运行时上下文，返回 disposer。
- `assemble(context)`（:356）每次组装时 `resolveContext(entry, context)` **同步**求值 `text`；`refreshContext(assembly, context)`（:324-346）重新解析所有已接受 context 的 `text`（不重跑 sections）。
- **关键实证（审阅问题 1 的答案）**：`dsh-agent-loop/lib/index.js:1053` 在 `step()` 里**每个 step** 都调用 `this.loopCtx.systemPrompt.refreshContext(assembly, assembleContextFor(this, signal))`。→ 同一个 turn 的每个 step（每次 LLM 请求）都会重新求值 World 的 text 函数；**不存在「turn 开始时组装一次、后续 step 沿用」**。因此每次请求都能拿到当前有效的 World 认识，不需要 turn 级去重标记。
- `CONTEXT_ORDERS`：WORKING_DIRECTORY:100、SANDBOX_POLICY:110、APPROVAL_POLICY:115、SUBAGENT_DELEGATION:120、TEAM_IDENTITY:125、HARNESS_SOURCE:200、WEB_SURFACE:210。World 认识应排在 125 之后、200 之前。
- `joinContextSections` 产出的文本会进**每次请求**的 runtime context——即每个 step 都会出现，必须控制长度。

### 1.4 现有 Hikari 插件面

`hikari-native/cordis.patch.yml` 当前正式态：agent-loop `sessionId: session-hikari-v0`、system-prompt persona、scoped-fs、perception、world、activation；replay 保留但 disabled。
World 目前只有内存态（`current/previous/lastConsumed/lastWokenAt`），重启即丢——这正是本闭环要替换的东西。

### 1.5 读日志事件（证据引用用，审阅问题 2 的答案）

- **`Session#eventAt(seq)` 真实存在**（`dsh-session/lib/index.js:1439-1441`）：`return this.log[seq]`，返回 accepted event 或 `undefined`。它**没有 `@deprecated` 标记**；被标 deprecated 的是 `snapshotEvents` / `ownEvents`（Agent Note `2026-09-09-deprecate-synchronous-session-event-reads.md`）。第一片用 `eventAt` 读证据，不用被废弃的同步读接口。
- **`tool/result` 的 `callId` 位置**：事件形状是 `data = { message, ... }`，`message = { id, role: 'tool', source: { kind: 'tool', callId }, toolCallId, content }`；`assertMessageEventShape`（:1216-1218）强制 `message.toolCallId === source.callId`。→ 证据引用取 **`event.data.message.toolCallId`**（与 `event.data.message.source.callId` 相同）。
- `tool/call` 不属于 message 事件类型（`isMessageEventType` :1183-1185），data 形状另查；第一片的 evidence 只用 `tool-result` 与 `file`，不依赖 `tool/call`。

---

## 2. 架构裁决

### 2.1 判断写入哪个 API（问题 1）

**裁决：用 `appendPluginRecord(session, 'plugin:hikari/finding', record)`，经 Hikari 自己的工具写入；不用 `Session#append` 新 type。**

理由（按优先级）：

1. 它是唯一「新 type + 能被持久化读路径接受」的通道（`ignorable: true`）；
2. 记录**不进 model-visible surface**——不污染对话历史、不改变 LLM 看到的消息序列，符合「World 持有语义、Session 持有经历」的分工；
3. fork / resume 携带，天然满足「进程重启后仍可读」；
4. `sessionProjections` 的 `apply(state, event)` 能看到它（`session/event` 对 attached session 的所有提交都触发），派生链完整。

代价与边界（必须写进实现 README）：

- 实验性 API：DSH 随时可能改语法或收紧 gate；Hikari 只依赖「语法 + ignorable + 不进 surface」三点，不依赖内部字段。
- 格式迁移 best-effort：记录可能丢。**丢记录的后果必须是可接受的**——即 World 认识丢失后，Hikari 退回「无旧发现」状态，不产生错误状态。
- 不追加到 detached session（`prepare` 出的实例无 store attachment）。

**明确的拒绝项**：不新建 JSON/SQLite 库、不写 World 自己的状态文件、不用 `Session#append` 新 type、不往 assistant 消息里塞结构化块充当状态。

### 2.2 重启恢复（问题 2）

**裁决：可以，且不需要 checkpoint 代码。**

链路：`sessionPersistence` 恢复日志 → `sessions.prepare/enter/announce` → agent-loop `resume` → World 的 projection cell 在首次 `stateOf` 时对 in-memory log 做 lazy fold。

World 插件声明 `inject: ['sessions', 'sessionProjections', 'systemPrompt', 'tools']`；注册 key `hikari/world.findings`、`stateVersion: 1`。不碰 `checkpoint/restore/hydrate`（那是给需要跨进程跳过重放的场景优化用的，v0 日志量小，没必要）。

验证方式见 §4 的「重启复现」步骤。

### 2.3 模型判断 vs 工具核验事实（问题 3）

**裁决：记录里显式带 `provenance`；`tool-evidenced` 只表示「有真实工具证据」，不表示「结论正确」。**

```ts
type FindingRecord = {
  type: 'plugin:hikari/finding'
  data: {
    findingId: string            // 稳定身份：f-001，整个生命周期不变
    scope: { project: string; sessionId: string }   // project = git root，非 cwd
    claim: string                // 一句话判断
    status: 'open' | 'confirmed' | 'refuted' | 'resolved'
    provenance: 'model-claim' | 'tool-evidenced' | 'verified'   // 第一片不产生 verified
    evidence: Array<
      | { kind: 'tool-call'; seq: number; callId: string }
      | { kind: 'tool-result'; seq: number; callId: string }
      | { kind: 'file'; seq: number; path: string }
    >
    recordedAt: number
  }
}
```

**身份与状态更新**：`findingId` 在整个生命周期内不变。每次状态推进都追加一条**完整**记录（whole-value，不写 delta），复用同一个 `findingId`：

```text
f-001  status=open        provenance=model-claim
f-001  status=confirmed   provenance=tool-evidenced   evidence=[...]
f-001  status=resolved    provenance=tool-evidenced   evidence=[...]
```

projection 的 `apply` 只做 `state.findings.set(record.findingId, record)`——**按 id 覆盖，永不按 seq 并列多条**。这样旧 `open` 记录不会被重新视为当前状态，身份稳定也允许对照实验按 `findingId` 跟踪同一条发现的全过程；不需要 `supersedes` 字段。

**provenance 的语义边界**：

| provenance | 含义 | 第一片是否产生 |
|---|---|---|
| `model-claim` | 模型提出的假设，可以没有证据 | 是 |
| `tool-evidenced` | 有真实工具证据支持（证据存在，不保证结论正确） | 是 |
| `verified` | 经过独立验证的结论（需要额外验证机制） | **否**，留待后续 |

写入路径（唯一）：模型调用 `record_finding` 工具 → `World.record(input)` 校验 → `appendPluginRecord`。

World 的校验（拒绝即返回错误文本给模型，不写日志）：

| 校验 | 规则 |
|---|---|
| evidence 真实存在 | `session.eventAt(seq)` 必须返回事件；`tool-result` 必须 `type === 'tool/result'`，且 `event.data.message.toolCallId === callId`；`file` 只要求 seq 存在 |
| provenance 门槛 | 声明 `tool-evidenced` 时至少 1 条 `tool-result` 证据；没有证据只能是 `model-claim` |
| 状态转移 | `open → confirmed/refuted`（需 `tool-evidenced`）；`confirmed → resolved`（需新的 `tool-evidenced` 证据）；非法转移拒绝 |
| 身份 | 新状态复用已有 `findingId`；新 claim 才分配新 id |
| scope | project 必须等于当前 scoped-fs root；sessionId 必须等于 World 绑定的 session |
| 去重 | 同 scope 下同 claim（规范化后）已有 open/confirmed 记录 → 返回已有 finding，不新建 |

关键语义（写进实现注释）：**`tool-evidenced` 只把「证据存在」变成结构化事实，不把「结论正确」变成事实。** 所以 `confirmed` 的措辞是「有证据支持」，不是「已验证」；`verified` 这一级第一片不实现。


### 2.4 项目归属、证据、状态规则（问题 4）

- **归属**：`project` 取 scoped-fs 的 root（即 `git rev-parse --show-toplevel` 的真实值），不是 cwd。跨 root 的发现不合并；同一个 root 天然稳定。
- **证据**：seq 引用而不是文本引用——日志 append-only，seq 永久有效；重启后仍是同一 seq。
- **状态**：append-only + whole-value。每条新记录携带完整状态（不带 delta），与 `sessionProjections` 的 load-bearing 规则（「a state-carrying log event MUST carry the complete post-change state」）一致；projection 的 `apply` 只做 `state.findings.set(id, record)`。

### 2.4.1 World 如何拿到项目根（问题 4 的接口细节）

**裁决：共享配置 + 启动校验 + fail-closed；模型不能传 project。**

- World 的 Config 增加 `root: string`，与 scoped-fs 的 `root` 在**同一个 `cordis.patch.yml`** 里成对出现（值相同），README 注明两处必须同步；
- World `apply()` 启动时：`realpathSync(config.root)` → `execFile('git', ['-C', root, 'rev-parse', '--show-toplevel'])`，结果存为 `project`；失败则 **fail-closed**：不注册 `record_finding` 工具（或每次调用返回错误），不写任何记录；
- `record_finding` 参数里**没有 project**；`scope.project` 一律由 World 从启动时解析出的 `project` 填充，模型无法通过参数决定归属；
- 一致性：若 `git rev-parse --show-toplevel` 与 `realpath(config.root)` 不同（配置指向仓库子目录），以 **git 根**为准并 warn；记录归属永远用 git 根，与 scoped-fs 的授权目录保持同一语义。

不新增 Service 契约的原因：第一片只有一个 World 消费者，scoped-fs 暴露 Service 需要改动已验收的工具层；共享配置 + 启动校验是更小、可逆的切片。后续出现第二个消费者再抽 Service。

### 2.5 Context 的投放语义（问题 5）

**裁决：每个模型请求都投当前有效的 World 认识；3 条 / 1200 字符是每次请求的预算。**

依据：`dsh-agent-loop/lib/index.js:1053` 每个 step 调 `refreshContext`，World 的 `text` 函数每次请求都会被重新求值（§1.3 实证）。因此不需要 turn 级「已投」标记，也不会出现「step 1 见过、step 2 失去」。

- **同一 turn 的不同 step 都会重新注入**：`text` 每次求值都返回当前有效发现——这是多步推理持续拥有认识材料所必须的成本，接受；
- **同一请求内不重复**：一次请求只组装一次 context，`text` 只调用一次，天然不重复；
- **状态变化立即生效**：下一个请求即拿到最新版本（版本号 = 最新记录的 seq）；
- **重启后正常注入**：state 由 projection 从日志重建，不需要额外标记；
- **预算**：每次请求最多 3 条、总长 ≤ 1200 字符；只投 `open` / `confirmed`，`resolved` / `refuted` 只给计数行；
- **排序**：按「最近状态更新」降序。

**防循环靠两件事**，而不是靠「只投一次」：

1. 每次请求 3 条 / 1200 字符的硬上限；
2. `record_finding` 对同 claim 返回「已存在」，阻止同一结论被反复登记；`status` 推进后 projection 按 findingId 覆盖，只有最新状态可投。

为什么不用「已读标记写回日志」：那会让每次注入都产生新事件，日志膨胀且引入自反馈；按请求注入本身已保证不会无限增长——上限固定、状态覆盖。

**渲染措辞（贯彻「证据存在 ≠ 结论正确」）**：

| status | Context 里的措辞 |
|---|---|
| `open` | 「此前的假设：…（尚未验证）」 |
| `confirmed` | 「此前的判断有工具证据支持，尚未独立验证：…」 |
| `resolved` | 「基于后续证据作出的关闭判断：…」 |

不使用「已证实」「已确认」「问题已解决」这类绝对表述；`resolved` 不保证问题永远不存在。


### 2.6 对照实验（问题 6）

见 §4。

---

## 3. 明确不做

- 不改 Attention / 唤醒条件（下一轮再研究「行动结果改变下一次唤醒」）。
- 不做跨项目的记忆、不做通用记忆框架、不引入数据库。
- 不把 assistant 自由文本直接写进 World 状态；模型必须走 `record_finding`。
- 不修改正式运行的 hikari 实例；所有实验在独立 profile + 独立 sessionId + 独立 patch 下进行。
- 不为了测试强制模型输出预设结论。

---

## 4. 最小验证方案

### 4.1 实验环境

- 独立 patch（`experiments/hikari-feedback-loop/loop.patch.yml`）覆盖：agent-loop `sessionId: session-hikari-loop-a` / `session-hikari-loop-b`、cwd = 临时仓库、scoped-fs root = 临时仓库、system-prompt persona（观察者）、world（新版本，带 findings projection + context）、activation（复用）、replay（复用 v1 的 16 条事件）。
- 临时仓库 `%TEMP%\hikari-feedback-loop\repo`：初始化 git，放一个可读文件 + 一个已知缺陷（比如一段注释与代码不一致的脚本），让发现可被 `project_status` 或 `read` 核验。

### 4.2 三段验证

**A. 写入与持久**

1. 跑 replay，让 agent 观察到一个项目缺陷；
2. 期望：`record_finding` 被调用 → session 日志出现 `plugin:hikari/finding` 记录（用 `pluginRecordOf` 读回验证）；
3. kill 实例 → 重启 → 读同一 session：finding 仍在（lazy fold 重建）；`context()` 在下一 turn 的 `system/message` 里重新出现该发现。

**B. 影响下一次判断**

同一事件的第二轮（replay 重跑一次，或重启后触发同一窗口事件）：
- A 组（注入）：模型提到旧发现 / 不再重复读取同一文件 / step 数下降；
- B 组（不注入，context 返回空）：行为与第一轮一致。

判定用「行为差异」而不是「模型说了某句话」：比较 tool/call 序列（重复路径集合、总 step 数、是否重新调查同一文件）。

**C. 投放语义（防循环）**

连续 5 个 turn、每个 turn 多个 step，观察同一 open finding：

- 同一 turn 的每个 step 的 `system context` 都包含该发现（step 2、3 不丢）；
- 单次请求内该发现只出现一次（不重复渲染）；
- 状态从 `open` 变 `confirmed` 后的**下一个请求**即出现新版本；
- 5 个 turn 后每次请求的 context 总长稳定在 3 条 / 1200 字符预算内；
- `record_finding` 对同一 claim 返回「已存在」而不是新增。



### 4.3 停止条件与审阅点

- A 段通过 = 记录写入 + 重启后可见（硬指标，不依赖模型措辞）。
- B 段通过 = A 组与 B 组在 tool/call 序列上有可量化差异（重复读取次数或 step 数）。
- 若 B 段无差异：**不继续加机制**，先复盘「发现是否真的被注入」（读 `system/message` 原文），再决定是否调整注入位置/长度。

### 4.4 首轮裁决结果（已确认，2026-10-30）

1. **接受 `appendPluginRecord`** —— 满足持久化、隔离对话表面、恢复需求；实验性风险已记录在 §2.1。
2. **保留全部历史发现**（含 `resolved`）—— 历史认识是经历的一部分，不为了控制上下文而删除；由注入规则过滤，而不是裁剪日志。
3. **Context 预算：3 条 / 1200 字符** —— 第一片只验证一个发现，保持最小化。

审阅通过后进入实现；实现范围严格限定在 §2 与 §4.1 描述的三段验证，不扩枝。

---

## 5. 与既有边界的对照

| 既有裁决 | 本设计是否冲突 |
|---|---|
| Session 保存推理与对话历史，World 保存环境状态与判断 | 不冲突：findings 记在 Session 日志的 plugin record 区，投影为 World 状态，对话表面不变 |
| 不新建 Runtime / 长期记忆系统 | 不冲突：没有新 Service 以外的存储，没有数据库 |
| 不把模型自由文本当权威状态 | 不冲突：模型只能通过 `record_finding` 写结构化记录；`tool-evidenced` 要求真实证据 seq，且只表示「证据存在」 |
| Activation 热重载不影响 Agent | 不冲突：World 是独立插件；重载后 state 从日志 lazy fold 重建，无内存标记可丢 |
| 不修改正式实例 | 不冲突：实验在独立 patch/profile 下 |
