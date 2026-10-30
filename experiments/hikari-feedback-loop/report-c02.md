# Hikari Native · C-02 历史证据利用行为诊断

> 状态：实验完成，报告待裁决。本轮**不进入修复**。
> 实验实例全部使用 `--patch` 覆盖，端口 3090；正式实例（3080）全程未动。
> 日期：2026-10-30

## 0. 摘要

**结论先行：三个候选原因里，①「DSH 没有向模型提供历史证据」被排除；②「Finding 没有准确描述历史证据的覆盖范围」与 ③「模型拿到证据仍选择重读」都有直接证据；④「为了确认文件变化」只被部分观察到，且 D 组实验本身被夹具污染。**

关键数字：

| 组 | session | 请求 | messages | tool/result 条数 | Finding 注入消息 | 最长单条 tool/result |
|---|---|---|---|---|---|---|
| A（无 readscope） | session-hikari-fb2 turn 8 | #1 | 151（system 1 / user 29 / assistant 54 / tool 67） | 67 | 17 | 49,932 字符 |
| B（readscope） | 同上 turn 9 | #1 | 164（1 / 32 / 58 / 73） | 73 | 19 | — |
| C（关注入） | 同上 turn 10+ | #1 | 192（1 / 41 / 68 / 82） | 82 | 25 | — |
| D（改文件） | 同上 turn 11+ | #1 | 216（1 / 48 / 76 / 91） | 91 | 25 | — |

> 注：A/B/C/D 是**顺序施加**在同一 session 上的四组条件，不是四个独立 session。这一点本身成为混杂因素（见 §5.1）。

## 1. 方法与材料

- 请求取证插件：`hikari-native/trace/index.js`（`llm/stream` waterfall 拦截，逐请求落 JSONL）。
- 四组覆盖 patch：`loop4-trace.patch.yml`（A）、`loop5b-readscope.patch.yml`（B）、`loop6-c-noinject.patch.yml`（C）、`loop7-d-change.patch.yml`（D）。
- 分析脚本：`analyze-requests.mjs`（请求摘要）、`analyze-calls.mjs`（按 turn 聚合调用）、`session-tail.mjs`（解压 session 尾部）。
- 实验 session：`session-hikari-fb2`（`%USERPROFILE%\.dsh\sessions\--G-work-LAB-code-projects-own-hikari-new--\session-hikari-fb2`）。
- trace 原始文件在 `%TEMP%\hikari-feedback-loop\requests-fb2*.jsonl`（约 0.5–1.3 MB/文件），**不提交**，只提交分析脚本与 patch。

## 2. 第一阶段：真实请求链路（直接观察事实）

### 2.1 请求在哪里发出

`@deepseek-ai/dsh-agent-loop/lib/index.js`：

- `step()`（:1043-1173）：每个 step 先 `prepareRequest(turn, step, signal)`（:1052），再 `systemPrompt.refreshContext(...)` 重新求值全部动态 context（:1053），然后 `buildRequest(...)`（:1075），最后 `preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)`（:1084）。
- `buildRequest()`（:1214-1289）：写好 `request/header`、`request/context` 事件，然后 `const boundaryMessages = session.deriveMessages()`（:1274），返回 `Object.freeze({ ...header.config, messages: boundaryMessages, toolHistory: session.toolHistory(), tools, sessionId, signal })`。
- `@deepseek-ai/dsh-llm/lib/index.js`：`stream()`（:2393-2395）→ `streamWithRegistration()`（:2396-2398）→ **`ctx.waterfall(this, "llm/stream", options, () => adapterStream(...))`**——这是官方拦截点，trace 插件挂在这里。

**结论（事实）**：发往 provider 的请求对象由 `session.deriveMessages()` 全量派生，历史 user / assistant / tool 消息都在，没有 DSH 侧裁剪层。`llm/stream` 在发送前同步可拦截，无采样、无缓冲。

### 2.2 历史证据是否真的在请求里

A 组 request #1（turn 8）：

- `tool/result` 消息 67 条；其中最大一条 49,932 字符、其次 17,912 / 13,839 / 11,040。
- Finding 注入消息 17 条（`[Hikari 当前认识（来自本项目的持久发现）]` + 最多 3 条 + `已闭合 N 条`）。
- `tools` 数组 6 个（glob / grep / project_status / read / record_finding / working_directory）。

