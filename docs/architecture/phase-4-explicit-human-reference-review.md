# Hikari 第四阶段 P4-03 Explicit Human Reference Frame Boundary Review

> 结论：**EXPLICIT HUMAN REFERENCE VERDICT: BLOCKED**
>
> 范围：**只做 Boundary Review。本轮不实现、不新增 contract、不开始下一 slice。** 审查题目是——如何让一个窄而真实的 explicit human reference 合法进入一个 domain-local judgement。
>
> **范围界定（须与结论同时阅读）**：本文**不是**一次落地记录，也**不授权**任何实现。它固定的是一组「当前实现事实」与一条 blocker。本文**没有**创建、也**没有**授权创建：`explicit-human-reference` Service、relevance Service、`HumanStatement`、Generic Human Input、Resident flag、CLI command、fake consumer。上列每一项都仍然不在当前已批准范围内。
>
> **traceability 作用**：`docs/development/current-stage.md:737` 与 `docs/development/phase-4-git-repository-perception.md:23-31` 都以「P4-03 的 Explicit Declaration / Reference Frame 研究已经实际推进」作为立项依据，而仓库内此前**没有**对应正式 artifact。本文补齐该依据。**它不新增任何产品能力**，只把此前只存在于对话历史中的结论固化为可引用产物。
>
> 上位原则：`core-architecture-v0.md:391-404`（§11 明确禁止重新引入的结构）、`core-architecture-v0.md:283-287`（§6.6「不建立中央 Judgement Domain。判断是自治插件内部的局部活动」）、`principles.md:445-473`（§14 Perception ≠ Awareness）、`plugin-design-spec.md:519-569`（§16 Contract Creation Gate，含 §16.1 / §16.2）、`plugin-design-spec.md:52-79`（§2.1 public 的判据）。本轮**没有新增第二套架构原则**。

---

## 1. 本轮审查目标

只有一个问题：

> 找到 Hikari 第一次能够诚实回答「这件事与我现在明确在做的事情有关吗？」所需的最小 human reference。

围绕它拆成十一节：概念压窄、consumer-first、reference 是否需要独立 public contract、human ingress、occurrence 与 current state、replacement 语义、multiplicity、provenance、模型边界、与 Repository CI Awareness 的关系，以及十二个必答问题。

**本轮不落地。** 结论为 BLOCKED，理由见 §13。

---

## 2. 证据基础与锚定纪律

本文的每条结论都锚定到当前工作树的真实源码或真实文档，不引用设计意图的转述。作为结论地基的四条事实**由主 Agent 亲自复验**，不是子 Agent 报告的转述：

1. `src/` 全量检索 `process.env` / `process.stdin` / `readline` / `process.on(` —— 只有 `src/cli/resident.ts:413-414` 的 SIGINT/SIGTERM；
2. `src/cli/control.ts:164` 强制请求封套键数**恰好为 2**，`control.ts:117` 强制 `request` 只能是 `'status'` / `'stop'`；
3. `src/cli/resident.ts:106-108` 明写组合是「Exactly seven plugins, and nothing else.」，`git-repository` 与 `github-ci` **不在其中**；
4. `src/` 全量检索 `relevance` / `relevant` / `unrelated` —— **零命中**；全仓检索 `Explicit Declaration|Reference Frame` 只命中 3 个 `docs/development/*.md`，且均为**引用**。

第 4 条是本文 traceability 作用的直接依据。

---

## 3. occurrence / current reference / interpretation 三件事必须分开

以一句具体的话为准：「用户明确说：我现在正在推进 hikari-new P4-03。」

| | 是什么 | 今天 Hikari 能不能持有 |
| --- | --- | --- |
| **occurrence** | 「用户在 T1 说过这句话」 | **不能**（见 §4） |
| **current reference** | 「这句话现在仍被用作当前 judgement 的参照」 | 能，但**只能作为「本次组合被给定了某个名字」**（见 §6） |
| **interpretation** | 「P4-03 / hikari-new 对当前 observation 意味着什么」 | 部分能（名字），部分**根本不能** |

三者的不对称是本文全部结论的地基。

