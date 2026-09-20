# Hikari 第四阶段 P4-01 Desktop Session Awareness Loop v1 实现

> **本轮只新增一个普通 Plugin。**
> `src/runtime/**`、`src/foreground/**`、`src/input-activity/**`、`src/desktop-session-world/**`、`src/desktop-session-awareness/**` 的改动数均为 **0**。`package.json`、`tsconfig.json` 改动数为 **0**。

---

## 1. 阶段目标

P3-05 证明了四层可以**组合**，但那条链是 **pull-only** 的：`desktop-session-awareness.current()` 只在被调用时才前进，没有任何东西会周期性地调用它。Awareness 的 `baseline` / `comparison` 语义因此**只能被手工驱动**。

P4-01 补的不是感知能力，而是**驱动**这一格：

```
Foreground ┐
           ├→ World → Awareness → 【Loop】→ Event（0..n 订阅者）
Input ┘                              ↑
                                  本轮新增
```

要回答的问题只有一个：**一个普通 Plugin，能否只用 Runtime 已冻结的接缝，安全地周期性驱动一个 pull-only 能力，并把结果作为 occurrence 发布出去？**

| # | 子问题 | 为什么既有测试答不了 |
| --- | --- | --- |
| 1 | 后台异步循环的失败，会不会逃逸成 unhandled rejection，或永久杀死循环？ | 既有 Plugin 的 `setup` 全是同步的，没有任何后台工作 |
| 2 | 非重叠能否**由调度形状保证**，而不是靠守卫去堵？ | 仓库此前没有任何 `setTimeout` / `setInterval` |
| 3 | 反激活能否在 in-flight 采集进行中安全收尾，且不发布、不产生 unhandled rejection？ | 既有 cleanup 全是同步的 |
| 4 | 驱动一个**单驱动者**能力是否需要一个新架构机制？ | 此前没有任何模块周期性调用 `current()` |

---

## 2. 冻结设计（本轮不重新发明架构）

本轮**设计已冻结**，实现只是把它落成代码。

| 项 | 值 |
| --- | --- |
| Plugin id | `desktop-session-awareness-loop` |
| 角色 | **Service Consumer + Event Producer**（纯消费者） |
| `requires` | `desktop-session-awareness.current@1` |
| `provides` | `[]` |
| `emits` | `desktop-session-awareness-loop.assessed@1` |
| 新增文件 | `contracts.ts` / `plugin.ts` / `index.ts` |

**未创建 `types.ts`、`errors.ts`。** 实现证明确实不需要：config 类型就地定义在 `plugin.ts`，唯一的 error 是一个 `parse` 里的普通 `Error`，没有可被独立消费的错误分类。若当时认为必要，按 §19 纪律应先停下报告，而不是自行扩展 —— 结果是没必要。

**零新增 runtime 概念**：没有 `Runtime.getService()`、没有 service locator、没有 scheduler、没有 loop registry、没有 manager、没有 super orchestrator、没有 health framework。全部实现只用到 `PluginDefinition` / `requires` / `context.services.get` / `context.events.emit` / `context.defer`。

---

## 3. 当前文件

| 文件 | 大小 | 内容 |
| --- | --- | --- |
| `src/desktop-session-awareness-loop/contracts.ts` | 856 B | `desktopSessionAwarenessAssessedEvent` |
| `src/desktop-session-awareness-loop/plugin.ts` | 6082 B | config 类型、`MAX_TIMER_DELAY_MS`、`parseConfig`、Plugin Definition |
| `src/desktop-session-awareness-loop/index.ts` | 206 B | 三个导出 |
| `test/desktop-session-awareness-loop.test.mjs` | 23015 B | 19 条用例 |

---

## 4. Event 契约语义

### 4.1 Owner 是 Loop，不是 Awareness

事件名是 `desktop-session-awareness-loop.assessed`，**不是** `desktop-session-awareness.assessed`。

差别不在措辞。后一个名字会宣称 **provider 开始推送**，而 provider 保持 pull-only —— 它的公开面里没有 Event，只有 `current()`。这个 occurrence 说的是「**谁问了、什么时候问完的**」，那是 Loop 拥有的语义；评估结果本身是 Awareness 拥有的，Loop 只是把它交出去。

### 4.2 Payload 就是评估结果本身

