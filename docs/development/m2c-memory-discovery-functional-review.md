# M2-c Functional Review：记忆发现与修订闭环

> 基线：`main` @ `7032589`。事实依据全部取自 `experiments/m2c-code-facts.md`（每条都带 文件:行号）。
> 本文回答「做成什么样」，不做架构取舍结论（留给 Architecture Review），也不改代码。
> 状态：待人工审阅。

## 0. 七个问题，七句话

| # | 问题 | 答案 |
| --- | --- | --- |
| Q1 | 发现入口是什么 | 两个新只读工具：`search_memories` 与 `get_memory`；既有四个工具一字不改 |
| Q2 | 按什么匹配 | 正文子串（大小写不敏感）+ 可选时间窗 + 可选「只看链头」；排序按 `seq` 倒序 |
| Q3 | 检索结果带什么 | 每条 5 个键：`memoryId`、`snippet`、`occurredAt`、`validHint`、`supersededBy` |
| Q4 | 怎么完成修订闭环 | 检索 → `get_memory` 读全文与链邻居 → `revise_memory`；链头判定沿用 M2-b 的 `MEMORY_SUPERSEDES_NOT_HEAD` |
| Q5 | 已被修订的记录怎么呈现 | 照样出现在结果里，但带 `supersededBy`，并提示「修订请指向后继」 |
| Q6 | 来源怎么处理 | 检索不返回 `source`（它不在判断新旧关系的最小集里）；`get_memory` 返回，供模型判断是否沿用 |
| Q7 | 边界在哪 | 只读、只由模型发起、不注入、不自动提取、不判定过期；检索不写任何东西 |

## 1. 命名与作用域（Q1）

- [事实] 现有 `search_memory` / `read_memory` 检索的是 findings（`hikari-native/memory/tools.js:62-64`、`:109-111`），finding id 是 `f-`（`hikari-native/world/findings.js:68` 的 `FINDING_ID_PATTERN`），Memory id 是 `m-<uuid>`（`hikari-native/memory/store.mjs:44`）。
- 决定：新增 `search_memories`、`get_memory` 两个只读工具，注册在 `hikari-native/memory/` 的写工具同一模块名下（同一 fiber，卸载一起消失）。
- 为什么是「新增」不是「扩 `search_memory`」：扩作用域会改变一个已冻结工具的输出形状（同一个 query 可能返回两套 id），而 M2-b 的验收第 12 项明确要求「检索结果里没有 `m-` 记录」。改它等于把那条断言推翻，代价大于多两个工具。
- 命名风险的诚实说明：`search_memory`（单数、findings、本会话）与 `search_memories`（复数、长期存储、跨会话）只差一个字母，`read_memory` 与 `get_memory` 也只差一个动词。缓解只能靠 description 首句：
  - `search_memory`：「Findings recorded in this session…」
  - `search_memories`：「Long-term memories, shared across sessions and projects…」
  这是已知的、可接受的混淆成本；重命名既有工具属另一件事，不在本片。

## 2. 匹配语义（Q2）

`search_memories` 的参数：

| 参数 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `query` | string | 是 | 正文子串，大小写不敏感；空串不合法 |
| `since` | number | 否 | Unix epoch 毫秒下界（按 `occurredAt`；`occurredAt` 为 null 的记录**不**命中时间窗） |
| `until` | number | 否 | 上界，含边界 |
| `headOnly` | boolean | 否 | 只返回未被任何记录 `supersedes` 的链头 |
| `limit` | number | 否 | 1–20，缺省 10 |
| `nextOffset` | number | 否 | 下一页起点（0 起） |

- 匹配范围：只匹配 `text`。不匹配 `validHint`、不匹配 `source.ref`——两者都可能很长，且 `validHint` 是自然语言，匹配它会让「为什么这条回来」不可解释。
- 排序：`seq` 倒序（最新写入在前）。**不用 `occurredAt` 排序**：它大量为 null（模型没有时钟，`docs/architecture/cognition-action-loop-v0-boundary-review.md:68`），null 排前还是排后都属于工程替模型做判断。
- 为什么需要 `headOnly`：修订后旧记录仍在（append-only），不筛会让同一件事出现两三次，模型容易改到旧的那条（这正好是 M2-b 的 `MEMORY_SUPERSEDES_NOT_HEAD` 要防的）。
- 时间窗缺失即不过滤；`since > until` 报 `MEMORY_INVALID_RANGE`（复用 M2-b 的错误码族）。

## 3. 返回什么（Q3）

每条命中返回五个键：

```json
{ "memoryId": "m-…", "snippet": "…", "occurredAt": 1730000000000, "validHint": "2026-10 前后", "supersededBy": null }
```

- `snippet`：`text` 的前 120 个 UTF-16 码元，超出加 `…`。不返回全文——全文可能 4000 字符，10 条就 4 万。
- `occurredAt` / `validHint`：原样返回，不做格式化（M2 架构 §5.4：渲染不排序、不标「已过期」）。
- `supersededBy`：链上后继的 `memoryId`，没有则为 null。**这是闭环的关键**——有它就等于告诉模型「该修订谁」。
- 顶层返回 `{ results: [...], nextOffset?: number }`——**唯一形状以冻结面 §2 为准**，这里只解释语义、不另立一份。`nextOffset` 只在「还有更多可能匹配」时出现；不设 `total`：模型要的是「还能不能往下翻」，不是总数，省一次全量计数。
- 不返回：`recordedAt`（写入时刻，与判断新旧无关）、`seq`（内部序号）、`source`（见 Q6）、`text` 全文（见上）。

