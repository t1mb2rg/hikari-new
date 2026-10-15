# 执行者的第一片 —— 实施边界冻结（里程碑 3）

- 日期：2026-10-15
- 前置：`docs/architecture/authorized-repository-action-v0-boundary-review.md`（2026-10-13，六条裁决已作出）
- 前置：`docs/architecture/authorized-repository-action-v0-composition-boundary-review.md`（判「落笔」为 `BLOCKED`）
- 前置：`docs/development/current-stage.md:301`（Human，2026-10-15：支持把「执行者的第一片」纳入本阶段；本裁决没有解除任何 MUST）
- **VERDICT: NARROW** —— 本文件**不新增边界决定**。它把上面两份评审已经作出的裁决落成可实现的形状，并列出**两处需要 Human 裁决的读法**（§3）与**本片明确不做**的事（§6）。

---

## §0 结论

执行者的第一片在这一阶段可以开：它的边界 2026-10-13 已经裁决完，而 2026-10-15 的阶段裁决把「执行者是 NOT-YET」这一条按 R2 的重新判级程序翻成了「真实需求已经出现，纳入本阶段」。**但它仍然不是「Hikari 可以自己动东西」**：范围由人的声明卡住，决定要不要动由人的句子带来，执行器之外的可核对来源（git 本身）决定结果的三态，而**一次真实的写入、commit、push 仍然逐轮单独授权**——机制交给你，扣扳机不交。

本片交付的是**机制**：一个 owner、一条只有人能触发的端、一个事先承认的工具集、一个**多步**模型循环、一个新的事实家族、以及 fail-closed 的三条启动条件。它不预建 `Service`（今天没有第二个消费者），不自动重试，不回滚，不做 Approval 流程（理由见 §6）。

---

## §1 证据（逐字）

### 1.1 边界评审已裁决的部分

| 出处 | 逐字 |
| --- | --- |
| 边界评审 §2（取 L1） | 「人用**一个词**带着他那句话进来（同 G-1 的 `screen` 形状）。**那句话原文就是 mandate**。模型可以把 mandate **落成具体动作**，但它是**关于"被要求了什么"的证据**，**不是授权**。」 |
| 边界评审 §3.2 | 「持续层＝通道＝人点名的声明」；「每次层＝判断＝一个词、请求局部、零状态」；「一条 standing grant 授予的是通道，不是判断」 |
| 边界评审 §4 | 「**执行者**：一个有边界的子进程。**同型于已有先例**——`desktop-content-read` 起 PowerShell 子进程（带 timeout 与 maxBuffer），所以**不新增通信平面**。」 |
| 边界评审 §4 | 「范围只有 §3.1 声明里的仓库；工作目录固定在该仓库内」；三条启动条件缺一即不动并说明是哪条（**fail-closed**） |
| 边界评审 §5.1 | 事实家族必须含：mandate 原文（不改写）、仓库标识、执行者标识、结果三态、证据引用、`occurredAt`；**不记 Hikari 对结果的解释** |
| 边界评审 §5.2 | `changed` / `unchanged` / `unknown` 三态；**`unknown` 不得塌缩成 `unchanged`** |
| 边界评审 §8 第 5 条 | 「执行者第一次被允许做到 (iii)：**commit + push + 看 CI**」；**证据栏必须包含 push 之后的 CI run 号，且记录必须写明「它 push 了」** |
| 边界评审 §8.1 | 「能力承认是常设的、由外部给的；授权是逐轮的、由 Human 的句子给的」；「在授权范围之内，模型自己决定怎么做」；工具集事先承认、**模型加不了工具** |
| 边界评审 §8ter 追加裁决 7 | 可改仓库声明**持久**（写入 Chronicle），撤销必须显式 |
| 边界评审 §8ter 不变量 4 | **低信任来源不得自我升权**：声明只能由人的显式动词写；执行者读它不能写它；执行者不能改自己的动作集；mandate 不能来自执行者的输出 |
| 组合边界评审 §5.5 | 「『行动』是一个**平面的开工**，不是给现有插件加能力」；第一片至少要同时立起 Action Intent、Authority Policy、单调守卫、Approval（如需要）、Provider、Receipt、Durable Fact |
| 组合边界评审 §7 | 提出了「今天可以开的那一半：提议，而不是落笔」；`current-stage.md:301` 的裁决选的是**落笔半的执行者第一片**，不是提议半 |

### 1.2 仓库现状（本次逐字读到）

