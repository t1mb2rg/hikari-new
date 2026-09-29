# HIKARI OPERATOR TUI v0 + RESIDENT LAUNCH PROFILE v0 — IMPLEMENTATION BOUNDARY FREEZE

> **状态**：**DONE**。`HIKARI OPERATOR TUI v0 = DONE`；`RESIDENT LAUNCH PROFILE v0 = DONE`；`REAL WINDOWS TTY SMOKE = PASS`（Human 手工实测，见 §5.7）。
>
> 本轮冻结。**无 L3 trigger**，因此不修改 `core-architecture-v0.md` / `principles.md`，本文件即全部产物。
>
> **判据来源**：`docs/architecture/governance-rules-v1.md`（R1 权威层级 / R2 冻结语义 / R3 真实消费者重开 / R4 管辖扩张四问 / R5 升级阶梯 / R7 文档权威）。
>
> **本文的地位**：implementation boundary freeze，与 `human-surface-language-client-v0-implementation-boundary-freeze.md` 同级。**不是**权威来源本身，只有 R1 前两层才是。

---

## 1. 立项依据：这是一条 NOT-YET，被真实 consumer 解锁

### 1.1 被触碰的那条冻结

台账里逐字的一条（`docs/development/current-stage.md`「当前明确仍不做」）：

> 配置文件、环境 Profile、节点配置、用户配置中心——CLI 只有一个必填参数 `--data-dir`；

### 1.2 它的源与 R2 归类

按 R1，`current-stage.md` 是 **citation surface，不是法源**；它的规范力来自**转写自**哪里。追源结果：

| 出现处 | 文档层 | 效力 |
| --- | --- | --- |
| `docs/development/phase-2-cli.md`「不建立配置系统、配置文件搜索、环境 Profile、节点配置、用户配置中心。」 | development doc | R1：**不作为权威来源** |
| `docs/development/phase-4-resident.md`「❌ 配置文件 / 环境变量配置」 | development doc | 同上 |
| `docs/development/phase-4-resident-control.md` §14「其余各条（…配置文件…）全部仍然成立」 | development doc | 同上 |
| `docs/development/phase-2-cli-architecture-review.md` §15 | phase architecture review | R1：**历史证据，不作为权威来源** |

**在 R1 前两层检索结果：`principles.md` 与 `plugin-design-spec.md` 对「配置 / Profile」零命中；`core-architecture-v0.md` 唯一相关的一条是 `:65`「插件配置的基础验证」，不是对配置系统的禁止。**

按 **R2 第 3 条**（「MUST 只能来自 R1 的前两层，或 Runtime 已强制的 invariant。写在别处的规则**最高只能是 SHOULD**」），并结合其文本形态（「本阶段明确没有实现」——即还没有真实需求），该条归类为：

> **NOT-YET。主语是 CLI / Resident 的启动配置面。条件逐字是「没有真实实现问题」。**

### 1.3 真实 consumer

按 **R3**：NOT-YET 的类别下，**真实有界 consumer 是充分的**——「真实需求出现即条件消失」。

本轮的 consumer 是**一个具体的、有界的实现问题**：

> 操作者已经用一整串 flag 起过一次 `hikari resident`。他需要一个**本地控制台**，在常驻不在时能**按同一份配置**再起一次，而不必重新回忆并重打那串 flag。

### 1.4 同类先例（这条决定了它为什么是「排队等 consumer」而不是「被禁止」）

