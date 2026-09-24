# Durable Fact Admission v0

> **工作标签，不占用任何阶段编号。** 它不是 P4-04，也不是 P4-03 的一部分。它是 Repository CI Relevance v1
> 与 Judgement Reachability v0 之后的一次独立 slice，处理的是一个此前没有出现过的问题：**当一个 Plugin
> 确实拥有一件自己的语义转变时，它可不可以把这件事写进 Chronicle。**

本轮的立项依据是 `DURABLE FACT ADMISSION v0 — BOUNDARY REVIEW`（只设计、不实现），Human ruling：

```text
VERDICT = NARROW → READY / AUTHORIZED FOR IMPLEMENTATION
```

NARROW 的含义是本轮**只**批准 `work-focus` 这一个 owner 承认它自己的那一条事实——**不是**借此机会让
Plugin 普遍获得写 Chronicle 的权利，**不是**引入 Memory，也**不是**给 Runtime 增加任何机制。

---

## 0. 本轮回答的问题

Chronicle 从 P2-02 起就存在，契约完整（`append` / `get` / `read`），但到今天为止**没有任何生产 Plugin
承认过一条自己的事实**。此前所有写入都发生在测试与验收里。于是问题第一次变得具体：

> **一次 `declare` 让工作焦点集合真的变了。这件事，谁有资格记下来，记成什么，记不下来的时候又该怎么办。**

三个子问题各自有独立答案，而且都不是「加一个写入者」这么简单：

1. **谁写**——语义 owner 自己写，还是由别人代写（recorder / Event 订阅者 / Resident / Runtime）。
2. **什么算一次事实**——命令到达算，还是语义转变才算。
3. **写不成怎么办**——回滚、重试、抛出，还是承认这次没有取得持久化确认。

---

## 1. 解除旧轮次冻结：记录当时的理由，与现在的理由

本轮**解除**了 `docs/architecture/phase-4-explicit-work-focus-review.md` 里两处冻结。解除的是**这两个
具体条目**，不是那份文档，也不是它的其余结论。

| 位置 | 冻结内容 |
| --- | --- |
| §5 #16 | `不写 Chronicle。` |
| §8 反例表 | 「把 designation 写进 Chronicle」被列为**错误做法** |
| §9 严禁创建 | `Chronicle integration` 与 `persistence` 在禁止清单内 |

**当时为什么冻结，以及那个理由今天是否仍然成立。** §8 给出的理由逐字是：

> Event ≠ Durable Fact；「声明过焦点」与「决定长期记住」是两件事。

这条理由**没有被推翻**，它今天仍然成立。被它否定的做法是：**把 designation 当成一条命令流水写进去**——
命令到达即承认，不区分这次命令有没有改变任何东西，于是 Chronicle 里出现一条「有人敲了 declare」的记录，
而「声明过焦点」与「值得长期记住的事」之间的那道分野被抹平。

**变化的不是这条理由，是它现在有了一个它能接受的答案。** 当年缺的两样东西现在都在：

```text
当年缺的第一样：真实的 occurrence。
  Work Focus Local Ingress v1 之前没有入口，因此没有「一次声明真的发生过」这回事，
  没有东西可以指向它说「这件事发生了」。

当年缺的第二样：一条被批准的 durable admission 规则。
  「谁可以承认」与「可以承认什么命题」此前没有被裁决过；没有裁决，
  写进去的每一条都只是在替 Hikari 决定什么值得长期记住——而那正是 §8 拒绝的事。
```

两条同时到位之后，冻结对**这一个 owner** 解除。三条边界随之冻结（§12）：只有 Work Focus；只有它自己
concern 的事实；只有它**有权断言**的命题。**不要把它读成「所有 Plugin 都应该写 Chronicle」。**

这与 Repository CI Relevance v1 里 `work-focus.current@1` 的翻转是同一种处理——**重新裁决，而不是删除
历史**。旧守卫没有被删掉，它被**替换**，而且替换它的测试带着一段注释记录原来那条守卫在防什么、为什么
它现在防的东西不再是风险（`test/work-focus.test.mjs`，两条守卫各自的抬头注释）。

