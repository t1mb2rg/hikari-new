# Agent-callable Capability Surface v0

> 轮次：**工作标签，不占用任何阶段编号**（不是 P4-04，不是 P4-03 的一部分）
> 状态：**实现完成、已提交、已 push、CI 通过**（Functional / Architecture Review 见 §11；交付事实见 §12）
> 前置：`work-focus.current@1`（commit `b0ecde2`）与 `desktop-session-awareness.peek@1`（commit `ee73e17`）均已就位
> 本轮开工时的 `HEAD` = `b0cca79`（`docs: record language plugin v1`）
> 边界记录依据：上一轮 **Agent-callable Capability Surface v0 Boundary Review** 的结论已由人类裁决并冻结；本文件是 mandate 要求的 **after-the-fact record**，不是新的设计阶段
> 交付事实（commit / CI run / 测试计数）见 §12
>
> **口径更新（`Language Tool-use Loop v1` 之后，2026-09-23）**：本轮交付的两个 exposure、owner 归属、metadata 的 `{name, description, service}` 形状、以及「exposure 不携带权限」这条边界**全部仍然成立**，并且正是下一个 slice 的输入。**已被取代的只有本文件对「下一 slice 还没发生」的描述**：§7 与 §8 关于 `current-context` / `LanguageTopic` 的裁决（「仍在 `LANGUAGE_TOPICS` 里、且不在 `LANGUAGE_EXPOSURES` 里」）、§11 测试表里同一件事那一行、§12 第 7 条与第 5 条、以及 §13 末行把 `src/language/topics.ts` 列为未改动文件——`Language Tool-use Loop v1` 已删除 `topics.ts` 与 `understanding.ts`，`current-context` **没有**成为 exposure，而是**消失**了：它不是 capability，是「都读一遍」，而那正是 loop 读两次做的事。**§7/§8 当时的裁决本身没有被推翻**——它说的是「不把它硬塞进 exposure」，这一条仍然是现在的实际状态。

---

## 0. 本轮回答的问题

上一轮 Language Plugin v1 交付了一个**闭集**：模型只能从四个词里挑一个，挑不到就 `refused`。那是**输入侧**的收窄——模型不能编写现实。

本轮处理的是**另一侧**：当下一个 slice 让模型自己选「要调用哪个能力」时，它选的到底是什么。

一句话概括本轮的结论：

> **它选的不是一个新的可调用对象，而是某个早就存在的 public Service 的一个面向智能交互层的名字。**

这决定了本轮的形状。它不是「加一层 capability」，而是**给已有的 Service 补上它的 owner 一直没写、现在第一次有读者的一段元数据**。

---

## 1. 冻结结论与它的来源

`core-architecture-v0.md` §5.3 在本轮之前就写死了这件事：

```
### 5.3 Capability 暂不成为第二套运行机制
v0 中：
> Service 是 Runtime 的真实原语；Capability 是从公开 Service 形成的能力视图。
不维护一份与 Service 重复的独立 Capability 真源。
```

**这是本轮唯一的架构依据，本文件不新增任何权威。** §5.3 不是本轮推导出来的，是本轮**第一次有实现去碰它**。它同时否决了上一轮评审中我提出的一版设计（为每个 owner 新建一个 capability Service）——那正是一份「与 Service 重复的独立真源」。

由它直接推出一条**结构性的**、不是风格性的结论：

```text
Service  是 Runtime 的真实 callable contract
Capability / Exposure  = 某个已有 public Service 面向智能交互层的能力视图
```

因此本轮**没有**新增：capability Service、`AgentTool` runtime primitive、Tool Registry、Capability Registry、provider-side invocation handler、第二套 result、任何 Runtime 修改。

---

## 2. Precedent（本轮要固化的一条）

**Agent-callable exposure v0：**

