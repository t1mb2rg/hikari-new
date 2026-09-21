# Git Repository Perception v1（P4-03 Supporting Slice）

> 轮次：**P4-03 supporting slice**（**工作标签，不是阶段编号**——本轮不占用 P4-03 编号，也不是 P4-03.1；P4-03 本身仍未开始）
> 状态：**实现完成、Functional / Architecture Review 通过、已提交、已 push**
> 提交：`ca2db7a feat: add git repository perception`，CI（Runtime Tests #35567512137）**success**
> 前置：P4-02.1 已收口（commit `138cf9c`）；本轮开工时 `origin/main` = `8a9b744`

---

## 0. 本轮回答的问题

Hikari 目前没有任何能力回答：

> 这个**明确指定的本地 Git repository** 现在处于什么状态？

它有一些间接的东西——`foreground` 说谁在前台，`input-activity` 说最后一次输入发生在哪个 tick，`desktop-session-world` 把两者装进同一个信封——但**没有一个是具名对象源**。所谓「具名对象」，指的是那些**有身份、有名字、可以被指定**的东西：一个 repository、一个文件、一个日历。感知层今天能报的都是**环境事实**（屏幕上有什么、系统记了什么），不是一个可以被指名的东西的**当前状态**。

### 立项依据（必须与本轮全部结论同时阅读）

本轮的立项理由**不是**「以后 GitHub CI 可能会用」，**也不是**任何未来可能性。它是**一件已经发生的事**：

```text
P4-03 的 Explicit Declaration / Reference Frame 研究已经实际推进，
并且已经确认当前缺少稳定的 named-object source，
导致 repository-level relevance 无法继续建立。

Git Repository Perception v1 是这个已经发生的 P4-03 blocker 的 supporting capability。

本轮的真实 callable need 是：
「当前 P4-03 已经需要一个 domain-local consumer
  能主动取得明确本地 repository 的当前事实。」

Consumer implementation 尚未存在。
plugin-design-spec §16.1 明确写了「不要求已经存在具体的 Consumer implementation」，
因此这不构成阻断。
```

**Consumer 今天不存在，这一点已经核实，并且是本轮如实记录的限制之一**（见 §13 限制 8）：`impact gitRepositoryPlugin` 返回 `impactedCount: 0 / risk: UNKNOWN`，文本检索确认全仓只有定义处、barrel 再导出、以及两个测试文件引用它。**零生产调用方是预期状态，不是遗漏。**

### 本轮成立之后到达的那句话

> **Hikari 能第一次直接观察一个明确指定的本地 Git repository，但它仍然不知道这个 repository 对用户意味着什么。**

到达这句话就够了。本轮不越过它。

---

## 1. 冻结边界（逐条对照）

立项裁决给出的 12 条边界，逐条对照如下：

| # | 冻结要求 | 本轮实现事实 |
| --- | --- | --- |
| 1 | 使用能正确看到 untracked files 的 worktree 判据 | ✅ `-unormal` **显式传入**，不交给 `status.showUntrackedFiles` 配置。见 §5.2 |
| 2 | 明确支持 unborn HEAD | ✅ `{ kind: 'unborn' }` 是**一等观测值**，不是失败。见 §2 |
| 3 | branch / detached / unborn 分开 | ✅ 三支独立 union。见 §2 |
| 4 | missing remote 是合法状态 | ✅ `git remote` 无 remote 时 rc=0 + 空输出 → `remotes: []`。见 §5.4 |
| 5 | 不假设 remote 名为 origin | ✅ 全模块**没有 `origin` 这个字符串**。测试断言 `remotes.includes('origin') === false` |
| 6 | 不把 `workTreeRoot` 当 repository identity | ✅ 它被报告为**一个事实**，不是身份。全模块无 `RepositoryIdentity` / `id` / `key` 概念。见 §5.5 |
| 7 | rc=1 / rc=128 按各自 command semantics 解释，不建通用 exit-code taxonomy | ✅ 退出码**原样报告**并绑定到它回答的那个问题，**没有任何 code→meaning 的映射表**。见 §6 |
| 8 | `observedAt` 不承诺原子 snapshot | ✅ 3（或 4）个独立进程顺序执行，无事务。见 §2.5 与 §13 限制 4 |
| 9 | Git CLI / parser / process 全部保持 Plugin private | ✅ `git.ts` **不在 barrel 里**。见 §7 |
| 10 | pull-only、fresh per `current()`、no cache / watcher / Event / persistence | ✅ 见 §8 |
| 11 | 不加入 Resident composition | ✅ `src/cli/resident.ts` **零改动**，第七个 Plugin 仍是 Loop |
| 12 | Runtime 不修改 | ✅ `src/runtime/` **零改动** |

