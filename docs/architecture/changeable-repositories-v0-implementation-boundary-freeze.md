# CHANGEABLE REPOSITORIES v0 — IMPLEMENTATION BOUNDARY FREEZE

- 日期：2026-10-13
- 前置：`docs/architecture/authorized-repository-action-v0-boundary-review.md`（VERDICT **NARROW**）。
- 本文只冻结实施边界，**不重开架构问题**。与 Human ruling 冲突时以 ruling 为准。
- 本文覆盖的是那一轮的**前半段（声明）**。**后半段（行动）不在本文权限内**——它需要一次 Composition Boundary Review，理由见 §7。

---

## 1. 范围：本片只做"人授权了哪些可改仓库"

**本片不启动任何执行者、不改任何仓库、不碰 Language。** 它只把一件人类的事变成**可读、持久、可核**的声明：

> **哪些目录，Hikari 被允许去改。**

**为什么这一半可以独立落地**：它的参数是**一个路径**，不是一句人话——同 `hikari focus declare <path>` 的先例。**人话的入口只有 Language 一个**，本片不制造第二个（`src/language/plugin.ts:81` 逐字：第二个这样的能力是 **Composition Boundary Review** 的触发）。

---

## 2. 为什么需要一个新 Plugin，而不是复用 `work-focus`

`work-focus` 的 concern 是「**我在做什么**」，用途是 relevance 判断，**只读**。

本片的是「**哪些仓库可以被改**」，是**可写**权限的来源。**两件事的 concern 与权限都不同**，混在一起会让 `work-focus` 的语义变成两个（同 `governance-rules-v1.md` R4 的精神：不要用"加一个字段"的形式完成管辖扩张）。

---

## 3. R4 判级

- **Q2（在备选项之间做选择吗？）——否。** 它不做排序、不做优先级、不做评分；它存的是 Human 写下的集合。
- **Q4（必须决定一件人类和 source 都没给出的事吗？）——否。** 每一个值都来自 Human 的显式声明。
- 全否 → **capability growth → L1**。本片**不发布 Service 契约**，因此不触及 R4 意义上的管辖扩张。

---

## 4. 公共面（**冻结面**）

### 4.1 Plugin

```text
id       changeable-repositories
version  1
requires [chronicle]
provides []                    ← 有意为空：今天没有消费者（见 §4.4）
config   { rootDir }           ← 同其它 Plugin，数据目录
```

### 4.2 CLI（四个词）

```text
hikari change declare --data-dir <path> <目录> [<目录> ...]   把一个或多个目录加入集合
hikari change replace --data-dir <path> <目录> [<目录> ...]   用给出的集合替换
hikari change clear   --data-dir <path>                       清空
hikari change status  --data-dir <path>                       看现在授权了什么
```

**`declare` 是并集、`replace` 是整体替换、`clear` 是清空**——与 `hikari focus` 的三个词同义，不发明新语义。

### 4.3 端点协议（一条线，恰好三键）

```text
请求   { "protocol": 1, "request": "declare" | "replace" | "clear" | "status",
         "repositories": ["<目录>", ...] }         ← clear/status 时为空数组，键仍在
应答   { "protocol": 1, "outcome": <四个词之一>, "lines": ["...", ...] }
```

**应答的 outcome 是四词闭集**：

| 词 | 含义 |
| --- | --- |
| `changed` | 集合真的动了 |
| `unchanged` | **语义无操作**（声明了已有成员 / 清空了已空的集合）——**不写事实** |
| `refused` | Hikari 拒绝这一次（理由在 `lines` 里，见 §4.5） |
| `failed` | Hikari 没能完成（理由在 `lines` 里） |

`unchanged` 与 `changed` 分开，是本片对「语义无操作不产生事实」这条既有取向的落实。

### 4.4 为什么 `provides` 是空的

今天的唯一读者是 CLI，它走**本插件自己的端点**（同 `hikari content status`）。**不为假想的消费者发布契约。**

**拆分/发布条件（写下来，免得下次重新想）**：当**本插件之外的第一个真实消费者**出现时（例如行动那半），再发布 `changeable-repositories.current@1` 并随之拆分——与 `work-focus` → `repository-ci-relevance` 当年的路径完全一样。

### 4.5 人可见字面（**冻结面**）

```text
空集合时的 status 首行     「这个数据目录里还没有授权任何可改仓库。」
refused：目录不存在        「<原样路径> 不是一个存在的目录。」
refused：不是绝对路径      「<原样路径> 不是一个绝对路径。」
refused：持久化未确认      「记不下这次授权，所以没有采纳它。」
failed：端点不可达         「没有常驻在跑，或者它没有提供这个入口。」
```

**`status` 的正文**：每行一个**规范化后的**目录，不排序、不加装饰、不显示声明时间。

---

## 5. 状态与持久化

