# M2-b Memory Writing 接口冻结（write_memory / revise_memory）

日期：2026-11-04 · 基线 `main` @ `9df0d4d`
前置：`experiments/m2b-code-facts.md`、`docs/development/m2b-memory-writing-functional-review.md`、
`docs/architecture/m2b-memory-writing-architecture-review.md`。

> **本文只冻结 M2-b 的实施边界，不重开架构问题。**
> 范围：`hikari-native/memory` 新增的两个模型可调用工具 `write_memory`、`revise_memory` 的入参、返回值、
> 校验规则与错误契约。本片级别：**B（普通 capability）**，owner 为 Memory plugin。
> 下面的 schema 与规则是设计结论，**不是实测结果**——被测对象还不存在。2026-11-05 补记：会话后来拿到 `pwsh`，
> 已实测实施前基线（`npm test` 1103 pass / 0 fail / 4 skip、M2-a 21 pass、插件 9 pass），冻结面本身未被运行验证。
>
> **评审状态（2026-11-05）**：人已通读五份材料，结论 **Conditional PASS**——架构方向认可，实施前需完成少量契约修订。
> 该轮修订已落地五项：① `occurredAt` 校验改为"对调用墙钟的输入合理性检查"，不再声称是 `recordedAt` 的不变量；
> ② 毫秒时间戳不再写"必须是 13 位"；③ 补 `MEMORY_HINT_TOO_LONG` 错误码与对应测试；④ 4000 字符的依据从"存储原子性"
> 改为"输入与上下文规模"，原子性仍交 M2-a 的恢复机制与后续实测；⑤ Functional Review 与 Architecture Review 的文档状态同步。
> 两条 advisory 也已落纸：`ref` 的写法约定（§4）与"跨 session 修订属 M2-c"的记录（Functional Review §9.2）。
> 随后人又指出第 ① 项里一处方向写反了（「秒当毫秒」得到的是 1970 年，不是未来），已按人工定稿改写 §4 的说明段、
> `MEMORY_INVALID_TIME_ORDER` 的消息，以及 Functional Review §2.2 与 Architecture Review §3 的同句：
> 该检查只用来拒绝晚于工具调用时刻的时间戳，不能可靠识别单位混淆，单位正确性主要靠工具描述约束。
> **实施后校正（2026-11-05）**：§4 的时间行原写"`null` / 非数字到达即折叠为 `null`"，与实际实现不符——实现只折叠
> 省略与 `null`，非数字（如 `1.5`、`"1762345678901"`）一律报 `MEMORY_INVALID_TIME`。把非法值悄悄折叠成"未知"会让
> 模型的错误输入变成一条看似正常的记录，因此以实现为准，文档已改。这是澄清，不改变 §5 的错误码表。
> 本文是冻结面；另外两份评审文档保留为**评审记录**，不再标注"待审阅"。

## 1. 冻结面

| 项 | 值 |
|---|---|
| 注册位置 | `hikari-native/memory/` 内新增写工具模块，由 `hikari-native/memory/index.js` 在 `MemoryStore.open` 之后调用 |
| 工具名 | `write_memory`、`revise_memory`（名字即契约，不接受别名） |
| 冒泡名字常量 | `tools.js:11` 的 `MEMORY_TOOL_NAMES` 需扩为四个名字（冲突检查 `index.js:57-64` 与 ready 行 `:89-94` 同时受益；实施后行号） |
| 依赖 | 只依赖 `MemoryStore` 实例；**不依赖** `hikariWorldFindings` service |
| 不新增 | 不新增 `store.mjs` 导出、不改 `append` 白名单、不改 `MEMORY_FIELDS`、不新增持久化 |
| 稳定性 | 以下 schema、返回键、错误消息前缀一旦实现即为公开契约；改它们要重开本审阅 |

## 2. `write_memory`

### 2.1 描述（照抄进代码）

```
Save one long-term memory that should survive this session and other projects. Use it when
something is worth remembering later, not for ordinary conversation state. You write the text;
the store assigns the id, the recorded time and the sequence number. Omit any time you do not
actually know: absent means unknown, never "now" and never a guess. The record never enters the
chat surface.
```

