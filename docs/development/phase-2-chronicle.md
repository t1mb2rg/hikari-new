# Hikari 第二阶段 P2-02 Chronicle v1 实现

> 状态：**P2-02 已完成**（第二阶段整体进行中，P2-03 / P2-04 未完成）
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体的事实史。
>
> 本文只覆盖 P2-02。第二阶段其余两项不在本文范围内。

## 1. 阶段目标

`core-architecture-v0.md` §6.2 规定 Chronicle 回答：

> “真实发生过什么？”

本阶段只实现这个问题的最小可运行答案：

> 一个 Hikari 可以把一条已经发生的**事实**追加进自己的事实史，并在一次**全新的 Runtime 生命周期**中读回它。

本阶段不实现 Chronicle 的完整领域模型，也不实现「什么值得长期记录」这一判断本身。

## 2. 阶段边界

本阶段明确不做以下事情，并且这些边界已经由代码结构保证，而不只是文档约定：

- 不修改 `src/runtime/`；
- Continuity 不依赖 Chronicle；
- Chronicle 只依赖 Continuity 的公开身份语义；
- Chronicle 不是所有 Plugin 的强制依赖；
- Chronicle 不接管 Event、Memory、World、Goal、Action、状态恢复或判断；
- Event 不自动转为 Durable Fact；
- Chronicle 不决定「什么值得长期记录」；
- 不实现通用 Persistence 抽象；
- 不实现查询 DSL、全文搜索、向量搜索、`update` / `delete`；
- 不实现自动修复、自动截断、迁移、跨进程锁、分布式机制。

## 3. 当前目录

P2-02 新增文件 **13 个**：

```text
src/chronicle/  (10)
  contracts.ts  errors.ts  fact.ts  index.ts  initialize.ts
  open.ts  plugin.ts  service.ts  store.ts  types.ts
test/chronicle.test.mjs                                        (1)
docs/development/phase-2-chronicle.md                          (1)
docs/architecture/phase-2-chronicle-architecture-review.md     (1)
```

修改文件：`docs/development/current-stage.md`。

完整目录：

```text
src/
├─ index.ts                 （未修改）
├─ chronicle/
│  ├─ contracts.ts
│  ├─ errors.ts
│  ├─ fact.ts
│  ├─ index.ts
│  ├─ initialize.ts
│  ├─ open.ts
│  ├─ plugin.ts
│  ├─ service.ts
│  ├─ store.ts
│  └─ types.ts
├─ continuity/              （未修改）
└─ runtime/                 （未修改）

test/
├─ chronicle.test.mjs
├─ continuity.test.mjs
└─ runtime.test.mjs
```

Chronicle 与 Continuity 同级，是 Runtime **之上**的模块：从独立入口 `dist/chronicle/index.js` 导入，包根 `src/index.ts` 未做任何改动。

Chronicle 只使用 Runtime 与 Continuity 的公开表面：

- `runtime/contracts.ts` 的 `defineService`；
- `runtime/plugin.ts` 的 `PluginDefinition`（仅类型导入）；
- `continuity/contracts.ts` 的 `continuityService`；
- `continuity/types.ts` 的 `HikariIdentity`（仅类型导入）。

没有导入 `runtime.ts`、`service-registry.ts`、`event-bus.ts`、`effect-scope.ts` 等内部模块，也没有导入 `continuity/` 的任何存储或校验模块。

## 4. 数据模型

```ts
interface ChronicleStoreHeaderV1 {
  readonly kind: 'hikari-chronicle';
  readonly version: 1;
  readonly owner: string;
}

interface FactSource {
  readonly kind: string;
  readonly reference?: string;
}

interface FactDraft {
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly source: FactSource;
  readonly payload: JsonValue;
}

interface DurableFact {
  readonly factId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly source: FactSource;
  readonly payload: JsonValue;
}
```

职责划分：

- `Draft` 是调用方提供的部分：`type` / `version` / `occurredAt` / `source` / `payload`；
- `DurableFact` 是 Chronicle 记下的事实：调用方的部分 + 由 Chronicle 生成的 `factId` 与 `recordedAt`；
- `ChronicleStoreHeaderV1` 是**持久化格式**，只存在于存储与校验层。

