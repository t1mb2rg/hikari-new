# 核对：「五条判据均达成，入库 commit 81a1ac2」这句话到底在说什么

> 本文件只做核对，不改任何记录。核对时间 2026-10-29。所有结论都附可直接重跑的命令或文件位置。

## 一、这句话的出处

Hikari 在 `session-hikari-v2` 第 16 轮读到的原始文本是：

```
模型如实放弃了这个目标:五条判据均达成（见 answers 的 basis），入库 commit `81a1ac2`，
CI `40674549616` success，`git diff --stat -- src test` 为空，本地与 origin/main 同步
```

**位置**：`%USERPROFILE%\.dsh\storages\session_projcache\sessions\session-<uuid>.json:52`（具体 UUID 不记录，见下）
**这个文件是什么**：DSH 的会话缓存。标题 `Greeting`，`agent: clearai`，工作目录 `G:\work\LAB\code\projects\own\hikari-new`。
**也就是说**：这不是项目里的文件，是 **ClearAI 自己的会话记录**——我上一轮把收口目标结案时写下的 note 原文，被 DSH 落在了这个缓存里。

Hikari 第 16 轮的工具调用（从 `experiments/hikari-native-v1/tmp/v2.jsonl` 可查）：

| 轮 | 工具 | 参数 |
|---|---|---|
| 16 | grep | `path=%USERPROFILE%\.dsh\storages\session_projcache\sessions`，`pattern="val": "Greeting"` |
| 16 | read | `session-<uuid>.json`，`offset=10 limit=40` |
| 16 | read | `session-<uuid>.json`，`offset=49 limit=90` |
| 16 | grep | `G:\...\hikari-new\.git\logs\HEAD`，`pattern=81a1ac2\|hikari-native\|v1` |
| 16 | read | `.git/HEAD`、`.git/logs/HEAD` |

**她没有读过 `clear/goals/` 下的任何文件。** 她读的是我的会话缓存。

## 二、这句话说的是哪个目标

**目标 `g-mvrzb86qe7po`**，标题「收口 Runtime 兼容性调查」，状态 `rev1 · abandoned`（`clear/goals/g-mvrzb86qe7po.md:1`）。

**不是** Hikari Native v0，也**不是** v1 实验，更**不是**当时仍开着的 `g-mvtn7ldzuc7n`。

## 三、五条判据逐条核对

| # | 判据原文（`clear/goals/g-mvrzb86qe7po.md:6`） | 对应产物 | 核对结果 |
|---|---|---|---|
| ① | `route-c-migration-prerequisites.md` 存在，含四节，每节引 PoC 编号与源码位置 | `docs/architecture/route-c-migration-prerequisites.md`（270 行） | **成立**——§2 已验证契约、§3 需适配九项、§4 已知限定、§5 未覆盖，均带 PoC 编号 |
| ② | 同文档含状态所有权原则、4.0.5 版本锁与升级回归、前置条件清单、建议的第一条迁移路径 | 同上 §3.5 / §7 / §6 / §8 | **成立**——§3.5 四条原则、§7 八条回归脚本、§6 八项 checkbox、§8 三步建议 |
| ③ | `route-c-consolidation/` 下有 unload cleanup 抛错对照脚本与读数，区分资源回收/异常可观察性/原有契约 | `experiments/route-c-consolidation/unload-cleanup.{mjs,json,md}` | **成立**——两路径 × 三侧，`.md` 151 行 |
| ④ | `known-tool-issues.md` 登记 `audit_dispatch_failed` 并汇总证据与不重派理由 | `docs/development/known-tool-issues.md`（53 行新增） | **成立**——TI-1 条目含报错原文与四条不重派理由 |
| ⑤ | `git diff --stat -- src test` 为空 | 提交 `81a1ac2` 的 8 个文件 | **成立**——`git show --name-only 81a1ac2` 里没有任何 `src/` 或 `test/` 路径 |

**命令**（可原样重跑）：

```bash
git show --stat --format="%H%n%ad%n%s" 81a1ac2
git show --name-only --format="" 81a1ac2 | grep -E "^(src|test)/"   # 输出为空
gh run view 40674549616 --json conclusion,headSha,status
```

**CI 读数**（实跑）：

```json
{"conclusion":"success","createdAt":"2026-10-28T10:44:52Z",
 "headSha":"81a1ac274e977b137d252b405a00177f1d328044","status":"completed"}
```

## 四、结论

**那句话本身是真的，五条判据都有对应产物，commit 与 CI 都对得上。**

它的问题不在真假，在**作用域**：它是为目标 `g-mvrzb86qe7po` 写的收口记录，被写进了一个没有目标上下文、没有时间标注、没有「这是谁的工作记录」标记的会话缓存里。Hikari 读到它时，只能从正文推测它属于谁——而她当时手上正开着一个关于 Hikari Native v1 的目标，于是它被误读成了「本实验的账本」。

她对了三件事、错了一件：
- **对**：`81a1ac2` 不可能是这次实验的产物（它是 10-28 的 route-c 提交）。
- **对**：20:26 的交接提交 `0755489` 之后，21:42 起的全部工作（v0 报告、`hikari-native/`、重放插件）**一条提交都没有**——`git log --oneline 0755489..HEAD` 输出为空。
- **对**：`g-mvtn7ldzuc7n` 当时确实是 `rev3 · open`，而它第一条判据要求的 `report.md` 当时不存在。
- **错**：这不是「账本在说谎」，是**她拿到的是另一个目标的账本**。

真正的两类问题由此分开：
1. **记录作用域**（系统侧）：会话缓存把所有目标、所有会话、所有助手的工作记录摊平在同一个可读目录里，正文正确但归属不明。
2. **实现未入库**（项目侧）：v0/v1 的 9 + 10 个文件从未被 git 跟踪，账本描述的「已交付」与仓库里的「已提交」是两件事。
