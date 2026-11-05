# M2-d 冻结面自评审记录

**日期** 2026-11-05
**评审对象** `docs/architecture/m2d-memory-matching-interface-freeze.md`（下称「冻结面」）
**评审人** 实施者本人（`deepseek-account/deepseek-flash`，单进程、无第二人参与）

> **这份记录的性质先说清楚**：这是**自评审**，不是独立评审。冻结面 §8 第 1 条要求「冻结面评审通过」才实施，本片在实施前没有第二个人看过冻结面；所以本节记录的是「实施者逐条对照自己写的契约」，能证明的是**契约与代码一致**，不能证明「契约本身是对的」。是否补一次独立评审，由人决定。

## 1. 评审范围与方法

逐条读冻结面 §2.1（匹配强度）、§2.2（强度分与排序）、§2.3（不改的东西）、§3（对 M2-c 的四处修订）、§5（七项验收）、§6（明确不做），每条都回到代码或命令输出核对，不引用「我记得」。

核对手段：

- 代码：`read` / `Select-String` 直接读 `hikari-native/memory/recall.js` 与测试文件（`Get-Content` 在本仓库的 UTF-8 文件上行号会错位，不用它数行）。
- 行为：`node --test hikari-native/test/memory-recall.test.mjs`（16 pass）与全量 `npm test`（1135 tests / 1131 pass / 0 fail / 4 skip）。
- 口径对账：`experiments/m2d-matching/crosscheck.mjs` 用**实施后的** `matchStrength` 重放探针的 19 条 query，与 `matching-probe.md` 的 `E.25` 列逐格比对 → 命中 10/12、误命中 0、逐格不一致 0。

## 2. 逐条对照

| 冻结面条款 | 代码/证据 | 结论 |
| --- | --- | --- |
| §2.1 规则 1：整串子串 → 强度 1 | `recall.js:152`（`if (t.includes(q)) return 1`）；测试 `[13]` 的 `matchStrength('memory 修订约定', REAL_TEXT) === 1`（`hikari-native/test/memory-recall.test.mjs:418`） | 一致 |
| §2.1 规则 2：`/[\s\p{P}\p{S}]+/u` 切词，拉丁词元按 `/^[a-z0-9_.#/-]+$/u` 判定 | `recall.js:31-42`（`SEPARATOR`、`LATIN_WORD`）、`tokensOf` `:112-114` | 一致 |
| §2.1 规则 3：任一句拉丁词元不被正文词元包含 → `null` | `matchStrength` 内拉丁词元循环；测试 `[13]` 的 `typescript`（正文无该词元）→ `null` | 一致 |
| §2.1 规则 4：中文侧取相邻字符对，单字片段取自身 | `cjkFragmentsOf` `:123-134`；测试 `[13]` 的 `memory 修订 规则 是什么` → `0.25`（四片段中 `修订`） | 一致 |
| §2.1 规则 5：中文侧为空且未走快速路径 → 见 §2.2 的 0.5 档 | `matchStrength` 中「无中文侧但有拉丁词元」分支 `:163` `return LATIN_ONLY_STRENGTH`；测试 `[13]` 的 `revise-memory` → `0.5`（`hikari-native/test/memory-recall.test.mjs:424`） | 一致 |
| §2.1 规则 6：覆盖率 < 0.25 → `null`，否则返回覆盖率（上限 0.99） | `MIN_COVERAGE = 0.25`（`:33`）、`:170` `Math.min(coverage, MAX_FRAGMENT_STRENGTH)`；测试 `[13]` 的 `0.20` 用例 → `null` | 一致 |
| §2.2 排序：强度倒序，同强度 `seq` 倒序 | `matchMemories` `:194-210` 的 `b.strength - a.strength \|\| b.record.seq - a.record.seq`；测试 `[16]` 三条断言（`hikari-native/test/memory-recall.test.mjs:471` 片段那条更新、`:474-478` 整串命中先出现、`:484-488` 同强度按新到旧） | 一致 |
| §2.3 过滤顺序、五键结果、分页、其余五工具、`store.mjs`、错误码一律不动 | `git diff --stat` 的实现面只有 `recall.js` 与 `memory-recall.test.mjs`；另外两份是文档（M2-c 冻结面四处修订、`known-tool-issues.md` 的 TI-1 状态），`store.mjs` 无改动；`[1]`–`[12]` 全部仍绿 | 一致 |
| §3 四处修订已落到 M2-c 冻结面正文 | `docs/architecture/m2c-memory-discovery-interface-freeze.md` 的 `:79`（匹配口径）、`:83`（排序）、`:177`（§6 第 1 条）、`:179`（§6 第 3 条），文首 `:8` 有 M2-d 修订说明 | 一致 |
| §5 第 1 项：原 12 用例仍通过（含 `[2]` 的 `ableGi`、`[3]` 时间窗、`[4]` `headOnly`） | `node --test` 16 pass；`[2]` 未改一行，`ableGi` 仍靠快速路径命中 | 一致（且实施前预估会破，实测未破；这条自查异常只记在交付过程的任务书未解释项里，本文件不用它的编号） |
| §5 第 2 项：B1 四条现场 query 各命中 1 条（1 条记录） | 测试 `[14]`（`:433`）用 `store.append` 造 1 条记录后逐条断言 | 一致 |
| §5 第 3 项：七条无关 query 空集 | 测试 `[15]`（`:449`），含纯英文问法 | 一致 |
| §5 第 4 项：整串命中排在片段命中之前；同强度按 `seq` 倒序 | 测试 `[16]`（`:467`） | 一致 |
| §5 第 5 项：`snippet` 仍前 120 个 UTF-16 码元、补 `…` | `snippetOf` 未改（`:213-216`）；`[5]`（`:173`）仍绿 | 一致 |
| §5 第 6 项：`revise-memory` 走 0.5 档、`revise` 走快速路径 1 | `[13]` 里 `revise-memory → 0.5`（`hikari-native/test/memory-recall.test.mjs:424`）与 `revise → 1`（`:426`）两处断言；冻结面 `:97` 有实施时校正说明 | 一致 |
| §5 第 7 项：全量不少于 1131/1127/0/4 | `npm test` 实测 1135 / 1131 / 0 / 4 | 一致 |
| §6 明确不做：不加 `score`、不改 `search_memory`、不加索引 | `results` 五键未变（`presentCandidate` 未改）；`tools.js` 未改；无缓存/索引代码 | 一致 |

