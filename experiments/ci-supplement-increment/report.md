# 模型补充相对基线通知，到底多说了什么

五个历史真红 run，各跑一次真模型补充。问题只有一个：**在确定性链路一个字建议都给不出的时候，那段模型补充有没有给出通知里没有、且能对上材料的具体失败定位。**

日期：2026-10-19。材料：真 token 从 GitHub 现读。模型：`qwen3.8-flash-next-iq2_xs`（`192.168.1.20:8080`），`temperature: 0`，`budgetMs` 180 000。提示词与 schema 与 `146e53b` 一致（`outputs.json` 里 `supplementCommit` 记录该哈希）。

## 0. 结论

1. **五次补充段共提到 22 个具体标识，没有一个出现在基线通知里。** 基线通知是 8 行，只有仓库 / 运行号 / 工作流 / 分支 / 提交 / 结论 / 观察时间——它从结构上就不可能包含 job 名、step 名、文件路径。
2. **22 个标识全部能在材料里逐字找到，幻觉 0。**
3. **五次指向的失败位置与材料里的真值全部一致，不一致 0。** 其中三处是材料本身的缺口，不是失败原因：模型指出「日志窗口只覆盖 `Build and test`」，而真值里另一个失败 job `surface` 的 `Test the runtime` 步骤没有日志——这一点通知里没有，材料里也不显眼。
4. **但增量是不均匀的**：最有用的一次（`38930952193`，182 字）给出文件:行号与断言原文；最薄的一次（`38932844025`，55 字）只说了「再看 `Test the runtime` 步骤、`skipped` 步骤、日志末尾退出行」，三个都是范围提示，没有落到具体行。

这四条只在这五个材料、这一个模型、这一批样本上成立。

## 1. 两段内容各自的形状

| | 基线通知 | 模型补充 |
| --- | --- | --- |
| 何时出现 | 每次失败都发 | 只在 `commit-comparison-indeterminate`（确定性链路无建议）时附在后面 |
| 行数 / 长度 | 恰好 8 行 | 一条 `补充复查建议（模型，不是规则判断）` 标签 + ≤600 字 |
| 含哪些字段 | 仓库、run id、工作流、分支、commit、结论、观察时间 | 自由文本 |
| 不含什么 | job、step、文件、日志内容 | 无结构约束（只有 cited 逐字校验） |

基线通知由 `src/repository-ci-attention/judgement.ts` 的 `renderOccurrence` 生成；补充段由 `src/repository-ci-attention/supplement-block.ts:32-39` 组装。这就是「增量」的全部空间：**通知里没有任何定位信息，所以任何 job/step/文件都是净新增。**

## 2. 逐 run 对照表

判分规则写死在 `score.mjs` 里（`score.json` 有逐项明细），标识分三类：词表命中的 job / step 名、文件路径、与日志逐字相同的片段（6-gram 滑窗）。

| run | 基线通知行数 | 补充段字数 | 标识数 | 其中在通知里 | 其中材料里查不到 | 与真值不一致 |
| --- | --- | --- | --- | --- | --- | --- |
| `38920662846` | 8 | 117 | 5 | 0 | 0 | 0 |
| `38929605750` | 8 | 85 | 5 | 0 | 0 | 0 |
| `38930952193` | 8 | 182 | 5 | 0 | 0 | 0 |
| `38931770141` | 8 | 143 | 6 | 0 | 0 | 0 |
| `38932844025` | 8 | 55 | 1 | 0 | 0 | 0 |
| **合计** | — | — | **22** | **0** | **0** | **0** |

「与真值不一致」只对 job / step / 文件三类成立（判定：job 名是否在失败 job 清单里，step 名是否挂在某个失败 job 下，文件是否在 `changedFiles` 里）。`log-span` 不参与这一列，它证明的是「引用了日志原文」，不是「定位正确」。

## 3. 五次原文与逐条定位判定

真值对五个 run 完全同构：失败的 job 是 `test`（失败 step `Build and test`）与 `surface`（失败 step `Test the runtime`）；改动文件 `test/ci-failure-probe.test.mjs`。**但日志窗口取的步骤不一样**——这是判「指向对不对」的关键前提：

| run | 材料里的 `log.step`（日志窗口实际覆盖的步骤） |
| --- | --- |
| `38920662846` | `Build and test` |
| `38929605750` | `Build and test` |
| `38930952193` | **`Test the runtime`** |
| `38931770141` | `Build and test` |
| `38932844025` | `Build and test` |

### 3.1 `38920662846`（138 776 ms）

> 建议补看 surface 作业里的 Test the runtime 步骤；当前日志窗口只覆盖 Build and test。可再核对 test/ci-failure-probe.test.mjs:8:1 与 1 !== 2 这两行。

判定：**一致**。`surface` / `Test the runtime` 是真失败位置；「日志窗口只覆盖 Build and test」与上表真值吻合；文件在 `changedFiles` 里；`1 !== 2` 是日志原文（`test/ci-failure-probe.test.mjs:8:1` 命中日志）。

### 3.2 `38929605750`（140 565 ms）

> 建议补看 surface 作业中 conclusion 为 failure 的 Test the runtime 步骤；当前日志片段只覆盖 Build and test。