---

## 2. 什么算「真实变化」

Chronicle 记录的是 Work Focus 的**语义状态转变**，不是端点上的命令审计。`state.ts:18-22` 早已冻结
「Order is not part of this contract」，因此下面四种**都是语义无操作，一条事实都不产生**：

```text
declare 一个已经声明过的 designation        → 集合没动
clear 一个本来就是空的集合                   → 集合没动
replace 成相同成员的集合                     → 集合没动
replace 只差顺序：["A","B"] → ["B","A"]      → 集合没动
```

第四种是最容易写错的一种，也是唯一一种**表示变了而语义没变**的情形：`replace` 无条件构造一个新的冻结
数组，所以「和上一次是同一个对象」在这里**永远为假**。因此判定不能是对象同一性。

**判定被实现为一个最窄的、符合本领域现有语义的等价检查**（`src/work-focus/state.ts` 的
`sameMembership`），而不是一个通用 equality framework：

```ts
export function sameMembership(before: WorkFocusState, after: WorkFocusState): boolean {
  const left = before.designations;
  const right = after.designations;
  return left.length === right.length && left.every((designation) => right.includes(designation));
}
```

它是精确而非近似的，理由是**结构性的而不是巧合**：`designations` 永远不含重复——`declare` 在追加前
检查 `includes`，`replace` 在构造集合前收敛重复——所以先比长度再比包含关系就是集合相等，两边都不需要
排序。它也不看对象同一性，因此一次「重建了一个等值数组」的 `replace` 是相等的，`status` 原样退回的那个
对象同样是相等的。

**没有创建的**：generic equality framework、deep-equal、排序归一化、内容哈希、idempotency key。

---

## 3. 事实家族

三个类型，版本 1，全部复用 Chronicle 既有的 `FactDraft`：

```text
work-focus.declared   payload: { designation: string }
work-focus.replaced   payload: { designations: string[] }
work-focus.cleared    payload: {}
```

- `occurredAt` 由 Work Focus 在**发生时刻**读一次（`new Date().toISOString()`，ISO-8601 毫秒 UTC），
  不是读回时刻，也不是写入时刻；
- `source` **只声称可证明的部分**：`{ kind: 'work-focus.endpoint' }`。`{ kind: 'human' }` **被禁止**
  ——入口没有任何身份认证，这条管道上任何本机进程都能声明一个工作焦点，写成 `human` 是在断言一个
  这里没有任何东西建立过的身份。写得更窄但为真，好过写得更宽但不真；
- `declare` 的载荷取自**请求本身**（`request.designation`，逐字是 `state.ts` 接受的那一个），不是从
  结果集合里回溯出来的；
- `replaced` 的载荷是这次转换**留下的集合**的拷贝（`[...next.designations]`，不是共享引用）。

**没有加入的字段**：importance / salience / confidence / relation / memory 相关字段 / 通用认识论 schema
/ owner / 任何判词。Chronicle 只保存**发生过什么**，它不解释**这意味着什么**。

---

## 4. 事实发生与持久化确认分离

这是本 slice 最重要的失败语义，也是 `src/work-focus/session.ts` 抬头注释写下的那一半。

**Work Focus 的 action 成功不以 Chronicle append 成功为条件。** 理由不是「append 不重要」，而是
`ChroniclePersistenceError` 的含义：它只说**这一次写入没有取得可靠的持久化确认**，
**不表示什么都没写进去**（`src/chronicle/` 的既有语义，本轮未改）。于是：

```text
append 失败 → 回滚 Work Focus state   ✗  回滚会在一次可能已经落盘的写入上，发明一个从未存在过的状态
append 失败 → 重试                    ✗  重试会让一条事实变成两条，而这里没有任何东西分得清是哪种
append 失败 → 抛出 / 让常驻崩溃        ✗  一个进程因为自己的历史不可用而死，代价远大于一次未确认的承认
append 失败 → fire-and-forget 静默吞掉 ✗  调用方将无法区分「记下了」与「没记下」
```

**正确顺序：**

