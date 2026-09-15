# Hikari 第二阶段 P2-01 Continuity v1 Architecture Review

> 结论：**Functional PASS + Architecture PASS**
>
> 范围：单 Runtime、本地进程内、单个 Hikari 主体的持续性身份。
>
> 本文只评审 P2-01。第二阶段整体尚未收口——P2-02 / P2-03 / P2-04 未开始，各自需要单独的 Boundary Review 与 Architecture Review。

## 1. Functional Review

当前实现已经验证：

- 空目录可以显式创建一个长期主体；
- 创建结果携带可靠随机 UUID 与明确 UTC 时间戳；
- 已有有效记录时拒绝再次创建，且不修改原文件；
- 损坏 / 不支持版本的记录会拒绝创建，且不覆盖；
- 新调用上下文可以恢复出相同身份；
- Origin 不存在时给出明确的 `NotInitialized`；
- 非法记录给出 `InvalidOrigin`；
- 不支持版本给出 `UnsupportedVersion`；
- 模糊状态给出 `AmbiguousState`；
- 恢复过程零写入；
- Continuity Plugin 可以成功提供 `continuity.current`；
- 未初始化时 Plugin 失败而不是创建；
- 全新 Runtime 生命周期恢复同一主体。

本地测试：**23 / 23 PASS**（17 个 Continuity + 6 个原有 Runtime）。

**Functional PASS。**

## 2. Runtime 核心未特殊化

`src/runtime/` 的 diff 为空，逐字节未修改。

Continuity 只依赖 Runtime 的公开表面：

- `runtime/contracts.ts` 的 `defineService`；
- `runtime/plugin.ts` 的 `PluginDefinition`（仅类型导入）。

没有导入 `runtime.ts`、`service-registry.ts`、`event-bus.ts`、`effect-scope.ts`，也没有为 Continuity 增加任何钩子、分支或特例。

包根 `src/index.ts` 同样未修改，Continuity 从独立入口导入。

**PASS。Continuity 是 Runtime 之上的模块，不是 Runtime 的一部分。**

## 3. Runtime 不知道 hikariId

在 `src/runtime/` 与 `src/index.ts` 中检索 `hikari` / `continuity` / `identity` / `origin` / `uuid` 等词汇，**零命中**。

Runtime 依然只理解 Plugin 生命周期状态、Service 契约、Event、Effect Scope 与配置验证，没有吸收任何 Hikari 领域语义。

**PASS。**

## 4. initialize / restore 分离

两者是两个独立模块、两套独立错误面：

- `initialize.ts` 只负责显式创建，从不调用 `restoreHikari`；
- `restore.ts` 只负责读取，不具备任何创建能力。

不存在把「查不到就创建」合并起来的入口，也不存在 `getOrCreate` 之类的名称或语义。

**PASS。**

## 5. restore 零写入

`restore.ts` 只导入 `readOriginText`、`parseOriginRecord`、`toIdentity`，不导入任何 `mkdir` / `write` / `rename` / 修复能力。

因此「不创建目录、不写文件、不修复、不升级」由导入图保证，而不只是约定。

测试同时断言恢复前后目录清单与文件字节完全一致。

**PASS。**

## 6. Plugin 不会创建 Hikari

`continuityPlugin.setup` 只调用 `restoreHikari()` 并提供结果。

- 未初始化时 Plugin 进入 `failed`，错误类型为 `NotInitializedError`；
- 测试同时断言此时存储根目录仍为 `[]`，证明失败路径没有创建任何文件或目录；
- 不发 Event、不后台重试、不自动修复；
- 配置缺失 / 空白在 Plugin 注册前即被拒绝，Plugin 不进入生命周期。

**PASS。**

## 7. Service 不暴露持久化格式

对外契约是：

```ts
interface ContinuityService {
  readonly current: HikariIdentity;
}
```

测试断言：

- Service 对象键集合精确等于 `['current']`；
- `current` 键集合精确等于 `['createdAt', 'hikariId']`；
- `current` 上不存在 `kind`；
- `current` 上不存在 `version`。

`OriginRecordV1` 只存在于存储与校验层，没有通过 Service、Plugin 配置或任何导出泄漏给消费者。

**PASS。**

## 8. Continuity 不知道 Chronicle

在 `src/continuity/` 中检索 `Chronicle`，**零命中**。

Continuity 只回答「这些经历属于谁」，不记录发生过什么，也不引用任何事实史结构。`core-architecture-v0.md` §6.1 与 §6.2 的边界在代码中没有被穿透。

**PASS。**

## 9. 没有 getOrCreate

`src/continuity/` 中检索 `getOrCreate`，**零命中**。

创建只能通过显式调用的 `initializeHikari()`，且它在已有记录时一律拒绝。查询只能通过 `restoreHikari()`，且它在记录不存在时一律报错。

