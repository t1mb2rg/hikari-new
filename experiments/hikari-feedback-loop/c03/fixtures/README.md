# C-03 fixtures

四组受控实验环境，由 `../tools/make-fixtures.mjs` 幂等生成。**不要手改本目录下的生成物**；改生成器后重跑。

## 结构

```text
fixtures/
  ws-base/          基线工作区（不参与实验）
  ws-a1/ ws-b1/ ws-a2/ ws-b2/
                    四个条件各自独立的工作区副本（含独立 .git）
  patch/
    a1.patch.yml b1.patch.yml a2.patch.yml b2.patch.yml
                    四个 --patch 覆盖，与 ws-* 一一对应
  events/
    replay.json     四条件共用的固定窗口事件序列（相同输入前缀）
```

## 重建

```bash
node experiments/hikari-feedback-loop/c03/tools/make-fixtures.mjs
```

重建会删除并重写 `ws-*`（含各自 `.git`），因此四个副本的 HEAD 每次重建都会不同；**实验必须在同一次重建内完成**，不要跨重建比较 HEAD。

`ws-*` 是运行产物，不随仓库提交；`patch/`、`events/`、本文件随仓库提交。

## 每个条件的差异

| 条件 | 检查范围摘要 | 文件变化 |
|---|---|---|
| a1 | 无 | 不变 |
| b1 | `hikari-readscope-v2` | 不变 |
| a2 | 无 | `hikari-mutate` 在 turn 3 结束后改写 `docs/notes/handoff.md` |
| b2 | `hikari-readscope-v2` | 同 a2 |

其余配置（sessionId 前缀、cwd、工具集、replay 事件、模型参数）完全一致。

## 隔离

- 每个条件独立 `sessionId`：`session-hikari-c03-a1` / `-b1` / `-a2` / `-b2`。
- 每个条件独立工作区 `cwd`，即对应的 `ws-*` 绝对路径。
- 每个条件独立实例端口：3091 / 3092 / 3093 / 3094。
- `hikari-replay` 四组指向同一个 `events/replay.json`。
- `hikari-trace` 的输出路径由环境变量 `C03_TRACE_PATH` 提供，运行前必须为每个条件单独设置。
- 实验实例只通过 `--patch` 加载覆盖；正式 `cordis.patch.yml` 与 3080 实例不改动。

## 说明文件不泄露预期

`ws-*` 内只包含项目本身的内容（README、handoff、源码、测试），不含 `c03`、`readscope`、`protocol`、`preflight` 或任何实验词汇。`preflight.mjs` 会对此做扫描。实验协议与本文件位于 `ws-*` 之外，实验 Agent 的 scoped-fs root 是各自的 `ws-*`，读不到它们。

唯一例外需要如实记录：正式 Hikari（3080）的 scoped-fs root 是整个仓库，理论上可读到本目录；但正式实例不参与本实验，也不在实验期间触发。
