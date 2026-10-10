# D0 · UIA Content Reader — Implementation Boundary Review

> 本轮是**架构与实现边界设计**，不是实现。未修改任何生产代码，未 commit，未 push。
>
> 上游：`desktop-context-understanding-v0-research.md`（NARROW）、`desktop-context-understanding-d0-uia-fidelity.md`（NARROW）、`desktop-context-understanding-d0-content-groundtruth.md`（NARROW / READY: YES）。
>
> 本轮所有承重结论都已锚回源码、契约与测试；每条都给出文件与行号。**subagent 的发现只作为候选**，下面每一条都经过主 Agent 第一手复核。

---

## §0 结论摘要

**整体判定：NARROW。** 第一片 **READY: YES**；第二片（模型可达）**BLOCKED**。

本轮最重要的一条发现是：

> **§三（Composition 冻结守卫）与 §四（数据边界）不是两个问题，是同一个岔路口。**
>
> 模型要能读到窗口正文，唯一的机制是 `src/language/exposure.ts` 的两份 exposure 清单 —— 而那份清单的消费者**就是模型**。正文一旦被模型读到，就已经发往 operator 配置的 endpoint。而 §四 明令 v1 **不授权向远程模型发送真实私人窗口正文**。
>
> 换句话说：**§四 排除掉的那条路，恰好就是会触发 §三 守卫的那条路。** 把模型暴露排除出 v1 之后，第一片根本不碰 `exposure.ts`，也就根本不触发守卫 —— 不是因为绕开了它，而是因为第一片不走那条路。

据此，第一片的形状由既有先例直接给出，且无需任何新的 Runtime 机制：

| 面 | 结论 | 依据 |
| --- | --- | --- |
| 新 Service | **不需要** | `desktop-session-observe/index.ts`：无 Service 且无缺失 |
| exposure 清单 | **不碰** | 模型路径被 §四 排除 |
| 新 variant | **不需要** | 守卫不触发 |
| `tools.ts` / `readArguments` | **不碰** | 第一片不是模型工具 |
| 参数化读 | **不做** | `tools.ts` 明记「第一个带参数的能力才决定那是什么形状」 |
| Composition | **只加一个成员** | 与 `foreground` / `observe` 同形 |
| 平台缺席 | **沿用 throw** | `desktop-session-observe/plugin.ts:93-98` |

---

## §1 目标与真实消费者

### 1.1 目标

针对一个 Windows 窗口，**按需**返回**有界**、**可归属**、**带来源及读取状态**的 UIA 内容。

### 1.2 真实消费者：诚实的答案

**今天，这个仓库里没有任何消费者需要窗口的文本内容。** 这不是搜索遗漏，是仓库的事实：

- `src/` 全域检索 `UIAutomation` / `AutomationElement` / `TextPattern` / `ValuePattern` / `EnumWindows` / `screenshot` / `ocr` / `截图` —— **零命中**。
- 全仓**唯一**真正读 Windows 窗口的地方是 `src/foreground/windows.ts`，读的是 `GetWindowTextW`（标题）与进程名，**不是正文**。
- 所有下游只消费**窗口身份**与**输入活动 tick**：
  - `src/desktop-session-world/plugin.ts:28-49` —— 原样转发，不解释；
  - `src/desktop-session-awareness/plugin.ts:35` —— 只比较 `title` 与 `processName`；
  - `src/desktop-session-observe/presentation.ts` —— 渲染 `processName` / `title` / 观察时间；
  - `src/desktop-return-attention/plugin.ts` —— 完全不读 foreground，只读 `input-activity.current@1`。

### 1.3 既有 base read 的消费者结构

作为对照，今天两个 base read 的 Service 各自有**组合成员**消费者：

| Service | 组合成员消费者 | 依据 |
| --- | --- | --- |
| `work-focus.current@1` | `desktop-return-attention`（真实 decider）、`language`、`repository-ci-relevance` | `src/desktop-return-attention/plugin.ts:114` |
| `desktop-session-awareness.peek@1` | `desktop-session-observe`、`language` | `src/desktop-session-observe/plugin.ts:85` |
| `repository-ci-relevance.current@1` | **只有 `language`** | `src/language/plugin.ts:535` |

这张表给出两条**方向相反**的事实，都要如实记下：

1. **「只有 Language 一个消费者」是被接受过的先例**（relevance 就是）。所以不能仅凭「没有组合成员要读」就否掉一个 Service。
2. 但 Language 是通往**模型**的门。走这扇门 = 正文离开本进程。

