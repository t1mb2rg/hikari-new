# M2 文档自检（Functional + Architecture Review）

对象：`docs/architecture/memory-core-m2-architecture-v0.1.md`（实测 **447 行 / 28,344 字节**，`Get-Content -Encoding utf8` 与 `read` 工具读数一致；12 个 `## ` 标题 = 11 节 + 「需要人工决定的事项」。结案时修正四处引证后字节数由 27,744 增至 28,344，行数不变）
基线：`main` @ `ce12a15`
输入：`experiments/m2-code-facts.md`、`experiments/m2-design-options.md`

---

## 一、Functional Review

### 1.1 任务书 11 节逐条核对

| 要求节 | 文档位置 | 是否写满 | 备注 |
|---|---|---|---|
| 当前状态与问题分析 | §1 | 是 | 五个「现在有什么」全部带行号；六个问题用表对齐 |
| Memory 职责边界 | §2 | 是 | 三域对照表 + 「必须负责」三条 + 「明确不负责」六条 |
| 数据模型候选 | §3 | 是 | 记录结构 + 刻意不设的四个字段及理由 + 与 Finding 的六项对照 |
| 持久化方案比较 | §4 | 是 | 为什么不是投影（带行号）、推荐形态、必须处理的四件事 |
| 时间与有效性模型 | §5 | 是 | 三个时间对照 + 工程/模型分工表 + 与 TTL 的四项判别 |
| 来源追溯机制 | §6 | 是 | 五种 source kind + 四种指针状态的渲染方式 |
| 模型自主读写机制 | §7 | 是 | 四个接口 + 不设规则 + 不设触发 + 模型需要知道什么 |
| World/Session/Memory 关系图 | §8 | 是 | mermaid 图 + 依赖方向说明 |
| 生命周期与恢复机制 | §9 | 是 | 启动五步 + 运行 + 卸载 + 四种损坏处理 |
| 风险/替代/未决 | §10 | 是 | 6 项风险 + 6 项排除方案 + 5 项未决 |
| 实施阶段与验收 | §11 | 是 | M2-a/b/c 三段，每段有验收标准 |

### 1.2 代码依据抽查（五处，逐条对源码）

| # | 文档引用 | 源码实际 | 结论 |
|---|---|---|---|
| 1 | `findings.js:149-158` 记录八字段 | `const record = { findingId, scope:{project,sessionId}, claim, status, provenance, evidence, recordedAt, seq }` | ✅ 一致 |
| 2 | `findings.js:71-76` 四条迁移两个终态 | `TRANSITIONS = { open:['confirmed','refuted'], confirmed:['resolved','refuted'], refuted:[], resolved:[] }` | ✅ 一致 |
| 3 | `findings.js:387-393` `currentFindings` 依赖 `ctx.sessions.get` | 同左，且 `stateOf(session, FINDINGS_PROJECTION_KEY)` | ✅ 一致 |
| 4 | `findings.js:233` 检索签名只有 `query/limit/offset` | `searchFindings(findings, { query, limit = 4, offset = 0 } = {})` | ✅ 一致 |
| 5 | `dsh-scope/lib/index.js:189-192` `effect` 返回 `ctx.effect(...)` | `effect(ctx, action, options) { … return ctx.effect(function* () { … }) }` | ✅ 一致（本次现读，非引用 M1 结论）。完整路径：`G:\work\LAB\code\_poc\poc01\node_modules\@deepseek-ai\dsh-scope\lib\index.js`——该包在 PoC 安装目录里，**不在本仓库的 node_modules 下** |

**抽查之外，另核对两处**：`memory/tools.js:14-18` 的 `search_memory` 描述确实以「Searching is your choice, not a required step」结尾；`memory/index.js:9` 确实写着「不做 Finding → Memory 同步，不新增持久化，不引入检索算法」——文档 §2.3 引用的边界有出处。

### 1.3 三类标注是否混用

计数：全文 `[F]` 20 处、`[I]` 33 处、`[H]` 8 处（其中 `:7-:9` 是三行图例，扣掉后正文为 **19 / 32 / 8**）。首版写的 33/7 是 §4.3 那处标注改动前的数字，未同步；此处为改后实测值。

发现一处混用并已修正：§4.3「追加原子性」原本标 `[I]`（设计推论），但它实际是**平台行为假设**（单次 write 不撕裂），本应标 `[H]`。已改为 `[H]` 并写明「未在 NTFS 与 POSIX 上实测」。

其余各处抽查未发现把推论当事实的情况。**[F] 的每一处都指向一段可以立刻打开核对的行号**，没有「根据经验」「一般来说」这类表述。