- Runtime 原语**仍然只是 Service**。没有第二套可调用对象，也没有第二套返回值。
- **capability 是 Service 的 agent-facing view**，不是与它并列的第二个东西。
- **owner 定义 exposure metadata**（这个名字描述的是谁的能力，就由谁写）。
- **consumer / composition 决定是否暴露**（`principles.md` §6：Provider 负责「怎么做」，Consumer 负责「如何使用/暴露这个能力」）。
- **execution 仍然调用原 Service**。exposure 不携带调用路径，也不新增调用路径。
- exposure **不自动等于** authorization。
- exposure **不自动等于** model availability。
- exposure **不自动等于** execution permission。

以及它所属的那条既有原则（`principles.md` §5）：

```text
Capability existence ≠ Exposure ≠ Authorization ≠ Execution
```

**本轮只实现了第二项。** 还没有 Authorization：没有任何东西在回答「这一次动作允不允许」，因为本轮也还没有任何东西在**发起**动作。

---

## 3. 两个 exposure 的最终名字与描述

两个都不是新发明的语义，都是 Language v1 已经在读的那两个契约换一个面。

### 3.1 `work_focus.read`

- owner：`work-focus`
- 指向：`work-focus.current@1`
- 描述：

  > 读取用户当前明确声明的工作焦点。结果只是用户明确声明过的那组 designation，不解释它们的含义，也不推断优先级、重要性，或者用户此刻实际正在做什么。

### 3.2 `desktop_context.read`

- owner：`desktop-session-awareness`
- 指向：`desktop-session-awareness.peek@1`
- 描述：

  > 读取 Hikari 当前的桌面会话观察与 awareness assessment，这次读取不会推进 desktop awareness 的时间线。返回的是 Hikari 已经建立的事实与判词本身，不含引申：前台是某个应用不等于用户正在做与之相关的事，stable 不等于什么都没发生，changed 不等于重要，输入活动不等于用户的专注程度。

### 3.3 为什么名字不是契约 id

`work-focus.current` 命名的是**那个 Service**，`work_focus.read` 命名的是**那次 offer**。两者由 metadata 里的 `service` 字段绑定，**不是靠命名约定绑定**——约定会在两边一起改名时继续「一致」，而字段的引用同一性不会（§11 有测试）。

### 3.4 为什么描述必须带上「不做什么」

两半里只有一半会腐化。offer 那一半会自我复述——一个忘了自己干什么的能力是显眼的；limit 那一半读起来像一句 caveat，而 caveat 是后来者最先删掉的东西。删掉它的那一刻，「用户声明了什么」就变回了「用户正在做什么」，而后者是这两个插件**从未被给过事实**去回答的问题。

---

## 4. Desktop owner 的裁决

**owner 是 `desktop-session-awareness`，不是 `desktop-session-observe`。**

理由是语义归属而不是出口位置。`desktop-session-observe` **不拥有任何事实**：它的 setup 是一次 `get` 加一次 `await awareness.peek()`，它的 `provides` 是空的。在它上面建 exposure 会得到一个**视图的视图**，而描述文本会落在一个**不知道桌面会话是什么**的插件手里。

`observe` 保留它现在的位置——human inspection 的表达。渲染留在它那里，读取桌面的语义留在 awareness 这里。

这同时决定了 exposure 指向 `peek` 而不是 `current`。两个契约回答同一个问题、用同一个比较、对同一个 baseline，差别只在「这次读数会不会成为下一次比较的对象」。**给人看的东西不该变成 judgement timeline 的一步**，而 `current()` 持有的是移动 baseline 的能力。这一条是**持有的契约的性质**，不是遵守的规则：exposure 根本没有命名 `current`，所以消费者够不到它。

---

## 5. metadata 的实际 shape

```ts
{
  readonly name: string;
  readonly description: string;
  readonly service: ServiceContract<...>;
}
```

三个字段。**第三个是本轮的设计内容。**

只有 `{name, description}` 的话，「这个能力是那个 Service 的视图」就只是一句话——一张标签，消费者可以把它贴到任何一个它喜欢的 Service 上。加了 `service` 之后：

