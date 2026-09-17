# Hikari 第三阶段 P3-03 Desktop Session World v1 Architecture Review

> 结论：**P3-03 Architecture Review: PASS**（P3-03 Functional PASS + Architecture PASS）
>
> 范围：单个自治 Plugin `desktop-session-world`，经由 `desktop-session-world.current@1` 把两个已存在的感知 capability 组合成一次 snapshot。
>
> 上位原则：`core-architecture-v0.md` §12.2「Runtime 负责机制，不理解领域意义」、`core-architecture-v0.md:265`「World 不是 `GlobalWorldState`，而是多个有范围、来源、新鲜度和不确定性的局部视图」、`principles.md` §14「Perception ≠ Awareness」。本轮没有新增第二套架构原则。
>
> 本文按既有惯例把 Functional Review 作为 §1；P3-03 不单独拆出一份 Functional Review 文件。

## 1. Functional Review

以下每一条都由当前真实的文件、真实的测试或真实的 Windows 运行支撑，不是设计意图的转述。

- Runtime 可以加载一个 `requires: [foreground.current@1, input-activity.current@1]` 的 Plugin，并在两个 capability 都到位后把它置为 `active`；
- 缺任一 capability 时 World 停在 `waiting`，`provides` 不发生，`current()` 不可达；
- provider 消失时 World 经 `#deactivateTree` 回到 `waiting`，provider 回来后重新 `active`；
- 一次 `current()` 组合**两次真实获取**，返回两个 facet；
- 每次调用都是一次新的组合，没有缓存、没有复用、没有去重；
- `setup`、空闲、`shutdown` 期间**零观测**（两个感知源的调用计数均为 0）；
- 两个 source 在**同一个同步段**内启动，第二个 source 在第一个 settle 之前就被调用；
- `snapshotAt` 在 `Promise.allSettled()` 完成**之后**产生，由测试实证；
- 成功 snapshot **按引用**携带两个 source 的 observation，不重建、不复制；
- `{ kind: 'absent' }` 是成功观测，facet 为 `available`，与 `unavailable` 不塌缩；
- 单个 source 失败只让该 facet `unavailable`，另一个 facet 保持 `available`；
- 两个 source 同时失败时 `current()` 仍然 **resolve**，两个 facet 都 `unavailable`；
- **同步抛出**与 promise rejection 落到完全相同的位置，且 World 不检查 error 类型、不读 reason；
- `unavailable` facet 的键集合恰为 `['kind']`，不携带原因；
- snapshot 与两个 facet 外壳被冻结；
- 不依赖 Continuity、Chronicle 即可收敛；
- 组合不触碰 Continuity 与 Chronicle 的任何持久字节（两次 `current()` 后目录逐字节不变）；
- 真实 Windows 上两个 facet 同时 `available`。

真实运行样例（本机 Windows 11，两个真实 Windows 感知）：

```text
loadPlugin x3: 0ms
current() #1: 386ms  foreground=available  inputActivity=available  snapshotAt=2026-09-17T13:33:14.877Z
current() #2: 389ms  foreground=available  inputActivity=available  snapshotAt=2026-09-17T13:33:15.267Z
current() #3: 382ms  foreground=available  inputActivity=available  snapshotAt=2026-09-17T13:33:15.649Z
```

本地测试：**154 / 154 PASS，0 skipped**（17 个 DesktopSessionWorld + 16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。全量为 137（既有）+ 17（本阶段）。

编译：`npx tsc -p tsconfig.json --noEmit` 无错误。

**Functional PASS。**

有一条**必须与结论同时阅读**的限制，见 §14 与 §17：17 条测试中有 2 条（并发、`snapshotAt` 时序）的**判别力**由一次性变异探针验证，而不是由测试自身证明。该探针不在仓库内、不进 CI、不可复现。

## 2. Runtime 边界：Runtime 仍然只理解机制

World 是**第一个** `requires` 非空的领域模块。它因此是 Runtime 依赖模型第一次被真实使用的用例，而不只是一条实现路径。

Runtime 侧**零改动**：`src/runtime/` 全部文件逐字节未改动。World 只使用了 Runtime 已经公开的既有能力：

```text
PluginDefinition.requires          已有
PluginDefinition.provides          已有
context.services.get(contract)     已有
context.services.provide(...)      已有
defineService(id, version)         已有
#reconcile 依赖收敛                 已有
```

**没有**为 World 新增任何 Runtime API，也**没有**新增依赖语义。partial availability 是在已有 `Promise.allSettled` 语义之上表达的，不是在 Runtime 里加一个「可选依赖」概念换来的（见 §5）。

