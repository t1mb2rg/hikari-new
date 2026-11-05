# M2-b 实施任务书：write_memory / revise_memory

> 基线 `main` @ `9df0d4d`。前置三份文档：
> `docs/architecture/m2b-memory-writing-interface-freeze.md`（契约）、
> `docs/development/m2b-memory-writing-functional-review.md`（行为）、
> `experiments/m2b-code-facts.md`（代码事实）。
> 2026-11-05 补记：会话后来拿到 `pwsh`，已实测实施前的基线——`git rev-parse HEAD` = `9df0d4d`、
> 五份文档仍未跟踪、`writing.js` 与 `memory-writing.test.mjs` 不存在、`npm test` 全绿（1103 pass / 0 fail / 4 skip）。
> 逐项读数见 §5 的"实测基线"表。**新用例本身仍未写过、未跑过**，§4 的 12 项验收都还是待实现状态。

## 1. 目标与不做

**做**：在 `hikari-native/memory` 增加两个模型可调用工具，让 Hikari 能写一条长期记忆、并能通过追加新记录修订它。

**不做**（与任务第 6 条一致，且冻结文档 §7 已列）：不扩检索（`search_memory` / `read_memory` 仍只查 findings）；
不做删除 / 批量 / 幂等键；不引入向量库、新持久化、新 service 类型；不自动提取、分类、过期、同步 Findings；
不改 `store.mjs` 的公开契约；不改 Runtime。

## 2. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `hikari-native/memory/writing.js` | **新增** | 写工具模块：校验、规范化、链头判定、串行队列、`installMemoryWriteTools(ctx, store)` |
| `hikari-native/memory/tools.js` | 改 1 行 | `MEMORY_TOOL_NAMES`（**`:11`**，`:9-10` 是注释）扩为四个名字 |
| `hikari-native/memory/index.js` | 改 2 处 | import（`:17`）+ 在 `installMemoryTools`（`:73`）之后调用 `installMemoryWriteTools(ctx, store)`（`:76-79`） |
| `hikari-native/test/memory-writing.test.mjs` | **新增** | 12 项验收的落点 |
| `hikari-native/test/memory.test.mjs` | 改 3 处（+15/−3） | ① `:175-181` 的 `tools.order` 期望改成五个名字（`record_finding` + 四个检索/写入工具）；② `:202-213` 卸载用例改名并加 write/revise 的"消失"断言（原用例只断言检索工具）；③ `:254` 附近 ready 行正则改成四个工具名。`:215-225` 重载用例与 `:227-235` Service 只读用例逻辑未改（行号因上面的插入而下移） |
| `hikari-native/memory/store.mjs` | **不动** | 冻结条件之一（架构审阅 §5） |

`MEMORY_TOOL_NAMES` 扩成四个名字的连带效果是自动的：冲突检查（`index.js:57-64`）会一起覆盖新名字，
ready 行（`:89-94`）会一起列出，不需要另写。

## 3. 分阶段

### 阶段 P1：`write_memory` 与全部校验

**目的**：先让"写一条"成立，且所有校验规则在它身上一次写全——`revise_memory` 复用同一套，不重复实现。

**落点**（`hikari-native/memory/writing.js`，建议顺序）：

