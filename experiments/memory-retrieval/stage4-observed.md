# 阶段 4：一次真实处境下的观察

**日期** 2026-11-03 · **实例** `dsh --profile hikari --no-open --port 0`（每次重启端口不同）· **模型** `deepseek-flash`（`reasoningEffort: max`）· **驱动** 真实前台窗口切换

## 实验设计

阶段 1–3 验的都是函数：给一个 findings 对象，问 `searchFindings` / `readFinding` 返回什么。这组验证**验不到一件事**——这些东西到底有没有装上。

所以这一轮换问题：**在没有任何人给她任务的时候，她会不会自己形成判断、记不记得下来。**

做法：起常驻实例，只做真实窗口切换（打开记事本、打开画图），不给任何提示、不注入构造事件、不告诉她要看什么。她自己决定读什么、记什么。

## 四轮读数

### 第一轮：没有记忆能力（00:27）

触发：打开 Notepad，窗口「必看.txt - Notepad」。

| 读数 | 值 |
|---|---|
| turn | 1 |
| step | 28 |
| tool/call | 45 |
| **record_finding** | **0** |
| 工具面 | `glob` / `grep` / `read` / `project_status` / `working_directory` |

输出 800 余字，其中三条是可核对的断言：

1. **findings 层没进常驻**。`world/index.js:128` 只在 `config.root` 有值时才装 findings，而正式 patch 的 `hikari-world` 只有 `sessionId / settleMs / cooldownMs`。她原话：「这一轮我的工具面是 glob / grep / read / project_status / working_directory，没有 record_finding，也没有 search_memory / read_memory，system prompt 里没有「当前认识」那一段。」
2. **账本没跟上**：`clear/goals/` 里最新的目标仍是那个 16 轮窗口事件。
3. 想知道但查不到：`必看.txt` 里写的到底是什么。

第 1 条当场核实为真。

### 第二轮：补上 root 之后，装不上（00:31）

补 `hikari-world.config.root` 后启动：

```
dsh: warning: 1 entry did not activate
hikari-world (hikari-native-v0/world): JsonSchemaError: unsupported JSON schema:
schema.properties.nextOffset.type must be a single type string (type arrays are not supported)
    at installFindings (hikari-native/world/findings.js:523:13)
```

上一轮我把 `nextOffset` 从 `{ type: ['number','null'] }` 改成了 `{ type: 'number' }`，但返回值仍给 `undefined`——注册工具时 schema 通过了，返回值序列化时又出问题，是两次不同的失败。改成「`hasMore=false` 时**不设这个键**」。

### 第三轮：能力接通，但第一次检索就失败（00:32）

触发：打开画图。

| 工具 | 次数 |
|---|---|
| read / glob / grep | 17 / 17 / 14 |
| **record_finding** | **2** |
| **search_memory** | **1** |

`search_memory` 调用本身是成功的、被受理了，但返回被判无效：

```
Error: tool "search_memory" returned invalid output: value is not lossless JSON
```

她去读源码定位，然后写进记忆：

> `search_memory` 在结果不满一页时（hasMore=false）返回 nextOffset=undefined，DSH 判为「not lossless JSON」并整条失败：findings.js:235 返回 undefined，冻结稿 §3.2 写的是 null，而 findings.test.mjs:187 断言的正是 undefined——所以记忆少于 5 条时她根本检索不了，只有已经多到翻页时才「能用」。

第一次写入被拒：`Error: a new finding must start as "model-claim"`。第二次改为 `model-claim` 成功：`{"findingId":"f-001","seq":265,"status":"open"}`。

### 第四轮：回路闭上（00:36）

`findings.js:235` 修好、注释里写明「实测，见 f-001」，重启后再触发一次窗口：

- `search_memory` 返回 f-001（`total: 1, shown: 1, hasMore: false`），**成功**。
- 她尝试把 f-001 标成 `resolved` → `Error: illegal status transition open -> resolved`（必须先 `confirmed` 或 `refuted`），改走 `refuted` 成功，证据指针自动补成 `seq 305` + `callId`。
- 记录 f-002：那条 bug 能逃过测试，是因为**测试站在错误的边界上**。

她的原话：

> 00:32 我把 search_memory 那次失败写成 f-001；三分钟后回到这里，findings.js:235 的那一行已经改了，注释里直接写着「实测，见 f-001」……我在这个项目里记下的第一条发现，第一次改变了代码。不是脚本化场景，是一个他自己还没撞到的真实缺陷。

## 她发现的三件事（逐条核实）

| # | 她的断言 | 核实 | 处置 |
|---|---|---|---|
| 1 | `world.root` 缺失 → findings 层从不安装 | 真（`world/index.js:128` + patch 无 root） | 补 root |
| 2 | `nextOffset: undefined` → 整次调用 `not lossless JSON` | 真（seq 231 错误原文） | 改成不设键 |
| 3 | 测试断言对「键不存在」与「键存在但值 undefined」等价，盖不住 | 真 | 断言改为 `!('nextOffset' in x)` |

第 3 条的判别力实测：

```
旧断言 assert.equal(x.nextOffset, undefined):  {nextOffset:undefined} → true   {} → true    （两者都过）
新断言 !("nextOffset" in x):                   {nextOffset:undefined} → false  {} → true
```

## 结论

- **检索链路通了**：她自主决定调用 `search_memory`、自主判断结果、自主记录、自主选择证据来源。
- **她记录的第一条 finding 改变了她自己的代码**——这是这四个阶段里唯一一次闭环走到对岸。
- **状态机语义她走过一次弯路**：`open → resolved` 被拒，她读完错误后改走 `refuted`，并把这件事本身也写进输出。这不是缺陷，是她在真实边界上学习。
- **仍未解决**：她这一轮只做了检索与记录，没有做 `read_memory`（候选只有 1 条、摘录够用）；阶段 4 原本的三个验证场景（够用时不搜 / 涉及旧认识时搜 / 摘录不够时读）还缺后两个的真实样本。

## 这一轮暴露的产品问题（不是实验问题）

- 阶段 1–3 的每一次「验证」都只调函数，**没有一次验证「它有没有被装上」**。`root` 缺失让三个阶段的成果在常驻里整整缺席一轮，而我的检查全绿。
- 冻结稿、实现、测试三处对 `nextOffset` 各写了三种做法（`null` / `undefined` / 不设键），按仓库自己的 R7.2，动冻结点要留指针，这次一个字都没留。
