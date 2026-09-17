# Hikari 第三阶段 P3-04 Desktop Session Change Awareness v1 Architecture Review

> 结论：**P3-04 Architecture Review: PASS**（P3-04 Functional PASS + Architecture PASS）
>
> 范围：单个自治 Plugin `desktop-session-awareness`，经由 `desktop-session-awareness.current@1` 把相邻两次 `desktop-session-world.current@1` 的 payload 做一次机械比较，产出「变没变」的判定。
>
> **范围界定（须与结论同时阅读）**：`principles.md` §14 定义的 Awareness 是「这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？」。**P3-04 并不实现完整 Awareness**，只落实该链路中第一个最小 contextualization primitive（Contextualization 一格的最窄面）。本评审的 PASS 只针对这一个 slice，不针对 Awareness 层整体。
>
> 上位原则：`core-architecture-v0.md:288`「判断是自治插件内部的局部活动」、`core-architecture-v0.md:265`「World 是局部视图而非 `GlobalWorldState`」、`principles.md` §14「Perception ≠ Awareness」、§16、§17「no God Object」、§18、§21。本轮**没有新增第二套架构原则**。
>
> 本文按既有惯例把 Functional Review 作为 §1。

---

## 1. Functional Review

以下每一条都由当前真实的文件、真实的测试或真实的 Windows 运行支撑，不是设计意图的转述。

- Runtime 可以加载一个 `requires: [desktop-session-world.current@1]` 的 Plugin，并在 World 到位后把它置为 `active`；World 缺席时停在 `waiting`，`current()` 不可达；
- provider 消失时经 `#deactivateTree` 回到 `waiting`，provider 回来后重新 `active`；
- 第一次 `current()` 返回 `baseline`，按**引用**携带 World snapshot；
- 第二次起返回 `comparison`，携带 `previous` / `current`（均为引用）与三个判定；
- 每次 `current()` **恰好**触发一次 World 调用；`setup`、空闲、`shutdown` 期间**零** World 调用；
- payload 相同而时间戳不同 → `stable`，并已断言两个 snapshot 的 `snapshotAt` 与 `observedAt` **确实不同**，证明该判定不是「两份字节相同」的假象；
- 前台出现 / 消失 → `changed`；标题或进程名变化 → `changed`；相等但**不同对象** → `unchanged`；
- `title` 的 three states（omitted / `null` / `string`）两两可分：`omitted → null` 是 `changed`，`null → null` 是 `unchanged`，`omitted → omitted` 是 `unchanged`；
- `lastInputTick` 只按不等比较：`5000 → 4000` 与 `4000 → 5000` 都是 `changed`，`5000 → 5000` 是 `unchanged`；
- 任一 facet 在任一侧不可用 → 该 facet `indeterminate`；
- 一个 facet `changed` + 另一个 `indeterminate` → 整体 `changed`；
- 一个 facet `unchanged` + 另一个 `indeterminate` → 整体 `indeterminate`；
- 两个 facet 都 `unchanged` → 整体 `stable`；
- 部分可用的快照**仍然成为** baseline；连续两次相同的部分快照，第二次是 `comparison` 而不是 `baseline`；
- World rejection **原样**传播（`error === failure`），且失败调用**不移动** baseline；
- 停用再激活后第一次回到 `baseline`；
- 并发三次 `current()` 得到 `['baseline', 'comparison', 'comparison']`，且 `second.previous` / `third.previous` 分别是前一次的快照；
- 真实 Windows 上四个插件全部 `active`，两次 `current()` 得到 `baseline` → `comparison`。

真实运行样例（本机 Windows 11，真实感知 + 真实 World + 真实 Awareness）：

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

本地测试：**176 / 176 PASS，0 skipped**（22 个 DesktopSessionAwareness + 17 个 DesktopSessionWorld + 16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。全量为 154（既有）+ 22（本阶段）。

编译：`npx tsc -p tsconfig.json --noEmit` 无错误。

**Functional PASS。**

有一条**必须与结论同时阅读**的限制，见 §21 与 §22：22 条测试中 3 条关键性质的**判别力**由一次性变异探针验证，而不是由测试自身证明。该探针不在仓库内、不进 CI、不可复现。

---

## 2. Runtime 边界：Runtime 不知道 baseline / changed / stable / indeterminate

**Runtime 侧改动量为 0。** 本阶段没有为 Runtime 增加任何 API、任何依赖语义、任何生命周期钩子、任何事件。

因此「Runtime 知不知道判定语义」这个问题在结构上就有答案：`baseline`、`changed`、`stable`、`indeterminate` 这四个词**没有出现在 `src/runtime/` 的任何一行**。它们只存在于 `src/desktop-session-awareness/types.ts` 与 `plugin.ts`。

Runtime 看见的全部内容是：

```text
一个 Plugin 声明 requires: [某个 ServiceContract]
→ 该 contract 的 provider 到位 → active
→ 该 contract 的 provider 消失 → waiting
```

Runtime 不知道那个 contract 是 World 的、不知道 `current()` 返回的是什么、更不知道两次返回之间被比较过。这正是 `core-architecture-v0.md` §12.2 的「Runtime 负责机制，不理解领域意义」，本轮没有对它做任何让步。

**一致性检查**：本阶段 `requires` 只列了一个 contract，与 P3-01 / P3-02 / P3-03 使用的是同一种依赖声明，没有引入第二种依赖语义（没有 optional dependency、没有 lazy resolution、没有运行时动态发现）。

> 三层至此第一次同时存在于同一个 Runtime 中，而 Runtime 对三层语义的知晓量仍是 **0**。
>
> （此处「三层同时存在」只指**结构贯通**：第三层第一次有了真实实现。它不表示 Awareness 已被实现完整——P3-04 只是该层最小的一个 slice，见 §5。）

---

## 3. 依赖边界：只依赖 `desktop-session-world.current@1`

```ts
requires: [desktopSessionWorldService]   // 'desktop-session-world.current'
provides: [desktopSessionAwarenessService]  // 'desktop-session-awareness.current'
```

**恰好一个**依赖，且是硬依赖、全有或全无。没有第二项，没有可选依赖，没有降级路径。

