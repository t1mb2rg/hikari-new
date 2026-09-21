# Hikari 第四阶段 P4-03 Explicit Work Focus Vertical Slice Boundary Review

> 状态：**架构级 Boundary Review 已完成并落盘。**
> verdict：`EXPLICIT WORK FOCUS VERTICAL SLICE: NARROW`
>
> 本文是**只读评审的产物**：本轮**未实现任何代码**，**未新增任何 contract**，`src/` 零改动。
>
> 前置 artifact：`docs/architecture/phase-4-explicit-human-reference-review.md`（commit `87605c6`，verdict `BLOCKED`）。本文**不改写**它的结论；它记下的 BLOCKED 在本文之后**仍然成立**（见 §12）。
>
> 本文**不新增架构决定**，只固定人工裁决给出的边界与本轮由源码支撑的判断。

---

## 1. 本轮审查目标与裁决输入

**人工产品裁决（本轮的全部输入，不重新论证）：**

> Hikari 应允许用户在运行期间明确声明、替换和清除当前工作焦点。这是一个领域专用的人机入口，不是 Generic Human Input，不是通用消息入口。

**本轮要判断的最小 vertical slice：**

```text
Human explicit work focus
      ↓
current explicit focus state
      ↓
Repository CI relevance judgement
      ↓
relevant | unknown
```

**审查纪律（人工明确要求）：** 不要只设计 ingress。必须从「输入 → 当前状态 → 真实 consumer」整体审查，避免**再创建一个零 consumer Service**。

这条纪律正是本轮 verdict 之所以是 NARROW 而不是 READY 的原因——本 slice 的**前半段**（输入 → 当前状态）今天可以独立成立，而后半段（真实 consumer）不成立。

---

## 2. 证据基础与锚定纪律

本文的每一条断言都锚定到当前源码或已落盘文档，**不引用对话历史**。

| 断言 | 锚点 |
| --- | --- |
| 常驻控制通道的词汇表是封闭的，且**封闭的理由是「两个词都是常驻自己的」** | `src/cli/control.ts:2-10` |
| 控制通道只答 Runtime 已持有的事，**不触达任何 Plugin** | `src/cli/resident.ts:296-308`（`residentControlHost`） |
| 端点生命周期模式（`unref` / 有界关闭 / 先 destroy 连接再 close listener） | `src/cli/control-endpoint.ts:8-12` 与全文 |
| Plugin 拥有并登记 socket 是**明文 MUST**，不是可选项 | `docs/architecture/plugin-design-spec.md` §8.1 |
| 生命周期契约：`context.defer`、LIFO、幂等、`AggregateError` | `src/runtime/plugin.ts`、`src/runtime/runtime.ts` |
| `repository-ci-awareness` 的判词只读两个 commit 字符串，且**无 config、无状态、pull-only** | `src/repository-ci-awareness/plugin.ts:7-35, 37-65` |
| 仓库在**唯一的 repository 引用入口**就拒绝裸仓库名 | `test/github-ci.test.mjs:193-210`（`{ repository: 'hikari-new' }` 被拒） |
| CLI 只回答**词法**问题，领域规则归 owner 的 `config.parse` | `src/cli/options.ts:52-61` |
| 无 consumer Service「不构成一般许可」 | `docs/development/current-stage.md:17` |
| 冻结禁止清单 | `docs/architecture/core-architecture-v0.md` §11、§6.6；`CLAUDE.md` |

**关于证据强度的一处自我限制：** 本轮曾尝试用 subagent 统计「生产组合中全部 plugin definition 的数量」，其报告自述为 12，而同报告自身表格只列 11。该数字**不可采信**，本文因此**不引用任何 plugin 计数**。需要计数时，锚点是 `src/cli/resident.ts:106`（「Exactly seven plugins」）这一行**当下源码**。

**关于该锚点的一处后续位移（本轮 NARROW 前半段落地之后补记）：** P4-03 Explicit Work Focus Local Ingress v1 把 `work-focus` 作为**第八个** Plugin 加入了生产组合，因此上面引用的那一行当时变成了「Exactly eight plugins, and nothing else.」。**本文写就时它确实是 seven**，本句只记录锚点位移，不改动本文其余任何结论；「需要计数时以当下源码为准」这条纪律不变，落点改为 `src/cli/resident.ts` 的 `productionComposition`。