## 3. 自评审发现并已处理的问题

1. **冻结面 §5 第 6 项的例写错了**：原例 `revise` 说走 0.5 档，实际 `revise` 是 `revise_memory` 的子串、走快速路径得 1。已在冻结面 `:94`/`:97` 如实校正，并保留了校正说明（不改原文、加注）。
2. **探针的阈值结论只能算「本集合最优」**：0.25 与 0.30 只差一条 query（`memory 修订 规则 是什么`），19 条 query 里 6 条是真实、13 条是我构造的。冻结面 `:25` 已写明「这是本集合决定的线，不是理论最优」，没有把它写成通用结论。

## 4. 自评审无法覆盖的部分（留给人或独立评审）

- **契约本身对不对**：「强度倒序、同强度 `seq` 倒序」是否比「只按 `seq`」更符合使用方直觉，自评审判不了——它需要第二个使用方。
- **0.25 的推广性**：真实记忆库到几十条、几百条时误命中率如何，本片只有 1–2 条记录的现场数据。
- **三条残余缺口的优先级**：纯换义/跨语言/单字 query 哪个先补，属产品判断，冻结面 §7 只给了代价表，没有排序。
- **独立复跑**：`npm test` 与 16 个用例都在本机跑的；独立评审应在一份干净副本里复跑（M2-c 那次独立评估者发现副本没有 `.git` 时 `[11]` 会因 `findings.js` 的 fail-closed 失败，与实现无关）。

## 5. 结论

冻结面的每一条都能在代码或命令输出里找到对应位置，实施与契约没有分叉；§5 七项验收全部有测试或实测读数支撑。**但这是自评审**——「契约与代码一致」已验证，「契约是否正确」未验证。建议提交前由人指定一次独立评审（范围就是本文件 §2 的表 + §4 的四项）。
