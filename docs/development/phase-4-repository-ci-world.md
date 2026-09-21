# Repository CI World v1（P4-03 Supporting Slice）

> 轮次：**P4-03 supporting slice**（**工作标签，不是阶段编号**——本轮不占用 P4-03 编号，也不是 P4-03.1；P4-03 本身仍未开始）
> 状态：**实现完成、Functional / Architecture Review 通过、已提交、已 push**
> 提交：`f4234ef feat: add repository ci world`，CI（Runtime Tests #35574151359）**success**：314 tests / 297 pass / 17 skipped / 0 fail
> 前置：Git Repository Perception v1（`ca2db7a`，CI #35567512137 success：270 tests / 253 pass / 17 skipped / 0 fail）与 **GitHub CI Perception v1**（`65dd556 feat: add github ci perception`，CI #35569202089 success：296 tests / 279 pass / 17 skipped / 0 fail）；本轮开工时 `origin/main` = `65dd556`

> **Note（本轮如实记录）**：GitHub CI Perception v1 的一个 supporting slice **没有自己的阶段文档**，它的事实由本文件的前置行与 `current-stage.md` 的状态行记录。这是本轮刻意的取舍（最小必要文档），不是遗漏被掩盖。

---

## 0. 本轮回答的问题

截至上一轮，Hikari 已经有两个**真实具名对象源**：

```text
git-repository.current@1   一个明确指定的本地 Git repository 现在报告什么
github-ci.current@1        一个明确指定的 GitHub repository 现在报告什么
```

但**没有任何代码路径能同时持有这两份 observation**。任何想要它们的消费者都必须自己 `requires` 两个 contract、自己决定「同一时刻」意味着什么、自己把两个失败合并成一个信封——于是这套语义会在每一个跨源消费者里被重新实现一遍。

本轮只解决这一个问题：

> **如何诚实地让 `git-repository.current@1` 与 `github-ci.current@1` 进入同一个显式 repository scope，同时不提前发明 `RepositoryIdentity`？**

### 立项依据

与 Git Repository Perception v1 同构：**不是**「以后可能会用到」，而是一件已经发生的事——P4-03 的第一个 judgement 需要同时看到两份 observation，而这个能力今天不存在。

Contract Creation Gate 对照（`plugin-design-spec.md` §16）：

| # | 问题 | 本轮答案 |
| --- | --- | --- |
| 1 | 谁拥有这个语义？ | **World**。单个源都答不出「另一个源此刻说了什么」；而组合两份事实**不产生任何意义判定** |
| 2 | 存在真实跨模块 interaction need？ | 存在——两份 observation 共同指称同一时刻，这是已经发生的语义（见 §7 实测证据）。具体 Consumer 尚未出现，§16.1 明写「不要求已经存在具体的 Consumer implementation」 |
| 3 | Service / Event / Durable Fact / Action？ | **Service**，pull-only。Event 意味着 World 自己判断「哪个变化值得宣布」，那是 significance judgement |
| 4 | 现有 contract 能否表达？ | 不能。两个源各自只是自己那个 contract |
| 5 | 是否泄露实现细节？ | 不。`unavailable` 不带 reason——World 不 own 两个源的失败分类法 |
| 6 | 生命周期语义明确？ | 明确：`requires` 两个源，两者都在才 `active` |
| 7 | Runtime 是否开始理解业务？ | 没有。Runtime 只看到两个不透明 contract id |
| 8 | 真实需要，还是为了测试 / 对称 / 未来？ | 真实需要（理由同上）。**precedent 完全同构**，见 §8 |

### 本轮成立之后到达的那句话

> **Hikari 第一次能够在同一时刻同时持有「本地 Git 报告了什么」与「GitHub CI 报告了什么」，并且仍然不知道它们说的是不是同一个 repository。**

到达这句话就够了。本轮不越过它。

---

## 1. 冻结边界（十个裁决问题逐条对照）

