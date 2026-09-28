# DESKTOP RETURN ATTENTION v0 — BOUNDARY REVIEW

> **本轮只设计。不实现。不修改 Runtime。**
> 本文是一份边界评审，不是一份实现计划，也不是一份冻结文件。文中的「建议」不因写在这里而成立。
>
> **后续指针（2026-09-28 回填）**：本轮的 **BLOCKED 判词已被取代**。`HIKARI ARCHITECTURE GOVERNANCE REVIEW v1`（`docs/architecture/hikari-architecture-governance-review-v1.md` §5）把它**重新分类为 `eligible for local contract evolution`**——理由：本节 §一 第一环撞的那条冻结（`:1434`，重基后为 **`:1444`**；行号随 `docs/development/current-stage.md` 的后续修订漂移，**以该文件「Input Activity 的在场解读」那一条为准**，不以行号为准）**两半可切分**：六个导出量不得进入 Perception 是**有归宿的 MUST**（`principles.md:57`，**继续有效**），而兜底子句「以及任何阈值比较」**缺主语**、按 `plugin-design-spec.md` §18.2 最高只能是 SHOULD，**不构成 L3 阻断**。该口径修正已经落地（`docs/development/current-stage.md` 中紧接该条之后的「口径修正（ARCHITECTURE GOVERNANCE REVIEW v1 之后）」，Desktop Return Attention v0 收尾时为 `:1445`）。
> **下方 §17 的 BLOCKED 结论与四条解锁条件原样保留、不修改**，以便追溯本文当时究竟说过什么。
>
> **实施指针（2026-09-28 回填）**：该 slice 已按 **Level 2 — Local Contract Evolution** 实施，冻结与本轮实际决定逐条记在 `docs/architecture/desktop-return-attention-v0-implementation-boundary-freeze.md`（§1 选定的输入时间语义、§2 源契约变更、§9 判定规则表、§10 明确不做、§11 「无 Level 3 trigger」结论）。本文件与冻结文件的指向是**双向**的：本文记录「评审当时说了什么、为什么当时判 BLOCKED」，冻结文件记录「按修正后的口径落地了什么」。两者不互相覆盖。

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-27 |
| HEAD | `23d6fac`（`main`；评审期间工作区干净，本文是唯一新增的未跟踪文件） |
| 评审对象 | 一个**尚未存在**的能力：用户经过一段无输入时间后重新出现输入活动，且 Work Focus 非空时，Hikari 主动提醒当前关注对象 |
| 评审裁决 | **BLOCKED**（见 §17），附 4 条解锁条件 |
| 方法 | 只读；GitNexus graph 证据 + 源码逐行 + 13 个只读子代理（6 调查面 / 7 对抗面），全部 finding 由主 Agent 重新锚定到 `file:line` |
| 未运行 | 没有执行任何测试、构建或进程；没有可用模型 endpoint，任何模型语义验证在本机 **NOT RUN** |

**关于命名**：仓库里不存在 `DESKTOP RETURN ATTENTION` / `desktop-return-attention` / `desktopReturn` 的任何文档、代码、flag 或计划（`grep -rni` 在 `src/` `test/` `docs/` 全部零命中）。本文的评审对象是**任务书描述的 §一 链**，不是一份已冻结的 mandate 文本。所有引用均锚到既有 perception / awareness / language / delivery 边界。

---

## 1. Existing input-activity semantics

### 1.1 `InputActivityObservation` 是一个封闭的三字段只读记录

```ts
// src/input-activity/types.ts:3-7
{ observedAt: string; source: InputActivitySource; lastInputTick: number }
```

键集合被真实 Windows 测试逐个断言（`test/input-activity-windows.test.mjs:12,46`，`OBSERVATION_KEYS = ['lastInputTick','observedAt','source']`）。**没有第四个字段**，尤其**没有「当前 tick」**。

### 1.2 `lastInputTick` 是什么

| 问题 | 源码/文档给出的答案 |
| --- | --- |
| 来源 | `user32!GetLastInputInfo(ref LASTINPUTINFO)` 写回的 `dwTime`；结构体声明 `{ uint cbSize; uint dwTime; }`，P/Invoke 在 `src/input-activity/windows.ts:19-32` |
| 类型 | `number`，被实现限定在 `0..4294967295`（`isUint32` 校验，`:12,:126-135`） |
| 单位 | **仓库从未断言**。「1 tick = 1 ms」是 Win32 外部知识，不是仓库事实 |
| 时钟原点 | **仓库从未写出**。文档称其「启动相对的 tick」「不是时间戳，不与 `observedAt` 同轴，二者的关系不被本模块解释」（`docs/development/phase-3-input-activity.md:107`） |
| 回绕周期 | **从未被写下**。仓库只说 tick「可能在回绕时变小」（`docs/architecture/phase-3-desktop-session-awareness-architecture-review.md:375`），没有给出 2³² ms |
| 是否单调 | **没有承诺**。同一处评审明写 tick「可能因为平台语义在一次输入后跳动很远」 |
| 失败时 | **reject**，绝不 resolve 成哨兵值。且有三条互不等价的路径：非 win32 宿主是 setup 内同步 throw（Plugin `failed` / 消费者 `waiting`）、运行时失败 reject `InputActivityObservationError`、只有 World 把它折叠成**不带原因**的 `{kind:'unavailable'}`（`src/desktop-session-world/types.ts:22-23`、`plugin.ts:28-49`） |

### 1.3 `observedAt` 是什么

`[System.DateTime]::UtcNow` 在同一次 PowerShell 子进程调用里取得，格式 `yyyy-MM-ddTHH:mm:ss.fff` + `Z`，父 Node 进程只透传（`src/input-activity/windows.ts:31,:123-125`）。**顺序固定**：先 `GetLastInputInfo` 成功，后取时间，最后读 struct。所以 `observedAt` 相对产生该 `dwTime` 的时刻只会**偏晚**，方向确定、幅度未定义。

### 1.4 今天这一层唯一的运算

全仓库对 `lastInputTick` 的**全部**出现只有四类：透传赋值 / 契约字段、uint32 校验、**一处 `===` 比较**、一处原样打印。

```ts
// src/desktop-session-awareness/plugin.ts:46-50
// Compared for inequality only. The tick is the platform's own counter, so this layer reads a
// decrease as a difference, never as a rewind to correct and never as a duration.
return previous.observation.lastInputTick === current.observation.lastInputTick
  ? 'unchanged' : 'changed';
```

全仓库**没有**任何地方把 `lastInputTick` 转成时长，或把它与 `observedAt` 做运算。展示层唯一一次提到「换算」是在**拒绝**它：把 tick 渲染成「3 秒前」需要「一个这一层没有的第二次时钟读数与一次契约从未要求的减法」（`src/desktop-session-observe/presentation.ts:101-104`）。

### 1.5 词表的自我限定（这是词表的组成部分，不是注释装饰）

```ts
// src/desktop-session-awareness/types.ts:7-10
// `stable` says only that neither comparable payload differed between the two snapshots; it is not a
// claim that nothing happened on the desktop. `changed` says only that at least one comparable payload
// differed; it is not a claim that the difference matters.
// Neither verdict decides whether to remember, notify, or act, and this layer makes no such decision.
```

facet 三值 `changed | unchanged | indeterminate`；overall 三值 `changed | stable | indeterminate`（注意 overall 用 `stable`，facet 用 `unchanged`，不是笔误）。assessment 两个 arm：`{kind:'baseline', current}` 与 `{kind:'comparison', previous, current, foreground, inputActivity, change}`；**baseline arm 刻意不携带 `previous`/`change`/facet 值**（`types.ts:11-23`）。

---

## 2. Can idle duration be known honestly?

**不能。** 不是精度问题，是量纲问题。

### 2.1 `observedAt − lastInputTick` 不是时长

记 `W` = `observedAt` 的 epoch ms，`L` = `lastInputTick`，`B` = 开机时刻的 epoch ms，`U` = 到观测时的开机时长，`I` = 真实 idle。则：

```text
W = B + U
L = U − I
W − L = B + I          ← 相减没有消掉原点差，反而把 B 原样加进了答案
```

具体数值（`I = 300_000` ms，`U = 259_200_000` ms，`B ≈ 1.7905e12`）：

```text
W − L = 1_790_260_125_123 ms ≈ 56.73 年
真值  = 300_000 ms = 5 分钟
信噪比 B/I ≈ 6.0e6        ← 五个数量级，不是阈值能修的
```

按 uint32 截断（`(W−L)>>>0`）得到 ≈ 41.1 天，仍然荒谬。**这条命题在仓库里没有任何对应实现**——`wall clock − lastInputTick` 这个具体动作在生产源码里零次出现。

### 2.2 单次 observation 在原理上也给不出 idle

observation 没有「当前 tick」这个量，也没有 boot 时刻基元，全仓库不存在任何 tick ↔ 墙钟换算函数。文档把它逐字写为冻结边界：「**单次 observation 本身不提供 idle duration —— 这是冻结边界，不是缺陷**」（`docs/development/current-stage.md:1185`，另见 `docs/architecture/phase-3-input-activity-architecture-review.md:446`）。

另外 `dwTime = 0` 是**合法** tick（`docs/development/phase-3-input-activity.md:92-97`），所以单次也分不清「自启动以来没有输入」与「tick 恰好很小」。

### 2.3 唯一诚实的量：**observation-based inactivity 的下界**

从 ≥2 次 observation 可以得到——但必须指名道姓地说清它是什么：

> 设 `O1/O2` 为两次 `observedAt`，`L1/L2` 为对应 tick，且**只对 tick 做 `===`**。
> - `L2 === L1` ⇒ 该窗口内没有输入事件到达该 session ⇒ 最后一次输入早于窗口起点 ⇒ `idle(O2) ≥ O2 − O1`（**下界**，上界无穷）
> - `L2 !== L1` ⇒ 窗口内确实发生过输入 ⇒ `0 ≤ idle(O2) ≤ O2 − O1`（**上界**）
>
> 两者都是 **observation-based inactivity 的界**，且都是 wall-clock 减 wall-clock。
> **它们不是 OS-reported idle duration，两个名字不得混称。**

