# Hikari 第三阶段 P3-05 Phase 3 纵切验收 实现

> **本阶段不新增任何生产代码。**
> 唯一的新增物是一个测试文件与两份文档。`src/**`、`package.json`、`tsconfig.json` 的改动数均为 0。

---

## 1. 阶段目标

P3-01 ~ P3-04 各自证明了一条最小线，但**各自只在自己那一层内被证明**。P3-05 要证明的不是第五条线，而是**这四条线接起来之后仍然成立**：

```
Foreground Perception  ┐
                       ├→  Desktop Session World  →  Desktop Session Awareness
Input Activity Perception ┘
```

要回答的四个问题，都是既有测试**在结构上无法回答**的：

| # | 问题 | 为什么既有测试答不了 |
| --- | --- | --- |
| 1 | World 生产出来的 facet，是否正是 Awareness 比较器消费的形状？ | P3-04 的测试**手工构造** facet；P3-03 的测试止步于 World，**下游没有消费者** |
| 2 | 整条链能否只经公开契约组合，而不要求修改任何已冻结模块？ | 各层自己的测试都用替身隔离了另一层 |
| 3 | 这条链唯一的跨调用状态（baseline），是否严格活在一次 Runtime 生命周期内？ | P3-04 只在**单个** Runtime 内验证过 reset |
| 4 | 能力不存在的平台上，整条链是否诚实降级，而不是伪装出判断能力？ | 既有平台用例只观察到**第一层**（感知 failed），看不到传播 |

### 与 P2-04 的关系：同一枚硬币的两面

| | P2-04 | P3-05 |
| --- | --- | --- |
| 命题 | 该记住的东西**还在** | 本次运行时的感知状态**不被错误地带过去** |
| 方向 | 持久性必须成立 | 瞬时性必须成立 |
| 失败形态 | 恢复不出来 | 恢复出不该有的东西 |
| 状态载体 | Chronicle / Origin（盘上） | baseline（闭包内） |
| 断言方向 | B 必须恢复出 A 写的东西 | B 必须**恢复不出** A 留下的东西 |

两者共用同一套 cross-Runtime 骨架（两个 `new Runtime()`、同一进程、实例不等断言），但**断言方向相反**。

### 命名

- 阶段名：`Phase 3 Vertical Slice Acceptance`
- 测试文件：`test/phase-3-vertical-slice.test.mjs`
- 不新增生产标识符

---

## 2. 两类链（必须区分，不得互相代称）

本文件与测试文件里出现两条**不同**的链。混用会导致对证据强度的错误陈述。

### 2.1 确定性链（前六条用例）

```
test-only perception Service providers
  → production DesktopSessionWorld
  → production DesktopSessionAwareness
  → real Runtime
```

- 被替换的是**两个感知 Plugin 本身**（`test.vertical-slice-foreground` / `test.vertical-slice-input-activity`），它们在测试里是普通的 `PluginDefinition`。
- **World 与 Awareness 是生产实现**，经公开 barrel 导入。
- **不使用** `production foregroundPlugin` / `production inputActivityPlugin`。

### 2.2 真实生产链（最后一条用例，win32 only）

```
production foregroundPlugin
  → production inputActivityPlugin
  → production DesktopSessionWorld
  → production DesktopSessionAwareness
  → real Runtime
```

- **四个 Plugin 全部是生产实现**，读数来自真实桌面。
- 这是唯一一条"四层都真"的证据。

### 2.3 不得使用的表述

> ❌ 不准确：「确定性链是四个真实 production Plugin，只替换 acquisition」

正确说法：**确定性链替换了两个感知 Plugin**（不是"替换 acquisition 但插件仍是生产实现"）。真实感知插件的覆盖由 2.2 的 smoke 独立承担。

`dist/foreground/plugin.js` 导出的 `createForegroundPlugin(createAcquirer)` 确实允许只替换 acquisition，且**本轮刻意不使用**：它是深路径内部 import，已被 P3-01/P3-02 冻结为**每模块恰好一处**（现值 `test/foreground.test.mjs:20`、`test/input-activity.test.mjs:25` 各一）。再引入一处会扩大对一个被显式收窄的缝的依赖，且不会带来任何 2.2 之外的证据。