> **World 没有让 Runtime 学会任何关于「世界」的事。**

`src/runtime/` 中不存在 `World`、`Snapshot`、`Facet`、`Available`、`Unavailable` 等概念。Runtime 只知道「有个 Plugin 依赖两个契约、提供第三个契约」，这与它知道 Foreground 或 Chronicle 的方式完全相同。

## 3. Continuity / Chronicle 边界

World **不**依赖 Continuity，**不**依赖 Chronicle，**不**读写任何领域文件。

- 无 `context.defer()`——World 不拥有任何资源（无子进程、无文件句柄、无计时器、无监听器），因此没有需要释放的东西；
- 无 `errors.ts`——World 不定义错误类型，也不抛出错误（见 §6）；
- 测试 16 在真实 Continuity + Chronicle 存储上运行两次 `current()`，断言目录快照**逐字节不变**，且卸载后文件清单仍恰为 `continuity/origin.json` 与 `chronicle/chronicle.jsonl` 两项。

`src/continuity/` 与 `src/chronicle/` 全部文件逐字节未改动。

## 4. World 作为第二层的入场（本阶段的主要架构结果）

三个阶段的分工在实现文档 §2 已列明：

| 层 | 回答的问题 | 状态 |
| --- | --- | --- |
| Perception | 这个 source 告诉了我什么？ | P3-01 / P3-02 已交付 |
| **World** | **在这个 scope 内，我现在掌握了哪些事实？** | **P3-03 首次进入** |
| Awareness | 这些事实意味着什么？ | 未进入，且未被预埋 |

本阶段的主要架构结果**不是**新增了一种能力，而是证明了下面这条：

> **组合是可以在没有协调层的情况下发生的。**

World 本可以很容易地长成 `PerceptionManager` / `ObservationBus` / `GlobalWorldState`——「把多个 source 的观测汇总起来」是这类结构最常见的出生理由。本阶段刻意没有这么做：

```text
没有 PerceptionManager          —— World 自己就是一个普通 Plugin
没有通用 Observation 框架        —— 两个 facet 是具名联合，不是泛型容器
没有事件总线                    —— 两个 source 是 requires 出来的，不是订阅来的
没有中心注册表                  —— Runtime 的 ServiceRegistry 已是唯一的注册表
没有 cross-session 聚合         —— 一个 scope 就是一个 Plugin
```

World 取得两个 source 的方式与任何消费者取得任何 capability 的方式**完全相同**：`requires` 声明、`setup` 里 `get`、调用时 `await`。它没有为「我是组合者」这个身份要求任何特殊待遇，Runtime 也没有给它任何特殊待遇。

`core-architecture-v0.md:265` 说 World 是「多个有范围、来源、新鲜度和不确定性的局部视图」。本阶段落地的是这句话里**最小的那个**：一个 scope（桌面会话）、两个来源、逐条标注「拿到了 / 没拿到」。**范围写在 Plugin ID 里**——第二个 scope 出现时应当是一个新 Plugin，而不是本 Plugin 的一个配置项；这条决定了本阶段不引入 scope 参数、不引入 scope 注册表。

## 5. Dependency 语义：capability 缺席 ≠ capability 失败

这是本阶段最容易做错、也是评审时最值得复核的一处设计。

「一个 source 失败、另一个成功」与「一个 capability 缺席」是**两件不同的事**，本阶段让它们落在两个**不同**的机制上：

| 情形 | 机制 | 结果 |
| --- | --- | --- |
| capability 缺席（该感知根本没加载） | Runtime 依赖图（`#reconcile`） | World 停在 `waiting`，**不** `active`，`current()` 不可达 |
| capability 在位但本次获取失败 | World 内的 `allSettled` | World 保持 `active`，该 facet 为 `unavailable` |

被明确拒绝的三个替代方案：

```text
1. 让 World 自己检查 Provider 是否存在，缺了就返回 partial world
   → 拒绝：这是把 Runtime 的职责复制进领域模块，制造第二个真相来源

2. 把两个 capability 声明成「可选依赖」，让 World 永远 active
   → 拒绝：这需要给 Runtime 新增一种依赖语义，且会让 World 在缺 source 时
     声称自己掌握了事实——它没有

3. 把 world 的 requires 降级成运行时查询（tryGet / 动态发现）
   → 拒绝：绕过依赖图意味着 provider 消失时不再有生命周期收敛，
     直面 principles.md §16 所禁止的悬挂陈旧对象
```