- 这成了 **owner 自己作出的断言**（「我的这个能力，是那个 Service 的视图」），而不是消费者替它宣布的；
- 它是一个**指向已冻结契约对象的引用**，不是 id 字符串、不是拷贝：没有复制 provider state，没有登记，没有新契约；
- 它**可被证明**——测试断言引用同一性，而不只是断言 id 相等。

它**不授予任何东西**：消费者仍然必须通过自己的 `requires` 拿到 Service，exposure 回答的是「可以对外提供什么」，永远不是「这个调用方被允许做什么」。

### 5.1 刻意没有加的字段

input schema、output schema、authority metadata、side-effect class、tags、categories、cost、model hints、examples、aliases、discovery keywords。

**一个不接收参数的 read capability 一个都不需要**，而为「还不存在的调用方」预留字段，正是 `plugin-design-spec.md` §16 Contract Creation Gate 拒绝的那件事。这份清单写在这里而不是留在设计讨论里，因为拒绝一个字段最便宜的时刻是**第一个字段被加进来之前**。

### 5.2 没有建共享类型

两个 exposure 各自在自己的模块里声明了一个**模块内**的 interface，没有建立 `AgentCapabilityExposure` 这样的共享 shape，也没有建 `capability` package 或 tool runtime abstraction。

最小必要性判断的结论是**不需要**：`Object.freeze([a, b])` 推导出的元素类型是两个 interface 的**联合**，因此在任何一个**有类型标注的**消费点上，字段名对不上就是编译错误。

**一处必须说准的地方（评审修正）**：这条编译期检查**今天是潜在的，不是运行中的**。仓库里没有任何 `.ts` 文件访问 `LANGUAGE_EXPOSURES` 的元素；唯一的读者是 `.mjs` 测试，而 `tsconfig.json` 的 `include` 是 `["src/**/*.ts"]` 且未开 `allowJs`——测试完全不参与类型检查。所以今天真正挡住漂移的是**测试里的引用同一性断言**（运行时），编译期那条要等到第一个类型化消费点出现才生效。设计决定（无消费者 → 不建共享类型）本身不变，但它的理由在消费点出现之前是**备着的**，不是**在用的**。

---

## 6. Language 如何消费

新增的唯一消费侧文件是 `src/language/exposure.ts`，内容就是两个 owner export 的引用：

```ts
export const LANGUAGE_EXPOSURES = Object.freeze([
  workFocusReadExposure,
  desktopContextReadExposure,
]);
```

**它里面没有一个字描述任何领域。** 每个条目都是 owner 自己的对象，按引用；这个文件只回答**其中哪些在 offer 之列**。这与每个插件 barrel 导出自己的线词汇是同一个手法，也是同一条理由——消费者写一份自己的「读取用户当前明确声明的工作焦点」，就是第二个在决定别人领域能力覆盖范围的东西，而第二个恰好是第一个改动时没人会回头读的那一份。

因此 ownership 是三分的，每一半都归正确的一方：

| 谁 | 拥有什么 | 落在哪 |
| --- | --- | --- |
| owner | 能力的语义（名字与描述） | `src/*/exposure.ts` |
| consumer | 哪些能力被 offer | `src/language/exposure.ts` |
| consumer | 那个 Service 怎么被调用 | `src/language/plugin.ts` 已有的接线，**本轮未改一个字** |

**没有 registry、没有自动发现、没有遍历 Runtime、没有动态 enumerate、没有按名字查找。** 清单是写出来的，因为只有两项；一个会「发现」它们的 v0 需要一个用来发现的 registry，而那正是 §1 拒绝的东西。

**本轮没有改变依赖图。** Language 的 `requires` 仍然是恰好那两个，`provides` 仍然是空——两个 exposure 指向的 Service **本来就是**它在读的那两个，所以它不需要「再获得 capability」。

### 6.0 它不从 barrel 导出（评审修正）

