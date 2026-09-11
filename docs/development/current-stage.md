# Hikari 当前阶段开发说明

> 状态：新架构奠基期
>
> 目的：记录当前阶段的设计共识与后续实现约束。长期原则仍以 `docs/architecture/principles.md` 为准。

## 当前推导顺序

```text
Hikari Soul
+
Research
+
Architecture Principles
↓
Domain Dependency Graph
↓
Module Ownership
↓
Contracts
↓
Runtime / Plugin / Capability Model
↓
Implementation
```

当前阶段重点是把核心领域之间的语义依赖方向搞清楚。在这些边界稳定之前，不急于大规模创建 `src/` 或固定具体实现。

## Runtime / Plugin / Capability / Skill

当前约定：

- Runtime 是薄运行宿主，只负责生命周期、Service、Event、Scope、Effect、调度与通用资源机制；
- Plugin 是 Runtime 管理的自治功能单元；
- Capability 表示系统“能够做什么”，并与具体 Provider 解耦；
- Skill 暂定为更高层的认知包装，不是 Runtime 基础原语；
- Tool 是 Capability / Skill 面向模型暴露的一种方式。

概念关系：

```text
Runtime
→ Plugin
→ Capability
→ Skill（可选）
→ Tool（可选）
```

## 当前核心领域候选

```text
Continuity
Chronicle
Perception
World / Context
Memory / Learning
Judgement / Goal
Authority
Action
Presentation
```

下一步需要明确：

- 谁可以依赖谁；
- 谁只能通过 Contract 消费谁；
- 哪些方向禁止反向依赖；
- 哪些交互属于 Service；
- 哪些交互属于 Event；
- 哪些事实必须进入 Chronicle；
- 哪些副作用必须进入 Action Pipeline。

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

Plugin / Capability 的设计同样遵循 Research Before Build：

```text
明确问题
↓
检查已有 Hikari Capability
↓
研究外部成熟项目 / 标准 / 协议
↓
理解边界与失败经验
↓
形成 Hikari 决策
↓
再实现
```

## 当前阶段暂不做

暂不急于：

- 大规模创建 `src/`；
- 固定最终语言 / 框架；
- 实现具体 QQ / Windows / Codex Provider；
- 设计完整 Skill Library；
- 写死 Plugin Manifest 最终格式。

## 进入实现前至少要回答

1. Hikari 的核心领域边界是什么？
2. Core-like Domain Dependency Graph 是什么？
3. 哪些依赖方向允许，哪些禁止？
4. Runtime 与 Domain 的边界是什么？
5. Plugin、Capability、Skill、Tool 分别是什么？
6. Plugin Contract 如何做到机器可读和可验证？

> 当前阶段的目标不是尽快堆积能力，而是先设计一种让能力能够长期、规范、可验证地扩展的工程基础。
