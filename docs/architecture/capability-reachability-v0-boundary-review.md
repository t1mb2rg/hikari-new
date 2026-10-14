# 能力可达 ≠ 能力被想到 v0 — 边界评审

**工作标签，不占用阶段编号——不是 P4-04。**

触发是一个**已经发生过的真实问题**：`changeable-repositories-search-v0` 最后一轮真机验收里，模型手上有一个能直接回答那个问题的工具，它两次都没有去用（§1）。本片只回答一件事：**这是不是一个该在架构上处理的问题；如果是，最小的一步是什么。**

---

## 0. 结论先行

1. **能力是真的可达**：把搜索点名之后，一次命中答案那一行（§1.2）。
2. **两次没被想到**：同一句话问两次，模型读了三个相邻能力，两次都没有调用搜索（§1.1）。而且它**说了一句错的判词**——「我手上这几个工具没有任何一个会返回声明的存放位置」——搜索返回的正是「文件 + 行号 + 那一行」（§1.4）。
3. **处置顺序不是本片发明的，是仓库自己冻结的**。`test/language-semantic.live.test.mjs:66-71` 逐字写着：不加关键词表、不加域分支、**不往 system prompt 里放第二份 owner 描述的转述**；「若真模型误选，**第一件要检查的是 owner 自己的 `description` 是否不清楚，任何改动都进 owner 的文件**」；「若 owner 的描述清楚而模型仍按关键词路由，诚实的结论是**这个模型不适合这个循环的选择要求——而不是架构该围着它弯**」。
4. 按这个顺序走：§1.1 里模型**判错了覆盖范围**（它以为没有工具能回答），所以**描述对那类问句确实不清楚** → 第一步就是改描述（§4 B）。**C（往 prompt 加规则）与这份 mandate 方向相反**，本片因此不推荐它（§4 C）。
5. 改法有形状要求：新句子要说**「它答得了什么」**，不要说**「你什么时候该用它」**——前者是描述被点名的职责（`src/work-focus/exposure.ts:53`：*What the capability covers and, just as load-bearingly, what it does not.*），后者正是 `src/changeable-repositories/exposure.ts:12-14` 拒绝过的 *steered by*（§3）。
6. **一次只改一条**：只改**已被真机证明失败过的那一条**（`authorized_repositories_search`）；另外五条没有失败证据，按「只由真实问题驱动」留在边界里（§5.2）。

---

## 1. 证据

### 1.1 两次真机（用户侧，TUI，原句两次一字不差）

> 我 change declare 了一个仓库。这个声明被存在哪里？为什么常驻重启之后 `change status` 还认得它？请给出文件路径和记录的形状。

**16:09:47** — 「`G:\work\LAB\code\hikari-new`」一行 + 一段诚实分隔 + **明确拒答**：「我手上这几个工具没有任何一个会返回声明的存放位置……我不该拿这个反推出一个结构来。」

**16:17:40** — 同句再问，回答四行：`G:\work\LAB\code\hikari-new` / 「你当前还没有明确声明任何关注对象。」/「Repository CI relevance：unknown」/「未能在当前工作焦点与 Repository CI observation 之间建立逐字相等关系。」

三行都是**真读回来的**（可改仓库列表、`work-focus`、`repository-ci-relevance`），一句假话都没有；但三行答的都不是那个问题。**这一轮连上一轮那段「我不想编」的合成段都没有——零句合成，搜索依旧一次没调。**

### 1.2 点名之后，一次就命中

同一台机器、同一个常驻、同一个数据目录，只把能力点名：

```text
node dist/cli/main.js ask --data-dir C:\Users\29719\AppData\Local\Hikari\resident \
  "用 authorized_repositories_search 在已声明的仓库里搜字符串 changeable-repositories.declared，然后原样列出工具返回的每一行…"
```

返回 **9 条原样命中**，第 6 条正是答案所在：

```text
…\src\changeable-repositories\history.ts:29: const DECLARED = 'changeable-repositories.declared';
```

