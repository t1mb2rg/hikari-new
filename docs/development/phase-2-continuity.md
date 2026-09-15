# Hikari 第二阶段 P2-01 Continuity v1 实现

> 状态：**P2-01 已完成**（第二阶段整体进行中，P2-02 / P2-03 / P2-04 未完成）
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体。
>
> 本文只覆盖 P2-01。第二阶段的其余三项不在本文范围内。

## 1. 阶段目标

`core-architecture-v0.md` §6.1 规定 Continuity 回答：

> “这些经历属于谁？”

本阶段只实现这个问题的最小可运行答案：

> 一个 Hikari 可以被**显式创建**，并在一次**全新的 Runtime 生命周期**中恢复为同一个长期主体。

本阶段不尝试实现 Continuity 的完整领域模型，只实现「持续身份」这一条最小生命线。

## 2. 阶段边界

本阶段明确不做以下事情，并且这些边界已经由代码结构保证，而不只是文档约定：

- 不实现 Chronicle；
- 不修改 `src/runtime/` 核心；
- 不实现跨 Runtime 通信；
- 不实现 Memory / Goal / World；
- 不实现自动修复、迁移、备份、身份升级；
- 不提供 `getOrCreate`；
- Runtime 启动绝不自动创建 Hikari；
- 没有 `GlobalIdentityManager` 或任何全局身份中心；
- 不提前引入分布式机制（锁、租约、选举、网络、IPC）。

## 3. 当前目录

P2-01 新增文件 **12 个**：

```text
src/continuity/  (9)
  contracts.ts  errors.ts  index.ts  initialize.ts  origin-record.ts
  plugin.ts  restore.ts  storage.ts  types.ts
test/continuity.test.mjs                                     (1)
docs/development/phase-2-continuity.md                       (1)
docs/architecture/phase-2-continuity-architecture-review.md  (1)
```

修改文件：`package.json` / `package-lock.json`（新增 `@types/node` devDependency）、`docs/development/current-stage.md`。

完整目录：

```text
src/
├─ index.ts                 （未修改）
├─ continuity/
│  ├─ contracts.ts
│  ├─ errors.ts
│  ├─ index.ts
│  ├─ initialize.ts
│  ├─ origin-record.ts
│  ├─ plugin.ts
│  ├─ restore.ts
│  ├─ storage.ts
│  └─ types.ts
└─ runtime/
   └─ （未修改）

test/
├─ continuity.test.mjs
└─ runtime.test.mjs
```

Continuity 是 Runtime **之上**的模块，不是 Runtime 的一部分：它从独立入口 `dist/continuity/index.js` 导入，包根 `src/index.ts` 未做任何改动。

Continuity 只使用 Runtime 的公开表面：

- `runtime/contracts.ts` 的 `defineService`；
- `runtime/plugin.ts` 的 `PluginDefinition`（仅类型导入）。

没有导入 `runtime.ts`、`service-registry.ts`、`event-bus.ts`、`effect-scope.ts` 等内部模块。

## 4. 数据模型

```ts
interface OriginRecordV1 {
  readonly kind: 'hikari-origin';
  readonly version: 1;
  readonly hikariId: string;
  readonly createdAt: string;
}

interface HikariIdentity {
  readonly hikariId: string;
  readonly createdAt: string;
}
```

两者职责严格分离：

- `OriginRecordV1` 是**持久化证据格式**，只存在于存储与校验层；
- `HikariIdentity` 是**对外身份**，是唯一通过 Service 暴露给消费者的形状。

`OriginRecordV1` 不会被直接暴露给消费者。Service 返回的身份对象只包含 `hikariId` 与 `createdAt`，不携带 `kind` / `version` 等持久化字段。

字段约束：