`type` 只是调用方自己的字符串标签。Chronicle **没有**业务 Fact 类型注册表，未知 `type` 不是错误，也不需要预先注册。

`owner` 只写在 Store Header 里，是**整个 Chronicle Store 的主体绑定**；`DurableFact` 内不重复 `hikariId`。Header 不记录 `createdAt`——Chronicle v1 不解释「这个 Store 从何时开始存在」。

### 字段约束

- `factId` 使用 `crypto.randomUUID()` 生成的 UUID v4，校验同样是严格的 v4 形状；
- `occurredAt` / `recordedAt` 使用规范的毫秒精度 UTC，并做往返校验（`parse` 后重新 `toISOString()` 必须与原值一致）；
- `version` 是正整数；
- 未知的多余字段一律被拒绝，避免事实格式悄悄漂移（在 `FactDraft` 上传入 `factId` / `recordedAt` 也是未知字段，会被拒绝）。

Chronicle **不要求** `occurredAt <= recordedAt`，也不推断时间因果关系：它只验证两个时间各自合法。

## 5. Service 契约

```ts
interface ChronicleService {
  append(draft: FactDraft): Promise<DurableFact>;
  get(factId: string): Promise<DurableFact | undefined>;
  read(): Promise<readonly DurableFact[]>;
}

const chronicleService = defineService<ChronicleService>('chronicle', 1);
```

三个方法对外都是异步契约。v1 内部使用的是同步文件 I/O，因此实现里没有 `AsyncMutex`、没有 `WriteQueue`、没有 Promise 队列——异步只是**对外契约的形状**，不是内部并发机制。

- `read()` 按 **append 顺序**稳定返回，不按 `occurredAt` 排序；
- `get()` 未命中返回 `undefined`，**未命中不是异常**；
- `append()` 每次操作前都重新验证整个 Store，持久化失败绝不返回成功；
- Store 已经损坏时，`append()` 拒绝向坏尾巴继续追加。

「绝不返回成功」只有**一个方向**是确定的：**返回成功 ⟹ 这一条已写入且 `fsync` 完成**。反方向**不成立**——失败**不**意味着事实一定没落盘。准确语义见 §8。

Service 只暴露这三个行为，不暴露持久化格式：Header、文件路径、临时文件都留在模块内部。

## 6. initializeChronicle()

只负责显式创建，返回 `void`。

```text
空白状态            → 写入仅含 Header 的 Store → 回读确认 → 返回
已有合法 Store      → 拒绝（ChronicleAlreadyInitializedError）
Store 损坏 / 版本不支持 → 拒绝（InvalidChronicleStoreError / UnsupportedChronicleVersionError）
残留临时文件        → 拒绝（ChronicleAmbiguousStateError）
```

关键性质：

- **只由显式调用触发**。Runtime 启动不会调用它，`chroniclePlugin` 也不会调用它。
- **绝不覆盖**。已有 Store 时无论有效还是损坏，原文件字节都保持不变。
- **写入后必须回读**。创建后重新读取并严格校验，确认 Header 与刚写入的一致、且事实数为 0 才返回；不一致抛 `ChronicleAmbiguousStateError`。
- **返回 `void`**。不返回 Header、不返回 Service，因此调用方无法把「创建」当成「打开」来用。
- **不恢复 Continuity**。它接受调用方已确认的 `HikariIdentity`，自己不去读 `continuity/origin.json`。

### 结构上的保证

`initialize.ts` 内**没有任何 `try` / `catch`**。校验失败的错误直接从 `parseChronicleStore` 向外穿透，因此「捕获失败后自动创建」这一被禁止的模式在该文件里无法写出。

`plugin.ts` 同样不导入 `initialize.js`：Plugin 在结构上不具备创建能力，而不只是「被约定不要创建」。

### 检查顺序：先 Store，后临时文件

正式 Store 存在时，优先报 `ChronicleAlreadyInitializedError`，而不是因为残留 `.tmp` 改报 `AmbiguousState`。

