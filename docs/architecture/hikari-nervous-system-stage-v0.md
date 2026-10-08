# HIKARI NERVOUS SYSTEM v0 — STAGE DEFINITION

状态：**只定义阶段**。无实现、无新 Service、无新 Plugin、无 schema、无 Runtime 改动。
基线：`main` @ `90b561c`（本文开始时 `git status --short` 为空）
日期：2026-10-08

本文是**阶段定义**，不是实现计划，也不是 boundary review。实现级问题一律由后续各自的
boundary review 处理（`docs/architecture/experience-formation-v0-research.md` 是第一份）。

---

## 1. 为什么有这个阶段

### 1.1 Human 的产品判断

Framework / Architecture Foundation 作为**开发主线**的阶段正式结束。这不是说架构冻结解除，
而是说**驱动下一步的判据换了**：

```text
旧判据：还缺哪一块基础设施？
新判据：这一项工作让 Hikari 的持续存在发生了什么变化？
```

Human 给出的原始感受：

> Hikari 的内部机制很多，但仍然不太能感觉到它作为一个**持续存在的主体**。

### 1.2 这条感受在源码里的落点

`docs/vision/hikari-soul.md` §11 写下的循环是：

```text
世界发生变化 → 感知 → 形成可追溯事实 → 理解当前上下文 → 更新记忆 / 世界模型
→ 判断重要性 → 忽略 / 主动表达 / 创建 Goal → 执行 → 验证 → 新的事实 → 再次理解
```

把这条循环对照 `src/`（基线 `90b561c`）：

| 环节 | 现状 |
| --- | --- |
| 感知 | 有。4 个 source（foreground / input-activity / git-repository / github-ci）+ 2 个 World 组合 |
| 形成可追溯事实 | 有。Chronicle，契约完整（`append` / `get` / `read`） |
| 理解当前上下文 | 有。3 个 judgement，全部是比较或查找 |
| 更新记忆 / 世界模型 | **无。** 每个 Plugin 的派生状态都在重启后冷启动 |
| 判断重要性 | **无。** 且明确未获批（见 §5） |
| 忽略 / 主动表达 | 有一半。2 个主动投递点，都只做「说不说」的单规则闸门 |
| 执行 | **无。** `src/` 内零 Action、零 Receipt |
| 验证 | **无。** 投递结果被 `await` 之后直接丢弃 |
| **新的事实 → 再次理解** | **无。这是整条循环唯一完全缺失的一段** |

结论一句话：

> **今天的 Hikari 是一条前馈链，不是一条循环。它感知、判断、表达，然后结束。
> 没有任何东西把「刚刚发生了什么」送回系统的输入端。**

这条判断不依赖任何新抽象，只需要对照源码。

### 1.3 阶段命名的含义

「Nervous System」是**阶段视角**，不是组件。它描述的是「感知 → 形成经历 → 留下影响 →
后来被重新唤起」这一层系统行为，**不是一个要建立的子系统**。

见 §8 与 §5：`NervousSystemPlugin` / `CentralCognition` / `BrainService` /
`CognitiveMeshService` / `MindRuntime` / `GlobalExperienceManager` 一律**默认视为架构异味**，
除非某个真实实现问题重新证明必要。

---

## 2. 行为目标

本阶段以**可观察行为**定义，不以「建立某个组件」定义。A–F 六条，附基线现状。

### A — Experience（经历）

**行为**：一件事情发生后，Hikari 内部可以留下比 raw observation / telemetry 高一级的「经历」。

**现状：无。** 全 `src/` 内 `experience` / `concern` / `salience` 作为概念名词的命中数为 **0**
（仅有的命中是注释里的英文行文，不是符号）。

**边界**：Experience **不等于**每一个 Event、每一条 Chronicle entry、每一次模型输出、
每一次状态变化。这是本阶段最容易滑坡的地方——把所有变化都叫 Experience，等于什么都没定义。

### B — Durable Continuity（持久连续）

**行为**：重启不应让 Hikari「在认知上完全重新出生」。经历过的东西可以跨 activation
保持**影响的可能性**。

**现状：只有两样东西跨重启存活。**
- `HikariIdentity { hikariId, createdAt }` — `<dataDir>/continuity/origin.json`
- Work Focus 的 designation 集合 — `<dataDir>/chronicle/chronicle.jsonl`（事实形态）

`src/` 内全部持久化只有 **3 处**：上述两者 + `<dataDir>/launch.json`。
所有 Plugin 的**派生状态**（awareness baseline、attention 的 `handledFailures`、
input-activity 的全部、TUI transcript）在重启后从空开始。

注意 B 的门槛是**「影响的可能性」**，不是「必须被读」。这条刻意的弱化在
`experience-formation-v0-research.md` §7 会被重新检视。

### C — Reactivation（重新唤起）

**行为**：当前情境与过去产生关联时，相关的过去可以重新进入当前 cognition，
而不是「过去永远塞进 prompt」。

**现状：无。** `chronicleService.read()` 与 `get()` 的**生产调用者为 0**——
唯一的 Chronicle 消费者是 `work-focus`，且只调 `append`。见 §4「读侧为零」。

