# M2-b Functional Review：Memory Writing 的行为边界

> 状态：**已评审（Conditional PASS，2026-11-05）——评审记录，非冻结面**；未实现。
> 冻结的入参/返回值/错误码以 `docs/architecture/m2b-memory-writing-interface-freeze.md` 为准。
> 评审后按意见改过三处：`occurredAt` 校验改为"对调用墙钟的输入合理性检查"、毫秒时间戳不再声称"必须 13 位"、补 `MEMORY_HINT_TOO_LONG`。
> 前置：`experiments/m2b-code-facts.md`（代码事实与缺口 G-1..G-10）。
> 本文只回答任务列出的 7 个边界问题，并给出 12 项验收各自"怎么被观察到"。
> 取舍的理由与对冻结原则的对照放在 `docs/architecture/m2b-memory-writing-architecture-review.md`。
> **下面所有"会拒 / 会成功"都是读代码推出的行为，不是实测结果。**
> 2026-11-05 补记：会话后来拿到 `pwsh`，已实测**既有基线**（`npm test` 1107 项 / 1103 pass / 0 fail / 4 skip；
> `memory-store.test.mjs` 21 pass；`memory.test.mjs` 9 pass，见 `docs/development/m2b-implementation-task-book.md` §5）。
> 那两个文件覆盖的是 M2-a 与插件生命周期，**不含**本文新写的规则；本文的规则要被实测，得等 P1–P4 的用例落地。

## 0. 七个问题，七句话

| # | 问题 | 一句话答案 |
|---|---|---|
| 1 | 哪些字段模型填、哪些工程生成 | 模型填 `text` 与四个时间/来源字段；`memoryId`、`recordedAt`、`seq`、`supersedes` 由工程填 |
| 2 | 时间字段缺失与空值 | 缺失一律落 `null`（`null` 只是防御性兜底，schema 声明的是不可空类型）；空串只在 `validHint` 上折叠为 `null`，`source.ref` 的空串按 kind 规则报错；不回落 `recordedAt`、不换算相对时间；跨字段只查 `validTo >= validFrom` 与 `occurredAt` 不晚于**调用时的墙钟** |
| 3 | `source.kind` / `source.ref` 校验 | `kind` 五值词表（`unknown` 只能由工程缺省产生）；`ref` 按 `kind` 逐种校验，`inference` 必须无 `ref` |
| 4 | 能否一次修订多条 | 不能。`supersedes` 是单值，一次调用只改一条链头 |
| 5 | 重复修订、错误 supersedes、无效引用 | 三层挡：schema 挡 `f-` 前缀、工具层挡"非链头"、存储层挡"目标不存在" |
| 6 | 是否继承旧来源 | 不继承。新记录缺省 `{kind:'unknown',ref:null}`，旧指针仍留在旧行上 |
| 7 | 返回什么 | `write_memory` 四键：`memoryId`、`seq`、`recordedAt`、`chars`；`revise_memory` 再加 `supersedes` |

---

## 1. 字段所有权

存储层已经用白名单把"能进 `append` 的 key"限死为七个（`hikari-native/memory/store.mjs:475-480`）：

```
text, occurredAt, validFrom, validTo, validHint, source, supersedes
```

这七个是**模型可填集合的上界**。工具层在这个上界之内再切一刀：

| 字段 | `write_memory` | `revise_memory` | 谁写 | 依据 |
|---|---|---|---|---|
| `text` | 必填 | 必填 | 模型 | `store.mjs:122-124` 要求非空 |
| `occurredAt` | 可选 | 可选 | 模型 | M2 架构 §5.1（`:179`）：`null` = 不知道 |
| `validFrom` / `validTo` | 可选 | 可选 | 模型 | M2 架构 §3.1（`:100-101`），语义见 §2.3 |
| `validHint` | 可选 | 可选 | 模型 | M2 架构 §5.1（`:181`），自然语言 |
| `source` | 可选 | 可选 | 模型 | M2 架构 §6.1（`:222-230`） |
| `memoryId` | **不可见** | 作为目标 id 传入，不进入新记录 | 工程 | `store.mjs:483` |
| `recordedAt` | **不可见** | **不可见** | 工程 | `store.mjs:486` |
| `seq` | **不可见** | **不可见** | 工程 | `store.mjs:492` |
| `supersedes` | **不可见** | 不直接暴露：由"目标 id"派生 | 工程 | `store.mjs:499-505` |