判定：**一致**。同上，且这次明确说了「窗口只覆盖 Build and test」= 指出材料缺口。

### 3.3 `38930952193`（147 241 ms，补跑）

> 建议补查：先看 Test the runtime 步骤日志中的 test at test\ci-failure-probe.test.mjs:13:1 和 AssertionError [ERR_ASSERTION]: 这一条是故意写失败的断言；同时核对 Build and test 步骤是否也涉及 test/ci-failure-probe.test.mjs。

判定：**一致**。这个 run 的日志窗口恰好就是 `Test the runtime`，所以把 `test.mjs:13:1` 与 `AssertionError` 归到它名下是对的；`Build and test` 也是真失败步骤。这是五条里定位最具体的一次。

### 3.4 `38931770141`（125 902 ms）

> 建议先看 test 作业里 Build and test 失败步骤，以及 surface 作业里 Test the runtime 失败步骤；在改动文件 test/ci-failure-probe.test.mjs 的日志片段中，可核对"真机实验：故意失败"和"1 !== 2"这两行。

判定：**一致**。两个 job / 两个 step / 文件全对，且把日志片段正确归到「改动文件的日志片段」（不声称它来自哪个 step）。

### 3.5 `38932844025`（166 807 ms）

> 建议再看 Test the runtime 步骤、被标记为 skipped 的步骤，以及日志末尾的进程退出行。

判定：**一致但信息量最低**。`Test the runtime` 是真失败步骤（且该 run 窗口是 `Build and test`，补看是对的）；`skipped` 是真的——两个 job 里共有 5 个 skipped 步骤（`test` 的 `Setup .NET`、`Surface core tests`；`surface` 的 `Setup .NET`、`Build the shell`、`Surface tests`）。没有任何具体行号或断言原文。

## 4. 两条判断

| 判断 | 裁决 | 依据 |
| --- | --- | --- |
| 补充段提供了基线通知里没有的具体失败定位（job/step/文件/日志原文），而不是把通知已有的字段换个说法重述 | **支持** | 22 个标识在通知里出现 0 次；通知 8 行里没有任何 job/step/文件字段 |
| 补充段指向的失败位置（job/step/文件）与材料里真实的失败位置一致，没有张冠李戴 | **支持** | 五条全部与 `failedJobs` / `changedFiles` 吻合，不一致 0、幻觉 0 |

第二条的效力有一个必须写明的限制：**五个 run 的失败位置完全同构**（都是 `test`/`Build and test` + `surface`/`Test the runtime`）。因此这只证明「模型没有说错」，不能证明「模型能在多个候选 job 里挑对」——那需要失败位置各不相同的材料。此限制已登记为未解释项 `u-uq502w`。

## 5. 幻觉计数与规则局限

- 幻觉定义：出现文件路径形态的标识，但在 `changedFiles` 与日志里都查不到。**五次都是 0。**
- `log-span` 里有两条是通用词而非定位：`38929605750` 的 `conclusion` 与 `failure 的`。已核查：日志里确有 `✔ a run that has not concluded carries no conclusion…` 和中文测试名 `…failure 的转变恰好产…`，所以它们是合法的逐字命中，只是**不含定位信息**。这说明本规则会把「引用日志里的常见词」也算成标识，`log-span` 计数偏高；`job`/`step`/`file` 三类不受影响。
- 规则本身写在 `score.mjs` 顶部，跑之前定稿，跑完没改。

## 6. 范围与不成立的推论

- **不是 §10.5 的 B 段独立验收。** 这五个 run 在 §13.12 / §13.16 用过（当时测形状与附加率），本报告只回答「在这五个材料上，补充段多说了什么」，不能作为「补充有价值」的验收结论。
- 只覆盖一个模型、一个端点、一批材料、一次温度 0 的调用。
- 不覆盖：失败位置各不相同的材料（见 `u-uq502w`）、补充段里的建议是否**可执行**（只判了定位是否真实，没判建议是否管用）、人工读通知后能否自己找到同样信息（没有对照的「人读完 8 行通知会怎么做」）。
- 耗时读数（125 902–166 807 ms）不能拿来谈预算，那是另一个实验的题目。

## 7. 读数缺陷

- 首轮 `38930952193` 在 175 889 ms 后报「模型补充：端点不可用 → 未附加」，之后用 `ONLY_RUN=38930952193` 补跑成功（147 241 ms）。`outputs.json` 里该 run 保留 `firstAttempt`，判分用补跑那次。与对抗实验的两次 502 同类，属端点偶发故障。
- 因此**实际附加率是 5/5，但首轮是 4/5**；报告不把「首次即成功」当作已证事实。

## 8. 复现

```bash
npm run build                      # 探针从 dist/ 导入
node experiments/ci-supplement-increment/probe-truth.mjs       # 五个 run 的材料与基线通知 → materials.json
node experiments/ci-supplement-increment/run-supplement.mjs    # 五次真调用 → outputs.json（--only=<runId> / --resume）
node experiments/ci-supplement-increment/score.mjs             # 判分 → score.json
```

`gh auth status` 需已登录（探针用 `gh auth token` 现取，不落盘）；端点需可达，否则耗时不可复现，但判分部分可离线复核。