---

## 3. P3-05 相对 P3-04 的新增证据

**P3-04 已经证明**（`test/desktop-session-awareness.test.mjs:609`，测试名
`the production world and awareness plugins compose under the real runtime`）：

> test-only foreground provider + test-only input-activity provider
> → production World → production Awareness → `baseline` / `comparison`

因此 **P3-05 不主张「World 与 Awareness 能组合」这一发现**。P3-05 的新增证据是：

1. **cross-Runtime transient-state isolation** —— 两个**同时存活**的 Runtime 不共享 awareness baseline
2. **baseline 不跨 Runtime 生命周期** —— 前一个 Runtime 结束后，全新 Runtime 仍从 baseline 开始
3. **full production Windows vertical smoke** —— 四个生产 Plugin 端到端真跑
4. **non-Windows two-level dependency convergence** —— 失败沿 `requires` 图传播**两层**
5. **end-to-end reference preservation across the World/Awareness seam** —— observation 引用从 provider 穿过两个生产层到达 assessment
6. **pull-only and shutdown behavior of the whole vertical slice** —— 整条链在无人调用时零采集

第 4 条与第 1、2 条尤其重要：它们各自对应既有测试集合里**没有任何断言**的性质。

---

## 4. 当前文件

| 文件 | 性质 |
| --- | --- |
| `test/phase-3-vertical-slice.test.mjs` | 新增，8 条用例 |
| `docs/development/phase-3-vertical-slice.md` | 新增，本文件 |
| `docs/architecture/phase-3-final-architecture-review.md` | 新增 |

**未修改**：`src/**`（0）、`test/**` 既有文件（0）、`package.json`（0）、`tsconfig.json`（0）。

两项承重前提已直接核实，不是推断：

```
package.json  →  "test": "npm run build && node --test test/*.test.mjs"   ← 通配，新文件自动被拾取
tsconfig.json →  "include": ["src/**/*.ts"]                              ← .mjs 不参与编译
```

`npm test` 先 `npm run build`，`dist/` 必然新鲜。

---

## 5. 确定性纵切

### 5.1 端到端引用保持（D1）

这是本用例的**承重点**，也是 P3-04 T22 没有覆盖的部分。

| 断言 | 意义 |
| --- | --- |
| `comparison.previous === baseline.current` | 跨真实 World 的快照引用恒等 |
| `comparison.current !== baseline.current` | 第二次是新的快照 |
| `comparison.current.snapshotAt` 匹配 UTC 毫秒格式且 `!== OBSERVED_AT` | `current` 是 **World 重新打戳**的产物，不是 provider 的对象 |
| `comparison.previous.foreground.observation === firstForeground` | 感知交出的 observation **穿过两个生产层仍是同一个对象** |
| `comparison.current.foreground.observation === secondForeground` | 同上，第二次 |
| `comparison.previous.inputActivity.observation === steadyInput` | 同上，输入侧 |
| `comparison.foreground === 'changed'` | 前景侧变了 |
| `comparison.inputActivity === 'unchanged'` | **没变的那一侧必须被报成 unchanged** |
| `comparison.change === 'changed'` | 整体 |

**为什么 `inputActivity === 'unchanged'` 是关键**：T22 的输入 tick 从 5000 → 5001，两侧都 `changed`。若只断言 `change === 'changed'`，一个"只要有输入就算 changed"的实现也会绿 —— 判定代数就退化成了"读过两次"。把 tick 钉住不动，才能证明**非对称判定**跨真实模块边界成立。

### 5.2 组合接缝上的单格（D2）

只取 P3-03 partial availability 矩阵中的**一格**，且刻意不展开全矩阵：

```
感知 current() reject
  → production World 产出 { kind: 'unavailable' }        （断言 deepEqual 精确形状）
  → production Awareness 判为 'indeterminate'            （断言）
  → inputActivity 侧仍 'unchanged'
  → change === 'indeterminate'                          （"相同必须全部可比"）
```

这是 World 的失败 facet 形状与 Awareness 的不可判分支之间的**唯一致命接缝**：P3-03 证明前者产出正确，P3-04 证明后者消费正确，**没人证明两者指的是同一个形状**。

