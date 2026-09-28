# DESKTOP RETURN ATTENTION v0 — IMPLEMENTATION BOUNDARY FREEZE

> 日期：2026-09-28
> HEAD：`26ee358`
> 级别：**Level 2 — Local Contract Evolution**
> 前置：`desktop-return-attention-v0-boundary-review.md` 的 **BLOCKED** 判词已被 `hikari-architecture-governance-review-v1.md` §5 取代为 `eligible for local contract evolution`；本冻结即该口径下的实施边界。
>
> 本文只冻结本轮要建的东西与明确不建的东西，不重开架构评审。与 `principles.md`、`core-architecture-v0.md`、`plugin-design-spec.md` 冲突时以后者为准。
>
> **反向指针**：本文是 `desktop-return-attention-v0-boundary-review.md`（BLOCKED → 经治理评审 v1 §5 重分类为 `eligible for local contract evolution`）在 Level 2 下的实施边界。该评审的 §17 BLOCKED 结论原样保留、不修改；本文记录的是按修正后口径**落地了什么**，两者互不覆盖。本轮真实端到端证据见 §12。

---

## 1. 选定的输入时间语义（§4 → **B**）

**在 `InputActivityObservation` 上新增一个原始事实 `observedTick`**：与 `lastInputTick` **同一次采集中读到的同一个 Windows 计数器读数**（`GetTickCount()`，uint32）。

- `lastInputTick` = 最后一次输入发生的计数器读数；`observedTick` = 采样瞬间的计数器读数。
- 两者**同一时钟域、同一单位、同一次快照**，因此 `observedTick − lastInputTick` 就是「距上次输入多久」，且该减法**在契约内成立**。
- **严禁** `observedAt − lastInputTick`（UTC 墙钟 − 开机相对 tick，§3 明令禁止，本轮零实现）。

**平台语义的本机可执行证据**（官方文档在本机不可达，故不写成「文档已核实」）：

| 命题 | 证据 | 结论 |
| --- | --- | --- |
| 单位是毫秒 | 本机探针：2 s 窗口内 `tickDelta = 2016` vs `wallClockDeltaMs = 2013.6`（吻合 2.4 ms） | 实测 |
| 与墙钟同速 | `ageB − ageA = 2016`，与 tick 增量**完全一致** | 实测 |
| 纪元是开机相对 | 同次读数 `tick = 265624562` ≈ 73.8 h 运行时长 | 实测 |
| `dwTime` 与 `GetTickCount()` 同域 | `lastInput(265528890) ≤ tick(265624562)`，且 age 随 tick 等量增长 | 实测 |
| 32 位回绕 / 重启复位 | 未实测（需 49.7 天或重启）；由「纪元是开机相对」+ `windows.ts` 既有 `isUint32` 校验推出 | **推断**，下文 §9 按 fail-closed 处理 |

### 为什么不是 A

A（契约不变，仅靠重复观测 + 墙钟 `observedAt`）能证明「≥ 阈值无输入」，但它**对重启是盲的**：重启后若仍无输入，新的 `lastInputTick` 会**大于**重启前的读数，A 只能把它读成「刚刚发生了输入」，于是**凭空造出一次 return**——直接违反 §5G。A 没有可用的参考时钟，无法察觉。B 让这种不连续**可检测**，且检测方式与 32 位回绕**完全一致**（都表现为 `observedTick` 变小）。

### 为什么不是 C

C（owner 导出一个 `idleForMs`）被 §4 明确排除：那是让声明「不解释」的模块开始解释。**阈值比较留在 Desktop Return owner**。

---

## 2. 选定的 source contract 变化（§2）

`input-activity.current@1` 的**形状**增加一个字段，**版本保持 `@1`**。