**没有「World 不在就返回全 indeterminate」的实现。** 那是一个看起来更「宽容」的写法，但它是错的：它会让本层在**没有真实输入**的情况下产出一个形状完整、内容空洞的判定，而调用方无法把这种空洞与「World 在，但两次都拿不到数据」区分开。缺席是 `waiting`，不是 `indeterminate`——这两件事分属两个不同的机制，与 P3-03 §5 「capability 缺席 ≠ capability 失败」是同一条分界线的延续。

**不依赖 Continuity，不依赖 Chronicle。** `requires` 中没有它们，模块内也没有对它们的任何 import（§15）。

---

## 4. 无 Foreground / InputActivity 直连

这一条有三层独立证据，强度依次递增。

### 4.1 源码级（结构性）

`src/desktop-session-awareness/` 的四个文件对外的 import **只有三个入口**：

```text
../desktop-session-world/index.js
../runtime/contracts.js
../runtime/plugin.js
```

`../foreground/index.js` 与 `../input-activity/index.js` **被显式排除在允许列表之外**（`test/desktop-session-awareness.test.mjs` 的 import allowlist 测试）。这不是靠自觉遵守的约定，而是**违反即测试失败**的结构事实。

### 4.2 图谱级（GitNexus）

```text
src/desktop-session-awareness/ 的全部对外 IMPORTS 边：
  → src/desktop-session-world/index.ts   （2 条：plugin.ts、types.ts）

指向 foreground / input-activity / chronicle / continuity 的边：
  0 条（专项查询计数 = 0）
```

注意目标**恰好是 `index.ts`**，不是 `plugin.ts` 也不是 `contracts.ts`——即使未来 World 内部重构，本模块也只依赖它的公开入口。

### 4.3 符号级（Serena，最强）

Serena 的引用分析直接回答了「谁引用了感知契约」：

```text
foregroundService 的引用者：
  src/foreground/plugin.ts          （自身）
  src/foreground/index.ts           （自身 barrel）
  src/desktop-session-world/plugin.ts
  → src/desktop-session-awareness/ 不出现在列表中

inputActivityService 的引用者：
  src/input-activity/plugin.ts      （自身）
  src/input-activity/index.ts       （自身 barrel）
  src/desktop-session-world/plugin.ts
  → src/desktop-session-awareness/ 不出现在列表中
```

这比文本检索强：Serena 解析的是**符号引用**，而不是字面匹配。一个用别名 import、或用 `import type` 只取类型的穿透都会在这里现形。**没有现形。**

> **结论：Awareness 与两个感知之间，既没有公开直连，也没有内部直连，也没有类型级直连。**

---

## 5. Perception / World / Awareness 三层边界首次贯通（注意：贯通 ≠ 完整实现 Awareness）

这是本阶段的主要架构结果。

```text
Perception    foreground.current@1 / input-activity.current@1   「这个 source 告诉了我什么」
     ↓        requires: []，各自平台自治
World         desktop-session-world.current@1                    「这个 scope 内我掌握哪些事实」
     ↓        requires: 两个感知契约
Awareness     desktop-session-awareness.current@1                「这些事实意味着什么 /
              requires: World 一个契约                             什么值得在意」
                                                                 （本层首次进入；
                                                                  P3-04 只实现
                                                                  最小的一格）
```

**层定义与阶段能力是两件事，不得混用。** Awareness 的领域定义以 `principles.md` §14 为准（继续冻结）：*「这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？」*，链路为 `Observation → 事实标准化 / Contextualization → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act`。**P3-04 只落在 Contextualization 这一格的最窄面**——比较相邻两次 World snapshot 的可比较 payload。

> **P3-04 首次让 Perception → World → Awareness 三层在真实代码中贯通。贯通不等于完整实现 Awareness；P3-04 只落实了 Awareness 的最小 change-contextualization slice。**

这与 §14 末句「不应把 Foreground、Calendar、DeviceActivity 等传感器集合本身称为完整 Awareness」是同一条纪律：**把 P3-04 读成完整的 Awareness，与把一组感知读成完整 Awareness，是同一类错误。**

三层第一次**同时**运行在同一个 Runtime 中。三层的入场方式完全相同：`requires` 声明、`setup` 里 `get`、调用时 `await`。Runtime 没有为任何一层增加特殊待遇。

**本节标题所说的「贯通」只指结构上的贯通**：三层各自是真实代码、边界互不穿透、Runtime 对三者语义零知晓。它**不**声称第三层已被实现完整。

**每层只依赖它的下一层。** 链条是严格线性的，没有跨层引用、没有回边、没有共享状态：

```text
Awareness  →  World  →  Perception        （只有向下）
Perception ↛  World  ↛  Awareness          （没有任何向上）
```

图谱证实了这一点：`src/desktop-session-world/` 没有任何来自 Awareness 的入边被反向依赖，Awareness 也没有被任何模块依赖（§19）。

### 这条边界最容易被破坏的地方，以及它为什么没有被破坏

最容易的错法是让 Awareness **直接取两个感知**、自己组装一个「上一次的 payload」，因为那样可以省掉一次 World 往返。它没有这么做，理由是结构性的：**「这个 scope 内有哪些事实」是 World 的定义，不是 Awareness 的。** 若 Awareness 自己取感知，它就把 World 的职责复制了一份，两份定义会随时间漂移，而 Runtime 无法察觉——没有任何机制会发现「Awareness 眼里的 World」与「World 眼里的 World」开始不同。

> **Awareness 是 composer 的 consumer，不是 composer。**

它消费的是 World 的**结论**，不是 World 的**原料**。

---

## 6. baseline 语义：activation-local，不持久化

### 6.1 声明位置

```ts
setup(context) {
  const world = context.services.get(desktopSessionWorldService);
  let previous: DesktopSessionWorldSnapshot | undefined;   // ← setup 内部
  ...
}
```

`previous` 声明在 `setup` 的函数体内，不是模块作用域。`setup` 每次激活只跑一次，因此：

```text
一个激活周期 = 一个独立的 previous 绑定
```

**没有任何持久化**：不写文件、不读文件、不进 Continuity、不进 Chronicle、不进进程外的任何地方。判定是进程内的、瞬时的，进程结束即消失。

### 6.2 为什么不是模块作用域