同一张台账里，**`~~hikari stop` / `hikari status` / `hikari log` 等运维命令~~` 本身就是被 P4-02.1 以同样方式解锁的**：`status` 与 `stop` 因「从另一个进程请求优雅停机」这个真实需求而落地，`log` 因没有真实需求**仍然不做**。而同一次收口**逐字把「配置文件」列在仍然成立的清单里**（`phase-4-resident-control.md` §14）。

也就是说：**这一条一直在等它的 consumer，本轮来的就是那个 consumer。**

### 1.5 解锁的**只有四个主语中的一个**，且只是它最窄的一种读法

原条列了四个主语。本轮**只**触碰第一个，且**只**在最窄的意义上：

| 主语 | 本轮 |
| --- | --- |
| **配置文件** | **解锁，且仅限「一个数据目录记住自己的启动参数」这一种** |
| 环境 Profile | **不解锁**。不引入环境切换、不引入 profile 栈 |
| 节点配置 | **不解锁** |
| 用户配置中心 | **不解锁**。**不引入任何用户级 / 全局配置位置**（见 §4.2） |

**没有解锁的东西必须逐条继续成立**，R7.3 要求发生过的裁决落纸，本节即该记录。

---

## 2. 组合 guard 为什么没有被触碰

`src/cli/resident.ts` 里有一段逐字 guard：

> This is deliberately **not a Profile system**, a capability registry, an optional-plugin mechanism or a conditional-composition framework, and **it should not become one**. It is the local implementation of one product need … and **a general facility built ahead of a second such need would be an architecture layer invented for a need that has not arrived.**

**它的主语是 `productionComposition()`——决定「这次常驻加载哪些插件」的那个函数。** 它禁止的是**组合机制**变成框架。

Resident Launch Profile 与它是**不同种类的东西**，理由是结构性的而不是措辞上的：

1. **组合函数零改动。** 本轮不修改 `productionComposition()`、不修改任何 roster、不修改 `CompositionMember`。
2. **没有新增条件词表。** profile 里没有「若 X 则加载 Y」这种表达；它存的是**上次给过的 flag 原值**。
3. **`options.ts` 仍然是合法性的唯一权威。** profile **不是**第二套合法性判断：半给的 pair（只给 endpoint 不给 model 等）装载时**照旧被 `options.ts` 拒绝**，profile 不补全、不推断、不给默认。
4. **profile 不是 resident 的配置来源。** `resident` **完全不读 profile**（§4.3）。

按 **R4 四问**，本轮**四条全否**：

| # | 问题 | 答 |
| --- | --- | --- |
| Q1 | 让 owner 回答一个今天不回答的**新问题**（新量 / 新单位 / 新轴）？ | **否**。TUI 报告的一切都来自 `renderStatus()` 已经产出的行 |
| Q2 | 在备选项之间**做选择**（排序 / 优先级 / 评分）？ | **否**。没有排序、没有「最要紧的」 |
| Q3 | 解释**上游刻意不封闭的词表**并升成全局语义？ | **否**。TUI 不解释任何词 |
| Q4 | 决定一件**人和 source 都没给出**的事（阈值 / 权重 / 策略）？ | **否**。profile 里的每个值都是操作者自己给过的 |

**四问全否 → capability growth。** 但本轮仍走 **L2**（不是 L1），因为另外两条 L2 trigger 成立：**给既有 contract 加 consumer**（§3）、**重开一条 NOT-YET**（§1）。

### 2.1 L3 trigger 逐条检查：全部不成立

| L3 判据（`governance-rules-v1.md` R5 / `CLAUDE.md`） | 本轮 |
| --- | --- |
| 触及 R2 的 MUST | **否**。见 §1.2，该条最高是 NOT-YET |
| Runtime public API | **否**。`src/runtime/` 零改动 |
| 新 communication plane | **否**。复用既有 control endpoint，不新增通道 |
| 跨 Runtime | **否** |
| 新全局状态中心 | **否**。无注册表、无 Service Locator、无中央路由 |
| 难撤回的 public contract | **否**。profile 是单写单读的本地文件，读写双方都在 `src/cli/`，无跨组件消费；见 §4.2 |

---

## 3. control endpoint：TUI 是它的 client，不是新的面

### 3.1 事实

`src/cli/control.ts` 头部逐字：

> This is not a transport layer and it is not shared infrastructure. **The only modules that import it are the Resident's own**: `resident.ts` (which hands it to the endpoint), `control-endpoint.ts` (the listening half), and `control-command.ts` (the asking half). No plugin imports it, no module routes through it, and **there is no registry behind it**.

已就位的、TUI 正好需要的东西：

| 元素 | 事实 |
| --- | --- |
| `requestControl(dataDir, request)` | **客户端一半已经存在**，`hikari status` / `hikari stop` 走的就是它 |
| `ControlRequest` | `'status' \| 'stop'`，**闭集**，无 payload、无 routing、无 plugin id |
| `ControlOutcome` | `answered` / `absent` / `unavailable`——**三态已经就是 TUI 要的三态** |
| `absent` 的语义 | ENOENT / ECONNREFUSED。原文：「**ENOENT is the one failure that is an answer rather than an error**: nothing is listening on this data directory's endpoint, which is precisely 'no resident is running'」 |
| `CONTROL_PROTOCOL_VERSION` | `1`，不匹配即拒绝，绝不猜 |
| `controlEndpointPath(dataDir)` | 由 dataDir **派生**而非发布。原文说明理由：派生的名字由操作系统回答「有没有常驻」，而发布式地址文件会**过期** |

**「常驻在不在」这个问题不需要 TUI 发明任何探测**：`requestControl` 返回 `absent` 就是答案，且这个答案不是缓存的观点。

### 3.2 需要显式更新的东西：importer 枚举

`control.ts` 头部**逐字枚举了它的 importer**（三个模块）。TUI 会成为**第四个**。

**边界要求**：TUI 属于「the Resident's own」（它在 `src/cli/`，属于 CLI 家族），**不越出该枚举的类别**；但**枚举本身必须就地更新**，否则注释开始说谎。这是本轮对 `control.ts` 的**唯一**改动计划——**只改注释，不改行为、不改协议、不加 request 词**。

### 3.3 不解析 status 的人类文本

`status()` 返回的是**已经渲染好的行**（`renderStatus()` 的输出），其注释逐字：

> a status line is a report of what is already known, not a health check, and **this function has no way to learn anything the Runtime does not already have**.

**本轮的硬边界**：

> **TUI v0 原样显示这些行。不解析它们、不为它们建结构、不从它们派生任何量。**

理由：把人类文本解析成结构化真源，就是在一个**没有 promise 过结构的载体**上建立 promise。真需要结构化 inspection 时，正确做法是**单独推动一次 contract evolution**（给 protocol 加一个词或加一个结构化应答），而不是让 TUI 变成那个协议的**事实上的定义者**。

这条也解释了为什么 TUI **不能**复述 `Runtime.getPluginState` / `getPluginError`：

> **TUI 是独立进程，够不着运行中常驻的那个 Runtime 实例。** 那两个方法是**同进程内**的 API。把它们写成 TUI 的数据来源，等于假装存在一个跨进程的 Runtime 读取权——那个东西不存在，且本轮不建立。

---

## 4. Resident Launch Profile v0

### 4.1 形状

profile 是 `<data-dir>/launch.json`，内容**就是 `ResidentOptions` 去掉 `dataDir`**：

```jsonc
{
  "desktopAwarenessDelayMs": 1000,
  "model": { "endpoint": "http://…", "model": "…", "credentialEnv": "ENV_NAME" },
  "repositoryCi": { "rootDir": "…", "repository": "owner/name" },
  "proactiveCiDelayMs": 60000,
  "proactiveReturn": { "delayMs": 1000, "afterMs": 20000 }
}
```

**缺失的键 = 该 flag 缺席**，与命令行上没给这个 flag 完全等价。

这条必须写死，因为 `options.ts` 里有**两个 `undefined` 是有意义的**，不能被 JSON 的空值抹平：

- `ModelOptions.credentialEnv: string | undefined`——`undefined` 是「不带凭据」，不是「空名字」；
- `ModelOptions.reasoningEffort: string | undefined`——`undefined` 是「请求里没有这个字段」，其原文说明这正是该 flag 承载的全部差别。

**`credentialEnv` 是变量名，永远不是凭据本身。** 这一点不是本轮的设计，是既有设计：`ModelOptions` 的注释逐字说，正是因为只带名字，「this shape can be printed, logged or **shown in a status line**」。**因此 profile 可以安全地存它、也可以安全地被 TUI 显示。**

### 4.2 profile 住在数据目录里，**不引入用户级配置位置**

这是本轮**最重要的一个收窄**，必须写明理由。

一个数据目录**就是**一个 Hikari 的身份（`continuity/origin.json`）。控制端点名由 dataDir 派生；`resident.ts` 逐字：一个数据目录**只拥有一个端点**，第二个监听者拿到 `EADDRINUSE`，而这被当作「这里已经有一个常驻」的答案。

所以：

> **profile 属于它所描述的那个数据目录，因此住在那个数据目录里。**

**没有**：`%APPDATA%` 下的用户级 profile、配置文件搜索路径、`HIKARI_DATA_DIR` 之类的环境变量、最近使用列表、多数据目录注册表。以上任何一项都会把「配置文件」这条 NOT-YET **连带解锁成「用户配置中心」**，而那一条本轮**没有**解锁（§1.5）。

**直接后果（必须同时接受）**：`--data-dir` **仍然是必填的，没有默认值。**

这**不是**偷懒，是**同一个纪律的延续**。`options.ts` 对每个值给的理由都是同一条：

> none of them has a default: a resident that chose its own cadence would be deciding how often Hikari looks at the desktop, and one that chose its own repository scope would be deciding what Hikari looks at.

一个**替操作者选数据目录**的入口，就是**在替操作者决定他在跟哪一个 Hikari 说话**——与「a default model would be this file choosing to send a human's words somewhere nobody named」是同一类错误。

### 4.3 `resident` 不读 profile

> **profile 的唯一读者是 TUI。`resident.ts` 与 `options.ts` 的配置语义本轮零改动。**

TUI 把 profile **翻译成一条显式的 `hikari resident` 命令行**，然后按那条命令行启动。由此得到本轮**最强的一条不变量**，它可测：

> **TUI 能执行的每一次启动，都必须能写成一条既有的 `hikari resident` 命令行。**

这条同时保证了三件事：组合函数没被绕过；`options.ts` 仍是唯一权威；profile 没有变成 resident 的第二条配置来源。

### 4.4 profile 的写入

由操作者**显式**完成，与 resident 启动是分开的两件事（沿用 `--proactive-return-after-ms` 的既有纪律：「Speaking first is a separate act by the person who runs this, made in the same place they made every other decision about this resident」）：

```text
hikari profile set   --data-dir <path> [与 hikari resident 相同的 flag 面]
hikari profile show  --data-dir <path>
hikari profile clear --data-dir <path>
```

`profile set` 的 flag 面**就是 resident 的 flag 面**，**走同一个 reader**，因此非法组合在这里被**同一段代码**以**同一句话**拒绝。profile 里**不可能**存下一个 `hikari resident` 会拒绝的配置。

---

## 5. Operator TUI v0

### 5.1 目标形状

```text
hikari                      → 打开 TUI
hikari --data-dir <path>    → 打开 TUI，直接进入该数据目录