```ts
export const desktopSessionAwarenessAssessedEvent =
  defineEvent<DesktopSessionAwarenessAssessment>('desktop-session-awareness-loop.assessed', 1);
```

`DesktopSessionAwarenessAssessment` 是 Awareness 已经公开的类型，**按引用传递**：

- **无字段复制** —— 没有 loop 专属的包装对象；
- **无第三个时间戳** —— 不新增 `emittedAt` / `observedAt` 之类；
- **无 `importance` / `salience` / `priority` / `remember` / `notify` / `action` / `interpretation`** —— 这些是 Awareness 层**尚未实现**的环节，Loop 更没有资格代它下判断。

一个把拿到的数据重新表述一遍的发布者，会成为该数据形状的**第二个权威**。所以 payload 原样传出，不 clone、不重建、不重新解释。

### 4.3 Producer 不决定消费者

- 不检查订阅者数量；
- 不决定有几个订阅者；
- 不决定结果去了哪里。

**0 subscriber 是合法状态。** Event 的合法性来自 Producer 拥有的、真实且稳定的 occurrence semantics，不来自 subscriber count。测试用例 5 专门断言零订阅时循环照常推进。

---

## 5. `delayMs` 语义

```ts
export interface DesktopSessionAwarenessLoopConfig {
  readonly delayMs: number;
}
```

**严格含义**：**上一轮 cycle 完成后，到下一轮 cycle 开始前的延迟。**

它**不是** wall-clock 间隔。若一轮采集耗时 300 ms 而 `delayMs` 是 1000，那么下一轮的开始时刻是「完成 + 1000」，不是「上次开始 + 1000」。这个区别是 §7 非重叠性质的直接来源。

**无默认值，必须显式给出。** 有默认值就等于这个 Plugin 替 Hikari 决定「多久看一次桌面」，那是 mandate，不是实现细节。

`parse` 拒绝以下全部输入：

| 输入 | 结果 |
| --- | --- |
| `undefined` / `null` / `'5'` | 拒绝（非 number） |
| `{}` / `{ delayMs: undefined }` / `{ delayMs: null }` | 拒绝 |
| `0` / `-1` | 拒绝（必须 ≥ 1） |
| `1.5` | 拒绝（必须整数） |
| `NaN` / `Infinity` / `-Infinity` | 拒绝 |
| `2_147_483_648` / `Number.MAX_SAFE_INTEGER` | 拒绝（超出 timer 上限） |
| `5` | 接受 |
| `10_000` | 接受 |
| `2_147_483_647` | 接受（上限本身） |

`Number.isInteger` 本身就排除 `NaN` 与两个无穷，所以判定条件就是「是 number、是整数、且在 `[1, 2_147_483_647]` 区间内」三项。

**取值范围的上界是 `2_147_483_647` ms（`2^31 - 1`）。** 这个上界不是 cadence 策略，而是**本 Loop 实际使用的调度原语的边界**：Node 的 `setTimeout` 对大于 `2^31 - 1` 的延迟不做等待，而是**静默改写成 1 ms** 并发出 `TimeoutOverflowWarning`。也就是说，超过上界的值一旦被接受，Plugin 承诺的 cadence 与它真正执行的 cadence 就不再是同一个值 —— 配置语义与运行语义脱节。**这是 `config.parse` 的正确性边界，不是通用 Plugin Design Rule**：它只约束这一个 Loop 的 schedule 实现，其他 Plugin 是否受同类边界约束，取决于它们各自使用的原语。

越界一律**拒绝**，不做 clamp、不做截断、不做静默修复。被悄悄改成另一个值的 cadence 已经不再是所配置的那个 cadence；一个 Plugin 无法忠实执行的 cadence，它就不该接受。

**没有** cron、RRULE、jitter、backoff、scheduler DSL、优先级队列。就一个正整数，且没有任何可以长成 scheduler 的东西。

---

## 6. 首轮语义

**激活后立即、且异步**调度第一轮。

```ts
scheduleCycle(0);
```

`setup` **不** `await awareness.current()` —— 激活不得阻塞在一次真实采集上（一次采集会拉起 2 个 PowerShell 子进程，见 §18 限制 5）。

边界选在 macrotask（`setTimeout(..., 0)`），因此 `loadPlugin` resolve 时插件已 active，在 `loadPlugin` 返回后才订阅的调用方已经就绪。测试用例 3 用 `delayMs: 10_000` 配 1000 ms 的判定窗口，证明第一轮**不经过一个 cadence 才到来**。

