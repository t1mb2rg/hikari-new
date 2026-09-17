# Hikari 第三阶段 P3-03 Desktop Session World v1 实现

> 状态：**P3-03 已实现，等待人工 Functional Review / Architecture Review**
>
> 未提交。本文只描述已落盘的实现事实，不代表审核结论。
>
> 范围：单个自治 Plugin `desktop-session-world`，经由 `desktop-session-world.current@1` 把两个已存在的感知 capability 组合成一次 snapshot。
>
> 第三阶段其余项不在本文范围内。

## 1. 阶段目标

P3-01 让 Runtime 能知道「此刻谁在前台」。P3-02 让 Runtime 能知道「系统记录的最后一次输入发生在哪个 tick」。两者都是 perception：**一个 source 告诉了我什么**。

本阶段只做这一件事：

> 让 Runtime 能加载一个自治的 `desktop-session-world` Plugin，并通过 `desktop-session-world.current@1` 取得一次「在这个 scope 内，我现在掌握了哪些事实」。

它**不**回答「这些事实意味着什么」。World 回答的是「我手里有什么」，而不是「这代表人在不在」。同一个 scope 下两个 source 都拿到了，就是两条事实；其中一个没拿到，就是一条事实加一个缺口。缺口就是缺口，不被解释成任何一种状态。

### 命名

模块名为 `desktop-session-world`，**不是** `windows-session-world`。

理由是结构性的：本模块**没有任何 Windows 专属实现**。它不含 `process.platform` 检查，不含 PowerShell，不含 Win32，不含子进程。它只组合两个 capability，而这两个 capability 今天恰好都只在 Windows 上可用——这是它们的事实，不是 World 的事实。把平台写进 World 的公开身份，会把「当前 provider 的实现平台」误固化成「World 的定义范围」，并给下一个平台留下一份需要改名的遗产。

同一理由决定了 service id 为 `desktop-session-world.current@1`：**service id 从不携带 `.windows`**，`.current` 后缀只在服务带 `current()` 方法时出现（`chronicle` 无此方法，故其 id 为裸 `chronicle`）。

## 2. 三层架构中的位置

`principles.md` §14 与 `core-architecture-v0.md` 的三层分工：

| 层 | 回答的问题 | 本阶段 |
| --- | --- | --- |
| **Perception** | 这个 source 告诉了我什么？ | P3-01 / P3-02 已完成 |
| **World** | 在这个 scope 内，我现在掌握了哪些事实？ | **本阶段** |
| **Awareness** | 这些事实意味着什么？ | 不在本阶段，且不被本阶段预埋 |

`core-architecture-v0.md:265` 已经写明：

> World 不是一个 `GlobalWorldState`，而是多个有范围、来源、新鲜度和不确定性的局部视图。

本阶段实现的是这句话里**最小的那个局部视图**：一个 scope（桌面会话），两个来源，逐条标注「拿到了 / 没拿到」。它**没有**引入 `GlobalWorldState`、`WorldManager`、跨 scope 聚合、跨 runtime 聚合。范围（scope）写在 Plugin ID 里，就是一个 scope；第二个 scope 出现时是一个新 Plugin，而不是本 Plugin 的一个配置项。

## 3. 阶段边界

本阶段明确不做以下事情，且这些边界已由代码结构保证，而不只是文档约定：

- **不修改任何既有文件**。`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json`、既有测试、`current-stage.md` 全部零改动；
- 不引入 `GlobalWorldState` / `WorldManager` / `PerceptionManager`；
- 不引入 Awareness / Judgement / Salience / Importance / Attention / User Presence / Idle Detection / Activity Classification；
- **不引入任何时间语义**：没有 freshness、stale、TTL、`ageMs`、过期判断；
- 不引入缓存、latest snapshot、polling、timer、watcher、event、`changed` event、history；
- 不引入 retry framework、dedup、debounce、rate limiting；
- 不与 Chronicle 集成，不做 LLM 调用，不做模型调用；
- 不引入第三个感知，不引入通用 Windows transport helper，不引入跨 runtime / 跨 session 聚合；
- **不新增平台实现**：模块内没有 `process.platform`；
- 不让 World 自己检查 Provider 是否存在。

## 4. 当前目录

P3-03 新增文件 **6 个**：