这条界限本身依赖仓库**没有提供**的前提（tick 与墙钟同速率、窗口内无休眠、墙钟未被 NTP 步进）。这些前提从未被评估过——因为仓库从不把两者做运算。

### 2.4 分辨率

- `observedAt` 文本分辨率 1 ms（格式写死 `.fff`）；
- 但每次 `current()` 启动一次 PowerShell + `Add-Type`，实测 ≈ 523 ms（`docs/development/current-stage.md:1183`），**两个观测的最小窗口被采集成本支配在 0.5–1 s 量级**；
- 再叠加 cadence（下一轮定时从上一轮**完成**后开始）。

### 2.5 一个必须一起读的既存反例

`test/input-activity-windows.test.mjs:62-80` 记录了一条**被删除而非放宽**的断言：曾经写过「两次真实 tick 的差值应被两次采集之间的墙钟窗口约束」，判定其**前提错误**后删除，注释逐字给出形式化保证是 `L0 <= T1`（dwTime 可比于窗口末端，**永不** ≥ 窗口起点）。任何新的时长语义都必须先正面回答这个反例，而不是加一个容差常数。

---

## 3. Definition of return

### 3.1 先攻击命题「tick 变了 = 用户回来了」

**该命题不成立**，有四个具体反例，其中两个来自仓库自己的记录。

**序列 A —— 用户全程在打字（最平凡的反例）**

```text
09:00:00.000Z  tick=650000000  → baseline
09:01:00.000Z  tick=650060000  → inputActivity=changed
09:02:00.000Z  tick=650120000  → changed
09:03:00.000Z  tick=650180000  → changed
```

真实世界：人一直坐在同一把椅子上敲字，**根本没走**。按命题，3 分钟内 3 次「欢迎回来」。误报率 100%。

**序列 B —— 仓库自己记录的真实运行（更强）**

`docs/development/phase-3-desktop-session-awareness.md:356-360` 逐字记录了一次真实运行：

```text
current() #2: 391ms  kind=comparison  foreground=unchanged inputActivity=changed change=changed
```

同文 `:367` 称它「是真实的核心场景：前台没变（QQ 还是 QQ），tick 变了，整体因此是 changed」。**「用户从未离开」在这条数据上读出来恰恰是 `changed`。**

**更要命的是同一份文档 `:386` 的口径**：

> 只要用户有输入，`inputActivity` 就是 `changed`，整体就是 `changed`。`stable` 实际只在「两次读取之间完全没有任何输入且前台没变」时出现——即空闲期。

也就是说 `changed` 是**正常使用时的常态**，`stable` 才是空闲这个**异常态**。把常态读成「回来了」这个异常事件，是把词义读反了。

**序列 C —— 一次路过碰鼠标 / 一次重启**

```text
09:00:00  tick=650000000   人在座
09:05:00  tick=650299995   09:04:59 同事路过碰了一下鼠标；人 09:00:05 就走了
09:10:00  tick=650299995   unchanged
09:20:00  tick=650960000   09:16 人真的坐下打字
```

第 2 条会宣布「用户回来了」，而人不在座。

重启：计数器是**启动相对**的，机器重启后立刻敲一键 → tick 从 `650000000` 掉到 `4000`，仍是 `changed`，而人从未离开座位。

**序列 D —— 合成输入**

keep-awake 鼠标抖动器、RDP 转发、自动化脚本都会推进这个系统级计数器。perception 对输入来源零过滤，而「感知结果的过滤」本就在明确不做清单里（`docs/development/current-stage.md:1435`）。

### 3.2 仓库对「changed」的既有否决

`docs/architecture/phase-3-desktop-session-awareness-architecture-review.md:373-385` 已经把命题的一半写成反例：「4000 → 5000 changed（变大同样是变化，**不推断『刚刚有输入』**）」；`:357`：「`changed` 也**不代表**用户是活跃的——它只代表某个观测点的值动了」。

`docs/development/current-stage.md:417` 逐字：`stable` 是关于观测值的陈述，不是关于世界的陈述……不表示用户空闲、不表示用户离开。

### 3.3 攻击「`change === 'changed'` 可以当 return」

同样不成立。`change` 的判定域是两个 payload 的取或（`plugin.ts:35-37,48-50,59`），而这两者都不携带「缺席—返回」结构：

- **用户整段不在场，`change` 仍可为 `changed`**：无人触碰键鼠（tick 两次相同 → `unchanged`），但前台窗口标题自己变了（构建进度 `3/10 → 4/10`）→ `foreground=changed` → overall `changed`。
- **`unavailable` 不会制造 changed，也不会压掉另一个 facet 的 changed**（`plugin.ts:23,:44` 返回 `indeterminate`；overall 经另一 facet 仍可为 `changed`）。
- **第一次是 `baseline`**，**没有 `change` 字段**。天真读 `assessment.change` 会拿到 `undefined`。
- loop 每轮 `catch {}` 吞掉失败（`desktop-session-awareness-loop/plugin.ts:86-92`），所以 **loop 静默停摆也会被误读成「用户一直没回来」**。

### 3.4 最小机械、activation-local 的规则（本轮推导结果）

不创建 Presence / Away / UserState。只在新的 decider 内部持有两个 activation-local 变量：

```text
lastSeenTick      : number | undefined   上一次「有输入」时的 tick
runStartObservedAt: string | undefined   当前这条「未观测到输入」的 run 的起点（wall-clock）
```

| 情形 | 判据 | 动作 |
| --- | --- | --- |
| **A. Runtime activation 后第一次 observation** | `assessment.kind === 'baseline'`（或 `lastSeenTick === undefined`） | 建立 baseline，**不判定**。baseline arm 本来就没有 `change` 字段 |
| **B. 持续无输入** | `L === lastSeenTick` | 延续当前 run；**不更新** `runStartObservedAt` |
| **C. 观测到输入** | `L !== lastSeenTick` 且 `L > lastSeenTick` | 若当前 run 的 wall-clock 跨度 ≥ 阈值，才是候选 return。**否则只是回到 B 之外的常态** |
| **D. 回绕 / 重启 / 平台跳动** | `L < lastSeenTick` | **不是 return**。重置 run，**不发出**。与 `plugin.ts:46-47` 一致：读作差异，不读作倒退，不做修正 |
| **E. 观测不可用 / `indeterminate` / 缺样** | 任一侧 `kind !== 'available'` | 重置或保持；**观测的空洞不是输入的空洞** |

**这条规则只做 wall-clock 减 wall-clock，从不做 `observedAt − lastInputTick`。**

`runStartObservedAt` 的上界取「上一个仍与 `lastSeenTick` 相同的样本的 `observedAt`」，而不是「第一次观测到变化的样本的 `observedAt`」——因为变化发生在两次采样**之间**，该窗口的起点才是可诚实引用的下界时刻（这正是 §2.5 那条被删断言给出的 `L0 <= T1` 约束）。

### 3.5 但这条规则的结论名字是受禁的

规则能诚实产出的最强句子是：

> 「本次采样的这个窗口内，观测到了一次输入事件，而在此之前至少 W 毫秒的窗口内没有观测到任何输入事件。」

把它压缩成一个对消费者有用的量，就是 **observed-absence-of-input over a wall-clock window**。它**不是** presense，**不是** return，**不是** OS-reported idle。而 `docs/development/current-stage.md:1434` 逐字禁止的正是这个名字所指的量（见 §17）。

---

## 4. Activation-local temporal state

### 4.1 先例（正面）

| 先例 | 形状 | 位置 |
| --- | --- | --- |
| awareness `previous` | `let previous: DesktopSessionWorldSnapshot \| undefined` 在 setup 闭包内；setup 每次 activation 只跑一次，重新 activation 得到全新绑定，第一次 assessment 又是 `baseline`。**零持久化** | `src/desktop-session-awareness/plugin.ts:72-78` |
| attention `handledFailures` | `Set<number>` 在 setup 闭包内；重启后重来；查阅 Chronicle 被明确拒绝 | `src/repository-ci-attention/plugin.ts:95-98` |
| work-focus state | `let state = emptyWorkFocus()`；`session.ts:17-19` 逐字「The history cannot restore the state」 | `src/work-focus/session.ts:17-19,51-52` |

### 4.2 这一层是**新的一类**状态

全仓库 `src/` 下 `Date.now()` / `performance.now()` / `hrtime` **零命中**（命中全在 `test/`）。`src/` 下唯一一处 wall-clock 时间差是 `src/language/dialogue.ts:90` 的对话 TTL，而它挂在**人提问**的请求路径上（`src/language/answer.ts:135,145`），**不在任何 cycle 上**。

准确的说法不是「跨 cycle 状态里没有时间戳」——`DesktopSessionWorldSnapshot.snapshotAt` 就在 awareness 跨 cycle 持有的 `previous` 里（`src/desktop-session-world/types.ts:25`）——而是「**没有任何地方拿它做时间差**」。比较函数从不读 `snapshotAt`，只读 `title`/`processName`/`lastInputTick`。

所以 §3.4 需要的 `runStartObservedAt` 是一个**仓库从未有过的状态种类**：跨 cycle 持有 wall-clock 时间戳，**目的就是**测量经过时长。

### 4.3 一处会被现有测试挡住的路径

```js
// test/desktop-session-awareness.test.mjs:851-859
const holders = walk(new URL('../src/', import.meta.url))
  .filter((path) => /\brequires:\s*\[[^\]]*\bdesktopSessionAwarenessService\b/.test(...))
assert.deepEqual(holders, ['desktop-session-awareness-loop/plugin.ts']);
```