**该锚点的第二次位移（P4-03 收口后补记，最小事实修正）：** 上面引用的「Exactly eight plugins, and nothing else.」**在当前源码中已不存在**。Repository CI Relevance v1 让生产组合变成**两个合法组合**，`src/cli/resident.ts` 现在是：

```text
default          — the eight members below, and nothing else
Repository CI    — those same eight, plus the five-member Repository CI chain
```

**「八个」是【默认组合】这一条可执行事实，不是架构不变量。** 显式同时给出 `--repository-root` 与 `--repository` 时为**十三个**成员。计数纪律不变：以当下源码为准。本节只作事实修正，不改动本文其余任何结论，也不改变本文 verdict（**NARROW**）——该 verdict 的历史性质见 `docs/architecture/phase-4-p4-03-entry-review.md`。

**该锚点的第三次位移（Desktop Observation Surface v1 收口后补记，最小事实修正）：** 上面引用的「the eight members below」**在当前源码中已不存在**。`desktop-session-observe` 作为默认组合的第八个成员加入，`src/cli/resident.ts` 现在是：

```text
default          — the nine members below, and nothing else
Repository CI    — those same nine, plus the five-member Repository CI chain
```

即：**默认组合九个成员，显式组合十四个**。上面两段里的「八个」/「十三个」是**当时**的计数，作为位移记录保留，不再代表当下源码；计数纪律不变。

**当前工作区事实（写完本文前实测）：** `git log --oneline -3` = `87605c6 / 18bca09 / 6d537e0`；`origin/main` = `87605c68a332437aa0122b34ab337ba14b0387b8`；`origin/main..HEAD` = 0；`git status --short` 为空。`src/` 中 `relevance` 零命中，`workFocus` / `work-focus` 零命中。

---

## 3. occurrence 结论收紧（本文相对上一轮的一处措辞更正）

上一轮评审曾出现「occurrence 现在真实存在」的说法。**该说法不成立，本文予以收紧。**

今天代码中**仍然没有 runtime human ingress**，因此**今天尚不存在实际被 Hikari 接收的 human declaration occurrence**。

准确结论是：

> **产品 mandate 已经使 runtime human declaration 成为真实需求；**
> **当 Explicit Work Focus ingress 实现并实际接收到 declare / replace / clear 请求时，**
> **Hikari 才第一次真正拥有 human declaration occurrence。**

纪律一句话：

> **不要把「产品需求已成立」写成「运行事实已经发生」。**

这条更正不降低本轮的判断——它恰好**支持** NARROW：mandate 使 ingress 这一半成为可以正当实现的工作（§6），而「已发生」这一半仍待实现后才会出现。

---

## 4. verdict 与它的两半

```text
EXPLICIT WORK FOCUS VERTICAL SLICE: NARROW
```

```text
前半段（可以现在实现）
  Human explicit work focus  →  current explicit focus state
  —— 这一半今天就能独立成立，且是一个真实用户能力

后半段（尚不成立）
  current explicit focus state  →  Repository CI relevance judgement  →  relevant | unknown
  —— 缺的不是输入、不是入口、不是表示、不是命名，缺的是【真实 reader】
```

**为什么后半段不成立（一句话）：** 判词要成立就必须**发布**；发布即新建跨模块 contract；而今天**没有任何 module 会读它**。唯一候选 reader 是一个跑 `hikari status` 的人——那是一个 **client，不是 consumer**。本仓库对 consumer 的门槛是**模块级**的（`current-stage.md:17`），或由人工对**这一个** slice 明确裁决授权。

因此本轮**不描述 Relevance 的最小形状**，也不为它发明 contract。

**这一点与上一轮的 BLOCKED 是同一个缺口的不同措辞**：上一轮说「缺已发生的语义」，本轮说「缺真实 reader」。二者不冲突，本轮的表述更精确——上一轮列的四条重新审查触发条件中**第一条「出现真实 runtime human ingress」在实现本 slice 之后才可能满足**，而它恰好是本文允许实现的那一半。

