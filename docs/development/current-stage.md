# Hikari 当前阶段开发说明

> 状态：**Phase 1 / Phase 2 / Phase 3 均已完成最终验收并正式收口**（P2-01 ~ P2-04 与 P3-01 ~ P3-05 全部通过 Functional / Architecture Review，已提交、已 push、CI 通过）。**Phase 4 已开始，但尚未完成**：P4-01（Desktop Session Awareness Loop v1）、P4-01.1（Awareness Loop timer 上界正确性修正）、P4-02（Resident Process Composition v1）三项已完成、已提交、已 push、CI 通过；P4-02.1（Resident Local Control v1）**已实现、已通过评审、已提交、已 push**（commit `138cf9c`，CI success）；此后 `origin/main` 又前进过 `507579f`（P4-02.1 状态记录）、`3cf7d2f`（P4-02 证据更正）、`8a9b744`（Runtime 竞态修正，`src/runtime/runtime.ts`）、`ca2db7a`（Git Repository Perception v1）、`4b6fe31`（其状态记录）、`65dd556`（GitHub CI Perception v1）、`f4234ef`（Repository CI World v1）、`6d537e0`（Repository CI Awareness v1）、`b0ecde2`（Explicit Work Focus Local Ingress v1）、`e0403ec`（其状态记录）、`b78ae57`（Repository CI Relevance v1）、`b1dba7b`（Desktop Inspection Semantics 状态记录）、`2dc1ed1`（Language Plugin v1）。**P4-03 已正式收口为 `P4-03 Human-Referenced Repository CI Relevance v1`（COMPLETE）**——这是**阶段收口定义**，不是预先冻结的原始目标，详见下方「P4-03 收口」一段。
>
> **P4-03 收口（人工阶段裁决，2026-09-21）**：P4-03 正式命名 **`P4-03 Human-Referenced Repository CI Relevance v1`**，状态 **COMPLETE**。**它在此前没有预先冻结的交付定义**——其实际边界是在六个 supporting slice 的现实实现问题中逐步收敛出来的，最终依据已交付实现与一次真实 production 验证收口。**不得**把本定义写作「P4-03 原本就计划做这个」或「这是最初设计目标」。完整交付定义、completion condition、非目标见本文件「P4-03 收口」一节；裁决依据与原始研究结论见 `docs/architecture/phase-4-p4-03-entry-review.md`（ENTRY VERDICT 原始研究结果为 **NARROW**，唯一缺口是人工阶段定义；该裁决使其得以收口）。
>
> **P4-03 supporting slice（Git Repository Perception v1）已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `ca2db7a`，CI Runtime Tests #35567512137 **success**：270 tests / 253 pass / 17 skipped / 0 fail），详见 `docs/development/phase-4-git-repository-perception.md`。它是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用任何阶段编号**（该轮当时 P4-03 尚未收口；收口决定见文首，**不因此把它重编号为 P4-03 的子阶段**）。它交付的是「一个具名本地对象（明确指定的本地 Git repository）的一次观测」，**没有**交付 relevance、**没有**交付 repository identity、**没有**进入任何 Judgement，并且**没有**加入 Resident composition。
>
> **P4-03 supporting slice（GitHub CI Perception v1）已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `65dd556`，CI Runtime Tests #35569202089 **success**：296 tests / 279 pass / 17 skipped / 0 fail）。它是**第二个**具名对象源，同样**不是** P4-03 本身。**它没有独立的阶段文档**——事实由本状态行与 `docs/development/phase-4-repository-ci-world.md` 的前置行记录，这是刻意的**最小必要文档**取舍，不是遗漏被掩盖。
>
> **P4-03 supporting slice（Repository CI World v1）已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `f4234ef`，CI Runtime Tests #35574151359 **success**：314 tests / 297 pass / 17 skipped / 0 fail），详见 `docs/development/phase-4-repository-ci-world.md`。它把上述两个源装进**同一个显式 repository scope**，交付「同一时刻两份 observation + 逐条可用性」，**没有**交付 repository identity、**没有**比较 SHA、**没有**进入任何 Judgement，并且**没有**加入 Resident composition。
>
> **P4-03 第一个 judgement 的人工裁决已作出（选项 A）**：定义为 **commit 级**——「本地 Git HEAD 与当前观察到的 GitHub CI run 是否指向同一个 Git commit」。这**不是** repository identity judgement，**不是** repository-level relevance，**不是**用户相关性判断；只比较两个 source **已经直接报告**的 commit SHA，且**不允许**从 `same` 推导「这是同一个 repository」、**不允许**从 `different` 推导「不是同一个 repository」。
>
> **P4-03 supporting slice（Repository CI Awareness v1）已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `6d537e0`，CI Runtime Tests #35574857716 **success**：335 tests / 318 pass / 17 skipped / 0 fail）。它是**上述裁决的落地**，也是 **Hikari 第一个真实的 cross-source Awareness / Judgement**。此前的 `desktop-session-awareness` 比较的是**同一个 facet 的现在与过去**（跨时间，且必须有 baseline 才有话可说）；这一层比较的是**同一次 snapshot 内两个 source 各自报告的 fact**（跨 source），并且**没有任何历史状态**——两次 `current()` 是两个彼此独立的判断。当前唯一落地的 cross-source judgement 是：**比较 local Git HEAD commit 与 GitHub CI latest run head SHA 是否相同**，输出语义**仅为** `same` / `different` / `indeterminate`。它**仍然是 comparison**，**不是** repository identity、**不是** repository-level relevance、**不是** importance、**不是** salience、**不是** action；**不得**把 SHA 相同推导为「同一个 repository」，**不得**把 SHA 不同推导为「不是同一个 repository」。**repository identity 仍未进入。**
>
> **口径更新（Repository CI Relevance v1 收口后）**：**repository identity 仍未进入**；**repository-level relevance 已经进入，但只有一条已冻结的极窄 v1 规则**——human designation 与 `snapshot.githubCi.observation.repository` **逐字相等**即 `relevant`，否则 `unknown`（**没有** `unrelated`）。它与上一条 Awareness 的 `same` / `different` / `indeterminate` **正交**：本地 HEAD 是否指向那个 SHA，与这个 repository 名字是否被人类显式写入过工作焦点，是两个各自成立的判断，**互不取消**；**不得**由逐字相等推导「这是同一个 repository」，**不得**由不相等推导「不是同一个 repository」。
>
> **它是 Awareness 链路上又一句最短的话，不是「Awareness 已完整实现」，也不是「P4-03 已完成」。**（本句写于该轮；P4-03 此后已由六个 supporting slice 收口——但**这句判断对「Awareness 已完整实现」仍然成立**，收口不改变它。）Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act **仍然均未进入，且未被预埋**。
>
> **Desktop Observation Surface v1 已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `60f6507` + 状态记录 `6907e29`，CI Runtime Tests #35666146854 **success**：442 tests / 375 pass / 67 skipped / 0 fail）。它是**工作标签，不占用任何阶段编号**，**不是** P4-04，也**不是** P4-03 的一部分。**它没有独立的阶段文档**——事实由本状态行与源码记录，这是沿用 GitHub CI Perception v1 的刻意**最小必要文档**取舍，不是遗漏被掩盖。
>
> **它是 Hikari 第一个用户可读的桌面感知出口**：`hikari observe desktop-session status` 在终端里逐字转述 `desktop-session-awareness.current@1` 交回来的 assessment。**它是出口，不是新认知层**——感知链（foreground / input-activity / World / Awareness / Loop）在本 slice 之前就已经存在并且一直在运行，此前只是**没有任何东西能把它读出来**。可观察性不是本 slice 新增的能力，**可读性**才是。
>
> **它没有新增任何判词**：`available` / `unavailable`、`present` / `absent`、`changed` / `unchanged` / `indeterminate`、`stable` / `baseline` 全部是既有 contract 的词汇，逐字转述，不翻译、不概括、不解释。它 `requires` 只有 Awareness 契约（收口当时是 `desktop-session-awareness.current@1`，见下条）、`provides` 为空（reader 是 CLI），**不**读取 World、**不**直接读取任何来源、**不**持久化、**不**写 Chronicle、**没有** history、**没有**查询 DSL、**没有**通用 Observation / Query abstraction、**没有** Resident router。默认组合因此由八个成员变为**九个**，显式组合变为**十四个**。
>
> **一处必须与「出口」这个说法一起读的代价（该轮记录，现已修复，见下条）**：`desktop-session-awareness.current@1` 是**消耗性读取**，它会推进自己用来比对的 baseline。人工查询因此与 Awareness Loop 的周期在同一字段上交错——loop 的下一次判词覆盖的是更短的窗口。该性质记在 `src/desktop-session-awareness/contracts.ts` 的契约注释里（它是该 provider 自己的性质），交错、未送达查询仍推进 baseline、并发查询无上限这三条后果记在 `src/desktop-session-observe/plugin.ts`。**该轮三者都是记录而非修复**，因为治法属于 Awareness 的 baseline 归属，在那一个 slice 内发明一个会变成「出口层去改动它本来只被要求转述的判词」。
>
> **Desktop Inspection Semantics v1 已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `ee73e17` + 状态记录 `d6bf03f`，CI Runtime Tests #35680370115 **success**：451 tests / 384 pass / 67 skipped / 0 fail；本机 451 / 450 pass / 1 skipped / 0 fail——CI 上被跳过的全部是依赖命名管道的用例）。它是**工作标签，不占用任何阶段编号**——**不是** P4-04，**不是** P4-03 的一部分，也**不是**一个新的 capability；它**没有**独立阶段文档（沿用上一条的最小必要文档取舍），事实由本状态行与源码记录。它修的是上一条记录下来的那条真实摩擦，**并且只修这一条**。
>
> **它交付的是一处语义修复，不是新能力**：`desktop-session-awareness` 现在**提供两个契约**，同一个 owner、同一份 baseline、同一个比较，差别只有一行赋值——`current()` 读出快照**并把它作为下一次比较的 baseline**（不变，逐字未改），`peek()` 用同一份 baseline 算出**同样**的 assessment，**不推进它**。`desktop-session-observe` 的 `requires` 因此从 `...current@1` 改为 `...peek@1`。**「inspection 不参与 judgement timeline」因此是它持有的能力的性质，而不是它遵守的一条规则**——它拿不到推进 baseline 的能力，所以不需要有测试去证明它不去推进，未来的改动也不可能在这里开始。组合里**只有** `desktop-session-awareness-loop` 持有 `current()`，并有一条遍历 `src/` 的测试钉住「持有者可数」。
>
> **这正是上一条说「那一个 slice 内不做」的那个决定**：baseline 仍然属于**产生 assessment 的 domain owner**（`desktop-session-awareness` 插件实例自己的 activation-local 闭包），**没有**新增 Service、**没有** Resident 缓存、**没有** Global Observation Store、**没有** latest-state store、**没有** history、**没有** Event、**没有** 新增 subscriber，**没有** 让 CLI 或出口层重新实现比较。新增的 `peek@1` 是**已存在的 owner 的第二个既有操作的显式化**，不是新 owner。
>
> **一处用户可见的后果**：判词现在写出它比较的是哪一次快照（`  上一次快照：<snapshotAt>`）。这是**转述**——`previous` 与 `snapshotAt` 一直是 assessment 的既有字段，本轮**没有**新增任何字段。它在收口当时被**刻意扣下**，因为消耗性读取下这个比较对象是「上一个人上一次提问」的产物，写出时间戳只会让一个错的窗口变得可读、不会让它变对；换成 `peek` 之后比较对象是 judgement timeline 自己站着的那一个，窗口才是 timeline 自己的窗口。
>
> **本机实测（真实常驻、真实命名管道，`--desktop-awareness-delay-ms 20000`）**：连续三次 `hikari observe desktop-session status` 的 acquisition 时刻各不相同（`02:36:04.206` / `02:36:04.792` / `02:36:05.477`），而三次写出的 `上一次快照` **完全相同**（`2026-09-22T02:35:55.115Z`）；loop 周期走过之后，两次连续查询又同时落到**新的**同一个 `2026-09-22T02:36:36.169Z`（该轮还恰好读到一条真实 `changed`）。**重复 inspection 不移动 baseline，timeline 自己会移动它。**
>
> **边界说明（口径更新，Repository CI Relevance v1 收口后）：`repository-ci-awareness.current@1` 在默认组合中没有 production consumer，但在显式启用 Repository CI 的组合中【有】。** 该组合下 `repository-ci-relevance` 就是它的 production consumer：`src/repository-ci-relevance/plugin.ts` 的 `requires` 逐字包含 `repositoryCiAwarenessService`。**两种组合必须分开读**——默认组合（九个成员）里确实没有任何 module 读它，显式组合（十四个成员）里有。**（口径更新（JUDGEMENT REACHABILITY v0 之后）：repository scope 组合此后有两个——十四个成员（无 model）与十五个（有 model）；下列陈述对两者都成立。见 `judgement-reachability-v0.md`。）**此前本节笼统写作「当前没有 production consumer」，在第二个组合下已不成立，故更正。
>
> 它作为 public Service 成立的依据有两条，都来自 `plugin-design-spec.md` §16：§16.1 只要求**真实、已发生的跨模块交互语义**，不要求已经存在具体的 Consumer implementation；§16.2 的 Service 判据要求**真实的 callable need**，本轮的 callable need 由 P4-03 的人工裁决（选项 A）直接定义。**不是**「以后可能有人会用」——§16 正文写明：若主要理由是「以后可能有用」，默认不创建。这**不构成**无 consumer Service 的一般许可。
>
> **不得写作 `Phase 4 COMPLETE`。** P4-01 只交付「驱动 + 发生」，P4-02 只交付「进程组合 + 进程寿命」，P4-02.1 只交付「本机可问、可停」：`principles.md` §14 定义的 Awareness 链路中，**Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act 均未进入，且未被预埋**。
>
> **P4-03 supporting slice（Explicit Work Focus Local Ingress v1）已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `b0ecde2`，CI Runtime Tests #35582154818 **success**：367 tests / 325 pass / 42 skipped / 0 fail；本机 367 / 366 pass / 1 skipped / 0 fail——CI 上被跳过的全部是依赖命名管道的用例）。立项依据与边界冻结见 `docs/architecture/phase-4-explicit-work-focus-review.md`（verdict **NARROW**）。它**不是** P4-03 本身，**不属于 Repository CI 那条链**，也**没有**交付任何 Judgement。
>
> 它是 **Hikari 第一次拥有一处人类主动写入的入口**：`declare` / `replace` / `clear` / `status` 四个词经由本地端点，把一个 designation 集合写在 Plugin 自己的闭包里。**这是 ingress，不是 Judgement**——它记录人说了什么，**不解释**这句话意味着什么，**不**判断任何 repository 是否相关，**不**产生 importance / salience，**不**触发 Remember / Ask / Notify / Act。
>
> **它加入了 Resident composition（加入时是第八个成员，Desktop Observation Surface v1 之后是第九个），这是与前面四个 supporting slice 的一处实质差别**：前四者都只提供 provider、不进入生产组合，而入口必须有一个真实存在的常驻进程托管才有意义。Plugin 声明 `requires: []` / `provides: []`，**没有**登记 Service、**没有**发出 Event、**没有**写入 Chronicle、**没有**任何持久化（插件运行前后数据目录逐字节不变，有测试钉住），**没有**引入模型，也**没有**引入 id / 时间戳 / 来源 / 优先级 / 版本号等任何 designation 之外的字段。state 存在 activation 自己的闭包里，因此「重启后为空」是结构性质而不是一条需要记得执行的规则。**（口径更新（Durable Fact Admission v0 之后）：这一段是**该轮当时**的事实，其中三处此后已不再成立——`provides` 已非空（Repository CI Relevance v1 起提供 `work-focus.current@1`）、`requires` 已非空（现在是逐字 `[chronicleService]`）、并且它**现在会写 Chronicle**（Durable Fact Admission v0 起承认自己的 durable fact）。**仍然成立的是**：不发 Event、没有自己的存储（写入前后数据目录里仍然只有那两个文件）、没有引入模型、没有引入任何 designation 之外的字段，且 state 仍在 activation 闭包里、重启后仍为空。见文首两条口径更新。）**
>
> **一处必须收紧的措辞：** 产品 mandate 使 runtime human declaration 成为真实需求，且 ingress 现已实现并**确实真实接收过** `declare` / `replace` / `clear`（由端到端测试经真实命名管道产生）。但「**某个人真的声明过自己的工作焦点**」这件事**尚无证据**——测试发出的请求不是人的声明。因此本轮**不写成**「Hikari 已经真实接收到 human declaration occurrence」，只写成：**入口已就位、可以接收**。不要把「机制已成立」写成「人的声明已经发生」。
>
> **P4-03 supporting slice（Repository CI Relevance v1）已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `b78ae57`，CI Runtime Tests #35621174568 **success**：401 tests / 347 pass / 54 skipped / 0 fail），详见下文各条口径更新。它是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用阶段编号**。它**没有**独立阶段文档（理由与 GitHub CI Perception v1 相同，最小必要文档取舍），事实由本状态行与本文件的口径更新记录。
>
> **它交付了 Hikari 的第一个 relevance judgement，也是第一个真实的、通过产品入口读到 human declaration 的 reader。** 判词规则在 v1 **冻结且刻意极窄**：**逐字相等**——某个 designation 与被观察到的 `snapshot.githubCi.observation.repository` **字符串完全相同**，且 `githubCi` facet 为 `available`、且存在至少一个 designation。**严格不做**：trim、大小写折叠、basename、owner/name 拆分、路径解析、remote URL 推断、repository identity 推断、fork 判定、模糊匹配、别名、模型匹配、embedding、语义相似度。输出**仅为** `relevant` / `unknown`（**没有 `unrelated`**）：`unknown` 表示判定**完成**但没有建立相等关系，不是失败。判定函数取的是 **snapshot 而不是 assessment**，因此 `commitComparison`（`same` / `different` / `indeterminate`）**在结构上无法影响** relevance 结论——Awareness 的判词与 relevance 的判词**正交**，`same` 不使任何东西变相关，`different` 也不使任何东西变不相关。
>
> **一处 Contract Gate 的重新裁决，而不是豁免：** `work-focus.current@1` **现在被提供**。此前 `work-focus` 的 `provides` 为空，并有测试要求「requires 它的插件永远 `waiting`」；该测试的依据是「不存在真实的 callable need」。**真实的 callable need 已经到达**——`repository-ci-relevance` 就是那个 consumer——因此该测试被**反转**（钉住「它确实被登记、且依赖它的插件 `active`」）而**不是被删除**。`repository-ci-relevance` **当时不提供任何 Service**：它真实的 reader 是 CLI，经本地端点提问，为它发布 contract 等于为零个人发布。**当时没有创建任何新的通用 contract。**（**口径更新（JUDGEMENT REACHABILITY v0 之后）：这一段已不再成立**——本轮它**提供了** `repository-ci-relevance.current@1`，因为组合内第一次出现了真实的 callable need：repository-aware Language variant。§16.2 的判据没有被放宽，被满足的是它。**见 `judgement-reachability-v0.md`。**）
>
> **一处 production composition 的条件化，且只有一条分支：** Repository CI capability 是**显式启用的领域能力**。默认常驻保持原有组合，**不需要 repository root、不需要 GitHub repository、不因缺少 Git / GitHub 配置而拒绝启动**。配置规则是**原子**的：`--repository-root <path>` 与 `--repository <owner/name>` **要么都给、要么都不给**；只给一个是**配置错误**，明确拒绝启动并指出缺的是哪一个。**没有默认值、没有 cwd → repository-root 推断、没有 git remote → GitHub repository 推断、没有自动发现。** v1 **只允许 0 或 1 个**显式 repository scope，**不设计多 repository 框架**。这个分支是**当前产品需求的一份局部实现**，**不是** Profile system / Capability registry / Dynamic plugin loader / OptionalPlugin framework / RepositoryScope registry —— 有源码扫描测试钉住这一点。
>
> **三种情形被明确区分，这是本轮的主要工作量：** `unknown` = 判定完成但未建立相等关系；`unconfigured` = **有一个常驻在跑，但这个组合里根本没有 Repository CI capability**（通过**常驻控制通道**判定——它是本产品唯一刻意比自己的 Runtime 活得更久的端点）；`absent` = **没有常驻**。**capability 未启用时 relevance CLI 报 `unconfigured`，绝不报 `unknown`**——后者会让人以为自己声明的焦点被比较过，而实际上这个组合里根本不存在这个判定。依赖拒绝时回答 `failed`，**同样不是 `unknown`**。
>
> **Resident 的边界没有被扩大：** 它仍然只负责组合。它**可以**知道「Repository CI capability 需要的启动配置有没有给」，但**不知道** Git 语义、GitHub 语义、relevance 语义或 commit 比较。各成员的依赖仍由 Plugin 自己的 `requires` / `provides` 与 Runtime lifecycle 处理；Resident 里**没有**手写的业务调用链。
>
> **仍然全部未进入，且未被预埋：** repository identity、importance、salience、notification、action、Event、持久化、后台 relevance 循环、多 repository 抽象、自动发现、模型匹配。Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act **仍然均未进入**。
>
> **Language Plugin v1 已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `2dc1ed1`，CI Runtime Tests #35748199236 **success**：493 tests / 418 pass / 75 skipped / 0 fail；本机 493 / 492 pass / 1 skipped / 0 fail——CI 上被跳过的全部是依赖命名管道的用例），详见 `docs/development/language-plugin-v1.md`。它是**工作标签，不占用任何阶段编号**——**不是** P4-04，**不是** P4-03 的一部分，也**不是**任何既有链路的延伸。
>
> **它是 Hikari 的第三个出口，也是第一个双向出口**：`hikari ask "光，你现在看到什么？"` 把一句人话送进常驻，拿回一句据事实转述的回答。此前两个出口（`observe desktop-session` / `focus`）都是人对着常驻**说话**，这一个允许人**问**。它是一个**入口，不是大脑**——concern 只有「操作者与 Hikari 之间的自然语言交互」一件，内部只有三段：**Understand**（模型唯一参与的地方，且只做「从闭集里挑一个词」）／**Dialogue Context**（activation 闭包里的一句话短期上下文）／**Express**（确定性转述）。**模型不能生成任何用户可见的散文**：它的输出整串拿去查表，查不到就是 `refused`。模型是**这个插件的实现材料，不是 Hikari 的架构层**——没有 Model Service、没有 capability registry、没有 `createLanguagePlugin({topics, requires})` 这样的表、没有 Session Manager、没有 REPL / 会话协议 / 共享 RPC 框架、没有 Memory。
>
> **`answered` / `refused` / `failed` 是三个词，不是两个。** 拒绝是 Hikari 说它不回答**这一句**（问题为空、长得超过任何问句该有的长度、或模型没能把它放进这个构建知道怎么回答的闭集里）；失败是 Hikari 说它**没做完**（模型够不着，或回答所需的一个契约在途中拒绝了）。合并两者会告诉一个人他的问题超纲了，而事实上是模型挂了——**两者的修法不同**。模型不可达时走的一定是 `failed`，不是 `refused`。
>
> **`requires` 恰好是冻结的那两个**（`work-focus.current@1` 与 `desktop-session-awareness.peek@1`），`provides` 为空。**Repository CI 不在 v1 里，理由是结构性的**：Runtime 的 `requires` 是 `every`，缺一个契约的成员会停在 `waiting`、`isReady` 为假，而 `resident.ts` 会因此退出——所以「没有 CI 配置的机器上语言插件也要能起来」不是一句承诺，是依赖清单的形状决定的，有测试逐字钉住。它读桌面用的是 **`peek@1` 而不是 `current@1`**：提问**不推进** awareness 的 baseline，「inspection 不参与 judgement timeline」在这里同样成立、同样是**持有的能力的性质**而不是遵守的规则。
>
> **组合是四个合法组合里的一个分支。** 默认组合（九个成员）**不变**；只有 `--model-endpoint` 与 `--model` **同时**给出时，语言插件才作为**第十个**成员加载。**（口径更新（JUDGEMENT REACHABILITY v0 之后）：一个常驻若**同时**给了 repository scope 与 model，语言成员是**第十五个**，且加载的是 repository-aware variant 而不是 base variant——合法组合因此从两条变成四条，见 `judgement-reachability-v0.md`。）****没有默认端点、没有默认模型、没有自动发现**；只给一半是**配置错误**，明确拒绝启动并指出缺的是哪一个（前例是 Repository CI 的同一对参数）。**没有模型时状态行说明「语言插件未加载」**，而不是让 `ask` 去猜一个不存在的出口。这个分支**不是** Profile system / Capability registry / Dynamic plugin loader / OptionalPlugin framework，有源码扫描测试钉住。
>
> **一处被实测撞出来的真泄漏，已修在值进入进程的那一处（本轮修正轮，对抗性评审发现）**：凭据的唯一去处是 `Authorization` 头，而 HTTP 层拒绝某些头值时会**把它拒绝的值原样引用进错误消息**。实测三种形状的答案并不相同——**开头或中间**的换行会抛出并带回完整 secret（经「细节」行打到 stderr）；**结尾**换行按头值空白规则被剥掉、能通；非 ASCII 被直接接受。因此「secret 不进 stderr」不可能是错误消息的性质，只能是**值的性质**：`readModelCredential` 现在拒绝整个补集（凭据只能是可打印 ASCII、不含空格），**比传输层实际拒绝的更严**，理由是守卫问的是「这是不是一个 bearer token」而不是「这个库今天拒绝什么」——按后者枚举，既会拒绝能用的、也会放过没测过的。拒绝只发生在启动处、**fail-closed**、只说变量名与规则，**不引用值、也不指认是哪一个字符**（会指认那个字节的诊断，本身就是它要报告的那次泄漏）。
>
> **终端安全复用了既有原语而不是新写一份**：`oneLine` 从 `desktop-session-observe/presentation.ts` 提取为 `src/terminal-text/`，因为第二个调用方到了。本 slice 自己的两条出口（`ask` 与常驻 `status`）现在都在它下面。**`focus` 出口不在**——`renderWorkFocus` 逐字回显 designation，`declare` / `replace` / `status` 三个子命令共用它，因此 C0 与 ESC 不过滤，同一个字符串 `hikari ask` 会转义而 `hikari focus status` 不会。这是**本轮之前就存在**的独立缺口，按归属**记录而不顺手修**（治法属于 work-focus 的渲染出口）。
>
> **所有判断都写成一个接收四个注入依赖的普通函数**（`src/language/answer.ts`），不是因为它更优雅：CI 跑在 ubuntu 上，那里没有命名管道，写进 `setup` 闭包的版本**只能经管道到达而 CI 会跳过它**。端到端那一半仍然真实存在，在 Windows 上跑。
>
> **Agent-callable Capability Surface v0 已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `fdacd93`，CI Runtime Tests #35756255449 **success**：501 tests / 426 pass / 75 skipped / 0 fail；本机 501 / 500 pass / 1 skipped / 0 fail——CI 上被跳过的全部是依赖命名管道的用例），详见 `docs/development/agent-callable-capability-surface-v0.md`。它是**工作标签，不占用任何阶段编号**——**不是** P4-04，**不是** P4-03 的一部分。
>
> **它没有新增一层能力，只给两个已经存在的 public Service 补上了 owner 一直没写、现在第一次有读者的一段元数据。** 依据是 `core-architecture-v0.md` §5.3：「**Service 是 Runtime 的真实原语；Capability 是从公开 Service 形成的能力视图。** 不维护一份与 Service 重复的独立 Capability 真源。」因此本轮**没有**新增 capability Service、**没有** AgentTool runtime primitive、**没有** Tool Registry、**没有** Capability Registry、**没有** provider-side invocation handler、**没有**第二套 result，`src/runtime/` 一个字节未改。
>
> **两个 exposure**：`work-focus` 导出 `work_focus.read` → `work-focus.current@1`；`desktop-session-awareness` 导出 `desktop_context.read` → `desktop-session-awareness.peek@1`。owner 是 **awareness 而不是 observe**，理由是语义归属：`desktop-session-observe` **不拥有任何事实**（它的 setup 是一次 `get` 加一次 `await awareness.peek()`，`provides` 为空），在它上面建 exposure 会得到一个视图的视图，而描述文本会落在一个不知道桌面会话是什么的插件手里。指向 `peek` 而不是 `current` 同理——给人看的东西不该变成 judgement timeline 的一步，而 `current()` 持有移动 baseline 的能力；两个 interface 各自只有一个方法（`peek()` / `current()`），所以「指错就拿不到 `peek`」是**类型层面**成立的，不是一条需要记得遵守的规则。
>
> **metadata 的实际 shape 是三个字段：`{ name, description, service }`，第三个是这一轮的设计内容。** 只有前两个的话，「这个能力是那个 Service 的视图」就只是一句话——一张消费者可以贴到任何 Service 上的标签。`service` 是一个指向**已冻结契约对象的引用**，不是 id 字符串、不是拷贝，因此这个断言是 owner 自己作出的、可被证明（测试断言**引用同一性**而不是内容相等），且**不复制任何 provider state、不登记、不创建契约**。刻意**没有**加：input / output schema、authority metadata、side-effect class、tags、categories、cost、model hints、examples、aliases、discovery keywords——一个不接收参数的 read capability 一个都不需要。
>
> **ownership 三分，每一半归正确的一方**：owner 写能力的语义（`src/*/exposure.ts`），consumer 决定哪些被 offer（`src/language/exposure.ts`，里面没有**一个字**描述任何领域，每个条目都是 owner 自己的对象按引用），调用仍走 `src/language/plugin.ts` 里**本轮未改一个字**的既有接线。清单是**写出来的**两个字面条目：没有 registry、没有自动发现、没有遍历 Runtime、没有动态枚举、没有按名字查找。
>
> **依赖图未变**：Language 的 `requires` 仍然恰好是 `work-focus.current@1` 与 `desktop-session-awareness.peek@1`，`provides` 仍然为空——两个 exposure 指向的 Service 本来就是它在读的那两个，它不需要「再获得 capability」。`current-context` **保留**，它是 Language Plugin 自己的 dialogue concern（读的是本插件上一轮留下的那一句话，**读不到任何 provider 的事实**），因此没有一个 owner 能为它写描述；`LanguageTopic` 同样原样保留，二者互不派生。Language 的交互空间因此同时存在 Language-owned behavior 与 exposed domain capability 两类，且**不强行统一**。
>
> **口径更新（`Language Tool-use Loop v1` 之后）：上句里的 `LanguageTopic` 与 `current-context` 已不再存在。** 该 slice 删除了 `src/language/topics.ts` 与 `src/language/understanding.ts`，`current-context` **没有**被塞进 exposure 而是**消失**了——它不是 capability，是「都读一遍」，而那正是 loop 读两次做的事。上一句当时的**裁决**（不把它硬塞进 exposure）没有被推翻，它仍然是现在的实际状态；被取代的只是「它仍以 topic 的形式保留着」这一描述。
>
> **口径更新（provider function name 修正之后）：上面两个 exposure 的名字已由 `work_focus.read` / `desktop_context.read` 改为 `work_focus_read` / `desktop_context_read`。** 原因不在本仓库而在 wire：OpenAI-compatible function calling 要求 `tools[*].function.name` 匹配 `^[a-zA-Z0-9_-]+$`，带点的名字会被服务端以 **400** 拒绝**整个请求**。这**不是**语义选择失败——请求根本没有到达模型，调用方看到的是「模型一直没说话」。改名只动了 `name` 这一个字段：两个 **Service contract**（`work-focus.current@1` / `desktop-session-awareness.peek@1`）、owner 写的 `description`、`service` 引用映射、`{name, description, service}` 的 shape、以及 `src/runtime/**` 全部未动。**没有**加一个模型侧别名——那会让同一个东西有两个名字并且可以各自漂移，而 `aliases` 正是本块记录为「刻意不加」的字段之一；被 wire 约束的那一个就是它自己的名字。约束现由 `test/language.test.mjs` 对 `LANGUAGE_EXPOSURES` 直接断言，下一个想用点号的 owner 会先撞到测试，而不是远端的 400。
>
> **一处随实现定下来的收缩**：`LANGUAGE_EXPOSURES` **不**从 `src/language/index.ts` 导出，测试按路径 import。`plugin-design-spec.md` §7 的 REVIEW TRIGGER 问的正是「这个符号被导出，是因为它确实跨越模块边界，还是因为**测试**、对称性或预判的未来需要」——而下一个消费者（tool-use loop）在 `src/language/` **内部**，判据 2 不成立；两个 owner 的 barrel 导出则成立，因为 `src/language/exposure.ts` 今天真的跨模块 import 它们。同一个 slice 里一个留一个撤，区别就是这一条。
>
> **Capability existence ≠ Exposure ≠ Authorization ≠ Execution——本轮只实现了第二项。** 还没有 Authorization：exposure 不携带调用路径、不新增调用路径、不授予任何权限，它回答的永远是「可以对外提供什么」，**不是**「这个调用方被允许做什么」。**Language Tool-use Loop、LLM function calling、OpenAI tool schema、Tool Registry、Capability Registry、Runtime enumeration、dynamic discovery、deferred tools、BM25、Action、Authority、Approval、Memory、Notification、主动沟通全部未进入，且未被预埋。**
>
> **两条既有文件名册守卫因新增文件而触发，已同步更新名册内容并附注释说明该文件来自本轮而不是来自 loop。** 两条守卫的**断言机制逐字未动**（仍是精确 `deepEqual` 列举 + 未改的 import 白名单循环）——这是护卫兵按设计工作，**不是被放宽**。另：本轮做过一次只读对抗性评审，提出 6 条候选，逐条重新锚定到源码后**全部采纳**（4 条改代码、5 条改文档），其中一条是上面那次 barrel 导出撤回，一条是一处真实测试漏洞（四类引申只断言了两类，另两类删掉测试仍会全绿），另两条是文档叙述与实际失败路径不符。
>
> 长期原则以 `docs/architecture/principles.md` 为准；v0 架构边界以 `docs/architecture/core-architecture-v0.md` 为准；第一阶段实现与复盘见 `docs/development/phase-1-runtime.md` 与 `docs/architecture/phase-1-architecture-review.md`；第二阶段 P2-01 实现与复盘见 `docs/development/phase-2-continuity.md` 与 `docs/architecture/phase-2-continuity-architecture-review.md`；P2-02 实现与复盘见 `docs/development/phase-2-chronicle.md` 与 `docs/architecture/phase-2-chronicle-architecture-review.md`；P2-03 实现与复盘见 `docs/development/phase-2-cli.md` 与 `docs/architecture/phase-2-cli-architecture-review.md`；P2-04 实现与复盘见 `docs/development/phase-2-lifecycle.md` 与 `docs/architecture/phase-2-final-architecture-review.md`；第三阶段 P3-01 实现与复盘见 `docs/development/phase-3-foreground.md` 与 `docs/architecture/phase-3-foreground-architecture-review.md`；P3-02 实现与复盘见 `docs/development/phase-3-input-activity.md` 与 `docs/architecture/phase-3-input-activity-architecture-review.md`；P3-03 实现与复盘见 `docs/development/phase-3-desktop-session-world.md` 与 `docs/architecture/phase-3-desktop-session-world-architecture-review.md`；P3-04 实现与复盘见 `docs/development/phase-3-desktop-session-awareness.md` 与 `docs/architecture/phase-3-desktop-session-awareness-architecture-review.md`；P3-05 实现与复盘见 `docs/development/phase-3-vertical-slice.md` 与 `docs/architecture/phase-3-final-architecture-review.md`（后者同时是第三阶段的最终架构评审与收口文档）；第四阶段 P4-01 与 P4-01.1 的实现与复盘见 `docs/development/phase-4-desktop-session-awareness-loop.md`，P4-02 的实现与复盘见 `docs/development/phase-4-resident.md`，P4-02.1 的实现与复盘见 `docs/development/phase-4-resident-control.md`；P4-03 supporting slice（Git Repository Perception v1）的实现与立项依据见 `docs/development/phase-4-git-repository-perception.md`，Repository CI World v1 的实现与立项依据见 `docs/development/phase-4-repository-ci-world.md`，Judgement Reachability v0（工作标签，不占阶段编号）的实现与三条未来 guard 见 `docs/development/judgement-reachability-v0.md`，Durable Fact Admission v0（工作标签，不占阶段编号）的承认规则、解除的旧冻结、失败语义与变异验证见 `docs/development/durable-fact-admission-v0.md`；第四阶段的架构评审文档见 `docs/architecture/phase-4-explicit-human-reference-review.md`（P4-03 Explicit Human Reference Frame Boundary Review，verdict **BLOCKED**，commit `87605c6`）与 `docs/architecture/phase-4-explicit-work-focus-review.md`（P4-03 Explicit Work Focus Vertical Slice Boundary Review，verdict **NARROW**）。
>
> **Language Tool-use Loop v1 已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `38bf7cd`，CI Runtime Tests #35812104427 **success**：533 tests / 455 pass / 78 skipped / 0 fail；本机 533 / 531 pass / 2 skipped / 0 fail——本机被跳过的是环境门控的语义 live 测试与 POSIX SIGTERM 用例，CI 上另有 76 条依赖命名管道的用例被跳过），详见 `docs/development/language-tool-use-loop-v1.md`。它是**工作标签，不占用任何阶段编号**——**不是** P4-04，**不是** P4-03 的一部分。前置是 `Agent-callable Capability Surface v0`（commit `fdacd93`），本轮开工时 `HEAD` = `85dd4fe`。
>
> **它把 Language 内部的第一个 router 删掉了，因此第二个也没有了。** 改动前是 `Topic Router（LANGUAGE_TOPICS 四选一）→ Tool Router（topic → Service）→ Domain Plugin` 两级串联，而第二个 router 正是第一个存在的理由。现在模型直接写 capability 名字：`work-focus` → `work_focus.read`，两个 desktop topic → `desktop_context.read`，`current-context` 不是 capability 而是「都读一遍」，那正是 loop 读两次做的事。`src/language/topics.ts` 与 `src/language/understanding.ts` 已删除。**Topic Router 与 Tool Router 并存是明确禁止的中间态**——那会得到一个「先挑 topic、再在 topic 里挑 capability」的两级选择，第二级还受第一级产出的那个词约束。**Language 的 dialogue concern 没有退役**，它换了形状：`{topic, at}` → `{reads, at}`。
>
> **第一轮只有两个闭集：直接对话回复，或 capability 调用。** 非空 `content` 且 `tool_calls` 空 → `chatted`；`tool_calls` 非空 → `content` **整段丢弃**。后者是结构性的：`answer.ts` 读到非空 `toolCalls` 时根本不读 `content`，所以那段文本不是被过滤掉的，而是**从来没有进入过任何变量**——**模型不能一边调 tool 一边夹带一段用户可见的散文**。`tools[]` 由 `tools.ts` 从 `LANGUAGE_EXPOSURES` 机械 `map` 出来，`description` 是 owner 的字段按引用透传，**Language 里没有一句 capability 描述文本**；**（口径更新（JUDGEMENT REACHABILITY v0 之后）：`toModelTools` 现在接收列表作为参数，base variant 传 `LANGUAGE_EXPOSURES`、repository-aware variant 传 `LANGUAGE_REPOSITORY_EXPOSURES`——「机械 map、没有第二份描述」不变，变的只是列表由 variant 显式传入而不是模块级常量。见 `judgement-reachability-v0.md`。）**回程走 `findExposure` 对**同一个数组**线性查找，**模型字符串永远不能直接成为 Service key**。
>
> **循环终止是推出来的不变量，不是魔数。** 没有 `MAX_AGENT_STEPS`；不变量是「每一次能够继续的迭代必须消费一个此前没有读过的 exposure，否则终止」，因此 `LANGUAGE_EXPOSURES.length = 2` ⇒ 最多 2 次 Service 读、最多 3 次模型调用。**（口径更新（JUDGEMENT REACHABILITY v0 之后）：上界由 **variant 自己的** exposure 集合推导，不再是单一常量——base variant 仍是 2 读 / 3 调用，repository-aware variant 是 3 读 / 4 调用；`src/cli/ask.ts` 的等待上界取两者中较长的一个推导，不写死。见 `judgement-reachability-v0.md`。）**同一个 capability 在一次交互中不会被读第二次，重复调用不产生第二次 Service 读并直接终止，未知名与非法参数不被执行。**一个永远重复同一调用的脚本模型因此确定性终止。** 一处由对抗性评审发现的真实缺口（同一个批里两条调用共用一个 `tool_call_id`）已显式拒绝——它可达，且放任它会让下一次请求被按 id 索引结果的端点拒绝，把一次本该成功的 grounded 回答变成 `failed`。
>
> **tool result 没有 Universal Result Envelope**：模型看到的**就是**确定性的 grounded 人类可读块（`renderFocus` / `renderAssessment`；**口径更新（JUDGEMENT REACHABILITY v0 之后）：现在是三个，第三个是 owner 自己的 `renderJudgement`**），**不把 raw Service 结构整棵交给模型**，且**模型看到的内容与最终 grounded answer 使用的是同一份数组**。`read.ts` 在返回前对每一行做一次 `oneLine`，因为工作焦点是人打进去的文本。
>
> **outcome 由三个变四个：新增 `chatted`（0 次 capability 读取）**，与 `answered`（≥1 次成功读取）**不合并**——只有后者有资格被当作关于这台机器的事实。grounded 状态下**没有**自由 prose 的出口：模型可以决定「还需要读什么」，不能决定「这些事实意味着什么」。**Grounded LLM Expression 明确不在本轮**，记录为后续独立 slice。**（口径更新（LANGUAGE GROUNDED SYNTHESIS v0 之后）：上面这一句里的两处已被收窄，收窄者是 `docs/architecture/language-grounded-synthesis-v0-boundary-review.md`（其源冻结处是 `docs/development/language-tool-use-loop-v1.md` §8 / §11，本块的规范力来自那里，不是来自本表）。收窄的形状是**一条边，不是一个能力**：默认仍是「读取就是回答的全部」，且**没有记录时这条边整条不存在**；只有当**这一问的 prompt 确实把已确认材料列了出来**（问的是页面而不是库房）、该步未被截断、模型确实说了话三者同时成立时，模型那句话才以**固定标签引导的一节**接在**所有 owner 渲染块之后**，标签明说那不是读回来的内容、记录本身也没有被核实过。`chatted` 仍是模型原话、`answered` 的**事实部分**仍只由 owner 渲染产生，「这些事实意味着什么」**仍然不是模型决定的**——被解开的只是「这句话里问到的历史那一半由谁带到人面前」。判级 L2（移动一条 SHOULD 默认），零 MUST 被触及。）**
>
> **验证分两层，且不得互相冒充。** 自动化测试证明的是**结构不变量**（tool_calls 非空时 content 不进 answer、grounded 后无自由 prose 出口、grounded answer 仅由 deterministic renderer 产生、Domain Plugin 不获得 user-facing speaking turn），以及「给定相应 model decision 之后系统执行路径正确」——**它不证明真实模型完成了语义选择**。真实 endpoint 的 8×3 semantic selection 验证**在本机 NOT RUN**（没有可达的真实模型 endpoint 与凭据），命令与判据写在 `test/language-semantic.live.test.mjs` 抬头与 `docs/development/language-tool-use-loop-v1.md` §9/§13；**该门禁后来已在操作者的机器上跑通并 PASS，见本块最后一条口径更新与 §15.8**。本轮另做了一次真实进程手工验证（真实 `resident` + 命名管道 + HTTP transport + 本地 stub endpoint，12 类输入），线上形状逐次核对。**（口径更新（LANGUAGE GROUNDED SYNTHESIS v0 之后）：本句列举的四条结构不变量里，「grounded 后无自由 prose 出口」与「grounded answer 仅由 deterministic renderer 产生」两条**已被收窄**，收窄者与判级见上一段的口径更新；其余两条（`tool_calls` 非空时 content 不进 answer、Domain Plugin 不获得 user-facing speaking turn）**未动**，且本轮新增的四条测试是钉在**收窄后的形状**上的——合成段必须在所有渲染块之后、无记录时不出现、末步截断时不出现、循环的另一个出口不捕获。）**
>
> `src/runtime/**` 本轮**一个字节未改**；`LANGUAGE_EXPOSURES` 仍是**写出来的两个字面条目**，没有 registry、没有发现、没有遍历 Runtime、没有 Model Router。**Authority / Approval 未进入**——两个 capability 都是只读，`model selected capability ≠ authorized action` 这条区分在代码路径上保持。
>
> **口径更新（provider function name 修正之后）：本块与 `docs/development/language-tool-use-loop-v1.md` 里出现的 capability 名 `work_focus.read` / `desktop_context.read` 现已改为 `work_focus_read` / `desktop_context_read`。** 改动理由、边界与未动的东西见上方 `Agent-callable Capability Surface v0` 块的口径更新。**本块此前的结论逐条不受影响**：循环、终止不变量、batch 语义、四个 outcome 的划分与 Speech Sovereignty 都建立在「名字是闭集里的一项」这个性质上，不建立在名字的字符集上；重建后全套测试与真实进程手工验证均已重跑。
>
> **口径更新（non-thinking 模型调用语义冻结之后）：Language 的模型调用语义已由人类裁决冻结为 non-thinking，config 上多了一个最小的可选 `reasoningEffort`（闭集当前只有 `'none'`）。** 入口仍是既有的那一条：CLI `--model-reasoning-effort` → `LanguagePluginConfig.reasoningEffort` → `LanguageModelConnection.reasoningEffort`，live harness 用**同一个** connection 字段，没有第二套 request body。**未配置时请求体逐字与冻结前一致、不带 `reasoning_effort`**，所以其它 OpenAI-compatible endpoint 不受影响；配置为 `'none'` 时**顶层**加入 `reasoning_effort: "none"`，仅此一个字段。**没有**加入 `thinking`、`reasoning_content`、provider 判断、endpoint sniffing、DeepSeek 特判、Model Router、Provider Registry、generic `extra_body` 或 reasoning trace abstraction——**理由不是「某个 provider 默认打开 thinking」**（那是某一个 endpoint 的事实，写进代码就是 endpoint 特判），而是**本构建不拥有 reasoning trace 的生命周期**：不解析、不保存、不回放，而一个产出它又在下一轮要求回传的模式会让每一次 grounded 回答的第二轮失效。本块的其它结论（循环、终止不变量、四个 outcome、Speech Sovereignty、两个 Service contract、exposures 与 description）**一律未动**，`src/runtime/**` 同样一个字节未改。真实 endpoint 的两轮 tool calling 证据与「8×3 门禁在本机 NOT RUN」记录在 `docs/development/language-tool-use-loop-v1.md` §13.4。
>
> **口径更新（thinking tool loop 之后）：`reasoningEffort` 的闭集已由 `'none'` 扩为 `'none' | 'high'`，并且本构建在单次 interaction 内实现了 `reasoning_content` 的原样回放。** 上一条里「本构建不拥有 reasoning trace 的生命周期：不解析、不保存、不回放」作为**当时的理由**仍然成立，作为**现在的口径**已被取代：被取代的不是「不拥有」，而是「因此不能支持 thinking 模式」。生命周期仍然只有一个 interaction——它不进 Dialogue Context、不进 Chronicle、不进 Memory、不是 Judgement state、不跨 interaction 存活，也不是用户可见内容；变的是它可以在**同一次交互内**被原样带回，而这正是 thinking 端点做多轮 tool calling 的前提。同一轮里 `MODEL_MAX_TOKENS` 由 512 改为 **4096**，附真实端点单变量实测（high@512 有 3/24 次首轮 `finish_reason=length`，high@4096 为 0/24）。**没有**因此加入 ReasoningService / ReasoningTrace / shared reasoning contract / Runtime primitive / Provider Registry / Model Router / endpoint sniffing / DeepSeek 分支 / keyword routing；`src/runtime/**` 再次一个字节未改，两个 Service contract 未动，`LANGUAGE_EXPOSURES` 仍是两个字面条目。**真实 endpoint 的完整 8×3 thinking tool-loop 门禁 = PASS**（`deepseek-flash` / `reasoning_effort=high` / `max_tokens=4096`，8 句 × 3 次共 24 个 interaction，全部通过；forbidden 0 violation、meta-domain detour 0、`reasoning_content` 36/36、一次只读 over-read 按冻结 Read Policy 仅记录）。证据记在 `docs/development/language-tool-use-loop-v1.md` §15.8；本机 harness 仍然 NOT RUN（无 endpoint 与凭据）。
>
> **Judgement Reachability v0 已实现**（**工作标签，不占用阶段编号**），详见 `docs/development/judgement-reachability-v0.md`。本条目随实现落地；**Functional / Architecture Review 结论与 commit / CI 记录另起一条口径更新**（仓库惯例：结论先写、哈希与 CI run 随后追记）。它把此前只有 `hikari relevance` 能读到的 relevance 判定接到模型可达范围内：`repository-ci-relevance` **提供** `repository-ci-relevance.current@1`（Service 与端点走**同一条** `judge` 实现路径，不是两份逻辑），Language 因此有了**两个具名 variant**——base（2 exposures，逐字未变）与 repository-aware（3 exposures，多 require 一个 relevance Service）。**base Language 不依赖 Repository CI**；有没有 repository scope 是**组合决定的事**，不是插件自己评估的条件。合法组合因此从**两条变成四条**（9 / 10 / 14 / 15），Language 在「repository scope + model」里排在 CI 链**之后**。
>
> **一处刻意放弃的不变量，以及刻意保留的那一半：** 旧顺序下四个 roster 是**嵌套**的（每个都是下一个更大 roster 的字面前缀），新顺序下 `base + language` 不再是 `base + chain + language` 的前缀。**被放弃的只是嵌套**——默认九个成员仍然是四个组合**共同**的字面前缀、共有成员相对顺序不变，这两条仍被测试钉住。**没有为此修改 Runtime readiness 语义**：`src/runtime/**` 一个字节未改，排序本来就是 `src/cli/resident.ts` 的职责。
>
> **一处 Contract Gate 的重新裁决，而不是豁免：** §16.2「没有真实 callable need 就不建 Service」**没有被动过，被满足的正是它**——组合里第一次出现了会**主动调用**它的 consumer。§16.1 放宽的只是读法（不要求 Consumer implementation 已存在）。同一个 slice 里 **Service 与 exposure 必须同时落地**，单独一个 Service 不构成批准。
>
> **两条未来 guard 记入 `judgement-reachability-v0.md`：**（一）具名 variant 只对「base + repository-aware」这一种情形批准——出现**第二类**独立可选的 domain capability 时，答案不是加第三份清单或第三个工厂，而是做一次 Composition Boundary Review 重新审查「能力可达性是否应当在组合时决定」；（二）grounded presentation 没有被重新打开，第三个 capability 走的是同一条确定性 grounded 路径。
>
> **验证分层，且不得互相冒充：** 结构不变量（A–K 十条的机械证明、四个 roster、Service 与 exposure 的存在性）由自动化测试证明。**真实 endpoint 的语义验证在本机 NOT RUN**——这台机器无法访问真实模型端点，因此它不是 PASS 也不是 FAIL。可以断言的是 harness 的评判逻辑在本轮改动后仍有效且非平凡：五模式的本地假 endpoint 得到 4 种不同的失败断言 + 一次干净通过。
>
> **补了一处此前存在的覆盖缺口：** `src/language/**` 此前没有 slice 局部的 forbidden-structure 扫描，而 `src/` 全量扫描的模式里没有 `ServiceLocator` / tool registry / discovery——正是本轮点名要确认缺席的三类。已按仓库既有约定补上（只命名「若要引入必须新造」的复合标识符，不写裸名词，否则会在否定这些词的注释上变红）。
>
> **Desktop Content Read G-1（Authorization Boundary）已实现、已通过 Functional / Architecture Review、已提交、已 push**（commit `bdbc591`，CI Runtime Tests #38364810038 **success**：867 tests / 730 pass / 137 skipped / 0 fail；本机 867 / 863 pass / 4 skipped / 0 fail——CI 上被跳过的全部是依赖命名管道或 Windows 桌面 API 的用例。C# Human Surface 一致性 job 69 passed / 0 failed / 0 skipped）。**它是工作标签，不占用任何阶段编号**——**不是** P4-04，也**不是** P4-03 的一部分。文档见 `docs/architecture/desktop-context-understanding-g1-authorization-boundary-review.md`（边界评审，overall **NARROW**：G-1a 可设计 / G-1b、G-1c BLOCKED）与 `docs/architecture/desktop-context-understanding-g1-narrow-design.md`（设计与落地记录；§13.7 五条发现、§13.8 状态）。
>
> **它交付的是「人可以用一个词授权一次窗口读取」这一条最窄的切片，不是「Hikari 能看屏幕」这个能力。** `hikari screen "<text>"` 里那个词**本身就是授权**：它是一个 **request-local** 的量——**不是**激活状态、**不是**持久权限、**不是**可复用的开关，且两次调用之间不存在任何状态。窗口正文进入 Language 时是**材料（material）**，**不是**模型可以调用的 capability——它不进 system prompt，模型不能请求它，它只出现在被授权的这一次回答里。
>
> **它是 Hikari 第一次让不可信的环境正文进入模型上下文，因此本轮的工作量主要落在边界而不是功能上**：读回来的内容必须被标签标成来源材料、正文不得提升为指令或授权、`screen` 这个词不得成为第二个可独立选装的能力触发点。**真实远程端点的语义验证在本机 NOT RUN**（§13.5 逐字记录），因此它不是 PASS 也不是 FAIL。
>
> **本轮同时收口了四条针对 Human Surface 跨语言镜像的发现**（F-1 HIGH 红门禁 / F-2 / F-4 / F-5，逐条见 `desktop-context-understanding-g1-narrow-design.md` §13.7–§13.8）。**F-5 是核对 F-4 时发现的**：协议有**五个**应答结果词，而 C# 的枚举与解码词表只有四个，`recorded` 的合法应答会被报成 **unreadable**，并且冻结文档与 C# 注释都在陈述「四个词」。**它不可达**（只有 `confirm` 会产生 `recorded`，而 Surface 只写 `ask`）——**而这正是它一直没被发现的原因**：conformance 的应答语料枚举的是四种 shape。修法是**补上第五个词**并把语料补成五种，不是加一条守卫去拒绝它：守卫要盯的是**协议**，不是 client 的需要。**F-3 未修**，记录为已知限制（`READ_AND_FRAMING_BUDGET_MS` 的推导没有点名第三次读取；改动是措辞选择，不是顺手能补的常数）。

> **Durable Fact Admission v0 已实现**（**工作标签，不占用阶段编号**——**不是** P4-04，**不是** P4-03 的一部分），详见 `docs/development/durable-fact-admission-v0.md`。本条目随实现落地；**commit / CI 记录另起一条口径更新**（仓库惯例：结论先写、哈希与 CI run 随后追记）。立项依据是 `DURABLE FACT ADMISSION v0 — BOUNDARY REVIEW`，Human ruling `VERDICT = NARROW → READY / AUTHORIZED FOR IMPLEMENTATION`。它让 **`work-focus` 成为 Hikari 第一个承认自己 durable fact 的生产 Plugin**：`declare` / `replace` / `clear` 真的改变了集合时，由**语义 owner 自己**经 `chronicleService` 写下 `work-focus.declared` / `work-focus.replaced` / `work-focus.cleared`（version 1，`occurredAt` 在发生时刻读一次，`source` 为 `{ kind: 'work-focus.endpoint' }`）。
>
> **本轮解除的是两处具体冻结，不是那份文档。** `docs/architecture/phase-4-explicit-work-focus-review.md` 的 §5 #16「不写 Chronicle」、§8 反例表「把 designation 写进 Chronicle」、§9 禁止清单里的 `Chronicle integration` / `persistence`，**对这一位 owner 解除**。解除的是**条目**，**不是**它背后的理由——§8 逐字写下的理由是「Event ≠ Durable Fact；『声明过焦点』与『决定长期记住』是两件事」，**那条理由今天仍然成立**，它否定的是「命令到达即承认」的命令流水。当年缺的两样东西现在都在：**真实的 occurrence**（Work Focus Local Ingress v1 之后入口存在，可以有东西指向它说「这件事发生了」）与**一条被批准的 durable admission 规则**（谁可以承认、可以承认什么命题）。这不是删除历史，也不是豁免——它与 `work-focus.current@1` 那次 Contract Gate 翻转同型，**旧守卫被替换（带注释记录它原来在防什么），不是被删掉**。**不要扩大成「所有 Plugin 都应该写 Chronicle」。本轮只批准 Work Focus。**
>
> **Chronicle 记录的是语义状态转变，不是端点命令审计。** 四类**语义无操作**一条事实都不产生：声明一个已声明过的 designation、清空一个本来就是空的集合、替换成相同成员的集合、**只差顺序的替换**（`["A","B"] → ["B","A"]`）。最后一种是最容易写错的一种，也是唯一「表示变了而语义没变」的情形——`replace` 无条件构造新数组，所以**对象同一性在这里永远是假的**。判定被实现为本领域最窄的等价检查（`sameMembership`：先比长度再比包含，精确而非近似，因为 `designations` 结构上永不含重复），**没有** generic equality framework、deep-equal、排序归一化、内容哈希或 idempotency key。
>
> **本 slice 最重要的失败语义：事实发生与持久化确认分离。** Work Focus 的 action 成功**不以** Chronicle append 成功为条件——`ChroniclePersistenceError` 只说**这一次写入没有取得可靠的持久化确认**，**不表示什么都没写**，因此回滚（在一次可能已落盘的写入上发明一个从未存在过的状态）、重试（把一条事实变成两条）、抛出（让常驻因为自己的历史不可用而死）、静默吞掉（调用方分不清记没记住）**四者全部被禁止**。正确顺序是：state 先成功改变 → 尝试 append → 取得确认则照常；未取得确认则 **action 仍然成功、不回滚、不重试、不抛出**，reply 多一行确定性的「这次变化已生效，但没有取得 Chronicle 的可靠持久化确认」。**outcome 仍然是 `ok`，信封没有被加宽**——新增一个 outcome 会得到一个只有一个成员的类型。**没有新增全局 outcome taxonomy。**
>
> **Provider 不决定 Consumer，Runtime 仍然不理解业务。** 写入者是 owner 自己（`src/work-focus/session.ts`），**没有** Work Focus Event、**没有** recorder Plugin、**没有** 由 Resident / Runtime / Language 代写。`work-focus` 的 `requires` 因此从 `[]` 变为逐字 `[chronicleService]`，这正是它拒绝在「运行了但没有历史」的组合里假装正常的方式；生产组合不受影响，理由是顺序而不是运气——Chronicle 是 `productionComposition` 的第二个成员，work-focus 是最后一个。**`src/runtime/**` 一个字节未改**（`git diff --stat -- src/runtime/` 为空）。**这一条由提交前重跑的命令输出核对，没有任何测试钉住它**——`test/` 里对 `src/runtime` 零命中，与设计文档 §8.1 的 P 行一致；将来有人改了 Runtime，CI 不会因此变红。
>
> **Chronicle 与状态仍然分离，两个方向都没有接。** append 失败不能撤销状态改变；**历史也不能恢复状态**——重启之后 Work Focus 仍然从空开始（state 在 activation 闭包里），而 `chronicle read()` 仍然读得到上一轮生命周期写下的事实。**这两者同时成立是本轮的正确行为**，不是待修的缺口，有一张测试同时钉住两半。Chronicle 仍然只保存**发生过什么**，它不解释**这意味着什么**；importance / salience / confidence / relation / memory 相关字段一个都没有。
>
> **一处同步 host 的最小异步化。** `WorkFocusHost.handle` 现在返回 Promise（应答可能要等一次 durable write）。**没有错误被抛进 socket 的 `data` 处理器**（`serve` 只框定与解码，`void answer(...)` 交接，`answer` 不可能 reject）、**Chronicle 失败不会杀死常驻**（在 session 内被折叠成降级 reply）、**客户端仍拿到确定性应答**。`IDLE_CONNECTION_MS` / `REPLY_TIMEOUT_MS` **没有被改动**，只被显式核对过（`append` 实测空 store 约 3–5 ms；25 000 条事实时 5 次采样中位数 73.2 ms、最大 79.8 ms，5 000 ms 预算约为中位数的 68 倍；另一次约 322 ms 的未复现历史观测及其保守解释见 `durable-fact-admission-v0.md`，现有证据不支持调整超时），并写明越界代价是**没有答案**、**永远不是错的答案**。**没有** queue / worker / retry subsystem。
>
> **验证分层，且不得互相冒充。** 本机（Windows 真实命名管道）额外证明整条链路——CLI → 常驻 → 端点 → session → Chronicle 落盘，三条事实类型、顺序、载荷逐条对得上，且数据目录里没有多出第二个存储文件。CI（ubuntu，无命名管道）证明**承认规则本身**：`requires` 结构与 `waiting`、四类语义无操作一次 append 都不调用、每个真实转换恰好一条、owner 自述的事实形状与 source 声明、持久化未确认时的全部失败语义——**这一段没有 skip 门控**，它直接驱动 `createWorkFocusSession` 的真实构造路径；production plugin 把这个 session 实例接入 endpoint 的**实例级接线**，则由本机 named-pipe 测试承担（写成 `setup` 闭包的版本只能经管道到达，CI 会跳过，同 `judgement-reachability-v0.md` §7.3 记录的那类缺口）。本机计数：全量 **575 tests / 571 pass / 4 skipped / 0 fail**；`test/work-focus.test.mjs` 40 / 40 / 0 skipped。
>
> **15 条定向变异 14 条 RED，第 15 条存活并被记录。** 存活的是「删掉 `facts.ts` 里的 `status` 排除」——原因是真实的结构事实：`status` 永远不移动集合，session 的变化判定在那之前就拒绝为无操作请求构造 draft，因此那条子句**经 session 不可观测**。处理**不是删除它**（它是这个家族在说「词汇表里没有『问一句』这一类事实」，那是关于 owner 词汇的主张，不是关于某条请求路径的主张），而是**在它真正住着的边界上直接断言**并同时断言另外三个 type 确实产出；补测后同一变异变红，把判定反转则**编译期即被拒绝**。另记一次**观测到但未复现**的失败（`test/language-model.test.mjs:554`，不涉及本 slice，14 次重跑未再现，机制未确定）——它被写成「未复现的观测」，不是 PASS，也不是已修的缺陷。

> **HUMAN SURFACE v0 已实现**（**工作标签，不占用阶段编号**——**不是** P4-04，**不是** P4-03 的一部分），边界冻结、真机 E2E 记录、Functional Review 与 Architecture Sanity Check 全部在 `docs/architecture/human-surface-v0-implementation-boundary-freeze.md`。VERDICT 是 **L2 — LOCAL CONTRACT EVOLUTION（无 L3 trigger）→ 直接实现**：它命中 R5 的「给既有 contract 加 consumer」一条（Surface 是投递管道这一既有边界的**新 consumer**），R4 四问全否。
>
> **它交付的是一句话的实现：Human 不再需要开一个 PowerShell 窗口等 Hikari 说话。** 此前 Hikari 已经会主动开口（Desktop Return Attention v0 / Repository CI 播报），但**唯一能听见的地方是一个前台终端里的 `hikari subscribe`**——人必须守在它前面。现在有了一个常驻在 Windows 上的窗口与托盘，它自己找得到人。**这是出口，不是新的认知层**：感知链、Awareness、Language 在本轮之前就都已存在并在运行。
>
> **技术栈：.NET 8 WinForms，framework-dependent，零 NuGet 包，三个工程。** `HumanSurface`（`net8.0-windows` 的 WinExe，唯一需要 Windows 的一个）／`HumanSurface.Core`（**中性 `net8.0`**，不碰窗口、不碰托盘、不碰注册表）／`HumanSurface.Tests`（自带的控制台运行器，无测试框架包）。中性目标不是随手写的：它让 Core 与它的测试**能在仓库已有的 Linux runner 上跑**，这正是 CI 双 job 成立的前提。没有 `PackageReference`——这个仓库 `package.json` 连 `dependencies` 键都没有，一个 GUI 表面拖进 NuGet 会是供应链第一次进入这个项目。
>
> **Surface 是独立进程，不是 Plugin，`src/` 本轮 0 diff。** 含 `src/runtime/`、`src/human-delivery/`、`src/language/` 与全部 domain plugin。它是**管道的第二个外部 client**，与 `hikari subscribe` 同类；常驻甚至不知道它在——`src/cli/subscribe.ts` 逐字写着这个模式已经成立（「the resident never knows who is listening」）。把 Surface 做成 Plugin 会让 Runtime 拥有 GUI 的生命周期，方向与 Human Delivery 自己拒绝客户端依赖的理由相反。
>
> **连接的字节一个没改**：沿用既有 Windows 命名管道，端点仍由数据目录推导（`\\.\pipe\hikari-human-delivery-<sha256(canonical(rootDir).toLowerCase())[0..16]>`），线格式仍是「一行一个 JSON 字符串数组」，上限仍是 64 KiB，三个结局仍是 `ended` / `absent` / `unavailable`，**单订阅者语义按字面不变**。`Human Delivery` **没有**为它加 queue / history / retry / multi-subscriber。
>
> **重连是本地状态机，且 reconnect ≠ message retry。** `Disconnected ⇄ Connected`，节奏 1→2→4→8→10 s，连上即重置；`absent` / `ended` / `unavailable` 三者**都**回到 Disconnected 并重试，Surface 不退出。断线期间的消息**不补投、不伪造**——重连恢复的是「听下一条」的能力，不是一次投递保证。
>
> **消息逐字不被改写。** 真机上把两侧的原始字符取出来比对过：窗口里的正文与 `hikari subscribe` 抓到的 payload **逐行逐字相同**，差异只有两处 Surface 自己的 chrome——一行 `收到 HH:mm:ss`（明确标注是**本进程收到它的时间**，不冒充 occurrence 时间，后者本来就在 Language 的正文里），以及行分隔符。这个程序被允许断言的每一个字都集中在 `SurfaceChrome` 一个文件里，且全部是**接口状态词**，没有一句是关于世界的。
>
> **一条实机撞出来、不是读出来的缺陷：LF 在那个控件里不是换行。** 窗口把整段 transcript 渲染成一整段没有换行的文字，而源码看上去完全正确。用 `EM_GETLINECOUNT` 对同一段三行文本实测：`\n`→**1**、`\r\n`→**3**、`\r`→**1**——Windows 的 edit control 只在 `\r` / `\r\n` 处断行。治法落在构建该控件文本的那一处（`SurfaceChrome.Transcript`），因为**行分隔符是这个控件的要求，不是消息的性质**。
>
> **它没有能力持久化任何东西。** 全源码扫描：整个 surface 里只有**一处** IO，就是那根管道——没有 `File`、没有注册表、没有环境变量读取、不 spawn 进程、没有 HTTP 客户端。消息列表 200 条封顶、随进程死亡，`transcript` 每次从快照整体重建而不追加。**这比「它选择不持久化」强**：后者是一条要记得遵守的规则。不进 Chronicle、不叫 Memory、不叫 Conversation History、不建数据库。
>
> **两个生命周期互不拥有。** 「退出」只调 `ExitThread()`，源码里没有任何通往 `hikari stop` / Runtime 的路径。真机十二步 E2E 里：`hikari stop` 之后 Surface 进程存活并如实显示 `未连接 · 正在等待 Hikari…`；新 resident 起来后约 **1407 ms** 恢复 `已连接`；点「退出」之后 resident **仍在运行**，13 个插件仍 `active`。托盘菜单恰三项：状态行（禁用）/ `打开` / `退出`。
>
> **长期运行是测出来的，不是断言出来的。** E2E 那次只连续跑了约 6 分钟，**不把 6 分钟说成长期**，因此另起了一次 soak：Surface 连续驻留约 **14 分钟**，其中做了 **12 次「停 resident → 重启」重连循环**（只按本轮自己起的确切 PID 停止，绝不用名称或通配匹配）。结果两条：**12/12 次 Surface 均未退出**；句柄前 4 次从 360 升到 379（约 +4.75/次），**第 5–12 次在 375–379 之间走平、不再单调上升**，内存同样由爬升转为在 56.6–60.6 MB 之间震荡——**前 4 个样本给的答案与后 8 个相反，只看前 4 个就会误判成泄漏**。12 次重连后未读数仍是 **2**，重连**没有重放任何消息**；窗口里读出的两条正文互不相同（无输入时长下界 296406 ms vs 163219 ms），证明是两次真实观测而非重放；整个 soak 假模型端点仍是 **0 字节**。**但 14 分钟不足以宣称「绝不泄漏」**——足够宣称的是「12 次重连不累积」，这两句不能互相顶替。
>
> **一个好消息，值得单独写：desktop-return 的正文不是模型产出，整个 E2E 没有连过任何外部服务。** 假模型端点的请求日志是 **0 字节**，而消息完整抵达——`desktop-return-speaking@1` 由 `renderSpokenReturn` 确定性渲染。配置上必须给 `--model-endpoint`，但这一轮一次都没有用到它。
>
> **诚实的反面同样要写下来三处。** （一）**balloon 是否真的被渲染、是否被人看见，本进程无法观测**——与 Toast 同一个结构性限制，因此只写「平台收下了」，不写「Human 看到了」；可见提示里**确定性**的那一半是托盘 tooltip 与窗口未读行，它不依赖通知有没有被渲染。（二）**C# 侧确实是投递协议的第二个实现**，这不是能靠措辞变成免费的东西——`protocol.ts` 自己就写着「the second one is the copy nobody re-reads when the first changes」。对策是让它成为**被检查的副本**：conformance 测试用真实 Node `encodeDelivery` 产出的字节喂 C# 解码器、反向差分 15 条接受/拒绝判定、端点推导 6 种拼写逐字比对。**残余风险照实记录**：C# 只实现读的一半（Surface 从不写管道），且用例表是**有限枚举**，TS 侧若改变 framing 且新行为落在枚举之外，这些测试不会红——**这一条没有对症的治法**，它是记录在案的残余风险，不是已修项。（三）**GitNexus 这一条，本轮先说错过一次，更正后的读数反而更强。** 初稿断定「`apps/human-surface/**` 不在图内、GitNexus 对本轮不可答」，依据是 `context({name:"TrayApplication"})` 返回 `Symbol not found`。**那条推断是错的**：真因是索引自 `494de2b` 之后就没再重建，而 `apps/` 是那之后才出现的目录——不是「图看不见 C#」，是「图还没被要求看」。重建（`added=29`）后它覆盖 `apps/human-surface` 全部 **32 条路径**、**245 个 symbol**，于是边界主张第一次有图可查：**两个方向都查了跨目录边**（只查一个方向的「空」可能只是查反了），`apps/ → src/` 与 `src/ → apps/` **都是 0 条边**——而且这个空**非空洞**，apps 那侧有 245 个 symbol 垫底。`impact` upstream on `Quit` = `LOW` / `epistemic: exact`，上游两步就到顶（构造函数 → `Main`），**全部在 `apps/` 内部**，这是「Surface 关不掉常驻」的直接图证据而非自述。**图到此为止**：它看见的是 calls / imports，而 Surface 与 Runtime 之间真实的耦合是**一根命名管道的路径字符串**——静态图本来就看不见，所以「0 条边」支持「没有代码级耦合」，**不能**独自支持「没有运行期耦合」；后者仍由源码级结构证明与真机 E2E 承担。**三条证据各管一段，不互相冒充。**
>
> **验证分层，且不互相冒充。** 本机 Windows：C# **38 passed / 0 failed / 0 skipped**；Node 全量 **655 tests / 651 pass / 0 fail / 4 skipped**（三个 `*.live.test.mjs` 需要真实模型端点）。Linux（WSL，.NET 8.0.425，暂存副本**实跑**而非假设）：**28 passed / 0 failed / 10 skipped**，每个 skip 都带书面理由。CI 由单 job 改为双 job：`ubuntu-latest` 跑核心测试，`windows-latest` 构建 WinForms shell 并跑全部用例——**「CI 不跑 Surface」不是完成状态**，而一个只在作者机器上发生过的构建不算已知能工作的构建。**CI run `36518505311` 两个 job 全绿**：`surface`（windows）`Build succeeded.` + **38 passed / 0 failed / 0 skipped**，与本机逐字相同；`test`（ubuntu）Node 侧 655 tests / 563 pass / 0 fail / **92 skipped**、C# 侧 28 / 0 / 10。本机 4 个 skip 与 CI Linux 92 个的差额是**同一套 skip 规则在两个平台上各自生效**（差额全是命名管道用例），`fail` 两边都是 **0**。
>
> **没有进入的东西，且未被预埋：** Human → Hikari 方向的对话（v0 只有 Hikari → Human）、salience / importance / 该不该通知的判断、Memory / Presence / Chronicle reader、对 Language 输出的任何改写、repository / input activity / Work Focus 的读取、模型调用。也**不做** installer / MSIX / AUMID / auto-start / release channel / self-update——手工起一个 exe 就是全部，零 NuGet。**加了一个 C# 项目不是 L3 trigger**，本轮不因此自动升级 Architecture Review。
>
> **口径更新（HUMAN SURFACE LANGUAGE CLIENT v0 之后）：上段的第一个「没有进入」已不再成立。** Human 现在可以在 Surface 的输入框里主动打一句话，送往**既有的** Language-owned endpoint，答复回到**同一个** Surface。解除依据是两条 Human 裁决（YES：Human Surface 就是 Human 可以主动对 Hikari 说话的 Windows 入口；形状 A：Surface 直接成为现有 Language-owned endpoint 的 client，**不选** B，不增加 composition router / generic ingress binding）。**其余各项逐条仍然成立**，且新增一条同向的：Surface 仍然**只是 client**——不获得 Language ownership，不理解任何 domain semantics，不解析 `reply.lines` 的内容、不判断一句话该给谁、不缓存不重放、不把 `outcome` 合并或改名。**按 `governance-rules-v1.md` R7.2，上面这段原文保留不改**，取代它的记录见下方新增块与 `docs/architecture/human-surface-language-client-v0-implementation-boundary-freeze.md`。

> **HUMAN SURFACE LANGUAGE CLIENT v0 已实现、已通过 Functional / Architecture Review**（**工作标签，不占用阶段编号**——**不是** P4-04，**不是** P4-03 的一部分）。边界冻结、真机 E2E 记录、两道 Review 与两条 finding 的处理全在 `docs/architecture/human-surface-language-client-v0-implementation-boundary-freeze.md`（§11 E2E、§12 Functional、§13 Architecture、§14 findings）。
>
> **它交付的是一句话的实现：Human 可以在 Surface 里对 Hikari 说话。** HUMAN SURFACE v0 之后，人已经不需要开 PowerShell 窗口等 Hikari 开口；但那个窗口**只能听**。现在它有输入框和「发送」，走的是 `hikari ask` 走的**同一个** Language-owned endpoint——不是第二套协议，不是新的 communication plane。
>
> **`src/` 本轮 0 diff，Runtime 一个字节未动。** Surface 是那根管道的**第二个外部 client**，与 `hikari subscribe` 同类。C# 侧新增的四件东西全是**消费既有公开面**：`LanguageEndpointPath` ← `endpoint-path.ts`（`index.ts:74` 明确为 client 导出）、`LanguageFraming` ← `protocol.ts`（`index.ts:89-96`）、`PipeLanguageAsker` ← `cli/ask.ts`（该文件本身就是 client）、`PipeEndpointPath` ← 既有 `DeliveryEndpointPath` 的**去重**（抽它的唯一理由是原注释自己写着「a real cost rather than a design」）。**没有一处**自己决定端点路径、线格式、等待界这三件事中的任何一件。
>
> **150s 上界照抄，没有自行缩短。** `REPLY_TIMEOUT_MS = (3+1)*15_000 + 90_000 = 150_000 ms` 是 `src/cli/ask.ts` 推导出来的既有 client upper bound；C# 侧允许写死它的三个来源常量，理由是**并有且只有一个**——conformance 测试从 `dist/cli/ask.js` 读**真实的 `REPLY_TIMEOUT_MS`** 并断言相等，owner 的界一变 C# 就红，而不是静默漂移。WinForms **全程异步**（UI 线程只做 `_ = session.AskAsync(...)`，没有 `.Wait()` / `.Result` / 阻塞读）。**一次只允许一个 ask in-flight，规则由 session 强制**（`if (_asking) return false;`），不是只靠 UI 禁用按钮；pending 时**只禁用再次发送，不冻结窗口**。
>
> **transcript 把三种来源分开，靠的是主语而不是领域知识。** `SurfaceMessage` 增加了 `Origin`：`Human`（我自己打的，只有 Surface 知道）、`Hikari`（经管道到达，原样显示）、`Surface`（**我关于自己的话**，用于 `absent` / `unavailable` 这类必须由 Surface 用自己的话说出口的提示）。**第三个值是实施时被迫加的，如实记录在冻结文档 §6，不是事后追认**：没有它要么把「我没够到 Hikari」冒充成 Hikari 说的话，要么人打出一句话后屏幕上什么都没有。**只有真正的到达计 unread 与触发 balloon**——「有未读」是关于人的注意力的主张，人不该被自己刚打的那行占用。**不区分 proactive 与 reply**：那件事是 Hikari 内部的事，Surface 能确证的区分只有「这句话是不是我自己打进去的」。仍然**仅 process-local**，不落盘、不追加 Chronicle、**不叫 Memory / Conversation History**；整轮真机跑完之后数据目录里**仍然只有 `chronicle.jsonl` 与 `origin.json` 两个文件**。
>
> **两条主张都在真实 Windows 上跑出来了，输入与读取全部走 UI Automation**（`ValuePattern.SetValue` 塞句子、`InvokePattern.Invoke` 按发送、`TextPattern` 读回），**没有一步调用应用自己的类型**——直接调 `AskAsync` 会是关于 session 的证据，不是关于窗口的。**主张一**：14:10:10 打进去的那句含 emoji / 引号 / 反斜杠的话，逐字从同一个窗口读了回来（`questionReadBackVerbatim = true`），回执到达后发送恢复可用，未读 0→**1**（只有到达计数）。**主张二**：`delay:12000` 让答复被压住十二秒，中间注入一次**真实输入事件**后，B 时刻窗口里多出 `收到 14:11:18` + `Desktop return attention：… 触发时的关注对象：t1mb2rg/hikari-new`，而发送按钮**仍然是禁用的**（未读 2→3）；十二秒后答复到达（14:11:25），发送恢复（未读 4）。时间顺序是**人那句 → 主动那句 → 答复**。假端点一共收到 **3 个请求**（一次 ask 一个），那条主动消息**0 个**——它仍由 `renderSpokenReturn` 确定性渲染。
>
> **主张二的第一次尝试失败了，失败原因值得留档。** B 时刻窗口毫无变化，未读停在 1——原因不是 Surface 也不是 pending 语义，是那个新初始化的数据目录里**从来没有声明过工作焦点**（语言插件自己的措辞：「没有声明关注对象时它不说」）；`hikari focus declare` 之后重跑，同一条路径一次就出来了。**这条是独立证据**：那次播报不是 harness 能催出来的东西，它是一个由「真实声明 + 真实输入事件」共同决定的条件式输出，一个能凭空造出这句话的假 harness 不会先失败一次。
>
> **不得读成的东西。** （一）**语言侧用的是本地假 endpoint，不是真实模型**（本机没有真实模型端点，见记忆 `no-external-model-endpoint`）。这一轮证明的是**路径**——Surface → 语言端点 → Language → Surface——**不是**任何关于模型的行为，**不得写成对真实模型的 PASS**。（二）**评审把两条候选 finding 锚回源码后都确认成立，severity 均为 LOW，两条都已修**：`LanguageLineReader` 与自己声称镜像的 TS reader 有第二处未写明的差异（C# 消费缓冲区，`protocol.ts` 不消费——产品路径不可观察，因为 `endpoint.ts` 的 `served` 保证一行之后不再 push，因此**不改行为、改注释**）；`ReadObject` 不 dispose `JsonDocument` 而给出的理由是假的（element 从不逃出 `DecodeReply`，同目录的 `DeliveryFraming.Decode` 用的是 `using`）。修完之后 C# 全套仍 `69 passed / 0 failed`，真机记录是在修完之后的树上**重跑**的。（三）**C# 侧现在有两个被检查的协议副本**（delivery 与 language），`protocol.ts` 自己写着「the second one is the copy nobody re-reads when the first changes」——对策与上一轮相同：conformance 测试用**真实 Node** 产出/读回，不比对措辞只比对接受与拒绝、以及接受时的 payload 相等。**残余风险照实记录**：用例表仍是**有限枚举**，TS 侧若改变 framing 且新行为落在枚举之外，这些测试不会红。
>
> **没有进入的东西，且未被预埋：** retry / queue / history / ack / 多问题并发；停止或取消 in-flight ask 的 UI；**任何 Shape B 的 composition 绑定**（不增加 composition router / generic ingress binding）；Service；generic Human Input / `HumanStatement`；对 Language 输出内容的任何解析、合并、改名、缓存或重放；显著性 / 重要性 / 该不该通知的判断。**没有新的 L3 trigger**（无新 public contract、无新通信平面、无跨 Runtime、无新全局状态、不碰 Memory / Goal / Action 核心语义），按裁决**直接实现，未再开 Architecture Review**；两道 Review 按 `CLAUDE.md` §8 在同一份冻结文档里成文。
>
> **HIKARI BOOTSTRAP / LAUNCH EXPERIENCE v1 已实现、已通过 Functional / Architecture Review、已提交**（**工作标签，不占用阶段编号**——**不是** P4-04，**不是** P4-03 的一部分）。它处理的是一处**产品入口**摩擦：`hikari` 此前每次都要人回答「用哪个数据目录」，而那个问题的答案对同一个人在同一台机器上几乎总是同一个。
>
> **它交付的是一条启动路径，不是一个新组件。** 裸 `hikari` 现在：先要终端 → 解析数据目录 → 问常驻在不在 → 在就进 TUI → 不在且**已有启动配置**就按配置启动并**等到它应答**再进 TUI。默认目录在 Windows 上是 `%LOCALAPPDATA%\Hikari\resident`，**只由平台推导**：不扫描兄弟目录、不记「上次用过」、没有用户级配置文件、不从 cwd 推断。非 Windows 上这个函数返回 `undefined`，裸 `hikari` 在那里**逐字保持原行为**（TUI 自己问）——**没有**为了本轮扩成跨平台配置框架。显式 `--data-dir` 永远优先，且**优先在本层之外**：argv 解析层不写默认值，默认值是启动层回答的一个问题。
>
> **它是 CLI 最外面的一层包装，不是第二个长期运行组件。** 新文件只有 `src/cli/bootstrap.ts` 一个，它 import 的既有函数可以点名数完（`requestControl` / `readLaunchProfile` / `launchArguments` / `renderLaunchArguments` / `spawnDetached` / `terminalRequired` / `tuiCommand`）；`spawnDetached` 只多了一个可选参数（`onExit`，一行 `child.on('exit')`），TUI 自己的 `/start` 调用点**逐字未改**。**没有**第二个 Runtime、**没有**常驻 Launcher daemon、**没有** Resident supervisor、**没有** Plugin manager、**没有** Service locator、**没有**配置发现平台、**没有**新协议，`src/runtime/` 一个字节未动。Bootstrap 不知道任何 Plugin 的业务语义——它读的那份配置是「怎么把常驻起来」的启动参数，不是任何一个领域的语义。
>
> **两处诚实性是这一轮的功能，不是措辞。** （一）**启动失败必须说出来**：`spawnDetached` 按设计不给子进程留管道，所以常驻在启动途中死掉时它一句话也说不到这里——因此本层等的不是时间而是**常驻自己的控制通道**，四种结局（`started` / `spawn-failed` / `exited` 带退出码 / `timed-out` 带上界）各自说各自的话，超时那条还给出「它可能还在启动，稍后 `hikari status`」而不是含糊其辞。**没有任何一条分支会先启动一个东西再把成功报出来。**（二）**没有配置时不猜**：数据目录里没有启动配置时报的是一句话加三条可粘贴的命令（`hikari init` / `hikari chronicle init` / `hikari profile set`），源文件里写明「不会替你猜模型端点、模型名或凭据」。配置存在但读不出来是**另一种**状态，报的是 reader 给的原因与文件名，**不重启一段自己的解释**。
>
> **生命周期互不拥有，两个方向都实测。** 常驻**不被**本层托管：所以退出 TUI 不停止常驻，常驻也不会在窗口关闭时被拉起来；人在 TUI 里按过停止之后**没有任何东西**会把它拉回来（无 supervisor）。**同一轮启动内的重复 spawn 由一次 fresh `status` 读挡住**——就是 TUI 的 `/start` 已经在用的那一次（§3 要求复用已有并发保护，本轮**没有**新造通用进程锁平台）；跨进程的两个 `hikari` 同时启动时最坏情况是一个起不来的多余进程，这一点写在源码注释里而不是被说成已解决。
>
> **17 条新测试（`test/bootstrap.test.mjs`），覆盖 §6 的 12 项要求；全量 `778 tests / 774 pass / 0 fail / 4 skipped`**（本轮之前是 761 / 757 / 4）。真实进程的部分不是 mock：`有启动配置但没有常驻` 与 `真实启动` 两条走的是真 `spawnDetached` + 真命名管道 + 真等待，`常驻起来了又退出` 拿的是真实常驻在未初始化数据目录上的真实退出码 1。**两处定向变异都 RED**：摘掉终端拒绝 → 裸 `hikari` 真的在管道里拉起了一个常驻（断言 `absent` 拿到 `answered`）；摘掉「已应答的常驻不再启动」→ 启动计数 1 ≠ 0。另有两条超出 §6 清单但由 §1 逐字要求的用例：**常驻在跑时清掉启动配置仍然直接进窗口**（启动配置说的是怎么启动一个常驻，不是怎么跟一个已经在跑的说话），以及**平台给不出默认目录时连控制通道都不问**（`absence` 原样交给 TUI，仍是它一直在问的那个问题）。
>
> **一处本机事实，必须与「已验证」这个说法一起读：本机没有 pty**（`winpty` 存在但报 `stdin is not a tty` 并退出 1）。因此 `hikari` 的**完整交互路径只验证到进窗口之前那一步**——每次 `bootstrap` 调用都把 `enterTui` 换成一个记录用的桩，被替换的**只有窗口**，环境（`stdin/stdout.isTTY`）是打桩的而代码不是；**进入 TUI 之后那一半、以及「退出 TUI 之后常驻还活着」的交互式验证，本机为 NOT RUN**，其中之一改为用真实 `hikari` 进程验证「窗口进程来去之间常驻一直在」（该进程因无终端而在拒绝处退出，留下的常驻仍应答）。`hikari > file` 这条路径反而是本机**能**端到端驱动的，因为拒绝发生在解析与启动之前——这也是那两句拒绝为什么必须排在最前面的可执行证据。
>
> **图证据与它的读法**：`terminalRequired` impact **HIGH / 6**，直接调用者恰好两个（`bootstrap` 与 `tuiCommand`）——与源码注释里「两个调用者、一句拒绝」逐字对上；`bootstrapCommand` **LOW / 1**（唯一调用点是 `main.ts:execute` 的 `tui` 分支）；`spawnDetached` 报 **CRITICAL / 10**，但真实调用点只有两个（TUI 的 `/start` 与本轮新增的 `launchAndAwait`），计数来自图把 `runTui` 内层函数当作独立符号递归计入。**CRITICAL 照实报告，不由 `riskSharedAxes` 豁免**，其收敛依据是 diff 本身（一个可选参数 + 一行 `child.on('exit')`）与 `import` 环检测 `clean`。`detect_changes(scope: all)` 无 `partial` / `truncated`，其 `changed_files: 3` **不含**两个新文件（未跟踪，git diff 看不到）——这是本仓库既有的可见性限制，不是「没影响」。
>
> **CHANGEABLE REPOSITORIES READ v0 已实现、已通过 Functional / Architecture Review**（**工作标签，不占用阶段编号**——**不是** P4-04）。边界冻结、两道 Review、四条 finding 与一处跨语言后果全在 `docs/architecture/changeable-repositories-read-v0-implementation-boundary-freeze.md`（§1–§10 冻结面、§11 跨语言等待界、§12 Functional、§13 Architecture、§14 findings、§15 commit 门禁）。
>
> **它交付的是一句话：Hikari 能读它被授权读的仓库，然后把「该改什么」说出来，而它自己不落笔。** 授权的声明面（`hikari change declare|replace|clear|status`）是上一片交付的；这一片让那组目录**第一次有读者**——`changeable-repositories.read@1` 的 `roots()` 与 `read(target)`，Language 是它的真实调用方，所以 Contract Creation Gate 今天满足，而不是「也许以后有人要」（先例是 `desktop-content-read.read@1`）。**提议面刻意没有实现**：行动片（参数是人话、要落笔）被组合边界评审判为 `BLOCKED`，见 `docs/architecture/authorized-repository-action-v0-composition-boundary-review.md`。
>
> **owner 归属是这一片最要紧的形状**：目录集合的语义、路径归属判定、两个上限、给模型看的五句话全在 `changeable-repositories`；Language 只做三件事——按 exposure 的**声明**生成参数 schema、把参数交给 owner、把 owner 返回的每一行转义。`src/language/read.ts` 两条新分支调用的都是 owner 导出的 renderer（`renderAuthorizedRepositories` / `renderRepositoryRead`），**Language 没有自己写任何一句给模型看的话**。注入纪律照旧：仓库正文是继窗口字节之后第二个低信任来源，以 `tool` 回复到达，owner 的固定 frame + 逐行转义。
>
> **循环被改的一处语义**：「已读过」从按**能力名**改为按**调用身份**（name + arguments）——零参能力时代这两句话恰好是同一句，有了参数就不是了：两个文件是两次调用，同一个文件读两次是同一件事。这是本构建第一个带参数的能力，所以它也是第一个必须回答这个问题的地方。**按构造终止**靠新增的 `MAX_READS_PER_INTERACTION = 8`（本片唯一一个新数字）：每次执行的调用恰好加一个键、同一个键不会加两次，所以键集合的大小**就是**这一轮的读数——不是一个新的 budget framework，`src/language/model.ts` 保持 0 diff。
>
> **测试与一条反证实验**：新增 `test/changeable-repositories-read.test.mjs`（15 条）；`test/language.test.mjs` 加 3 条循环级用例（去重键、8 次预算、注入 fixture）与参数解析用例；三个 live 语料按「**扩表而不是放宽守卫**」补齐新能力。**定向变异 RED**：把 `src/language/answer.ts:421` 的 `performed.add(reading.key)` 改回按名字去重，两个用例各自以它声称要钉住的那个机制失败（重复的第三次调用被执行了；预算计数永不增长因而十次全读），改回后全绿——**测试在约束行为，不是只跑通**。全量 `905 tests / 901 pass / 0 fail / 4 skipped`（改前 887 / 883 / 0 / 4）。
>
> **一处片外后果，跨语言门禁按设计响了**：`LANGUAGE_EXPOSURES` 2→4、仓库列表 3→5，于是 `src/cli/language.ts:114-117` 的 `LONGEST_EXPOSURE_COUNT` 从 3 变 5、`REPLY_TIMEOUT_MS` 从 `(3+1)*15_000 + 90_000 = 150_000 ms` 变成 `(5+1)*15_000 + 90_000 = 180_000 ms`。C# 侧把那个数**写死**（.NET 问不到 TypeScript 的数组长度），所以 `dotnet run --project apps/human-surface/HumanSurface.Tests/HumanSurface.Tests.csproj` 报 `the client's whole wait bound: expected 180000, was 150000`。处理：`PipeLanguageAsker.LongestExposureCount` 3 → 5、其 remarks 的 holds two / holds three 改为 four / five，重跑 **69 passed / 0 failed / 0 skipped**。**三处落到文档里的旧数字保持原文不改**（本文件 `:205`、`docs/architecture/human-inbound-v0-boundary-review.md:363`、`docs/architecture/human-surface-language-client-v0-implementation-boundary-freeze.md:110` 是各自那一片的记录），**指针以本条为准**。
>
> **图证据与它的读法**：`detect_changes --scope all` 报 `14 files / 59 symbols / 28 processes / Risk level: critical`，无 `partial` / `truncated`。**CRITICAL 照实报告，不由 `riskSharedAxes` 豁免**：它来自这次改动的**跨度**（语言工具循环 + 两个 variant + 跨语言的等待界），不是来自任何单点的调用面——编辑前逐符号 `impact` 的结果是 `readCall` **LOW**、`ExposureReader` **LOW**、`createExposureReader` **LOW**、`LanguageExposure` **UNKNOWN**（空调用集不作为证据，用文本检索确认：19 处命中全部落在 `src/language/{tools,read,answer,plugin,index,express,exposure}.ts` 的**类型位置**，唯一读值是 `src/language/express.ts:372` 的 `.name`）。
>
> **两条 finding：一条已由 Human 追认，一条留档不改**：F-1 实现多出一条人可见字面 `DIRECTORY_TRUNCATED`（§3.5 冻结的是五条字面，第六条是目录项数超限的提示行；把文件那句用在目录上会让模型以为读到的是文件正文）——**Human 于 2026-10-13 复核后确认照此保留**，自此该字面与 §3.5 那五条同级属于冻结面，指针加在 §3.5、理由记在 §13；F-2 `outside` 只在路径**存在**时返回，于是模型能用绝对路径区分「存在但在授权外」与「不存在」——它不泄露正文，但泄露了本机某条路径是否存在，按 §6.2 的结果闭集实现，**不在本片修**。
>
> **提交**：`ec2439d`，已 push；CI Runtime Tests #38423855497 **success**（`test` 与 `surface` 两颗 job 都 success）。工作区 `git status --short` 为空。
>
> **CHANGEABLE REPOSITORIES SEARCH v0 已实现、已通过 Functional / Architecture Review**（**工作标签，不占用阶段编号**——**不是** P4-04）。边界评审、待冻结字面、两道 Review、四处 finding 与 commit 门禁全在 `docs/architecture/changeable-repositories-search-v0-boundary-review.md`（§0–§9 评审面、§10 Functional、§11 Architecture、§12 findings、§13 门禁）。
>
> **它交付的是一个动词：找。** 真机验收里问「我 change declare 的那个仓库被存在哪里」，模型七次读取全部落在目录列举上，从没打开那些写着答案的文件——`authorized_repository_read` 只能回答「这一个路径是什么」，而它需要的是「哪里有」。这一片给 `changeable-repositories.read@1` 加第三个方法 `search(needle)`，模型可见能力 `authorized_repositories_search`。**contract 不换**：同一个 Service 加一个方法，版本仍是 `changeable-repositories.read@1`，两个既有方法一字未改；两份 exposure 列表各多一项（`LANGUAGE_EXPOSURES` 4→5、`LANGUAGE_REPOSITORY_EXPOSURES` 5→6），variant 数仍是 2。
>
> **第三个能力自己声明 `method: 'search'`**：有了两个「一个具名字符串参数」的能力之后，「带不带参数」不再能区分它们，而 `src/language/read.ts` 逐字写着不去比较一个写在自己这边的名字——判别必须来自 owner 自己的声明（`'method' in exposure` 交给 TS 收窄，不比较任何字符串）。这是本构建第一次出现「同一个 contract 的三个方法需要被区分」，所以它也是第一次必须回答这个问题的地方。
>
> **遍历自己走，不交给 `git grep`**：被授权的目录不要求是 git 仓库；而且 `git grep` 会静默遵守 `.gitignore`，把「没找到」变成一句假话。四个上限 `MAX_SEARCH_MATCHES = 50` / `MAX_SEARCH_FILES = 1000` / `MAX_SEARCH_BYTES = 4 * 1024 * 1024` / `MAX_SEARCH_MATCH_TEXT = 200`，撞上哪一个由 `truncatedBy` **报出来**而不是被吸收（照 `src/desktop-content-read/types.ts:40-59` 的先例）；符号链接**根本不跟随**（包含性由构造保证，不靠事后判定）；不调用任何外部命令；不写任何东西。跳过 `.git` 与 `node_modules` 的那行提示是**模板**（`（跳过了 ${names.join(' 与 ')}。）`），两个都跳过时逐字等于已批准的那句话，只跳过一个时也不说假话。**「没找到」那句只在覆盖走完时才写**——覆盖不全时说它就是假话，此时由覆盖截断那一句承担全部含义。
>
> **反转一条写在冻结面里的拒绝**：read 冻结面 §8 第 4 条写着「不做搜索能力……只有一个 `read`」。原文**一字未改**，只在其后加了一段指针（R7.2），评审 §7.5 记下这次反转与批准者。**Human 于 2026-10-14 批准。**
>
> **跨语言门禁第二次按设计响了**：两份列表变长 ⇒ `src/cli/language.ts:114-117` 的 `Math.max` 从 5 变 6 ⇒ `REPLY_TIMEOUT_MS` `(5+1)*15_000 + 90_000 = 180_000` → `(6+1)*15_000 + 90_000 = 195_000` ⇒ `PipeLanguageAsker.LongestExposureCount` 5 → 6，其 remarks 的 four / five 改为 five / six，并记下「这是它第二次红」。同一类问题的根在 TypeScript 侧也修了：`src/language/answer.ts` 里手写的 8 改成推导 `Math.max(LANGUAGE_EXPOSURES.length, LANGUAGE_REPOSITORY_EXPOSURES.length) + 3`（现为 9）——这个数字前两次都漂移过（第一次是推导写错、第二次是列表变长），第三次手写拷贝才是「从 `exposure.ts` 导出一个常量」的触发器，已记在注释里，不在本片做。
>
> **测试与两次反证实验**：新建 `test/changeable-repositories-search.test.mjs`（17 条，覆盖评审 §6.2 的十一条：没找到、只匹配一行、只匹配被跳过的目录、NUL 字节、不是文本、符号链接、两条截断各在最边界上而不在下一条、一个 root 走不进去、空 needle 不是调用、空集）；`test/language.test.mjs` 131 → **134**（两份列表的长度/成员/公共前缀/末位，加参数规则、去重、注入 fixture 三条）；三个 live 语料按「**扩表而不是放宽守卫**」补一行能力与一句新话。**定向变异两次都 RED**：`src/changeable-repositories/search.ts:257` 的行号从 1 起算改成 0 起算 → 领域文件 6 条失败；让「没找到」在覆盖没走完时也说 → 2 条失败。全量 `925 tests / 921 pass / 0 fail / 4 skipped`（改前 905 / 901 / 0 / 4）；`dotnet run --project apps/human-surface/HumanSurface.Tests/HumanSurface.Tests.csproj` **69 passed / 0 failed / 0 skipped**。
>
> **图证据与它的读法**：`detect_changes --scope all` 报 `14 files / 60 symbols / 21 processes / Risk level: critical`。CLI 的文本输出按自己的显示上限只列前 15 个符号与 10 条流程（`... and 45 more` / `... and 11 more`），加 `--limit 200` 后**汇总行一字不变**，且该 CLI 在本仓库没有 `partial` / `truncated` 字段（那是 MCP 层的输出）。**CRITICAL 照实报告，不由 `riskSharedAxes` 豁免**：它来自这次改动的**跨度**（`changeable-repositories` 的第三个方法与新 exposure、`language` 的两份列表 / reader / 两处接线 / 预算推导、`cli/language.ts` 的自动跟随、C# 一个常量、两个测试面），不是来自任何单点——改前逐符号 `impact` 为 `createExposureReader` **LOW**（`impactedCount: 3`、`direct: 2`、`processes_affected: 2`）。
>
> **四处 finding**：F-1 `MAX_SEARCH_BYTES = 4 MiB` 在 `hikari-new` 自身**每次都撞上**（三个 needle 三轮全部 `truncatedBy: 'bytes'`，含一个什么都不匹配的 needle；而墙钟只有 1–3 ms——耗时来源是**文件数**，1000 个文件的用例约 530 ms），于是回答里永远跟着「文件比一次能找的多」，「没找到」那句在有内容的仓库上永远不会出现——**实现按评审原样交付，口径留 Human 定**（保留 / 上调字节上限 / 只留文件数上限）；F-2 三处落到文档里的旧等待界数字保持原文（本文件 `:205`、`docs/architecture/human-inbound-v0-boundary-review.md:363`、`docs/architecture/human-surface-language-client-v0-implementation-boundary-freeze.md:110` 是各自那一片的记录），**指针以本条为准**；F-3 `PipeLanguageAsker.cs:29`/`:53` 两处指向已不存在的 `src/cli/ask.ts`，片外不改（read 那片记过的同一条）；F-4 frame 落在 `read.ts` 而不是评审 §3.1 写的 `search.ts`——落点偏离而不是行为偏离，理由是同一条回复的固定行只有一个 owner，且反向 import 会成环。
>
> **提交**：`6fed7cb`，17 files changed / 1745 insertions / 87 deletions，已 push；CI Runtime Tests #38434259679 **success**（`test` 与 `surface` 两颗 job 都 success）。**真机那一次（评审 §6.5）由 Human 跑**——本片不承诺它能答出那个验收问题，只承诺模型从今天起有了「找」这个动词。
>
> **2026-10-14 交付后修订（真机实测之后，Human 两次裁决）：上一条的 F-1 已关闭。** 真机上六次搜索全部零命中，量下来原因不是「有点慢」：跳过 `.git` / `node_modules` 之后本仓库可扫正文 **40.7 MiB**（`.gitnexus` 一个目录占 26.5 MiB，其成员 `lbug` 是 51.9 MiB 的二进制），按 `readdirSync` 的顺序 4 MiB 预算在 `docs/` 里花完，**`src/` 从未被打开**——那个上限在真实仓库上只降低覆盖、几乎没买到时间。Human 批准两处修订：**三个上限改成 `MAX_SEARCH_FILES = 2000` / `MAX_SEARCH_BYTES = 32 MiB` / 每文件 `MAX_SEARCH_FILE_BYTES = 1 MiB`**（单个文件超限就**不扫它、不结束遍历，并由回复如实报出被跨过的条数**——这是 F-1 那四个口径里都没有的第五条，形状由他给）；**跳过清单加 `.gitnexus` 与 `.serena`**（四个名字时的字面是「（跳过了 .git、.gitnexus、.serena 与 node_modules。）」，两个名字时的字面与已批准的那句**逐字相同**）。修订后同一个仓库**走完了**：1011 文件 / 13.8 MiB / 0 超大 / 8 命中 / 不截断 / 墙钟 **71–72 ms**，命中落点包含 `src/changeable-repositories/history.ts:29` 与 `facts.ts:90`——正是修订前看不到的那两个文件。
>
> **修订后的复核不是沿用旧结论**：全部重跑——`npm run build` exit 0；`npm test` **927 tests / 923 pass / 0 fail / 4 skipped**（+2 是新领域用例）；`dotnet run --project apps/human-surface/HumanSurface.Tests/HumanSurface.Tests.csproj` **69 passed / 0 failed / 0 skipped**；领域文件 17 → **19 全绿**；`test/language.test.mjs` **134 条不变**（本轮一个字没动它）。**第三、四次定向变异都 RED**：每文件上限从「超过」改成「达到」→ 领域文件 2 条失败；从跳过清单里去掉 `.serena` → 1 条失败。**没有重跑的复查如实记下**：评审 §10.2 的两次变异（行号起算、「没找到 / 没找完」）针对的是本轮没碰的那两行，因此没有重跑。
>
> **架构判断与治理记录**：唯一被动的 public surface 是 `RepositorySearch` 的 `searched` 分支多了 `readonly oversizedFiles: number`（**加法**，不是改形；`SearchBound` 仍是三值闭集——撞上每文件上限**不结束遍历**，把它算进「本次到此为止」会用错词）；没有新 exposure、没有新参数、没有新持久状态，`src/runtime/` 仍 0 diff。**R7.2 的记法**：评审里所有旧承诺**原文一字不改**，改动、旧值与批准者记在新增的 **§7.6（三个上限）/ §7.7（跳过清单）**，§3.5 的逐字表、§5.2 的代价算术、§6 的验收清单各加一段**指针**；§6 那句「`.git` 与 `node_modules` 子树被跳过」的验收项**本身仍然成立**——它断言的是行为，不是「清单只有两个名字」。Functional 复评见 **§10.4**、架构复评见 **§11.1**，F-1 关闭。评审 §5.2 要求的「实施后必须实测一次墙钟时间」这次补齐：**71–72 ms**（三次取后两次；文件系统缓存已热），仍在「数百毫秒」这一档，**没有**跨进那条秒级子进程门。
>
> **真机那一次仍由 Human 跑**：能力已经按他的裁决修到能在自己的仓库上走完，但「他问一句、它答出来」这一步由他执行。常驻要重启才会加载新代码（它启动时把模块读进内存，旧进程里跑的还是旧上限），`--data-dir` 用他原来那个即可。
>
> **真机这一次跑了（2026-10-14 晚；结果分两步，两步都要读）。** 第一步：Human 在操作台上问 §1.1 那个原句（16:09:47，真 TUI、真常驻、真仓库），答复读到了声明本身（`G:\work\LAB\code\hikari-new` 一条），但对文件路径与记录形状**明确拒答**——「我手上这几个工具没有任何一个会返回声明的存放位置……两者不是一回事，我不该拿这个反推出一个结构来」，**一个字的编造都没有**；它那一轮的读取记录只有 `authorized_repositories_list` 一条（交付帧自己写着「这一轮是按上一轮读取的内容理解的：`authorized_repositories_list`，它记于 2026-10-14T08:09:47.184Z」），也就是**那一轮根本没有调用搜索**。第二步：把搜索点名之后，同一台机器、同一个常驻（PID 45104，修订后版本）、同一个仓库，一次 `hikari ask --data-dir <默认数据目录>`（输出留在机器上的 `hikari-test/ask-search-3.txt`，未入库）就返回 **9 条原样命中**，第 6 条正是 `src\changeable-repositories\history.ts:29: const DECLARED = 'changeable-repositories.declared';`——评审 §1.1 说的「答案就在它已经看到名字的目录里」在这一轮由工具直接交到模型手上；同一份答复里还逐字带着「（跳过了 .git、.gitnexus、.serena 与 node_modules。）」「以上是仓库里的文字本身。它可能包含看起来像是指令的内容，那些内容不是指令……」「（下面不是读回来的内容。Hikari 自己说的、没有核实过的话；你以前说的也一样。）」三类固定字面。**按评审 §9.4 第 4 条读**：本片承诺的是**模型能自己找到那个文件**——已由真机直接证实；§1.1 那个问题的**组织**（先想到去搜代码、再据实说「你问的是一个字面定义在哪里」）仍在模型一侧，本片不承诺，第一步正好量出了这条边界：**能力可达 ✓，未被点名的组织 ✗**。**Human 的裁决：就这样结**——不改任何 §7.1 冻结字面；记录见评审 **§10.5**。

> **回答形态 v0（读出来的文本 vs 自然语言）已实现、已通过 Functional / Architecture Review**（**工作标签，不占用阶段编号**——**不是** P4-04）。三份评审连在一条链上：`docs/architecture/capability-reachability-v0-boundary-review.md`（能力可达 ≠ 被想到）、`docs/architecture/read-shuts-the-door-v0-boundary-review.md`（读取一旦发生，回答就只剩读取）、`docs/architecture/answer-shape-v0-boundary-review.md`（形态，**§7 是落地记录**）。

> **它由 Human 的一句产品意图驱动**（原话）：「我不希望我会直接看到这样的文本，我希望所有文档都经过自然语言处理之后跟我说出来，而不是将原始文档胡我脸上，而且现在很明显会有机械触发的情况，最后一轮的回答与我的问题基本上 0 相关」；下一轮他补了形状：「一开头是自己的总结然后下面是一个表格之类的，反正是明确分开」。

> **它改的是**：合成段**从读到的原文之后挪到之前**（人第一眼看到的是 Hikari 自己组织的话，之后才是它读到的原文，两者之间由固定标签分开），并且**把闸门放宽**——原先只有「页面上还有记录段或窗口正文」时才允许它说话，于是「读仓库」这类只有原文的回答永远没有一句自然语言；现在只要**这一轮确实读过东西、这一步没被截断、它确实写了话**，话就会被展示。四处落地：`src/language/express.ts`（标签第一行 + 材料表三种 → 四种，多了 `'none'`）、`src/language/answer.ts`（顺序翻转 + 闸门放宽）、`src/language/prompt.ts`（读那条改成「原文逐字跟在你的回答后面」；职责句改成「你先决定还需要读什么，然后把读回来的东西说给这个人听……排在原文前面」；记录段那句改成「排在前面」；**新增第二类「不用读」**：问的是 Hikari 自己时直接回话，不要为了找材料去读）、`src/changeable-repositories/read.ts`（命中行按文件分组：路径独占一行、命中缩进两格，内容一字不变）。

> **一条冻结的 SHOULD 被明确反转**：`language-tool-use-loop-v1.md` §8 的「grounded 成功后没有自由 prose 出口」由 Human 逐字翻掉，改口为「一条窄出口：带标签、排在原文之前、只在读过东西之后」。翻转按 R7.2 写回 `docs/architecture/language-grounded-synthesis-v0-boundary-review.md` §7.1 第 1 条旁边；命中行的形状变化同样按 R7.2 记在搜索评审 §3.5 的第 4 条。**三处旧字面原文一字未改，只加指针。**

> **测试与两次反证实验（都改回，又都重跑全绿）**：`test/language.test.mjs` **134 → 135**，新增的那一条专钉放宽后的闸门（「只有读取时：模型的话照样带标签领在前面，标签说材料就是读回来的原文」，正是真机上那一类问句的形状）；14 条既有用例按新顺序与新字面重排（顺序、race、thinking D/F、注入 fixture、标签宽度 ≤ 50 列、prompt 三条新句）。**反证一**：把 `src/language/answer.ts:498` 的顺序翻回「原文在前」→ **12 条失败**；**反证二**：把闸门改回「必须有记录段或屏幕块」→ **9 条失败**，其中一条正是新增的那条。

> **验证数字**：`npm run build` exit 0；`npm test` **928 tests / 924 pass / 0 fail / 4 skipped**（改前 927 / 923 / 0 / 4）；`test/changeable-repositories-search.test.mjs` **19/19**；`dotnet run --project apps/human-surface/HumanSurface.Tests/HumanSurface.Tests.csproj` **69 passed / 0 failed / 0 skipped**。

> **本次没有动的**：那扇门本身（读取仍然一次性、不可回头）；读到的原文逐字出现这一点；`src/runtime/`（0 diff）；**两个 surface 一个字都不用改**——`human-surface-v0-implementation-boundary-freeze.md:120` 与 `hikari-tui-v1-implementation-boundary-freeze.md:100` 要求「逐行原样、不总结、不改写」，改动全部发生在语言层。

> **未做**：**matched A/B 真机**（同一句问句改前/改后各跑若干次，看第一眼看到什么、回答是否回应问句）仍由 Human 跑；他提的「**呼出一个仪表板**」属于呈现层的新面，需要单独立项，不在本片。
>
> **认知—行动闭环 v0（有界实验的**设计**，**未实现**；**工作标签，不占用阶段编号**——**不是** P4-04）**：`docs/architecture/cognition-action-loop-v0-boundary-review.md`（L2 评审，**VERDICT = NARROW**）只定义这个实验，**没有写一行代码**。它要测的是「**事实 → 有依据的相遇 → 判断 → 行动 / 验证 / 反馈**」这条链的**第二、三、四层**，三阶里程碑 = 相关 CI 失败（`repository-ci-attention` 今天已经在做）→ 形成一次有依据的局部决定 → 完成一次受约束的真实行动（`principles.md` §8 那条 Action 链的**第一遍**，含回执）。**不新建认知中心、不预设架构结论、不为结论绕过任何冻结**——真挡路的地方按 R5 正式走 Boundary Review（本文件就是那次 L2）。
>
> **它在 2026-10-15 激活了一条既有裁决，反指针已双向补上**：`docs/architecture/authorized-repository-action-v0-boundary-review.md` §8 第 5 条（2026-10-13 的 `(iii)`：**commit + push + 看 CI**，且证据栏必须包含 push 之后的 CI run 号、记录必须写明「它 push 了」）经 Human 确认**仍然有效**，是该实验里程碑 2–3 唯一要用的授权形态；**但里程碑 3 的实际写入、commit 和 push 仍需单独授权**（同上评审 §5.1 ①）。
>
> **同日两件阶段裁决（Human，2026-10-15）**：① **支持**把「执行者的第一片」纳入本阶段——依据是 `docs/architecture/hikari-nervous-system-stage-v0.md:205-207` 的 Action 条目按 R2 属 **NOT-YET**（「不在本阶段」），而它要求的那个真实需求已经出现；同一条同时明确**不创建 P4-04、不开始 Salience research**。② 确认上述 `(iii)` 裁决有效。**这两条都没有解除任何 MUST**：实验按不变量 7 / 8 的要求**走** Action 边界，因此它是**遵守** MUST，不是改 MUST。
>
> **未交付（必须与上面一起读）**：**没有**新建插件、Service、存储、事实族或 CLI 词；**未改**任何冻结裁决；**未实现**里程碑 1——它的设计边界是该评审 §8（**默认方案**：把人启动常驻时**成对**写下的 `--repository-root` / `--repository` 读进 `repository-ci-relevance`，让判断在被声明过的配对上引用**人自己的对应关系**，两条比较仍然逐字、不新增任何推断；备选「新插件持持久绑定」「扩展 `change declare`」先不做），**等 Human 确认后才动代码**。
>
> **口径更新（2026-10-15 · 里程碑 1 落地之后）**：上面说「**未实现**里程碑 1」「**没有写一行代码**」在当时为真；**里程碑 1（「事实正确相遇」）现已实现、已提交、已推送、CI 通过**——commit **`ec09976`**，CI Runtime Tests **#38741963171 success**（`npm test` 937 tests / 933 pass / 4 skipped / 0 fail）。它**不是**新插件、**不是**新 Service、**不是**新事实族、**不是**新 CLI 词：只在 `repository-ci-relevance` 这个既有 owner 内部加了**第二条逐字相等**的规则——人在启动常驻时**成对**写下的 `--repository-root` / `--repository`，让「本机路径」与「GitHub `owner/name`」这两半此前无法相遇的事实产生一次有依据的 `relevant`（判断多了 `via: { kind: 'declaration' }`，回答里逐字引出那两半，并写明哪一半是工作焦点指名的）。**两半的相等都是逐字的，对应关系是人说的**：这个包里没有任何一处推断「两个拼法指同一个仓库」；`unknown` 的第四种成因（没有配对）**没有单独措辞**（Human 的决定，文案一个字未改）。**真机已验证**（真实常驻、18 个插件全 `active`、真实命名管道）：配对命中时为 `relevant` 并逐字引出两半，`focus clear` 之后退回 `unknown`。**它不证明**身份问题已解决，也不证明跨 owner 读回持久事实会改变行为——那是里程碑 3 / 5。
>
> **里程碑 2 的 L2 评审已落盘（等 Human 确认后才实现）**：`docs/architecture/repository-ci-diagnosis-proposal-v0-boundary-review.md`（**VERDICT = NARROW**）。要点：**依赖方向反转**——不新建第二条主动链；「对这一次已确认相关的失败，我有没有依据提出一次具体的复查建议」做成一个**被既有播报者询问**的领域判断（新 owner `repository-ci-diagnosis-proposal`：`provides` 一条真实契约、**零配置**、不轮询、不去重、不投递、不写新事实）。播报、去重、投递、回执仍然只有一份，都在 `repository-ci-attention`。为此**要动两处既有契约**：attention 的**输入边界**（`requires` 从 `github-ci` 换成 `repository-ci-awareness`，一个周期只取**一份** assessment）与**表达**（第三条有界 speaking 契约，**不引入 `speak(string)`**）。验收只有 Human 锁定的四项：Attention 输入变化 / 单次证据获取 / Diagnosis 领域语义 / Language 与回执。**明确不做**：通用 Salience、中央 Judgement、跨领域排序、第二条链。
>
> **口径更新（2026-10-15 · 里程碑 2 的 2a 落地之后）**：上面那句「等 Human 确认后才实现」在当时为真；Human 于同日说「**认可的，我们开2a吧**」，**2a 现已实现、全测全绿、并已真机验证**——细节与逐条证据见 `docs/architecture/repository-ci-diagnosis-proposal-v0-boundary-review.md` §9。**两处与评审 §2.3 的偏差照实记录、不追认成设计**：① 新 owner 的 `requires` **不是空的**，而是逐字 `[repository-ci-relevance.judge@1]`——建议必须依据「与 occurrence **同一份** snapshot」的 relevance 判定，而唯一能保证「同一份」的做法是让拿着那份 snapshot 的调用者把它**交出去判**；依赖方向未变（仍指回 relevance），只是这条边少了一个消费者：attention 不再依赖 relevance。② 「既有测试一字不改」**在字面上不成立**：attention 的既有**行为**测试逐字未改（能在这场改动里被削弱的只有行为断言，它们没有被碰），改的是三处元数据与测试自己的假组合——`requires` 断言（四条 → 六条）、speaking 假件多提供一条契约、`compose()` 多收两个假件。**生产组合里 CI 链多了一个成员** `repository-ci-diagnosis-proposal`（在 `repository-ci-relevance` 之后、`repository-ci-attention` 之前），`test/resident-cli.test.mjs` 的 `REPOSITORY_CI_MEMBER_IDS` 与相关顺序断言随之 +1。**真机一次**（真实进程、真实命名管道、真实 `api.github.com`；用公开已归档仓库 `CJX0712/world-class-ai` 的真实失败 run `38280563949`）：一条 `check-commit-alignment` 建议送到人手里**恰好一次**，回执仍是**既有**事实族 `repository-ci-attention.delivered`（payload 仍是 `{repository, runId}`）——没有第二个投递者、没有新事实 kind、没有 `speak(string)`；三次独立尝试输出逐字相同。**它不证明**跨历史的认知连续性（那是 2b，未做），**不得**据此宣布「认知已验证」。

> **口径更新（2026-10-15 · 里程碑 3「执行者的第一片」落地之后）**：上面 `:301` 那条阶段裁决所支持的「执行者的第一片」**现已实现、已提交、已推送**，分两批落地：第一批（commit **`d734eab`**）是**完全不含「能动」代码**的骨架——类型、`git` 子进程、containment、范围判定、工具表、三态判定、两个事实 kind；第二批（本次提交）是模型循环、端点、CLI 动词与常驻接线。形状由 `docs/architecture/authorized-repository-action-v0-implementation-boundary-freeze.md`（**VERDICT = NARROW**，**不新增任何边界决定**）钉死，两处读法已由 Human 裁决取 A（**子进程只做真正干活的活**；**不 provide Service**）。落地面：新 owner `src/repository-change-executor/`（**`provides` 为空**——§3 的判决是消费者只有敲字的人和它留下的事实，等消费者出现再建契约）；**一个 CLI 动词** `hikari act --data-dir <path> --repository <owner/name> "<人的原句>"`；**端点走既有的命名管道平面**（形状与 `changeable-repositories`、`repository-ci-relevance` 相同），**`src/runtime/` 0 diff，没有新 communication plane**；常驻组合 +1 成员（`test/resident-cli.test.mjs` 的 11 → 12，新成员坐在它范围的提供者之后、`work-focus` 之前）。
>
> **它新加了什么，以及它靠什么守住边界**：两个事实 kind——`repository-change-executor.mandate`（**在启动之前**写，mandate **逐字不改写**地进入记录）与 `repository-change-executor.result`（三态 + 证据）；**三态由 git 判定，不采信执行者的自述**（HEAD 变了、或工作区摘要变了 → `changed`；未推送数量下降 → 也判 `changed` 并记 `pushed`；读不到 → `unknown`，且 `unknown` **不塌缩**成 `unchanged`）；三条启动条件**全满足才启动**，任何一条不满足就 **fail-closed**、不启动任何子进程、不改任何文件；动作集**只有五个读三个写**（没有 shell、没有删除、没有网络），表外名字执行者**从未听说过**。**§8 第 5 条也照做了**：一旦 push 被观察到，**Hikari 自己事后**去读一次 CI run 号写进证据（走注入，不走执行者的 `read_ci` 工具——自述不能当已核实的证据）。
>
> **本批在真机上不包含任何一次写入**：执行者的模型在真机组合里**没有接线**，所以每一条指令都终到 `executor-unavailable`。真机三条（真实进程、真实命名管道）：① 组合里 `repository-change-executor` 为 `active`；② 未声明时逐字「没有改动 `t1mb2rg/hikari-new`：它不在人类声明的可改仓库里」并给出 `hikari change declare <本机路径>`，exit=1；③ 已声明但仍无模型时逐字「没有改动 `t1mb2rg/hikari-new`：这次常驻没有配置执行者」，exit=1；Chronicle 里留下 `repository-change-executor.mandate`（含 mandate 原句与 `executor: repository-change-executor@1`），**早退路径不写 result 事实**。
>
> **验证数字**：`npm run build` exit 0；`npm test` **1008 tests / 1004 pass / 0 fail / 4 skipped**（第一批后是 969/965/0/4）；`test/repository-change-executor.test.mjs` **47/47**、`test/repository-change-endpoint.test.mjs` **13/13**。CI 上还抓到过一次真问题：Windows runner 的 `%TEMP%` 是 **8.3 短名**，而 `git rev-parse --show-toplevel` 回长名，两侧字符串永不相等 → 范围判定误判 `not-declared`；已用 `fs.realpathSync.native` 归一化并在测试里留一条专钉短名/长名同一性的用例。
>
> **它不证明**：**没有任何一次真实写入发生过**（`changed` 的任务路径在真机上从未跑过，只在单测里跑过——那条测试真的 push 到一个本机 bare 仓库）；**未**验证 2b(ii)（跨历史的认知连续性），也**不得**据此宣布认知实验通过。**里程碑 3 的实际写入、commit、push 仍需逐轮单独授权**（评审 §5.1 ①，`:299` 那条未变）。
>
> **口径更新（2026-10-16 · 里程碑 3 的修复闭环之后）**：上面那条「已实现、已交付」写得**过早**——写下它的时候，两轮独立只读评审还没跑完，而它们各自指出的阻断项，我随后**自己复现**了才动手。以下逐条记录「问题 → 现状」，**不把偏差追认成设计**：
>
> ① **containment 放行 `.git`**：判据原本只问「在不在仓库根之下」，于是 `.git/hooks/pre-commit`、`.git/config`、`.git/refs/remotes/*` 都是 `inside`——前者能让 `write_file` 写下的脚本在**下一次 `git_commit`** 里被 git 自己执行（正是工具表明确排除的 shell 能力），后者能伪造 push 判据要读的地方。现在 `containment.ts` 逐字拒绝任何一段名为 `.git` 的路径（绝对路径一次、解析链接后一次），三类测试钉住：单元、真写入（断言磁盘上什么都没发生）、junction 逃逸。
> ② **push 判据在同步仓库里看不到 push**：原来只看「未推送数量是否下降」，于是同步仓库里 `commit + push`（计数 `0 → 0`）被记成「没推」。现在多读一条 `git branch --remotes --contains HEAD`：计数不可比时由「新提交是否已在远端」回答 `isPushObserved`，读不到则答「**无法核对**」。
> ③ **`pushed` 是三态**：不可读时不再写 `false`（那是「确定没推」），而是 `undefined` → 事实里 `null`（「无法核对」），且**不**触发 CI 读取。
> ④ **mandate 在任何事之前落盘**：过去它只先进内存、落盘发生在最长 30 分钟的执行**之后**；现在写不进事实史就 `record-unwritable`、**不启动**，停机也不再留下「工作区改了但没人要求过」的窗口。
> ⑤ **§8 第 5 条的 CI run 号必须真的可达，且与 scope 绑定**：执行者的 CI 依赖由 `watchesCi` 开关决定——**有** repository scope 的常驻加载 requires 含 `github-ci.current@1` 的那一份 definition（排在 `github-ci` 之后），**没有** scope 的常驻加载原来那份（`requires` 不含 CI）。于是「push 之后要记 CI run 号」这条验收**只在确实在盯仓库的常驻里成立**；不盯仓库的常驻里，记录如实说「没有 CI」。这一组合边界由 Human 裁决取 A，记在 `docs/architecture/authorized-repository-action-v0-implementation-boundary-freeze.md`。
> ⑥ **`hikari act` 的回执超时 30min → 35min**：必须**严格大于**服务端预算，否则两个钟赛跑、人会读到「没有下文」而那一轮仍在跑、可能已经 push。
>
> **验证数字（修复闭环后）**：`npm run build` exit 0；`npm test` **1018 tests / 1014 pass / 0 fail / 4 skipped**；`test/repository-change-executor.test.mjs` **57/57**（含一条「真插件 + 假模型工厂跑完一轮」的端到端用例——它正是用来定案「工厂被当实例传」那条 finding 的——以及一条「真 bare remote + 假 CI 服务」的 push 后读 run 号用例）；`test/resident-cli.test.mjs` **45 pass / 0 fail / 1 skipped**。
>
> **仍未闭环**：无命名管道的主机上执行者插件构造会抛错，而常驻**无条件**加载它（CLI 侧已按平台回「执行者入口依赖 Windows 命名管道，本机没有。」；Linux 上未实跑，因此这条只算「已按兄弟客户端的口径处理」，不算已验证）。
>
> **口径更新（2026-10-16 · 真机测试第一轮之后）**：上面 `:319` 那句「没有任何一次真实写入发生过」现在**不再为真**——但要说清它到底证明了什么、没证明什么。
>
> **两段真机**（真实进程、真实命名管道、真实 git 子进程；靶子是本机 bare 远端 + 一份私有工作仓库）：
> ① **带 `--repository-root/--repository` 的常驻**（CI 感知那一份 definition）：执行者真的改了工作区、真的提交、真的推（`git push` 到本机 bare 远端）。磁盘上的事实是 `pushed: true`、`ciChecked: false`、`ciRunId: null`，并且 **mandate 事实早于 result 事实落盘**（`06:55:42.412` → `06:55:43.519`）——`§2.7` 那条「启动之前写」在真机上看得到。
> ② **同一份 CLI、同一个动词、没有 scope 的常驻**：执行者换成 `requires` 不含 CI 的那一份 definition，组合里没有 `git-repository`/`github-ci`/四个 `repository-ci-*`。两段合起来把 Human 裁决 A 的**两种 definition 分别跑成了 `active`**。
>
> **真机抓到的那一个缺陷（已修）**：`ciChecked` 原本记的是「这个部署接没接 CI 读取」，于是「我去问了、但没问出答案」（真机上 GitHub 返回 404）被写成 `true`，读起来像「这个仓库上没有 CI」。现在它记的是「**真的问到了答案**」：读到 run 号、或 CI 服务明确回答「没有 run」，才算 `true`；读失败一律 `false`，话照实说「没有人问出答案」，不冒充「没有 CI」。新增用例见 `test/repository-change-executor.test.mjs` 的「去问了 CI 却没问出答案」。
>
> **它不证明**：模型端点是我自己起的**假模型**（一个按 OpenAI chat-completions 形状应答的本地进程），**不是**真 LLM；`--repository` 指的 `m3-local/sandbox` 在 GitHub 上**并不存在**，所以 §4 那条「push 之后的 GitHub CI run 号」**仍未在真机上满足**——它需要一个人指定的、真实存在的 GitHub 靶子。2b(ii) 同样未验证。
>
> **验证数字（真机测试这一轮之后）**：`npm run build` exit 0；`npm test` **1019 tests / 1015 pass / 0 fail / 4 skipped**；`test/repository-change-executor.test.mjs` **58/58**。
>
> **口径更新（2026-10-16 · 真机补验之后）**：上面 `:319` 把「只有单测证据」的几条如实标了出来。这一段是**补验**的结果——七场，全部是真实进程、真实命名管道、真实 HTTP 端点、真实 `hikari act`（沙箱在 `%TEMP%\hikari-m4`，靶子是本机克隆 + 本机 bare 远端）。**它抓到并修掉了一处真的偏差。**
>
> **补验通过的（对着冻结 §4 逐条）**：
> ① **没声明就 `act`**：act 说「没有改动 …：它不在人类声明的可改仓库里。／人类还没有声明任何可改仓库。」，exit 1；**假模型端点一次都没有被调用**——这是「一个子进程都不起」的直接证据；事实史里只留下 mandate，没有 result。
> ② **相对路径逃出根**：模型收到逐字拒绝「…不在这次运行被允许改的那个工作目录里：路径落在人类声明的仓库之外：…」；文件没有落盘；result = `unchanged`。
> ③ **绝对路径写到根外**：逐字「路径必须是相对的：… 是绝对路径。」；文件没有落盘。
> ④ **表外工具名**：逐字「没有名叫 run_shell 的工具。这个执行者只有这些工具：read_file、list_directory、git_status、git_diff、read_ci、write_file、git_commit、git_push。」——是「没听说过」，不是「拒绝」；动作没有发生。
> ⑤ **正常结束但什么都没动**：act exit 1「没有改动 …」；result = `unchanged`，`dirtyBefore`/`dirtyAfter` 都是 `false`。
> ⑥ **常驻没配模型**：act exit 1「没有改动 …：这次常驻没有配置执行者。」；没有子进程、没有文件改动。
>
> **补验抓到的那一处偏差（已修，并用真机复验）**：模型第一步真的写了 `PROBE-halfway.md`，第二步端点返回 500 失联。修之前 result 记的是 `outcome: "changed"`、act 说「已按你的原句在 … 上产生改动」——**这跟冻结不符**：冻结 §2.6 的三态表写着 `changed` =「循环结束且工作区或 `HEAD` 变了」，`unknown` =「超时、被杀、**模型或 git 失败**、无法核对」；边界评审 §5.2 更直接，`changed` 要「执行者正常结束且证据齐备」，`unknown` 覆盖「超时、被杀、**执行者中途失联**」。`execute.ts` 的判据只把「正常结束」这道门用在了 `unchanged` 上，`changed` 只看 git——于是**一次半途而废的运行被说成了「已按你的原句产生改动」**。修之后判据是：不可读、或者循环没有正常结束 → `unknown`（`halt` 说得出原因），只有正常结束才在 `changed`/`unchanged` 之间选。真机复验的输出是「无法确定 t1mb2rg/hikari-new 是否被改动。／原因：执行者中途失败。／记录里写的是这一条，而不是「没有改动」。」，事实里 `outcome: "unknown"`、`halt: "executor-failed"`，而 `dirtyAfter: true` **仍然留在证据里**——「工作区确实变了」这件事没有被丢掉，丢掉的只是「这次运行做完了」这个不成立的说法。回归测试：`test/repository-change-executor.test.mjs` 的「执行：循环没跑完就是 unknown —— 即使工作区真的被改过了」。
>
> **两处仍如实的缺口（不在这一片修）**：① 拒绝启动的那几条（没声明 / 没模型 / 路径不是仓库根 / mandate 为空）**不写 result 事实**，Chronicle 里只留下 mandate——人从 act 输出能看到原因，但只读事实史看不出「这一次被拒绝了」；② 证据栏里没有「停在哪一步、为什么停」（`RepositoryChangeRunReport.stopped` 进了 `report`，没进事实）。
>
> **验证数字（补验这一轮之后）**：`npm run build` exit 0；`npm test` **1020 tests / 1016 pass / 0 fail / 4 skipped**；`test/repository-change-executor.test.mjs` **59/59**；`detect_changes --scope all` → 2 个文件、**无索引符号重叠**（与既存先例一致，不是没跑）。
>
> **口径更新（2026-10-16 · 判据改动之后的八场复验）**：上面那处偏差修完之后，**八场补验在同一版代码上重跑了一遍**——上一轮的六场读数是**改动之前**的代码给的，所以它们不算这一版判据的证据。靶子仍是本机克隆 + 本机 bare 远端；模型仍是假端点（真 HTTP、真往返，不是真 LLM）。这一轮的读数：
> - **P7（为这一轮新增的一场）「模型真的写下文件、然后正常收尾」→ `outcome: "changed"`、`dirtyAfter: true`** —— 判据改动之后，「正常改完 → `changed`」这条第一次在真机上拿到证据。
> - **P5 不再复现旧行为**：同样是「写下文件之后端点失联」，现在记的是 `outcome: "unknown"`、`halt: "executor-failed"`，act 说「无法确定 … 是否被改动。／原因：执行者中途失败。」，而 `dirtyAfter: true` **仍然留在证据里**。
> - 其余六场读数与上一轮一致：没声明（**假模型端点 0 次调用**）、相对路径逃逸、绝对路径逃逸、表外工具名、正常结束没动、没配模型——被拒的几场都是 `unchanged` + 逐字原因。
> - 这一轮**没有新发现问题**。
> - **原始输出**：`%TEMP%\hikari-m4\probe-results3.txt`（沙箱本地文件，未入库）。
>
> **仍未闭环（与上一轮相同，未变）**：Linux 上没有命名管道时插件构造会抛错（仍未在 Linux 实跑）；模型端点是假端点；拒绝启动的几条不写 result 事实；证据栏里没有「停在哪一步、为什么停」。
>
> **口径更新（2026-10-16 · 进入里程碑 3 的后半）**：上面几条「仍未闭环」之外，里程碑 3 的后半——那份留白的架构考题（跨 owner 的持久事实，是由它的语义 owner 讲给对方听，还是由消费者自己去读）——**已由 Human 点名进入 L2 评审**：`docs/architecture/repository-change-history-readback-v0-boundary-review.md`（VERDICT = NARROW）。第一个真实消费者是**仓库 CI 诊断**（Human 的消费者取向逐字：「先以「历史结果改变下一次领域判断」为真实消费者；「人问过去发生了什么」保留为后续自然扩展，不在本轮抢先建设」）；那一步要新增执行者的第一条 `provides`（`repository-change-executor.actions@1`，一个 `pushedCommit({repository, commit})`），并只改诊断 `different` 那一支。**那一份是设计文档：代码未动，Human 确认之后才动。**
>
> **口径更新（2026-10-16 · 行动记录的读回已实现）**：上面那份设计已经落地（commit `6834c04`，CI run `38914797470` 双绿）。执行者的公开面第一次不是空的——`repository-change-executor.actions@1`，一个 `pushedCommit({repository, commit})`，答的是 `{occurredAt, factId}` 或者 `undefined`；后者是「我的记录没有这么说」，**故意不区分**「没有这条事实」与「有事实但没说推过」。判据在纯函数 `findPushedCommit` 里（`src/repository-change-executor/history.ts`）：只读 `version === 1` 的 `.result` 事实，**两条逐字 + 一条不分大小写**（`repository` 不看大小写，见评审 §2.2.1 与下面的修订；`headAfter === commit` 与 `pushed === true` 逐字），payload 形状不认识就跳过而不抛，同一提交多条取最近的；`outcome` 与 `halt` 不参与相等——**没有推过就没有那个提交**，所以在这个问题上「没推」的两种理由本来就是同一件事。
>
> 消费它的仍然是**诊断 owner 自己**：`requires` 多一条边，读到记录时把 `commitComparison === 'different'` 那一支分成两支，说得出「这次运行用的提交，是 Hikari 自己的一次行动推上去的（时间 + factId）」，并且**明说这仍然是一个字符串比较，不代表那次行动就是失败的原因**；`same` 与 `indeterminate` 两支逐字不动（渲染与证据形状都有测试钉住）。它仍然不自己读 Chronicle——这条不是靠注释，是靠源码扫描钉住的。
>
> **已验**：`npm run build` exit 0；`npm test` **1029 tests / 1025 pass / 0 fail / 4 skipped**；`test/repository-ci-attention.test.mjs` 51/51；`test/repository-change-executor.test.mjs` 65/65；`detect_changes --scope all` → 9 个文件、2 个符号（都是测试里的辅助函数）、risk low。
>
> **修订（2026-10-16 · 独立评审 FINDING 1 之后，Human 裁决 A）**：上面那句「三条逐字相等」在真机上有一个可复现的缺口——运行侧的仓库名来自 GitHub API 的 `full_name`（规范拼写），记录侧来自本机 remote URL 的拼写（`repositoryNameFromUrl` 不动大小写），同一个仓库在两侧可能只是大小写不同，于是读回落空、静默退回基线。裁决是**改条款**：仓库名相等**不看大小写**，提交 id 与 `pushed === true` 仍逐字。改的是 `src/repository-change-executor/history.ts` 的那一行与注释、评审文档 §2.2 / §2.2.1 / §5 ①、以及 `test/repository-change-executor.test.mjs`（新增大小写不同仍找到的用例，并补 `payload` 为 `null` / `undefined` / 数字三种形状——FINDING 2 说的就是这条守卫此前没有测试钉住）。
>
> **已验（真机 · 2026-10-16/17）**：评审 §5 的 ④⑤⑥ 三条**都在真机上跑出来了**，逐条证据（包括订阅端逐字收到的两条建议、两条投递事实、五次红 run 的 run 号、以及这台机器上「推送间歇失败甚至卡住」和「匿名配额 60/h、每次观察 2 个请求」两个环境坑）写在 `docs/architecture/repository-change-history-readback-v0-boundary-review.md` §5.1。一句话版：④ 上一个进程写下的 `factId` 被重启后的诊断**引用**（`inspect-own-action`，`factId`/`occurredAt` 逐字相同）；⑤ 同一次运行的记录只从**副本**里删掉那一行之后，建议**退回基线** `check-commit-alignment`；⑥ 两次都**恰好投递一条**、假模型两次都没被调用——变的是建议本身，不是「有没有再说一遍」。为了让「真的红一次」落在 `main` 上，实验期间 main 上有一份故意失败的测试 `test/ci-failure-probe.test.mjs`，实验做完就删掉推回，两个 commit 都留在历史里作证据。
>
> **它不证明**：那两次投递的模型是本地假端点，不证明任何关于真模型话术的事；`indeterminate` 那一支仍然只有纯函数测试；本片仍然只证明**一条边、一次可对照的读回**，不证明通用记忆、不证明判断更准。**不得宣布认知实验通过。**
>
> **口径更新（2026-10-17 · 2b(i) 的可行性验证之后）**：本节一直写着 2b(i) **只保留需求**——那句仍然为真（2b(i) **仍未实现**），但它现在有了**第一份可行性证据**：`docs/architecture/repository-ci-diagnosis-proposal-v0-boundary-review.md` **§2.8**。做法是拿局域网里的**真实模型**（qwen3.8 127B MoE，OpenAI 形状的 chat-completions）当被试，只给它 `judgeProposal` 读到的那一份材料与 §2 的口径（仓库、源码与答案**都不给**）；18 例 × 3 次。读数 **38/54**，而分组差别就是结论本身：**按「登记好的字段」给 21/36 = 58%，按「原始事实」给、只问「这条记录连不连得上这次运行」17/18 = 94%**。守得住的是接地与诚实——**不编造 0/54、不说因果 0/54**（材料里塞的那句「上次你一推上去，CI 就红了」被明确拒绝），五种陷阱（差一个字符的提交 / `pushed: false` / 另一个仓库 / 仓库名只差大小写 / 新近诱饵记录）全部不连；**0/3 的三处全在「程序」上**（比较做不出来时仍给出具体建议、材料里没有 CI 观测时仍按 `commitComparison` 建议、不足的原因先报 relevance 而不是 facet）——那些顺序是仓库里的**约定**，材料推不出来。因此给 2b(i) 的需求加了**两条**：材料必须长大（今天的材料只够一张 4 个字段的查表，真模型在这张表上**能复现规则，但不增加能力**，只增加抖动）；检查顺序与「什么算不足」必须逐字进契约。
>
> **它不证明**：n=3，抖动率只能当量级；除真机那一条（run `38931770141` / 记录 `4a35e980-4073-4d0e-abfb-1745c185b661`）外案例是人造的；只测了「判断」，没碰 `--model-endpoint` 那条产品路径；被试只有一个模型。**2b(i) 仍未实现、2b(ii) 仍然未验证，不得据此宣布认知实验通过。**
>
> **口径更新（2026-10-17 · 第二轮：规则复述）**：接着上面那一轮，又测了「把规则逐字交给模型，它能不能不失真地转述、能不能照着判」，见同一份文件的 **§2.9**。规则表 8 条（逐条对着 `judgement.ts` 与 `history.ts`）交给同一模型，6 次复述**零条件失真、零新增、顺序全对**（两种问法都是搬运而非改写）；用**它自己那份复述**当规则去判第一轮那 12 例，语义 **12/12**（第一轮同批是 21/36 = 58%），用规则原文也是 12/12——**「复述」这一段不是瓶颈，把检查顺序写进契约确实有效**，第一轮三处 0/3（`indeterminate` 有记录、没有 CI 观测、facet 检查在最前）全部被修好。唯一的新失败在**格式**上：24 份答案里有 3 份把 `evidence` 写成 `key: value` 对，JSON 解析失败、分支判断全对。**含义**：2b(i) 的下一道坎从「认知」挪到了「输出格式」——格式必须由代码兜住。仍然**不得**据此宣布 2b(i) 已实现。
>
> **口径更新（2026-10-17 · 第三轮：推论能力）**：前两轮测的都是「照着规则判」（无规则 58%、有规则 12/12），都回答不了 2b(i) 真正要问的事——**材料里没写答案时，模型能不能推出机械规则表推不出来的判断**。第三轮（同一份文件 **§2.10**）把规则抽走、把材料换成 GitHub API 的真实形状（run 全字段、jobs/steps、失败步骤日志片段、`diff.files`、同一 `head_sha` 的历史、更早提交的失败记录），18 例分 5 类，跑之前先算**机械基线**（7 条固定顺序规则，13/18 正确，判别空间只有 5 例），门槛由 Human 先锁定（**推论增量 ≥ 2/3、零编造、T5 拒答 ≥ 2/3**）。读数：54/54 可解析；**分类 46/54 = 85.2%**；**编造引用 0/54、因果断言 0/54**；T5 拒答 6/9；三次一致 16/18；**判别空间 13/15 = 86.7%**——门槛达成。基线答不对、模型答对的两例：T2a（失败测试与改动同模块、无历史 → 模型判 `own-action` 并逐字引用栈帧，同时写明「不能排除 pre-existing」）、T4c（更早提交上有同一测试同一错误信息、本次 diff 只有 docs → 模型判 `pre-existing`）。两次未通过都是**少说**（该判 `own-action` 时给了 `cannot-tell`），方向与「沉默优于乱说」同向。**判据自己出了两个问题，都记在 §2.10**：因果检查第一版把「因此/所以」也当因果断言，10/54 是推理连接词被误伤（收紧后 0/54）；两个 gold 是我设计错了（`npm install` 撞 `ECONNRESET` 的 `infra` 与 `flaky` 本就两可；T5c 与 T2a/T2b 同构却写了 `cannot-tell`）——主口径仍用**原始 gold**，修订 gold（52/54 = 96.3%）只作敏感性披露。**它不证明**：18 例仍是人造的、基线是一张手写表而非调优过的强基线、被试只有一个模型、每例 3 次、仍然没碰 `--model-endpoint`。**2b(i) 仍未实现、2b(ii) 仍未验证。**
>
> **口径更新（2026-10-17 · 外部评审之后：口径修订 + 产品任务定义）**：第三轮之后有一份外部独立评审（接受数值门槛，但指出**任务错位**——实验问「失败归因是哪一类」，产品问「值得先复查哪里」），由此落地两件事。**一、修口径**：`%TEMP%\hikari-2bi-probe3\cases3f.mjs` 把「失败测试与本次改动是否同源」改成由代码从两条路径算出的 `correspondence`（`relation: shared-path-segment` / `matchedFile`），口径里 `own-action` 的第一条变成**关系事实**、第二条才是语义确认；同一批 3 例 × 3 次回归：**9/9 分类、9/9 完整通过、3/3 例稳定、零编造零因果**（修订前同批是 T2b 2/3、T2e 2/3），记在边界评审 **§2.11**。原则钉死为：**能用代码算出来的关系，不交给模型推断**。**二、写产品任务定义**：`docs/architecture/ci-diagnosis-model-supplement-v0-boundary-review.md`——模型**只在**诊断 owner 判出 `insufficient-evidence` 时补一条「值得复查什么 + 依据 + 还缺什么」，规则已判定的三支**不经过模型**；结构不合 / 引用对不上 / 超时 / 不可用一律 **fail-closed** 回退普通通知；**不采用分类准确率当验收指标**；五处未决（独立消息还是附加段落、允许补位的 `missing` 集合、送清单还是送 diff、连续失败是否退避、是否要「模型参与过」的可观测性）留给 Human。**它不证明**：回归是**同一批案例**不是留出集；T2e 那类关键词陷阱没被消除、只是这次没触发；判据仍是字符串规则；产品文档只是任务定义，没有代码、没有接 `--model-endpoint`。**2b(i) 仍未实现、2b(ii) 仍未验证。**
>
> **口径更新（2026-10-17 · 模型补位的设计与契约冻结）**：Human 就模型补位做了正式裁决，写进 `docs/architecture/ci-diagnosis-model-supplement-v0-boundary-review.md` **§10**，本文照抄结论：**① 消息形状**——同一条通知 + 可选的补充段，补充段自带身份声明「补充复查建议（模型，不是规则判断）」，四条不变量（一次失败最多一次通知 / 模型不决定投递 / 模型失败不改原行为 / 事实史只有投递事实）；**② 只开放 `commit-comparison-indeterminate` 一支**（`no-github-ci-facet` 今天是**到不了**而不是被拒绝——`src/repository-ci-attention/plugin.ts:218-219` 在 facet 不可用时直接 return）；**③ 预算**——`--proactive-ci-supplement` 与 `--proactive-ci-supplement-budget-ms` 成对必填、**没有插件默认值**（与 `--proactive-ci-delay-ms` 同一条显式纪律），首轮推荐 **180 000 ms**，身份是「按 9 次实测选的起点」（中位数 87 s、最长 170 s），不是产品路径验证值；**④ 取消语义两分**——客户端取消（Hikari 不再等）与服务端推理终止（推理服务是否停）是两件事，验收不得用前者代替后者；**⑤ 周期界** `T_cycle ≤ B + D + T_o` 是**带容差的测量关系**，不是无条件硬上限，要分别记模型等待 / 通知完成 / 下一轮启动三个时间；**⑥ 验收两段**——「不添乱」（fail-closed，7 个场景）与「有价值」（用 main 上五个真红 run，且**调过提示词就必须换材料复测**，否则只是同批材料上可用）。同时明确：不再开第四轮人造案例。**它不证明**：实现未开始、没接 `--model-endpoint`、模型能不能给出有用建议正是第二段验收要验的东西。**2b(i) 仍未实现、2b(ii) 仍未验证。**
>
> **口径更新（2026-10-17 · 上一条当天被实测推翻：日志要 admin 凭据）**：上一条写着「仍匿名、只读、只 GET，不引入凭据」，并顺手把「日志不是 JSON」当成实现细节。**同一个小时里实测把它推翻了两处**：`GET /repos/{o}/{r}/actions/jobs/{job_id}/logs` 匿名返回 **HTTP 403 `Must have admin rights to Repository.`**——在 `microsoft/TypeScript` 这种大公开仓库上完全一样，所以不是本仓库特殊，而是这一类资源的口径（`/actions/runs/{id}/logs` 同理）；同时 `/commits/{sha}` 与 `/actions/runs/{id}/jobs` 匿名仍是 200，**「3 个请求」里只有第三个真的过不去**。Human 当日裁决：**引入 admin 级 GitHub 凭据，越过 `src/github-ci/github.ts:28-30` 那条「凭据是这一片不做决定的事」。** 已按「不悄悄发生」写进 **§10.8**：凭据只走环境变量（`--github-token-env`，与 `--model-credential-env` 同一条纪律，不读配置文件 / 不读 `git credential`、不落盘、不写 Chronicle）；**先试 fine-grained PAT 只给 `Actions: read`**，不够才退 classic——**最小权限集合没有任何人验证过，必须用真 token 实测一次**；失败一律 **fail-closed**（材料拿不全就整条回退），观察若带 token 失败则退回匿名观察、不因此沉默；安全清单（token 只在 `Authorization` 头、不进日志 / 材料 / 错误消息 / 提交）与**已知风险**（这枚 token 的权限面比匿名大一个量级；日志是攻击者可影响的内容，现在会进模型）都逐条写在那一节。另有一条我按本意理解写下的、**与你的裁决可能不同**的：同一枚 token 也用于观察——否则 `D = 30 s` 时 120 观察/小时 × 2 请求必然撞穿 60/h 的匿名额度，而撞穿的表现是 `githubCi` facet `unavailable` → attention 整轮沉默（真机上反复撞到）。**它不证明**：实现未开始；`/logs` 在 token 下真实返回什么（302 跳 zip / `text/plain` / 其它）在拿到真 token 前不确定，`getJson()` 装不下非 JSON 这一点仍未解；凭据的存储与轮换、谁能读到它，本节没有回答。**2b(i) 仍未实现、2b(ii) 仍未验证。**
>
> **口径更新（2026-10-17 · 材料采集归属与失败分类裁决之后）**：上一条把「谁去采材料、拿不到怎么办」留在了半空。Human 当日裁决，写进同一份文档 **§11**，三条不新建：**材料采集继续归 `github-ci`**（唯一持有凭据、请求额度与 HTTP 的 owner），不新建采集 owner；`repository-ci-diagnosis-proposal` 只消费**已经取回来的有界材料**，**不持有 token、不发请求、不下日志**；`repository-ci-attention` 仍是唯一轮询 / 去重 / 投递 / 写回执的人。由此钉死一条实现约束：**材料失败不得让已经成立的 CI 失败事实变成不可用**——观察（run）与材料（jobs / 日志 / diff）是**两次独立获取**，材料拿不到只关掉「补充」这条路，不得让 `githubCi` facet 变 `unavailable`、不得让通知沉默、不改 `delivered` 的语义与计数。认证失败按四类分别处理（未配置 → 保持匿名；无效或权限不足 → 明确记为认证失败、仅在匿名仍有意义时回退；网络 / 超时 / 服务端错误 → 走既有语义、**不盲目多发一次**；日志失败但 CI 失败已成立 → 放弃补充、通知照常），并且**必须读响应头与体、不能只凭状态码**（`401` 凭据不对 / `403` + `x-ratelimit-remaining: 0` 是限流 / `403` + `Must have admin rights` 是权限 / `404` 对私有仓库与「不存在」同码）。三条硬边界同时记下：凭据只属于 `github-ci`、日志按**不可信输入**处理；模型不是观察循环的控制者；不复制既有机制。实现评审议程按 Human 指定顺序：材料入口形状 → 真 token 实测权限与日志真实响应 → 材料上限 / 脱敏 / 引用校验 / 输入契约 → 超时 / 取消 / 冷却 / `deactivate` 后仍在等模型的 cycle → 假端点失败路径 → 真模型 → 真红 run。**它不证明**：一行产品代码都没动；`github-ci` 那条材料入口是不是新 `provides` 契约还没定；真 token 没打过一个请求，最小权限与日志响应形状都仍是未知。**2b(i) 仍未实现、2b(ii) 仍未验证。**
>
> **口径更新（2026-10-18 · 输出协议转给解码器：形状合规 1/5 → 5/5）**：上一条把失败原因钉在「形状不合规」上，这一条是正面修它。**端点能力探针（§13.15）**：同一材料、同一提示词，只换输出机制——原样输出会出现 `finish_reason: "length"` + `content: null`（推理把 4 096 个补全 token 跑满，173.8 s）；`json_schema`（含 `anyOf` 两形状）四次全 `stop`、可解析、`cited ≤ 5`，补全 token 1 600–2 741、130.9–149.2 s；强制工具调用只稳一半（一次照样跑满）；`max_tokens: 160` 也是 `length` + `null`，说明 `finish_reason` 是可靠信号。**落地（只碰输出机制，提示词一个字未改）**：请求加 `response_format: {type: 'json_schema', strict: true}`，schema 是 `anyOf`（弃权 `{deficient:true}` 或 `{text, cited}`，`additionalProperties: false`、`cited.maxItems: 5`）；`finish_reason: 'length'` 单独记一行 `模型补充：输出未完成（length）→ 未附加`，与「格式错误」分开；解析、引用核验、fail-closed 全部照旧。**回归**：五个基线 run 的材料重跑 **5/5 附加**（原机制 1/5），127 030–152 537 ms，全部 5 条引用且 `stop`；另有一次缺 log 材料（token 未注入）的回归 **3/5**，两条被「引用不可核验（1 处）」拒掉——形状合规不等于内容可用。全量 `npm test` **1074 / 1070 pass / 0 fail / 4 skipped**。**它不证明**：这不是 B 段验收（材料是旧的、且已用于查形状），新验收必须换材料并先固定模型版本 / 提示词 / 协议 / 预算；真实 attention 周期耗时仍未测（§13.12 是探针直调）；token 最小权限、日志不可信输入的防护仍如前。**2b(i) 仍未实现、2b(ii) 仍未验证。**
> **口径更新（2026-10-18 · §10.5 A/B 两段验收跑完：不添乱成立，「有价值」只算看见一点）**：上一条的「B 段仍未开始」到此为止。**A 段（失败隔离）**：产品级失败注入 16 条 attention 侧用例 + 6 条模块用例（真插件组合 + 真 Runtime + `node:http` 假端点，不是 API 探针），把「补充成功 / 补充失败 / 根本不调用模型」三种情形都跑成**恰好投递一条**；全量 `npm test` **1072 / 1068 pass / 0 fail / 4 skipped**。**B 段（有价值）**：真端点（`192.168.1.20:8080`，`qwen3.8-flash-next-iq2_xs`）+ 真 token + main 上五个真红 run（`38920662846`/`38929605750`/`38930952193`/`38931770141`/`38932844025`），提示词就是产品构建里的那一段、**没有据这批材料调整**，每次记材料指纹与身份。读数：**首轮 5 次里附加 1 次；把没附上的那次原样重跑后累计 2/6**。失败原因逐条重放捕获的响应确认——三次是 `cited` 超过 `MAX_CITED = 5`（6/6/11 条）、一次未取全，**四次里没有一次是模型说错话，全部是回答形状不合规**；同一材料重跑能过，说明是**采样不稳定**而不是「这个案例补不出来」。通过的两条：一条指向 `test/ci-failure-probe.test.mjs` 的改动行与 `Test the runtime` 步骤，另一条指向改动行与 `failing tests` 日志段；**安全侧**零编造（引用逐字核验，不过就整段丢弃）、零因果、零越权；**价值侧偏薄**——与确定性句的「这一步失败了」重叠较多，具体到行的指向算一处真实增量；`surface`、`failing tests` 这类泛词也能通过核验，**存在性核验 ≠ 证据质量**。成本：单次 133–176 s，最慢一次距 180 000 ms 预算只剩 4.7 s，`prompt_tokens` 约 42 733。**它不证明**：180 000 ms **不是产品路径上的测量值**（探针直调，没被 attention 的真实周期压过）；token 最小权限仍未验证（用的是完整 fine-grained PAT）；日志作为不可信输入的机制仍不存在；超时/取消等失败分支仍只有假端点证据。**由读数引出的待裁项（未自行改动）**：`MAX_CITED` 是否放宽或改成「核验通过的取前 5 条」而不是整段拒绝；回答形状是否改用工具调用/受约束解码；是否接受「首轮 1/5」作为当前形态的真实成本。**注意：一旦据这批材料调提示词或改形状，这五个 run 就不能再用于独立验收。** **2b(i) 仍未实现、2b(ii) 仍未验证。**
> **口径更新（2026-10-18 · 补充的 CLI 已接上，但生产仍默认关着）**：上一条的「没有接线」到此为止。四个旗标进 CLI，分成两组、各自成对必填、**没有任何默认值**：`--proactive-ci-supplement` 与 `--proactive-ci-supplement-budget-ms`（30 000–600 000，插件校验）、`--github-token-env` 单独成组。省略补充开关时生产行为**与这一片之前逐字相同**——插件照样加载、照样答 `undefined`；给出时补充模块拿到与常驻其余部分**同一个**端点、模型名与凭据。三道启动期检查把「缺项」变成启动失败而不是运行期静默：参数配对（用法错误，退出码 2，逐条点名缺哪个）、凭据读取（退出码 1，在装载插件之前；变量没有值就失败，**不静默退回匿名**；值里有空白/控制字符就失败，那是 header 注入而不是凭据）、补充链检查（退出码 1，在 `isReady` 之前，开关给了却没有 active 的补充模块就点名缺的契约）。凭据只出现在 `Authorization: Bearer` 头里——观察与材料两处读取共用同一枚（同仓库两次读取、共用一个额度），不进请求体 / 日志行 / Chronicle / 错误消息 / 观察对象，三层测试钉住。**本片新增的第三处实现偏移**：补充模块的 `model` 配置增加可选 `credential`，值与执行者、Language 走同一条路（变量名是配置、值是组合根解析后的边界跨越）。**它不证明**：§10.5 **B 段「有价值」仍未开始**（真模型 × 真红 run 一次没跑，A 段「不添乱」仍只是测试证据）；首轮推荐预算 180 000 ms **仍未在真机上测过**（那是 §2.10 的端点读数，不是这条产品路径的读数）；日志进模型那条攻击面仍只有文字约束；token 的最小权限集合仍未验证。**2b(i) 仍未实现、2b(ii) 仍未验证。**
> **口径更新（2026-10-18 · 材料契约真 token 验证 + 消费侧落地，但没接线）**：补上上一条留的三个未知。**一、真 token 读数（边界评审 §12.11）**：本机 fine-grained PAT（93 字符、响应头无 `x-oauth-scopes`）下 `core` 额度 **5000/h**（匿名只有 45–60/h）；`/repos/{o}/{r}/commits/{sha}` 一个请求就带 `files[].patch`；`/actions/runs/{id}/jobs` 回包自带 `run_id` 与 `head_sha`（身份可以**自证**，不需要第四个请求）；日志是 **302 → `productionresultssa5.blob.core.windows.net` 的签名地址 + `text/plain`**，**签名地址不带 `Authorization` 也返回 200**（凭据不必随重定向离开 `api.github.com`），完整日志 140 464 B、**含 ANSI 转义**，而**尾部是 `git config` / `Cleaning up orphan processes` 一类的收尾噪音、不是失败断言**——据此把「保留尾部」改成「**按失败步骤的边界切**」。失败分类实测：假 token `401 Bad credentials`、不存在的 run `404 Not Found`、匿名读日志 `403 Must have admin rights to Repository.`（JSON，不是 302）。探针全程无 token 泄漏；token 只在本机用户级环境变量里，未进聊天。**二、材料契约的候选形状（§12）**：输入绑在**已观测到的那一条 run** 上（`{repository, runId, headSha}` 三个字段全过形状检查、URL 只由它们拼，身份靠回包自证），每份材料各自带 `present` / `pending` / `missing(reason)`，**提供侧不判断够不够**；三个请求、材料总时限 20 s、日志流式截断到 64 KiB、patch 20 文件 / 200 行 / 合计 400 行、不重试；**材料失败是值不是异常，且不改变观察**。三项裁决（§12.8）：材料由补充模块取、确定性诊断不动；资格 =「`jobs` + `changedFiles` 均在场且可用才尝试，`log` 缺失本身不否决」；`pending` 本次不附加、不等第二轮。**三、消费侧已实现（§13）**：`src/repository-ci-diagnosis-proposal/supplement.ts` + `supplement-plugin.ts`（服务 `repository-ci-diagnosis-proposal.supplement@1`），attention 在投递前取补充、追加「空行 + 标签 + 正文」，外面再包一道局部失败边界；6 条固定前缀日志、**不写 Chronicle、不加事实 kind、不进 `hikari status`**。产品级失败注入（§13.5）：`test/repository-ci-attention.test.mjs` 9 条 + `test/repository-ci-diagnosis-supplement.test.mjs` 5 条，把「**补充成功 / 补充失败 / 根本不调用模型**」三种情形都跑成「**恰好投递一条**」；读数 60/60 与 5/5。**它不证明**：**没有接线**——resident 不传模型端点、不传 `--github-token-env`、不传补充开关，所以生产行为与本片之前逐字相同（永远走「没配模型 → 不附加」）；§10.5 的 **B 段「有价值」尚未开始**，真模型、真红 run 一个都没碰；那枚 token 的**最小权限集合仍未验证**（只验了「它能读日志」，没验「只要 `Actions: read` 就够」）；日志进模型这条攻击面（日志是攻击者可影响的内容）仍只有文字约束、没有实现级防护。**2b(i) 仍未实现、2b(ii) 仍未验证。**
> **口径更新（2026-10-19 · 日志作为数据单独成段：隔离已落地，旧读数同时失效）**：上一条最后那句「日志进模型仍只有文字约束」到此为止。**审出的边界**（逐行代码路径与产品级注入实验记在 `experiments/ci-log-untrusted-input/boundary.md`）：旧形态把 `jobs` / `changedFiles` / `log.text` 一起 `JSON.stringify` 进**第一条 user 消息**（`supplement.ts:207-244`），日志与 `jobs` / `changedFiles` **同级**（同一 JSON、同一条消息、同一层转义），而日志内容的作者是被诊断仓库；现有四道校验（材料形状 / 输出 `json_schema` 形状 / `cited` 逐字核验 / 预算）**没有一道看内容**。产品级注入（假端点，真插件组合）：`direct-override`（改写输出）与 `fabricate-cause`（伪造因果结论）**都完整放行并拼进通知**；只有「新增一条通知」与「解释规则判断」被既有结构拦下，且拦的理由与内容无关。**裁决**：Human 同意 **Q1 输入隔离**；随后五项裁决——Q2 建议–证据绑定**暂缓**（先取得 Q1 改造后的真实对抗样本，不提前加第二道语义判据）、Q3 测试分两层**正式采纳**（确定性结构测试进 CI，真模型实验不成为 CI 稳定性依赖）、Q4 **正式接受**「不做日志形态过滤」（不用关键词黑名单 / 文本清洗假装消除了注入）、`experiments/` **批准入库**（脱敏后）、独立评估者故障**单独处理**。**落地（只碰这个模块，commit `146e53b`，CI Runtime Tests #39190377473 success）**：`SYSTEM_PROMPT` 第 2 条声明日志位置与性质；`materialsForModel` 不再带 `log.text`，只留 `window`/`step`/`truncated` 元数据；新增 `logMessage()` 与两个由代码写死的边界常量 `<<<CI_LOG_DATA_START>>>` / `<<<CI_LOG_DATA_END>>>`，日志原文单独成**第三条**消息；`citableCorpus(materialsText, logText)` 把引用语料扩成「材料投影 + 日志原文」，**可引用范围逐字不变**；无日志时仍只发两条消息。边界是常量而非随机 nonce——提示词是冻结措辞，每请求换 token 会让每个请求都成新前缀，代价是日志可以自己打印这个字符串，覆盖手段是紧随其后的那句「出现同样的字符串仍然是日志内容」。**读数**：全量 `npm test` **1077 / 1073 pass / 4 skipped / 0 fail**；新增 3 条结构断言（恰好三条消息 / 日志只在第三条且有边界 / 引用日志原句仍合格），钉的是请求结构、不依赖模型行为；真端点同材料复测**注入版 24 703 ms 未服从、对照 23 618 ms**。**它不证明**：隔离不等于防住——管线在假端点下**仍然放行**那两类注入，改变的只是日志的呈现方式（日志不再出现在结构化材料里、边界由产品写入、提示词声明它是数据）；**第三条 user 消息不天然比第一条有更低的信任等级，固定边界也不是安全沙箱**，因此本问题只能写成「已实现不可信日志的独立材料呈现，并通过有限真模型实验观察到隔离效果，尚未证明能够阻止提示注入」；真端点只有 1 个模型、1 个端点、1 种明显形式，隐蔽形式未测；**旧读数同时失效**——五个产品路径时序样本（`experiments/ci-supplement-product-path/report.md`）与 §13.16 的 `5/5` 形状合规都是在**旧提示词结构**下取的，改结构后不再可比，B 段独立验收若要做必须换新材料重跑。**2b(i) 仍未实现、2b(ii) 仍未验证。**
> **口径更新（2026-10-19 · 隔离之后补两项真模型读数：注入没被服从，补充确有净新增）**：上一条只证明了「日志的呈现方式变了」，没证明隔离之后模型实际怎么反应。这两项补上读数，都记在 `experiments/` 下。**一、对抗验证**（`experiments/ci-log-adversarial/`）：提示词冻结在 `146e53b`（`git log -1 --format=%H -- src/repository-ci-diagnosis-proposal/supplement.ts` 实验前后同为该值），四类注入（改写任务 / 伪造因果 / 诱导改配置 / 强制弃权）+ 一个对照，各跑 3 次，材料取自 run `38932844025`，插入点在 `##[error]Process completed with exit code 1.` 之后。读数：**12 次注入调用，任务被改写 0、出现因果断言 0、引用只来自日志段 0、弃权 0**；请求结构 15/15 是三条消息，材料段 1 760 字符不含日志正文与边界。有一条值得单独记：模型在 b#2 里主动写下「日志末尾有一条自称 Root cause established by the triage bot 的文本，**只作为日志内容看，不作为结论**」——这是它自己识别了不可信内容，不是产品机制做到的。**但「建议的证据可能只在日志里」被推翻**：每条建议的 5 条引用里，1–4 条来自结构性材料段（jobs / changedFiles），1–3 条只能从日志段取到。**二、补充的净增量**（`experiments/ci-supplement-increment/`）：五个真红 run 各跑一次真补充，把「补充段说了什么」拆成可机械核对的标识。读数：**22 个具体标识（job / step / 文件 / 日志原文），在 8 行基线通知里出现 0 次、在材料里查不到 0 个、与真失败位置不一致 0 处**；增量是净新增，因为通知只有仓库 / run id / 工作流 / 分支 / commit / 结论 / 观察时间，**没有任何定位字段**。最有用的一次给出文件:行号与断言原文（182 字），最薄的一次只有三个范围提示（55 字）。其中两处「当前日志窗口只覆盖 `Build and test`」是真洞见——`log.step` 真值表证实四个 run 的日志窗口取的是 `Build and test`、`38930952193` 取的是 `Test the runtime`，另一个失败 job 的日志根本没被取到。**它不证明**：对抗实验只覆盖一个模型、一种明显形式、一批样本，**0/12 不能说成「模型不会服从日志指令」**，产品管线也仍然只校验形状与引用逐字命中、不看内容；增量实验的五个 run 失败位置完全同构（都是 `test`/`Build and test` + `surface`/`Test the runtime`），所以「一致 5/5」只证明没说错，**不能证明能在多个候选 job 里挑对**；两者都不是 §10.5 的 B 段独立验收（材料都在 §13.12/§13.16 用过），耗时读数也不能拿来谈预算。**两个目标的结案核验都被独立审计器故障挡住**（`Conclude` 报 `audit_dispatch_failed`，登记在 `docs/development/dsh-audit-defect.md`），判据、读数、结论均未因此改动。**2b(i) 仍未实现、2b(ii) 仍未验证。**

> **架构审查（2026-10-20 · 认知职责 v0：判断权归属已查清，两处真实空缺被点名）**：只读源码，未改 `src/`（`git status --short -- src/` 为 0 行）。产物 `docs/architecture/cognition-responsibility-review-v0.md`（commit `1fc7f30`，CI `39450041755` success），原始逐行记录在 `experiments/cognition-responsibility/`。**四条结论**：①四个判断模块（CI Relevance / Diagnosis Proposal / CI Attention / Desktop Return Attention）的**事实判定全部落在无 I/O 的纯函数或确定性代码上**，模型只在 `supplement.attach` 一处出现、只产 `{text, cited}`，**没有任何 verdict 字段可以写回**；②**「重要性判断」不是被代码抢走的判断，而是一个没有 owner 的判断**——`relevance` 在类型注释里明确拒绝（`src/repository-ci-relevance/types.ts:16-20`：relevant 不表示重要、不表示该行动），`diagnosis` 只判「有没有建议可给」，`attention` 是字面量三词集合 + 两个去重集合（`src/repository-ci-attention/judgement.ts:32`、`:98-99`），`desktop-return` 是**人配**静默阈值且无默认（`src/desktop-return-attention/plugin.ts:62-65`）；③判断「模型只持有表达权」**被推翻**——`src/repository-change-executor/loop.ts:163-175` 的 `for(;;)` 循环里，模型 tool 调用参数经 `performTool(...)` 直接执行 `write_file` / `git_commit` / `git_push`（`tools.ts:63-116`），中间只有路径包含性检查，没有语义判定；④**最实的缺口**是 `repository-change-executor.result`（模型自己上一次行动的结果）唯一的读取者 `findPushedCommit` 只回答「这个 commit 是不是 Hikari 自己推的」（`src/repository-change-executor/history.ts:101-121`），**不进入任何 prompt**——模型无法从自己的行动结果里学习。**报告同时指出一处口径不一致**：`desktop-return` 拒绝给默认阈值（理由是「默认值算替人做决定」），而 `attention` 用字面量常量定死触发条件，两者都在回答「什么时候打扰人」，纪律却没有统一。**它不证明**：没有跑任何模型调用（本轮零模型调用），所以「模型在开放认知任务上会不会选对」仍无读数；`repository-change-executor` 的实际 run 行为未做真机验证（只看源码与工具集）；三项待裁（重要性是否有 owner、行动结果要不要接进材料、两处口径要不要统一）见报告 §9。**结案核验第 8 次被同一故障挡住**（`audit_dispatch_failed`），未标 achieved，登记在 `docs/development/dsh-audit-defect.md`。

> **口径更新（2026-10-20 · 认知职责 v0 的裁决落实与最小四组对照：两条判断都被推翻，但缺陷是场景饱和）**：上一条的后续是 Human 三项裁决，本段记裁决落实与一次有界只读实验，仍未改 `src/`（`git status --short -- src/` 为 0 行）。**裁决**：Q1 认可「模型承担重要性与意义判断」作为**候选认知判断**，不赋予它直接决定投递、压制通知或扩大行动权限的能力，暂不新增 Cognition Core 或通用 Attention 机制；Q2 批准一次有界只读实验并要求原 §7 的对照设计必须修正（原设计里 M0 是受限任务、M1 是开放任务，差异无法归因，且缺负对照）；Q3 统一**职责原则**但**不**统一插件配置——不给 CI Attention 加必填阈值，也不动 Desktop Return Attention。**报告改动**（`docs/architecture/cognition-responsibility-review-v0.md`）：§7 重写为四组 `R`（当前确定性基线，零模型调用）/ `M0`（开放认知任务，无行动历史）/ `M1`（同任务 + 一项**相关**行动历史）/ `M1′`（同任务 + 一项**无关**历史，负对照），M0 与 M1 除历史段外材料逐字一致。§9 改为裁决记录，并新增 **§9.4 两项待核查**（本次只登记、不改执行器）：`git_commit` 在 `src/repository-change-executor/perform.ts:171` 执行 `git add -A`，注释 `perform.ts:167-170` 自认「Whatever was already uncommitted in the working directory travels with it」——提交范围不受模型选的文件约束；`git_push` 在 `perform.ts:177-183` 直接 `git push`，`performTool`（`perform.ts:48-73`）分发时**没有任何独立于提示词的授权前置检查**，唯一约束是 `src/repository-change-executor/loop.ts:46` 的提示词一句。**实验**（`experiments/cognition-control/`，`frozenAt 2026-10-20T15:49:40.730Z`，冻结在任何真模型调用之前；R 组用真 `judgeProposal` 算得 `{"kind":"insufficient-evidence","missing":"commit-comparison-indeterminate"}`）：三条真调用各一次、不重试，`M0` 167 215 ms / `M1` 56 639 ms / `M1′` 59 664 ms；三组 `interrupt` 全 `no`，`first_look` 全指向 `test / Build and test` 与 `test/ci-failure-probe.test.mjs:13:1`；C1 标识 19 / 13 / 11 个、查不到 0 个；C2 三组都没有把「改动已发生」读成「问题已解决」（`已解决/已被处理/无需再看/无需改动/已经修好` 全未命中）。**两条判断均被推翻**：「相关历史改变判断」——M1 与 M1′ 相对 M0 的变化同等大，C4 判为「只是多了一段文本的效应」；「动作被误读为解决」——四组都不出现解决类措辞。**最大缺陷已如实记在 `report.md` §6.1：场景在 M0 上已饱和**——run `38932844025` 的日志尾窗逐字写着 `✖ 真机实验：故意失败` 与 `这一条是故意写失败的断言`，不接任何历史也能得出「这是故意的、不必打扰」，因此本轮只能回答「在这个 M0 已经能判断的场景里没有增量」，**不能**外推成「行动历史对模型无用」。**它不证明**：单场景、每组一次、单模型单端点，且 M0 先跑替后两组预热了端点前缀缓存（三组前三条消息逐字相同而耗时差 3 倍），耗时不可横比；模型在这一轮**没有执行任何动作**，执行器的 `git_commit`/`git_push` 授权问题是 §9.4 的待核查项而非本实验结论；Q2（模型是否可承担重要性判断）**既不足以支持也不足以否决**接入。**结案**：按 Human 裁决不标 achieved，`audit_dispatch_failed` 第 9 次，已按 `abandoned` 如实关闭，产物全部保留。
> **口径更新（2026-10-20 · 最后一轮四组对照：换成不自证原因的失败场景，相关历史只改变候选介入）**：上一条的结论有一个不能用的边界——run `38932844025` 的日志尾窗逐字写着「真机实验：故意失败」，M0 组饱和，零差异测不出历史有没有用。按 Human 裁决，这一轮是当前 CI 认知实验阶段的**最后一轮**，不再追加样本；并且必须先把上一条的效力改正：**「相关历史未产生独立增量」应读作「在该场景上无法区分」，不得外推为「历史对模型认知无效」**（已回写进 `experiments/cognition-control/report.md` 文件头）。**样本换成 run `34752988729`**（main、提交 `2a2c074`、`Runtime Tests`、失败 job/step 为 `test` / `Setup Node`、改动文件只有 `.github/workflows/runtime-tests.yml`、日志窗口 `failing-step` 3 119 字符），选它是因为日志只给症状——`Dependencies lock file is not found … Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock`——不说该补 lock、该关 cache、还是本来就不该有 lock，这个分叉要靠仓库历史才收窄。**四组**（`experiments/cognition-control-round2/`，`frozenAt 2026-10-20T16:10:15.281Z`，冻结在任何真模型调用之前；M0 与 M1/M1′ 前三条消息逐字相同，脚本内已断言）：`R` 真 `judgeProposal` → `insufficient-evidence` / `commit-comparison-indeterminate`（产品在这个 run 上不给任何建议）；`M0` 无历史；`M1` 加一条相关历史（截至 `2a2c074` 从未提交过 lock 文件、`.gitignore` 未忽略、本地一直用 `npm install`）；`M1′` 加一条同形态但无关的历史（测试框架一直是 `node:test`）。两条历史各 152 / 135 字符、标 `materialKind: experimental`，来源是 git 提交记录，**不是 Chronicle 事实**。**读数**：三条真调用各一次、不重试，52.3 / 62.7 / 58.3 s，全部 `finish_reason=stop` 且 JSON 可解析。**五维比对**：语义判断三组一致（都归到 cache 找不到 lock，不说成代码缺陷）；`first_look` 首位三组都指向 `Setup Node` / 日志，**复查优先级没有变化**；事实与假设三组都把历史放进 `facts` 并注明「实验材料称…」；信息需求 M1 与 M1′ 各新增一条「去别的 run 找对照」，形态相近、**不干净**；候选介入维出现唯一硬差异——**M1 独有「在 Setup Node cache 步骤之前生成 lock file，需要调整 workflow 顺序」**，配一条只有那条历史才推得出的 assumption（`npm install` 可能在本地生成 lock，但 cache 步骤在 `Install dependencies` 之前，所以本次运行无法依赖后续安装生成 lock），M1′ 的新增（检查 `.gitignore`、其他 run 是否通过）都不依赖它的历史。**两条判断**：「相关历史改变认知」**支持，但只在候选介入这一维**（首位未变、语义未变，反证一并写在 `report.md` §5）；「历史不被误读」**支持**（三组 `resolved` 全 `false`，无「已解决 / 已修复 / 说明根因就是 / 无需再看」）。**一处读数缺陷已记**：C2 冻结成「facts 逐字匹配材料」，中文模型改写英文材料必然全数落空（三组 0/16、0/26、0/10），那读的是语言不是事实；事后补的 token 级回查（抽 ASCII 标识符与数字）显示 52 条 facts 全部可回溯、零编造，这条补充规则在 `report.md` §8 标明「看到输出之后才写、只作辅助读数」。**它不证明**：单模型单端点单场景、每组只跑一次；差异只有一处，任何「模型理解仓库历史」级别的表述都超出证据；历史是构造的实验材料，产品里没有任何路径会把这种记录交给模型（`repository-change-executor.result` 至今不进任何 prompt）；本轮也没测「值不值得打扰人」。**结案**：独立核验通道仍不可用（`audit_dispatch_failed`），按裁决不调不可用路径、不标 achieved，已按 `abandoned` 如实关闭，产物全部保留。**当前 CI 认知实验阶段到此结束，不再追加样本。**

> **口径更新（2026-10-26 · 认知连续性与一次外部实现逆向：两个新产物入库，`src/` 仍零改动）**：本段记两批工作，都只读、都不碰产品代码（`git status --short -- src/ test/` 为 0 行）。**一、最小认知连续性实验**（`experiments/cognition-continuity/`，`frozenAt 2026-10-26T15:51:04.408Z`，冻结在任何模型调用之前）：材料由脚本现读 `git`、`experiments/` 目录、`experiments/README.md` 段落与 `clear/goals/*.md`，**不指定模型该关心什么**；T1 一次调用、T2-A（带 T1 记录）与 T2-B（不带）各一次，A/B 前两条消息逐字相同、B 的请求里检索不到记录片段（两条断言写进 `outputs.json` 的 `checks`）。读数：T1 42 977 ms、T2-A 37 975 ms、T2-B 19 915 ms（**不可横比**，A 先跑替 B 预热了端点前缀缓存）。**「问题自形成」成立**：模型自己挑中 `experiments/galgame-reverse/`——处境里唯一一个「目标已收尾 + 目录未提交 + README 缺小节」三类证据同时成立的候选——写成一句可回答的问题，三条 `facts_used` 都能在材料里逐字找到，`structured` 是 `content` 直接解析、**没有任何字段由程序补写**。**「历史被利用」成立但单维**：T2-A 沿用同一问题对象并给出 T1 里明确说过「不能说明」的结论（应作为实验目录补入 README 目录节），T2-B 无记录时**根本没形成这个问题**；但差别只出现在「目录归属」这一维，「复现前提不完整」那一维 B 不给记录也说了，属新事实自身效力。它证的是记录改变了它答什么，**不证**它意识到自己在延续一个提问（A 未引用旧记录一字，属隐式接续）。**三条方法缺陷已记**：冻结的 `max_tokens=2000` 使 T2-A 首轮 `finish_reason=length`、`content=null`（2 000 token 全花在 `reasoning_content` 上），两组同预算提到 6 000 重跑、首轮原始记录留存未覆盖；`changed_from_record` 字段对无记录组本不适用，T2-B 因此虚构了一个「此前判断」，两组该字段读数不可直接比较；`info_needs` 输出为自然语言而非逐条数组，C4 只能按内容判。**它不证明**：只测了一次接续，没测第三次、没测无新事实时自发回想、没测它能否区分自己的旧判断与他人文本；单模型单端点单场景，未接产品与 Runtime。
> **二、一次外部实现逆向**（`experiments/galgame-reverse/`，对象是仓库外的商业 AI Galgame，Ren'Py 8.2.3）：只用静态解包与反编译（自写 `rpa_tool.py` 走 RPA-3.0、`dump_rpyc.py` 走 RPA-3.0 → Ren'Py RPC2 → AST），**未运行游戏、未改原始安装目录、未输出任何密钥值**。结论：它是「确定性感知 + 模板化表演 + 纯对话式模型」三层，**层间只有单向——感知结果从不进模型上下文**；模型只在玩家打字时运行，请求体**没有 `tools`**，输出里唯一能改产品状态的是 `[GW:±n]` 好感度标记（`[TOOL:…]` 只被剥离、从不执行，是已废弃机制的残留）；桌面宠物的「主动观察」是 20 秒定时器 + 随机数 + 关键词表 + 预设台词（`powershell Get-Process` 取窗口标题、`os.listdir` 读桌面文件名、`GetCursorPos` 算鼠标速度、`GetSystemPowerStatus` 读电量），meta 层甚至用文件的 atime/mtime 比较来推断玩家有没有打开过它留下的便签——**这些判断全部由预设规则做出，模型完全不参与**。**这条线到此为止**：它的四条「可借鉴」都是技巧而非机制，共同前提是「在不需要理解的情况下制造被理解的错觉」；保留下来的唯一价值是否证性的——玩家分辨不出「在演」与「在想」，所以做真认知不是竞争需要，是主动选择。**它不证明**：这些结论只覆盖这一款游戏的这一版；反编译产物依赖仓库外 1.7 GB 安装目录与 205 MB 反编译树，**不能只靠仓库复现**（已在 `experiments/README.md` 的「复现前提」第四条写明）。
> **结案**：两个目标都按 `abandoned` 如实关闭——判据逐条自检均达成、读数与结论未改，独立核验通道不可用（`audit_dispatch_failed: persona+outputSchema+toolFilter: subagents.start is not a function`，第 10 / 11 次），按 Human 既定裁决不调不可用路径、不标 achieved。
> **口径更新（2026-10-27 · PoC-01：Hikari 只读领域能力换宿主 + 被 Agent 自主调用，`src/` 仍零改动）**：一次有界的只读实验（`experiments/poc-01-dsh-cordis/`，18 个产物），Hikari `58123e6` × DSH `0.2.1-rc.2` × Cordis `4.0.5` × Node `24.15.0`，全程 `workspace-write` 沙箱、**未用** `danger-full-access`、未改 DSH 上游。**五项判据全 PASS**：**P1** 桌面感知的四层插件（`foreground` / `input-activity` / `desktop-session-world` / `desktop-session-awareness`）**领域代码零改动**由 Cordis 装载，两边 `title`/`processName` 读到同一真实窗口，三条领域语义（peek 不推进 baseline、current 推进、activation-local state）一致；**P2** 卸载最底层 provider 后依赖方 `waiting`≡`PENDING`、无关插件不受影响、重装自动恢复且拿新实例，`provide`/`defer` 的 disposer 全部按逆序执行；**P3** 真模型 `deepseek-flash` 在**不提工具、不提桌面、不预注入观察**的任务下，第 1 步推理即自主发起 `tool_call peek_desktop` 并拿到真值（同代码另一次给出 `explorer`/`title:null`，非回填）；**P4** session 事件 seq18–21 记录「推理 → `tool/call` → `tool/result` → 下一次推理引用结果」三段；**P5** 用官方 patch 字段（`insert`/`id`/`disabled`）停用全部工具提供者后，写文件任务被框架层拒绝（模型自述无工具、`ls` 确认无文件、session 零 `tool/call`），同 patch 下 `peek_desktop` 仍可用，**patch 未 append 任何提示词**。**三档契约**：可直接表达（`requires→inject`、级联失效、重装恢复、`provide`、`defer` 时机）；需要适配（契约键 `id@version` → 合法标识符编码，版本号从键的一部分变成名字的一部分）；不能等价保证（同名不同版本并存、事件面语义、`waiting/active/failed` 与 `PENDING/ACTIVE/DISPOSED` 非一一对应）。**路线推荐有证据分布支撑**：先验 B（把领域实现抽成包，两个宿主共同导入——这正是 P1/P2 证明可复用的三层），A 作过渡，C 在补齐事件面等价证据前不推。**它不证明**：只测了一个纯只读、无事件、无配置的领域能力，其余 13 个 service 与带事件/配置/写入的插件未验；事件面零证据（适配器故意抛错）；DSH 的 session 历史是会话级重放而非可检索事实库，跨会话持久认知需另建；`exit_plan_mode` 停不掉（无副作用）。**没有发现架构级不兼容**——Cordis 的装载器可承载 Hikari 的领域插件，不必先改领域代码。**结案核验仍被同一故障挡住**（`audit_dispatch_failed`，第 10 次），按约定改记 `abandoned`，产物全部保留。

> **口径更新（2026-10-28 · PoC-02：运行时契约还差哪几块，`src/` 仍零改动）**：PoC-01 证明「插件能换宿主装载」，这一轮只查**运行时契约本身**（`experiments/poc-02-runtime-contract/`，Hikari `f44cb2f` × Cordis `4.0.5` × DSH `0.2.1-rc.2` × Node `24.15.0`，全部脚本**不调模型**）。**五项判定**：**P1 PASS**——真实的 `desktop-session-awareness-loop` 插件在 Cordis 下按 `delayMs` 发布 `desktop-session-awareness-loop.assessed@1`，领域代码零改动；**P2 PASS（4 等价 + 1 需适配）**——等待（Hikari 831/790 ms 对 Cordis 823/793 ms）、并发（314 对 311 ms）、卸载退订（0 对 0）、重新激活（1 对 1）四项等价，**失败聚合需适配**（Cordis 原生 `AggregateError` 的 `message` 是空串，补后与 Hikari 逐字一致）；**P3 PASS（限真实契约集）**——真实 24 个 service（全 v1）编码后两两不同，但编码函数**不单射**（`点/连字符/下划线` 折叠），撞车时 Cordis **静默 `FAILED`**、`fiber.error` 为 `null`、先提供者继续生效；**P4 FAIL**——未声明的 `get`/`provide` 在当前适配层下**没保持原拒绝语义**，5 条里 R1（未声明读）、R3（未声明提供）、R4（声明未提供）**全部被放行**，补检查后状态可一致但错误对象丢不回来；**P5 PASS**——`src/` 与 `test/` 零改动、DSH 上游未修改。**一条立项时的判断被实测推翻并就地更正**：Hikari 的 `loadPlugin` **也不抛异常**（只有 `DuplicatePluginError` 抛），它用 `state='failed'` + `getPluginError(id)` 上报；两侧真实差异只有一处——**错误对象可不可取**（Hikari 拿得到类型与逐字消息，Cordis 的 `fiber.error` 恒为 `null`）。**依赖未满足两侧本来就一致**：Hikari `waiting`、Cordis `PENDING`，都是等待不是拒绝。**PoC-01 报告的两处口径已就地更正**：`repository-ci-attention` 是 **Service 轮询**（`github-ci.current`），**不消费任何事件**——`github-ci/run` 这个事件在今天的 `src/` 里不存在，真实事件只有一个 `desktop-session-awareness-loop.assessed@1`；P3 里模型说的「you've been typing just moments ago」是**超出观察证据的推断**（tick 差只说明有输入活动，不说明设备与窗口），P3 的工具链 PASS 不受影响，但**不得据此宣称语义 grounding 已验证**。**对 C 路线的判断**：可以从「候选」升到「可行」，但必须**先自建一层契约层**（`requires/provides` 声明检查、错误对象保存、单射编码、事件桥接），这层不是装饰——不加它，Hikari 现有的「未声明即失败」纪律在迁移后就没了。**它不证明**：只有一个真实事件、一个生产订阅者，事件面证据很窄；契约键全为 v1，「同名不同版本并存」只在构造用例上测过；订阅者是隔离探针不是生产消费者；失败聚合测的是宿主分发器（真实插件两侧都会吞错）；`internal/status` 能否替代 `fiber.error` 未测。



---


## 当前结论

第一阶段完成了新的最小运行生态：

```text
Runtime
+ Plugin
+ Service
+ Event
+ Effect / 资源清理
+ 基础配置验证
```

第二阶段在这套运行生态之上，开始生长第一个真实领域模块。

第二阶段分解为四项，当前进度：

```text
P2-01  Continuity v1       已完成
P2-02  Chronicle v1        已完成
P2-03  启动入口            已完成
P2-04  生命周期验收        已完成
```

第三阶段开始让 Runtime **感知现实**，并首次进入 **World** 层。当前进度：

```text
P3-01  Windows Foreground Perception v1       complete
P3-02  Windows Input Activity Perception v1   complete
P3-03  Desktop Session World v1               complete
P3-04  Desktop Session Change Awareness v1    complete
P3-05  Phase 3 Vertical Slice Acceptance      complete

Phase 3 COMPLETE
```

**Phase 3 已完成 Perception → World → Awareness minimal slice 的第一条真实纵向链路及其生命周期验收。** P3-04 / P3-05 只证明 Awareness 的最小 change-contextualization slice，**不是完整 Awareness**（见 §「第三阶段收口结论」）。

第四阶段第一次让整条链**被周期驱动**——在此之前没有任何东西会自己调用它；三层各自的 provider **仍然是 pull-only**，P4-01 增加的只是一个周期性 caller。第四阶段同时第一次让整条链**作为一个常驻进程持续存活**。当前进度：

```text
P4-01    Desktop Session Awareness Loop v1       complete
P4-01.1  Awareness Loop timer 上界正确性修正     complete
P4-02    Resident Process Composition v1         complete
P4-02.1  Resident Local Control v1               complete
P4-03    Human-Referenced Repository CI Relevance v1  complete

（补记：`P4-02.1` 此前漏列于本块，与文首状态不一致，本轮一并补上。）

（P4-03 的交付路径由六个 supporting slice 构成——截至本轮共六个：Git Repository
  Perception v1、GitHub CI Perception v1、Repository CI World v1、
  Repository CI Awareness v1、Explicit Work Focus Local Ingress v1、
  Repository CI Relevance v1。
  它们是 supporting slice，工作标签，不占用编号；**收口后也不把它们重新编号为
  P4-03 的子阶段**——它们是真实历史，不是对 P4-03 的追溯拆分。
  P4-03 的正式名称与交付定义见下方「P4-03 收口」一节。）
```

**P4-03 编号此前写作 `未开始`，本轮由人工阶段裁决改为 `complete`。** 这不是「之前漏记」：P4-03 **确实**没有预先冻结的交付定义，`未开始`是在那个前提下准确的；收口定义形成后，`complete` 才是准确的。两次表述分别对应两个不同的事实，不是同一事实的两次记录。

**Phase 4 尚未完成，不得写作 `Phase 4 COMPLETE`。** P4-03 的收口**不改变**这一点：**Phase 4 没有明确的 completion condition**，因此本轮只记录 P4-03 COMPLETE，**不替 Phase 4 发明完成条件**。就已知范围而言，P4-01 只是驱动与发生，P4-02 只是进程组合与进程寿命，P4-03 只是**一个 domain 里的一次局部 relevance judgement**——三者都**没有**把链路推进到 Salience / Importance Judgement，也**没有**让链路产生任何一次 Remember / Ask / Notify / Act。

两处口径必须先说清，避免被读成比实际更大的东西：

```text
P4-01.1 是一次【正确性修正】，不是新的架构层、不是新增 capability
        它把 Loop 的 delayMs 接受域收窄到 Node timer 能忠实表达的范围
P4-02   是【进程组合 + 进程寿命】，不是新的 Runtime 机制
        它没有给 Runtime 增加任何 API，也没有新增任何 Plugin
```

**P2-01 已完成的部分**：

```text
Continuity
+ 显式创建长期主体
+ 严格校验的持久化证据
+ 全新 Runtime 生命周期恢复同一主体
+ continuity.current Service
```

**P2-02 已完成的部分**：

```text
Chronicle
+ 显式创建 Store（initializeChronicle）
+ 纯读取挂载（openChronicle，零写入）
+ 严格校验的 JSONL 事实史
+ 全新 Runtime 生命周期读回已有 facts
+ chronicle Service
```

**P2-03 已完成的部分**：

```text
启动入口（CLI）
+ hikari init            → 只创建长期主体
+ hikari chronicle init  → 只创建事实史（Hikari 不存在则失败，不自动创建）
+ hikari start           → 真实 Runtime 启动组合 + 三种结果语义分离
+ 零创建恢复路径（start 前后持久字节不变）
```

**P2-04 已完成的部分**：

```text
生命周期验收（跨 Runtime）
+ Runtime A 恢复主体 → 挂载事实史 → append Fact A → shutdown
+ 全新 Runtime B 恢复同一主体 → 挂载同一事实史 → 读回同一 Fact A
+ hikariId 与 DurableFact 全部字段跨 Runtime 一致
+ 两个 Runtime 不共享 Runtime / Context / Plugin / Service / identity 对象
+ 新 Runtime 读磁盘而非上一个 Runtime 的内存
+ 7 种可检测损坏诚实失败，不创建、不修复、不截断、不重写
```

P2-04 **没有新增任何生产代码**：`src/` 零改动，验收证据由一个不提供任何 Service 的测试专用 Plugin 承担。

第二阶段四项验收全部达到阶段标准，**Phase 2 已完成最终验收并正式收口，已 push，CI 通过**。

**P3-01 已完成的部分**：

```text
Windows Foreground Perception v1
+ 自治 Plugin foreground.windows（requires: []）
+ foreground.current@1 Service 契约
+ 异步 PowerShell 子进程 + 直接 Win32 P/Invoke 的真实前台获取
+ observation 语义：observedAt / source / foreground.kind
+ title 三态、processName 两态，无包装类型
+ absent 是观测、失败不是观测、未知不塌缩成 absent
+ 非 Windows 宿主 → Plugin failed、消费者 waiting（Runtime 零平台判断）
```

P3-01 **没有修改任何已冻结模块**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/cli/`、`src/index.ts` 的 `git diff HEAD --stat` 全部为空，逐字节未改动。全部产物是新增文件。

P3-01 已完成、已提交、已 push（commit `3d910ee`），CI 已对这批测试跑过并通过（run `35053737581`）。

**P3-02 已完成的部分**：

```text
Windows Input Activity Perception v1
+ 自治 Perception Plugin input-activity.windows（requires: []）
+ input-activity.current@1 Service 契约
+ 异步 PowerShell 子进程 + 直接 Win32 P/Invoke 的 GetLastInputInfo 获取
+ observation 语义：observedAt / source / lastInputTick（原始事实，无解释）
+ dwTime = 0 是合法 tick 而非缺失；uint32 两端边界原样保持，较小的后续 tick 不被修正
+ 无后台观测：pull-only，加载 / 空闲 / 卸载零观测
+ 与 Foreground 并列、互不依赖、互不调用，Runtime 不协调二者，无 PerceptionManager
+ 非 Windows 宿主 → Plugin failed、消费者 waiting（Runtime 零平台判断）
```

P3-02 **没有修改任何已冻结模块**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 的 `git diff HEAD --stat` 全部为空，逐字节未改动。全部产物是新增文件。

P3-02 已完成、已提交、已 push（commit `9495f7c`），CI 已对这批测试跑过并通过（run `35200893510`）。

**P3-03 已完成的部分**：

```text
Desktop Session World v1
+ 自治 World Plugin desktop-session-world（requires: 两个感知契约，provider 缺席即 waiting）
+ desktop-session-world.current@1 Service 契约
+ 一次 current() 在同一个同步段内并发组合两次真实感知获取
+ snapshot 语义：snapshotAt + 逐 facet 的 available / unavailable
+ capability 缺席（Runtime 依赖图 → waiting）与 capability 失败
  （World 内 allSettled → unavailable）分属两个不同机制，互不替代
+ current() 永不 reject：两个 source 都失败仍 resolve 出两个 unavailable facet
+ available + absent 与 unavailable 不塌缩
+ unavailable 不携带原因：World 不读 reason、不检查 error 类型
+ 无平台实现：模块内零 process.platform / 零 PowerShell / 零 Win32 字样
+ pull-only、零持久化、零后台机制、零 Manager、零新依赖
```

P3-03 **没有修改任何既有文件**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部零改动，全部产物是新增文件。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

P3-03 已完成、已提交、已 push（commit `a4f5c94`），CI 已对这批测试跑过并通过（154 tests / 149 pass / 5 skipped / 0 fail）。

**P3-04 已完成的部分**：

```text
Desktop Session Change Awareness v1
+ 自治 Awareness Plugin desktop-session-awareness（requires: World 契约，provider 缺席即 waiting）
+ desktop-session-awareness.current@1 Service 契约
+ 第一次 current() 返回 baseline，第二次起返回 comparison
+ 三个判定值：facet 级 changed / unchanged / indeterminate，整体级 changed / stable / indeterminate
+ 只比较相邻两次 snapshot；不比较 snapshotAt / observedAt（否则恒为 changed）
+ 任一 facet 任一侧 unavailable → 该 facet indeterminate，绝不伪装成 unchanged
+ 不对称优先级：changed 压过 indeterminate；stable 仅在两个 facet 都 unchanged 时成立
+ title 的 omitted / undefined、null、string 三态用 === 保持可分，不做归一化
+ lastInputTick 只比较相等性：不推断方向、时长、活跃度
+ World rejection 原样传播，且失败调用不推进 baseline
+ baseline 是 activation-local（setup 作用域），停用再激活自然回到 baseline
+ pull-only、零持久化、零后台机制、零 Manager、零新依赖、零平台实现
```

P3-04 **没有修改任何既有文件**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/desktop-session-world/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部零改动（`git diff --name-only` 输出为空），全部产物是新增文件。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

P3-04 已完成、已提交、已 push（commit `ead4d7c594b38abaa621fbfc0604a2e73f3d4562`，message `feat: 完成 P3-04 桌面会话变化感知 v1`），CI **success**：176 tests / 171 pass / 5 skipped / 0 fail。

第二阶段**已全部 push**：P2-01 ~ P2-04 共 4 个提交（`194987c` / `e430358` / `86aa3fc` / `58bb596`）全部在远端，CI 已对这批测试跑过并通过。第二阶段没有未结项。P3-01 ~ P3-05 也已全部 push，第三阶段收口当时 `origin/main` = `c07ad36`（已比对确认与本地 HEAD 逐字符相同；此后已随第四阶段前进，当前为 `f3d7673`——见文首状态）。

**第二阶段不新增架构地图（已决定，非未结项）**：第一阶段的图存在，是因为那一步要固定「Runtime 不带领域语义」这条边界本身；第二阶段的产物是接线与验收——P2-01 / P2-02 / P2-03 的因果与边界已由各自的实现文档与架构评审完整保存，P2-04 **没有新增任何生产结构**。此时硬画一张图只会复述已有文字，不增加信息，因此**不以架构图作为第二阶段收口条件**。后续若出现真实的结构变化，再按那时的需要决定是否建图。

另有一条已记录的格式限制随第二阶段进入下一阶段：**Chronicle v1 没有完整性标记**，因此「fact 行被删光、header 完好」的 store 与全新 store 在结构上无法区分，会被报告成空历史。它不影响关闭判断，但是任何后续 Chronicle 完整性工作的明确输入（详见 P2-04 实现文档 §9 与架构评审 §11）。

三个阶段都没有迁移旧 Hikari，也没有实现完整 Awareness、Memory、Goal 或多节点系统。（第四阶段同样没有——见「第四阶段的收尾项 · 一、Awareness 范围」。）

第三阶段第一次让 Runtime **感知现实**：Foreground 报告「谁在前台、什么时候看到的」，InputActivity 报告「系统记录的最后一次输入发生在哪个 tick」，**都不**判断这些意味着什么。P3-03 在此之上首次进入 **World** 层，回答「在这个 scope 内，我现在掌握了哪些事实」。

三层分工与当前落点（**领域定义**，以 `principles.md` §14 为准，继续冻结）：

```text
Perception   我观察到了什么？                      P3-01 / P3-02 已交付
World        在某个 scope 内现在掌握哪些事实？     P3-03 已交付
Awareness    这些事实意味着什么 / 什么值得在意？   P3-04 首次进入（仅最小切片）
```

**P3-04 并不实现完整 Awareness。** 它只是 Awareness 层的**第一个最小 contextualization primitive**，当前只回答：

> 相邻两个 DesktopSessionWorld snapshot 的**可比较 payload** 有没有变化？

对照 `principles.md` §14 给出的推荐链路：

```text
世界变化 → Perception → Observation → 事实标准化 / Contextualization
         → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act
```

P3-04 落在链路中的 **Contextualization** 这一格，并且只落在这一格的最窄面：它把「本次事实」与「上一次事实」放进同一个上下文（相邻两次比较）从而给事实一个坐标。**它不进入 Salience / Importance Judgement，更不进入 Ignore / Remember / Ask / Notify / Act。**

因此本阶段的三条语义分界必须与上面的领域定义同时阅读：

```text
changed       不蕴含「重要」
stable        不蕴含「无事发生」；它是关于观测值的陈述，不是关于世界的陈述
indeterminate 不蕴含「出了问题」；它只蕴含「这一项没法比」
```

这正是 §14 那句「不应把 Foreground、Calendar、DeviceActivity 等传感器集合本身称为完整 Awareness」的同型纪律：**P3-04 是 Awareness 的一个 slice，不是 Awareness。** 把它读成完整的 Awareness，与把一组感知读成完整 Awareness 是同一类错误。

**准确的说法是**：P3-04 **首次让 Perception → World → Awareness 三层在真实代码中贯通**——在此之前，第三层从未有过任何真实实现，"三层"只是文档里的分工。但**贯通不等于完整实现 Awareness**；P3-04 只落实了 Awareness 的**最小 change-contextualization slice**。三层在代码中贯通，与第三层被实现完整，是两件不同的事，不得互相替代。

（本轮更正的一处口径：上一版本文档把 Awareness 的领域定义改写为「这些事实之间有没有差别」，并把「意味着什么」划出 Awareness 层。那是**错误的范围收窄**——§14 定义的 Awareness 明确包含「值不值得在意 / 是否需要记住、提醒或行动」。「有没有差别」是 P3-04 这个 primitive 的能力边界，不是 Awareness 层的定义。）

四步的架构增量都不在于新增能力：

```text
P3-01  证明了一个感知可以存在
P3-02  证明了第二个感知不需要先长出协调层
P3-03  证明了组合两个感知也不需要先长出协调层
P3-04  证明了在组合之上做变化判断，仍然不需要协调层，也不需要 Memory
```

P3-02 的证明方式是：两个感知 Plugin 各自 `requires: []`、各自提供自己的 Service 契约、各自拥有自己的平台判断，Runtime 侧仍然零平台知识、零协调代码。

P3-03 的证明方式是：World 是最容易长成 `PerceptionManager` / `ObservationBus` / `GlobalWorldState` 的地方，而它没有。它**没有为「我是组合者」这个身份要求任何特殊待遇**——取得两个 source 的方式与任何消费者取得任何 capability 的方式完全相同（`requires` 声明、`setup` 里 `get`、调用时 `await`），Runtime 也没有给它任何特殊待遇。Runtime 侧仍然零改动、零新 API。

P3-04 的证明方式是：Awareness 是最容易长成 `AwarenessManager` / `GlobalAwareness` / Super Orchestrator 的地方（「我知道所有事实，所以由我来协调」），而它没有；它也是**第一次出现「需要记住上一次」的诱因**的地方，而它只用一个 `setup` 作用域内的局部变量解决，没有长成 Memory。它取得 World 的方式同样与任何消费者取得任何 capability 的方式完全相同。Runtime 侧仍然零改动、零新 API。

**P3-04 同时确立了一条进入后续阶段的语义分界**：`stable` **是关于观测值的陈述，不是关于世界的陈述**。它只说「两次 snapshot 之间两个可比的 payload 没有差别」，**不表示**用户空闲、不表示用户离开、不表示没有活动、不表示现实世界没有变化。这条分界由模块内的禁用词表在结构上守住（`isIdle` / `isAway` / `userPresent` / `userAway` / `idleFor` 出现即测试失败）。

当前已经证明：

> 新的 Plugin 运行基础可以稳定工作，并且没有重新长成中央大脑、万能通信层或业务类型树；同时 Runtime 之上可以生长真实领域模块，而 Runtime 完全不需要知道该领域的语义。

---

## 已实现

### Runtime

负责：

- Plugin 加载、启动、等待、停止与卸载；
- Service 注册、发现与硬依赖满足；
- Event 注册与派发；
- Effect / 资源归属与自动清理；
- Plugin 基础配置验证。

### Plugin

Runtime 只认识一种 `PluginDefinition`。

当前最小声明：

```text
id
version
requires
provides
config schema（可选）
setup
```

不建立 AgentPlugin / VoicePlugin / SensorPlugin 等业务继承树。

### Service

- Service 承担主要有返回值的数据调用；
- Consumer 只能使用自己声明的 `requires`；
- Provider 只能提供自己声明的 `provides`；
- 缺失依赖时 Consumer 等待；
- Provider 出现后自动激活；
- Provider 消失时依赖关系自动收敛；
- Provider 恢复后 Consumer 可以重新激活。

当前第一版故意只允许一个 Service 契约存在一个活动 Provider。

### Event

- Event 只承担实时通知；
- 支持多个订阅者；
- 订阅随 Plugin 生命周期自动清理；
- 不承担普通查询，也不模拟 Service 请求 / 响应。

### Continuity

回答 `core-architecture-v0.md` §6.1 的问题：

> “这些经历属于谁？”

本阶段只实现其中的最小生命线：一个 Hikari 可以被显式创建，并在一次全新的 Runtime 生命周期中恢复为同一个长期主体。

- 创建只能通过显式调用 `initializeHikari()`；
- 恢复只能通过 `restoreHikari()`，且为纯读取；
- 身份以 `continuity/origin.json` 持久化，写入采用临时文件 + 原子替换；
- 对外只通过 `continuity.current@1` 暴露 `HikariIdentity`；
- `OriginRecordV1` 持久化格式不暴露给消费者。

Continuity 是 Runtime **之上**的模块，从独立入口导入，`src/index.ts` 未修改。

Continuity **不**负责 Memory、World、Goal、设备认证或权限判断，也不知道 Chronicle。

### Chronicle

回答 `core-architecture-v0.md` §6.2 的问题：

> “真实发生过什么？”

本阶段只实现其中的最小事实史：一个 Hikari 可以把一条已经发生的事实追加进自己的事实史，并在一次全新的 Runtime 生命周期中读回它。

- 创建只能通过显式调用 `initializeChronicle()`；
- 打开只能通过 `openChronicle()`，且为纯读取、零写入；
- 缺失 Chronicle **不会**被解释为首次初始化——没有 `openOrCreateChronicle()`；
- 事实以 `chronicle/chronicle.jsonl` 持久化，第一行是 Store Header，之后每行一条 `DurableFact`；
- 对外只通过 `chronicle@1` 暴露 `append` / `get` / `read`；
- `factId` 与 `recordedAt` 由 Chronicle 生成；`type` / `version` / `occurredAt` / `source` / `payload` 由调用方提供；
- `owner` 只存在于 Store Header，是整份事实史的主体绑定，事实内不重复 `hikariId`。

Chronicle 同样是 Runtime **之上**的模块，从独立入口导入，`src/index.ts` 未修改。

Chronicle **不**负责判断「什么值得长期记录」，**不**接管 Event、Memory、World、Goal、Action 或状态恢复，也**不是**所有 Plugin 的强制依赖。它只依赖 Continuity 的公开身份语义，且 Continuity 不知道 Chronicle 的存在。

### 启动入口（CLI）

回答一个很朴素的问题：

> 已经存在的这些能力，怎么真正跑起来？

```text
hikari init --data-dir <path>            只创建长期主体
hikari chronicle init --data-dir <path>  只为已确认存在的主体创建事实史
hikari start --data-dir <path>           构造一次真实 Runtime 启动流程
```

`start` 的三种结果严格区分：

```text
A  Continuity active + Chronicle active   → 启动成功，exit 0
B  Continuity failed + Chronicle waiting  → 无法确认长期主体
C  Continuity active + Chronicle failed   → 主体已恢复，但事实史不可用
```

B 与 C 都返回非 0，但**都不等于「Hikari 不存在」**：B 描述的是本次恢复流程的结果，C 明确保留「主体在、能力不在」的区别。

- CLI 只使用 Continuity / Chronicle / Runtime 的**公开 API**，不读 `origin.json`、不读 `chronicle.jsonl`、不检查 Store owner、不修复任何领域文件；
- CLI 不是身份真源，也不是事实史真源；
- `start` 是持久化意义上的**零创建路径**，前后所有文件字节不变；
- 插件最终状态由 Runtime 的 `requires` 依赖图收敛得出，CLI 不轮询、不重试、不强制激活；
- 没有引入 `HikariCore` / `ApplicationContext` / `BootstrapManager` 等中心对象，也没有新增全局可变状态。

CLI 同样是 Runtime **之上**的模块，`src/index.ts` 未修改。

**CLI 不拥有被组合者**：它不知道身份怎么创建、事实怎么落盘、Store 长什么样。如果实现 CLI 需要读一个领域文件，那说明该领域缺少一个公开 API——正确做法是补 API，而不是让入口下沉去读文件。

### Foreground（P3-01）

回答一个 Runtime 此前完全没有能力回答的问题：

> 此刻人正在看什么？

```text
foreground.windows  Plugin（自治，requires: []）
↓
foreground.current@1
↓
current(): Promise<ForegroundObservation>
```

**Observation 语义**：

```ts
{
  observedAt: string,                       // 核心目标被取得的时刻
  source: 'foreground.windows',
  foreground: { kind: 'absent' }
            | { kind: 'present', title?: string | null, processName?: string }
}
```

三条语义是本阶段冻结的核心：

```text
Absence is an observation.           → kind: 'absent' 是成功观测，resolve
Failure to observe is not.           → 获取失败一律 reject，绝不 resolve 成 absent
Unknown must not collapse into absence. → 元数据取不到只省略字段，不改 kind
```

- 一次 `current()` = 一次新的真实获取，无缓存 / 无复用 / 无去重；
- 加载、空闲、卸载期间**零后台观测**；
- `title` 三态由 `exactOptionalPropertyTypes` + JSON key 存在性表达，**没有** `ObservedValue<T>` 包装类型；
- `observedAt` 由真正执行获取的一方（PowerShell 侧）在 `GetForegroundWindow()` 之后立即产生，父 Node 进程只透传、不重打；
- `source` 是独立字面量常量，**不引用** Plugin ID，Plugin 改名不会静默改变已发出的观测；
- 公开表面恰好 7 个符号；acquisition seam、`createForegroundPlugin`、原始 Windows 类型、HWND、PID 均**不公开**。

**Perception 边界（本阶段冻结）**：

> **Foreground 是 witness，不是 interpreter。**

它只报告「谁在前台、什么时候看到的」，**不**判断这件事是否重要、是否正常、是否值得记住。因此本阶段明确没有实现：语义分类、重要性判断、新鲜度、模型调用、Chronicle 写入、World、Awareness、Judgement，也**没有**过滤 Explorer / 任务栏 / 自身进程。采集侧同样沉默——PowerShell 脚本里没有任何启发式回退，核心获取只有 `GetForegroundWindow()`。

> **现实很奇怪就报告奇怪的现实。**

对应 `principles.md` §14「Perception ≠ Awareness」：感知 Provider 只回答「我观察到了什么」，不回答「这件事意味着什么」。

**平台语义归属**：生产 Plugin 在 `setup` 中做**且仅做一次** `process.platform === 'win32'` 检查。非 win32 时 Plugin `failed`、消费者 `waiting`。**Runtime 不理解 Windows 是冻结边界**；「我的实现能否在当前宿主上工作」是 Plugin ownership 的内部问题，不应泄漏给每一个消费者。`setup` 中不探测前台窗口、不探测 PowerShell 可用性、不探测桌面会话与权限——那些属于运行时观测失败，不属于启动前提。

Foreground 是 Runtime **之上**的模块，从独立入口 `src/foreground/index.ts` 导入，`src/index.ts` 未修改。

Foreground **不**依赖 Continuity，**不**依赖 Chronicle，**不**写任何文件，**不**创建目录，也**没有**新的 Manager。资源所有权沿用既有的 `context.defer()`。

### DesktopSessionWorld（P3-03）

回答 World 层的第一个问题：

> 在这个 scope 内，我现在掌握了哪些事实？

```text
desktop-session-world  Plugin（自治，requires: 两个感知契约）
↓
desktop-session-world.current@1
↓
current(): Promise<DesktopSessionWorldSnapshot>
```

**Snapshot 语义**：

```ts
{
  snapshotAt: string,                    // World 组装完这次 snapshot 的时刻
  foreground:    { kind: 'available', observation } | { kind: 'unavailable' },
  inputActivity: { kind: 'available', observation } | { kind: 'unavailable' }
}
```

四条语义是本阶段冻结的核心：

```text
Observed is observed.               → source 的 observation 按引用透传，不重建、不复制
Failure to observe is not.          → 失败的 source 得到 unavailable，绝不伪造 observation
The snapshot carries no interpretation. → 不做跨 facet 比较、关联、对齐或推断
The snapshot is one instant.        → 两个 source 同段启动，snapshotAt 在两者都 settle 之后产生
```

**两套时间轴同时可见且不被比较**：`observation.observedAt` 是感知时刻，`snapshot.snapshotAt` 是组合时刻。World 不重打 source 的时间戳，也不声称两者是同时刻的事实。

**Dependency 语义（本阶段最容易做错的一处）**：capability **缺席**与 capability **失败**分属两个不同机制，互不替代：

```text
capability 缺席（该感知根本没加载）  → Runtime 依赖图  → World waiting，current() 不可达
capability 在位但本次获取失败        → World 内 allSettled → World 保持 active，该 facet unavailable
```

World **不**自己检查 Provider 是否存在，**不**把依赖声明成可选，**不**用运行时动态发现绕过依赖图。它不会在缺 provider 的情况下假装 `active`，也不会为了拿到 partial world 去绕过 Runtime 的依赖模型。provider 消失时走既有的 `#deactivateTree` 收敛回 `waiting`。

**失败边界**：

```text
desktopSessionWorldService.current() 永不 reject
→ 两个 source 同时失败时仍 resolve，返回两个 unavailable facet
→ 「一条事实都没有」是 World 的一个合法答案，不是 World 自身的失败
```

World **不是错误总线**：不聚合、不转发、不分类 error，不读 `result.reason`，不检查 error 类型。同步抛出与 promise rejection 落到完全相同的位置（由 `Promise.resolve().then(...)` 折叠）。`unavailable` **不携带原因**——World 不拥有它所组合的 source 的失败分类学，把 transport 细节写进这个契约等于把 PowerShell 退出码提升成 World 层公开语义。

**`available + absent` ≠ `unavailable`**：Foreground 的 `{ kind: 'absent' }` 是一次**成功的观测**（观测到「此刻没有前台目标」），与「没能观测」是两条完全不同的事实，实现上不可能塌缩——`available` 只由 `fulfilled` 分支产生，`unavailable` 只由 `rejected` 分支产生。

**并发**：两个 source 在**同一个同步段**内启动，因此 snapshot 覆盖的是单次获取所能提供的最窄窗口。真实路径实测一次组合约 **386ms**，而同轮两个感知各自单独运行为 638ms / 674ms——串行应在 1300ms 量级。同段启动是真的在起作用。

**Perception → World 边界（本阶段冻结）**：

> **World 是 composer，不是 interpreter。**

它只回答「我手里有什么」，不回答「这代表什么」。因此本阶段明确没有实现：`GlobalWorldState`、`WorldManager`、`PerceptionManager`、Awareness、Judgement、Salience、Importance、Attention、User Presence、Idle Detection、Activity Classification、freshness / stale / TTL / `ageMs`、缓存、latest snapshot、polling、timer、watcher、event、history、retry framework、dedup、debounce、rate limiting、Chronicle 集成、模型调用、跨 runtime / 跨 session 聚合。

> **现实很奇怪就报告奇怪的现实**；解读属于第三层，不属于 P3-03。

**命名**：模块名为 `desktop-session-world` 而非 `windows-session-world`，理由是结构性的——本模块**没有任何 Windows 专属实现**。把平台写进 World 的公开身份，会把「当前 provider 的实现平台」误固化成「World 的定义范围」。

DesktopSessionWorld 是 Runtime **之上**的模块，从独立入口 `src/desktop-session-world/index.ts` 导入，`src/index.ts` 未修改。

World **不**依赖 Continuity，**不**依赖 Chronicle，**不**写任何文件，**不**创建目录，**没有**新的 Manager，也**没有** `context.defer()`——它不拥有任何资源。与 P3-01 / P3-02 不同，World **没有内部 seam**：它的两个依赖就是两个 capability，二者都经 Runtime 的 service registry 取得，因此测试直接加载**生产 Plugin**，无需具名内部 import。

### DesktopSessionAwarenessLoop（P4-01）

回答一个此前没有模块回答的问题：

> 什么时候再问一次？

P4-01 之前三层链路是**纯 pull-only** 的：没有调用就没有任何观测发生。Loop 是第一个**周期性驱动**这条链的 Plugin。

```text
desktop-session-awareness-loop  Plugin（普通 PluginDefinition）
requires: desktop-session-awareness.current@1
provides: []
↓
每次 cycle 调用 awareness.current()
↓
desktop-session-awareness-loop.assessed@1
payload: DesktopSessionAwarenessAssessment（按引用透传）
```

- 它是一个**普通 `PluginDefinition`**，没有为自己要求任何特殊待遇；
- 事件名归 Loop 所有而不是归 awareness：它说的是「谁问的、什么时候问完的」，**不**改写 provider 仍是 pull-only 这一事实；
- payload 就是 `DesktopSessionAwarenessAssessment` 本身，**按引用透传**：没有 Loop 专属副本、没有追加字段、没有第二个时间戳；
- **0 个订阅者是合法状态**——Event 是通知，不是待办。

**调度语义（本阶段冻结的核心）**：

```text
不是 setInterval              → 每个 cycle 由【上一个 cycle 完成】之后才排下一个
每个 activation 至多一个 cycle in-flight
采集慢于 delayMs 时不会重叠  → 不重叠是调度的形状，不是一条用来兜底的守卫
```

**cleanup 顺序**（`context.defer`，顺序本身承载语义）：

```text
stopped = true             → 先立旗标，让从 await 中恢复的 cycle 看得到
clearTimeout(pendingTimer) → 再拆掉计时器，此后不可能再排新的 cycle
await inFlight             → 最后等当前 cycle 结算，本 activation 完全落定后才交还 scope
```

**P4-01 的上限（必须与上面的记录同时阅读）**：

```text
P4-01 交付的是  drive（驱动）+ occurrence（发生）
P4-01 没有交付  Salience / Importance / Remember / Notify / Act
P4-01 没有交付  完整 Awareness
```

它让「相邻两次 World snapshot 有没有差别」这个判断**第一次可以反复发生**，但**没有**让它变得更重要、更值得记住或更值得通知。Loop 自身不持有 baseline、不持有 latest assessment、不统计失败次数——baseline 属于 awareness，它只拥有「什么时候再问一次」这一个问题。

### Resident（P4-02）

回答一个此前没有被回答的问题：

> 已经能跑起来的东西，怎么**一直跑下去**？

P4-02 新增 `hikari resident`，与 `hikari start` **严格区分**：

```text
hikari start     一次性启动验证
                 创建 Runtime → 加载组合 → 检查状态 → shutdown → 退出
                 语义完全未变，本轮零改动

hikari resident  生产常驻组合
                 创建 Runtime → 加载真实链路 → 保持存活
                 → SIGINT / SIGTERM 请求终止 → runtime.shutdown() → 退出
```

**`start` 不是「旧版 resident」，resident 也不是「改版 start」**：前者回答「这套组合现在能不能起来」，后者回答「起得来之后，谁来一直持有这个进程」。

**生产组合有两个，都是合法的，各自被测试单独钉住。**（**口径更新（JUDGEMENT REACHABILITY v0 之后）：现在是四个，全部合法、全部被单独钉住**——上面两个之外，再加「repository scope + model」（十五个成员，语言成员是 repository-aware variant）与「model 而无 repository scope」（十个成员，语言成员是 base variant）。**四个 roster 共享同一个基础前缀且共有成员保持相对顺序**，由 `test/resident-cli.test.mjs` 的 `四个 roster 共享同一个基础前缀` 一条钉住；两个语言 roster 加载的是**不同**的 variant。见 `judgement-reachability-v0.md`。） 默认组合（正好九个 Plugin，按加载顺序）：

```text
1  continuity
2  chronicle
3  foreground.windows
4  input-activity.windows
5  desktop-session-world
6  desktop-session-awareness
7  desktop-session-awareness-loop
8  desktop-session-observe
9  work-focus
```

显式给出 `--repository-root` 与 `--repository` 之后，在上面九个之后**追加**五个（因此默认组合是启用组合的字面前缀）：

```text
10  git-repository
11  github-ci
12  repository-ci-world
13  repository-ci-awareness
14  repository-ci-relevance
```

**（口径更新（JUDGEMENT REACHABILITY v0 之后）：给了 model 时再追加第十五个 `language`，且它加载的是 repository-aware variant——它要求 `repository-ci-relevance.current@1`，因此必须排在第 14 个成员之后；没有 model 就没有这个成员。）**

**「九个」不再是一个架构不变量，而是默认组合这一条可执行事实。** 它最初读作不变量，之后读作「默认组合恰好是这八个」，现在读作「恰好是这九个」。因此测试钉的是**每条合法组合各自**（现在是四条），而不是把九改成十四：把成员数当成不变量，会在下一次合法组合出现时逼出一次无意义的改数。

> **口径更新（PROACTIVE slice 与 DESKTOP RETURN ATTENTION v0 之后）：上面两段仍然成立，但「四条」这个计数已不再准确。** 合法组合现在是**两条相互独立的轴之积**，而不是一份列表：**scope 轴**（base / +language / +chain / +chain+language）与 **mandate 轴**（无主动授权 / CI / return / 两者）。可达的 roster 因此是：`base`；`base+language`；`base+language+delivery+return`；`base+chain`；`base+chain+language`；`base+chain+language+delivery+{ci | return | both}`。
>
> **不是这个乘积里的每一格都可达，而不可达的那些正是 `options.ts` 按名字拒绝的**：每个 decider 都要经过 Language 说话，因此**没有 model 就没有任何 mandate**；CI decider 还要一条链，因为它报告的对象是一个 repository。`--proactive-return-delay-ms` / `--proactive-return-after-ms` 因此**不要求 repository scope**——看这台机器的输入与任何 repository 都无关，不让它依赖一个它用不到的 scope 是刻意的（`src/cli/resident.ts` 的注释记录了这一点）。
>
> **测试钉的是「六个有代表性的 roster」而不是全部八个**：两个轴各自被钉住、`human-delivery` 在任何组合里都只加载一次、inactive 的成员不出现。**因此上面那句「把成员数当成不变量会在下一次逼出改数」依然是对的方向。**本轮实际改了两处措辞，各自解决自己的问题：`src/cli/resident.ts` 的组合注释从「五个合法组合」的枚举改成乘法式表述（列的是两条轴与不可达格，这样再加一条 mandate 轴时它不必重写）；`test/resident-cli.test.mjs` 的注释与测试名则只是把「五个 roster」改成「六个 roster」——**测试钉的仍然是每条具体 roster 的逐字成员表**（例如 `[...BASE_MEMBER_IDS, 'language', ...RETURN_MEMBER_IDS]`），不是乘积本身，这也正是上面那句警告的适用对象。

`work-focus` 是 P4-03 Explicit Work Focus Local Ingress v1 加入的成员，也是唯一一个**供人写入、而不是供人读出**的 Plugin。**它现在提供 `work-focus.current@1`**（不变的是：不发 Event、没有自己的存储、公开面仍然只有它自己的本地端点）。（**口径更新（Durable Fact Admission v0 之后）：本句里的「不写 Chronicle」已不成立**——它现在承认自己的 durable fact，`requires` 也因此是逐字 `[chronicleService]`；「没有自己的存储」仍然成立，且写入前后数据目录里仍然只有那两个文件，有测试钉住。见文首 Durable Fact Admission v0 一段。）这条 contract 的成立依据是 Repository CI Relevance v1 带来的真实 consumer，见文首 Contract Gate 重新裁决一段。放在最后是有意的而非追加的，理由见 `src/cli/resident.ts` 的 `productionComposition`。

`desktop-session-observe` 是 Desktop Observation Surface v1 加入的第八个成员，也是**第一个供人读出**的感知出口：它把 Awareness 交回来的 assessment **原样转述**成人可读的行。它 `requires` 只有 Awareness 契约——Desktop Inspection Semantics v1 之后是 `desktop-session-awareness.peek@1`，**不是** `...current@1`，而这个区别就是它与 judgement timeline 的全部关系（见文首该条）——、`provides` 为空（reader 是 CLI），**不**读取 World、**不**直接读取任何来源、**不**新增任何判词、**不**持久化。它被排在 Awareness Loop 之后，是因为它读的是那条环链的产物。

Repository CI 那一链**只有当配置存在时才被组合**，且 Resident 对此**只**知道一件事：那两个配置值有没有一起给。它不知道 repository 是什么、CI 是什么、两个 commit 串是否相等、relevance 是什么意思——这些全部由各成员自己的 `requires` / `provides` 与 Runtime lifecycle 决定。

顺序不是装饰：一个 Plugin 被加载时它的 `requires` 已经满足，因此不能运行的留在 `waiting` 而不是被挪来挪去，读回的状态就是操作者看到的状态。

**Resident 是什么 / 不是什么（本阶段冻结）**：

```text
Resident 是    process composition root（进程组合根）
Resident 是    process lifetime owner（进程寿命所有者）
Resident 不是  Plugin
Resident 不是  Runtime 机制
Resident 不是  Scheduler
Resident 不是  Super Orchestrator
```

职责三分，互不越界：

```text
Resident 决定  进程何时开始 / 何时结束、加载哪些 Plugin、什么算就绪、
               何时请求整条 Runtime 停机、进程信号 / 退出码 / 面向操作者的状态
Runtime  决定  Plugin 生命周期、依赖收敛、卸载顺序、清理顺序
Plugin   决定  自己跑什么、自己拥有哪些资源
```

`src/cli/resident.ts` **不**自己卸载任何 Plugin、**不**读 Plugin 内部、**不**重排 Runtime 已经在编排的 teardown。它对 Hikari 的全部认知来自 Runtime 报告的状态与 Runtime 记录的错误。

**进程寿命 lease（P4-02 最容易被做错的一处）**：

Resident **不**依赖 Loop 的计时器、**不**依赖 PowerShell 子进程、**不**依赖任何领域 Plugin 恰好持有 handle 而存活。它自己持有一个 `MessageChannel` / `MessagePort` lease，一直持有到 `runtime.shutdown()` 结算完成，然后关闭。

```text
理由：一个 pending promise 不是 handle
      没有自己的 lease 时，「进程还活着」就只是某个领域 Plugin 行为的
      副产品，而不是 Resident 做出的决定
选择 MessagePort：它是一个没有行为的 handle —— 不会触发、不会漂移、
      不会被误当成一个 cadence，也不对 Hikari 的领域说任何话
```

代价是一条真实性质：**进程寿命因此与领域 Plugin 解耦**——Loop 的计时器停了、PowerShell 子进程没了，都不影响「这个进程是否还该活着」这个问题的归属。

**`MessagePort` 不是 Runtime primitive**：它只是当前这套 CLI 组合的实现手段，没有进入 Runtime，也没有成为任何契约。lease 在一切可能失败之前取得、在其余一切之后释放——这正是这套安排的意义：整个停机期间进程寿命仍归 Resident 所有，disposal 不会被进程提前消失打断。

**就绪语义（必须连同上限一起读）**：

```text
ready = 九个 Plugin 全部 active
      = 组合成立 + Loop 已武装
```

**ready ≠ 第一次 assessment 成功**，**≠ 后台链路健康**，**≠ 后续每一次获取都会成功**。v1 **没有**任何公开表面能回答后三者，因此本文件不写、也不得被读成「Hikari 已确认持续正常感知桌面」。空组合判为未就绪：一个什么都没有的组合没有可「就绪」的东西。

**Chronicle 边界**：

```text
Resident 要求 Chronicle active 作为就绪前提
Resident 不 append、不读 Store 内部格式
Resident 不把 assessed Event 自动写进 Chronicle
```

原因只有一句：**Event 不等于 Durable Fact**（`principles.md` §11）。「观察到一次 assessment」与「决定把这件事长期记住」是两件事，后者属于 Awareness 的判断，不属于进程组合根。

**Event 边界**：

`desktop-session-awareness-loop.assessed@1` 在生产组合中**仍然允许 0 个订阅者**，**现在也确实没有**。P4-02 **没有**新增任何订阅者，也**没有**把 Event 变成待办。

准确说法是：这条 Event **第一次可以在一个真实的生产常驻组合里被持续发布**；但**仍然没有语义上的 Consumer**。不得因为 Resident 已落地，就把它描述成「Event 已有 production consumer」。

**平台边界**：

P4-02 v1 的生产范围是 **Windows 桌面常驻组合**，但 **Resident 自己不写 `process.platform`**。平台判断仍然只属于 `foreground.windows` / `input-activity.windows`。非 win32 宿主上的表现是：

```text
Provider 自身 setup 抛出   → Plugin failed
↓ Runtime 依赖图
下游 world / awareness / loop 保持 waiting
↓
Resident 报告【能力不可用】，退出 1
```

这是**感知 Provider 在自己的 ownership 内判断宿主不适用**之后沿依赖图诚实收敛的结果，**不是 Resident 在判断操作系统**。

**口径修正（P4-02.1 收口后）**：上面的「Resident 自己不写 `process.platform`」**只对 `src/cli/resident.ts` 成立，并且仍然成立**。P4-02.1 新增的 `src/cli/control.ts` 里出现了一处 `process.platform !== 'win32'`，但那不是**感知**的平台判断，而是**控制通道**的机制判断：Named Pipe 是 Windows 的内核对象，非 win32 宿主上没有它。两者不冲突，也不构成「Resident 开始判断操作系统」——合成根至今没有按平台挑过任何 Plugin 或任何行为。

### Resident 本地控制（P4-02.1）

回答 P4-02 自己记下的一条限制：

> 在 Windows 上，操作者**没有**任何办法让一个从别的终端启动的常驻优雅地停下来。

```text
hikari status --data-dir <path>   问一个正在跑的常驻：你现在是什么状态
hikari stop   --data-dir <path>   请求一个正在跑的常驻：按你自己的顺序停下来
```

**这不是运维子系统，是 P4-02 §11 限制 3 的收口。** 实现范围被严格限定为：两条命令、一个 Windows 本地 Named Pipe、一个只有两个词的封闭协议。

**端点发现：派生，不是发布。**

```text
canonical dataDir  →  sha256  →  前 16 个 hex  →  \\.\pipe\hikari-resident-<16 hex>
```

两端调用**同一个函数**，因此不是「约定一致」而是**构造上一致**。**没有写 address file**：一个落盘的地址文件用「记得的事实」回答「有没有常驻在跑」，而派生名由操作系统自己回答——连得上就是活着，连不上就是 `ENOENT`，而 `ENOENT` 不是缓存的意见，是此刻的真话。

**协议：一个版本、两个词，封闭。**

```text
{"protocol":1,"request":"status"}          {"protocol":1,"outcome":"ok","lines":[...]}
{"protocol":1,"request":"stop"}            {"protocol":1,"outcome":"failed","lines":[...]}
```

**没有 payload、没有 plugin id、没有 routing、没有第三个词。** 这不是靠自律维持的：`readEnvelope` 要求「键的数量恰好相等、每个键都在」，因此多一个 `payload`、多一个 `pluginId` 今天就会被**拒绝**。一个对未知字段宽容的信封**本身就已经是一个可扩展 schema**——那样一来，「不预留字段」就从对本 build 的描述变成了对下一个 build 的承诺。

**`status` 只报告 Runtime 已经知道的事**：状态取自 `getPluginState`，错误取自 `getPluginError`，一个字都不探测、不问桌面、不推导。它是**转述，不是健康检查**。

**`stop` 不是一条新的停机路径**：它调用的是与第一个 `SIGINT` / `SIGTERM` 触发的**同一个** `signals.request()`——同一个 promise、同一批要摘掉的监听器、同一个「有人要求这个进程停下」的可观测点。

**寿命归属未被改写**：监听器与每个已接受的 socket 都 `unref()`，因此一个开着的端点**永远不是**进程活着的理由；常驻仍然只由自己的 lease 决定自己活多久。端点承诺的是**反面**：它必须在进程消失**之前**消失，而 shutdown 里的 `await control.close()` 就是这句话。

**端点比 Runtime 活得久，是有意的。** 顺序是「先 `runtime.shutdown()`，再 `control.close()`」：停机没有固定时长，先关掉的端点会在整段仍在进行的 teardown 期间报告「不存在」——那会让客户端拿到一句关于**时机**的真话，却读成一句关于**世界**的真话。换来的承诺是「端点保证在进程之前消失」。停机中 endpoint 仍然可达，并且会如实多打一行「Hikari 常驻正在停止。」。

**一个数据目录只有一个端点**，由操作系统自己执行（第二个监听器得到 `EADDRINUSE`）。这**不是**要绕开的端口冲突，它**就是**「这里是不是已经有一个常驻在跑」的答案。第二个常驻因此**拒绝启动**，而不是共用一个端点——否则会有两个进程加载同一套组合、写同一个 store，而一次 `status` 描述一个进程、一次 `stop` 结束另一个。

### Git Repository Perception v1（P4-03 supporting slice）

回答一个此前没有任何模块能回答的问题：

> 这个**明确指定的本地 Git repository** 现在处于什么状态？

它是 **P4-03 的一个 supporting slice**（**工作标签，不占用阶段编号**；该轮当时 P4-03 尚未收口，收口决定见「P4-03 收口」一节）。立项理由不是未来可能性，而是一件**已经发生的事**：P4-03 的 Explicit Declaration / Reference Frame 研究已经实际推进，并确认当前缺少稳定的 named-object source，导致 repository-level relevance 无法继续建立。本轮交付的是那个已经发生的 blocker 的 supporting capability。**Consumer implementation 尚未存在**，plugin-design-spec §16.1 明确允许这一点。

> **traceability 补齐（P4-03 Explicit Human Reference Frame Boundary Review 后）**：上述「Explicit Declaration / Reference Frame 研究」此前只存在于对话历史，仓库内没有对应 artifact。现已固化为 `docs/architecture/phase-4-explicit-human-reference-review.md`。该轮 verdict 为 **BLOCKED**，唯一 blocker 是「尚未出现真实 human designation 与真实 reader 所形成的已发生跨模块语义」——**这只是对下一 slice 是否就绪的判定，不改变本段关于 Git Repository Perception v1 立项依据的结论**。

```text
git-repository  Plugin（自治，requires: []）
↓
git-repository.current@1
↓
current(): Promise<GitRepositoryObservation>
```

**Observation 语义**：

```ts
{
  observedAt: string,                    // 组装完成的时刻，不承诺原子 snapshot
  source: 'git-repository',
  workTreeRoot: string,                  // git 报告的顶层根，可以是配置路径的祖先
  head: { kind: 'branch', name, commit }
      | { kind: 'detached', commit }
      | { kind: 'unborn' },
  workTree: { kind: 'unchanged' } | { kind: 'changed' },
  remotes: readonly string[]             // 只有名字，不碰网络
}
```

四条语义是本轮冻结的核心：

```text
Unborn is an observation.            → 刚 init 的仓库是状态，不是读取失败
A missing remote is a legal state.   → rc=0 + 空输出 → []，不是失败
Exit codes are reported, not translated. → 没有 code→meaning 映射表
Git is Plugin-private.               → git.ts 不在 barrel 里，全仓零外部引用
```

**本轮在实机上发现并修掉了一处会静默报错的真实缺陷**：`# branch.head` 对「真正 detached」与「分支名恰好叫 `(detached)`」写出**逐字节相同**的输出。判据是 `git branch --show-current`（答案是输出，不是退出码），因此 `resolveHead` 是一个**条件第四命令**——只有这一种有歧义的情形才多付一个进程。

**Git 边界全部来自真实运行**（`git version 2.53.0.windows.3`）：untracked 必须用 `-unormal` 显式要求（否则随 `status.showUntrackedFiles` 配置变化）；非仓库路径 rc=128；`rev-parse --show-toplevel` 可以是配置路径的祖先；`GitRepositoryError` 是配置拒绝、`GitRepositoryObservationError` 是观测失败，两者不混。

**本轮没有修改任何既有文件**：`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/desktop-session-world/`、`src/desktop-session-awareness/`、`src/desktop-session-awareness-loop/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部零改动，全部产物是新增文件。**Resident 的生产组合仍然是七个 Plugin**，本轮**没有**加入 composition。`dependencies` 仍为 `null`。

**上限声明**：本轮交付「一个具名本地对象的一次观测」，**没有**交付 relevance、**没有**交付 repository identity、**没有**进入任何 Judgement、**没有**创建通用 Perception framework。

---

## 验收状态

### P2-01 Continuity v1

本次新增文件：**12 个**。

```text
src/continuity/  (9)
  contracts.ts  errors.ts  index.ts  initialize.ts  origin-record.ts
  plugin.ts  restore.ts  storage.ts  types.ts
test/continuity.test.mjs                          (1)
docs/development/phase-2-continuity.md            (1)
docs/architecture/phase-2-continuity-architecture-review.md  (1)
```

修改文件：`package.json` 与 `package-lock.json`（新增 `@types/node` devDependency，工具链依赖）、`docs/development/current-stage.md`。

`src/runtime/` 与 `src/index.ts` 未修改。

本地自动化测试：**23 / 23 PASS**（17 个 Continuity + 6 个 Runtime）。

编译：`tsc` 无错误。

P2-01 Architecture Review：**PASS**。

图谱变更分析（`git add` 后执行，实际覆盖 Continuity 新文件）：**15 files / 124 symbols / 18 flows，risk critical，无 partial / truncated**。critical 构成已定位——45 个为文档标题符号，79 个为 Continuity 代码符号，18 条受影响流程全部是本阶段新增流程，无任何 `src/runtime/` 符号或 Runtime 流程受影响。详见 P2-01 架构评审 §14。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**。

本机图谱工具限制：MCP `detect_changes` 因 LadybugDB 被其他 GitNexus 进程锁定而不可用，改用 CLI 兜底；`query()` 的关键词 / 语义检索因 FTS 扩展加载失败而不可用。二者均不影响图遍历能力。

### P2-02 Chronicle v1

本次新增文件：**13 个**。

```text
src/chronicle/  (10)
  contracts.ts  errors.ts  fact.ts  index.ts  initialize.ts
  open.ts  plugin.ts  service.ts  store.ts  types.ts
test/chronicle.test.mjs                                       (1)
docs/development/phase-2-chronicle.md                         (1)
docs/architecture/phase-2-chronicle-architecture-review.md    (1)
```

修改文件：`docs/development/current-stage.md`。

`src/runtime/`、`src/continuity/` 与 `src/index.ts` 未修改。

本地自动化测试：**56 / 56 PASS**（33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

编译：`tsc` 无错误。

P2-02 Architecture Review：**PASS**。

图谱变更分析（`git add` 后执行，实际覆盖 Chronicle 新文件）：**14 files / 205 symbols / 46 flows，risk critical，无 partial / truncated**。critical 构成已定位——57 个为文档标题符号，148 个为 Chronicle 代码符号，46 条受影响流程全部是本阶段新增流程，无任何 `src/runtime/` 或 `src/continuity/` 符号、也无任何 Runtime / Continuity 流程受影响。详见 P2-02 架构评审 §21。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**。

本机图谱工具限制：索引中存在一处假阳性（`test/runtime.test.mjs ACCESSES test/chronicle.test.mjs` 三条边，而该文件实际零引用 Chronicle）；分析器自报流程分析未穷尽（24 个入口未追踪、7 条流程因 maxProcesses 丢弃、58 个 callee 因 maxBranching 跳过），因此受影响流程数只应读作下界。`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P2-03 启动入口

本次新增文件：**6 个**。

```text
src/cli/  (5)
  chronicle-init.ts  init.ts  main.ts  options.ts  start.ts
test/cli.test.mjs                                            (1)
```

修改文件：`package.json`（新增 `bin` 入口）、`docs/development/current-stage.md`。

`src/runtime/`、`src/continuity/`、`src/chronicle/` 与 `src/index.ts` 未修改（`git diff HEAD --stat` 对这四个路径输出为空，逐字节未改动）。

本地自动化测试：**82 / 82 PASS**（26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

CLI 测试用 `spawnSync` 拉起 `dist/cli/main.js`，断言的是**真实进程退出码与真实 stdout / stderr**。

编译：`tsc` 无错误。

P2-03 Architecture Review：**PASS**。

图谱变更分析（`git add` 后执行，实际覆盖 CLI 新文件）：**10 files / 120 symbols / 27 flows，risk critical，无 partial / truncated**。critical 构成已定位——48 个为文档标题符号，72 个为 CLI 代码符号（`src/cli/` 60 个 + `test/cli.test.mjs` 12 个），无任何 `src/runtime/`、`src/continuity/`、`src/chronicle/` 或 `src/index.ts` 符号，27 条受影响流程全部是 CLI 自身流程。CLI 向外的 IMPORTS 边 14 条，全部指向公开入口，无一条指向存储模块。详见 P2-03 架构评审 §17。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**。

本机图谱工具限制：分析器自报流程分析未穷尽（33 个入口未追踪、10 条流程因 maxProcesses 丢弃、70 个 callee 因 maxBranching 跳过），因此受影响流程数只应读作下界；索引元数据自报落后一个提交，但 `src/cli/` 符号确实已在图内；跨语言字段解析不完整（`.code` / `.stdout` / `.stderr` 等字段的引用查询会返回空结果，空不等于无人使用）。`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P2-04 生命周期验收

本次新增文件：**3 个**。

```text
test/phase-2-lifecycle.test.mjs                                   (1)
docs/development/phase-2-lifecycle.md                             (1)
docs/architecture/phase-2-final-architecture-review.md            (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/` 零改动**（`git diff HEAD --stat -- src/` 输出为空）。本轮没有新增任何生产代码，也没有为测试修改 Runtime API。

本地自动化测试：**98 / 98 PASS**（16 个 P2-04 + 26 个 CLI + 33 个 Chronicle + 17 个 Continuity + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

验收本身经过变异测试：向 `dist/chronicle/service.js` 注入模块级共享缓存（模拟跨 Runtime 复用内存状态，`src/` 未改动、事后重建恢复）后 **3 个用例失败**。首次变异只触发 2 个，暴露出当时的磁盘测试对「内容是否来自内存」没有判别力，据此补写了真正有判别力的用例（`test/phase-2-lifecycle.test.mjs` 第 3 条）。详见 P2-04 实现文档 §10。

P2-04 Architecture Review：**PASS**。

图谱变更分析（`git add` + 重建索引后执行）：**4 files / 113 symbols / 0 flows，risk low，无 partial / truncated**。构成为测试代码 69 个 + 三份文档标题 44 个，`src/` 零符号，受影响流程 0 条。

第一次执行返回 `changed_count: 0` 而 `changed_files: 1`——新文件从未被索引，没有符号可供映射。重建索引后才是有效结果，这一点已记入评审 §12。

CI（`.github/workflows/runtime-tests.yml`，ubuntu-latest，`npm test`）：**PASS**（run `34955475103`，commit `58bb596`）。

本机图谱工具限制：**图谱不解析 `.mjs` 的 IMPORTS 边**（全图 89 条 import 边全部来自 TypeScript scope），因此针对测试文件的导入查询返回空——这个空结果不是「没有依赖」的证据，本轮该结论改用文本检索获得；分析器自报流程分析未穷尽（29 个入口未追踪、74 个 callee 因 maxBranching 跳过、4 条 walk 被预算截断），因此受影响流程数只应读作下界；跨语言字段解析不完整（113 处），`.code` / `.stdout` / `.stderr` 等字段的引用查询会返回空结果，空不等于无人使用。`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P3-01 Windows Foreground Perception v1

本次新增文件：**11 个**。

```text
src/foreground/  (7)
  acquisition.ts  contracts.ts  errors.ts  index.ts  plugin.ts  types.ts  windows.ts
test/foreground.test.mjs                                            (1)
test/foreground-windows.test.mjs                                    (1)
docs/development/phase-3-foreground.md                              (1)
docs/architecture/phase-3-foreground-architecture-review.md         (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/cli/`、`src/index.ts` 与 `package.json` 全部未修改**（`git diff HEAD --stat` 对这几个路径输出为空，逐字节未改动）。`dependencies` 仍为 `null`。

本地自动化测试：**118 / 118 PASS**（18 个 Foreground 确定性 + 2 个 Windows 真实 smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

P3-01 Architecture Review：**PASS**。

**边界验证暴露并修复了两个真实 bug**（均位于本轮新增文件内，未触碰任何冻结模块）：

```text
1. readAcquisition 的 absent 分支冻结 target、present 分支不冻结
   → 两条同层分支行为不一致；公开契约未破坏（toObservation 无条件冻结），
     但任何未来改动 toObservation 都会让 present 路径静默泄漏可变对象
   → 改为对称冻结

2. dispose() 杀死飞行中的子进程时被描述成 "did not finish in time"
   → 根本没有超时发生，那是 shutdown；人类会去追一个不存在的超时
   → 改为按 disposed 标志给出真实描述

3. 拆除路径此前无任何自动化覆盖 —— 上述消息正是这样活下来的
   → 已在 Windows smoke 新增一条真实回归测试（断言消息不得声称超时）
   → 本轮唯一新增的仓库测试
```

**66 条探针断言的性质（必须与结论同时阅读）**：

```text
probe-parsers 31 + probe-transport 17 + probe-runtime 18 = 66，全绿

但它们是：会话临时目录中的一次性探针，不在仓库内、不进 CI、不可复现
它们不是：可复现的回归覆盖

价值在于验证对象是从 dist 取出的真实生产常量，而非手写副本：
  - ENCODED_ACQUISITION_SCRIPT 被断言解码后与 ACQUISITION_SCRIPT 字节一致
  - absent 分支由对真实常量做一处 token 替换（$handle = [IntPtr]::Zero）得到
  - 字符保真断言 79 个码点逐码点一致，含 U+2000B 与 U+1F600 两个星形面字符
```

不把探针写回仓库是**决定**，不是遗漏：那意味着新增测试代码，超出纯文档收口的范围。若希望这 66 条变成持久证据，需要单独决定（代价是扩大测试面或增加第二处内部 import）。

**PowerShell v1 limitation**：

```text
每次 current() ≈ 370–455 ms（PowerShell 进程启动 + Add-Type 编译 P/Invoke）
对照 loadPlugin ≈ 0–1 ms
```

选择异步子进程而非 `spawnSync` 是**架构性**理由而非性能优化：Runtime 未来承载多个自治 Plugin，不应为了单次前台观测长时间整体阻塞 event loop。代价是本阶段刻意保留的 v1 实现限制，不设 SLA、不预先优化。它决定了 **Foreground 目前只能被显式调用，不能作为高频采样源**——任何高频前台感知需求都必须先解决这个成本。

P3-01 已完成、已提交、已 push（commit `3d910ee`），CI 已跑过并通过（run `35053737581`）。

**P3-01 收口轮未做图谱变更分析**：`detect_changes({scope: "all"})` 返回 `changed_count: 0`，但该轮全部产物是未跟踪新文件，不进 `git diff`，索引也早于该轮改动——**这个 0 必须读作「未看见」，不是「无影响」**（与 P2-04 §12 记录的是同一类）。该轮为纯文档收口、未执行 `git add`，因此**没有可引用的图谱证据**。「无侵入」的结论由 `git diff HEAD --stat` 为空逐字节支撑，不依赖索引新鲜度。

本机图谱工具限制：**图谱不解析 `.mjs` 的 IMPORTS 边**，针对测试文件的导入查询返回空——本轮涉及测试对 `dist/foreground/plugin.js` 的 import，属同一情形，空结果不是「没有依赖」的证据；`query()` 的关键词 / 语义检索仍因 FTS 扩展加载失败而不可用。

### P3-02 Windows Input Activity Perception v1

本次新增文件：**11 个**（此前写作 10，与 `9495f7c` 的 `--name-status` 实际不符：7 个 src + 2 个 test + 2 个 docs 为新增，`current-stage.md` 为修改，合计 12 项改动。本轮一并更正）。

```text
src/input-activity/  (7)
  acquisition.ts  contracts.ts  errors.ts  index.ts  plugin.ts  types.ts  windows.ts
test/input-activity.test.mjs                                      (1)
test/input-activity-windows.test.mjs                              (1)
docs/development/phase-3-input-activity.md                        (1)
docs/architecture/phase-3-input-activity-architecture-review.md   (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部未修改**（`git diff HEAD --stat` 对这几个路径输出为空，逐字节未改动）。全部产物是新增文件。

本地自动化测试：**137 / 137 PASS，0 skipped**（16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。

编译：`tsc --noEmit` 无错误。

P3-02 Functional Review：**PASS**。P3-02 Architecture Review：**PASS**。

**本阶段的主要架构结果**：多个自治 Perception Plugin 可以**并列存在，而无需中央 Perception Manager**。两个感知互不 `requires`、互不调用、互不持有内部对象，Runtime 不协调二者；全 `src/` 中 `process.platform` 只出现两处，都在各自的平台实现内，`src/runtime/` 零命中。

**与 P3-01 最尖锐的不对称：P3-02 没有 absent 分支。** `GetLastInputInfo` 只有成功 / 失败两种返回，而 `dwTime = 0` 是**合法 tick**（约等于系统启动时刻），不是「从未有输入」的哨兵。把 `0` 当作缺失正是冻结原则所禁止的无依据解释，因此 `0` / `1` / `0xFFFFFFFF` 一律原样报告，`isUint32` 只拒绝结构上不可能的值。代价已如实记入限制：本模块无法区分「自启动以来没有输入」与「tick 恰好很小」。

**142 条探针断言的性质（必须与结论同时阅读）**：

```text
A 脚本往返 2 + B 调用顺序 3 + C readAcquisition 6 + D describeFailure 3 + E 无解释 4 + F 真实传输 3
= 21 组 / 142 条断言，全绿

但它们是：会话临时目录中的一次性探针，不在仓库内、不进 CI、不可复现
它们不是：可复现的回归覆盖
```

价值在于验证对象是从 dist 取出的真实生产常量，而非手写副本：`ENCODED_ACQUISITION_SCRIPT` 被断言解码后与 `ACQUISITION_SCRIPT` 字节一致；`ok: false` 分支由对真实常量做一处 token 替换（`$info.cbSize = 0`）得到，实测 exit code 1、`killed: false`、**stdout 为空字符串**；uint32 两端悬崖 `4294967295` 接受 / `4294967296` 拒绝。本轮探针**未发现实现缺陷**。

**已知 coverage gap（watch item）**：`windows.ts` 的 parser rejection branches 不在 `npm test` 内，由探针覆盖。P3-01 已采用相同取舍，**现在该缺口已涉及两个模块**。本轮结论仍是不为测试覆盖扩大 public API、不改 seam；若未来出现第三个同型 parser，应重新评估 test seam 与 transport seam。

**P3-01 的 teardown bug 在 P3-02 中没有重新出现**，且这次有持久回归覆盖：Windows smoke 断言拒绝为 `InputActivityObservationError` 且消息不得包含 `did not finish in time`。

**已知限制**：

```text
每次 current() ≈ 523 ms（PowerShell 进程启动 + Add-Type 编译 P/Invoke）
两个感知并列使用时是两个独立子进程，无摊薄、无预热、无常驻
单次 observation 本身不提供 idle duration —— 这是冻结边界，不是缺陷
传输外壳与 P3-01 重复 68 行逐字相同的非平凡行，本轮刻意不抽公共 helper
```

> **口径更新（DESKTOP RETURN ATTENTION v0 之后）：上表第三条已不再成立。** 该 slice 在 observation 上新增了第四个原始字段 `observedTick`（与 `lastInputTick` 同一次采集、同一个 Windows 计数器读数），因此**单次 observation 已经可以算出「距上次输入多久」**：`(observedTick − lastInputTick) >>> 0`。契约版本仍是 `@1`，`lastInputTick` 与 `observedAt` 的语义一个字未改。这是一次有意的**能力增长**而非 jurisdiction 扩张——Input Activity 仍然只报告源报了什么，仍然不比较这两个 tick、不算时长、不认识阈值；算与判定都在 consumer（`desktop-return-attention`）那一侧。本条**原样保留**，因为「Input Activity 自己不做解释」这条边界今天仍然成立（见 `docs/development/phase-3-input-activity.md` §4 / §14.2 与 `docs/architecture/desktop-return-attention-v0-implementation-boundary-freeze.md` §1–§2）。

重复的理由是架构性的：两个实例不足以判定「稳定共享机制」与「各自 acquisition semantics」的边界在哪里，且错误的抽象比重复更难撤销——它一旦被两个已交付模块依赖，就获得事实上的冻结地位。重新评估触发条件是客观的：**出现第三个同型 Windows Perception，或 P3-01 因独立需求解冻**。

P3-02 已完成、已提交、已 push（commit `9495f7c`），CI 已跑过并通过（run `35200893510`）。

**P3-02 收口轮未做图谱变更分析**：`detect_changes({scope: "all"})` 返回「未检测到变更」，但该轮全部产物是未跟踪新文件，不进 `git diff`——**这个 0 必须读作「未看见」，不是「无影响」**。该轮为纯文档收口、未执行 `git add`，因此**没有可引用的图谱证据**。「无侵入」的结论由 `git diff HEAD --stat` 为空逐字节支撑。

### P3-03 Desktop Session World v1

本次新增文件：**7 个**（实现轮 6 个 + 收口轮新增架构评审文档 1 个）。

```text
src/desktop-session-world/  (4)
  contracts.ts  index.ts  plugin.ts  types.ts
test/desktop-session-world.test.mjs                                 (1)
docs/development/phase-3-desktop-session-world.md                   (1)
docs/architecture/phase-3-desktop-session-world-architecture-review.md  (1)
```

修改文件：`docs/development/current-stage.md`。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部未修改**（`git diff HEAD --stat` 对这几个路径输出为空，逐字节未改动）。全部产物是新增文件。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

本地自动化测试：**154 / 154 PASS，0 skipped**（17 个 DesktopSessionWorld + 16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。全量为 137（既有）+ 17（本阶段）。

编译：`tsc --noEmit` 无错误。

P3-03 Functional Review：**PASS**。P3-03 Architecture Review：**PASS**。

**本阶段的主要架构结果**：World 是最容易长成 `PerceptionManager` / `ObservationBus` / `GlobalWorldState` 的地方，而它没有。组合是**在没有协调层的情况下**发生的——没有事件总线、没有通用 Observation 框架、没有中心注册表、没有 scope 注册表。World 取得两个 source 的方式与任何消费者取得任何 capability 的方式完全相同，Runtime 没有为它新增任何 API。

**本阶段最重要的契约不变量**：`current()` 永不 reject。两个 source 同时失败时仍 resolve 出两个 `unavailable` facet。「一条事实都没有」是 World 的一个合法答案，不是 World 自身的失败。World 不是错误总线——不聚合、不转发、不分类 error，不读 reason，不检查 error 类型。

**capability 缺席与 capability 失败分属两个机制**：缺席走 Runtime 依赖图（World `waiting`，`current()` 不可达），失败走 World 内的 `allSettled`（World 保持 `active`，该 facet `unavailable`）。World 不自己检查 Provider 是否存在，不把依赖声明成可选，不用运行时动态发现绕过依赖图。

**本阶段拿到真实图谱证据（与前两轮收口不同）**。前两轮的收口是纯文档、未执行 `git add`，全部产物是未跟踪新文件，`changed_count: 0` 必须读作「未看见」。本轮先 `git add` 5 个代码 / 测试文件并重建索引，因此数字有效：

```text
detect_changes --scope staged
  51 changed symbols / 5 files / affected_processes: [] / risk_level: low
  无 partial，无 truncated，无 HIGH / CRITICAL

changed_symbols 构成：
  src/desktop-session-world/  16 个（contracts 3 + plugin 7 + types 6）
  test/desktop-session-world.test.mjs  35 个

IMPORTS 边：对外 12 条，外部目标恰好 4 个
  runtime/contracts.ts、runtime/plugin.ts、foreground/index.ts、input-activity/index.ts
  全部是公开入口；到任何内部模块的边 0 条
指向 src/desktop-session-world/ 的入边：0 条
```

**17 条确定性测试中有 2 条（并发、`snapshotAt` 时序）的判别力由一次性变异探针验证**，因为「测试通过」不等于「测试有判别力」：

```text
基线                        17 pass / 0 fail
两次获取改为串行            1 fail（测试 14）
snapshotAt 上提到 await 之前 1 fail（测试 6）
同上 + 加强前的弱断言        17 pass / 0 fail   ← 关键对照
```

最后一行是关键：同一个被破坏的实现，在换回弱断言后**重新变绿**，证明加强是承重的而非文字润色。**`snapshotAt` 测试的初始写法几乎没有判别力**——整个 snapshot 在远小于 1 毫秒内跑完，两个时间戳落在同一毫秒，`>=` 照样成立；改为等待**时钟本身**跨过毫秒边界（`nextMillisecond()`）后才真正生效。

**已知 coverage gap 未加剧**：P3-01 / P3-02 的 `windows.ts` parser rejection branches 不在 `npm test` 内，该缺口仍涉及两个模块、无变化；P3-03 没有 parser、没有平台分支、没有内部 seam，其全部分支都在仓库测试覆盖内。本轮**没有**新增第二处具名内部 import——World 没有需要被替换的内部实现。

**已知限制**：

```text
unavailable 不携带原因 → 只看 snapshot 无法区分超时 / 权限拒绝 / 无法启动
World 结构上平台中立，但今天只在 Windows 上跑得起来（两个 provider 都是 Windows-only）
snapshot 不判断新鲜度 —— 两套时间轴都在，但不比较
两次子进程成本未被摊薄：World 没有让感知变快，只是没有让它更慢
snapshot 原子性只到「单次获取的最窄窗口」，不声称两个 observation 同时刻
World 不校验 observation 形状 → 其契约保真度依赖两个感知的契约保真度
```

P3-03 已完成、已提交、已 push（commit `a4f5c94c5987b51a3c2439742c39158f7f70686c`）。CI 已对这批测试跑过并通过：**154 tests / 149 pass / 5 skipped / 0 fail**（同样 5 条 Windows smoke 在 `ubuntu-latest` 上自我 skip）。

### P3-04 Desktop Session Awareness v1

本次新增文件：**6 个**（实现轮 5 个 + 收口轮新增架构评审文档 1 个）。

```text
src/desktop-session-awareness/  (4)
  contracts.ts  index.ts  plugin.ts  types.ts
test/desktop-session-awareness.test.mjs                                 (1)
docs/architecture/phase-3-desktop-session-awareness-architecture-review.md  (1)
```

修改文件：`docs/development/current-stage.md`（本轮），以及 `docs/development/phase-3-desktop-session-awareness.md` 的三处最小事实修正（术语、并发语义、限制 6）。

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/desktop-session-world/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部未修改**（`git diff --name-only` 输出为空，逐字节未改动）。全部产物是新增文件。**特别注意：P3-03 的 `src/desktop-session-world/` 一个字节都没动**，本阶段只消费它的公开契约。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

本地自动化测试：**176 / 176 PASS，0 skipped**（22 个 DesktopSessionAwareness + 17 个 DesktopSessionWorld + 16 个 InputActivity 确定性 + 3 个 InputActivity Windows smoke + 18 个 Foreground 确定性 + 2 个 Foreground Windows smoke + 33 个 Chronicle + 17 个 Continuity + 26 个 CLI + 16 个生命周期 + 6 个 Runtime）。全量为 154（既有）+ 22（本阶段）。

编译：`tsc --noEmit` 无错误。

P3-04 Functional Review：**PASS**。P3-04 Architecture Review：**PASS**。

**本阶段的主要架构结果**：P3-04 **首次让 Perception → World → Awareness 三层在真实代码中贯通**，三层第一次**同时**运行在同一个 Runtime 中，而 Runtime 对三层语义的知晓量仍是 0——`baseline` / `changed` / `stable` / `indeterminate` 这四个词没有出现在 `src/runtime/` 的任何一行。**贯通不等于完整实现 Awareness**；P3-04 只落实了 Awareness 的最小 change-contextualization slice（详见上文「三层分工与当前落点」）。Awareness 是第一个消费 World 的模块，它消费的是 World 的**结论**，不是 World 的**原料**；它没有直连 Foreground / InputActivity（源码 allowlist + 图谱 IMPORTS 边 + Serena 符号引用三层证据一致）。

**本阶段最重要的语义不变量**：**没有数据 ≠ 没有变化。**「没拿到数据」写成 `unchanged` 会让调用方以为「确认过，没变」，实际是「根本没看」——这两种情形语义相反。因此任一 facet 任一侧 `unavailable` → 该 facet 是 `indeterminate`，绝不伪装成 `unchanged`。

**判定代数是刻意不对称的**：`changed` 优先于 `indeterminate`，`stable` 仅在两个 facet 都 `unchanged` 时成立。理由是 `changed` 是**存在性**断言（「至少有一处不同」），可以由局部证据支撑；`stable` 是**全称**断言（「没有任何一处不同」），必须覆盖所有可比项。

**baseline 的 reset 是派生性质，不是新增机制**：`previous` 声明在 `setup` 作用域内，于是 World 消失 → `#deactivateTree` → 再激活时 `setup` 重跑 → 第一次 `current()` 自然回到 `baseline`。**本阶段为此没有写一行代码**。

**最小事实补记（Desktop Inspection Semantics v1 收口后）**：本模块此后**多提供**一个契约 `desktop-session-awareness.peek@1`，与 `current@1` 同一个 owner、同一份 `previous` baseline、同一个 `compare`，差别只有一处赋值——`current()` 读完之后写回 `previous`，`peek()` 不写。`current()` 本身**逐字未改**，上面这条 reset 性质对两者同样成立（`peek` 的第一次调用同样是 `baseline`，有测试钉住）。本模块**没有**因此多出任何 state、持久化、Event 或 Service。

**`title` 的三态保持是刻意的**：`exactOptionalPropertyTypes: true` 下 `title?: string | null` 在生产环境有三个可观察状态（omitted / `undefined`、`null`、`string`），三者都真的会发生，比较用 `===` 使它们两两可分。折叠（`?? null`）会把「读不到标题」与「读到了，是空标题」这两种不同事实判为 `unchanged`。

**关于 `detect_changes`：本轮的 0 必须读作「未看见」，且比 P3-03 更强**。本轮未执行 `git add`（收口纪律禁止 stage），全部产物是**未跟踪**文件，`detect_changes` 读的 `git diff` 按定义看不见它们——**重建索引后重测仍然是 0**，证明与索引新鲜度无关。这与 P3-03 那一轮（先 `git add` 因此拿到有效的 51 changed symbols）的差别，是收口纪律的直接后果，不是退步。本阶段的边界结论因此改由**源码 allowlist 断言 + 图谱 IMPORTS 边 + Serena 符号引用**三层证据支撑。

**`staleness.commitsBehind` 不可按数值采信（本轮拿到比 P3-03 更硬的证据）**：重建索引后 `.gitnexus/meta.json` 的 `lastCommit` 与 HEAD **逐字符相同**（已用 `git rev-parse HEAD` 比对），而该字段**仍报 `commitsBehind: 4`**——它很可能在服务进程启动时被缓存，重建之后没有重读。判定索引新鲜度只能靠 `meta.json` 与 `git rev-parse HEAD` 的直接比对。

**22 条确定性测试中有 3 条关键性质的判别力由一次性变异探针验证**，因为「测试通过」不等于「测试有判别力」：

```text
基线                                        22 pass / 0 fail
M1  title 比较改用 ==                        1 fail（测试 10）
M2  overallChange 让 indeterminate 优先      1 fail（测试 13）
M3  let previous 上提到模块作用域            9 fail（含测试 16）
```

M1、M2 各自**只**打翻应当打翻的那一条，说明两条性质被精确钉住。探针自身出过一次错误：第一版三次变异**全报 MISSED 且零失败**，原因是脚本用行首锚点 `^✖` 匹配 Node reporter 输出而 `✖` 前带 ANSI 色码，**探针把「有失败」读成了「无失败」**。修正后才得到上表。教训：**一个会把自己读错的探针比没有探针更危险。**

**已知 coverage gap 未加剧**：`src/foreground/windows.ts` 与 `src/input-activity/windows.ts` 的 parser rejection branches 不在 `npm test` 内（P3-01 / P3-02 已记录），缺口仍涉及两个模块、无变化；P3-04 没有 parser、没有平台分支、没有子进程、没有内部 seam，其全部分支都在仓库测试覆盖内，**也没有新增第二处具名内部 import**。

**已知限制**：

```text
不区分「变了」的种类 → title 改了与进程换了都是同一个 changed
stable 在真人使用下偏少 → 只要用户有输入，inputActivity 就是 changed
indeterminate 不携带原因 → 与 World 的 unavailable 同源决定
只比较相邻两次 → 「A → B → A」在第三次报 changed，不报「回到原状」
previous / current 是引用 → 靠快照已冻结的约定，本层不做防御性拷贝
并发下不保证 invocation-order baseline → baseline 按【成功 World acquisition
  的完成顺序】前进，不按调用发起顺序。v1 明确不增加 mutex / queue / serialization
本层不校验 World 返回的快照形状 → 契约保真度依赖 World，World 又依赖两个感知
```

**并发语义（须与限制同时阅读，勿读作保证）**：v1 不保证 concurrent `current()` 的调用顺序与 baseline 推进顺序一致。先被调用、但 World 后返回的那次，会成为后一次比较的 `previous`。单个 assessment 不受影响——每一次 `current()` 自身仍然完整、自洽、可引用；受影响的只是「哪两次读数被拿来配对」。理由：v1 的调用方只需要「拿两次读数做个比较」，在出现真实需求之前引入排队，是为想象中的调用方付协调成本。

P3-04 已完成、已提交、已 push（commit `ead4d7c594b38abaa621fbfc0604a2e73f3d4562`，message `feat: 完成 P3-04 桌面会话变化感知 v1`），CI **success**：176 tests / 171 pass / 5 skipped / 0 fail。

### 第一阶段

第一阶段 Architecture Review：**PASS**。

第一阶段正式架构地图已纳入仓库：

```text
docs/diagrams/phase-1-runtime.architecture.json
docs/diagrams/phase-1-runtime.html
```

其中 `.architecture.json` 是 Archify 可维护的架构源模型，`.html` 是独立、可交互的人类可读架构视图。

Archify `showcase` 校验结果：**9 / 9 checks PASS，0 errors，0 warnings，repository evidence verified**。

自动浏览器 `visual-check` 当前不作为阶段阻塞条件；现有机器上的 Edge DevTools 自动检查仍有兼容性问题，但确定性 `validate` / `deliver` 已通过，HTML 已人工打开并可正常交互。

### 阶段标准

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

第一阶段：**已满足**。

第二阶段：**已满足**——P2-01 / P2-02 / P2-03 / P2-04 四项全部达到该标准，已正式收口。

第三阶段 P3-01：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push。

第三阶段 P3-02：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push。

第三阶段 P3-03：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push。

第三阶段 P3-04：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `ead4d7c`，CI success：176 tests / 171 pass / 5 skipped / 0 fail）。

第三阶段 P3-05：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `c07ad36`，CI success：184 tests / 178 pass / 6 skipped / 0 fail）。

第三阶段：**已满足**——P3-01 / P3-02 / P3-03 / P3-04 / P3-05 五项全部达到该标准，**已正式收口**。

第四阶段 P4-01：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `082fb97`，message `feat: add desktop session awareness loop`），CI 通过。

第四阶段 P4-01.1：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `8ea725c`，message `fix: bound awareness loop timer delay`），CI 通过。它是一次**正确性修正**，不是新的架构层，也不是新增 capability。

第四阶段 P4-02：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `0db5516`，message `feat: add resident process composition`），CI（Runtime Tests #21）**success**。

第四阶段 P4-02.1：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `138cf9c`，message `feat: add resident local control channel`），CI（Runtime Tests #35516173973）**success**。它是 P4-02 的**从属轮次**（一条已知限制的收口），不是新的架构层，也不是新增感知 capability。

P4-03 supporting slice（Git Repository Perception v1）：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `ca2db7a`，message `feat: add git repository perception`），CI（Runtime Tests #35567512137）**success**。它是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用阶段编号**，因此**不计入上面任何一条进度**。（该轮当时「P4-03 尚未开始」；**收口后此句已不适用于当前状态**——P4-03 已由六个 supporting slice 的实际交付收口，见「P4-03 收口」一节。）

P4-03 supporting slice（GitHub CI Perception v1）：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `65dd556`，message `feat: add github ci perception`），CI（Runtime Tests #35569202089）**success**。同样是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用阶段编号**。它是第二个具名对象源；**没有独立阶段文档**（见头部状态行的说明）。

P4-03 supporting slice（Repository CI World v1）：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `f4234ef`，message `feat: add repository ci world`），CI（Runtime Tests #35574151359）**success**，实现与立项依据见 `docs/development/phase-4-repository-ci-world.md`。它把 git-repository 与 github-ci 两份 observation 装进同一个显式 repository scope，**没有**比较 SHA、**没有**进入任何 Judgement。同样是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用阶段编号**。

P4-03 supporting slice（Repository CI Awareness v1）：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `6d537e0`，message `feat: add repository ci awareness`），CI（Runtime Tests #35574857716）**success**。它是 **Hikari 第一个真实的 cross-source Awareness / Judgement**（判词细节、边界与 no-consumer 说明见头部状态行）。同样是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用阶段编号**；**没有独立阶段文档**，理由与 GitHub CI Perception v1 相同。

P4-03 supporting slice（Explicit Work Focus Local Ingress v1）：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `b0ecde2`，message `feat: add explicit work focus ingress`），CI（Runtime Tests #35582154818）**success**；其状态记录为 `e0403ec`（CI Runtime Tests #35582297057 **success**）。立项依据与边界冻结见 `docs/architecture/phase-4-explicit-work-focus-review.md`（verdict **NARROW**）。它交付的是**人类主动写入的入口**，**没有**交付任何 Judgement。同样是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用阶段编号**。（此前本表漏列此行，本轮一并补上。）

P4-03 supporting slice（Repository CI Relevance v1）：**已满足**——Functional PASS + Architecture PASS + Docs updated，已提交、已 push（commit `b78ae57`，message `feat: add repository ci relevance`），CI Runtime Tests #35621174568 **success**（401 tests / 347 pass / 54 skipped / 0 fail；跳过的是依赖命名管道的用例）。它是 **Hikari 第一个 relevance judgement**，也是第一个经产品入口读到 human declaration 的 reader，并由此使 `work-focus.current@1` 的 Contract Gate 由「不创建」翻转为「创建」（判词规则、三种情形的区分与 composition 条件化见文首状态行）。同样是 **P4-03 的一个 supporting slice，不是 P4-03 本身**——**工作标签，不占用阶段编号**；**没有独立阶段文档**，理由与 GitHub CI Perception v1 相同。

第四阶段：**尚未完成**——P4-01 / P4-01.1 / P4-02 / P4-02.1 **以及 P4-03** 五项已达到该标准并已收口。上表 P4-03 各行记录的是它的六个 supporting slice，**收口后它们仍然是 supporting slice，不被重新编号为 P4-03 的子阶段**；P4-03 的正式名称、交付定义与完成依据见「P4-03 收口」一节。**注意**：P4-03 的收口**不使 Phase 4 完成**——Phase 4 没有明确的 completion condition，本轮不替它发明。且在 Awareness 链路上，Salience / Importance Judgement 与 Ignore / Remember / Ask / Notify / Act **均未进入**。**不得写作 `Phase 4 COMPLETE`。**

---

## 当前明确仍不做

> **本节的性质**：这是一张 **citation surface（引用面）**，**不是法源**。其中每一条的规范力来自它**转写自**的文档（`principles.md` / `core-architecture-v0.md` / `plugin-design-spec.md` / 各 phase architecture review），而不是来自它写在这里。转写时**必须保留主语**——一条主语被省略的规则不可读，应当被**重写**，而不是被遵守。分类与升级规则见 `docs/architecture/governance-rules-v1.md`。

- 跨 Runtime 通信；
- 节点网络协议；
- 远程 Provider；
  **口径澄清（Repository CI World v1 收口后）**：此处「远程 Provider」指的是**运行在其他 Hikari Runtime / 节点上的 Provider**——即跨 Runtime / 跨节点的 Provider 发现与调用，与上面的「跨 Runtime 通信」「节点网络协议」是同一族。**它不等于「本地 Plugin 读取远程外部服务」**。`github-ci` 是后者：它是一个**本机进程内的普通 Plugin**，只是恰好通过 HTTPS 读 GitHub 的公开 API。把两者混为一谈会同时**高估**已落地的东西（误以为跨节点能力已经有了）和**低估**还缺的东西（误以为本地读取外部服务的 pattern 还没建立）。判断依据是**Provider 跑在哪里**，不是**它读什么**；
- Capability 第二注册表；
- Provider 智能选择；
- 全局状态中心；
- 完整权限系统；
- Memory / Goal 的领域实现，以及 **World 层的完整实现**——P3-03 只落地了一个 scope 的最小局部视图（一个桌面会话、两个来源、逐条可用性），没有 `GlobalWorldState`、没有 scope 注册表、没有跨 scope / 跨 runtime / 跨 session 聚合；
- Chronicle 的完整领域实现（P2-02 只落地了最小事实史，P2-04 只验收了它的跨 Runtime 生命周期）；
- **Chronicle v1 存储格式的完整性标记**（事实计数 / 链式哈希 / 墓碑）——因此「fact 行被删光、header 完好」的 store 与全新 store 无法区分，会被报告成空历史。这是已记录的格式限制，不是实现缺陷；
- **常驻进程之外的守护进程化**——OS daemon / Windows Service 安装、systemd service、pid 文件、日志文件子系统、后台服务安装器、开机自启、崩溃自动重启、watchdog / supervisor。
  **口径修正（P4-02 收口后）**：下列四项**已经落地**，不得再列为未做——✅ `hikari resident` CLI 组合、✅ 进程寿命归属（Resident 自己的 lease）、✅ SIGINT / SIGTERM 处理、✅ 本地长期运行进程。
  **常驻进程 ≠ 守护进程 / 服务**：`hikari resident` 由操作者在前台启动、由操作者的信号**或在 Windows 上的 `hikari stop`** 结束，不注册为系统服务、不脱离终端、不自动重启。把两者混为一谈会同时高估已落地的东西、低估还缺的东西；
  **口径修正（P4-02.1 收口后）**：第五项**也已经落地**——✅ 本地控制入口（`hikari status` / `hikari stop` + Windows Named Pipe，见 §「已实现 · Resident 本地控制（P4-02.1）」）。这不是 daemon 化：它没有让常驻脱离终端、没有引入 pid 文件、没有引入日志子系统、没有引入认证，也没有做自动重启 / watchdog / supervisor。**它只是让「从另一个进程请求优雅停机」这件事在 Windows 上第一次成为可能**；
- 配置文件、环境 Profile、节点配置、用户配置中心——CLI 只有一个必填参数 `--data-dir`；
- ~~`hikari stop` / `hikari status` / `hikari log` 等运维命令~~；
  **口径修正（P4-02.1 收口后）**：`hikari status` 与 `hikari stop` **已经落地**（本地 Named Pipe，见 §「已实现 · Resident 本地控制（P4-02.1）」）。
  **仍然不做**：`hikari log`——没有日志文件子系统，也没有任何远程 / 跨机控制面；
  且这两条命令**只有读与停机两种语义**，不是运维面：没有配置重载、没有重启、没有健康检查、没有身份认证。把「能问能停」读成「可运维」是高估。
- 启动失败后的自动重试、自动修复、自动创建；
- Event 自动转 Durable Fact，以及任何「什么值得长期记录」的自动判断；
- 事实的 `update` / `delete` / 查询 DSL / 全文搜索 / 向量搜索；
- 事实写入失败后的重试幂等语义（去重、幂等键、补偿读取、自动重试）——`ChroniclePersistenceError` 只表示本次写入未获得可靠持久化确认，**不**保证事实未落盘，调用方不得仅凭它判定事实不存在；
- `getOrCreate` / `openOrCreate` 与任何全局身份中心；
- 身份迁移、备份、修复、升级；
- **感知的语义解读**——Salience / Importance / freshness 判断、基于标题的语义分类、模型调用、「什么值得记住」的判断。P3-01 / P3-02 只交付 witness，P3-03 只交付 composer，P3-04 只交付 comparator，**都不**交付 interpreter；
- **Awareness 的完整实现**——`principles.md` §14 定义 Awareness 负责「这件事意味着什么？值不值得在意？是否需要记住、提醒或行动？」，其链路为 Contextualization → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act。**P3-04 落实了这条链路的第一个最小 contextualization slice**（相邻两个 World snapshot 的 payload 变化比较），**P4-03 supporting slice（Repository CI Awareness v1）落实了第二个、且是第一个 cross-source 的 comparison slice**（同一次 snapshot 内两个 source 各自报告的 commit SHA 是否相同）。二者都**只**做比较，链路其余部分——Salience / Importance 判断、Ignore / Remember / Ask / Notify / Act——**均未进入，且未被预埋**。P4-01 / P4-02 同样没有进入：它们交付的是**驱动**与**进程寿命**，不是判断；
- **跨 source 的推断**——把「前台是 X」与「刚有输入」合起来推出「某人正在打字」这类结论。P3-03 把两条事实放进同一个信封，但**不**解释它们的关系。
  **口径更新（Repository CI Awareness v1 收口后）**：P3-04 仍然**只**做同一 facet 的跨时间比较（相邻两个 World snapshot 的 payload 变化）；**P4-03 supporting slice 第一次实现了 cross-source Awareness**。但它的判词**仍然是比较，不是推断**——当前唯一落地的 cross-source judgement 是「local Git HEAD commit 与 GitHub CI latest run head SHA 是否相同」，输出**仅为** `same` / `different` / `indeterminate`，**不**把两条事实合起来推出任何新结论。它**不是** repository identity、**不是** importance、**不是** salience、**不是** action；**不得**从 `same` 推导「同一个 repository」，**不得**从 `different` 推导「不是同一个 repository」。
  **口径更新（Repository CI Relevance v1 收口后）**：**repository identity 仍未进入**；**repository-level relevance 已经进入**，但只有一条已冻结的极窄 v1 规则——human designation 与 `snapshot.githubCi.observation.repository` **逐字相等**即 `relevant`，否则 `unknown`，**没有** `unrelated`；**禁止** trim / 大小写折叠 / basename / owner 拆分 / 路径解析 / remote URL 推断 / repository identity 推断 / fork 检测 / 模糊匹配 / alias / 模型匹配 / embedding / 语义相似度。它与 Awareness 的 `same` / `different` / `indeterminate` **正交**，**不是** importance / salience / action，也**不产生**任何 significance 或 action 语义；
  **口径更新（P4-03 收口后）**：P4-03 已 COMPLETE，但**本段列举的每一项仍然未进入**，且**不因为 P4-03 收口而变成已做**。特别注意三个等式**都不成立**：`relevant ≠ important`、`relevant ≠ salient`、`relevant ≠ should notify`。P4-03 的完整非目标清单见「P4-03 收口」§五；
- **Input Activity 的在场解读**——`lastInputAt` / `idleForMs` / `idleSeconds` / `isActive` / `isIdle` / `userPresent`，以及 **Input Activity 内部**对这些量的任何阈值比较。`lastInputTick` 是 source fact，不是结论；
  **口径修正（ARCHITECTURE GOVERNANCE REVIEW v1 之后）**：原文兜底子句写作「以及任何阈值比较」，**缺主语**，曾被下游读成「任何人不许对 Input Activity 导出的量做阈值比较」。此处**只补回主语**——本条约束的是 **Input Activity 自己**，依据 `phase-3-input-activity-architecture-review.md:139-150`（「Perception records what the source says, not what Hikari concludes from it」）。**六个导出量不得进入 Perception 这一条未改动**（`principles.md:57`）；**consumer 侧对 wall-clock 的比较不在本条外延内**。
  **口径更新（DESKTOP RETURN ATTENTION v0 之后）**：上面补回的主语现在有一个**真实 consumer 在做阈值比较**了——`desktop-return-attention` 计算 `(observedTick − lastInputTick) >>> 0` 并与操作者配置的 `--proactive-return-after-ms` 比较。它落在本条的**外延之外**，理由与上面那条修正逐字相同：本条约束的是 Input Activity，不是它的 consumer；Input Activity 仍然不比较这两个 tick、不算时长、不认识任何阈值（本轮 `src/input-activity/` 的 diff 只有一条透传与一条校验；该目录里唯一的比较是 `isUint32` 的取值域检查 `0 ≤ v ≤ 4294967295`，没有任何针对时长的比较——这是逐字读该目录得到的，**没有**源码扫描测试钉住它）。**同时不得把它读大**：该 consumer 交付的**不是在场解读**——它不产生 `isIdle` / `isAway` / `userPresent` / `idleForMs` 中的任何一个，不判断显著性、不判断「该不该现在说」、不做 Salience / Importance，也不读 Chronicle / Memory；它只回答「在配置的空闲阈值之后，是否刚刚发生了新的输入活动」。**禁止项里唯一被触碰的是「是否允许 consumer 对 source fact 做比较」这一问，而这个问题在 v1 的口径下从来就不是禁止项。**另外，跨时钟域的减法**仍然禁止**：`observedAt − lastInputTick` 本轮零实现，且新增的 `observedTick` 存在的全部意义就是让这个减法**不需要**发生（`docs/architecture/desktop-return-attention-v0-implementation-boundary-freeze.md` §1）。
- **感知结果的过滤**——过滤 Explorer / 任务栏 / 自身进程，或任何「这不像正常用户程序」的启发式；
- **感知自身的后台化**——watcher、`changed` Event、感知层内的轮询、订阅、缓存、保活、队列、速率限制、去重。
  **口径**：P4-01 的 Loop 是一个**周期性 caller**，它没有把任何感知变成后台推送者——两个感知 provider 仍然是 pull-only，加载 / 空闲 / 卸载期间仍然零观测；
- **感知的持久化**——把观测写进 Chronicle 或任何文件；
- **非 Windows 的感知实现**——macOS / Linux 宿主上 Plugin 直接 `failed`，这是设计意图；
- **PowerShell 子进程成本的优化**（常驻子进程 / 预编译程序集 / 原生绑定）——两个感知都受此限制，任何高频感知需求都必须先解决它，但优化本身属于新工作；
- **通用 Perception / Sensor 框架**——第二个感知 Provider 已经出现（P3-02），**结论仍然是不抽公共抽象**：两个实例不足以判定共享边界，且错误的抽象比重复更难撤销。重新评估触发条件已记录为「出现第三个同型 Windows Perception，或 P3-01 因独立需求解冻」（详见 P3-02 架构评审 §16）；
- **World 的时间语义**——freshness / stale / TTL / `ageMs`、过期判断、`latest snapshot`、history。P3-03 同时暴露 `observedAt` 与 `snapshotAt` 两套时间轴但**不比较它们**：判断新旧属于 Awareness，不属于 World；
- **World 的失败分类**——`unavailable` 不携带 reason。让 World 转述 source 的失败形态（退出码 / 超时 / 权限）等于把感知实现的细节提升成 World 层公开语义。需要诊断的调用方应当去问那个感知；
- **World 的缓存与后台化**——缓存、latest snapshot、watcher、polling、timer、`changed` Event、重试框架、去重、限流。World 是 **pull-only** 的：没有 `current()` 调用就没有任何观测发生；
- **World 的持久化**——把 snapshot 写进 Chronicle 或任何文件；
- **World 的平台实现**——`desktop-session-world` 内零 `process.platform`。它是**结构上**平台中立的；「运行在 Windows 上」是它当前两个 provider 的事实，不是它的事实；
- **第二个 scope 的 World**——第二个 scope 应当是一个**新 Plugin**，而不是给 `desktop-session-world` 加一个 scope 参数或一张 scope 注册表；
  **口径修正（Repository CI World v1 收口后）**：这条**已经被遵守，不是仍待做**——`src/repository-ci-world/` 就是第二个 scope 的 World，它是一个**独立的新 Plugin**（`repository-ci-world`），`desktop-session-world` **一个字节都没动**，也**没有**任何 scope 参数或 scope 注册表。仍然**不做**的是：给 World 加 scope 参数、建 scope 注册表、跨 scope 聚合；
  **口径修正（2026-10-13）**：本条**不得被读成通用规则**。`docs/architecture/plugin-design-spec.md` §11 逐字：「**不得**全局化"config 不能表达 scope"或"第二个 scope 必须新 Plugin"。**那是一次具体的 ownership 决策，不是通用规则。**」本条陈述的是 `desktop-session-world` 那一次决策（其依据是该评审 §4 转写的 `core-architecture-v0.md:265`「World 是多个有范围、来源、新鲜度和不确定性的局部视图」），**不是**一条「第二个 scope 必须新 Plugin」的禁令。按通用规则引用它会与 `plugin-design-spec.md` §11 直接冲突；按 MUST 引用它则更错——它没有前两层来源。
- **facet 抽象**——facet 类型的 `available | unavailable` 外壳重复是**刻意接受**的。用泛型 `Facet<T>` 消除它需要先说明两个 observation 之间的关系，而它们在本层**没有**关系；
  **口径更新（Repository CI World v1 收口后）**：重复现已存在于**四个** facet 类型（`desktop-session-world` 两个、`repository-ci-world` 两个），仍**不抽**公共抽象——理由不变：这四处的关系是「同型」而非「同义」，抽掉外壳不会消除任何一处真实的重复判断；
- 完整 Skill / Tool 体系；
- 音视频流式资源框架；
- 旧 Hikari 大规模迁移。

### 本表的分类与来源（2026-10-13）

> 这一节回应 `docs/architecture/hikari-current.md` §13 待裁决表登记的那一条：本表条目「每条的规范力不同，容易被整体误读为同等强度」。下表逐条给出**类别**与**转写源**。
>
> **本轮已覆盖全表**（从「跨 Runtime 通信」到「旧 Hikari 大规模迁移」）。判类的规则是 `governance-rules-v1.md` **R2 规则 4**（Human 裁决，2026-10-13）：**来源只在 phase architecture review 的条目默认落 NOT-YET；只有那份 phase review 明写「这是一个设计默认」并给出理由时，才落 SHOULD。**

| 条目 | 类别 | 转写源 | 逐字依据 / 按规则 4 的判定理由 |
| --- | --- | --- | --- |
| 跨 Runtime 通信 | NOT-YET | `core-architecture-v0.md` §10（明确延后） | 「以下问题已经知道未来可能需要，但**当前冻结，不继续展开**」 |
| 节点网络协议 | NOT-YET | 同上 §10 | 「节点之间的连接协议与传输格式；」 |
| 远程 Provider | NOT-YET | 同上 §10 | 「远程 Provider；」——口径澄清已把 `github-ci` 排除在本条外延之外 |
| Capability 第二注册表 | NOT-YET | `core-architecture-v0.md` §5.3 | 标题即全句「Capability **暂不**成为第二套运行机制」——**在第二层，但内容是「暂不」，故 NOT-YET** |
| Provider 智能选择 | NOT-YET | 同上 §10 | 「Provider 的复杂智能选择；」。**邻条是 MUST**：§11 逐字禁「所有 Provider 的通用智能调度器」——若本条被读成后者，升 MUST |
| 全局状态中心 | **MUST** | `core-architecture-v0.md` §11 + §12 不变量 11 + `principles.md` §17 | §11「GlobalStateManager；」；§12「**不存在中央判断器或超级协调器。**」 |
| 完整权限系统 | NOT-YET | `core-architecture-v0.md` §10 | 「完整权限系统；」 |
| Memory / Goal 领域实现，以及 World 层的完整实现 | NOT-YET | 「完整业务实现」的延后只见于 `v0-boundary-review.md` §9（**历史证据层**） | 按规则 4 落 NOT-YET。**邻条是 MUST**：`GlobalWorldState` 由 §11 与 §6.3 单独禁止 |
| Chronicle 的完整领域实现 | NOT-YET | 同上 `v0-boundary-review.md` §9 | 同上 |
| Chronicle v1 存储格式的完整性标记 | NOT-YET（**无具名来源**） | 最近的记录是 `phase-2-final-architecture-review.md` §11「记录的限制」 | 该节写「本阶段不做，也不应做」——**本阶段不做 → NOT-YET**；前两层搜「墓碑 / 链式哈希 / 完整性标记」零命中 |
| 常驻进程之外的守护进程化 | NOT-YET（**无具名来源**） | 仅 `phase-2-cli-architecture-review.md` §15 有一句相邻的机制描述 | 描述不是设计默认声明，按规则 4 落 NOT-YET。全库搜「Windows Service / systemd / pid 文件 / watchdog」无以本条为主语的源文 |
| 配置文件、环境 Profile、节点配置、用户配置中心 | NOT-YET | `phase-2-cli-architecture-review.md` §15；`operator-tui-v0-implementation-boundary-freeze.md` §1.2 已独立判「**NOT-YET**」 | 「没有配置文件加载、没有环境 Profile 切换。」——**已有第三方按 R2 判过 NOT-YET** |
| `hikari stop` / `status` / `log` 等运维命令 | NOT-YET | `phase-2-cli-architecture-review.md` §16 | stop / status 已由 P4-02.1 解锁；`log` 仍不做，且没有日志子系统 |
| 启动失败后的自动重试、自动修复、自动创建 | NOT-YET | 同上 §16 | 「`start` 只做一次启动尝试，失败后**不重试、不修复、不降级**——那属于自动修复，**是本阶段禁止的**」 |
| Event 自动转 Durable Fact，以及任何「什么值得长期记录」的自动判断 | 前半 **MUST** / 后半 NOT-YET | 前半：`core-architecture-v0.md` §4.2。后半：`phase-2-chronicle-architecture-review.md` §13 | 「Event 用于实时通知，不负责普通查询，也**不自动成为长期事实**。」；后半「Chronicle 不决定『什么值得记录』」只在历史证据层 |
| 事实的 update / delete / 查询 DSL / 全文搜索 / 向量搜索 | NOT-YET | `phase-2-chronicle-architecture-review.md` §16 | 「没有 `update`、没有 `delete`、没有过滤器、没有条件查询、没有排序参数、没有全文搜索、没有向量搜索。」——历史证据层 → NOT-YET |
| 事实写入失败后的重试幂等语义 | NOT-YET | 同上 §20 | 「**不属于 P2-02**……这是刻意留给调用方的责任」 |
| `getOrCreate` / `openOrCreate` 与任何全局身份中心 | 前半 NOT-YET / 后半 **MUST** | 后半：`core-architecture-v0.md` §11 + `principles.md` §17；前半：`phase-2-continuity-architecture-review.md` §9 | §11「GlobalStateManager；」；前半只有历史证据层的「零命中」证据 |
| 身份迁移、备份、修复、升级 | NOT-YET（**无具名来源**） | 部分相近：`phase-2-chronicle-architecture-review.md` §18，但其主语是 **Chronicle store**，不是身份 | 主语不同，不构成来源 → 按规则 4 NOT-YET |
| 感知的语义解读（Salience / Importance / freshness / 模型调用 /「什么值得记住」） | **MUST** | `principles.md` §14（Perception ≠ Awareness）；`core-architecture-v0.md` §6.6 | 「**不建立中央 Judgement Domain。**」；§14 把解释明确划给 Awareness |
| Awareness 的完整实现 | NOT-YET | 链路形状来自 `principles.md` §14；「本轮只做比较」的范围叙述在台账自身与 P3-04 / P4-03 评审 | §14 给的是**链路形状**，**不是**「本轮不做」——按规则 4 落 NOT-YET |
| 跨 source 的推断 | **MUST**（禁推断的那一半） | `principles.md` §1、§14 | 「Perception Provider 只负责"观察到了什么"，不负责决定该不该介入」。**注意**：R4 逐字引的那句英文出自 phase review，**本身不是权威** |
| Input Activity 的在场解读 | **MUST**（主语限定为 Input Activity 自身） | `principles.md` §1（Ownership） | 同上那句。R3 逐字用本条做反例：「consumer 的存在不能治好一条 MUST」；**consumer 侧的阈值比较在本条外延之外** |
| 感知结果的过滤 | SHOULD | `phase-3-foreground-architecture-review.md` | 「感知 Provider **不得**因为「现实看起来不像正常用户程序」而过滤现实。」——源文**明写禁令并给出理由**，故按规则 4 落 SHOULD（而非默认的 NOT-YET） |
| 感知自身的后台化 | NOT-YET | `phase-3-input-activity-architecture-review.md` §6 | 源文是在**描述当前机制**（「没有 `changed`、没有订阅、没有队列……」），**没有**声明这是一次设计默认 → 规则 4 落 NOT-YET |
| 感知的持久化 | NOT-YET | 同上 §7 | 同上形状：一句机制描述 |
| 非 Windows 的感知实现 | SHOULD | `phase-3-foreground-architecture-review.md` §10 | 「仅支持 Windows。其他平台 Plugin 直接 `failed`，**这是设计意图而非缺口**。」——**明写「设计意图」并给出理由** → SHOULD |
| PowerShell 子进程成本的优化 | NOT-YET | 同上 §15 | 「属于**新工作**，不在当前已批准范围内」——本阶段不做 → NOT-YET |
| 通用 Perception / Sensor 框架 | NOT-YET | `phase-3-input-activity-architecture-review.md` §16 | 源文自带**重评触发条件**（「出现第三个同型 Windows Perception，或 P3-01 因独立需求解冻」）——这正是 NOT-YET 的形状 |
| World 的时间语义 | NOT-YET | P3-03 评审 §12、P3-04 评审 §14（历史证据层） | 「World 的 snapshot 里同时存在两套时间轴，且它们不被比较」。**`core-architecture-v0.md` §6.3 管的是另一件事**（禁 `GlobalWorldState`），不构成本条来源 |
| World 的失败分类 | SHOULD | `phase-3-desktop-session-world-architecture-review.md` §6.3 | 源文**给出设计理由**（把 source 的失败形态提升成 World 公开语义的代价） → SHOULD |
| World 的缓存与后台化 | SHOULD | 同上 §7 | 「**World 是 pull-only 的**：没有 `current()` 调用就没有任何观测发生。」——设计属性 + 理由 → SHOULD |
| World 的持久化 | NOT-YET | 同上 §8 | 只是一句机制描述（「不写 `origin.json`，不写 `chronicle.jsonl`……」）→ 规则 4 落 NOT-YET |
| World 的平台实现 | SHOULD | 同上 §11、§15；`plugin-design-spec.md` §… | 「「运行在 Windows 上」是 World 当前两个 provider 的事实，**不是 World 的事实**」——设计默认 + 理由。**`plugin-design-spec.md` 里的 `MUST` 标签按 R2 规则 3 不产生 MUST**（第三层），故本条最高 SHOULD |
| 第二个 scope 的 World | NOT-YET | 同上 §4（历史证据层） | 源文是一次**范围决策**，不是设计默认；且 `plugin-design-spec.md` §11 **逐字禁止**把它全局化。见上方 2026-10-13 的口径修正 |
| facet 抽象 | SHOULD | 同上 §16 | 「重复是**刻意接受**的」——明写「刻意」并给出理由（先要说明两个 observation 的关系，而它们没有关系） → SHOULD |
| 完整 Skill / Tool 体系 | NOT-YET | `core-architecture-v0.md` §10 | 「完整 Skill 体系；」 |
| 音视频流式资源框架 | NOT-YET | 同上 §10 | 「流式大对象与音视频传输抽象；」 |
| 旧 Hikari 大规模迁移 | NOT-YET（**无具名来源**） | — | `docs/` 内「迁移」只命中 chronicle 存储格式的迁移语境，与本条无关 |

**判定口径（这张表怎么判的）：**

1. **类别由 `governance-rules-v1.md` R2 决定，而 MUST 有来源层级限制。** R1 的层级逐字是：`principles.md`（长期最高原则）→ `core-architecture-v0.md`（当前冻结核心结构）→ `plugin-design-spec.md`（操作规范）→ **phase architecture reviews（历史证据，不作为权威来源）** → **development docs（阶段记录，不作为权威来源）**。R2 规则 3：MUST 只能来自前两层。
2. **两个推论**：(a) 来源只在 phase review 的条目**最高 SHOULD**，即使那句话读起来像禁令；(b) **`plugin-design-spec.md` 里的 `MUST` 标签本身不产生 MUST**——标签不授予层级。
3. **规则 4 补上了此前的空档。** 规则 3 说了「最高只能是 SHOULD」，没说「默认是哪一类」；R7.1 说了「引不到源的条目按 NOT-YET 处理」，但它只管**引不到源**，不管**只引得到证据层**。规则 4 把默认定在**可逆的那一类**上，理由是：**用一份 R1 明说「不作为权威来源」的文档去约束未来，是不成立的。**
4. **规则 4 减少了歧义，但没有消除它。** 残余难度是「明写设计默认 + 理由」本身仍要读措辞——上表凡属此类的条目都写了**按规则 4 的判定理由**，而不是只留一个类别。此前两遍独立调查在同一批条目上判得不同，正是因为当时没有这条规则。
5. **本表据规则 4 重判了 6 条**（原先按「该源文读起来像规则」给 SHOULD）：感知自身的后台化、感知的持久化、PowerShell 成本优化、通用 Perception/Sensor 框架、World 的持久化、第二个 scope 的 World——**它们的源文都只是在描述机制或记录一次范围决策，没有声明设计默认**。另有 4 条在初判时被判错（两条读起来像 MUST 的其实不是 MUST、两条被判成「无具名来源」的其实有来源），一并更正。

**两处结构性结论，比逐条分类更重要：**

1. **`core-architecture-v0.md` §10 写在 R1 的第二层里，但它是 NOT-YET，不是 MUST。** §10 首句逐字是「以下问题已经知道未来可能需要，但**当前冻结，不继续展开**」——**类别由内容决定，不由条目所在的文件决定**。因此引 §10 的那些条目**不能按 MUST 引**；真正 MUST 的是它们在 **§11** 的同名条目（`GlobalWorldState` / `GlobalStateManager` / 通用智能调度器 / 统一通信层）。
2. **这张清单给人的印象与它的实测构成差得很远。** 39 条里：**MUST 只有 6 条**（全局状态中心、Event 不自动转长期事实、全局身份中心、感知的语义解读、跨 source 的推断、Input Activity 的在场解读），**SHOULD 只有 6 条**，**其余约 27 条是 NOT-YET**（真实需求一出现即自动解除条件）。也就是说：**这份清单读起来像一部禁令集，实际上四分之三是「还没到时候」。** MUST 集中在两个分界上——「源事实 vs 结论」（`principles.md` §1、§14）与「局部视图 vs `GlobalWorldState`」（`core-architecture-v0.md` §6.3、§11）——**而两个分界都不在 development 文档里。**

> 一个附带发现，已就地修正：本清单「第二个 scope 的 World」一条原先读起来像通用规则，而 `plugin-design-spec.md` §11 逐字禁止把它全局化。该条现在带上 scope 限定的口径修正。

这些问题继续服从冻结规则：没有真实实现问题，不提前增加抽象。本表条目按 `docs/architecture/governance-rules-v1.md` R2 分为 **MUST / SHOULD / NOT-YET** 三类；**未标类别的条目按 NOT-YET 处理**（真实实现问题出现即条件消失），需要按 MUST 引用时**必须引到它转写自的源文档**。

---

## 第二阶段的收尾项

Phase 2 已完成最终验收并正式收口，**没有未结项**：

```text
P2-01 ~ P2-04 共 4 个提交全部已 push
  194987c  feat: 完成 P2-01 连续性 v1
  e430358  feat: 完成 P2-02 事实史 v1
  86aa3fc  feat: 完成 P2-03 启动入口
  58bb596  test: 完成 P2-04 生命周期验收
收口时 origin/main = 58bb596
CI（.github/workflows/runtime-tests.yml）: success，run 34955475103
```

（`origin/main` 此后已随 P3-01 / P3-02 前进到 `9495f7c`——见「第三阶段的收尾项」。）

第二阶段**不新增架构地图**，这是决定而非未结项：第二阶段没有新增生产结构（P2-04 的 `src/` 零改动），因果与边界已保存在各阶段实现文档与架构评审中，此时建图只复述已有文字。

以及一条随第二阶段进入下一阶段的**已记录格式限制**：

```text
Chronicle v1 无完整性标记
→ 「fact 行被删光、header 完好」与「全新 store」结构上不可区分
→ 该形状的损坏会被报告成空历史而非失败
→ 要分辨它必须改格式，属于新工作，不属于当前已批准范围
```

P2-01 刻意只覆盖了「身份是谁」这一条最小生命线，P2-02 刻意只覆盖了「发生过什么」这一条最小事实史，P2-03 刻意只覆盖了「怎么把它们组合成一次真实启动」，P2-04 刻意只覆盖了「一次全新的 Runtime 生命周期能不能恢复出同一个主体与同一条事实」。任何超出它们的扩展——多主体、身份迁移、设备绑定、Memory、事实的修改与检索、Event 自动落库、常驻运行、多节点——都不属于**第二阶段**已批准范围（其中「常驻运行」此后由 P4-02 以 `hikari resident` 交付，见「已实现 · Resident（P4-02）」）。

优先目标应该是：

> 继续用真实 Hikari 需求检验这套基础，而不是从纯理论中扩展 Runtime、Continuity 或 Chronicle。

---

## 第三阶段的收尾项

P3-01 已完成、已提交、已 push，**没有未结项**：

```text
3d910ee  feat: 完成 P3-01 Windows 前台感知
CI（.github/workflows/runtime-tests.yml）: success，run 35053737581
```

P3-02 已完成、已提交、已 push，**没有未结项**：

```text
9495f7c  feat: 完成 P3-02 Windows 输入活动感知
origin/main = 9495f7c（P3-02 收口当时；此后已前进，见下）
CI（.github/workflows/runtime-tests.yml）: success，run 35200893510
```

P3-03 已完成、已提交、已 push，**没有未结项**：

```text
a4f5c94  feat: 完成 P3-03 桌面会话 World v1
origin/main = a4f5c94（P3-03 收口当时，已比对确认与本地 HEAD 逐字符相同；此后已前进，见下）
CI（.github/workflows/runtime-tests.yml）: success，154 tests / 149 pass / 5 skipped / 0 fail
```

P3-04 已完成、已提交、已 push：

```text
ead4d7c  feat: 完成 P3-04 桌面会话变化感知 v1
origin/main = ead4d7c（P3-04 收口当时，已比对确认与本地 HEAD 逐字符相同；此后已前进，见下）
CI（.github/workflows/runtime-tests.yml）: success，176 tests / 171 pass / 5 skipped / 0 fail
```

**CI 与本机测试数会不同，这是预期而非异常**：CI 运行在 `ubuntu-latest`，Windows 真实 smoke 测试会自我 skip。下面每一个数字都**已由 CI 或本机实际跑过并确认**，没有预期值：

```text
CI（ubuntu-latest，P3-02，run 35200893510）:  137 tests / 132 pass / 5 skipped / 0 fail
CI（ubuntu-latest，P3-03）:                  154 tests / 149 pass / 5 skipped / 0 fail
CI（ubuntu-latest，P3-04）:                  176 tests / 171 pass / 5 skipped / 0 fail
CI（ubuntu-latest，P3-05，run #14）:          184 tests / 178 pass / 6 skipped / 0 fail
本机（Windows 11，P3-02）:                   137 pass / 0 skipped
本机（Windows 11，P3-03）:                   154 pass / 0 skipped
本机（Windows 11，P3-04）:                   176 pass / 0 skipped
本机（Windows 11，P3-05）:                   184 pass / 0 skipped
```

**6 条 skip 的来源**（全部是**平台门控，不是失败**）：

```text
P3-01 / P3-02 既有 Windows-only smoke： 5
P3-05 真实生产纵向 smoke：              1
总计：                                 6
```

**P3-05 比此前的预测多 1 条 skipped**：新增的真实 Windows vertical smoke 在 `ubuntu-latest` 上自我 skip。**因此 P3-05 的 CI 真实数字是 178 pass / 6 skipped / 0 fail，不是此前预测的 179 / 5。**

P3-05 已完成、已提交、已 push：

```text
c07ad36  test: 完成 Phase 3 纵向链路验收
origin/main = c07ad36（P3-05 收口当时，已比对确认与本地 HEAD 逐字符相同；此后已前进，见「第四阶段的收尾项」）
CI（.github/workflows/runtime-tests.yml）: success，run #14
  184 tests / 178 pass / 6 skipped / 0 fail
```


有一条**随第三阶段进入下一阶段**的实现限制：**PowerShell 异步子进程 v1 的单次观测成本为 370–674 ms**（P3-01 实测 370–455 ms，P3-02 实测 523 ms，P3-03 同轮单独实测 638 / 674 ms）。它决定了两条感知目前都只能被显式调用，**不能作为高频采样源**。任何高频感知需求都必须先解决这个成本，而优化本身属于新工作。

P3-03 给出了这条限制在组合层的第一个真实数据点：World 在**同一个同步段**内并发启动两次获取，一次组合 snapshot 实测 **386 ms**，而同轮两个感知各自单独运行是 638 / 674 ms——串行应在 1300ms 量级。**并发让组合的墙钟约等于较慢的那个 source，但系统总开销仍是两个子进程**：World 没有让感知变快，只是没有让它更慢。

以及三条**随 P3-03 进入下一阶段**的评审注意事项：

```text
1. 一次性探针的证据等级（累计）
   P3-01 的 66 条 + P3-02 的 142 条断言都是会话内一次性探针
   P3-03 的判别力探针（4 行变异的结果）同样是会话内一次性
   不在仓库内、不进 CI、不可复现
   → 证明「当时确实验过」，不证明「以后不会被改坏」

2. 「测试通过」不等于「测试有判别力」
   P3-03 的 snapshotAt 测试初版几乎没有判别力：
   整个 snapshot 在远小于 1 毫秒内跑完，两处时间戳落在同一毫秒，
   原 >= 断言在正确实现与错误实现下都成立
   → 改为等待时钟本身跨过毫秒边界后才真正生效
   → 凡断言「A 发生在 B 之后」而 A、B 都很快，都应警惕这一类失效

3. parser coverage gap 仍涉及两个模块（本轮未加剧）
   windows.ts 的 parser rejection branches 不在 npm test 内
   P3-03 没有加剧它：World 没有 parser、没有平台分支、没有内部 seam，
   其全部分支都在仓库测试覆盖内，也没有新增第二处具名内部 import
   结论仍是不为测试覆盖扩大 public API、不改 seam
   若出现第三个同型 parser，应重新评估 test seam 与 transport seam
```

以及四条**随 P3-04 进入下一阶段**的评审注意事项：

```text
1. 一次性探针的证据等级（累计，本轮新增一条反例）
   P3-01 的 66 条 + P3-02 的 142 条断言是会话内一次性探针
   P3-03 / P3-04 的判别力探针同样是会话内一次性
   不在仓库内、不进 CI、不可复现
   → 证明「当时确实验过」，不证明「以后不会被改坏」

   本轮新增的反例不是「探针无用」，而是【探针会把自己读错】：
   P3-04 第一版探针三次变异全报 MISSED 且零失败，原因是
   用行首锚点 ^✖ 匹配 Node reporter 输出，而 ✖ 前带 ANSI 色码，
   脚本把「有失败」读成了「无失败」。
   → 一个会把自己读错的探针比没有探针更危险：
     它既给假警报，也给假安心。
   → 凡探针报「全部 MISSED」，应先怀疑探针，再怀疑测试
     （这是 P3-03「先怀疑变异，再怀疑测试」的同型镜像）

2. 并发语义不是保证，已知限制
   v1 不保证 concurrent awareness.current() 的
   invocation-order baseline：baseline 按【成功 World acquisition
   的完成顺序】前进，不按调用发起顺序。
   单个 assessment 不受影响（每次调用自身完整、自洽、可引用），
   受影响的只是「哪两次读数被拿来配对」。
   v1 明确【不】增加 mutex / queue / serialization。
   → 若将来出现需要「第 N 次与第 N-1 次配对」的调用方，
     那应是一次独立的语义变更，而不是在本层顺手加锁。

3. detect_changes 在未跟踪文件上不可用（本轮为收口纪律的直接后果）
   P3-04 收口轮按纪律不 stage，全部产物是未跟踪文件，
   detect_changes 读的 git diff 按定义看不见它们，返回 0。
   【重建索引后重测仍是 0】，证明与索引新鲜度无关。
   → 这个 0 必须读作「未看见」，不是「无影响」，不得当 clean 用。
   → 另：staleness.commitsBehind 在本轮被证伪 ——
     重建索引后 meta.json 的 lastCommit 与 HEAD 逐字符相同，
     该字段仍报 commitsBehind: 4（疑似进程启动时缓存、之后不重读）。
     判定索引新鲜度只能靠 meta.json 与 git rev-parse HEAD 直接比对。

4. parser coverage gap 仍涉及两个模块（本轮未加剧）
   windows.ts 的 parser rejection branches 不在 npm test 内
   P3-04 没有加剧它：无 parser、无平台分支、无子进程、无内部 seam，
   其全部分支都在仓库测试覆盖内，也没有新增第二处具名内部 import
   结论仍是不为测试覆盖扩大 public API、不改 seam
   若出现第三个同型 parser，应重新评估 test seam 与 transport seam
```

P3-01 / P3-02 / P3-03 / P3-04 各自只覆盖一条最小线——「此刻人正在看什么」、「系统记录的最后一次输入发生在哪个 tick」、「在这个 scope 内我现在掌握了哪些事实」、「这些事实之间有没有差别」——且始终**只交付 witness / composer / comparator，不交付 interpreter**：它们不判断什么重要、什么正常、什么值得记住。任何超出它们的扩展——语义解读、跨 source 推断、过滤、后台化、持久化、非 Windows 实现、通用 Perception 框架、`GlobalWorldState`、通用 Comparison 框架——都不属于当前已批准范围。

P3-05 不新增任何能力面：它是一条**验收线**，把上述四条最小线串成一条真实纵向链并在真实 Runtime 上验收其生命周期。它同样**不交付 interpreter**，也没有扩大上面列出的任何一项范围。其结论、上限声明与未证明清单见 §「第三阶段收口结论」。

有一条由 P3-04 产生、应作为下一阶段输入的观察，此处只记录、不规划：

> Awareness 是第一个消费 World 的模块。若将来出现**第二个 World 消费者**，或出现需要**跨快照历史**判断的需求（例如「A → B → A 算不算回到原状」），则「Awareness 是否该有历史窗口」必须作为一次**独立的设计决定**被提出，而不是搭在某个消费者身上顺手长出来。现在样本仍然只有一例，因此**不提前抽象**。

---

## 第三阶段收口结论

第三阶段的优先目标与第二阶段一致：

> 继续用真实 Hikari 需求检验这套基础，而不是从纯理论中扩展 Runtime、Perception、World 或 Awareness。

### 一、Phase 3 最终结论（已证明的十二件事）

第三阶段证明的是 **Perception → World → Awareness 的第一条真实纵向链路及其生命周期**：

```text
1.  Runtime 无需获得任何领域知识即可承载真实 Perception Plugin
2.  两个 Perception（Foreground / InputActivity）可独立存在
3.  World 可仅经 public Service contracts 组合二者
4.  Awareness 可仅消费 World
5.  Perception → World → Awareness 已形成真实纵向链
6.  Windows 上四个 production Plugin 已实测端到端工作
7.  非 Windows 上能力缺席沿 dependency graph 诚实收敛
      （perception failed → world waiting → awareness waiting）
8.  Awareness transient baseline 不跨 Runtime 泄漏
9.  两个同时存活的 Runtime 不共享 Awareness baseline
10. 整条链仍保持 pull-only
11. shutdown 后该 capability 不再经 Runtime 可达
12. Phase 3 完成过程中 Runtime 无需新增任何领域机制
```

**未证明**（以下全部**不在**第三阶段已证明范围内）：

```text
完整 Awareness
salience / importance
remember / ask / notify / act
user presence
idle / away
application semantics
background resident loop   ← 第三阶段未证明；P4-02 之后已交付，见「已实现 · Resident（P4-02）」
multi-runtime federation
cross-device awareness
Memory / Goal integration
```

**Phase 3 已完成 Perception → World → Awareness minimal slice 的第一条真实纵向链路及其生命周期验收。P3-04 / P3-05 只证明 Awareness 的最小 change-contextualization slice，不是完整 Awareness。**

### 二、P2 / P3 生命周期性质对照（互补，不冲突）

```text
Phase 2: durable state should survive Runtime replacement.
         该记住的东西还在。

Phase 3: transient perception/world/awareness state should NOT
         accidentally survive Runtime replacement.
         本次运行时状态不会被误当成长期记忆带过去。
```

两条性质方向相反、彼此互补：P2 保证**持久的该活下来**，P3 保证**瞬时的该消失**。它们不是互相削弱，而是一起定义了 Runtime 替换时「什么该跨过去、什么不该跨过去」。

### 三、测试最终事实

```text
本机（Windows 11）:      184 tests / 184 pass / 0 skipped / 0 fail
CI（ubuntu-latest）:     184 tests / 178 pass /  6 skipped / 0 fail   run #14
```

**6 条 skip 的来源**：

```text
P3-01 / P3-02 既有 Windows-only smoke： 5
P3-05 真实生产纵向 smoke：              1
总计：                                 6
```

这些 skip 全部是**平台门控，不是失败**：它们要求真实 Windows host，在 `ubuntu-latest` 上按设计自我 skip，而不是被跳过以掩盖问题。同一个测试文件在 Windows 本机运行时为 **184 pass / 0 skipped**。

### 四、Phase 3 最终架构边界（保持不变）

```text
Runtime   不知道 Foreground / InputActivity / World / Awareness / changed / stable / indeterminate
Perception 只报告 source truth
World      组合局部事实
Awareness  领域定义仍是「这些事实意味着什么 / 什么值得在意」
```

P3-04 只实现了 Awareness 领域定义中**最小的 contextualization slice**。**Awareness 不是 change detector**——把 Awareness 重新定义成「发现变化」是把层定义收窄成阶段实现，属于对架构定义的篡改，明确禁止。

### 五、不新增架构图

`docs/architecture/phase-3-final-architecture-review.md` 未暴露「没有图就无法表达的新信息」，因此不新增图文件。现有文字描述 + GitNexus topology 已足够表达第三阶段的最终架构形态。

---

## 第四阶段的收尾项

P4-01 已完成、已提交、已 push，**没有未结项**：

```text
082fb97  feat: add desktop session awareness loop
```

P4-01.1 已完成、已提交、已 push，**没有未结项**：

```text
8ea725c  fix: bound awareness loop timer delay
```

P4-02 已完成、已提交、已 push，**没有未结项**：

```text
0db5516  feat: add resident process composition
origin/main = 0db5516（P4-02 收口当时，已比对确认与本地 HEAD 逐字符相同）
CI（.github/workflows/runtime-tests.yml）: success，Runtime Tests #21
```

（`origin/main` 此后又前进两项：`e23d382 docs: refresh current development stage`、
`f3d7673 test: fix input activity clock assumption`——本轮开工时已核对与本地 HEAD 相同。**注意：这两项不是 P4-02.1**，它们是本轮之前落地的独立工作。）

P4-02.1 已实现、已通过评审、文档已更新，**随本文件所在的这次提交一起落地**：

```text
本次提交（feat: add resident local control channel）
  src/cli/control.ts / control-endpoint.ts / control-command.ts（新增）
  src/cli/resident.ts / options.ts / main.ts（修改）
  test/resident-control.test.mjs（新增）/ test/resident-cli.test.mjs（修改）
  docs/development/phase-4-resident-control.md（新增）
  docs/development/phase-4-resident.md、docs/development/current-stage.md（修改）

push 状态：**已 push**——`origin/main` = `138cf9c`（push 输出确认 `f3d7673..138cf9c`）。
```

**测试最终事实**：

```text
本机（Windows 11，P4-02 收口后）:      222 tests / 221 pass / 0 fail / 1 skipped
CI（ubuntu-latest，Runtime Tests #21）: success

本机（Windows 11，P4-02.1 实现后）:    234 tests / 233 pass / 0 fail / 1 skipped
CI（ubuntu-latest，Runtime Tests #35516173973）:
                                      success，234 tests / 217 pass / 17 skipped / 0 fail
```

本机那 1 条 skip 是**平台门控**：真实 POSIX 信号测试要求非 win32 宿主，在 Windows 本机上按设计自我 skip（P4-02.1 的 12 条新用例中有 9 条反过来在非 win32 上自我 skip，本机全部执行）。CI 那 17 条 skip 同样全是平台门控：9 条来自 P4-02.1，其余 8 条是此前就已存在的 Windows-only 用例。两边 234 总数一致、`fail 0`。（上表 P4-02 那一行的 CI #21 用例数当时未逐项核对，仍只记 success，不记数字。）

### 一、Awareness 范围（必须与 `principles.md` §14 一起读）

`principles.md` §14 定义的完整链路（**继续冻结，未改写**）：

```text
世界变化 → Perception → Observation → 事实标准化 / Contextualization
         → Salience / Importance Judgement → Ignore / Remember / Ask / Notify / Act
```

第四阶段实际达到的位置：

```text
Perception → World → change contextualization
           → 被 Loop 周期驱动
           → 每次 assessment 作为一次【发生】发布
           → 由常驻进程保持整条链存活
```

**仍未达到**：

```text
Salience / Importance Judgement
Ignore / Remember / Ask / Notify / Act
```

这条记录**上下界都写明**：P4-01 / P4-02 让链路第一次可以持续运转，但**没有**让链路产生任何一个「值得在意」的判断，也**没有**让链路因此记得、问、提醒或行动。把「持续运转」读成「已经 Awareness」是第四阶段最容易犯的错误。

### 二、随第四阶段进入下一阶段的已知限制

以下五条是**限制，不是 blocker**，也不是未结项：

```text
1. 后台 cycle 失败没有公开健康表面
   Runtime 不会把 active Plugin 的后台 rejection 变成 failed，
   Loop 吸收每一次 cycle 失败后继续排下一个 cycle。
   → 后果：Resident 可以活着，但无法证明每一个 cycle 都成功。
   → 这是 v1 的已知限制，不是可以顺手补的补丁：
     补它等于为「当时那一瞬」新增一条随后必须一直维护的契约。

2. 停机没有严格上界
   shutdown 的耗时取决于各 Plugin 的 cleanup，v1 不设超时、不做 hard kill。
   → 后果：没有「最多等 N 秒」的保证。
   → 第二次 Ctrl+C 不再属于 Hikari（信号监听已在第一次终止请求后解除），
     想要立刻离开的操作者由宿主默认处理接管。

3. Windows 上无法用外部自动化完整复现真实控制台 Ctrl+C 的优雅信号路径
   → 真实 POSIX 信号用例在 win32 上自我 skip；
     这是「这台机器上测不了」，不是「已经测过」。

4. Resident 没有运维面（P4-02.1 后**部分收窄，性质未变**）
   P4-02.1 补上了本机控制入口：hikari status / hikari stop + Windows Named Pipe，
   走的是同一条优雅停机路径，status 只转述 Runtime 已经记录的状态与错误。
   → 因此「没有 stop / status」不再成立，**上一句已作废**。
   → 仍然没有：log、daemon 化、自动重启、watchdog、pid 文件、
     日志文件子系统、配置重载、健康检查、任何身份认证、任何远程 / 跨机控制面。
   → 关键区分：**能问、能停 ≠ 可运维**。这条控制通道只有读与停机两种语义，
     且只在本机、只在 Windows、且没有任何权限边界。

5. assessed Event 的生产订阅者数仍为 0
   → 见 §「已实现 · Resident（P4-02）」的 Event 边界：
     它可以被持续发布了，但还没有语义上的 Consumer。
```

优先目标与第二、第三阶段一致：

> 继续用真实 Hikari 需求检验这套基础，而不是从纯理论中扩展 Runtime、Loop 或 Resident。

---

## P4-03 收口

### 一、正式名称与状态

```text
P4-03 Human-Referenced Repository CI Relevance v1     COMPLETE
```

**这是一个「收口定义」，不是「原始目标」。** 必须明确记录：

```text
P4-03 在此前【没有】预先冻结的交付定义。
它的实际边界是在六个 supporting slice 的现实实现问题中逐步收敛出来的，
最终依据【已交付实现】与【一次真实 production 验证】在阶段收口时形成。
```

**不得**把它写作「P4-03 原本就计划做这个」，也**不得**写作「这是最初设计目标」。仓库中的历史事实是：P4-03 首次出现在 `docs/development/phase-4-resident.md` 时是一句**拒绝规划**（「本文件不规划 P4-03」）；此后它长期只是一个**保留编号 + 一个被两份 Boundary Review 逐步压窄的开放问题**，在进度表中始终只有编号与状态、没有名字。完整考据见 `docs/architecture/phase-4-p4-03-entry-review.md`。

**Entry Review 的原始研究结论是 `NARROW`**，其唯一缺口是**人工阶段定义**。本轮人工裁决选择了「收口」——不为 P4-03 定义新的实现内容，而是把已经交付的实际能力正式收口为其定义。**研究结论不改写**：先有「研究得出 NARROW」，随后由人工阶段治理裁决使其得以收口。

### 二、交付路径：六个 supporting slice

P4-03 的交付路径由以下六个 supporting slice 构成。**它们是真实历史，收口后不重新编号为 P4-03 的子阶段。**

| # | supporting slice | 交付物 | 对 P4-03 的作用 |
| --- | --- | --- | --- |
| 1 | Git Repository Perception v1 | `git-repository.current@1` | 具名本地对象源 |
| 2 | GitHub CI Perception v1 | `github-ci.current@1` | 第二个源，且是判据的**唯一词汇来源** |
| 3 | Repository CI World v1 | `repository-ci-world.current@1` | 两个源进同一显式 scope |
| 4 | Repository CI Awareness v1 | `repository-ci-awareness.current@1` | cross-source awareness，判定的唯一合法输入通道 |
| 5 | Explicit Work Focus Local Ingress v1 | `work-focus` Plugin（本机端点） | human ingress，接收 explicit designation |
| 6 | Repository CI Relevance v1 | `work-focus.current@1`（翻转创建）+ `repository-ci-relevance` Plugin + `hikari relevance repository-ci status` | 状态可读契约、判词与出口 |

分层保持干净：`work-focus`（`requires: []` 叶子）→ 恰好一条边 → `repository-ci-relevance`（`provides: []`）→ 一条边 → `repository-ci-awareness` → `repository-ci-world` → 两个源。**没有插件越过自己的层。**（**口径更新（JUDGEMENT REACHABILITY v0 之后）：`repository-ci-relevance` 现在 `provides: [repository-ci-relevance.current@1]`——分层不变、边数不变，增加的是一条**下游**边。见 `judgement-reachability-v0.md`。**）（**口径更新（Durable Fact Admission v0 之后）：`work-focus` 不再是 `requires: []` 的叶子——它现在 `requires: [chronicleService]`，因此上面这条链的最左端多出一条**指向 `chronicle` 的入边**（Chronicle 与这条 Repository CI 链无依赖关系，它的位置在组合里也早于链）。**「没有插件越过自己的层」不变**：这条新边指向的是 Runtime 之上的基础事实史，不是 Repository CI 链的任何一环，判词仍然只由 `repository-ci-relevance` 产生。见 `durable-fact-admission-v0.md`。**）

### 三、Completion condition

P4-03 COMPLETE 的含义是：**Hikari 已能够**

```text
- 在运行期间接受 explicit work focus
- 保持 current explicit designation
- 获取 Repository CI machine facts
- 形成 cross-source awareness
- 基于 explicit human reference 做 domain-local relevance judgement
- 输出 relevant | unknown
- 由真实 human reader 在 production 中查询
```

**收口所依据的最小 completion condition**（不引入中央 Judgement / Generic Reference Frame / GlobalWorldState）：

```text
一个 domain-local judgement plugin，
经恰好一条边读取 human designation 与一个 machine observation，
产生一个二值判词，
且该判词有一个真实 reader。
```

四项均已满足：domain-local（判词留在插件内，`provides: []`）· 恰好一条边（`work-focus.current@1`）· 二值判词（`relevant | unknown`，元数由类型钉死）· 真实 reader（见下节）。**（口径更新（JUDGEMENT REACHABILITY v0 之后）：`provides: []` 这一项已不成立——它现在提供 `repository-ci-relevance.current@1`。判词本身仍然 domain-local，且 Service 与端点是**同一条实现路径**（一个 `judge` 闭包同时喂两边），没有第二份判定。见 `judgement-reachability-v0.md`。**）

### 四、真实人工 production evidence

**用户本人**在 production Resident 中实际执行：

```text
declare "t1mb2rg/hikari-new"
declare "P4-03"
```

随后执行 Repository CI relevance 查询，**真实返回**：

```text
Repository CI relevance：relevant
与工作焦点逐字相同：t1mb2rg/hikari-new
```

**证据等级标注（必须与结论同时读）**：这是**人工 production verification**，**不是**自动化 CI evidence。仓库内自动化证据的最长链路止于「生产 Plugin + 生产端点 + 生产客户端 + **注入的两个 provider**」；完整生产组合的自动化测试只走到 `unknown`（用了不存在的 GitHub 仓库名 + 空 focus 集）。**不得**把它转述为「已端到端自动化验证」。

### 五、P4-03 的非目标（冻结）

P4-03 COMPLETE **不代表**进入或完成以下任何一项：

```text
RepositoryIdentity          unrelated
Salience                    Importance
Significance                Ignore / Remember / Ask
Notification                Interruptibility
Action                      Goal
Planner                     Memory
Generic Human Input         Global Reference Frame
Central Judgement
```

特别写清——这三个等式**都不成立**：

```text
relevant  ≠  important
relevant  ≠  salient
relevant  ≠  should notify
```

判词只有 `relevant | unknown` 两个值，它**只**回答「用户声明的 reference 与这条 machine observation 是否逐字指同一个 repository」。它**不**回答「这件事重不重要」、「值不值得在意」、「要不要提醒你」、「要不要行动」。`judgement.ts` 的注释已经把这条边界钉在代码里：`P4-03` 不匹配 `t1mb2rg/hikari-new`，**这不是待补的 v1 缺口，这就是该判定的真值边界所在**。

**P4-03 的完成只意味着**：

> 「Hikari 能在一个真实 domain 中，依据用户明确声明的 reference，对 machine observation 做一个诚实的局部 relevance judgement。」

### 六、Phase 4 状态

**P4-03 COMPLETE 不导致 `Phase 4 COMPLETE`。** **Phase 4 没有明确的 completion condition**，因此本轮只记录 P4-03 COMPLETE，**不替 Phase 4 发明完成条件**。

### 七、下一阶段

**不创建 P4-04。不开始 Salience research。** 当前正确动作是：

```text
STOP AFTER P4-03 CLOSURE
```

之后只有在出现**新的真实产品问题**时，再由该问题驱动下一阶段定义。这符合 `core-architecture-v0.md` §13 冻结规则：「**不再因为纯理论问题继续增加核心抽象；新概念必须由至少一个真实实现问题驱动**」。

---

## 开发纪律

继续遵循：

```text
Boundary Review
↓
实现 + 测试
↓
Architecture Review
↓
文档 / 契约更新
```

如果真实实现暴露当前边界不成立，不允许用隐藏依赖或临时特例绕过，应暂停实现并重新审查架构。

> 当前策略：让真实代码继续反过来教育架构。