这条断言遍历**整个 `src/`**，把 `desktopSessionAwarenessService` 的 holder 集合钉成恰好一个。新的 decider 若声明 `requires: [desktopSessionAwarenessService]`（要拿到 self-advancing 的 `current()` 序列，这是最自然的一条），**这条测试直接变红**。

两条诚实的替代路：

1. **订阅 `desktopSessionAwarenessAssessedEvent`**——loop 已经在按 cadence 产出恰好这个序列，payload 是 assessment 本身、不加字段、不加第二个时间戳（`src/desktop-session-awareness-loop/contracts.ts:4-12`）。**代价**：生产代码里**没有任何插件订阅过任何 Event**——`src/` 下 `.subscribe(` 的唯一命中是 Runtime 自己实现该 API 的那一行（`src/runtime/plugin-context.ts:36`）。做这件事会**成为全仓库第一个生产 Event 订阅者**。函数上没问题（`EventBus` 在 0 订阅者下是空 `Promise.allSettled([])`，无副作用 resolve，`src/runtime/event-bus.ts:38-52`），但它是**一个新的结构事实**，需要一次独立设计决定，不能顺手长出（`docs/development/current-stage.md:1640`）。
2. **用 `desktopSessionAwarenessPeekService`**——它**不推进 baseline**，所以拿不到「连续的、互不相同的窗口」。对 §3.4 的规则来说这条路不成立。

留给实现的取舍本评审不建议冻结；本节要记录的是：**这条边今天只有一条路，而它会打破一条既有测试或成为全仓库第一个 Event 订阅者。**

---

## 5. Work Focus role

**只表达用户当前明确关注什么。继续冻结 `Work Focus ≠ interruption authority`。**

### 5.1 能力面

```ts
// src/work-focus/contracts.ts:27  —— 接口体的唯一成员
current(): Promise<readonly string[]>
```

`defineService('work-focus.current', 1)`；该 plugin 的唯一 `provides`。数组已冻结、**按引用**返回活状态，顺序无承诺。

- 「当前 focus 是否非空」可以诚实回答：`designations.length === 0`。
- 空数组与「无 focus」**严格等价**：空白 designation 一律被拒绝（`state.ts:43-45,57,77`），数组里不存在空字符串元素。
- 但一次调用的结果是「那一刻」的集合，不是稳定事实。

### 5.2 明确不拥有的东西（源码逐字）

| 不拥有 | 证据 |
| --- | --- |
| 打断 / interruption | `contracts.ts:9-12` 逐字列出没有 ingress、occurrence history、timestamps、provenance、priority、replacement history；「a contract cannot expose what its owner does not have」 |
| presence / 在场 | `facts.ts:14-16`：字段里没有 importance / salience / confidence / relation / 对 designation 含义的解读 |
| attention / authority | 同上；全仓库没有任何地方因为「focus 非空」而获得说话/通知/打断权力 |
| 何时适合说话 | 它的全部对外面只有 `current()` Service 与一个本机 endpoint；零输出、零投递、零调度 |

### 5.3 已冻结的 Human 裁决（效力高于任何本地推断）

> **Human ruling #1：Work Focus / repository scope 不承担 interruption authority。**
> —— `docs/architecture/outbound-composition-v0-boundary-review.md:10`

同文 `:102-107` 的「**以下任何一条都不单独产生 speaking authority**」表里，**Work Focus 是第一行**。同文 `:1063`：「「人配了 repository」不构成「人可以被打断」。」

### 5.4 攻击「focus 非空 ⇒ 可以主动说」

**不成立。** 三条具体失效路径：

**(a) 授权从组合期静态事实滑到运行期可变状态。** 今天唯一的说话授权是 resident 算子显式给出的一个 flag：`src/cli/options.ts` 逐字「speaking first is the resident's operator's decision rather than any listener's」；`src/cli/resident.ts:355`「The composition is where a human's explicit act lands, and the act is one flag.」而「集合是否非空」是**任何能往那条 named pipe 写一行的本地进程**都能改的运行期状态（`src/work-focus/endpoint.ts` 的监听端没有任何调用方身份）。这把 R2 冻结的二分轴（组合期静态授权 / 瞬态连接状态——「**不是两个轴**」）变成三分。

**(b) 「非空」是状态，不是事件。** 今天会说话的路径都以**事件**为触发器，且每个事件自带去重身份（`runId`）。状态触发没有身份，于是：`declare acme/payments-api` → 响一次；`clear` → 授权消失；`declare acme/payments-api` → **同一句话再响一次**。且 `delayMs` 只设上界，`--proactive-ci-delay-ms 1000` 时节奏上界就是人的敲键速度。

**(c) 内容本身错。** 「提醒**当前**关注」依赖一个契约上不存在的量：`contracts.ts:9-12` 逐字说没有 timestamps、没有 provenance。一个由「非空」授权的 decider 在结构上**无法区分**「4 秒前声明的」与「6 天前声明、从没 clear 过的」——两者在它拿到的 `readonly string[]` 上是同一个值。它唯一能说的是「你现在关注：X」，也就是**把用户自己刚敲进去的字符串回显给他**。

**(d) 表达面绕开。** 若被授权者想说得更多，就只能自己给这个状态造句——那正是 `principles.md:495`「领域模块不应自行绕过 Presentation 直接向用户说话」点名的失败态（见 §9）。

### 5.5 仍然成立的那一半

「Work Focus 非空」确实是**一个真实判词的必要输入**（relevance v1 的「至少一个 designation ∧ 逐字相等」规则）。**说「非空不授权」不等于说「非空无关」。** 错的是「就**可以**」这四个字——把输入读成了授权。

---

## 6. Product mandate

**必须有独立的 explicit configuration。没有它，Hikari 即使能观察 input activity 也不能主动提醒。**

### 6.1 既有 parity 的逐条对照

| 要素 | proactive repository CI 今天的样子 | 来源 |
| --- | --- | --- |
| 显式人类行为 | `--proactive-ci-delay-ms` 必须与 repository scope + model 三件同时给出 | `src/cli/options.ts` 的三前提 pairing |
| 组合期落地 | `resident.ts` 是**人手写的 roster**；`proactiveDelayMs === undefined` 时直接早退 | `src/cli/resident.ts:362-363` |
| 授权边的方向 | decider 在自己的 `requires` 里点名两个 Service | `src/repository-ci-attention/plugin.ts:76` |
| capability ≠ permission | 契约头注释逐字：「What this contract is *not* is a permission … the authorization lives on the other side」 | `src/language/contracts.ts:10-16` |
| 感知能力 ≠ 主动授权 | 同一条 | 「Attention 的 `requires` 就是那条授权边，capability 存在本身不授权」 |

### 6.2 `--desktop-awareness-delay-ms` 不得被静默升级

它今天的含义是「以这个节奏**观察**桌面」。它与 `--repository` 是同一形状：`--repository` 的含义是「**观察**这个仓库的 CI」，不是「**打断**我」；把它升级为授权 = 在人类没这么说的情况下改变既有 contract 的含义（Human ruling #1）。**同一句话对 `--desktop-awareness-delay-ms` 成立。**

### 6.3 一个必须写明的**不完整 parity**

`--proactive-ci-delay-ms` 的**值**是一个 cadence（多久看一次）。§一 链需要的 flag 的**值**是一个**在 observation-based inactivity 上的阈值**——也就是 §2 说不能诚实得到、§17 说被逐字禁止的那个量。

所以：**这个 mandate flag 会是一个语义建立在受禁量上的 flag。** 这不是「再加一个 flag」的规模问题，是它能不能被诚实定义的问题。

---

## 7. Second-consumer pressure on Language speaking

### 7.1 今天这个契约到底是什么

```ts
// src/language/contracts.ts:31
import type { RepositoryCiAttentionOccurrence } from '../repository-ci-attention/types.js';
// src/language/contracts.ts:48-51
export interface LanguageSpeakingService {
  speak(occurrence: RepositoryCiAttentionOccurrence): readonly string[];
}
```

**关键事实（与「必须泛化」的直觉相反）**：形参类型是 **consumer 自己的私有类型**，经 owner 的**叶子** `types.ts` 引入（该文件 `import` 计数为 0）。

> 所以 `language.speaking@1` 从第一天起就是 **owner-specific / consumer-specific** 的，不是中立信封。
> **第二份 owner-specific Service 不是「泛化」，而是「同一形状的第二次实现」。**

### 7.2 生产消费面

- `speak` 的生产调用点**恰好一个**：`src/repository-ci-attention/plugin.ts:147`，`await delivery.deliver(speaking.speak(occurrence))`。全 `src/` 内 `.speak(` 只出现这一次。
- provider 在同一条边上：`provides: [languageSpeakingService]`（`src/language/plugin.ts:206`，两个 variant 共用），method 就是 `renderSpokenOccurrence` **函数本身**（`:275`）——`:271-274` 逐字给出理由：「naming the function directly … **leaves no closure for a later edit to grow a decision in**」。
- 测试侧：`test/repository-ci-attention.test.mjs:366-381` 自建假 speaking provider，按同一签名编译；`test/language.test.mjs:1372`/`:1587-1588` 把两个 variant 的 `provides` 钉成**精确单元素列表**。

### 7.3 Language 对 domain 的耦合今天有几条

Language 已经 import **五个** domain 包（`desktop-session-awareness`、`desktop-session-observe`、`repository-ci-relevance`、`repository-ci-attention`、`work-focus`），外加 `terminal-text`。但拿的只有四类：

1. owner 的结构化**事实类型**
2. owner 的**纯渲染器**
3. **Service contract 对象**
4. owner 的 **exposure 条目**

**从不拿判定函数**：`grep -rn 'judgeRelevance|detectNewFailure' src/language/` → **零命中**。这与 `contracts.ts:43-46` 的自述一致。

**结论**：`relevant ≠ salient` 这道防火墙从未被 Language 越过，加第二个 owner 本身也不会越过它——**只要拿的仍然是事实 + 纯渲染器**。

