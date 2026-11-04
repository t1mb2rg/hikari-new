# M2-a 验收读数：CI 两个平台与工作区边界

记录时间：2026-11-04。基线 `ce12a15` → 交付 `53dd845`。

## 一、本地全量测试

```
npm test
ℹ tests 1098
ℹ suites 2
ℹ pass 1094
ℹ fail 0
ℹ cancelled 0
ℹ skipped 4
```

改前 1086 项，新增 12 项（`hikari-native/test/memory-store.test.mjs`）。4 项 skip 是仓库原有的平台相关跳过，非本轮引入。

## 二、CI 第一轮：Windows 上两项失败

run `41844631032`，`surface` job 的「Test the runtime」步骤失败，`test` job（Ubuntu）通过。失败两项：

```
✖ 非仓库目录：Memory 仍能激活，record_finding 不存在
  AssertionError: actual: false, expected: true        ← assert.equal(tools.has('search_memory'), true)

✖ 接管成功时输出一条 ready 日志，含 provider / tools / source
  AssertionError: expected exactly one ready line, got: [
    "...available=false, store=C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\hikari-memory-plugin-iKrBuE...",
    "...available=true,  store=C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\hikari-memory-plugin-v49lmG..."
  ]
```

**根因**：`memory/index.js` 的 `apply` 本轮从同步改成 `async`（要 `await MemoryStore.open()`）。测试替身原来的固定窗口（150 ms / 40 ms）在 Windows runner 的慢盘上不够：

- ready 行在 `console.error` 已被恢复之后才打出来，于是落进**下一个用例**截获的数组——「一条 ready」变成两条，且两条的 `store=` 目录不同（正是两个不同用例的临时目录）。
- 非仓库目录用例 40 ms 后查 `tools.has('search_memory')` 时，Memory 还卡在 `MemoryStore.open()` 的 `mkdir`/读文件上，工具尚未注册。

**为什么只有 Windows 失败**：Ubuntu runner 上 40 ms 足够跑完一次空目录 `open`；Windows 上 `mkdir` + 两次 `readFile` 的系统调用开销更大。这不是 store 实现的问题，是测试里对「插件加载即就绪」的时序假设。

**修法**（commit `53dd845`）：把固定窗口换成 `until()` 等真实条件——有 `logs` 时等 ready 行出现，无 `logs` 时等 `search_memory` 注册完成；冲突用例显式传 `expectReady: false`，因为它本来就不该打 ready，等它会拖到超时。

## 三、CI 第二轮：两个平台通过

run `41845324643`（head `53dd845`）：

| job | 平台 | 结论 |
|---|---|---|
| `test` | ubuntu-latest | success |
| `surface` | windows-latest | success |

overall `conclusion: success`。

## 四、工作区边界

```
git status --porcelain -- hikari-native      → 空
git diff --stat HEAD~3 -- hikari-native/world hikari-native/memory/tools.js hikari-native/cordis.patch.yml → 空
```

即：World 插件、`memory/tools.js`（两个检索工具的定义与行为）、`cordis.patch.yml`（装配配置）相对 `ce12a15` **零改动**。本轮动的是 `memory/store.mjs`（新增）、`memory/index.js`（open/close 与 ready 行）、`test/memory-store.test.mjs`（新增）、`test/memory.test.mjs`（时序与临时目录）。

仓库里没有 `src/` 或 Runtime 目录的改动，`git diff --stat HEAD~3 -- src/` 输出为空。

## 五、这一轮暴露的一个真实风险（已写进文档 §3）

`apply` 从同步变 `async` 之后，**`app.plugin(...)` 返回的那一刻工具还不可用**，要等 `MemoryStore.open()` 完成。DSH 侧目前没有代码假设「插件加载完成即工具可用」（工具是模型按需调用的，不存在启动期快照），所以现在没影响；但任何未来的启动期工具快照都会踩到这一点。文档 §3「风险与限制」已补这一条。

## 六、未做的事

- 未在真实 DSH 实例里验证 ready 行的 `store=` 是否落成 `~/.dsh/hikari/memory`（本轮只在测试临时目录里跑过）。桌面实例上一轮起的是旧代码，要重启才会加载 store。
- 未测多进程同时写同一个 store（设计上是单写入者假设，见文档 §3）。
