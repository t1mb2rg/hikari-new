# 最后一轮四组认知对照：相关行动历史是否改变复查优先级与候选介入

- 实验时间：2026-10-20（`frozenAt=2026-10-20T16:10:15.281Z`）
- 模型：`qwen3.8-flash-next-iq2_xs` @ `http://192.168.1.20:8080/v1/chat/completions`，`temperature=0`
- 产品代码基准：`src/` 实验前后均为 `146e53bf9feeafa1bfed9dd7b199b55b82c12fe7`，零改动
- 这是当前 CI 认知实验阶段的最后一轮，不追加样本

## §0 结论

1. **相关历史确实改变了一处判断，但改变落在「解释与候选介入」上，没有落在「先看哪里」上。** M1 多出的两处内容只能由那条历史得出：`Setup Node` 的 cache 步骤发生在 `Install dependencies` 之前，所以本地 `npm install` 生成的 lock 对 CI 无效；对应的候选是把 lock 生成提前到 cache 之前、调整 workflow 顺序。
2. **M1′ 也有新增内容，但都是不依赖它的历史也能想到的通用排查项**（检查 `.gitignore` 是否忽略 lockfile、同一 workflow 在其他 run 是否通过）。这是本轮把「相关」与「同形态但无关」分开的唯一依据。
3. **没有任何一组把历史读成「问题已解决」。** 三组 `resolved` 全为 `false`，全文无「已解决 / 已修复 / 说明根因就是 / 无需再看」。
4. **产品今天在这个 run 上不给任何建议**（R 组 `insufficient-evidence` / `commit-comparison-indeterminate`），所以本文的对照是「模型判断 vs 模型判断」，不是「模型 vs 产品」。

## §1 为什么换掉上一轮的场景

上一轮用 run `38932844025`，日志里直接有一行 `真机实验：故意失败`。不接任何历史也能判断「这是故意的」，M0 组已经饱和，测不出历史有没有用。**上一轮「相关历史未产生独立增量」应归因为场景饱和，不得外推为「历史对模型认知无效」**——这是本轮的第一条前提。

本轮换成 run `34752988729`：

| 项 | 值 |
| --- | --- |
| 提交 | `2a2c0748ed5c58b5c8e91b7439cff3de51946056`（`ci: run runtime tests on GitHub Actions`） |
| workflow / 分支 | `Runtime Tests` / `main` |
| 失败 job / step | `test` / `Setup Node` |
| 改动文件 | 1 个：`.github/workflows/runtime-tests.yml`（`added`） |
| 日志窗口 | `failing-step`，3 119 字符（含边界标记的消息体） |
| 关键日志行 | `##[error]Dependencies lock file is not found in /home/runner/work/hikari-new/hikari-new. Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock` |

选它的理由正是**它不自证原因**：日志说的是「找不到 lock 文件」，但没说该补一个 lock 文件、还是该把 `cache: npm` 去掉、还是这是仓库本身就不用 lock 的正常状态。这个分叉需要仓库历史才能收窄。

## §2 四组设置

| 组 | 模型 | 材料 | 第四段 |
| --- | --- | --- | --- |
| R | 不调用 | — | — |
| M0 | 调用 | 材料 JSON + 日志段 | 无 |
| M1 | 调用 | 同上，逐字一致 | 相关历史：截至 `2a2c074` 从未提交过 `package-lock.json` / `npm-shrinkwrap.json`；`.gitignore` 未忽略；本地安装一直用 `npm install` |
| M1′ | 调用 | 同上，逐字一致 | 无关历史（同形态）：测试框架一直是 `node:test`，`scripts.test` 直接调 `node --test`，没有用 jest/mocha/vitest |

前三条消息在三组之间**逐字相同**（`freeze.mjs` 内已断言打印 `true`）。两条历史各 152 / 135 字符，`materialKind: experimental`，来源是 git 提交记录，**不是真实的 Chronicle 事实**——本仓库里没有这两条事实。

任务说明要求模型输出 `explains / facts / assumptions / first_look / missing_info / candidates / resolved` 七个字段，**不给任何工具**，不执行动作。

## §3 五维逐条比对

### 3.1 语义判断（`explains`）