两个动作之间没有任何自动补全路径。

**PASS。**

## 10. 没有 GlobalIdentityManager

没有全局身份中心、没有注册表、没有单例服务定位器。

模块级状态只有一个 frozen 的契约常量 `continuityService`，没有任何可变全局状态。

身份由调用方通过显式 `rootDir` 定位，不存在隐式的「当前 Hikari」全局变量。

**PASS。**

## 11. 没有提前引入分布式机制

没有网络、IPC、锁、租约、选举或共识。

跨进程并发不做处理，这是 v1 的有意边界；单进程内因全部使用同步 I/O，检查与写入之间不存在 `await` 交错。

**PASS。**

## 12. 写入一致性

写入采用临时文件 + 原子替换，`fsync` 在重命名之前执行，因此重命名发布的名字不会指向半截内容。

创建成功后必须回读并严格校验，确认与刚写入的记录一致才返回；回读缺失或内容不一致都抛 `AmbiguousStateError`。

`restore` 只读取精确路径 `continuity/origin.json`，不扫描目录，因此 `.tmp` 残留即使内容完全合法也不会被当作身份——这一点由测试覆盖。

**PASS。**

## 13. 当前刻意保留的限制

以下是本阶段的有意限制，不作为缺陷提前抽象：

- 目录未做 `fsync`（Windows 不支持），断电场景下重命名的持久化存在理论窗口；补上它需要备份 / 修复机制，属本阶段禁止范围；
- 跨进程并发不做处理；
- 重命名失败不做重试，直接报错；
- Origin 记录只支持 `version: 1`，没有多版本共存或迁移路径；
- 未知多余字段被拒绝，格式漂移需要显式改版本；
- 身份一旦创建不可更改，没有轮换或升级机制。

这些限制只有在真实需求被阻塞时才触发新的 Boundary Review。

## 14. 图谱变更验证

在 `git add` 本阶段文件之后，重新执行了图谱变更分析。**本次输出实际覆盖了 Continuity 新文件**，因此可以作为图谱侧证据使用。

```text
Changes:        15 files, 124 symbols
Affected:       18 execution flows
Risk level:     critical
partial:        无
truncated:      无
```

`risk_level` 为 **critical**，未做降级处理。其构成已定位：

- 124 个变更符号中，**45 个是文档标题**（GitNexus 把 Markdown 标题也索引为 `Section` 符号）：架构评审 16、实现文档 19、阶段说明 10；
- 其余 **79 个为代码符号**，全部位于 `src/continuity/` 与 `test/continuity.test.mjs`；
- 18 条受影响执行流全部是 `Setup → *` 与 `InitializeHikari → *`，即本阶段新增模块自身的流程；
- **没有任何 `src/runtime/` 符号出现在变更集中，也没有任何 Runtime 执行流受影响。**

即：本次变更对既有代码是纯增量，critical 由「变更体量 + 文档标题计入符号」共同推高，而非由对既有结构的破坏推高。这是对风险来源的判断，不是对告警的豁免——工具本身没有给出 low。

### 工具限制（如实记录）

- **MCP `detect_changes` 不可用**：LadybugDB 文件被其他 GitNexus 进程锁定（`Error 33: another process has locked a portion of the file`）。本机同时存在两个 `gitnexus mcp` 进程（PID 10892、45548）与一个 `gitnexus serve` 进程（PID 51160），锁定源于进程争用。
- 上述结果由 CLI 兜底取得：`node .gitnexus/run.cjs detect-changes --scope all --repo .`
- **`query()` 的关键词与语义检索不可用**：FTS 扩展加载失败（缺少本机运行库），`vectorSearch` 状态为 `unavailable`、`embeddings: 0`。重建索引无法修复。图遍历能力（`context` / `cypher` / `impact` / `trace` / `detect_changes`）不受影响。
- 本次证据由**两个前置条件共同成立**才取得：索引重建（使 Continuity 符号进入图谱）+ `git add`（使新文件进入 diff）。缺少前者，符号无从映射；缺少后者，未跟踪文件不在 diff 中——这正是重建前那次 `changed_count: 0` 的成因。

## 15. 最终结论

P2-01 代码没有发现对 `core-architecture-v0.md` 的结构性穿透，也没有对 Runtime 核心产生任何特化。

```text
Functional PASS
+
Architecture PASS
+
Docs / Contracts updated
```

因此 **P2-01 Continuity v1** 可以正式收口。

第二阶段整体**不能**据此收口：P2-02 / P2-03 / P2-04 未开始，本文的结论不覆盖它们。

> P2-01 已经证明：一个长期主体可以被显式创建并在全新的 Runtime 生命周期中恢复，而 Runtime 完全不需要知道「Hikari」这个词。