### 5.3 Pull-only（D3）

| 步骤 | 断言 |
| --- | --- |
| 加载整条链 | World / Awareness 均 `active` |
| 推进两个 `nextTurn()`（`setImmediate` 事件循环轮次） | 两个感知计数**均为 0** |
| 调用一次 `current()` | `kind === 'baseline'`；两个计数**各为 1** |
| `shutdown()` | 计数**不再增加**；Awareness `undefined` |

**双重判别**：计数断言抓"急切采样"；`kind === 'baseline'` 抓"即使采样了也要诚实"。若 Awareness 在 `setup` 时抢先读一次 World，第一次用户调用会变成 `comparison` —— 而这正是 baseline 语义（"这是第一次"）所禁止的。

不使用任何耗时阈值；等待一律用 `setImmediate`。

---

## 6. 跨 Runtime 瞬时状态隔离

### 6.1 两个 Runtime **同时存活**（E1）

```
Runtime A: 假感知A → 真World → 真Awareness   A.current() ×2 → baseline, comparison(changed)
（A 未 shutdown）
Runtime B: 假感知B → 真World → 真Awareness   B.current() ×1 → 必须是 baseline
```

断言：

- `runtimeA !== runtimeB`
- `worldServiceA !== worldServiceB`
- `awarenessServiceA !== awarenessServiceB`
- **B 第一次 `kind === 'baseline'`**
- A 第三次 `kind === 'comparison'` 且 `previous === A 第二次的 current`（A 的序列未被 B 干扰）

**为什么必须并发存活而不是先后 shutdown**：`shutdown()` 会走 `#deactivateTree` 与 `#plugins.delete`。一个存在模块级共享状态的实现，在"先后"形态下可能因为前者已被清理而**侥幸通过**。两个链**同时活在同一个进程里**，任何模块级 binding 都会当场暴露。

### 6.2 全新 Runtime（E2）

A 用完 → `shutdown()` → 全新 Runtime B → 第一次调用必须 `baseline`。

额外断言：B 的输入与 A **完全不同**（不同的 title、不同的 tick）。若基线曾以任何形式存活，B 的第一次调用不仅会是 `comparison`，还会是 `changed`。

同时对**「无 Chronicle / disk / global 参与恢复」**做可观测的断言：

```js
await runtime.loadPlugin({ requires: [continuityService, chronicleService], ... });
assert.equal(runtime.getPluginState(DURABLE_OBSERVER), 'waiting');
assert.equal(durable.continuity, undefined);
assert.equal(durable.chronicle, undefined);
```

即：**该链不提供任何一个持久化能力**，因此链内没有任何消费者能取到可跨 Runtime 携带状态的机制。这是"参与面的缺席"，是**可观测的事实**，不是推断。

### 6.3 强度边界（如实记录）

E1 + E2 证明的是：**两个同时存活的链之间没有可观测的状态共享**。

它们**不**证明"不存在任何全局状态"。按 P2-04 已确立的纪律，结论应表述为「**未发现**泄漏」，而非「**已证明不存在**」泄漏。

### 6.4 Shutdown（E3）

| 断言 | 依据 |
| --- | --- |
| 四个 Plugin 的 `getPluginState()` 均为 `undefined` | `unloadPlugin` → `#plugins.delete` |
| 新消费者 `requires: [desktopSessionAwarenessService]` → `waiting`，`service === undefined` | 能力不再被 provide |
| **不断言**被捕获的旧 service 对象失效 | 它**不会**失效（见下） |

### 6.5 一条必须写下来的否定断言

被捕获的 awareness service 对象，即使 `shutdown()` 完成，**仍然可调用并仍会返回结果** —— 它闭包持有的正是那个已被卸载的 `previous`。这与 P3-04 测试 16 记录的 `assert.notEqual(observed.service, beforeDeactivation)` 同源。

因此测试断言的是：

```js
assert.equal(typeof detached.current, 'function');   // 明示它没有被断言为"已死"
```

**shutdown 结束的是它经由 Runtime 的可达性，不是这个对象的生命周期。** 断言更多就是一条会被后来者信任的假断言。

