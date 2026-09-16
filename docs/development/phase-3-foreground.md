# Hikari 第三阶段 P3-01 Windows Foreground Perception v1 实现

> 状态：**P3-01 已实现，等待人工 Functional Review / Architecture Review**
>
> 未提交。本文只描述已落盘的实现事实，不代表审核结论。
>
> 范围：单个自治 Plugin `foreground.windows`，经由 `foreground.current@1` 提供一次真实 Windows foreground observation。
>
> 第三阶段其余项不在本文范围内。

## 1. 阶段目标

前两个阶段建立了 Continuity 与 Chronicle，事实可以跨 Runtime 存活。但 Runtime 至今没有任何方式知道「此刻人正在看什么」。

本阶段只做这一件事：

> 让 Runtime 能加载一个自治的 `foreground.windows` Plugin，并通过 `foreground.current@1` 执行一次真实的 Windows foreground observation。

本阶段不新增感知框架，不新增中心层，也不引入 Memory / World / Awareness。

## 2. 阶段边界

本阶段明确不做以下事情，且这些边界已由代码结构保证，而不只是文档约定：

- 不修改 `src/runtime/`；
- 不修改 `src/continuity/` 与 `src/chronicle/` 的任何一行；
- 不修改 CLI 组合（`src/cli/`）与根公开架构（`src/index.ts`）；
- Foreground 不依赖 Continuity，也不依赖 Chronicle；
- 不引入 Event：没有 `changed`，没有 watcher，没有 polling，没有 dedup，没有 queue，没有 rate limiting；
- 不做后台观测：加载、空闲、卸载都不产生观测；
- 不引入持久化：不写 `origin.json`，不写 `chronicle.jsonl`，不写任何新文件；
- 不引入 World / Awareness / Judgement / Salience / importance / freshness；
- 不引入模型调用；
- 不引入 `ObservedValue<T>` / 通用 Observation 框架 / 通用 Sensor 抽象 / `ProcessManager` / `WorkerManager` / `ResourceManager`；
- 不在公开契约中暴露 HWND / PID / PowerShell / Win32 细节。

## 3. 当前目录

P3-01 新增文件 **10 个**：

```text
src/foreground/  (7)
  types.ts  contracts.ts  errors.ts  acquisition.ts  windows.ts  plugin.ts  index.ts

test/
  foreground.test.mjs          # 确定性测试
  foreground-windows.test.mjs  # Windows 真实 smoke（非 win32 自我 skip）

docs/development/
  phase-3-foreground.md        # 本文
```

公开模块 `src/foreground/index.ts` 只导出 7 个符号：

```ts
export { foregroundService } from './contracts.js';
export type { ForegroundService } from './contracts.js';
export { foregroundPlugin } from './plugin.js';
export type { ForegroundObservation, ForegroundTarget } from './types.js';
export { ForegroundError, ForegroundObservationError } from './errors.js';
```

`acquisition.ts` 与 `windows.ts` **不在** 公开面上。`createForegroundPlugin` 也不在公开面上——它只服务于内部实现与测试。

## 4. Observation 语义

```ts
export type ForegroundSource = 'foreground.windows';

export interface ForegroundTargetAbsent {
  readonly kind: 'absent';
}

export interface ForegroundTargetPresent {
  readonly kind: 'present';
  readonly title?: string | null;
  readonly processName?: string;
}

export type ForegroundTarget = ForegroundTargetAbsent | ForegroundTargetPresent;

export interface ForegroundObservation {
  readonly observedAt: string;
  readonly source: ForegroundSource;
  readonly foreground: ForegroundTarget;
}
```

三条语义在实现中的落点：

| 语义 | 落点 |
| --- | --- |
| **Absence is an observation.** | `kind: 'absent'` 是一次成功观测，`current()` resolve |
| **Failure to observe is not.** | 任何获取失败都 `reject`，绝不 resolve 成 `absent` |
| **Unknown must not collapse into absence.** | 元数据取不到只影响元数据，不改变 `kind: 'present'` |

`title` 是三态，由 `exactOptionalPropertyTypes` + JSON key 存在性表达，没有包装类型：