### 7.4 真正的问题不是「Language 能不能装两个 owner」，而是「第二个绑定对 `provides` 和分发做了什么」

这正是 §8 回答的。

### 7.5 模块环约束（第二轮 owner 必须重新证明，不能外推）

`src/repository-ci-attention/plugin.ts:24-29` 逐字说明为什么走 `../language/contracts.js` 而不是 barrel：`language` barrel → `express.ts` → attention barrel（取 `renderOccurrence`）→ 回 attention plugin；用 barrel 会闭合运行时环。

今天的图**无环**（`gitnexus check` → `status: "clean", cycleCount: 0, componentCount: 0`）。但——

> **「按 path import」并不自动安全。** `contracts.ts` 之所以安全，唯一原因是 `src/repository-ci-attention/types.ts` 的 import 闭包**为空**（`grep -c '^import'` = 0）。
> 换一个 owner：`src/desktop-session-awareness/types.ts:1` 就 import 了 `../desktop-session-world/index.js`（一个 **barrel**），而 `src/desktop-session-world/index.ts:3` re-export 自己的 plugin。
> 所以「叶子性」是**按 owner 逐个复核**的规则，不是一条可以照搬的规则。

**注意顺带被打破的还有 `language/index.ts:1-5` 的一句自述**：那里逐字声称「Three audiences and nothing for a fourth」。`src/repository-ci-attention/plugin.ts:30` 已经引入了**第四个**受众（兄弟 provider 读 `contracts.js`）。而 `index.ts:23-24` 记录过本仓库的惯例是「`src` 里开始有人读就给它一个 barrel 条目」——这条惯例与这次的深路径例外**没有被对齐**。§13 攻击 4 给出了完整的机制与实测数字。

---

## 8. Candidate speaking contract shapes

| 形状 | 描述 | Language 是否 import 第二个 domain | 判定 |
| --- | --- | --- | --- |
| **A** | 第二个 owner-specific Service（`language.desktop-return-speaking@1`） | 是（contracts.ts + express.ts 各一条，镜像今天的两条） | **本轮倾向** |
| **B** | 一个 Service + 封闭 union 形参 | 是，且**开始规定别人类型的形状** | **禁止**（见下） |
| **C** | owner-owned render handle | 是（要说出谁的事实就得静态 import 谁的渲染器） | **这不是新形状，就是现状** |
| **D** | 同一个 `language.speaking@1` 上加第二个方法 | 是 | 更小但权限更宽，见下 |

### 8.1 A —— 第二个 owner-specific Service

**成本**（机械化清单）：`contracts.ts` 第二个 interface + `defineService` + 第二条 domain type import；`express.ts` 第二个 `renderSpokenX`（镜像 `:137-144`）；`plugin.ts:206` 的 `provides` 由 1 → 2、`:275` 第二次 `provide`；`language/index.ts` 镜像导出；新 decider 的 plugin（镜像 attention 的 `:76/:81/:147`）；`cli/options.ts` 第二个 proactive flag + 第四条 pairing 规则；`cli/resident.ts` 加一个成员。
**会红的测试**：`test/language.test.mjs:1372`、`:1378`、`:1587-1588` 的精确列表断言。

**为什么是它**：每个 decider 只拿到**自己那一个**方法；`speak` 的签名保持窄；**没有任何地方出现 dispatch**；`contracts.ts:36-40` 的保证（renderer 是 owner 的、调用方看不到输出）逐字保留；「Provider 不决定 Consumer」不被反转。

### 8.2 B —— 封闭 union：攻击「做个 union 就行」

**失效点不是 union 本身，是 union 的判别。** N=1 时不存在这个判断（只有一个 renderer）；N≥2 时它变成一次**路由**。而两个 occurrence 都是**无判别 tag 的结构化 interface**（`src/repository-ci-attention/types.ts:30-45` 无 tag），于是只有两条路：

1. **靠字段嗅探**（`'runId' in material`）→ Language 在做「这个值属于哪个 domain」的路由判断；
2. **要求各 owner 加 tag** → Language 规定别人类型的形状，且直接撞上 `human-outbound-v0-boundary-review.md:585-586` 已划的界（「没有 priority / confidence / routing / **type tag** / expiry」「没有『这是哪种通知』的枚举」）。

同时 `plugin.ts:275` 的 `{ speak: renderSpokenOccurrence }` **必须改成 lambda**——那正是 `:271-274` 明令不留的那个 closure。

**这就是 `core-architecture-v0.md:391-404` 禁止清单里的「万能消息对象」与「所有交互必经的统一通信层」的形状**，也是 `src/language/exposure.ts:40-48` 逐字预言过的 `CalendarLanguage / MailLanguage / RepositoryCalendarLanguage` 家族。

**第三个、第四个 proactive concern 到来时的推演**：`contracts.ts` 累积 N 个 domain type import，`express.ts` 累积 N 路 dispatch，`options.ts` 累积 N 条 pairing（`:524` 逐字自称「The third pairing rule in this file, and the widest」），`resident.ts` 的加载段再拉长 N 倍。**Language 成为所有 domain type 的中央 import sink。** 触发 `plugin-design-spec.md:573,579` 的 God Object Review Trigger——清单逐字含「`requires` 快速增长且跨越多个不相关领域」与「**大量 sibling domain imports**」。

**这不是审美意见，是可测量的耦合面**（`dist` 上的直接测量，见 §13 攻击 4）：`import('./dist/language/index.js')` 的求值闭包是 **106 个模块 / 18 个包**；而 Language 自己**命名过**的 domain 包只有 5 个。另有 **10 个包**（github-ci、git-repository、human-delivery、repository-ci-world、repository-ci-awareness、chronicle、continuity、desktop-session-world、foreground、input-activity）出现在它的求值闭包里，而 Language 一个都没 import 过。

**同一份测量给出一条被漏掉的承力结构**：

> `import('./dist/language/contracts.js')` 只触发 **2 个模块**（自身 + `runtime/contracts.js`）。
> 也就是说 `contracts.ts` 是一个**值叶子**——它今天之所以能安全地被 N 个 owner 反向深路径命名，靠的正是这一点，而不是「类型被擦除」。

`tsconfig.json:12` 的 `verbatimModuleSyntax: true` 让类型导入确实零运行期边（`dist/language/contracts.js:28` 是它全篇唯一一条 import，已实测），但**「加一个 owner」从来不只是加一个类型**：它必然同时包含 `express.ts` 里一条**值**导入（`:45` 就是这条先例）与 owner 侧一条回边。**是那条值导入把 human-delivery 整包（8 个模块）拖进了 Language 的求值闭包**（`dist` 里 human-delivery 的非 cli 引入者只有 `dist/repository-ci-attention/plugin.js:22`）。

于是第 N 个 owner 到来时，`language/contracts.ts` 会成为 **N 个环的割点**，而这条不变量**今天无人看守**：`package.json` 的 test 是 `tsc && node --test`，tsc 不诊断 import 环；仓库根目录没有 eslint / dependency-cruiser / madge 的任何配置；`test/language.test.mjs:1669-1671` 的源码扫描只匹配标识符、不匹配 import 行。它目前只写在第一个 owner 自己的注释里（`src/repository-ci-attention/plugin.ts:24-29`）。

**注意触发点是 God Object Review，不是 variant guard**：variant 轴管的是「**read** capability 的第二类独立可选 domain」，proactive speaking 被**显式排除**在该轴外（两个 variant 的 `provides` 逐字相同）。这是一个容易误判的触发点。

### 8.3 C —— owner-owned render handle

**这个形状就是现状。** `renderSpokenOccurrence` 的全部 body 是「调 owner 的 `renderOccurrence` → 包成一个 `GroundedBlock` → 交给 `renderAnswer([...], null)`」（`express.ts:137-144`）。措辞完全不在 Language 手里。

所以 C 若被当新选项提出，它是在主张「保持现状」。而它的另一半是**一个载重的否定事实**：

> **不存在任何一种形状，能让 Language 说出某个 owner 的事实、同时又不静态 import 那个 owner 的渲染器。**
> 「措辞属于 owner」与「Language 不依赖该 owner」在本仓库的可达手段下是互斥的。

C 若想在字面上成立，只能变成「调用方自带 words」，即 `speak(string)`——`contracts.ts:36-40` 逐字拒绝：「A caller that supplied the lines could make Hikari say anything — that is `speak(string)` with a wrapper around it.」

### 8.4 D —— 同一契约上加第二个方法

**更小**：`provides` 保持单元素，`test/language.test.mjs:1372` 的精确断言存活，`index.ts` 不需要新增导出。多方法契约在本仓库是既成事实（`ChronicleService` = append/get/read）。

**但权限更宽**：任意持有 `language.speaking@1` 的 consumer 就**同时持有了全部 N 个 domain 的说话权**。这与本仓库把 `current()` / `peek()` 拆成两个契约的理由正相反——那一处的逐字理由是「一个整个工作就是可核查的表面，不该同时握着写它所核查内容的笔」（`src/desktop-session-awareness/contracts.ts:20-27`）。且 `language.speaking@1` 是**版本化**的，加方法是一次 v2 破坏。

### 8.5 明确禁止的候选

`speak(string)` / `speak(prompt)` / `speak(any)` / `GenericMessage` / `UniversalOccurrence` / `EpistemicPayload` / `SpeakMaterial` / `GenericGrounding` / generic prompt envelope / owner + payload dictionary / 任意 renderer callback / type-tag dispatch table。

### 8.6 一个反面事实

本仓库历史上出现过**两次**「第二个 caller」：`express.ts:44` 引入 `renderAssessment`、`express.ts:45` 引入 `renderOccurrence`。**两次都是以「导出 owner 的纯渲染器」解决的，consumer 侧一行 dispatch 都没加。** Language 内部另有三处「再多一件事」——`read.ts` 两个 reader、`plugin.ts` 两个 variant、`exposure.ts` 两份字面清单——**全部选了「再加一个具体的东西」，没有一处选了 union / table / 参数化**。

