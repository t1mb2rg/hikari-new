# Hikari Architecture Principles

> 状态：架构原则 / 初版
>
> 目的：定义 Hikari 新架构在后续设计与实现中必须持续满足的基本约束。
>
> 本文优先级高于具体模块实现。任何新组件、重构方案或跨模块调用，如果与本文原则冲突，应先解释为什么需要修改原则，而不是在代码里绕过它。

---

## 0. 北极星

Hikari 的目标不是做一个更强的聊天机器人，也不是单纯做一个 Agent Harness。

Hikari 应该：

- 持续存在，而不是只在用户发消息时才存在；
- 感知数字环境中的变化，并判断哪些变化重要；
- 通过共同经历形成连续记忆与成长；
- 在适当的时候主动介入；
- 在获得能力与权限时，真实完成事情；
- 对自己的状态、记忆与行动保持可验证的诚实。

因此，任何架构设计最终都应回答：

> 这个设计是否更有利于 Presence、Continuity、Growth、Agency 与 Trust？

如果只是让代码更整齐，但损害这些目标，就不是正确方向。

---

# 1. 严格模块边界

## 原则

模块拥有自己的领域语义、状态与不变式。其他模块不得直接穿透其实现边界。

模块之间不应通过：

- 直接操作对方数据库；
- import 对方内部实现类；
- 访问私有状态；
- 绕过公开契约直接调用底层 Provider；
- 为了“临时方便”增加跨模块特例。

模块之间应通过明确的公共契约交互。

## Ownership

模块划分不仅是目录划分，更是 Ownership 划分。

例如：

- Memory 拥有记忆语义、写入规则、检索与修订；
- Presentation 拥有最终用户可见表达；
- Action Domain 拥有真实世界动作的治理与执行事实；
- Perception Provider 只负责“观察到了什么”，不负责决定该不该介入；
- Host Runtime 不拥有任何 Hikari 领域语义。

任何模块都不能因为“它最方便拿到数据”就顺手接管不属于自己的职责。

---

# 2. 多通信平面，而不是单一超级总线

Hikari 会有明显的“总线结构”，但不采用“一条 Event Bus 承担所有通信”的设计。

不同语义必须走不同通信平面：

```text
需要一个能力
→ Service

某件事情刚刚发生
→ Event

这件事情以后必须还能证明发生过
→ Chronicle / Durable Fact

当前系统具备哪些能力
→ Capability Registry / Capability Graph

我要对外部世界产生副作用
→ Action Pipeline
```

## Service

用于直接能力调用。

含义是：

> 我现在需要你完成一种已经公开定义的能力。

Service 面向稳定契约，而不是具体实现。

## Event

用于实时通知与协作。

含义是：

> 某件事情发生了，感兴趣的组件可以响应。

Event 不自动等于长期事实。

## Chronicle / Durable Fact

用于记录必须跨进程、跨重启、跨设备生命周期保留的真实事实。

含义是：

> 这件事情真实发生过，未来应该可以恢复、审计或重新解释。

## Action Pipeline

用于所有真实外部副作用。

无论动作来源是用户、模型、Awareness、Goal、Forge、定时任务或其他模块，只要会改变外部世界，就必须经过统一行动治理链。

---

# 3. Runtime owns mechanism, never policy

Host Runtime 是一个故意保持“愚蠢”的运行宿主。

它可以拥有：

- Plugin lifecycle；
- Service registration / discovery；
- Event dispatch；
- Scope / isolation；
- Effect / resource ownership；
- Generic scheduling primitives；
- Generic persistence primitives；
- cancellation / teardown 等运行机制。

它不得理解：

- User；
- Persona；
- Memory；
- Goal；
- Awareness；
- Engineering；
- Conversation；
- Authority policy；
- Hikari 本身的业务语义。

允许：

```text
plugin loaded?
service available?
resource alive?
task cancelled?
transaction succeeded?
```

禁止：

```text
if engineering.blocked ...
if memory.should_store ...
if user.is_owner ...
if awareness.important ...
```

核心约束：

> Runtime 可以控制“怎么运行”，但不能决定“应该做什么”。

---

# 4. 能力与实现分离

Hikari 的重要能力应优先抽象为 Capability Seam，而不是直接绑定某个具体 Provider。

典型关系：

```text
Capability Definition
        │
        ├── Provider A
        ├── Provider B
        └── Consumer / Tool / Workflow
```

例如：

```text
Reasoning
├── DeepSeek Provider
├── OpenAI Provider
└── Local Provider

Coding
├── Codex Provider
├── Claude Code Provider
└── Forge Provider
```

上层依赖能力契约，不依赖 Provider 实现。

---

# 5. 能力存在不等于能力可用

Hikari 必须区分至少以下几个层次：

```text
系统是否拥有某项能力
↓
当前 Scope 是否能访问
↓
某个行为循环是否能消费
↓
模型是否能看到
↓
本次动作是否被允许执行
```

因此：

> Capability existence ≠ Exposure ≠ Authorization ≠ Execution。

这几个层次不得合并成一个布尔开关。

---

# 6. Policy 必须与 Mechanism 分离

