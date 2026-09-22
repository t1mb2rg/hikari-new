# Hikari 第三阶段 P3-04 Desktop Session Change Awareness v1 实现

> 状态：**P3-04 已实现，等待人工 Functional Review / Architecture Review**
>
> 未提交。本文只描述已落盘的实现事实，不代表审核结论。
>
> 范围：单个自治 Plugin `desktop-session-awareness`，经由 `desktop-session-awareness.current@1` 把相邻两次 `desktop-session-world.current@1` 的 payload 做一次机械比较，产出一个「变没变」的判定。
>
> 第三阶段其余项不在本文范围内。

## 1. 阶段目标

P3-01 / P3-02 是 perception：**一个 source 告诉了我什么**。P3-03 是 world：**在这个 scope 内，我现在掌握了哪些事实**。本阶段首次进入 **Awareness** 层，但**只落实它的第一个最小切片**。

**Awareness 层的领域定义以 `principles.md` §14 为准**（继续冻结，本阶段不改动它）：

> Awareness 才负责：这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？

其链路为 `Observation → 事实标准化 / Contextualization → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act`。

**P3-04 并不实现完整 Awareness。** 它落在链路中的 **Contextualization** 一格，且只落在这一格的最窄面：

> 让 Runtime 能加载一个自治的 `desktop-session-awareness` Plugin，并通过 `desktop-session-awareness.current@1` 取得「与上一次读取相比，Desktop Session 的**可比较 payload** 变了没有」。

它**不**回答「这个差别意味着什么」，也**不**进入 Salience / Importance Judgement，更**不**进入 Ignore / Remember / Ask / Notify / Act。`changed` 不蕴含「重要」，`stable` 不蕴含「无事发生」，`indeterminate` 不蕴含「出了问题」——它只蕴含「这一项没法比」。判断是自治插件内部的局部活动，本层不做。

> **准确的说法**：P3-04 首次让 Perception → World → Awareness 三层在真实代码中贯通。**贯通不等于完整实现 Awareness**；P3-04 只落实了 Awareness 的最小 change-contextualization slice。这两件事不得互相替代（同型纪律见 §14：「不应把 Foreground、Calendar、DeviceActivity 等传感器集合本身称为完整 Awareness」）。

### 命名

模块名为 `desktop-session-awareness`，**不是** `desktop-session-change`，也**不是** `change-detector`。

理由是结构性的：本模块描述的是 Hikari 的一个**能力层**（awareness），而不是一种**算法**。今天它用一个 payload 比较来实现；将来它可以被替换成别的实现，而层名不变。把它命名成算法，等于把「当前这一版怎么算」误固化成「这一层是什么」——与 P3-03 拒绝把平台写进 World 身份是同一条理由。

同一理由决定了它**不含任何感知词汇**：没有 `foreground` 的领域类型导入，没有 `lastInputTick` 的语义解读，没有 "idle"、"away"、"presence"。

## 2. 三层架构中的位置

```text
Perception     foreground.windows / input-activity.windows     「一个 source 告诉了我什么」
     ↓
World          desktop-session-world.current@1                 「这个 scope 内我掌握哪些事实」
     ↓
Awareness      desktop-session-awareness.current@1             「这些事实意味着什么 /
                                                                 什么值得在意」  ← 本层首次进入
                                                               （P3-04 只实现其中
                                                                 最小的一格：变化比较）
```

注意最后一行的**层定义**与**本阶段能力**是两件事：层定义来自 `principles.md` §14（继续冻结），本阶段能力是「相邻两个 DesktopSessionWorld snapshot 的可比较 payload 有没有变化」。P3-04 是 Awareness 的一个 slice，不是 Awareness。

这个分层不是修辞。它在代码里由一条**可执行的**约束钉住：本模块只允许 import 三个入口——`../desktop-session-world/index.js`、`../runtime/contracts.js`、`../runtime/plugin.js`。两个感知的 barrel **被显式排除在允许列表之外**（`test/desktop-session-awareness.test.mjs`）。因此「不穿透 Foreground / InputActivity」不是一条靠自觉遵守的约定，而是违反即测试失败的结构事实。

World 不因本阶段而改变。本阶段对既有代码的改动量为 **0 个文件**。

## 3. 阶段边界

**做**：