```text
src/desktop-session-world/  (4)
  types.ts  contracts.ts  plugin.ts  index.ts

test/
  desktop-session-world.test.mjs   # 确定性测试

docs/development/
  phase-3-desktop-session-world.md # 本文
```

`tsconfig.json` 的 `include` 为 `["src/**/*.ts"]`，`package.json` 的 `test` 为 `node --test test/*.test.mjs`，两者都是通配，因此**不需要**为新文件做任何配置改动。这正是「零既有文件修改」可行的原因，不是运气。

## 5. Snapshot 语义

```ts
export interface DesktopSessionWorldSnapshot {
  readonly snapshotAt: string;
  readonly foreground: DesktopSessionForegroundFacet;
  readonly inputActivity: DesktopSessionInputActivityFacet;
}
```

四条语义在实现中的落点：

| 语义 | 落点 |
| --- | --- |
| **Observed is observed.** | 两个 source 的 observation **按引用**放进 facet，不重建、不复制、不修正 |
| **Failure to observe is not an observation.** | 失败的 source 得到 `{ kind: 'unavailable' }`，绝不伪造一个 observation |
| **The snapshot carries no interpretation.** | 不做任何跨 facet 比较、关联、对齐或推断 |
| **The snapshot is one instant.** | 两个 source 在同一个同步段内启动，`snapshotAt` 在两者都 settle 之后产生 |

### snapshotAt

`snapshotAt` 表达的是 **World 组装完这次 snapshot 的那一刻**，不是任一 source 观测的时刻。它由 `current()` 在 `Promise.allSettled()` 完成后生成。

这一点与 P3-01 / P3-02 的 `observedAt` 是**两套不同的时间轴**，且它们在 snapshot 里同时可见：`snapshot.foreground.observation.observedAt` 是感知时刻，`snapshot.snapshotAt` 是组合时刻。World 不重打 source 的时间戳，也不声称两者相等。

### 冻结

snapshot 本身与两个 facet 外壳都被 `Object.freeze`。落点明确：**source 的 observation 对象不被 World 重新冻结**——它们由产生它们的模块负责，World 只是引用了它们。

## 6. Service 契约

```ts
export interface DesktopSessionWorldService {
  current(): Promise<DesktopSessionWorldSnapshot>;
}

export const desktopSessionWorldService = defineService<DesktopSessionWorldService>(
  'desktop-session-world.current',
  1,
);
```

一次 `current()` = 一次新的组合。无缓存，无复用，无去重。

## 7. Dependency 语义

```ts
export const desktopSessionWorldPlugin: PluginDefinition<undefined> = {
  id: 'desktop-session-world',
  version: '1.0.0',
  requires: [foregroundService, inputActivityService],
  provides: [desktopSessionWorldService],
  // ...
};
```

- **requires 两个感知**，不是可选的。World 的 `provides` 因此只在两者都在位时成立；
- Runtime 的依赖模型是**全有或全无**的：缺任一 capability，Plugin 停在 `waiting`，`provides` 不发生；
- **World 不检查 Provider 是否存在**。检查是 Runtime 的 `#reconcile` 循环的职责，World 的 `setup` 只有在两个 capability 都已在位时才会被调用；
- **provider 消失时走生命周期收敛**，不靠缓存兜底：`unloadPlugin` 掉任一个感知，Runtime 的 `#deactivateTree` 级联把 World 停回 `waiting`，World 的 `current()` 也不再可达。provider 回来后重新 `active`（测试 4）。

这直接落实 `principles.md` §16：provider 消失必须靠生命周期收敛，不允许留下悬挂的陈旧对象。

### 为什么 partial availability 不绕过依赖模型

「一个 source 失败、另一个成功」与「一个 capability 缺席」是**两件不同的事**，本阶段刻意让它们落在两个不同的机制上：

| 情形 | 机制 | 结果 |
| --- | --- | --- |
| capability 缺席（该感知根本没加载） | Runtime 依赖图 | World 停在 `waiting`，不 `active`，`current()` 不可达 |
| capability 在位但本次获取失败 | World 内的 `allSettled` | World 保持 `active`，该 facet 为 `unavailable` |

因此 World **不会**在缺 provider 的情况下假装 `active`，也不会为了拿到 partial world 去绕过 Runtime 的依赖模型。partial 只描述「在位的能力这一次没答上来」，不描述「我少了一个能力还继续跑」。

## 8. Partial availability

