# Hikari Plugin Design Spec

> **性质**：architecture documentation。本规范是 Plugin 设计与 code review 的**操作规范**。
>
> **权威层级**
>
> | 文档 | 地位 |
> | --- | --- |
> | `principles.md` | 长期最高原则 |
> | `core-architecture-v0.md` | 当前冻结核心结构 |
> | **本规范** | Plugin 设计与 code review 操作规范 |
> | phase architecture reviews | 历史设计与实现证据 |
> | development docs | 具体阶段实现记录 |
>
> 低层文档不得反向覆盖高层。本规范**不修改、不重新定义**上两层；phase reviews 只作为 evidence，不能反过来成为新的最高原则。
>
> **适用对象**：人类开发者、Claude / Codex / Forge 代码代理、未来生成或审查 Plugin 的 Hikari 自身。

---

## 如何阅读

每条 normative rule 标注三种等级之一，未标注的段落是定位与解释，不构成规范。

- **MUST** — 违反即为架构缺陷。仅可来自 `principles.md`、`core-architecture-v0.md`，或 Runtime 已明确强制的不变量。
- **SHOULD** — 成熟、重复出现，但不是上位冻结原则的工程纪律。偏离需在评审中说明理由。
- **REVIEW TRIGGER** — 出现后要求显式重新审查，**不代表自动违规**。

分级纪律见 §18。

---

## 1. 核心定位

**Plugin 是 Runtime 唯一运行扩展单元。**

Provider / Consumer / Loop / Perception / World / Awareness / Memory / Goal / Presentation 等都只是**领域角色**，不是 Runtime Plugin 类型。Runtime 只认识一种 Plugin。

**MUST** 禁止业务 Plugin 基类树。以下类型（及其任何变体）不得存在：

```
AgentPlugin     SensorPlugin     AwarenessPlugin    LoopPlugin
ProviderPlugin  ConsumerPlugin   BackgroundPlugin   MemoryPlugin
```

依据：`core-architecture-v0.md:84`、`core-architecture-v0.md:412`、`core-architecture-v0.md:118-124`（禁止结构清单）。

领域角色通过三件事表达，且**只能**通过这三件事表达：`requires` / `provides` 的 Service 契约、emit 的 Event、以及 Plugin 自身的实现结构。角色的丰富度不构成新增 Runtime 类型的理由。

---

## 2. Public Contract Boundary

**冻结：内部实现可以自由生长，对外只暴露规范化 public contract。**

### 2.1 public 的判据

只有当**同时**满足以下四条时，该符号才进入 public surface：

1. **Owner 确实拥有这个语义**——它属于该模块的领域职责，而不是它顺手持有的东西；
2. **该语义确实跨越模块边界**，而不是内部实现细节；
3. **它属于一个明确的 communication plane**（§5）——契约标识如此，由平面承载的领域数据亦然；
4. **Owner 愿意对该语义承担 contract 稳定性承诺**。

四条缺一不可。

**判据 2 衡量的是语义边界，不是当前是否已经有人站在对面。** "确实跨越模块边界"指该语义**按设计**属于模块之间的交互面；它**不要求**此刻已经存在某个具体的 Consumer implementation。若把"必须已经有具体消费者"当作通用必要条件，会让某些平面陷入循环：没有契约 → Consumer 无法依赖 → 没有 Consumer → 不允许创建契约。

**这处澄清放宽的是"是否已经有人站在对面"，没有放宽"语义是否真实"。** 以下理由**仍然不构成** public 的充分理由：

```
测试方便
对称性
"以后可能有人会用"
```

判据 1、3、4 与 §16 第 8 问不受影响。

> 注意：**不得**使用"它失败会不会成为别人的失败"作为唯一的 public/private 判据。**错误语义属于 contract 的组成部分，不是 public/private 的根判据。** 一个完全内部的实现细节同样可能产生失败；一个公开契约数据同样可能永不失败。

### 2.2 典型 internal

以下东西默认留在内部，不进入 public surface：

```
timer handle              child process             parser
comparison helper         activation-local state    Promise bookkeeping
retry state               generation token          transport detail
platform API handle       internal factory          test seam
```

### 2.3 典型 public contract data

以下**类别**通常构成正当的 public contract data：

```
Observation          WorldSnapshot        AwarenessAssessment
DurableFact          Identity             （以及同类规范化领域数据）
```