```text
title: "..."   → 确认有文本
title: null    → 确认没有文本
title 缺失     → 未能取得
```

`processName` 是两态（存在 / 缺失），没有 `null`。

### observedAt

`observedAt` 表达的是 **核心 foreground 目标被取得的那一刻**，不是调用开始、不是 Promise resolve、也不是目标成为 foreground 的时刻。

它由真正执行获取的一方产生：PowerShell 脚本在 `GetForegroundWindow()` 返回后立刻取 `[System.DateTime]::UtcNow`，父 Node 进程只是把它原样透传，**不会在 child process 返回后重新生成**。

### source 的独立性

`source` 固定为 `'foreground.windows'`，写在 `acquisition.ts` 的 `OBSERVATION_SOURCE` 常量里，是一个独立字面量，**不引用** `plugin.ts` 中的 Plugin ID 常量：

```ts
const OBSERVATION_SOURCE: ForegroundSource = 'foreground.windows';
```

两者取值相同是事实，来源相同则不是。

## 5. Service 契约

```ts
export interface ForegroundService {
  current(): Promise<ForegroundObservation>;
}

export const foregroundService = defineService<ForegroundService>('foreground.current', 1);
```

一次 `current()` = 一次新的真实观测。无缓存，无复用，无去重。

## 6. 非 Windows 宿主的生命周期语义

生产 Plugin `foreground.windows` 在 `setup` 中做 **且仅做一次** 宿主检查：

```ts
process.platform === 'win32'
```

- win32 宿主：正常 `provide`，Plugin `active`；
- 非 win32 宿主：`setup` 抛出 `ForegroundError`，Runtime 将 Plugin 置为 `failed`，需要 `foreground.current@1` 的消费者停在 `waiting`。

`setup` 中 **不探测** foreground window、不探测 PowerShell 是否可用、不探测桌面会话、不探测权限。这些都属于运行时观测失败，不属于启动前提。

Runtime 不知道 Windows 的存在。平台知识完全由 Plugin 自己拥有。

`createWindowsAcquirer` 内部同样保留一次 `process.platform` 检查，作为直接的防御性边界。

## 7. Windows acquisition

v1 采用 **异步 PowerShell 子进程 + 直接 Win32 P/Invoke**。不使用 `spawnSync`，不使用 active-window heuristic，不引入 `get-windows`。

| 关注点 | 实现 |
| --- | --- |
| 核心获取 | `GetForegroundWindow()`（user32.dll），无启发式 |
| 标题 | `GetWindowTextW`（`CharSet.Unicode`）写入固定容量 `StringBuilder` |
| 进程 | `GetWindowThreadProcessId` + `Get-Process -Id` |
| 命令行 | `-NoProfile -NonInteractive -EncodedCommand`（base64 UTF-16LE），消除全部引号与编码风险 |
| 输出 | `[System.Console]::OpenStandardOutput()` 直接写 UTF-8 字节，绕过控制台代码页 |
| stderr | `$ProgressPreference = 'SilentlyContinue'` 保持干净，仅用于失败诊断 |
| 失败诊断 | `$ErrorActionPreference = 'Stop'` + exit code，不进公开契约 |
| 超时 | `ACQUISITION_TIMEOUT_MS = 10_000`；超时是 **observation failure**，不转成 absent |
| 目标消失 | `Marshal.GetLastWin32Error() != 1400`（`ERROR_INVALID_WINDOW_HANDLE`）区分「确认无文本」与「取不到」 |

失败描述函数 `describeFailure` 先判 `error.killed`（Node 在被 `timeout` 杀死时 `error.code` 为 `0`，只看 code 会把超时误判成启动失败），再判数字 `code`，最后归为「无法启动」。

`readAcquisition` 对 stdout 做严格校验：非法 JSON、非对象、`observedAt` 不匹配 UTC 毫秒格式、未知 `kind` 一律抛 `ForegroundObservationError`；`title` / `processName` 格式不合规则**省略**，不抛错——元数据缺失不推翻观测。

## 8. 资源归属

沿用 Runtime 已有的 `context.defer()`，没有新建任何 Manager：

