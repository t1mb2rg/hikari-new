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

### `poc-01-dsh-cordis/` — Hikari 只读领域能力能不能换个宿主，还要能被 Agent 自主调用

一次有界的只读实验，不是迁移。P1–P5 五项判据全部 PASS，产物与逐项证据在 `report.md`。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 八节：五项判定、领域实现复用边界、契约三档、DSH 集成成本、A/B/C 推荐、未覆盖项、复现 |
| `inventory.md` | 起点清单（候选插件、真实依赖链、三条路线预设） |
| `adapter.mjs` | 共享适配层：契约键编码、`services` 转发、`defer` 收集、`requires → inject`；不含任何领域判断 |
| `p1-cordis.mjs` / `p1-result.json` / `p1-cordis.md` | P1：四层插件在 Cordis 下装载，`peek`/`current` 三条语义与原 Runtime 一致 |
| `p2-lifecycle.mjs` / `p2-result.json` / `p2-lifecycle.md` | P2：卸载底层 provider 后依赖方 `waiting`≡`PENDING`，重装自动恢复，disposer 按逆序全执行 |
| `dsh-plugin.mjs` / `poc01.patch.yml` | 把 `peek()` 注册成 DSH 工具 `peek_desktop`，用官方 patch 层装载 |
| `p3-agent-tool.md` / `p3-session.jsonl` | P3：真模型在未预注入观察的任务下自主调用该工具并拿到真实读数 |
| `p4-session.md` | P4：`tool/call` → `tool/result` → 下一次推理，三段都在 session 事件里 |
| `poc01-p5.patch.yml` / `p5-boundary.md` / `p5-session.jsonl` | P5：patch 停用全部工具提供者，写文件任务被框架层拒绝，且不依赖提示词自律 |
| `dump-session.mjs` | `session.v4.jsonl.zstd`（多帧 zstd）→ 可读 jsonl |

**依赖仓库外环境**：需要单独安装的 `@deepseek-ai/dsh@0.2.1-rc.2` 与一个 DeepSeek key（只进环境变量）。`p1`/`p2` 不调模型，`p3`/`p5` 需要真 key。

### `poc-02-runtime-contract/` — 运行时契约还剩哪些没对位（事件面 / 契约键 / 服务拒绝语义）

PoC-01 证明「插件能换宿主装载」，这一轮只查**运行时契约**本身。五项判定：P1 PASS、P2 PASS（4 等价 + 1 需适配）、P3 PASS（限真实契约集）、**P4 FAIL**、P5 PASS。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 八节：五项判定、事件对照、键碰撞、拒绝语义、要重做的部分、复现、范围、下一步 |
| `inventory.md` | 三张表：事件面 E1–E7、服务解析 S1–S6、契约键 K1–K4，每行带 `文件:行号` |
| `collect-contracts.mjs` | 扫 `src/` 得到真实契约全集：**24 个 service（全 v1）+ 1 个 event** |
| `adapter-events.mjs` | 在 PoC-01 适配层上补事件桥接：`emit → ctx.parallel`、`on → ctx.on`、补 `AggregateError` message |
| `event-hikari.mjs` / `event-hikari.json` / `event-hikari.md` | s2：Hikari 侧五项语义基线（等待 831/790 ms、并发 314 ms、聚合消息逐字、退订 0、重装 1） |
| `event-cordis.mjs` / `event-cordis.json` / `event-cordis.md` | s3：Cordis 侧同名五项 + 逐项对照（823/793 ms、311 ms、message 需补、0、1） |
| `key-collision.mjs` / `key-collision.json` / `key-collision.md` | s4：真实 24 个键无碰撞；但编码函数不单射（点/连字符/下划线折叠），撞车时静默 `FAILED` |
| `service-reject.mjs` / `service-reject.json` / `service-reject.md` | s5：五场景两侧对照，**当前适配层放行 R1/R3/R4**；补检查后状态一致但错误对象丢失 |

**依赖仓库外环境**：与 `poc-01-dsh-cordis/` 相同（`@deepseek-ai/cordis@4.0.5` 随 DSH 装在隔离目录）。全部脚本**不调模型**，不需要 API key。

### `poc-03-contract-layer/` — 契约适配层能不能保住原 Runtime 的行为