- `hikariId` 使用 `crypto.randomUUID()` 生成的 UUID v4，校验同样是严格的 v4 形状；
- `createdAt` 使用 `new Date().toISOString()`，即明确的毫秒精度 UTC，并做往返校验（`parse` 后重新 `toISOString()` 必须与原值一致），因此 `2026-13-01T00:00:00.000Z` 这类非法日期会被拒绝；
- 未知的多余字段会被拒绝，避免记录格式悄悄漂移。

## 5. Service 契约

```ts
interface ContinuityService {
  readonly current: HikariIdentity;
}

const continuityService = defineService<ContinuityService>('continuity.current', 1);
```

契约通过当前 Runtime 的 `defineService` 定义，标识为 `continuity.current@1`，没有另建注册表，也没有第二套真源。

Service 只回答「当前是谁」，不承担创建、修复、查询历史等职责。

## 6. initializeHikari()

只负责显式创建长期主体。

```text
空白状态        → 创建 Origin Record → 回读确认 → 返回 HikariIdentity
已有有效记录    → 拒绝（AlreadyInitializedError）
记录损坏        → 拒绝（InvalidOriginError / UnsupportedVersionError）
状态模糊        → 拒绝（AmbiguousStateError）
```

关键性质：

- **只由显式调用触发**。Runtime 启动不会调用它，Plugin 也不会调用它。
- **绝不覆盖**。已有记录时无论有效还是损坏，原文件字节都保持不变。
- **写入后必须回读**。创建后重新读取并严格校验，确认与刚写入的记录一致才返回成功；回读缺失或内容不一致都抛 `AmbiguousStateError`，不会返回一个未经确认的身份。
- **没有 `getOrCreate`**。查询与创建是两个不同的调用，不存在把两者合并的入口。

### 结构上的保证

`initialize.ts` 内**没有任何 `try` / `catch`**。校验失败的错误直接从 `parseOriginRecord` 向外穿透。

这不是风格偏好，而是让「捕获恢复失败后自动创建身份」这一被禁止的模式在结构上无法写出：该文件里没有任何可以吞掉错误再继续的代码路径。整个 Continuity 模块只有三处 `catch`，且没有一处会转为创建：

- JSON 解析失败 → 转 `InvalidOriginError`；
- 读取非 `ENOENT` 失败 → 转 `AmbiguousStateError`；
- 重命名失败 → 转 `AmbiguousStateError`。

## 7. restoreHikari()

纯读取。

```text
Origin 不存在              → NotInitializedError
JSON 非法 / 缺字段 / UUID 非法 → InvalidOriginError
version != 1               → UnsupportedVersionError
非 ENOENT 的读取失败        → AmbiguousStateError
```

`restore.ts` 只导入 `readOriginText`、`parseOriginRecord`、`toIdentity` 三个函数，不导入任何 `mkdir` / `write` / `rename` 能力，因此「不创建目录、不写文件、不修复、不升级」是由导入图保证的。

测试同时断言恢复前后目录清单与文件字节完全一致。

## 8. 存储

v1 使用固定路径：

```text
<rootDir>/continuity/origin.json
```

`rootDir` 必须由调用方显式提供，没有隐式默认值，不存在往当前工作目录意外写入的可能。

### 写入不能留下半成品

写入采用「临时文件 + 原子替换」：

```text
mkdir -p <rootDir>/continuity
写 origin.json.tmp
fsync
rename origin.json.tmp → origin.json
```

`fsync` 在重命名之前执行，因此重命名发布出去的名字不会指向半截内容。重命名失败直接抛 `AmbiguousStateError`，**不做任何重试**——重试属于自动修复，超出本阶段边界。

### `.tmp` 残留绝不会被当成合法 Origin

`restore` 只读取精确路径 `continuity/origin.json`，不扫描目录、不做模式匹配。因此临时文件在结构上是惰性的：即使残留内容是一条完全合法、格式正确的记录，也不会被当作身份。

测试覆盖了这一点：只存在 `.tmp` 时恢复返回 `NotInitialized`；已初始化后再放入一条 `hikariId` 不同的合法 `.tmp`，恢复仍然返回磁盘上真实的身份。