---

## 9. Speech Sovereignty

链路分工（继续冻结）：

```text
Domain  owns judgement / occurrence / deterministic owner serialization
Language owns the speaking turn / human-facing composition
Transport owns delivery
```

三条推论：

1. **Desktop Return plugin 不得自己输出 conversational prose。** `src/repository-ci-attention/plugin.ts:143-146` 逐字：「a decider that re-wrote the answer on its way to the transport would be a second expression surface, and the one nobody reviews」。`principles.md:495` 同义。**注意这条路的失败方式是静默的**：`deliver(lines)` 收得下任何 `readonly string[]`，编译通过，**没有任何测试会红**。
2. **Language 不得重新判断用户是否真的「回来了」。** 它拿到事实、说话；判断属于 decider。反过来，decider 也不得把「判断」偷偷塞进 owner renderer 之外的任何地方。
3. **Domain Plugin 不获得 user-facing speaking turn 是结构不变量**（`docs/development/language-tool-use-loop-v1.md:213-220`，由自动化测试证明）。

**§8 的 B 与 C-退化版恰好是这条不变量在出站方向上的反面**：Domain 通过通用材料/自带 words，重新获得了 speaking turn 的**内容**。它没有打破「deterministic renderer 产生 grounded answer」的字面（排版仍是确定性的），但丢掉了「**renderer 是 owner 的**」这半句——而那正是 `contracts.ts:39-40` 用来定义安全的半句。

---

## 10. Human Delivery reuse

### 10.1 模块层：**零改动**

| 证据 | 位置 |
| --- | --- |
| 形参是 `readonly string[]`，**类型本身不携带** id / 时间 / 优先级 / 来源 | `src/human-delivery/contracts.ts:43` |
| 全模块 import 只有三类：`runtime/contracts.js`、node 内建、本目录文件。**没有任何一行 import 任何 domain 模块** | 逐文件 grep |
| `requires: []`（无 client 仍 active） | `src/human-delivery/plugin.ts:50` |
| 实现是一次逐字委派 `deliver: (lines) => endpoint.write(lines)` | `:72` |
| 逐字自述：「this module does not know what it is carrying, and the lines it is handed are opaque to it」 | `src/human-delivery/types.ts:15-16` |
| 唯一的可变状态只有一个 `client` 变量；无 Set / Map / 数组 / 计数器 / 时钟读取 | `src/human-delivery/endpoint.ts:66` |
| 唯一的时间值是 `DELIVERY_WRITE_TIMEOUT_MS = 5000`，且注释逐字否认它是投递时机判断：「What it is *not* is a latency budget」 | `:43-49` |

**结论**：一个新 domain 只要 `requires: [humanDeliveryService]` 并调用 `deliver(lines)`，`src/human-delivery/` 下八个文件**一行都不用改**。这是**共享机制已经存在**的强证据。活证据：`test/repository-ci-attention.test.mjs:385-400` 在真实 Runtime 里替换该 Service 驱动 consumer。

### 10.2 但「零改动」只对模块成立

**repository-specific 的泄漏清单**（全部在**组合与命名层**）：

- `src/cli/resident.ts:362-377`——transport 与 decider **只在给了 `--proactive-ci-delay-ms` 时才进 roster**，`undefined` 直接早退；
- `src/cli/options.ts`——flag 名与帮助文本都是 Repository CI 专属；
- decider 自己的 `requires`（`src/repository-ci-attention/plugin.ts:76`）。

`src/human-delivery/` 内部：**零处**。

### 10.3 语义边界（继续冻结）

- `delivered` = **字节被写到了 socket**。不声称「人收到了 / 人读了 / 人在桌前」。
- `unavailable` = 「此刻没有 client」，不声称「以后会到 / 会被记住 / 会补发」。
- `failed` = 不声称原因、不声称可否重试。**无队列、无重试、无历史**（`contracts.ts:16-18,:36-38`）。
- 三值**都不**声称「这件事重要 / 该不该说 / 该什么时候说」。
- `handled ≠ delivered ≠ human observed`（上一轮已确立）。
- **不要修改 transport 只为了让第二个 consumer 更漂亮。没有东西需要改。**

### 10.4 一处必须记录的隐藏耦合

两个 consumer 共享**同一个 socket 槽位**。写超时会 `socket.destroy()`（`endpoint.ts:117-121`），而 close 事件清空 `client` 槽位（`:83-85`）。所以 consumer A 的一次慢写会连带销毁 consumer B 正在使用的连接，B 的下一次 `deliver` 会拿到 `unavailable` 而不是 `failed`。v0 不是缺陷，但意味着**「两个 consumer」不是两条独立通道**。

---

## 11. Memory / Chronicle boundary

**本轮仍不读 Chronicle。Desktop Return v0 优先 activation-local。**

- 先例是显式的：`repository-ci-attention` 把 `handledFailures` 留在 setup 闭包里，并明确拒绝 Chronicle 当作第二存放处；`src/work-focus/session.ts:17-19` 逐字「The history cannot restore the state」；`docs/architecture/memory-reactivation-v0-boundary-review.md:265` 把「Work Focus Chronicle history → 自动恢复 Work Focus `current()`」列为**禁止**。
- 事实补充：今天**没有任何地方读回** work-focus 的 Chronicle facts（`src/work-focus/index.ts:16-21`「Nothing reads them back」；全仓库没有 `chronicleService.read()` 的生产调用者）。
- 所以本轮明确**不做**：跨 restart 的 presence history、持久化 run 状态、从历史重建「离开多久」、把 occurrence 写 Chronicle。

**Runtime restart 后之前的 inactivity state 可以丢失。** 新 activation 第一次 observation 就是 baseline——这与 awareness 的既有性质完全一致，不需要任何新机制。

---

## 12. Salience boundary

### 12.1 先把格子摆正

`principles.md:445-469` 的链路：

```text
Observation → 事实标准化 / Contextualization → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act
```

- transition detection（`changed` / `stable` / `baseline` / `indeterminate`）属于 **Contextualization**，**不是** Salience。
- 「主动告诉用户」是 **Notify**，而 Notify 位于 Salience/Importance 的**上一格** ⇒ 走 Notify **必然穿过** Salience 格（`docs/architecture/phase-4-p4-03-entry-review.md:195`）。
- 三个等式**都不成立**：`relevant ≠ important`、`relevant ≠ salient`、`relevant ≠ should notify`（`docs/development/current-stage.md:1433,1947-1953`）。
- `Salience / Importance Judgement` 与 `Ignore / Remember / Ask / Notify / Act` **仍然均未进入，且未被预埋**（`:19,:43,:65`）。

### 12.2 用一个**固定阈值**驱动，是不是 Salience？

按仓库自己给出的判据（`docs/architecture/human-outbound-v0-boundary-review.md:265-271`）：

| 判据 | 固定 `--proactive-return-after-ms` |
| --- | --- |
| 它比较备选项吗？ | 否。它是有限次比较的合取 |
| 重要性是人类预先给的吗？ | 是。阈值由人类在命令行给出 |
| 它有「该不该打扰」的自由度吗？ | 否。无动态权重、无 learned policy、规则完全确定 |

**结论：按仓库自己的判据，一个固定阈值属于 fixed product mandate，不是通用重要性判断。** 这是一个诚实的、对设计有利的发现。

### 12.3 但仓库**没有**直接裁决「时间阈值驱动的行为 ∈/∉ Salience」

两侧措辞方向相反：

- 「**没有阈值**」被用作**否定** salience 的三条理由之一（`human-outbound-v0-boundary-review.md:269`）；
- 抑制规则（**频率 / 安静时段 / 去重 / 冷却**）被划归「⑤ 的 owner」，而该 owner 被逐字声明**今天不存在**（`outbound-composition-v0-boundary-review.md:1064,1270`）。

把任一条读成「已裁决」都是超出源码的推断。**本轮只报告两侧措辞，不制造裁决。**

### 12.4 立即停止条件

若实现需要判断「现在是不是合适的时机」「用户会不会嫌烦」「这次回来重要不重要」，**立即停止**。同样禁止：候选排序、优先级、分数、动态权重、learned policy、跨情形重要度比较。

另需注意：**vision 对「主动性」的定义本身就包含「能判断是否值得介入」**（`docs/vision/hikari-soul.md:159-189`）。所以一条纯机械的固定阈值通道**满足架构授权**（§12.2），但**不满足愿景对主动性的定义**。这两件事不矛盾，但必须并列写下来。

---

## 13. Adversarial findings

七条攻击，全部由独立子代理构造具体失败场景，并经主 Agent 重新锚定到 `file:line`。**没有 concrete failing scenario 的 finding 不进入本节。**

### 攻击 1 ——「`lastInputTick` 一变化就是 return」 ⇒ **不成立**

**失败场景**：序列 A（§3.1）——用户持续打字 3 分钟，产出 3 次 `changed` ⇒ 3 次误报，「误报率 100%」。序列 B（§3.1）是仓库自己记录的真实运行：#2 用户从未离开座位，`change=changed`。
**锚点**：`src/desktop-session-awareness/plugin.ts:48-50`；`docs/development/phase-3-desktop-session-awareness.md:356-360,367,386`；`docs/architecture/phase-3-desktop-session-awareness-architecture-review.md:357,373-385`。
**仍然成立的**：`L1 !== L2 ⇔ 该窗口内至少有一个输入事件到达过这个 session`——一条**存在性**断言。

### 攻击 2 ——「Work Focus 非空就可以主动说」 ⇒ **不成立**

