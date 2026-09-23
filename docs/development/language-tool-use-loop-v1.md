# Language Tool-use Loop v1

> 轮次：**工作标签，不占用任何阶段编号**（不是 P4-04，不是 P4-03 的一部分）
> 状态：**实现完成、测试通过**；交付事实（commit / CI run / 测试计数）由随后的状态记录提交补记
> 前置：`Agent-callable Capability Surface v0`（commit `fdacd93`）已让两个 owner 导出各自的 exposure；`LANGUAGE TOOL-USE LOOP v1 Boundary Review` 的 5 项 NARROW 已由人类全部裁决
> 本轮开工时的 `HEAD` = `85dd4fe`
> 边界依据：人类 mandate + 两层验证冻结；本文件是 **after-the-fact record**，不是新的设计阶段

---

## 0. 本轮回答的问题

`Language Plugin v1` 交付的是**一次**自然语言交互：人问一句，Hikari 用已经存在的事实答一句。但它内部的**路由是固定的四选一**——模型把话说成一个本插件自己发明的 topic 词，`answer.ts` 再把这个词派发到一个 Service 调用上。

这有两个后果，本轮就是来消掉它们的：

```text
第一，模型必须先学会一串只存在于这个插件里的词。
第二，能回答的问题集合，等于本插件预先想到的那四种。
```

本轮把这一层换成**模型直接调用 capability**：请求带上 `tools`，模型回 `tool_calls`，循环去读，读完再决定要不要继续读。**能回答的问题集合不再由本插件的词表决定。**

这不是「给 Hikari 加一个大脑」。它仍然是**出口**：读的是 owner 已经拥有的东西，答的是 owner 自己渲染的行。变的是**选择权的位置**——从本插件的固定词表，挪到模型对这一句话的理解上。

---

## 1. 两个 router 变成一个

改动之前是**两个 router 前后串联**：

```text
Topic Router（LANGUAGE_TOPICS 四选一）
    ↓
Tool Router（topic → Service 调用）
    ↓
Domain Plugin
```

模型挑一个 topic，`answer.ts` 再把 topic 落到一个 Service 上。**第二个 router 是第一个 router 存在的理由**——如果没有它，第一个就没有东西可以派发。

本轮**删掉的是第一个**，第二个因此也没有了：

```text
模  型  →  tool_calls（capability 名字）
   ↓
Tool-use Loop（answer.ts）
   ↓
Domain Plugin
```

**capability 名字本身就是模型要写的东西**，所以 topic 层没有剩下任何可翻译的内容：

```text
work-focus          →  work_focus.read
desktop-state       →  desktop_context.read
desktop-change      →  desktop_context.read
current-context     →  不是 capability，是「都读一遍」，而那正是 loop 读两次做的事
```

**退役的东西**：`src/language/topics.ts`（`LANGUAGE_TOPICS`、`TOPIC_GLOSS`）与 `src/language/understanding.ts`（`buildUnderstandingPrompt`、`readUnderstanding`），以及只为固定 topic 路由存在的代码。

**没有退役的东西**：Language 的 **dialogue concern**。它换了形状（见 §6），但没有消失。

**不允许的中间态**：Topic Router 与 Tool Router 并存。那会得到一个「模型先挑 topic、再在 topic 里挑 capability」的两级选择，第二级还受第一级产生的那个词约束——比原来更贵，且没有任何东西因此变得可回答。

---

## 2. 协议：两个闭集

第一轮（`grounded = false`）的模型应答有两种，且只有两种：

```text
A. 直接对话回复        content 非空，tool_calls 空
B. capability 调用     tool_calls 非空
```

**非空 `content` 加空 `tool_calls` → `chatted`。**
**非空 `tool_calls` → `content` 整段丢弃。**

第二条是**结构性的**，不是约定：模型**不能一边调 tool 一边夹带一段用户可见的散文**。`answer.ts` 在读到非空 `toolCalls` 时根本不读 `content`，所以那段文本不是「被过滤掉了」，而是**从来没有进入过任何变量**。

真实线上的形状（本机实测，`manual-wire.jsonl`）：

```text
keys=[max_tokens,messages,model,temperature,tool_choice,tools]
model=stub-model  max_tokens=512  temperature=0  tool_choice=auto
tools=[work_focus.read|desktop_context.read]
```