- 判定：按治理规则 R4 Q1–Q4，这是**能力增长**而非 **jurisdiction 扩张**——Input Activity 仍然只报告「Windows 输入活动源报了什么」，多报的是**同一个源、同一个计数器**的第二次读数；它仍然**不做任何比较、不推导时长、不认识阈值**。`isIdle → userReturned → shouldNotify` 那条**被禁止**的链条没有出现。
- **版本不改**：`serviceKey` 是 Runtime 的匹配键，新增字段对既有 consumer 是**兼容**的（旧 consumer 读到的 `lastInputTick` 仍然为真）。改成 `@2` 会让既有 `requires` 全部落空而无信息增益。这是一个**决定**，不是遗漏；若要 `@2`，改动量是一行。
- **被取代的旧冻结**：`phase-3-input-activity-architecture-review.md:446`（及 `:324`）写过「observation 里没有当前 tick，这是刻意的」。按 R7，本轮在该处留下**修订指针**，理由：该条想要的两条路径中，「consumer 自己取两次 observation」比本轮方案**更弱**——两次独立采集可能**跨越一次重启**，而两次采集都不带启动标识，配对结果无法察觉；同一次快照里读同一个计数器反而是**更强**的诚实性。仍然有效的部分是「Input Activity 不做解释」，本轮**未**越过。

---

## 3. Desktop Return owner / requires

新 Plugin：`src/desktop-return-attention/`，id `desktop-return-attention`。

```text
requires: inputActivityService
          workFocusCurrentService
          languageDesktopReturnSpeakingService
          humanDeliveryService
provides: []          ← 有意为空：没有 consumer，不发明 capability
```

- **消费原始 `input-activity.current@1`**，不消费 awareness（§11）。理由：`desktop-session-awareness` 的 facet 契约按自己的注释**只做不等比较**，「changed ≠ returned」（连续输入也会一直 changed）；`current()` 会推进**共享**基线（会偷走 awareness loop 的基线），`peek()` 又比对一条 Desktop Return 并不掌握的基线；且 Awareness 会连带拖进整个 World（含前台窗口采集）。
- **不**创建 Presence / AwayState / UserState / ActivityState / TemporalReasoning。该 Plugin 只拥有一个 concern：**在满足配置的空闲阈值之后，是否刚刚发生了新的输入活动**。

---

## 4. Occurrence 形状

```ts
interface DesktopReturnOccurrence {
  readonly observedAt: string;        // 触发它的那次观测的墙钟时间
  readonly silentForMs: number;       // 一段**已被观测到**的无输入区间的下界
  readonly designations: readonly string[];  // 触发时刻读到的 Work Focus 声明集
}
```

- 无判别字段、无 `kind`、无 `status`——与 `RepositoryCiAttentionOccurrence` 同形。
- `silentForMs` 是**下界**：它是在**最后一次确认静默的那次采样**上算出的 `(observedTick − lastInputTick) >>> 0`，即「到那一刻为止，已确证至少这么久没有输入」；那段被观测到的静默只会更长。它**不是**墙钟重建。
- **归属限定（本 Agent 对抗性复核后补写，方案 B 原措辞在这里不够精确）**：它不保证等于**刚刚结束的那一段**静默的长度。采样是离散的，两次观测之间可以塞进不止一次输入——因而也不止一段静默；当这发生时，被报出的是 `confirm` 那次采样上的读数（对它所属的那段静默仍是真下界），而紧邻本次观测之前的那段静默更短、且从未被观测到。§12.6 有可复现的最小反例。
- Occurrence 的构造被收进纯函数 `formOccurrence(...)`：**设计集为空时返回 `undefined`**（§6 的「不发声」规则与形状同处一地，CI 在 Linux 上也能验证）。

---

## 5. Work Focus 的角色（§6）

- 只用既有 `work-focus.current@1`，**零 diff**。
- 触发时读一次；**空集 → 不发声**，不构造 occurrence。
- Work Focus 只提供 Human **显式声明**的对象，**不是打断授权**：它不决定「该不该现在说」，也不提供优先级 / 显著性 / 许可。本轮不把它改造成 presence / priority / salience / permission，不改其 domain ownership。

---

## 6. 主动配置形状（§7）

两个 flag，**共同**表达一次授权；**不新增 enable boolean**：