**结论（事实）**：模型侧确实收到了完整历史工具结果与 Finding 上下文——**候选原因 ① 排除**。

### 2.3 Finding 注入了什么、没注入什么

注入文本只含：`findingId · 措辞`、claim、状态、provenance、evidence 指针（seq/callId）。不含：读了哪些文件、读到哪一段、当时文件内容摘要。

**结论（事实）**：Finding 记录的是"结论 + 证据指针"，不是"检查范围"——这就是候选原因 ② 的结构性来源。

### 2.4 已闭合 Finding 不进入上下文

`renderFindings()` 只渲染 `open` / `confirmed`；`resolved` / `refuted` 只在末尾计数（`已闭合 N 条`）。

**结论（事实）**：同一历史发现不会以完整文本重复进入上下文——候选原因 ④ 中"反复注入"这一半被排除。

## 3. 重复读取的直接证据（turn 4 / turn 5）

fb2 的调用序列（来自 `analyze-calls.mjs`）：

- turn 4：`read findings.js (offset 318)`、`read 设计文档`。
- turn 5：`read findings.js (offset 120)`，随后写 f-009。
- 两次都在 context 含 f-001..f-008 的情况下发生。
- assistant reasoning 原文（turn 5）："text identical to my 00:40 read"。

**观察（事实）**：模型明确知道内容与之前一致，仍重新读取，并在 reasoning 里承认这一点。

三种重复情况判定：

| 情况 | 判定 | 依据 |
|---|---|---|
| 同一文件反复读取 | 部分存在 | 有全读 + 片段精读（offset 120/240/318），不是同区域机械重复；含新调查目的 |
| 同一 Finding 反复登记 | 不存在 | `deduplicated: true` 生效（turn 6 的 f-010 去重实验） |
| 已有证据仍重复调查 | 存在 | turn 4/5 在 context 含 f-001..f-008 时重读 findings.js |

## 4. 第二阶段：A / B / C / D 实验

### 4.1 B 组：中性"已检查文件"摘要（readscope）

- readscope context 确认进入请求（`本会话已检查过的文件（最近在前，仅记录，不含内容）` + 12 条 `path（offset，limit）`），trace 中 6 次命中。
- B 组 request #1：readCalls=30（A 组 27；多出的 3 条是 turn 8 新增的历史读取，不是 turn 9 重读）。
- turn 9 自身新增读取：`hikari-native/scoped-fs/index.js`（此前未读的新文件）。

**推论（弱）**：本轮没有观察到"readscope 减少重读"的直接证据，因为 turn 9 的读取对象本来就换了（转向新插件）。样本仅 1 turn，不足以归因。

### 4.2 C 组：保留历史、关闭 Finding 注入

- 配置 `hikari-world.config.injectContext: false`。
- 结果：新注入消失（findingMessages 不再随 turn 增长，稳定在 25），但**历史 user 消息里仍带着前几轮注入的 Finding 文本**——它们是已提交的 session 历史，不会被"关闭注入"移除。
- agent 自己发现了这一点并记录："C 组测的是『结构化注入在完整 transcript 之上还有没有增量』，不是『有没有旧记忆』"。

**结论（事实）**：C 组不是"无记忆"对照。若要真正的"无记忆"基线，需要新 session。

### 4.3 D 组：两次观察之间真实改文件

- 操作：在 fb2 session 上继续，findings.js 末尾追加 `// D-group change marker <时间>`，再触发 replay 事件。
- 结果：agent 读到 `loop7-d-change.patch.yml`（说明文件在可读 root 内），先知道"会在末尾加 marker"，再读 `findings.js (offset 378)` 确认 marker 在 :383。
- agent 自己记录了夹具污染："D 组的操作说明写在 loop7-d-change.patch.yml 里……于是『是否注意到变化』这个观测值被夹具自己污染了"。

**结论（事实）**：D 组没有测到"文件变化后是否主动重新调查"，因为夹具说明文件本身在可读范围内，agent 先看到了预期。

## 5. 混杂因素（多数由 agent 自己在 reasoning 中指出）

### 5.1 顺序效应