`tools[]` 由 `tools.ts` 从 `LANGUAGE_EXPOSURES` **机械生成**：`toModelTools()` 对列表做一次 `map`。**Language 里没有一句 capability 描述文本**——`description` 是 owner 自己的字段，按引用透传。

名字回程走 `findExposure(name)`，对 `LANGUAGE_EXPOSURES` **同一个数组**做线性查找。**模型字符串永远不能直接成为 Service key**：`exposure.service` 才是契约对象，`read.ts` 用 `exposure.service ===` 去认它。

---

## 3. 循环终止：不变量，不是魔数

**没有 `MAX_AGENT_STEPS`。** 终止依据是一条不变量：

> **每一次能够继续的迭代，必须消费一个此前没有读过的 exposure；否则循环终止。**

因此上界是**推出来的**，不是写下来的：

```text
LANGUAGE_EXPOSURES.length = 2
⇒ 最多 2 次 Service 读
⇒ 最多 3 次模型调用
```

同一个 capability 在一次交互中**不会**被读第二次；重复调用**不产生第二次 Service 读**，并直接终止。未知名字与非法参数**不被执行**，直接进入 `refused`。

因此一个**永远重复同一个调用的脚本模型会确定性地终止**，而不是靠某个计数到顶。

这条不变量在 `LANGUAGE_EXPOSURES` 增长时会自动重算上界，**但「允许重读」的能力出现时必须重新审视**——记录在此，不在本轮解决。

---

## 4. 一个批里的多个调用

v1 支持一条 assistant 消息里出现**多个** `tool_calls`。线上不变量：

> **只要还要再发一次模型请求，上一条 assistant 消息里的每一个 `tool_call_id` 都必须已经有一条对应的 tool 结果消息。**

批内出现 重复 / 未知 / 非法 时：

- **不**重读已经读过的 Service；
- 批的完整性**保住**（所有 call id 都有归宿）；
- 未执行的调用得到一条**受控的** tool 结果，**内容里不含模型原始自由文本**；
- 如果这个批导致终止，**先把整批处理完再终止，不再发新请求**。

本机实测（真实常驻、真实命名管道）：

```text
「批量」  一个 assistant 消息里两个 tool_calls
    exit=0  model requests=2
    第 2 次请求 roles=[system,user,assistant,tool,tool]   # 两个 tool 结果都在

「重名」  同一个 capability 在批里出现两次（id 不同）
    exit=0  model requests=1                              # 第二次不读，批后直接终止
    stdout 只有一份「你当前明确关注：hikari-new」
```

一处对抗性评审发现的真实缺口：**同一个批里两条调用共用一个 id**。两条调用各自合法、批级检查此前看不出来，而它**可达**（两个不同的新 capability 同一个消息正是本构建的 exposure 集允许的批）。放任它会让下一次请求带着两条同 id 的 tool 结果出去，被按 id 索引结果的端点点名拒绝，于是一次本该成功的 grounded 回答变成 `failed`。现在在 `readStep` 里显式拒绝：

```text
「重复id」  exit=1
    模型没有答上来，所以这个问题没有被理解，也没有被回答。
      细节：模型端点的应答里有重复的 tool_call id。
```

---

## 5. tool result 的形状

**没有 Universal Result Envelope。** 模型看到的，就是**确定性的 grounded 人类可读块**：

```text
work_focus.read      →  renderFocus(...)
desktop_context.read →  renderAssessment(assessment)   # desktop-session-observe 既有的那个
```

**不把 raw Service 结构整棵交给模型**：`DesktopSessionAwarenessAssessment` 是一棵带 facet 判词的嵌套快照，交给模型就是交给它一棵要它自己解释的树。renderer 已经把树压平成带标签的行，走的就是那些行。

**模型看到的内容，和最终 grounded answer 将使用的内容，是同一份数组。** 这不是巧合而是要求：给模型一份**不同**的视图，就是同一份 reading 的第二份陈述，而这两者一旦分叉，模型就被喂了人类没有的东西。

`read.ts` 在返回前对每一行做一次 `oneLine`：工作焦点是**人打进去的文本**，其中一行如果带换行，到模型那里就是两行——第二行长成 Hikari 自己写的行的样子。`renderAssessment` 自己已经转义过（对桌面那半边是 no-op），两边都做，是因为要成立的是 **reading 的性质**，不是某一个分支的性质。

---

## 6. Dialogue Context：`{topic, at}` → `{reads, at}`