**关于 interpretation 有一个具体、可验证的残缺**：「P4-03」不对应任何 Perception 读得到的字段——它只存在于 `docs/development/current-stage.md`。因此对上述例句，任何诚实实现都只能对上「hikari-new」而对不上「P4-03」，即**对不上说话人真正在意的后半句**。

**这条残缺必须在命名里体现**：否则就是把「名字对上了」冒充成「事情对上了」，而那正是本文要用 §16 挡住的失败模式。

---

## 4. 当前没有 runtime human ingress

**在当前没有 runtime human ingress 的架构下，Hikari 无法拥有 human declaration occurrence。**

> **措辞限制**：这不是「human occurrence 永远不属于 Hikari」，也不是「occurrence 问题永久消解」。这是**当前实现状态**的陈述。**如果未来真实 ingress 出现，该结论需要重新审查。**

逐条列举当前被检查并确认为「无」的通道：

| 通道 | 现状 |
| --- | --- |
| `process.env` | `src/` 全量 **0 命中** |
| `process.stdin` / `readline` | **0 命中** |
| HTTP / WebSocket / `dgram` | **0 命中** |
| `fs.watch` / `watchFile` | **0 命中** |
| `process.on` | 只有 `resident.ts:413-414` 的 SIGINT/SIGTERM，且 handler 无参、不携带任何值 |
| 命名管道控制端点 | 存在，但**不是输入面**（见 §5） |

由此得到一条关键结论：**occurrence 与 current reference 必须分开，且在当前实现下这个分离是彻底的。**

任何把两者都放进 Hikari 的设计，都必须先发明一个当前不存在的 ingress。那既不在本轮授权范围内，也不是一个可以由实现细节补齐的缺口。

---

## 5. Resident control 不是领域输入面

`src/cli/control.ts:1-10` 对其自身边界的逐字陈述：

> This is not a transport layer and it is not shared infrastructure. … The vocabulary below is closed, and it is closed because both of its words are the Resident's own: process lifetime (`stop`) and what an operator is told (`status`). **A kind whose semantics belonged to another module would have to reach that module through here, and reaching another module is exactly what a router does — such a request belongs in that module's own endpoint instead.**

`src/cli/resident.ts:296-298` 逐字：

> The control channel, as this file understands it: two questions, both already answerable from what the Runtime holds. `status` reads it, `stop` asks for the same thing a signal asks for. **Neither one reaches a plugin, and there is nothing here for a plugin to register with.**

以及 `src/cli/resident.ts:21-23` 逐字：

> It is **not a second input surface**: it cannot start anything, cannot load a plugin, and cannot say anything the Runtime has not already recorded.

**结论**：控制通道今天承载两个词，**键数严格、无预留字段**（`control.ts:151-153`：「an envelope that shrugged at unknown fields would already be an extensible schema」）。

需要如实记录一处细微差别：`control.ts:8-10` **不是**一条对「整个控制通道永不扩展」的无条件禁令，而是一条**禁止把它变成 router** 的禁令。把「语义属于别的模块」的 kind 加进这个词表，就是 router；正确去处是「那个模块自己的 endpoint」。

**但本轮不据此提议任何新 endpoint。** 该差别只用于说明现有边界的**准确形状**，不用于为扩展埋伏笔。

---

## 6. 当前唯一存在且可验证的值入口：composition-time config

> **措辞限制**：这是「它是当前实现中唯一存在且可验证的值入口」，**不是**「composition config 是唯一入口」这种永久架构规则。

配置值的完整流转链（逐条锚定）：

```text
process.argv
↓  src/cli/main.ts:17,22
CliOptions
↓  src/cli/resident.ts 的 loadPlugin 调用点
runtime.loadPlugin(definition, configInput)     src/runtime/runtime.ts:31-34
↓  src/runtime/runtime.ts:38
definition.config.parse(configInput)
↓  src/runtime/runtime.ts:39-47（PluginRecord.config，全文无再赋值）
definition.setup(context, record.config)        src/runtime/runtime.ts:122
```

