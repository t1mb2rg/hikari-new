# experiments

可复现的实验材料与结果。这里的东西**不是产品代码、不进 CI**，但入库——没有记录的读数等于没有读数。

入库前按下面的脱敏规则审查过；违反规则的文件不提交。

## 脱敏规则

**不提交**：

- 任何 token、凭据、认证头（`gh[pousr]_*`、`github_pat_*`、`Authorization: Bearer <值>`）；
- 含凭据的环境文件（`.env`、导出的 shell 环境快照）；
- 未经审查的完整敏感日志（被诊断仓库的原始日志全文）；
- 大量无必要的模型原始输出（只留与结论相关的片段）；
- 临时缓存与中间产物（`node_modules`、构建输出、`*.tmp`）。

**脚本里的凭据只以读取方式出现**：`execSync('gh auth token')` 或 `process.env.*`，值不进文件、不进日志、不进 `console.log`。

## 目录

### `ci-supplement-product-path/` — 补充模块在产品路径上的耗时

测「180 000 ms 预算在真实 attention 周期下够不够」。真 Runtime、真 attention 周期、真 supplement 插件、真 GitHub 材料、真模型端点；假的是观察来源（回放历史 run）、speaking、投递、chronicle。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 结论与分解表：五轮 cycle 的耗时、周期等式、历史样本对照、真假边界、未覆盖部分 |
| `cycle-probe.mjs` | 探针（跑完自停） |
| `cycle-log.json` | 最后一轮批次的原始事件（批次 A 的一手记录在 `run-2026-10-18-two-cycles.log`） |
| `run-2026-10-18-two-cycles.log`、`run-2026-10-19-three-cycles.log` | 两批的时序日志原文 |
| `probe-materials.mjs`、`real-materials.json` | 单独测材料读取耗时与材料形状（不含日志正文，只有字节数与字符数） |

### `ci-supplement-increment/` — 模型补充相对基线通知多说了什么

| 文件 | 内容 |
| --- | --- |
| `report.md` | 五个 run 的逐条定位判定、22 个标识的对照表、幻觉与规则局限、范围 |
| `probe-truth.mjs` | 取真值：五个 run 的失败 job/step、changedFiles、`log.step`、8 行基线通知 → `materials.json` |
| `run-supplement.mjs` | 五次真调用（真 supplement 模块 + 真材料 + 真端点）→ `outputs.json` |
| `score.mjs`、`score.json` | 判分规则（写死在文件顶部）与逐项明细 |

### `ci-log-adversarial/` — Q1 隔离之后，日志内的指令在真实模型上还会不会被服从

| 文件 | 内容 |
| --- | --- |
| `report.md` | 四类注入 × 3 次的计数、逐条模型输出原文、两条判断的裁决、Q2 建议、范围与不证明什么、读数缺陷 |
| `samples.json` | 冻结件：4 类注入正文 + 对照、插入位置、四项判定的机械规则（写于任何模型调用之前） |
| `adversarial-probe.mjs` | 探针：真 `attach()` 发请求，假端点抓包后原样转发真端点，因此既跑真校验链又拿到模型原始输出 |
| `results.json` | 15 次调用：原始输出、cited、四项判定、上游错误 |
| `run-full.log`、`run-resume3.log` | 第一批与补齐批的运行输出 |

### `ci-log-untrusted-input/` — CI 日志作为不可信输入的边界

| 文件 | 内容 |
| --- | --- |
| `boundary.md` | 审出的边界、四类注入的阻断矩阵、最小机制方案、待裁问题、**落地后的确切保证（§0.1）**与落地记录（§6） |
| `code-path.md` | 日志进入请求的 12 环逐行路径（每环带 `文件:行号`） |
| `injection-probe.mjs` | 注入探针（真实 supplement 模块 + 假端点确定性回显） |
| `injection-result.json` | 四类注入的放行/阻断读数 |

### `cognition-responsibility/` — 认知职责审查的原始记录