因此：**World 不会在缺 provider 的情况下假装 `active`，也不会为了拿到 partial world 去绕过 Runtime 的依赖模型。** partial 只描述「在位的能力这一次没答上来」，**不**描述「我少了一个能力还继续跑」。

这同时落实了 `principles.md` §16：provider 消失必须靠生命周期收敛，不允许留下悬挂的陈旧对象。World 的收敛路径是 Runtime 既有的 `#deactivateTree`，不是它自己写的。

## 6. Partial availability 与失败边界

两个 facet 各自独立取 `available` / `unavailable`，四种组合都可达（测试 8 / 9 / 10 / 11 分别覆盖）。

### 6.1 `current()` 永不 reject

本阶段最重要的契约不变量，写在实现文档 §10：

> 两个 source 同时失败时，`current()` 仍然 **resolve**，得到一个两个 facet 都 `unavailable` 的 snapshot。

理由是职责归属：World 的职责是报告「我掌握了哪些事实」，「一条都没有」是这个问题的**一个合法答案**，而不是 World 自身的失败。若 `current()` 在此 reject，调用方就必须区分「World 坏了」与「World 好好地告诉我它什么都没拿到」——而后者恰恰是它该说的话。测试 10 用 `.then(onResolve, onReject)` 显式断言了 `outcome === 'resolved'`。

### 6.2 World 不是错误总线

- World **不**聚合 source 的错误；
- World **不**转发错误；
- World **不**把错误分类成码；
- World **不**读取 `result.reason`，**不**检查 error 类型。

测试 11 用一个**没有任何类型**的 `new Error('something nobody modelled yet')` 证明：未建模的抛出与类型化的 observation error 落到完全相同的位置。这同时满足 `principles.md` §21 的反面——**不要根据具体 error class 来决定 availability**。

### 6.3 `unavailable` 不携带原因

`unavailable` 分支**只有一个 `kind` 字段**，没有 `reason` / `error` / `message`，并由测试断言键集合恰为 `['kind']`。

理由是归属：World **不拥有**它所组合的 source 的失败分类学。把 transport 细节写进这个契约，等于把 PowerShell 退出码、超时、权限拒绝这些属于感知实现的概念，提升成 World 层公开语义的一部分。需要诊断细节的调用方应当去问那个感知，而不是从 World 契约里读一个被转述过的二手原因。

### 6.4 `available + absent` ≠ `unavailable`

Foreground 的 `{ kind: 'absent' }` 是**一次成功的观测**——观测到了「此刻没有前台目标」。它与「没能观测」是两条完全不同的事实：

```text
{ kind: 'available', observation: { foreground: { kind: 'absent' } } }   我看了，桌面上没有
{ kind: 'unavailable' }                                                  我没能看
```

实现上二者不可能塌缩：`available` 只由 `allSettled` 的 `fulfilled` 分支产生，`unavailable` 只由 `rejected` 分支产生，`absent` 则是 `fulfilled` **值内部**的结构。测试 12 单独断言了这条。

这是 P3-01 冻结的「Absence is an observation」在组合层的直接延续：World 不重新判定 source 的一句话是不是观测，它只判定 source 有没有答上来。

## 7. Pull-only：没有后台机制

与 P3-01 / P3-02 一致，World **没有任何后台机制**：

- 无 `changed` Event、无订阅、无 watcher、无 polling、无 timer；
- 无缓存、无 latest snapshot、无 history；
- 无 retry framework、无 dedup、无 debounce、无 rate limiting；
- 加载、空闲、卸载期间**零观测**——测试 15 断言两个 source 的调用计数在 `setup` 后、`setTimeout(50)` 后、`shutdown` 后**均为 0**。

World 的 `setup` 只做两件事：`get` 两个 source，`provide` 自己的 service。它**不**在 `setup` 里做第一次观测、不预热、不保活。

> **World 是 pull-only 的**：没有 `current()` 调用就没有任何观测发生。

## 8. 没有引入持久化

World 不写 `origin.json`，不写 `chronicle.jsonl`，不写任何新文件，不创建任何目录。

测试 16 的断言方式是**整目录逐字节快照比对**，不是「没有调用某个 write API」——前者能抓到实现里任何形式的意外落盘，后者不能。

## 9. 没有引入 Awareness / Judgement / Manager

按 §4 的分类，本阶段只进入第二层。以下全部**没有**出现，且边界由结构保证而非文档约定：

