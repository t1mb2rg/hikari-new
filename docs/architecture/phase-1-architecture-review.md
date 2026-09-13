# Hikari 第一阶段 Runtime Architecture Review

> 结论：**Functional PASS + Architecture PASS**
>
> 范围：单 Runtime、本地进程内的 Plugin / Service / Event / Effect 基础。

## 1. Functional Review

当前实现已经验证：

- Plugin 可以加载、启动、等待、停止和卸载；
- Plugin 资源能够随生命周期清理；
- `requires / provides` 能形成硬 Service 依赖；
- Consumer 在依赖缺失时保持等待；
- Provider 出现后 Consumer 自动激活；
- Provider 消失时依赖它的活动 Plugin 先收敛；
- Provider 恢复后 Consumer 可以重新激活；
- Service 可以进行带返回值的数据调用；
- Event 可以通知多个订阅者；
- Event 订阅会随 Plugin 卸载自动清理；
- Plugin 配置在进入生命周期前完成验证；
- 未声明的 Service 依赖与未声明的 Service 提供会被 Runtime 拒绝。

本地测试：6 / 6 PASS。

GitHub Actions：Node.js 24 下安装、编译、测试全部 PASS。

**Functional PASS。**

## 2. Runtime 边界

Runtime 当前只理解：

- Plugin 生命周期状态；
- Service 契约和 Provider 注册；
- Service 硬依赖是否满足；
- Event 订阅和派发；
- Effect Scope 与资源清理；
- Plugin 基础配置验证。

Runtime 不理解：

- Memory；
- Goal；
- World；
- 用户；
- 人格；
- 语音；
- 工程；
- Provider 的业务优先级。

**PASS。Runtime 没有吸收 Hikari 领域语义。**

## 3. Plugin 模型

实现中只有一个 `PluginDefinition`。

没有出现：

- AgentPlugin；
- VoicePlugin；
- SensorPlugin；
- StatePlugin；
- 其他业务继承树。

Plugin 的差异继续通过 `requires / provides / Event / 内部逻辑` 自然表达。

**PASS。**

## 4. Service / Capability 边界

当前只有一套 Service Registry。

没有建立第二套 Capability Registry，也没有维护重复真源。

Service Contract 只保存契约身份和类型关系；Provider 的实际对象由 Plugin 在运行时注册。

当前 v0 故意只允许同一 Service 契约存在一个活动 Provider。出现第二个 Provider 时直接拒绝，不引入通用智能选择器。

**PASS。**

## 5. Service / Event 分离

Service：

- 承担明确能力调用；
- 可以传入数据并返回结果；
- 决定 Plugin 的硬生命周期依赖。

Event：

- 只负责实时通知；
- 不承担普通查询；
- 不模拟请求 / 响应；
- 不参与硬依赖满足。

没有万能 Message / Envelope / Bus 抽象。

**PASS。**

## 6. 依赖边界

Runtime 对 Service 调用增加了两道实际护栏：

- Consumer 只能 `get()` 自己在 `requires` 中声明的 Service；
- Provider 只能 `provide()` 自己在 `provides` 中声明的 Service。

因此依赖关系不仅存在于文档，也由代码执行时验证。

**PASS。**

## 7. 资源所有权

Service 注册、Event 订阅和 Plugin 自己登记的清理函数都进入该 Plugin 的 Effect Scope。

Plugin 停止时按逆序清理；单个清理失败不会阻止剩余资源继续释放。

Provider 下线时先停依赖 Consumer，再释放 Provider 自身资源，使 Consumer teardown 仍可以在 Provider 有效时完成。

**PASS。**

## 8. 没有提前实现未来架构

本阶段没有加入：

- 跨 Runtime；
- RPC / 网络；
- 远程 Provider；
- 节点握手；
- Provider 智能调度；
- 全局状态中心；
- Entity / Subject / Scope 通用模型；
- Chronicle / Memory / Goal；
- 完整权限体系；
- 流式音视频资源。

**PASS。**

## 9. 当前刻意保留的限制

以下是 v0 的有意限制，不作为缺陷提前抽象：

- 一个 Service 契约当前只能有一个活动 Provider；
- 当前只有硬依赖，没有可选 Service 依赖模型；
- Plugin 进入 `failed` 后不会自动无限重试，需要卸载 / 重新加载；
- 配置 Schema 当前只是 `parse(input)` 的极薄契约，不绑定具体 Schema 库；
- 任务取消、长期后台任务管理等机制等真实 Plugin 需要时再扩展；
- Event 是否需要更丰富的派发语义，等待真实插件验证。

这些限制只有在真实实现被阻塞时才触发新的 Boundary Review。

## 10. 最终结论

第一阶段代码没有发现对 `core-architecture-v0.md` 的结构性穿透。

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

因此第一阶段 Runtime 基础可以正式收口。

> 第一阶段已经证明：Hikari 可以先拥有一个很薄的运行生命结构，而不需要中央大脑、万能通信层或业务插件类型树。