---

## 7. 非重叠

**完成驱动的调度**，不是 `setInterval`：

```
cycle 完成 ──→ delayMs ──→ 下一个 cycle
```

由此得到的不变量：

- 每次 activation **至多一个** `awareness.current()` 在途；
- 采集慢于 `delayMs` 时**不可能重叠** —— 因为下一个 cycle 还没有被排出来；
- **无 drift correction**（也就无 drift 需要纠正）。

关键在于：**非重叠是调度的形状，而不是一个守卫在强制它。** 代码里没有任何「如果还在跑就跳过」的判断 —— 那种守卫的存在本身就意味着调度允许重叠。

测试用例 7 用一个可控的 `deferred()` 闸门卡住第一轮采集，`delayMs` 设为 1 ms，等 40 ms 后断言 provider 的调用计数仍为 1。

---

## 8. 后台失败语义

**前提事实（Runtime 已冻结行为）**：Runtime **不会**把 active Plugin 的后台异步 rejection 变成 `PluginState = 'failed'`。`context.events.emit` 是一个不带生命周期门控的直通。

推论：`runCycle` **必须自己吸收 rejection**，否则一次失败要么变成 unhandled rejection，要么让循环永久停摆。三类失败：

| 类别 | 来源 | 处理 |
| --- | --- | --- |
| **A** 采集失败 | `awareness.current()` reject | 该轮操作失败 → **不 emit** → 无 unhandled rejection → `delayMs` 后继续 |
| **B** 发布失败 | `events.emit()` reject | 发布失败 → **一个坏订阅者不得永久杀死 Loop** → 继续 |
| **C** 内部异常 | 本文件自身的缺陷 | 捕获 → 无 unhandled rejection → 继续 |

**B 的一个细节**：`EventBus.emit` 用 `Promise.allSettled` 收集订阅者结果，任一订阅者 reject 时抛出 `AggregateError`。若某个订阅者的 handler **同步抛出**，`handlers.map(...)` 会在 `allSettled` 之前就抛出，后面的订阅者不会被调用。两种情况都由同一个 `catch` 吸收。

**不修改 EventBus。** EventBus 的语义是正确且已冻结的：对 Producer 而言「有订阅者失败了」是必须让它知道的事实，问题只在于 Producer 要不要因此死掉 —— 答案是不要。

**不新增**：failure Event、health Service、status Service、`lastError`、retry manager、circuit breaker、backoff framework。

测试用例 8 / 9 / 10 分别覆盖 A / B（异步 reject）/ B（同步 throw）。

---

## 9. 生命周期与 in-flight 关闭

所有 timer 与后台工作**归 Plugin 生命周期所有**。`context.defer` 注册 cleanup：

```ts
stopped = true;                    // 1. 标志先立，让从 await 返回的 cycle 看得见
if (pendingTimer !== undefined) {  // 2. 再清 timer，之后排不出新 cycle
  clearTimeout(pendingTimer);
  pendingTimer = undefined;
}
if (inFlight !== undefined) await inFlight;  // 3. 最后等 cycle，让本次 activation 完全 settle
```

**顺序承载含义**，三步不可换位。

必须成立的性质（逐条对应用例）：

- ✅ 反激活后**不得**启动新 cycle
- ✅ **必须**取消 pending timer
- ✅ in-flight resolve 之后**不得** emit（`await` 之后第二次检查 `stopped`）
- ✅ in-flight reject **不得**产生 unhandled rejection
- ✅ **不得**重新排程
- ✅ cleanup **必须**等 in-flight cycle settle

**为什么 `await inFlight` 不会死锁**：`#deactivateTree` **先**递归反激活 dependents，**再** `await #deactivate(record)`；dispose 期间整个 Runtime 是挂起的，所以上游 provider（Awareness）仍然 active，in-flight 的采集必然能拿到结果。三条卸载路径（`shutdown()`、卸载 Awareness、卸载 Loop）都已核对。

**`runCycle` 在每条路径上都 resolve**，所以这个 await 不会 reject。

### 关于关闭上界的一条必要克制

**不得声称 shutdown 有严格的 10 s 硬上界。**

