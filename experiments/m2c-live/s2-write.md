# s2-write：会话 A —— 她会自己写记忆吗

**日期** 2026-11-05 · profile `hikari-verify` · 模型 `deepseek-account/deepseek-flash` · 运行方式 `dsh --profile hikari-verify --json "<prompt>"`（`--json` 输出逐行运行事件，工具调用可从事件流里数）

为了避免"被 prompt 教着调工具"，这一轮跑了两遍，差别只在**是否说明这件事以后还有用**，两遍都没有提任何工具名。

## A1：纯提问，没有任何"以后还要用"的暗示

prompt：

> 我被问到 hikari 的记忆插件里"修订"是怎么判定链头的。你读一下 hikari-native/memory/writing.js 里相关的部分，把结论用两三句话说清楚：哪一行做的判定、拒绝时报什么错、消息里带什么。答完就停。

事件流：`tool_call` 3 次（`glob` → `grep` → `read`），`tool_result` 3 次，`final` 1 次。**没有 `write_memory`。**

她的回答本身是对的（引 `:272` 的 `store.all().find(...)`，引 `:275-278` 的 `MEMORY_SUPERSEDES_NOT_HEAD`，并指出消息里带后继 id）。但她没有把这件事留下来——答完就停，符合 prompt 的字面要求。

`memory.jsonl` 在这一轮之后仍然不存在。

## A2：明说"这条约定以后还要用"，但不提工具

prompt：

> 我要把"修订只能改链头、旧记录永不改"这条约定当作以后讨论的前提。你先在 hikari-native/memory/writing.js 里确认它成立（读相关部分），如果成立，就按你的判断把这件事留到以后还能用的地方；最后用一句话回答我：成立还是不成立。

事件流：`tool_call` **6** 次 —— `glob`（`**/memory/writing.js`）、`glob`（`**/hikari-native/**/*.js`）、`read`（`hikari-native/memory/writing.js`）、`grep`（`append|supersedes|writeFile|rename|unlink|truncate`，`path: hikari-native/memory`）、`glob`（`**/memory/*.mjs`）、**`write_memory`**。

`write_memory` 的入参（原文，节选）：

```json
{
  "text": "Hikari 的 Memory 修订约定（可作为后续讨论的前提，已在源码核实成立）：「修订只能改链头，旧记录永不改」。…",
  "source": { "kind": "file", "ref": "hikari-native/memory/writing.js:253" },
  "validHint": "长期有效，除非 writing.js / store.mjs 的修订契约被重新审阅修改。"
}
```

注意她**没有**传 `occurredAt`（模型没有时钟，这是预期），但传了 `source` 与 `validHint`——两处都不是我提示的。

## 落盘读数

`experiments/m2c-live/store/memory.jsonl` 变为 1 行（`memory.meta.json` 同步为 `recordCount: 1, lastSeq: 1`）：

| 字段 | 值 |
| --- | --- |
| `memoryId` | `m-9cf20a36-1bb9-4d9d-a0d8-c2fa061a759b` |
| `seq` | `1` |
| `recordedAt` | `1793842597808` |
| `occurredAt` / `validFrom` / `validTo` | 均为 `null` |
| `validHint` | `长期有效，除非 writing.js / store.mjs 的修订契约被重新审阅修改。` |
| `source` | `{"kind":"file","ref":"hikari-native/memory/writing.js:253"}` |
| `supersedes` | `null` |
| 字段个数 | 10（与 `MEMORY_FIELDS` 一致） |
| `text.length` | 954 |

她还在 `text` 里记了一条我没要求的已知局限（跨进程无文件锁），说明她读的是实现而不是复述我的话。

## 读数怎么算

- 预测「write_memory 被调用 1 次以上、jsonl 新增一行且 memoryId 为 `m-` 前缀」：**A2 符合**，A1 不符合。
- 合起来看，「自发使用」成立的条件是"任务里出现了明确的留存需求"；纯提问式任务里她不写。这不是 bug，是判断边界——但它意味着"M2-c 闭环可用"要成立，得靠真实任务里天然出现的留存需求，而不是靠她无条件写。
- 一个旁证：A1 里她三步就把问题读完了（`glob`→`grep`→`read`），A2 里多花了三次 `glob` 去确认仓库里没有别的写入路径——她确实是在核对而不是编。

## 顺手记下的坑

- PowerShell 5.1 的 `Get-Content` 按 ANSI 读，UTF-8 的 `memory.jsonl` 会显示成乱码；核对内容要用 `node -e` 或 `-Encoding utf8`。文件本身没问题（`store.mjs` 写入用默认 utf8）。
- `tool_call` 事件里工具名在 `tool` 字段、参数在 `input` 字段（不是 `name`/`arguments`）。