**这不是穷尽集合，也不是许可清单。** 具体符号是否进入 public surface，一律回到 §2.1 的四条判据。反过来，这份清单里的名字若在某个具体 Plugin 中不满足 §2.1，同样不得进入 public surface。

### 2.4 平台知识的边界

**MUST** 平台知识由拥有该平台的 Plugin 自行持有，不得泄漏进平台中立的契约。

当契约需要表达"数据来自哪个平台"时，只表达**数据来源标识**，不表达采集机制、API 句柄、进程模型或调用方式。

---

## 3. Provider / Consumer / Runtime

**冻结：**

> **Provider 不决定消费者。**
> **Consumer 不穿透 Provider。**
> **Runtime 不理解业务。**

三者的职责边界：

| 角色 | 可以 | 不可以 |
| --- | --- | --- |
| Provider | 公开 capability contract；实现该 contract | 知道谁会使用；为特定消费者做适配；决定消费者数量 |
| Consumer | 声明需要哪个 capability；调用它 | 依赖具体 Provider 实现；检查 Provider 是否存在；绕过依赖图运行时发现 |
| Runtime | registration / dependency / lifecycle / dispatch **机制** | 理解任何业务语义；决定"应该做什么" |

依据：`principles.md:171`（Runtime 可以控制"怎么运行"，但不能决定"应该做什么"）、`principles.md:177`、`principles.md:203`、`core-architecture-v0.md:231`。

**MUST** 不得引入 service locator 思想。具体地，不得为 Runtime 增加：

```
getService() / resolve() / container() / getServices()
暴露内部 Service Registry
动态查询式依赖发现（tryGet / 运行时探测 provider）
```

Consumer 取得 capability 的方式**只有一种**：`requires` 声明 → `setup` 中 `get` → 调用时 `await`。依赖关系必须能在激活前被静态判定。

**MUST** 不得让 Runtime 暴露内部 registry。Runtime 的公开面保持为生命周期与状态方法，不提供任何服务取值入口。

**REVIEW TRIGGER** 当出现"Consumer 自己检查 Provider 是否存在"的需求时——这通常意味着依赖模型表达力不足，应当审查依赖声明本身，而不是在领域模块里补一层探测。在领域模块中复制 Runtime 的职责会制造第二个真相来源。

---

## 4. Cross-module Import Rule

### 4.1 符号层（MUST）

**MUST** 跨模块只能依赖目标模块**明确公开的符号**。

不得 import：

```
private implementation      platform implementation
parser                      internal state
internal helper             internal types used only for implementation
```

依据：`principles.md:36`（其他模块不得直接穿透其实现边界）、`principles.md:41`（禁止 import 对方内部实现类）、`principles.md:46`（模块之间应通过明确的公共契约交互）。

这条规则的约束对象是**符号**，不是路径。判据是"这个符号是否由目标模块公开"，而不是"这个 import 写的是哪个文件"。

### 4.2 barrel 路径（SHOULD）

**SHOULD** 兄弟领域模块优先通过目标模块的 public barrel（`index.ts`）导入。

**barrel path 是工程惯例，不是架构真理。** 偏离它不构成架构违规，但构成 path-level 的可读性与可维护性问题，应当作为 cleanup opportunity 记录。

**REVIEW TRIGGER** 当某个模块的 import 面持续增长、或出现需要跨模块共享的**类型**时——审查目标模块的 public surface 是否应当扩展，而不是继续加深路径。

### 4.3 Runtime 特例

当前**不存在** `src/runtime/index.ts`。

`runtime/contracts.ts`、`runtime/plugin.ts`，以及现有已被使用的 Runtime public primitives，已经构成**事实上的稳定 Runtime seam**。它们承载 `defineService` / `defineEvent` / `PluginDefinition` 等 Runtime 公开原语，被领域模块正常消费。

本规范将这一事实记录为 **Runtime seam 现状**，不将其表述为违规，也不要求改变它。

**REVIEW TRIGGER** 若要改变 Runtime 的导入形态（新增 barrel、迁移现有 import、调整 seam 边界），这是一次**独立的设计变更**，必须显式审查，不得为了路径对称性顺带进行，也不得搭在某个 Plugin 的改动上。

### 4.4 禁止事项

**MUST** 不得为了通过 import 检查而扩大某个模块的 public surface——公开符号的判据是 §2.1，不是"让 import 看起来整齐"。

**MUST** 不得让 Runtime 因某个模块的 import 需要而增加领域概念。

---

## 5. Communication Planes

