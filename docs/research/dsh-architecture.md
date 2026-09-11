# DeepSeek Harness / Cordis 架构研究笔记

> 状态：研究记录
>
> 目的：记录我们对 DeepSeek Harness（DSH）与 Cordis 插件体系的理解，为 Hikari 新架构提供可追溯的设计参考。
>
> 原则：本文明确区分 **DSH 的事实**、**我们的架构理解**、**对 Hikari 的启发**。后续设计不得把三者混为一谈。

---

## 0. 为什么研究 DSH

Hikari 的目标不是做一个只在用户发消息时才存在的聊天机器人，而是构建一个长期存在于数字环境中的 AI：能够持续感知变化、形成连续记忆、判断何时应该介入，并在具备权限和能力时真实完成事情。

因此，我们关心 DSH 并不是因为想直接把 Hikari 做成 DSH 的分支，也不是为了复制一个 Agent Framework，而是因为 DSH 在以下几个问题上给出了很成熟的工程答案：

- 插件如何拥有明确生命周期，而不是靠全局单例和启动顺序拼起来；
- 能力如何与具体实现解耦；
- 能力存在、能力暴露、能力允许执行之间如何分层；
- 一个 Agent 行为过程如何推进，但又不把所有责任塞进 Agent Loop；
- 已发生的事实如何独立于运行时生命周期持久存在；
- 一套运行机制如何通过组合形成多种不同产品形态。

本文重点研究这些结构性思想。

---

# 1. DSH 的总体分层

## 1.1 【DSH 事实】

DSH 建立在 Cordis 插件框架之上。其系统并不是一个固定业务内核加若干外挂插件，而是由一棵插件树组合得到。模型适配器、工具注册表、Session、Agent、Agent Loop、存储、沙箱、审批、Web 表层等都通过插件与 Service 组合。

从我们研究到的代码与文档来看，可以把主体结构概括为：

```text
Profile / Bundle / Patch
        ↓
Final Plugin Tree
        ↓
Cordis
Context / Service / Event / Fiber / Effect
        ↓
Capability Seams
Definition / Provider / Consumer / Policy
        ↓
Agent Layer
Inbox / Turn / Step / LLM / Tools
        ↓
Session
Append-only Events / Projection / Persistence
```

Cordis 本身保留一层非常薄的运行机制，但这层不理解 Agent、LLM、Memory、Tool、User 等业务语义。

## 1.2 【我们的理解】

DSH 最值得关注的并不是一句抽象的 “Everything is a Plugin”，而是下面这组更精确的关系：

```text
产品长什么样
→ 由组合决定

插件什么时候存在
→ 由依赖决定

能力由谁实现
→ 由 Provider 决定

能力谁能看到
→ 由 Consumer 与 Scope 决定

本次调用能否执行
→ 由 Policy / Guard / Approval 决定

行为如何推进
→ 由 Agent Loop 决定

发生过什么
→ 由 Session Event Log 决定
```

这使得 Runtime 不需要理解整个系统的业务含义。

## 1.3 【对 Hikari 的启发】

Hikari 应借鉴的是这种 **职责拆解方式**，而不是 DSH 的具体模块列表。

尤其需要坚持：

> Runtime 可以控制机制，但不能拥有业务意义。

也就是：

```text
Runtime owns mechanism, never policy.
```

后续 Hikari Runtime 如果开始理解诸如 Memory、Awareness、Goal、Persona、Engineering 等领域概念，应视为架构退化信号。

---

# 2. Cordis：插件的生命模型

## 2.1 【DSH 事实】Context

Cordis 的 `Context` 是插件看到的能力环境。

服务通常通过稳定 key 暴露，例如：

```text
ctx.llm
ctx.tools
ctx.sessions
ctx.shell
```

消费者依赖的是这个稳定能力 key，而不是某个具体实现类。

Context 不是简单的全局字典。它还承载：

- 服务可见性；
- 作用域；
- 隔离关系；
- 插件当前绑定的服务实现；
- 依赖合法性检查。