| 段 | 计划行号 | 内容 | 对应契约 |
|---|---|---|---|
| 1 | `writing.js:1-20` | 常量：`MAX_TEXT = 4000`、`MAX_HINT = 400`、`MAX_REF = 512`、`SOURCE_KINDS`、`FINDING_ID_PATTERN`（照抄 `findings.js:68` 的正则） | 冻结 §4 |
| 2 | `writing.js:22-60` | `normalizeInput(args)`：把"省略 / `null` / 空串"折叠成 `null`；`text` 不 trim；`validHint` trim；`source` 整体缺省返回 `undefined` | 冻结 §4 |
| 3 | `writing.js:62-95` | `assertTimestamps(input)`：`Number.isInteger` + `>= 0`；`validTo >= validFrom`；`occurredAt <= 调用时的墙钟`（用 `Date.now()`，**不用** `store` 的 `#now`）。这是**输入合理性检查，不是记录上的不变量**：磁盘上的 `recordedAt` 由 `store.mjs:486` 的 `#now()` 生成且 `#now` 可注入（`:224`），两者可能不等，所以不要写成 `occurredAt <= recordedAt`，也不要在测试里断言磁盘记录满足这个不等式 | 冻结 §4、§5 |
| 4 | `writing.js:97-140` | `assertSource(source)`：`kind` 在词表内、`ref` 按 kind 校验、`inference` 不得带 `ref`、长度上限 | 冻结 §4 |
| 5 | `writing.js:142-210`（schema `142-180`，execute `182-210`） | `registerTool`：`write_memory` 的 name / description / parameters / output / execute（schema 直接照抄冻结文档 §2.2、§2.3） | 冻结 §2 |
| 6 | `writing.js:212-245` | `installMemoryWriteTools(ctx, store)`：注册 + 模块私有队列 | 冻结 §6 |

**计划行号**：`writing.js` 是新增文件，行号按各段的代码量估算（`npm test` 里没有"行号必须一致"的断言）。
它的用途是让 §4 的"实现落点"可复核；实施时若实际行号漂移，**同步改 §4**，不要让两处对不上。

**为什么这样切**：校验是 `revise_memory` 的前置——两工具共用 `normalizeInput` / `assertTimestamps` / `assertSource`，
先在一个工具上把它们调通，第二个工具只剩"链头判定 + 复制 supersedes"。

**为什么先做 write**：修订依赖"已存在的记忆"，没有写入就无法构造修订的测试夹具。

**探针断言**（每条都能在阶段末单独看到红灯）：

- `execute({ text: 'x' })` 返回对象含 `memoryId` 匹配 `/^m-/`、`seq === 1`、`recordedAt > 0`、`chars === 1`。
- `execute({ text: 'x', validHint: 'a'.repeat(401) })` 抛 `/^MEMORY_HINT_TOO_LONG/`，且 `store.size` 不变。
- `execute({ text: 'x', validHint: 'a'.repeat(400) })` 成功，落盘 `validHint.length === 400`。
- `execute({ text: 'x', validHint: '   ' })` 成功，落盘 `validHint === null`（空白折叠，见冻结 §4）。
- `execute({ text: 'x', source: { kind: 'file', ref: '   ' } })` 抛 `/^MEMORY_INVALID_SOURCE/`（`ref` 空串**不**折叠）。
- `execute({ text: '   ' })` 抛 `/^MEMORY_TEXT_EMPTY/`。
- `execute({ text: 'x'.repeat(4001) })` 抛 `MEMORY_TEXT_TOO_LONG`，且 `store.size` 不变。
- `execute({ text: 'x', occurredAt: -1 })` / `1.5` / `'123'` 抛 `MEMORY_INVALID_TIME`。
- `execute({ text: 'x', validFrom: 200, validTo: 100 })` 抛 `MEMORY_INVALID_RANGE`。
- `execute({ text: 'x', occurredAt: Date.now() + 86400000 })` 抛 `MEMORY_INVALID_TIME_ORDER`。
- `execute({ text: 'x', source: { kind: 'finding' } })` 抛 `MEMORY_INVALID_SOURCE`。
- `execute({ text: 'x', source: { kind: 'inference', ref: 'f-001' } })` 抛 `MEMORY_INVALID_SOURCE`。
- `execute({ text: 'x', source: { kind: 'unknown' } })` 抛 `MEMORY_INVALID_SOURCE`（`assertSource` 的词表里没有 `unknown`——**行为断言**；再补一条结构化断言：schema 的 `enum` 也不含 `unknown`。两道门都在，任一道单独失效都还有另一道）。

### 阶段 P2：`revise_memory` 与修订链