在途采集确实受 `execFile` 的 `ACQUISITION_TIMEOUT_MS = 10_000` 约束，但 `Foreground` / `InputActivity` 的 `terminate()` 自身有**有界性债务**（P3-01 / P3-02 遗留）。那笔债务**本轮不得修改**，因此也不能拿它来给本条性质背书。这里只声称「cleanup 会等 in-flight cycle settle」，不声称它多快 settle。

---

## 10. 依赖消失与恢复

**Loop 不做任何自愈动作**：

- ❌ 不查询 Runtime 状态
- ❌ 不轮询 Provider 可用性
- ❌ 不重连
- ❌ 不自发现

这些全部由 Runtime 的 `#reconcile` 负责。Runtime 已冻结的行为是：需求不再满足 → 反激活；需求重新满足 → 重新激活。

因此**恢复 = 一次全新的 activation**：

- 全新的 `stopped` / `pendingTimer` / `inFlight`（都是闭包局部变量，随 activation 生灭）；
- **重跑首轮语义**（恢复后的第一批数据是 baseline，不是 comparison）；
- Awareness 自己的 activation-local `previous` baseline 也**同步重启**。

这正是 `setup` 里的状态被刻意压到三个变量的原因 —— 没有 generation token 去区分「第几次激活」，因为闭包本身就是边界。

测试用例 14 卸载 Awareness → 断言 Loop 进入 `waiting` 且停止采集 → 重新加载 Awareness → 断言用**新一轮首轮语义**恢复。

---

## 11. 单驱动者假设（记录，不强制）

`desktop-session-awareness.current@1` 当前拥有一份**共享的、activation-local 的 `previous` baseline**：

```ts
let previous: DesktopSessionWorldSnapshot | undefined;   // desktop-session-awareness/plugin.ts
```

`current()` 每次被调用都会推进它。这意味着该能力**实际上是单驱动者的** —— 两个并发调用方会互相污染 baseline，各自看到的 `previous` 未必是自己上次拿到的 `current`。

**本轮记录如下前提，不施加任何强制**：

1. `desktop-session-awareness.current@1` 目前拥有一份共享的 activation-local baseline；
2. **P4-01 之后，Loop 是预期的生产运行驱动者**；
3. **任何未来计划周期性直接调用 `current()` 的生产模块，必须触发一次设计复审** —— 复审的问题是：**它为什么不能消费 Event？**
4. 若复审认定它确实需要直接调用，则 baseline 的归属问题需要在**那一轮**重新设计。

**本轮不修改 Awareness**，不加 mutex、不加 caller lock、不加 lease、不加 ownership enforcement。只记录前提。把假设写下来，与把它变成运行时强制，是两件事：后者会在没有任何真实第二个调用方之前，先给唯一合法的调用方套上成本。

---

## 12. 公开面

`index.ts` **只**导出三个：

```ts
export { desktopSessionAwarenessLoopPlugin } from './plugin.js';
export type { DesktopSessionAwarenessLoopConfig } from './plugin.js';
export { desktopSessionAwarenessAssessedEvent } from './contracts.js';
```

**不导出**：`runCycle`、`scheduleNext`、任何 timer 状态、parser helper、内部工厂、test seam。

依赖方向：import 一律走 `src/desktop-session-awareness/index.ts`，**无深路径 import**；Runtime 侧只用冻结接缝，**未新增任何 `runtime/index.ts`**。

测试用例 16 扫描源码 import 行做强制，用例 18 断言 Loop 目录下**恰好三个文件**。两条都是**结构性断言**，不依赖人的自觉。

---

## 13. Plugin Design Spec 符合性

