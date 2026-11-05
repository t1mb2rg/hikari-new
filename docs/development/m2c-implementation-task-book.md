# M2-c 实施任务书 · `search_memories` / `get_memory`

日期：2026-11-05
依据：`docs/architecture/m2c-memory-discovery-interface-freeze.md`（冻结面）、`docs/architecture/m2c-memory-discovery-architecture-review.md`、`docs/development/m2c-memory-discovery-functional-review.md`、`experiments/m2c-code-facts.md`
本任务书**不授权**在获得人批准前修改实现代码。

---

## 1. 目标与不做

**目标**：在 `hikari-memory` 里加两个**只读**工具，让模型能在新 Session 里发现过去写下的记忆、读它的完整内容与链关系，从而在同一上下文里发起 `revise_memory`。

**不做**：见冻结面 §6（向量检索、自动注入、相关性排序、传递闭包、可达性检查、删除/合并/去重/过期、改 `search_memory`/`read_memory`、建反向索引）。

---

## 2. 文件清单

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `hikari-native/memory/recall.js` | 新增 | 两个只读工具的全部实现（约 430 行） |
| `hikari-native/memory/tools.js` | 改 1 行 | `MEMORY_TOOL_NAMES`（`:11`）扩到六个名字：`search_memory`、`read_memory`、`write_memory`、`revise_memory`、`search_memories`、`get_memory` |
| `hikari-native/memory/index.js` | 改 2 处 | `import { installMemoryRecallTools } from './recall.js'`；在 `installMemoryWriteTools(ctx, store)` 之后调用。ready 行不用改：它按 `MEMORY_TOOL_NAMES` 拼清单，名字变长后自动跟着变（M2-b 已验证） |
| `hikari-native/test/memory.test.mjs` | 改 3 处 | 工具顺序断言由五项改为**七项**（`record_finding` + 六个记忆工具；现有断言 `hikari-native/test/memory.test.mjs:175-181` 是五项（`record_finding` + 四个记忆工具））；卸载用例改名为「六个记忆工具消失」；重载用例同步 |
| `hikari-native/test/memory-recall.test.mjs` | 新增 | 12 项验收 |
| `hikari-native/memory/store.mjs` | **不动** | 只读用 `all()` / `get()` |
| `hikari-native/world/findings.js` | **不动** | Findings 所有权不变 |

本表 7 行 = 5 个会动的文件（新增 2、改 3）+ 2 个明确不动的文件（`store.mjs`、`findings.js`）。

---

## 3. 分阶段落点

> 下表行号是**计划值**，实施完成后必须按实际结果回填（M2-b 的教训：计划行号直接写进验收表会造成文档漂移）。

### 阶段 P1：检索主干（`recall.js` 六段）

| 段 | 计划行号 | 内容 | 探针断言 |
| --- | --- | --- | --- |
| 1 | `:1-40` | 常量：`SNIPPET_CHARS = 120`、`DEFAULT_LIMIT = 10`、`MAX_LIMIT = 20`、`SOURCE` 无关 | 导出与冻结面一致 |
| 2 | `:42-90` | `normalizeSearchInput(args)`：query trim 判空、since/until 折叠 null、limit 夹取、nextOffset 归零 | `''`/`'   '` → `MEMORY_QUERY_EMPTY`；`limit: 999` → 20；`nextOffset: -1` → 0 |
| 3 | `:92-150` | `matchMemories(records, input)`：子串（大小写不敏感）→ 时间窗（闭区间，null 不命中）→ `headOnly` → `seq` 倒序 | 三条记录命中两条；`occurredAt: null` 在给 `since` 时被排除 |
| 4 | `:152-200` | `indexSupersedes(records)`：一次遍历建 `Map<oldId, newId>` | 两个修订 → 两个映射，旧 id 全部有后继 |
| 5 | `:202-280` | `presentCandidate(record, supersededBy)`：五键 + snippet（`slice(0,120)`，截断加 `…`） | 长文本 snippet 长度 121（含省略号），短文本原样 |
| 6 | `:282-400` | 两个工具的 name/description/parameters/output/execute | `parameters.additionalProperties === false`；`required` 分别 `['query']`、`['memoryId']` |