模块作用域的 `previous` 会让 baseline 跨激活存活。这**看起来**更「记得住」，实际是错的：World 的 provider 在重新激活后是一个**新的服务对象**，它背后的感知可能已经换了一轮；拿旧激活期的 payload 去比新激活期的 payload，比较的是两个不同运行状态的切片，而结果会被当成一次正常比较返回。判别力探针 M3 正是这个变异，它打翻了 9 条测试（§21）。

### 6.3 快照按引用携带，不复制

`baseline` / `previous` / `current` 携带的都是 World 返回的那个**同一个对象**。本层不重建、不深拷贝、不结构化克隆。理由是归属：那个 snapshot 由 World 生产、由 World 冻结，本层只是持有引用，不拥有它。

代价见 §24 已知限制。

---

## 7. provider disappear / recover 时 baseline 通过 Runtime 生命周期自然 reset

**本阶段没有为此写一行代码。**

没有 `reset()` 方法，没有 `onDeactivate` 钩子，没有对 PluginState 的检查，没有 `if (state === 'waiting')` 判断。reset 完全由 P3-03 既有的 Runtime 机制产生：

```text
unloadPlugin(world-provider)
  → #deactivateTree 级联
  → World 回 waiting
  → Awareness 因 requires 未满足也回 waiting
  → 本次激活的 setup 作用域被丢弃，previous 绑定随之消失

loadPlugin(world-provider) 之后
  → #reconcile 发现 Awareness 的 requires 已满足
  → 重新进入 setup，得到【全新的】previous = undefined
  → 第一次 current() 又是 baseline
```

这是一条**派生性质**，不是本阶段实现的特性——它之所以成立，是因为 baseline 恰好被放在了 `setup` 作用域里，而 `setup` 恰好是 Runtime 定义的激活边界。本阶段做的是**选对了位置**，而不是**增加了机制**。

测试 16 里有一条必须存在的断言，否则整条测试没有判别力：

```js
const beforeDeactivation = observed.service;
await runtime.unloadPlugin(WORLD_PROVIDER);
await runtime.loadPlugin(world.definition);
assert.notEqual(observed.service, beforeDeactivation, 'the service was not rebuilt');
```

旧 service 对象仍然闭包持有旧的 `previous` 与旧的 World 引用，**直接调它照样会返回结果**——只是结果是错的。没有这条断言，测试可能在读一个陈旧对象却依然变绿。

---

## 8. 失败边界：World rejection 原样传播，且失败调用不推进 baseline

```ts
const current = await world.current();   // 无 try/catch —— 第一行就是它
const baseline = previous;
previous = current;
```

### 8.1 原样传播

**没有 try/catch，没有包装，没有分类，没有转成 `unavailable` 判定。** 测试用 `error === failure` 断言，证明抛出的**就是**那个对象，不是被重新构造的新错误。

理由与 P3-03 的 `unavailable` 不携带原因同源：**本层不拥有 World 的失败分类法。** 一个传输细节不能变成本层契约的一部分。如果本层开始包装错误，它就承担了一个它没有能力履行的职责——它没有足够的信息去分类，也没有立场去决定什么错误值得重试。

### 8.2 失败调用不推进 baseline

这一条靠的是赋值位置的**顺序**，而且它是**不可见**的——代码里没有一行写着「失败时不要改 baseline」：

```ts
const current = await world.current();   // reject 时，以下三行全都不可达
const baseline = previous;               // ← 不可达
previous = current;                      // ← 不可达
```

`previous = current` 位于 `await` **之后**。若它被上提到 `await` 之前（一个很自然的「提前准备好」写法，或者把 `const baseline = previous` 与 `previous = current` 合并成一步的「简洁」写法），一次失败的获取就会把 baseline 清成 `undefined` 或写进一个坏值，而下一次调用会**错误地返回 `baseline`**——调用方看到的是「无事发生」，实际是「上次比较失败了」。

测试 18 精确覆盖：建立 baseline → 一次 rejection → 再取一次，断言 `previous` 仍是**最早那个**快照（不是 `undefined`，也不是坏值），且 `current` 是第三个快照、`change` 为 `changed`。

### 8.3 顺序为什么写成两行而不是一行

`baseline` 先取后覆盖，而不是直接读两次 `previous`。这两行**必须**是两行：合成 `previous = current` 单行、或直接在各处读 `previous`，都会在「并发」与「失败」两个维度上同时出错。这不是风格问题，是语义问题。

---

## 9. partial availability 不被伪装成 unchanged

```ts
if (previous.kind !== 'available' || current.kind !== 'available') return 'indeterminate';
```

**任一侧不可用 → 该 facet 是 `indeterminate`，绝不是 `unchanged`。**

这是本层最重要的一条诚实性约束。一个「没拿到数据」被写成 `unchanged`，会让调用方以为「确认过，没变」；实际发生的是「**根本没看**」。这两种情形在语义上是相反的，把后者伪装成前者是本层最容易犯、也最难被发现的错误——因为它在类型上完全合法。

`indeterminate` 是一个**第三值**，不是失败、不是错误、不是一个更弱的 `unchanged`。它的全部含义是「这一项没法比」。

测试 11 覆盖两个方向（unavailable → available、available → unavailable），并同时断言另一个仍然可比的 facet 保持它自己的判定，不被拖成 `indeterminate`。

---

## 10. 判定代数：changed 优先于 indeterminate；stable 仅在两个 facet 都明确 unchanged 时成立

```ts
function overallChange(foreground, inputActivity): DesktopSessionChange {
  if (foreground === 'changed' || inputActivity === 'changed') return 'changed';
  if (foreground === 'unchanged' && inputActivity === 'unchanged') return 'stable';
  return 'indeterminate';
}
```

这个优先级是**不对称**的，而且这个不对称是刻意的：

```text
差别自己站得住   —— 一个 facet 变了，另一个没比成，整体仍然是 changed
相同站不住       —— 只有所有能比的都比了且都一样，才叫 stable
```

**为什么不对称是对的**：`changed` 是一条**存在性**断言（「至少有一处不同」），它不需要知道另一项的状态就能成立；`stable` 是一条**全称**断言（「没有任何一处不同」），它必须覆盖所有可比项才能成立。一条存在性断言可以由局部证据支撑，一条全称断言不能。把它写成对称的（例如「两个 facet 权重相同，任一 indeterminate 则整体 indeterminate」），会让**部分可用的信号被整条丢掉**。

