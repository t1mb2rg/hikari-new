# Hikari 第三阶段 P3-05 Phase 3 纵切验收 Architecture Review

> **结论：Phase 3 的三层纵切已在真实代码中贯通，并已证明其组合性质。**
>
> P3-05 **未新增任何生产代码**（`src/**` 改动数为 0），未修改任何已冻结模块，未引入任何新的领域概念或协调层。
>
> **同时必须声明上限：本阶段证明的是三层的「组合性质」，不是 Awareness 层的完成度。** 详见 §14。

---

## 1. Functional Review

### 1.1 交付物

| 文件 | 性质 |
| --- | --- |
| `test/phase-3-vertical-slice.test.mjs` | 新增，8 条用例 |
| `docs/development/phase-3-vertical-slice.md` | 新增 |
| `docs/architecture/phase-3-final-architecture-review.md` | 新增，本文件 |

**未修改**：`src/**`（0）、`test/**` 既有文件（0）、`package.json`（0）、`tsconfig.json`（0）。

### 1.2 八条用例及其承重断言

| # | 测试名 | 承重断言 | win32 | 非 win32 |
| --- | --- | --- | --- | --- |
| 1 | `the production world and awareness carry an observation end to end without rebuilding it` | 引用恒等 + 非对称判定 | PASS | PASS |
| 2 | `a facet the production world could not fill reaches awareness as indeterminate` | 组合接缝形状一致 | PASS | PASS |
| 3 | `the whole slice acquires nothing until it is asked, and its first answer is a baseline` | 零急切采集 | PASS | PASS |
| 4 | `two simultaneously live runtimes never share an awareness baseline` | 瞬时隔离（强） | PASS | PASS |
| 5 | `a runtime that starts after the previous one is gone opens on a baseline again` | 瞬时隔离（字面）+ 无持久化参与者 | PASS | PASS |
| 6 | `shutdown retires the slice so no consumer can reach it any more` | 可达性 | PASS | PASS |
| 7 | `the four production plugins converge to the states this host actually supports` | 两层传播的诚实降级 | PASS | PASS |
| 8 | `the four production plugins observe a real desktop end to end` | 真实四层端到端 | PASS | **skip** |

### 1.3 实际结果

```
$ npx tsc -p tsconfig.json --noEmit
exit 0

$ npm test
ℹ tests 184   ℹ pass 184   ℹ fail 0   ℹ skipped 0
```

**Windows 本机 184 / 184 / 0 / 0，实际跑过，非预期值。**

CI（ubuntu-latest）预计 **184 / 179 pass / 5 skipped / 0 fail** —— 本轮**未 push**，该组数字是**预期值**，不得当作已确认值引用。5 条跳过全部来自 P3-01/P3-02 的感知平台 smoke，与本阶段无关。

### 1.4 Functional PASS

八条用例全部通过，且判别力已由变异测试证明（§1.5）。

### 1.5 判别力探针（一次性，不入库）

变异只施加于编译产物 `dist/`（已 gitignore），每次变异后 `npm run build` 重建恢复。探针先剥 ANSI 再匹配并交叉打印 pass 计数（P3-04 §21.4 的教训）。

| 变异 | 结果 |
| --- | --- |
| 基线 | `pass=8 fail=0` |
| **M1** 生产 World 的 facet 构造改为 `structuredClone(observation)` | `pass=7 fail=1` — **CAUGHT**（用例 1） |
| **M2** Awareness 的 `let previous` 提升到模块作用域 | `pass=2 fail=6` — **CAUGHT**（用例 2/3/4/5/6/8） |
| **M3** Awareness 在 `setup` 中急切调用一次 `world.current()` | `pass=1 fail=7` — **CAUGHT**（全部 7 条非 skip） |
| 恢复 | `pass=8 fail=0` |

**M2 的架构意义**：P3-04 也做过同型变异（`let previous` 上提，打红 9 条 P3-04 用例），但那些用例**全部在单个 Runtime 内**。P3-05 的 M2 打红的是**跨 Runtime** 的性质 —— 两者不等价。用例 4 与用例 5 **正是为 M2 而存在**。