`LANGUAGE_EXPOSURES` **没有**从 `src/language/index.ts` 导出；测试按路径 `../dist/language/exposure.js` 直接 import（这在本仓库是既有先例）。

理由是 `plugin-design-spec.md` §7 的 **REVIEW TRIGGER**，逐字针对的正是这一情形：「这个符号被导出，是因为它确实跨越模块边界，还是因为**测试**、对称性或预判的未来需要？」——而当初写的导出理由恰恰是「测试需要能检查它」。回到 §2.1 四条判据：判据 2（确实跨越模块边界）**不成立**，因为**下一个消费者在 `src/language/` 内部**（tool-use loop 是这个插件自己的一段），它可以直接 import 相邻模块，不需要 public surface。

作为对照，两个 **owner** 的 barrel 导出（`workFocusReadExposure` / `desktopContextReadExposure`）判据 2 **成立**：`src/language/exposure.ts` 今天真的跨模块 import 它们。同一个 slice 里两个导出，一个留、一个撤，区别就是这一条。

**这是一次收缩，不是遗漏**：等真的出现跨模块读者，把它加回 barrel 是一行的事。

### 6.1 一条必须说清楚的限制

`LANGUAGE_EXPOSURES` **今天没有生产读者，只有测试在读它。**

这是本 slice 的性质而不是疏漏：本轮建立的是 foundation，selection loop 属于下一个 slice。写它的理由是 mandate 明确要求「Language 当前允许的 exposure」必须被显式写下来，并且它使「每个 offer 都指向一个 Language 真的持有的契约」成为一条可执行的断言，而不是一条注释。

**如果下一个 slice 没有消费它，它就应该被删掉**，而不是留下来当作「以后会用」。

---

## 7. `current-context` 的裁决

**保留，而且它不是 external capability。**

`current-context` 是 Language Plugin 自己的 **dialogue concern**：它读的是本插件上一轮留下的那一句话，**读不到任何 provider 的事实**。因此没有一个 owner 能为它写描述——「问模型要不要调用一个工具来记住它自己上一个问题」是为了词汇整齐而牺牲词汇本来在描述的东西。

于是 Language 的交互空间里同时存在两类东西，且**不强行统一**：

```text
A. Language-owned behavior    普通聊天 / current-context / previous-turn / follow-up
B. Exposed domain capability  work_focus.read / desktop_context.read
```

Language 知道「我们上一轮在聊什么」，**不需要调用一个 tool**。本轮有测试钉住 `current-context` 仍在 `LANGUAGE_TOPICS` 里、且不在 `LANGUAGE_EXPOSURES` 里。

---

## 8. 与 `LanguageTopic` 的关系

两者**共存**，且互不派生：

```text
LanguageTopic          当前 v1 Understand 的闭集，answer.ts 今天就是按它分派的
agent-facing exposure  未来 tool-use loop 的输入材料
```

本轮**没有**删除 `LanguageTopic`、**没有**重写 Language v1、**没有**实现 full tool-use loop、**没有**提前做双重 router。如何从「固定 topic dispatch」迁移到「model-native tool use」由下一个 slice 决定。

---

## 9. `detailLine` invariant（记录，不是本轮的错误路径）

上一轮评审发现 `src/language/express.ts` 的 `detailLine` 是一条**已有的用户可见自由文本通道**：

```ts
function detailLine(detail: string): string {
  return `  细节：${oneLine(detail)}`;
}
```

喂给它的是 `answer.ts` 里 `describe(error)` 的结果（即 `error.message`），`oneLine` 只剥控制字符、**不约束内容**。今天它是诊断通道（机器/宿主文本），这是可以辩护的。

**本轮记录不变式，不提前实现错误路径**——本轮还没有 capability selection，因此不存在「未知 capability」这类分支，为一个不存在的分支新建错误路径正是 §5.1 拒绝的同一件事。不变式是：