```ts
interface DialogueTurn {
  readonly reads: readonly string[];   // exposure 名字，按读取顺序
  readonly at: string;                 // ISO 8601
}
```

TTL（5 分钟）、过期语义、activation-local 语义**逐字未变**。变的是**持有物**：从「本插件发明的 topic 词」变成「上一轮真正读了哪些 capability」。

- 只有**真正 grounded 的 `answered`** 才推进 referent；
- `chatted` **既不推进也不清除**已有且仍然有效的 grounded referent（人在两个关于屏幕的问题中间说一句「ayobro」，没有换话题）；
- `refused` / `failed` 不推进。

**没有** full transcript、**没有** chain of thought、**没有** tool reasoning trace、**没有** 模型散文历史、**没有** Chronicle 条目、**没有** Memory。

---

## 7. 四个 outcome

```text
chatted    什么都没读。模型和人说了话，那段话就是回答（0 次 Hikari capability 读取）。
answered   至少读了一个 capability，回答就是读到的内容。
refused    本构建看懂了请求，但不会回答它。
failed     本构建没能走到一个结论——模型够不到，或者回答所依据的契约在途中拒绝。
```

`chatted` 与 `answered` **不合并**，理由是**只有后者有资格被当作关于这台机器的事实**。一个 `answered` 是一次 reading，一个 `chatted` 是一句话；客户端如果要自己猜手里拿的是哪一种，猜的正是这个出口存在的理由。

**没有 outcome 会把两者混在一起**，而且这是构造上的而不是约定上的：循环只有在**什么都没读**时才产生 `chatted`，所以 outcome 不可能被独立于实际发生的事去选择。

---

## 8. Speech Sovereignty（结构不变量）

本轮把这条当作**结构不变量**来验证，自动化测试负责证明：

- `tool_calls` 非空时，model `content` **不进入** human-visible answer；
- 一旦成功读取 capability，后续**没有**自由 prose 的 grounded 出口；
- grounded answer **仅由 deterministic renderer 产生**；
- **Domain Plugin 不获得 user-facing speaking turn**。

grounded 状态下的合法控制结果只有两种：

```text
A. 调用一个尚未读过的已暴露 capability
B. 结束
```

grounded 状态下出现普通散文：**不进 answer / 不进 fact / 不进 diagnostic detail**，而是终止循环，用**已经读到的确定性 grounded 块**收尾。

> **模型可以决定「还需要读什么？」，模型不能决定「这些事实意味着什么？」**

本机实测：stub 在 grounded 态故意说「（读了之后我想评论两句，但这段话不该出现在答案里。）」，两次 `stdout` 里都**没有**这句话。

**Grounded LLM Expression**（让模型解释已读到的事实）**明确不在本轮**，记录为后续独立 slice。

---

## 9. Semantic Necessity（另一层，只能由真实 endpoint 提供）

**这一层不是脚本模型可以证明的。** 脚本模型证明了「给定某个 model decision 之后，系统执行路径正确」；它**没有**证明真实模型**会做出**那个 decision。

选择准则（已冻结）：

> 模型选择 capability 的依据不是「这句话出现了哪个领域词」，而是「**为了诚实完成当前用户意图，是否确实需要读取该 capability 当前拥有的 domain information**」。

因此：**提到 Desktop ≠ 需要读 Desktop；没有出现「桌面」二字 ≠ 不需要 Desktop；明确禁止读取 Desktop → 不应调用 Desktop。**

验证方式是 8 句话、每句独立 3 次，收集 `input / 实际选择的 capability / 实际 Service 读取 / outcome`，**最终回复文案不能代替 tool-selection evidence**。

**本轮该层在本机 NOT RUN**（没有可达的真实模型 endpoint），详见 §13。

---

## 10. 失败语义

```text
模型不可用 / 超时                 → failed
模型首轮应答畸形 / 空 / 不可用     → refused
未知 capability                   → refused
capability 调用畸形（带参数）      → refused
Service 调用拒绝                  → failed
domain 中合法的「没有」            → answered（不是 refused，也不是空回答）
desktop 部分不可用                → answered
grounded 态普通散文                → 不是模型错误，正常终止并渲染已读块
```

**没有 Universal Agent Error taxonomy。**

**模型原始输出不泄漏**：没有 `` `未知能力：${modelOutput}` `` 这类措辞，全部是固定、确定性的文本。