### 2.2 参数

```js
parameters: {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: {
      type: 'string',
      description:
        'The memory itself, in your own words. Up to 4000 characters; longer text is rejected, ' +
        'never truncated.',
    },
    occurredAt: {
      type: 'number',
      description:
        'When this happened, as Unix epoch MILLISECONDS (e.g. 1762345678901). Modern timestamps are ' +
        'typically 13 digits; older ones may have fewer. Do not convert seconds to milliseconds by ' +
        'guessing. Omit when you do not know the actual time — do not pass the current time.',
    },
    validFrom: {
      type: 'number',
      description:
        'When the stated condition starts to hold, Unix epoch MILLISECONDS. Omit when unknown; ' +
        'omit is not "always".',
    },
    validTo: {
      type: 'number',
      description:
        'When the stated condition stops holding, Unix epoch MILLISECONDS. Omit when unknown; ' +
        'omit is not "expires immediately".',
    },
    validHint: {
      type: 'string',
      description:
        'Your own guess about how long this stays true, in natural language ' +
        '(e.g. "one week unless the CI config changes"). Omit when you have no guess.',
    },
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          enum: ['finding', 'session', 'file', 'conversation', 'inference'],
          description:
            'What this memory came from. "finding" = a World finding, "session" = a point in a ' +
            'past conversation, "file" = a file in the repo, "conversation" = a whole earlier ' +
            'conversation, "inference" = derived from memories you already have.',
        },
        ref: {
          type: 'string',
          description:
            'The pointer for that kind: a finding id like "f-004", "<sessionId>#<seq>" for a ' +
            'session, "path/to/file.js:149" for a file, a session id for a conversation. ' +
            'Omit for "inference" (there is no direct evidence). Up to 512 characters.',
        },
      },
      required: ['kind'],
    },
  },
  required: ['text'],
}
```

三条实现要点，容易写错的：

- **`occurredAt` 等用 `type: 'number'`，不用 `'integer'`。** 仓库内没有 `integer` 的先例（`findings.js:522`、`:538` 都用 `number`），
  而 dsh-tools 对未知关键字的行为没有实测依据（`tools.js:54-56` 只记录了"类型数组会让插件激活失败"）。
  整数性在工具层用 `Number.isInteger` 判。
- **`source` 的 `required` 只有 `kind`**，不是 `['kind','ref']`。因为 dsh-tools 不能声明 nullable（缺口 G-7），
  `inference` 必须省略 `ref` 而不是传 `null`；其余四种缺 `ref` 由工具层报错。
- **不暴露 `supersedes`、`memoryId`、`recordedAt`、`seq`。** `write_memory` 拦这几项**只有 schema 一道门**
  （`additionalProperties: false`）：存储层白名单（`store.mjs:475-480`）并不替它拦——`supersedes` 恰是 `append`
  的合法字段（`revise_memory` 要用它）。所以验收 4 的行为断言只能用 `memoryId` / `recordedAt` / `seq` 举例，
  `supersedes` 只能靠结构化断言（schema 里根本没有这个键）。

### 2.3 返回

```js
output: {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      memoryId: { type: 'string' },
      seq: { type: 'number' },
      recordedAt: { type: 'number' },
      chars: { type: 'number' },
    },
    required: ['memoryId', 'seq', 'recordedAt', 'chars'],
  },
  render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}
```

| 键 | 含义 |
|---|---|
| `memoryId` | `m-<uuid>`，后续 `revise_memory` 的唯一抓手（模型没有别处能查回它） |
| `seq` | store 全局序号（正整数，`store.mjs:492`） |
| `recordedAt` | 工程时间戳，Unix epoch 毫秒（`store.mjs:486`） |
| `chars` | `text` 的字符数（JS `String.prototype.length`，UTF-16 码元；emoji 计 2） |

## 3. `revise_memory`

### 3.1 描述

```
Revise one existing memory by appending a new record that supersedes it. The old record is kept
forever; nothing is edited or deleted. You must pass the exact memoryId you want to revise, and
that memory must be the current version (it must not already have been revised). Pass the full
new text — revise_memory never reuses the old text. Source is not inherited: pass it again if the
new version still rests on the same evidence.
```

