# Hikari v0 Boundary Review

> 结论：**PASS，可进入实现准备**
>
> 范围：仅审查 Hikari v0 第一阶段需要的边界，不继续展开多节点、复杂权限、远程传输等未来问题。

---

## 1. 本轮审查目标

确认当前架构是否已经足够支持第一阶段实现，同时避免继续提前设计未来问题。

第一阶段目标不是“实现完整 Hikari”，而是验证：

```text
Runtime
+ Plugin
+ Service
+ Event
+ 生命周期 / 资源清理
```

这组最小机制能否稳定承载未来的 Hikari 领域插件。

---

## 2. Ownership 审查

### Runtime

拥有：

- 插件生命周期；
- Service 注册与依赖；
- Event 派发；
- 资源归属与清理；
- 基础配置验证。

不得拥有：

- Memory / Goal / World 领域状态；
- 用户语义；
- Provider 业务选择策略；
- 自治判断；
- 人格表达。

**结果：PASS**

### Plugin

拥有自己的实现状态、资源与业务逻辑。

只通过公开 Service / Event / 后续领域契约与其他插件协作。

**结果：PASS**

### Service

拥有稳定能力契约，不拥有具体实现。

Provider 承担实现。

**结果：PASS**

### Event

只承担实时变化通知，不替代查询、Service 或 Chronicle。

**结果：PASS**

---

## 3. 依赖方向审查

允许：

```text
Plugin -> Service Contract
Plugin -> Event Contract
Runtime -> Plugin lifecycle interface
Runtime -> generic service/event primitives
```

禁止：

```text
Plugin A -> Plugin B internal implementation
Runtime -> Hikari domain semantics
Domain -> concrete Provider implementation
Event -> universal request/response mechanism
```

**结果：PASS**

---

## 4. 通信机制审查

当前不建立统一通信层。

```text
需要能力 -> Service
通知变化 -> Event
长期事实 -> Chronicle
改变现实 -> Action
```

Service 承担主要数据流，Event 只承担通知。

同 Runtime 内允许直接进程内调用，不强制序列化、信封、消息总线化。

**结果：PASS**

---

## 5. 类与类型爆炸风险审查

### 已阻断的风险

- 不建立 AgentPlugin / VoicePlugin / SensorPlugin 等业务基类树；
- 不要求每个操作成为一个独立 Service；
- 不把查询设计成 request/response Event；
- 不把插件内部状态升级成公共 Event；
- 不维护与 Service 重复的 Capability 真源。

### 保留的增长方式

允许增长：

- Plugin 数量；
- Provider 数量；
- Service 契约数量；
- 有真实跨插件价值的 Event 数量。

要求稳定：

- Runtime 原语；
- Plugin 生命周期模型；
- Service / Event 的基本语义。

**结果：PASS**

---

## 6. 分布式复杂度审查

v0 不实现：

- 跨 Runtime 调用；
- 网络协议；
- 节点握手；
- 远程 Provider；
- 多节点能力目录同步；
- 密码学身份；
- 离线同步；
- 分布式锁、租约或 fencing。

但当前 Service / Provider 分离没有堵死以后增加远程适配的路径。

**结果：PASS**

---

## 7. 全局中心化风险审查

当前明确拒绝：

- GlobalWorldState；
- Central Judgement；
- Super Orchestrator；
- Universal Provider Selector；
- Universal Message；
- Global Capability Brain。

没有发现 v0 必须依赖上述结构的理由。

**结果：PASS**

---

## 8. 第一实现阶段允许做什么

第一阶段只允许实现：

1. Runtime 最小骨架；
2. Plugin 生命周期；
3. 最小 Manifest / Definition；
4. Service 注册、发现、依赖满足；
5. Event 注册与派发；
6. 插件资源 / Effect 清理；
7. 测试插件；
8. 对上述机制的自动化测试。

测试至少覆盖：

- Plugin 正常加载 / 卸载；
- Service Provider 注册与调用；
- 必需 Service 缺失时 Consumer 不错误启动；
- Provider 消失后的依赖收敛；
- Provider 恢复后的重新激活；
- Event 多订阅者通知；
- 插件卸载后监听器 / 任务 / 资源不泄漏；
- Service 可以直接传递有返回值的数据；
- Runtime 不需要理解测试 Service 的业务意义。

---

## 9. 第一阶段明确禁止做什么

实现过程中不得顺手加入：

- 多节点网络通信；
- 通用 RPC 框架；
- Capability 第二注册表；
- Provider 智能调度器；
- 全局状态中心；
- 完整权限系统；
- Chronicle / Memory / Goal 的完整业务实现；
- 旧 Hikari 大规模迁移；
- 为未来音频 / 视频提前设计流式资源框架。

如果实现真的被其中某项阻塞，停止编码，重新做边界审查。

---

## 10. 当前剩余的唯一实现前工程决策

核心架构已经足够稳定。

进入代码前仍需要做一次非常短的工程决策：

- 第一版使用的语言 / 工具链；
- 最小仓库目录；
- 测试框架；
- Runtime 与 Plugin 的第一组接口名称。

这些属于 **实现设计**，不是继续扩张核心架构。

---

## 11. 最终结论

**Architecture PASS。**

当前没有发现必须继续进行核心架构推演的阻塞项。

下一阶段应让真实实现开始提供反馈，而不是继续从纯理论中增加抽象。

> **先实现最小运行生态，再让代码告诉我们下一处真正的边界在哪里。**