**目的**：让"改一条"成立，且三种拒绝（不存在、是 finding、已被改过）都明确。

**落点**（同文件）：

| 段 | 计划行号 | 内容 | 对应契约 |
|---|---|---|---|
| 7 | `writing.js:247-275` | `assertReviseTarget(store, memoryId)`：`f-` 前缀 → `MEMORY_SUPERSEDES_NOT_MEMORY`；`store.get` 为空 → `MEMORY_SUPERSEDES_UNKNOWN`；`store.all().some(r => r.supersedes === id)` → `MEMORY_SUPERSEDES_NOT_HEAD`（消息带后继 id） | 冻结 §6 |
| 8 | `writing.js:277-330` | `revise_memory` 的 schema 与 execute：`supersedes` 由工具层从 `memoryId` 复制，不读模型给的 `supersedes` | 冻结 §3 |
| 9 | `writing.js:332-360` | 私有队列：把"判链头 + `store.append`"整体串行 | 冻结 §6 第 3 条 |

**为什么顺序 7→8→9**：先有判定，再有工具，最后包并发；队列包在最外层，不改变任何语义。

**探针断言**：

- 写一条 → 修订 → 返回 `memoryId !== 目标`，`supersedes === 目标`，`store.size` 从 1 变 2。
- 旧记录 `store.get(目标)` 的十个字段与修订前逐项相等（无 `supersededBy`）。
- 修订刚被修订过的那条（第二次改同一目标）→ `MEMORY_SUPERSEDES_NOT_HEAD`，消息含后继 id。
- 修订改孙节点（`get(后继)` 那条）→ 成功，形成 `a ← b ← c` 链，`c.supersedes === b`。
- `revise_memory({ memoryId: 'f-001' })` → `MEMORY_SUPERSEDES_NOT_MEMORY`。
- `revise_memory({ memoryId: 'm-00000000-0000-4000-8000-000000000000' })` → `MEMORY_SUPERSEDES_UNKNOWN`，`store.size` 不变。
- 修订不传 `source` → 新记录 `source` 为 `{kind:'unknown',ref:null}`，旧记录 `source` 不变（**不继承**）。

### 阶段 P3：接线与生命周期

**目的**：让两个工具真的出现在插件里，并且卸载后不残留。

**落点**：

- `hikari-native/memory/tools.js:11`：`MEMORY_TOOL_NAMES = ['search_memory','read_memory','write_memory','revise_memory']`
  （`:9-10` 是该常量的注释，所以数组不在 `:9`）。
- `hikari-native/memory/index.js`：在 `:74`（`installMemoryTools(ctx, service)`）之后加
  `installMemoryWriteTools(ctx, store)`（实施后位于 `:77`，含三行注释）；import 加在文件头（实施后为 `:17`）。

**为什么在这里才接**：前两阶段可以在测试里直接调 `installMemoryWriteTools(ctx, store)`，不必先过插件的
service 依赖与冲突检查；接线最后做，失败时能立刻区分"工具逻辑错"还是"接线错"。

**探针断言**：

- 装上插件后 `ctx.tools.get('write_memory')` / `get('revise_memory')` 都非空。
- 卸载 fiber → 四个名字全部 `undefined`（`ctx.effect` 回收；与 `hikari-native/test/memory.test.mjs:202-213` 的卸载用例同一机制）。
- 重载 → 四个名字恢复，且 `write_memory` 能写进同一个 store（`seq` 接着往下走，不归零）。
- ready 行里 `tools=` 出现四个名字。

### 阶段 P4：并发与回归

**目的**：确认"并发写序号正确"与"旧行为没被碰"。

**落点**：只在测试里加并发夹具，不改实现。

**探针断言**：