### 阶段 P2：读取与链

| 段 | 计划行号 | 内容 | 探针断言 |
| --- | --- | --- | --- |
| 7 | `:402-430` | `installMemoryRecallTools(ctx, store)`：注册两个工具，`execute` 直接返回对象 | 注册两个名字；`ctx.tools.get` 冲突时抛可操作消息（与 `index.js:57-64` 同风格） |
| — | — | `get_memory` 的 execute：`f-` 前缀 → `MEMORY_NOT_A_MEMORY`；`store.get` 未命中 → `MEMORY_UNKNOWN_ID`；命中 → 十字段 + `supersededBy` | 三种分支各一条 |

### 阶段 P3：接线与生命周期

| 位置 | 动作 | 验收 |
| --- | --- | --- |
| `hikari-native/memory/tools.js:11` | 数组扩六个名字 | `MEMORY_TOOL_NAMES.length === 6` |
| `hikari-native/memory/index.js` | import + `installMemoryRecallTools(ctx, store)` | ready 行里出现六个名字 |
| `hikari-native/test/memory.test.mjs` | 顺序断言、卸载/重载用例 | 顺序断言的期望值改为七项（`record_finding` + 六个记忆工具）；卸载后六个记忆工具全部消失、`record_finding` 仍在；重载后六个都在 |

### 阶段 P4：测试与回归

| 位置 | 动作 |
| --- | --- |
| `hikari-native/test/memory-recall.test.mjs` | 12 项验收（见 §4） |
| 全量 | `npm test` |

---

## 4. 12 项验收 → 测试名

| # | 验收 | 测试名 | 落点 |
| --- | --- | --- | --- |
| 1 | 正常检索返回五键、不给全文 | `[1] 检索命中：返回 memoryId/snippet/occurredAt/validHint/supersededBy` | `recall.js:202-280`（presentCandidate）+ `:282-360`（search execute）；测试 `memory-recall.test.mjs:120-150`（计划） |
| 2 | 子串匹配、大小写不敏感、无关 query 不命中（返回空集） | `[2] 正文子串匹配、大小写不敏感，无关 query 返回空集` | `recall.js:92-150`；测试 `:152-175`（计划） |
| 3 | 时间窗闭区间、null 不命中 | `[3] since/until 是闭区间，occurredAt 为 null 时不命中时间窗` | `recall.js:92-150`；测试 `:177-205`（计划） |
| 4 | `headOnly` 排除被修订记录 | `[4] headOnly 排除已被修订的旧记录` | `recall.js:92-150` + `:152-200`；测试 `:207-230`（计划） |
| 5 | 按 `seq` 倒序 + 翻页 | `[5] 结果按 seq 倒序，limit/nextOffset 可翻页` | `recall.js:92-150`；测试 `:232-258`（计划） |
| 6 | 参数非法被拒 | `[6] 空 query、非整数时间、since>until 分别被拒` | `recall.js:42-90`；测试 `:260-285`（计划） |
| 7 | `get_memory` 返回完整十字段 + `supersededBy` | `[7] get_memory 返回完整十字段与派生 supersededBy` | `recall.js:362-400`；测试 `:287-315`（计划） |
| 8 | 前缀与不存在分别报错 | `[8] f- 前缀报 MEMORY_NOT_A_MEMORY，未知 m- 报 MEMORY_UNKNOWN_ID` | `recall.js:362-400`；测试 `:317-340`（计划） |
| 9 | 修订后链关系正确 | `[9] 修订后旧记录仍在，get_memory(旧) 的 supersededBy 指向新记录` | `recall.js:152-200` + `:362-400`；测试 `:342-372`（计划） |
| 10 | 空存储返回空集且无 `nextOffset`；检索只读（前后 `memory.jsonl` 字节与 `store.size` 不变） | `[10] 空存储返回空数组且不带 nextOffset；检索前后 memory.jsonl 与 store.size 不变` | `recall.js:282-360`；测试 `:374-392`（计划） |
| 11 | 插件生命周期 | `[11] 卸载后六个工具消失，重载后恢复` | `hikari-native/test/memory.test.mjs`（现有用例改造）；测试 `:394-410`（计划，boot 版本） |
| 12 | 回归 | `[12] 全量测试全绿，search_memory 结果里没有 m- 前缀 id` | 全量 + 现有 `memory.test.mjs` |

