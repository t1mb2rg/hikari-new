# Hikari 第三阶段 P3-02 Windows Input Activity Perception v1 实现

> 状态：**P3-02 已实现，等待人工 Functional Review / Architecture Review**
>
> 未提交。本文只描述已落盘的实现事实，不代表审核结论。
>
> 范围：单个自治 Plugin `input-activity.windows`，经由 `input-activity.current@1` 提供一次真实 Windows input activity observation。
>
> 第三阶段其余项不在本文范围内。

## 1. 阶段目标

P3-01 让 Runtime 能知道「此刻谁在前台」。但前台窗口不等于人还在。

本阶段只做这一件事：

> 让 Runtime 能加载一个自治的 `input-activity.windows` Plugin，并通过 `input-activity.current@1` 执行一次真实的 Windows last-input observation。

本阶段不新增感知框架，不新增中心层，也不引入 Memory / World / Awareness。**它不判断人是否在场**——它只报告系统记录的最后一次输入发生在哪个 tick。

## 2. 阶段边界

本阶段明确不做以下事情，且这些边界已由代码结构保证，而不只是文档约定：

- 不修改 `src/runtime/`；
- 不修改 `src/continuity/` 与 `src/chronicle/` 的任何一行；
- 不修改 CLI 组合（`src/cli/`）与根公开架构（`src/index.ts`）；
- **不修改 P3-01 已冻结的 `src/foreground/` 的任何一行**；
- Input Activity 不依赖 Continuity，不依赖 Chronicle，**也不依赖 Foreground**；
- 不引入 Event：没有 `changed`，没有 watcher，没有 polling，没有 dedup，没有 queue，没有 rate limiting；
- 不做后台观测：加载、空闲、卸载都不产生观测；
- 不引入持久化：不写 `origin.json`，不写 `chronicle.jsonl`，不写任何新文件；
- 不计算 idle duration、不判断「人是否在场」、不引入 World / Awareness / Judgement / Salience / importance / freshness；
- 不引入模型调用；
- 不引入 `ObservedValue<T>` / 通用 Observation 框架 / 通用 Sensor 抽象 / `ProcessManager` / `WorkerManager` / `ResourceManager`；
- 不在公开契约中暴露 PowerShell / Win32 / tick 来源等细节。

## 3. 当前目录

P3-02 新增文件 **10 个**：

```text
src/input-activity/  (7)
  types.ts  contracts.ts  errors.ts  acquisition.ts  windows.ts  plugin.ts  index.ts

test/
  input-activity.test.mjs          # 确定性测试
  input-activity-windows.test.mjs  # Windows 真实 smoke（非 win32 自我 skip）

docs/development/
  phase-3-input-activity.md        # 本文
```

公开模块 `src/input-activity/index.ts` 只导出 **6** 个符号：

```ts
export { inputActivityService } from './contracts.js';
export type { InputActivityService } from './contracts.js';
export { inputActivityPlugin } from './plugin.js';
export type { InputActivityObservation } from './types.js';
export { InputActivityError, InputActivityObservationError } from './errors.js';
```

`acquisition.ts` 与 `windows.ts` **不在** 公开面上。`createInputActivityPlugin` 也不在公开面上——它只服务于内部实现与测试。

比 P3-01 少一个符号，是结构差异而非疏漏：Foreground 需要公开 `ForegroundTarget` 联合类型（`absent` / `present` 两态各有自己的形状），而 Input Activity 的 observation 是三个原始字段，没有需要公开的嵌套类型。`InputActivitySource` 与 `ForegroundSource` 一样**不导出**——它是观测值的内部标签，不是调用方需要拼写的类型。

## 4. Observation 语义

```ts
export type InputActivitySource = 'input-activity.windows';

export interface InputActivityObservation {
  readonly observedAt: string;
  readonly source: InputActivitySource;
  readonly lastInputTick: number;
}
```

三条语义在实现中的落点：

| 语义 | 落点 |
| --- | --- |
| **Observed is observed.** | `lastInputTick` 原样透传，不做修正、不做单调化、不做单位换算 |
| **Failure to observe is not an observation.** | 任何获取失败都 `reject`，绝不 resolve 成 `lastInputTick: 0` 或任何哨兵值 |
| **The value carries no interpretation.** | 不计算 idle duration，不判断在场 / 离场，不比较任何阈值 |

### 本阶段没有 absent 分支

这是与 P3-01 最尖锐的不对称，且是**验证过的**结论，不是推理：

- `GetLastInputInfo` 只有成功 / 失败两种返回，没有「没有输入」这一结果；
- `dwTime = 0` 是**合法 tick**（约等于系统启动时刻），不是「从未有输入」的哨兵。