**证据等级如实记录**：探针会话内一次性，不在仓库内、不进 CI、不可复现；证明"当时确实验过"，不证明"以后不会被改坏"。这是 P3-01 ~ P3-04 累计的已知弱点，本阶段未改变它。

---

## 2. 两类链的区分（架构关键）

本阶段有两类证据链，**强度不同，不得互相代称**：

### 2.1 确定性链（用例 1–6）

```
test-only perception Service providers
  → production DesktopSessionWorld
  → production DesktopSessionAwareness
  → real Runtime
```

替换的是**两个感知 Plugin 本身**；World 与 Awareness 是生产实现（经公开 barrel 导入）。

### 2.2 真实生产链（用例 7–8）

```
production foregroundPlugin → production inputActivityPlugin
  → production DesktopSessionWorld → production DesktopSessionAwareness
  → real Runtime
```

用例 8 上**四个 Plugin 全部是生产实现**，读数来自真实桌面。

### 2.3 禁止的表述

> ❌ 不得称确定性链为「四个真实 production Plugin，只替换 acquisition」

该说法把"替换了两个 Plugin"说成"只替换了插件内部的一个部件"，会**高估确定性链的证据强度**。真实感知插件的覆盖由用例 8 独立承担，二者不可互相顶替。

`createForegroundPlugin` 确实允许只替换 acquisition，且本轮**刻意未使用**：它是深路径内部 import，被 P3-01/P3-02 冻结为**每模块恰好一处**，再引入一处会扩大对一个被显式收窄的缝的依赖。测试文件的 **零深路径 import** 是该冻结的直接维持。

---

## 3. `src/runtime` 未修改

改动数 **0**。

`src/runtime/` 的 8 个 `.ts` 文件内容与 HEAD 逐字节相同（`git diff HEAD -- src/` 输出为空）。mtime 全部为 `2026-09-13 19:33`，早于本阶段写入（`2026-09-17 23:45–23:46`），本阶段未 touch。

架构含义：**Runtime 仍是领域无关的。** 本阶段新增的 8 条用例全部经 `Runtime.loadPlugin` / `getPluginState` / `getPluginError` / `shutdown` 四个既有公开入口取得证据，**Runtime 没有为验收新增任何钩子、枚举面或观测面**。

---

## 4. `src/foreground` 未修改

改动数 **0**（7 个 `.ts` 文件）。mtime 为 `2026-09-16 00:31 / 00:49`，早于本阶段写入。

本阶段对它的使用全部经公开 barrel：`foregroundPlugin`、`foregroundService`、`ForegroundError`、`ForegroundObservationError`。**零深路径 import**（见 §2.3）。

---

## 5. `src/input-activity` 未修改

改动数 **0**（7 个 `.ts` 文件）。mtime 为 `2026-09-17 16:06`，属已提交的 P3-02 轮次，**早于本阶段写入时间（23:45–23:46）约 7 小时**。

使用全部经公开 barrel：`inputActivityPlugin`、`inputActivityService`、`InputActivityError`。

---

## 6. `src/desktop-session-world` 未修改

改动数 **0**（4 个 `.ts` 文件）。mtime 为 `2026-09-17 21:29`，属已提交的 P3-03 轮次。

本阶段对它是**验收对象**之一：用例 1、2、3、7、8 都要求真实 World 产出进入真实 Awareness。**未为验收修改其任何一行。**

---

## 7. `src/desktop-session-awareness` 未修改

改动数 **0**（4 个 `.ts` 文件）。mtime 为 `2026-09-17 22:41`，属已提交的 P3-04 轮次。

本阶段对它是**验收对象**之一。**未为验收修改其任何一行。**

### 7.1 一处如实记录的既有措辞

`test/desktop-session-awareness.test.mjs` 的 T10 注释用 "the property is absent" 指代 title omitted（P3-04 §19 已记录）。该文件本轮**未被修改**，措辞保留原样。P3-05 的 F1 形状断言用 `'title' in foreground` 判定三种状态，**不依赖该措辞**。

---

## 8. 禁止新增的机制：零命中

| 检索 | 结果 |
| --- | --- |
| `src/runtime/` 中的领域词（Foreground / World / Awareness / Session） | **空** |
| 全库符号 `Manager` / `Orchestrator` / `Supervisor` / `GlobalWorldState` / `GlobalAwareness` | **空** |
| 本阶段新增的生产标识符 | **0**（本阶段不新增生产代码） |