- 一次机械的 payload 比较；
- facet 级三值判定（`changed` / `unchanged` / `indeterminate`）；
- 整体三值判定（`changed` / `stable` / `indeterminate`）。

**不做**：

- 不做 active / idle / away / presence；
- 不做 salience / importance / notify / remember / act；
- 不做时间线比较（不持有第三个及更早的快照）；
- 不做持久化、不产生事件、不订阅任何东西；
- 不做 active 推断（不读取 `change` 之外的任何上下文）。

## 4. 当前目录

```text
src/desktop-session-awareness/
├── contracts.ts    service 接口与 defineService
├── types.ts        assessment 与两个判定枚举
├── plugin.ts       组合、比较、baseline 维护（全部比较逻辑在此）
└── index.ts        公开 API，6 个符号
```

没有 `errors.ts`、`manager.ts`、`state.ts`、`comparison.ts`。比较是三个模块私有函数，不导出——它们是本层的**实现**，不是本层的**契约**。

## 5. Assessment 语义

```ts
export type DesktopSessionAwarenessAssessment =
  | { readonly kind: 'baseline'; readonly current: DesktopSessionWorldSnapshot }
  | {
      readonly kind: 'comparison';
      readonly previous: DesktopSessionWorldSnapshot;
      readonly current: DesktopSessionWorldSnapshot;
      readonly foreground: DesktopSessionFacetChange;
      readonly inputActivity: DesktopSessionFacetChange;
      readonly change: DesktopSessionChange;
    };
```

两种 kind 而不是「用可选字段凑一个」：**没有上一次读数时不存在比较结果**。用 `previous?: ...` 会更省事，但那会让「第一次」和「比较了一次」在类型上无法区分，调用方就得自己写 `if (previous)`——把本层的边界判断转嫁给调用方。

`current` 是**引用**，不是副本。快照由 World 在 settle 之后冻结，本层不再包装。

### 为什么 baseline 也算一次「assessment」

因为它就是一次 assessment 的结果。调用方问「现在变了没有」，第一次的诚实回答是「我还没有可比的基准」。把它做成异常或 `null` 会让每一条调用路径都要处理一种不成错的状况。

## 6. Service 契约

```ts
export interface DesktopSessionAwarenessService {
  current(): Promise<DesktopSessionAwarenessAssessment>;
}
```

```ts
export const desktopSessionAwarenessService = defineService<DesktopSessionAwarenessService>(
  'desktop-session-awareness.current',
  1,
);
```

service id 为 `desktop-session-awareness.current@1`。`.current` 后缀按既有规则出现（本服务带 `current()` 方法）；id **不携带 `.windows`**——本模块没有任何平台专属实现。

## 7. Dependency 语义

```ts
requires: [desktopSessionWorldService]
provides: [desktopSessionAwarenessService]
```

硬依赖，全有或全无。World 缺失时本插件停在 `waiting`，`current()` 不可达；World 重新出现时自动激活。没有降级路径，没有「World 不在就返回全 indeterminate」——那不是本层的职责，而且会制造一个没有真实输入的判定。

**本层不依赖 Continuity，也不依赖 Chronicle。** 判定是进程内的、瞬时的，不落盘。

零依赖时 `loadPlugin` 返回 `'waiting'`——已由测试 1 覆盖。

## 8. Comparison 语义

### facet 级

```ts
function compareForeground(previous, current): DesktopSessionFacetChange {
  if (previous.kind !== 'available' || current.kind !== 'available') return 'indeterminate';
  const before = previous.observation.foreground;
  const after = current.observation.foreground;
  if (before.kind === 'absent' || after.kind === 'absent') {
    return before.kind === after.kind ? 'unchanged' : 'changed';
  }
  return before.title === after.title && before.processName === after.processName
    ? 'unchanged'
    : 'changed';
}
```

```ts
function compareInputActivity(previous, current): DesktopSessionFacetChange {
  if (previous.kind !== 'available' || current.kind !== 'available') return 'indeterminate';
  return previous.observation.lastInputTick === current.observation.lastInputTick
    ? 'unchanged'
    : 'changed';
}
```

**只比较 payload，不比较时间戳。** `snapshotAt` 与 `observedAt` 每次都不同，把它们算进去会让每一次比较恒为 `changed`，本层也就不存在了。它们出现在 assessment 里是因为它们是事实的一部分，不是因为它们是判别依据。

