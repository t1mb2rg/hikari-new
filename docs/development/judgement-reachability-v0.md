# Judgement Reachability v0

> **工作标签，不占用任何阶段编号。** 它不是 P4-04，也不是 P4-03 的一部分。它是 P4-03 收口之后的一次
> 独立 slice，处理的是一个此前没有出现过的问题：**当一个 provider 已经存在、而它的判定此前只有人能读到
> 时，组合要不要把它接进模型的可达范围。**

本轮的立项依据是 `JUDGEMENT REACHABILITY v0 Boundary Review`，Human ruling：

```text
VERDICT = NARROW → AUTHORIZED FOR IMPLEMENTATION
```

NARROW 的含义是本轮**只**做一件事——把已有的 relevance 判定接到模型可达范围内——**不是**借此机会扩展
判定本身、扩展能力体系、或给 Runtime 增加任何机制。

---

## 0. 本轮回答的问题

`repository-ci-relevance` 从 Repository CI Relevance v1 起就有一个判定：某个 work-focus designation 与
被观察到的 repository 是否**逐字相等**。那个判定此前只有一条出口——本地端点，由 `hikari relevance` 这个
CLI 客户端提问，人读。

于是出现了 Hikari 的第一种形状的问题：

> **一个判定已经存在、已经真实可用、已经有人读——但读它的人只能是 `ask` 之外的另一个命令。**

这不是「能力不存在」，也不是「能力没被暴露」。它存在、也暴露（有端点）。缺的是**模型能不能在一次提问里
读到它**。本轮把这条路接上，并且**只**接这一条。

---

## 1. 组合顺序：放弃嵌套，保留前缀

Language 在「repository scope + model」这个组合里必须排在 CI 链**之后**，因为它新依赖的
`repository-ci-relevance.current@1` 由链的最后一个成员提供，而 Runtime 对未满足的 requirement 的记录
是 `waiting`，一个 `waiting` 成员会让常驻拒绝启动——所以排在前面不是不整洁，是起不来。

这带来一个**刻意放弃的不变量**。旧顺序把 Language 直接放在 base 之后、链放在最后，四个 roster 因此是
**嵌套**的：每一个都是下一个更大 roster 的字面前缀。新顺序下这条不再成立——`base + language` **不是**
`base + chain + language` 的前缀。

**但被放弃的只是嵌套，不是前缀本身。** 默认九个成员仍然是四个组合**共同**的字面前缀，共有成员在每个
roster 里的相对顺序不变。这两条由 `test/resident-cli.test.mjs` 的同一条测试钉住。把「嵌套没了」读成
「前缀也没了」是这一节最容易出错的地方，所以写在最前面。

**Runtime 一个字节不改。** 排序本来就是 `src/cli/resident.ts` 的职责，不是 Runtime 的：Runtime 只回答
「这个插件的 requirement 满足了没有」，不回答「你该按什么顺序加载」。本轮没有为此给 Runtime 增加
optional requirement、没有引入 service locator、没有 capability registry、没有动态发现，也没有通用
optional-plugin 框架。这条不是自我评价，是一条可执行事实：`git diff --stat -- src/runtime/` 为空。

---

## 2. Service：一次 Contract Gate 的重新裁决，而不是豁免

`repository-ci-relevance` 此前 `provides: []`，理由写在当时的注释里：它真实的 reader 是 CLI，经本地端点
提问，为它发布 contract 等于**为零个人发布**。

本轮第一次出现了真实的 callable need：repository-aware Language variant 在读
`repository_ci_relevance_read` 时会**主动调用**它。于是 `repository-ci-relevance.current@1` 被提供。

这里需要精确区分两段，因为它们很容易被读成同一段：

- **§16.2**「谁需要**主动调用**这个 capability？**若不存在真实的 callable need，默认不创建 Service。**」
  ——**这一段没有被动过**，被满足的正是它。
