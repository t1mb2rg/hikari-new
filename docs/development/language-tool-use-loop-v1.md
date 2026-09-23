# Language Tool-use Loop v1

> 轮次：**工作标签，不占用任何阶段编号**（不是 P4-04，不是 P4-03 的一部分）
> 状态：**实现完成、已通过 Functional / Architecture Review、已提交、已 push、CI 通过**（commit `38bf7cd`，CI Runtime Tests #35812104427 **success**）
> 前置：`Agent-callable Capability Surface v0`（commit `fdacd93`）已让两个 owner 导出各自的 exposure；`LANGUAGE TOOL-USE LOOP v1 Boundary Review` 的 5 项 NARROW 已由人类全部裁决
> 本轮开工时的 `HEAD` = `85dd4fe`
> 边界依据：人类 mandate + 两层验证冻结；本文件是 **after-the-fact record**，不是新的设计阶段
>
> **口径更新（provider function name 修正之后）**：两个 capability 名已由 `work_focus.read` / `desktop_context.read` 改为 **`work_focus_read` / `desktop_context_read`**。原因在 wire 而不在本仓库：OpenAI-compatible（含 DeepSeek）function calling 要求 `tools[*].function.name` 匹配 `^[a-zA-Z0-9_-]+$`，带点的名字被服务端以 **400** 拒绝**整个请求**——于是失败发生在请求到达模型之前，调用方看到的是「模型一直没说话」，而**不是**模型做错了一次语义选择。改动只落在 `name` 一个字段：两个 **Service contract**、owner 写的 `description`、`service` 引用映射、`{name, description, service}` 的 shape、`src/runtime/**` 全部未动，`tools.ts` / `findExposure` / `answer.ts` / `dialogue.ts` / `read.ts` **名字无关，未改**。约束现由 `test/language.test.mjs` 对 `LANGUAGE_EXPOSURES` 直接断言（正则 `^[a-zA-Z0-9_-]+$`），下一个想用点号的 owner 会先撞到测试。「**加了模型侧别名**」这条路**没有被采用**：同一个东西有两个名字就会各自漂移，而 `aliases` 正是两个 owner 都记录为「刻意不加」的字段之一——**被 wire 约束的那一个就是它自己的名字**。§2/§5 里的线上形状样本取自改名之前，名字已就地更新（形状逐字未变）；§13 的两层结论与 §9 的 NOT RUN 状态**均不受影响**。

> **口径更新（non-thinking 模型调用语义冻结之后）**：Language 的**模型调用语义已由人类裁决冻结为 non-thinking**，并只在 model connection 上增加了一个**最小可选配置** `reasoningEffort`（当前闭集只有一个成员 `'none'`）。**未配置时请求体逐字与冻结前一致，不带 `reasoning_effort`**——因此对不认识这个字段的 endpoint 没有任何影响；配置为 `'none'` 时，Chat Completions 请求体**顶层**加入 `reasoning_effort: "none"`，**仅此一个字段**。**没有**加入：`thinking`、`reasoning_content`、provider 判断、endpoint sniffing、DeepSeek 特判、Model Router、Provider Registry、generic `extra_body`、reasoning trace abstraction。配置入口是既有的那一条：CLI `--model-reasoning-effort` → `LanguagePluginConfig.reasoningEffort` → `LanguageModelConnection.reasoningEffort`，live harness 用的是**同一个** connection 字段，没有第二套 request body。闭集本身只有一处：`model.ts` 的 `REASONING_EFFORTS` 表由 union 定型（**给 union 加一个成员，这张表不补就不编译**），`plugin.ts` 的校验问这张表、拒绝的话也从这张表生成——沿用 `options.ts` 对 work focus 词表已有的同一条前例，而不是把 `none` 在类型、分支、消息里各写一遍。**理由不是「某个 provider 默认打开 thinking」**——那是某一个 endpoint 的事实，把它写进这里是 endpoint 特判；理由是**本构建不拥有 reasoning trace 的生命周期**：`reasoning_content` 不解析、不保存、不回放，而一个产出它、又在下一轮要求回传的模式会让**每一次 grounded 回答的第二轮**失效。§2 的线上形状样本抓自**未配置**的请求，逐字仍然成立（`reasoning_effort` 正是以其缺席出现在那份闭集里）；§3 的终止不变量、§5 的 tool result 形状、§8 的 Speech Sovereignty、§11 的「明确不做」**均不受影响**，`src/runtime/**` 与两个 Service contract 同样未动。真实 endpoint 证据见 §13.4。

---