配套 `docs/architecture/cognition-responsibility-review-v0.md`。只读源码，不含模型调用。

| 文件 | 内容 |
| --- | --- |
| `s1-authorities.md` | 四个判断模块（CI Relevance / Diagnosis Proposal / CI Attention / Desktop Return Attention）的权利表，逐行标注事实判定 / 重要性判断 / 行动授权与 `文件:行号` |
| `s2-language.md` | Language 层能自主与不能自主的边界、能力暴露边界、全仓库模型调用点穷举、`repository-change-executor` 的第二条模型循环 |
| `s3-chronicle.md` | 六个事实家族的读取通路、必须留在原 owner 的四项责任、四项可作材料但未进入模型的 |

### `cognition-control-round2/` — 最后一轮四组对照：换成不自证原因的失败场景

承接 `cognition-control/`。上一轮的 run 日志里直接写着「真机实验：故意失败」，M0 组饱和，结论应改判为「在该场景无法区分」。本轮换成 run `34752988729`（`Setup Node` 缺 lock file，日志只给症状、不给处置方向）。

**结论：相关历史只改变了一处——候选介入里多出「把 lock 生成提前到 cache 之前、调整 workflow 顺序」，并配了对应时序推理；复查优先级（三组首位都是 Setup Node 日志）与语义判断没变。同形态但无关的历史只带来通用排查项。三组都没有把历史读成「已解决」。**

| 文件 | 内容 |
| --- | --- |
| `report.md` | 九节：结论、样本选择理由、四组设置、五维逐条比对（含原文）、C1–C6 结果表、两条判断裁决、对上轮结论的效力修正、不证明什么、读数缺陷与复现 |
| `samples.json` | 冻结件：四组完整消息、两条历史材料（`materialKind: experimental` + provenance）、C1–C6、`frozenAt` |
| `outputs.json` | 四组记录（R 组 `modelCalled: false`）+ C1–C6 逐项判定 |
| `c2-tokens.json` | C2 的事后 token 级核验（原「逐字匹配」规则跨语言不可用，52 条 facts 零编造） |
| `freeze.mjs` | 冻结脚本：抓产品真实请求体，不调真模型；R 组用真 `judgeProposal` |
| `run.mjs` | 三组真调用，每组一次，不重试 |
| `assess.mjs` | C2 的补充核验脚本 |

### `cognition-control/` — 一次最小四组对照：相关行动历史会不会改变开放认知判断

配套 `docs/architecture/cognition-responsibility-review-v0.md` §7（按 Human 裁决重写的四组设计）。**本轮结论：两条判断均被推翻，但只在一个在对照组上已饱和的场景内成立**——详见 `report.md` §6.1。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 八节：四组判断原文、判据结果表、两条判断的裁定、失败样本节（无）、范围与限制、对 Q2 的意义、复现 |
| `samples.json` | 冻结文件：四组完整消息、两条历史材料（标注 `materialKind: experimental`）、判据 C1–C4、`frozenAt` |
| `outputs.json` | 四组原始回答（R 组 `modelCalled: false`）+ C1–C4 逐项结果 |
| `freeze.mjs` | 冻结脚本：起本地假端点抓产品真实请求体，不调真模型；R 组用真 `judgeProposal` 计算 |
| `run.mjs` | 三组真调用，每组一次，不重试 |
| `score.mjs` | 按冻结判据打分，规则写死在文件顶部 |

### `ci-supplement-triangulate/` — 三组对照：模型补充相对零模型机械摘要还有没有增量

| 文件 | 内容 |
| --- | --- |
| `report.md` | 三组对比表、逐 run 增量判定、范围限制、九节 |
| `samples.json` | 冻结件（选定理由、失败形态、抽取规则、判据） |
| `candidates.json`、`probe-candidates.mjs` | 六个未用 run 的只读筛选（取了 5 个） |
| `digest.mjs`、`groups.mjs`、`groups.json` | 零模型机械摘要的三条规则与 A/B 两组内容 |
| `markers.mjs`、`score.mjs`、`summary.json` | 标识提取、判分与逐项明细 |
| `run-supplement.mjs`、`results.json` | 五次真调用与三组内容 |

