# Hikari Desktop — 数据源盘点（P0 证据）

> 目的：把「打开面板想看到的四件事」逐个查到底——数据在哪个文件、字段叫什么、拿到要付多少代价、今天到底答不答得了。
> 全部读数来自 2026-11-05 本机实测；行号用 `Select-String` / `node` 回源核对过。
> 这份文件只回答"有没有、贵不贵"，不定义产品形状（那在 `docs/architecture/hikari-desktop-p0-boundary.md`）。

## 0. 一句话结论

| 想看到的 | 今天能不能答 | 数据在哪 | 代价 |
|---|---|---|---|
| 她最近记住了什么 | **能** | `memory.jsonl`（Hikari 自己的文件） | 极低：读一个 JSONL |
| 哪些认识发生了变化 | **能，但贵** | 会话日志里的 `plugin:hikari/finding` 记录 | 高：要解 zstd 帧；本工作区 99 个会话共 90.8 MB（快照，见下方口径说明） |
| 她观察到了什么 | **半能**：仓库变化有结构化轨迹；窗口切换只有提示文本 | `experiments/hikari-project-watch/tmp/trace.jsonl`（567 行）+ 会话日志里的 `[Hikari 自主观察 …]` 文本 | 中：轨迹可直接读，窗口侧要解日志且语义弱 |
| 还有什么事情没有完成 | **不能** | 没有载体 | —— |

---

## 1. 「她最近记住了什么」

**数据来源**

- 文件：`<store 目录>/memory.jsonl`，一文件多行、每行一条记录；常量在 `hikari-native/memory/store.mjs:24`（`MEMORY_JSONL = 'memory.jsonl'`）。
- 字段（十字段，`store.mjs:31-42`）：`memoryId`、`text`、`occurredAt`、`recordedAt`、`validFrom`、`validTo`、`validHint`、`source`、`supersedes`、`seq`。
- 派生信息："最近"用 `recordedAt` 或 `seq` 都行；"被谁修订过"要自己从 `supersedes` 建反向索引（store 没有反向索引：实测 `hikari-native/memory/writing.js:278` 用的是 `store.all().find(...)`；这条未竟项记在 `docs/architecture/m2b-memory-writing-architecture-review.md:136` 的 D-2）。
- 配套文件：`memory.meta.json`（计数与损坏记录）、`memory.rejections.jsonl`（被拒写入的七字段诊断）。

**实测成本**

- 现有数据规模（两个要分清）：
  - **生产库** `C:\Users\29719\.dsh\hikari\memory`：今天只有 `memory.meta.json`（`recordCount: 0`、`lastSeq: 0`、`createdAt: 1793801004829`），**没有 `memory.jsonl`**——Hikari 在真实运行里还没有写过一条记忆。
  - **实验库** `experiments/m2c-live/store/memory.jsonl`：2 条记录 / 4,144 B，是 M2-c 真实验证时留下的（`hikari-verify` profile 的 `storeDir` 指向它，见 `experiments/m2c-live/patch.yml:8`：「记忆目录指向实验目录，绝不碰 `~/.dsh/hikari/memory` 里的真实数据」）。
  - 文件都是纯文本、一行一条，读全量成本可忽略。
- 不需要任何解析器：`JSON.parse` 逐行即可；坏行按 M2-a 的规则只计数不抛。

**今天能否回答**：能。而且这是唯一一个"Hikari 自己的文件"，不依赖任何宿主格式。

---

## 2. 「哪些认识发生了变化」

**数据来源**

- 不在任何 Hikari 自己的文件里。findings 的持久载体是 **DSH 的 Session 日志**：`hikari-native/world/findings.js:20` 定义记录类型 `plugin:hikari/finding`，`:21` 定义投影键 `hikari/world.findings`，投影靠 `sessionProjections` 从日志 lazy fold（文件头注释 `:5-8`）。
- 记录形状（实测一条原文）：

```json
{"type":"plugin:hikari/finding","seq":265,"time":1793637163105,
 "data":{"findingId":"f-001","scope":{"project":"…","sessionId":"session-hikari"},
         "claim":"…","status":"open","provenance":"model-claim","evidence":[],"recordedAt":1793637163104}}
```