```text
--proactive-return-after-ms <integer>   空闲阈值；它就是「启用」这个值
--proactive-return-delay-ms <integer>   采样节奏
```

- `--proactive-return-after-ms` 要求 `--proactive-return-delay-ms`，并要求语言插件（`--model-endpoint` + `--model`），错误信息把缺的东西逐个点名——沿用 `readProactivePairing` 的既有形状。
- `--proactive-return-delay-ms` **单独给出即用法错误**：它没有第二种用途，留着它而不用就是「操作者以为自己配了什么、而没有任何东西读它」——该文件自己的注释拒绝这种 flag。这与 `--repository`（可独立存在）的不对称是**有理由的**，不是疏漏。
- **为什么是两个值**：节奏必须远小于阈值，否则「回来之后最多要等一个节奏才被提醒」，产品语义就废了；而本仓库每一个 loop 都**自己拥有显式节奏、没有默认值**。把节奏从阈值推导出来是隐藏策略，本仓库拒绝。
- **不**从 `--desktop-awareness-delay-ms`、Work Focus 的存在、Language 的存在、subscriber 的存在**推导**主动许可。
- 范围校验归 Plugin 自己的 `config.parse`（沿既有 cadence/config 先例）：`delayMs ∈ [1, MAX_TIMER_DELAY_MS]`；`afterMs ∈ [1, 0xffffffff]`（上界取自计数器本身的量程，不是计时器量程）。

---

## 7. Language 第二 consumer 的方案（§8 → **A**）

**新增一个 owner 专属 speaking Service，既有 `language.speaking@1` 保持逐字节不变。**

```text
language.speaking@1                speak(RepositoryCiAttentionOccurrence)   ← 不动
language.desktop-return-speaking@1 speak(DesktopReturnOccurrence)            ← 新增
```

- 决定的依据是本仓库对 `desktop-session-awareness` 的 `current` / `peek` 写下的原话：**持有其一不得因此持有其二**。方案 B（一个 Service 两个方法）会让 `requires: [languageSpeakingService]` **同时**授予两个 owner 的说话资格；方案 C（封闭 union）不可用——`RepositoryCiAttentionOccurrence` **没有判别字段**，收窄只能靠脆弱的形状守卫。
- 具体攻击过并要求回答的两条：**「第二 consumer 出现，所以 union 就是 abstraction」** ⇒ 不成立，union 在这里需要判别字段，而两个 occurrence 的分辨只能靠结构猜测；**「Language 多 import 一个 owner 类型没关系，以后无限加」** ⇒ 每一步都要过 Contract Creation Gate，本轮的证据是**一个真实的、正在发生的 callable need**（decider 要说、没有别的路径可说），不是「以后可能有用」。
- **命名不对称要记录、不用改名去抹平**：既有 `language.speaking@1` 是一个**已在服务的契约**，为一个更对称的名字去改它，是 §15 禁止的顺手重构。`renderSpokenOccurrence` 同理，新增的是 `renderSpokenReturn`。
- Language 的两个契约放进**同一个** `contracts.ts`，照 `desktop-session-awareness/contracts.ts` 的先例（两个契约、一个 owner、一段说明它们为何是两个）。
- **Domain 拥有判断 + occurrence；Language 拥有说话回合 + 面向人的组织；Transport 拥有投递。** Domain Plugin **不生成对话式散文**。

---

## 8. Human Delivery 复用（§9）

**零架构改动。** Transport 继续只认 `deliver(lines)`；它不需要理解 idle / return / focus / repository / judgement 中的任何一个词。若确实无需改动，这本身就是「第二个 consumer 真实共享了 Human Delivery 机制」的证据。保留 `delivered` / `unavailable` / `failed`；**无队列、无重试、无历史**：投递 `unavailable` / `failed` 的那次 occurrence **不重试**。`handled ≠ delivered ≠ human observed`。

---

## 9. activation-local 状态与时间判断（§5 / §10）