测试 12 / 13 分别覆盖这条规则的两半：`changed + indeterminate → changed`，`unchanged + indeterminate → indeterminate`，`indeterminate + indeterminate → indeterminate`。

判别力探针 **M2** 专门把这条规则反过来写（让 `indeterminate` 优先），测试 13 立刻变红（§21）。

---

## 11. `stable` 不代表 user idle / no activity / no real-world change

这是本阶段最需要被写下来的**语义防火墙**。

```text
stable 的准确含义：
  在两次 snapshot 之间，两个可比的 payload 都没有差别。

stable 不表示的：
  ✗ 用户空闲（idle）
  ✗ 用户离开（away）
  ✗ 没有活动（no activity）
  ✗ 现实世界没有变化（no real-world change）
  ✗ 任何形式的 presence 判断
```

`stable` 是**关于观测值**的陈述，不是**关于世界**的陈述。这两者在类型上无法区分，在语义上相距很远：

- 两次 snapshot 之间 tick 恰好相同、前台窗口恰好相同 → `stable`。用户可能刚刚什么都没做（真的空闲），也可能用户正在做一件**不改变这两个观测点**的事（例如在同一个窗口里滚动阅读、或者在另一个屏幕上用鼠标）。
- 反过来，`changed` 也**不代表**用户是活跃的——它只代表某个观测点的值动了。

`principles.md` §14 的分界线正在这里：**Perception 报告事实，Awareness 判断差别，但判断「差别意味着什么」是它之上那一层的事。** 本层停在「差别」上，一步都没有多走。

这条边界由 §15 的禁用词表在结构上守住：`isIdle` / `isAway` / `userPresent` / `userAway` / `idleFor` 这些词一旦出现就是测试失败。

---

## 12. `lastInputTick` 只比较相等性，不推断方向、时长或活跃度

```ts
return previous.observation.lastInputTick === current.observation.lastInputTick
  ? 'unchanged'
  : 'changed';
```

**只做相等性比较。** 没有减法，没有 `>` / `<`，没有「回退需要修正」，没有「间隔多大算空闲」。

这继承 P3-01 / P3-02 定下的契约：tick 是**平台自己的计数器**，不是时长、不是时间戳、不是单调量。它可能在回绕时变小，可能因为平台语义在一次输入后跳动很远。本阶段对它做的全部处理是「相等吗」，因此：

```text
5000 → 5000   unchanged
5000 → 4000   changed      （变小同样是变化，不修正）
4000 → 5000   changed      （变大同样是变化，不推断「刚刚有输入」）
```

测试 11 断言 `[baseline, unchanged, changed, changed, changed]`——把 `5000 → 4000` 与 `4000 → 5000` 放在一起，证明实现里**没有**方向性。

这条约束的架构意义在于：一旦本层开始对 tick 做算术，它就必须知道 tick 的单位、回绕周期与平台语义——那是一条把 Windows 知识拉进 Awareness 层的通道。**只比较相等性，这条通道就不存在。**

---

## 13. `title` 的 undefined / null / string 三态保持，不做归一化

`ForegroundTargetPresent` 在 `exactOptionalPropertyTypes: true` 下，`title` 在**生产环境**里有三个可观察状态，**三个都真的会发生**：

| `title` 的状态 | 生产来源（`src/foreground/windows.ts`） |
| --- | --- |
| **omitted / `undefined`** | `GetWindowTextW` 返回 0 且错误是 1400（窗口已消失） |
| `null` | `GetWindowTextW` 返回 0 但错误不是 1400 |
| `string` | 正常读到标题 |

> **术语约定（本文档全程遵守）**：`absent` **只**用于 `foreground.kind === 'absent'`（该 scope 内没有前台窗口，是 Foreground 域的判别值）。`title` 属性缺失一律写成 **title omitted / undefined**，绝不写成 "title absent"——否则「没有前台窗口」与「窗口在、但没读到标题」这两种完全不同的情形会在文档里长得一样。

这**不是**类型上的疏忽，是刻意的：`title?: string | null` 让「我没读到标题」与「我读到标题了，它是空的」保持可分。

### 比较必须用 `===`

```ts
return before.title === after.title && before.processName === after.processName
```

`undefined !== null`，所以三态两两可分。**不需要额外的存在性检查**——`Object.hasOwn` 或 `'title' in before` 都是多余的，而且引入它们反而容易写错。

被明确拒绝的写法：

```ts
(before.title ?? null) === (after.title ?? null)   // ✗ 把 omitted 折叠成 null
before.title == after.title                        // ✗ 同上，且更难看出
```

两种写法都会让 `omitted → null` 变成 `unchanged`，而它实际上是一次**事实的变化**：一次是「读不到标题」，另一次是「读到了，是空标题」。折叠它就等于在本层丢失一条真实信息。

测试 10 跑出 `['baseline', 'changed', 'unchanged', 'changed', 'unchanged']`，覆盖 `omitted → null`、`null → null`、`null → omitted`、`omitted → omitted` 四种转移。

判别力探针 **M1** 把 `===` 换成 `==`，测试 10 立刻变红（§21）。

> 残留不一致（如实记录）：`test/desktop-session-awareness.test.mjs` 的 T10 注释里用了 "the property is absent" 指代 title omitted。该文件本轮已冻结、不允许修改，因此这处措辞保留原样；它不进入任何契约或本文档的结论。

---

## 14. comparison 不比较 `observedAt` / `snapshotAt`

两个时间戳都**出现在** assessment 里（因为它们是事实的一部分），但**都不参与**比较。

```text
snapshotAt    每次 snapshot 都必然不同（World 在 settle 之后重新打戳）
observedAt    每次 observation 都必然不同（感知在采集时打戳）
```

如果把任一个算进比较，**每一次比较都会恒为 `changed`**——本层也就不存在了。这是一条「不做」比「做」更重要的约束，因为它不会以 bug 的形式出现，只会以「功能看起来很正常地永远返回 changed」的形式出现。