四种通信平面，按**语义**选择，不按便利性选择：

| 语义 | 平面 |
| --- | --- |
| 需要一种能力并得到结果 | **Service** |
| 某件值得其他 Plugin 知道的事情刚刚发生 | **Event** |
| 未来仍须证明它发生过 | **Chronicle / Durable Fact** |
| 改变外部现实 | **Action Pipeline** |

Capability view / graph 按上位原则描述。**MUST** 不得为此创造新的 Runtime mechanism。

**MUST** 禁止以下四种误用：

- 用 **Event** 代替普通请求 / 响应；
- 用 **Service** 模拟 occurrence（把"发生了某事"包装成可查询的服务）；
- **自动**把 Event 持久化为 Durable Fact；
- 绕过 Action governance 直接改变外部现实。

依据：`principles.md:388`（不能为了方便把所有 Event 都持久化）、`principles.md:80-81`、`principles.md:552-581`。

### 5.1 关于 Event 平面的诚实说明

**Event mechanism 当前状态：architecture-defined，runtime-tested，目前尚无 production domain consumer / producer。**

- architecture-defined：`principles.md` 与 `core-architecture-v0.md` 已定义 Event 平面语义；
- runtime-tested：Runtime 的 Event 机制已有运行时测试覆盖；
- production-domain precedent：**尚无**。

**这不得被读作 Event 平面合法性不足。** Event 是四种通信平面之一，其架构地位不因当前使用量而改变。记录此状态是为了让审查者知道：**Event 的具体使用形态尚未被真实领域需求检验过**，因此围绕 Event 的设计决定应当比已经被反复实践的平面承受更严格的审查。

**REVIEW TRIGGER** 首个 production domain Event producer / consumer 出现时——审查 Event contract 的命名、载荷与语义边界，将本次实践记录为第一个 precedent。

---

## 6. requires / provides

### 6.1 定义

- **`requires`**：Plugin **激活所必需**的 Service capabilities。
- **`provides`**：Plugin **激活期间**向 Runtime 提供的 Service capabilities。

两者都是声明式的：Runtime 依据声明完成依赖解析与生命周期收敛，Plugin 不参与该过程。

### 6.2 MUST 规则

**MUST** 禁止 hidden dependency。Plugin 不得在未声明 `requires` 的情况下取得任何 Service。

**MUST** 不得虚构 cosmetic `provides`——为了"看起来有输出"而声明一个没有真实消费者的 Service。

**MUST** 不得 require 并 provide 同一契约。

**MUST** 同一 Service contract 在同一时刻只能有一个活动 Provider。

以上四条均由 Runtime 强制：`src/runtime/plugin.ts`（声明校验）、`src/runtime/runtime.ts`（激活后校验声明的 `provides` 确已注册）、`src/runtime/service-registry.ts`（重复 Provider 拒绝）、`src/runtime/errors.ts`（未声明依赖 / 未声明 Provider / 缺失声明服务）。违反将导致 Plugin 激活失败，而非静默降级。

### 6.3 不是每个 Plugin 都必须 provide Service

**MUST** 不得要求每个 Plugin 至少提供一个 Service。

以下形态是**合法 Plugin**，由架构支持：

```ts
requires: [ServiceA]
provides: []
// 并在运行期间 emit EventB
```

这是 **architecture-supported 的合法形态**，而不是"SHOULD 才允许"的宽容条款。`requires` 与 `provides` 在类型层均为可选，纯 Consumer 是被正视设计的一部分。

> 当前尚无 production domain precedent。这不影响其合法性——合法性来自运行时模型与类型定义，不来自使用量。见 §19。

---

## 7. Public Surface

**SHOULD** public surface 保持最小。

**应当导出：**

```
真正跨模块需要的 contracts
真正跨模块需要的 domain data types
Plugin definition
必要且稳定的 domain errors
```

**默认不导出：**

```
parser                  transport helper       platform implementation
timer controller        comparison helper      test seam
internal factory        activation state       internal types
```

**SHOULD** 测试方便**不是**扩大 public API 的充分理由。若某个内部符号仅为测试可替换性而存在，它应当保持内部，并通过既有内部机制（依赖注入、工厂参数）在测试中替换，而不是提升为生产契约。

**SHOULD** 不稳定的部分不应进入 public surface。"将来最可能变的东西"一旦导出，就把变化固化成了破坏性变更。