因此把 `0` 当作缺失来对待，正是冻结原则所禁止的无依据解释，也直接违反「保留 `0` 为合法边界值」的要求。实现把 `0`、`1`、`0xFFFFFFFF` 一律原样报告。

代价是诚实的：本模块**无法**区分「自启动以来没有输入」与「tick 恰好很小」。这个区别被留给后续阶段，不在这里凭空发明。

### observedAt

`observedAt` 表达的是 **`GetLastInputInfo()` 返回成功的那一刻**，不是调用开始，也不是 Promise resolve。

它由真正执行获取的一方产生：PowerShell 脚本在 `GetLastInputInfo()` 返回后立刻取 `[System.DateTime]::UtcNow`，父 Node 进程只是把它原样透传，**不会在 child process 返回后重新生成**。

### lastInputTick

`lastInputTick` 是 user32 的 32 位 tick 计数，原样透传。它**不是**时间戳，不与 `observedAt` 同轴，二者的关系不被本模块解释。Runtime 侧的消费者可以直接看到这一点：observation 里没有「当前 tick」，因此**单次 observation 无法推出 idle 时长**（见 §14）。

### source 的独立性

`source` 固定为 `'input-activity.windows'`，写在 `acquisition.ts` 的 `OBSERVATION_SOURCE` 常量里，是一个独立字面量，**不引用** `plugin.ts` 中的 Plugin ID 常量：

```ts
const OBSERVATION_SOURCE: InputActivitySource = 'input-activity.windows';
```

两者取值相同是事实，来源相同则不是。这条不变量有一个可测的后果：即使 acquirer 返回的对象上带了一个伪造的 `source` 字段，它也不可能到达 observation（探针 E2 断言）。

## 5. Service 契约

```ts
export interface InputActivityService {
  current(): Promise<InputActivityObservation>;
}

export const inputActivityService = defineService<InputActivityService>('input-activity.current', 1);
```

一次 `current()` = 一次新的真实观测。无缓存，无复用，无去重。

## 6. 非 Windows 宿主的生命周期语义

生产 Plugin `input-activity.windows` 的宿主检查**整个模块只有一处**，位于 `createWindowsAcquirer`（`src/input-activity/windows.ts:45`）：

```ts
if (process.platform !== WINDOWS_PLATFORM) {
  throw new InputActivityError('Input activity observation requires a win32 host.');
}
```

`plugin.ts` 的 `setup` 本身**不含字面检查**：它调用工厂 `createAcquirer()`，生产路径下即 `createWindowsAcquirer`，因此这次检查发生在 `setup` 内，且每次 `setup` 恰好执行一次。

- win32 宿主：正常 `provide`，Plugin `active`；
- 非 win32 宿主：`setup` 抛出 `InputActivityError`，Runtime 将 Plugin 置为 `failed`，需要 `input-activity.current@1` 的消费者停在 `waiting`。

`setup` 中 **不探测** 桌面会话、不探测 PowerShell 是否可用、不探测权限、不探测是否存在输入。这些都属于运行时观测失败，不属于启动前提。

Runtime 不知道 Windows 的存在。平台知识完全由 Plugin 自己拥有：全 `src/` 中 `process.platform` 只出现两处，一处在 `src/input-activity/windows.ts`，另一处在 `src/foreground/windows.ts`，均不在 `src/runtime/`。

## 7. Windows acquisition

v1 采用 **异步 PowerShell 子进程 + 直接 Win32 P/Invoke**。不使用 `spawnSync`，不引入 FFI 依赖，不引入任何第三方 Windows 包。

`GetLastInputInfo` 没有托管包装：`System.Windows.Forms` 与 WPF 都不暴露它，P/Invoke 是唯一路径。

| 关注点 | 实现 |
| --- | --- |
| 核心获取 | `GetLastInputInfo(ref LASTINPUTINFO)`（user32.dll），无启发式 |
| 结构体 | `LASTINPUTINFO { uint cbSize; uint dwTime; }`，`LayoutKind.Sequential` |
| cbSize | `[System.Runtime.InteropServices.Marshal]::SizeOf($info)`，**实例形式**，实测为 8 |
| 命令行 | `-NoProfile -NonInteractive -EncodedCommand`（base64 UTF-16LE），消除全部引号与编码风险 |
| 输出 | `[System.Console]::OpenStandardOutput()` 直接写 UTF-8 字节，绕过控制台代码页 |
| stderr | `$ProgressPreference = 'SilentlyContinue'` 保持干净，仅用于失败诊断 |
| 失败诊断 | `$ErrorActionPreference = 'Stop'` + `if (-not ...) { throw }` → exit code 1，不进公开契约 |
| 超时 | `ACQUISITION_TIMEOUT_MS = 10_000`；超时是 **observation failure** |
| tick 校验 | `isUint32`：拒绝非整数、`NaN`、`Infinity`、`< 0`、`> 0xFFFFFFFF` |

