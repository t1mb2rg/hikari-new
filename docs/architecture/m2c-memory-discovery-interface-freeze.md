# M2-c · Memory 发现与修订闭环：接口冻结

日期：2026-11-05
前置：`docs/development/m2c-memory-discovery-functional-review.md`（七问七答）、`docs/architecture/m2c-memory-discovery-architecture-review.md`（八条前提对照、D-1..D-7）
本文只冻结实施边界，不重开架构问题。
状态：**冻结候选，待人批准**。批准前不改实现代码。

---

## 1. 冻结面

| 项 | 冻结内容 |
| --- | --- |
| 新增工具名 | `search_memories`、`get_memory` |
| 注册位置 | 新模块 `hikari-native/memory/recall.js`，由 `hikari-native/memory/index.js` 在 `MemoryStore.open` 之后调用（与 `installMemoryWriteTools` 并列） |
| 工具名单 | `hikari-native/memory/tools.js` 的 `MEMORY_TOOL_NAMES` 扩到六个名字 |
| 数据来源 | 只读 `MemoryStore` 的 `all()`、`get()`（`hikari-native/memory/store.mjs:259-265`）；不新增 store 导出、不改 `MEMORY_FIELDS`、不改 `validateRecord`、不改 `append` |
| 返回内容 | 检索只给五键摘要；读取给完整十字段 + 一个派生键 |
| 既有四工具 | `search_memory` / `read_memory` / `write_memory` / `revise_memory` 的 schema、返回、行为**一字不改** |

---

## 2. `search_memories`

```js
{
  name: 'search_memories',
  description:
    'Search your own long-term memories — the ones written with write_memory, across all projects and sessions. ' +
    'Matches the memory text by substring (case-insensitive). Returns short candidates only: id, a snippet, when it ' +
    'happened, an optional validity hint, and whether a later memory already replaced it. Never returns full text — ' +
    'call get_memory with one id to read it completely. Memories with an unknown occurredAt (null) are not matched by ' +
    'a time window. This is a different store from search_memory (World findings for the current project).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query:      { type: 'string', description: 'Words to look for in the memory text. Required.' },
      since:      { type: 'number', description: 'Unix epoch MILLISECONDS; keep memories whose occurredAt is at or after it.' },
      until:      { type: 'number', description: 'Unix epoch MILLISECONDS; keep memories whose occurredAt is at or before it.' },
      headOnly:   { type: 'boolean', description: 'When true, skip memories that a later memory already revised.' },
      limit:      { type: 'number', description: 'Maximum candidates (1-20, default 10). A cap, not a promise.' },
      nextOffset: { type: 'number', description: 'Skip this many matches, to browse further in the same query.' },
    },
    required: ['query'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              memoryId:     { type: 'string' },
              snippet:      { type: 'string' },
              occurredAt:   { description: 'Unix epoch milliseconds, or null when unknown.' },
              validHint:    { description: 'Free-form note about when it was true, or null.' },
              supersededBy: { description: 'memoryId of the memory that revised this one, or null.' },
            },
          },
        },
        nextOffset: { type: 'number', description: 'Pass this back to continue browsing; only present when more matches may exist.' },
      },
    },
    render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: '只读，同步返回对象（与 record_finding 同风格：execute 直接 return）',
}
```

### 2.1 匹配与排序（冻结）

- `query` trim 后必须非空；匹配对象是记录的 `text`，大小写不敏感（两边 `toLowerCase()`），**子串**匹配，不做分词、不做模糊、不做语义。
- `since` / `until` 是**闭区间**，比较对象是 `occurredAt`；`occurredAt === null` 的记录在给出任一界限时都不命中（不知道何时发生，就不该被时间窗挑出来）。
- 两者都给时要求 `since <= until`，否则 `MEMORY_INVALID_RANGE`。
- `headOnly: true` 时排除 `supersededBy !== null` 的记录。
- 排序：`seq` **倒序**（新的在前）。不用 `occurredAt` 排序——它大量为 null。
- `limit` 范围 1–20，缺省 10；`nextOffset` ≥ 0，缺省 0。
- `snippet` = `text` 的前 120 个 UTF-16 码元；若被截断，末尾追加 `…`（不计入 120）。
- `nextOffset` 只在「还有更多可能匹配」时出现；没有更多时不出现这个键（不是给 `null`）。

---

## 3. `get_memory`

```js
{
  name: 'get_memory',
  description:
    'Read one of your long-term memories in full by memoryId, including the memory it replaces (supersedes) and the ' +
    'memory that replaced it (supersededBy), if any. Use search_memories first to find the id; the id is also ' +
    'returned by write_memory and revise_memory. This reads the long-term memory store, not World findings.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      memoryId: { type: 'string', description: 'The memory id, e.g. "m-3f2a…-…".' },
    },
    required: ['memoryId'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        memoryId:    { type: 'string' },
        text:        { type: 'string' },
        occurredAt:  { description: 'Unix epoch milliseconds, or null when unknown.' },
        recordedAt:  { type: 'number' },
        validFrom:   { description: 'Unix epoch milliseconds, or null.' },
        validTo:     { description: 'Unix epoch milliseconds, or null (unknown, not "forever").' },
        validHint:   { description: 'Free-form note, or null.' },
        source:      { description: '{kind, ref} — where this memory came from; ref may be null.' },
        supersedes:  { description: 'memoryId this one replaces, or null.' },
        seq:         { type: 'number' },
        supersededBy:{ description: 'memoryId that replaced this one, or null when this is the current version.' },
      },
    },
    render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
}
```

### 3.1 冻结规则

