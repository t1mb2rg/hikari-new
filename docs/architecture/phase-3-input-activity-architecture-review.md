# Hikari 第三阶段 P3-02 Input Activity Perception v1 Architecture Review

> 结论：**P3-02 Architecture Review: PASS**（P3-02 Functional PASS + Architecture PASS）
>
> 范围：单个自治 Plugin `input-activity.windows`，经由 `input-activity.current@1` 提供一次真实 Windows last-input observation。
>
> 上位原则：`core-architecture-v0.md` §12.2「Runtime 负责机制，不理解领域意义」与 `principles.md` §14「Perception ≠ Awareness」。本轮没有新增第二套架构原则。
>
> 本文按既有惯例把 Functional Review 作为 §1；P3-02 不单独拆出一份 Functional Review 文件。

## 1. Functional Review

以下每一条都由当前未提交的真实文件、真实测试或真实 Windows 运行支撑，不是设计意图的转述。

- Runtime 可以加载一个 `requires: []` 的自治 Plugin，并通过依赖图把 `input-activity.current@1` 交给消费者；
- 一次 `current()` 执行一次**真实** Windows acquisition，返回真实的 32 位 last-input tick；
- 每次调用都是一次新的真实获取，没有缓存、没有复用、没有去重；
- `setup`、空闲、`shutdown` 期间**零后台观测**；
- `dwTime = 0` 是合法观测值，被原样报告，不被当作缺失；
- uint32 两端边界（`0` / `1` / `4294967295`）保持，不被夹取、不被换算；
- 一个**较小的后续 tick** 被如实报告，不被单调化修正；
- `observedAt` 在 acquisition 侧产生，父 Node 进程只透传、不重打；
- `source` 正确且独立于 Plugin ID 常量；
- observation 被冻结；
- 获取失败**拒绝**，绝不 resolve 成一个哨兵值；
- 意外错误同样拒绝，不伪装成有效 observation；
- 不依赖 Continuity、Chronicle、Foreground；
- 观测不触碰 Continuity 与 Chronicle 的任何持久字节；
- Foreground 与 InputActivity 可以**并列存在**，互不干扰；
- 非 win32 宿主上生产 Plugin `failed`、消费者 `waiting`，且 Runtime 不参与该判断；
- 真实 Windows acquisition 成功；
- 飞行中的 acquisition 在 shutdown 时被真实拆除。

真实观测样例（本机 Windows 11）：

```json
{
  "observedAt": "2026-09-17T08:07:26.378Z",
  "source": "input-activity.windows",
  "lastInputTick": 650025625
}
```

同一次 `npm test` 的 diagnostic 输出：

```text
wall clock: loadPlugin 1ms, current() 523ms
first 650026000 -> second 650026562, delta 562ms over 912ms of wall clock
shutdown with an acquisition in flight: 2ms
teardown rejection: Input activity observation failed: the acquirer was disposed mid-observation.
```

本地测试：**137 / 137 PASS，0 skipped**（16 个 InputActivity 确定性 + 3 个 Windows 真实 smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。

编译：`npx tsc -p tsconfig.json --noEmit` 无错误。

**Functional PASS。**

有一项**必须与结论同时阅读**的限制，见 §14 与 §17.1：每次 `current()` 启动一次 PowerShell 进程并执行 `Add-Type`，本轮实测 523 ms。它是 v1 冻结时就接受的实现限制，不是缺陷，但它决定了 Input Activity 与 Foreground 一样，目前只能是被显式调用的能力。

## 2. Runtime 边界：Runtime 仍然只理解机制

`git diff HEAD --stat -- src/runtime/` 为空，逐字节未修改。

对 `src/runtime/` 检索 `input-activity` / `InputActivity` / `GetLastInputInfo` / `lastInputTick` / `LASTINPUTINFO`：**零命中**。

Runtime 至今不知道 Windows 存在，也不知道什么是输入活动。P3-02 **没有**要求 Runtime 增加任何 platform branch、Manager 或测试 seam——Runtime 一行未改。

需要注入假 acquirer 时，走的仍是 P3-01 确立的第三条路径：`createInputActivityPlugin(createAcquirer)` 接收**工厂**而非实例，测试直接 import `dist/input-activity/plugin.js` 传入假工厂。被拒绝的仍是同样的两条捷径：