失败描述函数 `describeFailure` 先判 `error.killed`（Node 在被 `timeout` 杀死时 `error.code` 为 `0`，只看 code 会把超时误判成「exited with code 0」，读起来像成功），再判数字 `code`，最后归为「无法启动」。

`readAcquisition` 对 stdout 做严格校验：非法 JSON、非对象、`observedAt` 不匹配 UTC 毫秒格式、`lastInputTick` 不是合法 uint32 一律抛 `InputActivityObservationError`。与 P3-01 不同，这里**没有**「降级省略」的分支——observation 只有三个字段，没有哪个字段缺失之后观测仍然成立。多出来的键被丢弃，不进入结果。

### Marshal::SizeOf 的 PowerShell 5.1 陷阱

```powershell
# 会抛 ArgumentException：变量形式下 5.1 的重载解析选到泛型 SizeOf<T>(T) 并拒绝 System.RuntimeType
$type = [Hikari.Input+LASTINPUTINFO]
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($type)

# 正确：实例形式
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
```

该陷阱在实现前的设计轮已被实测发现并写进任务，本轮无需重新踩。

## 8. 资源归属

沿用 Runtime 已有的 `context.defer()`，没有新建任何 Manager：

```ts
setup(context) {
  const acquirer = createAcquirer();
  context.defer(() => acquirer.dispose());
  context.services.provide(inputActivityService, Object.freeze({ ... }));
}
```

- acquirer 在 `setup` 内构造，不在模块导入时构造；
- `dispose()` 后 `acquire()` 拒绝，不再启动新进程；
- `dispose()` 会终止仍在飞行中的子进程，并等待其 `close`；
- shutdown 后 `getPluginState('input-activity.windows')` 为 `undefined`（Runtime 删除记录）。

## 9. Internal seam

`InputActivityAcquirer` 是内部可测试性机制，不是生产领域 API：

```ts
export interface InputActivityAcquirer {
  acquire(): Promise<InputActivityAcquisition>;
  dispose(): Promise<void>;
}
```

`InputActivityAcquisition` 的字段名与 `InputActivityObservation` 去掉 `source` 之后**完全一致**。P3-01 在 `target` → `foreground` 之间做过一次重命名，本轮刻意不复制这一仪式：在 seam 两侧保持同名字段，去掉的是无谓的映射代码，保留的是必要的边界——`source` 仍在 observation 边界上补充，因此平台 acquirer 无法谎报自己的来源。

`createInputActivityPlugin(createAcquirer)` 接收的是 **工厂** 而非实例，因此构造（以及其中的 win32 检查）永远发生在 `setup` 内，不会在模块导入时发生。

确定性测试通过 **唯一一处具名例外** 直接 import 编译后的内部模块取得它：

```js
import { createInputActivityPlugin } from '../dist/input-activity/plugin.js';
```

没有建立新的 testing framework，也没有为了测试便利扩大生产契约。

## 10. 当前测试

| 文件 | 内容 | 结果 |
| --- | --- | --- |
| `test/input-activity.test.mjs` | 16 条确定性测试（fake acquirer） | 16 pass / 0 fail |
| `test/input-activity-windows.test.mjs` | 3 条真实 Windows smoke（非 win32 自动 skip） | 3 pass / 0 fail |
| `npm test`（全量） | Phase 1 / 2 / 3 全部 | **137 pass / 0 fail / 0 skipped** |

`npx tsc -p tsconfig.json --noEmit` 干净。

确定性测试覆盖：`requires: []` 与 `provides input-activity.current@1`、依赖图可达、每次 `current()` 都重新获取、加载/空闲/卸载期零后台观测、setup 不做观测、uint32 两端边界值原样透传、tick 回退（`123456` → `123400`）被如实报告而不被修正、source 正确、`observedAt` 透传不重打、frozen、失败 reject、意外错误同样 reject、无 Continuity/Chronicle/Foreground 也能收敛、观测不修改领域存储、**两个感知并存且互不干扰**、生产 Plugin 可用性与宿主平台一致。

最后一条是本阶段的架构主张所在：Foreground 与 Input Activity 都不 `requires` 对方，各自只 `provides` 自己的契约，两者同时加载时都能 `active`，任何一个失败都不会干扰另一个。

