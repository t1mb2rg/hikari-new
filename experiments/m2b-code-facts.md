# M2-b 代码事实：write_memory / revise_memory 的设计输入

> 核对基线：`main` @ `9df0d4d`（fix(memory): 尾部残片换行、快照隔离、并发串行化、meta 提交点）。
> 本文只记录**读到的**东西：字段形状、谁写、哪一层已经在拦什么。判断与取舍不在这里，见
> `docs/development/m2b-memory-writing-functional-review.md` 与
> `docs/architecture/m2b-memory-writing-architecture-review.md`。
>
> 本文的每一条都来自对源码与文档的阅读，行号对 `9df0d4d` 有效。2026-11-05 补记：会话后来拿到 `pwsh`，
> 已实测 `git rev-parse HEAD` = `9df0d4d1ca504a2af3fafe686c8622d0c59b5ee0`（分支 `main`），行号基线成立；
> 同时实测既有测试全绿（`npm test` 1107 项 / 1103 pass / 0 fail / 4 skip）。

标注约定沿用 `experiments/m2-code-facts.md`：

- **[事实]** 代码或文档原文可直接核对，附 `文件:行号`。
- **[缺口]** 文档与实现都还没定的地方，附它会在 M2-b 里造成什么。

---

## 1. 一条记录的形状

`MEMORY_FIELDS`（`hikari-native/memory/store.mjs:31-42`）固定十个字段，顺序与 M2 架构 §3.1 一致。
`validateRecord`（`hikari-native/memory/store.mjs:105-158`）是唯一判据来源：缺字段与多字段**都算错**
（`:112-117`），注释解释过原因——多字段通常就是 schema 漂移。

| 字段 | 实际判据（`validateRecord`） | 谁写 | 依据 |
|---|---|---|---|
| `memoryId` | 匹配 `^m-[0-9a-f]{8}-…-[0-9a-f]{12}$` | 存储层 | `:44`、`:119-121`、生成点 `:483` |
| `text` | 字符串，`trim()` 后非空 | 模型 | `:122-124` |
| `occurredAt` | `null` 或非负整数 | 模型 | `:125` |
| `recordedAt` | 非负整数（实际是 `Date.now()`，毫秒） | 存储层 | `:126-128`、`:224`、`:486` |
| `validFrom` | `null` 或非负整数 | 模型 | `:129` |
| `validTo` | `null` 或非负整数 | 模型 | `:130` |
| `validHint` | `null` 或字符串（**空串也合法**） | 模型（自然语言） | `:131-133` |
| `source` | `{ kind: 非空字符串, ref: null 或字符串 }`，多余 key 报错 | 模型（可省略） | `:134-147`、缺省 `:490` |
| `supersedes` | `null` 或 `m-<uuid>` | 模型（仅修订时） | `:148-152` |
| `seq` | 正整数 | 存储层 | `:153-155`、生成点 `:492` |

两点值得单独记住：

- **[事实] 存储层对时间只判"是不是非负整数"**，没有任何单位约束。`recordedAt` 的参照实现是 `Date.now()`
  （`hikari-native/memory/store.mjs:224`：`this.#now = options.now ?? Date.now`），所以**同一尺度是毫秒 epoch**，
  但这一条文档里没写死。
- **[事实] 存储层不校验跨字段关系**：`validTo >= validFrom`、`occurredAt <= recordedAt`、"修订目标必须是链头"
  一条都没有。`validateRecord` 只看单条记录自身。

## 2. `append` 给得起什么，给不起什么

`append(input)`（`hikari-native/memory/store.mjs:458-466`）把并发写排进私有队列 `#pending` 串行执行，
单次写入在 `#appendOne`（`:468-533`）里完成：

1. 已关闭抛 `STORE_CLOSED`（`:470-472`）。
2. **入参白名单** `['text','occurredAt','validFrom','validTo','validHint','source','supersedes']`
   （`:475-480`），其它 key 一律 `INVALID_INPUT`，消息是「append 不接受字段 X（由存储层生成的字段不能手填）」。
   → 验收第 4 项「工程字段不可伪造」在存储层已经有一道兜底。
3. 工程字段现场生成：`memoryId: \`m-${randomUUID()}\``（`:483`）、`recordedAt: this.#now()`（`:486`）、
   `seq: this.#lastSeq + 1`（`:492`）。
