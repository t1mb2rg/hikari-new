# Hikari 第四阶段 P4-02 Resident Process Composition v1 实现

> **本轮只新增一个 CLI 命令。**
> `src/runtime/**` 改动数为 **0**，`src/desktop-session-awareness-loop/**` 改动数为 **0**，`src/cli/start.ts` / `src/cli/init.ts` / `src/cli/chronicle-init.ts` 改动数为 **0**。`test/cli.test.mjs` 改动数为 **0** 且**逐条通过**。

---

## 1. 生产缺口

P4-01 交付了一条**可以被驱动**的感知链路，但生产里没有任何东西驱动它。

`hikari start` 做的是：

```
加载 continuity → 加载 chronicle → 读状态 → 打印 → shutdown → 进程退出
```

它是**一次性的**。一分钟之后 Hikari 不存在，Loop 从未被装载过，`desktop-session-awareness-loop.assessed` 在真实运行里**一次都没有被发出**。P3-05 证明过四层能组合，P4-01 证明了 Loop 能安全地周期性驱动 Awareness —— 但这些结论此前**只在测试进程里成立**。

缺的不是能力，是**让进程继续存在的那一格**。

---

## 2. Resident 是什么，不是什么

| 是 | 不是 |
| --- | --- |
| **process composition** —— 决定加载哪些 Plugin | ❌ 不是 Plugin（没有 `PluginDefinition`，没有 id/version/requires） |
| **process lifetime owner** —— 决定进程何时结束 | ❌ 不是 Runtime mechanism（不改 `src/runtime/**` 一个字节） |
| **composition root** —— 决定 Runtime 何时创建 | ❌ 不是 Scheduler（没有 cron / RRULE / jitter / 优先级） |
| —— | ❌ 不是 Super Orchestrator（不排序、不调解、不重试） |

### 三国职责分离

| 主体 | 拥有 |
| --- | --- |
| **Resident** | Runtime 何时创建；加载哪些 Plugin；什么状态算 ready；什么时候请求整个 Runtime shutdown；process signal / exit code / operator-facing status |
| **Runtime** | Plugin 生命周期、dependency reconciliation、unload ordering、cleanup ordering |
| **Plugin** | 自己运行什么、自己拥有哪些资源 |

**Resident 一格都不越界**：它不调用卸载接口、不读 `context.events`、不碰任何领域 payload、不写 `process.platform`。它知道的关于 Hikari 的一切，都来自 Runtime 报回来的 state 和 Runtime 记录下来的 error。

`src/cli/resident.ts` 里**没有** `unloadPlugin`、`context.events`、`process.platform`、`DesktopSessionAwarenessAssessment` —— 由测试用例 17 扫描源码强制。

---

## 3. 组合

七个 Plugin，按加载顺序：

| # | id | config |
| --- | --- | --- |
| 1 | `continuity` | `{ rootDir: dataDir }` |
| 2 | `chronicle` | `{ rootDir: dataDir }` |
| 3 | `foreground.windows` | 无 |
| 4 | `input-activity.windows` | 无 |
| 5 | `desktop-session-world` | 无 |
| 6 | `desktop-session-awareness` | 无 |
| 7 | `desktop-session-awareness-loop` | `{ delayMs: desktopAwarenessDelayMs }` |

**顺序不是装饰。** `loadPlugin` 在返回前完成 reconcile，因此被加载时其需求**已经**被满足；不能满足的留在 `waiting`，不会被搬到别处去凑一个好看的顺序。读回来的 state 就是给操作者看的 state。

**恰好这七个，一个不多。** Resident 自己没有能力要提供，因此不加载任何属于自己的 Plugin。

### `foreground.windows` / `input-activity.windows` 的可获得性是宿主事实

这两个 Plugin 的 `setup` 在非 win32 宿主上**同步抛出**。Runtime 吸收该异常并把它们的 state 置为 `failed`，下游（world / awareness / loop）保持 `waiting`，于是 Resident 报**未就绪**并退出 1。

**这是正确的回答**，不是缺陷：Resident 不重试、不替换、不降级、不换一个"差不多"的组合。Hikari 在这台机器上要么完整地存在，要么明确地不存在。