第二条直接支撑本阶段的核心命题：**不存在承载跨 Runtime 状态的"中心对象"**。§9 的动态证据与这里"连名字都没有"的静态证据指向同一结论。

---

## 9. 瞬时状态隔离的架构证据

### 9.1 命题

整条纵切唯一的跨调用状态是 Awareness 的 `previous`（baseline）。要证明的是：**它属于单次 Runtime 生命周期，不属于下一个**。

### 9.2 三项证据

| 证据 | 内容 | 用例 |
| --- | --- | --- |
| **并发存活** | 两个 Runtime **同时活着**，B 的第一次调用仍是 `baseline`，A 的序列不受 B 干扰 | 4 |
| **全新 Runtime** | A `shutdown()` 后，全新 B 在**输入完全不同**的情况下仍从 `baseline` 开始 | 5 |
| **无持久化参与者** | 该链不提供 `continuityService` 也不提供 `chronicleService`，链内消费者停在 `waiting` | 5 |

**为什么"并发存活"是必需的**：`shutdown()` 会走 `#deactivateTree` 与 `#plugins.delete`。一个存在模块级共享状态的实现在"先后 shutdown"形态下可能因前者已被清理而**侥幸通过**。只有两个链**同时活在同一个进程里**，模块级 binding 才会当场暴露。

### 9.3 强度上界（如实记录）

上述证据证明的是：**两个同时存活的链之间没有可观测的状态共享**。

它**不**证明"不存在任何全局状态"。按 P2-04 已确立的纪律，图谱与测试的结论应表述为「**未发现**泄漏」，而非「**已证明不存在**」泄漏。

### 9.4 一条不接受反向断言的限制

被捕获的 awareness service 对象在 `shutdown()` 后**仍然可调用并仍会返回结果**（它闭包持有已被卸载的 `previous`）。因此用例 6 断言的是它**经由 Runtime 不再可达**（`getPluginState` 为 `undefined`、新消费者停在 `waiting`），并**显式断言它尚未失效**：

```js
assert.equal(typeof detached.current, 'function');
```

**shutdown 结束的是可达性，不是对象生命周期。** 断言更多会是一条被后来者信任的假断言。

---

## 10. 端到端引用保持（组合接缝）

### 10.1 为什么这是架构性质，不是实现细节

World 的契约规定 facet 按引用携带 source 的 observation；Awareness 的契约规定 `previous` / `current` 按引用携带 World 快照。**两个"按引用"是各自模块内的性质，此前没有任何测试证明它们在同一条链上同时成立。**

一个在组合处克隆或重建 payload 的实现，**不会违反任何一方的单模块契约**，却会让下游的身份判断失去依据。

### 10.2 证据（用例 1）

| 断言 | 跨过的层 |
| --- | --- |
| `comparison.previous === baseline.current` | Awareness 内部 + World 边界 |
| `comparison.current.foreground.observation === secondForeground` | 感知 → World → Awareness（**三层**） |
| `comparison.previous.inputActivity.observation === steadyInput` | 同上 |
| `comparison.current.snapshotAt !== OBSERVED_AT` 且匹配 UTC 毫秒 | 证明 `current` 是 **World 重新打戳**的产物，而非 provider 的对象 |

### 10.3 非对称判定跨边界保持

用例 1 把输入 tick **钉住不动**、只改前景标题，据此断言：

```
foreground === 'changed'   ∧   inputActivity === 'unchanged'   ∧   change === 'changed'
```

**为什么必需**：P3-04 的 T22 中两侧都 `changed`。若只断言 `change === 'changed'`，一个"只要有输入就算 changed"的实现也会绿 —— 判定代数会退化成"读过两次"。钉住一侧才能证明**非对称判定跨真实模块边界成立**。

### 10.4 组合接缝上的形状一致（用例 2）

```
感知 reject → production World 产出 { kind: 'unavailable' }（精确形状断言）
           → production Awareness 判为 'indeterminate'
           → 另一侧仍 'unchanged' → change === 'indeterminate'
```

