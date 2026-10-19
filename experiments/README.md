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

## 复现前提

- **GitHub 材料**：`gh auth status` 显示已登录（探针用 `gh auth token` 现取，不落盘）；脚本里写死的 run id 是本仓库历史上的真实红 run。
- **模型端点**：`192.168.1.20:8080` 上的 `qwen3.8-flash-next-iq2_xs`（OpenAI 形状，无 key）。端点不在时，`report.md` 里的耗时读数不可复现，但结论的结构部分（真假边界、周期等式）仍可复核。
- **构建**：`npm run build` 先跑一次，探针从 `dist/` 导入。

## 读数的效力

每条读数在各自文档里都标了**有效范围**与**不证明什么**。两条纪律：

1. **调过提示词/协议的读数不能再用作独立验证**——只能写成「在同批材料上可用」。
2. **假端点的结论只覆盖管线行为，不覆盖模型行为**；真模型样本只覆盖测过的那些形式与那一个模型。