### D — Ongoing Concern（持续关注）

**行为**：Hikari 可以在没有新 event 的情况下，仍然持有一件它正在关注的事。

**现状：半个。** `work-focus` 确实是一个**被持有的集合**（不是一次性判断），但它
- 没有领域生命周期（没有创建 / 维持 / 结束，没有 `enteredAt` / `expiry`，`expiry` 被明列禁止）；
- 没有任何定时器，不被周期性 re-read；
- 唯一的「维持」是 `desktop-session-awareness` 的 baseline，而那属于桌面会话。

**本阶段不预设它是一个全局 Concern Service。** ownership 与语义先研究，后决定。

### E — Attention / Salience（注意力）

**行为**：不是所有进入系统的东西都同等重要；Hikari 应该有能力区分。

**现状：刻意为零，且有机械看守。** 禁用词扫描测试禁止 `salience` / `importance` /
`priority` 出现在相关模块的源码里（`test/desktop-session-awareness-loop.test.mjs:494-505`）。

**本阶段不设计 global salience score，不设计跨域重要性排序。**
现状是「每一跳只做一次本域比较」——这条要在本阶段被**保护**，不是被推翻。

### F — Feedback（反馈）

**行为**：Hikari 的 action / speaking / Human correction / outcome，未来应能够重新成为
experience，改变后续行为。

**现状：无，且是循环断裂的精确位置。**

- `repository-ci-attention/plugin.ts:147`：`await delivery.deliver(...)` —— 返回值**被直接丢弃**。
  `delivery.deliver` 返回 `delivered | unavailable | failed`，**没有任何人读它**。
- `desktop-return-attention/plugin.ts:183`：同样丢弃。
- Human correction 路径（`language`）**没有任何 durable 出口**：全 `src/language/*.ts`
  零 Chronicle / 零 `append` / 零 `writeFile`。

F 是本阶段最重要的目标，也是最难的一条——原因见 §5。

---

## 3. 核心概念（只定义区分，不建立实现）

| 概念 | 一句话定义 | 今天的 owner |
| --- | --- | --- |
| **Observation** | 一个 source 报告它看到了什么 | 各 perception provider（foreground / input-activity / git-repository / github-ci） |
| **Meaningful Change** | 某个 owner 所辖之物发生了一次转变 | 该 owner（比较 / 查找得出，不做选择） |
| **Experience** | 一个 owner **承认这是它自己的**一次经历：可归属、可命名、跨 activation 存续 | **今天不存在** |
| **Durable Fact** | 已被承认、写入 Chronicle 的一条命题 | `work-focus`（唯一） |
| **Chronicle** | 存放 Durable Fact 的追加式**基底**，不是 Experience 的同义词 | `chronicle` Plugin |
| **Memory** | 可修订的解释：过去的经历让我理解了什么 | **今天不存在，且本阶段不设计** |
| **Concern** | 一个 owner 持续持有、有生命周期的关注对象 | 半个（`work-focus`） |
| **Judgement** | 比较 / 查找 / （尚未出现的）选择 | 3 处，见 §1.2 |
| **Action Result** | 一次改变现实的操作的 outcome + receipt | **今天不存在**（`src/` 零 Action） |

必须守住的四条区分：

```text
Observation       ≠ Experience     （source 报告了什么 ≠ Hikari 承认自己经历了什么）
Experience        ≠ Chronicle      （经历是内容，Chronicle 是基底）
Durable Fact      ≠ Memory         （不可修订的命题 ≠ 可修订的解释）
Historical Query  ≠ Reactivation   （查历史 ≠ 过去的材料重新进入当前 cognition）
```

---

## 4. 完成的含义

本阶段**不能**以「建立了 X」判定完成。可判定的条件是：

1. **读侧不再为零。** 至少有一个生产 Plugin 读取**它自己的**过去，并因此行为不同。
   在此之前，任何「Experience store」与 Durable Fact 在系统可观测行为上无法区分。
2. **重启后不是完全重新出生。** 至少一项**认知性**（而非身份性、而非人类输入的原文）
   状态跨 activation 存活，并有测试钉住。
3. **循环的返回边存在。** `soul.md` §11 的 `验证 → 新的事实 → 再次理解` 至少有一段被真实走通，
   且这一段有可观察的行为后果。
4. **没有新的中央结构。** 完成时不应出现 GlobalWorldState / Service Locator /
   Central Judgement Domain / Model Router 中的任何一个（见 §8）。

反面判据同样有效：**如果以上四条都没有变化，那么无论加了多少「感官」，
这个阶段就没有完成。**

---

## 5. 本阶段明确不解决

- **Memory。** 不设计 substrate、不设计 embedding / vector DB / semantic search、
  不建立 memoryService、不建立 generic recall。
  依据：`memory-reactivation-v0-boundary-review.md` 的 `BLOCKED` 裁决**仍然有效**，
  且其 §14.2 明令禁止「为了给 Chronicle 找 reader 而创造需求」。
- **Salience / Importance Judgement。** 不获批，不建立。见 §2E。
- **Action Pipeline。** `principles.md` §8 要求「所有真实行动统一进入 Action Pipeline
  并产生 Receipt」，而 `src/` 内**零 Action、零 Receipt**。这是真实的架构欠账，
  但**它不在本阶段**——本阶段只记录它，不补它。