### 3.2 参数

```js
parameters: {
  type: 'object',
  additionalProperties: false,
  properties: {
    memoryId: {
      type: 'string',
      description:
        'The memory to revise, like "m-3f2a…". Must be the current version; a memory that was ' +
        'already superseded is rejected.',
    },
    text: { type: 'string', description: 'Same as write_memory: the full new text, up to 4000 characters.' },
    occurredAt: { type: 'number', description: 'Same as write_memory (Unix epoch milliseconds; omit when unknown).' },
    validFrom: { type: 'number', description: 'Same as write_memory.' },
    validTo: { type: 'number', description: 'Same as write_memory.' },
    validHint: { type: 'string', description: 'Same as write_memory.' },
    source: { /* 与 write_memory §2.2 完全相同 */ },
  },
  required: ['memoryId', 'text'],
}
```

`text` 是**必填**：修订的语义是"这条记忆现在应该这样写"，新记录必须是模型在当前认识下重述的内容。
"正文没变、只想调有效期"的需求在 M2 里不是修订——那是"这条现在应该这样写"的一种，重述一遍正文即可。
将来若出现真实需求，把 `text` 改成可选是向后兼容的（新增可选参数），不需要重开本审阅。

### 3.3 返回

与 `write_memory` 相同的四个键，**多一个 `supersedes`**：

```js
output: {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      memoryId: { type: 'string' },
      seq: { type: 'number' },
      recordedAt: { type: 'number' },
      chars: { type: 'number' },
      supersedes: { type: 'string' },
    },
    required: ['memoryId', 'seq', 'recordedAt', 'chars', 'supersedes'],
  },
  render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}
```

> **对 Functional Review §7 的一处细化。** 那里原写"两工具返回同一形状五键、`write_memory` 的 `supersedes` 恒为 `null`"（已同步改写）。
> 冻结时改成"`write_memory` 返回四键、`revise_memory` 多一个恒为字符串的 `supersedes`"，原因是 dsh-tools 不能声明 nullable：
> 若 `supersedes` 声明 `type:'string'` 而实际给 `null`，`output.schema` 就与真实返回不一致；
> 若把它从 write 的 schema 里删掉，又会出现"两个工具返回形状差一个键"的同样问题——所以让差值落在**新增**而不是**空值**上。

## 4. 字段规范化规则

顺序固定为：schema → 规范化 → 跨字段校验 → 写入。

| 字段 | 规范化 | 校验 |
|---|---|---|
| `text` | **不 trim**，原样保存（缩进与空行可能是刻意的） | `trim()` 后非空（与 `store.mjs:122-124` 一致）；`length <= 4000` |
| `occurredAt` | 省略或 `null` → `null` | 若为非 `null`：`Number.isInteger` 且 `>= 0`，否则 `MEMORY_INVALID_TIME`（非数字**不**被折叠成"未知"：那是没通过校验的输入，不是省略） |
| `validFrom` | 同上 | 同上 |
| `validTo` | 同上 | 同上 |
| `validHint` | `trim()`；trim 后为空 → `null` | `length <= 400`（自然语言一句话的量级；按 trim 后长度算），超限 → `MEMORY_HINT_TOO_LONG` |
| `source.ref`（字符串时） | `trim()` | 非空；`length <= 512` |
| `source` 整体 | 省略 → `undefined`（交给 `store.append` 落 `{kind:'unknown',ref:null}`，`store.mjs:490`） | 见下 |

`source` 的跨字段规则（工具层）：

| `kind` | `ref` 要求 | 违反时 |
|---|---|---|
| `finding` | 必须存在且匹配 `^f-[a-z0-9][a-z0-9._-]{0,63}$`（`findings.js:68`） | `MEMORY_INVALID_SOURCE` |
| `session` | 必须存在且非空 | `MEMORY_INVALID_SOURCE` |
| `file` | 必须存在且非空 | `MEMORY_INVALID_SOURCE` |
| `conversation` | 必须存在且非空 | `MEMORY_INVALID_SOURCE` |
| `inference` | **不得出现**（出现即错） | `MEMORY_INVALID_SOURCE` |
| `unknown` | **模型不得填**：schema 的 `enum` 不含它，`assertSource` 的 `SOURCE_KINDS` 也不含它（两道门） | 违反 → `MEMORY_INVALID_SOURCE`（"省略 source 即可"） |