**tick 只做不等比较。** `5000 → 4000` 与 `4000 → 5000` 一样是 `changed`，没有方向、没有时长、没有「回退需要修正」。这与 P3-01 定下的契约一致——tick 是平台自己的计数器，原样透传。

### 整体级

```ts
function overallChange(foreground, inputActivity): DesktopSessionChange {
  if (foreground === 'changed' || inputActivity === 'changed') return 'changed';
  if (foreground === 'unchanged' && inputActivity === 'unchanged') return 'stable';
  return 'indeterminate';
}
```

这个优先级是本阶段唯一一处真正需要判断的地方，它的规则不对称：

- **差别自己站得住**——另一项没比成，它仍然是差别（测试 13）；
- **相同站不住**——只有所有能比的都比了且都一样，才叫 `stable`（测试 14）。

反过来写（`indeterminate` 优先）是一个看起来同样合理的实现。它不是——它会让「两个 facet 里一个变了」这种**部分可用的信号**被丢掉。判别力探针 M2 专门破坏这一条并验证测试会红（§16）。

## 9. 三态 title

这是本阶段最有价值的一处发现，也是设计评审中被单列为必存测试（T10）的一条。

`ForegroundTargetPresent` 在 `exactOptionalPropertyTypes: true` 下，`title` 在**生产环境**里有三个可观察状态，三个都真的会发生：

| `title` 的状态 | 生产来源 |
| --- | --- |
| **title omitted / undefined** | `GetWindowTextW` 返回 0 且错误是 1400（窗口已消失） |
| `null` | `GetWindowTextW` 返回 0 但错误不是 1400 |
| `string` | 正常读到标题 |

### 术语：`omitted` 与 `absent` 是两个不同的东西

本文档全程区分这两个词，不得混用：

```text
absent            foreground.kind === 'absent' —— 该 scope 内没有前台窗口
                  （是 Foreground 域的判别值，来自 P3-01）

title omitted     ForegroundTargetPresent 上 title 属性不存在（undefined）
title / null      title 属性存在，分别为字符串或 null
```

`absent` **只**用于 `foreground.kind === 'absent'`。`title` 属性缺失一律写成 **title omitted / undefined**，绝不写成 "title absent"——否则「没有前台窗口」与「窗口在、但没读到标题」这两种完全不同的情形会在文档里长得一样。

这**不是**一个类型上的疏忽，是刻意的：`title?: string | null` 让「我没读到标题」与「我读到标题了，它是空的」保持可分。

比较因此必须用 `===` 而不能用 `==`，也不能写 `(before.title ?? null) === (after.title ?? null)`：

```ts
return before.title === after.title && before.processName === after.processName
```

`undefined !== null`，所以上面三种状态两两可分，**不需要额外的存在性检查**。测试 10 跑出 `['baseline', 'changed', 'unchanged', 'changed', 'unchanged']`——其中 `omitted → null` 是 `changed`、`null → null` 是 `unchanged`、`omitted → omitted` 是 `unchanged`。

判别力探针 M1 把 `===` 换成 `==`，这条测试立刻变红（§16）。

> 残留不一致（如实记录）：`test/desktop-session-awareness.test.mjs` 的 T10 注释里用了 "the property is absent" 指代 title omitted。该文件本轮已冻结，不允许修改，因此这处措辞保留原样；它不进入任何契约或文档结论。

## 10. 失败边界

```ts
const current = await world.current();   // 无 try/catch
const baseline = previous;
previous = current;
```

World 的 rejection **原样向上传播**，不包装、不分类、不转成 `unavailable` 判定。理由与 P3-03 的 `unavailable` 不携带原因同源：本层不拥有 World 的失败分类法，一个传输细节不能变成本层契约的一部分。

测试 17 用 `error === failure` 断言，证明它不是被重新抛出的新错误。

## 11. Baseline 语义

三条性质，每条都有对应测试：

1. **第一次调用返回 baseline**（测试 4），且 `current` 与 World 返回的是同一个引用；
2. **baseline 是 activation-local 的**——`let previous` 声明在 `setup` 内部，`setup` 每次激活只跑一次，所以停用再激活会得到全新的绑定（测试 16）；
3. **获取失败不移动 baseline**。这一条靠的是赋值位置的**顺序**：