Provider 负责“怎么做”。

Policy 负责“允不允许做”。

Consumer 负责“如何使用/暴露这个能力”。

Runtime 负责“这些组件怎么活”。

任何一个对象都不应同时回答所有问题。

例如 Shell 能力中：

```text
Shell Definition
→ 定义能力

Shell Provider
→ 具体执行

Tool Consumer
→ 是否暴露给模型

Policy / Guard
→ 本次是否允许

Approval
→ 是否需要用户一次性确认
```

---

# 7. 权限采用单调收缩

权限治理应优先满足“只能收紧，不能被后续插件重新放宽”的单调性。

理想模型：

```text
可见能力集合
∩ Scope Restriction
∩ Authority Policy
∩ Safety Guard
∩ User Approval
=
最终可执行集合
```

一个具有约束力的拒绝不能被后来的普通 Allow 覆盖。

---

# 8. 所有真实行动统一进入 Action Pipeline

Hikari 中所有会对外部世界产生副作用的动作，应统一经过类似：

```text
Action Intent
↓
Normalize / Resolve
↓
Authority Policy
↓
Monotonic Guards
↓
Approval（如需要）
↓
Capability Provider
↓
Result / Receipt
↓
Durable Fact
```

不允许：

- Awareness 直接发消息；
- Engineering 直接修改系统却不留下行动事实；
- Memory 直接触发外部动作；
- 某个模型插件绕过统一治理去调用原始系统资源。

模块可以提出 Action Intent，但不能绕开治理链。

---

# 9. Receipt 是一等公民

Hikari 声称“我做了”必须有可验证回执。

例如动作：

```text
发送一条消息
```

不能仅凭 Provider 返回 `success = true` 就结束。

理想情况下应形成：

```text
Action
Result
Receipt
```

Receipt 可以包含：

- provider；
- external id；
- timestamp；
- revision / commit id；
- result fingerprint；
- 其他可验证执行事实。

Hikari 对外表达完成状态时，应基于这些事实，而不是基于模型意愿。

---

# 10. 事实优先于状态

重要长期状态不应成为孤立真源。

原则：

> State should preferably be a projection of durable facts.

例如：

```text
goal/created
goal/updated
goal/completed
```

可以折叠得到：

```text
Goal.status = completed
```

但“completed”本身不应该覆盖掉此前发生过的事实链。

---

# 11. Event 不等于 Durable Fact

实时事件与长期事实必须严格区分。

```text
Event
= 现在发生了什么

Durable Fact
= 这件事发生过，以后仍然应该知道
```

不能为了方便把所有 Event 都持久化，也不能让必须审计的事实只存在于瞬态 Event 中。

---

# 12. Memory 是解释，不是绝对真源

Memory 不等于 Chronicle。

```text
Chronicle
= 发生过什么

Memory
= Hikari 从经历中理解出了什么
```

Memory 可以被：

- 修订；
- 重新解释；
- 降低置信度；
- 合并；
- 废弃。

重要记忆应尽可能保留：

- 来源；
- 依据；
- 时间；
- 置信度；
- 修订关系。

避免把 LLM 一次推断直接升级成不可质疑事实。

---

# 13. Hikari 不依赖单一 Agent Loop

Hikari 的存在不能依赖用户发起一次对话。

未来允许存在多个平级行为循环，例如：

```text
Conversation Loop
Perception / Awareness Loop
Goal Loop
Maintenance / Assimilation Loop
```

这些循环通过 Service、Event、Durable Fact 与 Capability 协作。

禁止出现必须接管所有行为的 Super Orchestrator。

Orchestrator 如果存在，也必须是可替换应用逻辑，而不是 Host Runtime 基础设施。

---

# 14. Perception ≠ Awareness

感知 Provider 只回答：

> 我观察到了什么？

Awareness 才负责：

> 这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？

推荐思路：

```text
世界变化
↓
Perception Provider
↓
Observation
↓
事实标准化 / Contextualization
↓
Salience / Importance Judgement
↓
Ignore / Remember / Ask / Notify / Act
```

因此，不应把 Foreground、Calendar、DeviceActivity 等传感器集合本身称为完整 Awareness。

---

# 15. Presentation 独占最终自然语言表达

内部模块优先输出结构化事实、判断、结果与错误。

最终用户可见自然语言应由 Presentation 层负责。

推荐边界：

```text
Domain Result
↓
Presentation
↓
RenderedMessage
↓
Transport
```

Transport 负责运送消息，不负责解释人格、权限或记忆。

领域模块不应自行绕过 Presentation 直接向用户说话。

---

# 16. 跨设备应视为能力联邦，而不是多个独立 Hikari

Hikari 未来可能同时存在于：

- 云端；
- Windows Resident；
- 手机；
- 可穿戴设备；
- 其他边缘节点。

这些不是多个不同的 Hikari，而应视为同一连续存在的多个能力节点。

节点上线时可以公布能力：

```text
desktop.observe
desktop.act
filesystem
shell
voice
notification
...
```

节点离线时，相应 Provider 消失，依赖这些 Provider 的能力应按生命周期机制收敛，而不是让上层持有失效对象。