```text
请求 → 计算转变 → 语义变化为真？ → state 成功改变 → 尝试 Chronicle append
                                              ├─ (A) 得到确认 → action 照常成功
                                              └─ (B) 未取得持久化确认 → action 仍然成功，
                                                     不回滚、不重试、不抛出，
                                                     reply 明确表示这次承认没有取得确认
```

可见形状是一个**确定性的额外行**，不新增 outcome：

```text
（这次变化已生效，但没有取得 Chronicle 的可靠持久化确认，可能没有被记下来。）
```

outcome 仍然是 `ok`——因为请求确实成功了——**信封没有被加宽**。新增一个 outcome 会得到一个只有一个
成员的类型，而调用方需要处理的 reply 形状应当保持它已经在处理的形状。**没有新增全局 outcome taxonomy。**

调用方因此能够观察到完整的那件事：**state mutation 成功了，而 durable admission 未确认。**

---

## 5. 同步 host / endpoint 的最小异步化

`WorkFocusHost.handle` 从同步改为 `handle(request): Promise<WorkFocusReply>`，并且：

- **Runtime 零改动**（§6）；
- **没有错误被抛进 socket 的 `data` 处理器**：`serve` 只做框定与解码，走 `void answer(...)` 交接，
  而 `answer` 自身不可能 reject。它由一个 try/catch 包住——**那个 catch 是给 host 某天违反「从不 reject」
  这个承诺用的**，代价是结束一条连接而不是一个进程，并且**不会**变成一条 reply（那会是在 host 的嗓子里
  替它编造一个失败；这个文件拥有框定，不拥有语义）；
- **Chronicle 失败不会杀死常驻**：失败在 session 内部被折叠成一条降级 reply（§4），到不了 socket 层；
- **客户端仍然拿到确定性应答**：三条路径各自有确定的输出——正常 reply、降级 reply、协议拒绝。

**超时预算被显式核对，没有改动。** `IDLE_CONNECTION_MS = 5000`（端点）与 `REPLY_TIMEOUT_MS = 5000`
（客户端）在这一轮之前就存在，现在它们第一次成为一次应答的**最外层上界**。核对依据是实测的
`append` 代价：空 store 约 3–5 ms；25 000 条事实时，5 次采样中位数为 **73.2 ms**、最大为 **79.8 ms**。
另有一次约 **322 ms** 的历史观测，其来源条件**未能复现**（现存探针的测点里没有 25 000 这一点），
可能与当时机器高负载有关，但目前**没有证据确认**，因此**不把它作为典型值**——仅作为保守的尾部风险
信号保留在此。即使按 322 ms 的保守值计算，5 000 ms 预算仍约为单次写入的 **15 倍**；按本次复测中位数
计算约为 **68 倍**。因此现有证据**均不支持**调整超时，也**不支持**引入 queue / worker / retry subsystem。

**超时越界的代价被写成注释而不是被调参掩盖**：连接断开、人拿不到答案；**永远不是拿到一个错的答案**——
因为写入开始时状态改变**已经发生**，下面没有任何东西能把它拿回去。

---

## 6. 直接写入者，与 Runtime 零改动

Work Focus Plugin **自己**要求 `chronicleService` 并**自己** append 自己的事实：

```ts
requires: [chronicleService],   // src/work-focus/plugin.ts
```

**没有创建的**：为 Work Focus 存在的 Event；recorder Plugin；由 Resident 代写；由 Runtime 代写；由
Language 代写。**Runtime：零改动**——`git diff --stat -- src/runtime/` 输出为空，**一个字节未改**。

`requires` 是非空的，这带来一个真实后果并且它是对的：在没有 Chronicle 的组合里，Work Focus **不会**
照常运行然后写进虚空，而是停在 `waiting`。**这个性质同时使一条 CI 可见的断言成为可能**——一个
`requires` 未满足的插件永远到不了 `setup`，因此平台问题（命名管道）在那条路径上根本不会被问到，
Linux 上不需要任何门控就能断言它。