### 1.4 把两个候选消费者分开

| 候选 | 路径 | 正文是否离开本进程 |
| --- | --- | --- |
| **C-1：操作员** | `hikari observe … status` → 本机命名管道 → 渲染成行 → 人的终端 | **否** |
| **C-2：模型** | `exposure.ts` 清单 → `tools.ts` → 模型请求 → 结果回灌给模型 | **是**，发往 operator 配置的 endpoint |

C-1 的既有形状已经存在且被用过三次：`src/cli/observe-command.ts:1` 的头一行写的就是
「`hikari observe desktop-session status` — a human asking a running Hikari what it currently sees.」
（另有 `focus-command.ts`、`relevance-command.ts` 同形。）

**§四 排除 C-2。因此第一片的真实消费者是 C-1。**

### 1.5 必须说清楚的一点

C-1 **也不是**一个「已经存在的、正在发生的」窗口正文消费者 —— 它同样是新造的面。真正授权这一片的不是消费者证据，而是 **Human Ruling H3**（桌面正文读取进入长期方向，首版限用户明确触发的按需读取）。

按 `src/language/contracts.ts` 记录的 Contract Creation Gate 口径，一个 Service 需要「一个真实的、已经发生的跨模块交互，而不是提前建好的一座设施」。**H3 是一条 mandate，不是一个 consumer。** 这个区别本轮不掩盖：第一片之所以成立，是因为它以 mandate 为依据并且**没有为此新增 Service**；一旦有人要用「有消费者」来论证新增 Service，那份论证今天不成立。

---

## §2 现有 Owner / Service / Composition 边界

### 2.1 Runtime 机制（逐条锚回源码）

- **插件接口**：`src/runtime/plugin.ts:29-36` —— `{id, version, requires?, provides?, config?, setup}`。
- **只有 `requires` 里的契约能 `get`，只有 `provides` 里的能 `provide`**：`src/runtime/plugin-context.ts:22-33`，越界抛错。
- **`requires` 是硬依赖，没有 optional**：`src/runtime/runtime.ts:109-111`
  ```ts
  #requirementsSatisfied(definition) {
    return (definition.requires ?? []).every((contract) => this.#services.has(contract));
  }
  ```
  **是 `every`，没有降级模式。** 缺依赖 → 停在 `waiting` → 常驻起不来（fail-closed）。
  测试固定此事：`test/language.test.mjs:1769`「relevance Service 缺席时，repository-aware Language 停在 waiting，不降级启动」。
- **契约配对是 `id@version` 精确字符串相等**，无中央注册表；契约 id 就地声明在各 owner 的 `contracts.ts`。
- **平台缺席的既有语义是 throw，不是 unavailable**：`src/desktop-session-observe/plugin.ts:93-98`
  ```ts
  const path = observeEndpointPath(config.rootDir);
  if (path === undefined) {
    throw new DesktopSessionObserveError('桌面会话观察入口依赖 Windows 命名管道，本机没有。');
  }
  ```
  同形的还有 `src/foreground/windows.ts:73-75`、`src/input-activity/windows.ts:52-53`。

> **推论（对验收条件 §6.7 的决定性）**：base composition **今天就已经是 Windows-only 的**（`desktop-session-observe` 就在 base 里，非 win32 直接 throw，`test/bootstrap.test.mjs` 因此整体 skip）。**新增一个 Windows-only 插件不会改变 base roster 的可启动性** —— 它已经是了。§五 的「非 Windows 缺席语义」不需要新设计，照抄既有先例即可。

### 2.2 exposure 机制：模型可达性的形状

- `LanguageExposure` 的三份 owner 形状都带 **`service: ServiceContract<…>`**（`src/desktop-session-awareness/exposure.ts:52-69` 是最接近的样板）。`src/language/exposure.ts:97-100` 把它写成联合类型。
- `src/language/read.ts:78-88` 按 `exposure.service` 派发读取分支，未知 service 抛 `LanguageError`。
- `src/language/tools.ts` 把它转成 wire 形状。

> **推论**：**一个能力要被模型读到，必须是一个 Service。** 这不是选择，是被现有 exposure 形状与派发逻辑决定的。反过来说：**不做模型暴露，就不需要新增任何 Service。**

### 2.3 参数问题：今天在结构上被拒绝

`src/language/tools.ts` 把这件事写得非常明确：