三处要说清：

1. **`write_memory` 不暴露 `supersedes`。** 白名单允许它（存储层要把修订写进去），但创建工具一旦开放这个字段，
   就等于允许"用 write 偷偷建立修订关系"，绕过修订工具的链头判定。修订只能发生在 `revise_memory`。
2. **`revise_memory` 的 `memoryId` 参数是"目标"，不是"新记录的 id"。** 新记录的 `memoryId` 仍然由 `randomUUID()` 生成
   （`store.mjs:483`）。这一条最容易在实现时写错：把模型给的 id 直接塞进新记录，会让两条记录同 id，
   被 `validateRecord` + 重复 id 检测挡下来（`store.mjs:119-121`）。
3. **`revise_memory` 的 `supersedes` 由工具层从 `memoryId` 参数复制**，不让模型自己写。

模型不能覆盖工程字段，但**不同字段的门不一样，不能笼统说"两道门"**：

- `memoryId` / `recordedAt` / `seq`：两道门。schema 里根本没声明这三个 key（`additionalProperties: false` 直接拒模型传入），
  存储层白名单也会抛 `INVALID_INPUT`（`store.mjs:477-480`）。
- `supersedes`：**只有 schema 一道门**。存储层白名单是**包含** `'supersedes'` 的（`store.mjs:475-480`），因为修订关系必须能传进
  `append`；`write_memory` 之所以不能顺带建立修订关系，靠的是它的 parameters 里没有这个键，而不是存储层会拒。

## 2. 时间字段的缺失与空值

### 2.1 "没有值"的写法与折叠

| 模型实际做的 | 规范化后 | 理由 |
|---|---|---|
| 不传这个 key | `null` | `store.mjs:485-491` 本来就 `?? null` |
| 传 `null` | `null` | 这是**防御性兜底，不是承诺的输入形式**：dsh-tools 不支持 `type: ['integer','null']`（`tools.js:54-56` 的实测注释），schema 只能声明不可空类型，`null` 大概率在校验层就被拒；真到达工具层时按"没有"处理，以免不同校验器行为不一致。契约与 `description` 只承诺"省略" |
| `validHint` 传空串或全空白 | `null` | 空串不携带信息；`store.mjs:131-133` 允许空串，但那是存储层的宽容，不是语义 |
| `source.ref` 传空串或全空白 | **不折叠，报错**（`MEMORY_INVALID_SOURCE`） | `ref` 是"指向哪里"，空串既不是指针也不是"没有"（"没有"由 `kind` 说明）；`finding`/`session`/`file`/`conversation` 四种 kind 缺 `ref` 本就报错（冻结 §4），空串按同一规则走 |

`validHint` 那一行是**工具层要新增**的一步：先 `trim()`，trim 后为空即 `null`。否则同一个"没有预判"会有 `null` 和 `""`
两种写法，M2-c 渲染时要额外分支。`source.ref` 的空串**不进这一步**——它按 kind 规则报错，而不是当"没有"。

### 2.2 边界与单位

- 单位冻结为 **Unix epoch 毫秒**（与 `recordedAt = Date.now()` 同尺度，`store.mjs:224`）。文档没给单位，也没有"非负整数"
  这类规则：语义只在字段注释里（§3.1 `:98-107`，`null` = 未知），整数性只存在于实现（`store.mjs:125-130` 的 `validateRecord`），
  这是缺口 G-1；工具层的 `description` 必须写明"毫秒"，因为校验层无法区分秒与毫秒。**不要写"必须是 13 位"**：
  2000 年以前的值本来就不足 13 位，而本片不设时间下限，模型可以合法地记录很久以前的事。正确的措辞是
  "Unix epoch MILLISECONDS，现代时间戳通常是 13 位；不要猜着把秒换算成毫秒"。