```ts
const current = await world.current();   // reject 时，以下三行都不可达
const baseline = previous;
previous = current;
```

`previous = current` 在 `await` **之后**。若它被上提到 `await` 之前（一个很自然的「提前准备好」写法），一次失败的获取就会把 baseline 清成未定义或写进一个坏值，下一次调用会错误地返回 baseline。测试 18 精确覆盖这条：先建立 baseline → 一次 rejection → 再取一次，断言 `previous` 仍是**最早那个**快照（不是 `undefined`，也不是坏值）。

`baseline` 先取后覆盖，而不是直接读 `previous` 两次。

**部分可用的快照照样成为 baseline**（测试 15）。两个 facet 都 `unavailable` 的快照内容未知，但它仍然是「上一次读数」——把它降级成 baseline 会凭空丢掉一次时间点。测试 15 用一个连续两次相同的部分快照证明第二次是 `comparison` 而不是 `baseline`。

## 12. Lifecycle Reset

要求「停用再激活后第一次回到 baseline」**无需任何新代码**。

它由 P3-03 既有的 Runtime 机制自然产生：`unloadPlugin` → `#deactivateTree` 级联 → 本插件与它的消费者一起回到 `waiting` → `loadPlugin` 重新进入 `setup` → `let previous` 是新绑定。本阶段没有为此写一行保护代码，也没有写 `reset()` 方法。

测试 16 里有一处**必须存在**的断言，否则整条测试没有判别力：

```js
const beforeDeactivation = observed.service;
await runtime.unloadPlugin(WORLD_PROVIDER);
await runtime.loadPlugin(world.definition);
assert.notEqual(observed.service, beforeDeactivation, 'the service was not rebuilt');
```

旧 service 对象仍然闭包持有旧的 `previous` 和旧的 world 引用，直接调它**照样会返回结果**——只是结果是错的。没有这条断言，测试可能在读一个陈旧对象却依然变绿。

## 13. 并发

`previous` 的读-改-写跨越了一个 `await`，所以两次重叠的 `current()` 会怎么交错是一个真实问题。

结论：**按 resolve 顺序串行，各自比前一次**。因为基线在 `await` 之后才捕获：

- 调用 A 恢复：`baseline = undefined` → `previous = s0` → 返回 baseline；
- 调用 B 恢复：`baseline = s0` → `previous = s1` → 返回 `comparison(s0 → s1)`。

两个调用不会读到同一个 baseline。测试 9 用 `Promise.all` 同时发起三次，断言 `['baseline', 'comparison', 'comparison']` 且 `second.previous === snapshots[0]`、`third.previous === snapshots[1]`。

这条测试是确定性的而不是碰运气的：假 world 的 `current()` 同步返回已 resolve 的 promise，三次调用在同一个同步段内按序发生，微任务按 FIFO 恢复。没有耗时阈值。

### v1 的并发语义（明确记录，勿读作保证）

```text
v1 不保证 concurrent current() 的 invocation-order baseline。

当多个 current() 并发时，baseline 按【成功的 World acquisition 的完成顺序】
前进，而不是按调用发起顺序前进。

即：先被调用、但 World 后返回的那次，会成为后一次比较的 previous。
```

本节上面那段「按 resolve 顺序串行」描述的是**真实路径上的实际行为**（真实 World 是异步的，谁先返回取决于两个 PowerShell 子进程谁先结束），而不是一条对调用方的**有序性承诺**。

**这是已知限制，本轮不增加 mutex / queue / serialization。** 理由：v1 的唯一消费者是「拿两次读数做个比较」，而每一次 `current()` 自身仍然是完整、自洽、可引用的一对；没有任何调用方需要「第 N 次调用必须与第 N-1 次调用配对」。在没有真实需求之前引入排队，是在为想象中的调用方付协调成本——这正是 P3-03 拒绝长出 `PerceptionManager` 的同一条理由。

## 14. 公开 API

`src/desktop-session-awareness/index.ts` 恰好 6 个符号：

| 符号 | 类别 |
| --- | --- |
| `desktopSessionAwarenessService` | value |
| `DesktopSessionAwarenessService` | type |
| `desktopSessionAwarenessPlugin` | value |
| `DesktopSessionAwarenessAssessment` | type |
| `DesktopSessionChange` | type |
| `DesktopSessionFacetChange` | type |

