# Hikari 第三阶段 P3-01 Windows Foreground Perception v1 Architecture Review

> 结论：**P3-01 Architecture Review: PASS**（P3-01 Functional PASS + Architecture PASS）
>
> 范围：单个自治 Plugin `foreground.windows`，经由 `foreground.current@1` 提供一次真实 Windows foreground observation。
>
> 上位原则：`core-architecture-v0.md` §12.2「Runtime 负责机制，不理解领域意义」与 `principles.md` §14「Perception ≠ Awareness」。本轮没有新增第二套架构原则。
>
> 本文按既有惯例把 Functional Review 作为 §1；P3-01 不单独拆出一份 Functional Review 文件。

## 1. Functional Review

当前实现已经验证：

- Runtime 可以加载一个 `requires: []` 的自治 Plugin，并通过依赖图把 `foreground.current@1` 交给消费者；
- 一次 `current()` 执行一次**真实** Windows foreground observation，返回真实前台窗口的标题与进程名；
- 每次调用都是一次新的真实获取，没有缓存、没有复用、没有去重；
- 加载、空闲、卸载期间**零后台观测**；
- `absent` 是一次成功观测；获取失败**拒绝**，且绝不 resolve 成 absent；
- `title` 三态（有文本 / 确认无文本 / 未取得）在真实路径上可区分；
- `observedAt` 在核心目标取得后立即产生，父 Node 进程只透传、不重打；
- 观测不触碰 Continuity 与 Chronicle 的任何持久字节；
- 非 Windows 宿主上生产 Plugin `failed`、消费者 `waiting`，且 Runtime 不参与该判断；
- 观测对象在两层均被冻结；
- 观测不含任何语义过滤：Explorer / 任务栏 / 自身进程同样如实上报。

真实观测样例（本机 Windows 11）：

```json
{
  "observedAt": "2026-09-15T16:34:44.258Z",
  "source": "foreground.windows",
  "foreground": {
    "kind": "present",
    "title": "DeepSeek 开放平台 和另外 13 个页面 - 个人 - Microsoft Edge",
    "processName": "msedge"
  }
}
```

本地测试：**118 / 118 PASS**（18 个 Foreground 确定性 + 2 个 Windows 真实 smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

**Functional PASS。**

有一项**必须与结论同时阅读**的限制，见 §15：每次 `current()` 启动一次 PowerShell 进程并执行 `Add-Type`，实测 370–455 ms。它是 v1 冻结时就接受的实现限制，不是缺陷，但它决定了 Foreground 目前只能是被显式调用的能力，不能被当作廉价的高频采样源。

## 2. src/runtime 未修改

`git diff HEAD --stat -- src/runtime/` 为空，逐字节未修改。

Runtime 侧对 `foreground` / `windows` / `win32` / `hwnd` / `powershell` / `pid` 的文本检索**零命中**：Runtime 至今不知道 Windows 存在，也不知道什么是前台窗口。

本轮**没有为测试修改 Runtime API**。确定性测试需要注入一个假的获取器，被拒绝的两条捷径是：

```text
给 Runtime 加测试用注入点              ← 修改已冻结的公开表面
让 PluginDefinition 支持测试专用字段   ← 污染所有 Plugin 的类型
```

实际采用的是第三条路径：`createForegroundPlugin(createAcquirer)` 接收一个**工厂**，测试通过直接 import 内部的 `dist/foreground/plugin.js` 传入假工厂。Runtime 因此一行未改，生产路径上的构造方式也没有任何特殊分支。

**PASS。**

## 3. src/continuity 与 src/chronicle 未修改

两者的 `git diff HEAD --stat` 均为空，逐字节未修改。

Foreground 对 Continuity 与 Chronicle 的文本检索**零命中**：没有 import、没有调用、没有类型引用。

有一条测试直接验证这一点：在一个加载了 Continuity 与 Chronicle 的 Runtime 里连续执行两次观测，整棵存储树的**文件集合与逐文件字节**在观测前后完全一致，且服务关闭后仍然一致。

> Foreground 能独立收敛，不依赖这两个领域，也不改写它们的状态。

**PASS。**

## 4. CLI 与根公开架构未修改