Cordis 会要求插件显式声明 `inject`。没有声明依赖却直接访问相应 Service，会被视为非法依赖。

## 2.2 【DSH 事实】Service

Service 表示一个插件向其他插件提供的能力。

例如：

```text
ctx.shell
```

表达的是“当前 Context 中存在 Shell 执行能力”，而不是指定必须由某个固定 Bash 实现负责。

Service 的注册与提供者 Fiber 绑定。提供者卸载时，对应 Service 也会撤销。

## 2.3 【DSH 事实】Fiber

每次插件被挂载，Cordis 会为它创建一个 Fiber。

Fiber 不是简单的“插件对象”，而是一次插件在某个能力环境中的运行生命。它包含：

- 父 Context；
- 声明的依赖；
- 当前绑定的服务实现；
- 生命周期状态；
- 由它拥有的 Effect；
- 子 Fiber。

典型状态包括：

```text
PENDING
  ↓
LOADING
  ↓
ACTIVE
  ↓
UNLOADING
  ↓
DISPOSED
```

启动失败时还可以进入失败状态。

## 2.4 【DSH 事实】依赖驱动生命周期

插件通过 `inject` 声明所需 Service。

如果依赖不完整：

```text
Plugin
requires A + B + C

A ✅
B ✅
C ❌

→ Plugin 不启动
```

当 C 出现：

```text
依赖满足
→ Fiber 激活
```

当 C 消失：

```text
依赖不再满足
→ Fiber 卸载
```

当同名 Service 的具体 Provider 被替换时，Cordis 也会让依赖它的 Fiber 重建生命周期。

## 2.5 【DSH 事实】epoch

Cordis 会把当前依赖的具体 Provider Fiber 身份编码进 Fiber 的 `epoch`。

例如：

```text
llm      → Fiber #17
storage  → Fiber #32

consumer epoch ≈ :17:32
```

如果 Storage Provider 被 Fiber #48 替代：

```text
:17:32
→
:17:48
```

即使 Service 名仍然叫 `storage`，Consumer 也会感知其依赖世界已经变化，并经过卸载、重新绑定、再激活。

这避免了运行中的插件静默切换到新实现，造成生命周期内部状态不一致。

## 2.6 【我们的理解】

这里最值得提炼的一句话是：

> **能力图决定生命，生命拥有资源。**

插件是否应该存在，不再主要由中央 Boot Manager 手工编排，而由它所需要的能力当前是否存在决定。

同时，一个 Fiber 生命周期内部使用的是明确的依赖快照，而不是每次调用时随机从全局表里拿“当前最新实现”。

因此整个系统可以在整体上动态变化，同时让每一次插件生命内部保持相对稳定和可解释。

## 2.7 【对 Hikari 的启发】

这一模型非常适合 Hikari 的跨设备能力。

例如未来 Windows Resident 在线时可以提供：

```text
desktop.observe
desktop.act
filesystem
shell
```

设备离线时，这些 Provider 消失。

依赖这些能力的插件或行为组件可以自然进入暂停/卸载，而不是让中央 Runtime 写大量：

```text
if windows_online ...
if desktop_available ...
if shell_available ...
```

这可能成为 Hikari “能力联邦”的基础机制之一。

---

# 3. Effect：资源所有权

## 3.1 【DSH 事实】

Cordis 将插件产生的可撤销副作用统一建模为 Effect。

例如：

- Event Listener；
- Timer；
- Socket；
- Service 注册；
- Tool 注册；
- 子插件；
- 各种异步资源。

一个 Effect 在建立时可以返回 disposer。Fiber 卸载时，这些 disposer 会被回收。

子插件本身也被纳入父 Fiber 的 Effect 所有权，因此插件树同时也是一棵生命周期所有权树。

## 3.2 【我们的理解】

Effect 解决的不是“怎么调用插件”，而是：

> **谁对这个长期存在的资源负责？**

只要资源 ownership 明确，热重载、Provider 替换、插件卸载、失败回滚才可能可靠。

## 3.3 【对 Hikari 的启发】

Hikari 会拥有大量长期资源：