- `Promise.all(Array.from({length: 20}, () => execute({ text: `n${i}` })))` → 20 个 `seq` 恰好是 `1..20`（集合相等、无洞、无重复）。
- 同一目标 20 个并发 `revise_memory` → 恰好 1 个成功，其余 19 个 `MEMORY_SUPERSEDES_NOT_HEAD`，`store.size === 2`。
- 全量 `hikari-native/test/memory.test.mjs` 与 `memory-store.test.mjs` 不回归（`memory.test.mjs:175-181` 按 §2 改成五个名字后，
  其余断言不变；`:202-213`、`:215-225` 两条生命周期用例按 §2 的描述改动或保持）。

## 4. 12 项验收 → 测试

文件：`hikari-native/test/memory-writing.test.mjs`。夹具沿用 `memory.test.mjs` 的写法：
`FakeTools extends Service`（注册走 `ctx.effect`）、`freshStoreDir()` 用 `mkdtemp` + `after` 清理、`until()` 轮询。

下表"实现落点"里的 `writing.js` 指 `hikari-native/memory/writing.js`、`store.mjs` 指 `hikari-native/memory/store.mjs`。
**行号已按实施结果复核**（2026-11-05，`writing.js` 共 483 行），不再沿用 §3 的计划值；测试名列的是实测的用例名。

| # | 测试名（都在 `hikari-native/test/memory-writing.test.mjs`） | 断言要点 | 实现落点（`文件:行号`） |
|---|---|---|---|
| 1 | `[1] 正常写入：返回 m- 前缀的 memoryId，并在存储里落一行` | 返回四键齐备；`store.size === 1`；**读 `memory.jsonl`**，末尾行十字段与 `get(id)` 一致 | `writing.js:366-420`（`write_memory` 注册与 execute）→ `:215-228`（`toAppendInput`）↦ `store.mjs:468-533` |
| 2 | `[2] 写入后关闭实例并重新打开，记录逐字段仍在` | 新 `MemoryStore.open` 后 `get(id)` 逐字段相等（含 `seq`、`recordedAt`） | `writing.js:366-420` ↦ `store.mjs:274-450`（重新 `open` 时逐行 fold 恢复） |
| 3 | `[3] 全局 memoryId 唯一：两次写入不同 id，重开后仍不重复` | 两个 id 不同；重开后 `all()` 无重复 id | `store.mjs:483`（`m-${randomUUID()}`，工程生成） |
| 4 | `[4] 工程字段不可伪造：schema 不暴露，绕过 schema 直接进 store 被白名单拒绝` | 结构化断言：`parameters.properties` 不含 `memoryId`/`recordedAt`/`seq`/`supersedes`，`additionalProperties === false`；行为断言：`store.append({ text:'x', memoryId:'m-x' })` 被拒，判 `error.code === 'INVALID_INPUT'`（该错误码在字段上，不在 message 里） | `writing.js:368-419`（schema 只有六个字段）+ `store.mjs:475-480`（白名单拒绝） |
| 5 | `[5] 非法输入逐条被拒绝且不落盘` | 空正文 / 超长正文（4001） / 超长 `validHint`（401） / 非整数时间 / 负时间 / `validTo<validFrom` / `occurredAt>now` / `kind` 非法 / 模型显式填 `unknown` / `inference` 带 `ref` / 缺 `ref` 的 `finding` / 空白 `ref` / 超长 `ref`；每条断言错误码前缀 + `store.size` 不变。另两条**成功**用例：`validHint` 400 字落 400 字、`validHint` 全空白落 `null` | `writing.js:67-78`（规范化）+ `:81-91`（`assertText`）+ `:94-115`（`assertHint`）+ `:118-145`（`assertTimestamps`）+ `:148-212`（`assertSource`） |
| 6 | `[6] 正常修订：追加一条新记录并指向旧记录，旧记录不动` | 新 `memoryId` ≠ 目标；`supersedes === 目标`；`size === 2` | `writing.js:422-482`（`revise_memory`，`supersedes` 由工具层复制；`store.append` 在 `:475`） |
| 7 | `[7] 修订后旧记录仍然存在，且一个字段都没被改写` | `get(目标)` 十字段与修订前 `deepStrictEqual`；对象无 `supersededBy` 键；重开后仍相等 | `store.mjs:510`（唯一写入路径是 `appendFile`，无重写） |
| 8 | `[8] supersedes 指向正确，链可两跳，且并发修订不产生分叉` | `b.supersedes === a.memoryId`；再修订 `b` 得 `c.supersedes === b.memoryId`；对 `a` 再修订抛 `NOT_HEAD` 且消息带后继 id；20 个并发修订恰 1 成功、指向目标的记录恰 1 条 | `writing.js:253-290`（`assertReviseTarget`）+ `:293-302`（私有串行队列）+ `store.mjs:499-505` |
| 9 | `[9] 不存在的修订目标被拒绝且不落盘` | `MEMORY_SUPERSEDES_UNKNOWN` 且消息**不**提 `search_memory`；`size` 不变；`f-001` 抛 `MEMORY_SUPERSEDES_NOT_MEMORY` | `writing.js:253-290` |
| 10 | `[10] 并发追加 20 次，seq 连续无洞` | `seq` 集合 === `{1..20}`；`size === 20`；`lastSeq === 20` | `store.mjs:458-466`（`#pending` 串行队列）+ `:492`（`#lastSeq + 1`） |
| 11 | `[11] 插件卸载后四个工具消失，重载后恢复且可写入` | 卸载后四个名字全部消失、`record_finding` 仍在；重载后四个都在且能写 | `writing.js:363-483`（注册走 `ctx.tools.register`，由 fiber 回收）；对照 `memory.test.mjs:202-213`（卸载）、`:215-225`（重载） |
| 12 | `[12] 检索工具与 World findings 不受影响，且检索结果里没有 m- 记录` | 复用既有断言（`search_memory`/`read_memory` 输出与 World 直调一致）；写入前后 `search_memory` 结果 `deepEqual` 相等且无 `m-` 前缀 id；`record_finding` 定义未变（不 execute：它要解析 host 的 `@deepseek-ai/dsh-session`） | `memory.test.mjs:168-171`（World 独占仍是三工具）、`:173-190`（Memory 接管，顺序断言在 `:175-181`）、`:202-213`（`record_finding` 仍在）、`:227-235`（Service 只读）；实现侧 `tools.js:11` 只加名字 |