4. 可空字段 `?? null`，`source` 缺省 `{ kind: 'unknown', ref: null }`（`:485-491`）。
5. `validateRecord` 不过 → `INVALID_RECORD` 带 `errors`。
6. `supersedes` 非 null 且不在已折叠的 `#records` 里 → `SUPERSEDES_UNKNOWN`（`:499-505`）。
7. `appendFile` 是提交点（`:510`）；之后 meta 写失败只置 `damage.metaWriteFailed`，**不抛**（`:523-530`）。
8. 返回 `snapshotOf(record)`（冻结副本，`:197-199`）。

读侧对外只有四个口子：`get(memoryId)`（`:263`）、`all()`（`:259-261`，按 seq 序的快照数组）、
`size`（`:231`）、`lastSeq`（`:235`）。

**[缺口 G-4] 没有 `has()`，也没有 supersedes 的反向索引。**
`supersedes` 只做"目标存在"判定，不做"目标是否已被替代"判定。M2 架构 §6.3（`memory-core-m2-architecture-v0.1.md:251`）
说反向查询用内存 Map 索引即可，§9.1 启动序列第 5 步也写了"构建 supersedes 反向索引"——M2-a 没实现它。
若 M2-b 要判"修订目标必须是链头"，工具层只能 `all()` 全表扫一遍算后继；对"数百到数千条"（§4.2，`:156`）够用，
但它是一条**每次修订都要付的 O(n)**，且是工具层自己维护的派生视图。

## 3. 插件接线

`hikari-native/memory/index.js`：

- `name = 'hikari-memory'`，`inject = ['tools', 'hikariWorldFindings']`（`:18-19`）。
- `apply` 是 **async**（M2-a 的偏离之一）：读取 service（`:46`）→ 对 `MEMORY_TOOL_NAMES` 逐个
  `ctx.tools.get(name) !== undefined` 判冲突（`:57-64`，报错里给 `world.registerMemoryTools: false` 的解法）→
  `await MemoryStore.open({ storeDir: config.storeDir })`（`:69`）→
  `ctx.effect(() => () => { void store.close() })`（`:70-72`）→ `installMemoryTools(ctx, service)`（`:74`）→ 打 ready 行（`:89-94`）。
  （以上行号为 M2-b 实施后复核；实施前整体少 1–3 行。）
- ready 行里 `tools=${MEMORY_TOOL_NAMES.join(',')}`，**名字是从常量拼出来的**，扩成四个工具时自动跟着变。
- ready 行走 `console.error`：dsh-app-boot 只注册 `levels: { default: 2 }` 的 exporter，`info` 会被丢掉。

`hikari-native/memory/tools.js`：

- `MEMORY_TOOL_NAMES = ['search_memory', 'read_memory']`（`:11`；`:9-10` 是该常量的注释）。
- `installMemoryTools(ctx, service)`（`:13`）逐个 `ctx.tools.register({ name, description, parameters, output, execute })`；
  schema 都是 `additionalProperties: false`，`execute` 直接转发 `service.search` / `service.read`（`:63`、`:110`）。
- **[事实] dsh-tools 的参数校验不接受类型数组**（`:54-56` 的实测注释）：写成 `type: ['number', 'null']` 会让整个插件
  激活失败，所以 `nextOffset` 只声明 `number`。这条限制决定了 M2-b 的"可空字段"只能声明成不可空类型 + 允许省略。

**[事实] 生命周期不需要手写注销**：注册走的是 `FakeTools extends Service` 的 `ctx.effect`
（`hikari-native/test/memory.test.mjs` 里的 FakeTools，配上 `:202-213`「卸载后四个工具消失，`record_finding` 仍在」
与 `:215-225`「重载后工具恢复、结果与首次一致」两条用例）。M2 架构 §9.3 的结论一致。
→ 验收第 11 项"卸载重载不遗留工具"靠的是新增工具也走 `ctx.tools.register`，不是额外写清理代码。

**[事实] 错误呈现的既有模式**：`findings.js` 的工具实现一律 `throw new Error(<可操作的一句话>)`，
例子 `hikari-native/world/findings.js:290`（`unknown finding id "..."; use search_memory to find one`）与
`:465`（`unknown findingId "..."; omit findingId to create a new one`）；存储层则用 `MemoryStoreError { code, message, details }`
（`store.mjs:161-168`）。两层风格不同，M2-b 必须选一个并说明为什么。

## 4. 现在谁在拦什么