```text
给 Runtime 加测试用注入点              ← 修改已冻结的公开表面
让 PluginDefinition 支持测试专用字段   ← 污染所有 Plugin 的类型
```

**PASS。**

## 3. Continuity / Chronicle 边界

两者的 `git diff HEAD --stat` 均为空，逐字节未修改。

`src/input-activity/` 对 Continuity、Chronicle 的检索**零命中**：没有 import、没有调用、没有类型引用。

有一条测试直接验证这一点：在一个**同时加载了 Continuity 与 Chronicle** 的 Runtime 里连续执行两次观测，整棵存储树的**文件集合与逐文件字节**在观测前后完全一致，且服务关闭后仍然一致；文件集合恰为 `continuity/origin.json` 与 `chronicle/chronicle.jsonl`，没有第三个文件被创建。

> InputActivity 能独立收敛，不依赖这两个领域，也不改写它们的状态。

**PASS。**

## 4. Foreground 并列与独立 Perception（本阶段的主要架构结果）

本阶段真正证明的架构主张是下面这张图可以成立，**而不是**需要一张新的图才能成立：

```text
Runtime
├─ Continuity
├─ Chronicle
├─ Foreground
└─ InputActivity
```

逐项由代码与测试支撑：

```text
互不 requires      foregroundPlugin.requires === [] 且 inputActivityPlugin.requires === []
互不调用           全 src/ 中 "input-activity" 只出现在 src/input-activity/ 的 4 个文件内
互不持有内部对象   两者只通过各自的 Service 契约暴露能力，无共享对象
Runtime 不协调二者 两者同时加载时各自独立 active，无第三方参与
没有 PerceptionManager  全 src/ 零命中
```

有一条测试专门承载这条主张：**两个感知同时加载、同时有消费者、各自独立收敛**。宿主为 win32 时两者都 `active`，且各自返回的 `source` 不同（`foreground.windows` / `input-activity.windows`）；宿主非 win32 时两者都 `failed`，且**各自以自己的错误类型失败**，任一方的失败不干扰另一方。

因此：

> **多个自治 Perception Plugin 可以并列存在，而无需中央 Perception Manager。**

这是 P3-02 的主要架构结果之一，也是它相对 P3-01 的真正增量：P3-01 证明了一个感知可以存在；P3-02 证明**第二个感知不需要先长出协调层**。

反过来说，本阶段也明确**没有**因为出现了第二个感知就补建抽象——见 §16。

**PASS。**

## 5. Perception fact 边界：witness 仍然是 witness

对 `src/input-activity/` 的**全部 7 个 `.ts` 文件**检索以下 token：**零命中**。

```text
idle  active  away  presence  attention  working
userPresent  isActive  isIdle  user state  classification
World  Awareness  Judgement  Salience  importance  freshness
model  LLM  llm
```

同一组 token 也对编译产物 `dist/input-activity/` 的全部 7 个 `.js` 文件扫描过（一次性探针 E3），同样零命中。这一步是必要的：源码与产物都扫过，才能排除「源码干净但构建过程注入」。

`src/input-activity/` 对 `node:fs` / `writeFile` / `appendFile` / `mkdir` / `createWriteStream` 的检索同样零命中——没有 Chronicle 写入，没有任何持久化。

**采集侧同样保持沉默**：PowerShell 脚本里除 `GetLastInputInfo` 之外没有任何判定逻辑——不比较阈值、不计算差值、不做单位换算、不做启发式回退，`dwTime` 被读出来就直接进结果。

固定原则：

> **Perception records what the source says, not what Hikari concludes from it.**

`lastInputTick` 是一个 **source fact**。以下都**没有**进入 Perception，也**不应当**进入：

```text
lastInputAt      idleForMs      idleSeconds
isActive         isIdle         userPresent
```

需要特别说明一处**不是**污染的情况：文档与测试描述中出现的 `idle` 一词（例如「空闲时不产生后台观测」）描述的是**调用方的行为**，不是被计算的领域语义。判断依据是**生产源码**，不是文档措辞。