---

## 4. 就绪语义

**就绪 = 组合里每一个成员都报 `active`。**

```
全部 active ──→ 打印「Hikari 常驻已启动。」──→ 等待终止请求
否则       ──→ 逐条打印 id + state + Runtime 记录的原因 ──→ 退出 1
```

**就绪不等于**：

- ❌ 首轮 assessment 已成功
- ❌ 后台链路健康
- ❌ 每一轮采集都会成功
- ❌ Awareness 的 baseline 已建立

就绪只声称**组合成立、Loop 已武装**。上述任何一条，v1 都**没有**公开可观测面（见 §11），因此这个谓词**不得**暗示它们。

**不新增** health Service / status Service / latest Service / failure Event。一个只能回答"当时那一瞬"的状态快照，会成为一条随后必须一直维护下去的契约。

### 组合为空也算未就绪

`loaded.length > 0 && every(active)`。空组合没有任何东西是就绪的，而 `every` 在空列表上会给出相反的答案。

---

## 5. 进程寿命 lease（本轮的关键修正）

### 5.1 为什么必须有

Node 进程在事件循环上**没有任何 handle** 时退出。而**待决的 Promise 不是 handle** —— 无论是 `await` 一个组合加载，还是 `await` 一个尚未 resolve 的终止 Promise，都**不**维持进程。

所以一个没有 lease 的 Resident，它的寿命完全取决于**某个领域 Plugin 恰好还开着什么**：一个 cadence timer、一个 PowerShell 子进程、一个 store handle。那会让进程寿命成为**插件行为的后果**，而不是这个组合根做出的决定。

### 5.2 正确的性质

> **Resident 必须拥有一个独立于领域 Plugin 的 process lifetime handle。**

**这条取代**边界复审时记录过的旧断言「Resident 不增加第二个 active handle」。旧断言是在把「唯一 handle」当作目标，而唯一 handle 属于**领域插件**；新性质要求的是 handle 属于 **Resident 自己**。两者不是程度差别，是归属差别。

### 5.3 机制：`MessagePort`

```ts
export function createLifetimeLease(): LifetimeLease {
  const channel = new MessageChannel();
  const lease = channel.port1;
  const peer = channel.port2;
  lease.ref();
  ...
}
```

选它，是因为它是**一个没有行为的 handle**：它不会触发、不会漂移、不会被误认为 cadence、不携带任何 Hikari 领域语义。`ref()` 让它维持进程（新建的 port 默认是 unref 的），`close()` 把进程还回去，对端 port 一并关闭，因此释放后不留下任何 port。

**显式排除的做法**：`while(true)`、`setInterval` keepalive、dummy timeout、busy loop、`stdin.resume()`。

### 5.4 判别力实验（真实运行，非预期）

同一份组合（成员全是立即 resolve 的替身）、同一个 runtime（不持有任何东西），**唯一变量是有没有 lease**。三个子进程，实测：

| 探针 | 观测 | 结论 |
| --- | --- | --- |
| **无 lease** | 报告就绪后**自行结束**，退出码 13 | Node 对未完成的顶层 await 报 13（`Unfinished Top-Level Await`）—— 它没有跑完，只是**没有继续跑下去的理由了** |
| **有 lease** | 报告就绪后 700 ms 仍然存活 | lease 确实在维持进程 |
| **有 lease + 自行请求终止** | 走完停机、打印已停止、**退出 0** | 释放之后进程**回得去** |

第三个探针的定时器在触发时就已经消耗掉了，因此它不可能是维持进程的东西；如果 lease 只是被遗忘而不是被释放，这个子进程会和第二个一样挂着。

三条合起来是一条完整的链：**lease 是寿命的来源，且释放是有效的。**

---

## 6. 信号语义

```
注册：进入时立即注册 SIGINT / SIGTERM

第一个信号：
  1. 同步摘掉监听器
  2. 置位请求标志
  3. settle 终止 Promise（只 settle 一次）

然后：await runtime.shutdown()   ← 不关 lease
之后：关闭 lease

第二个 Ctrl+C：监听器已经不在，走宿主默认行为
```