`src/` 中 `loadPlugin` 的**全部**调用点，其 `configInput` 无一例外来自 `argv` 派生的 `options`。

**precedent 直接同构**，且它的注释几乎就是本文需要的论证。`src/git-repository/plugin.ts:40-42` 逐字：

> Explicit by design. There is no default and no fallback to the process's own working directory: **choosing a repository here would make this plugin the thing that decides which repository Hikari looks at, and that is a decision for whoever composes the plugin.**

`git-repository` 收 `{ repositoryRoot }`、`github-ci` 收 `{ repository }`——两者都是「**一个由组合方显式命名的对象**」。

---

## 7. config 表达的是什么（强弱之分是本文的地基）

**config 是 operator 输入，不是「Hikari 听到了人类声明」。**

Hikari 分不清「用户说他的当前重心是 X」与「有人给这个 flag 传了 X」。它诚实地知道的只有：

```text
本次组合被给定为 X
```

这个入口是诚实的，但**它比真话弱**。只要契约不叫 `HumanStatement`、不带 `statedAt`、不声称「听过」，一个更弱的描述就不是谎。

**一旦按更强的说法命名，就是在主张 Hikari 拥有它没有的东西。** 这是本文对后续任何实现的第一条命名约束。

---

## 8. current reference 的最小表示

若能保持为 consumer 私有输入，则最小表示为：

```text
readonly designatedNames: readonly string[]
```

作为**具体 judgement plugin 自己的 `config`**。

不包含：timestamp、`statedAt`、authority、priority、confidence、source 字符串。

**多 reference 天然合法，且不引入 priority。** 以「我在推进 Hikari，同时今晚要复习考试，CI 红了告诉我」为例：

- 单值字段是对人类注意力形状的**虚假断言**（「有且仅有一个」）——这是**正确性问题**，不是完整性问题；
- 而集合**几乎不花成本**：只要判词是二值的（「是否与其中任一相关」），集合就**不迫使**任何排序 / 优先级 / scheduler。

**二值判词是集合得以廉价的原因**——若判词是分级（如「最相关的是哪个」），集合就会立刻迫使排序。这条依赖关系必须在后续实现中保持。

**lifetime**：owner = 该 plugin 的 config；lifetime = **本次 `load` 的生命**。`runtime.ts:38` 在 `loadPlugin` 时 parse 一次，`PluginRecord.config` 全文无再赋值，`waiting → active` 的再激活**不会重新 parse**。**不跨 restart 保留，不因为是人说的就持久化。**

**replacement 语义**（T1「我现在推进 hikari-new P4-03」→ T2「先不做 P4-03 了，去处理 DesktopAgent」）：在当前没有 runtime human ingress 的前提下，occurrence 从未进入 Hikari，因此 §8 的替换问题**在当前实现下不成立**：没有已存 fact 需要被取代，**换掉 config 就是替换本身**，owner 是 caller（组合根）。**默认禁止 silent time decay**，且这里有一个正面理由——Hikari 不知道人**何时**说的，因此没有依据判断这句话何时过期。

> **措辞限制**：这一段的成立同样依赖「当前没有 runtime human ingress」。**若未来真实 ingress 出现，replacement / supersession 语义需要重新审查**，而不是沿用本段的结论。

---

## 9. 不需要独立 ReferenceFrame / HumanStatement public contract

按 §16 Contract Creation Gate 逐个过七个候选：

| # | 候选 | 过门禁结果 |
| --- | --- | --- |
| 1 | judgement Plugin 的 `config` | **存活**——precedent 同构（§6） |
| 2 | judgement Plugin 内 activation-local state | 归约到 1：值不可能来自别处 |
| 3 | 独立 Service | **不成立**——config 不跨越模块边界，无 §16.2 意义上的 callable need |
| 4 | Event | **不成立**——Hikari 没观察到「人说了这句话」，没有属于自己的 occurrence 可发布 |
| 5 | Chronicle fact | **不成立**——且 Chronicle **不支持 update / delete / supersession**（`phase-2-chronicle-architecture-review.md` §16），§8 的替换语义在它上面无法表达 |
| 6 | source-facing Plugin contract | **不成立**——人不是 Hikari 感知的 source：没有 acquisition seam、没有 `observedAt` |
| 7 | 暂不构建 | 始终可用 |

