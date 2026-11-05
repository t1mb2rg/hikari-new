# s4-revise：会话 C —— 让她更正一条记忆，看旧行会不会被动

**日期** 2026-11-05 · profile `hikari-verify` · `dsh --profile hikari-verify --json "<prompt>"` · 独立进程（session `session-3432df1a-eddd-4948-94c1-41575bc0a0e9`）· storeDir `experiments/m2c-live/store`

## 前提：那条记忆里确实有一处行号不准

s2 写入的正文把串行队列记成「`writing.js` 约 288-292 行」。实读 `hikari-native/memory/writing.js`：`createQueue` 的 JSDoc 在 283-292、函数本体在 **293-303**（`Select-String` 复核：`:293 function createQueue() {`、`:295 return function enqueue(task) {`、`:364 const enqueue = createQueue()`）。所以任务不是编出来的，是可核对的更正。

修订前的快照：`memory.jsonl` 仅 1 行（2013 B，整文件 sha256 `FC897382B1C784391F824012128A2C7FEAB0BF731F9831BEC35C25269EAED076`），已备份到 `%TEMP%\m2c-before.jsonl` 用于逐字节比对。

## prompt（给内存 id，不给工具名）

> 记忆 m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b 里有一处行号不准：它把串行队列记成 writing.js 的 288-292 行。你先核对一下 createQueue 的真实行号，然后把那条记忆更正过来（旧记录不要删、不要改），最后告诉我新的 memoryId，以及新记录指向谁。

## 事件流：五次调用

| # | 工具 | 参数（要点） |
| --- | --- | --- |
| 1 | `get_memory` | `{"memoryId":"m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b"}` |
| 2 | `grep` | `{"pattern":"createQueue"}` → 命中 `:293`、`:364` 等 3 处 |
| 3 | `read` | `{"file_path":"…\\hikari-native\\memory\\writing.js","offset":278,"limit":40}` |
| 4 | `revise_memory` | 见下 |
| 5 | `get_memory` | 同 1（复核旧记录的 `supersededBy`） |

`revise_memory` 的入参字段：`memoryId`、`text`、`source`、`validHint`（**没有** `occurredAt`；`source` 是她自己重新传的，工具层不会继承——见下）。

它的返回（原文）：

```json
{
  "memoryId": "m-124371ee-e4cb-4ffb-a1d1-386bf23a1e62",
  "seq": 2,
  "recordedAt": 1793843299376,
  "chars": 1006,
  "supersedes": "m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b"
}
```

## 她的回答（原文）

> 核对与更正都已完成。
>
> ## 核对结果
>
> `hikari-native/memory/writing.js` 里的真实位置：
>
> | 内容 | 行号 |
> |---|---|
> | `createQueue` 的 JSDoc 注释 | 283–292 |
> | 其中「局限（只覆盖单进程…）」说明 | 290–291 |
> | **`createQueue()` 函数本体** | **293–303** |
>
> 原记录写的 `约 288-292 行` 实际落在 JSDoc 注释的末尾，并没有指向 `createQueue` 函数本体。
>
> ## 更正结果
>
> - **新的 memoryId**：`m-124371ee-e4cb-4ffb-a1d1-386bf23a1e62`
> - **新记录指向谁**：新记录 `supersedes` 旧记录 **`m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b`**
>
> 也就是说，旧记录保持原样、未被删除也未被修改，现在它的 `supersededBy` 已指向新记录 `m-124371ee-e4cb-4ffb-a1d1-386bf23a1e62`；链头已经是新记录。
>
> 新记录只改了那一处行号，其余全文原样保留，并把定位写成：串行队列的实现是 `writing.js` 的 `createQueue`（293-303 行，JSDoc 283-292 行，局限说明见 290-291 行）。

（她说的「293-303」与实读一致：`function createQueue() {` 在 `:293`、闭合的 `}` 在 `:303`，`return function enqueue(task) {` 正好在 `:295`。）

## 逐字节核对

`memory.jsonl` 变为 2 行（`memory.meta.json` → `recordCount: 2, lastSeq: 2`）：

| 检查 | 结果 |
| --- | --- |
| 第 1 行是否与修订前整文件逐字节相同 | ✅ `now.startsWith(before)` 为 true（新增内容全在第 2 行） |
| 第 1 行 sha256 | `1a44f98e40bc1443…`（修订前后同一行） |
| 第 1 行字段 | `memoryId=m-9cf20a36-…`、`seq=1`、`supersedes=null`、`chars=954`、10 个字段，无 `supersededBy` 键 |
| 第 2 行字段 | `memoryId=m-124371ee-…`、`seq=2`、`supersedes=m-9cf20a36-…`、`recordedAt=1793843299376`、`occurredAt=null`、`source={"kind":"file","ref":"hikari-native/memory/writing.js:253"}`、`validHint=长期有效，除非…`、`chars=1006`、10 个字段 |
| 链 | 旧 → 新，单向；`supersededBy` 是 `get_memory` 派生出来的，没有写进文件 |

## 两个读数

1. **修订不继承来源是行为事实**：`revise_memory` 的入参里有 `source`，是她自己重新给的（值与原记录相同，因为她核对后认为指针仍指向 `assertReviseTarget`，`writing.js:253` 未变）。如果工具层自动继承，入参里就不需要有这个键；如果模型不传，按冻结面会落 `{kind:'unknown',ref:null}`。
2. **她改了正文长度**（954 → 1006 字符）：只把行号那段写细，其余保留。这是"重述整条正文"而不是"补丁式修改"——与 `revise_memory` 要求 `text` 必填一致。

## 与预测的对照

预测「新增一行、旧行字节不变、`supersedes` 指向旧 memoryId」：三项都符合。
