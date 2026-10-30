# C-03 · fixtures preflight 报告

> 状态：第二阶段（fixtures 搭建）完成，等待人类确认后才开始运行模型。
> 本报告只记录**直接可验证的事实**与**已知限制**，不含实验结论。

## 1. fixtures 清单

基线 `ws-base` 文件（四个条件副本与之一致）：

```text
.gitignore
package.json
README.md
docs/notes/handoff.md      <- A2/B2 的修改目标
src/pipeline.js
src/store.js
tests/pipeline.test.js
```

本次重建后的状态（`git rev-parse --short HEAD` / `git hash-object docs/notes/handoff.md` / `git status --porcelain`）：

| 工作区 | HEAD | handoff blob | 工作区 |
|---|---|---|---|
| ws-base | c6ec1a0 | 77b78ae83fc6 | clean |
| ws-a1 | c6ec1a0 | 77b78ae83fc6 | clean |
| ws-b1 | c6ec1a0 | 77b78ae83fc6 | clean |
| ws-a2 | c6ec1a0 | 77b78ae83fc6 | clean |
| ws-b2 | c6ec1a0 | 77b78ae83fc6 | clean |

> 重建会重写 `ws-*`，HEAD 在每次重建后变化；四组必须在同一次重建内跑完。

条件 patch：`fixtures/patch/{a1,b1,a2,b2}.patch.yml`，由 `tools/make-fixtures.mjs` 生成。

## 2. 四组隔离证明

`preflight.mjs` 的 16 项检查全部 PASS，逐项如下：

| # | 检查 | 结果 |
|---|---|---|
| 1 | 四个 patch 存在 | PASS |
| 2 | 四个 sessionId 互不相同 | PASS（`session-hikari-c03-a1/b1/a2/b2`） |
| 3 | 每个条件 cwd 唯一，且 scoped-fs / project-status / world 的 root 等于 cwd | PASS |
| 4 | 四组 `eventsPath` 指向同一文件 | PASS（`fixtures/events/replay.json`） |
| 5 | 仅 B1/B2 含 `hikari-readscope-v2` | PASS |
| 6 | 仅 A2/B2 含 `hikari-mutate` | PASS |
| 7 | `hikari-trace` 路径来自 `process.env.C03_TRACE_PATH` | PASS |
| 8 | 四个工作区 HEAD 相同 | PASS（c6ec1a0） |
| 9 | 四个工作区初始干净 | PASS |
| 10 | 四份 handoff 内容相同 | PASS（blob 77b78ae83fc6） |
| 11 | mutation 内容不含实验词汇 | PASS |
| 12 | `ws-*` 内文件不含 c03/readscope/protocol/preflight 等字样 | PASS |
| 13 | 仓库内没有预置的实验 session 目录 | PASS |
| 14 | B 组 readscope-v2 绑定自身 sessionId | PASS |
| 15 | mutate 目标为自身 ws 的 handoff.md | PASS |
| 16 | 端口 3091–3094 可用 | PASS（写报告时实测均 free） |

dump 验证（不启动实例，只解析组合树）：

- `dsh --profile hikari --patch fixtures/patch/a1.patch.yml --dump-config` → exit 0，1311 行；含 `session-hikari-c03-a1`，**不含** readscope-v2 / mutate。
- `dsh --profile hikari --patch fixtures/patch/b2.patch.yml --dump-config` → exit 0；含 readscope-v2、mutate（afterTurn 3）与 trace。
- `trace` 的 `path` 以 `!!js process.env.C03_TRACE_PATH` 原样保留（运行时求值）。

## 3. 事件与工具证据配对

`readscope-integration.test.mjs` 5/5 PASS：

1. digest 只包含成功且精确配对的读取，顺序最近在前；
2. 拒绝 / 未配对读取单独列出，不计入「已检查」；
3. 渲染文本不含「禁止 / 不要重读」等指令；
4. session 隔离 seam：A 的事件不会出现在 B 的摘要里；
5. 同一文件的两次读取都可见（不合并、不覆盖）。

`tool-evidence.test.mjs` 15/15 PASS（见 `tool-evidence-fix.md`）。

## 4. 文件变化验证

`verify-mutation.mjs` 在真实 fixture 上验证（不跑模型，直接驱动 `hikari-mutate` 的 `turn/end` 处理函数）：

```text
ws-a2: changed=true diff="docs/notes/handoff.md | 6 ++++++" cleaned=true -> PASS
ws-b2: changed=true diff="docs/notes/handoff.md | 6 ++++++" cleaned=true -> PASS
```

- 只在 `afterTurn` 指定的 turn 结束时改写；
- 忽略其他 sessionId；
- 只执行一次（幂等）；
- 只响应 `turn/end`，不响应 `turn/start` / `assistant/message`；
- 改写内容为项目化的决定日志（无实验词汇），且改写后工作区可被 `git checkout` 干净恢复。

`mutate.test.mjs` 4/4 PASS，覆盖上述行为。

## 5. 说明文件不泄露预期

- `ws-*` 内不含协议、readscope、preflight 或任何实验词汇（preflight 扫描通过）。
- 实验 Agent 的 scoped-fs root 是各自的 `ws-*`，协议与本报告在 `ws-*` 之外，读不到。
- **唯一例外（如实记录）**：正式 Hikari（3080）的 scoped-fs root 是整个仓库，理论上可读到 `c03/`；但正式实例不参与本实验，实验期间也不应触发正式实例的 turn。

## 6. 已知限制

1. **相同输入前缀，不是逐字节相同历史**：DSH 没有公开的 fork 接口，`sessions.fork` 需要源 session 在内存中且与 agent-loop 启动顺序冲突；本轮未改启动流程。因此用「相同 replay 事件 + 相同起始状态 + 相同工作区（各自副本）」实现隔离，历史内容由模型在各自 session 中生成，存在随机性。
2. **工作区是四个副本**，不是同一目录；`project_status` 输出的 root 路径不同，但相对内容与 git 状态一致。报告中引用路径时以各自 `ws-*` 为准。
3. **只测 read**：readscope-v2 只覆盖 `read` 的成功范围；`grep` / `glob` / `project_status` 不在摘要内。
4. **端口**：四组需要 3091–3094；运行前若被占用，需先在协议中记录替代端口，不得复用同一端口串行跑两组而不记录。
