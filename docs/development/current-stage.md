# Hikari 当前阶段开发说明

> 状态：**第一阶段 Runtime 基础完成，Functional PASS + Architecture PASS**
>
> 长期原则以 `docs/architecture/principles.md` 为准；v0 架构边界以 `docs/architecture/core-architecture-v0.md` 为准；第一阶段实现与复盘见 `docs/development/phase-1-runtime.md` 与 `docs/architecture/phase-1-architecture-review.md`。

---

## 当前结论

第一阶段已经完成新的最小运行生态：

```text
Runtime
+ Plugin
+ Service
+ Event
+ Effect / 资源清理
+ 基础配置验证
```

这一阶段没有迁移旧 Hikari，也没有实现完整 Awareness、Memory、Goal、Chronicle 或多节点系统。

当前已经证明：新的 Plugin 运行基础可以稳定工作，并且没有重新长成中央大脑、万能通信层或业务类型树。

---

## 已实现

### Runtime

负责：

- Plugin 加载、启动、等待、停止与卸载；
- Service 注册、发现与硬依赖满足；
- Event 注册与派发；
- Effect / 资源归属与自动清理；
- Plugin 基础配置验证。

### Plugin

Runtime 只认识一种 `PluginDefinition`。

当前最小声明：

```text
id
version
requires
provides
config schema（可选）
setup
```

不建立 AgentPlugin / VoicePlugin / SensorPlugin 等业务继承树。

### Service

- Service 承担主要有返回值的数据调用；
- Consumer 只能使用自己声明的 `requires`；
- Provider 只能提供自己声明的 `provides`；
- 缺失依赖时 Consumer 等待；
- Provider 出现后自动激活；
- Provider 消失时依赖关系自动收敛；
- Provider 恢复后 Consumer 可以重新激活。

当前第一版故意只允许一个 Service 契约存在一个活动 Provider。

### Event

- Event 只承担实时通知；
- 支持多个订阅者；
- 订阅随 Plugin 生命周期自动清理；
- 不承担普通查询，也不模拟 Service 请求 / 响应。

---

## 验收状态

本地自动化测试：**6 / 6 PASS**。

GitHub Actions：Node.js 24 下安装、编译、测试全部 **PASS**。

第一阶段 Architecture Review：**PASS**。

第一阶段正式架构地图已经建立并纳入仓库：

```text
docs/diagrams/phase-1-runtime.architecture.json
docs/diagrams/phase-1-runtime.html
```

其中 `.architecture.json` 是 Archify 可维护的架构源模型，`.html` 是独立、可交互的人类可读架构视图。

Archify `showcase` 校验结果：**9 / 9 checks PASS，0 errors，0 warnings，repository evidence verified**。

自动浏览器 `visual-check` 当前不作为阶段阻塞条件；现有机器上的 Edge DevTools 自动检查仍有兼容性问题，但确定性 `validate` / `deliver` 已通过，HTML 已人工打开并可正常交互。

阶段标准：

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

已满足。

---

## 当前明确仍不做

- 跨 Runtime 通信；
- 节点网络协议；
- 远程 Provider；
- Capability 第二注册表；
- Provider 智能选择；
- 全局状态中心；
- 完整权限系统；
- Chronicle / Memory / World / Goal 的完整领域实现；
- 完整 Skill / Tool 体系；
- 音视频流式资源框架；
- 旧 Hikari 大规模迁移。

这些问题继续服从冻结规则：没有真实实现问题，不提前增加抽象。

---

## 下一阶段原则

第一阶段 Runtime 地基已经完成。

下一阶段不能直接继续堆功能，仍然需要先做一次新的 Boundary Review，明确首个真实 Hikari 领域 / 插件应该验证什么。

优先目标应该是：

> 用真实 Hikari 需求开始检验这套 Plugin / Service / Event 基础，而不是继续从纯理论中扩展 Runtime。

候选方向可以包括连续性、事实史或一个足够小的真实能力插件，但需要在下一阶段开始前重新讨论边界。

---

## 开发纪律

继续遵循：

```text
Boundary Review
↓
实现 + 测试
↓
Architecture Review
↓
文档 / 契约更新
```

如果真实实现暴露当前边界不成立，不允许用隐藏依赖或临时特例绕过，应暂停实现并重新审查架构。

> 当前策略：让真实代码继续反过来教育架构。