---

## 5. 本轮已成立的结论（逐条记录）

以下结论本轮已经成立，**后续不必重做**：

1. **verdict = NARROW**（§4）。
2. **runtime work-focus 的 domain owner 应是一个领域 Plugin。** 它 owns：local endpoint、current state、declare / replace / clear semantics、request parsing、endpoint lifecycle。
3. **不复用 Resident control channel。** 理由是 `src/cli/control.ts:6-10` 自己写下的那条理由，不是一条笼统禁令：控制通道的词汇表之所以封闭，是因为它的两个词（进程寿命、操作者被告诉什么）**都是常驻自己的**；一个语义属于别的模块的 kind「必须经由这里去够那个模块，而够别的模块正是 router 做的事」。work-focus 的语义属于 work-focus，因此它不属于那里。
4. **不创建 Generic Ingress / router。**
5. **CLI 只是 transport client。** 不保存状态、不解释 designation、不 normalize、不承担 domain rules。
6. **Plugin 拥有 endpoint、解析、state 与 lifecycle。**
7. **state 是用户原文 designation 集合。**
8. **declare / replace / clear 是集合写变换。**
9. **status 读取当前集合。**
10. **no normalization。**
11. **no model。**
12. **no persistence。**
13. **lifetime = plugin load / resident process。**
14. **restart 后为空。**
15. **occurrence 不公开成 Event。**
16. **不写 Chronicle。**
17. **不创建 work-focus Service。**
18. **Repository CI Relevance 仍 blocked**（§12）。
19. **`relevant` 的唯一未来合法规则目前是：designation 逐字等于 GitHub canonical `owner/name`**（§13）。
20. **`unrelated` 仍无合法依据**（§14）。
21. **不引入 `RepositoryIdentity`**（§15）。

---

## 6. 为什么前半段可以现在实现

它不是「为未来 consumer 预埋」，而是一个**今天就有真实用户**的能力：Hikari 运行期间，人可以 declare / replace / clear / status 当前工作焦点。

需要注意一条**不对称**：上一轮的 BLOCKED 针对的是一个**跨模块 contract** 是否成立；本轮允许实现的这一半**不发布任何跨模块 contract**——它把状态完全留在 owner Plugin 内部，经由一个**本机端点**被人的 CLI 读写。§16 的 Contract Creation Gate 管的是 contract，不是「Plugin 自己拥有的能力」；不新增 contract，就不在它的射程内。

`plugin-design-spec.md` §8.1 明文把 **socket** 列在「Plugin 创建的资源由该 Plugin 拥有并登记到 Runtime lifecycle mechanism」的适用范围里。因此「Plugin 自己拥有一个本机端点」是规范**已经写明**的方向，不是本文新开的口子。

**诚实的前置说明（必须与结论同时阅读）：** 本仓库**没有任何先例**——今天唯一真实的监听器属于 CLI 组合根（`src/cli/control-endpoint.ts`），不属于任何 Plugin。因此本轮实现要建立的是**第一条** Plugin-owned endpoint，风险落在 lifecycle 正确性上。缓解方式是**参考模式而非共享代码**（§7）。

---

## 7. 「参考实现模式」不等于「共享 transport」

允许复用的是**已验证的生命周期形状**：

```text
setup 内创建
所有资源由 Plugin ownership 管理
listener 与每个 accepted socket 都 unref()  → 端点永远不是进程活着的理由
socket 有 idle timeout
close 顺序：先 destroy 已接受连接，再 close listener
cleanup 有界
```

**不允许**的是 import / 泛化 / 抽象 `control` 那套 transport。理由与 P3-02 拒绝抽公共 helper 的理由同型：**两个实例不足以判定「稳定共享机制」与「各自 semantics」的边界在哪里**，而错误的抽象一旦被两个已交付模块依赖，就获得事实上的冻结地位。`src/cli/control.ts` 的注释已经明写它是常驻自己的、无 registry、不是 shared infrastructure（`:2-10`）——把它变成插件基础设施，等于**改写一段已经冻结的模块身份**。