> **口径更新（thinking tool loop 之后）**：`reasoning_effort` 的闭集由 `'none'` 扩为 **`'none' | 'high'`**，并且**在本构建内部实现了 `reasoning_content` 的单次 interaction 回放**——见 §15。上面第二条 blockquote 与 §11、§13 第五层里「本构建不拥有 reasoning trace 的生命周期」「不实现 `reasoning_content` 的回放」的说法，**作为当时的事实仍然成立，作为现在的口径已被取代**：被取代的不是「不拥有」，而是「因此不能支持 thinking 模式」。生命周期仍然只有一个 interaction，仍然不是 Hikari 的概念，仍然没有 ReasoningService / trace / Chronicle 条目 / Memory——变的是**它可以在一次交互内被原样带回**，而这正是 thinking 端点做多轮 tool calling 的前提。同一轮里 `MODEL_MAX_TOKENS` 由 512 改为 **4096**（附单变量实测），因此 §2 的线上形状样本里的 `max_tokens=512` 是**改动前的实测值**，形状逐字未变、只有这一个数字不同；§13 第六层那份 A/B harness 的「生产值仍是 512」前提**随之失效**，该文件现在会按其自身设计失败并报告前提移动，这是**已知且有意保留**的，见 §15.10。§3 的终止不变量、§4 的批完整性、§5 的 tool result 形状、§6 的 referent、§7 的四个 outcome、§8 的 Speech Sovereignty、§11 的「明确不做」**均不受影响**，`src/runtime/**` 与两个 Service contract 再次一个字节未改。

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
work-focus          →  work_focus_read
desktop-state       →  desktop_context_read
desktop-change      →  desktop_context_read
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
tools=[work_focus_read|desktop_context_read]
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
work_focus_read      →  renderFocus(...)
desktop_context_read →  renderAssessment(assessment)   # desktop-session-observe 既有的那个
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

**本轮该层在本机 NOT RUN**（没有可达的真实模型 endpoint），详见 §13。**该状态已由 §15.8 取代**：操作者在自己的机器上跑完了这道门禁，8 句 × 3 次全部通过，语义选择这一层**已经取得证据**；本节对「这一层只能由真实 endpoint 提供」的论证不受影响，只是它现在有了结果。

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
本机（Windows）   533 tests / 531 pass / 0 fail / 2 skipped
CI（ubuntu）      533 tests / 455 pass / 0 fail / 78 skipped   # Runtime Tests #35812104427 success

上面两行是**该 slice 提交时**的数。两次口径修正（provider function name、non-thinking）之后，本机当前是 **540 tests / 536 pass / 0 fail / 4 skipped**——新增的三条是：`LANGUAGE_EXPOSURES` 的 `function.name` 形状守卫、请求体闭集在**未配置**与**配置了** effort 两种情形下的断言、以及 `reasoningEffort` 闭集在 `config.parse` 处的拒绝；再往后的两条来自 §13 第五层的 reasoning-depth matrix harness（1 条环境门控的 live 用例 + 1 条不依赖 endpoint 的句子覆盖守卫）；再两条来自 §13 第六层的 token-budget A/B harness，形状相同（1 条环境门控的 live 用例 + 1 条句子覆盖守卫）；最后九条来自 §15 的 thinking tool loop——结构测试 A–F 六条、`reasoning_content` 的 wire 往返三条。**本机当前是 549 tests / 545 pass / 0 fail / 4 skipped**（§15 记录这一轮改了什么）。
```

本机的四条 skip：三条环境门控的语义 live 测试（`test/language-semantic.live.test.mjs`、`test/language-reasoning-depth.live.test.mjs`、`test/language-high-budget.live.test.mjs`）与 POSIX SIGTERM 用例。CI 的 78 条在此之上多出 **76** 条 `NO_PIPES` 用例——命名管道只在 Windows 上存在，`test/language.test.mjs` 里走真实端点的那一类因此在 Linux 上被跳过（本 slice 让该文件从 9 条变成 11 条，加上语义 live 测试 1 条，正是 75 → 78 的差额）。

这一层证明的是：**给定相应 model decision 之后系统执行路径正确**；`chatted` 路径真实可达；0-tool decision 确实产生 0 次 Service 读；capability decision 只读取被选择的 Service。**它不证明真实模型完成了语义选择。**

`test/language-semantic.live.test.mjs` 的 8 条成对用例属于本层——它们是**路径正确性**的证据，不是 semantic selection 的证据。

**第二层：真实 endpoint 语义验证。**

```powershell
$env:HIKARI_SEMANTIC_ENDPOINT = '<url>'
$env:HIKARI_SEMANTIC_MODEL    = '<name>'
$env:HIKARI_SEMANTIC_CREDENTIAL_ENV = 'SOME_API_KEY'   # 可选
$env:HIKARI_SEMANTIC_REASONING_EFFORT = 'none'         # 可选；省略表示请求里不带这个字段
node --test test/language-semantic.live.test.mjs
```

**本轮在本机 NOT RUN**：本环境没有可达的真实模型 endpoint，也没有对应凭据。README 级的说明写在测试文件抬头。**该状态已由 §15.8 取代**——操作者在自己的机器上跑完了这道门禁并 PASS，证据记在那里；本节保留的是当时的状态与 harness 的设计说明。

> 该文件的设计也记在这里：验证 harness 的 `requested` 读的是 `model.step` **返回的东西**，不是下一次请求的 `messages`。后者会漏掉它存在的那个理由——循环在拒绝一个批之后不再发请求，于是一个「被明确禁止仍然要求读桌面」的模型会被记成「什么都没要求」。
> 这一条不是推测：用一个故意越权的假 endpoint（对四条负例全部返回带参数的 `desktop_context_read`）跑**旧** harness，得到的是**全绿**；同一份 server 换成新 harness，四条负例 3/3 全 FAIL。

**第四层：non-thinking 的真实 endpoint 验证（由人类操作者执行，本机 harness NOT RUN）。**

`reasoning_effort: "none"` 的效力**不是在文档或二手资料上确认的**，而是在操作者自己的真实 DeepSeek Chat Completions endpoint 上实测的：

```text
TURN 1   model=deepseek-flash  reasoning_effort="none"
         finish_reason=tool_calls   reasoning_content 缺席
         selected tool=work_focus_read   arguments={}