agent 原文："跨运行比较注入条件时，条件是按顺序施加的而我的知识在累积：同一个事件 1，第一次运行我读了七八个文件，后面几次只做一两个定点核对——§4.2 B 量到的差异里混着学习/顺序效应，不只是注入。"

**推论（强）**：A/B/C/D 共用同一 session 的设计下，"注入条件"与"session 知识量"完全共线，无法分离。

### 5.2 C 组语义

见 §4.2。关闭注入不等于移除历史消息。

### 5.3 D 组夹具污染

见 §4.3。实验操作说明放在可读 root 内。

### 5.4 readscope 的已知实现缺陷（agent 指出）

readscope 只监听 `tool/call`，不配对 `tool/result`：被 scoped-fs 拒绝的读取（`%TEMP%\hikari-feedback-loop\requests-fb2.jsonl`）也会被记为"已查看"。

### 5.5 evidence 自动补全的选错风险（agent 指出）

`record_finding` 的 tool-evidenced 自动补全取"最近一次成功的工具调用"作为证据；f-002 的 resolved 记录因此挂上了它自己的 refute 结果（seq 369），而不是据以判断的那段代码。

## 6. 结论

### 6.1 直接观察事实

1. DSH 把完整历史（67–92 条 tool/result，最大单条 49,932 字符）与 Finding 上下文都放进了请求，无裁剪。
2. Finding 只记录结论 + evidence 指针，不记录检查范围（文件/偏移/内容）。
3. 模型在明确知道"内容相同"（reasoning 原文 "text identical to my 00:40 read"）时仍会重读。
4. 关闭 Finding 注入不会移除历史消息里已存在的 Finding 文本。
5. 同一 session 顺序施加 A/B/C/D 会产生顺序效应（agent 自己指出）。
6. D 组的操作说明文件在可读 root 内，污染了"是否注意到变化"的观测。

### 6.2 实验推论

1. 重复读取的**结构性原因**是 Finding 缺少"检查范围"维度：模型无法从 Finding 判断"这个结论覆盖了文件的哪一段"，因此用重读来确认。
2. 模型**不是完全没有利用历史**：turn 2 用真实 tool evidence 推进 f-002/f-003，说明"看到历史 → 用证据推进"通路存在。
3. readscope 这一片（中性范围摘要）在单 turn 内没有观察到明显减重读效果，但读的对象换成了新文件，**不能据此判定无效**。

### 6.3 未确定解释

1. 重读究竟有多少是"确认覆盖范围"、多少是"确认文件未变"、多少是"探索新方向"——现有数据没有可分离的标注。
2. 若 Findings 增加"检查范围"字段，模型是否真的会减少重读——未实验。
3. 顺序效应在独立 session 设计中是否消失——未实验。

### 6.4 对设计的影响（只记录，不实施）

1. Finding 的 schema 可能需要 `scope`（读过哪些文件/偏移/内容摘要）——这正是 C 段第一批取证时提出的方向 B。
2. 对照实验必须用**独立 session**，且夹具说明不能放在被测 agent 可读的 root 内。
3. C 段的"关闭注入"若要成立，需要新 session 作为基线。

## 7. 材料清单

| 文件 | 用途 |
|---|---|
| `hikari-native/trace/index.js` | `llm/stream` 拦截式请求取证（实验插件） |
| `hikari-native/readscope/index.js` | 中性"已检查文件"摘要（实验插件） |
| `experiments/hikari-feedback-loop/loop4-trace.patch.yml` | A 组 |
| `experiments/hikari-feedback-loop/loop5b-readscope.patch.yml` | B 组 |
| `experiments/hikari-feedback-loop/loop6-c-noinject.patch.yml` | C 组 |
| `experiments/hikari-feedback-loop/loop7-d-change.patch.yml` | D 组 |
| `experiments/hikari-feedback-loop/analyze-requests.mjs` | 请求级分析 |
| `experiments/hikari-feedback-loop/analyze-calls.mjs` | turn 级调用分析 |
| `experiments/hikari-feedback-loop/session-tail.mjs` | session 尾部解压查看 |
| `%TEMP%\hikari-feedback-loop\requests-fb2*.jsonl` | 原始 trace（不提交） |
