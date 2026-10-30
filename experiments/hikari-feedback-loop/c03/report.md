# C-03 实验报告：历史证据利用的受控对照实验

> 状态：r01–r12 全部运行完成（2026-10-30 20:21–21:07），报告停在审阅点，不进入 C-04。
> 证据位置：`c03/captures/`（原始 session 日志、trace jsonl、meta、运行日志，本地保留未覆盖）、`c03/analysis/runs.json`（归一化记录）。
> 采集脚本：`c03/tools/run-one.mjs`（逐次运行）、`c03/tools/collect-c03.mjs`（归一化 + 逐次统计）。

## 0. 摘要

- **12 次运行全部有效**（4 条件 × 3 重复，交错顺序 ABAB×3），每次 4 个 turn、独立 Session/工作区/trace、端口 3091–3102 串行占用后释放。
- **B2 硬门槛 3/3 通过**：r04、r08、r12 在 turn 4 都有成功的 `read docs/notes/handoff.md`，返回内容含 `## 4. Decision log` 与 `dedupeKey`（seq 133 / 154 / 131，callId 精确配对）。
- **A2 也 3/3 重读了变化文件**（seq 213 / 154 / 154）：文件变化本身足以触发重新检查。
- **检查范围摘要没有带来稳定的重复读取下降**：B1 重复读取均值 3.0 vs A1 3.67，但逐对比较只有 1/3 次严格更低，未达 protocol §6.1 的「至少 2/3 次低于」；B2 4.0 vs A2 4.67，同样只有 1/3 严格更低、2/3 相等。
- **观察到 B 组调查更收敛的迹象，但也观察到更少验证**：B2 的 step 数（16/18/15）全部低于 A2（27/20/20），finding 数（5/6/5）也低于 A2（18/5/6）；唯一的 tool-evidence 出现在 A2（9 条，8 条可解析为成功证据），B1/B2 为 0。
- 结论按 protocol §6.5 判定为：**未观察到检查范围摘要对重复读取的稳定改善**，并如实记录上述次要观察。

**分类标记**：`[事实]` 直接可复现的观测；`[推论]` 由观测推出但未独立验证；`[未确定]` 无法从本实验回答。

## 1. 方法

- 设计、隔离、指标、判定规则见 `c03/protocol.md`（v3 冻结稿）；本报告只记录执行与结果。
- 12 次运行：`CONDITION_CYCLE = a1,b1,a2,b2` 三轮交错（r01=a1、r02=b1、r03=a2、r04=b2、…、r12=b2）；每次独立 session（`session-hikari-c03-NN`）、独立工作区副本（`%TEMP%\workbench\ws-NN`，仓库外）、独立 trace 文件、独占端口。
- 输入前缀：共用同一份 `fixtures/events/replay.json`（4 条窗口切换），A/B 唯一差别是 `hikari-readscope-v2` 是否插入；条件 2（A2/B2）额外 `hikari-mutate`，在 turn 3 结束后把项目化的决定日志写入 `docs/notes/handoff.md`。
- 采集：session 日志（多帧 zstd 解压）+ `hikari-trace` 捕获的每次 `llm/stream` 请求；read 范围由 `tool-evidence` 的 callId 精确配对 + 返回行号反推。

## 2. 逐次记录

统一说明：`reads` = 成功 read 调用；`repeat` = 与更早一次成功 read 行范围重叠的 read；`ctxReq` = trace 中含 Finding 上下文的请求数；`scopeReq` = trace 中含 readscope 文本的请求数；`recheck` = turn 4 后成功读取变化文件的证据。

### r01 — A1（a1，session-hikari-c03-01，ws-01，端口 3091）
1. **Session 与条件**：4 turn、16 step、146 事件、142 秒；无 readscope、无 mutate。
2. **Finding 变化**：6 条记录、6 个唯一 id，全部 open/model-claim（未推进）。
3. **工具与重复读取**：8 次成功 read、3 次重复（handoff.md ×2、store.js ×1）；覆盖 handoff/pipeline/store/test/README。
4. **检查范围摘要利用**：无（A 组）。
5. **文件变化后重查**：不适用。
6. **无效样本**：无。
7. **备注**：turn 1–4 都关闭在「无值得行动的变化」，是 A1 组最安静的一次。

### r02 — B1（b1，session-hikari-c03-02，ws-02，端口 3092）
1. **Session 与条件**：4 turn、20 step、183 事件、135 秒；有 readscope。
2. **Finding 变化**：5 条记录、5 唯一，全部 open/model-claim。
3. **工具与重复读取**：12 次成功 read、3 次重复（handoff.md ×2、store.js ×1）；新读了 package.json、.gitignore、`logs/HEAD`（git 内部文件）。
4. **检查范围摘要利用**：17 个请求含 readscope 文本；首个摘要段 856 字符，最大 1817。
5. **文件变化后重查**：不适用。
6. **无效样本**：无。
7. **备注**：读取面比 A1 宽（`.git` 内部也读），但重复读取与 A1 相同。