三个比较函数**不在其中**。`src/index.ts` 只导出 Runtime 核心，不因本阶段改变。

**补记（Desktop Inspection Semantics v1 收口后，最小事实修正）：** 上面这张表是 P3-04 收口时的事实，现已**多两个符号**——`desktopSessionAwarenessPeekService` 与 `DesktopSessionAwarenessPeekService`，即 §14 之外的第二个契约 `desktop-session-awareness.peek@1`。**「比较逻辑不在公开面」这条判断不变**：`peek()` 复用同一个模块私有比较，未新增第三个比较函数，也未新增任何类型。

## 15. 当前测试

| 文件 | 内容 | 结果 |
| --- | --- | --- |
| `test/desktop-session-awareness.test.mjs` | 22 条确定性测试 | **22 pass / 0 fail** |
| `npm test`（全量） | Phase 1 / 2 / 3 全部 | **176 pass / 0 fail / 0 skipped** |

`npx tsc -p tsconfig.json --noEmit` 干净。全量为 154（既有）+ 22（本阶段）= 176，与实际运行一致。

22 条覆盖：契约形状（`requires` / `provides` / id / version / 无依赖时 `waiting`）、经依赖图可达、World 消失回到 `waiting` 并再次激活、首次为 baseline 且按引用携带快照、每次 `current()` 恰好一次 World 调用且加载/空闲/卸载期零调用、时间戳不同而 payload 相同判为 `stable`、前台出现与消失、标题与进程名变化、**三态 title 两两可分**、overlapping 评估按序串行、tick 只按不等比较、任一 facet 不可用则该 facet 为 `indeterminate`、差别在另一项 indeterminate 时仍为 `changed`、相同在另一项 indeterminate 时为 `indeterminate`、comparison 按引用携带两个快照、部分可用快照仍成为 baseline、停用再激活回到 baseline、rejection 原样传播、rejection 不移动 baseline、模块只依赖公开 World 契约、模块不含平台/存储/调度/策略词汇、真实 World + 真实 Awareness 在真实 Runtime 下组合。

### 计数口径

本机是 Windows 11，两个真实感知在本地全部可用，因此 **0 skipped**。CI（Linux）上预期为 5 skipped——那 5 条是感知自身的平台跳过，与本阶段无关。

## 16. 判别力探针

仓库测试通过并不等于测试**有判别力**。本轮用一次性探针（不进入仓库）变异 `dist/` 中的真实产物做对抗式验证：

| 变异 | 被破坏的性质 | 结果 |
| --- | --- | --- |
| 无变异（基线） | — | 22 pass / 0 fail |
| **M1** `title` 比较改用 `==` | 三态 title 两两可分 | **1 fail**（测试 10） |
| **M2** `overallChange` 让 `indeterminate` 优先 | 差别自己站得住 | **1 fail**（测试 13） |
| **M3** `let previous` 上提到模块作用域 | baseline 是 activation-local 的 | **9 fail**（含测试 16） |

M1、M2 各自只打翻应当打翻的那一条，说明两条性质被精确钉住。M3 打翻 9 条是符合预期的：基线一旦跨激活共享，几乎所有序列测试都会错位。

探针本身先踩了一次坑，值得记录：第一版脚本跑了三次变异全部报 "MISSED" 且**零失败**。这个结果不可信——三个独立变异不可能同时完全无效。原因是脚本用行首锚点 `^✖` 匹配 Node 的 reporter 输出，而 `✖` 前面带 ANSI 色码，锚点匹配不上，脚本把「有失败」读成了「无失败」。**一个会把自己读错的探针比没有探针更危险**：它会给出「测试没判别力」的假警报，也可能反向给出假安心。修正（先剥 ANSI 再匹配，并同时打印 pass 计数交叉验证）后才得到上表。

## 17. 真实运行结果

本机（Windows 11）实测，真实 `desktop-session-awareness` 加载真实 World（其下是两个真实 Windows 感知），连续三次 `current()`：

```text
loadPlugin x4: 1ms
state: world=active awareness=active
current() #1: 397ms  kind=baseline    foreground=available inputActivity=available
            target={"kind":"present","title":"QQ","processName":"QQ"}  tick=673799203
current() #2: 391ms  kind=comparison  foreground=unchanged inputActivity=changed change=changed
            target={"kind":"present","title":"QQ","processName":"QQ"}  tick=673799515
current() #3: 447ms  kind=comparison  foreground=changed inputActivity=changed change=changed
            target={"kind":"present","title":"街の残像 - あばらや","processName":"cloudmusic"}  tick=673799875
```

