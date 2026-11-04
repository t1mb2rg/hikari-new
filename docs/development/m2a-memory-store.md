# Memory Store（M2-a）

这一阶段只做一件事：让 Hikari 第一次拥有**自己的**持久化数据。存储层独立于任何项目与 Session，随 `hikari-memory` 插件加载与释放。写入工具、检索、自动分类、自动过期都不在这一阶段。

## 1. 存储格式

### 目录

```
<DSH_HOME>/hikari/memory/
├── memory.jsonl      # append-only，一行一条记录
└── memory.meta.json  # 派生元数据，可重建
```

目录由 `resolveMemoryDir`（`hikari-native/memory/store.mjs:67-96`）解析，优先级：显式 `config.storeDir` > `$DSH_HOME` > `~/.dsh`，之后拼 `hikari/memory`。空白 `$DSH_HOME` 视为未设（:79-80）——这条与 DSH 自己的 `resolveDshHome` 一致。

**两条分支都拒绝相对路径**（`storeDir` 的 throw 在 :71-75、`DSH_HOME` 的 throw 在 :83-87），抛 `INVALID_INPUT`。原因很简单：「不看 `process.cwd()`」这条约束不能只对默认路径成立——只要有一条分支悄悄按 cwd 解析，这个存储就不再是全局的了。默认分支完全不碰 cwd（:92-95 只用 `homedir()`）。

### 记录

一条记录是一个扁平 JSON 对象，固定十个字段（`store.mjs:31-51`）：

| 字段 | 类型 | 谁写 | 说明 |
|---|---|---|---|
| `memoryId` | `m-<uuid>` | 存储层 | 全局唯一，`randomUUID()` 生成（:483） |
| `text` | 非空字符串 | 调用方 | 记忆内容本身，不设模板、不设 kind 枚举 |
| `occurredAt` | 非负整数 \| null | 调用方 | 事情发生的时间；`0` 是合法值，null 表示不知道 |
| `recordedAt` | 非负整数 | 存储层 | 系统写下它的时间 |
| `validFrom` / `validTo` | 非负整数 \| null | 调用方 | 有效区间，**只表达不判断** |
| `validHint` | 字符串 \| null | 调用方 | 模型给的模糊期限（「大约一周」） |
| `source` | `{kind, ref}` | 调用方 | 来源指针；缺省 `{kind:'unknown', ref:null}` |
| `supersedes` | `m-<uuid>` \| null | 调用方 | 被这条取代的旧记忆 |
| `seq` | 正整数 | 存储层 | 写入顺序号，单调整增（:492） |

校验在 `validateRecord`（`store.mjs:105-158`）：**多一个字段也算无效**。schema 漂移最常见的形态就是某版本多写一个字段，放宽会把两个版本的数据混成一套——任务书 §2 冻结十字段，这条就是它的执行方式。

### 为什么是 append-only 文件

M2 §4 比较过四种持久化方案。选文件的三个理由：不引入新依赖（仓库 `devDependencies` 只有 `@deepseek-ai/cordis`、`@types/node`、`typescript`，CI 拉不到数据库）；可人工审阅（一条记忆就是一行，`Get-Content` 能看）；写失败不污染已有数据（追加失败最多丢最后一行）。

代价是启动要全量重放。M2 接受这个代价，因为记忆量级在可预见的阶段都很小。这条代价写在 §3「风险与限制」里。

## 2. 恢复机制

`MemoryStore.open`（`store.mjs:274-450`）按固定顺序做六件事：

1. **解析并创建目录**（:277）。
2. **读 meta**（:293-306）。文件不存在或读不出来 → 当作空 meta（读不出来的情况另记 `metaUnreadable`，见下）；存在且 `schemaVersion` 不等于 `MEMORY_SCHEMA_VERSION` → 抛 `SCHEMA_INCOMPATIBLE`（:306-310），**不迁移、不猜**。
3. **读 jsonl**（:313-323）。不存在 → 空存储。
4. **逐行解析、校验、fold 建索引**（:328-425）。
5. **处理损坏**（见下表）。
6. **对齐 meta 与 jsonl**（:426-438）。两者计数不符或 meta 读不出来时以 jsonl 为准重建 meta，并记 `metaRepaired`。

### 损坏分类