- `:14-19` ——「**Every capability in every variant of this build is a zero-argument read**」，`parameters` 恒为 `{properties:{}, additionalProperties:false}`。
- `:49-60` —— `readArguments` 对任何**带 key 的 object** 返回 `'malformed'`，该次调用被拒。`ArgumentReading` 是闭集 `'none' | 'malformed'`。
- `:21-25` ——「**There is no input type to generate from yet; the first capability that takes an argument is the one that gets to decide what that looks like**」。

> **推论**：「读**指定**窗口」在今天是被契约主动拒绝的形状。要做它，需要同时改 `exposure` 形状（带上 input schema）、`toModelTool`（生成 schema）、`readArguments`（从闭集改成真正的校验）—— 三面都在 `src/language/`。**这是「本仓第一个带参数的能力」这一独立决定，本轮不并进来。**

### 2.4 冻结守卫：精确定位

上一轮研究指出 `src/language/exposure.ts` 里的守卫可能阻止新增第三套字面量清单。**逐字核对后的准确说法如下**（比上一轮的表述更精确，方向不变）：

1. **守卫是注释里的规范，不是可执行代码。** `src/language/exposure.ts:40-48` 是散文：
   > 「如果将来出现第二个独立可选的领域能力，答案不是在此处再加第三个字面量列表——而是进行一次 Composition Boundary Review，决定能力可达性是否应在组合时决定。本切片不解决该问题，且有意不为其做准备。」

   `src/language/plugin.ts` 重复同一条：「A second such capability is the trigger for a Composition Boundary Review — not for a third factory here」。

2. **真正会变红的是测试**：
   - `test/language.test.mjs:1509` —— `assert.equal(LANGUAGE_EXPOSURES.length, 2)`
   - `test/language.test.mjs:1720` —— 两份清单名字并集大小 `=== 3`
   - `test/language.test.mjs:1534-1536` —— 逐项断言 `service` 身份
   - `test/language.test.mjs:1723-1739` —— **遍历 `dist/language/index.js` 的导出**，断言恰好是这两个列表

3. **这两条测试是互补的，缺一不可，值得记下**：并集断言只覆盖写死的那两份清单（`test/language.test.mjs:135` 的 `EVERY_EXPOSURE_LIST` 硬编码为两个），一个既不导出、也不加入两份清单的第三清单会漏过去；导出遍历断言正是为了堵这个洞 —— 它的注释自己写了这一点（「a third list could join the package and nothing above would notice」）。

> **结论**：守卫 = **一条记录在案的规范 + 覆盖常规实现路径的测试**，不是不可绕过的机制。正因为它是规范而不是编译器，**「不得绕过」才有意义**——绕过它只需要不导出，而那是欺骗而不是工程。本轮不绕。

### 2.5 守卫到底在守什么

守卫管的不是「能力」，是 **`2^n` 的变体轴**。原文的论证是：base 与 repository-aware 相差**恰好一个**独立可选能力，一个可选能力有两种状态，所以两个变体。第二个这样的能力 → 四个变体，第三个 → 八个。

因此本轮必须区分两件事：

| 做法 | 变体数 | 是否触发守卫 |
| --- | --- | --- |
| 新增第三个变体 / 第三个工厂 / 第三份清单 | 3+ | **是** |
| 把能力加入**两份既有清单的共同前缀**（无条件） | 仍为 2 | **否** —— 没有新增轴 |

`src/language/exposure.ts:110-112` 已经写明了这一点的反面：「Adding a Service to the composition does not add a capability here」—— 加 Service 不加能力。同理，**把一个无条件能力加进共同前缀，不加变体。**

---

## §3 最小实现候选

### 3.1 第一片（本候选，READY: YES）

**一个新插件，走自有 endpoint，不提供任何 Service。**

形状直接照 `desktop-session-observe`（它是最新加入的桌面类插件，也是「无 Service」的先例）：

```
src/desktop-content-read/
  contracts.ts      （不需要 —— 无 Service）
  types.ts          protocol 版本、wire 词汇、结果类型、上限常量
  protocol.ts       encode/decode 请求与应答（严格键集，未知字段即拒）
  endpoint.ts       监听、分行 framing、teardown（unref，不钉住进程）
  endpoint-path.ts  win32 门 → undefined
  presentation.ts   纯函数渲染器（导出，CI 全平台可测）
  plugin.ts         requires: [] / provides: []，setup 里做平台门
  index.ts          barrel
src/cli/content-command.ts   `hikari content status`
```

关键属性：