```ts
setup(context) {
  const acquirer = createAcquirer();
  context.defer(() => acquirer.dispose());
  context.services.provide(foregroundService, Object.freeze({ ... }));
}
```

- acquirer 在 `setup` 内构造，不在模块导入时构造；
- `dispose()` 后 `acquire()` 拒绝，不再启动新进程；
- `dispose()` 会终止仍在飞行中的子进程，并等待其 `close`；
- shutdown 后 `getPluginState('foreground.windows')` 为 `undefined`（Runtime 删除记录）。

## 9. Internal seam

`ForegroundAcquirer` 是内部可测试性机制，不是生产领域 API：

```ts
export interface ForegroundAcquirer {
  acquire(): Promise<ForegroundAcquisition>;
  dispose(): Promise<void>;
}
```

`createForegroundPlugin(createAcquirer)` 接收的是 **工厂** 而非实例，因此构造（以及其中的 win32 检查）永远发生在 `setup` 内，不会在模块导入时发生。

确定性测试通过 **唯一一处具名例外** 直接 import 编译后的内部模块取得它：

```js
import { createForegroundPlugin } from '../dist/foreground/plugin.js';
```

没有建立新的 testing framework，也没有为了测试便利扩大生产契约。

## 10. 当前测试

| 文件 | 内容 | 结果 |
| --- | --- | --- |
| `test/foreground.test.mjs` | 18 条确定性测试（fake acquirer） | 18 pass / 0 fail |
| `test/foreground-windows.test.mjs` | 2 条真实 Windows smoke（非 win32 自动 skip） | 2 pass / 0 fail |
| `npm test`（全量） | Phase 1 / 2 / 3 全部 | **118 pass / 0 fail / 0 skipped** |

确定性测试覆盖：`requires: []` 与 `provides foreground.current@1`、依赖图可达、每次 `current()` 都重新获取、加载/空闲/卸载期零后台观测、absent 是成功观测、present 带可用元数据、失败 reject 且不塌缩成 absent、意外错误同样 reject、title 三态、processName 缺失、元数据缺失不推翻观测、source 正确、`observedAt` 透传不重打、双层 frozen、无 Continuity/Chronicle 也能收敛、观测不修改领域存储、生产 Plugin 可用性与宿主平台一致、setup 不做观测。

## 11. 真实 Windows smoke

在本机（Windows 11）实测，真实观测样例：

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

该样例同时是 CJK 保真的一次真实验证：中文标题完整通过 PowerShell → stdout → Node 全链路，无乱码、无替换字符。

smoke 只断言结构与格式（键集合、UTC 毫秒时间戳可往返、`source`、`kind` 合法、present 键集合受限），**不假设当前是哪个窗口**——present 与合法 absent 都允许通过。

## 12. 本阶段明确没有实现

- 没有 `changed` Event、watcher、polling、queue、dedup、rate limiting；
- 没有后台观测、缓存、预热、保活；
- 没有 Memory / World / Awareness / Judgement；
- 没有模型调用、没有语义分类、没有「这不像正常用户程序」的判断；
- 没有过滤 Explorer / 任务栏 / 自身进程；
- 没有 Chronicle 写入；
- 没有新的 Manager / 通用 Sensor 抽象 / 通用 Observation 框架；
- 没有公开 HWND / PID / PowerShell / Win32 失败分类；
- 没有为 P3-01 引入任何新依赖（`dependencies` 仍为 `null`）。

## 13. 边界验证（探针）

除仓库测试外，另用一次性探针（不进入仓库）对冻结边界做了对抗式验证，共 **66 条断言全绿**。探针的意义在于它们验证的是 **dist 中的真实生产常量**，而不是手写副本。

| 探针 | 断言数 | 覆盖 |
| --- | --- | --- |
| `probe-parsers` | 31 | `readAcquisition` 接受形态与全部拒绝分支、元数据降级、`describeFailure` 分类 |
| `probe-transport` | 17 | 生产脚本常量本身、命令行编码往返、absent 分支、字符保真 |
| `probe-runtime` | 18 | 真实端到端冻结、顺序 / 并发获取、飞行中拆除、卸载重载、错误面 |