- `src/changeable-repositories/read.ts:121-130`：`ChangeableRepositoriesReadService { roots(): Promise<readonly string[]>; read(target): Promise<RepositoryRead>; search(needle): Promise<RepositorySearch> }` = `changeable-repositories.read@1`。→ **范围检查的现成材料**。
- `src/changeable-repositories/index.ts` 逐字：「The *action* half has not arrived and was left `BLOCKED` by the composition boundary review」。
- `src/language/model.ts:186-214`：`ModelMessage` 四态、`ModelRequest { messages, tools }`、`LanguageModel { step(request): Promise<ModelStep>; dispose(): void }`。模型循环所需的**全部传输材料已经存在**，本片不新建第二套。
- `src/language/model.ts:172-175` 逐字约束：「every `tool_call_id` in an assistant message must be answered by a tool message before the next request goes out, or the endpoint rejects the request outright」→ 本片的循环必须逐条遵守。
- `src/language/plugin.ts:249`：`createModel: (connection: LanguageModelConnection) => LanguageModel` 是**注入**，测试里用的是假模型。→ 本片用同一个注入点，**不新增配置面**。
- `src/desktop-content-read/plugin.ts`：起子进程的同型先例（timeout 与 maxBuffer 由子进程调用处给）；该插件 `requires: []`、`provides: []`，理由写在文件头。

---

## §2 形状

### 2.1 owner

新包 `src/repository-change-executor/`，插件 id `repository-change-executor`。名字说的是它**是什么**（执行者），不是它希望成为什么（Action Pipeline 全体）。

**不 provide 任何 `Service`。** 今天问它的只有人（一个词），没有第二个消费者；§8 的纪律是「不预建没有消费者的接口」，这条纪律对新契约和对新 Service 一样有效。它**requires** 两条：`changeable-repositories.read@1`（范围）与 `chronicle@1`（事实）。模型是**注入**的，不是 Service。

### 2.2 入口：一条只有人能触发的端

形状照 `hikari screen`：请求局部、零状态、不能比调用活得长。

```
hikari act --data-dir <path> --repository <owner/name> "<人的原句>"
```

- `--repository` 与人给的那句话共同构成一次 mandate：**仓库是范围锚点，原句是要求**。两者都来自人，缺一不启动。
- 原句**不改写**地进入记录（§5.1）：去掉首尾空白之外，一个字节都不动。
- 端点是**同步等待**的一次调用：它返回那一刻，三态已经确定并已写入 Chronicle。

**为什么仓库由人给而不是由模型解析**：§4 的启动条件之一是「mandate 指向的仓库在人类声明的可改集合里」，这条检查必须发生在**执行者启动之前**。如果仓库由模型从原句里解析，那么范围检查就要等一次模型调用，而在那次调用失败或超时的时候，我们手里既没有范围也没有结果——把「哪个仓库」交给人，是让 fail-closed 那一条真的能做到 fail-closed 的最简单办法。原句的**含义**仍然由模型在执行者内部解释，这正是 §2 的 L1。

### 2.3 三条启动条件（缺一条就不动，并说出是哪一条）

1. 有一个词带来了 mandate —— 端被调用，且原句非空。
2. `--repository` 在 `changeableRepositoriesReadService.roots()` 返回的集合里（**逐字比较**，不做大小写折叠、不做 basename 匹配）。
3. 执行者可达 —— 仓库目录存在、是一个 git 工作区、`git` 可执行、模型注入可用。

三条全满足才启动。任何一条不满足：**不启动任何子进程、不改任何文件**，结果记 `unchanged`，原因逐字写进记录。这一条同时也是不变量 4 的第一条测试面：**声明的写入口在执行者里不存在**（它 `requires` 的是读契约，`ChangeableRepositoriesReadService` 没有写方法可调）。

### 2.4 工具集：事先承认，模型加不了

五个读、三个写，**没有别的**：

| 工具 | 动作 | 边界 |
| --- | --- | --- |
| `read_file` | 读 | 路径 containment 同 `repository-read`（canonical realpath 前缀） |
| `list_directory` | 读 | 同上；条目数上限 |
| `git_status` | 读 | `git -C <repo> status --porcelain`，只读子命令 |
| `git_diff` | 读 | `git -C <repo> diff`，只读子命令；输出截断 |
| `read_ci` | 读 | 复用 `github-ci.current@1` 观测，只读 |

（实现时把 `git_status` 与 `git_diff` 写成两条，因为它们本来是两个不同的只读子命令；这一处数字以本节为准——它是**五**个读，不是四个。名字的总数不是重点，**能被叫到的名字就是这张表**才是重点。）
| `write_file` | **写** | 路径 containment；只能写仓库工作区内 |
| `git_commit` | **写** | `git -C <repo> commit`；消息由模型给，本片不改写 |
| `git_push` | **写** | `git -C <repo> push`；**这一条一旦发生就是不可回退**，记录必须写明「它 push 了」 |

**没有** `shell`、`run_command`、`delete`、`network`、`install`。工具集是一个**参数**（同 `src/language/tools.ts` 的形状）：模型能叫的名字**就是**这张表，表外的名字不是「被拒绝的名字」，而是这个 owner 从未听说过的名字。