### 1.3 两条证据合起来

**可达 ✓、被想到 ✗。** 这正是 search 那片评审 §9.4 第 4 条早就写下的边界：那片**不承诺**它能回答 §1.1 那个问题，只承诺**模型能自己找到那个文件**。

顺带一条当日留下的直接证据——16:09 那一轮**只读了列表**：

> （这一轮是按上一轮读取的内容理解的：`authorized_repositories_list`，它记于 2026-10-14T08:09:47.184Z）

### 1.4 关键的一步：那次拒答里的判词是错的

「我手上这几个工具没有任何一个会返回声明的存放位置」——这句话**不成立**：`authorized_repositories_search` 返回的正是 `路径:行号: 那一行`（`src/changeable-repositories/read.ts:236-238`），而 §1.2 用它一次就落到了 `history.ts:29`。六条能力里**只有它**返回这种定位（`list` 只给目录路径，`read` 必须先知道路径）。

**所以这不是「模型不肯找」，是「它读到的描述没有让它知道这件工具覆盖这类问句」。** 这一句把 §0 第 3 条那个处置顺序的第一步落实了：**描述对这类问句不清楚**。

### 1.5 本片不改「找」的任何字面

`changeable-repositories-search-v0` 已按 R7.2 结案（§10.5，Human 已裁「就这样结」）。**本片不动它的 frame、不动它的上限、不动它的参数。** 若最终选 B，改的是 `changeable-repositories` 自己的**描述**，按 R7.2 另记：旧字面一字不改。

### 1.6 补记（同一晚 17:17:46）：它自己把「可改仓库」说成了路径驱动

那一轮答复的最后一句，是它自己加的：

> 如果你想让我去看别的（比如某个仓库里的东西），**告诉我具体要读哪个路径**就行

**这一轮没有人问仓库。** 它是在主动总结「我还能为你做什么」的时候，把可改仓库这件事**只剩下 `read` 的那一面**（给路径我就读）——而 `authorized_repositories_search` 恰恰是六条里唯一一条**不需要路径**的。前两次是「那个问句来了，它没想到这件工具」；这一次是**没有人问，它自己复述自己的能力时把那件工具漏掉了**。同一个缺口，更主动的一种露头。

### 1.7 同一晚还有另一种「对不上」，它不是本片的缺口

17:21:38 那个人问：**「你自己觉得你还想知道什么信息」**。17:21:45 的答复以**一页读回来的桌面对话观察**开头（字段与 17:17:46 同一组）。

这不是 §1.1 那件事。问句问的是「你还想要什么」，**没有任何一次读取能回答它**；但照这套循环今天的形状，读取一旦发生，回答就**只剩读回来的东西**：

- 提示词把模型这一轮的全部职责写成「**你现在只负责决定「还需要读什么」**」（`src/language/prompt.ts:193`）——而提问者那句话几乎就是它的词；
- 并且提前告诉它读取的后果：「**读回来的内容会被展示给这个人，就是这次回答的全部内容。**」（`src/language/prompt.ts:179-180`）；
- 读完之后再加自己的话，是被明说的反面（`src/language/prompt.ts:191`：「读回来的东西是什么就是什么，不要读完之后随手加一句你自己的理解。」）；
- 装配那一层也是这样：有读取时**回答由读取组成**（`src/language/answer.ts:345-348` 的注释逐字写着「the answer is assembled from the readings and not from the model」），模型自己那段只在很窄的条件下才被允许出现，且永远带着「不是读回来的内容」的标签（`src/language/answer.ts:374-389`）。

所以它并不是答错了问题——**是这套循环里没有一条路，能让模型在读完之后用自己的话回答一个不需要读取的问题**。「你是谁」（17:17:19）走的是另一条路：那一轮**它没有读**，于是纯聊天那条分支（`src/language/answer.ts:395-400`）把它的原话原样展示了。