| # | 问题 | 结论 | 本轮实现事实 |
| --- | --- | --- | --- |
| 1 | 该落在 World 而非 Perception / Judgement？ | **是** | `src/repository-ci-world/`，与 `desktop-session-world` 同构 |
| 2 | scope 的 owner 是谁？ | **composition site** | 谁把两个源 + World 一起 load，谁就是。既不在 Runtime，也不在任何 registry |
| 3 | scope 应由显式配置建立，而非 SHA / basename / remote 推断？ | **是** | 两个源各自的 config（`repositoryRoot` / `repository`）**本来就**是显式的；World 一个新配置都不加 |
| 4 | 可以存在一个很窄的 Repository CI World？ | **可以** | 见 §2 |
| 5 | 需要 public Service contract？ | **需要** | `repository-ci-world.current@1`。见 §8 precedent |
| 6 | 已存在真实 callable need？ | **跨源交互语义已真实发生**；具体 Consumer 尚未出现 | 与 P3-03 落地时的状态同构 |
| 7 | 需要显式 binding/config 声明同一 scope？ | **需要，但不需要新类型** | binding **就是** composition 本身 |
| 8 | binding 属于谁？ | **加载方** | 没有塞进 Runtime，没有造 registry |
| 9 | 必须先改 Resident composition？ | **不必，且不应改** | `resident.ts` 明写「Exactly seven plugins, and nothing else.」；precedent 见 §8 |
| 10 | 必须给 git-repository v1 加 remote URL？ | **不必** | scope 可由显式配置建立，为「证明 identity」扩 Perception 属无据扩张 |

本轮**没有**引入：`RepositoryIdentity` / `ProjectIdentity` / `Generic NamedObject` / `GlobalWorldState` / `Central Judgement Domain` / `Generic Reference Frame` / relevance / unrelated / importance / salience / fake consumer / 通用 World 框架 / 基于 SHA 相等推断 repository identity。

---

## 2. 契约与形态

`src/repository-ci-world/`，四文件，与 `desktop-session-world` 同构（**无** `errors.ts`：World 永不失败；**无** `acquisition.ts`：World 不 own 任何 transport）：

```text
repository-ci-world
requires: [git-repository.current@1, github-ci.current@1]
provides: [repository-ci-world.current@1]
config:   undefined          ← 注意：它的两个源都带 config，它自己一个都不带
```

```ts
interface RepositoryCiWorldSnapshot {
  readonly snapshotAt: string;
  readonly gitRepository: RepositoryCiGitRepositoryFacet;
  readonly githubCi: RepositoryCiGitHubCiFacet;
}

type RepositoryCiGitRepositoryFacet =
  | { readonly kind: 'available'; readonly observation: GitRepositoryObservation }
  | { readonly kind: 'unavailable' };
```

要点：

- **facet 以「源」命名，不以「角色」命名。** `gitRepository` / `githubCi` 是两个名字对应两份 observation；写成 `local` / `remote` 或 `code` / `ci` 就已经是对它们的**解读**，而这一层不解读。
- **`unavailable` 不带 reason。** World 不 own 两个源的失败分类法；需要知道为什么失败，去问那个源。
- **`snapshotAt` 在两个 facet 都 settle 之后才打。** 它描述「这个信封是什么时候装好的」，**不是**「源观察到了什么」——两份 observation 各自的 `observedAt` 才是后者的唯一出处。
- **两个源在同一个同步段内启动**（`Promise.allSettled` + `Promise.resolve().then(...)`），后者同时把「源同步抛错」转成 rejection，使两种失败方式落到同一处。
- pull-only、无 cache、无 watcher、无 Event、无持久化、无历史状态。

---

## 3. 为什么 World 故意不知道 scope 是什么

这是本轮唯一真正需要论证的设计决定，也是它容易做错的地方。

**World 拿不到 `repositoryRoot`，也拿不到 `owner/name`。** 一旦拿到，它就能比较它们——而那个比较正是它存在要**留而不发**的结论。所以：

> **它按构造是盲的（blind by construction），不是靠纪律保持盲。**
> 这是它诚实的保证，不是遗漏。

`requires` 里写的是两个 contract，plugin 的 `config` 是 `undefined`，模块从不 import 任何一个源的 plugin 或 config 类型。因此「这两个源说的是不是同一个 repository」这个问题，World **在类型层面就无法回答**。

消费者仍然可以自己去看两份 observation——`gitRepository.observation.head.commit` 与 `githubCi.observation.latestRun` 都在 snapshot 里。World 不阻止读者得出结论，它只是**不替读者先得出结论再当作事实递出去**。