`get_memory` 的参数只有一个 `memoryId`，返回：

```json
{ "memoryId": "m-…", "text": "…", "occurredAt": …, "recordedAt": …, "validFrom": …, "validTo": …, "validHint": …, "source": {…}, "supersedes": "m-…" | null, "seq": 12, "supersededBy": "m-…" | null }
```

- 返回完整十字段 + 两个链邻居（前驱/后继各一个，**不做传递闭包**：M2 架构 §10.1 风险表明确 M2 不做多跳，读一条就是一条（`docs/architecture/memory-core-m2-architecture-v0.1.md:383`））。
- 为什么 `get_memory` 返回全部而 `search_memories` 只返回五个键：搜索是「找候选」，读是「做判断」。判断要全文、要来源、要链上位置。

## 4. 修订闭环（Q4）

1. 模型用 `search_memories` 找一个话题的候选（必要时 `headOnly: true`）。
2. 对某条用 `get_memory` 读全文与链邻居。
3. 判断：保留（什么都不做）/ 补充（`write_memory` 写新的，不动旧的）/ 修订（`revise_memory` 指向 `memoryId`）。
4. 若目标是旧记录，`revise_memory` 报 `MEMORY_SUPERSEDES_NOT_HEAD` 并给出后继 id（M2-b 已实现，`hikari-native/memory/writing.js:276`），模型据此后改指向链头。
5. 修订成功后，新记录的 `memoryId` 出现在返回值里，模型可以继续引用。

- 闭环里没有任何一步需要工程替模型判断「该不该修订」——判断留给模型，工程只保证「修订指向链头、旧行不动、id 可核」。
- 不提供 `delete`、不提供批量修订、不提供「合并两条记忆」。

## 5. 已被修订的记录（Q5）

- 它们照样出现在检索结果里（历史可查，M2 §6.3「旧记录不删除」），但携带 `supersededBy`。
- `headOnly: true` 时它们不出现。
- 错误信息与检索结果必须指向**同一个后继 id**，避免模型在两条信息之间来回试。

## 6. 来源（Q6）

- `search_memories` 不返回 `source`：检索是「这话题以前记过什么」，来源属于「这条可不可信」的判断，读全文时再给。
- `get_memory` 返回 `source` 原样（含 `kind` / `ref`），不做可达性检查——M2 架构 §6.2：不可达是合法状态。
- 修订时不继承来源（M2-b 已冻结）：`revise_memory` 不接受 `source` 参数，新记录落 `{kind:'unknown', ref:null}`，除非模型显式再传（等价于它自己判断过）。

## 7. 边界（Q7）

| 前提 | 本片如何遵守 |
| --- | --- |
| 不自动注入 | 两个新工具只在模型调用时执行；不注册 `systemPrompt.context()` |
| 不自动提取 | 检索幂等、不写盘；只有写工具能改变存储 |
| 不自动判断过期 | 不按 `validTo` 过滤；`since`/`until` 只看 `occurredAt`，且 null 不命中时间窗（不猜） |
| append-only | 检索与读取都不触碰 jsonl |
| World Findings 所有权不变 | Memory 侧不读 findings；`search_memory`/`read_memory` 一行不改 |
| 跨项目、跨 Session | 检索对象就是全局 `memory.jsonl`，天然跨项目 |

## 8. 错误契约（新增部分）

| 码 | 触发 | 消息要点 |
| --- | --- | --- |
| `MEMORY_QUERY_EMPTY` | `query` 为空或全空白 | 「说点什么」——不猜 |
| `MEMORY_INVALID_TIME` | `since`/`until` 非整数或负 | 与写入侧同口径（Unix epoch 毫秒） |
| `MEMORY_INVALID_RANGE` | `since > until` | 给出两个值 |
| `MEMORY_UNKNOWN_ID` | `get_memory` 的 id 不存在 | 「没有这条；先用 search_memories 找」 |
| `MEMORY_NOT_A_MEMORY` | `get_memory` 传了 `f-` 前缀 | 与 M2-b 的 `MEMORY_SUPERSEDES_NOT_MEMORY` 同口径 |

## 9. 验收

唯一清单在 `docs/development/m2c-implementation-task-book.md` §4（12 项 → 测试名 → 落点）；`docs/architecture/m2c-memory-discovery-interface-freeze.md:208` 指的也是这份。本节不再另列一套，避免两处口径漂移。

本评审在提问过程中强调、而初版表里没有单列的两种行为，已并入该表：

| 本评审的要求 | 并入 task-book 的哪一项 |
| --- | --- |
| 无关 query 不命中（返回空集，不是「最相近的结果」） | 第 2 项 |
| 检索只读：前后 `memory.jsonl` 字节不变、`store.size` 不变 | 第 10 项 |

## 10. 尚未解决

- 命名混淆（`search_memory` vs `search_memories`）：本片接受，靠 description 区分。
- 检索规模：`store.all()` 是 O(n) 全量物化（`hikari-native/memory/store.mjs:259`），本机规模小可接受；何时需要索引，留给以后用真实数据说话。
- 模型无时钟：`since`/`until` 模型多半填不出来，实际可能只用 `query`。这是已知局限，不靠改工具解决。