> 模型原始输出**不得**进入用户可见的错误文案。禁止 `` `未知 capability：${modelOutput}` ``；允许「这次请求没有匹配到当前可用的能力。」模型原文若确实需要调试，只能进受控 diagnostics，不得成为 Hikari 对外的回答或事实。

---

## 10. 明确不做（本轮冻结）

Language Tool-use Loop、LLM function calling、OpenAI tool schema、Tool Registry、Capability Registry、Runtime enumeration、dynamic discovery、deferred tools、BM25、Jev、Claude Code、Agent Bridge、Action、Authority、Approval、Memory、Notification、Proactive Communication、Grounded LLM Expression、Generic Tool Result、Universal Intent、Universal Result Envelope。

（与上一轮 mandate 的清单一致，逐条未动。）

---

## 11. 测试与 Review

### 11.1 新增测试（8 条）

| 文件 | 条数 | 钉住什么 |
| --- | --- | --- |
| `test/work-focus.test.mjs` | 2 | exposure 由本插件导出、指向 `work-focus.current@1`；描述同时说「能做什么」与「不做什么」 |
| `test/desktop-session-awareness.test.mjs` | 3 | exposure 由本插件导出、指向 `peek` 而**不是** `current`；描述写明不推进时间线且不含四类引申；**通过 exposure 指向的契约真的读一次**，读到的变化仍然留给时间线 |
| `test/language.test.mjs` | 3 | 清单里的对象**就是** owner 的导出（引用同一性，不是相等）；每个 offer 指向的契约都在 `requires` 里；`current-context` 仍在 topic 闭集且不在 exposure 里 |

### 11.1b 对照 mandate §十一 的十项验证目标

十项是**验证目标**，不必然各对应一个新测试函数；下面是每项的落点。

| # | 验证目标 | 由什么满足 |
| --- | --- | --- |
| 1 | Work Focus exposure 由 Work Focus owner 导出 | 新增 `test/work-focus.test.mjs` 的 exposure 段 |
| 2 | Desktop exposure 由 awareness owner 导出 | 新增 `test/desktop-session-awareness.test.mjs` 的 exposure 段 |
| 3 | Language 用的是 owner export，不是自己的复制字符串 | 新增 `test/language.test.mjs` 的**引用同一性**断言 |
| 4 | Work Focus exposure 实际映射到 `work-focus.current@1` | 同上，`assert.equal(exposure.service, workFocusCurrentService)` + id/version |
| 5 | Desktop exposure 实际映射到 `...peek@1` | 同上，`assert.equal(exposure.service, desktopSessionAwarenessPeekService)` |
| 6 | Desktop exposure 不调用 `current()`、不推进 baseline | 新增的行为测试（三读数，见下） |
| 7 | Language `requires` 仍然恰好那两个 | **既有**测试 `test/language.test.mjs:490` `Language 的 requires 恰好是冻结的那两个，provides 为空`，逐字 `assert.deepEqual` |
| 8 | Language `provides` 仍然 `[]` | 同上一条测试的后半 |
| 9 | Runtime 无变化 | **不是一条测试**，是本轮改动的事实：`git diff -- src/runtime/` 为空。`test/runtime.test.mjs` 全绿，其中 `runtime does not need to know service business semantics` 正是这一项的行为读法。mandate §十一 明确不要「source regex architecture suite」，因此**没有**新增扫描型守卫 |
| 10 | existing Language v1 全量回归绿 | 全量套件（§12） |

三条最关键的断言：