```ts
export type DesktopSessionForegroundFacet =
  | { readonly kind: 'available'; readonly observation: ForegroundObservation }
  | { readonly kind: 'unavailable' };

export type DesktopSessionInputActivityFacet =
  | { readonly kind: 'available'; readonly observation: InputActivityObservation }
  | { readonly kind: 'unavailable' };
```

两个 facet 各自独立地取 `available` / `unavailable`，四种组合都可达（测试 8、9、10、11）。

### unavailable 不携带原因

`unavailable` 分支**只有一个 `kind` 字段**，没有 `reason`、没有 `error`、没有 `message`。

理由是归属：World **不拥有**它所组合的 source 的失败分类学。把 transport 细节写进这个契约，就等于把 PowerShell 退出码、超时、权限拒绝这些属于感知实现的概念，提升成 World 层公开语义的一部分。需要诊断细节的调用方应当去问那个感知，而不是从 World 契约里读一个被转述过的二手原因。

测试断言了这一点：失败的 facet 的键集合恰为 `['kind']`。

### available + absent ≠ unavailable

这是与 P3-01 语义最直接的接触点。Foreground 的 `{ kind: 'absent' }` 是**一次成功的观测**——观测到了「此刻没有前台目标」。它与「没能观测」是两条完全不同的事实：

- `snapshot.foreground = { kind: 'available', observation: { foreground: { kind: 'absent' } } }` —— 我看了，桌面上没有前台窗口；
- `snapshot.foreground = { kind: 'unavailable' }` —— 我没能看。

实现上二者不可能塌缩：`available` 只由 `allSettled` 的 `fulfilled` 分支产生，`unavailable` 只由 `rejected` 分支产生，`absent` 则是 `fulfilled` 值内部的结构。测试 12 单独断言了这条。

### 类型上的一处已知重复

两个 facet 类型各自写了 `available | unavailable` 外壳，形状重复。

这里接受的**唯一**代价就是这个重复本身。两个联合类型**不是**可以互相赋值的：`available` 分支各自持有结构不同的 observation（`ForegroundObservation` 与 `InputActivityObservation`），因此整体联合并不自然可赋值。任何「用一个泛型 `Facet<T>` 消掉重复」的方案都需要先把两个 observation 的关系说清楚，而它们之间**没有**关系——那是第三层该回答的问题，不是本层。

## 9. 并发获取

```ts
const [foregroundResult, inputActivityResult] = await Promise.allSettled([
  Promise.resolve().then(() => foreground.current()),
  Promise.resolve().then(() => inputActivity.current()),
]);
```

三处细节都是刻意的：

**两个 source 在同一个同步段内启动。** 两次 `current()` 调用都发生在同一个 tick，中间没有任何 `await`，因此这次 snapshot 覆盖的是单次获取所能提供的最窄窗口。串行获取会让 snapshot 横跨两个 source 的完整耗时。

**`Promise.resolve().then(...)` 把同步抛出转成 rejection。** source 有两种失败方式：同步 `throw`，或返回一个 rejected promise。若直接写 `foreground.current()`，同步抛出会在 `allSettled` **构造数组时**就逃逸出去，使整个 `current()` reject——绕过 facet 机制，直接击穿契约。包一层之后，两种失败方式落到完全相同的位置。

`allSettled` 本身也保证了「一个先 settle 不影响另一个继续」。

**World 不看 reason。** 两处都只读 `result.status`，`result.reason` 从不被读取，来源 error 类型从不被检查。测试 11 用一个**没有任何类型**的 `new Error('something nobody modelled yet')` 证明：未建模的抛出与类型化的 observation error 落到完全相同的位置。

## 10. 失败边界

> **`desktopSessionWorldService.current()` 永不 reject。**

这是本阶段最重要的一条契约不变量。两个 source 同时失败时，`current()` 仍然 **resolve**，得到一个两个 facet 都 `unavailable` 的 snapshot（测试 10）。

理由：World 的职责是报告「我掌握了哪些事实」。「一条都没有」是这个问题的一个合法答案，而不是 World 自身的失败。若 `current()` 在此 reject，调用方就必须区分「World 坏了」与「World 好好地告诉我它什么都没拿到」——而后者恰恰是它该说的话。

World **不是错误总线**：它不聚合 source 的错误，不转发错误，不把错误分类成码。它只把每个 source 的结局折叠成一个二元的 availability。