### 已知的持久性边界

目录本身没有 `fsync`（Windows 不支持），因此在断电场景下重命名的持久化仍有一个理论窗口。

这属于 v1 明确不覆盖的范围：补上它需要备份 / 修复类机制，而那是本阶段禁止的。此处如实记录，不通过抽象绕过。

### 并发

跨进程并发不做处理：没有锁、没有租约、没有选主，这些都属于分布式机制。

单进程内因为没有 `await` 交错（全部使用同步 I/O），检查与写入天然原子。

## 9. Continuity Plugin

```text
id:        'continuity'
version:   '1.0.0'
requires:  []
provides:  [continuity.current@1]
```

`setup` 只做一件事：调用 `restoreHikari()` 并提供 `current`。

- 恢复成功 → Plugin `active`，并提供 `continuity.current`；
- 恢复失败 → Plugin `failed`，错误可通过 `getPluginError` 读取；
- **不发 Event**，不使用 `context.events`；
- **不后台重试**；
- **不自动修复**；
- **不创建 Hikari**。未初始化时 Plugin 失败后目录仍为空，测试对此有断言。

配置验证要求显式提供非空 `rootDir`，缺失或空白字符串都会在 Plugin 注册前被拒绝，Plugin 不会进入生命周期。

Runtime 自身还会在 `setup` 返回后校验声明的 `provides` 确实已提供，构成第二道防线。

## 10. 当前测试

本地自动化测试：**23 / 23 PASS**（17 个 Continuity + 6 个原有 Runtime，原有测试全部保持通过）。

Continuity 测试覆盖：

1. 空目录 `initialize` 成功；
2. 返回合法 UUID v4 与明确 UTC 时间格式，且两次初始化得到不同 id；
3. 第二次 `initialize` 被拒绝，且原文件字节不变；
4. 已在损坏 / 不支持版本状态下 `initialize` 被拒绝且不覆盖；
5. 新调用上下文 `restore` 得到相同 `hikariId` 与 `createdAt`；
6. Origin 不存在时 `restore` → `NotInitialized`，且不创建任何东西；
7. 非法 Origin（非 JSON、非对象、kind 错误、version 缺失 / 类型错误、UUID 非法 / 非 v4、时间戳格式非法 / 日期非法、多余字段）→ `InvalidOrigin`；
8. 缺字段 → `InvalidOrigin`；
9. 不支持版本 → `UnsupportedVersion`；
10. 模糊状态（`origin.json` 是目录）→ `AmbiguousState`，且 `initialize` 同样拒绝；
11. `.tmp` 残留不被当作合法 Origin（两种情况）；
12. `restore` 零写入：目录清单与文件字节均不变；
13. Continuity Plugin 成功提供 `continuity.current`，消费者插件可读取；
14. Service 只暴露身份，不暴露持久化格式（键集合精确匹配，且不含 `kind` / `version`）；
15. 全新 Runtime 生命周期恢复同一主体；
16. 未初始化时 Plugin `failed`，且目录仍为空；
17. 配置缺失 / 空白被拒绝。

## 11. 本阶段明确没有实现

仍然没有：

- Chronicle；
- Memory / World / Goal；
- 跨 Runtime 通信；
- 设备认证；
- 权限判断；
- 身份迁移、备份、修复、升级；
- `getOrCreate`；
- `GlobalIdentityManager` 或任何全局身份中心；
- 分布式一致性机制（锁 / 租约 / 选举）；
- Origin 记录的多版本写入策略。

这些继续服从 `core-architecture-v0.md` 的冻结规则。

## 12. 实现原则

本阶段代码的目标不是尽快拥有完整 Continuity，而是验证：

> 一个长期主体能否被显式创建、被严格校验、并在全新的 Runtime 生命周期中被恢复，而 Runtime 完全不需要知道「Hikari」这个词。

如果后续真实需求暴露当前模型无法表达的问题，再重新做 Boundary Review，而不是提前增加抽象。
