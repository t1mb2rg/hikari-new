# M2 代码事实表

核对基线：`main` @ `ce12a15`（2026-11-04），工作区无未提交的已跟踪改动。
所有行号对 `hikari-native/world/findings.js`（664 行）与 `hikari-native/memory/*`。

标注约定：**[事实]** 指的是从代码里读出来的，可直接核对；**[缺口]** 指的是现有结构表达不了的东西。

---

## 一、记录结构

**[事实] Finding 记录恰好八个字段**（`findings.js:149-158`）：

```js
{ findingId, scope: { project, sessionId }, claim, status, provenance,
  evidence: [...], recordedAt, seq }
```

| 字段 | 来源 | 说明 |
|---|---|---|
| `findingId` | 调用方或 `nextFindingId()`（`:326-333`，`f-001` 递增） | 正则 `^f-[a-z0-9][a-z0-9._-]{0,63}$`（`:68`） |
| `scope.project` | 启动时 `git rev-parse --show-toplevel`（`:316-324`） | **模型不能决定** |
| `scope.sessionId` | 安装参数 | 写入时所在 session |
| `claim` | 模型填，`normalizeClaim` 压空白、截 300 字（`:82-84`） | |
| `status` | `open` / `confirmed` / `refuted` / `resolved`（`:69`） | |
| `provenance` | `model-claim` / `tool-evidenced`（`:70`） | 「证据存在」不等于「结论正确」（`:13`） |
| `evidence` | 见第三节 | |
| `recordedAt` | `data.recordedAt ?? event.time`（`:156`） | **只有这一个时间** |
| `seq` | 写入事件在 session 里的序号（`:157`） | |

**[缺口] 没有「事件发生时间」**。`recordedAt` 的语义是「这条记忆是被写下来的时刻」，不是「这件事发生在什么时候」。代码里没有任何字段承载后者，也没有任何地方把两者区分开。一条记忆写「昨天 CI 挂了」，`recordedAt` 只会是今天。

**[事实] 没有第二个时间字段可退而求其次**。`event.time` 与 `recordedAt` 在同一个表达式里（`:156`），默认值就是写入时刻，不是可选替代。

---

## 二、状态机

**[事实] 四条迁移，两个终态**（`:71-76`）：

```
open      → confirmed | refuted
confirmed → resolved  | refuted
refuted   → （无出边）
resolved  → （无出边）
```

**[事实] 迁移不检查时间**。`TRANSITIONS` 是纯结构表，`recordOne`（`:422` 起）只按 `status` 字符串查表，没有任何「距上次多久」「是否超期」的判断。

**[事实] 状态是当前认识的快照，不是区间**。读一条记忆只能知道「现在是什么状态」，代码里没有 `validFrom` / `validTo` / `supersededBy` 这类字段。

**[事实] 终态确实不可再变**（`:74-75` 空数组）。这条在 f-006 那次真实事件里暴露过：她发现「一条已被 confirmed 的判断没法被修正，只能被关掉」。`refuted` 与 `resolved` 都没有出边，要表达「后来又有新证据推翻了它」只能新开一条 finding。

**[缺口] 没有「过期」这个状态**。一条 `confirmed` 的记忆一年后仍然是 `confirmed`——状态机里没有由时间触发的迁移，也没有「这条大概多久会失效」的字段。

---

## 三、证据结构

**[事实] 两种证据，都指向 session 内事件**（`:101-109`）：

- `{ kind: 'tool-result', seq, callId }`——`seq` 必须指向一个真的 `tool/result` 事件，且 `toolCallId` 逐字相同（`:101-106`）
- `{ kind: 'file', seq, path }`——`seq` 指向任意真实事件，`path` 是文件路径（`:107-109`）

**[事实] 校验靠 `session.eventAt(seq)`**（`:99`）。这是**当前加载的那个 session 对象**上的方法。

**[缺口] `evidence.seq` 跨 session 不可解析**。`scope.sessionId` 记下了来源 session，但 `validateEvidence` 与 `readFinding` 都只在当前 session 上查 `seq`。换一个 session 读旧记忆，`seq` 变成一个无法定位裸数字——`readFinding` 的注释自己承认了这点（`:284-285`：「`seq` 是写入时的 Session 事件位置，跨重启不保证仍可解析」）。

**[事实] `tool-evidenced` 的引用由插件补全**（`:123-134`），模型看不到 seq。`latestToolResult` 从 `session.seq - 1` 往前找最近一次**成功**的 `tool/result`；找不到就拒绝写入（`:435-445`，fail-closed）。

**[缺口] 没有「后来被修正」的指针**。一条 `refuted` 的记忆与当初 `confirmed` 它的那条记忆之间没有任何链接——只能是两条独立记录，靠人读出来它们的关系。

---

## 四、检索与注入

**[事实] 检索是词元重叠，不是语义相似**（`:205-217`）：英文按 `[a-z0-9][a-z0-9_.:/#-]*` 取词（≥2 字符），中文按**二字滑窗**切分。

**[事实] 相关性阈值**（`:237`）：查询切出 ≥2 个词元时，至少要命中 2 个才算候选——否则中文二字滑窗会把无关记录全捞上来。

**[事实] 排序**（`:246`）：命中数降序，同分按 `recordedAt` 降序。