- 文件监听；
- 前台窗口监听；
- WebSocket；
- 设备连接；
- 消息订阅；
- 定时器；
- 音频流；
- 后台 Worker；
- Provider 连接。

这些资源不能依赖各模块“记得自己关”。

新架构应让长期资源明确归属于某个生命周期实体，并且可系统性回收。

---

# 4. Event 与 Service 的分工

## 4.1 【DSH 事实】

DSH 并不把所有模块通信都塞进 Event Bus。

它区分：

### Service

表示：

> 我现在需要某个能力帮我完成一件事。

例如：

```text
ctx.shell.execute(...)
ctx.llm...
```

### Event

表示：

> 某件事情发生了，感兴趣的组件可以观察或干预。

Cordis 支持不同分发语义，包括：

- `emit`：通知；
- `waterfall`：可包装、替换或短路的中间件链；
- `parallel`：并行观察；
- `serial`：顺序异步执行；
- `bail`：首个有效结果结束分发。

## 4.2 【我们的理解】

如果所有东西都通过 Event 表达，会形成事件意大利面。

如果所有东西都通过 Service 直接调用，又会形成强耦合调用链。

比较健康的原则是：

```text
“我要你做某件事”
→ Service

“某件事发生了”
→ Event

“这一步允许别人包裹、修改、阻断”
→ Waterfall / Policy Seam
```

## 4.3 【对 Hikari 的启发】

Hikari 的长期系统需要非常克制地决定什么应该是 Event，什么应该是 Service。

尤其不要把 Memory Search、Action Execute、Reasoning 等直接能力伪装成 Event Request/Response。

---

# 5. Capability Seam：能力接缝

## 5.1 【DSH 事实】三种角色

DSH 对可替换的通用能力区分：

```text
Service Definition
能力定义

Service Provider
能力提供方

Consumer
能力消费方
```

以 Shell 为例：

```text
Shell Definition
     │
     ├───────────────┐
     ▼               ▼
Shell Provider     Consumer
bash-local         tool-bash
bash-sandbox       hooks
pwsh-local
```

Provider 和 Consumer 互不依赖，它们都只依赖稳定的能力定义。

## 5.2 【DSH 事实】能力存在不等于模型拥有能力

系统加载了：

```text
ctx.shell
```

只表示当前系统拥有 Shell 能力。

是否把它作为 Tool 暴露给模型，是 Consumer 层的责任。

因此可以存在：

```text
Shell Provider ✅
Tool Consumer ❌
```

此时系统可以使用 Shell，但 Agent 模型并不会看到 Bash Tool。

## 5.3 【我们的理解】

DSH 实际上至少存在三张不同的图：

```text
插件生命周期图
能力图
模型可见能力图
```

它们不能混为一谈。

进一步说：

```text
系统拥有什么能力
≠
当前上下文能看到什么能力
≠
模型被暴露什么能力
≠
本次调用被允许执行什么能力
```

## 5.4 【对 Hikari 的启发】

Hikari 应把所有外部能力设计成可替换的 Capability Seam，例如：

```text
推理能力
├─ DeepSeek Provider
├─ OpenAI Provider
└─ Local Provider

编程能力
├─ Forge Provider
├─ Codex Provider
└─ Claude Code Provider

桌面能力
├─ Windows Provider
└─ ...

通信能力
├─ QQ Provider
├─ App Provider
└─ ...
```

但必须坚持：

> **能力存在，不代表 Hikari 可以随意暴露或执行它。**

---

# 6. Policy、Guard、Approval：能力治理

## 6.1 【DSH 事实】

DSH 的工具执行不会直接从模型 Tool Call 跳到工具实现。

它存在受治理的执行流水线，大致是：

```text
Tool Call
  ↓
pre-execute
  ↓
Policy / Hook / Permission
  ↓
Monotonic Guards
  ↓
必要时 Approval
  ↓
execute
  ↓
Tool Body / Capability Provider
  ↓
post-execute
  ↓
final result
```

其中单调 Guard 的关键性质是：

> Guard 可以收紧权限，但不能把已经被约束的调用重新放行。