`src/cli/` 与 `src/index.ts` 的 `git diff HEAD --stat` 为空。

`src/index.ts` 只导出 Runtime 符号的现状未被打破：Foreground 从独立入口 `src/foreground/index.ts` 导入，与 Continuity / Chronicle 的既有做法一致。

CLI 没有获得任何 foreground 命令，`package.json` 的 `dependencies` 仍为 `null`。

**PASS。**

## 5. Perception 边界：Foreground 是 witness，不是 interpreter

这是本轮**最需要被固定下来**的一条架构边界，对应 `principles.md` §14。

Foreground 只回答：

> 我观察到了什么？

它**不**回答：

> 这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？

因此本阶段明确**没有**实现，且代码中零命中：

- 没有 Salience / Importance / freshness 判断；
- 没有「这个不像正常用户程序」的启发式；
- 没有基于标题的语义分类；
- 没有过滤 Explorer / 任务栏 / 自身进程；
- 没有模型调用；
- 没有 Chronicle 写入；
- 没有 World、没有 Awareness、没有 Judgement。

**采集侧同样保持沉默**：PowerShell 脚本里不含任何 `explorer` / `Shell_TrayWnd` / `taskbar` / `filter` 字样，也不含任何窗口枚举或启发式回退（`MainWindowTitle` / `MainWindowHandle` / `Where-Object` / `Get-Process |` 均被断言不存在），核心获取只有 `GetForegroundWindow()` 一条路径。

> **现实很奇怪就报告奇怪的现实。** 过滤与解读属于后续阶段，不属于 P3-01。

**PASS。**

## 6. 没有引入 Event、后台观测或缓存

`src/foreground/` 对 `defineEvent` / `emit` / `subscribe` / `watch` / `setInterval` / `setTimeout` 的检索零命中。

契约上只有 `current(): Promise<ForegroundObservation>`，没有 `changed`、没有订阅、没有队列、没有速率限制、没有轮询、没有预热、没有保活。

「无后台观测」由测试以计数方式断言：Plugin 加载后、空闲 50 ms 后、shutdown 后，获取器被调用次数始终为 **0**；真实路径上 `loadPlugin` 耗时 0–1 ms 而 `current()` 耗时 370–455 ms，这个数量级差本身就是「setup 不做观测」的旁证。

**PASS。**

## 7. 没有引入持久化

`src/foreground/` 对 `node:fs` / `writeFile` / `appendFile` / `mkdir` / `createWriteStream` 的检索零命中。

Foreground 不写任何文件，不创建任何目录，也没有自己的存储格式。

**PASS。**

## 8. 没有引入 World / Awareness / Judgement 或任何新 Manager

对 `World` / `Awareness` / `Judgement` / `ObservedValue` / `Sensor` / `Manager` 的检索在 `src/foreground/` 零命中。

没有 `ProcessManager` / `WorkerManager` / `ResourceManager` / `LifecycleManager`，也没有通用 Observation 框架或通用传感器抽象。

**PASS。**

## 9. 公开表面没有为测试扩大

冻结的公开表面恰好 7 个符号：

```ts
foregroundService  ForegroundService
foregroundPlugin   ForegroundObservation  ForegroundTarget
ForegroundError    ForegroundObservationError
```

**不在**公开面上的：`createForegroundPlugin`（内部工厂）、`ForegroundAcquirer` / `ForegroundAcquisition`（内部 seam）、`createWindowsAcquirer`（平台实现）、`ForegroundSource`、原始 Windows 类型、HWND、PID。

测试通过**唯一一处具名例外**取得内部 seam：

```js
import { createForegroundPlugin } from '../dist/foreground/plugin.js';
```

这条取舍有代价，且代价被如实计价：`windows.ts` 内部的输出解析与进程失败分类**因此不在仓库测试套件内**（见 §14）。不接受的做法是为了补这些断言而把 seam 导出成生产 API——**test seam 不应仅仅为了测试习惯而变成领域契约**。

`createAcquirer` 是工厂而不是实例，因此构造（连同其中的 win32 检查）永远发生在 `setup` 内，不会在模块导入时发生。

**PASS。**

## 10. 非 Windows 宿主语义归 Plugin 所有，Runtime 保持平台无关