另有立项裁决同时给出的四条禁止项，逐条对照：

```text
不建立中央 Judgement Domain      ✅ 没有。没有 Judgement / Salience / Relevance 任何字样
不创建 fake consumer             ✅ 没有。生产代码零 consumer；测试里的 observer 是测试脚手架
不加入 Resident composition      ✅ 没有。resident 的七个 Plugin 一个都没动
不修改 desktop-session-world    ✅ 没有。src/desktop-session-world/ 零改动
不提前建立 RepositoryIdentity    ✅ 没有。identity 概念在此处不存在
不创建通用 Perception framework ✅ 没有。没有 Observation<T> / GenericProvider<T> /
                                    ProviderRegistry / 共享基类 / 第二个注册表
```

---

## 2. Observation 语义

```ts
{
  observedAt: string,                        // UTC ISO-8601，观测组装完成的时刻
  source: 'git-repository',                  // 独立字面量常量，不引用 plugin id
  workTreeRoot: string,                      // git 自己报告的 work tree 顶层
  head: { kind: 'branch',   name: string, commit: string }
      | { kind: 'detached', commit: string }
      | { kind: 'unborn' },
  workTree: { kind: 'unchanged' } | { kind: 'changed' },
  remotes: readonly string[]                 // 只有名字，按 git 报告的顺序
}
```

### 2.1 三支 head union：三件不同的真话，不塌缩

```text
branch    有名字、有 commit          → 两者都是事实
detached  没有名字、有 commit        → 「没有名字」是事实，不是「名字读不到」
unborn    既没有名字也没有 commit    → repository 存在、一次提交都还没有
```

**`unborn` 必须是状态而不是失败。** 一个刚 `git init` 的 repository 会被 git 如实报告为 HEAD 未出生；把它报成错误，等于把 git 明说的一个状态，换成本模块自己发明的一个缺失。这正是冻结原则里 `Absence is an observation` 的同型纪律。

**`unborn` 不携带 `name`。** `# branch.head` 在 unborn 时确实会给出分支名（`git init -b main` 之后是 `main`），但本轮**不报告它**——因为那个名字此刻还不是一个已存在的 ref。这是刻意不报告，不是读不到（诚实记入 §13 限制 5）。

### 2.2 workTree 是二值的，没有任何细分

```text
unchanged   git 没有列出任何条目
changed     git 列出了至少一个条目
```

只有这一个 bit。**不分** staged / unstaged / untracked，**不分**文件个数，**不报告**任何路径。理由：`status --porcelain=v2` 的输出里每一条记录都带自己的 XY 状态码，一旦开始解析它们，就等于承诺一套「工作树脏度分类学」——而那属于下一层的问题，不属于「这个 repository 现在是什么状态」这个问题的 v1 答案。

实现上的判据极窄且可复核：**跳过所有 `#` 开头的 header 行、跳过空行，其余任何一行出现即 `changed`**。

### 2.3 `remotes` 只有名字

不带 URL，不带 fetch / push 地址，不带 reachability。理由分两条：

```text
URL        是配置，不是关于 repository 的事实
reachability 根本不是关于 repository 的事实 —— 本模块【永远不碰网络】
```

`git remote` 是纯本地读取，不加 `--verbose`，不做 fetch。

### 2.4 `source` 是独立常量