| 条款 | 要求 | 本实现 |
| --- | --- | --- |
| §2.1 四判据 | Owner / 跨边界 / 平面归属 / 稳定性承诺 | 三个导出逐条对照通过（§12） |
| §5 通信平面 | 按语义选平面 | Service = 消费 Awareness；Event = 发布 occurrence；无 Chronicle（不持久化）、无 Action（不改变现实） |
| §6.2 / §6.3 | requires / provides | `requires: [awareness]`，`provides: []`（纯消费者形态） |
| §7 public surface minimal | 最小公开面 | 3 个导出均满足 §2.1 的 public contract 判据；该判据不要求此刻已有 Consumer implementation，`desktopSessionAwarenessAssessedEvent` 当前允许 0 subscriber（§4.3） |
| §8.1 / §8.2 | 生命周期所有权 + cleanup 有界性 | §9，四个问题逐条回答 |
| §9 setup 规则 | 归属，不是行为分类 | 同步返回，所有工作归 `defer` |
| §10 / §10.1 | 状态归属 + 数据传递边界 | 三个闭包局部变量；payload 按引用传出 |
| §13 / §13.1 | 错误语义 | §8，三类失败全部在 cycle 边界吸收 |
| §14 / §14.1 | 后台循环规则 | §5–§9 |
| §15 Event-producing consumer | 0 subscriber 合法 | §4.3，用例 5 |
| §16 契约创建门禁 | 逐平面判据 | Event 平面：Producer 产生了对模块边界之外有意义的 occurrence ✅ |
| §17 god-object 触发 | 无 manager/scheduler | §2 末尾 |

**未新增任何架构概念。** 本轮是对已冻结规范的一次实例化，不是对它的扩展。

---

## 14. 当前测试

`test/desktop-session-awareness-loop.test.mjs` — **19 条**：

| # | 测试名 | 承重断言 |
| --- | --- | --- |
| 1 | `the loop requires exactly the awareness capability and provides nothing` | 纯消费者形态 + 事件 id/version |
| 2 | `the cadence must be given explicitly and must be an integer within the timer range` | 15 种非法输入全部被拒 + 拒绝后无残留记录 + 上限 `2_147_483_647` 被接受 |
| 3 | `setup acquires nothing and the first cycle does not wait for a cadence` | 零急切采集 + 首轮不等 cadence |
| 4 | `the assessment is published by reference and unmodified` | 引用恒等（无复制/无包装） |
| 5 | `a cycle with no subscribers is legal and the loop keeps running` | 0 subscriber 合法 |
| 6 | `cycles keep running at the configured cadence` | cadence 连续性 |
| 7 | `an acquisition slower than the cadence never overlaps the next one` | **非重叠**（可控闸门） |
| 8 | `an acquisition rejection neither stops the loop nor escapes it` | 失败类别 A + 无 unhandled rejection |
| 9 | `a failing subscriber does not stop the loop` | 失败类别 B（异步 reject） |
| 10 | `a subscriber that throws synchronously does not stop the loop` | 失败类别 B（同步 throw） |
| 11 | `an unload with a cycle pending cancels it` | pending timer 取消 |
| 12 | `an unload during an in-flight cycle waits for it and publishes nothing` | in-flight 收尾 + 不发布 |
| 13 | `an in-flight cycle that rejects during unload still lets the unload finish` | in-flight reject 不阻塞关闭 |
| 14 | `the loop waits when awareness disappears and restarts fresh when it returns` | 依赖消失/恢复 |
| 15 | `consumers fan out through the event without calling the awareness service` | 扇出经 Event，不穿透 Provider |
| 16 | `the loop module depends only on public entry points` | 无深路径 import |
| 17 | `the loop module carries no policy, platform, or storage vocabulary` | 无越界词汇 |
| 18 | `the loop added no file to any module it depends on` | 零修改既有模块 |
| 19 | `the largest accepted cadence is scheduled as configured and taken down on deactivation` | 上限 cadence 真实排程 + 反激活时被撤下（不等待真实最大 timer） |

### 测试纪律

- **不使用第三方 fake timers。** 等待用 `setImmediate` 的事件循环轮次边界、可控 `deferred()` 闸门、或带 deadline 的条件等待 helper `until()`。
- **不依赖「睡 20 ms 然后希望时序成立」。** 少量真实等待（`elapsed()`）只用于**否定断言**，即证明在给定窗口内**没有**发生额外的 cycle / publication / scheduling（用例 7、11、12、14、19）；正向时序与并发性质主要由可控 Promise、事件循环轮次边界和带 deadline 的条件等待证明。之所以需要真实等待，是因为「没有发生」无法靠事件循环轮次来观察。
- **不引入任何新依赖。** 只用 Node 原生 `node --test`。
- 用例 8/9/10 通过 `trapRejections(t)` 在进程级监听 `unhandledRejection`，在 `t.after` 移除。

---

## 15. 判别力探针

一次性、**不进入仓库**。探针脚本在 `process.on('exit')` 上无条件还原源文件，因此任何崩溃或超时都不会把工作区留在变异状态。