**REVIEW TRIGGER** 每一次新增导出——回到 §2.1 的四条判据逐条确认。特别是：**这个符号被导出，是因为它确实跨越模块边界，还是因为测试、对称性或预判的未来需要？**

---

## 8. Lifecycle Ownership

### 8.1 所有权规则

**MUST** Plugin 创建的资源由该 Plugin 拥有，并登记到 Runtime lifecycle mechanism。

适用于：Service registration / Event subscription / timer / child process / watcher / socket / background task，以及任何等价资源。

**冻结：**

> **谁创建资源，谁登记生命周期；**
> **Plugin 退出，资源随之停止产生新的领域效果。**

**MUST** 资源必须在激活期间创建，不得在模块导入时创建。模块导入期属于加载阶段，此时不存在任何可归属的生命周期容器。

**MUST** 不得依赖插件的自定义清理钩子或状态查询来完成释放——释放路径只能经由 Runtime 既有的 lifecycle mechanism。

### 8.2 关于清理的边界性

本规范**不得**要求所有 cleanup 使用统一 timeout。不同资源的合理清理时长差异极大，统一上限会制造虚假的安全感与真实的截断风险。

**REVIEW TRIGGER** 当 **cleanup 的完成依赖一个可能永远不会到来的外部事件**时，必须显式审查以下四项：

1. **cancellation** — 该等待是否可被主动取消？
2. **boundedness** — 是否存在上界，还是理论上可以无限等待？
3. **shutdown liveness** — 若该等待永不结束，Runtime 的 shutdown 是否仍然能够完成？
4. **failure semantics** — 等待失败或被放弃时，产生什么可观察的语义？

这四问不预设答案。**审查的目的是让"无界等待"成为一个被明确接受的决定，而不是一个未被注意到的默认行为。**

---

## 9. Setup Rules

**不得**将"setup 永远不得观测 / 探测"全局化。那是一类具体 Plugin 的领域决策，不是通用规则。

**通用规则：**

**setup 负责 activation 所需的初始化与资源建立。**

如果 **readiness 本身需要 handshake / validation**，setup **可以**执行必要工作。例如：连接握手、能力协商、格式校验、依赖可用性确认。这些是激活的组成部分。

**MUST** 不得借 setup 偷偷执行与 activation readiness **无关**的领域行为。

**MUST** 不得在 setup 中产生**未被 lifecycle ownership 管理**的后台工作。

判据是**归属**，不是**行为分类**：

- "setup 里能不能做 X" 的真问题不是"X 是不是观测"，而是"X 是不是 readiness 的一部分，以及它产生的资源是否已登记归属"。
- 一次与 readiness 无关的领域观测，即使它不产生资源，也越过了 activation 与 operation 的边界。
- 一次与 readiness 直接相关的握手，即使它访问外部系统，也是 setup 的正当职责。

**REVIEW TRIGGER** 当 setup 中出现任何外部交互时——确认它服务于 readiness，而非服务于领域运行。

---

## 10. State Ownership

Plugin **可以**拥有 activation-local transient state。

**MUST** 每一处状态必须明确四件事：

| 项 | 含义 |
| --- | --- |
| **owner** | 谁拥有它，谁能读写 |
| **lifetime** | 存活多久，跨越哪些边界（激活 / 请求 / 进程） |
| **reset boundary** | 什么事件使它重置或失效 |
| **durability** | 是否持久，持久到哪里，由谁负责 |

**MUST** transient 不自动 durable。进程内状态不会因为"它看起来很重要"而获得持久化资格。

**SHOULD** durable state 不能因为"未来可能有用"就创建。持久化是承诺，不是缓存。

**MUST** 模块作用域的 mutable state 不得用于承载需要跨激活重置的语义——它会静默地把状态生命周期延长到进程级，破坏 reset boundary。

### 10.1 关于数据传递方式的边界

**不得**把"按引用透传"、"不重新校验"、"不重建对象"提升成所有 Plugin 的通用 MUST。

这些是**特定 ownership 安排下的正确性结论**：当数据由生产方拥有并冻结、消费方只是持有引用时，重建或重校验会制造第二个真相来源。见 §19。

**Adapter / normalization boundary 未来可能合法地重建或验证数据**——当某层的职责恰恰是转换、归一化、或对不可信输入做校验时，重建与校验就是它的正当工作。

判据仍然是 ownership：**谁拥有这份数据的语义与不变式，谁负责校验它。** 重复校验的问题不在于"校验"本身，而在于两个模块同时成为同一不变式的权威。