| 现象 | 判定 | 去处 |
|---|---|---|
| 最后一个非空行不是合法 JSON | 尾部残片（写到一半崩了） | 跳过、记 `tailCorrupt{line,bytes}`、行号进 `meta.corruptLines`（:372） |
| 最后一个非空行校验不通过 | 同上 | 同上（:392） |
| 中间某行不是合法 JSON | 无法安全恢复 | 抛 `CORRUPT_MIDDLE_LINE`（:377-384），文件不动 |
| 中间某行校验不通过 | 无法安全恢复 | 抛 `INVALID_MIDDLE_RECORD`（:396-403） |
| 重复 `memoryId`、内容完全相同 | 重放 | 保留后者，计 `skippedDuplicates`（:413-416） |
| 重复 `memoryId`、内容不同 | 硬损坏 | 抛 `DUPLICATE_MEMORY_ID`（:406-411） |
| meta 计数与 jsonl 不符 | 派生值过期 | 以 jsonl 重建，记 `metaRepaired`（:426-438） |
| meta 文件读不出来（坏 JSON 等） | 派生值丢失 | 记 `metaUnreadable` 并从 jsonl 重建（:297-302、:426-438） |
| `schemaVersion` 不符 | 版本不兼容 | 抛 `SCHEMA_INCOMPATIBLE`，两文件都不动 |

三条判定原则：

**只在文件末尾的问题才允许猜。** 尾部残片后面没有别的记录，跳过它不影响任何其它数据；中间行坏掉意味着中间丢了内容，跳过会让索引从这里开始错位——所以只能报错。

**meta 坏了不能把存储锁死。** 这是评估时抓出来的一个真缺陷：初版对 meta 读不出来直接抛 `META_UNREADABLE`，结果是 jsonl 里明明有三条有效记忆，却因为一个**派生文件**打不开而全部不可达。现在改成当作空 meta、从 jsonl 重建（实测：删掉 meta → 恢复 3 条；把 meta 写成非法 JSON → 恢复 3 条并重建出合法 meta）。仍然拒绝启动的只剩「读得出来但版本不符」——那说明是别的版本写的，不能就地迁移。

**加过换行的残片不能变成「每次启动都报错」。** `append` 发现上次留下的是无换行残片时，会先写一个 `\n` 把它封成独立一行（`store.mjs:510`），否则新记录会和残片粘成一行。但封住之后，那行就从「尾部」变成了「中间」——下次启动会判成 `CORRUPT_MIDDLE_LINE`，存储从此再也起不来。修法是把已报告过的坏行记进 `meta.corruptLines`（:348-352、:430），恢复时先看这张表：在里面就跳过并计数，不在里面才按上面两张表处理。坏字节始终留在文件里，从不删除。

**要不要补换行只看文件末尾，不看最后一行能不能解析。** 初版把 `needsNewline` 只在「最后一行解析失败」的两个分支里置位，于是漏掉了一种更常见的残片：JSON 本体写完整了、只差最后的 `\n`。这种行能正常解析、会被当作健康记录收下，可它没有行尾换行——下一次 `append` 直接往后写，两条记录就粘成一行，重启时这一行已经是中间行，只能拒绝启动，那两条记忆一起不可达。现在 `needsNewline` 在循环之前统一算：`raw.length > 0 && !hasTrailingNewline`（`store.mjs:341`）。复现与修复读数见 `experiments/m2a-store/defects-probe.mjs` 的 1b 项。

### 与 meta 的权威关系

**jsonl 是权威，meta 是派生。** meta 里的 `recordCount` 和 `lastSeq` 都能从 jsonl 推出来，没有任何信息是 jsonl 推不出来的——所以不存在「以 meta 为准能救回一条记忆」的情形，也不该存在「meta 坏了记忆就没了」的情形。反过来说，meta 唯一不可推导的是 `createdAt`（存储创建时间）与 `corruptLines`（已报告过的坏行），这两个字段在重建时从旧 meta 继承（:429-437）。

## 3. 风险与限制