- **`provides: []`**。`src/desktop-session-observe/index.ts` 已经把理由写好了：
  > 「There is no Service to export, and there is nothing missing: this plugin has no callable need to satisfy inside the composition, so by the Contract Creation Gate it provides none.」
  这正是 §二「不得直接假设必须新增某种 Service」的答案 —— 而且它是**先例**，不是本轮的让步。
- **`requires: []`**（见 §3.3 的归属决定）。
- **目标 = Hikari 已经在观察的前台窗口**，零参数。不做窗口选择，因此完全避开 fidelity 报告 §3.5 的「42 → 3 择一」问题与 §3.4 的焦点竞争问题 —— 那两个问题属于「枚举并挑一个窗口」，属于解析式读，不属于本片。
- **不碰** `exposure.ts` / `plugin.ts`(language) / `tools.ts` / `readArguments` / variant / `test/language.test.mjs` 的任何清单断言。

平台缺席：照 `desktop-session-observe/plugin.ts:93-98` 的 throw。**base roster 的可启动性不变**（§2.1）。

### 3.2 为什么不是「扩展 `desktop-session-awareness`」

研究文档 §4.3 的路线 A。否掉的理由是 owner 语义，不是成本：

`src/desktop-session-awareness/contracts.ts` 的整个设计围绕一个 **baseline**：`current()` 推进它，`peek()` 不推进。**「读一次任意窗口的正文」既不读 baseline，也不产出比较。** 把它塞进一个以「判断时间线上的变化」为唯一语义的模块，是 concern 放错 owner —— 这正是 Architecture Review 要拦的那类。

### 3.3 为什么不是「扩展 `foreground`」

`src/foreground/types.ts` 的全部类型是：

```ts
ForegroundTargetPresent = { kind:'present'; title?: string|null; processName?: string }
```

这是一个**刻意的窄观测**，且 **不携带 HWND**。正文读取会同时撑爆它的类型面与它的隐私面。

### 3.4 目标 HWND 的确定与归属（对应 §二.3）

**事实**：`ForegroundObservation` 没有窗口句柄。所以「读前台窗口」在实现上意味着新插件**自己做一次 `GetForegroundWindow`**，而不是从 `foreground.current@1` 拿。

这就引出一个必须显式记录的取舍：**要不要 `requires: [foregroundService]` 来交叉验证归属？**

| 选项 | 代价 |
| --- | --- |
| **A. 不 requires**（本候选） | 单次采集，结果自带它实际读到的窗口身份。归属是**被报告的**事实，不是被外部核对的结论。 |
| B. requires `foregroundService` | 两次独立采集两个不同瞬间的「前台」。中间隔着一次 400–2700 ms 的树遍历（fidelity §5.3），两者**合法地可以不一致**（用户切了窗口），于是要么把它当错误（让真实情况变成失败），要么当正常分歧（多一条要解释的路径）。而且 `src/cli/resident.ts` 对 `desktop-session-observe` 的注释明确反对「对同一瞬间二次采集」。 |

**取 A**，理由是它更小且与 `principles.md` 一致：Perception 记录 source 报告了什么；**判定归属是 consumer 的事**。需要对照的 consumer 已经能拿到 `desktop_context_read`，不必由这一层替它下结论。

**仍然必须有的归属守卫**（来自 fidelity §7.3，且**必须在实现里落实，不能只写在文档里**）：

1. 读取前后**校验目标 HWND 仍指向同一个窗口**（窗口可能在遍历中关闭/被替换）；
2. **不得使用 `FocusedElement` 作为内容捷径** —— groundtruth §4.2 与 fidelity §3.4 都实测它跨应用误取；
3. 结果**自带它读的是哪个窗口**（title / processName / hwnd），让归属可被外部核对。

### 3.5 有界遍历（对应 §二.4）

- **walker 固定并记录**（fidelity §7.3-6：换 walker 就是换字符串）。groundtruth §4.3 在受控窗口上测得三种 walker 标记集相同，但 fidelity §3.1 在真实应用上测得不同 —— **不得把任一条当通则**，因此固定一种并把选择写进契约描述。
- 深度与节点上界，超出即**显式**标记 `truncatedBy`（不静默）。
- `matched` 与 `scanned` **一起上报**（fidelity §7.3-5：Targeted `FindAll` 曾静默丢 32% 正文）。
- 单次读取有超时；目标无响应即 `refused`，不挂起。

### 3.6 结果形状（对应 §二.5，落实 H2 / H3 / H4）