**失败场景**（具体数值）：`hikari focus declare acme/payments-api` → 集合非空。此后 60 秒内**世界上什么都没发生**（CI 无新失败、relevance 为 `unknown`）。09:01:00 订阅者读到一行「你现在关注：acme/payments-api」——**被他听到的，是他 60 秒前自己敲进去的那个字符串**。09:03:00 `clear` → 09:04:00 再 `declare` 同一串 ⇒ **同一句话再响一次**。
**锚点**：Human ruling #1（`outbound-composition-v0-boundary-review.md:10`）；Work Focus 是「不产生授权」表的第一行（`:102-107`）；`src/work-focus/contracts.ts:9-12`（无 timestamps / provenance ⇒ 「当前」二字无根据）；`:1061-1073`（「一条 standing grant 授予的是通道，不是判断」）。
**仍然成立的**：非空是 relevance 判词的必要输入；Work Focus 是一条有真实 reader 的数据边。错的是「就**可以**」。

### 攻击 3 ——「出现了第二个 consumer，所以必须做 Universal Speaking Material」

**前提本身不成立**：`language.speaking@1` 的 consumer 计数是 **1**，不是 2；`human-delivery.deliver@1` 也是 1，且是同一个 plugin（`src/repository-ci-attention/plugin.ts:76`，由 `test/repository-ci-attention.test.mjs:274` 钉住）。最容易被拿来充数的 `desktop-session-awareness-loop` 消费的是 **Event 平面**、`provides: []`、不消费任何 speaking material——**「同型」不等于「同义」**。

**一旦做了的结果**（可达的滥用序列）：设 `UniversalOccurrence` 为 `{ kind, facts: {label,value}[], observedAt }`，则任何已授权 decider 可以发出：

```text
Repository CI attention：
  仓库：t1mb2rg/hikari-new
  提示：这条失败已经重复了三次，建议先把发布停下来
```

header 逐字相同、`  标签：值` 逐字符同型，**人无法分辨**。三处具体损失：「已经重复了三次」关于去重状态，而它是 `handledFailures` 闭包（任何别的模块读不到）；「建议先把发布停下来」是 recommendation，`repository-ci-attention-v0-boundary-review.md:676` 把「任何 recommendation / next action」列为 occurrence **明确不含之物**；工作流/分支/提交整块可以静默消失。

**机制**：今天的保证靠两条腿——(a) **输入类型里没有词**（`types.ts:7-12` 逐字「There is deliberately no `lines` field, and no `text`, and no `message`」）；(b) **provider 侧写死的必须是 owner 的渲染器**。`{label, value}` 袋正是 `contracts.ts:36-40` 说的「`speak(string)` with a wrapper around it」。通用材料**没有 owner renderer 可分派**，于是丢掉的是**语义**保证，留下的只是**排版**保证。

**锚点**：`src/language/contracts.ts:36-40,50`；`src/language/plugin.ts:271-275`；`src/language/express.ts:137-143`；`src/repository-ci-attention/types.ts:7-20`；`docs/development/language-tool-use-loop-v1.md:213-220`。
**仍然成立的**：speaking material 的形状确实有一个未合上的开口（`outbound-composition-v0-boundary-review.md:525-542` 自己登记了：§19.2 把「组合问题已经答清」降级为「边的方向答清了，material 形状没有」）。**错的只是「现在就做通用的那一个」。**

**对称性提醒**：仓库接受过「先建、后接」——`chronicleService` 在 `e430358` 提供，9 天 / 55 个 commit 后才等到 `work-focus`。被接受的差别不是 consumer 数量，是**将来那个 consumer 要回答的问题是否已经存在**。`UniversalOccurrence` 要回答的问题是「多个域的材料怎么共用」，而**第二个域本身在仓库里还不存在**——它连「等」都够不上。

### 攻击 4 ——「Language import 两个 domain types 没事，以后继续加」 ⇒ **不成立**

**先把命题对的那一半说清楚**（否则这条结论会被误读成「Language 不该 import 别的 domain」）：在 `tsconfig.json:12` 的 `verbatimModuleSyntax: true` 下，往 `Language` 加一条 owner **类型**导入，机械上确实产生不了新的运行期边——`dist/language/contracts.js` 全篇只有一条 import（`:28`，指向 `runtime/contracts.js`），**已实测**。若命题只读作「类型导入是免费的」，它成立。

**被反驳的是后半句「以后继续加就行」。** 三条腿：

**(a) 加一个 owner 从来不只是加一个类型。** Language 自己立的规则是「不重渲染，必须调 owner 自己的 renderer」（`src/language/read.ts:9-30`、`src/language/express.ts:11-25`），所以每次新增必然包含 `express.ts` 里一条**值**导入（`:45` 就是这条先例）与 owner 侧一条回边。**那条值导入才是重量**：`dist` 里 human-delivery 的非 cli 引入者**只有** `dist/repository-ci-attention/plugin.js:22`——一条 renderer 值导入就把整个传输包（8 个模块）拖进了 Language 的求值闭包。

**实测数字**：

```text
import('./dist/language/index.js')     → 106 个模块 / 18 个包
import('./dist/language/contracts.js') →   2 个模块（自身 + runtime/contracts.js）
```

Language **命名过**的 domain 包是 5 个；出现在它求值闭包里的另外 **10 个**（github-ci、git-repository、human-delivery、repository-ci-world、repository-ci-awareness、chronicle、continuity、desktop-session-world、foreground、input-activity）它**一个都没 import 过**。

**(b) 一个无人看守的全局不变量。** 「`language/contracts.ts` 永远保持值叶子」——N 个 owner 就有 N 条回边穿过它，它是 N 个环的**割点**。而它今天只是一句写在**第一个** owner 注释里的话（`src/repository-ci-attention/plugin.ts:24-29`）。**没有任何机械看守**：`package.json` 的 test 是 `tsc && node --test`，tsc 不诊断 import 环；仓库根目录没有 eslint / dependency-cruiser / madge 的任何配置；`test/language.test.mjs:1669-1671` 的源码扫描只匹配标识符，不扫 import 行；`test/language.test.mjs:1354-1378` 的 roster 断言只覆盖 requires/provides 名单。第 N 个 owner 只要让 `contracts.ts` 需要**任何**一个运行期值（哪怕一个判别常量），N 个环会**同时**合上——连当初正确使用叶子路径的 owner #1 也一起被拖下水。

**(c) 用 `barrel` 写法会得到一个可复现的运行期硬失败。** `docs/architecture/plugin-design-spec.md:163-165` 明文 **SHOULD** 让兄弟领域模块走 public barrel。按这个 SHOULD 接第二个 owner（`express.ts` 值导入 owner 的 `index.js`，owner 的 `plugin.ts` 从 `../language/index.js` 取契约——`cli/resident.ts:38` 先 import language、`:42` 再 import 目标 domain，这是固定的生产入口顺序），四种入口组合的实测：

```text
CASE A  root=language   owner 走叶子路径 → OK      ← 今天的代码
CASE B  root=language   owner 走 barrel   → THREW ReferenceError:
                                            Cannot access 'languageSpeakingService'
                                            before initialization        ← TDZ
CASE C  root=attention  owner 走 barrel   → OK
CASE D  root=attention  owner 走叶子路径 → OK
```

**CASE B 的失败序列**：`dist/language/index.js:61`（`export … from './answer.js'`，第 1 个依赖）→ `answer.js:82` → `express.js:43` → `repository-ci-attention/index.js:28` → `plugin.js:21-22` → 回边进已在 evaluating 中的 `language/index.js`（不重入）→ `plugin.js:59` 读 `requires: [gitHubCiService, languageSpeakingService, humanDeliveryService]` → 此时 `contracts.js` 是 `index.js` 的**第 2 个**依赖、**还没求值** → 命中 TDZ。

**CASE C vs B 说明这是一条依赖入口顺序的陷阱**：从 `cli/resident.ts` 起**必然**触发；从 owner 先起则**连测试都静默通过**。所以这条失败在 CI 上未必看得见。

**(d) 一个「全绿 CI 之下语义已被换掉」的失败模式。** 把 `speak` 的形参放宽成 union 后，`test/language.test.mjs:1372`（`provides` 精确列表）与 `:1887`（直接调 `renderSpokenOccurrence`）**都仍然通过**——union 不改变 `provides`，收窄后的 union 仍收得下原类型。**失败不表现为红灯。**

**(e) 这一次在文档里已被登记为未决，不是「没什么」。** `src/language/exposure.ts:42-48` 与 `src/language/plugin.ts:58-61` 逐字规定：第二个可独立选装的能力触发 **Composition Boundary Review**，而不是第三个 variant；`docs/architecture/outbound-composition-v0-boundary-review.md:531-536` 更逐字把「引入一个新的 occurrence 输入类型」列为**不在那一轮权限内**的两条路之一。**给 `language.speaking` 加第二个 owner 类型是一次需要显式裁决的边界变更。**

**锚点**：`tsconfig.json:12`；`dist/language/contracts.js:28`；`src/language/express.ts:44-45`；`src/repository-ci-attention/plugin.ts:24-30,76`；`docs/architecture/plugin-design-spec.md:163-169`（barrel 是 SHOULD；偏离是 path-level 可维护性问题；**REVIEW TRIGGER 说的是 import 面持续增长时该审 public surface 是否应扩展，不是继续加深路径**）；`docs/architecture/plugin-design-spec.md:573,579`；`src/language/exposure.ts:42-48`。
**证据限制**：CASE B 是一个**按 `dist` 真实 import 顺序搭建的等价模型**（评审禁止改文件），不是把源码改成 barrel 后跑出来的；模型的每个输入（依赖顺序、`requires` 在模块求值期读契约、`contracts.js` 是值叶子）都逐条对过 `dist` 原文。闭包数字（106 / 2）与「human-delivery 的唯一非 cli 引入者」是 `dist` 上的**直接测量**。

### 攻击 5 ——「Desktop Awareness 报 changed 就可以直接当 return」 ⇒ **不成立**