**`ref` 的写法约定（写进工具描述，不是校验规则）。** 记忆是全局的，同一个相对路径可能出现在多个项目里，
所以 `file` 的 `ref` 尽量带上仓库或项目标识（如 `hikari-new/src/index.js:149`）——这是"全局共享不等于处处适用"的
最低成本表达，不引入 `projectId` / `projectScope` 之类的新字段；`session` 的 `ref` 保留足够的会话定位信息
（`<sessionId>#<seq>` 是建议写法）；`kind:'inference'` 明确表示这是推导，不是直接证据。这些只写进 `description`，
工具层不为它们新增校验。

时间跨字段规则（两者都非 `null` 时才判）：

| 规则 | 错误 |
|---|---|
| `validTo >= validFrom` | `MEMORY_INVALID_RANGE` |
| `occurredAt <= 调用时的墙钟`（工具层用 `Date.now()` 作参照，**不用** store 的 `#now`） | `MEMORY_INVALID_TIME_ORDER` |

> **这条检查不是记录上的不变量。** 持久化的 `recordedAt` 由存储层 `#now()` 生成（`store.mjs:486`），而 `#now` 可注入
> （`store.mjs:224`）；工具层用调用时刻的墙钟，两者在同一进程里也可能差几毫秒，注入假时钟时相差任意多。所以它检查的是
> 「模型提交的 `occurredAt` 是否晚于它此刻提交的墙钟时刻」——一条**输入合理性检查**，用来**拒绝晚于工具调用时刻的时间戳**。
> 它**不能**可靠识别秒与毫秒的混淆：「秒当毫秒」得到的是 1970 年（极早），本检查发现不了；单位正确性主要依赖工具描述约束
> （§2 的描述原文）。未来时间可能意味着单位错误，也可能意味着模型记录了尚未发生的事件。它**不**承诺磁盘上
> `recordedAt >= occurredAt`。若要那个更强的不变量，唯一干净的做法是让校验与写入共用同一个时钟，那需要重开 M2-a 的接口边界，
> 本片不做。

## 5. 错误契约

统一 `throw new Error(<CODE>: <一句话>)`（与 `findings.js:290`、`:465` 的既有风格一致）。消息开头固定为错误码，
既给人读也给测试认。`<CODE>` 之后必须能照做（指明下一步），不能只说"非法"。

| 错误码 | 触发 | 消息（示例，`{}` 为变量） |
|---|---|---|
| `MEMORY_TEXT_EMPTY` | `text` trim 后为空 | `MEMORY_TEXT_EMPTY: text is empty; write the memory in your own words.` |
| `MEMORY_TEXT_TOO_LONG` | `text.length > 4000` | `MEMORY_TEXT_TOO_LONG: {n} characters; keep it under 4000 (nothing was truncated).` |
| `MEMORY_HINT_TOO_LONG` | `validHint.length > 400`（trim 之后） | `MEMORY_HINT_TOO_LONG: validHint is {n} characters; keep the guess to one short sentence (under 400).` |
| `MEMORY_INVALID_TIME` | 时间非整数或为负 | `MEMORY_INVALID_TIME: {field} must be Unix epoch MILLISECONDS, not {got}. Modern values are typically 13 digits; do not convert seconds to milliseconds by guessing.` |
| `MEMORY_INVALID_TIME_ORDER` | `occurredAt > 调用时的墙钟` | `MEMORY_INVALID_TIME_ORDER: occurredAt is after the current time; either the value has a unit problem, or the event has not happened yet.` |
| `MEMORY_INVALID_RANGE` | `validTo < validFrom` | `MEMORY_INVALID_RANGE: validTo {to} is before validFrom {from}.` |
| `MEMORY_INVALID_SOURCE` | `kind`/`ref` 跨字段不合法，或 `ref` trim 后为空 / 超过 512 字符 | `MEMORY_INVALID_SOURCE: kind "{kind}" needs a {shape} ref; …` / `… "inference" takes no ref.` / `… ref must be 1-512 characters.` |
| `MEMORY_SUPERSEDES_NOT_MEMORY` | 目标以 `f-` 开头 | `MEMORY_SUPERSEDES_NOT_MEMORY: "{id}" is a World finding, not a memory; memory ids start with "m-".` |
| `MEMORY_SUPERSEDES_UNKNOWN` | 目标不在 store 里 | `MEMORY_SUPERSEDES_UNKNOWN: no memory "{id}"; use the memoryId returned when it was written.` |
| `MEMORY_SUPERSEDES_NOT_HEAD` | 目标已有后继 | `MEMORY_SUPERSEDES_NOT_HEAD: "{id}" was already revised by "{next}"; revise "{next}" instead.` |
| `MEMORY_STORE_REJECTED` | 存储层仍拒绝（兜底） | `MEMORY_STORE_REJECTED: store said {code}: {message}` |

