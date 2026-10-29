# Hikari Native 交接文档（2026-10-28）

> 用途：跨会话交接。新开的 agent 读完这一份，就能接上此前全部讨论与决定，不需要原始对话。
> 本文只记录**已经确定的决定**与**已核实的源码事实**；未确定的东西单列在 §7，不要当成已决。

## 1. 决定：重建，不是迁移

Hikari 不再基于 `hikari-new` 的 Runtime 演进，改为**以 DeepSeek Harness / Cordis 为目标运行底座重建**。

- **迁移**的判据是「一样」——把 `hikari-new` 的 17 个插件搬过去、逐项证明等价。PoC-01～04 走的是这条路。
- **重建**的判据是「成立」——不要求跟旧的一样，旧代码是参考资料而非必须继承的结构。

已明确不继承的东西：

- `hikari-new` 的 `src/runtime/` 整套（contracts / service-registry / event-bus / plugin-context / errors / runtime.ts）——生命周期、依赖协调、事件面交给 Cordis。
- `experiments/poc-03-contract-layer/contract-layer.mjs` 这层适配器。它存在的唯一目的是「让旧插件在两个宿主之间保持相同表现」；不再兼容旧 Runtime，它就没有存在理由。领域需要的输入校验和状态约束，用 Cordis 原生机制 + Hikari 自己的领域类型表达，**不是把兼容层改个名字留下**。

## 2. 为什么放弃逐项等价（PoC 的结论要如实说）

PoC 证明了**功能可映射**，但没有证明**语义等价**。最硬的反例是 §4.4：

- 依赖方 cleanup 失败时，Hikari 把它留在 `failed`（终态，可读错误）；
- Cordis 会把它重新拉起来（恢复为 `ACTIVE`，服务重新可解析）。

这不是「适配层写得不够好」，是两边对「失败」的看法不同。三路修法（代理 fiber / 记录重放 / 空壳 fiber）全部失败，因为都要让适配层维护一份与宿主不同的生命周期事实。既然走 Native，这个差异不需要再兼容。

## 3. 已核实的 DSH 事实（读的是 `_poc/poc01/node_modules` 里 0.2.1-rc.2 的安装）

| 事实 | 位置 |
|---|---|
| `followup(input: UserMessage): void` | `@deepseek-ai/dsh-agent-loop/lib/types/agent.d.ts:41` |
| 「A wake sent while idle always opens its turn boundary」 | 同文件 `:48`；实现 phase 三态 `idle`/`running`/`maintenance`，`lib/index.js:784`、`:791` |
| `whenIdle(): Promise<void>` | 同文件 `:55` |
| `ctx.agents.create(options): Promise<AgentHandle>` | `@deepseek-ai/dsh-agent/lib/types/index.d.ts:278` |
| `ctx.agents.get(id): Agent \| undefined`、`list(): Agent[]` | 同文件 `:343`、`:357` |
| `AgentHandle { agent, dispose() }` | 同文件 `:143-146` |
| agent 由**发起调用的 fiber** 拥有 | `@deepseek-ai/dsh-agent-loop/lib/types/index.d.ts`（`createAgent(ownerCtx, ...)` 注释） |
| 稳定身份 `sessionId` / 恢复 `resumeSessionId` | `@deepseek-ai/dsh-agent-loop/README.zh.md` |
| `dsh-acp` 已在用 `followup` 往 agent 送消息 | `@deepseek-ai/dsh-acp/lib/index.js` |

**由此成立的设计（方案 B）**：Hikari 是持续运行的 Cordis 插件系统；DSH Agent 是她可以使用的一种认知执行机制，**空闲时不消耗模型**，由 Attention 判断值得推理时 `followup()` 唤醒。

这条推翻了此前「Hikari 要么是 Agent、要么是常驻 Service 集合」的二选一——那是伪命题。

## 4. 第一版（v0）要做的三个插件

| 插件 | v0 职责 |
|---|---|
| Desktop Perception | 观察真实前台窗口变化 |
| World + Attention | 维护最小状态，判断变化是否值得推理（v0 合在一个插件里，为控制规模，不代表正式架构必须合并） |
| Agent Activation | 消费判断事件，唤醒 DSH Agent |

最小可观察链路：

```
前台窗口变化 → Hikari 更新认识 → 判断是否值得关注
            → 值得时主动唤醒 Agent → 留下判断与推理记录
```

**判据不是「她说了一句像有思想的话」**，而是能追踪：观察到什么 → 为什么决定关注 → 是否主动发起推理 → 得到什么结果。

## 5. 三个问题的 v0 答案（最小产品定义）

| 问题 | v0 答案 |
|---|---|
| 没人叫她时在做什么 | 持续感知环境，更新 World，并评估变化 |
| 她记得什么 | 最近一次有效状态、关注判断及相应时间与原因 |
| 她什么时候说话 | 判断值得主动沟通时才考虑打扰；**v0 只记录，不主动通知** |

「主动推理」与「主动打扰」是两个不同的决定，v0 只验前者。

## 6. 下一轮的具体步骤

1. **开独立 profile**（建议 `hikari`），不要把她装进日常聊天的那个 profile。
2. 开创造模式（`@deepseek-ai/dsh-agent-preset` 的 preset），使 agent 拿到 `plugin_manager` / `cordis_inspect_list` / `cordis_inspect_query` 三个工具。
3. 第一件事不是写代码，是 `cordis_inspect_query` 查 `dsh-agent-loop` 与 `dsh-session` 的**运行时**形状——读 `.d.ts` 和看运行中的注册表不是一回事，上一轮读的都是类型定义。
4. 然后按 §4 做 v0。

写插件的规范流程（来自 `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md`）：

- 在工作区写 bundle → `plugin_manager` 的 `install_bundle`（`target` 为包的绝对路径）装进当前 profile；
- **不要手写** profile 的 `package.json` 或 `cordis.patch.yml`，不要在 profile 目录跑 pnpm；
- 用返回的 `application` 与 `warnings` 判断是否生效，**不要**用日志、进程列表或页面 boot payload 判断；
- 用 `cordis_inspect_query` 确认新行存在，`application: applied` 才算装上。

## 7. 尚未确定（不要当成已决）

1. **独立 profile 的名字与位置**——倾向上单独一个，未定。
2. **连续性落在哪**：session（`dsh-session-persistence` 持久化对话与推理历史）和 World 插件（我们自己的世界状态）两处谁写什么。原则已定（连续性属于世界认识与经历，不属于某次模型调用，也不依赖永不销毁的 Agent 对象），落点未定。
3. **agent 所有权语义**：建议把 Activation 插件当作「她」的生命周期本体——热重载等于她重生，这是诚实的语义，不为了「不重置」造一个谁也不负责的长命对象。**这条只是建议，未经 Human 确认。**
4. 本仓库（`hikari-new`）后续是归档、还是作为领域逻辑的参考来源保留，未定。

## 8. 边界（本轮有效，未被撤销）

- 不改 `hikari-new` 的 `src/`、`test/`。
- 不改 DSH / Cordis 上游源码。
- v0 不实现主动打扰。