PoC-02 说「不补适配层，五条纪律丢三条」，这一轮把那层补出来再验一遍。七条验收：**7 条全 PASS，其中 3 条带限定**（P3 五条纪律、P5 资源清理、P6 事件语义）。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 七节：五条结论、六步结果表、七条验收逐项、契约键单射性证明、错误可读接口三通道对照、复现条件、对路线 C 的意义与六条限制 |
| `contract-layer.mjs` | **本轮核心**：约 350 行的适配层，一个文件，含三层失败分离、五条 requires/provides 检查、契约键 codec、错误转存与 `getPluginError` |
| `error-channel.mjs` / `.md` / `.json` | s1：`internal/status` 只带 `(fiber, oldState)` 不带错误；`fiber.await()` 能 rethrow 原对象且可重复；适配层需转存 |
| `key-codec.mjs` / `.md` / `.json` | s2：`id@version` 单射可逆（Hikari 原生格式），25 真实键 + 13 构造用例 + 38 键合并全 0 碰撞 |
| `three-layers.mjs` / `.md` / `.json` | s3：定义 / 配置 / setup 三层，A(Hikari) 与 B(裸 Cordis) 与 C(契约层) 矩阵——裸宿主连 `config.parse` 都不调 |
| `discipline.mjs` / `.md` / `.json` | s4：R1–R5 五条纪律两侧对照，状态与错误消息逐字一致 |
| `rollback.mjs` / `.md` / `.json` | s5：setup 中途抛错后 Service 注销、Event 退订、卸载后重装 `active`，四项判据两侧全成立 |

**依赖仓库外环境**：与 `poc-02-runtime-contract/` 相同（`@deepseek-ai/cordis@4.0.5` 随 DSH 装在隔离目录，脚本可用 `DSH_ROOT` 指向别处）。全部脚本**不调模型**，不需要 API key。

### `poc-04-cascade-lifecycle/` — 级联生命周期与最终契约回归

Runtime 兼容性阶段的收口验证。七项判定：**六 PASS + 一限定 PASS，零 FAIL**。核心结论是 Cordis 的 `inject` 失效语义与 Hikari 的 `#deactivateTree` **在结果上等价、在过程上不等价**——Cordis 那条路不经过适配层的 `unloadPlugin`，所以适配层自维护的簿记必须能按宿主真实状态自愈。另外证实 `fiber.await()` 对依赖未满足的 PENDING 插件立即返回（0–1 ms），PoC-03 留下的「组合启动可能被卡住」这条风险排除。

| 文件 | 内容 |
| --- | --- |
| `report.md` | 十节：七项判定表、环境与可复现、级联状态序列、重激活读数、异步竞争与 PENDING 等待、Event 五项回归、部分初始化失败与 cleanup 抛错、本轮修的三处适配层缺陷、等价清单、未覆盖 |
| `cascade.mjs` / `cascade.json` | C1–C3：A→B→C 三级依赖 + 无关插件 D，装载 → 卸载 A → 重装 A 全过程状态与残留（Service 登记、订阅回调、计时器三列） |
| `race.mjs` / `race.json` | C4–C5：PENDING 装载不阻塞、迟到提供方自动激活、setup 中途 provider 消失 |
| `event-final.mjs` / `event-final.json` | 收口 A：用最终适配层重跑 Event 五项，5/5 |
| `partial-fail.mjs` / `partial-fail.json` | 收口 B：setup 部分初始化后抛错、cleanup 也抛错，两侧对照 |
| `run-all.sh` | 一键复现上述四组读数 + PoC-03 三个脚本回归 |

**本轮改了 `poc-03-contract-layer/contract-layer.mjs` 三处**（实测先失败、再修、再回归）：状态查询去掉缓存短路改为实时读 fiber、`providedBy` 加 `reconcile()` 自愈、cleanup 错误收集并按 Hikari 形状合成 `AggregateError`。三处都是「Cordis 会做的事不经过适配层」这一条根因的不同表现。

**依赖仓库外环境**：同 `poc-03-contract-layer/`（`DSH_ROOT` + `npm run build`）。脚本不调模型。

### `route-c-consolidation/` — 正常卸载时 cleanup 抛错：三方最小对照

收口阶段的一次补测（**不是新 PoC**，产物放在合并阶段目录下）。PoC-04 只覆盖了 setup 失败路径，正常卸载路径上 cleanup 抛错被 `unloadPlugin` 的 `try/catch {}` 吞掉，这一轮把它测掉。

结论：**资源回收三侧等价**（cleanup 各 1 次、定时器停、服务注销），但**清理异常的可观察性三侧都不成立**，而且原因不同——Hikari 是「记录随卸载一起消失」（`unloadPlugin` 在 `#tearDown` 后立即 `#plugins.delete(pluginId)`），Cordis 是「`dispose()` 吞掉 cleanup 错误」。级联停用路径上 Hikari 反而能读到合成的 `AggregateError`，所以这条契约是**路径相关**的，不是全局属性。

| 文件 | 内容 |
| --- | --- |
| `unload-cleanup.mjs` | 两个停用路径（显式卸载 / provider 消失导致级联停用）× 三侧（Hikari Runtime / Cordis 原生 / PoC-03 契约层） |
| `unload-cleanup.json` | 全部读数：cleanup 次数、定时器是否仍在跑、服务是否仍可解析、卸载后状态、错误是否可读 |
| `unload-cleanup.md` | 四项区分（资源回收 / 异常可观察性 / 原有契约 / 适配层缺陷）+ 影子状态自愈读数 |