同 §3.3。具体三个场景：用户在场全程用电脑（`changed`，仓库实测记录）；用户整段不在场但窗口标题自己变了（`changed`）；来源报告形态抖动 `omitted → null`（`plugin.ts:32-37` 刻意用 `===`，`undefined !== null`）。
**附加**：loop 每轮 `catch {}` 吞掉失败 ⇒ **静默停摆也会被误读成「用户一直没回来」**。
**锚点**：`src/desktop-session-awareness/plugin.ts:32-37,48-50,59`；`src/desktop-session-awareness/types.ts:7-10`；`src/desktop-session-awareness-loop/plugin.ts:86-92`；`docs/development/current-stage.md:417`。

### 攻击 6 ——「用 wall clock − `lastInputTick` 就能得到 idle 时长」 ⇒ **不成立**

**失败场景**：`W − L = B + I ≈ 1.79e12 ms ≈ 56.73 年`；真值 5 分钟；信噪比 ≈ 6.0e6。按 uint32 截断得 ≈ 41.1 天。
**一处必须并列的巧合（防止把「从不成立」写成过头话）**：`(W − L) >>> 0 = (B + I) mod 2³²`，当且仅当 `B ≡ 0 (mod 2³²)` 时精确等于 `I`——即开机时刻恰好在 Unix epoch 之后 2³² ms 的整数倍上，**每 ≈49.71 天出现一次**，误差在 ±5 分钟内仍小于所声称的 idle 值。不截断时则**从不**接近正确（要求机器在 Unix epoch 开机）。
**顺带否掉一个替代品**：不能用 `process.uptime()` 冒充「当前 tick」——它的基准是 Node 进程启动而非系统启动，一个跑了 2 小时的 runtime 在 5 分钟 idle 下会算出 **−2,517,000 ms**。
**锚点**：`src/input-activity/windows.ts:19-32,126-135`；`src/input-activity/types.ts:3-7`；`docs/development/phase-3-input-activity.md:107,307`；`docs/architecture/phase-3-input-activity-architecture-review.md:446`；`src/desktop-session-observe/presentation.ts:101-104`。

### 攻击 7 ——「Human Delivery 已经泛化成功，所以整个 proactive 架构也已泛化成功」 ⇒ **不成立**

**失败场景（逐段核验，不是假想）**：新 decider 沿用 `src/repository-ci-attention/plugin.ts:147` 那一行 `await delivery.deliver(speaking.speak(occurrence))`，而它的 occurrence 与 `RepositoryCiAttentionOccurrence` **零字段重合** ⇒ `speak` 的形参类型不匹配。三条出路：

1. decider 自己渲染 lines 再 `deliver` ⇒ 编译通过、**没有任何测试会红**，但把表达层删掉了（`principles.md:495` 点名的失败态）；
2. 放宽 `contracts.ts:50` 的形参为 union 并在 `express.ts` 分派 ⇒ 最短路径，且**全绿 CI 之下语义被换掉**（见攻击 4）；
3. 加第二个方法 ⇒ 直接承认 Language 被改了，且是 v2 破坏。

**没有第四条出路。**

**机制**：domain 专用性没有被消除，只是被**上推**了一段。transport 弃权的每一件事都在上游被决定了——`deliver` 的类型里没有 domain 引用，恰恰因为它**看不见**生产者（lines 的生产者是 Language，不是 decider）。

**逐段结论**：

| 段 | 是否已泛化 |
| --- | --- |
| perception / judgement / occurrence 类型 | 是 domain 自己的；新 domain 新写一份属正常 |
| **`language.speaking@1` 的形参类型 + 唯一静态绑定** | **没有——这是全链唯一把某个 domain 的私有类型写进公共契约的地方** |
| `deliver` + transport | **真正泛化了**（`requires: []`、零 domain import、一次委派） |

**所以「DESKTOP RETURN ATTENTION v0」的设计问题不是「要不要新建一个 decider」，而是「Language 的 speaking contract 如何容纳第二个 domain」。**
**仍然成立的**：transport 一半是真泛化，不是巧合；consumer 侧的授权边（`requires`）不需要改，composition 只多加载一个成员。
**一处限制**：「已经泛化成功」这句话在 `docs/` 与 `src/` 里**没有逐字出处**（`grep -rn "泛化成功\|已经泛化\|已泛化" docs src` 为空）。被检验的是这条**推断**，不是某段已冻结的文本。

---

## 14. Smallest proving ground

```text
Input Activity / Desktop Awareness (既有，零改动)
      ↓
Desktop Return bounded judgement   ← 本轮 BLOCKED 的位置
      ↓
DesktopReturnOccurrence
      ↓
Language speaking
      ↓
Human Delivery (既有，模块层零改动)
      ↓
Human
```

Work Focus 只作为**事实输入**（非空检查），不产生任何授权。

**明确不创建**：User Presence Service / Away State / Proactivity Service / `Attention<T>` / Notification framework / Scheduler framework / generic temporal reasoning / Central Salience / Importance Service / Attention Registry / Global Proactivity / 通知账本 / `deliveredAt` / ack 状态 / 跨 repository 排序。

---

## 15. Smallest implementation slice

**如果 §17 的解锁条件被满足**，最小切片如下（**本评审不实施**）：

| # | 变更 | 镜像的既有先例 |
| --- | --- | --- |
| 1 | 新建 `src/desktop-return-attention/`（types / judgement / contracts / index / plugin） | `src/repository-ci-attention/` 的结构 |
| 2 | decider 骨架逐行复制 cadence 骨架（`MAX_TIMER_DELAY_MS` 本地副本、`parseConfig` 只收整数 `delayMs`、单 arm、`stopped` 双检查、空 `catch`、`finally` 重排程、`scheduleCycle(0)`、deactivate 三步收敛） | `src/repository-ci-attention/plugin.ts:8-20,39-44,103-158` |
| 3 | 输入接 assessment：**订阅 `desktopSessionAwarenessAssessedEvent`**（而不是 `requires: [desktopSessionAwarenessService]`，见 §4.3） | 全仓库**没有**先例——这会是第一个生产 Event 订阅者，需要独立设计决定 |
| 4 | 判词实现 §3.4 的 A–E 规则，输出的 occurrence **不含**任何人类可读句子 | `src/repository-ci-attention/judgement.ts` + `types.ts` 的「无 lines/text/message」论证 |
| 5 | Language：**形状 A**——第二个 owner-specific Service + 第二个 `renderSpokenX` + `provides` 变两项 | `src/language/contracts.ts` / `express.ts` / `plugin.ts` |
| 6 | 新 flag（名待定，示例 `--proactive-return-after-ms`）必须是**独立**的显式配置，且与 speaking 的 pairing 规则成立 | `src/cli/options.ts` 的三前提 pairing |
| 7 | `src/cli/resident.ts` 加第 6 个组合成员；`humanDeliveryPlugin` 的加载条件不能再只看 `proactiveCiDelayMs` | `src/cli/resident.ts:362-377` |

**必须一起改的测试**（否则会红）：

- `test/language.test.mjs:1372`、`:1378`、`:1587-1588`——`provides` 精确列表断言；
- `test/desktop-session-awareness.test.mjs:851-859`——若走 `requires: [desktopSessionAwarenessService]` 则红（走 Event 则不红，但那条断言的存在本身说明这是一条被守着的边）；
- `test/resident-cli.test.mjs:131`——「默认生产组合恰好是这九个成员，按加载顺序」。

**若走形状 A，必须同时补一条今天不存在的机械看守**（否则第二个 owner 会静默地给 N 个环埋下割点）：把「`language/contracts.ts` 的运行期依赖集必须恰好是 `{runtime/contracts.js}`」写成断言——它今天可测（`dist/language/contracts.js:28` 是全篇唯一一条 import），且是 §13 攻击 4 (b) 指出的那条无人看守的不变量。

**明确不做**：不改 `src/human-delivery/`；不改 `src/input-activity/`（该目录文件列表被 `test/desktop-session-awareness-loop.test.mjs:528,532` 钉成恰好 7 个）；不给 awareness / world / relevance 加 baseline 或变化检测；不建共享 loop 抽象（仓库先例是**复制骨架**，不是抽公共抽象）；**不为第二个 owner 把 owner 侧回边从叶子路径改成 barrel**（`plugin-design-spec.md:163-165` 的 SHOULD 在这一处与「不形成环」正面相抵，CASE B 是它的硬失败）。

---

## 16. What must NOT be generalized

**Language / speaking 面**：`speak(string)`、`speak(prompt)`、`speak(any)`、`SpeakMaterial`、`GenericGrounding`、`EpistemicPayload`、`UniversalMessage`、`UniversalOccurrence`、`GenericMessage`、generic prompt envelope、owner + payload dictionary、任意 renderer callback、type-tag dispatch table、第二个 `language.*` variant、把 `speak` 的形参扩成开放 union。

**同时不得松动的一条**：`src/language/contracts.ts` 必须保持**值叶子**（运行期依赖恰好是 `{runtime/contracts.js}`）。它是所有 owner 回边穿过的割点；一旦它长出运行期依赖，N 个环会同时合上（§13 攻击 4 (b)）。**也不得为了让第一个 owner 的写法看起来更「规范」，把 owner 侧回边从叶子深路径改成 barrel**——`plugin-design-spec.md:163-165` 的 SHOULD 在这一处与「不形成环」正面相抵，CASE B 证明它是一次运行期 TDZ 失败。

**感知 / 时间面**：Presence / Away / UserState / `isIdle` / `isAway` / `userPresent` / `userAway` / `idleFor` / `lastInputAt` / `idleForMs` / `idleSeconds` / 任何阈值比较；tick → 墙钟换算；tick 的减法 / `>` / `<` / 回绕修正；`process.uptime()` 冒充当前 tick；观察来源过滤；通用 Perception / Sensor 框架；通用 temporal reasoning / Scheduler framework。

**判断 / 注意力面**：Central Salience、Importance Service、Attention Registry、`Attention<T>`、`Notification<T>`、Global Proactivity、Global Notification Brain、Central Judgement、GlobalWorldState、Generic Notification Service、通知账本 / `deliveredAt` / ack 状态、跨 repository 排序或优先级、severity 分级、抑制规则（频率 / 安静时段 / 冷却）——后者今天**没有 owner**，本轮不为它建任何东西。