- **"变化"不是字段，是同一个编号的多次追加**：实测 `session-hikari` 里 `f-001` 先在 `seq=265` 记 `status:"open"`，3 分 36.7 秒后（216,709 ms）又以同 id 记 `status:"refuted"`（`seq=311`，`provenance:"tool-evidenced"`，带 `evidence:[{kind:"tool-result",seq:305,…}]`）。注意 `findingId` 只在会话内唯一（它的 `scope.sessionId` 就是 `session-hikari`），三个 `session-hikari*` 会话各有自己的 `f-001`。所以"认识怎么变的"= 按 **（会话, findingId）** 分组、按 `seq` 排序；只按 `findingId` 分组会把不同会话的编号混成一条。
- 口径差异（P1 面板落地后补记）：本节的「63 条 finding / 3 个会话 / 41 个实体」是 2026-11-05 早些时候**只看本工作区**的快照；面板默认扫 `~/.dsh/sessions` 下**所有工作区**，同日晚实测 103 个会话有写入、15 个会话含 finding、138 条 finding 记录 → 107 个（会话, 编号）实体。两者口径不同，不是数据变了。

**实测成本（这是本盘点的关键数字）**

对本工作区会话目录 `~/.dsh/sessions/--G-work-LAB-code-projects-own-hikari-new--` 全量解码的结果：

| 指标 | 数值 | 说明 |
|---|---|---|
| 会话数 | 99 | 会随运行增长（首测 95、写文档时 98、复测 99） |
| 会话日志总字节 | 90,813,228（≈90.8 MB） | 同上（首测 88,875,514） |
| zstd 帧数 | 52,311 | 同上（首测 51,422） |
| 解出的记录数 | 85,506 | 同上（首测 84,002） |
| 其中 `plugin:hikari/finding` 记录 | **63** | 三次测量都没变，分布在同样 3 个 `session-hikari*` 会话里 |

也就是说：为了这 63 条，要解 5 万多个 zstd 帧。

> 口径说明：上表是 **2026-11-05 的快照**，量的是"当时磁盘上有什么"。这台机器上正在运行的会话（包括写这份文档的那个）会持续追加，所以**会话数、字节、帧数、记录数四项都在涨**（首测 → 复测：95→99 个会话、88,875,514→90,813,228 B、51,422→52,311 帧、84,002→85,506 条）；`finding` 63 条与含 finding 的 3 个会话截至复测没变，因为那三个是早期实验会话，之后没有新的 finding 写入。所以"成本随运行增长"本身就是一条要写进设计的约束：面板必须增量读，不能每次全量解。日志是"多帧首尾相接"的容器（`zstdDecompressSync` 只解第一帧），必须按魔数 `28 b5 2f fd` 切帧逐帧解；这一次性读取在本机约数秒级，但**每次打开面板都重算不可接受**，需要增量（记录文件大小与偏移）或缓存。

**今天能否回答**：能，但代价与耦合都实打实——它耦合 DSH 的会话日志格式（版本号 `session.v4`），换宿主就没了。

---

## 3. 「她观察到了什么」

**数据来源（分两条，形态不同）**

1. **事件本身不落盘**。`hikari-native/perception/index.js:72` 发 `hikari/perception/window`，`hikari-native/world/index.js:98` 收；project-watch 采样 git 后发 `hikari/attention/worth`（`project-watch/index.js:126`）。这些事件只在进程内存里流过。
2. **observation 的唯一痕迹是"改写后的提示文本"**。`hikari-native/activation/index.js` 把事件改写成一段中文提示（`:19` / `:37` 的 `[Hikari 自主观察 HH:MM:SS]`），再 `agent.followup(message)`（`:87`）注入给模型——这段文本会作为一条消息进入会话日志，但**没有结构化的观察记录**（没有 kind、没有窗口标题字段、没有触发原因字段可供程序读取）。
3. **仓库变化有一条结构化轨迹**：`project-watch/index.js:32-44` 的 `trace()` 在配置了 `tracePath` 时逐次 `appendFileSync`；本仓库的 patch 就配了它（`hikari-native/cordis.patch.yml:107` → `experiments/hikari-project-watch/tmp/trace.jsonl`），实测该文件 **567 行**、36,978 B，字段 `at / kind / head / dirty / changed / headFrom / headTo`（首行 `{"at":1793695337698,"kind":"baseline","head":"b4e9c56","dirty":11}`，末行 `{"at":1793842376712,"kind":"baseline","head":"19648ed","dirty":10}`）。但它只覆盖「仓库变了没有」，**不含窗口切换**。
4. 所以"观察"是**两半**：仓库变化有结构化轨迹（可读、可统计）；窗口切换只有改写成提示的文本，且提示文本本身是给模型看的，不是给人读的记录。