**记在这里的原因是不让它丢**：这个「对不上」**不是**本片 §0 说的那个缺口，**B 也修不好它**（描述怎么写都一样——读取一旦发生，回答仍然是被读的东西）。它属于另一件事。

---

## 2. 模型今天看到的六条描述

### 2.1 名字与描述都是 owner 的原文，透传

`src/language/tools.ts:127-157` **一个字都不写**：`toModelTools` / `toModelTool` 把 owner 的 `name` 与 `description` 原样放进 wire shape，参数说明同样来自 owner 的声明（`:182`）。文件头把它写成纪律（`:8-9`）：

> …there is no description text in this file, because the description is the owner's and is passed through by reference…

工具数组唯一构造点 `src/language/answer.ts:298`；选择是**精确字符串相等**（`src/language/tools.ts:114-119`，测试 `test/language.test.mjs:783-797`）——**没有别名、没有关键词、没有预路由**。

### 2.2 六条描述，六条都只说「它返回什么」

今天能到达模型的能力**一共六条**，全部由 `src/language/exposure.ts:155-161`（base 5 条）与 `:174-181`（带 repository scope 时 6 条）决定：

| # | 工具名 | 描述出处 | 描述说的是什么 | 「什么问句该找它」 |
|---|---|---|---|---|
| 1 | `work_focus_read` | `src/work-focus/exposure.ts:67-71` | 「读取用户当前明确声明的工作焦点。结果只是用户明确声明过的那组 designation，不解释它们的含义，也不推断优先级、重要性，或者用户此刻实际正在做什么。」 | **无** |
| 2 | `desktop_context_read` | `src/desktop-session-awareness/exposure.ts:90-92` | 桌面会话观察与 awareness assessment；五句里四句在**否认四种引申**，一句在**否认它含窗口正文** | **无** |
| 3 | `repository_ci_relevance_read` | `src/repository-ci-relevance/exposure.ts:76-78` | 「Repository CI relevance 判定」；全篇是判定的语义边界与被否定的引申 | **无** |
| 4 | `authorized_repositories_list` | `src/changeable-repositories/exposure.ts:91-93` | 「列出用户明确声明为可改的代码仓库目录。结果只是那组目录本身，不解释为什么被声明，也不代表它们现在可以被动。」 | **无**（问题域最自明的一条，且复用了人类 CLI 的词 `change status`） |
| 5 | `authorized_repository_read` | `src/changeable-repositories/exposure.ts:98-100` | 「读取一个已授权仓库里的内容：给一个文件路径就返回它的文本，给一个目录路径就返回它直接包含的项…」 | **无**（说的是它接受什么输入） |
| 6 | `authorized_repositories_search` | `src/changeable-repositories/exposure.ts:109-111` | 「在已声明为可改的仓库目录里按内容找一段文字，返回出现它的文件、行号，以及那一行。原样匹配，区分大小写。」 | **无**（两句都在说它返回什么、怎么匹配） |

六条里 **0 条**给示例问句或触发场景；三个 owner 的文件头把 `examples`、`aliases`、`discovery keywords` **逐字记为刻意不加的字段**（`src/work-focus/exposure.ts:24-29`、`src/desktop-session-awareness/exposure.ts:45-47`、`src/repository-ci-relevance/exposure.ts:32-35`）。

### 2.3 于是模型要自己走完三步

它得自己接上：「我问的是一个字面/声明**在哪**」→「那是要在一堆文件里**找一段文字**」→「所以该用搜索」。**这三步里的前两步，今天任何一句被写下来的话都没有替它走过。**

对照：这个能力**已经**被选中过一次，而那一句问的是——

> 这个仓库里哪个地方提到了 Work Focus？（`test/language-semantic.live.test.mjs:385-390`，`why`：「问的是『哪些地方』，只有按内容找的那个能力答得了」）

也就是说：**让模型选中它的，是问句里出现了「哪些地方 / 提到」这类内容检索词**；§1.1 那句用的是「存在哪里 / 为什么重启还认得」这类**溯源词**。差别不在句子长短，在于没有一处把溯源问句和这个能力接起来。