`OBSERVATION_SOURCE: GitRepositorySource = 'git-repository'` 定义在 `acquisition.ts`，**不引用** `plugin.id`。Plugin 改名不会静默改变已经发出的观测。这与 P3-01 / P3-02 的做法逐字一致。

### 2.5 `observedAt` 不承诺原子 snapshot

`observedAt` 在**每一条命令都结算之后**打一次，描述的是「这次观测是什么时候组装完的」，**不是**「repository 处于被报告的那些状态的时刻」。

```text
一次 current() = 3 个（必要时 4 个）独立 git 进程，顺序执行
git 没有跨越它们的任何事务
→ 一个在它们运行期间发生变化的 repository，
  会被报告成【每条命令各自看到的东西】，而不是一个瞬间
本模块没有收窄这个窗口，【也没有声称它窄】
```

没有任何一条命令来打这个时间戳：git 无法标记自己的一次运行，而它能打印的时间戳描述的是 commit——那是另一个问题。

---

## 3. Service 契约

```ts
export interface GitRepositoryService {
  current(): Promise<GitRepositoryObservation>;
}

export const gitRepositoryService = defineService<GitRepositoryService>('git-repository.current', 1);
```

**契约 id 不带平台名**，理由与 P3-03 的 `desktop-session-world` 同型：本模块的**公开契约里没有任何 Windows 专属语义**。git CLI、一个路径、一个子进程都不是操作系统属性。把平台写进契约 id，会把「当前实现的宿主」误固化成「这个能力的定义范围」。

**`current()` 会 reject。** 这一点与 World 相反，是刻意的：World 的 `current()` 永不 reject，因为「一条事实都没有」对 World 是一个合法答案。而这里**没有**对应的合法空答案——一个读不到的 repository 不是「一个没有任何事实的 repository」，它是**这次观测失败了**。把它 resolve 成空观测，正是 `Failure to observe is not [an observation]` 所禁止的。

---

## 4. 两层结构：acquisition seam

```text
git.ts          createGitAcquirer()  → GitRepositoryAcquirer
                                        acquire(): Promise<GitRepositoryAcquisition>
                                        dispose(): Promise<void>
acquisition.ts  GitRepositoryAcquisition = 没有 source 的观测（内部）
                toObservation()          = 加上 source 并逐层冻结
plugin.ts       把 acquirer 的 acquisition 包成 Service 的 observation
```

`GitRepositoryAcquisition` 与 `GitRepositoryObservation` 的差别**只有 `source`**。分成两个类型不是冗余：`source` 是「谁在说这句话」，是传输身份而不是被观测的事实，因此由**发出观测的那一层**贴标签，而不是由获取事实的那一层。

### 4.1 失败描述放在哪一层，是一次真实的修正

第一版把 `describeFailure` 与 `disposed` 检查放在**默认 spawner 内部**。两条测试立刻暴露了它的错误：

```text
「一个从未启动的 git」被报告成裸 Error，不是 GitRepositoryObservationError
「一个退出码」的消息是 'Command failed'，不是分类后的消息
```

原因是结构性的：seam 的文档写着「在测试中替换以覆盖 git 本身不会按需产生的输出**与失败**」，但只要分类住在 spawner 里，**任何由注入 runner 产生的失败都绕过分类**——seam 承诺的能力和它的实现是两回事。

修正：把 `disposed` 检查与 `describeFailure` **上提到 acquirer**，包在 `rawRun` 外面。于是 `createGitSpawner` 只剩下「起进程、把写出来的东西交回去」。

```text
收益 1  注入 runner 的失败路径与真实路径【走同一段分类代码】，因此可测
收益 2  spawner 不再知道任何关于「失败意味着什么」的事
收益 3  「race unload 不得被报成超时」这条不变量，现在在两条路径上都成立
```

`disposed` 检查在分类**之前**，因此一次落在观测中途的 unload 会被报告成它本身（`the acquirer was disposed mid-observation`），而不是被报告成那个被杀死的进程从外面看起来的样子。

---

## 5. 真实 Git 边界（本轮在实机上确认的）

