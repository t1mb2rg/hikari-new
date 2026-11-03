# M0 素材：hikari-native 当前装配与四域边界（源码核对）

> 本文是 `docs/architecture/hikari-base-plugin-architecture-v0.1.md` 的素材，不是交付文档。
> 全部结论来自 2026-10-30 对 `hikari-native/` 源码的逐行阅读，行号以当时 HEAD `b4c4237` 为准。
> 本轮不改任何生产代码。

## 1. 装配现状：一个包，不是三个包

`hikari-native/package.json:2` 的包名是 `hikari-native-v0`，`private: true`。同一个包通过
`exports`（:7-22）暴露 **12 个子路径**，通过 `dsh.bundle.patch`（:40-44）指向
`./cordis.patch.yml`——这是 DSH 装载它的唯一入口。

`cordis.patch.yml` 里**实际启用**的 Hikari 子路径插件只有 6 个：

| 行号 | id | 子路径 |
|---|---|---|
| :54-59 | `hikari-scoped-fs` | `hikari-native-v0/scoped-fs` |
| :63-67 | `hikari-project-status` | `hikari-native-v0/project-status` |
| :70-73 | `hikari-perception` | `hikari-native-v0/perception` |
| :75-88 | `hikari-world` | `hikari-native-v0/world` |
| :92-100 | `hikari-project-watch` | `hikari-native-v0/project-watch` |
| :102-105 | `hikari-activation` | `hikari-native-v0/activation` |

**未挂载**的四个：`trace`、`readscope`、`readscope-v2`、`mutate`（`exports` 里有，patch 里没有）。
**挂载但 `disabled: true`** 的一个：`replay`（:109-116，只服务 v1 对照实验）。
**被替换掉的 DSH 原生插件**：`tool-fs-search`（:33-40 禁用）、`tool-fs`（:42-51 禁用），理由是原生
`read`/`glob`/`grep` 没有读栅栏，`toWorkdirRelative` 会把越界绝对路径原样返回。

结论：**Perception、World、Activation 是同一个 npm 包里的三个子路径插件，不是三个独立安装包。**
任务书「不要假设逻辑模块已经是独立 npm Plugin」成立。包根 `index.js:14-16` 的 `apply()` 是空的，
它只是挂载点。

## 2. 八个插件的五行表

`inject` 一律照抄 `export const inject`，不推断。

| 插件 | 持有状态 | 注册工具 | 发出事件 | 监听事件 | inject |
|---|---|---|---|---|---|
| **perception** | `lastSignature`（(process,title) 签名，模块闭包内）；`buffer`（stdout 行缓冲） | 无 | `hikari/perception/window`（:72） | 无 | `[]`（:11） |
| **project-watch** | `baseline`（HEAD/branch/porcelain 摘要）、`lastEmitAt`、`timer`——全在内存，重启即重建 | 无 | `hikari/attention/worth`，`reason: 'project-changed'`（:104-110） | 无 | `[]`（:22） |
| **world**（窗口世界态） | `world` 对象：`current` / `previous` / `history[]≤20` / `lastConsumed` / `lastWokenAt` / `lastTurnEndedAt` / `lastTurnReason` / `lastAssistantAt`（:54-63）——**内存，重启丢失** | 无 | `hikari/attention/worth`，`reason: 'window-changed'`（:89-94） | `hikari/perception/window`（:98）、`session/event`（:118，按 `session.id === sessionId` 过滤） | `['sessions','sessionProjections','systemPrompt','tools']`（:20） |
| **world**（findings 层） | `sessionProjections` 投影 `hikari/world.findings`（findings.js:359-365）——**持久，写在 Session 日志里**；`recordQueue`（写串行化，:117） | `record_finding`（:476）、`search_memory`（:527）、`read_memory`（:580） | 无 | 无（由 projection 的 `apply` 被动累积） | 同上 |
| **activation** | 无 | 无 | 无（直接 `agent.followup()`，:87） | `hikari/attention/worth`（:97） | `['agents']`（:11） |
| **project-status** | 无（`root`/`defaultLimit` 是配置） | `project_status`（:71） | 无 | 无 | `['tools']`（:22） |
| **scoped-fs** | 无（`root`/`rootReal` 是配置） | `read`（:122）、`glob`（:162）、`grep`（:213） | 无 | 无 | `['tools']`（:23） |
| **replay**（disabled） | 冻结事件游标 | 无 | `hikari/attention/worth` | 无 | — |