---

## 11. Config

**不得**全局化"config 不能表达 scope"或"第二个 scope 必须新 Plugin"。那是一次具体的 ownership 决策，不是通用规则。

**通用规则：**

**config 描述该 Plugin 合法拥有的运行配置。**

**MUST** config 不得替 Runtime 表达领域 policy。配置项不应成为绕过架构约束的通道——凡是 config 能表达的东西，都在该 Plugin 的 ownership 之内。

**MUST** config 不得偷偷扩大 Plugin ownership。一个配置项如果让 Plugin 事实上接管了不属于它的职责，无论形式多自然，都越过边界。

**SHOULD** 不得为了未来可能性暴露大量 knob。未被真实需求检验的配置项是负债：它们扩大 surface、制造组合爆炸，且几乎总是实现错误。

**关于 scope 的判据：** scope 是否可以作为 config，**取决于该 Plugin 的 ownership**。若多个 scope 共享同一语义、同一生命周期、同一不变式，则由一个 Plugin 通过 config 承载是合理的；若不同 scope 意味着不同的依赖、不同的生命周期、不同的状态归属，则那是一个新 Plugin。

**REVIEW TRIGGER** 每次新增 config 项——确认它落在该 Plugin 的 ownership 之内，且存在真实需求。

---

## 12. Service Naming

**不得**制定"有 `current()` 方法就必须叫 `.current`"这类语法规则。命名依据**语义**，不依据 TypeScript member 形态。

**现有约定（记录，非规则）：**

`.current` 当前用于表达"当前值 / 当前观测能力"的若干 Service contract。这些 contract 中，有的把 `current` 暴露为 **property**，有的暴露为 **method**——这属于实现形态差异，不是命名违规。

因此：

- **SHOULD** 命名表达语义角色（当前值 / 历史 / 查询 / 变更……），而不是实现形态。
- **MUST** 平台实现名不得**无理由**污染平台中立的 capability id。一个平台中立的 capability 不应在其身份中携带平台名，除非该 capability 的语义**本身**就是平台特定的。
- **SHOULD** service id 应当稳定。id 是契约身份的一部分，变更 id 等同于变更契约。

---

## 13. Error Semantics

**MUST** 区分以下类别。把它们折叠会制造静默的错误结论。

| 类别 | 含义 |
| --- | --- |
| **capability absence** | 所需能力当前不存在（依赖未满足） |
| **activation failure** | 激活过程失败 |
| **domain operation failure** | 能力在位，但本次操作失败 |
| **valid absence observation** | 成功观测到"没有" |
| **partial unavailable / unknown** | 部分不可用，或结果未知 |
| **invalid durable state** | 持久状态无效或不可解析 |
| **external action failure** | 外部动作失败（未来平面） |

**MUST** 特别地，**不得把 unknown / failure 压成普通 absence**。

这四者必须保持可区分：

```
"我看了，那里什么都没有"      → valid absence observation
"我没看到"                    → unknown
"我看失败了"                  → domain operation failure
"我没有能力看"                → capability absence
```

把它们中的任何一个折叠成另一个，都会让调用方基于错误的确定性行动。依据：`principles.md:225`（capability existence ≠ exposure ≠ authorization ≠ execution——同一族的不折叠原则）。

### 13.1 关于错误的上浮

**上层是否保留、包装、归一化下层错误，取决于该层的 ownership。**

- 若该层**拥有**该错误的语义（例如它自己定义了该失败的含义），它可以包装、分类、归一化。
- 若该层**不拥有**该错误的分类法，则它不应当替下层决定错误等级，也不应当把下层的具体错误类型暴露成自己的契约面。**原样传播是合法的**。

**不得**把某一层"不携带原因"的做法提升成所有 composer 的通用规则。是否携带原因，取决于该层是否拥有判断原因的能力与责任。见 §19。

---

## 14. Background Plugin / Loop

**只写通用规则。** 具体方案不在本规范范围内。

**Loop 仍然是普通 Plugin。** 长期运行**不产生**新的 Runtime 类型：

```
LoopPlugin        BackgroundPlugin     Manager
Supervisor        Super Orchestrator   Scheduler
```

依据：`core-architecture-v0.md:308`（Super Orchestrator 禁止）、`core-architecture-v0.md:403`（所有 Provider 的通用智能调度器禁止）。

