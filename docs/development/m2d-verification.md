# M2-d 实施验证：记忆检索匹配口径

> 冻结面：`docs/architecture/m2d-memory-matching-interface-freeze.md`
> 证据：`experiments/m2d-matching/matching-probe.md`（选口径）、`experiments/m2d-matching/crosscheck.mjs`（口径落地核对）
> 实施提交：本次改动尚未提交（工作树内四个文件：实现面两份 + M2-c 冻结面 + 片外改动一份，见 §2）

## 0. 结论

匹配口径按冻结面落地：整串子串仍是快速路径（强度 1），其余按「拉丁词元必须被正文词元包含 + 中文 bigram 覆盖率 ≥ 0.25」评定；排序改为强度优先、同强度按 `seq` 倒序。B1 现场那四条 query 在只有会话 A 那条记录时**全部命中**（原先 0 命中），六条无关 query 与一条纯英文问法**仍然全部不命中**。改动只落在 `hikari-native/memory/recall.js` 与其测试文件，`store.mjs` / `tools.js` / `index.js` / `writing.js` 未动，工具名、五键结果、分页与错误码未变。

## 1. 验的是什么

| 项 | 基线 | 本次读数 |
| --- | --- | --- |
| 全量 `npm test` | 1131 tests / 1127 pass / 0 fail / 4 skip | **1135 / 1131 / 0 / 4** |
| `node --test hikari-native/test/memory-recall.test.mjs` | 12 pass | **16 pass** |
| B1 四条现场 query 命中（1 条记录） | 0 / 4 | **4 / 4** |
| 无关 query 误命中（2 条记录） | 0 | **0** |

基线取自 M2-c 结束时（`docs/development/m2c-implementation-task-book.md` §5 的实测表）。新增 4 个用例，所以是 1131 → 1135。

## 2. 改动清单

`git diff --stat`：

```text
 docs/architecture/m2c-memory-discovery-interface-freeze.md |  12 ++-
 docs/development/known-tool-issues.md                     |   7 +-
 hikari-native/memory/recall.js                            | 120 +++++++++++++++++++++-----
 hikari-native/test/memory-recall.test.mjs                 |  95 +++++++++++++++++++++++-
 4 files changed, 209 insertions(+), 25 deletions(-)
```

第四个文件 `docs/development/known-tool-issues.md` 是**片外改动**（把 TI-1「独立评估者派遣失败」从「未恢复」更新为「已恢复（2026-11-05 复核）」）；它不属于本片实现面。只算本片三份时是 `3 files changed, 203 insertions(+), 24 deletions(-)`。

`recall.js` 五处：常量（`MIN_COVERAGE = 0.25`、`LATIN_ONLY_STRENGTH = 0.5`、`MAX_FRAGMENT_STRENGTH = 0.99`、分隔符与拉丁词元正则）、`tokensOf` / `cjkFragmentsOf`、`matchStrength`、`matchMemories` 的过滤与排序、`SEARCH_DESCRIPTION` 与 `query` 参数描述。

没有加 `score` 键（冻结面 §6）；强度只参与排序，不出现在结果里。

## 3. 冻结面 §5 七项，逐项对上

| §5 | 内容 | 由谁证 | 读数 |
| --- | --- | --- | --- |
| 1 | 原 12 用例全部仍通过（含 `[2]` 的 `ableGi`、`[3]` 时间窗、`[4]` `headOnly`） | `memory-recall.test.mjs` `[1]`–`[12]` | 12/12 pass，原样未改 |
| 2 | B1 四条现场 query 在 1 条记录上各命中 1 条 | `[14]` | 4/4；`crosscheck.mjs` 另在真库两行快照上重放，逐格一致 |
| 3 | 七条 query（含纯英文问法）在 2 条记录上均空集 | `[15]` | 7/7 空集 |
| 4 | 整串命中排在片段命中前；同强度按 `seq` 倒序 | `[16]` | 整串（强度 1）在片段（0.83）之前，尽管后者 `seq` 更大；三条同强度（0.83）按 4→3→2 的新到旧排列 |
| 5 | `snippet` 仍取前 120 个 UTF-16 码元、截断补 `…` | `[1]`（长正文用例） | `snippet.length === 121`、以 `…` 结尾 |
| 6 | 只有拉丁词元、整串不是子串时走 0.5 档 | `[13]` | `revise-memory` → `0.5`；`revise` 本身是子串 → `1` |
| 7 | 全量测试不少于基线 | `npm test` | 1135 / 1131 / 0 / 4 |