多个限制相当于不断取交集，而不是最后一个策略覆盖前面的拒绝。

Approval 也是独立能力。缺少可回答审批请求的组件时，应失败关闭，而不是默认放行。

## 6.2 【我们的理解】

能力治理至少要把下面几个问题分开：

```text
我要做什么？
→ Action / Tool

允许不允许做？
→ Policy / Guard

是否需要用户确认？
→ Approval

具体怎么做？
→ Provider
```

这样才能避免一个 BashTool、BrowserTool 或 DesktopTool 同时拥有执行、权限、审批、沙箱、展示等所有职责，最后长成领域章鱼。

## 6.3 【对 Hikari 的启发】

Hikari 不应只有 Tool Pipeline，而应进一步推广成统一的 **Action Pipeline**。

因为 Hikari 的动作来源未来可能包括：

- 用户直接命令；
- 感知后的主动决定；
- Goal 自动推进；
- 定时任务；
- Agent Tool Call；
- Forge / Engineering；
- 外部工作流。

无论来源是什么，所有真实世界动作都应该进入统一链路：

```text
Action Intent
   ↓
规范化
   ↓
Authority / Policy
   ↓
Monotonic Guards
   ↓
Approval（若需要）
   ↓
Provider
   ↓
Result / Receipt
   ↓
持久事实
```

这样才能把“我做了”从语言承诺变成架构事实。

---

# 7. Agent Loop：行为推进，而不是系统大脑

## 7.1 【DSH 事实】Session、Agent、Agent Loop

DSH 在这一层区分：

```text
Session
= 已经发生过的持久事实

Agent
= 当前活着的运行实体

Agent Loop
= 推动 Agent 行为前进的具体驱动器
```

一个 Agent 暴露诸如：

```text
followup
steer
inject
cancel
whenIdle
```

等实时能力。

Agent Loop 负责从 Inbox 领取输入，创建 Turn 和 Step，调用模型，执行工具，并判断是否继续下一 Step。

## 7.2 【DSH 事实】Turn 与 Step

可以简化理解为：

```text
Turn
= 从一条任务输入开始，到本轮自然停止

Step
= 一次模型请求 + 该模型请求产生的工具执行
```

例如：

```text
Turn
├─ Step 1：模型决定读文件
├─ Step 2：模型根据文件结果跑测试
└─ Step 3：模型形成最终回答
```

## 7.3 【DSH 事实】Loop 不拥有其他能力

Agent Loop 会使用：

```text
ctx.systemPrompt
ctx.llm
ctx.tools
ctx.sessions
```

但不会把这些能力实现进自己内部。

扩展插件依赖公开 Agent 契约，而不是依赖具体 Agent Loop 实现，因此具体 Loop 保持可替换。

## 7.4 【我们的理解】

最重要的边界是：

> **Agent Loop owns progression, not the world.**

中文：

> **循环负责推进过程，不负责占有整个系统。**

它拥有：

- 什么时候开 Turn；
- 什么时候开 Step；
- 什么时候继续；
- 什么时候停止；
- 什么输入在当前 Step 被领取；
- 模型与工具之间的推进顺序。

它不拥有：

- 历史真相；
- LLM；
- Tool 实现；
- 权限策略；
- Prompt 内容本身。

## 7.5 【对 Hikari 的启发】

Hikari 不应该只有一个 Agent Loop。

因为 Hikari 的初衷要求：

> 没有用户输入时，她仍然存在。

因此未来更可能存在多个平级行为循环，例如：

```text
对话循环
感知判断循环
长期 Goal 循环
维护 / 成长循环
```

它们通过 Event、Service 与持久事实协作，但不应再出现一个新的 Super Orchestrator 把所有业务收回中央。

---

# 8. Inbox：输入不是一种东西

## 8.1 【DSH 事实】

DSH Agent 对输入至少区分：

### followup

表示普通后续任务，可以唤醒 Agent 并开始新的 Turn。

### steer

表示对正在运行过程的中途指导，在合适的下一 Step 被领取。

### inject