- **单写入者假设**：没有文件锁。两个**进程**（或两个 store 实例）同时写会交错，最后一行可能被撕裂。当前 DSH profile 只起一个实例，这个假设成立；多实例写入需要另做协调，本阶段不做（任务书 §3.3 要求「明确当前版本的单写入者假设」）。
- **同一实例内的并发已串行化**：`append` 走一条私有队列（`store.mjs:459-466`，`#pending` 在 `:214`），并发的 N 次调用会依次执行，`seq` 由队列内读到的最新值生成。修复前的实测是 20 条并发写入只得到 1 个不同的 `seq`（19 条重复），因为两次调用在 `await appendFile` 之前都读到了同一个 `#lastSeq`。队列本身不会因一次失败而断掉：失败只传给这次调用方，后续 `append` 继续排队。
- **`meta` 写失败不算提交失败**：提交点是 `memory.jsonl`（`store.mjs:510`）。`meta` 全是派生值，下次 `open` 会重建；如果这里抛错，调用方会以为没写成功而重试，于是同一段内容被写第二遍——那才是真正的「部分提交」问题。现在只把 `damage.metaWriteFailed` 置位（`:529`），ready 行能看到。
- **没有 fsync**：`appendFile` 返回即认为落盘。断电可能丢掉最后一条已确认的记录。
- **没有上限**：文件会一直长，启动全量重放。M2 已接受；分段或压缩留给 M3。
- **不参与检索**：`search_memory` / `read_memory` 仍然只读 World 的 findings，`store.all()` 目前只给测试和下一阶段用。存储里就算有记录，模型现在也搜不到——这是有意的，M2-a 不实现检索。
- **不做迁移**：`schemaVersion` 一变就拒绝启动。改字段语义时必须同时决定升级路径，不能指望这里自动兼容。
- **meta 损坏可重建，但两个字段会丢**：`createdAt` 与 `corruptLines` 推不出来。meta 坏掉时前者的值重置成「现在」；后者丢失的后果更重——一条**已经封过换行的尾残片**在下次启动时会被重新判成中间坏行，存储从此起不来。这是这条恢复路径的残余风险，只在「meta 损坏与已报告坏行同时发生」时触发；正常情况下 meta 会被重建并写回（`:417-426`）。
- **明文**：记忆是明文 JSONL，访问控制依赖文件系统权限。任务书没有要求加密，这里如实记下。
- **日志不含内容**：ready 行只记计数与损坏分类，路径经 `presentDir`（`memory/index.js:25-33`）把用户主目录缩成 `~`。
- **`apply` 从同步变 async（本轮新引入的行为变化）**：`await MemoryStore.open()` 之后才注册工具，所以 `app.plugin(...)` 返回的那一刻 `search_memory` / `read_memory` 还不存在，要等存储打开完成。DSH 目前没有启动期工具快照（工具由模型按需调用），所以现在没有影响；但任何「插件加载完成即工具可用」的假设都会踩到。这不是理论风险——本轮 CI 上就因此失败过两个用例（Windows runner 的慢盘让 `open` 超过了测试的固定等待窗口），见 `experiments/m2a-ci-verify.md` 第二节。
- **两条代码路径各自 fail-closed，但报错形态不同**：`storeDir` / `DSH_HOME` 传相对路径会在插件加载时抛 `INVALID_INPUT`，整个插件不加载。这是有意的——全局记忆建到 cwd 下比不加载更糟。

## 4. Functional Review

任务书 §3.1 的九项实现逐条对照：

| 要求 | 落点 |
|---|---|
| 全局存储目录初始化 | `store.mjs:277` `mkdir(dir, {recursive:true})`；两条路径分支都拒绝相对路径（`storeDir` throw :76、`DSH_HOME` throw :88） |
| `memory.jsonl` append-only | `store.mjs:510`，只 `appendFile`，无任何重写路径 |
| `memory.meta.json` 元数据管理 | `store.mjs:293-306` 读、`:438` 写（`append` 内为 `:524`） |
| 全局唯一 `memoryId` | `store.mjs:483` `m-${randomUUID()}` |
| 顺序编号 `seq` | `store.mjs:492` `this.#lastSeq + 1` |
| 内存索引构建 | `store.mjs:328-425` 逐行 fold 进 `Map` + `seqOrder` |
| 启动时恢复 | `store.mjs:274-450` |
| 数据结构校验 | `store.mjs:105-158` |
| Schema 版本管理 | `store.mjs:306-310` 校验、`:431` 写回 |

测试覆盖任务书 §5 的十项（`hikari-native/test/memory-store.test.mjs`），另加十一项：8b 中间行非 JSON、8c 中间行合法但记录无效、8d 重复 memoryId 的两种去向、8e meta 损坏可重建、9b 相对路径被拒（两条分支）、11 元数据重建、记录校验正反例，以及修订一的四项（并发 seq 唯一、快照不泄漏 `source`、meta 写失败仍算成功、缺行尾换行不粘行）。**21 项全绿。全量 `npm test` 1107 项 / 1103 pass / 0 fail / 4 skip。**