## 11. 真实 Windows smoke

在本机（Windows 11）实测，真实观测样例：

```json
{
  "observedAt": "2026-09-17T08:07:26.378Z",
  "source": "input-activity.windows",
  "lastInputTick": 650025625
}
```

`npm test` 的 diagnostic 输出（同一轮）：

```text
wall clock: loadPlugin 1ms, current() 523ms
first 650026000 -> second 650026562, delta 562ms over 912ms of wall clock
shutdown with an acquisition in flight: 2ms
teardown rejection: Input activity observation failed: the acquirer was disposed mid-observation.
```

三条 smoke 只断言结构与格式，**不假设此刻是否有人操作**：

1. 真实路径产生一条格式良好的 observation（键集合、UTC 毫秒时间戳可往返、`source`、tick 的 uint32 边界）；
2. 真实 tick 的推进不快于墙钟——在第一次获取之前开窗、第二次获取之后关窗，该窗口严格包含两次 tick 采样，因此 `((tick2 - tick1) >>> 0) <= elapsed + slack` 必然成立，除非单位或量级错了；
3. 飞行中的获取在 shutdown 时被真实拆除，拒绝为 `InputActivityObservationError` 且**不含** `did not finish in time`——把关停谎报成超时会让人去找一个从未发生的超时。

## 12. 本阶段明确没有实现

- 没有 `changed` Event、watcher、polling、queue、dedup、rate limiting；
- 没有后台观测、缓存、预热、保活；
- 没有 idle duration 计算，没有阈值，没有「在场 / 离场」判断；
- 没有 Memory / World / Awareness / Judgement；
- 没有模型调用；
- 没有与 Foreground 的任何组合、关联、对齐或写入；
- 没有 Chronicle 写入；
- 没有新的 Manager / 通用 Sensor 抽象 / 通用 Observation 框架；
- 没有公开 PowerShell / Win32 / tick 语义；
- 没有为 P3-02 引入任何依赖（`package.json` 仍无 `dependencies` 字段）。

## 13. 边界验证（探针）

除仓库测试外，另用一次性探针（不进入仓库）对冻结边界做了对抗式验证，共 **21 组、142 条断言全绿**。探针的意义在于它们验证的是 **dist 中的真实生产常量**，而不是手写副本。

| 探针组 | 组数 | 覆盖 |
| --- | --- | --- |
| A 脚本往返 | 2 | `ENCODED_ACQUISITION_SCRIPT` 的 base64 / UTF-16LE 往返 |
| B 脚本调用顺序 | 3 | 结构体 → cbSize → 调用的顺序、`SizeOf` 实例形式、失败是否响亮 |
| C `readAcquisition` | 6 | 接受形态与全部拒绝分支、uint32 两端悬崖、多余键被丢弃 |
| D `describeFailure` | 3 | `killed` 优先于 `code`、真实退出码、无法启动 |
| E 无解释 | 4 | observation 只加 `source`、伪造 source 无法穿透、无解释 token、公开面恰为 6 个符号 |
| F 真实传输 | 3 | 未变异脚本的成功路径、一处 token 变异后的失败路径、tick 空闲稳定性 |

值得单独记录的几条结论：

- `ENCODED_ACQUISITION_SCRIPT` 解码后与 `ACQUISITION_SCRIPT` **字节一致**；
- 脚本中 `New-Object` → `$info.cbSize = ` → `GetLastInputInfo(...)` 的**顺序**被断言，保证不会在 cbSize 赋值前调用 API；
- 脚本中不含任何解释性 token（`idle` / `duration` / `elapsed` / `since` 等），并且 `dist/input-activity/` 全部 7 个 `.js` 文件都通过同一扫描——本模块**不做任何解释**由代码扫描佐证，不只是一句声明；
- 将真实常量做 **一处 token 替换**（`$info.cbSize = 0`）后，实测 **exit code 1、`killed: false`、stdout 为空字符串**、stderr 含 `GetLastInputInfo failed`——`ok: false` 路径由此获得对生产常量的证据，并且证明 API 失败是响亮的而不是静默产出垃圾；
- timeout-kill 分类：`{killed: true, code: 0}` 必须报为超时，而不能报为「exited with code 0」；
- uint32 两端悬崖：`4294967295` 接受、`4294967296` 拒绝。这是仓库测试套件**不会**覆盖的真实正确性悬崖——`2**32` 是一个完全普通的 JSON 数字，若放行会以「合法 tick」的身份流出去；
- 真实 tick 在空闲时稳定（两次调用差值 < 1s），与墙钟同量级同单位。