> **现实很奇怪就报告奇怪的现实。** 一轮输入都没有，或者 tick 恰好很小，都是现实，不是需要被修正的东西。

**PASS。**

## 6. Pull-only：没有后台机制

契约上只有：

```ts
current(): Promise<InputActivityObservation>
```

没有 `changed`、没有订阅、没有队列、没有速率限制、没有轮询、没有预热、没有保活。

对 `src/input-activity/` 检索 `defineEvent` / `emit(` / `subscribe` / `setInterval` / `setTimeout` / `watch`：**零命中**。

「无后台观测」由测试以**计数**方式断言：Plugin 加载后、空闲 50 ms 后、shutdown 后，假获取器被调用次数始终为 **0**；另有一条测试断言 `setup` 期间即 `disposes` 也为 0。真实路径上的数量级差是旁证：

```text
loadPlugin ≈ 1 ms
current()  ≈ 523 ms
```

如果 `setup` 做任何观测，这两个数字会接近。

**PASS。**

## 7. 没有引入持久化

`src/input-activity/` 不写任何文件，不创建任何目录，也没有自己的存储格式（检索见 §5）。

InputActivity 不写 `origin.json`、不写 `chronicle.jsonl`、不追加任何 Fact。观测到的 tick **不进入事实史**——「什么值得长期记录」的判断不属于感知层。

**PASS。**

## 8. 没有引入 World / Awareness / Judgement 或任何新 Manager

`World` / `Awareness` / `Judgement` / `ObservedValue` / `Sensor` / `Manager` 在 `src/input-activity/` 零命中。

没有 `ProcessManager` / `WorkerManager` / `ResourceManager` / `LifecycleManager`，也没有通用 Observation 框架或通用传感器抽象。资源归属沿用 Runtime 既有的 `context.defer()`（§11）。

**PASS。**

## 9. 公开面没有为测试扩大

冻结的公开表面恰好 6 个符号：

```ts
inputActivityService      InputActivityService
inputActivityPlugin       InputActivityObservation
InputActivityError        InputActivityObservationError
```

**不在**公开面上的：`createInputActivityPlugin`（内部工厂）、`InputActivityAcquirer` / `InputActivityAcquisition`（内部 seam）、`createWindowsAcquirer`（平台实现）、`InputActivitySource`、Win32 细节、PowerShell 常量、parser helpers。

比 P3-01 少一个符号，是结构差异而非疏漏：Foreground 需要公开 `ForegroundTarget` 联合类型（`absent` / `present` 两态各有自己的形状），而 InputActivity 的 observation 是三个原始字段，没有需要公开的嵌套类型。`InputActivitySource` 与 `ForegroundSource` 一样不导出——它是观测值的内部标签，不是调用方需要拼写的类型。

测试通过**唯一一处具名例外**取得内部 seam：

```js
import { createInputActivityPlugin } from '../dist/input-activity/plugin.js';
```

这条取舍有代价，且代价被如实计价：`windows.ts` 内部的输出解析与失败分类**因此不在仓库测试套件内**（见 §15）。不接受的做法是为了补这些断言而把 seam 导出成生产 API——**test seam 不应仅仅为了测试习惯而变成领域契约**。

**没有因为 parser coverage 再扩大公开 API，也没有增加第二处内部 import。PASS。**

## 10. 平台知识仍归 Plugin 所有，Runtime 保持平台无关

全 `src/` 中 `process.platform` **只出现两处**：

```text
src/input-activity/windows.ts:45   ← P3-02 新增
src/foreground/windows.ts:73       ← P3-01
```

两处都不在 `src/runtime/`。检查发生在 `createWindowsAcquirer` 内，而 `plugin.ts` 的 `setup` 通过工厂 `createAcquirer()` 调用它——因此每次 `setup` 恰好执行一次，且 `plugin.ts` 本身不含字面检查。

- win32：正常 `provide`，Plugin `active`；
- 非 win32：`setup` 抛 `InputActivityError` → Runtime 置 `failed` → 消费者停在 `waiting`。

**`setup` 中不探测**：真实 input 状态、PowerShell 是否可用、桌面 session、权限、`GetLastInputInfo` 运行时是否成功。这些属于**运行时观测失败**，不属于**启动前提**。