测试 7 用一侧断言证明这不是「两份字节相同」的假象：

```js
assert.notEqual(assessment.previous.snapshotAt, assessment.current.snapshotAt);
assert.notEqual(
  assessment.previous.foreground.observation.observedAt,
  assessment.current.foreground.observation.observedAt,
);
```

即：两份 snapshot 的**每一处时间戳都确实不同**，而判定仍是 `stable`。

---

## 15. 没有 salience / importance / notify / remember / act

本层**不做任何判断**，只做比较。`core-architecture-v0.md:288` 的「判断是自治插件内部的局部活动」在这里的落地方式是：**本层连判断都没有。**

结构性守住这条边界的是一张禁用词表（`test/desktop-session-awareness.test.mjs`）：

```text
平台：   process.platform / powershell / PowerShell / execFile / win32
存储：   chronicle / Chronicle / continuity / Continuity / writeFile
调度：   setInterval / setTimeout
策略：   isIdle / isAway / userPresent / userAway / idleFor
```

**词表的构造规则本身是一条设计决定**：每个条目要么是平台字符串，要么是**带词形的标识符**（camelCase），因为只有这两类东西不可能出现在散文里。裸的英文词根一律不查——理由有两条，都真实发生过：

1. `present` 是 Foreground 域的**合法取值**，查它必然误报；
2. 一段说明「本层拒绝做什么」的注释**必须**能写出它拒绝的那个动作的名字。第一版词表里放了 `notify` 与 `remember`，结果命中的全是本模块自己的注释（「本层不做通知、不做记忆」），而不是任何实现。

**这是一个真实的教训**：禁用词表如果查裸词根，它会先打死解释它的文档，再打死实现——而打死文档恰恰让这条边界更难被后人理解。

---

## 16. 没有 Chronicle / Memory / persistence

本层的全部状态是**一个进程内的变量**：

```ts
let previous: DesktopSessionWorldSnapshot | undefined;
```

没有文件、没有目录、没有 JSON、没有 JSONL、没有 sequel。`requires` 中没有 Continuity 与 Chronicle，模块内对它们零 import（§4）。

**这是一条刻意的取舍**：一个「记得住历史」的 Awareness 会立刻变成 Memory 的雏形——它要决定保留多久、保留多少、什么时候丢弃、要不要落盘、落盘的格式版本怎么迁移。这些全部是**未批准范围**。本阶段把状态压到「一个变量」，就是为了让这些问题**根本没有机会被提出来**。

测试 20 的 import allowlist 在结构上守住了这一点：`../chronicle/index.js` 与 `../continuity/index.js` 不在允许的入口里，出现即失败。

---

## 17. 没有 timer / polling / watcher / event loop

**pull-only。** 本层不主动做任何事：

- 没有 `setInterval` / `setTimeout`（§15 词表覆盖）；
- 没有 watcher、没有订阅、没有 Event；
- 没有后台循环、没有轮询；
- `setup` 只做一件事：把服务注册进去，然后返回。

**加载、空闲、卸载三个时期，World 的调用计数都是 0**——测试 5 用 `setImmediate` 的事件循环轮次边界断言空闲期零调用（不是用 sleep 猜时长：一个 macrotask 边界证明的是「待处理的工作已经做完」，而不是「大概来得及」）。

唯一会调用 World 的时刻是**调用方显式调用 `current()` 时**，且每次调用**恰好一次**。

这条约束的架构意义：一个自带 timer 的 Awareness 会获得一个 Runtime 看不见的**独立生命周期**——它会在插件被停用之后继续跑，或者在插件尚未激活时就已经产生判定。**只做 pull，这个问题就不存在。**

---

## 18. 没有 AwarenessManager / GlobalAwareness / Super Orchestrator

本阶段是一个**自治 Plugin**，仅此而已。没有：

```text
✗ AwarenessManager        ✗ GlobalAwareness      ✗ Super Orchestrator
✗ AwarenessBus            ✗ ChangeEvent          ✗ 任何中心注册表
✗ 通用 Comparison 框架    ✗ 泛型 Facet<T>        ✗ 跨 source 推断层
```

Serena 的符号搜索给出的是**空集**：`*Manager*`、`*Orchestrator*`、`*salience*` 在整个 `src/` 中**不存在**（不只是本模块）。

Awareness 是 `core-architecture-v0.md:265` 所说的**局部视图**的消费者，不是任何形式的全局状态持有者。它不跨 scope、不跨 source、不做聚合。

> **本层是最容易长成编排器的地方——「我知道所有事实，所以由我来协调」——而它没有。**

它取得 World 的方式，与任何消费者取得任何 capability 的方式完全相同：`requires` 声明、`setup` 里 `get`、调用时 `await`。Runtime 没有为它新增一行代码。

---

## 19. 公开面：恰好 6 个 symbols

`src/desktop-session-awareness/index.ts` 恰好导出 6 个符号：

| 符号 | 类别 |
| --- | --- |
| `desktopSessionAwarenessService` | value |
| `DesktopSessionAwarenessService` | type |
| `desktopSessionAwarenessPlugin` | value |
| `DesktopSessionAwarenessAssessment` | type |
| `DesktopSessionChange` | type |
| `DesktopSessionFacetChange` | type |

**三个比较函数不在其中**（`compareForeground` / `compareInputActivity` / `overallChange` 保持模块私有）。它们是本层的**实现**，不是本层的**契约**——导出它们会把「怎么比」冻成公开 API，而那是将来最可能变的部分。

### 公开面没有为测试扩大

测试通过**假 provider + 真实 Runtime 依赖图**来做，不引入注入缝、不暴露内部、不为测试增加任何导出。这是 P3-01 以来一以贯之的纪律，本轮没有破例。

### 被依赖情况

Serena 引用分析：

```text
desktopSessionAwarenessPlugin 的引用者：
  只有 src/desktop-session-awareness/index.ts（自身 barrel 的 re-export）
  → src/ 内的消费者数量：0

desktopSessionAwarenessService 的引用者：
  plugin.ts（自身）+ index.ts（自身 barrel）
  → src/ 内的消费者数量：0

DesktopSessionAwarenessAssessment 的引用者：
  contracts.ts + plugin.ts + index.ts
  → 全部在模块内
```

