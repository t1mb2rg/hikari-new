# M2-d 独立评审用的可复跑证据

**日期** 2026-11-05
**基线** `main` @ `aac2144`（本片改动未提交，以下读数都取自工作树）
**这份文件是什么** 不是结论，是给独立评估者的材料：冻结面条款 → 代码行号、diff 的文件面、两条命令的输出（测试输出为尾部摘录，见 §4；diff 为完整输出，见 §3）。每条都可以在仓库里重跑。

## 1. 冻结面 §2.1 六条规则 → `hikari-native/memory/recall.js`

冻结面：`docs/architecture/m2d-memory-matching-interface-freeze.md` §2.1（`:36-43`）。

| 冻结面规则 | 代码位置 | 原文 |
| --- | --- | --- |
| 规则 1：整串子串 → 强度 1 | `recall.js:152` | `if (t.includes(q)) return 1` |
| 规则 2：`/[\s\p{P}\p{S}]+/u` 切词，拉丁词元按 `/^[a-z0-9_.#/-]+$/u` 判定 | `recall.js:40`（`SEPARATOR`）、`recall.js:42`（`LATIN_WORD`）、`recall.js:112-114`（`tokensOf`） | `function tokensOf(text)` |
| 规则 3：任一拉丁词元不被正文词元包含 → `null` | `recall.js:154-160` | `if (!textTokens.some((candidate) => candidate.includes(token))) return null` |
| 规则 4：中文侧取相邻字对，单字片段取自身 | `recall.js:123-134`（`cjkFragmentsOf`） | `function cjkFragmentsOf(text)` |
| 规则 5：中文侧为空且有拉丁词元 → 0.5 档 | `recall.js:163` | `if (fragments.size === 0) return latinTokens.length > 0 ? LATIN_ONLY_STRENGTH : null` |
| 规则 6：覆盖率 < 0.25 → `null`，否则返回覆盖率（上限 0.99） | `recall.js:33`（`MIN_COVERAGE = 0.25`）、`recall.js:165-170` | `return Math.min(coverage, MAX_FRAGMENT_STRENGTH)` |

## 2. 冻结面 §2.2 排序 → `matchMemories`

冻结面：同文件 §2.2（`:45-49`）要求「强度倒序；强度相同 `seq` 倒序」。

```js
// hikari-native/memory/recall.js:197
const strength = matchStrength(input.query, record.text)
// hikari-native/memory/recall.js:208
matched.sort((a, b) => b.strength - a.strength || b.record.seq - a.record.seq)
```

- `matchMemories` 入口：`recall.js:194`（`export function matchMemories(records, input, supersededBy = indexSupersedes(records))`）。
- 过滤顺序仍是「匹配 → 时间窗 → `headOnly`」（冻结面 §2.3 第 1 条），没有换序。

## 3. diff 的文件面（「只改检索层」的硬证据）

```
$ git diff --stat
 .../m2c-memory-discovery-interface-freeze.md       |  12 ++-
 docs/development/known-tool-issues.md              |   7 +-
 hikari-native/memory/recall.js                     | 120 +++++++++++++++++++++-----
 hikari-native/test/memory-recall.test.mjs          |  95 +++++++++++++++-
 4 files changed, 209 insertions(+), 25 deletions(-)
```