1. **引用同一性**，不是内容相等——内容今天相等，明天可能巧合地仍然相等；引用同一性证明这些话只有一个作者。
2. **`exposure.service` 可以直接写进 `requires` 并被 Runtime 解析**——这是「它指向的是 Runtime 里那个真实契约，而不是一份长得一样的平行描述」的直接证据。
3. **通过 exposure 读桌面，变化仍然留给时间线**——notepad → firefox → firefox 三读数：读一次不消耗那次变化，时间线随后仍然拿得到它。

   **这条测试怎么抓错（评审修正）**：不是靠第三次读数变 `stable`。若 exposure 指错成 `current`，`requires` 会变成 `[current, current]`，而 Runtime 在 `validatePluginDefinition` 阶段就拒绝重复的 requires 契约——`loadPlugin` 会在断言 `'active'` 的那一行直接抛出，**后面三次读数根本不会执行**，也就永远不会出现 `stable`。测试**仍然会失败**（它不是 fake），但失败在上面的加载处。原先文档与测试注释都把这个失败路径说错了，已一并更正。`peek` 与 `current` 是两个各自只有一个方法的 interface（`peek()` / `current()`），所以「指错就拿不到 `peek`」这一点是**类型层面**成立的。

### 11.2 被更新的两条既有守卫

两条**文件名册**（roster）守卫被同步更新：

- `test/desktop-session-awareness.test.mjs`：`the awareness module depends only on the public world contract` —— 该模块的文件清单由 4 个变成 5 个。
- `test/desktop-session-awareness-loop.test.mjs`：`the loop added no file to any module it depends on` —— detection-awareness 是 loop 的依赖之一。

**这是名册守卫按设计工作，不是被削弱。** 它们的作用就是让「某个模块多了一个文件」这件事必须被人看见；这个文件是 exposure 带来的、不是 loop 带来的，两处注释都写明了这一点。两条守卫的**断言方式**（精确列举、逐文件检查 import 白名单）未改，也没有放宽。

### 11.3 Functional Review

- 行为满足验收：两个 exposure 由各自 owner 导出；Language 持有的是引用；`requires` / `provides` / Runtime 全部未变；Language v1 全量回归绿。
- regression test 真正约束行为：§11.1 的第 2、3 条是行为断言；第 3 条走的是**真实 awareness 插件 + 真实 Runtime 依赖图**，不是 fake。
- 全量测试与 build 见 §12。

### 11.4 Architecture Review（对照 mandate §十四 的九问）

1. **是否创建了 Service 之外第二套真源？** 否。exposure 按引用指向既有契约对象，不复制任何 state；`work-focus` 仍然只 `provides` 一个 Service。
2. **metadata 是否仍由 owner 控制？** 是。两个 exposure 各自住在拥有该语义的模块里，并从该模块 barrel 导出。
3. **Language 是否复制 domain description？** 否。`LANGUAGE_EXPOSURES` 里没有一个字描述领域，有引用同一性测试。
4. **Runtime 是否开始理解 tools/capabilities？** 否。`src/runtime/` 一个字节未改，没有新字段、没有新原语。
5. **是否产生 registry / locator？** 否。清单是写出来的两个字面条目，没有注册、没有查找、没有发现。
6. **Desktop owner 是否仍是 Awareness，而不是 Observe？** 是。`desktop-session-observe` 本 slice 未改。
7. **`current-context` 是否仍是 Language-owned behavior？** 是。仍在 `LANGUAGE_TOPICS`，不在 `LANGUAGE_EXPOSURES`，有测试钉住。
8. **是否为了两个 read capability 过度抽象？** 否。没有共享类型、没有 schema、没有 invoke、没有 authority 字段；两个模块内 interface 各三个字段。（唯一可议之处是 §6.1 记录的「今天没有生产读者」，已如实记录。）
9. **下一 slice 是否已经有足够基础开始 Language Tool-use Loop？** 是，且**恰好够**：名字、描述、指向的契约、允许清单四样齐备，而选择、授权、执行三样一样都没做。

### 11.5 已知限制