**为什么先摘监听器**：第二个 Ctrl+C 从那一刻起就**不属于 Hikari** 了。想立刻走人的操作者得到的是宿主的默认处理，而不是一个"再等等"。

**不做的事**：

- ❌ 不 `process.exit()` —— 硬杀是一条本文件**没有**的策略，发明它等于发明一种让 Runtime 的 cleanup 顺序半途而废的方式
- ❌ 不并发调用第二次 `shutdown()`
- ❌ 不自己实现 hard-kill policy

**启动期间收到终止**：这一次激活在报告就绪之前就被要求停止，因此它**不宣布已启动**，直接进入停机。用例 6 覆盖。

---

## 7. 清理顺序（所有路径 finally 安全）

**唯一的顺序规则**：

```
runtime.shutdown()  →  signals.disarm()  →  lease.release()
```

**lease 最后释放是整套安排的要点**：Resident 在整个停机期间都拥有进程寿命，因此销毁过程永远不会被一个提前消失的进程打断。

覆盖的路径：

| 路径 | 行为 | 用例 |
| --- | --- | --- |
| **A** 正常就绪 → 收到终止 | 停机 → 退出 0 | 1、2、7 |
| **B** 组合未全部就绪 | 报告 → 停机 → 退出 1 | 3、4 |
| **C** 加载期间抛错 | 报告 → 停机 → 退出 1 | 5 |
| **D** `shutdown()` reject | 报告 → **仍然释放 lease** → 退出 1 | 8 |

**D 的构造说明**：真实 `Runtime.shutdown()` 实际上**不会** reject —— `#deactivate` 捕获 `scope.dispose()` 的错误、写进 `record.error`、把 state 置为 `failed`，并且**不重新抛出**。因此 D 只能通过注入一个会 reject 的 Runtime 替身来覆盖。这是一条**测试缝**，不是对 Runtime 行为的描述。

失败既报错也放行：一次失败的清理是**报告的理由**，不是把进程扣为人质的理由。

---

## 8. CLI 边界：不复制领域规则

`delayMs` 的领域合法性**唯一真源**仍然是 `desktop-session-awareness-loop config.parse`。CLI 只回答一个**词法**问题：这个 token 是不是一个数字？

**不复制**：`> 0`、`<= 2147483647`、`positive integer`、`Number.isInteger`。

因此 `0`、`-1`、`1.5`、`2147483648`、`9007199254740991` 全部**原样穿过 CLI**，由 Loop 给出拒绝理由（退出码 **1**）。若 CLI 自行判定，它们会变成**用法错误**（退出码 **2**）—— 那意味着 CLI 有了自己的意见。

**没有默认值。** Resident cadence 没有默认值：一个有默认 cadence 的常驻进程等于替 Hikari 决定「多久看一次桌面」。

**`start` 的参数面没有被拓宽。** `hikari start --desktop-awareness-delay-ms 1000` 仍然是 `未知参数` + 退出码 2（用例 16），因为读写器按命令决定是否认识这个 token，而不是按全局开关。

### 精度：有意不管

一个无法被 double 精确表示的字面量会在这里四舍五入。但所有这样的值都远远超过 Loop 的上限，因此它们会因为一个**操作者能据以行动**的理由被拒绝，而不是因为一个**在这里发明出来的**理由。

---

## 9. P4-01.1 的 timer 上界已修

P4-01.1 修掉的是一条**配置契约的正确性缺陷**：`delayMs` 曾接受任意正整数，而 Node 的 `setTimeout` 会把大于 `2^31 - 1` 的延迟**静默改写成 1 ms**，于是 Loop 可以接受一个它无法忠实执行的 cadence。

现在上界是 `2_147_483_647`，写在 Loop 自己的 `config.parse` 里，越界一律拒绝，不 clamp、不截断、不静默修复。