- 只做两条跨字段检查，都在工具层：
  - `validTo >= validFrom`（两者都非 `null` 时），否则 `MEMORY_INVALID_RANGE`。
  - `occurredAt <= 调用时的墙钟`，否则 `MEMORY_INVALID_TIME_ORDER`。这道检查**不是**记录上的不变量：持久化的
    `recordedAt` 由 `store.mjs:486` 的 `#now()` 生成，而 `#now` 可注入（`store.mjs:224`），两者可能相差毫秒、注入假时钟时
    相差任意多。它检查的是"模型提交的这个时间点是否晚于它此刻提交的墙钟时刻"，即**拒绝晚于工具调用时刻的时间戳**。
    它**不能**可靠识别秒与毫秒的混淆：「秒当毫秒」得到的是 1970 年（极早），本检查发现不了；单位正确性主要依赖工具描述
    约束（见本节上文的毫秒表述）。未来时间可能意味着单位错误，也可能意味着模型记录了尚未发生的事件。若要"磁盘上
    `recordedAt >= occurredAt`"这个更强的不变量，必须让校验与写入共用同一个时钟——那要重开 M2-a 的接口边界，本片不做。
- **不做**的事：不把 `occurredAt` 回填成 `recordedAt`（§5.1 `:183` 明令禁止，原因写在文档里：会把"三天前发生、今天才记"
  标成今天）；不把"昨天"换算成绝对时间（模型没有时钟，见 §9）；不设时间下限（例如"不得早于 2000 年"），
  因为模型可能合法地记录很久以前的经历。

### 2.3 `validFrom` / `validTo` 的语义

缺口 G-2：文档只说"可选：从何时成立 / 到何时为止"（§3.1 `:100-101`），没说谁填、和 `validHint` 什么关系。
M2-b 的最小解释（不新增字段、不改存储层）：

- 它们是**模型知道的客观区间**，`validHint` 是**模型的主观预判**，两者可以同时给，工程不做一致性推断。
- 三者都可以是 `null`，"不知道"就是 `null`，不是"永久有效"（§3.1 `:101` 原文强调过）。
- 不给默认值、不互相推导。

## 3. `source.kind` 与 `source.ref`

### 3.1 `kind` 词表

M2 架构 §6.1（`:225-229`）给了五个示例，存储层缺省值是第六个（`store.mjs:490`：`source: input.source ?? { kind:'unknown', ref:null }`）：

| kind | 模型可填 | `ref` 要求 | 依据 |
|---|---|---|---|
| `finding` | 是 | `^f-[a-z0-9][a-z0-9._-]{0,63}$` | `findings.js:68` 的 id 正则 |
| `session` | 是 | 非空字符串，建议 `<sessionId>#<seq>` | §6.1 `:226`、`:234`（**不可回查，只能记录**） |
| `file` | 是 | 非空字符串，建议 `path/to/file.js:149` | §6.1 `:227` |
| `conversation` | 是 | 非空字符串（sessionId） | §6.1 `:228` |
| `inference` | 是 | **必须没有 `ref`** | §6.1 `:229`（`ref: null`，由已有记忆推出） |
| `unknown` | **否** | 不给 | 只由工程在"模型省略 source"时落值（`store.mjs:490`） |

两条决定的理由：

- **拒 `unknown`，两道门都拒**：schema 的 `enum` 只有五种，模型填 `unknown` 在参数校验层就被挡；`assertSource` 的
  `SOURCE_KINDS` 同样不含 `unknown`，所以即使 runtime 不执行 `enum`，工具层仍会报 `MEMORY_INVALID_SOURCE`
  （对应验收 5 的探针改成行为断言，见任务书 §3）。允许模型填 `unknown` 会出现"省略 source"和"显式声明无来源"
  两种写法表达同一状态，回读时无法区分也没有必要区分。拒绝，消息写"省略 source 即可"。
- **`inference` 必须无 `ref`**：`ref` 一旦存在就是"有直接证据"，和 `inference` 的定义冲突。反过来，
  `finding` / `file` / `session` / `conversation` **必须**有 `ref`——没有 `ref` 的 `{kind:'finding'}` 等于"有个来源但不知道是哪个"，
  那正是 `unknown` 要表达的东西，应该直接省略 source。

### 3.2 其他形状约束

