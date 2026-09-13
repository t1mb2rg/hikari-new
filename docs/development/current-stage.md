# Hikari 当前阶段开发说明

> 状态：**核心架构 v0 已冻结，进入实现准备阶段**
>
> 长期原则以 `docs/architecture/principles.md` 为准；v0 当前实现边界以 `docs/architecture/core-architecture-v0.md` 与 `docs/architecture/v0-boundary-review.md` 为准。

---

## 当前结论

核心架构已经通过第一轮 Boundary Review。

当前不再继续扩张核心抽象，而开始验证最小运行生态：

```text
Runtime
+ Plugin
+ Service
+ Event
+ 生命周期 / 资源清理
```

第一阶段目标不是迁移旧 Hikari，也不是直接实现完整 Awareness、Memory、Goal 或多节点系统。

目标是证明新的插件运行基础可以稳定工作，并且不会重新长成中央大脑、万能通信层或业务类型树。

---

## 第一阶段实现范围

允许实现：

1. Runtime 最小骨架；
2. Plugin 生命周期；
3. 最小 Plugin Definition / Manifest；
4. Service 注册、发现与依赖满足；
5. Event 注册与派发；
6. Effect / 资源归属与自动清理；
7. 用于验证机制的测试插件；
8. 自动化测试。

暂不实现：

- 跨 Runtime 通信；
- 节点网络协议；
- 远程 Provider；
- 完整 Capability Registry；
- Provider 智能选择；
- 完整权限系统；
- Chronicle / Memory / World / Goal 的完整领域实现；
- 完整 Skill / Tool 体系；
- 旧 Hikari 大规模迁移。

---

## v0 插件模型

Runtime 只认识一种 Plugin。

不建立：

```text
AgentPlugin
VoicePlugin
SensorPlugin
StatePlugin
...
```

插件差异由它提供、依赖和监听的契约以及内部逻辑体现。

最小声明目前只需要表达：

```text
id
version
requires
provides
config schema
```

具体文件格式在实现设计阶段决定，不在核心架构阶段继续推演。

---

## v0 交互模型

```text
需要能力
→ Service

通知变化
→ Event

长期事实
→ Chronicle（后续领域阶段）

真实副作用
→ Action（后续领域阶段）
```

第一实现阶段只需要真正完成 Service 与 Event。

必须保持：

- Service 承担主要有返回值的数据调用；
- Event 只承担实时通知；
- 不设计万能消息对象；
- 不要求同 Runtime 内调用序列化或经过网络式通信层。

---

## 下一步

进入编码前只做一次短的实现设计讨论：

1. 第一版语言与工具链；
2. 最小目录结构；
3. 测试框架；
4. Runtime / Plugin / Service / Event 的第一组接口；
5. 第一阶段验收命令。

完成后即可创建代码骨架。

不再继续讨论未来多节点、对象作用域、复杂 Provider 选择等问题，除非真实实现证明当前模型无法表达需求。

---

## 开发纪律

每个重要阶段遵循：

```text
Boundary Review
↓
实现 + 测试
↓
Architecture Review
↓
文档 / 契约更新
```

阶段通过标准：

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

如果实现中发现当前边界不成立，不允许用隐藏依赖或临时特例绕过，应暂停实现并重新审查架构。

> 当前策略：让真实代码开始反过来教育架构。