`MEMORY_SUPERSEDES_NOT_HEAD` 的消息**必须带后继 id**：模型没有检索工具能找回 memoryId（架构审阅 §7 第 2 条），
错误消息是它唯一的线索。

`MEMORY_SUPERSEDES_UNKNOWN` 的消息**不能**说"用 search_memory 找"——`search_memory` 只查 World findings
（`tools.js:11`、`m2a-memory-store.md` 风险清单）。说错会引导模型去查一个查不到的地方。

## 6. 修订链规则

1. 目标必须存在：`store.get(id) !== undefined`。
2. 目标必须没有后继：`!store.all().some((r) => r.supersedes === id)`。
3. **"判链头 + 写入"在工具模块的私有队列里串行执行**，防两个并发修订各写一行形成分叉。
   存储层的 `#pending`（`store.mjs:458-466`）只串行化单次写入，不覆盖这个组合。
4. 新记录的 `supersedes` 由工具层从 `memoryId` 参数复制，模型不能自己写。
5. 旧记录一律不动：不写 `supersededBy`、不改任何字段、不删行。

局限（必须写进代码注释，不许省略）：第 3 条只覆盖单进程。跨进程共写同一 store 仍无锁
（`docs/development/m2a-memory-store.md` 风险清单第 1 条）。

## 7. 明确不在冻结面内

- 不提供 `forget_memory` / 删除 / 覆盖。
- 不提供批量修订（`memoryIds` 数组）。
- 不提供幂等键（重试会写两条相似记录，已知并接受）。
- 不提供"当前时间"（模型没有时钟，见 §9）。
- 不改变 `search_memory` / `read_memory`：它们仍只查 World findings。
- 不做去重、相似检测、自动分类、自动过期、自动同步 Findings。
- 不在写入时广播事件、不新增 service 类型。

## 8. Contract Creation Gate

出现以下任一情况，必须回到本文重审，而不是就地改：

1. 想改 `parameters` 里任何字段的名字、类型或 `required`。
2. 想改返回值的键集合。
3. 想在 `store.mjs` 里新增导出或加索引。
4. 想让写工具依赖 `hikariWorldFindings`，或让读工具开始读 memory。
5. 想引入幂等键、批量修订或删除能力。

## 9. 仍等待人决定的两件事

1. **模型没有时钟**（`cognition-action-loop-v0-boundary-review.md:68` 已裁定"现在几点"无人拥有）。
   本文的设计是"不知道就给 `null`"，结果是很多记忆的 `occurredAt` 会是 `null`。
   是否改为"写入/修订时在返回值里带带当前时间"（属于"工程提供信息"，M2 §5.2 允许），需要人裁决。
2. **模型无法回读自己写的记忆**：`search_memory` / `read_memory` 只查 findings，M2-b 明确不做检索扩展。
   因此修订能力实际只在同一上下文内可用，跨 session 只能靠模型自己记住 `memoryId`。这是 M2-c 的前置，
   不是 M2-b 的缺陷，但冻结文档必须写明。
