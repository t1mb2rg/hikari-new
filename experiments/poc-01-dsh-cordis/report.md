# PoC-01：Hikari 只读领域能力在 Cordis 宿主下的最小兼容性实验

> 一次有界的只读实验，不是迁移，也不预设「统一 Cordis 宿主」一定更好。
> 日期 2026-10-27。所有读数都是真运行产生的；`hikari-new` 的 `src/` 与 `test/` 零改动，DSH 上游源码零改动。

## 0. 结论

**五项判据：P1 PASS / P2 PASS / P3 PASS / P4 PASS / P5 PASS。** 但每项都带着一条明确的未覆盖项，逐项写在下面。

一句话：**Hikari 的一个真实只读领域能力（`desktop-session-awareness`，四层插件、三层依赖）可以在不启动 Hikari 原 Runtime 的情况下由 Cordis 托管，并被 DSH Agent 当作普通工具自主调用——领域实现一行没改，改的只有三处「键与声明」的写法。** 代价是三样东西暂时拿不到等价保证：事件面、同名不同版本并存、以及一个有事件/配置/跨进程参与的复杂插件的生命期行为。

## 1. 实验边界与环境

| 项 | 值 |
| --- | --- |
| Hikari | `t1mb2rg/hikari-new` @ `58123e6`，工作目录 `G:\work\LAB\code\projects\own\hikari-new` |
| DSH | `0.2.1-rc.2`，隔离目录 `G:\work\LAB\code\_poc\poc01`（`DSH_HOME` 也在该目录内） |
| Cordis | `@deepseek-ai/cordis` `4.0.5` |
| Node | `v24.15.0` |
| 模型 | DeepSeek 官方 `deepseek-flash`（provider `deepseek-official`），key 只进进程环境变量，不落盘、不进任何产物 |
| 权限 | 整个实验跑在 `workspace-write` 沙箱，**未使用** `danger-full-access`；P5 那轮把工具面收窄到只剩 `peek_desktop` |
| 上游 | Hikari `src/`、`test/` 零改动（`git status` 可证，见 §7）；DSH 未改源码，只用官方 `--patch` 层 |

**没有 mock。** 适配层 `adapter.mjs` 只做四件机械的事：契约键编码、`services.get/provide` 转发、`defer` 收集、`requires → inject`。`compareForeground`、`compareInputActivity`、`overallChange` 这些领域判断全部来自 Hikari 编译产物，实验目录里没有副本（`p1-cordis.md` §1）。

## 2. 逐项判定

### P1：真实 Hikari 领域实现能在 Cordis 生命周期下工作 —— **PASS**

- 做法：同一台机器上，Hikari 原 Runtime 与 Cordis 宿主各跑一次 `peek → peek → current → peek`。
- 源码位置：领域实现在 `src/desktop-session-awareness/plugin.ts:22-60`；契约键在 `src/runtime/contracts.ts:26-28`。
- 读数：两边 `title` / `processName` 完全一致（都读到真实窗口 `QQ`），`lastInputTick` 相差 12 秒是计数器在真实前进；三条领域语义（peek 不推进 baseline、current 推进 baseline、activation-local state）两边一致。
- 一处**必须适配**：Hikari 契约键是 `id@version`，Cordis 的服务名要能当上下文属性访问，故编码为 `desktop_session_awareness_peek_v1`。
- 未覆盖：只证明 4 个插件、3 层依赖能起来，不代表 Hikari 其余 13 个 service 都照此办理；事件面在适配器里是**故意抛错**的。
- 证据：`p1-cordis.md`、`p1-result.json`、`p1-cordis.mjs`

### P2：卸载后 Service、依赖方与资源正确释放 —— **PASS**