| 组 | 原文 |
| --- | --- |
| M0 | 「这次 CI 失败发生在 test job 的 Setup Node 步骤，因为 actions/setup-node@v4 启用 npm cache 时未找到依赖 lock file。」 |
| M1 | 「这次失败意味着 test job 的 Setup Node 步骤因启用 npm cache 但 checkout 中没有受支持的依赖 lock file 而失败，后续安装和测试步骤被跳过。」 |
| M1′ | 「这次失败意味着 Setup Node 步骤因 actions/setup-node 的 npm cache 找不到依赖 lock file 而失败，后续安装和测试步骤被跳过。」 |

**三组一致**：都归到「cache 找不到 lock file」，都没把它说成代码缺陷。这一维没有差异。

### 3.2 事实与假设区分

| 维度 | M0 | M1 | M1′ |
| --- | --- | --- | --- |
| `facts` 条数 | 16 | 26 | 10 |
| 其中引自历史材料 | 0 | 3 | 2 |
| `assumptions` 条数 | 3 | 5 | 5 |
| ASCII 标识符可回溯 | 16/16 | 26/26 | 10/10 |

三组都把历史内容**放进 `facts` 并注明「实验材料称…」**，没有伪装成自己的观察；推测都放在 `assumptions`。token 级回查零编造。

### 3.3 复查优先级（`first_look`）

| 组 | 首位 | 第二位 | 第三位 |
| --- | --- | --- | --- |
| M0 | `job test / step Setup Node 的失败日志` | `runtime-tests.yml` 的 `cache: npm` | 仓库根目录是否存在 lock 文件 |
| M1 | `test job > Setup Node step` | `runtime-tests.yml` 的 `cache: npm` | 仓库根在 headSha 是否存在 lock 文件 |
| M1′ | `日志中的 Dependencies lock file is not found 报错行` | `cache: npm` 配置 | 仓库根是否存在 lock 文件 |

**三组的排序结构基本一致**（日志 → cache 配置 → 是否存在 lock 文件）。M1′ 的首位指向更具体（报错行本身），M1 没有。**这一维不支撑「相关历史改变了复查优先级」。**

### 3.4 信息需求（`missing_info`）

M1 独有的第五项：「是否有后续 CI run 在添加 lock file 或移除 cache 后成功。」

M1′ 独有的第六项：「同一 workflow 在其他 run 中是否通过。」

两条形态相近：都是「去别的 run 里找对照」。区别在 M1 的表述与它自己的历史直接咬合（历史讲的是 lock 从未存在 → 想知道「补上之后是否就好了」），M1′ 的表述是通用回归意识。**这一维有差异，但差异不够干净**——两组都新增了「去别的 run 找证据」这类需求。

### 3.5 候选介入意图（`candidates`）

| 组 | 条数 | 只在该组出现的项 |
| --- | --- | --- |
| M0 | 3 | 「如果项目使用 yarn，确认 lockfile 类型与 cache 配置一致；不确定时移除 cache 更可能先恢复 CI」 |
| M1 | 4 | **「在 Setup Node cache 步骤之前生成 lock file，但需要调整 workflow 顺序或单独执行安装步骤。」** |
| M1′ | 4 | 「确认 lock file 是否被 `.gitignore` 排除，并调整忽略规则。」 |

M1 的这条候选**只能由那条历史得出**：只有知道「本地一直用 `npm install`」（即本地能生成 lock、CI 不能），才会想到「把生成步骤提前」。

M1 对应的 assumption 也是同一条推理：「`npm install` 可能在本地生成 lock file，但 CI 中 Setup Node cache 步骤发生在 Install dependencies 之前，因此本次运行无法依赖后续 `npm install` 生成 lock file。」

M1′ 的 `.gitignore` 项是本轮 M0 的 `missing_info` 里就已经含有的方向（「仓库中是否实际存在 lockfile」）的一个变体，不需要它的历史。

### 3.6 汇总

| 维度 | M1 相对 M0 | M1′ 相对 M0 |
| --- | --- | --- |
| 语义判断 | 无实质变化 | 无实质变化 |
| 事实与假设 | 多 3 条历史事实（标注来源） | 多 2 条历史事实（标注来源） |
| 复查优先级 | 无变化（首位一致） | 无变化（首位更具体，方向一致） |
| 信息需求 | 新增「后续 run 是否成功」 | 新增「其他 run 是否通过」 |
| 候选介入 | **新增「调整 workflow 顺序」——历史独有** | 新增「检查 `.gitignore`」——通用项 |
| 是否误读 | 否 | 否 |