**生产组合不受影响，理由是顺序而不是运气：** `src/cli/resident.ts` 的 `productionComposition` 里
Chronicle 是**第二个**成员，work-focus 是**最后一个**，依赖在加载时就已满足。该文件里那句
「It requires nothing」随本轮改成事实（注释改动，无行为改动）。

---

## 7. Chronicle 与状态仍然分离

**只有语义转变进持久历史；没有建立 Chronicle → Work Focus 的状态恢复。** 重启之后：

```text
Work Focus state 仍然从空开始          ← 结构性事实：state 在 activation 闭包里，不从任何地方读回
Chronicle read() 仍然读得到上一轮事实   ← 事实史是事实史
```

**这两者同时成立是本轮的正确行为**，不是一处待修的缺口。有一张测试同时钉住两半（§8 的 K）：
新 Runtime 里 `status` 回的是 `[HEADER, NONE]`，而一个**独立打开的** reader 读得到上一轮生命周期写下的
两条 `work-focus.declared`。

---

## 8. 测试事实

### 8.1 ruling 九 A–P 的承载

| 条目 | 承载 |
| --- | --- |
| A 真实 declare → 恰好一条 `work-focus.declared` | `三次真实写入写进 Chronicle 的正好是三条事实…`（真实管道）／`每个真实转换恰好一条事实…`（无管道） |
| B 重复 declare → 0 条新事实 | `语义无操作连 append 都不调用…` |
| C 真实 replace → 恰好一条 `work-focus.replaced` | 同上两条 |
| D 同集合 replace → 0 | `语义无操作连 append 都不调用…` |
| E 仅顺序不同的 replace → 0 | 同上（**这一条要求判定不是对象同一性**） |
| F 真实 clear → 恰好一条 `work-focus.cleared` | 同 A |
| G 清空空集 → 0 | `语义无操作连 append 都不调用…` |
| H 载荷来自转换本身，不是事后 `current()` | `每个真实转换恰好一条事实…`（清空后读回，`replaced` 仍带两个 designation） |
| I `occurredAt` 落在真实请求窗口内 | `事实的形状是 owner 自己声明的那一种…` |
| J `source.kind === 'work-focus.endpoint'`，改 `'human'` 会变红 | 同上 + §8.2 表格中 `WORK_FOCUS_SOURCE_KIND → 'human'` 一行 |
| K 新生命周期：状态为空 + 上一轮事实仍可读 | `新的 Plugin 实例从空开始，而上一轮生命周期的事实仍然读得到` |
| L append 成功 → 正常 ok | `持久化未确认…` 的最后一段（恢复后照常承认） |
| M 未确认 → 状态已变、不回滚、不重试、不崩、降级可见 | `持久化未确认：状态照常改变、不回滚、不重试、不抛出，而降级对调用方可见` |
| N 无操作不调用 `chronicle.append` | `语义无操作连 append 都不调用…`（计的是 `attempts` 而不是 `drafts.length`：抛出的 append 不留下 draft，「有没有试过」与「成没成」是两个问题） |
| O `requires` 逐字包含 `chronicleService` | `工作焦点要求 chronicle，而且没有它时停在 waiting` |
| P `src/runtime/**` 零 diff | 本文件 §6 的命令输出 |

**一条没被 A–P 点到、但本轮同样冻结的性质**：`status` 不承认任何事实。它由
`这个家族里没有"问一句"这条事实：status 什么都不承认` 直接问 `workFocusFactDraft`——**§8.2 的补测段
（「删掉 status 排除 → RED」）证明它曾经没有任何断言承载**。

### 8.2 断言自身的变异验证

一条测试是否真的约束行为，从外面看不出来。本轮对 15 处关键断言各做一次定向变异——改掉生产代码里
**正是这条断言声称在管**的那一处，重建，跑目标测试：