**本轮从 CLI 侧补上了这条链的另一半**：`2147483647` 穿过 `parseCommandLine` 之后必须**仍然是** `2147483647`（用例 13），而 `2147483648` 必须以 **Loop 的句子**被拒绝（用例 15）。上界仍然只由 Loop 声明 —— CLI 侧扫源码断言 `2147483647` / `2_147_483_647` / `Number.isInteger` 在 `resident.ts` 中**不出现**（用例 18）。

---

## 10. Chronicle 边界

Resident 对 Chronicle 的**全部**关系是：`loadPlugin`，并要求它 `active` 才就绪。

- ❌ 不 append
- ❌ 不读内部 store
- ❌ 不自动记录 assessed Event
- ❌ 不把观察到的 assessment 变成 fact

一个没有持久事实史的常驻 Hikari 不是能记住任何东西的 Hikari，所以 Chronicle 的 `active` 是就绪前提。**这就是全部关系。**

> **Event ≠ Durable Fact。** 把 Event 自动落成 fact 的等价关系不在本轮发明，`resident.ts` 也不是发明它的地方。

### `assessed@1` 继续是 0 subscriber

Resident **不订阅任何 Event**。`desktop-session-awareness-loop.assessed` 在生产里仍然是 **0 subscriber**，这是设计的性质，不是本文件该去填的缺口。

---

## 11. 已知限制

1. **后台失败仍然不可观测。** 这条限制**从 P4-01 原样继承，本轮没有改善**：Loop 的 `catch` 是空的，一次采集失败除了「循环没有停」之外不留任何痕迹。Resident **没有**为此新增可观测面 —— 就绪只报告**启动那一刻**的组合状态，此后任何一轮采集失败，操作者在终端上**什么都看不到**。这是有意的取舍（见 §4），不是遗漏。

2. **shutdown 没有严格上界。** 继承 P4-01 §9 的同一条声明：in-flight 采集受 `execFile` 的 10 s 约束，但 `Foreground` / `InputActivity` 的 `terminate()` 的**有界性债务**（P3-01 / P3-02 遗留）本轮不得修改，因此**不能**据此声称 shutdown 有 10 s 硬上界。这里只声称「cleanup 会等 in-flight cycle settle」，不声称它多快 settle。

3. **Windows 无法从外部投递优雅终止。** Node 在 Windows 上不把进程间信号当作 POSIX 信号投递，`child.kill()` 一律是终止进程。因此：
   - 真实 `SIGTERM` 用例（用例 10）**在本机 win32 上被跳过**，**未在本机执行过**；
   - 生产 CLI 冒烟（用例 12）只能靠 `kill()` 收场，走不到优雅停机；
   - 优雅停机在本机的证据来自**同进程内**的用例 9、11，它们走的是**同一段**信号处理代码路径（`process.emit` 触发的是同一批监听器）。
   
   **如实记录证据等级**：Windows 上「真实跨进程信号」这一格，本轮**没有**直接证据。

4. **就绪不是健康证明。** 见 §4。

5. **一次 `current()` 会拉起 2 个 PowerShell 子进程**（P4-01 §18 限制 5，本轮未改变）。Resident 让这件事**持续**发生，但本轮没有做任何采集成本优化。

---

## 12. 明确没有实现

- ❌ daemon 化 / Windows Service 安装 / systemd unit
- ❌ 自动重启 / 崩溃恢复 / 看门狗
- ❌ `hikari status` / `hikari stop` / 任何控制通道
- ❌ 日志文件 / 日志轮转 / 结构化日志
- ❌ 退出码策略表（除 0 / 1 / 2 外）
- ❌ 配置文件 / 环境变量配置
- ❌ 任何 Salience / Importance / 解读 / 判断
- ❌ 任何新的 Event consumer
- ❌ 任何 P4-03 的内容

**本文件不规划 P4-03。** 下一阶段的范围与取舍不在本轮决定。

---

## 13. 当前文件

| 文件 | 状态 | 内容 |
| --- | --- | --- |
| `src/cli/resident.ts` | **新增** | `LifetimeLease` / `createLifetimeLease` / `CompositionMember` / `productionComposition` / `residentCommand` / `armTerminationSignals` |
| `src/cli/options.ts` | 修改 | `ResidentOptions`、`ParsedCommandLine` 联合、`resident` 读写器、`USAGE` |
| `src/cli/main.ts` | 修改 | 按 `ParsedCommandLine` 分派 |
| `test/resident-cli.test.mjs` | **新增** | 19 条用例 |
| `docs/development/phase-4-resident.md` | **新增** | 本文件 |