理由：一个是「已经初始化过了」，另一个是「无法证明发生过什么」。前者是更准确、也更有用的诊断；而「有 `.tmp` 残留但没有正式 Store」正是「写入被打断、结果不可证」的特征，此时拒绝才是需要的。

## 7. openChronicle()

只读取和验证，**零写入**。返回已挂载的 `ChronicleService`。

```text
JSONL 读取                 → 验证必须以换行结尾
Header                     → 验证 kind / version / owner 字段
owner == current hikariId  → 否则 ChronicleOwnerMismatchError
逐条 DurableFact           → 否则 InvalidChronicleStoreError
factId 唯一性              → 否则 InvalidChronicleStoreError
返回 ChronicleService
```

```text
Store 不存在        → ChronicleNotInitializedError
owner 不匹配        → ChronicleOwnerMismatchError
版本不支持          → UnsupportedChronicleVersionError
任意记录损坏        → InvalidChronicleStoreError
未知 type           → 不是错误
```

**禁止 `openOrCreateChronicle()`**。缺失无法证明「从未存在」，因此正常恢复路径绝不把缺失 Chronicle 解释为首次初始化。创建与恢复在名字、模块、返回值上都完全分离。

### 零写入如何保证

`open.ts` 只导入 `readStoreForOwner`（纯读取）与 `createChronicleService`：

- 整个模块不导入 `write` / `rename` / `mkdir` / `append` 能力；
- `createChronicleService` 只构造一个 frozen 对象，自身不做任何 I/O；
- 真正写入的 `appendStoreLine` 在整个仓库中**只被 `service.ts` 导入**，而它只在调用方显式调用 `append()` 时才会被执行。

因此「打开」这个动作本身不产生任何字节。测试断言了 `openChronicle` 前后目录清单与文件字节完全一致。

残留 `.tmp` 对 `open` 是惰性的：`open` 只读精确路径 `chronicle/chronicle.jsonl`，不扫描目录，因此残留临时文件既不影响打开，也不会被当作 Store。

## 8. 存储格式

v1 使用固定路径：

```text
<rootDir>/chronicle/chronicle.jsonl
```

`rootDir` 必须由调用方显式提供，没有隐式默认值，不存在往当前工作目录意外写入的可能。

格式：

```text
第 1 行        ChronicleStoreHeaderV1（JSON）
第 2..n 行     每行一个 DurableFact（JSON）
文件必须以 \n 结尾
```

- 最后一行没有完整的 `\n` → `InvalidChronicleStoreError`；
- 不自动截断，不自动修复：损坏的尾巴一律拒绝，绝不「修好一半再继续用」。
- 事实上限不是 v1 的验证项：Chronicle 不设置最大事实数，也不因为文件变大而裁剪历史。

### 初始化写入不能留下半成品

```text
mkdir -p <rootDir>/chronicle
写 chronicle.jsonl.tmp
fsync
rename chronicle.jsonl.tmp → chronicle.jsonl
```

`fsync` 在重命名之前执行，因此重命名发布出去的名字不会指向半截内容。重命名失败直接抛 `ChronicleAmbiguousStateError`，**不做任何重试**——重试属于自动修复。

### 追加写入

`append` 打开正式文件、写入**一整行**、`fsync`、关闭。写入失败（含短写未完成）抛 `ChroniclePersistenceError`，因此调用方不会在事实未落盘时收到成功。

追加前已经重新验证过 Store，所以坏尾巴不会被继续增长。

**`ChroniclePersistenceError` 的准确含义**：它表示**本次写入没有获得可靠的持久化确认**，**不**表示「目标 Fact 一定没有落盘」。

短写、`fsync` 失败、或错误发生在字节已经写出之后时，事实可能已经在文件里，只是没有得到确认。因此：

- 调用方**不得**仅根据这个错误就假定该事实不存在；
- 失败之后重复追加同一条事实会造成什么、如何避免，属于调用方的幂等语义，**不属于 P2-02**；
- Chronicle v1 不做去重、不提供幂等键、不自动重试，也不提供「回读确认到底写没写进去」的补偿路径。