| 变异 | 改动 | 结果 |
| --- | --- | --- |
| 基线 | — | `tests 18 / pass 18 / fail 0`（探针当时套件为 18 条；P4-01.1 之后为 19 条） |
| **A** | 移除 `await` 之后的 `stopped` 检查 | **`pass 17 fail 1` — CAUGHT**（用例 12） |
| **B** | `catch` 内改为重新抛出（不再吸收 rejection） | **`pass 15 fail 3` — CAUGHT**（用例 8/9/10） |
| **C** | `scheduleCycle` 每次额外再排一个 cycle | **`pass 12 fail 6` — CAUGHT**（用例 3/7/11/12/13/14） |
| **D** | cleanup 不再 `await inFlight` | **`pass 17 fail 1` — CAUGHT**（用例 12） |
| 恢复 | 重新构建 | `sha256:ce283460…` 与 pristine **一致 ✓** |

四条变异**各自至少让一条用例变红**，且失败集合与设计预期一致：

- **A / D 都只打红用例 12** —— 符合预期：它是**唯一**同时观察「in-flight 收尾」与「不发布」的用例。两者打红的用例相同但破坏的性质不同（A 破坏的是发布门禁，D 破坏的是收尾等待）。
- **B 打红的三条正是三个失败类别** —— 与 §8 的表一一对应。
- **C 打红六条** —— 额外的 timer 同时污染首轮语义、非重叠、以及四条生命周期用例，说明非重叠**不是**孤立性质。

**证据等级如实记录**：探针是**会话内一次性**的，不在仓库内、不进 CI、不可复现。它证明「当时确实验过」，**不证明「以后不会被改坏」**。这是 P3-01 起累计的已知弱点，P4-01 未改变它。

---

## 16. 真实运行结果

近期**实际运行**（非预期）。下面这一段是 **P4-01.1（timer 上界修正）之后**的运行记录；P4-01 当时的记录是 202 条用例、本文件的 18 条，差异来自 §5 上界修正新增的第 19 条与第 2 条的扩充。

```
$ npm test
ℹ tests 203
ℹ pass 203
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4165.3328

$ node --test test/desktop-session-awareness-loop.test.mjs     （单跑，需先 build）
✔ the loop requires exactly the awareness capability and provides nothing (1.2557ms)
✔ the cadence must be given explicitly and must be an integer within the timer range (0.6332ms)
✔ setup acquires nothing and the first cycle does not wait for a cadence (2.3928ms)
✔ the assessment is published by reference and unmodified (3.2932ms)
✔ a cycle with no subscribers is legal and the loop keeps running (4.9304ms)
✔ cycles keep running at the configured cadence (6.9805ms)
✔ an acquisition slower than the cadence never overlaps the next one (96.3314ms)
✔ an acquisition rejection neither stops the loop nor escapes it (9.5994ms)
✔ a failing subscriber does not stop the loop (4.9749ms)
✔ a subscriber that throws synchronously does not stop the loop (4.87ms)
✔ an unload with a cycle pending cancels it (168.9712ms)
✔ an unload during an in-flight cycle waits for it and publishes nothing (45.5295ms)
✔ an in-flight cycle that rejects during unload still lets the unload finish (1.4864ms)
✔ the loop waits when awareness disappears and restarts fresh when it returns (45.8981ms)
✔ consumers fan out through the event without calling the awareness service (5.1652ms)
✔ the loop module depends only on public entry points (0.9034ms)
✔ the loop module carries no policy, platform, or storage vocabulary (0.437ms)
✔ the loop added no file to any module it depends on (0.3639ms)
✔ the largest accepted cadence is scheduled as configured and taken down on deactivation (53.8425ms)
ℹ tests 19  pass 19  fail 0  skipped 0
ℹ duration_ms 538.1394
```

### 计数口径

| 环境 | 结果 | 来源 |
| --- | --- | --- |
| 本机 Windows 11 | **203 tests / 203 pass / 0 fail / 0 skipped** | **实际跑过** |
| CI | 未运行 | 本轮**未 push** |

203 = 184（P3-05 基线）+ 19（P4-01 的 18 条 + P4-01.1 新增 1 条）。

**不写耗时常量**：绝对数值跨轮次不稳定，按 P3-03 §13 纪律，只用同一轮同机相对关系下结论。