本轮的边界全部来自**真实运行**，不是文档推断。实测环境：`git version 2.53.0.windows.3`。

### 5.1 `# branch.head` 对两种不同状态写出逐字节相同的输出

这是本轮**在实现期间新发现**、先前研究**没有**覆盖的一处真实歧义：

```text
git checkout --detach                 → # branch.head (detached)
git checkout '(detached)'             → # branch.head (detached)     ← 逐字节相同
```

`(detached)` 是一个**合法分支名**（`git branch '(detached)'` 成功）。只读 porcelain 输出，这两种状态**不可区分**。

判据是 `git branch --show-current`：

```text
unborn HEAD          → 打印分支名，rc = 0
分支名恰好 (detached) → 打印 (detached)，rc = 0
真正 detached        → 什么都不打印，rc = 0
非 repository        → rc = 128
```

**答案是输出，不是退出码。**

因此 `resolveHead` 是一个**条件第四命令**：只有当 `# branch.head` 报出 detached 拼写时才问。普通分支路径保持三个命令，只有真正有歧义的那一种才多付一个进程。

这个修正不是文档上写一句「已知歧义」——那是一处会**静默报错**的真实缺陷（用户会把一个叫 `(detached)` 的分支看成 detached HEAD）。

### 5.2 untracked file 必须显式要求

`status.showUntrackedFiles=no` 会让 `git status` **完全不提** untracked 文件。一个随读者配置变化的事实，不是本模块能陈述的事实。

因此 `-unormal` **显式传入**，不依赖任何配置。测试覆盖：配置成 `no` 之后，untracked 文件仍然得到 `changed`。

同时 `-unormal` 也是**输出体积控制**：untracked 目录按一个条目报告，而不是每个文件一条，于是列表的大小与树的**形状**成正比，而不是与它的**内容**成正比。

### 5.3 非 repository → rc = 128，不是「空 repository」

`git -C <非仓库路径> status ...` 以 128 退出，并往 stderr 写字（`fatal: not a git repository (or any of the parent directories): .git`）。本模块**不解析 stderr 文字**，也**不解析 128 的含义**：它按 §6 的规则把「哪个问题没被回答」和「退出码是多少」一起报出去。

### 5.4 missing remote 是 rc = 0 + 空 stdout

```text
git remote      有 remote    → 逐行名字，rc = 0
git remote      没有 remote  → 输出为空，rc = 0      ← 不是失败
```

这个模块**没有 `origin` 这个字符串**。测试用 `upstream` + `fork` 两个 remote 断言得到 `['fork','upstream']` 且 `includes('origin') === false`。

### 5.5 `rev-parse --show-toplevel` 可以是配置路径的祖先

git 从被指向的地方**向上搜索** `.git`。因此配置一个子目录，得到的是仓库的顶层根，**不是**配置的那个路径。测试断言：

```text
acquisition.workTreeRoot !== 配置的子目录
acquisition.workTreeRoot === git 自己报告的 --show-toplevel
```

**这正是不能把 `workTreeRoot` 当 identity 的原因**：它是「git 这次找到了哪个 work tree」，是**一次搜索的结果**，不是 repository 的名字。两个不同的配置路径可以解析到同一个 root；一个配置路径可以在别人移动仓库之后解析到别处。identity 需要的是跨时间稳定的东西，而它是「这次是哪」。

### 5.6 bare repository 没有 work tree，本版本报成失败

`git init --bare` 之后，`status` 与 `rev-parse --show-toplevel` 都会失败。**v1 没有办法说「一个没有 work tree 的 repository」**——`GitRepositoryWorkTree` 是二值的，而 bare repository 连二值里的任何一值都不是。

诚实记入限制（§13 限制 1），不假装支持。

---

## 6. 失败分类：两件不同的事，不做 code→meaning 映射

```ts
if (error.killed) return 'the acquisition process did not finish in time';
if (typeof error.code === 'number')
  return `${invocation.establishes} could not be read (git exited with code ${error.code})`;
return 'the git executable could not be started';
```

### 6.1 `typeof code === 'number'` 是可实现的判据