本轮探针**未发现实现缺陷**。这与 P3-01 不同（那一轮发现并修正了 2 处），原因是本轮的两处已知陷阱（`Marshal::SizeOf` 的变量形式、`error.killed` 必须先于 `error.code`）已在设计轮被实测发现，实现时直接规避。

## 14. 已知限制（P3-02 v1）

1. **单次调用成本高，且本阶段翻倍。** 每次 `current()` 启动一次 PowerShell 并执行 `Add-Type`，实测本轮 `current()` 约 **523 ms**（对照 `loadPlugin` 约 1 ms），与 P3-01 的 370–455 ms 同带。两个感知同时被使用时，一次「前台 + 输入」观测是两次独立子进程，没有摊薄、没有预热、没有常驻。这是 v1 已知的实现限制，本轮刻意不优化。
2. **单次 observation 推不出 idle 时长。** `lastInputTick` 是启动相对的 tick，而 observation **不含**当前 tick，所以一次调用无法算出「距上次输入多久」。这不是缺口——把当前 tick 一起报出来，就是在一个声明不做解释的模块里偷偷做解释的第一步。需要时长的消费者应自行取两次 observation，并自行承担时钟语义。
3. **传输外壳与 P3-01 真实重复：68 行逐字相同的非平凡行。** 该数字由 `src/foreground/windows.ts` 与 `src/input-activity/windows.ts` 逐行求交集测得（含 2 条 import、5 个常量、`ENCODED_*_SCRIPT` 构造、平台检查、`runAcquisition` 主体、`terminate`、`describeFailure` 以及脚本首尾的固定管道行）。并非全部可抽取——两边的 parser 收尾与 acquisition schema 不同，共享脚本只有首尾的固定部分。本轮**不抽取**共享模块，因为抽取需要修改已冻结的 `src/foreground/`。触发条件已记录：出现第三个 Windows 感知，或 P3-01 解冻（见 §15）。
4. **输出解析的拒绝分支不在仓库测试套件内。** 非法 JSON / 时间戳不可用 / tick 不可用 / 非零退出 / 超时这些分支位于 `windows.ts` 内部，而具名内部 import 被冻结为恰好一处，因此改由探针覆盖（§13），不进入 `npm test`。这是刻意的取舍：不为补这些断言扩大生产契约或增加第二处内部 import。P3-01 已有同样的取舍，本轮**沿用**而未加剧——但覆盖缺口现在涉及两个模块。
5. **`dwTime = 0` 的语义不被区分。** 见 §4。`0` 被当作合法 tick 原样报告；本模块不声称它意味着「自启动以来没有输入」。
6. **stderr 是 CLIXML 且可能随系统语言变化。** 实测失败时 stderr 为 PowerShell 序列化错误流（`#< CLIXML …`），其中的本地化错误文本在非 UTF-8 控制台下会呈现乱码。实现**从不解析 stderr**，失败分类只用 `killed` / `code`，因此这不影响契约；仅记录为诊断可读性上的限制。
7. **`.name` 未设置。** `InputActivityError` 与 `InputActivityObservationError` 的 `error.name` 均为 `'Error'`。这是**项目既有约定**（Continuity、Chronicle、Foreground 的所有错误类同样未设置），不是 P3-02 的缺口；判别应使用 `instanceof`。
8. **仅支持 Windows。** 其他平台 Plugin 直接 `failed`，这是设计意图而非缺口。

## 15. 实现原则

`core-architecture-v0.md` 的「Runtime 负责机制，不理解领域意义」仍是上位原则，本阶段没有新增第二套架构原则。Input Activity 与 P3-01 的 Foreground 是同一条原则在感知侧的第二次应用：

> **Input Activity 是 witness，不是 interpreter。**

它只报告「系统记录的最后一次输入发生在哪个 tick、什么时候看到的」，不计算时长、不判断在场、不比较阈值、不与 Foreground 组合出「人在不在看」的结论。现实很奇怪就报告奇怪的现实；过滤与解读属于后续阶段，不属于 P3-02。

### 关于抽取共享 Windows 层

重复（§14.3）是已知的，且**刻意保留**。在本轮抽取意味着修改 `src/foreground/`，而那一层已被冻结；为消除重复而单方面解冻一个已交付的模块，代价高于 68 行重复。触发条件是客观的：**出现第三个 Windows 感知，或 P3-01 因其他原因解冻**。届时抽取应作为一次独立的、可审核的重构进行，而不是搭在某个新感知的顺风车上。
