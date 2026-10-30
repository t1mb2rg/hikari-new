# C-03 · 取证工具修正报告（tool-evidence-fix）

> 状态：第一阶段交付，停在审阅点。未进入正式实现，未改正式运行实例。
> 范围：把「历史检查范围」从模糊文本变成**可配对、可校验、可复核**的结构化证据。
> 材料：`c03/tools/tool-evidence.mjs`、`c03/tools/tool-evidence.test.mjs`、`c03/tools/extract-samples.mjs`、`c03/analysis/samples-fb2.json`。

## 1. 为什么要修

C-02 的 v1 readscope 记录的是「模型调用过 read 的文件」，不是「实际打开了哪些行、是否成功、结果是否来自这个调用」。这会直接污染 C-03 的自变量：如果 B 组拿到的「检查范围」本身不可信，实验测到的差异就无法归因。

本报告逐条列出已知缺陷、修正方式与验证证据。

## 2. 缺陷 → 修正对照

| # | C-02 缺陷 | 修正 | 代码位置 | 对应测试 |
|---|---|---|---|---|
| 1 | 只记 `tool/call`，不配对 `tool/result`；被拒绝的读取也计入「已检查」 | 严格按 `callId` 配对 call/result；只有 `isError === false` 且内容非空的调用才算成功 | `pairToolEvents()`、`classify()` | `refused read is classified as denied...`、`call without result stays pending` |
| 2 | 只记文件路径，忽略 `offset` / `limit` | 解析 read 的 `file_path` / `offset` / `limit`，并从返回文本的行号前缀（`N: `）反推实际返回范围 | `readRangeOf()`、`observedRangeOf()` | `success pair: observed range matches...`、`success pair with offset: first rendered line number is offset+1` |
| 3 | 不区分错误与成功 | 成功 / 越界拒绝 / 其他错误 / 未配对（pending）四态；拒绝与错误单列，不并入已检查 | `classify()`、`inspectedDigest()` | `other tool error is classified as error`、`refused read ... never counts as inspected` |
| 4 | 不区分工具；`grep` / `glob` 的结果被当作文件读取 | 只有 `name === 'read'` 且有 `file_path` 的调用才有可校验范围；其他工具返回 `unknown` | `readRangeOf()` | `readRangeOf stays unknown for non-read tools and missing path` |
| 5 | Finding 的 evidence 在找不到精确匹配时回退到「最近一次成功调用」，导致证据指针指向错误调用（C-02：f-002 的 resolved 记录挂的是它自己的 refute 结果） | 只按 `callId` / `seq` 精确匹配；不匹配 → `unknown`；匹配到非成功调用 → `invalid`；**绝不回退** | `resolveFindingEvidence()` | `resolveFindingEvidence never falls back...`、`...marks evidence pointing at a refused call as invalid` |
| 6 | 未配对的 call 被静默丢弃 | 未配对标 `pending`；没有 call 的 result 单独进 `orphanResults`，不吸附到最近的 call | `pairToolEvents()` | `result without call is an orphan...` |
| 7 | 分析脚本用渲染文案（正则匹配「此前的假设」）判断 findings 是否进入请求，措辞一改就静默归零 | 结构性判定：从请求的 `messages` 中按 `source` / 消息角色统计；本报告只修取证层，分析脚本的对应修正列入 C-03 第二阶段 | —（第二阶段） | — |

## 3. 事件结构实证

来自 `session-hikari-fb2` 的真实事件（不是文档推断）：

```json
// tool/call  seq=18
{ "type": "tool/call", "seq": 18, "time": 1793295…,
  "data": { "turn": 1, "step": 1,
            "callId": "call_00_N5APBSbNieHtfzAzCn186953",
            "name": "working_directory",
            "arguments": "{}" } }

// tool/result  seq=19
{ "type": "tool/result", "seq": 19, "time": 1793295…,
  "data": { "turn": 1, "step": 1,
            "message": { "role": "tool",
                         "source": { "kind": "tool", "callId": "call_00_N5APBSbNieHtfzAzCn186953" },
                         "toolCallId": "call_00_N5APBSbNieHtfzAzCn186953",
                         "content": [{ "type": "text", "text": "G:\\work\\LAB\\code\\projects\\own\\hikari-new" }],
                         "isError": false,
                         "id": "…" } },
  "sourceEventSeqs": [18], "surfaceOp": "append" }
```

要点：

- `arguments` 是 **JSON 字符串**；解析失败时保留原始字符串但 `args` 为 `undefined`，不猜测。
- call/result 的关联键是 `message.toolCallId`，不是 `sourceEventSeqs`（后者是 surface 溯源，不能当配对依据）。
- `isError` 只在 result 上，且拒绝读取也走 `isError: true`，因此不能靠错误码区分「越界」与「文件不存在」，必须读错误文本（当前用 `scoped-fs:` / `outside the authorized directory` 前缀）。

## 4. 真实三态样例（`c03/analysis/samples-fb2.json`）

来源：`session-hikari-fb2`，689 个事件、93 次工具调用。

| 类别 | 数量 | 样例 |
|---|---|---|
| success | 92 | `read docs/development/hikari-native-handoff.md`（callSeq 34）→ 返回 98 行，首行 1、末行 98，`matchesRequest: true` |
| denied | 1 | `read C:\Users\…\AppData\Local\Temp\hikari-feedback-loop\requests-fb2.jsonl`（callSeq 355）→ `Error: scoped-fs: "…" is outside the authorized directory`，判定 `not-inspected` |
| error | 0 | 真实数据中无此样例；由测试合成覆盖 |
| pending | 0 | 真实数据中无此样例；由测试合成覆盖 |
| orphan results | 0 | 真实数据中无此样例；由测试合成覆盖 |

注意：真实 fb2 中**绝大多数成功调用是 read**（92/93），拒绝样本只有 1 条——这是 C-02 里 agent 有一次读取 `%TEMP%` 下请求日志被 scoped-fs 拒绝留下的。error / pending 没有真实样本，是这批数据的限制，不是分类器缺陷。

## 5. 测试

`node --test c03/tools/tool-evidence.test.mjs` → **15/15 通过**。

覆盖：成功配对 + 行号校验、offset 起始行、返回范围与请求不一致的上报、越界拒绝、其他错误、未配对、孤立 result、非 read / 缺路径的 unknown、空证据 unknown、空 content unknown、evidence 精确匹配不回退、拒绝证据标 invalid。

## 6. 已知限制

1. **范围反推依赖渲染格式**：当前从 `N: text` 行号前缀解析；如果渲染格式变化（例如不编号），`observedRangeOf` 会降级为 `unknown` 而不是误报。
2. **只支持 `read`**：`grep` / `glob` / `project_status` 等的返回无法给出「行范围」，一律 `unknown`，不会伪装成已检查。
3. **不判断内容正确性**：分类器只回答「这次调用是否成功、打开了哪一段」，不回答「结论是否正确」。
4. **error / pending 无真实样本**：合成测试覆盖逻辑，但真实运行中的错误形态可能更复杂（例如部分内容 + 错误）。
5. **c03 分析脚本尚未改用结构化判定**：见缺陷 #7，属于 C-03 第二阶段。

## 7. 与 C-03 协议的关系

本修正只提供**测量工具**，不改变正式插件（`hikari-native/readscope`、`world/findings.js`、`cordis.patch.yml` 均未改）。C-03 的 B 组将使用 `hikari-native/readscope-v2`（实验插件），以本报告的配对/校验逻辑生成「历史检查范围」摘要；A 组不加载该插件。协议见 `c03/protocol.md`。