---

## 7. 平台收敛（G1）

设计为**一条跨平台用例**，两种平台都运行：

```js
const onWindows = process.platform === 'win32';
```

| 平台 | 期望四元组 |
| --- | --- |
| win32 | `foreground: active` / `inputActivity: active` / `world: active` / `awareness: active` |
| 非 win32 | `foreground: failed` / `inputActivity: failed` / `world: waiting` / `awareness: waiting` |

非 win32 分支额外断言：

- `getPluginError('foreground.windows') instanceof ForegroundError`
- `getPluginError('input-activity.windows') instanceof InputActivityError`

即降级是**具名领域失败**，不是泛型崩溃。

**机制**（已由源码逐行确认）：

```
setup() → createWindowsAcquirer() → process.platform !== 'win32' → throw ForegroundError
       → Runtime #activate 内 try/catch → #failActivation → state = 'failed'
       → World/Awareness 的 requires 不满足 → 停在 'waiting'
       → Runtime 不崩
```

两平台都额外断言 **Runtime 仍健康**：随后加载一个无关 Plugin → `active`。

全程**不调用 `current()`**，故 win32 上开销为 0，可安全进 CI。

**相对既有测试的新意**：`test/foreground.test.mjs:301` 已有同型的三目平台断言，但它只观察到**第一层**（感知 failed）。G1 把断言对象提升到**四插件链**，证明失败会沿 `requires` 图**正确传播两层**。

---

## 8. 真实 Windows 生产 smoke（F1）

```
{ skip: onWindows ? false : 'requires a win32 host' }
```

沿用仓库既有 idiom（`false` 而非 `undefined`，判定在模块顶层只做一次）。

| 步骤 | 断言 |
| --- | --- |
| 加载四个生产 Plugin | 四个 id 均 `active` |
| 第一次 `current()` | `kind === 'baseline'`；`snapshotAt` 匹配 UTC 毫秒 |
| facet 形状 | `kind ∈ {available, unavailable}` |
| available 的观测 | `source` 为对应感知名；`observedAt` 匹配 UTC 毫秒且可往返 |
| 前景 present 的键 | ⊆ `{kind, processName, title}`；`processName` 为 string；`title` 若在则 `null` 或 string |
| 输入 tick | 整数 ∈ `[0, 4294967295]` |
| 第二次 `current()` | `kind === 'comparison'`；`previous === baseline.current` |
| 枚举合法性 | 两个 facet ∈ `{changed, unchanged, indeterminate}`；`change ∈ {changed, stable, indeterminate}` |
| 冻结 | assessment / current / previous 均 `Object.isFrozen` |
| `shutdown()` | 四个 id 均 `undefined` |

### 明确**不**断言

- ❌ `change` 是 `'changed'` 还是 `'stable'` —— 活桌面上人可能在也可能不在操作
- ❌ 具体 `title` / `processName`
- ❌ tick 的推进方向
- ❌ 任何耗时阈值

这是**唯一**一条四层全为生产实现的证据。CI 为 ubuntu，因此它在 CI 上永远 skip —— **真实 happy path 不进 CI** 是结构性缺口，与既有的 5 条平台跳过同源。

---

## 9. 公开 API 与依赖

本阶段**不新增任何生产 API**。测试文件只使用公开 barrel：

| 导入 | 来源 |
| --- | --- |
| `Runtime` | `dist/index.js` |
| `foregroundPlugin` / `ForegroundError` / `ForegroundObservationError` / `foregroundService` | `dist/foreground/index.js` |
| `inputActivityPlugin` / `InputActivityError` / `inputActivityService` | `dist/input-activity/index.js` |
| `desktopSessionWorldPlugin` / `desktopSessionWorldService` | `dist/desktop-session-world/index.js` |
| `desktopSessionAwarenessPlugin` / `desktopSessionAwarenessService` | `dist/desktop-session-awareness/index.js` |
| `continuityService` | `dist/continuity/index.js` |
| `chronicleService` | `dist/chronicle/index.js` |

**零深路径内部 import** —— P3-01/P3-02 冻结的"每模块恰好一处"计数保持为 1。