Node 的 `execFile` 把两类完全不同的失败放在同一个 `code` 字段上：

```text
number   git 【跑起来了并退出】，这是它的退出码
string   'ENOENT' — git 【从未启动】
```

用 `typeof` 分开它们，是本模块唯一做的一处类型判断，也是**唯一可实现的**判据。

### 6.2 退出码按「它回答的是哪个问题」报告，不翻译

```text
message = 「<那个问题> 读不到（git exited with code <N>）」
```

**没有映射表。** 理由写在源码注释里，此处重述：**哪些退出码意味着什么，是每条命令自己的问题**。git 用 128 覆盖了一整族情形；`1` 对某些命令是合法答案；`git remote` 在没有任何 remote 时明确以 0 退出。一张「128 = 不是仓库」的表，会在第一次遇到「128 = 别的原因」时把一句错话包装成一句权威的话。

`establishes` 字段存在的唯一目的就是这条消息：它让失败说的是「**工作树状态**读不到」而不是一个裸码。它**只**用于描述失败——不参与任何控制流。

### 6.3 输出读不懂时拒绝，而不是硬猜

`readStatus` 在两种情形下抛错（而不是返回一个勉强的观测）：

```text
没有任何 # branch.head / # branch.oid header        → 'git reported no branch state'
branch.oid 既不是 unborn 标记也不是 40/64 位 hex     → 'git reported no usable commit id'
workTreeRoot 为空                                     → 'git reported no work tree root'
```

`OBJECT_ID = /^[0-9a-f]{40,64}$/`：40 位是 SHA-1，64 位是 SHA-256（`git init --object-format=sha256` 可以建出来）。**两种都接受，之间与之外的都不接受。**

**unborn 检查在 OBJECT_ID 测试之前**——顺序是承重的：`(initial)` 不是 object id，如果先跑正则，`unborn` 会变成一次观测失败。

---

## 7. 公开表面

`src/git-repository/index.ts` 导出**恰好 9 个符号**：

```text
gitRepositoryService        (value)   Service 契约
GitRepositoryService        (type)    契约接口
GitRepositoryError          (value)   配置 / 插件级错误基类
GitRepositoryObservationError (value) 观测失败
gitRepositoryPlugin         (value)   生产 Plugin
GitRepositoryPluginConfig   (type)    配置形状
GitRepositoryHead           (type)    head 三支 union
GitRepositoryObservation    (type)    观测
GitRepositoryWorkTree       (type)    work tree 二值 union
```

**不在公开表面上的**：

```text
GitRepositorySource       观测自己的来源字面量。与两个桌面感知一致：
                          需要按 source 分支的调用方，是一个拥有多于一个 source
                          的调用方，而那个东西今天不存在
GitRepositoryAcquirer     acquisition seam
GitRepositoryAcquisition  未贴标签的观测形状
createGitRepositoryPlugin 工厂（测试用，具名内部 import）
createGitAcquirer         git.ts 整个文件
GitInvocation / GitRunner 命令与 runner 形状
DETACHED_HEAD / UNBORN_HEAD / 所有 git 命令常量
```

**`GitRepositoryError` 是公开的，即使它今天只由配置拒绝抛出。** 理由：调用方需要能区分「我给的配置不对」与「这次观测失败了」，而后者是 `GitRepositoryObservationError`（`GitRepositoryError` 的子类），因此 `instanceof GitRepositoryError` 是那个可分点。两个错误类**都不设 `.name`**，与仓库既有两个错误类一致（诚实记入 §13 限制 7）。

---

## 8. 生命周期与资源归属

```text
loadPlugin(plugin, { repositoryRoot })
  → config.parse 【在记录被创建之前】跑（runtime.ts:38 vs :48）
  → setup()
      createAcquirer(config.repositoryRoot)   ← 此刻才存在，之前零进程
      context.defer(() => acquirer.dispose()) ← 资源归属沿用既有机制
      services.provide(...)
```

**invalid config 不留下任何记录。** 测试对 7 种非法输入逐一断言 `getPluginState('git-repository') === undefined` **且** `counts.acquisitions === 0`。

