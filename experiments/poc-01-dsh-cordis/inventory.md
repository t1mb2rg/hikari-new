# PoC-01 实验对象与依赖清单

记录时间：2026-10-28。本文是 s1-scout 的产物，后续步骤只引用这里的结论。

## 0. 环境与固定版本

| 项 | 值 | 来源 |
| --- | --- | --- |
| 工作目录 | `G:\work\LAB\code\projects\own\hikari-new` | 当前 cwd |
| Hikari 版本 | `main` @ `58123e6` | `git log -1` |
| DSH 运行版本 | `0.2.1-rc.2` | `node_modules/.bin/dsh --version` |
| DSH 上游源码（只读参考） | `G:\work\LAB\code\_repos\deepseek-harness` @ `22ddee3`（0.2.1-rc.3） | `git clone --depth 1` |
| Cordis | `4.0.5` | `node_modules/@deepseek-ai/cordis/package.json` |
| Node | `v24.15.0` | `node -v` |
| 平台 | Windows 11（`win32`） | 实验对象依赖 Windows API |
| 实验隔离目录 | `G:\work\LAB\code\_poc\poc01`（DSH 安装 + profile） | 不在 hikari-new 内 |
| DSH_HOME | `G:\work\LAB\code\_poc\poc01\dsh-home` | 与用户真实 `~/.dsh` 隔离 |

DSH 用 npm 发布版而非源码构建：monorepo 需要 `pnpm`（本机未安装）与全量 build，成本与 PoC 目标不成比例。上游源码只用来核对 API 的真实签名。

## 1. Hikari 侧：依赖链与契约形状

选定对象：`desktop-session-awareness.peek`。

| 层 | 插件 id | requires | provides（契约 id@version） | 资源/清理 |
| --- | --- | --- | --- | --- |
| 1 | `foreground.windows` | 无（`requires: []`） | `foreground.current@1` | `context.defer(() => acquirer.dispose())`（`src/foreground/plugin.ts:18`） |
| 1 | `input-activity` | 无 | `input-activity.current@1` | 同上模式 |
| 2 | `desktop-session-world` | `foreground.current@1`、`input-activity.current@1` | `desktop-session-world.snapshot@1` | — |
| 3 | `desktop-session-awareness` | `desktop-session-world.snapshot@1` | `desktop-session-awareness.current@1`、`desktop-session-awareness.peek@1` | baseline 变量，activation-local |

关键源码位置：

- 契约与两种语义（`current()` 消费 baseline，`peek()` 不消费）——`src/desktop-session-awareness/contracts.ts:26-36`、`:67-72`，`defineService` 调用在 `:38-41`、`:74-76`。
- 依赖声明——`src/desktop-session-awareness/plugin.ts:66-68`、`src/desktop-session-world/plugin.ts:14-15`、`src/foreground/plugin.ts:13-14`。
- 领域判断（不改写的部分）——`compareForeground`（`plugin.ts:22-40`）、`compareInputActivity`（`:42-49`）、`overallChange`（`:51-60`）。这三个函数是本次「不许复制」的对象。

外部依赖性质：两条链路的叶子（`foreground.windows`、`input-activity`）都只读 Windows 本地状态，无网络、无第三方包、无 Hikari Runtime 之外的全局状态。所以依赖链**三层、全部零外部依赖**，与 s1 的预测一致。

### 为什么选 peek 而不是 foreground

| 候选 | 依赖深度 | 是否含语义判断 | 卸载后是否有资源可释放 | 判定 |
| --- | --- | --- | --- | --- |
| `foreground.current` | 0 | 无（`toObservation` 直接投影） | 有（acquirer.dispose），但对象很薄 | 太薄，P2 测不出有意义的生命周期差异 |
| `desktop-session-awareness.peek` | 3 | **有**：三值 change 判断 + baseline 不变语义 | 有（三层各有 acquirer/baseline） | 选它 |
| `desktop-session-awareness.current` | 3 | 同上，但会推进 baseline | 同上 | 需要会改变状态的副作用，PoC 不需要 |