- **§16.1** 放宽的是读法：真实交互语义**不要求已经存在具体的 Consumer implementation**。
  ——它管的是「对面有没有人站着」，不是「要不要建 contract」。

`src/repository-ci-relevance/contracts.ts` 与 `plugin.ts` 的注释逐字记录了这个区分。

contract 是**最小**的：`current()` 返回既有的 `RepositoryCiRelevanceJudgement`。它**不**暴露 world
snapshot、**不**暴露 designation 集合、**不**暴露 awareness 内部、**不**细分 `unknown` 的成因、**不**缓存、
**不**产生第二份判定。

**Service 与 exposure 在同一 slice 落地。** 单独一个 Service 不构成本次批准——本轮两者同时存在，因为
board 上第一次同时出现了「可以被调用」和「有东西要调用它」两件事。

**同一条实现路径**，这是本轮唯一真正的结构性要求：Service 与端点不是两份代码，是一个 `judge` 闭包同时
喂两边。任何一份单独的判定逻辑都会让两边在未来某一天给出不同答案。

---

## 3. 两个 Language variant

```text
base Language               work-focus.current@1, desktop-session-awareness.peek@1         2 exposures
repository-aware Language   上面两个 + repository-ci-relevance.current@1                    3 exposures
```

- `LANGUAGE_EXPOSURES`（2）与 `LANGUAGE_REPOSITORY_EXPOSURES`（3）是**两份写出来的字面清单**，不是
  master table + filter，不是 registry，不是发现。两份之间**允许少量重复**，且**刻意不做 DRY 抽象**。
- **base Language 不依赖 Repository CI。** 没有 repository scope 时，`LANGUAGE_EXPOSURES` 逐字未变，
  提供它的插件也逐字未变——同样的 id、同样的 version、同样的两个 requires、同样的两个 exposure。
  「有没有 repository scope」因此是**组合决定的事**，不是这个插件自己评估的条件。
- **是 Language consumer 决定自己的一套能力，不是 provider 决定 consumer。** 组合只负责**选哪个
  variant**；provider 不知道 consumer 是谁，也没有把任何 tool 注册进 Language。
- 依赖是**硬的**。Runtime 没有 optional requirement（`#requirementsSatisfied` 是一个 `every`），所以
  repository-aware Language 在缺少 relevance Service 的组合里停在 `waiting`，常驻拒绝启动。**fail-closed
  是 v0 的语义，不是疏忽**：另一条路要加 optional-require 机制 / service locator / capability registry /
  动态发现 / 通用 optional-plugin 框架——五件本轮明确不允许增加的东西，而问题并不需要它们。

---

## 4. 三件必须记录的未来 guard

### 4.1 具名 variant 只对「base + repository-aware Language」这一种情形批准

**这是本轮的立项条件，不是本轮的经验总结。** base 与 repository-aware 之间只差**一个**独立可选的 domain
capability。第二个这样的 capability 会让 variant 变成四个，第三个变成八个，而
`CalendarLanguage` / `MailLanguage` / `RepositoryCalendarLanguage` 就是它们到达时的形状。

**因此：** 如果将来出现**第二类**独立可选的 domain capability，答案**不是**在这里加第三份字面清单，
**也不是**加第三个具名工厂——而是做一次 **Composition Boundary Review**，重新审查「能力可达性是否应当在
组合时决定」这件事本身。

这条 guard 落在源码里（`src/language/exposure.ts` 与 `src/language/plugin.ts` 的文件头），本节是它在
文档侧的落点。**放在文档里是因为它不是一句注释，是一个触发条件**：它规定的是下次遇到同类问题时的动作，
而不是本轮代码的性质。

### 4.2 Grounded presentation 没有被重新打开

成功的 grounded read 得到的是**确定性的 grounded 回答**。本轮**没有**把 renderer 自然化、**没有**加人格、
**没有**让 Domain 生成对话体散文、**没有**让 Language 重新解释判定。第三个 capability 与前两个走**同一
条** grounded 路径，因为它本来就是同一件事。