### 2.5 循环

- 注入的 `LanguageModel.step()` 驱动；`ModelMessage` 四态按 `src/language/model.ts` 的规定使用，每个 `tool_call_id` 都被 tool 消息回答。
- 上界：最大步数、总超时、每步超时、单次工具输出截断上限。四个都是**配置**，都有默认值。
- 到达任何上界：停止，结果 `unknown`，把「停在哪一步、为什么停」写进证据。

### 2.6 结果：由 git 判定，不由执行者自述

§5.1 要求「执行者的自述不得被记成已核实事实」。因此三态由**执行者之外的可核对来源**判定——就是 git 本身：

| 三态 | 判定（启动前后的 git 状态对比） |
| --- | --- |
| `unchanged` | 启动前 fail-closed；或循环正常结束且 `git status --porcelain` 与 `HEAD` 都未变 |
| `changed` | 循环结束且工作区或 `HEAD` 变了；`git push` 成功则**额外**记下「它 push 了」与 push 之后的 CI run 号 |
| `unknown` | 超时、被杀、模型或 git 失败、无法核对（例如仓库目录在过程中消失） |

**`unknown` 不得塌缩成 `unchanged`**：这是 §5.2 的逐字要求，也是本片最重要的一条测试。

### 2.7 事实家族

两个 kind，都进 Chronicle：

1. `repository-change-executor.mandate` —— 在**启动之前**写。含：原句（不改写）、仓库、执行者标识、`occurredAt`。写它是因为即使执行者随后崩掉，也必须留下「被要求了什么」。
2. `repository-change-executor.result` —— 三态、证据引用（git 前后状态、工具调用摘要、push 后的 CI run 号）、`occurredAt`。

**不写** Hikari 对结果的解释（那是 Awareness 的事）。**不新增**「通用行动事实」。

---

## §3 两处读法：**已由 Human 裁决（2026-10-15）**

1. **「子进程」指哪一层 → 取「真正干活的在子进程里」。** 真正干活的 git 与文件写入都起子进程（带 timeout 与 maxBuffer，stdout/exit code 是唯一通信面，因此不新增通信平面）；**决定做什么的模型循环在 Hikari 进程内**。另一种读法（整个执行者是子进程）被明确放弃。
2. **provide Service → 不 provide。** 本片只有端点。今天问它的只有人；§8 的纪律与 `changeable-repositories` 读半的先例都指向「等消费者出现再造契约」。若以后有插件要请求改动，那是一条**新**的边界决定，不在本片。

---

## §4 验收（正反两面）

| 验证对象 | 完成条件 |
| --- | --- |
| 不越权 | ① 仓库不在声明集合里 → 一个子进程都不起、一个文件都不改、结果 `unchanged` 且说出「不在人类声明的可改集合里」② 执行者**无法**写声明（它的 `requires` 里没有写入口）③ 模型叫一个表外的工具名 → 不是「拒绝」，是「没听说过」，动作不发生 |
| 范围 | 工作目录固定在 `--repository` 对应的本机根；`write_file` 的路径逃出该根 → 被 containment 挡住（同 `repository-read` 的 canonical 检查），且记下这是一次被挡住的尝试 |
| 三态 | ① 正常改完 → `changed` ② 正常结束但什么都没动 → `unchanged` ③ **超时/被杀 → `unknown`，且断言它没有写成 `unchanged`** ④ 启动前 fail-closed → `unchanged` 且原因逐字 |
| 不可回退 | 发生 push 的那一次：记录里**必须**同时出现「它 push 了」与 push 之后的 CI run 号；没有 CI run 号就不算这一条通过 |
| 事实 | 两个 kind 都写进 Chronicle；mandate 原文逐字等于人给的那句话；执行者自述不出现在「已核实」字段里 |
| 边界 | 不新增 `Service`（本片默认）；没有 `shell`/`run_command`；工具集是参数而不是注册表；`src/runtime/**` 一行未动 |
| 组合 | 常驻组合里多一个成员，位置与顺序断言跟着改；没有新 flag 被引入（复用现成的 `--model-endpoint` / `--model`） |

## §5 代价（照实说）

1. **本片交付的机制，今天没有人扣扳机。** 真机验证能做到的是三条，都不需要真模型：组合 active、fail-closed 三条、拿不到模型时 `unknown` 而不塌缩。**「真的改了东西」那一步需要一次逐轮授权 + 一个真 endpoint**，本轮**不做**，也不得被读成做过。
2. **多步循环是仓库里第一个自主循环。** 它的上界（步数、超时、截断）是本片自己定的数，不是裁决给的；这些数会在真实使用里第一次被检验。
3. **`read_ci` 依赖 `--repository` 指向的仓库确实有 CI。** 没有 CI 的仓库上，push 后的 CI run 号会缺席——那时记录要说「没有 CI」，而不是留一个空字段。