判断归属是刻意的：**Runtime 不理解 Windows 是冻结边界，而「我的实现能否在当前宿主上工作」是 Plugin ownership 的内部问题。** 反过来，如果 Plugin 在明确无法工作的宿主上仍然宣称 `active` 并广告 capability，平台知识就会泄漏给每一个消费者——它们将不得不各自判断「这个 capability 现在到底能不能用」。

P3-02 没有改变这条归属，只是把它**复制到了第二个 Plugin 上**，并因此获得了一条 P3-01 无法获得的证据：两个平台 Plugin 各自独立拥有自己的平台判断，Runtime 侧仍然零判断。

**PASS。**

## 11. 资源所有权沿用既有 EffectScope

没有新建任何资源管理机制，沿用 Runtime 既有的 `context.defer()`：

```ts
setup(context) {
  const acquirer = createAcquirer();
  context.defer(() => acquirer.dispose());
  context.services.provide(inputActivityService, Object.freeze({ current: ... }));
}
```

逐项确认：

```text
acquirer setup 内构造          ✓ 工厂在 setup 内调用，模块导入时不构造
dispose 后 acquire 拒绝        ✓ 抛 InputActivityObservationError
in-flight child 被 kill 并等待 close  ✓
无 orphan helper               ✓ 真实 teardown 后 shutdown 2 ms 内完成，不挂起
disposed-mid-observation 不被误报 timeout  ✓ 消息为 "the acquirer was disposed mid-observation"
```

**P3-01 已发现的 teardown bug 在 P3-02 中没有重新出现。** 这一点是**刻意保留**而非偶然：`execFile` 回调里 `disposed` 标志的判断被写在 `describeFailure` **之前**，因为被 `dispose()` 杀死的子进程同样会带上 `error.killed === true`——若先走 `describeFailure`，就会把 shutdown 描述成 `did not finish in time`，让人去追一个从未发生的超时。

这条路径在 P3-02 **有持久回归覆盖**（不是靠探针）：Windows smoke 的第 3 条断言拒绝为 `InputActivityObservationError`，**且消息不得包含 `did not finish in time`**。P3-01 的同一个 bug 正是因为没有覆盖才活下来的；P3-02 从第一版起就带着这条断言。

**PASS。**

## 12. observedAt 的产生方与 source 的定义方式

**`observedAt` 表达的是 `GetLastInputInfo()` 返回成功的那一刻**，不是调用开始、不是 Promise resolve、也不是「最后一次输入发生的时刻」（那是 `dwTime`，一个不同轴的量）。

脚本内顺序（`src/input-activity/windows.ts:27-32`）被固定为：

```text
$info.cbSize = Marshal::SizeOf($info)
↓
GetLastInputInfo([ref]$info)          ← 核心获取
↓
$observedAt = [System.DateTime]::UtcNow   ← 在此产生
↓
$lastInputTick = [uint32]$info.dwTime      ← 读取 struct 快照
```

`observedAt` 与 `lastInputTick` 因此来自**同一次快照**：tick 是调用返回的那个 tick，时间戳是紧接其后取的。父 Node 进程只做透传，**不在 child process 返回后重新生成** `observedAt`。测试以「注入一个远早于当前时刻的历史时间戳，断言返回的正是该值」来固定这条语义。

**`source` 独立于 Plugin ID 定义**：它写在 `acquisition.ts` 的 `OBSERVATION_SOURCE` 常量里，是一个独立字面量，不引用 `plugin.ts` 中的 `id`：

```ts
const OBSERVATION_SOURCE: InputActivitySource = 'input-activity.windows';
```

两者取值相同是事实，来源相同则不是。这样 Plugin 改名不会静默改变已经发出的观测的 `source`。这条不变量有一个可测的后果：即使 acquirer 返回的对象上带了伪造的 `source` 字段，它也不可能到达 observation（探针 E2 断言）。

并且 `source` 是**在 observation 边界上补充**的，不在 seam 之下：平台 acquirer 因此无法谎报自己的来源。

**PASS。**

## 13. GetLastInputInfo 的事实语义（含「没有 absent 分支」）