### 4.3 不重新引入的结构

本轮确认这些没有出现：Runtime optional dependency、Service locator、capability registry、tool registry、
dynamic plugin discovery、generic profile system、Central Judgement、Global Brain、Memory、Chronicle
writer、confidence 抽象、新的 perception、Grounded LLM Expression、domain 对话体散文。

`Provider 不决定 Consumer` 这条有一条**正向**断言钉住：provider 可以在**没有任何 consumer** 的组合里
`active`。

---

## 5. Roster 事实

```text
base                              9
base + language                  10
base + chain                     14
base + chain + language          15   ← 本轮新增，语言成员是 repository-aware variant
```

「九个」仍然不是架构不变量，而是默认组合这一条可执行事实。本轮把合法组合从两条变成四条，**没有**在任何
地方写死成员数——四条各自被单独钉住，外加一条四个 roster 的公共前缀与相对顺序断言。

「四个 roster 共享同一个基础前缀、共有成员保持相对顺序」是本轮**唯一**被允许的跨 roster 不变量的完整
陈述。比它强的（嵌套）已被放弃，比它弱的（成员数相等）从来不成立。

---

## 6. Boundary Review A–K 的机械证明

本轮要求 A–K 十条**被机械证明**，不是被叙述。逐条对应：

| | 主张 | 落点 |
| --- | --- | --- |
| A | provider 存在**不**让 base Language 长出第三个能力 | `test/language.test.mjs` `provider 的存在不会让 base Language 自动多出第三个能力`（清单那一半）+ `variant 递给答案器的，就是它自己那一份字面清单`（**接线那一半**） |
| B | base Language 的 requires 仍只有原来那两个 | `Language 的 requires 恰好是冻结的那两个，provides 为空` |
| C | repository-aware 的 requires 是那两个 + relevance Service | `repository-aware Language 的 requires 是 base 那两个加上 relevance Service` |
| D | Service 缺席时 `waiting`，到达后 `active` | `relevance Service 缺席时…停在 waiting，不降级启动` + `relevance Service 到达后，repository-aware Language 才 active` |
| E | provider 可以没有 consumer 而 `active` | `relevance provider 可以没有 consumer 而 active，Service 也真的可被调用` |
| F | exposure 的读取结果与 owner 的 `renderJudgement` 逐字相同 | `repository exposure 的读取结果与 owner 的 renderJudgement 逐字相同`（含一个**需要转义**的判定：owner 的渲染，经 `oneLine` 之后逐字相同——见 §7.2） |
| G | Language 不重算 relevance | `relevance Service 只被读一次，Language 不重新算一遍判定` |
| H | 两份清单是显式冻结集合，不是 registry/discovery | `两个 exposure 列表都是显式冻结的字面量…` + `语言包只导出这两个 exposure 列表` |
| I | 四个 resident roster 用新的真实顺序断言 | `test/resident-cli.test.mjs` 的四条 roster 测试 + `四个 roster 共享同一个基础前缀…` |
| J | `REPLY_TIMEOUT_MS` 上界**按最长 exposure set 推导**并测试 | `src/cli/ask.ts` 的 `Math.max(...)` 推导 + `CLI 的等待上界高于 loop 合法能花掉的时间`——含一条**等式**断言：上界 == `(最长清单长度 + 1) * MODEL_TIMEOUT_MS + READ_AND_FRAMING_BUDGET_MS`，清单与预算都从源文件读（见 §7.3） |
| K | 既有 tool-use / thinking / `reasoning_content` 测试保持绿 | 整个 `test/language.test.mjs` |

**A 与 B 是两条不同的主张**，容易混为一条：A 说「provider 在不在场不影响 base 的能力数」，B 说「base
声明的东西没变」。一条 provider 存在、另一条 base 自己的形状——两条都红过才算钉住。

---