**零修改**：`src/runtime/**`、`src/index.ts`、`src/desktop-session-awareness-loop/**`、`src/desktop-session-awareness/**`、`src/desktop-session-world/**`、`src/foreground/**`、`src/input-activity/**`、`src/continuity/**`、`src/chronicle/**`、`src/cli/start.ts`、`src/cli/init.ts`、`src/cli/chronicle-init.ts`、`test/cli.test.mjs`、`package.json`、`tsconfig.json`。

**未创建 `src/resident/`。** Resident 是一个 CLI 命令的组合根，不是一个子系统。

---

## 14. 当前测试

`test/resident-cli.test.mjs` — **19 条**：

| # | 测试名 | 承重断言 |
| --- | --- | --- |
| 1 | `resident 加载组合、报告就绪，并一直等到终止请求` | 就绪行 + lease 持有 + shutdown 恰好一次 |
| 2 | `就绪不是对后台链路健康的断言…` | 恰好七个成员、顺序一致、无额外成员 |
| 3 | `组合未全部 active 时拒绝启动，并逐条报告状态与原因` | 七条状态全报 + 原因来自 Runtime + 不宣布就绪 |
| 4 | `未初始化时的失败仍然给出下一步该做什么` | `NotInitializedError` → `INIT_HINT`，且不误报另一条提示 |
| 5 | `组合加载期间抛错时报告失败，并且仍然完成清理` | 路径 C |
| 6 | `终止请求发生在启动期间时，这一次启动不再宣布已就绪` | 启动期间终止不挂起、不误报 |
| 7 | `第一个终止请求之后，resident 就退出信号通道，shutdown 只发生一次` | 同步摘监听器 + 停机期间 lease 仍持有 + 计数复原 |
| 8 | `shutdown 失败时报告失败，但 lease 仍然被释放` | 路径 D |
| 9 | `常驻进程的寿命来自它自己的 lease，而不是任何领域插件` | **§5.4 三个探针** |
| 10 | `真实 SIGTERM 让常驻停止并让进程干净退出` | 真实跨进程信号（**win32 跳过**） |
| 11 | `resident 以真实生产组合在这台机器上就绪，并优雅停机` | 七个**真实** Plugin → active → 优雅停机 |
| 12 | `hikari resident 从 argv 走到生产组合，并在真实调用下保持存活` | argv → 分派 → 生产装配，端到端 |
| 13 | `CLI 原样传递 cadence，从不 clamp、四舍五入或自行判定合法性` | 上限/零/负数/小数原样穿过 |
| 14 | `hikari resident 用用法错误回答缺失或非数字的 cadence` | 词法层才是 CLI 的判断范围 |
| 15 | `CLI 不复制领域规则：非法 cadence 由 Loop 拒绝，而不是被当作用法错误` | 五种非法值 → 退出 1 + Loop 的句子 |
| 16 | `hikari start 的参数面没有被 resident 拓宽` | 一次性命令的参数面不变 |
| 17 | `resident 不承担 Runtime 的职责，也不触碰领域事件` | 源码扫描四个禁用 token |
| 18 | `resident 没有把 Loop 的 cadence 边界抄进 CLI` | 源码扫描三个领域规则字面量 |
| 19 | `resident 不是一个新的平台抽象` | 全 `src/` 扫描九个禁用抽象（**词边界**） |

### 测试纪律

- **用例 19 必须用词边界匹配。** `desktopSessionAwarenessLoopPlugin` 是既有标识符，裸子串扫描会把 `LoopPlugin` 误判为命中。
- **不依赖「睡一会儿然后希望时序成立」**：正向等待一律用带 deadline 的条件等待 `until()`，进程存活性的否定断言（用例 9 的 700 ms 窗口）是**唯一**必须真实等待的地方 —— 「没有退出」无法靠事件循环轮次观察。等待用 `node:timers/promises`。
- **不让探针脚本落进仓库**：子进程脚本一律经 `--input-type=module -e` 注入。
- **不修改旧测试来适配新语义。** `test/cli.test.mjs` 25 条**逐条未改**通过。