## 11. 公开 API

`src/desktop-session-world/index.ts` 只导出 **6** 个符号：

```ts
export { desktopSessionWorldService } from './contracts.js';
export type { DesktopSessionWorldService } from './contracts.js';
export { desktopSessionWorldPlugin } from './plugin.js';
export type {
  DesktopSessionWorldSnapshot,
  DesktopSessionForegroundFacet,
  DesktopSessionInputActivityFacet,
} from './types.js';
```

`types.ts` / `contracts.ts` / `plugin.ts` **不在**公开面上，公开面只有 `index.ts`。

`src/index.ts`（根公开架构）**未改动**：它只导出 Runtime，不导出任何领域 barrel。World 与其他领域模块一样，通过自己的 `index.ts` 被使用。

## 12. 资源归属与持久化

World **不拥有任何资源**：没有子进程，没有文件句柄，没有计时器，没有监听器。

- 没有 `context.defer()`——因为没有任何东西需要释放；
- 没有 `errors.ts`——因为 World 不定义错误类型，也不抛出错误；
- 没有 factory seam——因为 World 没有需要注入的平台依赖。它的两个依赖**就是**两个 capability，二者都通过 Runtime 的 service registry 取得。测试因此不需要 `createXPlugin(...)` 这样的具名内部 import：直接加载**生产 Plugin** 加上两个假 provider 即可，测试与被测对象之间没有缝（见 §13）。

**零持久化**：World 不写 `origin.json`，不写 `chronicle.jsonl`，不写任何新文件。测试 16 在真实 Continuity + Chronicle 存储上跑两次 `current()`，断言目录快照**逐字节不变**，且卸载后文件清单仍恰为两项。

## 13. 当前测试

| 文件 | 内容 | 结果 |
| --- | --- | --- |
| `test/desktop-session-world.test.mjs` | 17 条确定性测试 | 17 pass / 0 fail |
| `npm test`（全量） | Phase 1 / 2 / 3 全部 | **154 pass / 0 fail / 0 skipped** |

`npx tsc -p tsconfig.json --noEmit` 干净。全量为 137（既有）+ 17（本阶段）= 154，与实际运行一致。

17 条覆盖：契约（`requires` / `provides` / id / version / 无依赖时 `waiting`）、经依赖图可达、等两个 capability 且不需要 Continuity / Chronicle 即可收敛、provider 消失回到 `waiting` 并再次激活、成功 snapshot 原样携带两个 observation、`snapshotAt` 在两个 facet 都 settle 之后产生、snapshot 与两个 facet 外壳冻结、每次 `current()` 都重新获取、前台失败只让前台 facet 不可用、输入活动失败只让输入活动 facet 不可用、两者都失败仍 resolve、同步抛出被记为不可用而不被分类、**成功观测到的 absent 保持 available**、**两个感知都在任一方 settle 之前启动**、加载/空闲/卸载期零观测、snapshot 不触碰 Continuity 与 Chronicle 存储、模块只依赖两个公开感知契约。

### 并发测试为何是确定性的

测试 14 不用耗时阈值。它用一个 **deferred gate** 把前台 source 按住，然后断言：

```js
await nextTurn();
assert.equal(foreground.counts.calls, 1);
assert.equal(inputActivity.counts.calls, 1, 'the second perception was not started before the first one settled');
assert.equal(settled, false, 'the snapshot resolved while a source was still pending');
```

`nextTurn()` 是一次 `setImmediate`，即**一整个事件循环轮次**，足以排空全部微任务。因此「门还关着的时候第二个 source 已经被调用」是一个**已完成的**事实，而不是「大概来得及」。

串行实现会让 `inputActivity.counts.calls` 在这里停在 `0`，测试立刻失败（见 §14 实测）。

### snapshotAt 测试为何是确定性的

这里有一个本轮才发现、必须记录的问题。

最初的写法是：在 gate 的回调里记 `finalSettlementAt = Date.now()`，然后断言 `Date.parse(snapshot.snapshotAt) >= finalSettlementAt`。**这条断言几乎没有判别力**——整个 snapshot 在远小于 1 毫秒内跑完，`finalSettlementAt` 与「在 `current()` 开头打的戳」通常落在**同一毫秒**，`>=` 因此照样成立。

现在改为等待**时钟本身**跨过一个毫秒边界：