生产 Plugin 在 `setup` 中做**且仅做一次**宿主检查：

```ts
process.platform === 'win32'
```

- win32：正常 `provide`，Plugin `active`；
- 非 win32：`setup` 抛 `ForegroundError` → Runtime 置 `failed` → 消费者停在 `waiting`。

**`setup` 中不探测** foreground window、不探测 PowerShell 是否可用、不探测桌面会话、不探测权限。这些属于运行时观测失败，不属于启动前提。

判断归属是刻意的：**Runtime 不理解 Windows 是冻结边界，而「我的实现能否在当前宿主上工作」是 Plugin ownership 的内部问题。** 反过来，如果 Plugin 在明确无法工作的宿主上仍然宣称 `active` 并广告 capability，平台知识就会泄漏给每一个消费者——它们将不得不各自判断「这个 capability 现在到底能不能用」。

Runtime 侧零 Windows 判断，已由 §2 的检索确认。

**PASS。**

## 11. 资源所有权沿用既有 EffectScope

没有新建任何资源管理机制，沿用 Runtime 既有的 `context.defer()`：

```ts
setup(context) {
  const acquirer = createAcquirer();
  context.defer(() => acquirer.dispose());
  context.services.provide(foregroundService, Object.freeze({ current: ... }));
}
```

- 获取器在 `setup` 内构造，不在模块导入时构造；
- `dispose()` 后 `acquire()` 拒绝，不再启动新进程；
- `dispose()` 终止仍在飞行中的子进程并等待其退出；
- shutdown 后 Plugin 记录被移除，`getPluginState` 返回 `undefined`。

真实路径验证：在飞行中获取的状态下 shutdown，shutdown 本身 3 ms 内完成且不挂起，`tasklist` 中 `powershell.exe` 计数未上升（无孤儿进程）。

**PASS。**

## 12. observedAt 的产生方与 source 的定义方式

**`observedAt` 表达的是核心 foreground 目标被取得的那一刻**，不是调用开始、不是 Promise resolve、也不是目标成为 foreground 的时刻。

它由真正执行获取的一方产生。脚本内的顺序被断言固定为：

```text
GetForegroundWindow()
↓
$observedAt = [System.DateTime]::UtcNow   ← 在此产生
↓
GetWindowTextW / GetWindowThreadProcessId  ← 元数据在此之后
```

父 Node 进程只做透传，**不在 child process 返回后重新生成** `observedAt`。测试以「注入一个远早于当前时刻的历史时间戳，断言返回的正是该值」来固定这条语义。

**`source` 独立于 Plugin ID 定义**：它写在 `acquisition.ts` 的 `OBSERVATION_SOURCE` 常量里，是一个独立字面量，不引用 `plugin.ts` 中的 `id`：

```ts
const OBSERVATION_SOURCE: ForegroundSource = 'foreground.windows';
```

两者取值相同是事实，来源相同则不是。这样 Plugin 改名不会静默改变已经发出的观测的 `source`。

**PASS。**

## 13. 边界验证暴露的两个真实 bug 与修复

除仓库测试外，本轮用一次性探针对冻结边界做了对抗式验证，**暴露出两个真实 bug**。两处都在本轮新增文件内，未触碰任何冻结模块。

### 13.1 `readAcquisition` 两条同层分支行为不一致

absent 分支冻结 target，present 分支不冻结。公开契约**没有**被破坏（`toObservation` 无条件冻结），但两条兄弟分支对「冻结是不是这一层的责任」给出了相反答案，且任何未来改动 `toObservation` 的改动都会让 present 路径静默泄漏可变对象。

修复：`src/foreground/windows.ts` 的 present 分支改为对称冻结。

### 13.2 拆除路径谎报超时

`dispose()` 杀死飞行中的子进程时，`execFile` 回调看到 `error.killed` 为真，于是被描述成 `did not finish in time`。**根本没有超时发生**——那是 shutdown。人类在关闭日志里会去追一个不存在的超时。

修复：回调改为按 `disposed` 标志给出真实描述（`the acquirer was disposed mid-observation`）。

### 13.3 为第二个修复补上持久覆盖