- `hikari-native/memory/store.mjs`、`hikari-native/memory/writing.js`、`hikari-native/memory/tools.js`、`hikari-native/world/findings.js` **均不在 diff 里**。
- 第四个文件 `docs/development/known-tool-issues.md` 是**片外改动**：把 TI-1「独立评估者派遣失败」从「未恢复」更新为「已恢复（2026-11-05 复核）」，与本片实现面无关。只算本片三份（recall.js、测试、M2-c 冻结面）时是 `3 files changed, 203 insertions(+), 24 deletions(-)`。
- **行号基准**：本文件与 `docs/development/m2d-verification.md` 的行号按交付版 `recall.js`（416 内容行，已删 `needle`）。两条已核验事实（f-sc1mbs「冻结面可实现」、f-dd68gz「强度排序有效」）的 basis 落盘早于删 `needle` 9 秒，引用的是 417 行快照，**读数整体比交付版大 1**（示例：事实写 `:153`，交付版是 `:152`；写 `:209`，交付版是 `:208`）。**整篇 basis 一律减 1** 即可回源到交付版；常用几条的对照：`153→152`、`113-115→112-114`、`155-161→154-160`、`124-135→123-134`、`164→163`、`166-171→165-170`、`209→208`、`210→209`、`220-228→219-227`。
- 唯一的文档改动是 `docs/architecture/m2c-memory-discovery-interface-freeze.md`（冻结面 §3 要求的四处修订 + 文首说明），不是实现文件。
- 未跟踪的新文件（`docs/architecture/m2d-*.md`、`experiments/m2d-matching/`）不含实现代码。

## 4. 测试输出（尾部摘录）

下面是**尾部摘录**（`node --test` 输出共 16 个 ✔，此处只留 M2-d 新增的 `[13]`–`[16]` 四行与汇总行，中间 `[1]`–`[12]` 省略）：

```
$ node --test hikari-native/test/memory-recall.test.mjs
✔ [13] matchStrength：整串命中 1、片段按覆盖率、拉丁词元必须落在正文词元里
✔ [14] B1 现场四条 query 在只有一条记录时各命中一条（M2-d 的主证据）
✔ [15] 无关 query 仍然空集（收紧口径不能换来假阳性）
✔ [16] 排序按命中强度：整串命中压过片段命中，即使后者更新
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

`[16]`（`hikari-native/test/memory-recall.test.mjs:467-489`）三条断言：整串命中的那条排在片段命中之前（即使片段命中更新），同强度时按新到旧（`seq` 倒序）。

```
$ npm test
ℹ tests 1135
ℹ pass 1131
ℹ fail 0
ℹ skipped 4
```

前提：在含 `.git` 的仓库根跑（`hikari-native/world/findings.js:403-410` 在非 git 目录下 fail-closed，会少 8 个 world/findings 用例，与本片无关）。

## 5. 探针口径 vs 实施口径的逐格对账

```
$ node experiments/m2d-matching/crosscheck.mjs
改了旧记录会不会被覆盖      同义   hit  2   2   0.40 / 0.40
两次修改同一条记忆          同义   hit  0   0   — / —
memory 修订 规则 是什么     跨语言  hit  2   2   0.25 / 0.25
完全不存在的词              无关   miss 0   0   — / —
TypeScript 编译错误         无关   miss 0   0   — / —
npm test 跑多久             无关   miss 0   0   — / —

命中 10/12，误命中 0，逐格不一致 0 → 实施与探针同口径
```

（中间若干行省略；完整 19 行在命令输出里。左侧是探针 `E.25` 列的强度，右侧是用实施后 `matchStrength` 重算的强度。）

## 6. 三条判断各自该看哪一段

| 判断 | 看这份文件的哪一节 | 还能额外核对什么 |
| --- | --- | --- |
| 冻结面可实现 | §1、§2、§3 | 冻结面 §2.1 六条与 §2.2 排序是否真的一条不漏，以及是否被迫改 store（§3 的 diff 面） |
| 强度排序有效 | §2、§4、§5 | `[16]` 的三条断言原文（`:467-489`）；crosscheck 里「强度更高」的行是否也是事实上更相关的那条 |
| 只改检索层 | §3、§4 | `git diff` 里没有 `store.mjs`/`writing.js`/`tools.js`；全量 1135/1131/0/4 说明写入侧测试没变 |

## 7. 这份文件没做的事

- 没有重跑真实会话（跨进程复现 B1 需要另一个 profile 与一次真实对话，属 M2-c 的验证范围，本片不重复）。
- 没有把「阈值 0.25 在更大语料上是否仍 0 误命中」当成已验证——这仍是未测项。
- 没有请人看过冻结面本身对不对（那是独立评审要回答的，不是本文件能自证的）。