TURN 2   未回传 reasoning_content
         请求成功   finish_reason=stop   reasoning_content 缺席
```

这证明三件事，且只有这三件：一，`reasoning_effort: "none"` 在当前请求 shape 下**有效**；二，它确实使这次调用处于 non-thinking（`reasoning_content` 自始至终缺席）；三，**native multi-turn tool calling 可以在这条路径上完成，不需要 reasoning_content 的 parsing / storage / replay**——轮次 2 没有因为缺 `reasoning_content` 而 400。**它不证明语义选择**：TURN 1 选中的是 `work_focus_read`，而那是一个孤立的单轮观察，不是 §9 那 8 句 × 3 次的门禁结果。

`node --test test/language-semantic.live.test.mjs` 的完整 8×3 门禁**在本机 NOT RUN**，状态与上面第二层相同（没有可达的真实 endpoint）。本文件**不给出** `REAL-MODEL SEMANTIC NECESSITY GATE` 的 PASS 或 FAIL。**该状态已由 §15.8 取代**：这道门禁后来在操作者的机器上跑通并 PASS，下面这段 transport-blocked 的记录保留为**当时**的状态。

操作者随后跑了这道门禁，结果是 **24/24 `outcome=failed` / `requested=[]` / `performed=[]` / `serviceReads=0`**：每一次交互都在任何 capability selection 被观察到之前就失败了。这既不是语义证据，也不是 FAIL——按本文件的口径记为 **`REAL-MODEL SEMANTIC NECESSITY GATE = NOT RUN / TRANSPORT BLOCKED`**，并且这个记法不是宽容：`failed` 恰恰是 §7 里那个「本构建没能走到一个结论」的分支，把它读成选择失败会让四句期望为空的正例自动变绿——而它们变绿的原因只是从来没有发生过一次交互。

为了让这个状态可诊断而不是靠猜，live harness 里加了一个**受控的、仅存在于测试中的诊断**。它包住 `globalThis.fetch`（`src/` 一行未动，所以它不可能变成 resident 拥有的行为），在**第一条失败请求**上打印 HTTP status 与 provider 自己的 `error.type` / `error.code` / `error.param` / `error.message`，外加该请求的脱敏形状：top-level keys、`model`、`reasoning_effort`、`temperature`、`tool_choice`、`max_tokens`、每条 message 的 role 与其 keys、每个 tool 的 `function.name` / function keys / `parameters` 是否存在及其值 / description 长度，以及 Authorization 的**存在性**、是否 Bearer、凭据是否非空——**从不打印值或 credential**。它不打印成功响应里的模型正文，不打印 reasoning content，不打印 system prompt 正文；message 只打印 keys、从不打印值，这条区分是结构性的而不是一句承诺。诊断只触发一次：24 次相同的失败是一个事实，重复 24 遍正是第二个事实被淹没的方式。`HIKARI_SEMANTIC_DIAGNOSTIC=off` 关闭它，留给之后重跑干净的门禁。

表格里的 `failed` 行现在会多一行 `失败原因`，那是 harness 本来就拿到、之前却被丢掉的值，因此**不在开关管辖内**：关掉探针不该把结论一起关掉。

**第三层：真实进程手工验证（`hikari ask` 全链路）。**

**第五层：reasoning-depth matrix（四档 reasoning effort 的模型行为实验；本机 NOT RUN）。**

这是一个**只观察模型第一次决策**的实验，落在 `test/language-reasoning-depth.live.test.mjs`。它不执行 Service、不回注 tool result、不发第二轮、不实现 `reasoning_content` 的回放——写它时的口径是本构建不拥有 reasoning trace 的生命周期，而一个产出它又在下一轮要求回传的模式会让每一次 grounded 回答的第二轮失效。**该前提已由 §15 取代**（回放现已在 interaction 内实现），但这个实验本身的形状不受影响、也不该被改写：它问的就是**第一次决策**，而第一次决策在四档里都是**一次**请求，不涉及第二轮的存亡。

```powershell
$env:HIKARI_SEMANTIC_ENDPOINT = '<url>'
$env:HIKARI_SEMANTIC_MODEL    = '<name>'
$env:HIKARI_SEMANTIC_CREDENTIAL_ENV = 'SOME_API_KEY'   # 可选
node --test test/language-reasoning-depth.live.test.mjs   # 8 句 × 3 次 × 4 档 = 96 次首轮请求
```

四档是 `none` / `low` / `high` / `max` 这四个 **canonical depth**；`minimal` / `medium` / `xhigh` / `ultra` 是 provider 侧的别名，映射到同样的底层深度，跑出来不会是四个独立的深度，因此不跑。除 `reasoning_effort` 外的每一个字段都由生产代码通过 `createAnswerer` 的 `step` 依赖间接提供（system prompt、`LANGUAGE_EXPOSURES`、exposure → native tool 的转换），这份文件里**没有第二处**写下这些内容，所以它不可能与 resident 实际发出的请求发生漂移。

观察**不是**一个总分，而是三个互相独立的读数加上各自旁证的证据：

```text
Required Read     当前意图确实需要的事实读到了没有。缺失 = correctness failure。
Forbidden Read    用户明确禁止的 capability 被碰了没有。碰了 = hard failure，
                  与它是否只读、有无副作用无关——明确的用户边界不因为没有副作用而消失。