```ts
interface DesktopReturnWatch {
  readonly observedTick: number | undefined;  // 上一次观测的计数器读数
  readonly silence: number | undefined;       // 已观测到、尚未结束的静默（undefined ⟺ 不在等待）
}
```

规则（纯函数 `stepReturn`，不持有状态、不接触 Runtime）：

1. **不连续守卫（G）**：若 `observedTick < watch.observedTick` ⇒ 重启或 32 位回绕 ⇒ **fail closed**：本次不判断，重置 `silence = undefined`，只更新 `observedTick`。回绕与重启**同一种处理**，因此无需区分。
2. 计算 `silence = (observedTick − lastInputTick) >>> 0`。
3. `silence ≥ afterMs` ⇒ 记录静默（取历史最大值），**不发声**，等它结束（E）。
4. `silence < afterMs` 且 `watch.silence !== undefined` ⇒ **就是这次 return**：产出一个 occurrence（D），随后回到基线（F 靠此自然成立）。
5. 其余情况 ⇒ 静默（A 首次观测只建基线；B 连续输入永不重复；C 未达阈值的停顿不触发）。
6. 观测不可用 / 采集失败 ⇒ 由 Plugin 直接跳过本 cycle，**不把「取不到」读成「没有输入」**（H）。

- **去重不复制 CI 的 runId Set**：`silence` 字段本身就是去重——一次 occurrence 之后必须**重新走完一整个空闲阈值**才可能有下一次（§10）。
- **不建通用 dedup 工具。**
- 状态跨 Runtime 重启丢失是 **v0 的可接受行为**；**不读 Chronicle / Memory**，不做跨重启的 return 检测。

---

## 10. 明确不做（§12 / §13 / §15）

- Runtime：**0 diff**。
- 不重构其他 Plugin；不建 generic framework。
- 不建：Salience 判断（「现在是不是合适的提醒时机」「Human 会不会烦」「这次 return 重不重要」「这条 Focus 值不值得提醒」）、模型判断打断时机、Presence / AwayState / UserState / ActivityState / TemporalReasoning、`GlobalWorldState`、Service Locator、Central Judgement Domain、Generic Human Input、Universal Message、Model Router。
- 不建：Chronicle 读取、Memory、持久化空闲状态、跨重启 return 检测、持久化最后输入状态。
- 不做：`speak(string)` / `speak(any)` / GenericMessage / GenericOccurrence / UniversalSpeakingMaterial / owner+payload 字典 / 任意 renderer callback / Notification 抽象 / Proactivity 抽象。
- 不改 `desktop-session-observe/presentation.ts`（它的测试逐行断言既有输出；§15 未把它列入范围）。
- 不把 §17 的测试阈值写成任何默认值。

---

## 11. 为什么是 Level 2 而不是 Level 3

逐条对照 §2 与 R5：

| 触发面 | 本轮情况 |
| --- | --- |
| Runtime public API | 无：Runtime 0 diff |
| 新 communication plane | 无：全部走既有 Service 机制 |
| 跨 Runtime | 无 |
| Memory / Goal / Action 核心语义 | 无：不读 Chronicle、不写 Memory |
| 新全局状态中心 | 无：状态是 activation-local 的一个两字段结构 |
| 新公共基础设施 | 无：无 generic framework、无 dedup 工具、无抽象层 |
| 难撤回的 public contract | 无：新增的是一个 owner 专属 speaking Service，且既有契约兼容 |
| Ownership 无法从现有规则判断 | 否：judgement 归 Desktop Return owner，说话归 Language，投递归 Transport，三者分别有先例 |
| 多领域边界冲突 | 否：只碰 Input Activity 的**能力增长**，未扩张其 jurisdiction |

**结论：无 Level 3 trigger，直接进入实现。**

---

## 12. 真实端到端验收证据（§17）

2026-09-28 23:34（本地，UTC+8）在本机跑完一次真实端到端：**运行中的 Hikari 在没有任何 Human request 的情况下，通过 long-lived `hikari subscribe` 主动送达了一条 Desktop Return attention。** 与 CI slice 的记录方式一致，本节补证据、不修改 §1–§11 的任何决定。