这是 P3-02 与 P3-01 **最尖锐的不对称**，也是本轮最需要被固定下来的一条。

P3-01 有三条冻结语义，其中两条的形状在 P3-02 必须改变：

| | P3-01 Foreground | P3-02 Input Activity |
| --- | --- | --- |
| 缺失是否是一种观测 | 是（`kind: 'absent'`） | **不存在缺失这个结果** |
| 失败语义 | reject，不塌缩成 absent | reject，**不塌缩成任何哨兵值** |
| 边界值 | `title` 缺失 = 未取得 | `dwTime = 0` = **合法 tick** |

原因是事实层面的，不是设计偏好：

- `GetLastInputInfo` 的返回只有成功 / 失败，没有「没有输入」这一结果；
- `dwTime = 0` 是**合法 tick**（约等于系统启动时刻），不是「从未有输入」的哨兵。

因此把 `0` 当作缺失来对待，正是冻结原则所禁止的无依据解释。实现把 `0`、`1`、`0xFFFFFFFF` 一律原样报告；`isUint32` 只拒绝**结构上不可能**的值（非整数 / `NaN` / `Infinity` / `< 0` / `> 4294967295`），不拒绝**语义上罕见**的值。

`0` 与 `4294967296` 的区别是**类型边界**；`0` 与 `42` 的区别是**现实**。前者是实现该拒绝的，后者是实现必须原样报告的。

代价是诚实的，且被记入限制：本模块**无法**区分「自启动以来没有输入」与「tick 恰好很小」。这个区别被留给后续阶段，不在这里凭空发明。

**`lastInputTick` 是 raw uint32 semantic**：它不与 `observedAt` 同轴，实现不做任何对齐、换算或比较。observation 里**没有**「当前 tick」——这一点是刻意的，见 §17.2。

**PASS。**

## 14. Windows transport 与 parser 证据

v1 采用**异步 PowerShell 子进程 + 直接 Win32 P/Invoke**。不使用 `spawnSync`，不引入 FFI 依赖，不引入任何第三方 Windows 包。

选择异步而非同步的理由是架构性的，不是性能优化：**Runtime 未来承载多个自治 Plugin，不应为了单次 observation 长时间整体阻塞 event loop。** `spawnSync` 会让一次 input activity 观测阻塞整个 Runtime。

`GetLastInputInfo` **没有托管包装**——`System.Windows.Forms` 与 WPF 都不暴露它，P/Invoke 是唯一不引入依赖的路径。这已在设计轮验证过，不是假设。

本轮参考实现时确认了两处 PowerShell 5.1 的陷阱，二者都已在实现前被实测发现并写进任务：

```text
1. Marshal::SizeOf 的变量形式
   $type = [Hikari.Input+LASTINPUTINFO]
   ::SizeOf($type)     → ArgumentException（5.1 的重载解析选到泛型 SizeOf<T>(T)）
   ::SizeOf($info)     → 正确，实例形式，实测 cbSize = 8

2. 被 timeout 杀死的子进程
   error.killed === true 且 error.code === 0
   → 只看 code 会把超时描述成 "exited with code 0"，读起来像成功
```

**PASS。**

## 15. 测试策略与一次性探针的证据等级

三种证据的性质必须被准确区分，不应被读成同级：

| 维度 | 持久回归测试 | Windows smoke | 一次性探针 |
| --- | --- | --- | --- |
| 数量 | 16（InputActivity 确定性） | 3 | 21 组 / 142 条断言 |
| 位置 | `test/`，进入仓库 | `test/`，进入仓库 | 会话临时目录，**不在仓库内** |
| CI | push 后由 CI 执行 | CI 上**自我 skip** | **不执行** |
| 可复现 | 是，`npm test` 即可 | 本机可复现，CI 上 skip | **否**——一次性 |
| 验证对象 | 公开契约与依赖图 | **真实 Windows 路径** | dist 中的**真实生产常量** |

**因此：**