值得单独记录的几条结论：

- `ENCODED_ACQUISITION_SCRIPT` 解码后与 `ACQUISITION_SCRIPT` **字节一致**；
- 脚本中不含任何启发式标记（`MainWindowTitle` / `MainWindowHandle` / `Where-Object` / `Get-Process |` 等），`Get-Process` 全脚本只出现一次且带 `-Id`；
- 脚本中 `GetForegroundWindow()` → `$observedAt` → 标题读取 → 进程读取的**顺序**被断言，保证 `observedAt` 确实在核心获取之后、元数据读取之前；
- 将真实常量做 **一处 token 替换**（`$handle = [IntPtr]::Zero`）后，输出恰为 `{"observedAt":…,"kind":"absent"}`——absent 分支由此获得对生产常量的证据；
- 字符保真：79 个码点（含 `𠀋` U+2000B 与 `😀` U+1F600 两个星形面字符、制表符、CR、LF、双引号、单引号、反斜杠）经 PowerShell → UTF-8 字节 → Node 全链路**逐码点一致**；
- 并发 5 次 `current()` 全部 resolve、无对象共享，墙钟 467 ms（远低于串行累加）；
- 飞行中获取被 shutdown 终止时，拒绝信息为 `the acquirer was disposed mid-observation`，**不再谎报超时**；
- 十次顺序调用的 `observedAt` 单调不减，时跨 3306 ms。

边界验证同时暴露并修正了两处实现问题（均位于本轮新增文件，未触碰任何冻结模块）：

1. `readAcquisition` 的 absent 分支冻结 target、present 分支不冻结——两条同层分支行为不一致。虽不影响公开契约（`toObservation` 无条件冻结），但已改为对称冻结。
2. 飞行中获取被 `dispose()` 杀死时，`error.killed` 为真，被误报为「did not finish in time」。已改为按 `disposed` 标志给出真实描述。

## 14. 已知限制（P3-01 v1）

1. **单次调用成本高。** 每次 `current()` 启动一次 PowerShell 并执行 `Add-Type`，实测 `current()` 约 **370–455 ms**（对照 `loadPlugin` 约 0–1 ms）。这是 v1 已知的实现限制，本轮刻意不优化。
2. **absent 分支在活的交互式桌面上不可触发。** 会话中始终存在前台窗口，所以该分支无法端到端触发；已改为用真实生产常量的一处 token 替换来验证（见 §13），证据强度高于此前的复制品验证，但**仍不是**一次真实的「无前台窗口」观测。
3. **输出解析的拒绝分支不在仓库测试套件内。** 非法 JSON / 时间戳不可用 / 未知 kind / 非零退出 / 超时这些分支位于 `windows.ts` 内部，而具名内部 import 被冻结为恰好一处，因此改由探针覆盖（§13），不进入 `npm test`。这是刻意的取舍：不为补这些断言扩大生产契约或增加第二处内部 import。
4. **`.name` 未设置。** `ForegroundError` 与 `ForegroundObservationError` 的 `error.name` 均为 `'Error'`。这是**项目既有约定**（Continuity 与 Chronicle 的所有错误类同样未设置），不是 P3-01 的缺口；判别应使用 `instanceof`。
5. **超长标题会被静默截断。** `StringBuilder` 容量固定为 32767，更长的窗口标题会被截断。当前 `maxBuffer`（256 KiB）足以容纳该上限的最坏 JSON 转义形态。
6. **仅支持 Windows。** 其他平台 Plugin 直接 `failed`，这是设计意图而非缺口。

## 15. 实现原则

`core-architecture-v0.md` 的「Runtime 负责机制，不理解领域意义」仍是上位原则，本阶段没有新增第二套架构原则。Foreground 是这条原则在感知侧的延伸：

> **Foreground 是 witness，不是 interpreter。**

它只报告「谁在前台、什么时候看到的」，不判断这件事是否重要、是否正常、是否值得记住。现实很奇怪就报告奇怪的现实；过滤与解读属于后续阶段，不属于 P3-01。