修订一（用户提出四条缺陷）的复现与修复读数在 `experiments/m2a-store/defects-probe.mjs`：修复前 5 项断言中 1 项通过（`corruptLines` 指向合法行不会丢记录——初版顺序本来就在解析之后才查表，这条经确认无缺陷）、4 项失败；修复后同一探针 6/6 通过（新增 1b「缺行尾换行不粘行」）。

| 缺陷 | 修复前复现读数 | 修复 |
|---|---|---|
| 尾部残片恢复丢失路径 | 1b：写完整 JSON 却不写行尾换行，再 `append` 后两条记录粘成一行，重启时该行成为中间坏行 → 两条一起不可达 | `needsNewline` 改为只看文件末尾有无换行符（`store.mjs:341`） |
| 只读快照引用泄漏 | `store.get(id).source.kind = 'polluted'` 后内部实测 `polluted`；`store.all()[0].source.ref` 同样 | `snapshotOf`（`:197`）：浅拷贝连 `source` 一起拷贝并冻结，`all`/`get`/`append` 三处返回全改用它 |
| 并发追加未串行化 | 20 条并发 `append` 得到 **1 个** 不同 `seq`（19 条重复） | `#pending` 队列（`:214`、`:459-466`），原逻辑整体搬进 `#appendOne` |
| meta 更新失败的部分提交 | `meta` 路径换成目录后 `append` 抛 `EISDIR`，但 `size=2`（jsonl 已写入）→ 调用方重试会造成重复 | `writeFile` 包 try/catch，只置 `damage.metaWriteFailed`（`:524-530`），不抛

数据完整性几条硬要求都有字节级或错误码断言：第 7 项先读原字节、追加残片后再读，断言前缀逐字节相同（原文件未被改写）；第 8 项断言 schema 不兼容时两个文件字节都不变；8b 断言中间坏行拒绝启动且文件一个字节没动；8d 分别断言「内容相同→重放计数 1、size 仍是 1」与「内容不同→`DUPLICATE_MEMORY_ID` 且 `details.memoryId` 对得上」；8e 断言 meta 坏掉后仍恢复 3 条并重建出合法 meta。

## 5. Architecture Review

**隶属关系没变。** Memory 仍然不拥有 Findings（`record_finding` 在 World），不复制 World 的状态，不引入任何跨插件引用。新增的只是 Memory 自己那份数据的存储。

**没有引入依赖。** `store.mjs` 的五条 import 全是 `node:` 前缀；仓库 `devDependencies` 未改。

**`apply` 变成 async 的影响。** Memory 的加载从同步变成异步，Cordis 的 fiber 会等到 Promise resolve 才进 `ACTIVE`。这带来一个真实的行为变化：存储打不开时插件整只拒绝加载，而不是先挂工具、等第一次使用才暴露问题——任务书 §3.2 要求「无法安全恢复的数据明确报错」，拒绝加载就是最明确的报错。副作用有两个：`hikari-native/test/memory.test.mjs` 里固定毫秒的等待在并行跑时不够了（已改成轮询等待）；任何外部代码若假设「`app.plugin()` 返回即工具可用」都会踩空。

**两处偏离 M2 文档，各自有理由：**

1. M2 §9.4 写「单行解析失败 → 跳过计数」。实现改为「尾部跳过、中间报错」。理由：M2 那张表把「跳过」当默认动作，但跳过中间行会让它之后的全部记录错位；任务书 §3.2 明确要求「不得静默丢弃有效记忆」「无法安全恢复的数据明确报错」，两者相加只允许在最末尾做猜测。这张表在 M2 写的时候没有区分「哪一行坏」，本阶段按实际风险重写。
2. M2 §9.4 写「memoryId 重复 → 后者覆盖并计数」。实现改为「内容相同才覆盖计数，内容不同直接报错」。理由：同 id 装两段不同的记忆时，覆盖等于用一个未经裁决的猜测抹掉另一段内容；而内容完全相同的重复只可能是重放（写文件成功但确认失败后重试），覆盖是无损的。这条更严格，不放松 M2 的约束。

**一处偏离「拒绝启动」原则，方向相反但同样收紧：** meta 读不出来时不再拒绝启动，改为从 jsonl 重建。这看着像放宽，实际是纠正——把派生文件的损坏当成致命错误，会让有效记忆全部不可达，那才是真正违反「不得静默丢弃有效记忆」。实测两条路径（删 meta / 写坏 meta）都能恢复全部记录。

评审记录另存：`experiments/m2a-functional-review.md`、`experiments/m2a-architecture-review.md`。