- `ref` 长度上限 512 字符，`text` 上限 4000 字符，`validHint` 上限 400 字符（按 `trim()` 后算，空串已在 §2.1 折成 `null`）。
  这是**工具层**的输入约束，不是存储层的（存储层只判非空）。
  理由分两层，**不要把两层混成一条**：
  - **产品/上下文层**：4000 字符是"一次写入能带多少上下文"的上限，也是工具入参的合理规模。超限**报错而不是截断**——
    截断等于把模型写的内容改掉，而记忆正文的可信度就建立在"存进去的就是写下的"。
  - **存储完整性层**：单行 `appendFile` 的原子性假设是"单行 ≤ 数 KB"（M2 §4.3 `:162`，标 `[H]`，未在 NTFS/POSIX 实测）。
    4000 个中文字符最坏约 12 KB，加上 JSON 字段与元数据只会更大，所以**它不能当作原子性的证明**；
    这里只是"尽量留在数 KB 量级"的经验值。真正的完整性保障是 M2-a 已有的恢复机制（尾部残片跳过、中间坏行报错、
    meta 从 jsonl 重建），以及将来对实际文件系统的实测。
  - 两条约束（`MEMORY_TEXT_TOO_LONG`、`MEMORY_HINT_TOO_LONG`、`MEMORY_INVALID_SOURCE` 的超长 `ref`）各自有独立错误码
    （冻结 §5），实现时不许合并成一个笼统的"参数非法"。
- `source` 对象只允许两个 key（`store.mjs:144-146` 已经对多余 key 报错，schema 的 `additionalProperties:false` 再挡一层）。
- 不给 `source` 时落 `{kind:'unknown', ref:null}`，这是存储层的既有行为，工具层不要重复实现。

## 4. 一次修订多条？

**不允许。** 三个理由：

1. 结构上不支持：`supersedes` 是单值（`store.mjs:148-152`），一次指向一条。
2. 无法原子：append-only 下"改三条"就是写三行，第二行失败时第一行已经落盘且是提交点（`store.mjs:510`），
   没有回滚手段，调用方会拿到"部分成功"这种无法表达的返回。
3. 链头判定会退化成集合判定：目标是"三条都必须没有后继"，任何一条不满足就整体拒绝，而错误信息要指出是哪条——
   这已经比单条复杂一倍，收益却只是省两次工具调用。

模型要改多条就多次调用，每次一条，各自可追溯。这是任务里"原则上先研究单条修订"的直接落地。

## 5. 重复修订、错误 supersedes、无效引用

三层防线，各管一段：

| 层 | 挡什么 | 依据 |
|---|---|---|
| schema | `memoryId` 必须是字符串（**没有 `pattern`**：冻结 §3.2 只声明 `type:'string'`；dsh-tools 对 `pattern` 等关键字无实测依据，见缺口 G-7） | 参数声明 |
| 工具层 | `f-` 前缀 → `SUPERSEDES_NOT_MEMORY`；目标不存在 → `SUPERSEDES_UNKNOWN`；目标已有后继 → `SUPERSEDES_NOT_HEAD` | `store.get()` + `store.all()` |
| 存储层 | 目标不存在（兜底） | `SUPERSEDES_UNKNOWN`（`store.mjs:499-505`） |

### 5.1 目标存在性与 id 空间

- 先查前缀：`memoryId` 以 `f-` 开头 → `SUPERSEDES_NOT_MEMORY`，消息"`f-004` 是 World 的判断，不是记忆；
  记忆 id 以 `m-` 开头"。这条不靠存储层，因为存储层只查"在不在 `#records` 里"，报的是"目标不存在"，容易误导
  （见缺口 G-10：两套 id 空间并存）。
- 再查存在：`store.get(id) === undefined` → `SUPERSEDES_UNKNOWN`，消息照抄 World 的风格
  （`findings.js:290`）：`unknown memory id "m-…"; …`。

### 5.2 链头判定

M2-a 没有反向索引（缺口 G-4），工具层用一次全表扫描算后继：

```js
const hasSuccessor = store.all().some((r) => r.supersedes === targetId)
```

- 已有后继 → `SUPERSEDES_NOT_HEAD`，消息带后继 id："这条记忆已被 `m-…` 取代；要改就修订最新那条"。
  带上后继 id 是关键：模型没有检索工具能找回 memoryId（见 §9），错误消息是它唯一的信息来源。