几点值得记录：

- **本层的开销可忽略。** 三次耗时 397 / 391 / 447ms，与 P3-03 单独测 World 的 386 / 389 / 382ms 同量级。比较本身是几个 `===`，成本全在 World 的两次感知上。本层没有引入任何额外获取。
- **#2 是真实的核心场景**：前台没变（QQ 还是 QQ），tick 变了，整体因此是 `changed`。这正是 §8 那条不对称优先级在真实路径上的样子。
- **`===` 在非 ASCII 上工作正常**：#3 的标题含日文，比较不受影响。
- 绝对数值跨轮次不稳定（P3-03 记录过 386–674ms 区间），因此这里**只**用同一轮内的相对关系下结论。

## 18. 本阶段明确没有实现

- 没有 active / idle / away / presence / activity classification；
- 没有 salience / importance / notify / remember / act；
- 没有时间线比较、历史窗口、第三个及更早快照；
- 没有 `ChangeEvent`、事件、订阅、watcher、polling、timer；
- 没有持久化——不碰 Continuity，不碰 Chronicle；
- 没有 retry、backoff、dedup、debounce、rate limiting；
- 没有缓存、latest assessment、`ageMs`、freshness、stale、TTL；
- 没有 `errors.ts`、`manager.ts`、`state.ts`、`comparison.ts`；
- 没有引入任何感知领域类型（不 import 两个感知 barrel）。

## 19. 已知限制（P3-04 v1）

1. **不区分「变了」的种类。** `title` 改了和进程换了，都是同一个 `changed`。要区分需要引入字段级的差异结构，那已经接近「这意味着什么」，超出本阶段。
2. **`stable` 在真人使用下偏少。** 真实运行显示 tick 在几百毫秒内就会推进（`673799203 → 673799515`）。只要用户有输入，`inputActivity` 就是 `changed`，整体就是 `changed`。`stable` 实际只在「两次读取之间完全没有任何输入**且**前台没变」时出现——即空闲期。**这是对的**，但它意味着调用方不能把 `changed` 读成「有事发生」，那正是本层刻意不做的判断。
3. **`indeterminate` 不携带原因。** 与 P3-03 的 `unavailable` 同源决定：本层不拥有 World 的失败分类法。
4. **只比较相邻两次。** 没有历史窗口，所以「A → B → A」在第三次会报 `changed`（相对 B），而不是「回到原状」。这是设计选择，不是缺陷；要做后者需要保留更早的快照。
5. **`previous` 与 `current` 是引用。** 调用方若自行改动快照对象会破坏后续比较——快照在 World 侧已冻结，这是靠约定而非本层强制。
6. **并发下不保证 invocation-order baseline。** 多个 `current()` 并发时，baseline 按**成功的 World acquisition 的完成顺序**前进，而不是按调用发起顺序前进（§13）。本层不排队、不串行化、不加锁。单个 assessment 自身仍然完整自洽；受影响的只是「哪两次读数被拿来配对」。

## 20. 实现原则

- **只创建新文件。** 本轮对既有代码改动量为 0：`tsconfig.json` 的 `include: ["src/**/*.ts"]` 与 `npm test` 的 `test/*.test.mjs` 都是 glob，新文件自动纳入，无需改配置；`src/index.ts` 只导出 Runtime 核心，无需改。
- **比较逻辑是实现，不是契约。** 三个比较函数保持模块私有，公开面只有 6 个符号。
- **不制造选择题。** 本轮没有向人提出 A/B/C 决策；所有判断都由既有的 `principles.md` 与 P3-01/02/03 先例决定。
- **测试不放大公开 API。** 测试通过假 **provider** + 真实 Runtime 依赖图来做，不引入注入缝，不为测试暴露任何内部。
- **不使用耗时阈值。** 并发与空闲判定用 `setImmediate` 的事件循环轮次边界，不用 sleep。全文件没有一处真实的 `setTimeout` / `setInterval` 调用，也没有一处 `Date.now()`——那两个字符串只作为 §15 禁用词表的条目出现。