```text
GlobalWorldState        WorldManager            PerceptionManager
Awareness               Judgement               Salience
Importance              Attention               User Presence
Idle Detection          Activity Classification
freshness               stale                   TTL / ageMs
cache                   latest snapshot         polling / timer / watcher
event / changed event   history                 retry framework
dedup / debounce        rate limiting           Chronicle 集成
LLM / model call        第三个 Perception       通用 Windows transport helper
跨 runtime 聚合          跨 session 聚合
```

值得单独说明的是**「没有 freshness」**这条容易被误认为缺口的地方。snapshot 同时携带两个 source 的 `observedAt` 与自己的 `snapshotAt`，但**不比较它们**，也不给出任何「这条事实是否够新」的结论。这是三层分工的直接后果：判断新旧是 interpretation，属于第三层。需要新鲜度的消费者必须自己持有时间语义。

同样地，World **不**校验 observation 的形状——它按引用持有 source 给的对象。校验是产生 observation 的那一层的职责（P3-01 与 P3-02 各自的 `readAcquisition`），在 World 再做一次只会制造第二个真相来源。

## 10. 公开面没有为测试扩大

`src/desktop-session-world/index.ts` 恰好导出 **6** 个符号：

```ts
desktopSessionWorldService      (value)
DesktopSessionWorldService      (type)
desktopSessionWorldPlugin       (value)
DesktopSessionWorldSnapshot     (type)
DesktopSessionForegroundFacet   (type)
DesktopSessionInputActivityFacet (type)
```

`types.ts` / `contracts.ts` / `plugin.ts` 不在公开面上。

**本阶段没有第二处具名内部 import。** P3-01 与 P3-02 都需要 `import { createXPlugin } from '../dist/.../plugin.js'` 来注入 fake acquirer；World **不需要**，因为它没有需要注入的平台依赖——它的两个依赖**就是**两个 capability，二者都经由 Runtime 的 service registry 取得。测试因此直接加载**生产 Plugin**，再加载两个假 provider Plugin，让真实的 `#reconcile` 决定谁 active：

```js
await runtime.loadPlugin(foreground.definition);
await runtime.loadPlugin(inputActivity.definition);
await runtime.loadPlugin(desktopSessionWorldPlugin);   // 生产对象，未包装
```

测试与被测对象之间**没有缝**，因此也不需要为测试开口。这是 P2-03 / P2-04 以来第一次出现这种情况，且它是设计的结果而非巧合：**没有内部 seam，是因为没有需要被替换的内部实现。**

## 11. 平台知识：World 没有平台实现

全 `src/desktop-session-world/` 中：

```text
process.platform     0 处
PowerShell / pwsh    0 处
execFile / spawn     0 处
Win32 / HWND / LASTINPUTINFO   0 处
```

由测试 17 对**真实源文件**做 token 扫描断言，不是看一眼就下的结论。

这与 P3-01 / P3-02 形成对照：那两个模块**各自拥有**一份平台判断（各一处 `process.platform`，位于各自的 `windows.ts` 内），因为它们是平台特定能力的实现。World **不是**——它没有任何平台特定实现，它只组合两个 capability。因此：

> **「运行在 Windows 上」是 World 当前两个 provider 的事实，不是 World 的事实。**

这条区分直接决定了命名（§15），也是 §17.2 那条限制的来源：World 在**结构上是**平台中立的（代码里没有平台分支），但在**运行时**今天只在 Windows 上跑得起来（因为两个 provider 都是 Windows-only）。

## 12. `snapshotAt` 的产生方与两套时间轴

World 的 snapshot 里**同时存在两套时间轴**，且它们不被比较：

```text
snapshot.foreground.observation.observedAt      该感知取得该事实的时刻
snapshot.inputActivity.observation.observedAt   该感知取得该事实的时刻
snapshot.snapshotAt                             World 组装完这次 snapshot 的时刻
```

`snapshotAt` 由 World 自己在 `Promise.allSettled()` **完成之后**产生。它与 P3-01 / P3-02 的 `observedAt` 的关系是：

- World **不**重打 source 的时间戳——observations 按引用透传，测试 5 断言了引用同一性，测试 6 断言 `snapshotAt` 不等于 source 的 `observedAt`；
- World **不**声称两个 observation 是同时刻的事实——它只把两次观测放进同一个信封，并如实记录**信封封口**的时间。

**snapshot 的原子性只到「单次获取所能提供的最窄窗口」**（见 §13），World 不对更强的东西做承诺。这是刻意的：声称「这两个事实同时成立」需要跨 source 的时钟对齐，那是一个 World 没有能力、也没有被授权做出的判断。