---

# 17. 防止任何形式的 God Object / 章鱼化

不仅要防止 Runtime 章鱼化，也要防止未来出现：

- Super Orchestrator；
- Memory God Object；
- Awareness God Object；
- Global State Manager；
- Central AI Brain；
- 一个“方便访问所有东西”的万能 Service。

审查信号：

如果某模块开始：

- import 大量领域模块；
- 理解多个领域语义；
- 持有多个领域数据库；
- 成为所有调用的必经中转；
- 出现大量按模块名/事件名分支；

应立即重新检查 Ownership 是否失衡。

---

# 18. 不做宗教式解耦

严格边界不等于所有调用都改成事件。

避免：

```text
为了“解耦”
→ 一个简单直接调用被拆成十几个 topic
→ 无法追踪因果
→ Debug 变得困难
```

判断口诀：

```text
“我需要你的能力”
→ Service

“我告诉你发生了什么”
→ Event

“未来必须证明这件事发生过”
→ Chronicle

“我要改变现实世界”
→ Action Pipeline
```

优先使用最直接且语义正确的通信方式。

---

# 19. Research Before Build

Hikari 是我们第一次系统性处理大量异构数据融合、长期连续状态、跨设备能力与主动行为的问题。

因此重要新子系统默认遵循：

```text
明确问题
↓
寻找已有项目 / 标准 / 论文 / 协议
↓
研究架构边界与失败经验
↓
区分可直接借鉴的机制与领域特有假设
↓
形成 Hikari 自己的设计决策
↓
再开始实现
```

优先研究：

- 成熟开源项目；
- 相邻领域系统；
- 标准与协议；
- Architecture Decision Records；
- Issue / Postmortem / 失败经验；
- 必要时论文与工程博客。

不要因为某个项目知名就直接照搬。

每次研究最好明确输出：

```text
【外部项目事实】
它实际上怎么做

【我们的理解】
为什么它可能这样设计

【Hikari 决策】
我们采用什么、不采用什么、为什么
```

原则：

> 在发明之前先调查，在借鉴之前先理解，在采用之前重新验证是否符合 Hikari 的目标。

---

# 20. 研究结果不能凌驾于 Hikari 的灵魂

DSH、Cordis、ROS、Home Assistant 或其他系统都只能提供机制与经验。

Hikari 的目标函数与它们不同。

任何外部架构模式采用前都必须重新验证：

```text
它是否帮助持续在场？
它是否保护连续性？
它是否支持成长？
它是否增强可信行动能力？
它是否保持模块自治？
它是否让 Hikari 更容易成为长期存在，而不是更像一个普通 Agent Framework？
```

如果答案是否定的，则即使外部方案成熟，也不应照搬。

---

# 21. 架构原则必须通过代码与测试执行

文档不是足够的边界。

后续实现应考虑把关键原则做成可执行约束，例如：

- forbidden imports；
- architecture tests；
- contract tests；
- plugin conformance tests；
- capability exposure tests；
- action governance tests；
- durable fact / replay invariants；
- Presentation boundary tests；
- dependency graph snapshots。

核心目标：

> 不让未来的维护者仅靠“记得架构原则”来防止退化。

---

# 22. 当前架构判断口诀

在写一个新模块、Service、Event、Fact 或 Action 之前，先问：

```text
这个模块真正拥有什么？

它依赖的是能力，还是某个具体实现？

这是同步能力调用、实时通知、持久事实，还是外部副作用？

这件事应该由谁决定策略？

Runtime 是否开始理解业务语义？

有没有绕开 Action Pipeline？

有没有把 Memory 当成事实？

是否出现新的中央章鱼？

这个问题是否已有成熟项目值得先研究？

最终是否仍然符合 Hikari 的核心目标？
```

如果这些问题回答不清楚，优先暂停实现并重新设计边界。

---

# 23. 当前最核心的十条

如果未来只保留一页摘要，至少保留以下十条：

1. **严格模块边界，Ownership 优先于目录形式。**
2. **Service、Event、Chronicle、Action Pipeline 分工明确。**
3. **Runtime owns mechanism, never policy.**
4. **能力存在、能力暴露、权限允许、真实执行是不同层次。**
5. **真实副作用必须统一经过 Action Pipeline，并产生 Receipt。**
6. **重要状态应尽量从可追溯事实中派生。**
7. **Memory 是解释，不是绝对真源。**
8. **防止 Runtime、Orchestrator、Memory、Awareness 等任何形式的 God Object。**
9. **Research Before Build，参考项目但不盲目照搬。**
10. **所有设计最终接受 Presence、Continuity、Growth、Agency、Trust 的检验。**

---

## 后续

本文目前只定义原则，不定义最终模块图、技术栈或目录结构。

下一步应基于：

```text
Hikari Soul
+
DSH Architecture Research
+
Architecture Principles
↓
Hikari Overall Architecture
↓
Module Ownership
↓
Contracts
↓
Implementation
```

在总体架构与 Ownership 明确之前，不应急于创建大量实现目录或固定技术结构。