### 2.4 描述之外的规则也没有这一句

`src/language/prompt.ts:170-196` 是模型拿到的全部规则，与「读不读」有关的四句是：

- 「你可以调用下面列出的工具去读取 Hikari 已经掌握的东西。」（`:174`）
- 「关于这台机器和你面前的这个人，你自己什么都不知道，也看不到任何东西。唯一能让 Hikari 了解现实的途径，就是你去读它。」（`:176-177`）
- 「- 如果为了诚实回答这句话，必须去读 Hikari 现在观察到的东西，就调用工具去读。」（`:179-180`）
- 「- 如果这个人不是在问 Hikari 知道的事情（打招呼、随口聊两句、说一句自己的感受），就直接用自然语言回话，什么也不用读。这是允许的，也是应该的。」（`:181-182`）

四句都在说**要不要读**，没有一句说**读哪件**。

---

## 3. 为什么是这样：六处写下来的拒绝，以及其中真正被拒绝的东西

**R-1 · consumer 不得用自己的话重述 owner 的描述。**
`src/language/exposure.ts:7-12`：*a consumer that restated an owner's description in its own words would be a second thing deciding what another domain's capability covers.*
同一件事在 provider 侧写着（`src/work-focus/exposure.ts:10-16`）：名字与描述是关于**这个域意味着什么**的断言，按 `principles.md` §6 归 provider；*A consumer that wrote these words instead would be a second thing deciding what this domain's capability is called, and the day the two disagree the disagreeing is invisible, because a description is prose and prose has no compiler.*

**R-2 · 描述不是写给模型「被引导」用的。**
`src/changeable-repositories/exposure.ts:12-14`：*the descriptions are not written for a model to be steered by. They say what the capability returns and, in the first one, what it does not claim.*

**R-3 · 刻意不加的是「字段」。**
`src/work-focus/exposure.ts:24-29` 逐字列出：*an input schema, an output schema, an authority classification, a side-effect class, tags, categories, cost, model hints, examples, aliases and discovery keywords*；理由是 *the field added for a caller that does not exist yet is precisely the "maybe somebody will want it" that the Contract Creation Gate §16 refuses.* 同形的清单还在 `src/desktop-session-awareness/exposure.ts:45-47` 与 `src/repository-ci-relevance/exposure.ts:32-35`。

**R-4 · prompt 里不出现能力名、不出现域名。**
`src/language/prompt.ts:144-153`，记的是一次**真实的删除**：早稿在一个括号里举了两个域作例子，*and it had to go: those are the owners' own descriptions translated into this file's words, and a translation is a second statement of what another domain's capability covers…*

**R-5 · 不做话题路由，也不做关键词表。**
`src/language/exposure.ts:90-97`：topic router（`LANGUAGE_TOPICS`）被删，理由是那会是 *two routers in a row*。同一条在治理 mandate 里再写了一遍：`test/language-semantic.live.test.mjs:66-67`——**不加关键词表、不加域分支、不往 system prompt 放第二份 owner 描述的转述**。

**R-6 · 选择判据是「必要性」，不是「句子里出现了哪个域的词」。**
`test/language-semantic.live.test.mjs:57-58` 逐字：*The model selects a capability according to whether reading it is necessary in order to answer the current user intent honestly — not according to which domain words the sentence contains.*

### 3.1 六处放一起，缺口的位置就出来了

被拒绝的是：**结构化字段**（R-3、R-5）、**consumer 转述 owner 的话**（R-1、R-4）、**路由与关键词表**（R-5）、**把描述当指令写**（R-2）、**按域词匹配**（R-6）。

**没有一处拒绝**「owner 用自己域的语言，把它覆盖的范围写成一类**它能回答的问句**」——而描述自己的职责，`src/work-focus/exposure.ts:53` 写的就是 *What the capability covers and, just as load-bearingly, what it does not.*