**MUST** timer / scheduling 如果由 Plugin 创建，仍归**该 Plugin** 的 lifecycle ownership（§8）。不得存在无人拥有的定时器。

**MUST** 模块作用域不得承载 loop 状态。loop 状态必须符合 §10 的四项声明。

**多个 loop 平级。** 一个 Plugin 不得协调另一个 Plugin 的循环节奏；Provider 可以保持 pull-only，由 Consumer Loop 主动调用它。

**REVIEW TRIGGER** 当出现"谁来协调这些循环"的需求时——这通常意味着缺少一层领域 Plugin，而不是需要 Runtime 增加调度器。

### 14.1 本规范**不得**冻结的内容

```
具体 cadence                具体 Event 名
Resident 架构               P4-01 方案
任何常驻进程形态
```

这些属于尚未被真实需求检验的设计空间。任何提前冻结都会把猜测固化成约束。

---

## 15. Event-producing Consumer

**明确允许：**

```
Service Consumer  +  Event Producer
```

一个 Plugin 可以消费 Service，同时发布 Event。这是合法且被架构支持的形态。

**MUST** Plugin 不需要为了"有输出接口"虚构 `status` / `latest` / `trigger` 之类的 Service。这类 Service 在缺少真实消费者时是 cosmetic provides（§6.2），会污染依赖图并制造虚假的契约承诺。

**Producer 只发布规范化 occurrence。**

**MUST** Producer 不负责决定：

```
谁订阅
有多少订阅者
结果最终去哪里
```

**消费者自己声明 Event interest。** 发布方不知道订阅方的存在——这与 §3 的 "Provider 不决定消费者" 是同一条原则在 Event 平面上的表达。

**0 subscriber 是合法状态。** Event 的合法性来自 **Producer 拥有的、真实且稳定的 occurrence semantics**，而不是当前的 subscriber count。Producer 不检查订阅者数量，也不会因为"当前无人订阅"而停止发布。

**这不是 speculative Event 的许可。** 反问始终是：**Producer 是否真的产生了一个对模块边界之外有意义的 occurrence？** 若一个 occurrence 只是该模块内部状态的镜面，则无论有多少订阅者，它都不该成为 Event。判据见 §16 的 Event 平面。

---

## 16. Contract Creation Gate

新建任何跨模块 contract 前，逐条回答以下**通用问题**。任一问题的答案指向"不成立"，则不创建。

1. **谁拥有这个语义？**
2. **是否存在真实跨模块 interaction need？**
3. **这是 Service / Event / Durable Fact / Action 中的哪一种？**
4. **现有 contract 能否正确表达它？**（能否复用而非新建）
5. **新 contract 是否泄露实现细节？**
6. **生命周期语义是否明确？**（owner / lifetime / reset boundary / durability）
7. **Runtime 是否因此开始理解业务？**
8. **这个 contract 是真实需要，还是仅为了测试 / 对称 / 未来可能性？**

**若主要理由是"以后可能有用"，默认不创建。**

### 16.1 第 2 问的读法

第 2 问衡量的是**真实的跨模块交互语义**，而不是**当前是否已经存在某个具体的 Consumer implementation**。

> **必须存在真实、已发生的跨模块交互语义。**
> **不要求已经存在具体的 Consumer implementation。**

这与 §2.1 判据 2 是同一处澄清。放宽的只是"是否已经有人站在对面"；第 1 问、第 8 问，以及 §2.1 判据 1 / 3 / 4 全部不受影响。

### 16.2 按 plane 的补充判据

第 3 问确定平面之后，**用该平面自己的判据回答第 2 问**。**不得**把某个平面的判据套用到另一个平面上——Service 与 Event 对"真实交互语义"的要求并不相同。

**Service**

- 谁需要**主动调用**这个 capability？
- **若不存在真实的 callable need，默认不创建 Service。**

**Event**

- Owner 是否真的产生了一个**对模块边界之外有意义的 occurrence**？
- Event **可以**在 0 subscriber 时合法存在（§15）。
- Producer **不需要**知道 subscriber 的身份或数量。
- 但"以后可能有人感兴趣"**仍然不足以**创建 Event。

**Durable Fact**

- 是否真实需要**跨生命周期保存 / 证明**？

**Action**

- 是否真实存在**改变现实的 intent**？

**本节不扩展 Capability Registry 的架构。**

**REVIEW TRIGGER** 每次新增跨模块 contract。特别地，第 7 问若答案为"是"，这不是一次 contract 新增，而是一次架构变更，必须升级审查。

