# M2 外部调研：记忆分层、时间与来源

> 调研对象：Letta（原 MemGPT）、Hindsight、OpenViking、Zep / Graphiti。
> 目的：只提取设计取舍，不给 Hikari 写方案。检索时间 2026-11-04，全部为一手文档或论文。
> 名字歧义说明：Hindsight 与 OpenViking 都不是唯一命名。本文所用分别是 `vectorize-io/hindsight`（agent memory，对应 arXiv 2512.12818）与 `volcengine/OpenViking`（docs.openviking.ai）。未逐一排查其他同名项目。

---

## 1. Letta（原 MemGPT）

### (a) 分层：先按"在不在上下文里"分，再按用途分

- 现行文档的主线是 **MemFS**：一个 git 版本化的记忆文件系统，agent 用普通文件工具读写，记忆属于 agent state；下面那套四层与 memory block 收在 V1 SDK（legacy）里。[来源](https://docs.letta.com/concepts/memfs) [来源](https://docs.letta.com/llms.txt)
- 路径即常驻性：根目录下的 markdown 每轮进 system prompt；带自己 `MEMORY.md` 索引的子目录默认不进上下文。原文把这条讲得很直白——选 label 就是选它住在哪、是否常驻上下文。[来源](https://docs.letta.com/concepts/memfs)
- 旧版（v1）把这条轴写成显式四层，并给了容量建议：Memory Blocks（可编辑、在上下文内，建议 <50k 字符 / <20 个）、Files（只读、按需 open/close，5MB / <100 个）、Archival Memory（读写、不在上下文、单条 300 tokens、数量无限）、External RAG。[来源](https://docs.letta.com/v1-sdk/memory/context-hierarchy.md)
- 选层依据是原文一句话：「取决于数据规模与它对 agent 有多重要」。用户名字这种"永远要记住"的放 block，"今天聊了爱吃什么"这种不必总 recall 的放 archival。[来源](https://docs.letta.com/v1-sdk/memory/context-hierarchy.md)
- 旧版 core memory 的载体是 memory block，字段只有 `label` / `description` / `value` / `limit`（另有 `read_only`），以类 XML 形式 prepend 到 prompt，模型看到的是 `chars_current` / `chars_limit`。[来源](https://docs.letta.com/v1-sdk/memory/memory-blocks.md)
- MemGPT 论文里的分层是两分：main context（system instructions、working context、FIFO queue）vs external context（archival 与 recall 两个存储）。**recall memory 即 recall storage（消息数据库）**：新消息和模型输出都写入，被逐出队列的消息"stored indefinitely in recall storage and readable via function calls"。[来源](https://arxiv.org/html/2310.08560v2)

### (b) 时间：只有"版本时间"，没有"成立时间"

- v1 block 没有 `created_at` / `updated_at` / `version` 字段；设 `value` 是整体替换，不是追加。[来源](https://docs.letta.com/v1-sdk/memory/memory-blocks.md)
- MemFS 的时间来自 git：每次编辑一次 commit，因此有历史、有冲突解决、有"已保存/未提交"的边界。[来源](https://docs.letta.com/concepts/memfs)
- 也就是说，Letta 能回答"这条记忆何时被写成现在这样"，不能回答"它从何时起为真、到何时不再为真"。后者没有任何字段承载。

### (c) 来源与修正

- 修正靠覆盖：并发修改时"last write wins and overwrites all earlier changes"，官方因此建议用 read-only 或只在可控场景直接改。[来源](https://docs.letta.com/v1-sdk/memory/memory-blocks.md)
- MemFS 把每次编辑记成 commit，修正因此可回退；dreaming、memory doctor 这类子代理用 git worktree 并发改记忆。[来源](https://docs.letta.com/concepts/memfs)
- 出处很弱：block 没有来源字段；archival memory 是 **agent-immutable**（agent 不易改/删，开发者可通过 SDK 改），靠 tag 组织。[来源](https://docs.letta.com/v1-sdk/memory/archival-memory.md)
- 模型自主性体现在流程里：`/remember` 让 agent 自己判断一条经验放哪并 commit；`/init` 引导建记忆；`/doctor` 审计放置、重复与 token 占用。[来源](https://docs.letta.com/configuration/memory)
- dreaming 是后台子代理复盘近期对话、合并有用经验，可配置在 N 步后或上下文压缩时触发；可选"Agent reviews before applying"再开一轮复核，费 token 但不请求人批准。[来源](https://docs.letta.com/configuration/memory)
- archival 与 conversation search 的分工是原文写明的：archival 是 intentional storage（agent 决定什么值得长期记），conversation search 是 historical retrieval（搜真实历史消息，自动、无需 agent 策展）。[来源](https://docs.letta.com/v1-sdk/memory/archival-memory.md)

### (d) 取舍

值得借鉴：
1. 分层主轴是**上下文驻留**（常驻 / 按需打开 / 检索才进），不是主题分类；这条轴与"模型每轮能看到什么"直接对应。
2. 记忆编辑有版本（commit），"改过什么"可查；这是最便宜的一种可追溯。
3. 把"整理记忆"当成独立动作（`/doctor`、dreaming），与"当场记一条"分开。

不适合搬：
1. 用"多重要 / 多大"决定放哪一层，是一条固定规则，且要模型每次先做一次放置判断；与"不让固定规则决定什么值得记"相抵。
2. block 整体替换 + last-write-wins，既无历史也无出处；与"可追溯、可修正"冲突。
3. archival 对 agent 不可变（agent-immutable）——模型不能修正自己存错的东西，只实现了"自主记"，没实现"自主改"。
4. MemFS 要求模型拥有文件系统与 git 的心智模型。这是能力面而非记忆语义；可借 commit 语义，不必搬文件树。

---

## 2. Hindsight（vectorize-io/hindsight）

### (a) 分层：证据 / 抽取出的事实 / 信念 / 策展文档

- 文档列了五类记忆：**World fact**（"an objective claim it was told"）、**Experience fact**（"something the bank itself did"）、**Observation**（"a belief consolidated from many facts, with its evidence and its history"）、**Mental model**（"a curated summary you write for a question you ask often"）、**Knowledge page**（"a living document the bank writes about itself"）。[来源](https://hindsight.vectorize.io/llms-full.txt)
- 论文把记忆分成四个逻辑网络：world facts、agent experiences、synthesized entity summaries、evolving beliefs；并批评现有系统"blur the line between evidence and inference"。[来源](https://arxiv.org/abs/2512.12818)
- world / experience 的划分依据是**谁在说话**，不是语法：只有当说话者就是 bank 自己的 agent 时，第一人称才算 experience；用户说"I bought a Tesla"是关于用户的 world fact。[来源](https://hindsight.vectorize.io/llms-full.txt)
- 层与层之间是"证据→事实→信念"的支撑关系，不是按主题分区：observation 由后台从 fact 合并而来，并指向支持它的 memories。[来源](https://hindsight.vectorize.io/llms-full.txt)

### (b) 时间：两个维度，但没有"失效"

- 明写两个维度：**When It Happened**（会议、旅行、里程碑这类事件的发生时间；偏好、特征这类一般事实"没有具体发生时间"）与 **When You Learned It**（"Hindsight also tracks when you told it each fact"）。理由：历史查询、recency 排序、时序推理三者都需要区分。[来源](https://hindsight.vectorize.io/llms-full.txt)
- `retain` 的 `timestamp` 是"事件实际发生的时间"，三种取值：省略 → 用写入时刻；ISO 8601 → 用给定时间；`"unset"` → 完全不带时间戳，抽取 prompt 显示 `Event Date: Unknown`，允许每条 fact 的 `when` 返回 `N/A`（用于参考文档、书、虚构内容）。[来源](https://hindsight.vectorize.io/llms-full.txt)
- **没有 fact 级 `valid_at` / `invalid_at`。** 更新在 document 粒度：同 `document_id` 再 retain 默认 `replace`，删除旧 document 及其全部 memories 后重抽；`update_mode:"append"` 则拼接后重处理。[来源](https://hindsight.vectorize.io/llms-full.txt)
- 只有弱形式的"可能过时"：记忆已落地但尚未合并时，`reflect` 把受影响的 observation 视为 stale，先拿原始 fact 核对再采信。[来源](https://hindsight.vectorize.io/llms-full.txt)
- 因此 Hindsight 用"何时发生 + 何时被告知"表达时间，用"删除重抽 / 信念重构"表达变化，不用区间表达"仍然成立"。

### (c) 来源与修正

- 每条 memory 带 `document_id`、`chunk_id`、`tags`、`metadata`（任意 k/v，如 `{"source":"slack","thread_id":"T123"}`），并随每次 recall 返回。[来源](https://hindsight.vectorize.io/llms-full.txt)
- `attachments` 记录"模型看过哪些材料才产出这条记忆"，原文称它是 evidence, not decoration。[来源](https://hindsight.vectorize.io/llms-full.txt)
- observation 的证据是结构化的：每条指向支持它的 memories，带 exact quotes 与 proof count；"Refined, not overwritten"——新证据更新 observation，历史保留，因此能看到信念变化。[来源](https://hindsight.vectorize.io/llms-full.txt)
- `reflect` 的 `based_on` 返回被引 memory 的这些字段与 attachments；knowledge page 明确"Never self-citing"，页面之间不互相引用，避免形成反馈环。[来源](https://hindsight.vectorize.io/llms-full.txt)
- 修正只有两条路：document replace（硬删旧记忆）或 observation 重构（留历史）。原文也承认"content itself is never stored verbatim"，但 chunk 仍保留，`include_chunks=True` 可取回原始文本。[来源](https://hindsight.vectorize.io/llms-full.txt)

### (d) 取舍

值得借鉴：
1. 把"证据"与"推断"显式分成两层，且信念必须指回支持它的证据——这正是"当前认为什么是真的"与"凭什么"分开的现成做法。
2. 信念带历史：变化可见（原文 "so you can see a belief change"），而不是把旧版本覆盖掉。
3. 时间缺席也是一种信息：`"unset"` / `Event Date: Unknown` / `when: N/A`，明确区分"不知道何时发生"与"就是现在"。这条最贴合"时间是信息，不是过期开关"。
4. 出处随检索结果一起返回，不必另开一次接口去查。

不适合搬：
1. document replace 直接删除旧记忆，与"失效不删除"相反——历史恰好在这里丢掉。
2. 抽取与合并是异步的：写入后立刻 recall 可能查不到（作者自述）。对"模型刚记下就要用"的场景是硬伤。[来源](https://hindsight.vectorize.io/blog/2026/03/04/mcp-agent-memory)
3. 后台 worker 自行合并、改写信念；决定"什么值得记"的实际不是主模型，与"模型自己判断"有张力。
4. 五种类型 + bank 级 mission / directives / disposition 配置面很大，且类型是事先规定的，不是用出来的。

---

## 3. OpenViking（volcengine/OpenViking）

### (a) 分层：按上下文类型分，外加目录级摘要层

- 四类 context：**Resource**（用户添加的源知识）、**Memory**（偏好/事实/任务经验，长期动态更新）、**Skill**（任务说明）、**Rule (Beta)**（durable executable mandatory constraint）。[来源](https://docs.openviking.ai/en/concepts/02-context-types)
- Memory 之下有 11 个内建类型：profile、preferences、entities、events、identity、soul、cases、trajectories、experiences、tools、skills（后两类默认关闭），按 `~/memories/...` 的目录组织。[来源](https://docs.openviking.ai/en/api/16-memory)
- **L0 / L1 / L2 不是记忆层级，是目录级摘要**：L0 `.abstract.md` 256 字符，用于向量检索初筛；L1 `.overview.md` 4000 字符，用于 rerank / 导航；L2 是原始文件按需加载。L0/L1 是目录级的，不是每个文件都有。[来源](https://docs.openviking.ai/en/concepts/03-context-layers)
- 统一 URI 寻址（`viking://user/{user_id}/...`），记忆只是文件树的一片。[来源](https://docs.openviking.ai/en/concepts/02-context-types)

### (b) 时间：用"新鲜度"而不是"有效期"

- sidecar 的 YAML frontmatter 只有 `directory`、`source{kind,uri}`、`generated_by{component,trigger}`、`freshness{total_entries,sampled_entries,unsampled_entries,pending_child_changes}`；`pending_child_changes > 0` 表示正文已知落后于子层变化。[来源](https://docs.openviking.ai/en/concepts/03-context-layers)
- 我查的六页里只出现 `created_at` / `extracted_at` / `freshness`，**没有 valid from/until、invalid_at、superseded 这类字段**（这是检索结论，不是官方声明）。[来源](https://docs.openviking.ai/en/concepts/03-context-layers)
- 最接近"何时不再适用"的是 Rule 的 `status`：`active` 可编译可检索；`paused` 可编译**但不检索**，"retained without expiry cleanup"；`archived` 逻辑删除并存 `archived_at`，默认 30 天后清理。[来源](https://docs.openviking.ai/en/concepts/17-rule-scenarios)
- Rule 另有 `applies_when`（适用条件，空 = 处处适用除 exception）与 `exception`：**用条件表达适用性，不用时间表达失效**。[来源](https://docs.openviking.ai/en/concepts/17-rule-scenarios)
- 结论：OpenViking 把"现在还成不成立"表达为"派生摘要是否已知落后"与"规则是否处于启用状态"，不表达为事实的有效区间。

### (c) 来源与修正

- sidecar 的 `source{kind,uri}` + `generated_by{component,trigger}` 记录"从哪来、由谁生成"。[来源](https://docs.openviking.ai/en/concepts/03-context-layers)
- 每次 session commit 产出 `memory_diff.json`：adds（只有 after）、updates（before + after）、deletes（deleted_content）、skipped_operations（带 reason_code，如 `invalid_ranges` 表示解析不出事件区间）、summary 计数。[来源](https://docs.openviking.ai/en/concepts/08-session)
- 抽取链是 `SessionCompressorV3 → ExtractLoop → MemoryUpdater → SemanticQueue`；MemoryUpdater 校验后应用 additions/edits/deletions，schema、写权限、输出校验共同决定"这次能不能写"，因此一次 commit 不一定新增记忆。[来源](https://docs.openviking.ai/en/concepts/08-session)
- Rule 自带 sources + exact evidence + `revision`，修订留版本号。[来源](https://docs.openviking.ai/en/concepts/17-rule-scenarios)
- 修正即改文件内容 + 留 diff；文件本身是否有逐条历史（回滚）我没查到。

### (d) 取舍

值得借鉴：
1. "派生摘要声明自己是否落后"（`pending_child_changes`）：把"这条结论是最新的"与"它是真的"分开，且不用 TTL。
2. 每次写入留 before/after diff，连"没写进去"都带 reason_code——修正可审计，跳过也有记录。
3. Rule 把"适用条件"（`applies_when` / `exception`）与"内容"分开；边界是条件，不是期限。
4. 明说"主题相似不等于适用"，要求 agent 用可读证据自己判 satisfied / violated / undetermined，空结果不等于库里没有。这条与"不让固定规则替模型判断"同向。

不适合搬：
1. L0/L1 摘要层是为向量检索服务的（abstract 初筛、overview 重排）；不引入向量库时这层的收益与成本要重算。
2. 目录树 + 路径锁 + 多写存储是文件系统级工程，记忆被"放在哪个目录"绑死。
3. 11 类记忆是预先规定的分类法，容易变成先建分类再找内容。
4. commit 级异步流水线（摘要 → 抽取 → 向量化 → 索引）意味着写入不是即时的，写入与可检索之间有时间差。[来源](https://docs.openviking.ai/en/concepts/08-session)

---

## 4. Zep / Graphiti：把"何时为真"与"何时被记录"分开

### (a) 分层

- 三个子图：**episode subgraph**（原始 message/text/JSON，"non-lossy data store"）、**semantic entity subgraph**（实体与实体边）、**community subgraph**（强连通实体簇的高层摘要）；论文明确类比情景记忆 vs 语义记忆。[来源](https://arxiv.org/html/2501.13956v1)
- 事实存在**边**上，不在文档里；边有 name（`WORKS_AT` / `LIVES_IN` / `OWNS` / `PURCHASED`），可用 custom ontology 注册类型。[来源](https://help.getzep.com/facts.md)
- episode 是"a single data ingestion event"，本身也是一个节点，抽出的节点用 `MENTIONS` 边连回它。[来源](https://help.getzep.com/graphiti/core-concepts/adding-episodes.md)

### (b) 时间：四条时间戳，两条时间线

- 定义原文：timeline `T` 是事件的时间顺序，timeline `T′` 是 Zep 摄取数据的事务顺序；`T′` 用于数据库审计，`T` 用来建模对话数据的动态性。[来源](https://arxiv.org/html/2501.13956v1)
- 每条边四个时间戳：`t′created`、`t′expired ∈ T′` 表示系统何时创建/判定失效；`tvalid`、`tinvalid ∈ T` 表示事实何时成立/不再成立。[来源](https://arxiv.org/html/2501.13956v1)
- 失效不是删除：新事实与语义相关的旧事实矛盾、且时间上重叠时，把旧边的 `t_invalid` 设为新边的 `t_valid`；"Following the transactional timeline T′, Graphiti consistently prioritizes new information"。[来源](https://arxiv.org/html/2501.13956v1)
- 官方例子：Kendra 先爱 Adidas、后因鞋坏改爱 Puma → 使 "loves Adidas" 失效，新增 "Adidas shoes broke" 与 "likes Puma"。[来源](https://help.getzep.com/facts.md)
- 事件时间的锚是 episode 的 `reference_time`（"the timestamp for when this episode occurred or was created"），用于把 "next Thursday"、"one week ago" 解析成绝对时间；无时间的日期按 UTC 午夜。[来源](https://help.getzep.com/graphiti/core-concepts/adding-episodes.md)
- 输出时带区间：Context Block 里 fact 形如 `(2024-11-14 02:03:58+00:00 - present)`，注入模板是 `FACT (Date range: from - to)`。[来源](https://help.getzep.com/facts.md)
- 自述边界：`valid_at` / `invalid_at` 是从内容推断的，"does not prove that the source content or the inferred facts are true"。[来源](https://help.getzep.com/facts.md)

### (c) 来源与修正

- 每个派生节点/边都能回到源 episode：episode 是原始数据层（non-lossy），语义产物可回到它作 "citation or quotation"；episode 也能快速找到它提到的实体与事实（双向索引）。[来源](https://arxiv.org/html/2501.13956v1)
- 修正 = 新增事实 + 给旧事实一个 `t_invalid` 边界；旧事实仍在库里，因此可以查"现在为真"或"某时刻为真"。[来源](https://github.com/getzep/graphiti)
- 论文说 `T′` 只用于数据库审计；我没有看到它进入给模型的上下文。[来源](https://arxiv.org/html/2501.13956v1)

### (d) 取舍

值得借鉴：
1. 两条时间线 + 四个字段，是"现在还成不成立"最完整的答案：成立区间、记录时间、判定失效的时刻能分开看。
2. 失效用**边界**而非删除，且边界取自新证据的成立时间，不取自当前时钟——这与"不用固定 TTL"同向。
3. 检索结果本身携带区间，模型看到"在 2024-11 至 2025-03 成立"，而不是一个布尔的"有效/无效"。
4. 原始输入层 non-lossy，派生层可引用回去；出处是数据，不是注释。

不适合搬：
1. 整套是图数据库 + 实体解析 + 边类型本体，工程量与错误面都大；实体合并一旦错了会静默污染归属。
2. 失效判定由 LLM 比对"语义相关且时间重叠"的边自动完成，官方声明不保证为真；对 Hikari 来说"还成不成立"是需要留痕的判断，不宜静默自动改写。
3. `T′` 是数据库审计语义，不需要暴露给模型。
4. 检索依赖向量 + BM25 + 图遍历三路；不引入向量库时只有部分可复用。

---

## 5. 没核实到的内容（不推测）

- **Letta 现行分层是否还叫 "recall memory"**：`/v1-sdk/memory/recall-memory.md` 返回 404；V1 SDK 记忆导航只有 memory blocks / shared memory / archival memory / context hierarchy。论文里的 recall 指消息库，故本文按论文原义使用该词，未把它当现行产品概念。
- **Letta v1 block 是否有内部版本历史**：API 层未见 version 字段；是否另有审计表未核实。
- **Hindsight fact 级时间字段的存储列名**：抽取输出里字段叫 `when`；API/DB 层字段名未核实。
- **Hindsight 是否有显式"失效 / 撤回"动作**：只见到 document replace 与 stale observation 两处弱形式，未找到 fact 级标记。
- **OpenViking 是否有事实级有效区间**：六页检索未见；不排除其他页面存在，未全站排查。
- **OpenViking 的版本 / 回滚机制**：只看到 `memory_diff.json` 与 Rule 的 `revision`，未读存储与事务页的全部内容。
- **Zep 的 `observations`**（跨实体派生模式）如何存时间、如何失效：未读。
- **Zep / Graphiti 的实体解析策略与错误率**：未核实。
- **三者是否有"该不该记"的判定标准文档**：本文未找到；它们都把这件事交给模型或抽取流水线。

---

## 6. 跨项目归纳

### 值得借鉴的 5 个设计点

1. **两条时间线，必要时再加一条"判定线"。** Zep 的 `T` / `T′` 与 Hindsight 的 happened / learned 都表明："事件何时为真"与"系统何时知道"必须分开存；Zep 进一步把"何时判定失效"也放在事务线上。三者都不是 TTL，而是可展示的信息。[来源](https://arxiv.org/html/2501.13956v1) [来源](https://hindsight.vectorize.io/llms-full.txt)
2. **失效是加边界，不是删记录。** Graphiti 把旧边的 `t_invalid` 设为新事实的 `t_valid`；Hindsight 的 observation "refined, not overwritten"。旧说法退场有明确时刻，且历史仍可查。[来源](https://arxiv.org/html/2501.13956v1) [来源](https://hindsight.vectorize.io/llms-full.txt)
3. **信念必须指向证据，且出处随检索返回。** Hindsight 的 observation 指向支持它的 memories（exact quotes + proof count）；Graphiti 的每条边可回到源 episode 作引用。这样"为什么这么认为"是可回答的，而不只是存了一句结论。[来源](https://hindsight.vectorize.io/llms-full.txt) [来源](https://arxiv.org/html/2501.13956v1)
4. **时间缺席要显式表达。** Hindsight 的 `"unset"` → `Event Date: Unknown` → `when: N/A`，把"不知道何时发生"与"就是现在"分开；Zep 则对无时间日期按 UTC 午夜处理。[来源](https://hindsight.vectorize.io/llms-full.txt) [来源](https://help.getzep.com/facts.md)
5. **派生结论要声明自己的新鲜度。** OpenViking 的 `pending_child_changes` 与 Hindsight 的 stale observation 回答的是"这条摘要可能落后"，不是"这条事实过期"——把"结论"与"结论的新旧"分成两件事。[来源](https://docs.openviking.ai/en/concepts/03-context-layers) [来源](https://hindsight.vectorize.io/llms-full.txt)

一条与"不引入向量库"直接相关的外部事实：Letta 现行 MemFS **默认没有语义/向量索引**，搜索靠普通文件搜索与读工具，需要时才装 MemFS Search mod；会话历史搜索与记忆搜索是分开的。[来源](https://docs.letta.com/concepts/memfs) 反例是 Zep、Hindsight、OpenViking 三家都依赖向量检索（外加 BM25 / 图遍历）。[来源](https://github.com/getzep/graphiti) [来源](https://docs.openviking.ai/en/concepts/07-retrieval)

### 明确不适合搬的 5 个做法

1. **用"重要性 / 体积"决定记忆放在哪一层。** Letta 四层的选层依据是"数据规模与对 agent 有多重要"——这是一条硬编码的判断规则，而且把"记什么"与"放哪"绑成一次决策。[来源](https://docs.letta.com/v1-sdk/memory/context-hierarchy.md)
2. **原地覆盖、last-write-wins。** Letta block 更新与 Hindsight document replace 都会让旧版本消失，前者连历史都没有，后者删掉旧 memories；"改过什么"因此不可回答。[来源](https://docs.letta.com/v1-sdk/memory/memory-blocks.md) [来源](https://hindsight.vectorize.io/llms-full.txt)
3. **后台自动改写信念、主模型不知情。** Hindsight 的 observation 合并与 Letta 的 dreaming 都由旁路子代理完成；对需要"谁判断、谁负责"的系统，信念变更应可复核而不是静默发生。[来源](https://hindsight.vectorize.io/llms-full.txt) [来源](https://docs.letta.com/configuration/memory)
4. **预先规定记忆分类法。** OpenViking 的 11 类、Hindsight 的 5 类都是先定类型再往里装；类型一旦成为写入前置条件，就会反过来决定什么能被记。[来源](https://docs.openviking.ai/en/api/16-memory) [来源](https://hindsight.vectorize.io/llms-full.txt)
5. **把图 + 实体解析整套搬进来。** Graphiti 的价值在时间语义与出处链，不在图结构；实体合并错误会静默改归属，且必须搭配向量与图遍历才有其检索效果。[来源](https://arxiv.org/html/2501.13956v1)