补充说明：

- 测试夹具复用 `hikari-native/test/memory-writing.test.mjs` 的 `openTools()` 形状（真 `MemoryStore` + 真 `installMemoryRecallTools`，`register` 换成 `Map`）。
- `FakeTools.register` **不执行 schema 校验**，「工程字段不可伪造」一类的结构性结论只能靠结构断言（`additionalProperties === false`、`required` 列表），不能靠「传了多余字段应当报错」的行为断言。
- 断言错误一律判消息前缀（`/^MEMORY_QUERY_EMPTY: /`），不要判错误类。

---

## 5. 验证命令

```bash
node --test hikari-native/test/memory-recall.test.mjs
node --test hikari-native/test/memory-writing.test.mjs
node --test hikari-native/test/memory.test.mjs
node --test hikari-native/test/memory-store.test.mjs
npm test
```

提交前（仓库纪律）：

```bash
node .gitnexus/run.cjs impact "installMemoryTools" --direction upstream --repo .
node .gitnexus/run.cjs impact "MEMORY_TOOL_NAMES" --direction upstream --repo .
node .gitnexus/run.cjs detect-changes --scope all --repo .
git status --short
```

预期：`memory-recall` 12 pass；`memory-writing` 12 pass；`memory` 9 pass（改后仍 9）；`memory-store` 21 pass；全量 `npm test` exit 0（实施前基线 1119 / 1115 pass / 0 fail / 4 skip）。

---

## 6. 回滚

本片**不迁移数据、不改存储格式**，回滚是纯代码回滚：

1. 删除 `hikari-native/memory/recall.js`、`hikari-native/test/memory-recall.test.mjs`。
2. 还原 `hikari-native/memory/tools.js:11` 的数组为四个名字。
3. 删掉 `hikari-native/memory/index.js` 的 import 与 `installMemoryRecallTools(ctx, store)` 调用。
4. 还原 `hikari-native/test/memory.test.mjs` 的工具顺序断言与用例名。
5. `memory.jsonl` 无需处理——只读工具从不写盘。

---

## 7. 易错点

1. **把 `search_memories` 写成 `search_memory`**——两个工具只差一个字母，改错会把 findings 检索的行为改掉，直接违反 M2-b 验收第 12 项。
2. **给可能为 null 的字段写 `type: ['number','null']`**——dsh-tools 不接受类型数组，会让整个插件激活失败（`hikari-native/memory/tools.js:54-56` 有实测记录）。可能为 null 的键省略 `type`，只在 `description` 说明。
3. **用 `occurredAt` 排序**——它大量为 null，排出来的顺序没有意义；冻结面规定按 `seq` 倒序。
4. **把 `supersededBy` 写进记录**——它是派生键，落盘会破坏 M2-a 的十字段契约（`hikari-native/memory/store.mjs:105-158` 会直接拒收）。
5. **在 `get_memory` 里递归展开链**——M2 §10.1 风险表明确不做传递闭包（`docs/architecture/memory-core-m2-architecture-v0.1.md:383`）。
6. **`limit` 超界时报错**——上限是上限，不是契约；夹到边界即可。

---

## 8. 已知局限（写进 commit message）

1. 检索是**全表扫**（`store.all()` 为 O(n)，`hikari-native/memory/store.mjs:259-261`）；记录上万条后需要索引，属后续阶段。
2. `occurredAt` 长期大量为 null（模型没有时钟），时间窗会漏掉这些记录。
3. `search_memory` 与 `search_memories` 命名相近，只能靠 description 区分。