| | |
| --- | --- |
| **state** | 在 activation 闭包内，**由 Chronicle 读回重建**（Human 裁决 7：声明是持久的） |
| **事实家族** | `changeable-repositories.changed` v1 |
| **source kind** | `changeable-repositories.declaration`（**不是** `human`——入口没有认证，`durable-fact-admission-v0.md` 逐字禁止那样声称） |
| **payload** | `{ operation: 'declare' \| 'replace' \| 'clear', repositories: [规范化目录...] }` |
| **每条事实携带"转换之后的完整集合"** | 于是读回 = **最新一条事实的集合**，不需要重放逻辑 |
| **语义无操作不写事实** | 声明已有成员、清空已空集合 → 零 append |

### 5.1 一处**有意偏离 `work-focus` 先例**的地方（需要 Human 确认）

`work-focus` 在持久化未确认时的行为是「**状态照常改变、不回滚、不重试、不抛出，而降级对调用方可见**」。

**本片不这样做：持久化未确认 → 拒绝这次声明（`refused`），内存里的集合不动。**

理由：那是"一个 designation 记不下来"，这是"**一条授权记不下来**"。

> **一条不持久的授权不是授权**——它会在重启后静默消失，而依赖它的人以为自己授权过。

**这是有意的偏离，不是遗漏。** 代价：常驻在共享冲突或磁盘异常时会**拒绝**而不是"先答应下来"。

---

## 6. 生命周期与失败语义

- **endpoint 绑定失败** → Plugin `failed`（同 `work-focus`），而不是一个没有入口的 `active`。
- **非 win32**：`endpoint-path.ts` 返回 `undefined` → Plugin `failed`，客户端说"本机没有"，**不假装支持**。
- **`chronicle` 未就绪** → `waiting`（`requires` 的 `every` 语义）。
- **端点接了连接却不作答** → 客户端 `failed`，不是 `refused`。

---

## 7. 明确不做（本片一个都不做）

- **不启动任何执行者**、不改任何仓库、不 commit、不 push；
- **不发布 Service 契约**；
- **不碰 Language**——人话的第二个入口是 **Composition Boundary Review** 的辖地，`src/language/plugin.ts:81/210/509` 三处逐字规定；
- **不做**通用 designation 机制（触发条件：第三个同型声明出现）；
- **不做**仓库身份推断——**不做** owner/name 拆分、remote URL 推断、basename 匹配、逐字相等之外的任何匹配；
- **不做**继承 / 通配 / 目录递归展开；
- **不做**权限框架、不做审计界面、不做动作历史（那是后半段的事）；
- **不把**声明当成"授权现在可以动"——它只说明"哪些目录在范围内"，**每次动作的授权是另一件事**。

---

## 8. 一个必须写明的语义：声明的**含义**

> **声明的是一个目录；它的含义是"这个目录及其内容"。**

判定方式（后半段会用到，但现在就冻结）：**两边都用 `realpath` 规范化后再比前缀**。因此：

- 同一个目录的不同拼写（大小写、`..`、短名、符号链接）**归为同一个**；
- 一个**不存在**的目录**不能**被声明（`refused`），因为 `realpath` 需要它存在——**这是刻意的**：授权一个不存在的东西是授权一个将来可能是任何东西的名字。

---

## 9. 验证计划

- `npm run build` exit 0；
- `npm test`：新增 `test/changeable-repositories.test.mjs`，至少覆盖：
  **真实进程经 CLI 走完整链路**（declare / status / replace / clear）；
  **端点跟随 activation**（加载前没有、卸载后没有）；
  **语义无操作连 append 都不调用**（声明已有成员 / 清空已空集合）；
  **重启后仍在**（卸载再加载，读回同一个集合）；
  **持久化未确认时拒绝**（§5.1 的偏离要有一条断言钉住，否则它会退化成 `work-focus` 的行为）；
  **不存在的目录被拒**、**非绝对路径被拒**；
  **非 win32 的行为**（自我 skip）；
  **数据目录里只多出应有的事实文件**（不引入自己的存储）。
- `dotnet run apps/human-surface/...`：本片不碰 C#，但**照跑**（跨语言门禁不能因为"我没碰它"就不跑）；
- CI：两颗 runner 上都要绿。

---

## 10. 待 Human 冻结的字面清单

1. **CLI 四个词**：`hikari change declare | replace | clear | status`。
2. **Plugin id**：`changeable-repositories`。
3. **端点的四个 outcome 词**：`changed` / `unchanged` / `refused` / `failed`。
4. **§4.5 的五条人可见句子**（逐字）。
5. **§5.1 的偏离**：持久化未确认 → **拒绝**，而不是"照常改变 + 让人看见降级"。
6. **§8 的语义**：目录及其内容；两边 `realpath` 后比前缀；不存在的目录不能被声明。

上面六条点头之后，我按仓库流程实现：**实现 → Functional Review → Architecture Review → `detect_changes` → commit / push / CI**。