## 7. 四处覆盖缺口，本轮补上

四处都不是「再加几条测试」，而是**同一类问题**：一条主张有一个强读法和一个弱读法，被测到的是弱读法。
四条都是在本轮自检里被找出来的，不是实现时就知道的。

### 7.1 一个此前没有的 forbidden-structure 扫描

`src/language/**` 此前**没有** slice 局部的 forbidden-structure 扫描。`src/` 全量扫描（在
`test/resident-cli.test.mjs`）覆盖了新文件的一部分，但它的模式里**没有** `ServiceLocator`、tool registry
与 discovery——而这三类正是本轮 ruling 点名要确认缺席、且明确禁止增加的。

`src/language/plugin.ts` 的文件头用散文声称「它不是 brain、planner、action orchestrator、tool registry、
capability registry、global context、memory、model router、reasoning service」。本轮把这句话变成一条可
执行的断言（`语言包没有把不存在的通用机制引进来`），并按仓库既有约定**只命名「若要引入就必须新造」的
复合标识符，不写裸名词**——因为这个模块自己的注释会用大白话否定这些词（「no Memory, no Chronicle」、
「Why this is not Memory」），模式里写裸名词会在否定它们的句子上变红。

### 7.2 F 的精确主张：不是「逐字相同」，是「差且只差一层转义」

`read.ts` 的文件头一度写着 reading 与 owner 的渲染「byte for byte」相同。**这句话是错的**，而且错得刚好
在能被利用的方向上：这个文件对**每一条**分支都套了一次 `lineSafe`（也就是 `oneLine`），因为把原始字节
交给任何打印它们的人，就是交给那个人伪造一行的能力——模型读到两行而 owner 只写了一行时，它分不出哪一行
是 Hikari 说的。`renderAssessment` 自己已经做了转义，所以桌面那一支上是空操作；relevance 端点的调用者
**原样**打印它的行，所以同一个渲染的两个读者之间**恰好差这一层转义，别的什么也不差**。

测试因此也按这个精确主张写：fixture 里放一个**需要转义**的判定（designation 里带换行，并伪造一行
`Repository CI relevance：unknown`），断言的是 `renderJudgement(judgement).map(oneLine)`——而不是
`renderJudgement(judgement)`。一个用后者写的断言会在修好这个文件的那一天变红，而它证明的东西是错的。

### 7.3 A、C、J 三条曾在 CI 上不可证

`src/language/plugin.ts` 的 `setup` 在非 win32 上**先抛**（平台门），而 CI 跑 `ubuntu-latest`。因此任何
**只有 `setup` 能观察到**的接线，在 CI 上从来没有被检查过——包括「base variant 递给答案器的是它自己那
一份清单」和「repository variant 递给答案器的是能读第三个能力的那个 reader」。这两条是 A 与 C 里**真正
有内容的那一半**；清单那一半早就有测试，接线那一半当时只有本机在跑。

修法不是加断言，是**让被断言的东西在 CI 上也存在**：两个 variant 从 `buildLanguagePlugin` 的实参提升为
导出的 `baseLanguageVariant` / `repositoryLanguageVariant`，测试读的就是工厂真正递给
`buildLanguagePlugin` 的那两个对象。一个「测试自己写一份配对表」的修法不解决问题——那份表会和自己一致。
现在改接线就是改测试读到的东西。

J 的问题是同一种：原来只断言上界**高于**最低要求，而一个按**最短**清单定的上界同样高于它。改成断言
`REPLY_TIMEOUT_MS` **等于**按最长清单推导出来的值，并且清单长度与预算都从源文件读。

### 7.4 拒绝语的清单当时没有任何断言承载

`express.ts` 的 `unclassifiedLines(exposures)` 是本轮**签名改动的全部行为收益**：一位人类读到的拒绝语，应当
列出**他所在 variant** 的能力。它此前一个断言也没有——`grep '这个构建能读的是'` 在整个 `test/` 里零命中。