- 返回**完整十字段**（字段顺序同 `MEMORY_FIELDS`），外加派生键 `supersededBy`。
- 不做传递闭包：只给直接前驱（`supersedes` 指向的那条，仅 id）与直接后继（`supersededBy`）；要沿着链走，模型自己再调一次。
- 不返回邻居的正文。
- 不检查 `source.ref` 是否可达（M2 §6.2：不可达是合法状态）。
- 与 `read_memory` 的区别写进 description：前者读 findings（本 session 日志投影），后者读长期记忆（全局文件）。

---

## 4. 错误码（冻结）

统一 `throw new Error('<CODE>: <可操作消息>')`。错误码放消息前缀，不新建错误类。

| 码 | 触发 | 消息模板 |
| --- | --- | --- |
| `MEMORY_QUERY_EMPTY` | `query` 缺失、非字符串、trim 后为空 | `query is empty; search with the words you are trying to remember.` |
| `MEMORY_INVALID_TIME` | `since`/`until` 不是整数，或为负 | `{field} must be Unix epoch MILLISECONDS, not {got}.` |
| `MEMORY_INVALID_RANGE` | `since > until` | `until {until} is before since {since}.` |
| `MEMORY_UNKNOWN_ID` | `get_memory` 的 `memoryId` 缺失、非字符串、为空，或形如 `m-` 但不存在 | `no memory "{id}"; use search_memories to find one.` |
| `MEMORY_NOT_A_MEMORY` | `get_memory` 收到 `f-` 前缀 | `"{id}" is a World finding, not a memory; use read_memory for findings.` |

约束：

- `MEMORY_UNKNOWN_ID` **可以**引导去 `search_memories`（与 M2-b 的 `MEMORY_SUPERSEDES_UNKNOWN` 不同——那里禁止引导去 `search_memory`，因为那是 findings 检索，方向反了；这里引导是对的）。
- `f-` 前缀的记录一定不在 Memory Store 里，所以先判前缀、再查存在性，两条消息分开。
- 存储层抛错（理论上只读不会）不包装，原样冒泡，避免吞掉真实原因。

---

## 5. 参数规范化（冻结）

顺序：schema → 规范化 → 校验 → 查询。

| 输入 | 规范化 |
| --- | --- |
| `query` | 保留原文用于消息，匹配时两边 `toLowerCase()`；trim 后判空 |
| `since` / `until` | 省略或 `null` → `null`；非 null 时要求非负整数（非整数或负数直接 `MEMORY_INVALID_TIME`，不折叠；记录侧 `hikari-native/memory/store.mjs:125-130` 只接受非负整数） |
| `headOnly` | 省略 → `false`；只接受布尔（`type: 'boolean'`） |
| `limit` | 省略 → `10`；超出 1–20 时**夹到边界**并在结果里按实际条数返回（不报错：这是上限，不是承诺） |
| `nextOffset` | 省略 → `0`；负数 → `0` |
| `memoryId`（get） | trim；空、非字符串或缺失 → `MEMORY_UNKNOWN_ID`（与 §4 触发条件同一口径） |

---

## 6. 不在冻结面内

1. 向量检索、模糊匹配、分词、同义词。
2. 自动注入或自动调用（检索仍由模型发起，M2 §7.3）。
3. 相关性排序（只按 `seq`）。
4. 传递闭包（链的历史全貌）。
5. `source.ref` 可达性检查。
6. 删除、合并、去重、分类、过期判断。
7. `search_memory` / `read_memory` 的任何改动。
8. 反向索引（`supersededBy` 每次现算，O(n)）。

---

## 7. 实现落点（预估，实施后须回填实际行号）

| 段 | 计划位置 | 内容 |
| --- | --- | --- |
| 1 | `recall.js:1-40` | 常量（`SNIPPET_CHARS = 120`、`DEFAULT_LIMIT = 10`、`MAX_LIMIT = 20`） |
| 2 | `recall.js:42-90` | `normalizeSearchInput(args)` |
| 3 | `recall.js:92-150` | `matchMemories(records, input)`（过滤 + 排序 + 切片） |
| 4 | `recall.js:152-200` | `indexSupersedes(records)`（一次性建 `Map<oldId, newId>`） |
| 5 | `recall.js:202-280` | `presentCandidate(record, supersededBy)` |
| 6 | `recall.js:282-400` | 两个工具的 name/description/parameters/output/execute |
| 7 | `recall.js:402-430` | `installMemoryRecallTools(ctx, store)` |

注：行号是**计划值**，实施后必须按实际结果回填（M2-b 的教训：计划行号直接写进验收表会造成文档漂移）。

---

## 8. Contract Creation Gate

实施前必须同时满足：

1. 本文件经人批准（或明确「按此实施」）。
2. `MEMORY_TOOL_NAMES` 扩到六个名字后，`hikari-native/test/memory.test.mjs` 里断言工具顺序的用例要由**五项改成七项**（`record_finding` + 六个记忆工具），卸载/重载用例同步。
3. 新增测试文件 `hikari-native/test/memory-recall.test.mjs`，覆盖 `docs/development/m2c-implementation-task-book.md` 的 12 项验收。
4. 不改 `hikari-native/memory/store.mjs`，不改 `hikari-native/world/findings.js`。
5. 全量 `npm test` 全绿，且 `search_memory` 的结果里仍然没有 `m-` 前缀的 id。

---

## 9. 待人决定

1. **是否按此实施 M2-c**（本文件即实施边界）。
2. **是否需要「跨 session 的修订接力」提示**：当前设计下，模型在新 session 里靠 `search_memories` 找到链头再修订；是否在 `get_memory` 的返回里额外给一句「这是当前版本，可直接 revise_memory」（纯文案，不新增字段）——待定。