```js
const boundary = await nextMillisecond();   // boundary > before，可证
assert.ok(boundary > before, 'the clock never advanced, so this test could not discriminate');

releaseInputActivity();
const result = await pending;

assert.ok(
  Date.parse(result.snapshotAt) >= boundary,
  `snapshotAt ${result.snapshotAt} was taken before the last source settled at ${finalSettlementAt}`,
);
```

`nextMillisecond()` 以 `setImmediate` 轮询 `Date.now()` 直到它离开调用时的毫秒，是**等待时钟自己走**，而不是猜一个时长；返回值因此可证大于此前任何读数。gate 在此之后才放行，于是「在 settle 之前打戳」必然落在严格更早的一毫秒，被断言抓住。

仓库里保留一条 `setTimeout(resolve, 50)`（测试 15），但它断言的是**计数仍为 0**——「什么都没发生」不需要等待时长的精确性，等得越久断言越强，与这里的性质不同。

## 14. 判别力探针

仓库测试通过并不等于测试**有判别力**：一条在正确实现与错误实现下都通过的断言，什么也没钉住。本轮用一次性探针（不进入仓库）变异 `dist/` 中的真实产物做了对抗式验证。

| 变异 | 被破坏的性质 | 结果 |
| --- | --- | --- |
| 无变异（基线） | — | 17 pass / 0 fail |
| 两次获取改为串行 | 两个感知在任一方 settle 前启动 | **1 fail**（测试 14） |
| `snapshotAt` 上提到 `await` 之前 | snapshotAt 在最后一个 source settle 之后产生 | **1 fail**（测试 6） |
| 同上变异 + **旧的弱断言** | 同上 | 17 pass / 0 fail |

前三行证明两条性质各自被真实钉住。**第四行是关键的一条**：同一个被破坏的实现，在换成加强前的弱断言后重新变绿——这证明 §13 的加强是**承重的**，不是文字润色。

探针本身也踩了一次坑，值得记录：`snapshotAt` 变异的第一版把打戳语句插在 `return Object.freeze({` 之前，而那个位置**仍然在 `await Promise.allSettled(...)` 之后**，语义上什么都没改，测试正确地保持绿色。是探针错了，不是测试错了。修正后（两处协同编辑：上提到函数体的第一行 + 引用该变量）才得到上表的第三行。**这个错法本身就是教训**：一个「看起来很邪恶」的变异如果没被测试抓住，先怀疑变异，再怀疑测试。

## 15. 真实运行结果

本机（Windows 11）实测，真实 `desktop-session-world` 加载两个真实 Windows 感知，连续三次 `current()`：

```text
loadPlugin x3: 0ms
current() #1: 386ms  foreground=available  inputActivity=available  snapshotAt=2026-09-17T13:33:14.877Z
current() #2: 389ms  foreground=available  inputActivity=available  snapshotAt=2026-09-17T13:33:15.267Z
current() #3: 382ms  foreground=available  inputActivity=available  snapshotAt=2026-09-17T13:33:15.649Z
```

两次 `current()` 之间的间隔（390ms）与单次耗时（386ms）同量级，与「无缓存、无复用」一致。

**组合耗时约 386ms，约等于较慢的那个 source，而不是两者之和。**

同一个 `npm test` 轮次里，两个感知各自的 smoke 诊断输出为：

```text
wall clock: loadPlugin 1ms, current() 638ms      # foreground.windows
wall clock: loadPlugin 0ms, current() 674ms      # input-activity.windows
```

若两次获取串行，组合应在 1300ms 量级；实测 386ms。§9 的同段启动在真实路径上确实生效，不只是在假 provider 的测试里成立。

（绝对数值在轮次之间不稳定——P3-01 记录过 370–455ms，P3-02 记录过 523ms，本轮单独运行为 638 / 674ms——因此这里**只**用同一轮内、同一台机器上的相对关系下结论，不比较跨轮次的绝对值。）

## 16. 本阶段明确没有实现

