# M2-a Functional Review

**评审对象**：`hikari-native/memory/store.mjs`（536 行）、`hikari-native/memory/index.js` 的接线、`hikari-native/test/memory-store.test.mjs`（17 项）、`hikari-native/test/memory.test.mjs` 的同步修改。
**评审方法**：读实现、跑全量测试、对每条数据完整性要求做字节级或错误码级断言、另写一次性探针复核（`experiments/m2a-store/damage-probe.mjs`、`experiments/m2a-store/smoke.mjs`）。
**评审时间**：2026-11-04。

## 一、任务书 §3.1 的实现逐条核对

九项都有落点，行号见 `docs/development/m2a-memory-store.md` §4 的表。核对过程中确认的两处：

**「全局存储目录初始化」不是只对默认路径成立。** 初版只有默认分支不碰 cwd，显式 `storeDir` 传相对路径时仍会按 cwd 解析。这是评估时抓出来的（见下），已改成两条分支都 `isAbsolute` 检查（`store.mjs:72-78`、`:84-90`），抛 `INVALID_INPUT`。

**「Schema 版本管理」拒绝启动但不动文件。** `:298-303` 抛 `SCHEMA_INCOMPATIBLE` 时，第 8 项测试断言两个文件的字节都不变。

## 二、数据完整性（任务书 §3.2）六条实测

| 要求 | 判定 | 证据 |
|---|---|---|
| 正常追加 | 通过 | 第 2 项：两条记录、`seq` 1/2、`supersedes` 保存 |
| 重启恢复 | 通过 | 第 3 项：close 后重开读到同样两条 |
| 重复 ID 处理 | 通过 | 8d：内容相同 → 重放计数 1、`size` 仍 1；内容不同 → `DUPLICATE_MEMORY_ID` 且 `details.memoryId` 对得上 |
| 无效记录处理 | 通过 | 8c：中间行合法 JSON 但缺字段 → `INVALID_MIDDLE_RECORD`，文件字节不变 |
| JSONL 尾部不完整记录 | 通过 | 第 7 项：先读原字节，追加 21 字节残片后再读，断言前缀逐字节相同（原文件未被改写）；重开后 `tailCorrupt` 记到第 3 行、`bytes:21` |
| Schema 不兼容 | 通过 | 第 8 项：`schemaVersion: 999` → `SCHEMA_INCOMPATIBLE`，两文件字节不变 |

「不得静默丢弃有效记忆」这条有一个反例被当场抓到并改掉，见下第三条。

## 三、评审中发现的真缺陷（均已修，均有测试）

**1. 封过换行的尾残片会让存储永久起不来。** `append` 发现上次留下无换行残片时，会先补一个 `\n` 把它封成独立行（`:488`）；封住之后那行从「尾部」变成「中间」，下次 open 判成 `CORRUPT_MIDDLE_LINE` 直接拒绝启动。修法：`meta.corruptLines` 记已报告过的坏行（`:342-346`、`:424`），恢复时先查表跳过。坏字节从不删除。

**2. meta 读不出来会把有效记忆全部锁死。** 初版对 meta 读取失败抛 `META_UNREADABLE`。实测后果：jsonl 里三条有效记忆，删掉 meta 或写坏 meta 之后一条都读不到。这直接违反「不得静默丢弃有效记忆」——而且 meta 是**派生**文件，没有任何信息是 jsonl 推不出来的。改为当作空 meta、从 jsonl 重建，记 `metaUnreadable`/`metaRepaired`（`:289-294`、`:415-426`）。探针实测：删 meta → `size 3`、`metaRepaired: true`；写坏 meta → `size 3`、重建出合法 meta。

**3. `apply` 变 async 后固定等待窗口不够。** 这不是存储本身的缺陷，是接线带来的时序变化。本地并行跑时偶发，CI 的 Windows runner 上稳定失败两个用例（ready 行串进下一个用例；非仓库目录用例等不到 `search_memory`）。`hikari-native/test/memory.test.mjs` 改用 `until()` 条件等待，冲突用例传 `expectReady: false`。CI `41845324643`、`41847403448` 两次 success。

**4. 显式 `storeDir` 相对路径按 cwd 解析。** 见第一节。

## 四、未覆盖的部分（如实记录）

- **没有多实例并发测试**。单写入者假设是明确的前提，不是被测行为。
- **没有断电/部分写模拟**。`appendFile` 之后的落盘语义依赖文件系统；尾残片用例是「构造出残片状态」，不是真的在写到一半杀进程。
- **没有大文件性能测试**。M2 已把「启动全量重放」列为接受的代价，本阶段不测拐点。
- **`search_memory` / `read_memory` 未接存储**，它们仍读 World Findings，行为与本轮改动前一致（`git diff --stat -- hikari-native/memory/tools.js` 为空）。

## 五、结论

**功能验收通过（PASS），附三条限定：**

1. 真实运行验证用的是 DSH CLI `0.2.1-rc.2` + Cordis `4.0.5`；**桌面打包版尚未验证**（与 M1 时同一个限定）。
2. `npm test` 1103 项 / 1099 pass / 0 fail / 4 skip，但这只证明行为符合断言，不证明存储设计对长期使用是够的——检索、淘汰、迁移都不在本阶段。
3. 单写入者假设、无 fsync、无上限三条限制是**已知且接受**的，不是缺陷；但任何一条前提被打破（多实例、要求断电不丢、记忆量级上去），本阶段结论不成立。

**没有阻塞性缺陷。** 四条真缺陷全部当场修复，每条都有回归测试。