即：**本阶段没有为任何既有模块创建依赖，也没有任何既有模块依赖本阶段。** 这与 §20 的「零修改」是两条独立的证据，方向一致。

---

## 20. 零修改：P3-04 对既有 production module 的改动量为 0

```text
src/runtime/         未修改
src/continuity/      未修改
src/chronicle/       未修改
src/foreground/      未修改
src/input-activity/  未修改
src/desktop-session-world/  未修改   ← 本阶段的直接上游
src/cli/             未修改
src/index.ts         未修改
package.json         未修改
tsconfig.json        未修改
test/（既有测试）     未修改
```

`git diff --name-only` 输出为空（工作区无任何已跟踪文件的改动）。全部产物是**新增文件**。

**特别地：P3-03 的 `src/desktop-session-world/` 一个字节都没动。** 本阶段消费它的公开契约，仅此而已——这是「只依赖公开入口」这条纪律在真实改动上的兑现。

`package.json` 与 `tsconfig.json` **无需改动**，因为二者的 `test` 与 `include` 都是通配：

```text
tsconfig.json  include: ["src/**/*.ts"]     → 新目录自动纳入
package.json   npm test: node --test test/*.test.mjs → 新测试文件自动纳入
```

`npm test` 仍无 `dependencies` 字段——本阶段没有引入任何依赖。

---

## 21. 测试策略与判别力探针

### 21.1 22 条确定性测试

见 §1 的逐条列举。全部使用**假 provider + 真实 Runtime**：假的是**提供者**，被测的是**生产实现**。没有注入缝，没有 mock 框架，没有为测试暴露的内部。

### 21.2 不使用耗时阈值

全文件没有一处真实的 `setTimeout` / `setInterval` 调用，也没有一处 `Date.now()`——那两个字符串只作为 §15 禁用词表的条目出现。并发与空闲判定用 `setImmediate` 的事件循环轮次边界。

并发测试（测试 9）的确定性来源：假 world 的 `current()` 同步返回已 resolve 的 promise，三次调用在同一个同步段内按序发生，微任务按 FIFO 恢复。因此 `['baseline', 'comparison', 'comparison']` 是一个**已完成的**事实，不是「大概率」。

### 21.3 判别力探针（一次性，不在仓库内）

仓库测试通过并不等于测试**有判别力**。本轮用一次性探针变异 `dist/` 中的真实产物做对抗式验证：

| 变异 | 被破坏的性质 | 结果 |
| --- | --- | --- |
| 无变异（基线） | — | 22 pass / 0 fail |
| **M1** `title` 比较改用 `==` | 三态 `title` 两两可分（§13） | **1 fail**（测试 10） |
| **M2** `overallChange` 让 `indeterminate` 优先 | 差别自己站得住（§10） | **1 fail**（测试 13） |
| **M3** `let previous` 上提到模块作用域 | baseline 是 activation-local（§6） | **9 fail**（含测试 16） |

M1、M2 各自**只**打翻应当打翻的那一条，说明两条性质被精确钉住（不是被一串测试笼统覆盖）。M3 打翻 9 条是符合预期的：基线一旦跨激活共享，几乎所有序列测试都会错位。

### 21.4 探针自身的一次错误（必须记录）

第一版探针跑了三次变异，**全部报 "MISSED" 且零失败**。

这个结果不可信——三个独立变异不可能同时完全无效。原因是脚本用行首锚点 `^✖` 匹配 Node 的 reporter 输出，而 `✖` 前面带 ANSI 色码，锚点匹配不上，脚本把「有失败」读成了「无失败」。修正（先剥 ANSI 再匹配，并同时打印 pass 计数交叉验证）后才得到 §21.3 的表。

> **一个会把自己读错的探针比没有探针更危险。** 它既会给出「测试没有判别力」的假警报，也会在另一个方向上给出假安心。这是 P3-03 §14.4「先怀疑变异，再怀疑测试」的**同型错误的镜像**：那一次是变异看起来邪恶却无害，这一次是探针看起来有效却读错。

### 21.5 证据等级（必须与结论同时阅读）

```text
22 条确定性测试       在仓库内、进 CI、可复现
§21.3 的变异结果       会话内一次性探针，不在仓库内、不进 CI、不可复现
```

即：测试本身是可复现的回归覆盖；**「这三条性质确实有判别力」这个结论的证据等级较低**——它证明了「当时确实验过」，不证明「以后不会被改坏」。这是 P3-01 以来一以贯之的同一类限制。

### 21.6 已知 coverage gap（watch item，与前两阶段同型）

`src/foreground/windows.ts` 与 `src/input-activity/windows.ts` 的 parser rejection branches 不在 `npm test` 内（P3-01 / P3-02 已记录）。**P3-04 没有加剧这个缺口**——本模块没有 parser、没有平台分支、没有子进程、没有内部 seam、**也没有新增第二处具名内部 import**（它不需要被替换的内部实现）。它的全部分支都在仓库测试覆盖内。

---

## 22. 真实 Windows measurement 只是一项诊断，不是语义正确性证据

§1 的实测数字（397 / 391 / 447 ms，`QQ` → `cloudmusic`，tick `673799203 → 673799515 → 673799875`）在本轮中的**唯一作用**是：

1. 证明四个插件在真实 Windows 上确实能同时 `active`（**集成可达性**，不是语义正确性）；
2. 记录本层在真实路径上的开销可忽略（397ms 与 P3-03 单独测 World 的 386ms 同量级，成本全在两次感知子进程上）；
3. 记录一个真实的观测样本，供后人核对。

**它不证明任何一条语义结论。** 具体地：

```text
✗ 「397ms 说明比较很快」           → 耗时不是本层的契约，也未被任何测试断言
✗ 「QQ 的时候 stable，换歌的时候 changed」
   → 这是一次观测样本，不是对 stable / changed 语义的验证
✗ 「tick 从 673799203 变到 673799515」
   → 不能推出任何关于 tick 语义的结论（§12 全部由构造数据覆盖）
```

**语义正确性只由 §21 的 22 条确定性测试与 §21.3 的变异探针支撑。** 真实运行的数字跨轮次不稳定（P3-03 记录过 386–674ms 区间），本身也不具备被当作阈值的资格。