- 没有 `GlobalWorldState`、`WorldManager`、`PerceptionManager`；
- 没有 Awareness、Judgement、Salience、Importance、Attention、User Presence、Idle Detection、Activity Classification；
- 没有 freshness、stale、TTL、`ageMs`、过期判断；
- 没有缓存、latest snapshot、polling、timer、watcher；
- 没有 event、`changed` event、history；
- 没有 retry framework、dedup、debounce、rate limiting；
- 没有 Chronicle 集成，没有 LLM 调用，没有模型调用；
- 没有第三个感知，没有通用 Windows transport helper，没有跨 runtime 聚合，没有跨 session 聚合；
- 没有平台专属实现：模块内没有 `process.platform`，没有 PowerShell，没有 Win32；
- 没有修改任何既有文件，没有新增依赖（`package.json` 仍无 `dependencies` 字段）。

## 17. 已知限制（P3-03 v1）

1. **`unavailable` 不携带原因，调用方无法从 snapshot 区分失败形态。** 见 §8。超时、权限拒绝、进程无法启动在 World 层折叠成同一个 `{ kind: 'unavailable' }`。这是刻意的归属划分，代价真实存在：只看 snapshot 无法诊断。需要诊断时必须去问那个感知。
2. **World 是平台中立的，但今天的两个 source 都只在 Windows 上可用。** 因此在非 win32 宿主上，两个感知 Plugin 加载即 `failed`，World 会停在 `waiting`，`current()` 不可达。这是依赖模型的正确行为，不是缺陷；但它意味着「World 无平台实现」这句话今天是**结构上的**（代码里没有平台分支），而不是**运行时的**（实际上只在 Windows 上跑得起来）。
3. **snapshot 不判断新鲜度。** snapshot 同时携带两个 source 的 `observedAt` 与自己的 `snapshotAt`，但**不**比较它们，也不给出任何「这条事实是否够新」的结论。需要新鲜度的消费者必须自己持有时间语义。这是三层分工的直接后果，不是缺口。
4. **两次真实子进程获取的成本没有被摊薄。** 并发使一次 snapshot 的墙钟约等于较慢的 source（§15），但系统总开销仍是两个 PowerShell 进程。本阶段不引入预热、不引入常驻、不引入任何形式的缓存。这是 P3-01 / P3-02 已知限制在组合层的延续。
5. **两个 facet 类型的外壳重复未被消除。** 见 §8 末。接受的唯一代价就是这个重复。
6. **snapshot 的原子性只到「单次获取的最窄窗口」。** 两个 source 在同一个同步段启动，但它们各自完成的时间点不同，`observedAt` 也可能不同。World **不**声称两个 observation 是同时刻的事实——它只把两次观测放进同一个信封，并如实记录信封封口的时间。
7. **World 不校验 observation 的形状。** facet 按引用持有 source 给的 observation，若某感知返回了形状不对的对象，World 会原样透传。校验是产生 observation 的那一层的职责（P3-01 的 `readAcquisition`、P3-02 的 `readAcquisition`），在 World 再做一次只会制造第二个真相来源。

## 18. 实现原则

`core-architecture-v0.md` 的「Runtime 负责机制，不理解领域意义」仍是上位原则，本阶段没有新增第二套架构原则。P3-03 是这条原则第一次应用在**组合层**，而不是感知层：

> **World 是 composer，不是 interpreter。**

它只回答「我手里有什么」，不回答「这代表什么」。它把两个 source 的结局折叠成两个可用性，不做关联、不做对齐、不做推断、不做解释。现实很奇怪就报告奇怪的现实；解读属于第三层，不属于 P3-03。

`principles.md` §18「不做宗教式解耦」同样落在实现里：World 与两个感知之间**没有**事件总线、没有中间抽象、没有通用 Observation 框架。最直接的语义正确沟通就是 `requires` 两个 capability、在 `setup` 里 `get`、在 `current()` 里 `await`。任何「解耦」都会把一个本层必须知道的事实（它的两个来源是谁）藏进一个间接层，而那不叫解耦，叫转移。

### 复述：本阶段只进了第二层

`principles.md` §14 的 `Perception ≠ Awareness` 是本阶段唯一容易越界的地方。三个问题的分界在本阶段被反复用到：

- 「前台窗口是什么」→ 感知层，已在 P3-01 回答；
- 「最后一次输入在哪个 tick」→ 感知层，已在 P3-02 回答；
- 「这两个事实在不在一条时间线上」→ **本阶段不回答**。它属于「这些事实意味着什么」。

World 停在「两条事实都拿到了」或「拿到一条、缺一条」。它不把「前台是 Notepad」与「刚有输入」合起来推出「某人正在打字」——那是第三层的句子，写在这里就是越层。