这是 World 的**失败 facet 形状**与 Awareness 的**不可判分支**之间的唯一接缝。P3-03 证明前者产出正确，P3-04 证明后者消费正确，**此前无人证明两者指的是同一个形状**。

---

## 11. 平台收敛：失败传播两层

### 11.1 机制

```
setup() → createWindowsAcquirer() → process.platform !== 'win32' → throw ForegroundError
       → Runtime #activate 内 try/catch → #failActivation → state = 'failed'
       → World / Awareness 的 requires 不满足 → 停在 'waiting'
       → Runtime 不崩
```

平台守卫**全部在函数体内**，无顶层守卫 —— 因此非 win32 上**导入模块本身不会抛错**，`failed` 是加载期产生的状态而非导入期崩溃。

### 11.2 证据（用例 7）

| 平台 | 断言 |
| --- | --- |
| win32 | 四个 id 均 `active` |
| 非 win32 | 两个感知 `failed` + World/Awareness `waiting`；错误是 `ForegroundError` / `InputActivityError` 实例 |
| 两者 | 随后加载无关 Plugin → `active`（**Runtime 仍健康**） |

### 11.3 相对既有测试的新意

`test/foreground.test.mjs:301` 已有同型三目平台断言，但只观察到**第一层**（感知 failed）。用例 7 把断言对象提升到**四插件链**，证明失败会沿 `requires` 图**正确传播两层**，且**不伪装出判断能力**。

用例 7 全程不调用 `current()`，故 win32 上开销为 0，**可安全进 CI** —— 这使 CI 在无法运行真实 smoke 的情况下仍覆盖了降级半边。

---

## 12. 图谱变更验证（未取得有效结果）

**本轮 `detect_changes({scope: "all"})` 返回 `changed_count: 0` / `risk_level: "none"`，但该结果无效，不得采信。**

理由（P2-04 §13 已记录的同一陷阱）：`detect_changes` 只能看到**已被索引的文件**。本阶段的两个新增文件是**未跟踪文件**，从未被索引，因此"0 changes"是**未见**，不是**未变**。

P2-04 记录过该证据的两个前置条件：**索引重建 + `git add`**。本轮纪律明确**禁止 stage**，因此两个条件都无法满足，**该校验在本轮无法取得有效结果**。

**替代证据（本轮实际取得）**：

| 证据 | 结果 |
| --- | --- |
| `git diff HEAD -- src/` | 空 |
| `git diff --stat HEAD` | 空 |
| `git status --porcelain` | 仅两个未跟踪新文件 |
| src 文件 mtime | 全部 ≤ `22:41`，本阶段写入为 `23:45–23:46` |
| 索引 `meta.lastCommit` | 与 `git rev-parse HEAD` 逐字符相同 |

**同时记录一条已知工具缺陷**：GitNexus 自报 `staleness.commitsBehind: 5`，而同一次响应中 `meta.lastCommit` 精确等于 HEAD。该字段**第二次被独立证伪**（上一轮报 4，本轮报 5，随 HEAD 递增而恒大于 0），**其数值不作为陈旧证据采信**。

---

## 13. 工具限制（如实记录）

1. **图谱不解析 `.mjs` 的 IMPORTS 边。** `test/` 下的 File 节点存在，但 import 边为 0。因此本轮**没有也无法**用图谱证明"测试只经公开 barrel 导入"。该结论由源码审阅（§2、§9）与测试文件的 import 行直接确认。**空结果不是"没有依赖"，是分析器没建边。**
2. **`detect_changes` 对未跟踪文件返回误导性的 0**（§12）。
3. **`staleness.commitsBehind` 不可采信**（§12）。
4. **跨语言字段解析不完整**（P2-04 已记录，本轮未重测）。
5. **探针证据一次性、不进 CI、不可复现**（§1.5）。

**结论强度**：本阶段图谱侧的结论应表述为「**未发现**侵入」，**不是**「**已证明不存在**」侵入。

---

## 14. 最终结论

### 14.1 Phase 3 架构命题（三条）