Over-read         不是必需、但被额外读取的只读 capability。不是 hard failure，
                  但必须记录：grounded loop 一旦读到 capability 就可能进入 deterministic
                  grounded answer，所以一次无关读取仍可能变成 semantic detour / response derail。
```

`required` 与 `exact` 是**两个**集合而不是一个：`required` 判定正确性，`exact` 判定是否正好相等，所以「required satisfied = YES 而 exact = NO」（#1 同时取走两个 capability）是一个能被表达出来的结果，不是被折进一个布尔量的东西。`detour` 只标记本来就不需要当前事实的句子（#5 / #6 / #8）；#7 上发生的读取记进 forbidden violation / over-read，**不重复**计进 detour。

`max_tokens` 保持生产值不变（否则就是第二个变量），但每次观察都记录 `finish_reason`。`finish_reason = length` 的观察被**单独归类为截断并排除在语义选择统计之外**：一个被截断的 `message` 不带 `tool_calls`，不计排除就会在四条负例上记成「正确地什么都没选」——正是「用失败铸出一个通过」的形状。这一条是**被证伪过的**，不是承诺：把排除分支拿掉再跑一遍，同一个 stub 下 `max` 档的可用数从 `23/24` 变成 `24/24`、exact 从 `20/23` 变成 `21/24`，被截断的那一次在表里显示为 `不调用 … exact=YES`，而 `finish_reason=length` 这一行整个消失。同理被证伪的还有：非思考基线的 `none` 档一旦出现 `reasoning_content` 就断言失败（说明四档不再是同一个单变量）、一次观察必须恰好发出一个请求、以及出站 body 携带的 effort 必须等于该档条件。

harness 单次请求上限是 **180 s**，这不是生产策略：`MODEL_TIMEOUT_MS` 是 15 s，而一个 thinking 应答很容易超过它，留着它会让「被时钟切断」和「选择了别的东西」变成同一列数字。报告因此同时给出 `>15 s` 的次数。**本轮不提高 max_tokens，也不改生产 timeout。**

**结构层已用本地 stub 自证**（脚本模型证明的是 harness，不是 DeepSeek）：四档 96 次请求、每档 24 次、每次观察恰好一个请求、出站 `reasoning_effort` 与条件一致、`reasoning_content` 只在 non-`none` 档出现、`finish_reason=length` 被排除、forbidden violation 按档分别计数、HTTP 200 但 `tool_calls` 无法解析时记成 transport failure 而**不是**「不调用」。**真实 endpoint 语义层在本机 NOT RUN**（没有可达的 endpoint 与凭据，见第二层）。本轮**不给**任何一档的推荐，也不据此决定是否实现 thinking tool loop。

**第六层：high reasoning 的 token-budget A/B（`max_tokens` 512 vs 4096；本机 NOT RUN）。**

第五层把 `max_tokens` 按生产值固定（不引入第二个变量），留下一个未结项：high 档出现过 `finish_reason=length`。这一层就是针对它的**单变量**实验，落在 `test/language-high-budget.live.test.mjs`——两档的 `reasoning_effort` 都是 `high`，唯一的差别是输出预算。

```powershell
$env:HIKARI_SEMANTIC_ENDPOINT = '<url>'
$env:HIKARI_SEMANTIC_MODEL    = '<name>'
$env:HIKARI_SEMANTIC_CREDENTIAL_ENV = 'SOME_API_KEY'   # 可选
node --test test/language-high-budget.live.test.mjs    # 8 句 × 3 次 × 2 档 = 48 次首轮请求
```

4096 那一档**无法**通过生产开关做出来，而且这不是配置疏漏：`max_tokens` 是 `src/language/model.ts` 里的模块私有常量 `MODEL_MAX_TOKENS`，**不在** `LanguageModelConnection` 上——一个没人要求的旋钮正是配置面长成架构的方式。所以它由 harness 在 **fetch 层**改写发出请求的那个 body，与观测共用同一个 wrapper；`src/` 零改动，**不**修改生产常量，**不**把 4096 写进 `src/`。这是对生产请求的真实偏离，因此它被当作偏离来报告而不是藏起来：每次观察**分别**记录「生产写进 body 的 `max_tokens`」与「实际发出的 `max_tokens`」，报告两行都打印，并且断言两档的**其余**请求字段完全一致（`model` / `reasoning_effort` / `temperature` / `tool_choice` / 顶层键集 / messages 形状 / tools 名单）。断言还要求**生产值在两档里都仍然是 512**——将来若有人动了 `MODEL_MAX_TOKENS`，这个实验会**失败并说明前提移动了**，而不是安静地拿一个新基线继续比。

请求形状是读自**实际发出的 body**、不是读自 harness 自己的入参；`reasoning_effort` 的核对在第五层已经因为「回显自己的参数」被证伪过一次，这里沿用了修正后的做法。三个单列：A「Work Focus 为什么这么设计？」看 512 的截断在 4096 下是否消失；B「你现在看到什么？」看 4096 是否**引入**额外的 `work_focus_read`；C「别看我的桌面……」两档**各自**单报 forbidden violation。

**结构层已用本地 stub 自证**（脚本模型证明的是 harness，不是 DeepSeek）：48 次请求、两档各 24 次、每次观察恰好一个请求、两档除 `max_tokens` 外的请求形状逐字节一致、生产值两档都记录为 512 而实际发出分别是 512 与 4096。本轮新增的三条守卫都**被证伪过**，不是承诺：(a) 拿掉 fetch 层的改写 → 4096 档 24 次实际发出的都不是 4096，断言失败（同时截断不会消失，所以失败是可见的而不是被吞掉的）；(b) 把「生产值」的读取挪到改写**之后** → 4096 档 24 次记成「生产写进 body 的 = 4096」，生产值守卫失败；(c) 拿掉截断排除 → 512 档三次截断被记成 `exact=YES`、`finish_reason=length` 行变成 `0/24`、「截断是否消失」的对照变成 `0 → 0`（读起来像「本轮没有可消除的截断」，而不是「512 截断了三次」）。**真实 endpoint 语义层在本机 NOT RUN**（没有可达的 endpoint 与凭据，见第二层）。本轮**只给事实**：不决定 production 默认值，也不据此改 `MODEL_MAX_TOKENS` 或 timeout。

真实 `init` / `chronicle init` / `resident` / 命名管道 / 插件 / HTTP transport，本地 stub endpoint。覆盖：纯聊天 ×2、单次读取 ×2（含模型夹带散文）、验收 D（两次读取、三次模型调用）、批内两个调用、批内重名、批内重复 id、带参数调用、未知能力、首轮空应答。**全部与预期一致**，线上形状逐次核对（`max_tokens=512`、`tool_choice=auto`、`tools` 两项、tool 结果消息的 `tool_call_id` 完整性）。

---

## 14. 交付

```text
feat 提交     38bf7cd  "feat: 用 native tool calling 取代 Language 的固定 topic 路由"
CI            Runtime Tests #35812104427  success  (533 / 455 pass / 78 skipped / 0 fail)
```

沿用 `Agent-callable Capability Surface v0` 的同一分工：**feat 提交不携带交付事实**，交付事实由随后的**状态记录提交**补记。

---

## 15. Thinking tool loop：`reasoning_content` 的暂态回放

**状态：实现完成、结构层全绿、真实端点门禁 PASS（§15.8）。** 门禁由人类操作者在自己的机器上执行；本机 harness 仍然 NOT RUN（没有可达的 endpoint 与凭据），两者的证据分档见下面的分节。

### 15.1 改了什么，以及为什么只有这些

前面几层把一件事推到了台面上：`reasoning_effort: "none"` 之所以是当时唯一被支持的成员，理由是**本构建不拥有 reasoning trace 的生命周期**——`reasoning_content` 不解析、不保存、不回放，而一个产出它、又在下一轮要求回传的模式会让**每一次 grounded 回答的第二轮**失效。真实端点的测量（§13 第四、五、六层）把 high 档的可达性也证明了出来，于是那个理由有了条件：生命周期**可以在一个 interaction 内部被拥有**，而不必变成 Hikari 的一个概念。

于是本轮把这条路径补上，并且**只补这一条**：

```text
response → 当前 interaction 的 messages 暂存 → 下一轮 assistant message 原样回放
        → tool results → 下一次请求 → interaction 结束 → 丢弃