**所以缺口是一句很窄的话：`capability 描述里的「覆盖」今天只写返回物，没写它覆盖哪一类问句。` 这句话的 owner 是域自己（R-1 明确），不是语言侧。**

### 3.2 治理 mandate 给的处置顺序（本片的顺序依据）

`test/language-semantic.live.test.mjs:66-71`：

> What this file deliberately does not do, per the governing mandate: it does not add a keyword table, a domain-specific branch, or a second paraphrase of an owner's description to the system prompt. If a real model mis-selects, the first thing to check is whether the owning plugin's own `description` is unclear, and any change goes in that owner's file. If the owner's description is clear and a model still routes on keywords, the honest conclusion is that the model is unsuitable for this loop's selection requirement — not that the architecture should be bent around it.

按它走：**先判「描述是不是不清楚」**。§1.4 已经回答了——模型对覆盖范围的判词是错的，所以**不清楚**，第一步就是 owner 自己的文件。

### 3.3 五层链里没有这一层

`docs/architecture/principles.md` §5 把「能力可用」拆成五层：**系统是否拥有某项能力 → 当前 Scope 是否能访问 → 某个行为循环是否能消费 → 模型是否能看到 → 本次动作是否被允许执行**（`:207-227`），并逐字给出 `> Capability existence ≠ Exposure ≠ Authorization ≠ Execution.`（`:225`）与「这几个层次不得合并成一个布尔开关」（`:227`）。

**这五层里没有「模型是否会想到」这一层。** 所以本片处理的东西既不是往那条链上加第六层，也不是在修它——它在那条链**之外**，位置是「模型看得到」之后、模型自己那一步的选择。记下这一点的用处是：**无论本片选 A 还是选 B，那条冻结链一个字都不用动**。

---

## 4. 三条路与各自的代价

### A. 不动，把它记成一条边界

把「可达 ≠ 被想到」写成整机的一条已知限制（体例照 `docs/architecture/operator-tui-v0-implementation-boundary-freeze.md` §5.6 那些「登记它没盖住的那一半」的条目）。

- 代价：零改动、零风险；诚实，给以后留路牌。
- 代价的另一半：这个真实问题**不被处理**，用户下次问同类问题还会得到一句「我手上没有这样的工具」。
- 它与 §9.4 第 4 条不冲突：那条说的是一片**承诺范围**，A 说的是**整机的一条边界**。

### B（推荐）· owner 把「覆盖」写成「它答得了哪一类问句」

只改 `authorized_repositories_search` 一条描述，在现有两句之后加一句**关于覆盖**的话——**逐字待 Human 冻结**，形状如：

> 它给出的是位置（文件与行号）：某个名字、常量或声明写在哪个文件哪一行，同样用它。

- **改的是 owner 对自己的描述**，不转述任何别人的域 → 不越过 R-1。
- **它是「覆盖」不是「使用建议」**：说的是「这类问句它答得了」，与 `src/work-focus/exposure.ts:53` 给描述定的职责同形 → 不越过 R-2。
- **不新增字段、不加 `examples` / `aliases` / `discovery keywords`、不建表** → 不越过 R-3、R-5。
- **不用「当用户说…」这种句式**：它说的仍是「它答得了什么」，选择判据仍在模型手里（R-6）→ 不越过 R-6。
- 与仓库自己的处置顺序一致（§3.2）。
- 代价：改的是一个域的**公开描述**（模型与人都读得到），必须由 Human 冻结新字面并按 R7.2 另记一节（旧字面一字不改）；描述永久长一句。
- **这不是第一次改一条 description，形状已经有人走过**：`docs/architecture/desktop-context-understanding-g1-narrow-design.md:346-358` 收窄过 `desktopContextReadExposure.description`——**增补第五句**、在文件头补一段说明「第五句与前四句不是同一类」、并在 `test/desktop-session-awareness.test.mjs` 的同一条测试里加对应断言，沿用该测试已有的理由：*一条覆盖「caveat 还在不在」的断言，会让另外任意几条被删掉而测试仍然通过*。若走 B，**照这个形状做**（含那条测试断言）。
- 同一片的授权评审另有一条安全条款（`docs/architecture/desktop-context-understanding-g1-authorization-boundary-review.md:340`）：**正文不能进工具的 `description`**——描述是 owner 的固定字符串，任何环境文本进入它就是注入。B 加的那一句必须是常量，与运行时的任何内容无关。