1. **组合封闭** —— 四个生产 Plugin 可仅经公开契约组合，**不要求修改任何已冻结模块**（§3–§7 逐模块为 0）。
2. **瞬时局部** —— 该组合唯一的跨调用状态（baseline）活在单次 Runtime 生命周期内；**两个同时存活的 Runtime 之间无状态共享**（§9）。
3. **缺席诚实** —— 能力不存在的平台上，失败以具名领域错误沿 `requires` 图**传播两层**，不伪装出判断能力（§11）。

### 14.2 必须与本结论同时出现的上限声明

> **Phase 3 不实现完整 Awareness。**
>
> 按 `principles.md` §14 的冻结定义，Perception 回答「我观察到了什么？」，World 回答「在某个 scope 内现在掌握哪些事实」，**Awareness 回答「这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？」**，其链路为：
>
> ```
> Observation → 事实标准化 / Contextualization → Salience / Importance Judgement
>             → Ignore / Remember / Ask / Notify / Act
> ```
>
> P3-04 只落实了其中 **Contextualization 一格的最窄面**（相邻两个 snapshot 的可比较 payload 是否变化）。**Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act 至今没有任何真实实现，也没有任何证据。**
>
> 准确表述是：**P3-04 首次让 Perception → World → Awareness 三层在真实代码中贯通。贯通不等于完整实现 Awareness。**
>
> 本阶段（P3-05）证明的是这三层的**组合性质**，**不是** Awareness 层的完成度。**不得把"第三层已贯通"读成"第三层已验证"，也不得把 Awareness 等同于 change detection。**

### 14.3 第三阶段整体关闭条件

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| **Functional** | **PASS** | 8 条新增用例 + 全量 184 / 184 pass / 0 fail（Windows 实际） |
| **Architecture** | **PASS** | §3–§7 逐模块 0 改动；§8 禁止机制零命中；§9–§11 三项架构命题成立 |
| **Docs / Contracts updated** | **PASS** | 本文件 + `docs/development/phase-3-vertical-slice.md`；**生产契约零变更**（本阶段不新增生产代码） |
| **判别力** | **PASS** | M1/M2/M3 三个变异全部被抓（§1.5） |

| 阶段 | Functional | Architecture | Docs | 状态 |
| --- | --- | --- | --- | --- |
| P3-01 Foreground | PASS | PASS | PASS | complete |
| P3-02 Input Activity | PASS | PASS | PASS | complete |
| P3-03 Desktop Session World | PASS | PASS | PASS | complete |
| P3-04 Desktop Session Change Awareness | PASS | PASS | PASS | complete |
| **P3-05 Vertical Slice Acceptance** | **PASS** | **PASS** | **PASS** | **complete（待 closeout 提交）** |

### 14.4 closeout 时仍需完成的事项（不在本轮）

1. `docs/development/current-stage.md` 更新为 `ead4d7c`（及本阶段提交）、push DONE、CI **实际**计数，标记 Phase 3 COMPLETE。
2. 该文件中两处 `P3-05 尚未冻结`（`:41`、`:1111`）与 CI 计数块（`:1023-1033`，其中 P3-04 行仍标注为"预期值"，**现已经 CI 实际确认**）为已知 stale，由 closeout 一并修正。

**本轮按纪律未修改 `current-stage.md`。**

---

## 15. 不新增第三阶段架构地图（决定，不是未结项）

与 P2-04 同型的决定：**本阶段不新增架构地图，也不把它记作未结项。**

理由：本阶段**零新增生产结构**（`src/**` 改动数 0、零新增生产标识符）。建图只会复述 `docs/development/phase-3-vertical-slice.md` 与 `docs/development/phase-3-desktop-session-awareness.md` 已经写下的文字，不产生新的架构信息。

---

## 16. 一条留给后续阶段的观察（只记录，不规划）

Awareness 是第一个消费 World 的模块。若将来出现**第二个 World 消费者**，或出现需要**跨快照历史**判断的需求（例如「A → B → A 算不算回到原状」），则「Awareness 是否该有历史窗口」必须作为一次**独立的设计决定**被提出，而不是搭在某个消费者身上顺手长出来。**现在样本仍然只有一例，因此不提前抽象。**

本阶段新增的相关事实：`desktopSessionAwarenessService` 目前**零外部消费者**。这不是不完备 —— 它的消费者是**将来的模块**，不是现在的代码。