| 变异 | 目标 | 结果 |
| --- | --- | --- |
| `WORK_FOCUS_SOURCE_KIND` → `'human'` | J | **RED** |
| 去掉语义变化判定（每个非 status 请求都写） | D/E/G/N | **RED** |
| 用 `before === state` 代替 `sameMembership` | E | **RED** |
| append 失败 → 回滚 state | M | **RED** |
| append 失败 → 重试一次 | M | **RED** |
| append 失败 → 向上抛 | M | **RED** |
| `requires` 退回 `[]` | O | **RED** |
| 降级 reply 去掉 `UNCONFIRMED` 行 | L/M | **RED** |
| 只承认 `declare`，丢掉 `replaced` / `cleared` | A/C/F | **RED** |
| fact `version` → `2` | 事实形状 | **RED** |
| type 写成 `work-focus.declare` | A/C/F | **RED** |
| 载荷取自**转换前**的状态 | H | **RED** |
| 删掉 `facts.ts` 里的 `status` 排除 | — | **GREEN（存活）** |
| `occurredAt` 写死成过去的时间 | I | **RED** |
| 新 activation 从非空状态开始 | K | **RED** |

**14/15 变红，第 13 条存活。** 它存活的原因是一个真实的结构事实，不是测试写得不好：`status` **永远**
不移动集合，而 session 的变化判定在那之前就已经拒绝为「什么都没动的请求」构造 draft，所以那条子句
**经 session 不可观测**。

处理方式**不是删除它**——它是这个家族在说「我的词汇表里没有『问一句』这一类事实」，那是关于 owner 词汇
的主张，不是关于某一条请求路径的主张，而 `workFocusFactDraft` 的下一个调用方不会是 session。处理方式是
**在它真正住着的边界上直接断言它**，并同时断言另外三个 type 确实会产出（否则「一律返回 undefined」也
能过）。补测后重跑同一变异：

```text
删掉 status 排除        → RED
把 status 判定反过来     → 编译期拒绝（TS2367 / TS2339），根本跑不到测试
```

**变异验证本身也过一次核对**，因为第一版判据是错的：最初用「输出里有没有出现这条测试的名字」判断
「是不是这条测试抓住的」，而 TAP 对**通过**的测试同样打印 `ok N - name`——那个判据对套件里任何一条都
成立。改成只取 `✖` 行、并确认**目标断言在变红名单里**之后，上表才是可用的。

### 8.3 本机测试与 CI 测试分别证明什么

```text
本机（Windows，真实命名管道）额外证明：
  真实的 declare / replace / clear 经 CLI → 常驻 → 端点 → session → Chronicle 落盘这一整条链路，
  产物是磁盘上三条类型、顺序、载荷都对得上的事实，且数据目录里没有多出第二个存储文件。
  承载：`真实进程：declare / status / replace / clear 通过 CLI 走完整条链路`（常驻退出后读回 store）
  与 `三次真实写入写进 Chronicle 的正好是三条事实`（in-process Runtime + 独立 reader 读盘）。
  前者是唯一一条把**两个真实进程**与**落盘**接起来的测试——在此之前这两半分属两张测试，
  没有任何一条单独证明过整条链。

CI（ubuntu-latest，没有命名管道）证明：
  承认规则本身——requires 结构与 waiting、四类语义无操作一次 append 都不调用、每个真实转换恰好
  一条、事实的 owner 自述形状与 source 声明、持久化未确认时的全部失败语义。
  这一段没有任何 skip 门控，它驱动的是 createWorkFocusSession 本身——plugin.ts 调用的同一个函数，
  不是第二份实现。
  **但它驱动的不是那个实例**：CI 可见的测试自己构造 session，plugin.ts 那个只能经命名管道到达，
  因此接线段（尤其 services.get(chronicleService)）在 Linux 上没有任何测试覆盖，由本机管道测试承担。
```

后者是本轮补的一组**不依赖 Windows 命名管道**的结构/行为测试。之所以需要它：**写进 `setup` 闭包的
版本只能经管道到达，而 CI 会跳过它**——一条只在唯一一台有管道命名空间的机器上跑的规则，是没有任何
东西在合并它的机器上检查的规则（同 `judgement-reachability-v0.md` §7.3 记录的同一类缺口）。

**本机计数**：全量 575 tests / 571 pass / 4 skipped / 0 fail；`test/work-focus.test.mjs` 40 tests /
40 pass / 0 skipped / 0 fail。

---

## 9. 一处观测到、但未复现的失败（诚实记录）