---

## 17. God Object Review Triggers

出现以下任一信号，必须显式 review：

```
requires 快速增长且跨越多个不相关领域
大量 sibling domain imports
保存多个领域的状态
决定其他 Plugin 之间应当如何路由
成为大量调用的必经路径
需要 Runtime 新增领域 API
需要 global state
出现万能 Manager / Orchestrator / Brain 倾向
```

依据：`core-architecture-v0.md:231`（Runtime 不得成为全局业务调度器）、`principles.md:60`（任何模块都不能因为"它最方便拿到数据"就顺手接管不属于自己的职责）。

**名字本身不是罪证，ownership 失衡才是问题。**

一个叫 `Manager` 的类若只管理它自己的资源，不构成问题；一个不叫 `Manager` 的类若决定了其他模块的调用顺序，问题已经在。审查的对象是**它拥有了什么**，不是**它叫什么**。

**REVIEW TRIGGER** 每一个信号。审查结论可以是"这是恰当的领域职责"，但必须被显式记录。

---

## 18. 分级纪律

### 18.1 标签的使用

**不要机械地给每个解释句都加标签。** 标签只加在 normative rule 上；解释、定位、依据引用不加标签。

### 18.2 MUST 的来源限制

**MUST 只能来自：**

```
principles.md
core-architecture-v0.md
Runtime 已明确强制的不变量
```

任何没有上述来源的规则，最高只能是 **SHOULD**。若它足够成熟、被反复实践，但仍然没有上位依据，它就是 SHOULD——**不要为了强调而把工程纪律写成 MUST**，那会稀释 MUST 的含义。

### 18.3 历史措辞的处理

**不得**把阶段文档中的"独立设计决定 / Boundary Review / 实现设计决策"统一重写成同一种历史措辞。这些措辞的差异是**阶段性差异**，不是需要修正的不一致。

在**本规范自己的操作层面**，可以统一使用：

> **requires explicit review**

这是本规范的**操作性措辞**，用于表达"停下来做一次显式审查"这一动作——**不要伪称这是历史文档的原话**。引用历史文档时必须引用其原文措辞。

---

## 19. Evidence Appendix

本附录记录规则与当前实现之间的关系。**附录不产生规则**——规则在 §1–§18。

**正文规则不得以具体模块作为主语。** 本附录使用具体模块，是为了让审查者可以核对规则的实际落地状态。

### 19.1 证据等级

| 等级 | 含义 |
| --- | --- |
| **architecture rule** | 由 `principles.md` / `core-architecture-v0.md` 确立 |
| **production precedent** | 生产代码中的真实落地 |
| **runtime test precedent** | 仅由 Runtime 层测试覆盖，无生产落地 |
| **known exception** | 已记录、已接受、且被显式豁免的偏离 |
| **known debt** | 已识别的风险，尚未处理 |

### 19.2 逐项状态

**Event 平面**
`architecture-defined` + `runtime test precedent`。**production-domain precedent 尚无。**
→ 见 §5.1。记录状态，不降低架构合法性。

**Pure Consumer 形态（`provides: []`）**
`Runtime model` 已允许（`requires` / `provides` 类型层均可选）+ `runtime test precedent` 已覆盖。**production-domain precedent 尚无。**
→ 见 §6.3。这是架构支持的合法形态。

**跨模块 import**
符号层 **MUST**（§4.1）：现有生产代码**合规**——所有跨模块 import 引用的都是目标模块已公开的符号。
barrel 路径 **SHOULD**（§4.2）：**尚未完全满足**。存在 4 条 sibling domain deep-path import，它们引用的符号已由目标模块的 barrel 公开。
→ 这是 **path-level cleanup opportunity**，**不是 architecture violation**。本规范不要求立即整改，也不得将其作为阻塞项。

**Runtime seam**
`runtime/contracts.ts` 与 `runtime/plugin.ts` 构成事实上的稳定 Runtime seam（§4.3）。当前无 `runtime/index.ts`。
→ 记录为现状，不表述为违规，不要求改变。

**Setup 边界**
"setup 不做 observation" 是一类具体 Plugin 的**领域决策**，**不是**通用 MUST。
→ 见 §9。不得全局化。

**数据传递方式**
"按引用透传 / 不重新校验 / 不重建" 是特定 ownership 安排下的正确性结论。
→ 见 §10.1。不得提升为通用 MUST。

