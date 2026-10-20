# 四个判断模块的判断权（第一手源码核对）

范围：`src/repository-ci-relevance/`、`src/repository-ci-diagnosis-proposal/`、`src/repository-ci-attention/`、`src/desktop-return-attention/`。
所有行号取自当前工作区（HEAD = `09410ec` 之后），逐行读过原文件。

分类口径：

- **事实判定**：这次观测/这次运行/这段沉默，事实上是什么。
- **重要性判断**：值不值得打扰人、重不重要、是不是好时机。
- **行动授权**：允许不允许做某个动作（调工具、改文件、发通知）。

---

## 1. Repository CI Relevance

模块对外：`judgeRelevance(designations, snapshot, declared)` → `{verdict: 'relevant' | 'unknown', designation?, via?}`（`src/repository-ci-relevance/judgement.ts:65-69`）。

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | GitHub CI facet 是否可用；不可用直接 `unknown` | 事实判定 | 确定性代码 | `src/repository-ci-relevance/judgement.ts:75` | `if (githubCi.kind !== 'available') return UNKNOWN;` |
| 2 | 人的某条声明是否与观测到的 repository **逐字相等** | 事实判定 | 确定性代码 | `judgement.ts:86-90` | `if (designation === repository)` |
| 3 | 人启动时给的配对：观测名与人写的 github 名逐字相等，且某条声明与 localRoot 逐字相等 | 事实判定 | 确定性代码 | `judgement.ts:96-110` | `declared.githubRepository !== repository` / `designation === declared.localRoot` |
| 4 | 「两个拼写是不是同一个仓库」——**明确不做** | 事实判定（被拒绝） | 无 owner | `judgement.ts:77-84` | 注释列出八种被排除的做法：trim、大小写折叠、basename、拆 owner/name、重写 remote URL、检测 fork、别名表、**asking a model** |
| 5 | 这条观测重不重要 / 值不值得说 | 重要性判断 | 无 owner | `judgement.ts:1-24`（整段注释） | 文件只做「字符串相等」，不读 run / branch / workflow / conclusion |

**模型参与**：无。`asking a model` 被写进排除清单（`:55`），理由是「那是关于意义的推断，不是两个来源报告了什么」（`:80-81`）。

---

## 2. Repository CI Diagnosis Proposal

模块对外：`judgeProposal({occurrence, assessment, relevance, ownAction?})` → `check-commit-alignment` / `inspect-own-action` / `inspect-run-steps` / `insufficient-evidence`（`src/repository-ci-diagnosis-proposal/judgement.ts:80-85`）。

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | snapshot 里有没有 CI facet（没有就无从建议） | 事实判定 | 确定性代码 | `judgement.ts:92` | `if (assessment.snapshot.githubCi.kind !== 'available') return insufficient(...)` |
| 2 | 相关性是否已成立（只**消费**，不重算） | 事实判定 | 确定性代码 | `judgement.ts:97` | `if (relevance.verdict !== 'relevant') return insufficient('relevance-not-established')` |
| 3 | 两个 commit 串比对的三种情形：different / same / indeterminate | 事实判定 | 确定性代码（上游 `commitComparison`） | `judgement.ts:107-120` | `switch (assessment.commitComparison)` |
| 4 | 三种情形各自该建议人看什么 | 行动候选（建议文案） | 确定性代码（固定映射） | `judgement.ts:111-120` + `render.ts` | `'check-commit-alignment'` / `'inspect-run-steps'` / `insufficient('commit-comparison-indeterminate')` |
| 5 | `different` 是否来自 Hikari 自己此前的推送 | 事实判定 | 确定性代码（executor 的记录，作为入参） | `judgement.ts:111-116` | `ownAction === undefined ? ... : {kind:'inspect-own-action'}` |
| 6 | 这次失败到底「重不重要」 | 重要性判断 | **无 owner**（注释明说） | `judgement.ts:5-6` | `It is not "does this matter" ... not "is this important" (no layer in this repository owns that)` |
| 7 | 该做什么（动手） | 行动授权 | 无（本模块不行动） | `judgement.ts:6` | `not "what should be done" (this module does not act)` |

**模型参与**：不在本模块。模型在 `supplement.ts`，只在第 4 行的三种固定建议**都没给出**（`insufficient('commit-comparison-indeterminate')`）时提供一段补充文案，且不影响 delivered 判定（见 §4 与既有实验 `experiments/ci-supplement-increment/report.md`）。

---

## 3. Repository CI Attention