TUI 已发现常驻（requestControl → answered）
  → 原样显示 status 行
  → Stop 走 requestControl(dataDir, 'stop')

TUI 未发现常驻（requestControl → absent）
  → 有 profile：按 profile 译成的命令行 detached 启动 hikari resident
  → 无 profile：说明需要先 hikari profile set，并原样给出该命令行
  → 启动后通过 control endpoint 观察启动过程
```

### 5.2 生命周期：TUI 不是 owner

> **TUI 不是 Resident 的生命周期 owner。退出 TUI 不停常驻。**

这条有已写死的依据，`src/cli/control-endpoint.ts` 头部逐字：

> It is deliberately not a handle. `unref()` is called on the listener and on every accepted socket so that an open endpoint is never a reason for the process to stay alive: **the resident decides how long it lives, through its own lease**, and a control channel that quietly took that decision over would **make the lease a decoration**.

TUI 若持有子进程、在其退出时连带终止它，就是**让 lease 变成装饰**。

**实现要求**：detached 启动 + `unref()`，**不持有 stdout / stderr 管道**。持有管道本身就是一种生命周期耦合——TUI 退出会关掉读端，子进程随后的写入拿到 `EPIPE`。

**由此产生一个必须在实现期实测的问题**（本节显式登记，不留白）：detached 启动的子进程，bring-up 失败时操作者还能不能看见原因。本轮的「不要做」清单里**有 log subsystem**，因此**不能**用「重定向到日志文件」来回答这个问题。

#### 5.2.1 实测结论（2026-09-29，真实 Windows）

实测方法：用**已发布的** `spawnDetached` + `launchArguments` 起一个**从未 `init` 过**的数据目录，按操作台自己的节奏轮询 `requestControl(dataDir, 'status')`；再在终端里前台运行同一条命令作为对照。

| 观测 | 结果 |
| --- | --- |
| 轮询 6 秒（12 次） | **全部 `absent`**，端点一次都没应答 |
| 前台运行同一条命令 | exit 1，失败文本在 **stderr** |
| 成功路径（已 `init` 的数据目录） | 首次轮询即 `answered`，`outcome: ok`，九个插件全 `active`；`stop` 走同一通道生效，随后回到 `absent` |
| **启动器退出之后**，另一个进程 3 秒后询问 | `answered`，同样九行全 `active` |

最后一行是本轮 §5.2 那句「TUI 不是 Resident 的生命周期 owner」的**直接测量**，不是推论：起常驻的那个进程 `exit 0` 死掉之后，另一个进程仍然问得到它。`detached` + `unref()` + `stdio: 'ignore'` 三者合起来确实做到了「把它交出去就不再持有」。

**两处对原文的更正：**

1. 失败文本走的是 **stderr**，不是 stdout。`renderNotReady` 的产物由 `main.ts` 经 `commandFailure` 交给 stderr。前提记错了，结论不变：那段文本在 detached 启动下**没有任何地方可去**。
2. 失败时端点**从未 arm**。因此操作台的轮询只会看到 `absent`，而**不是**「看到一个报告失败的常驻」。这意味着 §5.3 的「原样显示 status 行」在失败路径上**拿不到任何行**。

**由此做出的设计决定（落在 `console.ts`）：**

> **不引入超时阈值，也不读任何文件去替常驻解释失败。** 「已发出、在等应答」这个状态**从发出那一刻起**就在屏幕上说明：操作台看不到常驻的输出，因为常驻不是它持有的进程；要看到原因，请在终端里直接运行**它已经渲染出来的那条等价命令**。

这条同时满足三件事：不用阈值（R4 Q4 不成立）；不建 log subsystem；不成为 `init` 的第二个校验者。指路用的命令**不是新造的**，就是 §4.3 那条不变量已经要求渲染的同一条命令行。

**未做的测量（保持诚实）**：探针里那条「detached 子进程的 fd 1 是不是终端」的见证**无效**——`spawnDetached` 总会把 `main.js` 前缀进去，所以那次 `--eval` 根本没执行到，见证文件从未产生。因此「`stdio: 'ignore'` 让子进程拿到 NUL 设备」这句是**按构造成立**，不是实测结论，本文件不把它记成实测。

### 5.3 显示纪律

- **status 行原样显示**（§3.3）。**包括上色在内**：装饰只能加在这些行的外面（上下加分隔线），不能进到行里面——不缩进、不上色、不重排（§5.8）。
- **TUI 不解析、不排序、不摘要、不判断「健康」**。`status` 的注释已经说了它不是 health check，TUI 不得把它**变成一个**。
- **唯一允许随状态变化的颜色，只能取自协议的 `outcome` 字段。** `ControlOutcome` 是控制协议定义的字段，常驻自己声明 `ok` / `failed`；而 status 行是**为人写的句子**，不承诺结构。按行内容上色（某行含 `failed` 就标红）就是 §3.3 禁止的那种解析，而且它会比「不纯」更糟：常驻**改一次措辞**，颜色就静默变错。落到实现是 `residentTone`，见 §5.8。
- **TUI 不显示 transcript、不提供 ask**。那是 Human Surface 的事；`hikari ask` 继续照旧存在。见 §5.4。

### 5.4 与 Human Surface 的分工

| | 谁 | 管什么 |
| --- | --- | --- |
| **Human Surface** | 人和 Hikari 说话的地方 | transcript / ask / proactive message |
| **Operator TUI** | 操作者看部件活没活 | 常驻在不在、status 行、启动、停止 |
| `hikari ask` | 既有的单句入口 | 不变 |

这条分工**不是新划的**，是 CLI 已经在做的那条线：`status` / `stop` 属运维，`ask` 属业务。TUI 只是把运维那半**做得能一直看着**。

**一旦 TUI 开始显示 transcript 或提供 ask，它就变成第二个 human surface**——那不是本轮的东西。

### 5.5 零运行时依赖

本仓库 `package.json` **没有 `dependencies` 字段**。TUI **手写**（raw mode + ANSI + alternate screen buffer），**不引入 ink / blessed / 任何第一个运行时依赖**。

### 5.6 已知限制（写下来，而不是留着不说）

**一、终端那一半没有自动化覆盖。** 实现所在的会话是**后台会话，没有 TTY**，所以 `test/console.test.mjs` 永远够不到这些：

- raw mode 的进入与退出、备用屏缓冲区的进入与退出；
- `process.stdin.on('data')` 在真实终端下的**分块行为**（一次按键是一个 chunk，还是会被切开）。

自动化**真正执行**的是被刻意抽成纯函数的那些部分：`renderConsole`（渲染纪律，§5.3）、`renderFrame`（帧擦除）、`residentTone`（上色依据，§5.8）、`appendTyped`（输入规则）、`readAskingChunk`（粘贴/提交）、`watchingAction`（按键语义表），以及启动路径的端到端（起真进程 → 走真命名管道 → 真停止）。

**终端控制这一半由 Human 在真实 Windows TTY 上手工实测覆盖（§5.7），不是由测试覆盖。** 这条区别不要在以后被读成「测试已经覆盖了终端」——它是**人工证据**，不是回归保护，将来改 `draw()` 或 `onKey` 时它不会自动挡住回归。

**二、方向键与 ESC 的分包。** 单独到达的 `\x1b` 被当作退出，且**没有引入 escape 超时**去区分「操作者按了 Esc」和「方向键序列被拆成了两段」。真实终端把 `\x1b[A` 作为一次写入送出，所以正常情况不会触发；若某个终端把它拆开，按方向键会关掉操作台。

这条被接受而**不是被忽略**，理由是它的后果是良性的，而且良性得**恰好因为 §5.2 成立**：退出操作台不停止常驻（已实测），所以最坏结果是操作者重新打开一次 TUI，而不是弄丢一个正在跑的 Hikari。引入超时等于为了一个良性后果，在这个文件里放进第一个计时器。

**三、bracketed paste 没有被实现。** 本程序**从不开启** bracketed paste（`\x1b[?2004h`），因此终端通常不会送出 `\x1b[200~…\x1b[201~`。但如果它已经被上一个程序开着而终端没有复位，粘贴会以一个 `\x1b` 开头的 chunk 到达，被当作转义序列整段丢弃——粘贴表现为「什么都没发生」。

这条同样被接受而**不是被忽略**：正确的修法是真的实现 bracketed paste mode（自己开启它 + 解析两个标记 + 处理 `\x1b` 转义），那是**终端协议**的工作量，而它要挡的后果是「粘贴无效、请改用键入」。一个**边界清楚、可以用打字绕过**的限制，不值得在这个 slice 里引入一个转义序列解析器。

**四、已被修掉、但值得记住的那条。** 复审发现 `draw()` 每行只清到**行尾**（`\x1b[K`），从不清到**屏尾**。帧长是变的（status 块随应答出现/消失），所以**停止常驻后，旧常驻的 status 行会留在「没有运行。」下面**，且每 2 秒重绘同样的短帧、永不自愈——把上一状态当作当前状态显示，正是 §5.3 要禁止的事。

已修（帧尾加 `\x1b[J`），并抽出纯函数 `renderFrame` 让「这一帧擦掉了上一帧留下的内容」成为**可测**的断言（`test/console.test.mjs` 里有一条专门断言「停止后的帧确实更短」+「以 `\x1b[J` 结尾」）。**记在这里是因为它说明了一件事**：把渲染抽成 `renderConsole` 让「行内容对不对」可测，但**没有**让「行写出去之后屏幕上剩下什么」可测，两者之间隔着一层真正属于终端的东西。

**五、窗口缩放只在会轮询的那一屏自愈（2026-09-29 复审新增，登记而非修复）。** 渲染从 §5.8 起依赖 `process.stdout.columns`，而**全仓库没有任何 `process.stdout.on('resize')`**——重绘只由按键（asking 屏）或 2 秒轮询（watching 屏）触发。所以在 asking 屏上把窗口从 80 列拉到 40 列，**没有按键就不会重绘**：会重排的终端把旧行挤乱、下面内容整体错位，不重排的终端则是分隔线被截断，直到操作员敲下一个键才恢复。watching 屏没有这个问题，因为轮询每 2 秒无条件重画。

这条被接受而**不是被忽略**，理由与第二条同型：后果良性且**边界清楚、一次按键就能绕过**，而修法要在 `draw()` 的生命周期里挂一个事件监听（POSIX 上 `'resize'` 可靠，Windows 上不发事件时还得给 asking 屏退化成低频计时器）并在 `finish` 里摘掉——那是这个文件里的第一个事件源，为的是一屏只活到操作员输入为止的画面。**它不是「已验证不受影响」，是「知道会发生、判定不值得现在挡」。** 将来若真有人在 asking 屏上缩放，修法就是上面那一句。

### 5.7 真实 Windows TTY smoke（2026-09-29，Human 手工执行）

**执行者：Human。** 不在 Claude Code 会话内、不在测试内、不经过任何自动化驱动——就是在一个真的 Windows 终端里把 `hikari` 跑起来用。这是本轮**唯一**一次终端控制路径的真实运行。

| # | 项目 | 结论 |
| --- | --- | --- |
| 1 | `hikari` 无参数进入 TUI | PASS |
| 2 | data-dir 输入正常 | PASS |
| 3 | Start 正常 | PASS |
| 4 | Resident detached 启动 | PASS |
| 5 | 所有预期 Plugin 状态正常出现 | PASS |
| 6 | **Stop 后旧状态块完全清除，无残影** | PASS |
| 7 | Restart 正常 | PASS |
| 8 | Quit 后终端 raw mode / 光标 / 回显全部恢复 | PASS |
| 9 | **退出 TUI 后 Resident 仍在运行** | PASS |

**这份 smoke 直接验证了两条承重claim**：

- **第 6 项验证了 §5.6 第四条（HIGH 修复）在真实终端上成立。** 那一处是复审发现的：`draw()` 原本只清到行尾，停止常驻后旧 status 块会留在「没有运行。」下面且永不自愈。加了帧尾 `\x1b[J` 之后，真实终端上确认「无残影」。**这是本轮唯一一个只有真实终端能证伪的缺陷**，也因此它证明了 smoke 不是走过场。
- **第 9 项验证了 §5.2 的核心边界在真实使用中成立。** 退出操作台不停止常驻——这正是「TUI 不是 Resident 生命周期 owner」那句话的端到端形态。此前只有用 launcher 脚本做的替代测量（启动器退出 3 秒后另一进程仍拿到 `answered`），现在有了真实 TUI 退出后的观察。

**同时它也覆盖了 §5.6 第一条列出的、测试够不到的那一半**：raw mode 进出（第 8 项）、备用屏进出（第 6 项）、真实 `stdin` 分块下的按键处理（第 1、2、3、7 项）。

**它没有覆盖的**（不要从上面九项读出来）：§5.6 第二条（方向键被拆包）与第三条（bracketed paste）在这九项里都没有被触发，所以**仍然只是已登记的限制，不是已验证的行为**。

### 5.8 呈现层（2026-09-29，DONE 之后的一次改动）

来源：Human 提出两点——「TUI 更美观一点」与「不用自己输入地址」。**两点各自独立裁决，结论不同。**

**一、地址输入：不改 Hikari。** Human 裁决用 **shell 包装**（自己的 alias / 包装脚本传 `--data-dir`）。

这不是搁置，是**边界**。TUI 的「没有默认目录、没有搜索路径、没有记住的上一次」是 §4.2 那条裁决的直接后果；在 TUI 里补一个默认目录或记忆位置，等于把「用户级配置中心」从后门放回来，而 §4.2 的拒绝**不是一条能被真实 consumer 解除的 NOT-YET**。因此本 slice **零改动**，痛点由 Hikari 之外解决。

**二、美观：做了。** 约束是 §5.5（零依赖，手写 ANSI）与 §5.3（status 行原样），在这两条之内加：加粗标题 / 变暗的数据目录与标签 / 分隔线 / 反显的按键条 / 状态点。

**配色红线由 Human 裁决：允许用协议的 `outcome` 字段上色。** 落成 `residentTone(view): 'ok' | 'failed' | 'idle' | 'broken' | 'pending'`——**只看 `ControlOutcome`、`launching`、`polled`**，不看 `answer.lines` 的任何一个字。这条纪律有测试，而且是**在屏幕上**测的：同一 outcome 下、行内容逐字不同的两个 view，那一行的 SGR 前缀必须相同。

**这句话在第一版里是不成立的，写在这里因为它比结论更值得记。** 第一版只钉了 `residentTone` 的**返回值**，没有钉返回值和屏幕之间那张映射表。后果是：把 `ok`/`failed` 的颜色对调，让每一个健康的常驻都用失败色显示，**全套测试仍然全绿**；把那一行的颜色整个去掉，也全绿。复审者做了这件事，然后是复现的变异测试确认了它（现在 `ok↔failed` 对调、整行不上色两处变异都被抓住）。教训不是「多写测试」，是**断言要落在承重的那一层**——说「颜色只看 outcome」而只测返回值，测的是决定，不是屏幕上那个决定的结果。

**实现面**：

| 变更 | 说明 |
| --- | --- |
| `residentTone` / `ResidentTone` | 新增导出。上色的唯一依据 |
| `ConsoleRenderOptions` | 新增导出。`{ columns, color }` |
| `renderConsole` / `renderFrame` | 追加**带默认值**的第三参数。既有调用点不改 |
| `draw()` | 每帧读一次 `process.stdout.columns`（窗口可被缩放）与 `NO_COLOR` |
| status 块 | 上下加分隔线。**行本身零改动**：不缩进、不上色 |
| 状态点 | `●` 运行中 / `○` 没有 / `◌` 还没答案 / `?` 看不见。**`unavailable` 故意不给实心点**——那是控制通道不应答，不是「有东西在跑」的证据，实心点等于替它断言（无命名管道的平台上它还是常态而不是例外） |
| 外部来的文本过 `oneLine` | 数据目录 / notice / profile 读失败原因 / 控制通道 detail / profile 里的命令行。**理由见下** |

**三、视觉这一半归 Human。** 写这个改动的会话**没有 TTY**，所以**作者从未看到过实际渲染结果**。自动化能证的是三件事：颜色只是加在文字外面的转义（关掉颜色后屏上的字一个不差）、每行都在 `\x1b[K` 之前把颜色收好（否则擦行会拿那行的颜色当底色）、语气只由 `outcome` 决定。**它证不了「好看」**——那需要一双眼睛。

**四、分隔线依赖一个宽度假设。** 分隔线是 `─`（U+2500，East Asian Width = **Ambiguous**）重复 `columns` 次。**若终端把 ambiguous 字符按双宽渲染**，这一行会折行，整帧错位。

这是本改动**唯一**一处「长度是硬约束而不是偏好」的地方（其它行折行只是难看，这一行折行会让下面的内容整体移位）。在这台机器面向的平台上**没有观察到**这个问题（box drawing 渲染为窄），但**本会话无法验证**。

风险是可接受的，理由是**失败响亮且修复是一行**：真折行了，Human 一眼就能看到，把 `RULE_CHAR` 换成 ASCII（`-`）即可，不需要改结构。因此这条是**已登记的未验证假设**，不是已验证的行为。

**五、复审之后的修补（7 条发现，6 条已改）。** 呈现层做完之后跑了一轮对抗性复审。逐条重新锚定到源码与可执行行为之后，改掉的是：`broken` 的实心点（见上表）、空状态块的两条分隔线、分隔线的 20 格下限、`NO_COLOR=` 空值语义、以及下面这条 `oneLine`。**没有改、只登记的是 §5.6 第五条（asking 屏不随窗口缩放重绘）。**

**`oneLine` 这条值得单独说，因为它不是「多加一层防御」，而是补上了一个和 §5.6 第四条同类的缺口。** `renderFrame` 给**每个数组元素**追加 `\x1b[K`，所以「一个元素就是一行」是这个帧契约的一部分；一个含换行的元素会变成两行，而**只有第二行会被擦除**——第一行右边的旧内容永远不会被清掉，正是帧尾 `\x1b[J` 要解决的那种残影，从另一扇门进来。

而含换行的元素是**够得着的**：`--data-dir` 只检查空不空（`options.ts` 里是 `value.trim()`，没有控制字符过滤），`view.notice` 可能带上 profile 的解析原因或控制通道自己的 detail。所以数据目录、notice、profile 路径、profile 里的命令行都在渲染处过 `oneLine`。

**两条边界要写清楚**：（1）`oneLine` 加在**值**上而不是整行上，因为整行已经含这个文件自己的 SGR 转义，`oneLine` 会把它们写成可见文本；（2）**resident 的 status 行刻意不过它**——§5.3 说那些行原样带过，且 resident 在自己那一侧已经转义，再转一次就是本文件编辑它被要求原样传的文本。

---

## 6. 明确不做

按用户裁决逐条列出，本轮**一条都不做**：

- Plugin manager
- 单独启停某个 Plugin
- Runtime service locator
- structured health system
- log subsystem
- node discovery
- distributed orchestrator
- chat
- Human Surface 功能
- multi-resident manager
- generic profile framework
- 用户级配置位置 / 配置搜索路径 / 环境变量选目录（§4.2）
- 结构化 control inspection（留待单独 contract evolution，§3.3）
- 非 Windows 支持（control endpoint 本身 `controlEndpointPath` 在非 win32 返回 `undefined`）

---

## 7. Boundary check

| 检查 | 结论 |
| --- | --- |
| 越过冻结架构边界 | **否**。触碰的是一条 NOT-YET，且只解锁其四个主语中的一个 |
| 需要冻结难撤回的 public contract | **否**。profile 单写单读、本地、无跨组件消费 |
| 新增 Runtime public API | **否**。`src/runtime/` 零改动 |
| 新增 communication plane | **否**。复用既有 control endpoint |
| 被 `resident.ts` 组合 guard 覆盖 | **否**，且理由见 §2（组合函数零改动 + 无新条件词表 + `options.ts` 仍是唯一权威） |
| 让 Runtime 开始理解业务 | **否**。Runtime 完全不在本轮改动范围内 |
| `src/` 是否新增依赖 | **否**。零运行时依赖 |

**结论：L2。无 L3 trigger。按用户裁决，完成本冻结后直接实现。**

---

## 8. 交付记录

```text
HIKARI OPERATOR TUI v0       = DONE
RESIDENT LAUNCH PROFILE v0   = DONE
REAL WINDOWS TTY SMOKE       = PASS   (Human 手工实测，§5.7)
```

**测试**：全量 698 条，694 通过，0 失败，4 跳过。跳过的四条全部既有且与本轮无关——3 条需要真实模型端点（本机没有，**不算 PASS**），1 条 POSIX SIGTERM（本机是 win32）。本轮新增 45 条：`test/launch-profile.test.mjs` 25 条、`test/console.test.mjs` 20 条。

**交付面**：

| 文件 | 性质 |
| --- | --- |
| `src/cli/console.ts` | 新增。操作台：raw mode / 备用屏 / 重绘循环 / 一次 detached spawn |
| `src/cli/launch-profile.ts` | 新增。Launch Profile 编解码 + `launchArguments` |
| `src/cli/profile-command.ts` | 新增。`profile set` / `show` / `clear` |
| `src/cli/options.ts` | 改。`ConsoleOptions` / `readProfileCommand` / `readConsoleCommand` + union + USAGE |
| `src/cli/main.ts` | 改。四个新命令的 dispatch |
| `src/cli/control.ts` | 改。**仅注释**：importer 枚举加入 `console.ts`。协议、请求词、行为零改动 |
| `test/console.test.mjs` / `test/launch-profile.test.mjs` | 新增 |
| 本文件 | 新增 |

**未触碰**：`src/runtime/**`、`src/cli/resident.ts`、`package.json`（`dependencies` 仍为空）。

**复审留痕（供后来者）**：对抗性复审发现一条 HIGH（`draw()` 不清屏尾，停止常驻后旧 status 块残留且不自愈），已修并抽出 `renderFrame` 使其可测，真实终端已确认（§5.7 第 6 项）。另有两条限制**有意不修**并登记在 §5.6：ESC 分包、bracketed paste。**这两条至今未被任何一次运行触发过**，将来若有人要修，先读 §5.6 里给出的「为什么当时判定不值得」。

---

### 8.1 呈现层改动（2026-09-29）

**变更面**：`src/cli/console.ts`（呈现层：SGR 常量、`residentTone`、`ConsoleRenderOptions`、`renderConsole` / `renderFrame` 的第三个参数、`draw()`、外部文本过 `oneLine`）、`test/console.test.mjs`（本轮 +10 条）、本文件（§5.3 加一条、§5.6 新增第四/第五条、新增 §5.8、本条）。

**测试**：全量 **708** 条，**704 通过，0 失败，4 跳过**。跳过的四条全部既有且与本轮无关（3 条需要真实模型端点，本机没有，**不算 PASS**；1 条 POSIX SIGTERM，本机是 win32）。`test/console.test.mjs` 自身从 20 条变成 30 条。

本轮新增的 10 条，按它们各自承重的东西分三组：

- **呈现层第一次落地**（6 条）：`renderConsole` / `renderFrame` 的既有断言按新布局更新；加「颜色只看 outcome」「五种语气」「颜色是纯附加」「状态块逐字节原样」「每行颜色都收好」「分隔线宽度」。
- **对抗性复审之后补的**（4 条）：「哪一种结局配哪一种颜色，钉在屏幕上」（§5.8 二记录的那个假绿）、「看不见的常驻不画实心点」、「一个空的状态块不画成两条紧挨着的分隔线」、「带换行的数据目录不会把一帧里的一行劈成两行」。
- 「分隔线宽度」那条在复审后**改写过断言**：它原本把 20 格下限钉死，正是复审指出的那个缺陷本身。

**这 10 条不是全部都被证明「会咬」——7 条被。** 复审指出「颜色这条纪律只测了返回值」之后，做了一轮变异测试：在构建产物上手工改 7 处（`ok↔failed` 颜色对调、常驻那行整行不上色、`broken` 换回实心点、空状态块照样画框、分隔线回到 20 格下限、数据目录不过 `oneLine`、notice 不过 `oneLine`），**7 处全部被测试抓住**。这条记录在这里，是因为**「有测试」和「测试会咬」是两件不同的事**，而这一轮恰好出现过一个只有前者成立的例子。

其中「状态块逐字节原样」是**先写成一次性 probe 跑通、再升格为测试**的：`frame.includes(line)` 挡不住「在两条状态行之间插了东西」或「两行换了顺序」，切成切片整块比对才行。

**未触碰**：`src/runtime/**`、`src/cli/resident.ts`、`src/cli/control.ts`（协议零改动）、`src/cli/options.ts`、`package.json`（`dependencies` 仍为空，§5.5 成立）。`src/terminal-text/index.ts` 是**只读引用**（`oneLine`），未改动。

**状态**：

```text
HIKARI OPERATOR TUI v0       = DONE
RESIDENT LAUNCH PROFILE v0   = DONE
REAL WINDOWS TTY SMOKE       = PASS   (§5.7，针对 §5.7 当时的呈现层)
呈现层改动 VISUAL SMOKE      = NOT RUN  ← 需要 Human 目视，见 §5.8 第三点
```

**注意最后一行**：§5.7 的 PASS 是**针对改动前的那一版画面**。呈现层改动之后，终端上长什么样**没有被任何人看过**。自动化覆盖了它能覆盖的三条（见 §5.8 第三点），但「好看」不在其中。