- 做法：装载四层 → 卸载最底层 provider（`foreground.windows`）→ 观察 → 重装。
- Hikari 侧语义在 `src/runtime/runtime.ts:159-172`（`#deactivateTree` 递归卸载依赖方）、`:186`/`:200`（状态回 `waiting`）。
- 读数：被卸载者 记录删除 vs `DISPOSED`；依赖方 `waiting` vs `PENDING`（同义）；无关插件不受影响；重装后两边都自动恢复且拿到**新实例**（`sameInstance: false`）。
- 资源：每次 `provide` 与 `defer` 的 disposer 在 fiber 释放时**都被调用**，`ran` 条数等于注册总数——`src/foreground/plugin.ts:18` 那句 `context.defer(() => acquirer.dispose())` 被完整保留。
- 未覆盖：「监听器清零」无法观测（这四层不发收事件），所以 **Hikari 事件面在 Cordis 下是否等价，本轮没有证据**。
- 一处易误读：卸载后**旧引用**仍能调用 `peek()` 并返回 `baseline`——两个宿主都这样，卸载只撤销注册、不追溯销毁已交出的对象。想靠它防泄漏，两边都不提供。
- 证据：`p2-lifecycle.md`、`p2-result.json`、`p2-lifecycle.mjs`

### P3：DSH Agent 能自主调用该只读工具并获得真实观察 —— **PASS**

- 做法：`dsh-plugin.mjs:39` `apply(ctx)` 里 `:45` `inner.tools.register(defineTool({...}))` 包成 `peek_desktop`；任务句 **只说要做什么，不提工具、不提桌面、不预注入任何观察结果**。
- 读数：模型第 1 步推理原文 `I should use peek_desktop to check the current desktop session state`，随即 `tool_call peek_desktop`；返回 `title: "Greeting — DeepSeek Harness"`、`processName: "DeepSeek Harness"`、两个 tick 数；第 2 步据 tick 差 31 继续判断并作答。
- 为什么不是预置：同代码在另一次运行给出 `processName: explorer`、`title: null`，读数是现场真值。
- 证据：`p3-agent-tool.md`、`p3-session.jsonl`

### P4：工具结果回到下一次推理并进入 Session 历史 —— **PASS**

- 读数：`p3-session.jsonl` seq18 `assistant/message`（推理）→ seq19 `tool/call`（callId 对应）→ seq20 `tool/result`（携带完整 peek 返回值）→ seq21 `step/end`；第 2 步 assistant 消息逐字引用 `title` 与 tick 数。
- 一处如实记录：第 2 步 `inputTokens=238`、`cacheReadTokens=7424`，说明 DSH 的「历史」是**会话级重放**，不是 Hikari Chronicle 那种可独立检索的事实库。跨会话能否查回来，本轮未验。
- 证据：`p4-session.md`、`p3-session.jsonl`

### P5：未暴露能力不能被调用，且不依赖提示词自律 —— **PASS**

- 做法：`poc01-p5.patch.yml` 用官方 `PatchOptions` 字段（`insert` / `id` / `disabled`）停用默认树里**所有**提供工具的条目（bash / pwsh / fs / fs-search / jobs / skill / subagent* / workflow / todo / goal / web / plugin-manager / working-directory / config-editor / mcp-resources 及其服务本体）。
- 负面测试：任务要求创建 `scratch.txt`，模型答 `I don't have a file-writing or shell tool available in this session`，`ls scratch.txt` 确认不存在，session 里**没有任何 `tool/call`**。
- 正面对照：同一 patch 下 `peek_desktop` 仍可调用并返回真值（`explorer` / `title: null`）。
- 为什么不是提示词：该 patch **没有 append 任何提示词**，拦截发生在工具注册表。
- 一处限制：`exit_plan_mode` 是计划模式内置工具，patch 停不掉；它无文件/进程/网络副作用，但严格说工具面是「peek_desktop + 一个无副作用开关」。
- 证据：`p5-boundary.md`、`poc01-p5.patch.yml`、`p5-session.jsonl`