### `cognition-continuity/` — 模型能不能自己形成一个信息需求，并在下一次独立调用里接住它

| 文件 | 内容 |
| --- | --- |
| `report.md` | 九节：结论、冻结项与一处预算修订、三次调用读数、T1 记录原文、A/B 逐字段对照、C1–C4、延续 vs 复述、失败定位、范围与不证明什么 |
| `samples.json` | 冻结件（`frozenAt=2026-10-26T15:51:04.408Z`）：T1 材料全文、T2 新事实全文与来源、三段提示词、模型与端点、C1–C4 与推翻条件 |
| `gen-samples.mjs` | 冻结脚本：`execFileSync` 现读 `git`、`experiments/` 目录、README 段落、`clear/goals/*.md`；不调模型 |
| `t1.mjs`、`t1.json` | T1 一次调用；`structured` 是模型 `content` 直接解析，无字段补写 |
| `t2.mjs`、`outputs.json` | T2-A（带 T1 记录）与 T2-B（不带）各一次调用，附 `identicalPrefix`、`bHasNoRecord` 两条断言 |
| `outputs-round1-truncated.json` | 首轮原始记录：`max_tokens=2000` 使 T2-A 截断（`content=null`），留作方法缺陷证据，未覆盖 |

### `galgame-reverse/` — 一款 AI Galgame 的人格、主动行为、文件读取与记忆是怎么实现的

**依赖仓库外材料，本目录里的脚本不能只靠仓库复现**（见「复现前提」第四条）。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 七节：技术栈与解包清单、五条路径调用链、A/B/C 三问、模型决定 vs 预设脚本、可借鉴、无法确认、合规声明 |
| `inventory.md`、`model-chain.md`、`trigger-chain.md`、`file-access.md`、`memory.md` | 技术栈判定与四条路径的独立调用链表（每行带 `文件:行号` 与置信度） |
| `rpa_tool.py` | RPA-3.0 只读解包（`list` / `stat` / `extract --only=.ext --max-mb=N`） |
| `dump_rpyc.py` | `RPA-3.0` → Ren'Py RPC2 `.rpyc` 反编译器，还原 AST 与 Python 块 |
| `extract_code.py` | 批量导出可读 Python（`src/<module>.py.txt`） |

## 复现前提

- **GitHub 材料**：`gh auth status` 显示已登录（探针用 `gh auth token` 现取，不落盘）；脚本里写死的 run id 是本仓库历史上的真实红 run。
- **模型端点**：`192.168.1.20:8080` 上的 `qwen3.8-flash-next-iq2_xs`（OpenAI 形状）。**自 2026-10-26 起该端点要求 API key**，`cognition-continuity/` 的脚本只从环境变量 `MODEL_API_KEY` 读、不落盘、不进产物；更早的实验写于免鉴权时期。端点不在时，`report.md` 里的耗时读数不可复现，但结论的结构部分（真假边界、周期等式）仍可复核。
- **构建**：`npm run build` 先跑一次，探针从 `dist/` 导入。
- **Python 与仓库外材料**（仅 `galgame-reverse/`）：三个脚本需要 Python 3.12；解包对象是仓库外的一份 1.7 GB 安装目录，反编译产物（205 MB 树）也在仓库外，两者都未入库，路径写在该目录 `report.md` 的第 3 行与第 208 行。这决定了它**不能靠仓库本身复现**，只能复核已有文档里的行号引用。

## 读数的效力

每条读数在各自文档里都标了**有效范围**与**不证明什么**。两条纪律：

1. **调过提示词/协议的读数不能再用作独立验证**——只能写成「在同批材料上可用」。
2. **假端点的结论只覆盖管线行为，不覆盖模型行为**；真模型样本只覆盖测过的那些形式与那一个模型。