**[缺口] 检索没有状态过滤、没有时间过滤**。`searchFindings` 不接收 `status` 或时间范围参数（`:233` 的签名只有 `query / limit / offset`）。想找「上个月还是 open、现在也许已经过时的」，只能靠查询词碰运气。

**[事实] 结果只给摘要不给正文**（`:262-271`）：`id / line（≤120 字）/ at（YYYY-MM-DD）/ status / chars`。整条返回受 **800 字符硬预算**约束（`:51`），超了从尾部减条数（`:274-277`）。

**[事实] `read_memory` 一次只读一条**（`:281`，`:287`），返回里同时给机器状态与人类口径 `statusReading`（`:61-66`），并把 `evidence` 原样带出。

**[事实] 注入预算 3 条 / 1200 字符**（`:44-45`），每请求求值一次（`:396-400`），`order: 150`。

---

## 五、持久化与恢复

**[事实] 唯一持久载体是 Session 日志**（`:379-385`）：

```js
ctx.sessionProjections.register({
  key: FINDINGS_PROJECTION_KEY,      // 'hikari/world.findings'
  stateVersion: FINDINGS_STATE_VERSION, // 1
  stateSchema: { type: 'object' },
  init: () => ({ findings: {} }),
  apply: applyFindingRecord,
})
```

**[事实] `apply` 是覆盖式 fold**（`:159`）：`{ ...state.findings, [record.findingId]: record }`——同一个 `findingId` 的后一次写入**覆盖**前一次。

**[事实] 恢复靠重放**：文件头注释写明「`sessionProjections` 从 Session 日志派生当前认识（lazy fold，重启可恢复）」（`:6`）。

**[缺口] 修正历史只在日志里，不在投影里**。一条 finding 从 `open` 走到 `refuted`，投影里只剩最后那个 `refuted`。中间那次 `confirmed` 仍然在 session 日志的 `plugin:hikari/finding` 事件里，但**没有任何接口能读到它**——投影只保留末态。

**[事实] 写入串行化**（`:137-141`、`:413-420`）：`recordQueue` 串起 `recordOne`，保证 `findingId` 分配不会在并发调用里撞车。

**[事实] 非 git 仓库是 fail-closed，但仍暴露 Service**（`:403-411`）：不注册 `record_finding`，但 `provideWorldFindings(ctx, currentFindings, undefined)` 照样执行，`describe().available === false`。注释写明了原因（`:406-408`）：若这里不 provide，Memory 会停在 `PENDING`，模型连 `search_memory` / `read_memory` 都看不到。

---

## 六、所有权与依赖方向

**[事实] Findings 数据归 World**：注册投影、注册 `record_finding`、提供 Service 全在 `world/findings.js`。

**[事实] Memory 不持有数据**：`memory/index.js` 的 `inject = ['tools', 'hikariWorldFindings']`，`apply` 里 `ctx.get('hikariWorldFindings')`，再把 `service` 传给 `installMemoryTools`（`memory/tools.js:11`）。

**[事实] 依赖单向**：`memory → world`，`world` 不知道 `memory` 存在（`world/findings.js` 全文没有 `hikari-memory` 字样）。

**[事实] Service 是冻结的只读对象**（`:32-42`）：`Object.freeze({ search, read, describe })`，`search`/`read` 返回快照，消费者拿不到内部结构。

---

## 七、现有结构表达不了的六件事

| # | 缺口 | 对应字段/位置 | 后果 |
|---|---|---|---|
| 1 | 只有记录时间，没有事件发生时间 | `recordedAt`（`:156`） | 无法区分「这件事发生在昨天」与「我今天才想起来记」 |
| 2 | 没有有效区间 | 无 `validFrom`/`validTo` | 只能表达「现在是什么状态」，不能表达「在什么时间段成立」 |
| 3 | 状态覆盖无历史 | `:159` | 修正链只能靠人从日志里读，接口层看不到 |
| 4 | `evidence.seq` 跨 session 不可解析 | `:99`、`:284` | 旧记忆的来源指向一个无法定位的裸数字 |
| 5 | 没有记忆间关联 | 记录只有八个字段 | 「这条是从那条推出来的」「这两条互相矛盾」都没有位置放 |
| 6 | 没有「多久可能失效」的表达 | 无对应字段 | 模型写记忆时给它的一切时间判断都被丢弃，只剩一个记录时刻 |

**另有一条不属于缺口的观察**：检索不按状态/时间过滤（第四节），这不是「缺字段」，是「检索接口太窄」。它与第 1、2 条一起，决定了模型即使想问「上个月那些还没被推翻的」也问不出来。

---

## 待核对项

以下三条尚未在代码里确认，留到设计阶段判断是否需要：

1. `sessionProjections.stateOf` 在 session 未被加载时返回什么——`currentFindings()`（`:388-393`）对 `undefined` 有兜底，但没验证过「session 从未加载」与「已加载但无记录」是否都走同一个分支。
2. 投影 `stateVersion: 1` 的升级路径：改了记录结构之后，旧投影是否会被丢弃重算，还是会读到 `stateVersion` 不匹配的旧状态。
3. `plugin:hikari/finding` 事件 `ignorable: true`（`:142` 检查）意味着什么——是否影响其它 projection 的 fold。
