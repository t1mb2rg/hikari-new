# P4：工具结果回到下一次模型推理，并进入 DSH Session 历史

**判定：PASS**

## 1. Session 里到底落了什么

`p3-session.jsonl`（由 `dump-session.mjs` 从 `session.v4.jsonl.zstd` 解出 12 个 zstd 帧、28 行事件）。与本项判据直接相关的四行：

| seq | type | 关键内容 |
| --- | --- | --- |
| 18 | `assistant/message` | 第 1 步的推理文本：`I should use peek_desktop …` |
| 19 | `tool/call` | `callId=call_00_4ECiE9KX5Oy2GSzOtix05990`、`name=peek_desktop` |
| 20 | `tool/result` | `callId` 与上一条相同，`message.role=tool`，`source.kind=tool` |
| 21 | `step/end` | 第 1 步结束 |

第 2 步的 `step/start`（seq 22）之后是 `assistant/message`，其推理内容逐字引用了工具返回的 `title`／tick 数——这就是「结果回到下一次模型推理」的落盘证据。

## 2. 三个「进了历史」的事实

1. **工具调用本身进了历史**：`tool/call` 是 session 事件，不是内存里的临时对象；`callId` 与 `tool/result` 严格对应。
2. **工具结果进了历史**：`tool/result` 携带完整的 Hikari `peek()` 返回值（含 `snapshotAt`、`source`、`observedAt`），可直接从 session 复原。
3. **模型对结果的解释进了历史**：第 2 步的 assistant 消息里有对 `title` 与 tick 差的解读——所以「模型看到了什么、据此说了什么」是同一条链上的两段，而不是分开的两份记录。

## 3. 一处如实记录的限制

DSH 的 session 里 `usage` 显示第 2 步 `inputTokens=238`、`cacheReadTokens=7424`。这说明第 2 步的请求是把「system + 用户消息 + 工具调用 + 工具结果」整段重发的，而不是把结果追加成一个新的独立上下文。这一点对本项判据没有影响（结果确实进入了下一次推理），但它意味着：**「历史」在 DSH 里是会话级重放，不是 Hikari Chronicle 那种可被独立检索的事实库**。跨会话能不能查回来，不在 PoC-01 判据内，本轮没有验证。

## 4. 产物

- `p3-session.jsonl`（28 行）、`p5-session.jsonl`（21 行）
- `dump-session.mjs`（复现用：`node dump-session.mjs <xxx.jsonl.zstd> out.jsonl`）