| 规则 | 存储层 | 工具层（`tools.js` 现状） |
|---|---|---|
| 十字段齐全、类型正确 | 拦（`validateRecord`） | — |
| 工程字段不可伪造 | 拦（白名单 `:475-480`） | schema `additionalProperties:false` 也能拦，但那是第二道 |
| `supersedes` 指向已存在 | 拦（`SUPERSEDES_UNKNOWN`） | — |
| `supersedes` 指向**链头** | 不拦 | 无 |
| `source.kind` 是已知词表 | 不拦（只要非空字符串） | 无 |
| `source.ref` 与 `kind` 匹配 | 不拦 | 无 |
| 时间单位、`validTo >= validFrom` | 不拦 | 无 |
| `text` 长度上限 | 不拦 | 无 |
| 一次修订多条 | 结构上不支持（`supersedes` 是单值） | 无 |

## 5. 缺口清单

- **G-1 时间单位没冻结。** 文档的字段注释只给语义（`null` = 未知，§3.1 `:98-107`），既没有整数规则也没有单位；
  「非负整数」这条规则**只存在于实现**（`store.mjs:125-130` 的 `validateRecord`）。
  `recordedAt` 实际是毫秒。若模型给秒级时间戳，校验拦不住，只会存进一个 1970 年附近的数。
- **G-2 `validFrom` / `validTo` 没有填写者与语义。** §3.1 的注释只说"可选：从何时成立 / 到何时为止，
  `null` = 未知（不是"永久"）"（`:100-101`），§5 只讨论 `occurredAt` / `recordedAt` / `validHint` 三个时间（`:173-183`）。
  谁填、和 `validHint` 什么关系、要不要 `validTo >= validFrom`，都没定。
- **G-3 `seq` 的语义与 M2 文档不一致。** 文档 §3.1 说它是"写入事件在当时的 session 中的位置（可选的辅助定位）"（`:105`），
  M2-a 实现是 **store 全局单调序号**（`lastSeq + 1`，`:492`），跨 session 连续、不随会话重启归零。
  实现更简单也更有用，但文档没同步；验收第 10 项"并发追加保持序号正确"针对的正是实际语义。
- **G-4 无 `has()` / 无反向索引**（见 §2）。
- **G-5 模型没有时钟。** `docs/architecture/cognition-action-loop-v0-boundary-review.md:68` 已裁定"现在几点"这一格
  **无人拥有**；M2 架构 §7.4（`:287-289`）把它列为 `[H]` 待验证。后果：模型无法把"昨天"换算成绝对时间，
  也没有任何工具告诉它 `now`。M2 架构 §5.2 却把"把『昨天』换算成绝对时间"列为模型职责（`:189`）——依赖它先知道当前时间。
- **G-6 没有幂等键。** 同一调用重试会写入两条内容相同的记录。存储层不去重（去重只存在于 `findings.js:451`
  的 Finding 层），`text` 相同也不拦。
- **G-7 schema 无法表达 nullable**（dsh-tools 限制，`tools.js:54-56`）。"空值"的合法形态只能是"省略这个 key"。
- **G-8 `text` 没有长度上限。** `validateRecord` 只判非空；没有任何与长度有关的约束。
  （实现层的单行 `appendFile` 原子性假设是"单行 ≤ 数 KB"，M2 §4.3 `:162`，标 `[H]` 未在 NTFS/POSIX 实测——
  但那是**存储层**的未验证假设，不能拿来给工具层的正文上限做背书，M2-b 的 4000 字符是产品理由，见 Architecture Review §2.7。）
- **G-9 错误通道二选一未定**（`throw Error` vs 返回 `{ ok:false, code }`），见 §3 末。
- **G-10 `read_memory` 只返回 `f-` 前缀的 finding id**（`hikari-native/world/findings.js:265-269`、`:299-305`），
  memory 的 id 是 `m-` 前缀。两套 id 空间并存，M2-b 新增的 `revise_memory` 只认 `m-`，模型不能拿 finding id 去改记忆。

## 6. 这些事实把 M2-b 夹在哪里

一句话：**存储层已经能保证"记录形状 + 工程字段 + supersedes 目标存在"三件事，其余全部要在工具层新建**，
而且工具层能借的只有 `get` / `all` / `size` / `lastSeq` 四个读口子——不改 `store.mjs` 的公开契约也能做到
（链头判定用 `all()` 扫，不新增索引），代价是每次修订一次全表扫。