这条区分是 P3-03 §14.5 / §21.5 同一纪律的延续：**诊断数据与语义证据必须分开记账。**

---

## 23. 命名：为什么是 `desktop-session-awareness`

模块名为 `desktop-session-awareness`，**不是** `desktop-session-change`，也**不是** `change-detector`。

理由是结构性的：本模块描述的是 Hikari 的一个**能力层**（awareness），而不是一种**算法**。今天它用一个 payload 比较来实现，将来它可以被替换成别的实现，而层名不变。把它命名成算法，等于把「当前这一版怎么算」误固化成「这一层是什么」——与 P3-03 拒绝把平台写进 World 身份是同一条理由。

命名规则与本仓库既有惯例一致：

```text
service id: desktop-session-awareness.current@1
.service id 从不携带 .windows
.current 后缀只在服务带 current() 方法时出现
  → chronicle 无此方法，故其 id 为裸 chronicle
```

**`.windows` 不出现在本模块的任何公开身份上**，因为本模块没有任何 Windows 专属实现：零 `process.platform`、零 PowerShell、零 Win32、零子进程。这一点由 §15 的词表在结构上守住。

---

## 24. 已知限制

1. **不区分「变了」的种类。** `title` 改了与进程换了都是同一个 `changed`。要区分需要引入字段级差异结构，那已经接近「这意味着什么」，超出本阶段。

2. **`stable` 在真人使用下偏少。** 真实运行显示 tick 在几百毫秒内就会推进（`673799203 → 673799515`）。只要用户有输入，`inputActivity` 就是 `changed`，整体就是 `changed`；`stable` 实际只在「两次读取之间完全没有任何输入**且**前台没变」时出现。**这是对的**，但它意味着调用方不能把 `changed` 读成「有事发生」——那正是 §11 刻意不做的判断。

3. **`indeterminate` 不携带原因。** 与 P3-03 的 `unavailable` 同源决定：本层不拥有 World 的失败分类法。

4. **只比较相邻两次。** 没有历史窗口，所以「A → B → A」在第三次会报 `changed`（相对 B），而不是「回到原状」。这是设计选择，不是缺陷；要做后者需要保留更早的快照，而那正是 §16 拒绝的 Memory 雏形。

5. **`previous` / `current` 是引用。** 调用方若改动快照对象会破坏后续比较。快照在 World 侧已冻结，因此这靠的是**约定**而非本层强制——本层没有做防御性拷贝，也不打算做。

6. **并发下不保证 invocation-order baseline。** v1 明确不保证 `concurrent current()` 的调用顺序与 baseline 推进顺序一致。多个调用并发时，**baseline 按成功的 World acquisition 的完成顺序前进**，而不是按调用发起顺序前进（先被调用、但 World 后返回的那次，会成为后一次比较的 `previous`）。**这是已知限制，本轮不增加 mutex / queue / serialization。** 理由：v1 的调用方只需要「拿两次读数做个比较」，每一次 `current()` 自身仍然完整、自洽、可引用；没有任何调用方需要「第 N 次调用必须与第 N-1 次配对」。在没有真实需求之前引入排队，是为想象中的调用方付协调成本——与 P3-03 拒绝长出 `PerceptionManager` 是同一判断。单个 assessment 不受影响，受影响的只是「哪两次读数被拿来配对」。

7. **本层不校验 World 返回的快照形状。** 与 P3-03 不校验 observation 形状同型：它依赖 World 的契约保真度，而 World 的保真度又依赖两个感知的保真度。当前这条链条是安全的（两个感知各自有严格校验），但这是一个需要被记住的**耦合方向**。

---

## 25. 工具限制（如实记录）

### 25.1 `detect_changes` 的 0 是「未看见」，不是「无影响」

本轮 `detect_changes --scope all` 返回 `changed_count: 0`。**这个 0 不可读作 clean**，有两个独立成因，且都已验证：

```text
成因 1（根本性）：本轮产物全部是【未跟踪】文件。
  detect_changes 读的是 git diff，而 git diff 按定义不含未跟踪文件。
  本轮未执行 git add（收口纪律禁止 stage），因此 P3-04 的
  全部代码、测试、文档对它都是不可见的。
  → 已用重建索引后的重测确认：索引重建后读数【仍然是 0】，
    证明它与索引新鲜度无关。

成因 2（当时性）：首次读取时索引确实落后 1 个提交
  meta.lastCommit = 9495f7c（P3-02），HEAD = a4f5c94（P3-03）。
```

因此本阶段的架构边界证据**不来自** `detect_changes`，而来自 §4 的三层证据（源码 allowlist / 图谱 IMPORTS 边 / Serena 符号引用），其中后两者都是在**已重建、已确认包含 P3-04 文件**的索引上取得的。

> **与 P3-03 收口轮的差别必须说清楚**：P3-03 那一轮 `git add` 了代码与测试文件，因此它的 `detect_changes` 数字是**有效**的（51 changed symbols）。本轮按收口纪律**不 stage**，因此拿不到同等级的数字。这不是退步，是这一轮纪律的直接后果。

### 25.2 索引包含 P3-04 新文件（已确认）

重建输出：`Incremental: changed=1, added=5`，图谱中 `src/desktop-session-awareness/` 共 **22 个符号**，分布在 4 个文件：

```text
contracts.ts  4    index.ts  1    plugin.ts  13    types.ts  4
```

§4.2 的 IMPORTS 边查询返回结果，本身也证明这些文件已在图内。

### 25.3 拓扑（与预期一致）

```text
foreground ─┐
            ├→ desktop-session-world ──→ desktop-session-awareness
input ──────┘

src/desktop-session-world/plugin.ts  → src/foreground/index.ts
src/desktop-session-world/plugin.ts  → src/input-activity/index.ts
src/desktop-session-world/types.ts   → src/foreground/index.ts
src/desktop-session-world/types.ts   → src/input-activity/index.ts
src/desktop-session-awareness/plugin.ts → src/desktop-session-world/index.ts
src/desktop-session-awareness/types.ts  → src/desktop-session-world/index.ts

awareness → foreground / input-activity / chronicle / continuity 的边：0 条
（专项计数查询返回 0）
```