## §4 判据 C1–C6 结果

| 判据 | M0 | M1 | M1′ | 说明 |
| --- | --- | --- | --- | --- |
| C1 语义判断 | 归到 cache/lock，非代码缺陷 | 同 | 同 | 三组一致 |
| C2 事实与假设区分 | 原规则 0/16；token 级 16/16 | 原规则 0/26；token 级 26/26 | 原规则 0/10；token 级 10/10 | **原规则不可用，见 §8** |
| C3 复查优先级 | 首位=日志 | 首位=日志 | 首位=日志 | 无实质变化 |
| C4 信息需求 | 有 | 有，新增一条 | 有，新增一条 | 两组都新增，不干净 |
| C5 候选介入 | 3 项 | 4 项，含历史独有项 | 4 项，含通用项 | M1 的独有项是唯一硬差异 |
| C6 是否误读 | `resolved=false` | `resolved=false` | `resolved=false` | 三组全 pass |

## §5 两条判断的裁决

**「相关历史改变认知」→ 支持，但只在候选介入维。** 依据是两处只能由那条历史得出的内容（§3.5 的候选与 assumption）。反证同样要写清：`first_look` 首位没有变，`explains` 没有变，M1′ 在信息需求维也新增了一条同类需求。如果只允许一个维度的证据，这条判断只站得住一半。

**「历史不被误读」→ 支持。** 三组 `resolved` 全 `false`，没有一组把「历史里发生过某动作」当成「问题已解决」；M1 明确把历史标为「实验材料称…」而不是当前事实。

## §6 对上一轮结论的效力修正

上一轮（`experiments/cognition-control/`）的结论「相关历史未产生独立增量」**应改判为「在该场景上无法区分」**：

- 那一轮的日志自证「故意制造」，M0 不需要任何历史就能给出完整解释；
- 本轮的场景不自证原因，同样两组的对比出现了可指认的差异（候选介入维）；
- 因此上一轮的零差异**不能**外推为「历史对模型认知无效」。

## §7 范围：这不证明什么

- **不证明模型能替代产品判断。** R 组说明产品今天在这个 run 上完全不给建议；模型给的是判断，不是事实。
- **不证明历史应当进入模型上下文。** 本实验的历史是 git 提交记录、一条一次；产品里没有任何一条路径会把这种记录交给模型，`repository-change-executor.result` 至今不进任何 prompt。
- **不证明这类判断会让通知更值得打扰人。** 本轮没有测「值不值得打扰」，也没有测通知文本质量。
- **只在一个模型、一个端点、一个失败场景、每组一次**上成立。三组各跑一次，没有重复样本，无法给出稳定性估计。
- **差异只在一处**：候选介入里的一条。任何「模型理解仓库历史」级别的表述都超出本轮证据。

## §8 读数缺陷

1. **C2 原规则（facts 逐字匹配材料）在本轮不可用。** 模型用中文改写英文材料，跨语言逐字匹配必然全数落空（三组 0/16、0/26、0/10），那读的是语言不是事实。事后补的 token 级规则（抽 ASCII 标识符与数字回查语料）显示 52 条 facts 全部可回溯、零编造。这条补充规则是看到输出之后写的，只作辅助读数，不用于裁决。
2. **每组只跑一次。** 没有重复，温度虽为 0 但端点不保证确定性（上一批同端点已有 502 与耗时波动）。
3. **历史材料是构造的。** 两条都是实验材料，不是 Chronicle 事实；它们的形态模仿 `repository-change-executor.result`，内容来自 git 提交记录。真实产品流程中，模型目前读不到任何这类记录。
4. **长度不完全对齐。** 两条历史 152 / 135 字符，相差 17 字符。差异很小但存在。

## §9 复现

```bash
node experiments/cognition-control-round2/freeze.mjs   # 冻结四组（不调模型，抓产品真实请求体）
node experiments/cognition-control-round2/run.mjs      # 跑 M0 / M1 / M1′，各一次，不重试
node experiments/cognition-control-round2/assess.mjs   # C2 的 token 级补充核验
```

产物：`samples.json`（冻结）、`outputs.json`（原始输出 + C1–C6 判定）、`c2-tokens.json`（补充核验）、本报告。