---

## 10. 当前测试

`test/phase-3-vertical-slice.test.mjs` — 8 条：

| # | 测试名 | 承重断言 |
| --- | --- | --- |
| 1 | `the production world and awareness carry an observation end to end without rebuilding it` | 引用恒等 + 非对称判定 |
| 2 | `a facet the production world could not fill reaches awareness as indeterminate` | 组合接缝形状一致 |
| 3 | `the whole slice acquires nothing until it is asked, and its first answer is a baseline` | 零急切采集 |
| 4 | `two simultaneously live runtimes never share an awareness baseline` | 瞬时隔离（强） |
| 5 | `a runtime that starts after the previous one is gone opens on a baseline again` | 瞬时隔离（字面）+ 无持久化参与者 |
| 6 | `shutdown retires the slice so no consumer can reach it any more` | 可达性 |
| 7 | `the four production plugins converge to the states this host actually supports` | 两层传播的诚实降级 |
| 8 | `the four production plugins observe a real desktop end to end` | 真实四层端到端（win32 only） |

### 计数口径

| 环境 | 结果 | 来源 |
| --- | --- | --- |
| 本机 Windows 11 | **184 tests / 184 pass / 0 fail / 0 skipped** | **实际跑过** |
| CI（ubuntu-latest） | 预计 **184 / 179 pass / 5 skipped / 0 fail** | **预期值** |

**预期值说明**：本轮**未 push**，CI 尚未实际跑过。184 = 176（P3-04 基线）+ 8（本阶段）；CI 的 5 条跳过全部来自 P3-01/P3-02 的感知平台 smoke，与本阶段无关。**该组数字不得当作已确认值引用。**

---

## 11. 判别力探针

一次性、**不进入仓库**。变异只施加在**编译产物 `dist/`**（已 gitignore），每次变异后 `npm run build` 重建恢复。

按 P3-04 §21.4 的教训，探针脚本**先剥 ANSI 再匹配**，并交叉打印 pass 计数（P3-04 第一版探针用行首 `✖` 锚点，而 `✖` 前带色码，导致三次变异全报 MISSED 且零失败）。

| 变异 | 改动 | 结果 |
| --- | --- | --- |
| 基线 | — | `pass=8 fail=0` |
| **M1** | 生产 World 的 facet 构造改为 `structuredClone(observation)` | **`pass=7 fail=1` — CAUGHT**（用例 1） |
| **M2** | Awareness 的 `let previous` 提升到模块作用域 | **`pass=2 fail=6` — CAUGHT**（用例 2/3/4/5/6/8） |
| **M3** | Awareness 在 `setup` 中急切调用一次 `world.current()` | **`pass=1 fail=7` — CAUGHT**（全部 7 条非 skip） |
| 恢复 | `npm run build` | `pass=8 fail=0` — OK |

三条变异**各自至少让一条用例变红**，且失败集合与设计预期一致：

- **M1** 只打红用例 1 —— 与设计一致：引用保持是本文件**唯一**在断言 clone 的用例。
- **M2** 打红 6 条，其中用例 4（两 Runtime 并发）与用例 5（全新 Runtime）正是**为它而存在**的。P3-04 也做过同型变异（M3，`let previous` 上提），但它打红的是 **9 条 P3-04 用例**，全部在**单个 Runtime 内**；P3-05 打红的是**跨 Runtime** 的性质 —— 两者不等价。
- **M3** 打红 7 条 —— 急切采样会污染每一条依赖 baseline 语义的用例。

**证据等级如实记录**：探针是**会话内一次性**的，不在仓库内、不进 CI、不可复现。它证明"当时确实验过"，**不证明"以后不会被改坏"**。这是 P3-01 ~ P3-04 累计的已知弱点，P3-05 未改变它。

---

## 12. 真实运行结果

本轮**实际运行**（非预期）：