**一条测试设计上的诚实说明**：`FakeTools.register` 只保存 definition，**不执行 schema 校验**。
所以"模型多传了 `memoryId`"这类只能由 runtime 的 schema 层挡住的情况，测试用**结构化断言**证明 schema 里
没有这个字段、且 `additionalProperties === false`；真正的行为断言落在存储层白名单（`store.mjs:475-480`）上。
不要在测试里假装 schema 生效了。

## 5. 验证命令

```bash
# 全量（与 CI 一致；先 build 再跑 tests）
npm test

# 只跑本片新增的用例（不需要 build：纯 .mjs）
node --test hikari-native/test/memory-writing.test.mjs

# 回归（M2-a 与插件生命周期）
node --test hikari-native/test/memory-store.test.mjs hikari-native/test/memory.test.mjs
```

`engines.node >= 22`（`package.json`），`node --test` 可直接用。

预期：新增用例全绿；回归用例数保持不变（M2-a 结案时 `hikari-native/test/memory-store.test.mjs` 是 **21 项全绿**，
全量 `npm test` 1107 项 / 1103 pass / 4 skip，见 `docs/development/m2a-memory-store.md:113`）。

**实测基线（2026-11-05，实施之前，本会话已具备 `pwsh`）**——上一版这里写的是"没有验证过"，现已实测：