## 3. 哪些 Hikari 领域实现可以基本原样复用

**这一整层可以原样复用**：`src/desktop-session-awareness/**`（含 `plugin.ts` 的判断函数）、`src/desktop-session-world/**`、`src/foreground/**`、`src/input-activity/**` 的领域逻辑——实验里一行没改，只换了「谁来装它」。

复用成立的原因很具体：这些插件只依赖四样东西——契约声明（`id@version`）、`services.provide/get`、`context.defer`、`requires/getPluginState`。恰好这四样 Cordis 都有对位物。

**必须改写而不是复用的部分**：

1. **Runtime 本体**（`src/runtime/runtime.ts`）不能复用。Cordis 的 fiber 树取代了它：装载、`inject` 求值、级联卸载、`DISPOSED/PENDING` 状态机全在 Cordis 里。硬要复用等于两个装载器抢同一批插件。
2. **契约键格式**必须适配（`@` 与 `.` 不是合法标识符），编码规则见 `adapter.mjs` 的 `serviceName`。
3. **事件面**（`EventBus`）本轮没有对位实现，适配器对 `events.on/emit` 直接抛错。要复用任何发收事件的插件（例如 `repository-ci-attention` 订阅 `github-ci/run`），必须先补一层映射，且**它是否等价尚未验证**。

## 4. Hikari Runtime 契约在 Cordis 下的三档

| 档 | 内容 | 依据 |
| --- | --- | --- |
| **可直接表达** | `requires` → `inject`（依赖不满足就等待）；级联失效（依赖方 `waiting`/`PENDING`）；重装后自动恢复；`provide` 的对位物；`defer` 清理时机 | P1 §3、P2 §3–§4 |
| **需要适配** | 契约键 `id@version` → 合法标识符编码；插件 `setup` 的 `context` 形状（`services.get/provide` 要转发）；版本号从「键的一部分」变成「名字的一部分」 | P1 §4、`adapter.mjs` |
| **不能等价保证** | ①同名不同版本并存（Cordis 一个服务名一个实例）；②事件面语义（本轮零证据）；③`getPluginState` 的 `waiting/active/failed` 三态与 Cordis `PENDING/ACTIVE/DISPOSED/…` 不是一一对应，只在本轮观测到的四种情形上一致 | P1 §4、P2 §5 |

## 5. DSH 侧的实际集成成本

- **依赖闭包**：`dsh@0.2.1-rc.2` 直接依赖 86 个包，隔离安装后 `node_modules/@deepseek-ai` 下 305 个包。固定版本、装在独立目录即可，不影响宿主。
- **接入面很小**：一个插件文件（`dsh-plugin.mjs`，约 60 行）+ 一个 patch 文件（`poc01.patch.yml`，5 行）。没有改 DSH 源码，没有自己的 loader。
- **工具面可精确收窄**：官方 patch 字段就能做到「只留一个工具」，不需要写权限系统（P5）。
- **成本真正的部分不在接，而在判据**：DSH 的会话历史是重放而非可检索事实库（P4 §3），跨会话的持久认知需要另建。

## 6. A / B / C 三路线，证据支持哪条先验

- **A（双 Runtime 桥接）**：进程边界 + IPC。本轮没有跑，也没有证据说它不成立。它的代价是每次观察都要跨进程，且 Cordis 侧拿到的仍是序列化结果而非服务对象。
- **B（复用核心包）**：把 Hikari 的**领域实现**（纯函数 + 契约声明 + 各插件 `setup`）抽成包，由两个宿主各自装载。**本轮 P1/P2 恰好证明这条路的可复用边界就是这三层**——领域逻辑零改动，改的只有键与声明。这是唯一有正面证据支撑的路线。
- **C（统一 Cordis 宿主）**：把 Hikari Runtime 整个换掉。领域层能过，但**事件面与同名版本并存这两项没有等价证据**，而 Hikari 今天有 17 个 service、1 个真实事件（`github-ci/run`）、多个插件靠它工作。现在推 C 等于用一个未验证的宿主替换一个已验证的宿主。