分三层，每层都带**不确定性**：

```ts
type ContentRead =
  | { kind: 'read';        window: WindowIdentity; regions: Region[]; bounds: Bounds; readAt: string }
  | { kind: 'empty';       window: WindowIdentity; bounds: Bounds; note: string }   // 走查走完但 0 字符
  | { kind: 'truncated';   window: WindowIdentity; regions: Region[]; bounds: Bounds }
  | { kind: 'refused';     window: WindowIdentity; note: string }                    // 超时 / 目标不响应
  | { kind: 'unreadable';  window: WindowIdentity; note: string };                   // 句柄不可读

interface Region {
  id: string;                        // 最近的带 ScrollPattern 祖先的身份（见下）
  viewportRelation: 'inside' | 'outside' | 'partial' | 'unknown';
  notVisibleBecause: 'offscreen' | 'clipped-by-ancestor' | null;
  nodes: ContentNode[];
}

interface ContentNode {
  channel: 'name' | 'text' | 'value';   // H3
  text: string;
  depth: number;
}

interface Bounds { maxDepth: number; maxNodes: number; maxChars: number;
                   truncatedBy: 'depth' | 'nodes' | 'chars' | null;
                   scanned: number; matched: number; textChars: number }
```

**四个决定的依据：**

1. **`viewportRelation` 而不是 `onScreen`**（H2）。三态 + `unknown` 是**必须**的，不是风格：groundtruth §6.3 实测二值会在边界行上制造假结论，且 §五 明记「partial 是第三态，不是二值」。`unknown` 不得并入 `outside`。
2. **`notVisibleBecause` 与 `viewportRelation` 分开**，因为它们是两个独立问题：**看不见**（几何）与**看不见的原因**（越界 / 被祖先裁剪）。
3. **region 的 id 用「最近的带 `ScrollPattern` 的祖先」的身份** —— 这不是发明，是 groundtruth §6.2 实测出来的**唯一可靠判据**（135/136）的自然载体：
   ```
   visible(el) := 面积(BoundingRectangle(el) ∩ BoundingRectangle(nearest ScrollPattern ancestor)) > 0
                  ∧ IsOffscreen(el) = false
   ```
   对照：∩ 客户区误报 7 次；∩ 每一层祖先误报 124 次（**被证伪** —— raw 树里 `TabItem` 的矩形只是标签头）。H4 的「单 HWND 内多个内容区域」由此有了具体的、实测支撑的定义。
4. **`channel` 三态必须暴露**（H3），且**通道不得被当作内容判定**。groundtruth §2.6 的实测是反直觉的：WPF 上 38 行可见正文里只有 1 个元素暴露 TextPattern，`Name` **本身就是正文通道**，而它同时承载可访问性标签、无法区分。因此：
   - 不得用「有没有 TextPattern」判成功；
   - 不得回退：正文为空时**不得**用 `Name` 冒充正文（fidelity §7.3-2，文档自己标注这条是反惯例的）；
   - 通道只能被 consumer 用来**区分来源**，不能被用来断言「这是正文 / 用户意图」（H3 原文）。

### 3.7 必须写进契约描述的能力缺口（否则就是过度承诺）

groundtruth §6.3 的排除项必须逐字进入**对外的描述文本**，而不是留在报告里：

> 本读取**不保证**区分一切隐藏内容。**只改变渲染、不改变布局**的隐藏方式（`Opacity=0`，以及应假定包括被遮挡、被非滚动祖先裁剪、GPU 合成层）会被报告为 `viewportRelation: 'inside'`。
> 没有任何 UIA 属性表达它们 —— 这是**能力缺口**，不是可以靠更仔细实现补上的 bug。
> 另外：**「可访问」≠「可见」**。走查返回的是文档；groundtruth 实测返回集是屏幕内容的 **2 倍**。消费者必须自己再过一遍可见性。

### 3.8 Windows 原生调用方式与开销（对应 §二.7）

- **调用方式**：沿用仓内既有形态 —— `src/foreground/windows.ts` 的模式（`execFile('powershell.exe', …)` + `Add-Type` 内联 C# + `user32.dll` P/Invoke），而不是在 Node 里引入原生 UIA 绑定。**理由**：这是仓库已经走通、已有错误分类、已有超时常量的路，且不需要新的构建/依赖面。
- **开销**（fidelity §5.3 实测，需在验收里复测）：单窗口 ControlView 399–1453 ms、RawView 1046–2670 ms；**冷树首读是否阻塞未测**。
- **副作用**：UIA 调用会在目标进程产生真实副作用（fidelity 已实测，但只覆盖 14 个样本，长时累积**未验证**）。