- 代价是每次修订 O(n)（`all()` 返回全表快照，`store.mjs:259-261`）。当前规模数百到数千条（M2 §4.2 `:156`），
  可以接受；M2-c 若要优化，应在存储层做索引，而不是在工具层做缓存。

### 5.3 并发下的分叉

存储层的 `#pending` 队列只串行化"写入这一行"（`store.mjs:458-466`），**不覆盖"检查链头 + 写入"这个组合**。
两个并发的 `revise_memory` 可能都读到"目标无后继"，然后各写一行，形成分叉。

M2-b 的处理：工具层再排一个队列，把"判链头 → append"整体串行。这是工程在保证**完整性**（同一条记忆不出现两个后继），
不是在替模型做语义判断。局限必须写明：只对**单进程内**有效；跨进程共写同一 store 仍无锁（M2-a 已知风险，
`docs/development/m2a-memory-store.md` 风险清单第 1 条）。

## 6. 修订后的记录是否继承旧来源

**不继承。** 新记录的 `source` 由模型给；不给就是 `{kind:'unknown', ref:null}`。

代码依据（三条，都在存储层）：缺省值只在**本次 append** 生效（`store.mjs:490`）；`append` 不读旧记录的任何字段——
它只做白名单与字段生成，唯一的读取是 `supersedes` 的存在性检查（`store.mjs:468-533`，读点 `:499-505`）；
旧行不会被改写，因为唯一写入路径是 `appendFile`（`store.mjs:510`），没有重写/删除路径。

为什么这不是信息损失：

- 旧记录的 `source` 还留在旧行上，行是不可变的（append-only，`store.mjs:510`）。沿 `supersedes` 走一步就能读到"上一版是从哪来的"。
- 新记录表达的是"这一版的依据"。一次修订把"从 f-004 读到的结论"改成"我重新验证过"，依据显然变了；
  自动继承会让新记录声称一个它没核对过的来源。
- 想沿用的模型可以在**同一次上下文里**显式传同一个 `source`，成本是一次参数复制；跨 session 时它既拿不到 `memoryId`（§9.2），
  也拿不到旧 `source`，那时"沿用"本来就无从做起——所以"不继承"没有在可用的操作里拿走任何东西。

反过来，"自动继承"违反的是 §5.2 那条分工（`memory-core-m2-architecture-v0.1.md:194`）：工程只给信息、存状态，
不替模型判断。判断"这一版还依据原来那条证据吗"是语义判断。

## 7. 工具返回什么

`write_memory` 返回**四个键**；`revise_memory` 在同一组键上多一个 `supersedes`：

```js
// write_memory
{ memoryId: 'm-1b2c…', seq: 12, recordedAt: 1762345678901, chars: 233 }
// revise_memory
{ memoryId: 'm-9f0d…', seq: 13, recordedAt: 1762345680120, chars: 241, supersedes: 'm-1b2c…' }
```

| 键 | 作用 | 依据 |
|---|---|---|
| `memoryId` | 后续 `revise_memory` 的唯一抓手 | `store.mjs:483` 生成，模型无法预知 |
| `seq` | 确认写入顺序；并发场景下用来核对"我这条是不是第 12 条" | `store.mjs:492` |
| `recordedAt` | 工程时间戳，模型据此知道"这条是此刻记下的"（它自己没有时钟，见 §9） | `store.mjs:486` |
| `chars` | 规范化后正文的**字符数**（不是字节），确认正文完整落盘、没被截断 | 截断被禁止，见 §3.2 |
| `supersedes` | **只出现在 `revise_memory` 的返回值里**：目标 id，让模型确认改的是哪条（`write_memory` 不返回这个键——"恒为 null"的键只占上下文不携带信息） | `store.mjs:499-505` |

不返回的东西，以及为什么：

- **不回整条记录**：正文模型刚写完，回声没有信息量，只花 token。
- **不回存储统计**（总数、`all()`、`damage`）：那是诊断信息，属于 ready 行（`index.js:85-91`），不是工具返回。
- **不回规范化后的字段回显**：只有两处规范化（`validHint` 空串→`null`、`source` 省略→`unknown`），
  模型能自己推出结果；若真要"工程怎么理解了我给的"，`chars` + 不报错已经够。
- **不回警告**：秒/毫秒混淆这类问题工程判不了（§2.2），给个"警告"等于半个语义判断，还会让模型把
  工具的猜测当成结论。