### 12.1 本次运行的配置（是本次的选择，不是默认值）

| 项 | 值 |
| --- | --- |
| `--proactive-return-delay-ms` | `500`（采样节奏） |
| `--proactive-return-after-ms` | `5000`（空闲阈值） |
| `--desktop-awareness-delay-ms` | `1000` |
| `--model-endpoint` / `--model` | `http://127.0.0.1:8799/v1` / `e2e-probe-model`（本机假 endpoint） |

这两个门槛值**是本轮这次运行自己选的**。plugin 没有默认节奏、也没有默认阈值，`config.parse` 拒绝缺省；本节不得被读成任何推荐值或默认值。

### 12.2 可核对的事实（本 Agent 自己观测）

| 项 | 值 |
| --- | --- |
| `hikari status` | **12** 个成员全部 `active`——base 九个、`language`、`human-delivery`、`desktop-return-attention`，最后一行是 `desktop-return-attention 状态：active`。12 = 9 + 1 + 1 + 1，与「无 repository scope + 一个 return mandate」这一格可达 roster 逐字相符 |
| Work Focus | `focus declare` 一个声明后 `focus status` 读回同一条 |
| 观察到的静默（独立探针，非 Hikari） | `silenceMs = 22031`（同一 acquirer 的原始读数） |
| 送达的时机 | `observedAt = 2026-09-28T15:34:55.907Z`，`silentForMs = 38344` |
| `subscribe` 收到的原文 | 见 12.3 |
| 模型请求数 | **0**（本机监听 8799 端口，整个运行期间零请求） |
| resident stderr | 空 |
| `hikari stop` | 退出码 0 |
| Human request | 全程没有：`focus declare` / `subscribe` 之后，本 Agent 未发出任何请求；链路里也没有任何一步会发出 |

### 12.3 Human 实际看到的文本（逐字）

```text
Desktop return attention：
  观察时间：2026-09-28T15:34:55.907Z
  已观测到的无输入时长（下界）：38344 ms
  触发时的关注对象：
    桌面回归 E2E：验证主动播报链路
```

五行加一个尾随空行，与 `renderOccurrence` 的输出逐字相同——中间没有任何一层改写、加时间戳、加引导语或摘要。

### 12.4 触发这次 return 的那次输入：本 Agent 未注入

本次运行**没有**走合成输入分支（运行时记录 `nudge: null`）：输入事件来自本机输入队列，本 Agent 未调用任何注入路径，探针与 CLI 也不会产生输入事件。

能证明的部分到这里为止：**这次 return 不是本 Agent 制造的**。不能证明的是它究竟来自哪一次物理操作——`input-activity.current@1` 读的是操作系统输入队列，它无法区分 Human 的键鼠与其他进程注入的输入，这正是本 slice 的契约命名为 **input-activity** 而不是任何关于「人」的说法（§1、§9）的原因。因此本节记的是「本机确实发生了一次非本 Agent 制造的输入活动」，不是「某位 Human 回来了」。

### 12.5 这一次证明了什么、没有证明什么

**证明了**：整条链在真实环境里成立过一次——真实 Windows 计数器与真实输入队列 → Desktop Return 真判定 → Language 真表述 → 真实命名管道 → 真实 `hikari subscribe` 进程 → Human 真收到；全程零 Human request；且被送出的字与 owner 的 renderer 输出逐字相同。这是本 slice 第一次以真实 provider 走完整链，而不是 fake provider 对 fake transport。

**没有证明**：