真正让这一条必须现在修的，是一条**说了断言没有的事**的注释。它写着「拒绝语列出的能力是这一 variant 的事
实」，紧挨着的断言却是 `base.models[0].requests[0].tools.length`——**模型被给的 tools**，不是**人类被读到的
拒绝语**。这是两类不同的表面，而注释把其中一类算成了另一类的证据。

缺口是实测出来的，不是读出来的：把 `answer.ts` 两处实参都改回 `LANGUAGE_EXPOSURES`（也就是让
repository-aware 居民的拒绝语少列第三个能力，正是那条注释声称在防的事），**`npm test` 全绿 568/564/0/4**。

补法是就地加一条**离线**断言（`拒绝语告诉人类它能读哪些能力，而那份清单同样是 variant 的事实`），它
`createAnswerer` 直接注入依赖，不经过命名管道，所以在 CI 上真的会跑。它覆盖**两处**调用点——「模型要了一个
这个构建不会执行的能力」与「第一轮什么都没有」——因为两处是同一份接线，只钉一处会让另一处被改坏而全绿。
断言的右端读的是 variant 自己的导出清单，不是本文件再写一遍的描述：写一遍的断言会和自己一致。
补上之后，同一个变异**只让这一条**变红。

---

## 8. 测试事实

本机（Windows 11，win32）：

```text
569 tests / 565 pass / 0 fail / 4 skipped
```

四条被跳过的是三处环境门控的 live 语义 harness 与一条 POSIX `SIGTERM` 用例（「Windows 不投递 POSIX
信号」）。**命名管道的用例在本机是真实执行的**，不是被跳过的——这一条重要，因为 ruling 八 的若干条只有
在 win32 上才有意义。

CI 跑在 `ubuntu-latest` 上，那里依赖命名管道的用例被跳过，因此**本机与 CI 的绿色证明的是不同的事实**，
两者不互相替代。这正是 §7.3 存在的理由。

### 8.1 断言自身的变异验证

一条测试是否真的约束行为，从外面看不出来。本轮对八条关键断言各做一次定向变异——改掉生产代码里**正是
这条断言声称在管**的那一处，看它会不会变红：

| 变异 | 目标 | 真正变红的测试 |
| --- | --- | --- |
| reader 改用自己写的格式，不再调 owner 的 `renderJudgement` | F | `repository exposure 的读取结果与 owner 的 renderJudgement 逐字相同` 等 4 条 |
| base variant 改用三个能力的清单 | A | `variant 递给答案器的，就是它自己那一份字面清单` 等 3 条 |
| repository variant 的 requires 去掉 relevance Service | C | `repository-aware Language 的 requires 是 base 那两个加上 relevance Service` 等 5 条 |
| repository variant 的 reader 换成 base reader | F2 | `第三个能力只有 repository variant 读得了，base variant 读不了` 等 2 条 |
| 客户端按**最短**的 exposure 清单定尺寸 | J | `CLI 的等待上界高于 loop 合法能花掉的时间` |
| relevance 既不在 `provides` 声明也不注册 Service | 新加的 `provides` 断言 | `relevance 声明自己提供这个 Service，且不要求任何 consumer` 等 2 条 |
| reader 不再把 owner 的渲染转成 line-safe | F | `repository exposure 的读取结果与 owner 的 renderJudgement 逐字相同` |
| 组合在 repository + model 分支里改回 base variant | I | `四个 roster 共享同一个基础前缀，且共有成员保持相对顺序` |
| 两处拒绝语都改用 base 清单（§7.4） | express.ts 的 variant 参数化 | `拒绝语告诉人类它能读哪些能力，而那份清单同样是 variant 的事实` |

九条全部变红，且每一条的**目标断言都在变红的名单里**——不是「套件里某处红了」。第九条是本轮补完 §7.4
之后才加的，补之前它在全量套件下**是绿的**。