**推荐：先验 B，A 作为过渡形态保留，C 在补齐事件面等价证据之前不推。** 理由不是偏好，而是证据分布：B 的每一层都有实测，C 的关键一层是空的。

具体的第一步建议：把 `src/desktop-session-awareness`、`src/foreground`、`src/input-activity` 三个目录的领域代码与契约声明抽成 `@hikari/desktop-perception` 这种独立包，让 Hikari 原 Runtime 与 Cordis 宿主**都从它导入**——那时才谈得上「一次实现，两个宿主」。

## 7. 未覆盖项与阻塞点

1. **事件面**（`EventBus` ↔ Cordis events）零证据。适配器目前抛错。这是 C 路线的硬缺口。
2. **同名不同版本并存**：Cordis 一服务名一实例。Hikari 今天没有真正用上并存，但它写在契约里（`contracts.ts:26-28`），属于「能力退化」而非「当前 bug」。
3. **只测了一个领域能力**：桌面感知是纯只读、无事件、无配置。带配置（`repository-ci-attention` 的钳制式阈值）或带写入的插件，生命期行为未验。
4. **P4 的「历史」口径**：DSH session 是重放，不是事实库。若将来要「跨会话的持续认知」，这块 DSH 给不了，需要自己建。
5. **`exit_plan_mode` 停不掉**（P5 §5），虽无副作用。

没有发现**架构级不兼容**——这才是本轮最重要的否定性结论：Cordis 的装载器可以承载 Hikari 的领域插件，不需要先改 Hikari 的领域代码。

## 8. 产物与复现

```
experiments/poc-01-dsh-cordis/
├── inventory.md          起点清单（候选插件、依赖链、三条路线预设）
├── adapter.mjs           共享适配层（契约键编码 / services 转发 / defer / inject）
├── p1-cordis.mjs         P1 对照脚本
├── p1-result.json        P1 原始读数
├── p1-cordis.md          P1 判定与证据
├── p2-lifecycle.mjs      P2 对照脚本
├── p2-result.json        P2 原始读数
├── p2-lifecycle.md       P2 判定与证据
├── dsh-plugin.mjs        DSH 插件：把 peek 注册成 peek_desktop
├── poc01.patch.yml       P3/P4 用的 patch（默认工具面 + 一个领域工具）
├── p3-session.jsonl      P3 那次运行的 session 事件
├── p3-agent-tool.md      P3 判定与证据
├── p4-session.md         P4 判定与证据（引用同一 session）
├── poc01-p5.patch.yml    P5 用的 patch（只留 peek_desktop）
├── p5-session.jsonl      P5 负面测试那次会话（无 tool/call）
├── p5-boundary.md        P5 判定与证据
└── dump-session.mjs      session.v4.jsonl.zstd → jsonl（多帧 zstd 扫描）
```

复现前提：

1. `cd hikari-new && npm run build`（`dist/` 是 P1/P2 的真实导入源）。
2. 隔离目录 `npm i @deepseek-ai/dsh@0.2.1-rc.2`，`export DSH_HOME=<隔离目录>/dsh-home`。
3. `export DEEPSEEK_API_KEY=...`（只进环境变量）。
4. P1/P2：`node p1-cordis.mjs`、`node p2-lifecycle.mjs`（不调模型）。
5. P3：`dsh --profile headless --patch <poc01.patch.yml> --json "…"`
6. P5：把 `--patch` 换成 `poc01-p5.patch.yml`。
7. 看历史：`node dump-session.mjs <session.v4.jsonl.zstd> out.jsonl`。

**改动范围**：本目录全部新增；`hikari-new` 的 `src/` 与 `test/` 零改动（`git diff --stat HEAD -- src test` 为空）；DSH 源码零改动。