**实测成本**

- 若要"观察列表"，只能从会话日志里按 `[Hikari 自主观察` 前缀捞消息文本，再正则解析。同一份 88.9 MB 日志、同一套解帧成本。
- 而且这样捞出来的东西回答不了"她看到了什么"的细节（前台窗口标题、进程名在文本里，但没有统一字段），只能整段转述。

**今天能否回答**：半能，两半的成色不同——仓库变化能（`trace.jsonl` 567 行、字段齐全，可直接统计"今天仓库变过几次"）；窗口切换不能（只有提示文本，且要先解 5 万帧日志）。

**缺的是什么**：给**窗口切换**（perception）一个与 `tracePath` 对等的结构化出口；另外 `trace.jsonl` 目前落在 `experiments/…/tmp/`（实验目录），不是稳定的数据位置，面板要读它得先决定它该住在哪。

---

## 4. 「还有什么事情没有完成」

**数据来源**：没有。

- `memory.jsonl` 只记"已发生的解释"，没有状态字段，也没有截止/对象/条件（`store.mjs:31-42` 十字段里没有任何一处能表达"欠着"）。
- findings 有 `status`，四态 `open / confirmed / refuted / resolved`（`hikari-native/world/findings.js` 的 `record_finding` schema）。但 `open` 的语义是"这条认识还没被确认/推翻"，**不是"这件事还欠着"**——实测那条 `f-001` 的 `open` 在被推翻前只存在 **216,709 ms（3 分 36.7 秒）**（`seq=265` 的 `time=1793637163105` → `seq=311` 的 `time=1793637379814`）。它自己在 claim 文本里写的是"六分钟"，那是模型当时的估计而不是实测间隔；这里一律以两条记录的 `time` 之差为准。不管哪种数字，它描述的都是认识的可靠度，不是未完成的工作。
- `memory.rejections.jsonl` 记的是被拒的写入，不是待办。
- 会话日志里确实有执行记录：`tool/call` 与 `tool/result` 成对出现（复测 13,517 / 13,650 条），是 DSH agent-loop 记的。但那是**宿主**执行工具的记录，不是"Hikari 的行动"——它既没有"这是她决定要做的"这层意思，也没有"做完了没有"。
- 另有 `todo/write` 记录 333 条，分布在 6 个会话里（其中 330 条属于两个非 `session-hikari*` 会话，`session-hikari*` 三个会话里是 0 条），字段只有 `todos:[{content,status}]`，**没有 owner、没有 due、没有完成时间**。它能表达"待办长什么样"，但同样不属于 Hikari：它绑定的是 DSH 会话的待办列表，而且她自己从没写过。能不能拿它当"未完成的事"的载体，属于 `docs/architecture/hikari-desktop-p0-boundary.md` §3 Activities 行里写的那条待裁决，不是本盘点的结论。

**实测成本**：N/A（数据不存在）。

**今天能否回答**：不能。

**缺的是什么**：一个能表达"欠着的事"的概念与载体——谁欠、欠什么、什么条件下算还完。这是 `docs/architecture/hikari-end-state.md` §4 里"还欠什么没有归属"那一条的同一件事；面板是它第一个真实 consumer，但面板不能自己发明它。

---

## 5. 这份盘点对 P0 的三个约束

1. **P1 只能诚实地画"两格半"**：记忆（能）、认识变化（能但贵）、观察（半能）。"未完成"那一格第一版必须显示"我现在还不知道"，而不是画一个空列表——空列表会被读成"没有欠着的事"，那是假信息。
2. **读口必须一次定清**：记忆走文件几乎无争议；认识变化与观察都要碰会话日志，所以"面板怎么拿到 DSH 里的东西"是 P0 的真问题（三方案见 P0 文档）。
3. **观察与未完成这两格，第一版不做样子**：它们的完成依赖"给观察一个持久化出口"与"给未决一个概念"，都不在面板这一片里。