- **delivery 三值的真实分布**：本次只观测到 `delivered`。真实进程边界上的 `unavailable` 与 `failed` 未被覆盖，它们仍只有测试证据（含 Windows 上的真实管道测试）。
- **`endedSilenceMs` 是下界而非精确值**：本次 38344 ms 由 500 ms 的采样节奏决定分辨率，没有独立测量能证明真实静默长度；本 slice 在设计上也不声称能给出精确值（§9、`types.ts`）。
- **32 位回绕与重启**：本机无法在 49.7 天或一次重启的时间尺度上验证；该路径由纯函数测试用合成读数覆盖（跨回绕的那段静默、计数器倒退两种形态），在本机是**未实测**。
- **重新激活语义**：activation-local watch 跨 unload/reload 的行为由集成测试覆盖，未在真实 resident 上重启验证。
- **模型路径**：本次 endpoint 是本机假监听，全程零请求。因此本次运行对 `ask` / 模型表述**什么也没有证明**——这是 feature 本身的性质（proactive 路径不碰模型），但也意味着这一半在本机仍是 NOT RUN。
- **静默时长本身是短的**：约 38 s，是人短暂离开的时间尺度，不是「长时间离开」的产品场景。多长算长属于本轮明确不建的显著性边界（§10），本次运行不改变这一点。

### 12.6 对抗性复核确认的两条边界（行为保持不变）

本节的证据来自本 Agent 自己跑的探针，不是子 Agent 的文字结论：`stepReturn` 是从 `dist/desktop-return-attention/index.js` 真实导入后逐场景调用的。两条都**不改代码**，理由各写在下面。

**(1) 计数器倒退守卫会丢掉一次真的发生过的 return。** §9 规则 1 的 fail-closed 分支只在守卫命中时触发，这一点在随机时间线上是**实测**的：同一批 500k 条合成时间线，带守卫跑出 `lost = 47986`，把守卫摘掉跑则 `lost = 0`；同一批里 `fabricated = 0`、`inflated = 0`（两种跑法都是 0）——即守卫是**唯一**的丢失来源，而它同时是伪造与夸大的唯一防线。最小反例（`reanchor-low.mjs`）：`obs1 = (lastInputTick 4293886968, observedTick 4294937797)` → `silence = 1050829`；`obs2 = (lastInputTick 46843, observedTick 46956)` → 守卫先把 `silence` 清成 `undefined`，于是 `obs2` 的 `endedSilenceMs` 也是 `undefined`，**这次 return 不发声**——而 `obs2` 自己算出来的 113 ms 说明确实有新输入发生。可达条件很窄：同一段激活内连续运行满 49.7 天，且回绕落在**两次观测之间**；重启无法触发它（重启会结束进程，重新激活从 `INITIAL_DESKTOP_RETURN_WATCH` 起步，`plugin.ts` 的 `desktopReturnWatch` 初值）。**保留 fail-closed 是原决定**：同一个分支还要覆盖未建模的时钟故障（例如 VM 快照回滚），在那里「保留 silence」有伪造风险；本 slice 声明的失败方向是漏报而不是误报。要在回绕场景下保住这次 return，就只能改判定语义，那已经越过本轮的冻结边界，不在本 slice 内做。

**(2)** `silentForMs` **的归属可以早于刚结束的那段静默**，值是它所属那段静默的真下界（§4 已补限定）。这不是子 Agent 描述的「值本身被夸大」——同一批随机时间线上 `inflated = 0`，读数永远取自真实采样点。最小反例（同上脚本）：`obs1 = (469885, 603856)` → `silence = 133971`；下一次观测直接跳到 `obs2 = (824888, 878119)`，中间那次输入 `725575` 从未被采样。此时 `endedSilenceMs = 133971`，而它属于 `469885 → 725575`（真实长度 255690，下界成立）；紧邻 `obs2` 之前的那段静默是 `725575 → 824888`，只有 99313 ms，且从未被观测到。面向人的那一行写的是「已观测到的无输入时长（下界）」，**逐字为真**；不精确之处仅在归属，且归属不可能由采样修复——离散采样看不见没被采到的输入。修措辞（`types.ts` 注释 + 本节 §4）而不是修代码。

两条都**没有**在最终结论里被当成缺陷：它们各自有具体场景，但都落在本 slice 显式选择的失败方向上，且不构成「行为与其契约不符」。