## 13. 并发获取与同步抛出的折叠

```ts
const [foregroundResult, inputActivityResult] = await Promise.allSettled([
  Promise.resolve().then(() => foreground.current()),
  Promise.resolve().then(() => inputActivity.current()),
]);
```

三处细节都是承重的：

**（1）两个 source 在同一个同步段内启动。** 两次 `current()` 调用发生在同一个 tick，中间没有 `await`，因此 snapshot 覆盖的是单次获取所能提供的最窄窗口。串行获取会让 snapshot 横跨两个 source 的完整耗时——实测代价见 §13.1。

**（2）`Promise.resolve().then(...)` 把同步抛出转成 rejection。** source 有两种失败方式：同步 `throw`，或返回 rejected promise。若直接写 `foreground.current()`，同步抛出会在 **`allSettled` 构造数组时**就逃逸出去，使整个 `current()` reject——绕过 facet 机制，直接击穿 §6.1 的契约。包一层之后，两种失败方式落到完全相同的位置。这是本阶段**唯一**一处「为语义正确性而非风格写的包装」。

**（3）`allSettled` 而非 `all`。** `all` 会在第一个 rejection 时短路，另一个 source 的结果被丢弃；`allSettled` 保证两个 facet 都能被如实报告。这正是 partial world 的实现基础——若用 `all`，「一个失败、一个成功」将无法表达。

### 13.1 实测效果

```
loadPlugin x3: 0ms
current() #1: 386ms  foreground=available  inputActivity=available
current() #2: 389ms
current() #3: 382ms
```

同一轮 `npm test` 中两个感知**各自单独**的 smoke 诊断：

```text
wall clock: loadPlugin 1ms, current() 638ms      # foreground.windows
wall clock: loadPlugin 0ms, current() 674ms      # input-activity.windows
```

串行应在 1300ms 量级，实测 386ms。**同段启动在真实路径上确实生效，不只是在假 provider 的测试里成立。**

（绝对数值在轮次之间不稳定——P3-01 记录过 370–455ms，P3-02 记录过 523ms，本轮单独运行为 638 / 674ms——因此这里只用同一轮内、同一台机器上的**相对关系**下结论，不比较跨轮次的绝对值。）

## 14. 测试策略与判别力探针的证据等级

17 条确定性测试全部使用假 provider Plugin + 真实 Runtime + **生产 World Plugin**，不断言任何具体耗时。

### 14.1 并发测试为何是确定性的

测试 14 用一个 **deferred gate** 按住前台 source，然后：

```js
await nextTurn();
assert.equal(foreground.counts.calls, 1);
assert.equal(inputActivity.counts.calls, 1, 'the second perception was not started before the first one settled');
assert.equal(settled, false, 'the snapshot resolved while a source was still pending');
```

`nextTurn()` 是一次 `setImmediate`，即**一整个事件循环轮次**，足以排空全部微任务。因此「门还关着的时候第二个 source 已经被调用」是一个**已完成的**事实，而不是「大概来得及」。没用任何耗时阈值。

### 14.2 `snapshotAt` 测试为何是确定性的——以及它一开始并不成立

**这是本轮最重要的一条评审记录。**

最初的写法是在 gate 回调里记 `finalSettlementAt = Date.now()`，再断言 `Date.parse(snapshotAt) >= finalSettlementAt`。这条断言**几乎没有判别力**：整个 snapshot 在远小于 1 毫秒内跑完，两个时间戳通常落在**同一毫秒**，`>=` 照样成立。

改为等待**时钟本身**跨过毫秒边界：

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

`nextMillisecond()` 以 `setImmediate` 轮询 `Date.now()` 直到离开调用时的毫秒——是**等待时钟自己走**，不是猜一个时长；返回值因此可证大于此前任何读数。gate 在此之后才放行，于是「在 settle 之前打戳」必然落在严格更早的一毫秒，被断言抓住。

### 14.3 判别力探针（一次性，不在仓库内）

仓库测试通过 ≠ 测试**有判别力**：一条在正确实现与错误实现下都通过的断言，什么也没钉住。本轮对 `dist/` 中的真实产物做变异：

| 变异 | 被破坏的性质 | 结果 |
| --- | --- | --- |
| 无变异（基线） | — | 17 pass / 0 fail |
| 两次获取改为串行 | 两个感知在任一方 settle 前启动 | **1 fail**（测试 14） |
| `snapshotAt` 上提到 `await` 之前 | snapshotAt 在最后一个 source settle 之后产生 | **1 fail**（测试 6） |
| 同上变异 + **加强前的弱断言** | 同上 | 17 pass / 0 fail |