- 142 条是**一次会话内的验证证据**，不是可复现的回归覆盖。它们证明了「当时确实验过」，**不**证明「以后不会被改坏」；
- Windows smoke 在 CI 上是 **5 条 skipped**（P3-01 的 2 条 + P3-02 的 3 条），因此 CI 预期为 **132 pass / 5 skipped**；本机（Windows 11）为 **137 pass / 0 skipped**。两者都算通过。**这个 CI 数字是预期值，本轮未 push，尚未由 CI 实际跑过。**
- 探针的价值在于它们验证的是从 `dist` 取出的**真实常量**而非手写副本：`ENCODED_ACQUISITION_SCRIPT` 被断言解码后与 `ACQUISITION_SCRIPT` 字节一致；`ok: false` 分支通过对真实常量做**一处 token 替换**（`$info.cbSize = 0`）得到，而不是复制一份脚本改写。

探针分组：

```text
A 脚本往返        2 组   base64 / UTF-16LE 往返
B 脚本调用顺序    3 组   结构体 → cbSize → 调用、SizeOf 实例形式、失败是否响亮
C readAcquisition 6 组   接受形态与全部拒绝分支、uint32 两端悬崖、多余键被丢弃
D describeFailure 3 组   killed 优先于 code、真实退出码、无法启动
E 无解释          4 组   observation 只加 source、伪造 source 无法穿透、无解释 token、公开面恰为 6
F 真实传输        3 组   未变异脚本成功路径、一处 token 变异失败路径、tick 空闲稳定性
```

其中三条值得单独记录：

- **一处 token 变异后的真实行为**：`$info.cbSize = 0` 实测为 **exit code 1、`killed: false`、stdout 为空字符串**、stderr 含 `GetLastInputInfo failed`。`ok: false` 路径由此获得对生产常量的证据，并证明 API 失败是**响亮的**而不是静默产出垃圾——`readAcquisition` 永远不会拿到半个结果。
- **uint32 两端悬崖**：`4294967295` 接受 / `4294967296` 拒绝。`2**32` 是一个完全普通的 JSON 数字，若放行会以「合法 tick」的身份流出去。这是仓库测试套件**不会**覆盖的真实正确性悬崖。
- **空闲稳定性**：两次真实调用在无输入时 tick 差值 < 1 s，与墙钟同量级同单位——排除单位或量级错误。

**本轮探针未发现实现缺陷**，与 P3-01 不同（那一轮发现并修正了 2 处）。原因是本轮的两处已知陷阱（§14）已在设计轮被实测发现，实现时直接规避，且 P3-01 的 teardown bug 在本轮有持久回归覆盖（§11）。

探针不进入仓库是**决定**，不是遗漏：写回仓库就意味着新增测试代码与第二处内部 import，超出「纯文档收口」的范围。若希望这 142 条变成持久证据，需要单独决定是否把它们改写成仓库测试。

### 15.1 已知 coverage gap（watch item）

```text
windows.ts 的 parser rejection branches
—— 非法 JSON / 时间戳不可用 / tick 不可用 / 非零退出 / 超时
—— 不在持久 `npm test` 内，当前由一次性探针验证
```

P3-01 已经采用相同取舍，**现在该 coverage gap 已涉及两个模块**。本轮结论仍然是：

```text
不为了测试覆盖扩大 public API
不为了本轮改 seam
```

但把它作为明确的 known tradeoff 记录：**如果未来出现第三个同型 parser，应重新评估 test seam 与 transport seam。** 本轮不解决（见 §16）。

## 16. 重复与不过早抽象

P3-02 与 P3-01 之间存在**真实的传输外壳重复：68 行逐字相同的非平凡行**。该数字由 `src/foreground/windows.ts` 与 `src/input-activity/windows.ts` 逐行求交集测得，包含 2 条 import、5 个常量（平台 / 可执行文件 / 超时 / maxBuffer / UTC 时间戳正则）、`ENCODED_*_SCRIPT` 构造、平台检查、`runAcquisition` 主体、`terminate`、`describeFailure`，以及脚本首尾的固定管道行。

需要如实说明的是：**68 行并非全部可抽取。** 两个脚本的中间部分完全不同，两边的 parser 收尾与 acquisition schema 也不同；真正可共享的是那层与 `GetLastInputInfo` / `GetForegroundWindow` 无关的、纯属「用 PowerShell 子进程取一次 JSON」的机制。

**本轮结论：允许重复，不在本轮抽公共 helper。** 理由必须是架构性的：