**错误携带原因**
某一层"`unavailable` 不带 reason"是该层**不拥有**下层失败分类法的结果。
→ 见 §13.1。不得提升为所有 composer 的通用规则。

**测试内部导入**
存在**恰好两处**具名例外（每处均已自述为"唯一一处具名例外"），用于注入平台实现的假替身。
→ **known exception**。这是内部 seam 可达性的有意安排，不是 public surface 的一部分（§7）。新增此类例外需要显式审查。

**shutdown boundedness**
清理路径的 lifecycle ownership **合规**（资源已登记、由 Runtime 释放）。
但存在 **known risk**：部分清理的完成依赖一个可能不会到来的外部事件，理论上无界。
→ 见 §8.2 的四问。记录为 **known debt**，不在本规范范围内处理。

### 19.3 附注

本附录列出的状态是编写本规范时的快照。**附录允许过时，规则不允许。** 若实现演进使某条附注不再准确，应更新附注，而不是修改规则以匹配实现。

---

## 20. Authority

| 文档 | 地位 | 是否可被本规范修改 |
| --- | --- | --- |
| `principles.md` | 长期最高原则 | **否** |
| `core-architecture-v0.md` | 当前冻结核心结构 | **否** |
| `plugin-design-spec.md`（本规范） | Plugin 设计与 code review 操作规范 | — |
| phase architecture reviews | 历史设计与实现证据 | 不作为权威来源 |
| development docs | 具体阶段实现记录 | 不作为权威来源 |

**低层文档不得反向覆盖高层。**

具体推论：

- 本规范**不得**新增或重定义 `principles.md` / `core-architecture-v0.md` 中的任何条目。
- 本规范中的 MUST 必须可回溯到上两层或 Runtime 已强制的 invariant（§18.2）。
- phase review 可以**印证**本规范，但不能**推翻**它；反之，本规范也不能因为 phase review 的历史措辞而改写自己的规则。
- 当本规范与上两层出现表述冲突时，**以上两层为准**，本规范应当被修正。

---

## 21. Checklist

可直接作为 Claude / Forge task 的 review 清单使用。

```
Ownership
  [ ] 谁创建资源，谁登记生命周期？
  [ ] 模块作用域是否有不应存在的 mutable state？

Contract
  [ ] 新符号是否满足 public 四判据（拥有 / 跨越边界 / 平面归属 / 稳定性承诺）？
  [ ] 是否泄露实现细节或平台机制？

requires / provides
  [ ] 是否有未声明的 hidden dependency？
  [ ] 是否有 cosmetic provides？
  [ ] 是否 require 并 provide 了同一契约？

Public surface
  [ ] 每个新导出是否必要？还是为了测试 / 对称 / 未来？
  [ ] 不稳定的部分是否被隔离在内部？

Imports
  [ ] 只依赖目标模块已公开的符号？
  [ ] 优先走 barrel？
  [ ] 未为 import 整齐而扩大 public surface？

Communication plane
  [ ] 语义对应正确的平面？
  [ ] 是否用该平面自己的判据回答过 §16 第 2 问？
  [ ] 无 Event 模拟请求 / 响应、Service 模拟 occurrence、
      Event 自动持久化、绕过 Action governance？

Lifecycle
  [ ] 资源在激活期创建，不在模块导入期？
  [ ] 清理是否依赖可能永不到来的外部事件？
      → 若是，cancellation / boundedness / liveness / failure semantics 是否已审查？

State
  [ ] owner / lifetime / reset boundary / durability 四项是否明确？
  [ ] transient 是否被误当 durable？
  [ ] durable 是否只因为"以后可能有用"而创建？

Errors
  [ ] absence / unknown / failure / capability absence 是否保持可区分？
  [ ] 是否把 unknown 或 failure 压成了普通 absence？
  [ ] 是否泄漏了下层的错误分类法？

Runtime boundary
  [ ] Runtime 是否因此开始理解业务？
  [ ] 是否引入了 service locator 或动态依赖发现？
  [ ] 是否为领域需求新增了 Runtime 机制？

God-object signals
  [ ] requires 是否跨越多个不相关领域？
  [ ] 是否保存了多个领域的状态？
  [ ] 是否成为大量调用的必经路径？
  [ ] 是否出现万能 Manager / Orchestrator / Brain 倾向？

Testing
  [ ] 测试是否依赖了 public surface 之外的东西？
  [ ] 测试便利是否被当作扩大 API 的理由？
```

---

**END OF SPEC**