可以确定的只有反方向：**`append` 返回成功，即意味着这一条已经写入并完成 `fsync`**。

这一条是**语义声明，不是测试断言**：失败发生在写入之后才可能出现「已落盘但未确认」，而它在本地无法被确定性地构造出来。测试能覆盖的只有「打开即失败」这一种（§12 第 22 项）。

### 已知的持久性边界

目录本身没有 `fsync`（Windows 不支持），因此断电场景下重命名的持久化仍有一个理论窗口。

这属于 v1 明确不覆盖的范围：补上它需要备份 / 修复类机制，而那是本阶段禁止的。此处如实记录，不通过抽象绕过。

### 并发

跨进程并发不做处理：没有锁、没有租约、没有选主，这些都属于分布式机制。

单进程内因为 `append` 的验证与写入之间没有 `await` 交错（内部全部同步 I/O），检查与追加天然原子。

## 9. JsonValue 运行时校验

`payload` 的类型是 `JsonValue`，不使用 `unknown`：

```ts
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
```

TypeScript 的类型在运行时不存在，因此校验层真的走一遍整棵 payload，拒绝所有会**静默改变语义**或无法可靠 JSON 持久化的值：

```text
undefined / NaN / Infinity / -0
BigInt / Symbol / function
Date / Map / Set / class instance
循环引用
```

其中 `-0` 也被拒绝：它是唯一一个序列化后不回头的有限数（`JSON.stringify(-0) === '0'`），属于同一原则下的静默语义变化。

校验方式是**校验即重建**：校验通过时返回的是一棵重新构造、深度冻结、与调用方入参完全脱离的树。因此调用方之后修改自己的对象，不会影响已经写下的事实，也不会让「校验过的内容」与「实际写入的内容」发生分歧。

数组共享（DAG）允许，循环引用拒绝。

## 10. Chronicle Plugin

```text
id:        'chronicle'
version:   '1.0.0'
requires:  [continuity.current@1]
provides:  [chronicle@1]
```

`setup` 只做一件事：

```text
获取 continuity.current
↓
openChronicle(...)
↓
provide chronicle@1
```

- Continuity 缺失 → Plugin `waiting`；
- Continuity 正常但 Chronicle 缺失 / 损坏 → Plugin `failed`；
- **不调用 `initializeChronicle()`**；
- **不自动创建 Chronicle**；
- 不发 Event、不后台重试、不自动修复。

配置验证要求显式提供非空 `rootDir`，缺失或空白字符串都会在 Plugin 注册前被拒绝。

Chronicle **不是所有 Plugin 的强制依赖**：`chronicle@1` 只有显式声明 `requires` 的消费者才会等待，未声明的 Plugin 完全不受影响。

## 11. 错误面

保持最小，共 9 个，全部继承 `ChronicleError`：

```text
ChronicleError
ChronicleNotInitializedError
ChronicleAlreadyInitializedError
ChronicleAmbiguousStateError
InvalidChronicleStoreError
UnsupportedChronicleVersionError
ChronicleOwnerMismatchError
ChroniclePersistenceError
InvalidFactError
```

没有继续拆出字段级错误类型。错误消息为英文，与 Runtime 和 Continuity 保持一致。

其中 `ChroniclePersistenceError` 的语义是「**本次写入未获得可靠持久化确认**」，而不是「事实一定没落盘」；失败后的重试幂等语义不在 P2-02 范围内。详见 §8。

消息文本与这个语义对齐，使用 `Chronicle fact was not confirmed as persisted: <reason>`，而不是「无法持久化」——**措辞本身不应该暗示事实未落盘**，否则调用方会从错误消息里读出一个代码并未做出的保证。

## 12. 当前测试

本地自动化测试：**56 / 56 PASS**（33 个 Chronicle + 17 个 Continuity + 6 个原有 Runtime，原有测试全部保持通过）。

Chronicle 测试覆盖：