---

## §4 新旧契约关系

**第一片不新增、不修改任何 ServiceContract。** 新增的只有：

| 新增物 | 形态 | 说明 |
| --- | --- | --- |
| 插件 id / version | `desktop-content-read` / `1.0.0` | 与 `desktop-session-observe` 同形 |
| endpoint path 派生 | `contentReadEndpointPath(rootDir): string \| undefined` | win32 门 |
| protocol 版本 + wire 词汇 | 自有 `protocol.ts` | 严格键集；未知字段即拒 |
| 结果类型 | §3.6 | 无 Service 依赖 |
| 纯渲染器 | `renderContentRead(...)` | 导出，CI 全平台可测 |
| CLI verb | `hikari content status` | 与 `observe-command.ts` 同形 |

**如果将来要加 Service**（即模型可达），那一步的形状已经被既有先例限定，且**属于另一次评审**：

- contract id 形如 `desktop-content-read.read@1`（就地声明在 owner 的 `contracts.ts`）；
- 需要一份 `desktopContentReadExposure`（owner 自己的导出，形状同 `DesktopContextReadExposure`）；
- 需要 `read.ts` 加一条派发分支；
- **并且必须决定它进哪份清单** —— 那就是 §2.5 那张表的判断点。

---

## §5 数据与权限边界

### 5.1 第一片遵守的边界

| 约束 | 第一片如何满足 |
| --- | --- |
| 只在用户明确触发时读取 | endpoint 只回答一个 verb；**没有 loop、没有 cadence、没有订阅** |
| 不持续/后台采集 | 插件不注册任何定时器；不提供 Service 意味着没有任何组合成员能周期调用它 |
| 不自动落盘 | 结果只在应答行里；不写 Chronicle / Memory / Experience / Salience |
| 不发送到远程模型 | **第一片根本不暴露给模型**（§1.4 的 C-1） |
| 不执行外部动作 | 只读。`SetValue` / `Invoke` 不在本片内（fidelity 也标注写入侧未验证） |
| 读取结果不是指令 | 见 §5.3 |

### 5.2 必须如实记录的缺口

研究文档 §6.2 的检索结论成立且重要：**`src/` 里不存在任何用户同意、隐私边界或脱敏机制**（`consent|privacy|redact|隐私|同意|sanitiz|敏感|脱敏` 零命中）。

第一片**不需要**这层机制 —— 因为正文不离开本进程。**这不是「缺口被忽略」，是「这一片没有用到会暴露缺口的路径」。** 一旦引入 C-2，这层缺失就立刻变成承重问题（→ §7 G-1）。

### 5.3 注入面

§四 明令：UIA 读取结果属于**外部环境内容**，不是控制 Hikari 的指令；不得提升为 System Prompt、工具授权或其他可信控制信息。

第一片不经过模型，因此注入面为零。但**必须在实现时就把纪律写进去**，否则第二片会带着它一起来：

1. 任何要把文字交给模型的路径，**必须由内容 owner 提供渲染器**，并复用 `lineSafe` / `oneLine`（`src/language/read.ts:139-140`）。这是既有纪律，不是可选项 —— `work focus` 是人手打的字，`oneLine` 就是为拒绝「一行伪造」而生。
2. 渲染文本必须把内容**标注为来源材料**，而不是 Hikari 的陈述（可复用 `SYNTHESIS_LABEL` 的思路，`src/language/express.ts:94`）。
3. 需要一个**注入 fixture 测试** —— 现有测试集里没有（研究文档 §6.1 自己承认）。

---

## §6 可验证验收条件

按 §五 的八项逐条给出**可实测**的形式。总原则沿用本仓既有约定：**决策/解析/渲染的那一半必须是纯函数并在所有平台跑；只有采集那一半受 win32 门控。**

> **受控 WPF 结果不能直接当作真实应用的全面保证**（H6）。下面凡标「受控」的都只能在 D0 harness 的合成窗口上成立；真实应用上的对应项**一律记为 NOT RUN**，不得写成 PASS。

