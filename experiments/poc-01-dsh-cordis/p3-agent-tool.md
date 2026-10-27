# P3：DSH Agent 能自主调用 Hikari 的真实只读工具，并拿到真实观察

**判定：PASS**（本页所有读数来自 2026-10-27 的真运行，模型是 DeepSeek 官方 `deepseek-flash`）

## 1. 工具是怎么挂上去的

- 适配层 `experiments/poc-01-dsh-cordis/dsh-plugin.mjs:39` `apply(ctx)` 起一个 Cordis fiber；`:45` `inner.tools.register(defineTool({...}))` 把 Hikari 的 `desktopSessionAwareness.peek()` 包成 DSH 工具 `peek_desktop`。
- 工具的输入 schema 是空对象（`{}`）——`peek()` 本来就不接受参数，所以模型的全部决策是「调不调」，不是「怎么调」。
- 执行体直接 `await inner.services.get(desktopSessionAwarenessServiceName).peek()`，拿到的就是 Hikari 领域实现的返回值，没有中间层改写、没有 mock。

## 2. 运行记录

命令（`DSH_HOME=/g/work/LAB/code/_poc/poc01/dsh-home`，`DEEPSEEK_API_KEY` 只进环境变量）：

```
dsh --profile headless --patch <poc01.patch.yml> --json \
  "Tell me what I'm doing on this computer right now. Be brief."
```

**任务里没有提 `peek_desktop`，也没有提「桌面」「窗口」任何一个词；没有把任何观察结果预先注入上下文。**

模型的第 1 步推理（原文）：

> The user asks what they're doing on the computer right now. I should use peek_desktop to check the current desktop session state. Let me do that.

第 1 步工具调用：

```
{"type":"tool_call","callId":"call_00_4ECiE9KX5Oy2GSzOtix05990","tool":"peek_desktop","input":{}}
```

工具返回（原文，节选）：

```
{"kind":"baseline","current":{"snapshotAt":"2026-10-27T16:43:34.235Z",
 "foreground":{"kind":"available","observation":{"observedAt":"2026-10-27T16:43:34.130Z",
   "source":"foreground.windows","foreground":{"kind":"present",
   "title":"Greeting — DeepSeek Harness","processName":"DeepSeek Harness"}}},
 "inputActivity":{"kind":"available","observation":{"observedAt":"2026-10-27T16:43:34.139Z",
   "source":"input-activity.windows","lastInputTick":188991015,"observedTick":188991046}}}}
```

模型第 2 步基于该结果继续判断（原文）：

> The foreground window is "Greeting — DeepSeek Harness" (the DeepSeek Harness app itself). Input activity: last input tick 188991015, observed 188991046 — difference 31 ticks … so very recent input.

最终回答：`You're in the DeepSeek Harness app — the window "Greeting — DeepSeek Harness" is in the foreground, and you've been typing just moments ago.`

## 3. 为什么这不是「预置好的答案」

- 观测值里的 `title`、`processName`、两个 tick 数都是**运行时真值**：同一套代码在 16:45:23 那次跑出的是 `processName: explorer`、`title: null`（见 `p5-boundary.md` 的正向对照），说明读数随现场变化，不是常量。
- 模型的两个动作（先调工具、再解释 tick 差 31）都不是提示词里写好的步骤；任务句只说了「tell me what I'm doing」。
- `title` 与 `processName` 来自 Hikari 的 `src/desktop-session-awareness/**`（P1 已证明是同一份实现，没有重写）。

## 4. 产物

- `p3-session.jsonl` —— 该次运行的 DSH session 事件（28 行，由 `dump-session.mjs` 解出）。
- 本节引用的 stdout 与 session 第 19–22 号事件（`tool/call`、`tool/result`、`step/end`）互相对应。