测试用禁止 token 表把这条性质钉死——全模块不得出现：`headSha` / `workTreeRoot` / `full_name` / `remotes` / `fetch` / `execFile` / `spawn` / `node:`。前四个是「一旦读到就能拿来比较」的事实，后四个是「能够去够到机器」的通道。

---

## 4. 与 desktop-session-world 的同构与差异

| | desktop-session-world（P3-03） | repository-ci-world（本轮） |
| --- | --- | --- |
| 文件数 | 4 | 4 |
| config | `undefined`（两个源也都没有 config） | `undefined`（**两个源都有 config**） |
| snapshot 是否含 scope 标识 | 否 | 否 |
| `snapshotAt` 位置 | 两个源 settle 之后 | 同 |
| facet | `available` / `unavailable` | 同 |
| 失败语义 | World 永不失败 | 同 |

**唯一的实质差异是 config 那一行**，而它恰恰是最有信息量的一行：desktop 的 World 不接 config 是「没什么可接」，这里的 World 不接 config 是「有两个值可以接，但接了就能比较，所以不接」。前者是省略，后者是决定。

---

## 5. GitNexus 证据

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `check` | `status: clean`，`cycleCount: 0` | 无新增 import 环 |
| `detect_changes({scope: "all"})` | `changed_count: 54`，`changed_files: 5`，无 `partial` / `truncated` | 首跑因索引未覆盖新文件报 `0`——按 CLAUDE.md，**零意味着「没看到」，不是「没影响」**；`analyze --index-only` 刷新后重跑得 54 |
| `impact(repositoryCiWorldService, upstream)` | `risk: UNKNOWN`，`impactedCount: 0` | **不当作安全**。文本检索确认：`repositoryCiWorldPlugin\|repository-ci-world` 全仓只命中新模块自己的三个 `.ts` 与测试文件，**真实消费者为 0** |

### 一处 GitNexus 假阳性（已查证）

`detect_changes` 的 `affected_processes` 列出 `proc_122/123/124_current`（`Current → CompareForeground` 等）。用 cypher 展开步骤即见真相：

```text
proc_122_current  step 1  current  src/repository-ci-world/plugin.ts     ← 本轮新增
proc_122_current  step 2  current  src/desktop-session-awareness/plugin.ts
proc_122_current  step 3  compareForeground  src/desktop-session-awareness/plugin.ts
```

两条**互不相干**、仅仅同名的 `current` 被 GitNexus 按名缝在了一起。判据同 `parseConfig`：本模块在 `src/` 下的消费者数为 0，不存在任何通往 `desktop-session-awareness` 的执行路径。

---

## 6. 测试（`test/repository-ci-world.test.mjs`，18 项）

沿用 P3-03 的做法：**不注入 seam**，测试提供假的 *provider* 作为普通 Plugin，由真实 Runtime 依赖图决定谁 active；被测的是生产 plugin 本身。

其中两项是本切片特有的诚实约束，值得单独指出：

- **`the snapshot holds the two facets and no fact of the world own`** —— snapshot 的键集精确等于 `[gitRepository, githubCi, snapshotAt]`。任何「这是哪个 repository」的字段都会当场失败。
- **`the world records neither agreement nor disagreement between the two sources`** —— commit 相符与不符两种输入产出**完全相同**的键结构。World 哪天开始比对 SHA，这里立刻红。

其余覆盖：契约形状与 `config === undefined`；只有两个源都在时才 `active`；provider 消失后回到 `waiting`、回来再 `active`；两份 observation **按引用**原样透传（不是深比较）；`snapshotAt` 用毫秒边界证明晚于最后 settle；snapshot 与两个 facet 均 frozen；每次 `current()` 都是新采集；单源失败只让该 facet 不可用；**同步 throw 与类型化失败落到同一处、不被分类**；**已观察到的缺失**（`unborn` head、无 CI run）保持 `available`，不与被观察失败合并；两个源都在任一方 settle 前启动；idle / shutdown 期间零采集；模块依赖白名单与禁止 token 表。

---

## 7. 跨源事实的实测证据（为下一轮准备，本轮不使用）

上一轮用真实 acquirer 对真实 `api.github.com` 取得过：