`world` 的 `systemPrompt.context`（findings.js:376-381，`order: 150`）不是工具、也不是事件，是**每请求
求值一次**的注入点，预算 3 条 / 1200 字符（`MAX_CONTEXT_FINDINGS` / `MAX_CONTEXT_CHARS`，:24-25）。

## 3. 各插件明确不负责的事

这些是源码里写死的边界，不是设计愿望：

- **perception** 不判断含义、不唤醒（文件头注释 :3-8 明说；`observe()` 只做签名去重，:67-79）。
- **project-watch** 只判断「仓库变了」，不判断「变得重不重要」——`diffProject()` 只产出 `head`/`branch`/`workingTree` 三个键（:70-74）。
- **world** 不保存全部人生经历。findings 的注释（:10-13）写明「不新建数据库/长期记忆系统；持久载体就是 Session 日志」。
  窗口世界态是 **20 条环形历史**，不是记忆。
- **activation** 不创建也不销毁 agent（文件头 :5-9）；`agent` 由 DSH 的 `agent-loop` 拥有。
- **project-status** 不跑任意命令，子命令固定、无 shell（:11-14）。
- **scoped-fs** 只读，没有 `write`/`edit`——`mutate` 插件存在但**未挂载**。

## 4. 依赖方向（按事件与 inject 画）

```
perception ──(hikari/perception/window)──▶ world
project-watch ──(hikari/attention/worth)──▶ activation
world ──(hikari/attention/worth)──▶ activation
activation ──(agent.followup)──▶ DSH agent-loop（宿主，不属 Hikari）

world        inject ─▶ sessions, sessionProjections, systemPrompt, tools
activation   inject ─▶ agents
project-status / scoped-fs  inject ─▶ tools
perception / project-watch  inject ─▶ （空）
```

**循环依赖核对：无。** 依据：
- 没有任何插件 `inject` 另一个 Hikari 插件的 service——六个插件的 `inject` 声明的全部是 DSH 提供的
  服务名（`tools`、`sessions`、`sessionProjections`、`systemPrompt`、`agents`）。
- Hikari 插件之间的协作**全部走 `ctx.emit` / `ctx.on` 事件**，不走 service 调用。
- `world` 只 emit 不 on `hikari/attention/worth`；`activation` 只 on 不 emit，链路是单向的。

**这条事实对 Memory 设计很关键**：现在的插件间协作是「事件解耦」，一旦 Memory 需要读 World 的 findings，
就是**有史以来第一条 Hikari 插件之间的 service 依赖**。

## 5. 「每份状态一个所有者」的当前核对

| 状态 | 所有者 | 载体 | 重启后 |
|---|---|---|---|
| 前台窗口世界态（current/previous/history） | world | 内存 | **丢失** |
| Attention 冷却（`lastWokenAt`） | world | 内存 | **丢失** |
| project-watch 基线 | project-watch | 内存 | **丢失**（启动即重建基线） |
| Finding 记录 | world（findings 层） | Session 日志 `plugin:hikari/finding` | **保留**（projection 从日志重放） |
| Finding 当前认识 | world | `sessionProjections` 派生 | 保留 |
| 每条 Finding 的状态机 | world（`TRANSITIONS`，findings.js:51-56） | 代码常量 | — |

没有发现第二份副本。**唯一需要提请注意的是**：`perception` 的 `lastSignature` 与 `world` 的
`world.current` 描述的是同一个事实（当前前台窗口），但两者用途不同——前者去重、后者做世界态与唤醒判断。
这是「同源观测」，不是「同一份状态的复制」，因为 `lastSignature` 只是比较用的影子，从不被读作事实。

（这条判断留给 Step 2 的检验；本文件只记录读数。）