**pull-only 是结构性事实，不是纪律**：

```text
加载 → 0 次 acquire
空闲 → 0 次 acquire
只有 current() 才 acquire
```

测试 `loading the plugin observes nothing; only a caller does` 断言加载后 `acquisitions === 0`，一次 `current()` 后 `=== 1`，再等 50ms 仍然 `=== 1`。

**dispose 会杀死飞行中的子进程。** acquirer 持有 `inflight: Set<ChildProcess>`，`dispose()` 立 `disposed` 旗标、复制并清空集合、`await Promise.all(terminate)`。`terminate` 等 child 的 `close` 事件——不是 `kill()` 返回就完事。

### 8.1 `-C` 而不是 spawn 的 `cwd`

```text
用 cwd：repositoryRoot 不存在 → 【spawn 本身失败】→ 与「git 可执行文件不存在」不可区分
用 -C ：repositoryRoot 不存在 → git 正常启动、正常以 128 退出 → 两件事分开
```

这不是风格选择，是把 §6 的失败分类**做成可达的**。用 `cwd` 的话，「ENOENT」会同时意味着两件事，而 §6 刚说过不能把它们混起来。

---

## 9. 当前文件

本次新增文件：**9 个**（7 个 src + 2 个 test）。

```text
src/git-repository/  (7)
  acquisition.ts  contracts.ts  errors.ts  git.ts  index.ts  plugin.ts  types.ts
test/git-repository.test.mjs                                          (1)
test/git-repository-git.test.mjs                                      (1)
docs/development/phase-4-git-repository-perception.md                 (1)
```

**`src/runtime/`、`src/continuity/`、`src/chronicle/`、`src/foreground/`、`src/input-activity/`、`src/desktop-session-world/`、`src/desktop-session-awareness/`、`src/desktop-session-awareness-loop/`、`src/cli/`、`src/index.ts`、`package.json`、`tsconfig.json` 全部未修改**（`git diff --stat HEAD` 对这几个路径输出为空，逐字节未改动）。全部产物是新增文件。`package.json` 与 `tsconfig.json` 无需改动，因为二者的 `test` 与 `include` 都是通配。

**`dependencies` 仍为 `null`。** 新增零依赖：`node:child_process` 是 Node 内置。

---

## 10. 当前测试

本地自动化测试：**270 / 270 运行，269 PASS，0 FAIL，1 skipped**。

本轮新增 **31 条**（11 个确定性 + 20 个真实 git）：

```text
test/git-repository.test.mjs       11 pass / 0 fail    fake acquirer + 真实 Runtime
test/git-repository-git.test.mjs   20 pass / 0 fail    真实临时 git 仓库
```

全量 270 = 既有 239 + 本轮 31。唯一 skipped 的一条是 `真实 SIGTERM 让常驻停止并让进程干净退出`，跳过原因 `# Windows 不投递 POSIX 信号`——**与本轮无关，本轮开工前就已如此**。

本轮新引入的 skip 轴（`hasGit`）在本机**没有触发**（git 在 PATH 上）；在没有 git 的宿主上，整个 `git-repository-git.test.mjs` 会诚实 skip，而不是给出一串令人困惑的失败。

### 10.1 测试的两处纪律

**真实 git 测试不继承开发者的 git 配置。**

```js
GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null'
GIT_CONFIG_SYSTEM: 同上
GIT_AUTHOR_NAME / EMAIL、GIT_COMMITTER_NAME / EMAIL 全部显式设定
```

一个全局 `status.showUntrackedFiles=no` 或 `init.defaultBranch` 会改变这些 fixture 被观测到的样子，而**一个结果取决于跑在哪台机器上的测试，测的不是这个模块**。

**具名内部 import 本轮新增 2 处。** 全仓现有 7 处（分布在 5 个测试文件）：