`[13]` 的完整强度表（正文即会话 A 写入的 954 字原文）：

| query | 强度 | 原因 |
| --- | --- | --- |
| `修订只能改链头` | `1` | 整串子串 |
| `memory 修订约定` | `1` | 整串子串（大小写不敏感） |
| `memory 修订 规则 是什么` | `0.25` | 中文四片段只中 `修订`，恰好压线 |
| `修订 规则 词汇 语义 关系` | `null` | 五片段只中一个 = 0.20，差一格落空 |
| `typescript` | `null` | `typescript` 不在正文词元里（`script` 才算） |
| `revise-memory` | `0.5` | 两个拉丁词元都在，但整串不是子串 |
| `revise` | `1` | 是 `revise_memory` 的子串，走快速路径 |
| `完全不存在的词` | `null` | 只中 `存在` 一个片段 |

`0.25` 与 `0.20` 这两行是有意配对的：它证明阈值不是装饰，差一格就落空。

## 4. 口径落地核对（探针 vs 实现）

探针里的 `latinAndCjkMix` 是独立实现（用来选口径），真正装进插件的是 `recall.js` 的 `matchStrength`。`node experiments/m2d-matching/crosscheck.mjs` 用后者重放探针的 19 条 query，逐格比对 `matching-probe.md` 的 `E.25` 列：

```text
命中 10/12，误命中 0，逐格不一致 0 → 实施与探针同口径
```

这条同时满足冻结面 §8 第 4 条（探针口径在实施后不得变差）：B1 仍 4/4、无关 query 仍 0 误命中，且 19 个格子一个不差。

## 5. 冻结面的一处校正

§5 第 6 项原例写的是 `revise` 走 0.5 档，但 `revise` 是正文 `revise_memory` 的子串、走快速路径得 1，够不到 0.5。已把该行改为 `revise-memory`（两个词元都在、整串不是子串），并在 §5 末尾留了校正说明。这是举例错误，不是口径变更。

## 6. 没验到的与已知局限

1. **真实会话没有重放 B1。** 实现口径是用「会话 A 的真实正文 + B1 的真实 query」在测试与 `crosscheck.mjs` 里重放的，等价性由同一份正文和同一批 query 保证；但「模型这次会不会换个说法」属于 M2-e 的问题，本片不回答。
2. **阈值只有 1–2 条记录做样本。** `0.25` 在 19 条 query 上 0 误命中，但语料极小；记录变多以后是否需要重新标定，得看 M2-e 的真实读数。
3. **`occurredAt` 大量为 null。** 时间窗对 null 一律不命中，这是 M2-c 的既有边界，本片没动。
4. **全表扫 O(n)。** 每次检索现算强度，没有索引；记录量级上来后是已知代价。
5. **三类字面天花板**（冻结面 §7）：纯换义（`两次修改同一条记忆`）、纯英文问法、单字 query（`记忆`）。它们不是阈值问题，加阈值救不回来。

## 7. 复现命令

```bash
node --test hikari-native/test/memory-recall.test.mjs
node experiments/m2d-matching/crosscheck.mjs
npm test
```

**全量 `npm test` 的前提：在含 `.git` 的仓库根运行。** 这不是本片引入的限制：`hikari-native/world/findings.js:403-410` 在拿不到 git 项目时走 fail-closed——只提供空数据源、不注册 `record_finding`（日志 `hikari findings: "<root>" is not a git repository; record_finding disabled (fail-closed)`）。在一份没有 `.git` 的复制目录里跑，会看到 8 个 world/findings 相关用例失败，与本片改的检索层无关；M2-c 的独立评估者在副本里也遇到过同一现象（那次是 `git init` 后全绿）。本片所有读数都在真实仓库根跑的。