**状态 / 持久化面**：跨 restart 的 presence history、durable away state、把 return occurrence 写 Chronicle、把 run 状态写文件、给既有 awareness / relevance / world 加 baseline 或变化检测。

**组合面**：User Presence Service、Proactivity Service、共享 cadence loop 抽象、generic envelope 通信层、让 provider 侧持有「谁被授权」的平行名单。

---

## 17. Verdict

# BLOCKED

### 17.1 主阻断

```text
docs/development/current-stage.md:1434
（所在小节：docs/development/current-stage.md:1400 「## 当前明确仍不做」）

- **Input Activity 的在场解读**——`lastInputAt` / `idleForMs` / `idleSeconds` / `isActive` /
  `isIdle` / `userPresent`，以及任何阈值比较。`lastInputTick` 是 source fact，不是结论；
```

§一 链的第一环是 `input inactive >= threshold`。那是**施加在由 Input Activity 导出的量上的阈值比较**。它被这条逐字禁止两次：一次被**点名**（`idleForMs` / `idleSeconds` 就是那个导出的量），一次被**兜底子句**（「以及任何阈值比较」）。

**三条独立佐证**：

1. `docs/development/current-stage.md:1185`——「单次 observation 本身不提供 idle duration —— **这是冻结边界，不是缺陷**」；
2. `docs/development/current-stage.md:1676-1677`——`user presence`、`idle / away` 逐字列在「Phase 3 明确未证明」清单；
3. 两个模块的**禁用词扫描测试**把这个词汇表做成了会失败的断言：`test/desktop-session-awareness.test.mjs:600-618`（`isIdle` / `isAway` / `userPresent` / `userAway` / `idleFor`）与 `test/desktop-session-awareness-loop.test.mjs:480-505`（另加 `salience` / `importance` / `priority` / `notify` / `memory` / `action` / `health`）。

**比词汇表更强的一条语义佐证**：仓库已经对「`changed` / `stable` 是关于观测值的陈述、不是关于世界的陈述」上了锁（`docs/architecture/phase-3-desktop-session-awareness-architecture-review.md:338-361`；`docs/development/current-stage.md:417`）。§3.4 推导出的、唯一诚实的量，**恰好就是这样一条关于世界的陈述**。

**注意：改名不解除禁令。** 把 `idleForMs` 叫成 `returnAfterMs` 不改变它所指的量；把阈值从毫秒改成「连续 K 个样本」也不改变语义，只是换了个单位。这与本轮开头把 `announced` 改成 `handledFailures` 是同一条纪律的另一面：**变量名不得声称语义没有的东西；反过来，语义受禁也不得靠改名绕过。**

### 17.2 三条次级阻断

1. **§6**——这个 mandate flag 的**值**必须是一个在 observation-based inactivity 上的阈值，也就是 17.1 禁止的那个量。这不是「再加一个 flag」的规模问题，是它能不能被**诚实定义**的问题。
2. **§5**——「Work Focus 非空」不产生 interruption authority（Human ruling #1 + 「不产生授权」表第一行）。§一 链把它当作一个前提，这是可以的；但把它当作任何一环的授权，就与冻结裁决逐字相反。
3. **§2 / §3**——即使撤掉禁令，机制本身在今天也**不完整**：没有 tick ↔ 墙钟换算、没有「当前 tick」字段、回绕周期从未被写下、单次观测在原理上给不出 idle。

### 17.3 解锁条件（每一条都是 Human 行为，不是实现选择）

1. **对 `current-stage.md:1434` 的一次 Human 裁决**——明确解除或收窄该条，使其覆盖「在 wall-clock 窗口上观测到输入的缺席」这一个具体量；同时**规定命名**：只能说 *observation-based inactivity*，**不得**说 OS-reported idle、**不得**说 presence / away / return。
2. **对 mandate 形状的一次 Human 裁决**——确认它是一个**独立于 `--desktop-awareness-delay-ms` 的显式配置**，且其值就是那个阈值（§6）。
3. **对第二条授权边的一次 Human 裁决**——第二个 consumer 的授权来自哪个 flag，以及它是「一个新 flag」还是「放宽既有 flag」。（`outbound-composition-v0-boundary-review.md` 已把这一判断显式留给 Human。）
4. **对 Language 契约形状的一次裁决**——本文**建议 A**（第二个 owner-specific Service），但本评审**无权冻结**它；B 与 D 都需显式否决或接受的记录（§8）。**这次裁决必须一并处理两件被登记为未决的事**：`outbound-composition-v0-boundary-review.md:531-536` 把「第二个 owner 类型」列为不在那一轮权限内的边界变更；以及 §13 攻击 4 新发现的那条无人看守的不变量（`contracts.ts` 必须保持值叶子 + owner 侧回边只能走叶子深路径，而 `plugin-design-spec.md:163-165` 的 SHOULD 说的是相反的话）。

### 17.4 本评审**没有**阻断的部分（已由本文确立，不因 BLOCKED 而失效）

- **机制**：§3.4 的最小 activation-local 规则是诚实的——只做 wall-clock 减 wall-clock，tick 只用 `===`，**从不** `observedAt − lastInputTick`。解锁条件 1 若被满足，它可以直接用。
- **`human-delivery` 零改动复用**（模块层），泄漏点被精确定位在组合与命名层（§10）。
- **Salience 判定**：按仓库自己的判据，一个**固定阈值**是 fixed product mandate，不是通用重要性判断（§12.2）。
- **Language 形状建议 A**（§8.1），以及「B 就是被禁止的万能消息对象 / C 就是现状 / D 更小但权限更宽」这三条判定。
- **一个结构事实**：`desktopSessionAwarenessAssessedEvent` 今天 **0 production subscriber**，且 `src/` 下**没有任何插件订阅过任何 Event**。第二个 proactive consumer 若走这条路，会成为**全仓库第一个生产 Event 订阅者**——这是一条需要独立设计决定的边（`docs/development/current-stage.md:1640`），不是一条可以顺手长出的边。
- **一条此前没被写下来的承力结构**（§13 攻击 4）：`language/contracts.ts` 是**值叶子**（`dist/language/contracts.js:28` 实测全篇只有一条 import，指向 `runtime/contracts.js`），它是所有 owner 回边穿过的**割点**；而这条不变量**今天只有一句注释看守**——tsc 不诊断 import 环，仓库无 eslint / dependency-cruiser / madge 配置，现有源码扫描测试只匹配标识符。配套的实测耦合面：`dist/language/index.js` 求值闭包 **106 模块 / 18 包**，其中 **10 个包 Language 从未 import 过**。

### 17.5 与既有裁决的一致性检查

| 冻结项 | 本评审是否越线 |
| --- | --- |
| R3（Domain speaking authority 两条合取） | 未越线——§6 要求独立 mandate，§5 拒绝 Work Focus 授权 |
| R4（禁止现在创建 SpeakMaterial / GenericGrounding / EpistemicPayload / UniversalMessage / generic prompt envelope） | 未越线——§8.5 逐条列入禁止 |
| Human ruling #1（Work Focus / repository scope 不承担 interruption authority） | 未越线——§5.3 逐字引用并据此否决攻击 2 |
| `relevant ≠ salient` 等三个等式 | 未越线——§12 只做格位归属判定，并明确报告「时间阈值是否属 Salience 在仓库里无裁决」 |
| 「不为没有 reader 的判词发布 contract」 | 未越线——§8 只比较形状，不发布 contract |
| 「不创建 P4-04，不开始 Salience research」（`current-stage.md:1967`） | 未越线——本轮是边界评审，不是 salience 研究，也不产生新 phase |

---

## 附：本评审的证据限制

- **只读**。没有执行任何测试、构建或进程。「某条测试会红」是从测试源码读出的结论，**不是执行观察**；`dist/` 只被**读取与求值闭包测量**，没有被重新构建。
- 攻击 7 里的类型不匹配（`speak` 形参）是从类型声明读出的，**没有编译过任何东西**。
- 攻击 4 里的 CASE A–D 是**按 `dist` 真实 import 顺序搭建的等价模型**（评审禁止改文件），不是把源码改成 barrel 后跑出来的。攻击 4 的两个闭包数字（106 / 2）与「human-delivery 的非 cli 引入者只有一个」是 `dist` 上的**直接测量**。攻击 6 与攻击 2 里的具体数值是**手算**，不是运行观测。
- **本机没有可访问的真实模型 endpoint**，任何「模型会/不会认为某事件值得打扰」的验证在本机 **NOT RUN**，不得写成 PASS。
- 13 个子代理（6 调查面 + 7 对抗面）**全部完成、0 错误**；其结论均为**候选**，本文每一条 finding 都已由主 Agent 重新锚定到 `src/` 源码行、测试行、文档行或 `dist/` 实测。仍属推断的条目已在正文中标注为推断（`kind: "inference"`）。
- 子代理报告了两处**文档与实现不一致**，一并记录以免后续引用踩坑：
  1. `docs/development/phase-3-input-activity.md:263` 仍在描述一条**已被删除**的 smoke 断言（真实 tick 推进不快于墙钟）；`test/input-activity-windows.test.mjs:62-80` 明确写着该前提是假的、因此删除而非放宽。
  2. 同文 `:255` 与被删测试引用的 diagnostic 来自那个已删除的测试。
- 子代理另报告了两处**已被后续 slice 推翻、不可再引用的旧冻结项**（引用时必须只引最新裁决）：`docs/architecture/phase-4-explicit-work-focus-review.md:145` / `:209` 曾把 `work-focus.current@1` 列入严禁创建，今天已 provides；`docs/architecture/outbound-composition-v0-boundary-review.md` 正文 §17.2 / §19 的 BLOCKED 措辞已被同文 R1 覆盖，引用时只引 R1 与 ruling #1/#2。