表示向后续 Step 注入模型可见上下文，但它本身不负责唤醒空闲 Agent。

## 8.2 【我们的理解】

“用户消息”“中途指令”“环境上下文”不应该天然被建模成同一种输入。

尤其是环境变化：

```text
用户切到 VSCode
设备连接
某个项目状态变化
```

未必应该自动开启一次 Agent Turn。

## 8.3 【对 Hikari 的启发】

Hikari Awareness 需要认真区分：

```text
Observation
Context Injection
Wake Signal
User Command
Steering
```

避免“感知到一个变化就唤醒大模型”这种粗暴实现。

---

# 9. Session Event Sourcing：事实独立于运行时存在

## 9.1 【DSH 事实】

DSH 的 Session 是类型化 `SessionEvent` 组成的只追加日志，是 Agent 交互历史的唯一真源。

模型消息历史从事件日志派生，而不是单独存储。

典型事实包括：

```text
turn/start
step/start
user/message
assistant/message
tool/call
tool/result
step/end
turn/end
```

还可以包含仅用于重建请求或系统状态的事件，例如请求头与请求上下文。

插件也可以扩展 Session 事件词汇。

## 9.2 【DSH 事实】实时 Event 与持久事实不同

`agent/*` 等事件主要负责实时控制和观察。

`session/event` 记录的是需要回放、恢复、审计的持久事实。

因此：

```text
“现在发生了什么”
≠
“这件事以后必须知道它发生过”
```

## 9.3 【DSH 事实】Projection

当前状态、模型历史等可以从 Session Event Log 重新计算得到。

也就是：

```text
Events
↓ fold / derive
Projection
```

Projection 是事件的派生视图，不是独立真源。

## 9.4 【我们的理解】

Event Sourcing 带来的核心价值不是“数据库写成事件格式”，而是：

> **短暂运行状态可以消失，已经发生的事实不能跟着消失。**

模型进程、Agent、插件、设备都可能重启或重载，但如果真实动作已经发生，系统之后仍应能够知道。

## 9.5 【对 Hikari 的启发】Chronicle

Hikari 的事实范围远远大于一次聊天 Session，因此我们可能需要把 DSH 的 Session Event Sourcing 推广成更广义的 **Chronicle（暂名）**。

它记录的是 Hikari 世界中真实发生、值得长期保留的事实，例如：

```text
observation/device-connected
observation/foreground-changed
conversation/user-message
conversation/hikari-message
goal/created
goal/updated
action/proposed
action/approved
action/started
action/completed
action/failed
device/offline
```

需要特别区分：

```text
Chronicle
= 发生了什么

Memory
= Hikari 从这些事实中理解出了什么
```

这两个不能成为互相竞争的真源。

---

# 10. Memory 应是带依据的解释层

## 10.1 【DSH 事实】

DSH 本身的 Session/Event Sourcing 主要围绕 Agent 交互与可恢复事实，并没有直接给出 Hikari 所需要的长期个人记忆系统答案。

## 10.2 【我们的理解】

事实与解释应该分离。

例如事实可能是：

```text
用户多次指出 Runtime 不应干涉领域模块
用户明确记录 Hikari 的核心灵魂
用户选择从新仓库重新开始
```

Memory 可以基于这些事实形成：

```text
用户重视模块自治与架构长期可控性
```

后者是解释，可以被修订。

## 10.3 【对 Hikari 的启发】

重要 Memory 最好最终能够携带：

- 来源事实；
- 形成时间；
- 置信度；
- 修订关系；
- 适用范围；
- 是否仍有效。

这样 Hikari 的“成长”才会更接近：

```text
经历
→ 理解
→ 形成记忆
→ 后续经验修订记忆
→ 判断发生变化
```

而不是简单地让 Prompt 越来越长。

---

# 11. Persistence：持久化是能力，不是第二套事实模型

## 11.1 【DSH 事实】

Session 本身定义事件语义；具体持久化由 `SessionPersistence` Seam 负责。

持久层直接保存原来的 Session Events，而不是再创建一套“持久化事件类型”。