### r03 — A2（a2，session-hikari-c03-03，ws-03，端口 3093）
1. **Session 与条件**：4 turn、27 step、251 事件、195 秒；有 mutate、无 readscope。
2. **Finding 变化**：18 条记录、9 唯一：f-001/002/004/005/006/007/008/009 由 open→confirmed（tool-evidenced），f-003 open→refuted（tool-evidenced）；每条都是同一 findingId 的完整状态演进，不是重复登记。
3. **工具与重复读取**：10 次成功 read、3 次重复（handoff.md ×2、store.js ×1）；step 数显著高于其他运行（27）。
4. **检查范围摘要利用**：无（A 组）。
5. **文件变化后重查**：turn 4 成功 read handoff.md（seq 213，call_01_oCcqUy4mYyDJ32f4aNrB8881），读到 `## 4. Decision log`，随后集中复核 pipeline/store 并更新 9 条 finding。
6. **无效样本**：无。
7. **备注**：文件变化触发了一次完整验证，是 12 次里最深入的一次；18 条记录是 9 条 finding ×2 次状态演进，计数上需注意。

### r04 — B2（b2，session-hikari-c03-04，ws-04，端口 3094）
1. **Session 与条件**：4 turn、16 step、154 事件、141 秒；有 mutate + readscope。
2. **Finding 变化**：5 条记录、5 唯一，全部 open/model-claim。
3. **工具与重复读取**：9 次成功 read、3 次重复（handoff.md ×2、store.js ×1）。
4. **检查范围摘要利用**：14 个请求含 readscope 文本；首段 956 字符，最大 2369。
5. **文件变化后重查**：turn 4 成功 read handoff.md（seq 133，call_00_RcLu6TVe65v2vGEv4ugX2103），读到 Decision log；**硬门槛通过**。
6. **无效样本**：无。
7. **备注**：发现变化后没有像 r03 那样展开验证，finding 停留在 open。

### r05 — A1（a1，session-hikari-c03-05，ws-05，端口 3095）
1. **Session 与条件**：4 turn、17 step、154 事件、135 秒。
2. **Finding 变化**：4 条记录、4 唯一，全部 open/model-claim。
3. **工具与重复读取**：10 次成功 read、3 次重复（handoff.md ×2、store.js ×1）。
4. **检查范围摘要利用**：无。
5. **文件变化后重查**：不适用。
6. **无效样本**：无。
7. **备注**：读取结构与 r01 几乎相同。

### r06 — B1（b1，session-hikari-c03-06，ws-06，端口 3096）
1. **Session 与条件**：4 turn、19 step、185 事件、162 秒；有 readscope。
2. **Finding 变化**：9 条记录、9 唯一，全部 open/model-claim（登记更多，但未推进）。
3. **工具与重复读取**：9 次成功 read、3 次重复（handoff.md ×2、store.js ×1）。
4. **检查范围摘要利用**：16 个请求含 readscope；首段 856 字符，最大 2165。
5. **文件变化后重查**：不适用。
6. **无效样本**：无。
7. **备注**：finding 多但都停在 open，与 B1 的「先登记再判断」倾向一致。

### r07 — A2（a2，session-hikari-c03-07，ws-07，端口 3097）
1. **Session 与条件**：4 turn、20 step、177 事件、138 秒；有 mutate。
2. **Finding 变化**：5 条记录、5 唯一，全部 open/model-claim。
3. **工具与重复读取**：13 次成功 read、6 次重复（handoff.md ×3、pipeline ×1、store ×2、test ×1）。
4. **检查范围摘要利用**：无。
5. **文件变化后重查**：turn 4 成功 read handoff.md（seq 154，call_01_YpGbmLOZolONmf95kye20887），读到 Decision log。
6. **无效样本**：无。
7. **备注**：重复读取为 12 次里最高之一，但 finding 全部停留在 open。

### r08 — B2（b2，session-hikari-c03-08，ws-08，端口 3098）
1. **Session 与条件**：4 turn、18 step、173 事件、135 秒；有 mutate + readscope。
2. **Finding 变化**：6 条记录、6 唯一，全部 open/model-claim。
3. **工具与重复读取**：10 次成功 read、4 次重复（handoff.md ×2、pipeline ×1、store ×1）。
4. **检查范围摘要利用**：16 个请求含 readscope；首段 856 字符，最大 1980。
5. **文件变化后重查**：turn 4 成功 read handoff.md（seq 154，call_01_sak0D0xbv3d7tB5B3wBV0066），**硬门槛通过**。
6. **无效样本**：无。
7. **备注**：与 r04 结构相似。

