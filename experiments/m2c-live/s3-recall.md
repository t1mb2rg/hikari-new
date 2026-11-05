# s3-recall：会话 B —— 另一个进程里，她找得回上一条记忆吗

**日期** 2026-11-05 · profile `hikari-verify` · `dsh --profile hikari-verify --json "<prompt>"` · 每个会话都是**独立进程**，存储目录同为 `experiments/m2c-live/store`

s2 已在 `memory.jsonl` 留下 1 行（`memoryId` `m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b`、`seq` 1、`recordedAt` 1793842597808、`validHint`「长期有效，除非 writing.js / store.mjs 的修订契约被重新审阅修改。」）。本轮 §3 的对照表就是拿它比的。

## B1：自然问法（不给 memoryId，不提工具名）

prompt：

> 我们之前确认过一条关于 hikari 记忆修订的约定：修订只能改哪一条记录？旧记录会被改动吗？如果你手上有可靠的记录，就按记录回答；如果没有，就直说不确定。只回答问题本身。

session `session-306dce0a-9ae5-406e-8757-b57b51fc0e95`，四次工具调用及其**返回原文**：

| # | 工具 | 参数 | 返回原文 |
| --- | --- | --- | --- |
| 1 | `search_memories` | `{"query":"hikari 记忆修订","limit":10}` | `{"results": []}` |
| 2 | `search_memories` | `{"query":"revise memory 旧记录","limit":10}` | `{"results": []}` |
| 3 | `search_memory` | `{"query":"记忆修订 只能修订哪一条 旧记录是否改动"}` | `{"results": [], "total": 0, "shown": 0, "hasMore": false}` |
| 4 | `search_memories` | `{"query":"记忆 修订 约定","limit":20}` | `{"results": []}` |

第三次用的是 findings 侧的 `search_memory`（返回形状带 `total/shown/hasMore`，与记忆侧的 `{results}` 不同，可据此区分）。从该会话的 reasoning 文本看，她换成本工具的动机是「No memories. Let me search project findings too.」——主动去查 Project findings，而不是把两个近名工具弄混；这条 reasoning 与第 1、2 次调用在同一条 assistant 消息里（session `session-306dce0a…` seq 27），不是"一次失败后另起一步"。

她的最终回答（逐字，按空行分三段）：

> 手上没有那条约定本身的可信记录：我在长期记忆和项目记录里都搜过，没有找到与「hikari 记忆修订」相关的条目，因此关于“我们之前确认过这条约定”这一点，我只能说不确定。
>
> 不过，当前记忆工具的文档对修订机制有一处明确说明：修订只能指定**当前最新版本**的那一条记录（必须以它的 memoryId 为准，已被取代的版本不能再被修订）；旧记录**不会被改动或删除**，它会永久保留，新记录以 supersedes 关系接在它后面。
>
> 这两点中，第一点是我确实查到的工具语义，第二点就是“只补充、不修改”的含义；但它是否就是我们当时共同确认的那条约定，我无法从现有记录中证明。

第二段的关键：她**没有**凭记忆作答，而是明确标出这段来自“记忆工具的文档”（工具描述），并且把“这是不是我们当时确认的那条”留成不可证。也就是说，检索失败时她没有编造，而是降级到工具语义并标注来源。

`memory.jsonl` 在这轮之后仍是 1 行（没有新写入）。

## 为什么没命中：把匹配逻辑单独跑一遍

把 store 与 `recall.js` 的纯函数（`normalizeSearchInput` / `matchMemories` / `indexSupersedes`）拿出来，对同一行记录试不同 query：

| query | 命中数 |
| --- | --- |
| `hikari 记忆修订` | 0 |
| `记忆修订` | 0 |
| `记忆 修订 约定` | 0 |
| `修订` | 1 |
| `链头` | 1 |
| `Hikari` | 1 |
| `Memory` | 1 |
| `记忆` | 0 |

两条成因，都不是实现 bug：

1. **`query` 是单串子串匹配**（冻结面 §2 如此定义）。词序不同、中间隔字、多词用空格连写都不命中。中文自然问法几乎必然踩中。
2. **模型在另一个进程里不可能记住自己上次的措辞**：s2 写的是「Memory 修订约定」，s3 问的是「记忆修订」——同一概念、两种写法。连单独一个「记忆」都命中 0，因为正文里写的是 "Memory"，没有这两个汉字。

## B2：把措辞对上之后（又一个新进程）

prompt：

> 我记得之前留过一条记录，标题大概是「Memory 修订约定」。你帮我把它找出来，告诉我它的 memoryId 和 validHint 原文。

