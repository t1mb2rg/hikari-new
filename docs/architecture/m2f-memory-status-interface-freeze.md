# M2-f 冻结面：`memory_status`（它自己的状态）

- 日期：2026-11-05
- 状态：**已实施**（人 2026-11-05：「做吧」）
- 前置：`docs/architecture/hikari-end-state.md` §5.1（反馈口的模型侧）
- 本片级别：B（新增一个只读工具，不改写入契约、不改 store）
- owner：`hikari-memory`；实现 `hikari-native/memory/status.js`

## 1. 一句话范围

模型能回答"我一共记了几条、最近记了什么、刚拒了什么、多少条不知道发生时间"——**不靠现搜现猜**。

## 2. 冻结面

### 2.1 工具

| 项 | 值 |
|---|---|
| 名字 | `memory_status` |
| 参数 | 只有 `recent`（number，1–20，缺省 5；非法或越界退回缺省） |
| 语义 | 只读汇总：不做匹配、不返回正文全文（只给 80 字摘要）、不改任何状态 |
| 位置 | `MEMORY_TOOL_NAMES` 第七个（ready 行与 `tools.order` 的最后一项） |

### 2.2 返回（字段固定，`additionalProperties: false`）

```json
{
  "total": 2, "lastSeq": 2, "heads": 1, "revised": 1,
  "unknownOccurredAt": 2,
  "sources": { "file": 2 },
  "recent": [
    { "memoryId": "m-…", "seq": 2, "recordedAt": 1793843299376,
      "occurredAt": null, "supersededBy": null, "snippet": "…" }
  ],
  "rejections": {
    "total": 1, "byCode": { "MEMORY_TEXT_EMPTY": 1 },
    "lastAt": 1793881240309, "lastTool": "write_memory", "lastCode": "MEMORY_TEXT_EMPTY",
    "unreadableLines": 0
  }
}
```

- `heads`：没有任何后继记录修订过的条数；`revised`：自己带 `supersedes` 的条数。
- `unknownOccurredAt`：`occurredAt === null` 的条数——**这是要如实说出来的"不知道"**。
- `recent`：按 `seq` 倒序取最后 N 条；`supersededBy` 由 `supersedes` 现算（存储里没有这一列）。
- `rejections.unreadableLines`：坏行计数；`-1` 表示文件存在但读不了（不假装"没有拒绝样本"）。
- `rejections.lastAt/lastTool/lastCode`：最近一次被拒的时间、工具与错误码；没有拒绝样本时这三个键整组省略（dsh-tools 不能声明"对象或 null"）。

### 2.3 三条边界

1. **只读**：只调 `store.all()` 与读 `memory.rejections.jsonl`；调用前后 `memory.jsonl` 逐字节相同、`store.size` 不变（有测试）。
2. **不是第二条检索路径**：它不做匹配、不给全文；要内容仍用 `search_memories` / `get_memory`。
3. **与视图同源**：这些数字的定义与 `hikari-native/viewer/render.mjs` 的 `buildView` 一致（有交叉断言），所以"页面上的数字"和"它嘴里的数字"不会打架。

## 3. 明确不做

关键字搜索、正文全文、写入/修订（它不是写工具）、清理拒绝记录、时间换算（不把 `recordedAt` 冒充 `occurredAt`）、缓存（每次现算）。

## 4. 落地位置

| 位置 | 内容 |
|---|---|
| `hikari-native/memory/status.js`（新增） | `summarize`、`normalizeStatusInput`、`readRejections`（`ENOENT` 当空、读不了记 `-1`）、`installMemoryStatusTool` |
| `hikari-native/memory/tools.js:11-20` | `MEMORY_TOOL_NAMES` 六个 → 七个 |
| `hikari-native/memory/index.js:19`、`:81-83` | import 与安装调用（在 recall 之后） |
| `hikari-native/test/memory-status.test.mjs`（新增） | 十项：空库、写入后读数、修订后链头、参数边界、拒绝汇总与坏行、只读、与视图同源、工具形状、纯函数口径、**schema 表达力守门**（子 schema 不为空、`additionalProperties` 是布尔、`type` 不是数组） |
| 既有测试 3 处 | `memory.test.mjs` 的 `tools.order` / 卸载清单 / ready 正则；`memory-writing.test.mjs` 与 `memory-recall.test.mjs` 的卸载清单与用例名 |

## 5. 验收

十项用例全绿；全量 `npm test` = **1158 tests / 1154 pass / 0 fail / 4 skip**（本片前 1148 / 1144）。

真机验收（`dsh --profile hikari-verify`，连的是 `hikari-native` 的 link）：

- ready 行：`tools=search_memory,read_memory,write_memory,revise_memory,search_memories,get_memory,memory_status`——七个工具全部注册。
- 问「用 memory_status 查一下你自己的记忆」，回答「共 2 条记忆，其中 2 条的发生时间未知；这次调用的是 memory_status 工具。」与 `experiments/m2c-live/store` 的实际读数一致。

## 5.1 实施时踩到的表达力限制（真机抓到的，单测抓不到）

第一次真机启动直接不激活：

```text
hikari-memory (hikari-native-v0/memory): JsonSchemaError: unsupported JSON schema:
schema.properties.sources.additionalProperties requires type or oneOf;
schema.properties.rejections.properties.byCode.additionalProperties requires type or oneOf;
schema.properties.rejections.properties.last.properties requires type or oneOf;
schema.properties.rejections.properties.last.additionalProperties requires type or oneOf
```

改掉 `additionalProperties` 的 schema 形式后再启动，报的是 `...additionalProperties must be a boolean`。结论（两条，已写进测试 `[10]` 守住）：

1. `additionalProperties` 只能是布尔值，不能是子 schema——所以 `sources` / `byCode` 这类映射只能声明 `type: 'object'` + `additionalProperties: true`，值的类型交由 description 说明。
2. 子 schema 不能是空对象 `{}`（既无 `type` 也无 `oneOf`）；只带 `description` 的 nullable 写法是允许的（`recall.js` 的 `NULLABLE_TIME` 已在真机上验证过）。

代价：单元夹具 `FakeTools.register` 只存 definition、不校验 schema，所以这类错误只有真机启动才暴露——本片因此把"真机 ready 行 + 一次真实提问"列为验收步骤，而不是可选项。


## 6. 已知局限

- 只覆盖记忆与拒绝；findings 不在里面（那是 World 的事）。
- `sources` 只给 kind 计数，不给 ref（ref 可能很长，且要看细节有 `get_memory`）。
- 摘要固定 80 字，不能调（要全文请 `get_memory`）。