```text
本地   git rev-parse HEAD          = 4b6fe319c4621bbdef932ee1ea3562dc19ed81f5
GitHub actions/runs?per_page=1 → head_sha = 4b6fe319c4621bbdef932ee1ea3562dc19ed81f5
```

**逐字节相同。** 记录在这里是为了下一轮：commit 级对齐**零成本已经成立**。

同时必须记住它的限度：**同一个 commit 可以同时存在于 fork 里，所以 SHA 相等是证据，不是同一性。** 这正是 World 拒绝替读者下结论的原因，也是下一轮 judgement 必须止步于 commit 级的原因。

---

## 8. 为什么 World 可以没有 Consumer 就落地（precedent，非推断）

Contract Creation Gate §16.2 有一句「若不存在真实的 callable need，默认不创建 Service」。本轮**没有**生产 Consumer，所以这一条必须正面回答，而不是绕过。

依据是 **P3-03 的 precedent 完全同构**，用 commit 历史核实过：

```text
a4f5c94  feat: 完成 P3-03 桌面会话 World v1        ← World 单独落地，无 consumer
ead4d7c  feat: 完成 P3-04 桌面会话变化感知 v1       ← consumer 下一轮才来
0db5516  feat: add resident process composition    ← Resident 更晚才成立
```

**先有 World，后有 consumer，最后才有 composition。** 因此本轮：

- **不进 Resident。** `src/cli/resident.ts` 明写「Exactly seven plugins, and nothing else.」；且 `desktopSessionWorldPlugin` 是随 `0db5516` 才进 composition 的，不是在 P3-03。
- **不造 fake consumer。**
- **不为了「能跑」而硬塞 composition。**

---

## 9. Review

**Functional Review — PASS。**

两份 observation 按引用原样透传；per-facet 可用性互不影响；同步 throw 与类型化失败落到同一处；已观察到的缺失保持 `available`；`snapshotAt` 晚于最后 settle；每次 `current()` 都是新采集；idle / shutdown 期间零采集；build 与 314 项测试通过，CI success。

**Architecture Review — PASS，一处如实记录。**

- concern 在正确的 owner（World，不是 Perception，也不是 Judgement）；
- Runtime 没有开始理解业务——它只看到两个不透明 contract；
- 没有引入任何 `RepositoryIdentity` / `GlobalWorldState` / Service Locator / 中央 Judgement；
- snapshot **故意不含 scope 标识**，这是 `GlobalWorldState` 的反面；
- 未触碰「当前明确仍不做」清单：无跨 source 推断、无通用 Perception / World 框架、无持久化、无后台化、未进 Resident；
- **如实记录的一项**：`repository-ci-world.current@1` 目前**没有生产 consumer**。依据见 §8（precedent），不是「多个 agent 都同意」。

第四阶段目前**没有**架构评审文档，本轮沿用该口径，不新增。

---

## 10. 限制

1. **没有生产 consumer。** 零调用方是预期状态，不是遗漏（§8）。
2. **没有进入任何 composition。** Resident 的七插件列表未变。
3. **`unavailable` 不带 reason 是刻意的。** 需要区分「git 不在」「不是 work tree」「网络超时」的调用方，必须自己再去问那个源。
4. **World 无法回答「是不是同一个 repository」，且这是设计而非缺陷。** 见 §3。
5. **本轮没有、也没有试图创造 repository identity 的任何事实依据。** 见 §7 的限度说明。

---

## 11. 人工裁决（本轮落地后作出）

本文件只负责把 P4-03 第一个 judgement 的**输入**准备齐；判断本身不在本轮。世界落地并交付后，人工裁决为 **A**：

> **P4-03 的第一个真实 judgement 定义为 commit 级**——
> 「本地 Git HEAD 与当前观察到的 GitHub CI run 是否指向同一个 Git commit」。
>
> 这**不是** repository identity judgement，**不是** repository-level relevance，**不是**用户相关性判断；只比较两个 source **已经直接报告**的 commit SHA。
>
> 不允许从 `same` 推导「这是同一个 repository」，也不允许从 `different` 推导「不是同一个 repository」。

下一轮（P4-03 supporting slice）据此实现，本文件不预写它的结论。