### r09 — A1（a1，session-hikari-c03-09，ws-09，端口 3099）
1. **Session 与条件**：4 turn、16 step、150 事件、150 秒。
2. **Finding 变化**：4 条记录、4 唯一，全部 open/model-claim。
3. **工具与重复读取**：12 次成功 read、5 次重复（handoff.md ×3、pipeline ×1、store ×1）。
4. **检查范围摘要利用**：无。
5. **文件变化后重查**：不适用。
6. **无效样本**：无。
7. **备注**：A1 组重复读取最多的一次（5 次，handoff.md 读了 3 次）。

### r10 — B1（b1，session-hikari-c03-10，ws-10，端口 3100）
1. **Session 与条件**：4 turn、17 step、153 事件、144 秒；有 readscope。
2. **Finding 变化**：2 条记录、2 唯一，全部 open/model-claim。
3. **工具与重复读取**：9 次成功 read、3 次重复（handoff.md ×2、store ×1）。
4. **检查范围摘要利用**：14 个请求含 readscope；首段 856 字符，最大 1683。
5. **文件变化后重查**：不适用。
6. **无效样本**：无。
7. **备注**：finding 最少的一次（2 条）。

### r11 — A2（a2，session-hikari-c03-11，ws-11，端口 3101）
1. **Session 与条件**：4 turn、20 step、180 事件、150 秒；有 mutate。
2. **Finding 变化**：6 条记录、6 唯一，全部 open/model-claim；另有 file 证据 11 条。
3. **工具与重复读取**：11 次成功 read、5 次重复（pipeline ×2、handoff.md ×2、store ×1）。
4. **检查范围摘要利用**：无。
5. **文件变化后重查**：turn 4 成功 read handoff.md（seq 154，call_01_1RHsCeQJIGzr41KcUPc41351），读到 Decision log。
6. **无效样本**：无。
7. **备注**：与 r07 接近。

### r12 — B2（b2，session-hikari-c03-12，ws-12，端口 3102）
1. **Session 与条件**：4 turn、15 step、152 事件、147 秒；有 mutate + readscope。
2. **Finding 变化**：5 条记录、5 唯一，全部 open/model-claim。
3. **工具与重复读取**：10 次成功 read、5 次重复（handoff.md ×2、store ×1、pipeline ×1、test ×1）。
4. **检查范围摘要利用**：13 个请求含 readscope；首段 850 字符，最大 2220。
5. **文件变化后重查**：turn 4 成功 read handoff.md（seq 131，call_01_8ngx2f7WWnSb4grado8P0753），**硬门槛通过**。
6. **无效样本**：无。
7. **备注**：step 最少的一次（15）。

## 3. 对照统计

### 3.1 重复读取与调查规模

| 条件 | 运行 | reads | repeat | steps | findings（记录/唯一） |
|---|---|---|---|---|---|
| A1 | r01/r05/r09 | 8 / 10 / 12（均值 10.0） | 3 / 3 / 5（均值 3.67） | 16 / 17 / 16（16.3） | 6/6、4/4、4/4 |
| B1 | r02/r06/r10 | 12 / 9 / 9（10.0） | 3 / 3 / 3（3.0） | 20 / 19 / 17（18.7） | 5/5、9/9、2/2 |
| A2 | r03/r07/r11 | 10 / 13 / 11（11.3） | 3 / 6 / 5（4.67） | 27 / 20 / 20（22.3） | 18/9、5/5、6/6 |
| B2 | r04/r08/r12 | 9 / 10 / 10（9.67） | 3 / 4 / 5（4.0） | 16 / 18 / 15（16.3） | 5/5、6/6、5/5 |

**逐对判定（B 是否严格低于 A）**
- B1 vs A1：r02 3 vs r01 3（相等）、r06 3 vs r05 3（相等）、r10 3 vs r09 5（低）→ 1/3 严格更低。
- B2 vs A2：r04 3 vs r03 3（相等）、r08 4 vs r07 6（低）、r12 5 vs r11 5（相等）→ 1/3 严格更低。

`[事实]` 均值上 B 略低（B1 3.0 vs 3.67；B2 4.0 vs 4.67），但逐对比较达不到 protocol §6.1 的「至少 2/3 次严格低于」。

`[事实]` 重复读取集中在 `docs/notes/handoff.md` 与 `src/store.js`——12 次运行中 11 次重复 handoff.md、12 次重复 store.js。

### 3.2 检查范围摘要的实际利用

- `[事实]` B 组 6 次运行中，含 readscope 文本的请求数为 17/16/14/14/16/13；readscope 从 turn 2 起出现（turn 1 尚无读取记录）。
- `[事实]` readscope 段长度：首段 850–956 字符，最大 1683–2369 字符；运行时上下文基线 728 字符，因此 B 组后续请求的运行时上下文约 1.6–3.1K 字符。
- `[事实]` 首请求（turn 1 首次）的两组可见性完全相同：system 3423 字符 + runtime context 728 字符 = 4151 字符。