**变异验证本身也过一次变异，因为它第一版是错的。** 前两轮用 TAP 输出里「有没有出现这条测试的名字」判断
「是不是这条测试抓住的」，而 TAP 对**通过**的测试同样打印 `ok N - name`——那个判据对套件里的任何一条测试
都成立，所以它给出的「是」是白给的，RED 是真的、「谁抓住的」是假的。第三轮改成只取 `not ok` 行并列出真正
变红的测试名，上表的最后一列就是这样来的。

### 真实模型端点的语义验证：**NOT RUN**

**这台机器无法访问真实模型端点。** 因此「模型在真实 endpoint 上会按必要性与否而不是领域词来选择能力」
这件事在本轮**没有被执行**，它**不是 PASS，也不是 FAIL，是 NOT RUN**。

已经做过并且**可以**断言的是另一件事：local harness 的判定逻辑在本轮改动之后仍然有效且非平凡。用一个
五模式的本地假 endpoint 驱动 `test/language-semantic.live.test.mjs`，得到：

```text
correct    -> exit 0
forbidden  -> exit 1   命中「读取或要求了明确被禁止的 capability」
unknown    -> exit 1   命中「必须读到的没有读到」
truncated  -> exit 1   命中 finish_reason=length 守卫
error      -> exit 1   命中「模型没有答上来，这一行不构成选择证据」
```

五种模式命中**五条不同的断言**，不是同一个偶发崩溃。这张表在**最终树**上重跑复现过——`REPLY_TIMEOUT_MS`
由 90 000 改为 150 000、以及 §7.4 补测试之后各重跑一次，五个模式的退出码与命中断言逐条不变。另一支假
endpoint 脚本（模式集为 `correct / overread / forbidden / truncated / broken`）也跑过一遍，`overread`
得到 PASS 且把过度读取记为**记录而非失败**、`broken` 八句全失败，与它各自的预期一致。这证明的是 harness
的评判逻辑完整，**不**证明任何关于真实模型的事。

### 8.2 三处 CI 上看不见的地方（本轮声明，本轮不修）

前两条是**先行存在**的，不是本轮引入的；第三条是本轮引入的接线留下的残影。三条都是本轮发现、记录，
并且**明确不动它们**。

1. **凭据与状态行的泄漏 canary 在 CI 上是盲的。** 断言「凭据不出现在状态行里」的用例带
   `skip: NO_PIPES`，因为在 Linux 上 `setup` 先抛，根本没有状态行可看。也就是说这条 canary 只在
   本机绿，CI 上的绿对它不构成证据。修它需要一条不经过命名管道的路径，那是另一个 slice 的形状。
2. **live harness 的判定逻辑没有离线单元测试。** 八条语义 harness 全部要求真实 endpoint，本机跑不了
   （见上），CI 也跑不了。它们的评判逻辑因此只被本机的假 endpoint 演练过，没有被任何会持续运行的测试
   约束。把那段逻辑抽成纯函数是可做的，但那会把 `test/language-*.live.test.mjs` 的结构问题带进本轮
   scope，而 ruling 把本轮收在 relevance 可达性上。

3. **工厂递给 `buildLanguagePlugin` 的那一跳，只有 `exposures` 一侧在 CI 上看不见。** `requires` 那一侧是钉住
   的：`repositoryLanguagePlugin.requires` 直接读工厂产物，整份 variant 被换掉会在 CI 上变红。`exposures` 那一
   侧不是——`PluginDefinition` 不携带这个字段，只能在 `setup` 里经由答案器观察，而 `setup` 在 Linux 上先抛。
   写一个 `{...baseLanguageVariant, exposures: …}` 式的覆盖，本机会被 `模型被给出的能力是三个…` 抓住，
   CI 上不会。**无廉价修法**：要让工厂的选择在不激活的情况下可观察，就得往 `PluginDefinition` 或导出面上加
   字段，那正是 ruling 明确禁止的「为对称/为以后」扩结构。最接近的廉价断言（`languagePlugin.requires ===
   baseLanguageVariant.requires`）抓不住它——展开复制保留的是同一个数组引用，这条断言会绿。因此记录，不修。