```text
test/foreground.test.mjs:20        dist/foreground/plugin.js
test/input-activity.test.mjs:25    dist/input-activity/plugin.js
test/resident-cli.test.mjs:10,11   dist/cli/options.js, dist/cli/resident.js
test/resident-control.test.mjs:23  dist/cli/resident.js
test/git-repository.test.mjs:14    dist/git-repository/plugin.js      ← 本轮
test/git-repository-git.test.mjs:18 dist/git-repository/git.js        ← 本轮
```

两处的理由不同，都写在文件里：

```text
plugin.js  acquisition seam 是内部的，注入 fake acquirer 是唯一
           能在【磁盘上没有仓库】的前提下让生命周期测试确定的方法
git.js     本套件是全仓唯一驱动一个第三方程序、且由它自己写 fixture 的，
           seam 是唯一能到达真实 acquirer、同时不牵动 plugin 生命周期的路径
```

**这两处 import 是本轮覆盖纪律上真实的代价**，不是免费的东西：它们让 `git.ts` 的 parser 分支进入了 `npm test`——这一点与 P3-01 / P3-02（其 parser rejection branches **不在** `npm test` 内，是已记录两个轮次的 coverage gap）**相反**，是本轮的一个改善。代价是测试与内部文件路径绑定。

### 10.2 测试对真实输出形状的断言

`test/git-repository-git.test.mjs` 里的 fake 输出**逐字复制真实 porcelain 形状**（`# branch.oid <hex>` / `# branch.head <name>`），因此 parser 的判别力不依赖真实仓库是否恰好处于某个状态。真实仓库测试负责证明**那个形状是真的**（`assert.equal(head.commit, git(root,'rev-parse','HEAD').trim())`）。

---

## 11. 真实 git 冒烟

在会话临时目录（仓库外）用**从 `dist` 取出的真实 acquirer** 跑通 9 种状态，全部符合预期：

```text
unborn                        → {kind:'unborn'}
clean branch                  → {kind:'branch', name:'main', commit:<hex>}
untracked file                → workTree changed
untracked + showUntracked=no  → workTree 【仍然】 changed     ← §5.2
remote named upstream         → remotes ['upstream']           ← §5.4
detached                      → {kind:'detached', commit:<hex>}
branch literally (detached)   → {kind:'branch', name:'(detached)'}  ← §5.1
非 repository 路径            → GitRepositoryObservationError:
                                … the working tree state could not be read
                                (git exited with code 128)
配置为子目录                  → workTreeRoot 解析到祖先            ← §5.5
```

**这 9 条是实机确认，不是单元测试的重复**：其中 §5.1 与 §5.2 两条是**只有真实 git 才能证明**的，而它们各自对应一处会静默报错的真实缺陷。

---

## 12. 本阶段明确没有实现

```text
没有 RepositoryIdentity / repository id / repository key
没有 origin 这个字符串，没有默认 remote 假设
没有 URL、没有 fetch / push 地址、没有 reachability、没有网络访问
没有 commit 详情、message、author、时间、历史、log、diff、blame
没有 branch 列表、tag、stash、ahead/behind、upstream 配置
没有 staged / unstaged / untracked 的细分，没有文件路径，没有条目计数
没有 git 版本检测，没有能力协商
没有 Judgement / Salience / Relevance / Importance
没有 "Hikari 应该关心这个 repository 吗" 这类问题
没有 Event、没有 Subscription、没有 watcher、没有 polling、没有 timer
没有 cache、没有 latest observation、没有 TTL / freshness / ageMs
没有持久化、没有 Chronicle 写入、没有文件写入、没有目录创建
没有 Resident composition 变更（第七个 Plugin 仍是 Loop）
没有跨 source 推断（不与 foreground / input-activity 做任何关联）
没有通用 Perception framework、没有共享基类、没有第二个注册表
没有 RepositoryIdentity 与 desktop-session-world 的对接
没有 Manager、没有 Agent、没有 Orchestrator
没有依赖：dependencies 仍为 null
```

**本模块是 witness，不是 interpreter。** 它报告「这个 repository 现在是什么状态」，**不**报告这件事意味着什么、是否重要、是否值得记住。

---

## 13. 已知限制（Git Repository Perception v1）