1. **描述断言钉的是「在不在」，不是「对不对」。** 子串断言能挡住「后来者把 caveat 删掉」——那是它被写下来的理由——但挡不住**改写成相反的意思**。一个同时含 `不解释` 与 `不推断`、却写着「并推断优先级」的描述会全部通过。散文无法被单元测试证明；这是这项技术的**真实上界**，不是可以通过再加几条断言消除的东西。
2. **四类引申现在是四条独立断言**（评审前只有两条，另两条被删掉测试仍会全绿——那是当时的一个真实漏洞，已补）。补上之后，覆盖的是「四条都在」，不是「四条都真」——限制同上一条。
3. **编译期漂移检查是潜在的，不是运行中的**（见 §5.2）。
4. **`LANGUAGE_EXPOSURES` 今天没有生产读者**（见 §6.1）。
5. **`current-context` 与两个 exposure 分属两种词汇**，本轮刻意不统一（见 §7）；这是下一 slice 的输入，不是本 slice 的缺陷。

### 11.6 本轮对抗性评审的处置

一次独立的对抗性评审（只读，单域一次 pass，未铺 fan-out）对本 slice 提出 6 条候选。按仓库纪律逐条重新锚定到源码后：

| # | 候选 | 裁决 | 动作 |
| --- | --- | --- | --- |
| 1 | 测试只断言了四类引申中的两条，另两条删掉仍全绿 | **采纳** | 补齐为四条独立断言 |
| 2 | 子串断言挡不住语义反转 | **采纳**（作为限制） | 写入 §11.5，不再声称它能挡 |
| 3 | 文档与测试注释把失败路径说错（`stable` / `.peek()` 抛错，实际是 `loadPlugin` 拒绝重复 requires） | **采纳** | 两处叙述一并更正，见 §11.1 注 3 |
| 4 | `src/language/exposure.ts` 自称不含领域文字，却在注释里逐字引用 owner 描述 | **采纳** | 删去引文并说明为何不引 |
| 5 | `LANGUAGE_EXPOSURES` 的 barrel 导出以「测试需要」为由，抵触 spec §7 | **采纳** | **撤回该导出**，测试改为按路径 import，见 §6.0 |
| 6 | 编译期漂移检查今天不会被触发 | **采纳** | 更正 §5.2 措辞 |

评审同时**否证**了一条预期的怀疑：「两条名册守卫被放宽」。守卫的断言机制逐字未动（仍是精确 `deepEqual` 列举 + 未改的 import 白名单循环），只更新了名册内容本身。

**6 条全部采纳，没有一条是风格偏好**：其中 4 条改了代码（#1、#3、#4、#5），5 条改了文档（#2、#3、#5、#6 以及 §11.5）。这比本 slice 的体量所暗示的要多——本轮的结论大部分是「不需要做什么」，而「不需要做什么」恰恰是最容易说过头的地方。

---

## 12. 交付

- 本轮开工 `HEAD`：`b0cca79`（`docs: record language plugin v1`）
- 实现：`fdacd93`（`feat: add agent-callable capability exposures`）——9 个文件，+430 / −6
- CI：Runtime Tests **#35756255449 success**（501 tests / 426 pass / 75 skipped / 0 fail）
- 本机：501 tests / 500 pass / 1 skipped / 0 fail（CI 上被跳过的全部是依赖命名管道的用例）
- 基线本机测试计数：493 / 492 pass / 1 skipped / 0 fail → 新增 8 条
- `git status --short`：除本状态记录提交自身外为空
- GitNexus：`meta.json` 的 `lastCommit` == `git rev-parse HEAD` == `fdacd93`

### 12.1 实际改动

**新增（3）**

```
src/work-focus/exposure.ts
src/desktop-session-awareness/exposure.ts
src/language/exposure.ts
```

**修改（6）**

```
src/work-focus/index.ts                    +2 导出 + 头部受众说明
src/desktop-session-awareness/index.ts     +2 导出
test/work-focus.test.mjs                   +2 条
test/desktop-session-awareness.test.mjs    +3 条，另更新一条名册守卫
test/desktop-session-awareness-loop.test.mjs  更新一条名册守卫
test/language.test.mjs                     +3 条，按路径 import
```

`src/runtime/**`、`src/language/plugin.ts`、`src/language/index.ts`、`src/language/topics.ts`、两个 `contracts.ts` **均未改动**。
