# Hikari 当前阶段开发说明

> 状态：新架构奠基期
>
> 目的：记录当前阶段的设计共识与后续实现约束。长期原则仍以 `docs/architecture/principles.md` 为准，当前架构检查点见 `docs/architecture/core-architecture-v0.md`。

## 当前推导顺序

```text
Hikari Soul
+
Research
+
Architecture Principles
↓
核心生态架构
↓
领域 Ownership / 契约
↓
Runtime / Plugin / Capability Model
↓
最小实现
↓
阶段复盘
```

当前阶段重点不再是设计一个中央 Core，而是明确：

- 哪些语义必须长期稳定；
- 哪些活动应该局部自治；
- 哪些交互应走服务、事件、事实史或行动管线；
- 哪些正确性必须由执行边界保证，而不能依赖中央调度。

在这些边界稳定之前，不急于大规模创建 `src/` 或固定具体实现。

## Runtime / Plugin / Capability / Skill

当前约定：

- Runtime 是薄运行宿主，只负责生命周期、Service、Event、Scope、Effect、调度与通用资源机制；
- Plugin 是 Runtime 管理的运行单元，可以承载能力、自治过程或桥接逻辑；
- Capability 表示系统“能够做什么”，并与具体 Provider 解耦；
- Skill 暂定为更高层的认知包装，不是 Runtime 基础原语；
- Tool 是 Capability / Skill 面向模型暴露的一种方式。

重要修正：

> Hikari 整体不是一个 Agent Loop，也不存在必须统一处理所有判断的中央 Judgement。

判断被视为自治插件内部的局部活动或能力。

传统 Agent Loop 可以作为某个自治插件内部的一种实现方式。

## 当前共享语义候选

```text
Continuity
Chronicle
World Views
Memory / Learning
Goal / Commitment
Authority
Action
Presentation
```

其中：

- Continuity 定义同一个 Hikari 的连续身份；
- Chronicle 保存长期事实及其来源、顺序和因果；
- World 不是单一全局状态，而是一组有范围的当前世界视图；
- Memory 是可修订的长期理解；
- Goal 是跨时间承诺，不等于一次判断；
- Authority 约束“允许做什么”；
- Action 负责真实外部副作用；
- Presentation 负责最终用户可见表达。

自治活动可以包括：

```text
Perception / Awareness Loop
Goal Loop
Conversation Loop
Engineering Loop
Maintenance Loop
Memory Assimilation Loop
```

这些不是固定最终清单，而是当前用于验证“局部自治、没有中央大脑”的行为形态。

## 当前交互方式

当前明确放弃“所有东西都经过统一通信信封 / 万能消息协议”的方向。

只保留少数语义清楚的交互方式：

```text
需要能力
→ Service

通知变化
→ Event

未来必须证明发生过
→ Chronicle / Durable Fact

需要改变现实
→ Action Pipeline
```

“通信平面”只是架构统称，不要求实现一个统一的 `CommunicationLayer`。

本地交互优先保持本地语义；跨节点传输、认证、序列化等能力应尽量下沉到底层适配，不污染插件业务代码。

## 多自治协调的当前原则

当前不追求一个全局最优调度器。

原则：

> 调度负责效率，执行校验负责正确性。

当前已经形成的约束：

```text
意图可以等待
↓
轮到执行时重新读取当前状态
↓
目标已经满足 → 直接结束
↓
仍需行动 → 生成当前动作
↓
授权 + 前置条件 + 必要的状态版本验证
↓
执行
```

状态版本应保持局部，不设计全 Hikari 的单一全局版本号。

资源租约、占用代次等更复杂机制暂时只做架构预留，等真实出现跨节点资源竞争再研究和实现。

## Plugin 体系必须为未来自动化工程工具准备

这是当前阶段必须保留的长期设计要求。

Plugin 体系不能只依靠隐式约定或“读已有源码照着写”。未来的工程自动化工具需要能够直接读取、理解和验证 Plugin 规范。

因此后续 Plugin 体系应同时具备：

1. 面向人类的开发文档；
2. 面向机器的 Manifest / Schema；
3. 明确的 Capability / Dependency 声明；
4. 可执行的 Contract / Lifecycle / Architecture 验证；
5. 稳定的 Plugin SDK 或模板。

原则：

> 人类文档负责解释语义，机器可读 Schema 负责验证边界。

### Capability Discovery

新增能力前，应先检查是否已有可复用的 Capability Contract。

```text
需要能力
↓
检查已有 Capability
↓
已有 → 优先增加 Provider / Consumer
没有 → 再讨论新增 Capability Contract
```

例如已经存在 `shell.execute` 时，新的远程执行实现应优先作为新的 Shell Provider，而不是重复创造语义近似的能力名称。

### Plugin Validation

后续应设计统一的 Plugin Conformance / Validation 机制，至少覆盖：

- Manifest / Schema validation；
- forbidden import / architecture checks；
- dependency declaration checks；
- lifecycle tests；
- Effect / resource cleanup tests；
- Service / Event contract tests；
- Scope / permission tests；
- clean shutdown tests；
- failure containment tests。

Plugin 是否遵守边界，应尽量由规则与测试证明，而不是依靠人工阅读源码判断。

### 后续文档方向

当 Runtime / Plugin Contract 开始进入实现阶段时，需要形成正式的 Plugin Development 文档集，方向暂定：

```text
docs/plugin-development/
├─ overview.md
├─ plugin-contract.md
├─ capability-design.md
├─ manifest-spec.md
├─ lifecycle.md
├─ permissions.md
└─ conformance-testing.md
```

当前阶段先记录需求，不提前写死 Plugin API 或 Manifest 最终格式。

## Research Before Build

Plugin / Capability 及重要基础机制的设计继续遵循 Research Before Build：

```text
明确问题
↓
检查已有 Hikari Capability / Contract
↓
研究外部成熟项目 / 标准 / 协议
↓
理解边界与失败经验
↓
形成 Hikari 决策
↓
只实现当前阶段真正需要的最小机制
↓
复盘
```

## 当前阶段暂不做

暂不急于：

- 大规模创建 `src/`；
- 固定最终语言 / 框架；
- 实现具体 QQ / Windows / Codex Provider；
- 设计完整 Skill Library；
- 写死 Plugin Manifest 最终格式；
- 第一版就完成完整多节点部署；
- 第一版就完成分布式租约、离线同步、完整节点信任系统；
- 建立统一万能通信协议。

## 进入实现前至少要回答

1. Hikari 的核心共享语义和自治活动边界是什么？
2. Runtime 与 Domain / Plugin 的边界是什么？
3. Service、Event、Chronicle、Action 分别解决什么问题？
4. Plugin、Capability、Skill、Tool 分别是什么？
5. 哪些动作需要状态重新验证，状态版本的粒度如何确定？
6. Plugin Contract 如何做到机器可读和可验证？
7. 第一版最小 Runtime + Plugin 骨架需要实现哪些机制，哪些只做架构预留？

> 当前阶段的目标不是尽快堆积能力，而是先设计一种让 Hikari 能够长期存在、局部自治、规范扩展，并且不会因为任何单一模块便利而重新长成中央大脑的工程基础。