---

## 8. 反例检查：哪些「顺手」的做法是错的

| 做法 | 为什么错 |
| --- | --- |
| work-focus Plugin 订阅 `desktop-session-awareness-loop.assessed` | 那是把「什么时候再问一次」变成 work-focus 的输入；焦点与桌面会话变化无关 |
| work-focus Plugin `requires: repositoryCiWorldService` 自己算 relevance | 那让 work-focus 开始**知道 Repository CI**，越过 §12.4 的分层底线 |
| work-focus endpoint 转发/路由到另一个模块的 endpoint | 那正是 `control.ts:9-10` 定义的 router |
| 把 work-focus 塞进常驻控制通道的词汇表 | §5.3；且会让控制通道第一次出现「语义属于别人的词」 |
| 创建 `work-focus.current@1` 供未来 consumer 使用 | §16：无真实 callable need 时不创建 Service；且会成为第三个无 consumer contract（模式而非例外） |
| 把 designation 写进 Chronicle | Event ≠ Durable Fact；「声明过焦点」与「决定长期记住」是两件事 |

---

## 9. 边界与禁止范围（本轮冻结）

**架构边界：**

```text
Work Focus Plugin   domain owner：endpoint / state / semantics / parsing / lifecycle
CLI                 只是 client；无状态、不解释、不 normalize、不承担 domain rules
Resident            只负责 composition；不成为领域 router；不理解 work-focus semantics
Runtime             不修改 public API；不理解 ingress semantics
```

**本轮严禁创建：**

```text
work-focus.current@1        work-focus Event        Repository CI Relevance
HumanStatement              Generic Human Input     Generic local RPC framework
Resident router             Chronicle integration   persistence
model integration           ReferenceFrame Service  CurrentConcern
Goal / Planner / Memory     salience / importance / notification / action
```

`CLAUDE.md` 与 `core-architecture-v0.md` §11 的既有禁止清单**同时生效**，本清单是它的本轮投影，不是替代。

---

## 10. 状态形状的边界（由实现 Boundary Freeze 最终确认）

本轮**倾向** `readonly string[]`，但**最终形状由实现的 Boundary Freeze 确认**，本文不代做该决定。

已经确定的是**不得添加**：

```text
id      enteredAt    updatedAt    source    provenance field
revision    priority    expiry
```

**保留用户提供的原始 designation 文本。** 不得：

```text
trim 后保存成另一种值    case fold    basename 推断
owner/name 推断          模型 normalize
```

输入合法性所需的**最小词法校验**可以做，但**不得改变 designation 的语义**。

---

## 11. 失败语义与测试面的边界

本 slice 需要**明确并测试**的失败面（具体形状由实现确认）：

```text
endpoint bind failure          malformed request        unsupported command
client disconnect              request while shutting down
cleanup with active connection
```

**一条本轮的冻结纪律：失败不得被压成 absence。**

`ControlOutcome` 今天把「没人应答」拆成 `absent` / `unavailable` 两类，正是这条纪律的既有形态（`src/cli/control.ts:34-37`）。本 slice 沿用该**形状**，但**必须重新推导措辞**：与常驻控制端点不同，work-focus endpoint **不能**比它所属 Plugin 的 activation 活得久（§7），因此停机期间连不上**不能**被说成「没有常驻」。这条差异必须写进实现的注释，不能靠沿用文案掩盖。

**同时不得**为了这些失败创建通用 ingress failure framework。

---

## 12. Repository CI Relevance 仍 blocked

```text
REPOSITORY CI RELEVANCE: BLOCKED（不变）
```

**为什么仍 blocked，逐条：**