**一条阅读警告**：第一版复用 `poc-02-runtime-contract/adapter-events.mjs` 做裸 Cordis 侧，量到「cleanup 0 次、定时器还在跑」——查因是那个适配层 `await def.setup(...)` 后**丢弃返回值**，而 Hikari 的「setup 返回 cleanup」正是靠返回值注册。这不影响 PoC-02 五项判定，但那个适配层的资源回收行为不可信。本目录已改用 Cordis 原生写法。

**依赖仓库外环境**：同 `poc-03-contract-layer/`（`DSH_ROOT` + `npm run build`）。脚本不调模型。

### `route-c-first-domain/` — 真实带配置与带写入的领域插件，在契约层下能不能跑

这一批把 PoC 阶段「全是只读、无配置的探针」这个缺口补上一半：两个**真实**的领域插件。

| 文件 | 内容 |
| --- | --- |
| `config-matrix.mjs` / `.json` / `.md` | 14 个配置输入 × 三侧（Hikari / 裸 Cordis / 契约层）。非法 12 例两侧拒绝且消息逐字相同；裸 Cordis 一个都没拦，其中两个非法 `rootDir` 还让插件带病 `ACTIVE` |
| `awareness-chain.mjs` / `.json` / `.md` | 真实五层 `requires` 链（`foreground` / `input-activity` → `world` → `awareness` → `loop`）的装载、级联停用与重激活；重装后事件间隔未减半，说明无残留定时器 |
| `human-delivery.mjs` / `.json` / `.md` | 第一个带真实副作用的插件：真建命名管道，三态投递（`delivered` / `failed` 5013 ms 真实写超时 / `unavailable`）全部走到，卸载后管道 `ENOENT`，重装可复用同名管道 |
| `report.md` | 三项判断裁决 + 「是否具备把适配层纳入 `src/` 的条件」的回答（不具备，缺 §4.4 裁决①）+ 未覆盖五项 |

同时纠正了 `docs/architecture/route-c-migration-prerequisites.md` 的两处错误：删掉「桌面感知四层之间没有 `requires` 链」（链真实存在三处），改写 §4.1 版本隔离的表述（版本隔离在编码层是保留的，不是「只剩标签」）。

**依赖 Windows**：`human-delivery` 依赖 Windows 命名管道；`config-matrix` 与 `awareness-chain` 会真实读取当前前台窗口，窗口标题随运行时刻变化属预期。脚本不调模型。

## 复现前提

- **GitHub 材料**：`gh auth status` 显示已登录（探针用 `gh auth token` 现取，不落盘）；脚本里写死的 run id 是本仓库历史上的真实红 run。
- **模型端点**：`192.168.1.20:8080` 上的 `qwen3.8-flash-next-iq2_xs`（OpenAI 形状）。**自 2026-10-26 起该端点要求 API key**，`cognition-continuity/` 的脚本只从环境变量 `MODEL_API_KEY` 读、不落盘、不进产物；更早的实验写于免鉴权时期。端点不在时，`report.md` 里的耗时读数不可复现，但结论的结构部分（真假边界、周期等式）仍可复核。
- **构建**：`npm run build` 先跑一次，探针从 `dist/` 导入。
- **Python 与仓库外材料**（仅 `galgame-reverse/`）：三个脚本需要 Python 3.12；解包对象是仓库外的一份 1.7 GB 安装目录，反编译产物（205 MB 树）也在仓库外，两者都未入库，路径写在该目录 `report.md` 的第 3 行与第 208 行。这决定了它**不能靠仓库本身复现**，只能复核已有文档里的行号引用。
- **DSH 与 API key**（仅 `poc-01-dsh-cordis/`、`poc-02-runtime-contract/`、`poc-03-contract-layer/`、`poc-04-cascade-lifecycle/`、`route-c-consolidation/` 与 `route-c-first-domain/`）：需要独立安装 `@deepseek-ai/dsh@0.2.1-rc.2`（约 305 个 `@deepseek-ai/*` 包）并把 `DSH_HOME` 指到隔离目录；PoC-01 的 `p3`/`p5` 需要 `DEEPSEEK_API_KEY`（只进环境变量，不落盘），PoC-02 / PoC-03 / PoC-04 与 `route-c-consolidation/` 全部脚本不调模型、不需要 key。Hikari 侧只需 `npm run build` 产出的 `dist/`。

## 读数的效力

每条读数在各自文档里都标了**有效范围**与**不证明什么**。两条纪律：

1. **调过提示词/协议的读数不能再用作独立验证**——只能写成「在同批材料上可用」。
2. **假端点的结论只覆盖管线行为，不覆盖模型行为**；真模型样本只覆盖测过的那些形式与那一个模型。