### 1.4 判据逐条

| 判据 | 结果 |
|---|---|
| 文档存在且含 11 节 | ✅ 11 个 `## ` 标题 + 独立的「需要人工决定的事项」 |
| ≥10 处 `文件:行号` 引用 | ✅ 远超（`[F]` 共 20 处，其中同一行内带 `` `…:N` `` 行号锚点的 13 处；评估者按「正文 19 处、带行号 13 处、全文 14 处」计，与我实测一致） |
| 三类标注可检索 | ✅ `[F]`/`[I]`/`[H]` 全文一致，正文计数 19/32/8（全文 20/33/8 含三行图例） |
| 末尾 ≥5 条待人工决定，各带推荐与替代 | ✅ 8 条（原 7 条 + 复查补的第 8 条） |
| `hikari-native/` 与 `cordis.patch.yml` 无改动 | ✅ 见第三节 |

---

## 二、Architecture Review

### 2.1 所有权是否唯一

| 状态 | 所有者 | 是否被别处复制 |
|---|---|---|
| Finding 记录 | World（`findings.js:379` 注册投影） | 否——Memory 只经冻结 Service 读（`:32-42`） |
| Memory 记录 | Memory（§3.1 自有 `memoryId`） | 否——`source` 是指针不是副本（§6.1） |
| Session 日志 | DSH | 否——Memory 只读引用（§6.2 明确「只能记录不能保证回查」） |

**结论：通过。** 文档里没有任何一处把别人的状态复制一份存下来。

### 2.2 依赖方向

`memory → world`（单向）、`memory → session`（只读）、`world ⊥ memory`。

**[F] 现状已满足**：`world/findings.js` 全文不含 `hikari-memory` 字样；`memory/index.js:15` 的 `inject` 只声明 `tools` 与 `hikariWorldFindings`（首版误写成 `:11`，那是注释块收尾，已按实测行号改正——`export const inject` 在 `:15`）。

**结论：通过。** 文档 §8 的图与实际依赖一致，没有画出一条代码里不存在的边。

### 2.3 是否引入禁止结构

| 禁止项 | 文档中是否出现 |
|---|---|
| GlobalWorldState | 未出现；§10.2 显式列为排除项 |
| Service Locator | 未出现；Memory 通过 `ctx.get('hikariWorldFindings')` 拿一个具体契约，不是通用查找器 |
| Central Judgement Domain | 未出现；§5.2 把语义判断全部划给模型 |
| Universal Message / HumanStatement | 未涉及 |
| 新数据库 | §4.2 明确用 JSONL，§10.2 排除向量库 |
| Finding → Memory 自动同步 | §2.3、§7.2、§10.2 三处明确不做 |

**结论：通过。**

### 2.4 有没有替模型做语义判断

逐条看工程动作：

- 不做自动写入（§7.2）✅
- 不做自动注入（§7.3）✅
- 不做自动过期（§5.3）✅
- 检索排序**不按「是否过期」或「重要性」**，只按词元命中数（§5.4 明确「不排序、不标注已过期」）✅
- `validTo` 只表达不动作（§5.2）✅

**唯一一处需要盯住的地方**：§11 的 M2-c 打算加 `since`/`until` 时间范围过滤。这**不是**语义判断（「上个月之后」是确定性条件），但要在实现时守住——**不能顺手加 `status` 过滤**。文档 §7 已写明理由。

**结论：通过，附一条实现期约束。**

### 2.5 边界是否可被偷偷越过

文档 §2.3「明确不负责」六条与 §10.2「明确排除」六项构成一张负面清单。逐条比对 M2-a/b/c 的实施阶段：

- M2-a 只做存储层，不挂载插件 → 不越界
- M2-b 加写入工具 → 落在「Memory 拥有自己的数据」边界内
- M2-c 来源解析与时间渲染 → 不涉及 World 内部结构

**没有发现「先做了再说」的隐藏项。**

### 2.6 发现但未修正的问题（留给人工）

1. **记忆无限增长**：文档只做到「不自动过期」，没有清理机制。§10.1 把它列为风险，缓解措施偏弱。已在待决定事项补第 8 条（推荐 M2 接受无限增长，把「忘」留给模型主动删除）。
2. **`schemaVersion` 演进**：§4.3 选择「不匹配就拒绝启动」，但没说 M3 该怎么迁移。已在 §10.1 与待决定事项第 3 条标出。
3. **外部调研的覆盖范围**：`experiments/m2-external-survey.md` 在本文档首版写作期间尚未产出，首版 §3/§4/§5 的方案比较**全部基于代码事实与约束**。该文件随后完成（204 行，Letta / Hindsight / OpenViking / Zep-Graphiti，每条带 URL），本文档正文**没有逐条吸收**它——外部设计只作旁证，不作为论据。特别记一条：Zep/Graphiti 的 bi-temporal 四时间戳（`t_valid`/`t_invalid` 与 `t'_created`/`t'_expired`）与本文档 §5 的三个时间是**不同的切法**（它按事实级有效区间，本文档按「工程表达 / 模型判断」分工），没有照搬。