### 3.3 文件变化后的重新检查

- `[事实]` A2：r03 seq 213、r07 seq 154、r11 seq 154，全部 turn 4 成功读取 handoff.md 并读到 `Decision log`。
- `[事实]` B2：r04 seq 133、r08 seq 154、r12 seq 131，全部满足硬门槛。
- `[事实]` 两组都发现并重读了变化文件；差异不在「是否重读」，而在重读之后的动作：A2 的 r03 展开为 9 条 finding 的完整验证，B2 则停在 open。

### 3.4 证据精确率

| 条件 | 记录数 | tool-result 证据 | 可解析为成功证据 | 精确率 |
|---|---|---|---|---|
| A1 | 14 | 0 | 0 | 不可计算（无证据） |
| B1 | 16 | 0 | 0 | 不可计算 |
| A2 | 29 | 9 | 8 | 8/9 = 89% |
| B2 | 16 | 0 | 0 | 不可计算 |

`[事实]` tool-result 证据只出现在 A2（r03）；按 callId + 返回事件 seq 精确匹配，8/9 可解析为成功证据（另 1 条未匹配到成功结果）。

## 4. 判定（protocol §6）

1. **正向效果**：不满足。B1 只有 1/3 次严格低于 A1。
2. **B2 硬门槛**：满足（3/3，内容级证据）。
3. **可见性对照**：首请求两组完全相同（4151 字符）；B 组从 turn 2 起多出 850–2369 字符的 readscope 段，占完整请求比例很小，但按 §6.3 需在报告中注明这一长度效应。
4. **证据利用**：无法判定——A1/B1/B2 均无 tool-result 证据，只有 A2 有（8/9）。
5. **结论门槛**：1 未满足 → 结论为「**未观察到检查范围摘要改善历史证据利用**」。

## 5. 结论

**直接观察事实**
- 12/12 运行有效；两组都发现并重读了文件变化；B2 三次全部满足内容级硬门槛。
- 重复读取没有因 readscope 而稳定下降：逐对比较仅 1/3 严格更低，均值差异在样本内不稳健。
- 重复读取集中在 `handoff.md` 与 `store.js` 两个核心文件。
- 唯一的 tool-evidence 出现在 A2 的 r03（9 条，8 条可解析）；B 组没有出现 tool-evidence 推进。
- B2 的 step 数（16/18/15）全部低于对应 A2（27/20/20），finding 数也更少。

**实验推论（未独立验证）**
- readscope 摘要可能让模型更早「认为已检查过」，从而减少重复读取的动机；但同一机制也可能减少它重新查看内容、发现新问题的动机——B2 与 A2 的 finding/step 差异与这一方向一致。
- r03 的深度验证更像「文件变化」本身触发，而不是「有无摘要」触发。

**未确定**
- 样本量（3 次/条件）不足以区分「无效应」与「效应存在但方差大」；r03 是明显异常值。
- readscope 是否改变了「读取内容层面的覆盖」（只读了行号/摘要 vs 读全文）无法从计数判断。
- B 组没有 tool-evidence 是能力限制、提示差异还是随机，需要更多运行才能区分。

## 6. 限制

1. 历史非逐字节相同：A/B 各自生成历史，只能保证相同输入前缀。
2. B 组上下文多 850–2369 字符（readscope 段），属混杂变量。
3. 单模型、单仓库、4 turn 终止条件；结论不外推到其他模型/任务。
4. 重复读取的判定基于行范围重叠，`grep`/`glob` 未计入重复读取。
5. 12 次运行串行执行，未做盲法；条件映射只存在于 manifest，模型不可见。
6. r03 的 18 条 finding 记录导致其规模指标偏高，均值对其敏感。

## 7. 材料清单

- 原始证据（本地保留，不覆盖）：`c03/captures/rNN.jsonl`（trace）、`rNN.meta.json`、`rNN.log`、`rNN.run.log`；session 日志在 `~/.dsh/sessions/**/session-hikari-c03-NN/session.v4.jsonl.zstd`。
- 归一化记录：`c03/analysis/runs.json`（由 `collect-c03.mjs` 生成）。
- 运行脚本：`c03/tools/run-one.mjs`；采集脚本：`c03/tools/collect-c03.mjs`。
- 协议：`c03/protocol.md`（v3）；fixtures：`c03/fixtures/`；取证工具：`c03/tools/tool-evidence.mjs`（15/15）。
- 工作区副本：`%TEMP%\workbench\ws-01` … `ws-12`（运行产物，未提交）。