---

## 17. 本阶段明确没有实现

- ❌ 任何 salience / importance / priority / remember / notify / act
- ❌ 任何对评估结果的语义解读或跨 source 推断
- ❌ 失败 Event / health Service / status Service / retry / circuit breaker / backoff
- ❌ 通用 scheduler / loop registry / manager / super orchestrator
- ❌ 对 `EventBus` 的任何修改
- ❌ 对 `Awareness` 的单驱动者保护（mutex / lease / ownership enforcement）
- ❌ 对 Foreground / InputActivity `terminate()` 有界性债务的修复
- ❌ 非 Windows 实现

**本文件不规划 P4-02。** 下一阶段的范围与取舍不在本轮决定。

---

## 18. 已知限制

1. **后台 cycle 失败没有独立的公开可观测面。** v1 的失败语义是「吸收、继续」，而不是「吸收、上报」。`runCycle` 的 `catch` 是空的 —— 一次采集失败或一个坏订阅者，除了「循环没有停」之外**不留任何痕迹**。这是本轮**有意**的取舍：唯一能上报它的手段（failure Event / health Service）都会新增一个本阶段没有真实消费方的契约，而那正是规范要拦的东西。**它是限制，不是设计** —— 读作「v1 不假装自己可观测」，不读作「失败不重要」。

2. **关闭没有严格上界。** §9 已声明。in-flight 采集受 `execFile` 的 10 s 约束，但 `Foreground` / `InputActivity` 的 `terminate()` 有界性债务仍然存在，本轮不得修改，因此**不能**据此声称 shutdown 有 10 s 硬上界。

3. **单驱动者假设是记录，不是强制。** §11 已声明。`current()` 的共享 baseline 目前**没有任何运行时保护**；违反该假设的后果是静默的 baseline 污染，不是报错。

4. **探针一次性、不可复现**（§15）。

5. **真实生产链的高成本未被本轮改变。** 一次 `current()` 会拉起 **2 个** PowerShell 子进程（`desktopSessionWorld.current()` 并行调用 `foreground.current()` 与 `inputActivity.current()`，Windows 实现各启动一个 `powershell.exe`；本轮以 `execFile` 计数桩实测确认）。P3-05 实测两次调用合计约 846 ms。Loop 让它**定期**发生，但本轮**没有**做任何采集成本优化 —— 那是另一个问题，且不在本轮范围。

---

## 19. 实现原则

1. **不重新发明架构** —— 设计已冻结，实现是实例化。
2. **零修改既有生产代码** —— 若实现必须改动 `src/runtime/**` 才能通过，停止并报告 blocker，**不得偷偷扩 Runtime**。
3. **不新增架构概念** —— 只用 `PluginDefinition` / `requires` / `context.services.get` / `context.events.emit` / `context.defer`。
4. **公开面最小** —— 三个导出，每一个都有真实消费方。
5. **不使用注入缝** —— 测试替身作为普通 Plugin 参与真实 Runtime 依赖图，由 Runtime 决定谁 active。
6. **不留假断言** —— 不成立的性质写成明示的否定断言（用例 7、12）。
7. **判别力优先** —— 变异未被抓住时，先怀疑变异，再怀疑测试。

---

## 20. 一条必须与本阶段结论同时出现的上限声明

> **P4-01 补的是「驱动」，不是「Awareness」。**
>
> 按 `principles.md` §14 的冻结定义，Awareness 是「这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？」，其链路包含 **Salience / Importance Judgement** 与 **Ignore / Remember / Ask / Notify / Act**。P3-04 落实的只是 **Contextualization** 一格的最窄面；P4-01 **一格都没有新增**。
>
> 本轮真正新增的，是**让那一格定期前进**、并把每次前进作为 occurrence 发布出去的**机制**。事件载荷因此**不含**任何判断 —— 没有 `importance`、没有 `salience`、没有 `priority`、没有 `action`。
>
> 准确表述是：**P4-01 首次让 Awareness 被一个真实生产 Plugin 周期性驱动，并把结果作为 Event 发布；驱动不等于解读。**
>
> 同时必须记住：**0 subscriber 是合法的。** 本轮交付的是一条**可以被订阅**的链路，不是一条**已被消费**的链路。在真实订阅方出现之前，这条链路的端到端价值**尚未被证明**。