拆除路径此前**没有任何自动化覆盖**——那个错误消息正是这样活下来的。已在 Windows smoke 中新增一条真实回归测试，断言拒绝的是 `ForegroundObservationError`，**且消息不得声称超时**。

这是本轮唯一新增的仓库测试。修复前它不可能通过。

**PASS。**

## 14. 66 条探针断言的证据性质（必须连同结论一起读）

边界验证共 **66 条断言全绿**（`probe-parsers` 31 / `probe-transport` 17 / `probe-runtime` 18）。它们的**性质**必须被准确表述，不应被读成同级证据：

| 维度 | 仓库测试 | 探针断言 |
| --- | --- | --- |
| 数量 | 118 | 66 |
| 位置 | `test/`，进入仓库 | 会话临时目录，**不在仓库内** |
| CI | push 后由 CI 执行 | **不执行** |
| 可复现 | 是，`npm test` 即可 | **否**——一次性，未保留 |
| 验证对象 | 公开契约与真实路径 | dist 中的**真实生产常量** |

**因此：**

- 66 条是**一次会话内的验证证据**，不是可复现的回归覆盖。它们证明了「当时确实验过」，**不**证明「以后不会被改坏」；
- 其中只有 §13.3 补的那一条（以及 18 条确定性测试、2 条 smoke）具备持久性；
- 探针的价值在于它们验证的是从 `dist` 取出的**真实常量**而非手写副本：`ENCODED_ACQUISITION_SCRIPT` 被断言解码后与 `ACQUISITION_SCRIPT` 字节一致；absent 分支通过对真实常量做**一处 token 替换**（`$handle = [IntPtr]::Zero`）得到，而不是复制一份脚本改写；
- 字符保真探针断言 79 个码点逐码点一致，含 `𠀋`（U+2000B）与 `😀`（U+1F600）两个**星形面**字符、制表符、CR、LF、双引号、单引号、反斜杠——验证的是**传输管道**，与当时哪个窗口在前台无关。

探针不进入仓库是**决定**，不是遗漏：写回仓库就意味着新增测试代码与第二处内部 import，超出「纯文档收口」的范围。若希望这 66 条变成持久证据，需要单独决定是否把它们改写成仓库测试（代价是扩大测试面或增加内部 import），本轮不做。

## 15. PowerShell v1 limitation

v1 采用**异步 PowerShell 子进程 + 直接 Win32 P/Invoke**，不使用 `spawnSync`，不使用 active-window heuristic，不引入 `get-windows`。

选择异步而非同步的理由是架构性的，不是性能优化：**Runtime 未来承载多个自治 Plugin，不应为了单次 foreground observation 长时间整体阻塞 event loop。** `spawnSync` 会让一次前台观测阻塞整个 Runtime。

代价被如实记录：

```text
每次 current() ≈ 370–455 ms
构成：PowerShell 进程启动 + Add-Type 编译 P/Invoke 声明
对照：loadPlugin ≈ 0–1 ms
```

这是 **P3-01 v1 的实现限制**，本轮刻意不优化，也没有设定任何性能 SLA。它意味着：

- Foreground 目前只能是被**显式调用**的能力，不能作为高频采样源；
- 任何需要高频前台感知的未来需求，都必须先解决这个成本，而不是在其之上叠加轮询；
- 优化路径（常驻子进程 / 预编译程序集 / 原生绑定）属于新工作，不在当前已批准范围内。

超时被明确归类为 **observation failure**，不转成 absent：`ACQUISITION_TIMEOUT_MS = 10_000`。

其余同类限制见 §16。

## 16. 当前刻意保留的限制