前三行证明两条性质各自被**真实**钉住。**第四行是关键的对照**：同一个被破坏的实现，在换回弱断言后重新变绿——这证明 §14.2 的加强是**承重的**，不是文字润色。

### 14.4 探针自身的一次错误（必须记录）

`snapshotAt` 变异的**第一版是无效的**：它把打戳语句插在 `return Object.freeze({` 之前，而那个位置**仍然在 `await Promise.allSettled(...)` 之后**，语义上什么都没改。测试正确地保持绿色。

我最初把这个 0 读成了「测试没有判别力」。**错的不是测试，是变异。**修正为两处协同编辑（上提到函数体第一行 + 引用该变量）后才得到上表第三行。

**这条错法本身就是教训：一个「看起来很邪恶」的变异如果没被测试抓住，先怀疑变异，再怀疑测试。**把「变异未被抓住」直接当成「测试无效」，会导致把一条本来正确的断言改坏。

### 14.5 证据等级（必须与结论同时阅读）

```text
17 条确定性测试       在仓库内、进 CI、可复现
§14.3 的四行变异结果   会话内一次性探针，不在仓库内、不进 CI、不可复现
```

即：测试本身是可复现的回归覆盖；**「这两条测试确实有判别力」这个结论的证据等级较低**——它证明了「当时确实验过」，不证明「以后不会被改坏」。这是 P3-01 / P3-02 以来一以贯之的同一类限制。

### 14.6 已知 coverage gap（watch item，与前两阶段同型）

`src/foreground/windows.ts` 与 `src/input-activity/windows.ts` 的 parser rejection branches 不在 `npm test` 内（P3-01 / P3-02 已记录）。**P3-03 没有加剧这个缺口**——World 没有 parser，没有平台分支，没有内部 seam，它的全部分支都在仓库测试覆盖内。

但该缺口**仍然涉及两个模块**，本轮没有改变处理结论：不为测试覆盖扩大 public API、不改 seam。若未来出现第三个同型 parser，应重新评估 test seam 与 transport seam。

## 15. 命名：为什么是 `desktop-session-world`

模块名为 `desktop-session-world`，**不是** `windows-session-world`。

理由是结构性的，且在 §11 已有代码证据：本模块**没有任何 Windows 专属实现**。把平台写进 World 的公开身份，会把「当前 provider 的实现平台」误固化成「World 的定义范围」，并给下一个平台留下一份需要改名的遗产——而 World 恰恰是那个**不该**随平台变的东西。

配套的两条命名决定与本仓库已有惯例一致：

```text
service id: desktop-session-world.current@1
.service id 从不携带 .windows
.current 后缀只在服务带 current() 方法时出现
  → chronicle 无此方法，故其 id 为裸 chronicle
```

这条规则是从仓库既有四个模块的实际命名中归纳出来的，不是偏好。

## 16. 重复与不过早抽象

本阶段接受了一处**明确的小重复**：两个 facet 类型各自写了 `available | unavailable` 外壳。

**必须准确描述这处代价**：两个联合类型**不是**可以互相赋值的。`available` 分支各自持有结构不同的 observation（`ForegroundObservation` vs `InputActivityObservation`），因此整体联合并不自然可赋值。任何「用一个泛型 `Facet<T>` 消掉重复」的方案都需要**先把两个 observation 的关系说清楚**，而它们之间**没有**关系——那是第三层该回答的问题，不是本层。

因此接受的代价就是**重复本身**，而不是别的什么东西。这与 P3-01 / P3-02 那条 68 行 transport 重复是同一类判断：**错误的抽象比重复更难撤销**。

以及一条**新产生**的重新评估信号：World 是第一个需要同时看两个感知契约的模块。若未来出现**第三个**需要组合多个感知的 World，届时「facet 外壳」与「transport 外壳」两处重复应放在一起重新评估——现在样本仍然只有一例。

## 17. 已知限制

