# M2-b 修订路径探针记录

日期：2026-11-05 ｜ 基线：`9df0d4d1ca504a2af3fafe686c8622d0c59b5ee0`（改动未提交）
对象：`hikari-native/memory/writing.js` 的两个写入工具 + 真 `MemoryStore`

这份记录只回答一件事：**冻结面 §6 写下的修订链规则，在真实实现里是否真的成立**。
四个读数都是从真实 `MemoryStore`（临时目录里的真 `memory.jsonl`）跑出来的，不是推演。
探针脚本是用完即弃的临时文件（`$env:TEMP/m2b-smoke2.mjs`），没有入库——下面把每个读数
需要的输入、断言与结果都写全，实施后可以用测试文件里的对应用例复现同一结论。

## 1. 并发写入的 seq 连续

- 输入：对同一实例 `Promise.all` 发 20 次 `write_memory.execute({ text: 'row i' })`。
- 读数：返回的 `seq` 集合恰为 `{1..20}`（排序后逐项相等），`store.size === 20`。
- 由谁保证：`store.append` 的私有队列（`hikari-native/memory/store.mjs:458-466`）把并发追加
  串行化，序号在队列内取 `#lastSeq + 1`（`:492`）。工具层不参与序号生成。
- 对应：冻结面 §1「工程字段由存储层生成」；任务书 §4 第 10 项。

## 2. 并发修订同一目标只有一个胜出

- 输入：先写一条 `a`，再对 `a.memoryId` 并发发 20 次 `revise_memory.execute({ memoryId, text: 'v i' })`。
- 读数：`fulfilled` 1 次、`rejected` 19 次；19 次的错误消息全部以
  `MEMORY_SUPERSEDES_NOT_HEAD:` 开头。`store.size` 从 1 变 2。
- 由谁保证：`assertReviseTarget` 的"目标没有后继"判定与随后的 `store.append` 在**同一个**
  `enqueue` 回调里执行（`createQueue` → `revise_memory.execute`）。若两者分开，20 个回调会
  各自看到"没有后继"，于是写出 20 条指向同一旧记录的新行。
- 对应：冻结面 §6 第 3 条「判链头+写入在同一私有队列里串行」；任务书 §4 第 6、8 项。

## 3. 无分叉计数

- 读数：上述 20 次并发之后，`store.all().filter((r) => r.supersedes === targetId).length === 1`。
- 意义：这是"修订链线性"的直接读数——同一个目标最多被一条新记录替代，链不会长出两条分支。
  它是 **单进程内**的结论：队列是模块私有的，两个进程共写同一 `memory.jsonl` 仍没有文件锁
  （M2-a 风险清单第 1 条），跨进程并发不在本片保证之内，也不能由这条探针推出。

## 4. 两跳链的指向

- 输入：写 `a` → 用 `a.memoryId` 修订出 `b` → 用 `b.memoryId` 修订出 `c`。
- 读数：`store.get(a).supersedes === null`、`store.get(b).supersedes === a.memoryId`、
  `store.get(c).supersedes === b.memoryId`；三条记录都在（`store.size === 3`），旧行的其余字段
  与写入时逐字段相等，且不存在 `supersededBy` 键。
- 再读一次：对 `a` 直接再发一次修订，被 `MEMORY_SUPERSEDES_NOT_HEAD` 拒绝，消息里带出了
  后继 id `b.memoryId`。
- 对应：冻结面 §6 第 1、2、5 条（目标存在 / 目标无后继 / 旧记录一律不动）；M2 架构 §6.3
  「单向 supersedes、不写 supersededBy」。

## 没被这四段证明的东西

- **跨进程/跨实例并发**：没有文件锁，未测也不保证（见第 3 段的限定）。
- **大量记录时的性能**：判"有无后继"是 `store.all()` 全表扫（无反向索引，缺口 G-4），
  探针里记录数是几十条，没有测上万条的代价。
- **存储层自身在崩溃时的行为**：那是 M2-a 的范围（`docs/development/m2a-memory-store.md`），
  本片不重复验证。