---

## 15. 真实运行结果

```
$ npm test
ℹ tests 222
ℹ pass 221
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 5212.9836

$ node --test test/resident-cli.test.mjs     （单跑，需先 build）
✔ resident 加载组合、报告就绪，并一直等到终止请求 (4.6831ms)
✔ 就绪不是对后台链路健康的断言：一个只能报告状态的组合也足以宣布启动 (0.9672ms)
✔ 组合未全部 active 时拒绝启动，并逐条报告状态与原因 (0.5428ms)
✔ 未初始化时的失败仍然给出下一步该做什么 (0.3909ms)
✔ 组合加载期间抛错时报告失败，并且仍然完成清理 (0.4357ms)
✔ 终止请求发生在启动期间时，这一次启动不再宣布已就绪 (0.2697ms)
✔ 第一个终止请求之后，resident 就退出信号通道，shutdown 只发生一次 (1.5954ms)
✔ shutdown 失败时报告失败，但 lease 仍然被释放 (0.4709ms)
✔ 常驻进程的寿命来自它自己的 lease，而不是任何领域插件 (1441.5234ms)
﹣ 真实 SIGTERM 让常驻停止并让进程干净退出 (0.1619ms) # Windows 不投递 POSIX 信号
✔ resident 以真实生产组合在这台机器上就绪，并优雅停机 (613.081ms)
✔ hikari resident 从 argv 走到生产组合，并在真实调用下保持存活 (1800.005ms)
✔ CLI 原样传递 cadence，从不 clamp、四舍五入或自行判定合法性 (0.7615ms)
✔ hikari resident 用用法错误回答缺失或非数字的 cadence (195.870ms)
✔ CLI 不复制领域规则：非法 cadence 由 Loop 拒绝，而不是被当作用法错误 (638.474ms)
✔ hikari start 的参数面没有被 resident 拓宽 (84.5895ms)
✔ resident 不承担 Runtime 的职责，也不触碰领域事件 (0.4331ms)
✔ resident 没有把 Loop 的 cadence 边界抄进 CLI (0.2838ms)
✔ resident 不是一个新的平台抽象 (6.008ms)
ℹ tests 19  pass 18  fail 0  skipped 1
```

### 计数口径

| 环境 | 结果 | 来源 |
| --- | --- | --- |
| 本机 Windows 11 | **222 tests / 221 pass / 0 fail / 1 skipped** | **实际跑过** |
| CI | 未运行 | 本轮**未 push** |

222 = 203（P4-01.1 基线）+ 19（本轮）。唯一的 skip 是用例 10，原因是本机是 win32（§11 限制 3）。

**不写耗时常量**：绝对数值跨轮次不稳定，按 P3-03 §13 纪律，只用同一轮同机相对关系下结论。

---

## 16. 一条必须与本阶段结论同时出现的上限声明

> **P4-02 交付的是「进程持续存在」，不是「Hikari 在感知」。**
>
> 本轮真正新增的，是**让那七个 Plugin 在一个真实进程里一起活着、并且在被要求停止时按 Runtime 的顺序干净退出的组合根**。它**一格感知能力都没有新增**：没有 Salience、没有 Importance、没有解读、没有判断、没有记忆。
>
> 更准确地说：**P4-02 让 P4-01 交付的链路第一次在生产进程里被真正驱动起来 —— 但被驱动不等于被消费，跑起来不等于有意义。**
>
> 三条必须同时记住的限制：
>
> 1. **就绪只描述启动那一刻的组合状态**，不描述此后任何一轮采集是否成功；
> 2. **后台失败在终端上不可见**（§11 限制 1）；
> 3. **`desktop-session-awareness-loop.assessed@1` 在生产里仍然是 0 subscriber** —— 本轮交付的仍然是一条**可以被订阅**的链路，不是一条**已被消费**的链路。
