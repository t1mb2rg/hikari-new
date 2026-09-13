# Hikari 第一阶段 Runtime 基础实现

> 状态：已实现 / 待实现后复盘
>
> 范围：单 Runtime、本地进程内插件生态。

## 1. 工程选择

第一阶段采用：

- TypeScript；
- Node.js 22+；
- TypeScript 严格模式；
- Node.js 内置 `node:test` 作为测试框架。

选择原则是：优先保证 Plugin / Service 契约的类型清晰，同时尽量减少第一阶段依赖。

## 2. 当前目录

```text
src/
├─ index.ts
└─ runtime/
   ├─ contracts.ts
   ├─ effect-scope.ts
   ├─ errors.ts
   ├─ event-bus.ts
   ├─ plugin.ts
   ├─ plugin-context.ts
   ├─ runtime.ts
   └─ service-registry.ts

test/
└─ runtime.test.mjs
```

## 3. 已实现机制

### Plugin

Runtime 只认识一种 Plugin。

Plugin Definition 当前包含：

- `id`；
- `version`；
- `requires`；
- `provides`；
- 可选配置 Schema；
- `setup` 生命周期入口。

没有 AgentPlugin、VoicePlugin、SensorPlugin 等业务继承树。

### Service

- Service 由稳定契约标识；
- Provider 只能注册自己在 `provides` 中声明的 Service；
- Consumer 只能获取自己在 `requires` 中声明的 Service；
- 缺失硬依赖时 Plugin 保持 `waiting`；
- Provider 出现后 Consumer 自动激活；
- Provider 消失前先停用依赖它的 Consumer；
- Provider 恢复后等待中的 Consumer 可以重新激活。

第一阶段只允许一个 Service 契约存在一个活动 Provider；重复 Provider 会被拒绝。复杂多 Provider 选择仍按冻结架构延后。

### Event

- Event 与 Service 分离；
- Event 支持多个订阅者；
- Event 订阅归属于 Plugin 生命周期；
- Plugin 卸载后订阅自动清理；
- Event 不用于模拟 Service 请求 / 响应。

### Effect / 资源清理

Plugin 可以通过 `defer()` 将清理函数登记到自己的 Effect Scope。

卸载时按逆序清理资源；即使某个清理失败，也会继续执行剩余清理，并最终汇总错误。

Service 注册与 Event 订阅本身也归属于 Plugin 的 Effect Scope。

### 配置验证

Plugin 可以提供极薄的配置 Schema：

```text
parse(input) -> validated config
```

Runtime 在 Plugin 进入生命周期前完成验证。验证失败时 Plugin 不会被注册或启动。

## 4. 当前测试

当前本地实现已通过 6 个自动化测试：

1. Plugin 加载 / 卸载与资源清理；
2. Consumer 等待 Service、收到返回数据、Provider 消失后收敛、恢复后重新激活；
3. Event 多订阅者通知与生命周期清理；
4. 未声明 Service 依赖被 Runtime 拒绝；
5. Runtime 无需理解 Service 的业务语义；
6. Plugin 配置在启动前验证并将解析结果传给 Plugin。

GitHub Actions 已配置在 push / pull request 时执行 `npm test`。

## 5. 本阶段明确没有实现

仍然没有：

- 跨 Runtime 调用；
- 网络 / RPC；
- 远程 Provider；
- Capability 第二注册表；
- Provider 智能选择；
- 全局状态中心；
- 完整权限系统；
- Chronicle / Memory / Goal 业务实现；
- 音视频流式资源框架；
- 旧 Hikari 功能迁移。

这些继续服从 `core-architecture-v0.md` 的冻结规则。

## 6. 实现原则

第一阶段代码的目标不是尽快拥有大量功能，而是验证：

> Plugin 能否在一个薄 Runtime 中按照公开 Service / Event 契约形成稳定、可收敛、可清理的运行关系。

如果后续真实 Plugin 暴露当前模型无法表达的问题，再重新做 Boundary Review，而不是提前增加抽象。
