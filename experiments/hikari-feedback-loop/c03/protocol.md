# C-03 · 历史证据利用受控对照实验协议（protocol，v2 冻结稿）

> 状态：fixtures 已搭建并通过 preflight（见 `preflight-report.md`），等待人类确认后才运行模型；**未经单独确认不进入正式实现**。
> 适用范围：只验证一个问题——*额外提供明确的历史检查范围，能否改善 Agent 对历史证据的利用*。不验证 Attention、不验证记忆系统、不改正式插件。

## 1. 假设

- **H1**：当 Agent 已有 Findings 与历史工具结果时，额外提供结构化的「历史检查范围」（路径 / 实际行范围 / 对应工具结果 / 内容摘要），会减少对已检查内容的无意义重读，并提高对历史证据的引用率。
- **H0**：检查范围摘要不改变后续行为；差异由模型随机性解释。
- 预先声明：如果 H1 成立，也**不能**直接推出「readscope 应进入正式插件」——只说明该信息对当前模型有用；是否进入生产由后续单独裁决。

## 2. 设计：2×2

| 条件 | 历史 | 检查范围摘要 | 文件状态 |
|---|---|---|---|
| A1 | 有 Findings + 完整历史 | 无 | 不变 |
| B1 | 有 Findings + 完整历史 | 有（`hikari-readscope-v2`） | 不变 |
| A2 | 有 Findings + 完整历史 | 无 | 在两次观察之间真实修改文件 |
| B2 | 有 Findings + 完整历史 | 有 | 在两次观察之间真实修改文件 |

- **自变量**：检查范围摘要（有/无）× 文件是否变化（不变/变化）。
- **因变量**：重复读取次数与范围、新读取、对 Finding/历史结果的引用、调查终止理由、Step 数、Token 量。
- **A2/B2 的作用**：防止「摘要让模型跳过必要重新检查」——文件变化后，正确行为是重新检查被修改的部分；如果 B2 因为摘要而跳过，即为负效应。

## 3. 历史前缀与隔离

**历史前缀构造**：每个条件使用独立 Session，从零开始，由 replay 插件重放**同一组固定事件**（同一窗口事件序列、同一任务文本、同一模型参数、同一工具集）。模型在新 session 中自主产生 Findings 与工具调用。

**为什么不是逐字节相同的历史**：DSH 没有公开的「从既有 Session 派生实验副本」接口（`sessions.fork` 需要源 Session 已在内存中，且会让 agent-loop 的启动顺序与插件 apply 顺序冲突）；为 `fork` 改启动流程超出本轮授权。因此本实验提供的隔离度是：

- 相同输入事件序列（相同 replay 输入）
- 相同起始状态（空 session、空 World、相同工具集）
- 相同工作区副本（见下）
- 模型输出差异作为实验噪声，由重复次数与交错顺序抵消

**工作区副本**：`c03/fixtures/` 下四个独立副本 `ws-a1` / `ws-b1` / `ws-a2` / `ws-b2`，由 `c03/tools/make-fixtures.mjs` 幂等生成（同一基线 `ws-base`，各自 `git init` 并提交一次基线提交）。每个条件启动前确认副本干净；A2/B2 由 `hikari-mutate` 在 turn 3 结束后原子改写 `docs/notes/handoff.md`（内容为项目化决定日志，无实验词汇，只改写一次）。重建脚本会重写 `ws-*`，因此**四组必须在同一次重建内完成**。

**独立 Session / 实例**：每个条件独立 `sessionId`（`session-hikari-c03-a1` 等）、独立 `--patch` 覆盖、独立端口（a1=3091、b1=3092、a2=3093、b2=3094），实验实例与正式 3080 完全隔离；正式 `cordis.patch.yml`、`world/findings.js`、`readscope/index.js` 一律不改。`hikari-trace` 的输出路径由每个条件的 `C03_TRACE_PATH` 提供，运行时必须逐条件设置。

**交错顺序**：A1 → B1 → A2 → B2 → A1 → B1 → …（每轮循环一次），避免「先跑的条件吃掉时间/资源趋势」。

**重复**：每条件 ≥ 3 次；若同条件 3 次结果方差过大（重复读取次数极差 > 50%），补跑至 5 次。

## 4. 材料与工具

| 材料 | 用途 |
|---|---|
| `hikari-native/trace` | 记录每次 `llm/stream` 的完整请求（messages/tools/toolHistory），事后核查「历史是否进入请求」 |
| `hikari-native/readscope-v2` | B 组注入检查范围摘要（中性、无指令、无禁止重读措辞；只收成功且精确配对的读取） |
| `hikari-native/mutate` | A2/B2 在 turn 3 后真实改写目标文件（原子写、只一次、忽略其他 session） |
| `c03/tools/tool-evidence.mjs` | 配对 call/result、分类成功/拒绝/错误/未配对、反推行范围、校验 Finding evidence |
| `c03/tools/make-fixtures.mjs` | 幂等生成四个工作区副本、四个 patch、固定 replay 事件 |
| `c03/tools/preflight.mjs` | 16 项隔离/一致性检查 |
| `c03/tools/verify-mutation.mjs` | 在真实副本上验证「文件变化」条件 |
| `c03/tools/extract-samples.mjs` | 从 session 提取各类真实样例 |
| `c03/tools/tool-evidence.test.mjs` | 取证逻辑单测（15/15） |
| `hikari-native/replay` | 重放固定窗口事件（四组共用 `fixtures/events/replay.json`） |