**结论：reference 不需要独立 public contract，`HumanStatement` / `Generic Reference Frame` 均不建立。** 候选 3 与 4 的失败与 §13 的 blocker 是同一处：contract 必须被**发布**，而当前没有任何需要发布它的读者。

**provenance 因此是结构性的**：reference 位于某 plugin 自己的 `config`，任何其它模块都写不进去。它与 foreground / git / github / 模型推断天然可分，**不需要 payload 字段**，也**不需要 identity / authentication**。

---

## 10. 最小 relevance 语义的元数：`relevant | unknown`

**本轮证据支持二值，不支持 `unrelated`。**

理由是**两侧词汇不同型**：

- `repository-ci-awareness` 敢说 `different`，因为两侧是**同一类报告**（两条 40 位 hex，两个源各自的拼写）。两个同类报告不相符，是**真实的差异发现**。
- 而 relevance 的两侧，一侧是自由人类语言，另一侧是文件系统路径（`workTreeRoot`）或 GitHub 的规范名（`repository`）。**不匹配是「未能建立」，不是「发现不同」**——人完全可能用 Hikari 对不上的说法指同一件事（URL、简称、「我的 CI 项目」）。

`unrelated` 要合法，需要两侧取自**同一个封闭词汇表**且存在定义良好的匹配关系。今天不成立，因此**不引入 `unrelated`**，也**不为了凑三值而人为构造一个 comparison scope**。

**可对上的词汇是封闭且已知的**，只有 `snapshot.githubCi.observation.repository` 与 `snapshot.gitRepository.observation.workTreeRoot`。特别地，`git-repository` 的 `remotes` **只有远端名、没有 URL**——一个说 URL 的人，Hikari 手里没有任何东西能对上。

---

## 11. 与 Repository CI Awareness 必须保持分层

两层不得合并：

```text
Repository CI Awareness   = 两个 commit SHA 是否相同
                            same | different | indeterminate
Human-relevant Judgement  = 这个 observation 是否与那个 reference 有关
                            relevant | unknown
```

**结构上因此天然可分**：未来的 relevance 层 `requires: [repositoryCiAwarenessService]` **一条边**——它读 assessment 里的 `snapshot`（`repository-ci-awareness.current@1` 已按引用携带 World snapshot），**不必**再 `requires` World，也**不得**重新推导 `commitComparison`。

**本轮另发现一件应明说的事：一部分「相关性」已经被 Layer 1 回答了。** `commitComparison === 'same'` 意味着 CI 报的正是本地 checkout 的那个 commit——这本身就是「这条 CI 结果与你当前的工作有关」的一个实质部分，且**零 human reference**。

所以 Layer 1 是**必要不充分**的：它答的是「是不是我脚下这个 commit」，human reference 补的是「是不是我在意的那个仓库」。

---

## 12. 模型边界

**最小 slice 不需要模型。** 匹配是字符串比较。

今天 `src/` 中**根本没有模型**——本节的边界当前不是靠政策守住的，是靠**不存在**守住的。这是一个比任何禁令都强的保证，**不应当主动放弃它**。

需要一个模型的是「我的 CI 项目」→ `t1mb2rg/hikari-new` 这类**改写理解**，而那正是「凭空发明用户没说的 current concern」变得可能的地方。**不要构建它，也不要为它预留位置。**

不建立：Reasoning Service / Model Router / Fast-Slow Model Layer / Central Brain。

> **Code guards truth; models interpret meaning.**

---

## 13. 结论

```text
EXPLICIT HUMAN REFERENCE VERDICT: BLOCKED
```

**唯一 blocker：尚未出现真实 human designation 与真实 reader 所形成的已发生跨模块语义。**

拆开说，因为这条 blocker 的形状容易被误读成「缺输入」：