1. 空目录显式 `initialize` 成功，写入仅含正确 `owner` 的 Header；
2. 第二次 `initialize` 被拒绝，且原文件字节不变；
3. 已在损坏 / 不支持版本状态下 `initialize` 被拒绝且不覆盖；
4. 模糊状态（存在残留临时文件）→ 拒绝；
5. Store 不存在时 `open` → `NotInitialized`，且不创建任何东西；
6. `owner` 不匹配 → `OwnerMismatch`；
7. 不支持的 Header 版本 → `UnsupportedVersion`；
8. Header 损坏（非 JSON、非对象、kind 错误、version 缺失 / 类型错误、owner 非法、多余字段、缺少 Header 行）→ `InvalidChronicleStore`；
9. 任意一条 Fact 损坏 → `InvalidChronicleStore`；
10. 最后一行没有完整换行 → `InvalidChronicleStore`；
11. 重复 `factId` → `InvalidChronicleStore`；
12. `open` 忽略残留临时文件；
13. 已有合法 Store 时 `initialize` 报 `AlreadyInitialized`，即使同时存在临时文件残留；
14. `open` 零写入：目录清单与文件字节均不变；
15. `append` 返回合法的 `DurableFact`；
16. `factId` 与 `recordedAt` 由 Chronicle 生成，调用方无法指定；
17. `append` 持久化的字节与它返回的事实完全一致；
18. `read` 按 append 顺序返回，而非按 `occurredAt` 排序；
19. `get` 命中 / 未命中（未命中返回 `undefined`）；
20. 缺失 Store 时 `append` / `get` / `read` 一律报 `NotInitialized`，不重建；
21. Store 损坏后 `append` 拒绝向坏尾巴追加；
22. 持久化失败（文件只读，`EACCES` 发生在**打开阶段**）报 `PersistenceError` 且不报告成功；该场景下文件字节不变——这只覆盖「打开即失败」，**不构成**「失败必然未落盘」的一般保证（见 §8）；
23. 非 JSON-native 的 payload 被拒绝（`undefined` / `NaN` / `Infinity` / `-0` / `BigInt` / `Symbol` / function / `Date` / `Map` / `Set` / class instance / 循环引用）；
24. 非法 `FactDraft` 被拒绝（含传入 `factId` / `recordedAt` / `hikariId` 等未知字段）；
25. 未知 `type` 不是错误，且不强制时间顺序；
26. Chronicle 与 Continuity 共用同一数据目录互不干扰；
27. `append` / `get` / `read` 保持异步契约（返回 Promise）；
28. Service 只暴露契约（键集合精确匹配）；
29. Continuity active + Chronicle 正常 → Plugin `active`；
30. Continuity 不存在 → Plugin `waiting`；
31. Continuity 正常 + Chronicle 不存在 → Plugin `failed`，且不创建 Store；
32. 全新 Runtime 生命周期读回上一个 Runtime 写下的事实；
33. Continuity 不因为 Chronicle 存在与否而受影响。

## 13. 本阶段明确没有实现

仍然没有：

- Memory / World / Goal / Action 的领域实现；
- Event → Durable Fact 的自动转换；
- 「什么值得长期记录」的判断；
- 跨 Runtime 通信；
- 查询 DSL、全文搜索、向量搜索；
- `update` / `delete`；
- 通用 Persistence 抽象、Repository / Adapter / Manager 层；
- 自动修复、自动截断、迁移、压缩；
- 跨进程锁、租约、选举；
- Store 的多版本写入策略。

这些继续服从 `core-architecture-v0.md` 的冻结规则。

## 14. 实现原则

本阶段代码的目标不是尽快拥有完整 Chronicle，而是验证：

> 一个 Hikari 可以把真实发生过的事实追加进自己的事实史，并在全新的 Runtime 生命周期中读回，而 Runtime 与 Continuity 都不需要知道「Chronicle」这个词。

`core-architecture-v0.md` §12.10 的「Chronicle 共享事实，但不共享控制」是本阶段的反 Core 边界原则，没有新增第二套架构原则。

如果后续真实需求暴露当前模型无法表达的问题，再重新做 Boundary Review，而不是提前增加抽象。