---

## 三、受保护路径无改动

```
$ git status --porcelain -- hikari-native cordis.patch.yml
（空）
```

完整 `git status --porcelain` 里新增的未跟踪项只有：

- `docs/architecture/memory-core-m2-architecture-v0.1.md`
- `experiments/m2-code-facts.md`
- `experiments/m2-design-options.md`
- 以及本轮之前就存在的若干 `experiments/**/tmp`、`clear/`、`AGENTS.md`、`CLAUDE.md`

**没有修改任何已跟踪文件。**

---

## 四、独立评估者退回后的修订（第二次）

评估者按「每项重大设计决定给出代码依据」判不成立，指出三处缺口与两处读数矛盾。逐条处理：

| # | 缺口 | 处理 |
|---|---|---|
| 1 | §5 时间与有效性整节无 `文件:行号` | 在 §5.1 前新增 `[F]` 段，给出 `world/findings.js:149-158`（八字段无有效区间）、`:156`（只有 `recordedAt`）、`:69` + `:71-76`（`refuted: []`、`resolved: []` 是终态，没有「变旧但未失效」） |
| 2 | §9.3 的 `dsh-scope/lib/index.js:189-192` 裸路径在本仓库不可解析 | 改为完整路径 `G:\work\LAB\code\_poc\poc01\node_modules\@deepseek-ai\dsh-scope\lib\index.js:189-192`，并补上 `dsh-tools/lib/index.js:2982` 的 `layers.effect` 调用点；正文写明「两条都在 PoC 安装目录、不在本仓库」 |
| 3 | §4 未交代 `m2-design-options.md:73-79` 的候选 C | §4.1 后新增一段：候选 C（复用 DSH 会话/档案存储）被排除的实测理由——会话存储只能按 `sessionId` 定位或按 projection key 折叠（`findings.js:387-393`），无跨 session 按内容检索入口；profile 目录存的是配置不是数据 |

**一处实质纠错（评估者 u1 指出，我原结论错）**：我此前写「同名工具重复注册不报错」，据此论证 Memory 的启动期冲突检查必要。**这句话在「同一 layer」语境下是错的**：`tools.register()` 把定义 `insert` 进 `layers.effect` 选中的 layer（`dsh-tools/lib/index.js:2982`），而 `ScopedLayers.effect` 在 `scopeOf(ctx) === undefined` 时统一用 `this.global`（`dsh-scope/lib/index.js:195`）；layer 的 `NamedEntries` 重名 `insert` 会抛 `tool "<name>" is already registered`（`dsh-tools/lib/index.js:2731` 的错误工厂）。`register()` 的注释也明写 "Scoped tools shadow globals; duplicates within one layer … fail"（`:2969-2970`）。只有**跨 scope**（`agent.ctx`）的同名注册才是 shadow、不报错。已按此改写文档 §8 末尾，并说明 M1 的启动期检查防的是「跨 scope 静默 shadow」与「World 忘了关开关」两种，与平台约束互补而非重复。

**行号偏差的根因（第二次退回时发现）**：上表第 2 行与上段原先引的 `:2978 / :2727 / :2966` 全部偏 4 行，正确为 `:2982 / :2731 / :2969-2970`。根因是 `pwsh` 的 `Get-Content` 在**不带 `-Encoding utf8`** 时按系统代码页读 UTF-8 文件，行号与行数一起偏。`read` 工具读同一文件给出的 `:2982`、`:2731`、`:2969-2970` 与 `grep` 一致。**以后引用 `node_modules` 或本仓库任何文件的行号，一律用 `read` / `grep` 定位，不用 `Get-Content` 数行。**

**读数矛盾的处理**：行数三处说法不一致（331 / 340 / 441 / 447）已定位根因——PowerShell 的 `Get-Content` 不带 `-Encoding utf8` 时按系统编码读 UTF-8 中文文件，既乱码又把行数算少（读到 340），而 `read` 工具报 441、加 `-Encoding utf8` 后为 447。**以后本仓库所有行数/字节计数一律带 `-Encoding utf8`**。标注计数也已改为实测：全文 `[F]20/[I]33/[H]8`，扣三行图例后正文 `19/32/8`。
