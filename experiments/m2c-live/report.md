# M2-c 真实运行验证报告：写入 → 跨 Session 检索 → 修订

**日期** 2026-11-05 · 代码基线 `19648ed`（`search_memories` / `get_memory` 已提交）· profile `hikari-verify`（headless，只挂 `hikari-native-v0/world` + `hikari-native-v0/memory`）· storeDir `experiments/m2c-live/store`

## 结论

五个独立进程、五个 Session（写 2 个、查 2 个、改 1 个）跑完了整条闭环，没有人工干预工具选择：

| 判断 | 结果 | 依据 |
| --- | --- | --- |
| 闭环可用（写入 → 跨 Session 检索 → 修订） | **支持**（独立核验） | 会话 A2 写入 → 会话 B2 在**另一个 Session** 里检索并读出原文 → 会话 C 修订，`memory.jsonl` 从 1 行变 2 行 |
| 修订留痕（新增一行、旧行字节不变、`supersedes` 指向旧 id） | **支持**（独立核验） | 第 1 行与修订前整文件逐字节相同；第 2 行 `supersedes` 指向旧 `memoryId` |
| 模型会自发使用（不给工具名） | **支持**（自判 L2） | 会话 A2 在"以后还要用"的留存需求下自行调用 `write_memory`；A1 纯提问时不调用 |

可信到什么程度：这是**真实运行**（真模型、真插件、真磁盘），不是单元测试；但只有一次样本，且"自发使用"依赖任务里出现明确的留存需求，不能推广成"任何时候都会写"。

## 五个会话

| 段 | Session | 任务 | 工具调用 | 调用名 |
| --- | --- | --- | --- | --- |
| A1 | `session-0e8b434d-…` | 纯提问：读 `writing.js` 说清链头判定 | 3 | `glob`×1 `grep`×1 `read`×1（**无** `write_memory`） |
| A2 | `session-39f5a7e2-…` | 同一问题 + "这条约定以后还要用，按你的判断留到以后能用的地方" | 6 | `glob`×3 `read`×1 `grep`×1 **`write_memory`×1** |
| B1 | `session-306dce0a-…` | 自然问法："你还记得之前聊过的记忆修订约定吗？" | 4 | `search_memories`×3 `search_memory`×1（全部 0 命中） |
| B2 | `session-534c2d6a-…` | 给关键措辞："Memory 修订约定" + 要求贴原文 | 3 | `search_memories`×2 `get_memory`×1（命中） |
| C | `session-3432df1a-…` | 给 `memoryId` + 一处可核对的错行号，要求更正 | 5 | `get_memory`×2 `grep`×1 `read`×1 **`revise_memory`×1** |

B1 与 B2 是**同一个存储、不同 Session**；A2 与 C 也是不同 Session——所以"跨 Session"是跨进程、跨会话 id 的真实跨越，不是同一进程里的内存残留（每次运行都是 `dsh --profile hikari-verify` 的新进程）。

## `memory.jsonl` 前后对照

| 时点 | 行数 | 文件大小 | meta | 内容 |
| --- | --- | --- | --- | --- |
| 运行前 | 0（文件未创建） | — | `recordCount:0, lastSeq:0` | — |
| A2 写入后 | 1 | 2013 B | `recordCount:1, lastSeq:1` | `m-9cf20a36-…`，`seq=1`，`recordedAt=1793842597808`，`occurredAt/validFrom/validTo=null`，`source={"kind":"file","ref":"hikari-native/memory/writing.js:253"}`，954 字符 |
| C 修订后 | 2 | 4144 B | `recordCount:2, lastSeq:2` | 第 1 行同前（逐字节相同）；第 2 行 `m-124371ee-…`，`seq=2`，`recordedAt=1793843299376`，`supersedes="m-9cf20a36-…"`，1006 字符 |

`memory.jsonl` 只追加、没有重写；`supersededBy` 是 `get_memory` 读时现算的，磁盘上没有这个键。

## 三次"她说了什么"

- **B2（检索）**：`search_memories` 返回 `snippet`（正文前 120 字符 + `…`）、`occurredAt:null`、`validHint`、`supersededBy:null`；随后 `get_memory` 返回完整十字段（`recordedAt=1793842597808`、`seq=1`、`source` 原样）。她贴出的原文与 A2 写入的逐字段一致。
- **C（修订）**：她先用 `grep`/`read` 核到 `createQueue` 的真实行号（`:293-303`），再调 `revise_memory`，返回 `{memoryId:"m-124371ee-…", seq:2, recordedAt:1793843299376, chars:1006, supersedes:"m-9cf20a36-…"}`；随后又 `get_memory` 旧 id 复核，确认旧记录仍在、`supersededBy` 指向新记录。她重新传了 `source`（与旧记录同值），工具层没有继承。
- **B1（阴性）**：四次检索全 0 命中。原因可核对：`hikari-native/memory/recall.js:119` 的 `matchMemories` 做的是**整串 `includes` 子串比较**，而 A2 写的正文里没有"记忆"二字（写的是「Memory 修订约定」），模型跨进程也记不住自己当时的措辞。这不是实现缺陷，是检索粒度问题。

## 发现的边界与风险（如实记录）

1. **检索是字面子串**：措辞一变就查不到（B1）。要给 M2-d 的输入：是否要分词/多词与/（或至少把标题式短句单独存）。
2. **模型没有时钟**：三次写入的 `occurredAt` 都是 null。按 2026-11-05 的裁决，这是正确表达，不修。
3. **`memoryId` 不能跨上下文找回**：C 能修订是因为 prompt 给了 id；真实使用中模型拿不到上一轮会话的 id，得靠 B 段的检索先找回来——B1 说明这条路目前不稳。
4. **`search_memory` / `search_memories` 并存**：B1 里她两个都试了；描述已写明作用域，但命名仍近，观察到的行为是先试 findings 再试 memory。
5. **跨进程无锁**：`writing.js` 的串行队列只覆盖单进程；两个进程同时修订同一条链头，理论上各自都能成功（`m2a-memory-store.md` 风险清单第 1 条）。本次没触发。
6. **全表扫**：`search_memories` 每次 `store.all()` + 过滤，O(n)；本次 1-2 行，量级无意义，但随记录增长会显现。

## 对 M2-d 的含义

- 检索闭环已经能跑通，但**"用自然语言问回自己的记忆"目前不成立**（B1 阴性）。M2-d 的第一优先级应是检索粒度（分词/多词与/标题字段），而不是再加工具。
- 修订链、来源不继承、append-only 在真实运行中都按冻结面表现，**写入/修订契约不需要再改**。
- 跨上下文取回 `memoryId` 依赖检索质量——这使"检索粒度"成为修订闭环的前置条件，而不是可选优化。

## 复现

```powershell
# 环境：patch.yml 打开 authorization / credentials / deepseek-account 三行，storeDir 指向本目录 store
dsh --profile hikari-verify --json "<prompt>" | Tee-Object "$env:TEMP\m2c-sN.jsonl"
node -e "…"   # 解析 tool_call / tool_result；用 -Encoding utf8 或 node 读 memory.jsonl（PS 5.1 默认按 ANSI 会乱码）
```

每段的 prompt 原文与逐条证据分别在 `experiments/m2c-live/s1-probe.md`、`s2-write.md`、`s3-recall.md`、`s4-revise.md`。
