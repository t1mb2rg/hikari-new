# 真实四层依赖链在契约层下的装载、级联停用与重新激活

## 链条是真的

| 层 | 插件 id | requires | provides | 源码 |
| --- | --- | --- | --- | --- |
| 1 | `foreground.windows` | — | `foreground.current` | `src/foreground/plugin.ts:11-14` |
| 2 | `input-activity.windows` | — | `input-activity.current` | `src/input-activity/plugin.ts:11-14` |
| 3 | `desktop-session-world` | 上面两项 | `desktop-session-world.current` | `src/desktop-session-world/plugin.ts:12-15` |
| 4 | `desktop-session-awareness` | world | `desktop-session-awareness.current`、`.peek` | `src/desktop-session-awareness/plugin.ts:65-68` |
| 5 | `desktop-session-awareness-loop` | awareness | —（纯消费者） | `src/desktop-session-awareness-loop/plugin.ts:43-51` |

**这推翻了一条旧表述**：`docs/architecture/route-c-migration-prerequisites.md` 里写的「真实四层插件没有 requires 链」，与本表第 3、4、5 行的 `requires` 相矛盾。链不只是存在，它有三段真实的依赖边。

但「依赖链存在」和「这条生产链的级联卸载被实测过」是两件事——前者读源码就有，后者要跑。下面这份读数是后者。

## 读数

脚本 `awareness-chain.mjs`，读数 `awareness-chain.json`。`delayMs = 100`。

同一套流程在两侧各跑一遍：**契约层**（PoC-03 `contract-layer.mjs`）与 **Hikari 原 Runtime**（对照基线）。Hikari 的 `Runtime` 不对外暴露 `events`，所以两侧都用同一个隔离测试订阅者计数 `desktop-session-awareness-loop.assessed@1`——它不是生产消费者（生产消费者只有 `desktop-content-read`，`src/cli/resident.ts:431`）。

### 阶段 1：按真实顺序装载

| 侧 | 五层状态 | 2 s 内事件 | 事件间隔 |
| --- | --- | --- | --- |
| 契约层 | 全部 `active` | +4 | 538 / 487 / 499 ms |
| Hikari | 全部 `active` | +4 | —（未逐条记录间隔） |

### 阶段 2：卸载 `foreground.windows`

| 层 | 契约层 | Hikari |
| --- | --- | --- |
| `foreground.windows` | 无记录（已卸载） | 无记录 |
| `input-activity.windows` | `active`（本就不依赖它） | `active` |
| `desktop-session-world` | `waiting` | `waiting` |
| `desktop-session-awareness` | `waiting` | `waiting` |
| `desktop-session-awareness-loop` | `waiting` | `waiting` |
| 1.2 s 内事件 | **+0** | **+0** |

级联是真实的：卸掉最上游一个插件，下游三层全部离开 `active`，而**没有依赖它的 `input-activity.windows` 不受影响**。事件计数停在 0，说明 loop 的定时器随激活一起停了——这正是 `src/desktop-session-awareness-loop/plugin.ts:98-113` 的 `context.defer` 负责的那件事。

### 阶段 3：把 `foreground.windows` 装回来

| 侧 | 五层状态（窗口结束） | 2 s 内事件 | 事件间隔 |
| --- | --- | --- | --- |
| 契约层 | 全部 `active` | +4 | 496 / 503 / 524 ms |
| Hikari | 全部 `active` | +4 | 491 / 516 / 533 ms |

下游三层在没有任何额外操作的情况下自己回来了——这是 Cordis `inject` 的原生行为，契约层没有为它写代码。

**事件间隔是关键读数**：重装后与首次装载后处在同一量级（约 500 ms），没有减半。如果旧激活的定时器残留，两个定时器会同时到期，间隔会掉到约一半、事件数会翻倍。没有发生，说明**没有残留的旧订阅或旧定时器**。

### 阶段 4：全部卸载

两侧都是零事件、无记录。契约层的 `inspect()` 在 `awareness-chain.json` 的 `teardown.records` 里。

## 一次实测暴露的时序细节

重装 `foreground.windows` 之后**立即**采状态，会看到 `desktop-session-awareness: loading`、`desktop-session-awareness-loop: waiting`——因为 `loadPlugin` 等的是被装载的那个插件自己的激活，下游的重新激活是随后异步发生的。窗口结束后再采，五层都回到 `active`。

这不是缺陷，但它是一个必须写下来的读法：**「装完立刻查状态」看到的不是稳定态**。

## 这一节证明了什么、没证明什么

证明：

- 真实生产依赖链在契约层下被正确满足（五层 `active`，事件按 cadence 产生）。
- 级联停用在这条**生产链**上被实测过，而不只是「构造出来的三层探针」。
- 重新激活后没有残留定时器（间隔未减半、计数正常）。
- 契约层的状态读数与 Hikari 逐项一致。

没证明：

- 这条链在 Hikari 侧被**整体卸载**（先卸 awareness 还是先卸 foreground）时的差异——本轮只卸最上游。
- `desktop-session-awareness.current()` 读到的窗口内容是否与 Hikari 一致（PoC-01 测过一次，本轮未重测）。
- 超过五层的分叉依赖。