### C（不推荐）· prompt 里加一条程序性规则

例如「如果你判断『没有任何工具能回答这个问题』，而这句话问的是一件具体的东西被谁记下来、存在哪里、由哪段东西产生，先在能读的东西里试一次，再回这句判断。」

- 字面上它不点名能力、不点名域；**但治理 mandate 逐字反对往 system prompt 加东西来解决选错**（§3.2），并给了替代结论：「若 owner 的描述清楚而模型仍按关键词路由，诚实的结论是这个模型不适合这个循环的选择要求——而不是架构该围着它弯。」
- 它还**改不了描述不清楚这个事实**：下一次别的问句、下一个模型，仍只能靠这条程序兜着。
- 有失败先例：`docs/architecture/language-grounded-synthesis-v0-boundary-review.md:516`——*prompt 改写无可测效果。matched A/B：改前的 standing prompt 12/12 收尾轮有字，改后的 conditional prompt 9/9 有字……那次改动因此撤销*。
- 需要说明一处**看起来像禁令其实不是**的东西：`src/language/prompt.ts` 在好几片的「不改的」清单里出现过（`changeable-repositories-read-v0-implementation-boundary-freeze.md:156`、`changeable-repositories-search-v0-boundary-review.md:137,470,578`）——那写的是**那几片自己不动它**，不是「prompt 永不可改」。它不可改的理由在 R-4 与 mandate 里，不在那些清单里。

### D. 不采用

- **能力索引 / 话题表 / 逐话题提示 / 关键词**：R-5 与 mandate 逐字拒绝。
- **靠历史**（把「上一轮有人用过 `authorized_repositories_search`」摆到模型面前当理由）：把可达性建立在一段偶然的历史上，而且那是在解释别人的能力。
- **别名字段 / 关键词字段**：R-3 逐字拒绝过。
- **让 consumer 写一句「问 X 就用 Y」**：R-1、R-4 逐字拒绝过。

---

## 5. 建议

**做 B，且一次只改一条；A 与之并行（改完仍然把「模型可能想不到」留在边界里）；C 不做。**

### 5.1 为什么是 B

1. 治理 mandate 的处置顺序就指向描述（§3.2），而 §1.4 已经证明描述不清楚。
2. 缺口的位置在描述里（§3.1）：描述说它覆盖什么，今天只写了返回物。
3. B 不推翻任何一条既有取向（§4 B 的五条逐条对照）。
4. B 不需要 prompt 改动，也就不碰 R-4 与那份先例。

### 5.2 为什么一次只改一条

真机失败**只被证明过一次**，就是 §1.1（搜索）。另外五条没有失败证据；`work_focus_read` 之所以在验收里被选中，是因为那些句子**恰好复用**了它描述里的用词（「明确关注 / 明确声明」）——那是脆弱的，但**不是失败**。按「只由真实问题驱动」，**只改有证据的那一条**，其余留在 A 的边界里。

### 5.3 验收必须是 matched A/B（先例已给）

> `docs/architecture/language-grounded-synthesis-v0-boundary-review.md:516`：**prompt 改写无可测效果。** matched A/B：改前的 standing prompt 12/12 收尾轮有字，改后的 conditional prompt 9/9 有字——两者的闸门都是 100% 打开。**那次改动因此撤销**（`src/language/prompt.ts` 已回到 HEAD）。