```

**绝不跨 interaction 持久化。** 它不是 §6 那个 referent（referent 是「上一轮读了什么」，会跨 interaction 存活 5 分钟），不是 Chronicle 条目，不是 Memory，不进 Dialogue Context，不是 Judgement state，不是 Runtime state，不是用户可见内容，也不是可记录的 reasoning trace。它是**一次 interaction 内部的 provider wire material**，和 `tool_call_id` 属于同一类东西。

### 15.2 生产改动（五个文件，无新概念）

```text
src/language/model.ts     ReasoningEffort 增加 'high'；REASONING_EFFORTS 表随之加一项
                          ModelStep.reasoningContent: string | undefined（新增，required-with-undefined）
                          ModelMessage 的 assistant 变体增加 reasoningContent
                          toWireMessage 以「展开或不存在」的方式带回 reasoning_content
                          readReasoningContent：缺席与 null 读作 undefined，空串保持为空串，其余非字符串抛错
                          MODEL_MAX_TOKENS 512 → 4096
src/language/answer.ts    一处：assistant 消息带上 step.reasoningContent（连同 toolCalls，同一条消息）
src/language/plugin.ts    仅注释：说明本构建接受哪些值
src/cli/options.ts        USAGE 一行 + 一行选项说明
src/language/express.ts   仅注释：与「raising MODEL_MAX_TOKENS 就是在猜一个数」这句旧陈述保持一致
```

**新增的字段一律用既有的两种前例，没有发明第三种**：`reasoningContent` 沿用 `ModelMessage` 的 required-with-undefined 约定（「这个字段是必填的，它的缺席在每个构造点被写下来」）；`toWireMessage` 与 `send` 都沿用**展开模式** `...(x === undefined ? {} : { key: x })`，让「没有值 = 没有这个键」成为**对象构建方式的属性**，而不是 `JSON.stringify` 丢弃 undefined 的属性。空字符串刻意**不**折叠为缺席：`undefined` 是端点什么都没产出，`''` 是端点产出了空的东西，两者在协议上是不同的事实，而这个区分一旦在这里丢掉，下游没有任何地方能恢复。

**不得新增的清单（逐项确认未出现）**：ReasoningService / ReasoningTrace / ReasoningContext / shared reasoning contract / Runtime primitive / provider registry / model router / generic provider abstraction / Chronicle 事件 / Memory 条目。它没有暴露给任何其他 Plugin——`LanguageModelConnection` 上没有新字段，两个 Service contract 未动，`src/runtime/**` **一个字节未改**。

### 15.3 协议行为

assistant 消息的两个字段（role/content）保持原样，`reasoning_content` 存在时在**同一条 assistant message** 上原样带回，再追加每个 tool result，再发下一轮。**wire 保真**：不 trim、不 summarize、不 parse、不 inspect、不 modify、不 concatenate、不 persist。对这个字符串唯一被允许的判断是**存在性**。空字符串保持为空字符串。

### 15.4 effort 与 max_tokens

`ReasoningEffort` 正式支持 `none` 与 `high` 两个成员，理由各自写在类型上：`high` 是本构建被带去生产的那个值，也是这个循环背后**每一次真实端点测量**所用的值；`none` 保留是因为不需要 chain of thought 的部署不该被强加。**实验跑过但产品不需要的成员刻意不在表里**——一个会收留「谁试过一次」的 union 是配置面而不是决定。未配置 → 请求体**完全不携带** `reasoning_effort`。

`MODEL_MAX_TOKENS` 512 → 4096，附**真实端点单变量证据**：high@512 有 3/24 次首轮 `finish_reason=length`，high@4096 是 0/24。**不新增 maxTokens 配置项**。

**没有** endpoint sniffing、**没有** DeepSeek 分支、**没有** provider-name 分支、**没有** keyword routing。`reasoning_effort` 这个名字是 OpenAI 兼容请求字段，不是某一家 provider 的拼法。

### 15.5 结构测试 A–F（`test/language.test.mjs`）

```text
A  非思考向后兼容      没有 thinking 时，所有请求的 assistant 消息 reasoningContent === undefined，行为逐字不变
B  第一轮 thinking+调用  reasoningContent 与 toolCalls 在同一条消息上，下一条即 tool 结果，wire 完整
C  第二轮               两轮各自带回各自的推理（R1 / R2 不交叉、不合并、不丢失），第一轮 tool 结果保留
D  最终停止            最后一段推理不进 reply / 不进 detail / 不进 Dialogue Context / 不进 Chronicle / 不进日志
E  chatted 路径         非思考的对话路径不因为本轮改动而改变
F  grounded 路径        grounded 回答仍由 deterministic renderer 产生，推理不绕过它
```

另有三条 wire 级测试（`test/language-model.test.mjs`）走**真实 HTTP 往返**：原样往返（含首尾空白与制表符，且键序为 `content, reasoning_content, role, tool_calls`）、空字符串仍是字符串（`'reasoning_content' in body` 为 true）、以及端点没有产出该字段时它**不出现**在请求里。

### 15.6 四项强制证伪（全部红过，全部逐字节恢复）

```text
1  移除回放（reasoningContent: undefined）   → B、C 红，断言 `undefined !== 'R1'`
2  交叉轮次（把这一轮的推理盖到上一轮上）    → C 红，断言「第一轮的推理不得被第二轮的覆盖」`'R2' !== 'R1'`
3  最终推理泄漏进回答                        → D（泄漏守卫）与 F（确定性渲染器守卫）红，diff 显示答案末尾多出被泄漏的那一行
4  MODEL_MAX_TOKENS 改回 512                 → production request-shape 守卫红（actual 512 / expected 4096）
```

恢复后 `git diff` 与证伪前**逐字节一致**（`answer.ts` 校验哈希 `12eff4cdd34188aea011cb7dac86797444c4d1e46883d9e93c7539bd9a229ad5`）。

第 2 项第一次写得太钝（推入上一轮的陈旧推理），整体错位一格，B 与 C 一起以 `undefined !== 'R1'` 失败，**没有**体现「R1 被错接到第二轮」——这正是证伪要避免的形状：失败对了，原因说错了。改成覆盖已存在的 assistant 消息后，只有 C 失败，断言精确指向被交叉的那一对。第 3 项第一次在无推理时也追加空行，导致 A / C / F 一并失败；改成只在泄漏非空时追加后，只有 D 与 F 失败。

### 15.7 循环终止没有被重新设计

`answer.ts` 的终止不变量（§3）、批完整性（§4）、一次性门（§7）、Speech Sovereignty（§8）**全部保持不变**。本轮在循环里增加的只有「assistant 消息多带一个字段」。

### 15.8 真实端点门禁：**PASS**（由人类操作者在自己的机器上执行）

```text
REAL-MODEL FULL THINKING TOOL-LOOP GATE = PASS
```

命令（本机 harness 无 endpoint，NOT RUN；以下结果来自操作者的真实机器）：

```powershell
$env:HIKARI_SEMANTIC_ENDPOINT = 'https://api.deepseek.com/chat/completions'
$env:HIKARI_SEMANTIC_MODEL    = 'deepseek-flash'
$env:HIKARI_SEMANTIC_CREDENTIAL_ENV = 'DEEPSEEK_API_KEY'
$env:HIKARI_SEMANTIC_REASONING_EFFORT = 'high'
node --test test/language-semantic.live.test.mjs
```

冻结条件：`deepseek-flash` / `reasoning_effort=high` / production `max_tokens=4096`，**8 句 × 3 次 = 24 个 interaction**。

```text
整体            8/8 句 PASS
required 正例    4 句 × 3/3 全部读到 required capability
forbidden        「别看我的桌面，我们聊聊桌面架构。」3/3 未读取 desktop_context_read
meta-domain      「桌面感知是怎么实现的？」3/3 不调用；「Work Focus 为什么这么设计？」3/3 不调用
                 两句的 semantic detour 均为 0/3
闲聊             「最近写 Hikari 写麻了。」3/3 chatted，无 capability read
over-read        「你现在看到什么？」1/3 同时读取 desktop + work_focus；其余 over-read = 0
reasoning_content 36/36 次模型请求均带 reasoning_content
protocol         无 400、无 transport failure、无 replay failure、无 finish_reason=length 导致的 gate failure
```

**36 这个数字与 interaction 结构对得上**，这是「回放确实跑通」的证据而不是一个计数：12 个 tool interaction × 2 次请求 = 24，12 个 no-tool interaction × 1 次请求 = 12，合计 36。也就是说 **thinking → tool call → Service read → `reasoning_content` 回放 → 第二轮模型请求 → grounded completion** 这条完整链路在真实端点上实际走过了，而不只是被结构测试断言过。

**唯一一次 over-read 按冻结口径记为可见的优化信号，不是失败**：那是一个只读 capability 被多读一次，它既不是 correctness failure，也不是 forbidden violation，也没有让那一句变成 hard failure。**本文件不记录 `reasoning_content` 正文**——按 §15.1 的生命周期，它不是本构建拥有的东西，没有一处持久化它，报告里也没有它的位置。

八项验证逐条落实：required 全完成 ✅、forbidden 0 violation ✅、无 protocol 400 ✅、无 replay failure ✅、grounded answer 仍 deterministic ✅、无 reasoning leakage ✅、no-repeat / max-step 不变量保持 ✅、无 `finish_reason=length` ✅。

**这一层证明的是真实模型完成了语义选择**，也就是 §9 那一层此前无法在本机取得的证据。它**不**证明别的东西：24 次是一个 endpoint、一个模型、一个 effort 下的观察，不是一个关于「所有模型都会这样选」的结论。

### 15.9 harness 的评估标准按冻结标准重述

`test/language-semantic.live.test.mjs` 的判定从「选中集合等于期望集合」改成冻结标准，**三档而不是两档**：

```text
required 缺失        → correctness failure（FAIL）
forbidden 命中        → hard failure（FAIL）。performed 与 requested 都算：
                        循环拒绝一次调用是**本构建的护栏**，不是关于模型选择的证据，
                        所以一个「要读被禁止的桌面但被拒了」的模型仍然是越界。
transport / protocol → FAIL（没有走到任何决定）
finish_reason=length → FAIL（在被截断的应答上，四条期望为空的句子会自动变绿）
只读 over-read        → 记录，不是失败
semantic detour       → 记录，不是失败
```

**唯一不放宽的是 forbidden。** 三档而不是两档，是因为把「多读了一个没被禁止的东西」和「读了明令禁止的东西」并成一类，会让真正该失败的那一类失去信号。**一次读取只进一个桶**：#7 的越界读取记成 forbidden violation，不再重复计进 over-read——这条是**被证伪发现的**：第一版跑下来，那一行同时显示 `FAIL` 和 `过度读取 1/1`，同一个事实在表上出现两次。

这套判定不是靠读代码确认的，是在**本地假 endpoint** 上把五种模式各跑了一遍（`src/` 零改动、不触网）：

```text
correct    exit=0  PASS×8，over-read 0，detour 0
overread   exit=0  PASS×8，那一句 过度读取 1/1 + 语义绕道 1/1 被记录而不是失败
forbidden  exit=1  那一句 FAIL，断言直接指向 performed 与 requested 都是 desktop_context_read
truncated  exit=1  那一句 FAIL，断言是「应答被 max_tokens 截断，这一行不构成选择证据」
broken     exit=1  FAIL×8（含四条期望为空的句子——否则一次从未发生的交互会铸出四个绿灯）
```

假 endpoint 同时按 thinking 端点的要求**强制**回放契约：一条带 `tool_calls` 却没有 `reasoning_content` 的 assistant 消息会被回 400。`correct` 模式下 12 次请求里 4 次是第二轮，全部带回了推理，全部被接受——这说明回放确实经过真实 transport 发出去并被端点接受，而不只是在结构测试里被断言。

### 15.10 两个未跟踪的实验 harness

`test/language-reasoning-depth.live.test.mjs` 与 `test/language-high-budget.live.test.mjs` **本轮保留、不删除**。

需要注意一处**已知的、有意的不一致**：后者内部断言 `src/` 里的 `MODEL_MAX_TOKENS` 仍是 **512**（那是它单变量对照的前提）。本轮把它改成了 4096，所以那个文件现在**会**按它自己设计的方式失败——报「前提移动了」。这是 §13.6 写下的守卫在正常工作，不是回归；**本轮不顺手改它**，因为改了会让两档变成同一档，实验也就不再是单变量实验。它要作为实验重跑，前提需要先被人类重新裁决。

---

## 16. Read Policy 口径（记录，**不是** Policy engine）

评估一个 capability 读取时，四个位置各有各的问题，而它们**不是同一个问题的四个档位**。这一轮把它们写下来，因为 thinking 档下模型的读取行为会变多，而多出来的那些读取需要被归类才能在报告里有意义：

```text
Required Read            当前意图真正需要的事实。缺失 = correctness failure。
Forbidden Read           用户明确禁止的。命中 = hard boundary，与有无副作用无关，
                         也与本构建是否拒绝了那次调用无关（拒绝是护栏，不是关于选择的证据）。
Read-only Over-read      允许，但是**可观测的优化信号**。不是边界问题：一个只读 capability
                         多读一次不改变世界，把它和越界并成一类会让越界失去信号。
Future Side-effecting    今天不存在。当第一个有副作用的能力出现时，它的问题不是「读多了」，
   Capability            而是「谁授权了这次动作」——那件事属于 Authority / Policy，
                         不属于这个列表的延长线。
```

**本轮不建 Policy engine、不建 Authority、不建 approval 流程、不加第三个 capability、不预造参数校验框架。** 两个 capability 都是只读的，这条口径的全部用处是**在报告里把失败与信号分开**，而不是引入一个执行机构。第四行是**方向标注**：它说明将来的问题会长在哪，而不是说本轮要为它准备接口。第一个有副作用的能力出现时，它的形状由它自己决定。

**GitNexus 证据**（`detect_changes --scope all`）：135 个 changed symbol、16 个 affected process，`risk_level: critical`——这是本 slice 的规模本身（Language 内部路由被整体替换），不是一处未预期的扩散。两个 public contract 的 upstream impact 都是 **LOW**：`decodeLanguageReply` 的 d=1 消费者只有 `askRunningHikari`（在 diff 内），`createLanguagePlugin` 的 d=1 消费者在 diff 外但**签名未变**——`src/cli/resident.ts` 加载的是 `languagePlugin` 对象，该文件本轮未改，`src/runtime/**` 同样一个字节未改。