`peek()` 的语义是可验证的：连读两次 baseline 不动，`current()` 才会推进。这让「Cordis 是否保住了契约语义」变成可测的，而不是靠读代码判断。

## 2. Hikari Runtime 的三条语义（后续要逐条对照 Cordis）

来自 `src/runtime/runtime.ts`：

1. **依赖满足才启动**：`runtime.ts:98` `if (record.state === 'waiting' && this.#requirementsSatisfied(record.definition))`，判断体在 `:110` `(definition.requires ?? []).every(contract => this.#services.has(contract))`。
2. **级联失效**：`runtime.ts:159` `#deactivateTree`——卸载一个 provider 时，把所有 `requires` 命中其 `provides` 的依赖方**递归卸载**（`:168-169`），再 `#deactivate` 自己（`:172`）。
3. **卸载 ≠ 销毁**：`runtime.ts:186`、`:200` 卸载后 state 回到 `waiting`，不是终止；服务重新被提供时可以再次激活。

契约键是 `id@version` 复合键（`src/runtime/contracts.ts:26-28` 的 `serviceKey`），版本号参与键的构造。

## 3. DSH 侧：插件与工具的真实入口

| 目的 | 机制 | 位置 |
| --- | --- | --- |
| 定义插件 | Cordis `Context` + `Service` 基类 + `inject` | `node_modules/@deepseek-ai/cordis/README.md` 快速开始 |
| 启动宿主 | `dsh --profile headless "job"`（一次性 session，打印最终答案后退出） | `node_modules/@deepseek-ai/dsh/README.md` 的 Entry modes 表 |
| 装载第三方插件 | profile 目录 `$DSH_HOME/profiles/<name>/`，或 `--patch <path>` 叠加 YAML | `dsh --help`；loader 的 `name` 是模块 specifier |
| 注册模型工具 | `defineTool({ name, description, parameters, output, execute })` + `ctx.tools.register(...)` | `node_modules/@deepseek-ai/dsh-tools/README.md`（Register a tool 一节） |
| 工具策略 | `ctx.tools.guard(guard)`、`restrict(filter)`；未注册的工具压根不在 schema 里 | 同上 |
| 模型接入 | `@deepseek-ai/dsh-llm-pi-ai`，`providers.<route>.baseURL` + `apiKeyEnv` + `models` | `node_modules/@deepseek-ai/dsh-llm-pi-ai/README.md` |
| Session 落盘 | `@deepseek-ai/dsh-session`（默认 bundle 已含） | headless 默认树 `id: session` |

profile 现状（`dsh-home/profiles/headless/`）：`package.json` 的 `dsh.profile.bundles` 为 `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]`，另有 `cordis.yml`、`cordis.patch.yml`、`pnpm-workspace.yaml`。默认树里 `agent-default-model` 配的是 `provider: deepseek-official, model: deepseek-flash`。

## 4. 已知的风险（进 P1/P3 之前先记下）

1. **契约键形状不同**：Hikari 是 `id@version`，Cordis 服务名是单字符串。适配层把版本号编进名字（`desktop-session-awareness.peek@1`）能否保住版本语义，要实测。
2. **失效语义不同**：Cordis 的 `inject` 在服务消失时是等待还是 dispose，与 Hikari 的「级联卸载 + 回 waiting」不是同一件事；P2 要分清「行为看着像」与「语义等价」。
3. **模型接入需要一个可用端点**：`dsh-llm-pi-ai` 支持自定义 `baseURL`，但 `apiKeyEnv` 指向的凭据必须可解析，否则请求以 `MISSING_CREDENTIAL` 失败。这一步会先在 s4 前单独验证一次连通性。
4. **`pnpm` 不可用**：`dsh plugin add` 走 pnpm，所以第三方插件不通过它安装，改用 profile 目录内直接放置 + `--patch` 叠加。

## 5. 本步没做的事

没有启动 DSH、没有装载任何插件、没有调用模型。这份清单只是把后续步骤要对照的坐标固定下来。