1. **基线就是 §1.1 的两次**（同一句话、同一台机器、同一数据目录，两次都没搜）。
2. 改完之后用同一句话问**多轮**，看它**是否调用 `authorized_repositories_search`**（这在真机的交付帧里看得见，§1.1 的括注就是证据），不是只看答复像不像。
3. 若多轮仍一次不调，**按 mandate 的第三句走**：那是「描述清楚而模型仍不选」的情形，结论是**这个模型不适合该选择要求**，届时如实记下，并且**不改架构**。
4. 那条已知可用的对照句（「这个仓库里哪个地方提到了 Work Focus？」）**必须仍然通过**——改描述不能把已经成立的那一类问句弄坏。
5. 领域测试与 semantic live 表的**期望集合不改**（本片不加验收句）；要动的只是 `src/changeable-repositories/exposure.ts` 的那一条字面。

### 5.4 若选 B：冻结面清单

| 项 | 内容 |
| --- | --- |
| **owner** | `changeable-repositories`（描述是它的公开物；语言侧一个字不改） |
| **public surface** | 一条 `description` 文本。不加工具、不加参数、不改 `provides`、不改 frame、不改上限 |
| **lifecycle / state / durability** | 全无。描述是常量，不落盘任何东西 |
| **失败语义** | 无失败路径；最坏是**没有效果**，而这不是假设（§5.3 有先例、mandate 有第三句） |
| **明确不做什么** | 见 §6；尤其：不加字段、不加别名、不建表、不用「当用户说…」句式、不点别的域的名字 |

---

## 6. 这一片明确不做什么

- 不改 `src/language/exposure.ts` 的任何成员与顺序（三条冻结理由继续有效）。
- 不改 `src/work-focus/` / `src/desktop-session-awareness/` / `src/repository-ci-relevance/` 的任何字面（没有失败证据）。
- 不改 `src/language/prompt.ts`（R-4 与 mandate）。
- 不新增路由、索引、话题表、别名、关键词字段。
- 不做「按问题类型自动选工具」。
- 不改搜索的机制、上限、frame（§1.5）。
- 不承诺模型一定会想到——本片最多让**那一条**描述把「它覆盖哪类问句」说清楚。
- 不处理 §1.7 那种「对不上」（问句不需要读取，回答仍然变成读取）：那是另一道缝（`src/language/prompt.ts:179-180`、`:191`、`:193` 与 `src/language/answer.ts:345-348`、`:374-389`），**改描述修不了它**。
- 不顺手修已过期的文档数字（`docs/architecture/hikari-current.md:458` 的「今天三个工具」等；它们**已经被 search 那片记在案**）。

---

## 7. 需要 Human 裁决的

1. **选哪条路**：A（只记边界）/ **B（改那条描述，推荐）** / C（加 prompt 规则，本片不推荐）/ 先 A 再议。
2. **若选 B**：那句新描述的**逐字**（旧字面一字不改，按 R7.2 另记一节）。审阅时应当能回答：这句说的是**覆盖**还是**使用建议**？有没有出现「当用户说…」这类句式？有没有变成一个字段或一张表？有没有点别的域的名字？

---

## 8. 触发与依据

- 触发：`changeable-repositories-search-v0` 的真机一次（§1）；Human 于 2026-10-14 选择「开一小片，先只评审」。
- 依据：`docs/development/judgement-reachability-v0.md` 已经做过同向的一步（把既有的相关判断接进模型可达范围），本片处理的是它的**下一格**——能力在可达范围里，但模型没想到去用它。
- 纪律：`docs/architecture/principles.md`、`docs/architecture/core-architecture-v0.md` §13（只由真实问题驱动）、`test/language-semantic.live.test.mjs:54-71`（选择判据与处置顺序的 mandate）；**模型是 Plugin 的实现材料，不是 Hikari 架构层**。
- 顺带记下、不在本片范围内的一件事：六条能力里唯一**没有**语义验收覆盖的是 `repository_ci_relevance_read`（三份 live 测试都只写 base 五条名字），而它恰好是描述最空的一条。