全量套件第一次重跑时，`test/language-model.test.mjs:554`
（`同一个批里出现重复的 tool_call id 是失败`）在 `assert.ok(error instanceof Error)` **通过**的前提下，
第二句断言 `应说明是 id 重复，而不是别的形状问题` **失败**。

随后 14 次运行该失败**没有复现**：9 次全量套件（575 / 571 / 4 / 0）与 5 次该文件单跑全部通过，
另做 5 份并发单跑（每个 20 tests / 20 pass）也全部通过。

**它没有被归因为本轮改动**，依据是结构而不是概率：该文件只 import `../dist/language/model.js`
（HTTP transport），本轮没有改 `src/language/**` 的任何一个字节；它走的是 `startServer` 起的
throwaway loopback HTTP server，不加载任何 Plugin，也不经过 work-focus 的端点或 session。

**机制没有被确定。** 观测到的信号（第一个断言成立、第二个不成立）与「请求根本没到达那个畸形应答、
拿到的是另一类传输错误」一致，但这是推断不是证据，且并发加压也没有把它逼出来。**它被记录为一次
未复现的观测，不是 PASS，也不是已修的缺陷。**

---

## 10. 明确不做（本轮冻结）

- 不批准除 `work-focus` 之外的任何 Plugin 写 Chronicle；**不**把它读成「所有 Plugin 都应该写 Chronicle」。
- 不创建 Work Focus Event、recorder Plugin、Retired Plugin、通用 recorder、retry queue。
- 不让 Runtime 写事实、不让 Resident 写事实、不让 Language 写事实。
- 不建立 Chronicle → state 的恢复；不做 state restoration。
- 不做 Memory / recall / association / reactivation / revision / confidence / salience / 语义搜索 /
  embedding / vector DB / 通用保留策略。
- 不给判定加 importance / salience / confidence / relation / 通用认识论 schema。
- 不加 generic equality framework、deep-equal、idempotency key、内容哈希、dedup。
- 不新增全局 outcome taxonomy；**不修改 Runtime**。

---

## 11. 交付

生产改动按 concern 分：语义变化判定 + 事实家族 + session（承认规则本体）／插件接线与端点异步化／
旧冻结守卫的替换与 CI 可见测试。设计记录与服务状态为最后一个 commit。

提交前核对的是**真实 git 状态**，不是本文档或任何会话快照里的记录。

---

## 12. 两道评审

### 12.1 Functional Review

- `npm run build` 干净；`npm test` → **575 tests / 571 pass / 0 fail / 4 skipped**。
- 15 条定向变异 14 条 RED，存活的那一条已按 §8.2 补齐断言并复测。
- A–P 十六条逐条找到承载测试，没有一条是空心的（§8.1）。
- 失败语义（M）由一张测试同时钉住五件事：状态已变、不回滚、不重试、不抛出、降级对调用方可见。

**结论：Functional Review — PASS。**

### 12.2 Architecture Review

- **concern 在正确的 owner。** 承认自己事实的是持有该状态的 plugin（`session.ts`），不是 recorder、
  不是 Runtime、不是 Resident、不是 Language。命题是 owner 有权断言的那一条，`source` 只声称可证明的部分。
- **Runtime 没有开始理解业务，也没有被改动。** `git diff --stat -- src/runtime/` 为空。
- **没有投机抽象。** 没有 generic equality framework、没有 outcome taxonomy、没有 retry/queue/worker、
  没有 Event、没有 recorder；state-equivalence 是 `sameMembership` 一个函数，理由写在它的抬头注释里。
- **没有越过冻结边界。** §10 逐条扫描无命中；Memory 未进入、未被预埋。
- **没有偷偷实现「明确不做」的内容。**
- **判词与持久历史分离。** Chronicle 里只有转变，没有解释；状态不从历史恢复，两者同时成立是正确行为。

**结论：Architecture Review — PASS。**

真实模型端点的语义验证与本轮无关（本轮不调用模型）；本机无外站模型访问这一条限制**不构成本轮的任何
结论**，因为它不在本轮的证明目标里。