持久访问通过逐 Session Handle 完成，例如：

```text
read
append
flush
close
```

写 Handle 同时承担写所有权。同一 Session 不允许两个独立写者并发拥有写权。

`append` 与 `flush` 也被明确区分：

```text
append
= 后端接受并排序

flush
= 持久性屏障，保证此前事实经得住崩溃
```

## 11.2 【DSH 事实】崩溃恢复

如果进程在 Turn 中途崩溃，DSH 不会删除已经成功写入的完整事实。

恢复时会识别未关闭的 Turn / Step，并追加表示中断的闭合事件，而不是重写过去。

## 11.3 【我们的理解】

这里体现出一条很重要的事件溯源原则：

> **恢复不是抹掉过去，而是追加新的事实解释发生了中断。**

## 11.4 【对 Hikari 的启发】

Hikari 如果未来执行长期任务、跨设备动作或持续感知，必须允许：

```text
进程死掉
设备掉线
模型崩溃
Provider 重启
```

但这些事情不应让系统随后无法判断：

- 哪些动作真正发生过；
- 哪些动作只被计划过；
- 哪些动作已经成功；
- 哪些动作在执行中被中断。

---

# 12. Receipt：从 DSH 的工具结果进一步推导

## 12.1 【DSH 事实】

DSH 会把 Tool Call 与 Tool Result 作为明确事实记录，并通过 call identity 关联。

## 12.2 【我们的理解】

对于长期自主系统，“返回一个字符串说成功”仍然不够。

真正的行动应该尽可能得到结构化、可验证的执行结果。

## 12.3 【对 Hikari 的启发】

Hikari 可以把 **Receipt（行动回执）** 做成一等结构。

例如发送消息：

```text
Action
send_message(...)

Result
provider accepted

Receipt
provider = qq
message_id = ...
timestamp = ...
```

只有当可接受的 Result / Receipt 已存在，Hikari 才应该对外声称：

```text
“已经发了。”
```

这将 Trust 从 Prompt 规则提升为架构约束。

---

# 13. Profile / Bundle / Patch：产品由组合产生

## 13.1 【DSH 事实】Profile

DSH 同一套安装可以通过不同 Profile 启动为：

```text
web
headless
acp
sdk
sdk-minimal
```

Profile 主要声明：

- 有哪些 Bundle；
- Bundle 的顺序；
- Profile 自己的 patch；
- patch 的加载策略。

## 13.2 【DSH 事实】Bundle

Bundle 是可安装的组合层，主要贡献一份插件树 Patch。

例如多数产品形态以 `base` 为基础，再叠加 `web-app`、`headless` 等模式 Bundle。

## 13.3 【DSH 事实】Patch

最终 Plugin Tree 从空树开始，按层应用：

```text
Bundle #1
↓
Bundle #2
↓
Profile Patch
↓
Home / Invocation Overlay
↓
Final Plugin Tree
```

Patch 可以插入条目、禁用条目、替换已有条目的配置。

DSH 当前 Patch 对目标配置采用整块替换而不是静默深度 merge，这让配置 ownership 更明确。

长生命周期 Profile 还可以支持用户 Patch 热重载。有效变更重新组合应用；无效变更不应摧毁当前仍然可用的系统。

## 13.4 【我们的理解】

Profile / Bundle / Patch 的最大价值不是配置方便，而是：

> **产品差异不需要进入 Runtime 的业务分支。**

不是：

```text
if web ...
if desktop ...
if mobile ...
```

而是：

```text
我要什么产品形态
→ 组合对应插件树
```

## 13.5 【对 Hikari 的启发】

Hikari 天然是多节点、跨设备系统。

未来可以考虑类似：

```text
Cloud Profile
├─ reasoning
├─ memory
├─ world model
└─ goals

Windows Resident Profile
├─ desktop perception
├─ filesystem
├─ shell
├─ local notification
└─ desktop action

Mobile Profile
├─ sensors
├─ notification
└─ voice
```

但这些不是多个 Hikari。

它们应该是：

> **同一个 Hikari 在不同节点上的能力组合。**