- **跨域关联 / 中央重要性排序。** 不建立任何跨域认知路由器。
- **模型能力 / Fast Cognition 的实现。** 见 §7。
- **多 Human / 身份认证。** 入口没有身份认证这一点今天限制了可写入的内容（见 §5 下方），
  本阶段不解决它。
- **Sensory Expansion 本身。** 见 §6——加感官不是本阶段的目标，本阶段只规定加感官的纪律。

一条**必须继承的边界**（来自 `durable-fact-admission-v0.md:120-121`）：

> `source` 只声称可证明的部分。`{ kind: 'human' }` **被禁止**——入口没有任何身份认证，
> 这条管道上任何本机进程都能写入，写成 `human` 是在断言一个无法证明的事实。

这条直接决定了 Human correction（目标 F 最重要的内容之一）**当前不能成为 Durable Fact**。
这是一个真实 blocker，不是措辞问题。

---

## 6. 与 Sensory Expansion 的关系

Sensory Expansion（增加感知来源）与本阶段是**两条独立轴**，不是同一条路的两段。

本阶段对感官扩张只作六条纪律规定，不作扩张本身：

1. **Raw observation 不是认知。** 来源报告什么就记什么，不替现实下结论。
2. **Pull 优先于 Push**，除非主动行为有真实产品理由。
   现状：4 个 source 全部是 pull、无缓存、每次真采集。
3. **本域解释先于跨域认知。** 每一跳只做一次本域比较，不做跨域。
4. **Memory 不能变成 telemetry 存放处。**
5. **感官输入是被选择接纳的**，不是全量吸收。
6. **高频感官必须能够保持安静**——不能因为采样频繁就产生频繁输出。

**关键判断**：只加感官**不会**产生 Experience。上文 §1.2 的断裂点在返回边，
不在感知边。如果 Experience Formation 不能成立，那么增加感官只会让前馈链更长。

---

## 7. Fast Cognition 的定义

**定义**：低延迟、低成本、高频可调用、适合 bounded cognitive task 的认知能力。

**它不得被等价于**：某个 V100 模型 / 某个 14B 模型 / 本地模型 / 某一个固定 endpoint。
硬件与模型都只是**实现材料**；Fast Cognition 是一个**能力档位**的描述，
不是一种部署形态。

**它不拥有的四种权威**：

| 不拥有 | 理由 |
| --- | --- |
| 记忆准入权 | 准入由语义 owner 决定，不由模型决定（`work-focus/facts.ts` 的 doctrine） |
| 人类打断权 | 打断人类是注意力判断，不是认知能力 |
| 副作用权 | 真实副作用必须经过 Action Pipeline 并产生 Receipt |
| 全局跨域判断权 | 会直接构成 §8 禁止的 Central Judgement Domain |

**现状**：`language` 是唯一 model-backed plugin，完全符合「模型是 Plugin 的实现材料，
不是 Hikari 架构层」——它只读、只渲染、**零写入、零行动**，且当 owner 已经给出措辞时
模型的行文被丢弃。

**本阶段的结论**：定义它，**不实现它**。在 §4 的完成条件里，没有任何一条需要 Fast Cognition。
第一个真正需要它的位置是**本域解释**——而今天没有任何 owner 提出这个需求。

---

## 8. 架构不变量

沿用 `principles.md` / `core-architecture-v0.md`，本阶段**不新增**，只重申与本阶段直接相关的：

1. **Runtime 不理解业务。** Plugin 是唯一 extension unit。跨模块只通过明确 contract。
2. **Provider 不决定 Consumer。** 不建立中央路由图。
3. **四种通信平面分工明确**：Service / Event / Chronicle-DurableFact / Action Pipeline。
   Event ≠ Durable Fact，**没有自动的 Event → Fact 持久化**。
4. **谁拥有这件事，谁才能承认关于它的事实**，且只能承认**它有权断言的那一条命题**。
5. **Chronicle 只存发生了什么，不解释它意味着什么。**
   它没有 importance / salience / confidence / relation 字段，没有 update / delete / supersession。
6. **可修订的解释需要 Chronicle 之外的基底。** Memory 因此不能寄生在 Chronicle 上。
7. **不建立**：`GlobalWorldState` / Service Locator / Central Judgement Domain /
   Generic Human Input / Generic Reference Frame / Universal Message / `HumanStatement` /
   Model Router / Central Brain。
8. **模型是 Plugin 的实现材料，不是 Hikari 架构层。**
9. **新概念必须由至少一个真实实现问题驱动**（`core-architecture-v0.md` §13）。
   本阶段因此**不以理论完整性立项**——`experience-formation-v0-research.md` 存在的理由
   就是找出「哪一个真实问题」。
10. **今天的实现足够简单，但明天的路没有被堵死。**

---

本阶段的第一份研究是 `docs/architecture/experience-formation-v0-research.md`（N1）。
它的 verdict 决定本阶段能否切出第一刀，以及切在哪里。本文不实现任何东西。