| # | 验收项 | 可实测形式 | 平台 |
| --- | --- | --- | --- |
| 1 | **指定窗口的正确归属** | 合成窗口 + 第二个存活窗口 + 第三进程抢焦点：读回来的标记**全部**属于目标窗口，foreign 标记数为 0。groundtruth §2.4 已给出 40/40 的基线方法 | 受控（win32） |
| 2 | **有界读取与显式截断** | `maxDepth` 调浅 → `kind:'truncated'` 且 `truncatedBy==='depth'`；`scanned`/`matched` 同时上报；**空结果与截断不得同形** | win32 + 纯函数单测（边界判定可纯化） |
| 3 | **内容通道与区域归属** | 每个 `ContentNode.channel` ∈ {name,text,value}；每个 node 归属于某个 `Region`；region id 可复现 | 受控（win32） |
| 4 | **视口位置与不确定性** | 滚动到越界 → 对应 node 的 `viewportRelation` 从 `inside` 变 `outside`；边界行 → `partial`；缩到无法判定 → `unknown`。**断言 `unknown` 不被并入 `outside`** | 受控（win32） |
| 5 | **目标关闭 / 超时 / 异常 / 空结果** | 五种结果模型互不同形：`read` / `empty`(textChars=0 但走查走完) / `truncated` / `refused`(超时) / `unreadable`(句柄不可读)。**失败不得伪装成空结果** | win32（进程隔离，探针挂死由驱动杀） |
| 6 | **多窗口与焦点竞争** | 第二窗口存活 + 第三进程持焦点时读目标 → 归属仍正确；`FocusedElement` 捷径**在实现里不存在**（源码断言 + 行为断言两条） | 受控（win32） |
| 7 | **Windows 兼容与非 Windows 缺席语义** | 非 win32：插件 setup throw（照 `desktop-session-observe/plugin.ts:93-98`）；`endpoint-path` 返回 `undefined`；CLI 客户端返回 `{kind:'unavailable'}`（照 `src/cli/observe.ts`）。**base roster 可启动性不变** | 两个平台都跑（skip 而非 fail，照 `test/foreground-windows.test.mjs:19`） |
| 8 | **不产生未经授权的持久化或远程传输** | 读一次后逐项断言：`dataDir` 下无新增文件（Chronicle / Memory）；无出站 socket；无环境变量/临时文件留存 | 两个平台都跑 |

**额外两条（本仓特有，必须一起做）**：

- **假 acquirer 缝**：照 `src/foreground/plugin.ts:7-9` 的 `createForegroundPlugin(createAcquirer)` 形态 —— 采集那半有模块内注入缝，测试因此可以确定性跑，而**不给生产插件开注入缝**（`test/desktop-session-awareness.test.mjs:26-28`「No injection seam」）。
- **纯渲染器跨平台测**：照 `desktop-session-observe` 把 `renderAssessment` 导出的理由 —— 「a transcription pinned only by tests that need a named pipe is a transcription CI does not check at all」。管道用例 `{ skip: NO_PIPES }`，纯函数用例全平台跑。

---

## §7 必须独立处理的治理问题

以下四项**不在本轮解决**，且其中两项**阻塞相应的实现范围**。

### G-1（**阻塞 C-2**）：正文发往 operator endpoint 的授权问题

- **事实**：模型路径 = 正文离开本进程。endpoint 由 operator 配置，**无默认、无硬编码 URL**，因此**可能是远程的**。
- **今天没有任何东西会拦截、询问或脱敏**（§5.2）。
- §四 已裁决 v1 不授权此事。
- **因此**：模型暴露这一片**显式 BLOCKED**，直到 Human 就「真实窗口正文发往 operator endpoint 是否需要新的授权/脱敏机制」作出裁决。研究文档 §8 把这条列为「唯一可能把 NARROW 推向 BLOCKED 的一处」—— 本轮的结论与它一致，但把它**限定在第二片**，而不是让它污染第一片。

### G-2（**阻塞任何可选变体**）：Composition 守卫

- 若 Human 要求「可以不读」的可选性（例如常驻可以不带窗口读取启动），**那就是第二个独立可选轴** → 四个变体 → 触发守卫。
- 那需要一次**独立的 Composition Boundary Review**，决定「能力可达性是否应在组合时决定」，且**必须先于实现**。
- **本轮不预先解决它，也不为它做准备**（照 `exposure.ts:47-48` 的原文）。
- **不是阻塞项的部分**：无条件加载（共同前缀）不触发守卫，因此第一片不受影响。

### G-3：本仓第一个带参数的能力