注意 Awareness 的两条对外边**都指向 `index.ts`**——即 World 的公开入口，而不是它的 `plugin.ts` 或 `contracts.ts`。

### 25.4 `staleness` 字段不可按数值采信（比上一轮更硬）

`cypher` 响应报 `staleness: {status: 'behind', commitsBehind: 4}`。

**这是假的。** 本轮重建索引后，`.gitnexus/meta.json` 的 `lastCommit` 为 `a4f5c94c5987b51a3c2439742c39158f7f70686c`，**与当前 HEAD 逐字符相同**（已用 `git rev-parse HEAD` 比对确认 `matches: True`）。

也就是说：**在索引被证实为最新之后，该字段仍然报「落后 4 个提交」。** 它不只是在方向上偏保守，它是在重建之后**没有重读**——该值很可能在服务进程启动时被缓存。

> 结论：`staleness` 既不可用于判断索引是否需要重建，也不可用于判断重建是否生效。**判定索引新鲜度只能靠 `meta.json` 与 `git rev-parse HEAD` 的直接比对。**

### 25.5 其余

- **图谱不解析 `.mjs` 的 IMPORTS 边**（P2-04 已记录）：针对测试文件的导入查询返回空，**这个空结果不是「没有依赖」的证据**。本模块的边界结论因此改用「源码 allowlist 断言（测试 20 直接读源文件做 specifier 断言，比图谱更强）+ Serena 符号引用」获得。
- **`query()` 的关键词与语义检索仍因 FTS 扩展加载失败而不可用**。图遍历能力不受影响。
- **探针不可复现**（§21.3）：变异结果随会话结束而失去载体，仓库内不保留。

---

## 26. 最终架构结论

**P3-04 Architecture Review: PASS**

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

```text
Runtime modified?                          NO
Continuity modified?                       NO
Chronicle modified?                        NO
Foreground modified?                       NO
InputActivity modified?                    NO
DesktopSessionWorld modified?              NO   ← 本阶段的直接上游，零改动
CLI modified?                              NO
src/index.ts modified?                     NO
package.json / tsconfig modified?          NO
Event introduced?                          NO
Background mechanism introduced?           NO
Timer / polling / watcher introduced?      NO
Persistence introduced?                    NO
Memory introduced?                         NO
Salience / Importance introduced?          NO
Notify / Remember / Act introduced?        NO
Manager / Orchestrator introduced?         NO
GlobalAwareness / GlobalWorldState?        NO
Cross-source inference introduced?         NO
Platform implementation introduced?        NO
Perception import introduced?              NO
New public symbols beyond 6?               NO
New dependencies?                          NO（package.json 仍无 dependencies 字段）
Second internal test import?               NO（本阶段为零）
```

```text
No blocking issue.
No production redesign required.
No frozen boundary was crossed.
No HIGH / CRITICAL risk identified.
```

本阶段冻结/强化的边界：

> **判断是自治插件内部的局部活动**——而本层连判断都没有，只做比较。

> **Awareness 是 composer 的 consumer，不是 composer。** 它消费 World 的结论，不是 World 的原料。

> **没有数据 ≠ 没有变化。** 拿不到就报 `indeterminate`，绝不伪装成 `unchanged`。

> **差别自己站得住，相同站不住。** 存在性断言可以由局部证据支撑，全称断言不能。

> **`stable` 是关于观测值的陈述，不是关于世界的陈述。**

> **没有历史，就没有 Memory 的问题要回答。** 本层的全部状态是一个进程内变量。

> **baseline 的 reset 是派生性质，不是新增机制。** Runtime 的激活边界已经足够，本阶段只是选对了变量的位置。

P3-04 **没有建立新的中央架构**，而是证明了现有 Runtime / Plugin / Service 模型已经足以容纳 **Awareness 层的一个最小切片**——正如 P3-02 证明了它足以容纳第二个感知，P3-03 证明了它足以容纳组合。**这不等于说模型已足以容纳完整 Awareness**：链路中的 Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act 都尚未被任何真实实现检验过，它们是否也需要新的机制，现在**没有证据**。四步的递进是清楚的：

```text
P3-01  一个感知可以存在
P3-02  第二个感知不需要先长出协调层
P3-03  组合两个感知也不需要先长出协调层
P3-04  在组合之上做变化判断，仍然不需要协调层，也不需要 Memory
```

四步共同说明的只是**这条最小路径**可以被现有模型承载；它没有回答 Awareness 的其余部分需要什么。**不得把「第三层已贯通」读成「第三层已验证」。**

以及一条同时进入下一阶段的事实：

```text
Awareness 是第一个消费 World 的模块。
若未来出现第二个 World 消费者，或出现需要【跨快照历史】判断的需求，
则「Awareness 是否该有历史窗口」必须作为一次独立的设计决定被提出，
而不是搭在某个消费者身上顺手长出来。
现在样本仍然只有一例，不提前抽象。
```

### 评审性质（如实记录）

本文与 `docs/development/phase-3-desktop-session-awareness.md` 由**实现者本人**撰写，属于自评。它记录的是实际验证过什么、以及哪些结论的证据强度较弱（§21.4 / §21.5 / §21.6 / §25），但**不能替代独立评审**。人工作为独立评审者时，最值得复核的三处是：

1. **§10 的不对称优先级是否应当如此。** 本阶段的立场是：`changed` 是存在性断言、`stable` 是全称断言，因此前者可以由局部证据支撑而后者不能。若将来出现一个需要「证据完整才给结论」的调用方，那应当是一次**独立的语义变更**，而不是在本层加一个开关。

2. **§6 把 baseline 放在 `setup` 作用域是否已经足够。** 它依赖「`setup` 恰好等于 Runtime 定义的激活边界」这一事实。这条依赖今天成立且由测试 16 覆盖，但它是一条**对本层之外机制的依赖**——Runtime 若改变 `setup` 的调用时机，本层语义会随之改变而本层代码不动。这是需要被记住的耦合方向。

3. **§22 对真实运行数字的处理是否足够克制。** 本文只允许它证明「集成可达」与「开销可忽略」，不允许它支撑任何语义结论。若评审认为连这两条也不该由测量支撑，则 §1 的真实运行样例应当进一步降级为纯附录。