估算：单次返回约 45 token，远低于"回读整个存储"的量级。

## 8. 12 项验收各看什么

| # | 验收项 | 观察到的行为 |
|---|---|---|
| 1 | 正常写入 | 返回 `m-` 前缀 id；`memory.jsonl` 末尾多一行，十字段齐全 |
| 2 | 关闭重开仍在 | 新实例 `get(id)` 返回记录，十字段逐项相等（含 `seq`） |
| 3 | 全局 id 唯一 | 两次写入 id 不同；重开后已有 id 不会重复出现 |
| 4 | 工程字段不可伪造 | schema 拒额外参数；绕过 schema 直接 `store.append({memoryId})` 抛 `INVALID_INPUT`（两条独立证据） |
| 5 | 非法数据被拒 | 空正文 / 非整数时间 / `validTo < validFrom` / `occurredAt` 晚于调用墙钟 / 未知 `kind` / `inference` 带 `ref` / 超长正文 / 超长 `validHint` / 超长或空白 `ref`，逐条有专属错误码且不落盘 |
| 6 | 正常修订 | 返回新 `memoryId ≠ 目标 id`；新行 `supersedes === 目标 id` |
| 7 | 旧记录仍在 | `all()` 条数 +1；旧行逐字段未变（无 `supersededBy` 之类新字段） |
| 8 | supersedes 指向正确 | 新行 `supersedes` 精确等于目标 id；链上只此一条后继 |
| 9 | 不存在目标被拒 | `SUPERSEDES_UNKNOWN`；`all()` 条数不变（没有半截写入） |
| 10 | 并发追加序号正确 | N 个并发写入后 `seq` 集合为 `1..N` 连续无洞（存储层 `#pending` 保证） |
| 11 | 卸载重载不遗留工具 | 卸载后 `ctx.tools.get('write_memory') === undefined`；重载后工具恢复且功能正常 |
| 12 | 原检索工具与 Findings 不受影响 | `search_memory` / `read_memory` 输出与 M2-a 一致；`record_finding` 正常；memory 的 `m-` id 不出现在 finding 检索结果里 |

## 9. 还没解决的事（必须在架构审阅时看到）

1. **模型没有时钟（G-5）。** `docs/architecture/cognition-action-loop-v0-boundary-review.md:68` 已裁定"现在几点"这一格无人拥有。
   直接后果：`occurredAt` 只能由模型猜；`recordedAt` 是唯一可信的时间，但模型看不到它（除非这次返回的 `recordedAt`）。
   M2-b 的选择是"不猜、不换算"，代价是很多记忆的 `occurredAt` 会是 `null`。**这条需要人裁决**：
   是否允许工具在返回值里带一句"当前时间"，或者接受 `occurredAt` 大量缺失。
2. **模型无法回读自己写的记忆。** `search_memory` / `read_memory` 只查 World findings（`m2a-memory-store.md` 的风险清单、
   `tools.js:11` 只注册这两名字）。M2-b 明确不做检索扩展（任务第 6 条），所以：写入后模型只能靠返回值里的
   `memoryId` 记住这条记忆；跨 session 之后，它**没有任何工具能找回 memoryId**。
   → 这意味着 M2-b 的修订能力实际只在"同一上下文/同一 session 内"可用。这不是 bug，但必须在冻结文档里写明，
   并在实施任务书里标为 M2-c 的前置。它也解释了为什么 §7 必须回完整的 `memoryId`、§5.2 的错误消息必须带后继 id。
   → 换句话说，M2-b 交付的是三件事里的前两件半：**跨 Session 长期保存**（store 在 `$DSH_HOME` 下，与项目无关）、
   **当前上下文内可修订**（手里有 `memoryId`）、**跨 Session 暂时不能自主检索并修订**。第三件是 M2-c 的能力缺口，
   不是 M2-b 的实现缺陷；不要为了让 M2-b"看起来完整"而把检索塞进来。
3. **秒/毫秒混淆无法被工程判出**（§2.2）。只能靠 schema description 提示，剩下的靠模型。
4. **跨进程无锁**（§5.3）：单进程内的分叉已经被工具层队列挡住，多实例共写不在 M2-b 的范围。