| 命令 | 实测结果 |
| --- | --- |
| `git rev-parse HEAD` | `9df0d4d1ca504a2af3fafe686c8622d0c59b5ee0`，分支 `main` |
| `git status --short` | 五份 M2-b 文档与 `experiments/m2b-code-facts.md` 均为 `??`；`writing.js` 与 `memory-writing.test.mjs` 尚未创建（`Test-Path` 均为 `False`） |
| `npm test` | `tests 1107 / pass 1103 / fail 0 / cancelled 0 / skipped 4`，exit 0，与 `docs/development/m2a-memory-store.md:113` 一致 |
| `node --test hikari-native/test/memory-store.test.mjs` | 21 pass / 0 fail |
| `node --test hikari-native/test/memory.test.mjs` | 9 pass / 0 fail |

→ 实施完成后这张表要整体刷新，回归数只增不减；`hikari-native/test/memory.test.mjs:175` 的期望值从三个名字改成五个之后，该文件仍是 9 项。

**实测（2026-11-05，实施之后，同一台机器、同一 PowerShell）**：

| 命令 | 实测结果 |
| --- | --- |
| `git rev-parse HEAD` | `9df0d4d1ca504a2af3fafe686c8622d0c59b5ee0`（实施改动尚未提交） |
| `git status --short` | `M hikari-native/memory/index.js`、`M hikari-native/memory/tools.js`、`M hikari-native/test/memory.test.mjs`；`?? hikari-native/memory/writing.js`、`?? hikari-native/test/memory-writing.test.mjs`。**`hikari-native/memory/store.mjs` 不在列表里**——冻结条件仍然成立 |
| `npm test` | `tests 1119 / pass 1115 / fail 0 / cancelled 0 / skipped 4`，exit 0（1107 + 12，恰好是新用例数） |
| `node --test hikari-native/test/memory-store.test.mjs` | 21 pass / 0 fail（不变） |
| `node --test hikari-native/test/memory.test.mjs` | 9 pass / 0 fail（期望改成五个名字后仍是 9 项） |
| `node --test hikari-native/test/memory-writing.test.mjs` | 12 pass / 0 fail |

实施时发现并修正的一处实现缺陷：`validHint: '   '` 最初被折叠成空串 `''` 而不是 `null`（`normalizeInput` 先 trim 再判 null，`''` 漏过），测试 `[5]` 的"全空白 hint 落 null"抓到了它。

## 6. 回滚

- 范围小且自包含：新增一个模块 + 一个测试文件，改两个文件各一两行。回滚 = `git revert <commit>`。
- **数据侧安全**：写入的记忆只是 `memory.jsonl` 里的新行，回滚后插件不再认识 `write_memory`，
  但这些行仍是合法记录（十字段齐全），不影响启动、不影响 `search_memory` / `read_memory`（它们不读 memory）。
  代价是这些行在 M2-c 之前没有任何读取路径——**不会丢，只是暂时读不到**。
- 不要为了回滚去删 `memory.jsonl` 的行：那是手改用户数据，且破坏 append-only。

## 7. 实施时最容易踩的四处

1. **把模型给的 `memoryId` 当成新记录的 id**（`revise_memory`）。新记录 id 必须由 `store.append` 生成
   （`store.mjs:483`），工具层只把参数当 `supersedes` 用。
2. **自己生成 `recordedAt` / `seq`**。工具层若传这两个字段，`store.append` 会抛 `INVALID_INPUT`（白名单 `:475-480`）——
   这正好是验收 4 的第二道证据，别为了"顺手"把它改掉。
3. **给 `supersedes` 或 `memoryId` 在 schema 里留位置**。`additionalProperties:false` 与字段清单必须一致。
4. **忘了 `source` 不继承**：`revise_memory` 不要从目标记录里读 `source` 再传进去。

## 8. 交付后的两个已知局限（写进 commit message 与文档，不许省）

1. 模型没有时钟，`occurredAt` 会大量为 `null` —— 等人工裁决是否在返回值里带当前时间。
2. 模型无法回读 memoryId（检索只查 findings），修订能力实际只在同一上下文内可用 —— M2-c 的前置。
