# M2-e 冻结面：被拒写入的留痕（`memory.rejections.jsonl`）

- 日期：2026-11-05
- 状态：**已定范围并实施**（范围由人在 2026-11-05 批准：「只做被拒留痕、独立文件」）
- 前置：`docs/architecture/m2e-memory-governance-boundary-draft.md`（为何只借这一条）
- 本片级别：B（普通 capability，无 Runtime 改动、无新服务）
- owner：`hikari-memory` 插件；实现落在 `hikari-native/memory/rejections.js` 与 `writing.js` 的 `logged` 包装

## 1. 一句话范围

**一次被校验拒绝的写入，留下一条诊断记录**；它是旁路，不改变校验、不改变错误、不进入检索。

## 2. 冻结面（对外可见的部分）

### 2.1 文件

| 项 | 值 |
|---|---|
| 路径 | `<store 目录>/memory.rejections.jsonl`（与 `memory.jsonl`、`memory.meta.json` 同目录） |
| 编码 | UTF-8，一行一条 JSON，追加写 |
| 谁写 | 只有 `write_memory` / `revise_memory` 的 `execute` 包装在**捕获到异常之后**写 |
| 谁读 | 没有工具读它。只供人/诊断脚本读 |

### 2.2 一行记录的形状（`additionalProperties: false` 语义，字段固定七个）

```json
{"at":1793881240309,"tool":"write_memory","code":"MEMORY_TEXT_EMPTY","keys":["text"],"chars":3,"memoryId":null,"excerpt":null}
```

| 字段 | 含义 |
|---|---|
| `at` | 工程时间（`Date.now()`，Unix 毫秒），记录的是**留痕时刻**，不是事件时刻 |
| `tool` | `"write_memory"` 或 `"revise_memory"` |
| `code` | 错误消息冒号前的错误码，如 `MEMORY_TEXT_EMPTY`；取不到时是 `MEMORY_UNKNOWN_ERROR` |
| `keys` | 模型这次给了哪些键（排序后），**不含值**——用来看"它想写什么形状" |
| `chars` | `text` 的 UTF-16 长度；没给 `text` 时为 `null` |
| `memoryId` | 修订时模型指定的目标 id；`write_memory` 恒为 `null` |
| `excerpt` | 正文摘要：压平空白后取前 120 个码元，截断时补 `…`；空白正文为 `null` |

**刻意不记**：整段正文（只留摘要）、调用栈、store 路径、`recordedAt`/`seq`（被拒的写入没有它们）、错误全文（错误码已足够定位）。

### 2.3 失败语义（两条硬约束）

1. **留痕失败不得改变调用者看到的错误**：`logRejection` 抛错时吞掉，最初那条 `MEMORY_*` 原样抛出。测试用「把 `memory.rejections.jsonl` 占成目录」验过。
2. **并发不交错**：同进程内的追加走一个模块私有队列（与 `store.append` 同款理由），五条并发被拒按提交顺序逐行落盘。

### 2.4 与记忆本体的关系

- 不写 `memory.jsonl`、不生成 `memoryId`、不进 `MEMORY_FIELDS`、不动 `memory.meta.json` 的计数。
- `search_memories` / `get_memory` / `search_memory` / `read_memory` 都看不到它；`store.size` 不受影响。
- 因此它**不是第二个 Memory Store**：接前提 2（单一全局 Memory Store）时，它属于「运行诊断文件」，与 `memory.meta.json` 同类，不是记忆记录。

## 3. 明确不做

删除、自动过期、自动分类、审核队列、`protect`/`forgetting_history`、自动沉淀、自动注入、跨系统对接、向量检索、给拒绝记录加工具（本片不提供"查拒绝记录"的工具）、按字段名细化（`keys` 只给键，不给是哪个字段校验失败）。

## 4. 落地位置

| 位置 | 内容 |
|---|---|
| `hikari-native/memory/rejections.js`（新增） | `REJECTIONS_FILE`、`EXCERPT_CHARS`、`describeRejection`、`logRejection`（串行队列） |
| `hikari-native/memory/writing.js` | 顶部说明追加一段；`installMemoryWriteTools` 内 `logged(tool, run)` 包装两个 `execute` |
| `hikari-native/test/memory-rejections.test.mjs`（新增） | 七项：空正文、超长、成功不留痕、修订目标不存在、并发五条、留痕失败不改错误、检索看不到 |

## 5. 验收（七项，都已跑过）

| # | 检查 | 结果 |
|---|---|---|
| 1 | 空正文被拒 → 一行、七字段齐全、`memory.jsonl` 未创建、`store.size === 0` | pass |
| 2 | 超长被拒 → `chars` 照实、`excerpt` 121 字符且以 `…` 结尾 | pass |
| 3 | 成功写入不产生留痕文件 | pass |
| 4 | 修订目标不存在 → `tool`/`memoryId` 正确、摘要保留 | pass |
| 5 | 并发送五条 → 五行、逐行合法 JSON | pass |
| 6 | 留痕失败（路径被占成目录）→ 仍抛原错误码 | pass |
| 7 | 被拒正文写在摘要里，但 `search_memories` 搜它返回空 | pass |

## 6. 已知局限

- 只有 `write_memory` / `revise_memory` 的校验失败会被记；`search_memories` 一类**读**工具的报错不记（本片只治"记忆为什么缺"）。
- 摘要就是模型给的正文前 120 字，含它写的内容；不含对话上下文。
- 没有轮转与上限：拒绝次数很少，但长期运行会持续增长（与 `memory.jsonl` 一样，靠人清理）。
- 没有"查拒绝记录"的工具：要看得人自己读文件（或将来另开一片做诊断工具）。