- **不缺输入**——两侧都已具备：`repository-ci-awareness.current@1`（它自带宽窄两侧事实的 `snapshot`），以及一个 `config` 就能给定的名字；
- **不缺入口**——composition-time config 存在且有 precedent（§6）；
- **不缺表示**——最小表示可保持在 plugin 私有 config 内（§8）；
- **不缺命名**——元数可判（§10）；
- **缺的是「已发生」。**

`plugin-design-spec.md` §16.1 要求的是**真实、已发生的跨模块交互语义**，并明确「不要求已经存在具体的 Consumer implementation」。上一轮 `repository-ci-world` 的正当性来自「两份 observation 已共同指称同一时刻」——**可验证**。

而本轮所要求的语义，需要**先存在一个 human designation**。今天不存在：没有 composition 持有过它，没有 resident flag，没有 Service，`src/` 中 `relevance` 零命中。

而一个 judgement 若要成立就必须**发布**判词；发布即新建跨模块 contract。上一轮已在 `current-stage.md` 记录：无 consumer Service **「不构成一般许可」**。第三个无 consumer contract 会是**模式**而非例外——那正是 §16 要挡的东西。

**因此本文不描述「下一 slice 的最小形状」。** 描述它等于替人工裁决做掉决定，而本轮明确「不要为了 READY 发明 contract」。

### 解封条件

只需一件事，二选一，**均属人工裁决、不属研究**：

1. 出现**真实 reader**——某个人或某个循环会真的去读这个判词；或
2. 人工明确裁决：**这一个** slice 的无 consumer contract 被授权（**而非作为一般许可**）。

### 本轮的净产出

以下三条此后不必重做：

1. **入口问题已答死**：当前唯一存在且可验证的值入口是 composition-time config，不存在 runtime human ingress（§4、§6）；
2. **occurrence 在当前实现下无法进入 Hikari**，§8 的 lifetime 与 replacement 问题因此在当前实现下不成立——**但这是一条当前实现事实，不是永久结论**（§4、§8）；
3. **reference 不需要独立 contract，provenance 是结构性的**（§9）。

### 门禁理由第三次位移

- **第一次**（`github-ci` v1 后）：理由是「只有一个稳定 named-object source」→ **已解决**；
- **第二次**（`repository-ci-world` v1 后）：理由是「缺 repository 级同一性」→ **输入已补**；
- **第三次**（本轮）：**有输入、有入口、有表示，但那条语义从未发生。**

### 重新审查触发条件

出现下列任一情况时，本文结论**需要重新审查**（不是自动失效，也不是自动沿用）：

- 出现真实 runtime human ingress；
- 出现**真实 reader**（人或其他循环）会读取该判词；
- 人工对无 consumer contract 作出针对本 slice 的裁决；
- 出现一个**已真实持有 designation 的 composition**——届时「observation 与 designation 指同一件事」才第一次成为已发生的语义。

---

## 14. 本轮明确未做

- 未实现任何代码，未新增任何 contract；
- 未创建 `explicit-human-reference` Service / relevance Service / `HumanStatement` / Generic Human Input；
- 未新增 Resident flag，未新增 CLI command，未创建 fake consumer；
- 未修改 `src/` 下任何文件；
- 未把 reference 写进 Chronicle 或任何持久化介质；
- 未引入 salience / importance / notify / interruptibility / action；
- 未引入 `RepositoryIdentity` / `ProjectIdentity`；
- 未建立 cross-runtime sync、auth / permission、Resident routing、shared transport framework。

---

## 15. 已知限制

- 本文的 BLOCKED 是**关于「下一 slice 是否已就绪」的判定**，**不是**「P4-03 无法继续」。P4-03 的 commit 级 judgement 已经落地（`repository-ci-awareness` v1），不受本文影响。
- 本文的 §4 / §8 的强结论都**绑定当前实现状态**，已按 §4 与 §8 的措辞限制标注，不得当作永久架构原则引用。
- 本文不构成无 consumer contract 的一般许可，也不构成对「未来会有 reader」这一假设的认可。
- 「P4-03 的 Explicit Declaration / Reference Frame 研究」此前只存在于对话历史；本文是其仓库内 artifact，但**不包含**该研究本身的过程记录，只固定了本轮由源码与文档支撑的结论。