这会进一步要求一层跨节点能力发现与联邦机制。

---

# 14. 我们目前认为最值得 Hikari 借鉴的原则

以下不是 DSH 官方口号，而是我们从研究中提炼出的设计原则。

## 14.1 Runtime 只拥有机制，不拥有策略

```text
Runtime owns mechanism, never policy.
```

Runtime 可以知道：

```text
plugin
service
event
scope
fiber
effect
lifecycle
resource
```

Runtime 不应该知道：

```text
Memory
Awareness
Goal
Persona
Engineering
Conversation
User
Hikari 的领域语义
```

## 14.2 能力关系是一等公民

模块不依赖具体实现，而依赖能力契约。

```text
Consumer
↓
Capability Definition
↑
Provider
```

## 14.3 能力存在不等于可执行

至少需要区分：

```text
系统拥有能力
当前 Scope 可见能力
Agent 可见能力
本次动作允许的能力
```

## 14.4 依赖驱动生命周期

尽量避免中央 Runtime 手工知道所有启动顺序。

```text
依赖满足
→ 组件存在

依赖消失
→ 组件退出
```

## 14.5 长期资源必须有明确 Owner

Timer、Watcher、Socket、Device Link、Provider 等长期资源必须可以随拥有者生命周期可靠释放。

## 14.6 事实与运行态分离

```text
Live State
可以消失

Durable Fact
不能因为进程重启而消失
```

## 14.7 事实与解释分离

```text
Chronicle
= 事实

Memory / World Model
= 对事实的解释与投影
```

## 14.8 行动必须经过统一治理

```text
Intent
→ Policy
→ Guard
→ Approval
→ Provider
→ Receipt
→ Durable Fact
```

## 14.9 行为循环只推进过程

不要让某个 Orchestrator 成为新的中央章鱼。

对话、感知、Goal、维护等循环可以平级存在，通过契约、事件和事实协作。

## 14.10 产品与节点形态由组合产生

Cloud、Windows、Mobile、未来可穿戴设备等差异，应优先通过 Profile / Bundle / Capability Provider 组合表达，而不是在 Runtime 内写设备与产品条件分支。

---

# 15. 当前对 Hikari 的初步结合模型

> 这一节是我们的推导，不是 DSH 原有架构。

目前可以粗略形成下面的方向：

```text
Hikari Deployment / Profiles
云端 / Windows / 手机 / 可穿戴设备
                │
                ▼
┌────────────────────────────────────┐
│          极薄 Host Runtime          │
│                                    │
│ Context / Service / Event          │
│ Fiber / Effect / Scope / Lifecycle │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│             能力接缝层              │
│                                    │
│ 推理 / 感知 / 文件 / 桌面 / 浏览器   │
│ 编程 / 通信 / 语音 / 通知 / 设备     │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│           持久事实层 Chronicle      │
│                                    │
│ Observation / Conversation         │
│ Goal / Action / Result / Device    │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│       Memory / Projection / World   │
│                                    │
│ 世界模型 / 用户模型 / 长期记忆       │
│ 自我连续性 / 项目状态 / 关系理解      │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│             多种行为循环             │
│                                    │
│ 对话 / 感知判断 / Goal / 成长维护     │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│             Action Pipeline         │
│                                    │
│ Intent → Policy → Guard            │
│ → Approval → Provider → Receipt    │
└────────────────┬───────────────────┘
                 │
                 ▼
          Presentation / Delivery
```

需要特别警惕：这还只是研究阶段的候选形状，不应直接变成目录结构。

---

# 16. DSH 不应被直接照搬的部分

## 16.1 DSH 的 Agent 中心视角不等于 Hikari 的 Presence

DSH 的核心应用场景仍然围绕 Agent Turn / Step。

Hikari 则必须在没有用户消息、甚至没有活跃 Conversation 时仍然存在。

因此 Hikari 不能简单写成：

```text
DSH
+ Memory
+ Awareness
```

## 16.2 Session 不能直接等于 Hikari 的长期生命事实