session `session-534c2d6a…`（与 B1 不同的进程），三次调用与返回。下面这段是**事件流里 `tool_result` 的原文**（值未改，只是为了排版把多行 JSON 压平；`get_memory` 的 `text` 过长，中间用 `（…）` 省略，已在 §「与 s2 写入值的并排对照」里与 s2 原文比对过开头与结尾）：

```jsonc
// 1) search_memories {"query":"Memory 修订约定","limit":20}
{"results":[{"memoryId":"m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b",
  "snippet":"Hikari 的 Memory 修订约定（可作为后续讨论的前提，已在源码核实成立）：「修订只能改链头，旧记录永不改」。\n\n核实位置：\n- `hikari-native/memory/writing.js` 的 `assertReviseTa…",
  "occurredAt":null,
  "validHint":"长期有效，除非 writing.js / store.mjs 的修订契约被重新审阅修改。",
  "supersededBy":null}]}

// 2) search_memories {"query":"修订","limit":20}   —— 返回同上一条
// 3) get_memory {"memoryId":"m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b"}
{"memoryId":"m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b",
 "text":"Hikari 的 Memory 修订约定（…）…",
 "occurredAt":null,"recordedAt":1793842597808,
 "validFrom":null,"validTo":null,
 "validHint":"长期有效，除非 writing.js / store.mjs 的修订契约被重新审阅修改。",
 "source":{"kind":"file","ref":"hikari-native/memory/writing.js:253"},
 "supersedes":null,"seq":1,"supersededBy":null}
```

她的最终回答：

> 找到了。
>
> **memoryId**：`m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b`
>
> **validHint 原文**：
>
> > 长期有效，除非 writing.js / store.mjs 的修订契约被重新审阅修改。
>
> 补充说明：
> - 该记忆没有标题字段；你记的「Memory 修订约定」对应正文开头「Hikari 的 Memory 修订约定（可作为后续讨论的前提，已在源码核实成立）：「修订只能改链头，旧记录永不改」」。
> - 该条未设置 `occurredAt` / `validFrom` / `validTo`，`supersedes` 与 `supersededBy` 均为空，即当前仍是最新版本，没有被后续修订覆盖。
> - 来源标注为文件 `hikari-native/memory/writing.js:253`。

## 与 s2 写入值的并排对照

| 字段 | s2 的 `write_memory` 入参 / 落盘行 | B2 的 `search_memories` snippet / `get_memory` | 一致 |
| --- | --- | --- | --- |
| `memoryId` | `m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b` | 同 | ✅ |
| `validHint` | `长期有效，除非 writing.js / store.mjs 的修订契约被重新审阅修改。` | 同（B2 回答里逐字引用） | ✅ |
| `recordedAt` | `1793842597808` | 同 | ✅ |
| `seq` | `1` | 同 | ✅ |
| `source` | `{"kind":"file","ref":"hikari-native/memory/writing.js:253"}` | 同 | ✅ |
| `occurredAt`/`validFrom`/`validTo` | 均 `null` | 均 `null` | ✅ |
| `snippet` | 正文前 120 个 UTF-16 码元 + `…` | 用 node 复算 `row.text.slice(0,120) + "…"` 与该 snippet **逐字相等**（`text.length` 954） | ✅ |
| `supersededBy` | （写入时不返回） | `null` | ✅（未被修订） |

## 读数怎么算

- 预测「`search_memories` 首次调用即命中上一 session 的 memoryId，snippet 与 s2 正文前 120 字一致」：**B1 不符**（三次记忆侧调用全空），**B2 符合**——但 B2 的 prompt 里已经写出正文短语「Memory 修订约定」，等于给了检索词，条件与 B1 不同。
- 跨进程读通路的**机制**成立：同一份 `memory.jsonl`、另一个进程、不预先给 memoryId（B2 只用正文短语），`search_memories` + `get_memory` 取回原记录、`validHint` 原文与派生关系，逐字段与 s2 落盘值一致。
- 但“自然问法能不能找回来”取决于 query 是否与正文逐字重合——这是 `query` 语义的直接后果，已作为未解释项登记（`u-xpsedh`），留给 M2-d 判断（分词/多词与/别的手段）。

## 旁证

- 第三次调用的是 findings 侧 `search_memory`，它的返回形状（`total/shown/hasMore`）与记忆侧 `{results}` 不同，工具名相近但返回可区分；她的 reasoning 显示这是主动扩大搜索面。
- B2 里她在 `get_memory` 之前又做了一次 `search_memories` 复核，说明五键返回对“确认是哪一条”够用。