1. **单次调用成本高**（§15）。370–455 ms，v1 刻意不优化。
2. **absent 分支在活的交互式桌面上不可触发**。会话中始终存在前台窗口。已用真实常量的一处 token 替换验证其形状（§14），但**仍不是**一次真实的「无前台窗口」观测。
3. **输出解析的拒绝分支不在仓库测试套件内**。非法 JSON / 时间戳不可用 / 未知 kind / 非零退出 / 超时这些分支位于 `windows.ts` 内部，而具名内部 import 被冻结为恰好一处，因此改由探针覆盖，不进入 `npm test`。这是 §9 那条取舍的直接代价，不接受用扩大生产契约来消除它。
4. **`.name` 未设置**。`ForegroundError` 与 `ForegroundObservationError` 的 `error.name` 均为 `'Error'`。这是**项目既有约定**（Continuity 与 Chronicle 的全部错误类同样未设置），不是 P3-01 的缺口；判别应使用 `instanceof`。本轮边界验证曾因此产生过一条错误的探针断言，处理方式是**改探针而不是改生产代码**——为迎合探针而让 Foreground 偏离既有约定是更坏的结果。
5. **超长标题会被静默截断**。`StringBuilder` 容量固定为 32767。
6. **仅支持 Windows**。其他平台 Plugin 直接 `failed`，这是设计意图而非缺口。

## 17. 图谱变更验证

`detect_changes({scope: "all"})` 返回 `changed_count: 0` / `risk_level: "none"`。

**这个 0 必须被读作「未看见」，不是「无影响」**，原因与 P2-04 §12 记录的是同一类：本轮全部产物是**未跟踪新文件**，不进 `git diff`，索引也早于本轮改动。缺少 `git add` + 重建索引这两个前置条件中的任何一个，`detect_changes` 都会给出误导性的 `0`。

本轮未执行 `git add`（收口为纯文档，提交由人类决定），因此**本节的图谱结论不成立，不应被引用**。真正支撑「无侵入」的证据是另一条、不依赖索引新鲜度的：

```text
git diff HEAD --stat -- src/runtime src/continuity src/chronicle src/cli src/index.ts package.json tsconfig.json
→ 输出为空
```

即**没有任何既有文件被编辑**，因此不存在既有符号行为变更的路径。这是逐字节的保证，强于任何图侧推断。

图谱侧结论应表述为「**未发现**侵入」，而**不是**「**已证明不存在**侵入」。

## 18. 工具限制（如实记录）

- **本轮未做图谱变更分析**（§17）。前置条件（`git add` + 重建索引）未满足，因此本轮**没有**可引用的图谱证据。这不是「图干净」。
- **图谱不解析 `.mjs` 的 IMPORTS 边**（P2-04 已记录）：针对测试文件的导入查询返回空，这个空结果不是「没有依赖」的证据。本轮涉及测试对 `dist/foreground/plugin.js` 的 import，属同一情形。
- **`query()` 的关键词与语义检索仍因 FTS 扩展加载失败而不可用**。图遍历能力不受影响。
- **探针不可复现**（§14）：66 条断言随会话结束而失去载体，仓库内不保留。

## 19. 最终结论

**P3-01 Architecture Review: PASS**

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

三项均满足。

```text
Runtime modified?              NO
Continuity modified?           NO
Chronicle modified?            NO
CLI modified?                  NO
Event introduced?              NO
Persistence introduced?        NO
World introduced?              NO
Awareness introduced?          NO
Model call introduced?         NO
Public HWND/PID introduced?    NO
Generic Observation framework? NO
New dependencies?              NO（dependencies 仍为 null）
```

本轮冻结下来的 Perception 边界：

> **Foreground 是 witness，不是 interpreter。** 它只报告「谁在前台、什么时候看到的」，不判断这件事是否重要、是否正常、是否值得记住。感知 Provider 不得因为「现实看起来不像正常用户程序」而过滤现实。

以及一条同时进入下一阶段的实现限制（§15）：

```text
PowerShell 异步子进程 v1
→ 每次 current() 370–455 ms
→ 决定 Foreground 只能被显式调用，不能作为高频采样源
→ 任何高频前台感知需求都必须先解决这个成本
→ 优化属于新工作，不在当前已批准范围
```

### 评审性质（如实记录）

本文与 `docs/development/phase-3-foreground.md` 由**实现者本人**撰写，属于自评。它记录的是实际验证过什么、以及哪些结论的证据强度较弱（§14 / §17 / §18），但**不能替代独立评审**。人工作为独立评审者时，最值得复核的三处是：

1. §14 中 66 条探针断言是否应改写为持久测试；
2. §9 中「恰好一处内部 import」的取舍是否接受，以及它换来的 §16.3 覆盖空洞；
3. §15 中 370–455 ms 的 v1 限制是否可接受为进入下一阶段的前提。