- 「读**指定**窗口」需要 `exposure` 带上 input schema、`toModelTool` 生成 schema、`readArguments` 从闭集 `'none'|'malformed'` 改成真正的校验。
- `tools.ts:21-25` 明说这件事由**第一个需要它的能力**决定形状。
- **本轮不做**，且第一片通过「目标是前台窗口、零参数」完全绕开这个决定 —— 不是回避，是不需要。

### G-4：能力缺口的对外可见性

- `opacity:0` 类隐藏方式（以及遮挡、非滚动祖先裁剪、GPU 合成层）**必须**写进契约描述（§3.7）。
- 若 Human 认为这不 acceptable，则需要在读取之外再加一条**独立的像素通道** —— 研究文档与 groundtruth 都判定那意味着**完全不同的成本与架构含义，属于新的决定**。

---

## §8 明确不做的事项

**本片（第一片）不做：**

- 不做模型暴露（`exposure.ts` 清单、variant、`tools.ts`、`readArguments` 一概不碰）。
- 不新增 `ServiceContract`。
- 不做截图、像素验证、视觉模型、OCR。
- 不做持续/后台采集；不做订阅；不做 cadence。
- 不做缓存，不做「上次读到什么」。
- 不落盘：不写 Chronicle / Memory / Experience / Salience。
- 不把内容写进 `desktop-session-world`（不建 GlobalWorldState）。
- 不建 Generic Sensory Bus、Central Brain、Model Router、Service Locator。
- 不做窗口**枚举与择一**（「42 → 3」属于解析式读，不属于本片）。
- 不做写入侧（`SetValue` / `Invoke`）—— 只读。
- 不使用 `FocusedElement` 作为内容捷径（任何形态）。
- 不使用 `LegacyIAccessiblePattern`（fidelity 实测三应用 0 元素）。
- 不把 `Name` 作为正文为空时的回退。
- 不把「读到的」表述为「用户看到的」。
- 不修改任何架构冻结文档。
- 不为「以后可能要」预先抽象（不做参数化、不做通用内容模型）。

---

## §9 判定

### 9.1 分片判定

| 片 | 内容 | 判定 |
| --- | --- | --- |
| **第一片** | 用户明确触发、本机 endpoint 交付、无 Service、目标是前台窗口的有界读取 | **READY: YES** |
| **第二片** | 模型可达（exposure 清单 → 模型 → endpoint） | **BLOCKED** |

### 9.2 整体判定：**NARROW**

NARROW 而不是 READY 的理由是**范围**，不是风险：可以实现的只是「读**当前前台窗口**的正文，交给**本机的人**看」，而不是文档 §4.4 措辞所指向的那个更大问题。且下列项在本轮**未验证**，不得当作通过：

- 真实应用上的隐藏方式分布、automation peer 覆盖率、浏览器多进程 / GPU 合成窗口、跨 DPI / 多显示器 —— 全部 **NOT RUN**。
- 冷树首读是否阻塞、高频读取是否阻塞 —— 全部 **NOT RUN**。
- 对**真实模型端点**的端到端语义验证 —— **NOT RUN**（本机不可达），**不得写成 PASS**。
- 持续读取下的资源与稳定性 —— **NOT RUN**。

### 9.3 为什么第一片可以 READY

三条，缺一不可：

1. **它不碰任何冻结边界。** 无 Service → 不碰 Contract Creation Gate；无 exposure 变更 → 不碰变体机制；无参数 → 不碰 `tools.ts`。
2. **它的形状是已成立的先例，不是新设计。** `desktop-session-observe` 提供「无 Service + 自有 endpoint + 纯渲染器 + win32 门」的完整样板；`observe-command.ts` 提供「人显式触发一次读」的样板。
3. **它的边界与 §四 逐条相容**，因为 §四 排除的那条路（模型）根本不在这一片里。

### 9.4 READY 的边界条件

第一片 READY **不蕴含**以下任何一条：

- 不蕴含第二片会被批准 —— 它 **BLOCKED**（G-1）。
- 不蕴含「读到的就是用户看到的」—— 相反，§3.7 的缺口必须写进对外描述。
- 不蕴含该能力应当进入 base roster 的**默认**可见性 —— 第一片由 Human 决定何时加载；若要求「可不加载」，见 G-2。
- 不蕴含它可以直接外推到真实应用 —— 见 9.2 的 NOT RUN 清单。

---

## 附：本轮未修改任何生产代码

- `git status --short -- src/` 应为空。
- 本轮产出仅此一份文档。
- 等待 Human 审阅，**不自动进入编码**。