三条都写进这里而不是修掉，是因为**一条没人知道的盲区比一条被记录下来的盲区危险**。

---

## 9. 明确不做（本轮冻结）

- 不扩 relevance 判定本身。逐字相等仍然是唯一规则，`relevant | unknown` 仍然是全部取值。
- 不给判定加第二个 consumer，不为未来可能的 consumer 预埋结构。
- 不把判定细分（不区分 `unknown` 的成因）。
- 不做 `CalendarLanguage` / `MailLanguage` / 任何第三个 variant（见 §4.1）。
- 不加 optional requires、service locator、capability registry、tool registry、动态发现、通用
  optional-plugin 框架、profile system。
- 不引入 Memory、Chronicle 写入、confidence 抽象、新的 perception。
- 不重新打开 Grounded LLM Expression。
- **不修改 Runtime。**
- **不在 report 之前进入 Chronicle / Memory。**

---

## 10. 交付

生产改动按 concern 分成三个 commit（Service + exposure / Language variant / 组合选择），设计记录与服务
状态为第四个。

---

## 11. 两道评审

### 11.1 Functional Review

判据是 ruling 八 的接受条件本身：A–K 各有一条测试承载、regression test 真正约束行为、build 与全量测试正常。

- `npm run build && npm test` → **569 tests / 565 pass / 0 fail / 4 skipped**。
- 九条定向变异**全部 RED**，且每条的目标断言都在变红名单里（§8.1）。第九条是本轮补 §7.4 之后才加上的。
- A–K 十一条逐条找到承载测试，**没有一条是空心的**（§6、§7）。
- 五模式假 endpoint 演练在最终树上逐条复现（§8）。

自检里唯一被判为「声称了却没被约束」的地方是 §7.4：那条注释把**模型看到的 tools**当成了**人类读到的拒绝语**的
证据。它已在本轮补上，并且补完后同一个变异只让新加的那一条变红。

**结论：Functional Review — PASS。**

真实模型端点的语义验证 **NOT RUN**（本机无外站模型访问），见 §8。它不是 PASS，也不是 FAIL。

### 11.2 Architecture Review

- **concern 在正确的 owner。** 判定仍然只由 `src/repository-ci-relevance/judgement.ts` 产生；Service 是这条
  既有实现的新出口，不是第二处判定。Language 不重算 relevance（G）。
- **Runtime 没有开始理解业务，也没有被改动。** `git diff --stat -- src/runtime/` 为空。
- **Provider 不决定 Consumer。** `src/repository-ci-relevance/**` 对 `language` 只有注释引用，**没有任何
  import**；`provides` 不参与激活判定，所以 provider 可以在没有 consumer 的组合里照常 `active`（八.E），这是
  Runtime 的既有性质而不是本插件处理的特例。
- **能力集合由 consumer 自己声明。** 两个 variant 各自持有字面清单；组合只选择用哪一个。没有 master table +
  过滤、没有 registry、provider 不知道 consumer，也不向 Language 注册任何工具。
- **没有投机抽象。** 两份清单之间的少量重复是 ruling 明确允许的；共有成员是**同一个对象**而非重写的等值副本，
  因而不存在可静默漂移的分叉。§9 与 4.3 的禁止项逐条扫描无命中。
- **未来 guard 已落纸。** §4.1 约定：出现第二类独立可选 domain capability 时做 Composition Boundary Review，
  而不是继续加组合 variant；源码落点在 `src/language/exposure.ts` 与 `src/language/plugin.ts` 的文件头。
- **没有偷偷实现「明确不做」的内容**（§9 逐条）。

**结论：Architecture Review — PASS。**

**提交前核对的是真实 git 状态**，不是本文档或任何会话快照里的记录。