## §6 明确不做

照抄边界评审 §7，并加本片自己的三条：

- 不做「它自己决定要不要动」；不做 Goal / Memory reactivation；不做能力发现注册表动态加载。
- 不做多执行者抽象；不做跨设备、远程动作。
- 不做自动重试、自动修复、自动回滚。
- 不做通用 designation 机制（触发条件仍是「第三个同型声明出现」）。
- 不做任何「无人句子」的动作；不把执行者的自述记成已核实事实。
- **不做 Approval 流程**：§5.5 写的是「Approval（如需要）」，而本片**不需要**——授权是逐轮的（人这一次明确要求），范围由声明卡住，不可回退的那一步（push）在记录里被单独标出。
- **不做提议半**：`current-stage.md:301` 的裁决选的是执行者第一片。组合边界评审 §7 的「提议而不落笔」是**另一条路**，本片不开它。

## §7 落地顺序

0. 本文件（已完成，等确认）
1. 新包骨架：`types.ts` / `contracts`（无 Service，只描述请求与结果）/ `errors.ts`
2. 三条启动条件 + 范围检查（先能 fail-closed，再谈动作）
3. 工具集与 containment（读工具先行，写工具后置）
4. 模型循环（步数 / 超时 / 截断上界）
5. 三态判定（由 git 判定）+ 两个事实 kind
6. CLI 动词 + 常驻组合 + 接线断言
7. Functional Review → Architecture Review → `detect_changes` → commit / push / CI
8. 真机三条（组合 active / fail-closed / 拿不到模型 → `unknown`），**逐轮授权后才做**

## §8 冻结之后的实施记录（2026-10-16）

本节的每一条都是**实施中被真实运行打出来、再由 Human 裁决或由既有冻结文本直接决定**的，**不改 §1–§7 的边界决定**，只把「初稿没写到、但边界要求的东西必须真的可达」这几处补齐。

1. **§4「不可回退」那一行与配置绑定（Human 裁决取 A）**。它的验收「记录里必须同时有『它 push 了』与 CI run 号」只有**确实在盯仓库**的常驻才可能满足。初稿把这个义务写给了执行者，实施时发现：若执行者的 `requires` 里带一条硬 CI 依赖，**所有**常驻（包括压根没配 `--repository` 的）都得先起 `github-ci` 成员——实测让 15 条既有常驻测试从约 1 秒变成 30 秒超时（`常驻没有应答控制通道`）。因此执行者有**两份 definition**、同一个 id、`provides` 都为空、只有 `requires` 与加载位置不同：不盯仓库的那份在 base（`requires: [changeable-repositories.read@1, chronicle]`，记录如实说「没有 CI」），盯仓库的那份排在 `github-ci` 之后（`requires` 里多一条 `github-ci.current@1`），CI 观测一上来就把 run 号交给事实路径；模型自述用的 `read_ci` 工具仍然只在配了 CI 观察者时存在。**§4 那一行据此读作**：在盯仓库的常驻里必须满足，在不盯仓库的常驻里「没有 CI」是正确记录。
2. **§2.4 containment 补一个洞**：`write_file` 的判据原本只问「在不在仓库根之下」，`.git/hooks/pre-commit`、`.git/config`、`.git/refs/remotes/*` 都被放行——前者等于让 git 在下一次 commit 时执行人写下的脚本（§6 排除的 shell 能力），后者能伪造 §2.6 判 push 时要读的地方。现在任何一段名为 `.git` 的路径（含经链接落进去的）逐字被拒。
3. **§2.6 push 判据补一个洞**：只看「未推送数量是否下降」在**同步仓库**里看不见 push（`commit + push` 计数 `0 → 0`）。现在多读一条 `git branch --remotes --contains HEAD`；并且 `pushed` 是**三态**——读不到时写「无法核对」（事实里 `null`），不写「确定没推」，也不因此去读 CI。
4. **§2.7 的落盘时机收紧**：mandate 事实必须在**任何事之前**写进 Chronicle；写不进去就不启动（`record-unwritable`），因此停机不会留下「工作区改了但没人要求过」的窗口。
5. **§2.2 的客户端超时必须严格大于服务端预算**：`hikari act` 的回执超时从 30 分钟改为 35 分钟。相等会让两个钟赛跑，人可能读到「没有下文」而那一轮仍在跑、可能已经 push。
6. **仍未闭环（照实记）**：无命名管道的主机上，执行者插件构造会抛错，而常驻**无条件**加载它；CLI 侧已按兄弟客户端（`hikari change`）的口径回答「执行者入口依赖 Windows 命名管道，本机没有。」，但 Linux 上未实跑，因此只算「口径一致」，不算已验证。