1. **`unavailable` 不携带原因，调用方无法从 snapshot 区分失败形态。** 见 §6.3。超时、权限拒绝、进程无法启动在 World 层折叠成同一个 `{ kind: 'unavailable' }`。这是刻意的归属划分，代价真实存在：只看 snapshot 无法诊断。需要诊断时必须去问那个感知。
2. **World 结构上平台中立，但今天只在 Windows 上跑得起来。** 见 §11。非 win32 宿主上两个感知 Plugin 加载即 `failed`，World 停在 `waiting`，`current()` 不可达。这是依赖模型的正确行为，不是缺陷；但它意味着「World 无平台实现」是**结构性的**而非**运行时的**。
3. **snapshot 不判断新鲜度。** 见 §8 末与 §12。两套时间轴都在，但 World 不比较、不判定。需要新鲜度的消费者必须自己持有时间语义。
4. **两次真实子进程获取的成本没有被摊薄。** 并发使一次 snapshot 的墙钟约等于较慢的 source（§13.1），但系统总开销仍是两个 PowerShell 进程。本阶段不引入预热、不引入常驻、不引入任何形式的缓存。这是 P3-01 / P3-02 已知限制在组合层的延续。**World 没有让感知变快，只是没有让它更慢。**
5. **两个 facet 类型的外壳重复未被消除。** 见 §16，是一处有意识接受的重复。
6. **snapshot 的原子性只到「单次获取的最窄窗口」。** 两个 source 在同一个同步段启动，但各自完成的时间点不同，`observedAt` 也可能不同。World 不声称两个 observation 是同时刻的事实。
7. **World 不校验 observation 的形状。** 见 §8 末。若某感知返回形状不对的对象，World 会原样透传。这**不是**一条可以无限容忍的性质：它意味着 World 的契约保真度**依赖**两个感知的契约保真度。当前的依赖是安全的（两个感知各自有严格校验），但它是一个需要被记住的耦合方向。

## 18. 工具限制（如实记录）

**本轮与 P3-01 / P3-02 的收口轮不同：本轮拿到了真实的图谱变更证据。**

前两轮的收口是纯文档、未执行 `git add`，全部产物是未跟踪新文件、不进 `git diff`、索引也早于改动，因此 `detect_changes` 的 `changed_count: 0` 必须读作「**未看见**」而不是「**无影响**」。本轮先 `git add` 了代码/测试文件并重建索引，因此下面这组数字是**有效**的。收口轮把 3 个文档一并 stage 后重测，`changed_symbols` 由代码符号增至含文档标题符号：

```text
detect_changes --scope staged
  收口前（仅 5 个代码/测试文件）: 51 changed symbols / 5 files
  收口后（含 3 个文档，最终态）:  123 changed symbols / 8 files
  affected_processes: [] / affected_count: 0 / risk_level: low
  无 partial，无 truncated

changed_symbols（收口前 51）的构成——代码侧，收口后不变：
  src/desktop-session-world/  16 个（contracts 3 + plugin 7 + types 6）
  test/desktop-session-world.test.mjs  35 个
  收口后新增的 72 个全部是三个文档的 Section 节点，不参与依赖图

changed_files 的 5 个构成：
  上述 4 个 .ts + 1 个 .mjs
  （index.ts 只有 File 节点、不含符号，故计入 changed_files 但不计入 changed_symbols）

受影响流程：0 条
受影响既有符号：0 个
```

两次读数之间的差值全部来自文档标题符号，**代码侧的 51 个与 0 影响在收口轮重测后逐项不变**。

IMPORTS 边（同一索引，对真实图查询）：

```text
src/desktop-session-world/ 的对外 IMPORTS 共 12 条，其中外部目标恰好 4 个：
  src/runtime/contracts.ts
  src/runtime/plugin.ts
  src/foreground/index.ts
  src/input-activity/index.ts
全部是公开入口；到 src/foreground/windows.ts、src/input-activity/windows.ts
或任何内部模块的边：0 条

指向 src/desktop-session-world/ 的入边：0 条
  → 即没有任何既有模块引用本阶段新增的模块
```

`risk_level: low` 且 `affected_processes: []`，因此**没有需要警告的 HIGH / CRITICAL**。这与「零既有文件修改」是两条独立的证据，方向一致。

其余工具限制：