**理由一（认识论）：样本量不足以判定边界在哪里。** 两个实例无法区分「稳定的共享机制」与「各自的 acquisition semantics」。具体到这个 case，候选的共享边界恰恰是不清楚的：

```text
terminate                    → 纯机制，看起来该共享
describeFailure              → 分类逻辑，但「超时」两边的含义是否同一件事？
ENCODED_*_SCRIPT 构造        → 一行，共享收益接近零
ACQUISITION_TIMEOUT_MS       → 今天取值相同，但两个 acquisition 有不同的合理预算
脚本本体 / parser            → 明确不共享（不同 schema）
```

其中 `ACQUISITION_TIMEOUT_MS` 最能说明问题：今天两边都是 10 s，但共享这个常量会**把两个独立的获取预算耦合成一个**——第三个感知如果需要 30 s，将被迫要么修改共享常量（影响已交付的两个），要么在共享模块上开特例。**错误的抽象比重复更难撤销**，因为它一旦被两个已交付的感知依赖，就获得了事实上的冻结地位。

**理由二（冻结）：抽取需要修改 `src/foreground/`。** 那一层已被冻结。为消除重复而单方面解冻一个已交付模块，代价高于 68 行重复：它会让 P3-01 的 Architecture Review 结论（「逐字节未修改」）在事实上失效，并且这次改动没有经过 P3-01 自己的验收流程。

**代价对比是明确的：** 等待的成本是 68 行重复；猜错的成本是一个被两个已交付模块依赖的共享层。

**重新评估触发条件（客观的，不是「以后再说」）：**

```text
出现第三个同型 Windows Perception
或
P3-01 因独立需求解冻
```

届时抽取应作为一次**独立的、可审核的重构**进行，而不是搭在某个新感知的顺风车上。

**PASS（作为一次有意识接受的重复）。**

## 17. 已知限制

1. **单次调用成本高，且两个感知并列时翻倍。** 每次 `current()` 启动一次 PowerShell 并执行 `Add-Type`，本轮实测约 **523 ms**（对照 `loadPlugin` ≈ 1 ms），与 P3-01 的 370–455 ms 同带。两个感知**同时**被使用时，一次「前台 + 输入」观测是**两次独立子进程**，没有摊薄、没有预热、没有常驻。这是 v1 已知的实现限制，本轮刻意不优化，也没有设定性能 SLA。它意味着 Input Activity 与 Foreground 一样，目前只能被**显式调用**，不能作为高频采样源。
2. **单次 observation 本身不提供 idle duration。** `lastInputTick` 是启动相对的 tick，而 observation **不含**当前 tick，所以一次调用无法算出「距上次输入多久」。**这不是缺陷，是冻结边界**：把当前 tick 一起报出来，就是在一个声明不做解释的模块里做解释的第一步。需要时长的消费者应自行取两次 observation，并自行承担时钟语义。
3. **`dwTime = 0` 不被附加更高层解释。** 见 §13。`0` 被当作合法 tick 原样报告；本模块不声称它意味着「自启动以来没有输入」。
4. **parser rejection branches 不在 `npm test` 回归套件内。** 见 §15.1。这是 §9 那条取舍的直接代价，现在涉及两个模块。
5. **stderr / CLIXML 不作为稳定机器契约解析。** 实测失败时 stderr 为 PowerShell 序列化错误流（`#< CLIXML …`），其中的本地化错误文本在非 UTF-8 控制台下呈现乱码。实现**从不解析 stderr**，失败分类只用 `killed` / `code`，因此这不影响契约；仅记录为诊断可读性上的限制。
6. **`Error.name` 沿用项目既有行为。** `InputActivityError` 与 `InputActivityObservationError` 的 `error.name` 均为 `'Error'`。这是**项目既有约定**（Continuity、Chronicle、Foreground 的全部错误类同样未设置），不是 P3-02 的缺口；判别应使用 `instanceof`。
7. **Windows-only。** 其他平台 Plugin 直接 `failed`，这是设计意图而非缺口。
8. **transport shell 与 P3-01 重复 68 行逐字相同的非平凡行。** 见 §16，是一次有意识接受的重复，附客观的重新评估触发条件。