1. **bare repository 不支持。** 它没有 work tree，而 `GitRepositoryWorkTree` 是二值的——v1 没有第三支可以放它。表现是**观测失败**，不是错误的状态值。
2. **分支名恰好是 `(detached)` 时多付一个进程。** 这是 §5.1 那处真实歧义的代价，只有真正有歧义的那一种才付。它没有让普通路径变慢。
3. **观测不是原子 snapshot。** 3（或 4）个独立进程顺序执行，无事务。`observedAt` 描述组装时刻，**不描述 repository 处于任一被报告状态的时刻**。窗口没有被收窄，也没有被声称窄。
4. **`workTree` 只有一个 bit。** 无法回答「脏在哪」「脏了多少」「是不是 staged」。
5. **unborn 时不报告分支名。** `git init -b main` 之后 `# branch.head main` 确实在那里，但本轮刻意不报告——那个名字此刻还不是一个已存在的 ref。这是**选择**，不是读不到。
6. **`workTreeRoot` 是 git 的字符串，不是原生路径形态。** Windows 上它是正斜杠归一化的形式。本模块**不转换**——转换会引入一个「哪一侧该做这件事」的问题，而 v1 不回答它。
7. **退出码不翻译成原因。** 调用方能拿到「工作树状态读不到（git exited with code 128）」，拿不到「那不是仓库」。这是 §6.2 的**故意选择**，不是信息缺失的借口。
8. **零生产 consumer。** 今天没有任何生产代码调用 `gitRepositoryService`。这是预期状态（§0 立项依据），但必须如实记录：**没有任何真实调用方验证过这个契约在真实使用中感觉对不对。**
9. **两个错误类不设 `.name`。** 与仓库既有两个错误类一致；`instanceof` 与 `error.constructor.name` 可用，但 `error.name` 一律是 `'Error'`。
10. **不检测 git 版本、不做能力协商。** 模块依赖 `status --porcelain=v2` 与 `branch --show-current` 两个开关；比它们更旧的 git 会落进「输出读不懂」或「退出码」两条路径之一，而**不会被特判**。本机实测环境为 `git version 2.53.0.windows.3`。
11. **一次 `current()` = 3–4 次进程启动。** 与两个桌面感知的 PowerShell 成本是同一类代价（更小，因为 git 启动比 PowerShell + `Add-Type` 便宜）。v1 不优化、不预热、不缓存。
12. **`inflight` 只覆盖当前 acquirer 的进程。** 跨两次 `acquire()` 之间没有协调：两次并发 `acquire()` 会各自开 3–4 个进程，顺序不做保证。v1 不为此加 mutex——调用方不存在，排队是为想象中的调用方付协调成本。

---

## 14. 与 P4-03 的关系（上限声明，必须与本轮全部结论同时阅读）

```text
本轮交付的是  observation of a named local object（一个具名本地对象的一次观测）
本轮没有交付  relevance —— 这个 repository 对用户意味着什么
本轮没有交付  repository identity —— 跨时间、跨主机指同一个东西的能力
本轮没有交付  P4-03 的任何一部分 Judgement
```

**准确的说法是**：Hikari 第一次有了一条**具名对象源**，因此 P4-03 的 Explicit Declaration / Reference Frame 研究**第一次有了一个可以指向的真实对象**。但「有一个可以指向的对象」与「知道这个对象对用户意味着什么」是两件事，不得互相替代。

**本轮不占用 P4-03 编号。** 它是 P4-03 的一个 supporting slice，工作标签，不是阶段编号；P4-03 本身**仍然未开始**。`current-stage.md` 里第四阶段的进度不允许因为本轮而写成 P4-03 已完成。

**最容易被读大的地方**：一个能报告 branch / detached / unborn、能报告 work tree 是否干净、能报告 remote 名字的观测，看起来「已经知道关于这个仓库不少事了」。它知道的全是**此刻的、局部的、二值化的事实**——它不知道这是谁的仓库、这个仓库重不重要、用户在哪个仓库上工作、两个路径是不是同一个仓库。§0 那句话是本轮唯一允许的结论句。