模块对外：`detectNewFailure(observation, handledFailures, deliveredFailures)` → occurrence 或 `undefined`（`src/repository-ci-attention/judgement.ts:84-110`）；`renderOccurrence` 生成八行通知（`:135-146`）。

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | 有没有 latest run 被报告 | 事实判定 | 确定性代码 | `judgement.ts:89-90` | `if (latest.kind !== 'reported') return undefined;` |
| 2 | run 是否已 completed | 事实判定 | 确定性代码 | `judgement.ts:93` | `if (run.status !== 'completed') return undefined;` |
| 3 | 结论字段是否被报告 | 事实判定 | 确定性代码 | `judgement.ts:94` | `if (run.conclusion.kind !== 'reported') return undefined;` |
| 4 | 结论是否属于「跑了且失败」的三个词 | 事实判定 | 确定性代码（**硬编码集合**） | `judgement.ts:32`、`:95` | `new Set(['failure','timed_out','startup_failure'])`；`cancelled` / `action_required` / `neutral` / `skipped` / `stale` 被显式排除（`:22-25`） |
| 5 | 本次激活是否已处理过这个失败 | 事实判定 | 确定性代码（内存集合） | `judgement.ts:98` | `if (handledFailures.has(key))` |
| 6 | 过往激活是否已成功投递过 | 事实判定 | 确定性代码（**来自 Chronicle 的历史**） | `judgement.ts:99` | `if (deliveredFailures.has(key))` |
| 7 | 生成给人看的八行通知 | 表达（不作判断） | 确定性代码 | `judgement.ts:135-146` | 每行都是 header 或 occurrence 字段原样；注释 `:121-124` 明说「不说什么关于」 |
| 8 | 这次失败重不重要、值不值得打扰 | 重要性判断 | **明确禁止** | `judgement.ts:11-12` | `Neither of them is allowed to ask whether the failure *matters*: relevant ≠ salient` |

**模型参与**：无。补充段由 plugin 在 delivery 前拼进 lines，`detectNewFailure` 与 `renderOccurrence` 都不涉及。

---

## 4. Desktop Return Attention

模块对外：`stepReturn(observation, watch, afterMs)` → `{watch, endedSilenceMs}`（`src/desktop-return-attention/judgement.ts:89-90`）；`renderOccurrence` 渲染。

| # | 判断内容 | 类型 | 执行者 | 文件:行号 | 关键代码 |
|---|---|---|---|---|---|
| 1 | 32 位计数器是否倒退（重启或回绕，无法分辨） | 事实判定 | 确定性代码 | `judgement.ts:69-71`、`:89+` | 注释：`a reboot or a 32-bit wrap — this activation cannot tell which, and it does not try` |
| 2 | 沉默时长是否达到运营者给的阈值 | 事实判定（阈值来自外部） | 确定性代码 | `judgement.ts:72-73` | `silence at threshold`；阈值 `afterMs` 由 CLI 传入（`src/cli/resident.ts:462-465`） |
| 3 | 沉默是否结束（新输入发生） | 事实判定 | 确定性代码 | `judgement.ts:74-83` | 只有「新输入」能让差值跌破阈值 |
| 4 | 沉默够不够长到**重要** | 重要性判断 | **明确不做** | `judgement.ts:22-25` | `What this file is not allowed to ask: whether the silence was long *enough* to matter, whether the human would want to be told, whether this is a good moment` |
| 5 | 阈值取多少 | 配置（运营者的决定） | 运营者 | `src/cli/resident.ts:464` | `afterMs: proactiveReturn.afterMs` |

**模型参与**：无。

---

## 横向结论

1. **有没有任何一处把事实判定交给模型？**
   无。四个模块的事实判定全部是 `===`、集合成员、布尔字段检查。Relevance 甚至把「asking a model」写进排除清单（`judgement.ts:55`）。

2. **有没有任何一处模型输出不经确定性判定就成为事实或动作？**
   在这四个模块内：没有。模型只在 supplement 一处出现，输出必须过 `SUPPLEMENT_SCHEMA` + `cited` 逐字校验（`supplement.ts:445-449`），且只被追加为文本行，不参与 `detectNewFailure` / `delivery` 的判定。

   **但这四个模块之外另有一个模型循环**：`src/repository-change-executor/loop.ts:108-176` 让模型在 run 内部直接调用 `write_file` / `git_commit` / `git_push`，这些调用不经任何语义判定就生效（见 `s2-language.md` §E 与 `s4` 的修正）。本节的结论只适用于被审查的四个判断模块。

3. **「重要性判断」目前由什么决定？**
   逐模块一句话：
   - Relevance：不存在（只判断「是不是同一个仓库」）。
   - Attention：**被明确禁止**（`relevant ≠ salient`，`judgement.ts:11-12`）。
   - Desktop Return：**被明确禁止**（`judgement.ts:22-25`），只用一个运营者给的阈值代替。
   - Diagnosis Proposal：**没有任何层拥有它**（`judgement.ts:5-6` 原话 `no layer in this repository owns that`）。

   也就是说：全仓库没有任何一处代码在判断「这次失败重不重要」；四个模块只是把「是否相关 / 是否是新失败 / 沉默是否够长」判断完之后，把一切够格的事件都当成需要说的事说出去。