1. **唯一 blocker 未变：没有真实 reader。** 判词要成立必须发布 → 发布即新建跨模块 contract → 今天没有任何 module 会读它。人工跑 `status` 看一行输出的人是 **client，不是 consumer**。
2. **上一轮的 BLOCKED 直接继续生效。** `phase-4-explicit-human-reference-review.md` §13 的结论没有因为本轮而失效，本文也没有改写它。
3. **本轮实现的 endpoint 不会自动解封它。** 本 slice 交付的是「Hikari 能收到并持有 designation」这件事——它是 blocker 的**必要条件**，不是充分条件。解封仍需要**真实 reader**（人或循环真的会读该判词），或人工对**这一个** slice 的无 consumer contract 明确授权。
4. **分层底线：** 若未来要算 relevance，从 work-focus 到判词**恰好需要一条边**到 `repositoryCiAwarenessService`，且 work-focus **不得**直连 `repository-ci-world` 或两个感知。

---

## 13. 未来唯一合法的 `relevant` 规则（记录，不实现）

```text
designation 逐字等于 GitHub canonical owner/name
```

判据来源：`snapshot.githubCi.observation.repository`——GitHub **API 报告**的规范拼写，**不是**配置里的拼写（`src/github-ci/types.ts:44-57` 明写这两个会在配置拼写不同时不一致）。

**逐字比较**与仓库既有纪律同型：`repository-ci-awareness` 的 commit 比较就是「no trimming, no case folding, no prefix or length matching」（`src/repository-ci-awareness/plugin.ts:25-34`）。

**为什么拒绝 basename / 名字片段推断**，有一条仓库内证据而非泛泛的保守：本仓库在**唯一的 repository 引用入口**就拒绝裸仓库名——`test/github-ci.test.mjs:198` 明确断言 `{ repository: 'hikari-new' }` 被 `GitHubCiError` 拒绝。一个下游层如果接受 basename，就等于在仓库已经拒绝的地方重新接受它。

**诚实标注一处张力（必须与结论同时读）：** `test/repository-ci-awareness.test.mjs:344-369` 的 `differing` fixture 要求**名称匹配不得进入 commit 比较**。它约束的是**比较**，**不是**「一个下游 relevance 层按引用读取 snapshot」。二者不冲突，但该 fixture 的存在意味着任何未来的 relevance 实现都必须显式说明这条区分，不能默认它显然成立。

---

## 14. `unrelated` 仍无合法依据

与上一轮同型，本轮不变：`unrelated` 需要一个**比较范围（comparison scope）**，而今天不存在这样一个范围——没有任何东西界定「哪些 designation 与这个 repository 无关」。因此判词元数保持：

```text
relevant | unknown
```

`unknown` 承载「无从判断」，**不承载**「判断为无关」。

---

## 15. 不引入 `RepositoryIdentity`

`RepositoryIdentity` / `ProjectIdentity` 是跨层同一性判断，属于本轮明令禁止的范围。逐字相等是一条**字符串比较**，不是一个 identity 模型；把它写成 identity 会把一条窄规则抬成一个架构层。

---

## 16. 本轮明确未做

- 未实现任何代码，未新增任何 contract，`src/` 零改动；
- 未创建 work-focus Plugin / Service / Event / endpoint；
- 未新增 CLI command；
- 未修改 Resident composition，未修改 `src/cli/control.ts` / `control-endpoint.ts` / `resident.ts`；
- 未写 Chronicle，未新增持久化；
- 未引入 relevance / salience / importance / notify / action；
- 未创建 fake consumer，未创建 `docs/plans`，未新建 feature branch。

---

## 17. 已知限制

- 本文的 NARROW 是**关于「下一 slice 是否已就绪」的判定**，**不是**「P4-03 已完成」。P4-03 的 commit 级 judgement（`repository-ci-awareness` v1）不受本文影响。
- §6 的「Plugin 拥有 endpoint 是规范已写明的方向」是**规范文本**结论；**仓库今天没有任何 Plugin-owned endpoint 先例**。这是本轮实现要建立的**第一处**，风险在 lifecycle 正确性，不在方向。
- §10 / §11 的形状是**倾向**，最终由实现的 Boundary Freeze 确认；本文不代做实现决定。
- §13 的规则是**记录**，不是实现授权；它不解除 §12 的 BLOCKED。
- 本文不构成无 consumer contract 的一般许可，也不构成对「未来会有 reader」这一假设的认可。
- 本文只补**最小必要 traceability**：它引用既有文档与源码，不改写 `current-stage.md` 的其它章节。