## 5. 采集指标

每次运行记录：

1. **历史证据可见性**：请求中 tool 消息数、`tool/result` 条数、Finding 上下文条数、system 字符数。
2. **重复读取**：同一 `path` 且 `offset` 区间（含 limit）在历史前缀中已成功读取、且文件未变化的读取次数。
3. **新读取**：历史中未出现过的路径/区间。
4. **调查理由**：从 assistant reasoning 中提取「为什么读」（是否引用历史结果、Finding、检查范围）。
5. **证据利用**：新写入 Finding 的 evidence 是否能精确指向本次运行中的真实 `callId`（用 `resolveFindingEvidence` 校验）。
6. **变化发现**（A2/B2）：文件变化后是否重新读取被修改部分，以及在第几个 step 发现。
7. **Step / Token**：每 turn 的 step 数、请求字符量。

## 6. 判定规则（冻结）

1. **正向效果**：B1 的「重复读取次数」在至少 2/3 次运行中低于 A1，且差值不能被「B 组新读取更多」解释（新读取与重复读取分开统计）。
2. **无跳过代价**：B2 在文件变化后必须重新读取被修改范围（至少 1 次），且 B2 的「错误结论」（把未检查当已检查）为 0。
3. **可见性对照**：A/B 两组的「历史证据可见性」指标应基本一致（同一 replay 前缀、同一模型）；若 systemChars 差异 > 20%，需在报告中单独说明摘要带来的上下文长度效应。
4. **证据利用**：B 组新 Finding 的 evidence 精确率（`resolveFindingEvidence` 判为 `resolved` 的比例）不低于 A 组。
5. **结论门槛**：只有 1–4 同时满足，才可得出「检查范围摘要改善历史证据利用」的初步结论；否则报告为「未观察到稳定改善」或「观察到负效应」，并如实记录。

## 7. 技术限制

1. **历史非逐字节相同**：见 §3；模型生成的历史内容因随机性不同。
2. **上下文长度差异**：B 组多一段摘要（预计 300–800 字符），可能单独影响行为；用 §6.3 检查。
3. **时间成本**：每条件每轮 3–5 个 turn，12 次运行约 2–3 小时；实验实例可复用，但每个条件必须新 session。
4. **模型随机性**：同一条件重复 3 次仍可能不足；若方差大，按 §3 补跑。
5. **工作区副本**：`project_status` 依赖 git 状态；副本必须 `git init` 并提交一次基线，否则工具返回错误（记录在报告中）。
6. **只测 read**：检查范围摘要只覆盖 `read` 工具；`grep` / `glob` / `project_status` 不在摘要内（取证工具的限制）。
7. **正式插件未改**：`readscope-v2` 是实验插件，不进入 `cordis.patch.yml`；即使 H1 成立也不自动进生产。

## 8. 交付物

| 路径 | 内容 | 状态 |
|---|---|---|
| `c03/tool-evidence-fix.md` | 取证缺陷 → 修正 → 真实三态样例 | 完成 |
| `c03/tools/tool-evidence.mjs` | 配对/分类/范围反推/证据校验 | 完成 |
| `c03/tools/tool-evidence.test.mjs` | 15 用例 | 完成（15/15） |
| `c03/tools/extract-samples.mjs` | 从 session 提取样例 | 完成 |
| `c03/analysis/samples-fb2.json` | fb2 真实样例（92 success / 1 denied） | 完成 |
| `c03/protocol.md` | 本协议 | 完成（v2，待审阅） |
| `c03/preflight-report.md` | fixtures 清单、隔离证明、配对测试、文件变化验证、限制 | 完成（待审阅） |
| `c03/fixtures/` | 四组工作区副本、四个 patch、固定 replay 事件、README | 完成（`ws-*` 为运行产物，不提交） |
| `hikari-native/readscope-v2/index.js` | 实验插件（B 组用） | 完成，未启用 |
| `hikari-native/mutate/index.js` | 实验插件（A2/B2 用） | 完成，未启用 |
| `c03/captures/`、`c03/analysis/`、`c03/report.md` | 运行记录、分析、结论 | 第三阶段（待授权） |

## 9. 停止点

fixtures 搭建与 preflight 完成后停止，等待人类确认。确认后才开始运行模型：按 §3 启动四组实例，按 §4 运行，按 §5 采集，按 §6 判定，产出 `c03/report.md`。**报告须区分：直接观察事实 / 实验推论 / 未确定解释。**