---

## 11. 明确不做（本轮冻结）

```text
XML / JSON-in-content / prompt-prefix 的 tool-call 回退   第二套协议
偷偷退回旧的 LanguageTopic classifier
Tool Registry / Capability Registry / Service 枚举 / 动态插件发现
Generic Agent Runtime / Planner / deferred discovery / BM25 / Jev
Model Router / provider abstraction
JSON Schema abstraction / 通用参数校验框架
Universal Result Envelope / Universal Agent Error taxonomy
Authority / Approval / policy framework（两个 capability 都是只读）
Global Context / Memory / Chronicle 条目 / transcript / reasoning trace
Grounded LLM Expression
```

`src/runtime/**` 本轮**一个字节未改**。`LANGUAGE_EXPOSURES` 仍然是**写出来的两个字面条目**，没有登记、没有发现、没有遍历 Runtime。

---

## 12. 已知限制（记录，不是本轮缺陷）

- **referent 是 activation-local 的**，同一进程里多个客户端共享一个 referent；per-client 需要 session identity，本构建没有别的用途，v1 不假装有。
- **`chatted` 的内容不受 Hikari 事实约束**。本轮**没有**为此新增「不要编 Hikari 实现」之类的 prompt——那是用 prompt 约束冒充事实来源。未来如需 grounded self-knowledge，应由真实的 repository / self-knowledge capability 提供。
- **零参数是硬编码的边界**（`additionalProperties: false` + `readArguments`）。第一个需要参数的能力出现时，参数形状由它自己决定，本轮不预造。
- **不变量依赖「不重读」**。一旦出现允许重读的能力，终止上界需要重新推导。

---

## 13. 测试事实（两层分开记录）

**第一层：自动化结构测试（`npm test`）。**

```text
533 tests / 531 pass / 0 fail / 2 skipped   （本机 Windows）
```

两条 skip：环境门控的语义 live 测试（`test/language-semantic.live.test.mjs`）与 POSIX SIGTERM 用例。

这一层证明的是：**给定相应 model decision 之后系统执行路径正确**；`chatted` 路径真实可达；0-tool decision 确实产生 0 次 Service 读；capability decision 只读取被选择的 Service。**它不证明真实模型完成了语义选择。**

`test/language-semantic.live.test.mjs` 的 8 条成对用例属于本层——它们是**路径正确性**的证据，不是 semantic selection 的证据。

**第二层：真实 endpoint 语义验证。**

```powershell
$env:HIKARI_SEMANTIC_ENDPOINT = '<url>'
$env:HIKARI_SEMANTIC_MODEL    = '<name>'
$env:HIKARI_SEMANTIC_CREDENTIAL_ENV = 'SOME_API_KEY'   # 可选
node --test test/language-semantic.live.test.mjs
```

**本轮在本机 NOT RUN**：本环境没有可达的真实模型 endpoint，也没有对应凭据。README 级的说明写在测试文件抬头。

> 该文件的设计也记在这里：验证 harness 的 `requested` 读的是 `model.step` **返回的东西**，不是下一次请求的 `messages`。后者会漏掉它存在的那个理由——循环在拒绝一个批之后不再发请求，于是一个「被明确禁止仍然要求读桌面」的模型会被记成「什么都没要求」。
> 这一条不是推测：用一个故意越权的假 endpoint（对四条负例全部返回带参数的 `desktop_context.read`）跑**旧** harness，得到的是**全绿**；同一份 server 换成新 harness，四条负例 3/3 全 FAIL。

**第三层：真实进程手工验证（`hikari ask` 全链路）。**

真实 `init` / `chronicle init` / `resident` / 命名管道 / 插件 / HTTP transport，本地 stub endpoint。覆盖：纯聊天 ×2、单次读取 ×2（含模型夹带散文）、验收 D（两次读取、三次模型调用）、批内两个调用、批内重名、批内重复 id、带参数调用、未知能力、首轮空应答。**全部与预期一致**，线上形状逐次核对（`max_tokens=512`、`tool_choice=auto`、`tools` 两项、tool 结果消息的 `tool_call_id` 完整性）。

---

## 14. 交付

交付事实（commit / CI run / 测试计数）由随后的**状态记录提交**补记——沿用 `Agent-callable Capability Surface v0` 的同一分工：**feat 提交不携带交付事实。**