- **图谱不解析 `.mjs` 的 IMPORTS 边**（P2-04 已记录）：针对测试文件的导入查询返回空，**这个空结果不是「没有依赖」的证据**。本轮测试对 `dist/desktop-session-world/index.js` 的 import 属同一情形；该结论改用文本检索获得（测试 17 直接读源文件做 specifier 断言，是比图谱更强的方式）。
- **索引的 `staleness` 字段与它自己的元数据矛盾。** `cypher` 响应报 `staleness: {status: 'behind', commitsBehind: 3}`，但同一索引的 `.gitnexus/meta.json` 记录 `lastCommit: 9495f7c…`，**与当前 HEAD 逐字符相同**，且其 `indexedAt` 为本轮重建时刻。该 warning 因此是**假阳性**，不应据此重跑分析。本轮已用 `cypher` 直接确认 P3-03 的全部符号确实在图内（`File` / `Interface` / `TypeAlias` / `Const` / `Method` / `Property` 节点齐备），符号级证据有效。
- **索引增量重建只覆盖「自上次索引以来变化的文件」，新文档需重建后才进图。** 实现轮的索引早于本文档创建，因此当时对本文档路径的 `cypher` 查询返回 0 个节点；收口轮重建后为 33 个 Section。这只影响文档标题符号，不影响代码符号——实现轮的代码结论是在代码符号已在图内的前提下得出的。**不得把「新文件查询返回空」读作「该文件没有结构」。**
- **`query()` 的关键词与语义检索仍因 FTS 扩展加载失败而不可用**。图遍历能力不受影响。
- **探针不可复现**（§14.3）：四行变异结果随会话结束而失去载体，仓库内不保留。

## 19. 最终架构结论

**P3-03 Architecture Review: PASS**

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
InputActivity modified?               NO
CLI modified?                         NO
src/index.ts modified?                NO
package.json / tsconfig modified?     NO
Event introduced?                     NO
Background mechanism introduced?      NO
Persistence introduced?               NO
Awareness introduced?                 NO
Judgement / Salience introduced?      NO
freshness / TTL introduced?           NO
Manager introduced?                   NO
PerceptionManager introduced?         NO
Model call introduced?                NO
Platform implementation introduced?   NO
New public symbols beyond 6?          NO
Second internal test import?          NO（本阶段为零）
New dependencies?                     NO（package.json 仍无 dependencies 字段）
```

```text
No blocking issue.
No production redesign required.
No frozen boundary was crossed.
No HIGH / CRITICAL risk in graph change analysis.
```

本阶段冻结/强化的边界：

> **World 是 composer，不是 interpreter。**

> **组合不需要协调层**——World 本可以长成 PerceptionManager，它没有。

> **capability 缺席与 capability 失败必须落在两个不同的机制上**，且 World 不自己检查 provider 是否存在。

> **「运行在 Windows 上」是 provider 的事实，不是 World 的事实。**

P3-03 **没有建立新的中央架构**，而是证明了现有 Runtime / Plugin / Service 模型已经足以容纳**组合**——正如 P3-02 证明了它足以容纳第二个感知。三步的递进是清楚的：

```text
P3-01  一个感知可以存在
P3-02  第二个感知不需要先长出协调层
P3-03  组合两个感知也不需要先长出协调层
```

> Foreground、InputActivity 与 DesktopSessionWorld 共享「它们都是 Runtime 之上的领域模块」这一架构角色，但没有被强迫共享控制、生命周期、状态或领域语义。World 与那两个的关系是**消费者**关系，不是**拥有**关系。

以及一条同时进入下一阶段的事实：

```text
World 是第一个同时观察两个感知契约的模块
→ 若出现第三个需要组合的 World，应把「facet 外壳重复」与
   P3-01/P3-02 的「transport 外壳重复」放在一起重新评估
→ 现在样本仍然只有一例，不提前抽象
```

### 评审性质（如实记录）

本文与 `docs/development/phase-3-desktop-session-world.md` 由**实现者本人**撰写，属于自评。它记录的是实际验证过什么、以及哪些结论的证据强度较弱（§14.5 / §14.6 / §18），但**不能替代独立评审**。人工作为独立评审者时，最值得复核的三处是：

1. **§5「capability 缺席 ≠ capability 失败」的两分法是否应当如此**——特别是拒绝方案 2（可选依赖）是否过于保守。本阶段的立场是：给 Runtime 增加一种新的依赖语义，代价高于让 World 在缺 source 时停在 `waiting`。如果未来的真实用例要求「部分可用也要 active」，那应当是一次**独立的 Runtime 架构变更**，而不是搭在某个 World 的顺风车上。
2. **§16 中「两个 facet 类型重复外壳」的接受是否成立**——以及 §16 末尾那个重新评估触发条件是否足够客观。
3. **§14.2 的 `snapshotAt` 加强是否已经足够**——它证明的是「戳不是在 settle 之前打的」，没有证明「戳是在全部 settle 之后、而不是在最后一个 settle 之前的某一刻打的」。后者由代码顺序（打戳语句位于 `await` 之后）保证，测试只能从外部佐证到前者的强度。