DSH Session 非常适合记录一次 Agent 交互的事实，但 Hikari 的事实还包括：

- 设备变化；
- 环境变化；
- 长期 Goal；
- 跨 Session 行动；
- 非对话时发生的观察；
- 多设备共同经历。

因此需要更广义的持久事实模型。

## 16.3 不应机械复制 Cordis 的具体实现算法

我们值得借鉴的是：

```text
依赖驱动生命周期
Effect Ownership
Scope
Service / Event 分工
```

而不是承诺逐行复刻它当前的 notify 扫描、TypeScript API、Loader 格式或 npm 包组织。

Hikari 的实现语言、规模、跨进程与跨设备要求都可能不同。

## 16.4 不应把 DSH 的 Agent Loop 当 Hikari 的唯一大脑

Hikari 很可能需要多个平级行为循环，因此需要避免再次创造：

```text
SuperOrchestrator
```

让所有输入、感知、记忆、Goal、行动都重新通过一个中心对象。

---

# 17. 下一阶段待回答的问题

这份研究完成后，不应立即创建 `src/`。

下一阶段需要从 Hikari 的核心灵魂反推以下问题：

1. **什么构成“同一个 Hikari”的连续性？**
   - 换模型、换设备、换 Provider 后，什么仍然不能变？

2. **Hikari 的持久事实边界是什么？**
   - 哪些变化应该进入 Chronicle，哪些只是瞬态 Event？

3. **Memory 与 World Model 如何从事实派生？**
   - 如何带来源、修订和置信度？

4. **Presence 如何实现？**
   - 没有用户消息时，系统由什么循环维持感知与判断？

5. **多行为循环如何协作而不形成中央章鱼？**

6. **跨设备能力如何发现、声明、失效和恢复？**

7. **Action Pipeline 的 Authority、Policy、Guard、Approval 如何分层？**

8. **人格与 Presentation 如何独立于事实和执行层？**

9. **哪些东西属于 Host Runtime，哪些必须坚决禁止进入 Runtime？**

这些问题回答清楚以后，再开始定义模块 ownership、contracts 与最终目录结构。

---

# 18. 研究结论

目前对 DSH 最重要的认识可以压缩为六句话：

> **产品由组合产生，而不是由 Runtime 条件分支产生。**

> **插件是否存在由能力依赖决定。**

> **能力的定义、实现、暴露与治理应分离。**

> **行为循环负责推进，不拥有整个世界。**

> **持久事实独立于短暂运行状态存在。**

> **Runtime 应拥有机制，而永远不要拥有领域策略。**

对于 Hikari，这些不是最终答案，而是我们现在获得的一套非常有价值的机械骨架。

Hikari 真正需要自己定义的部分仍然是：

```text
Presence
Continuity
Perception
Understanding
Judgement
Growth
Agency
Trust
```

DSH 可以告诉我们系统怎样保持模块化、可替换、可恢复，但 Hikari 为什么存在，以及什么才算“她仍然在那里”，必须由 Hikari 自己的架构回答。

---

## 参考实现与文档

研究主要基于 DeepSeek Harness 官方仓库中的以下材料：

- `docs/cordis-primer.zh.md`
- `vendor/cordis/src/context.ts`
- `vendor/cordis/src/service.ts`
- `vendor/cordis/src/registry.ts`
- `vendor/cordis/src/fiber.ts`
- `docs/capability-seams.zh.md`
- `docs/user/develop/practice/index.zh.md`
- `docs/tool-execution-pipeline.zh.md`
- `docs/subsystems/tools.zh.md`
- `docs/subsystems/core.zh.md`
- `docs/agent-lifecycle.zh.md`
- `docs/subsystems/session.zh.md`
- `docs/subsystems/persistence.zh.md`
- `packages/boot/app-boot/README.zh.md`
- `packages/boot/app-boot/src/profile.ts`
- `packages/bundle/README.zh.md`
- `packages/bundle/base/cordis.patch.yml`
- `packages/bundle/web-app/cordis.patch.yml`

仓库：`deepseek-ai/deepseek-harness`