## 18. 工具限制（如实记录）

- **本轮未做图谱变更分析。** `node .gitnexus/run.cjs detect-changes --scope all` 返回「未检测到变更」，但本轮全部产物是**未跟踪新文件**，不进 `git diff`，索引也早于本轮改动。**这个 0 必须读作「未看见」，不是「无影响」**（与 P2-04 §12、P3-01 §17 记录的是同一类）。收口为纯文档、未执行 `git add`，因此本轮**没有可引用的图谱证据**。

  真正支撑「无侵入」的证据是另一条、不依赖索引新鲜度的：

  ```text
  git diff HEAD --stat -- src/runtime src/continuity src/chronicle src/foreground src/cli src/index.ts package.json tsconfig.json
  → 输出为空
  git status --porcelain（非 ?? 行）
  → 输出为空
  ```

  即**没有任何既有文件被编辑**，因此不存在既有符号行为变更的路径。这是逐字节的保证，强于任何图侧推断。图谱侧结论应表述为「**未发现**侵入」，而**不是**「**已证明不存在**侵入」。
- **图谱不解析 `.mjs` 的 IMPORTS 边**（P2-04 已记录）：针对测试文件的导入查询返回空，这个空结果不是「没有依赖」的证据。本轮涉及测试对 `dist/input-activity/plugin.js` 的 import，属同一情形；该结论改用文本检索获得。
- **`query()` 的关键词与语义检索仍因 FTS 扩展加载失败而不可用**。图遍历能力不受影响。
- **探针不可复现**（§15）：142 条断言随会话结束而失去载体，仓库内不保留。

## 19. 最终架构结论

**P3-02 Architecture Review: PASS**

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

```text
Runtime modified?                     NO
Continuity modified?                  NO
Chronicle modified?                   NO
Foreground modified?                  NO
CLI modified?                         NO
src/index.ts modified?                NO
Event introduced?                     NO
Background mechanism introduced?      NO
Persistence introduced?               NO
World introduced?                     NO
Awareness introduced?                 NO
Manager introduced?                   NO
Model call introduced?                NO
PerceptionManager introduced?         NO
New public symbols beyond 6?          NO
Second internal test import?          NO
New dependencies?                     NO（package.json 仍无 dependencies 字段）
```

```text
No blocking issue.
No production redesign required.
No frozen boundary was crossed.
```

本阶段冻结/强化的边界：

> **Perception records what the source says, not what Hikari concludes from it.**

> **多个自治 Perception Plugin 可以并列存在，而无需中央 Perception Manager。**

P3-02 **没有建立新的中央感知架构**，而是证明了现有 Runtime / Plugin / Service 模型本身已经足以容纳第二个独立 Perception。P3-01 证明了一个感知可以存在；P3-02 证明第二个感知不需要先长出协调层——它只需要自己那一份 `requires: []`、自己那一份 Service 契约、自己那一份平台判断。

> Foreground 与 InputActivity 共享「它们都是 Perception」的架构角色，但没有被强迫共享控制、生命周期、状态或领域语义。

以及一条同时进入下一阶段的事实（§16、§17.8）：

```text
两个 Windows Perception 之间存在 68 行逐字相同的非平凡行（传输外壳）
→ 本轮刻意不抽公共 helper，因为样本量不足以判定共享边界
→ 且抽取需要解冻已交付的 src/foreground/
→ 重新评估触发条件：出现第三个同型 Windows Perception，或 P3-01 因独立需求解冻
```

### 评审性质（如实记录）

本文与 `docs/development/phase-3-input-activity.md` 由**实现者本人**撰写，属于自评。它记录的是实际验证过什么、以及哪些结论的证据强度较弱（§15 / §18），但**不能替代独立评审**。人工作为独立评审者时，最值得复核的三处是：

1. §13 「本阶段没有 absent 分支」是否应当如此——即 `dwTime = 0` 被当作合法 tick 而非缺失，是否正确；
2. §16 「允许重复、不抽公共 helper」的理由是否成立，以及触发条件是否足够客观；
3. §15.1 中 coverage gap 已涉及两个模块，是否仍接受「不扩大 public API」而不处理。
