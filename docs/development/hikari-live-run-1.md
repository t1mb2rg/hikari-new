# Hikari 投运观察 1：她第一次在界面里说话并写记忆

日期：2026-11-05（约 22:40–23:20）
性质：运行观察记录。**不改代码、不改契约**，只记录这一轮真实运行里看到的、值得后面处理的东西。
环境：`dsh --profile hikari --no-open --port 31700`（PID 39396），工作区 `G:\work\LAB\code\projects\own\hikari-new`，生产库 `C:\Users\29719\.dsh\hikari\memory`。

## 1. 这一轮之前修了什么

| 问题 | 现象 | 处置 |
|---|---|---|
| 自主唤醒永不触发 | `project-watch` 是唯一发 `hikari/attention/worth` 的地方，仓库不变就不发；`wakeOnWindowChange: false` 让窗口切换也不发 | 未改代码。把驱动源换成「人跟她说话」，与用户确认 `activation/index.js:26` 的「不要联系用户」保持不变 |
| 界面里她自称编码 Agent | 新会话用 `agentPreset: standard`，`preset-standard` 自带 `persona`（`You are a coding agent…`）并加载 `AGENTS.md`/`CLAUDE.md`；Hikari 人格只对 `session-hikari` 生效 | `C:\Users\29719\.dsh\profiles\hikari\cordis.patch.yml` 用顶层 `insert:` 追加 `preset-hikari`（`persona` + `time-context`，不带 `agent-instructions`），并把 `agent-preset-registry.default` 设为 `hikari` |
| 人格偏「流程说明」 | 原 `personaPrefix` 让模型复述规则 | `hikari-native/cordis.patch.yml:15-31` 改写：新生儿设定、只留以后会用的、不要寒暄/复述规则/介绍流程 |

修完实测：新会话系统消息里 `你是 Hikari` 命中 1 次、`coding agent` 0 次；提示词 5.5K tok（修前 17.9K）；工具面含 `memory_status`/`search_memories`/`write_memory`/`record_finding`。

## 2. 她写了什么（生产库 `memory.jsonl`）

| seq | 触发 | 正文要点 | `source` | 备注 |
|---|---|---|---|---|
| 1 | 自主（无人对话） | 「空读数不等于没有变化」——trace 静默停止、`ctx.logger.info` 不落盘、投影过期三例 | `{"kind":"finding","ref":"f-011"}` | 342 字，`occurredAt: null`（当时确实没有时钟） |
| 2 | 用户自报身份与规矩 | 「主人叫 t1mb2rg……实验产物一律放 `experiments/<主题>/`」 | `{"kind":"session","ref":"turn: current"}` | 134 字，`occurredAt` 有值 |

两条都**没有抄对话原文**，都是重述；`memory.meta.json` 的 `recordCount`/`lastSeq` 与文件一致。

## 3. 记下来的缺口（本轮不修）

1. **`source.ref` 不是可回查指针。** 冻结面里 `session` 类应是 `<sessionId>#<seq>`，实现里只校验「非空字符串」，于是 `"turn: current"` 这类占位能通过。后果：这条记忆无法回溯到对应那一轮。
   决定（2026-11-05，用户）：**先只记录，不动代码**。等有更多真实样本再定校验形态。
2. **她把「根目录只有 7 个文件」读成「只有 7 个东西」。** 实测根目录是 16 个目录 + 7 个文件（`.agents`、`.git`、`docs`、`experiments`、`hikari-native`、`src`、`test`、`clear`…）。成因大概率是工具只返回文件。
   与她自己写的第 1 条记忆互为镜像：那条讲「空读数不等于没有变化」，这条是「看得见的列表不等于全部」。
3. **把 findings 说成「记忆库」。** 她说「记忆库很小——手上 3 条没验证的假设」，那 3 条其实来自 World 注入的 findings（`hikari-native/world/findings.js:396`），不是 memories。概念边界在模型侧还没有稳定。

## 4. 跨 Session 找回：已在真实运行中成立

同一晚 23:18，新会话 `session-b93f6d25-3661-45b2-bbc9-a23ad5500651`（`agentPreset: hikari`，确认新预设生效）里，用户只问「我是谁」，她做了三次调用：

| 调用 | 返回 |
|---|---|
| `memory_status({"recent": 10})` | `total: 3, lastSeq: 3, heads: 3` |
| `project_status({"limit": 4})` | 仓库状态（确认上下文） |
| `get_memory({"memoryId": "m-ad936527-…"})` | 取回 seq 2 的全文 |

回答（要点）：先叫出 `t1mb2rg`，复述「实验产物放 `experiments/<主题>/`；临时脚本、观测输出、trace dump、对照实现全算」，然后补一句「除此之外我不知道更多。**你的名字是你告诉我的，不是我从仓库里推断出来的**；我也没有关于你的其他记录。」

这是 M2-c 一直缺的最终证据：模型在没有任何记忆注入的情况下，靠自己的工具调用把上一轮写下的记忆找了回来，并且说清了它的来处。提示词 20.3K tok（含 findings 注入）。

同晚她还自主写下第 3 条记忆（`seq 3`、`m-c2489b3d-…`、`source: {"kind":"finding","ref":"f-007"}`、231 字）：「同一个仓库里可以并存两条时间线……读文件里手写的日期时不要当成事实；推不出来就写『日期不可靠』」。

## 5. 还没定的事

- 人格改写（`hikari-native/cordis.patch.yml`）与 profile 侧 `preset-hikari` 是否提交：未定，profile 下的文件不在仓库里，仓库里只有人格部分。
- 观察面（面板）目前靠手动重建：`node hikari-native/panel/build.mjs --out experiments/hikari-desktop/panel-live.html`。
- 她下一次被唤起仍然要有人说一句话；真正的「无指令也在场」还没到。