```
$ npx tsc -p tsconfig.json --noEmit
exit 0

$ npm test
ℹ tests 184
ℹ pass 184
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 4043.2449

$ node --test test/phase-3-vertical-slice.test.mjs     （单跑）
✔ the production world and awareness carry an observation end to end without rebuilding it (3.1118ms)
✔ a facet the production world could not fill reaches awareness as indeterminate (1.1745ms)
✔ the whole slice acquires nothing until it is asked, and its first answer is a baseline (2.5953ms)
✔ two simultaneously live runtimes never share an awareness baseline (0.6086ms)
✔ a runtime that starts after the previous one is gone opens on a baseline again (0.7964ms)
✔ shutdown retires the slice so no consumer can reach it any more (0.4698ms)
✔ the four production plugins converge to the states this host actually supports (0.4197ms)
✔ the four production plugins observe a real desktop end to end (846.1701ms)
ℹ tests 8  pass 8  fail 0  skipped 0
```

Windows smoke 实际 **846 ms**（两次 awareness 调用 = 两次 World acquisition = 4 次 PowerShell 子进程）。

**不写耗时常量**：绝对数值跨轮次不稳定，按 P3-03 §13 纪律，只用同一轮同机相对关系下结论。

---

## 13. 本阶段明确没有实现

- ❌ **Awareness 的完整实现** —— 见 §14
- ❌ 任何 salience / importance / notify / remember / act
- ❌ 任何新的 interpretation、语义解读、跨 source 推断
- ❌ 通用 Perception 框架 / Comparison 框架 / World 管理器
- ❌ PowerShell 采集成本优化
- ❌ 非 Windows 实现

---

## 14. 已知限制

1. **真实 happy path 不进 CI** —— F1 只在 win32 跑，CI 是 ubuntu。G1 在 CI 上只覆盖降级半边。这是结构性缺口，不试图用替身弥补（那会违反"真实生产 Plugin"要求），也不假装已覆盖。
2. **隔离证据的强度上界** —— E1/E2 证明"两个同时存活的链之间无可观测共享"，**不证明**"不存在任何全局状态"。结论写作「未发现泄漏」。
3. **被捕获的旧 service 对象不会失效** —— shutdown 只结束其经由 Runtime 的可达性（§6.5）。
4. **F1 不断言桌面状态** —— `change` 是 `changed` 还是 `stable`、标题是什么、tick 往哪走，都取决于此刻这台机器上的人在做什么。
5. **`absent` 前景在活桌面不可触发**（P3-01 已知限制 2）—— F1 同时接受 present 与合法 absent。
6. **探针一次性、不可复现**（§11）。
7. **CI 计数为预期值**（§10）—— 本轮未 push。

---

## 15. 一条必须与本阶段结论同时出现的上限声明

> **P3-05 证明的是三层的「组合性质」，不是 Awareness 层的完成度。**
>
> 按 `principles.md` §14 的冻结定义，Awareness 是「这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？」，其链路包含 **Salience / Importance Judgement** 与 **Ignore / Remember / Ask / Notify / Act**。P3-04 只落实了链路中 **Contextualization** 一格的最窄面；其余环节**至今没有任何真实实现，也没有任何证据**。
>
> 准确表述是：**P3-04 首次让 Perception → World → Awareness 三层在真实代码中贯通；贯通不等于完整实现 Awareness。** P3-05 通过后**不得**读作"第三层已实现"，只能读作"第三层的一个最小切片，已与下面两层构成一条**经证明可组合、且瞬时状态不跨 Runtime 泄漏**的纵切"。

---

## 16. 实现原则

1. **不新增生产代码** —— 若验收必须修改 `src/**` 才能通过，停止并报告 architecture blocker。
2. **验收对象必须是真实生产实现** —— World 与 Awareness 在任何证据中都不允许被替身冒充；确定性链替换的是感知 Plugin，且如实标注。
3. **不使用注入缝** —— 测试替身作为普通 Plugin 参与真实 Runtime 依赖图，由 Runtime 决定谁 active。
4. **不使用耗时阈值** —— 等待用 `setImmediate` 的事件循环轮次边界。
5. **不假设真实桌面状态** —— smoke 只断言形状、引用与合法枚举。
6. **不留假断言** —— 不成立的性质（旧对象"已死"）写成明示的否定断言。
7. **判别力优先** —— 变异未被抓住时，先怀疑变异，再怀疑测试。
