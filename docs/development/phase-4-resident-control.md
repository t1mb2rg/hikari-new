# P4-02.1 Resident Local Control v1

> 轮次：**P4-02.1**（P4-02 的从属轮次，不是新的阶段）
> 状态：**实现完成、Functional / Architecture Review 通过、已提交、已 push**
> 提交：`138cf9c feat: add resident local control channel`，CI（Runtime Tests #35516173973）**success**
> 前置：P4-02 `hikari resident` 已收口（commit `0db5516`）
> 本轮开工时的 `origin/main` = `f3d7673`（详见 `current-stage.md` 文首状态）

---

## 0. 本轮回答的问题

P4-02 交付了一个能一直活着的进程，但它留下了一个说不通的地方：

> 在 Windows 上，操作者**没有**任何办法让它优雅地停下来。

P4-02 §11 限制 3 自己记下了这件事：Node 在 Windows 上不把进程间信号当作 POSIX 信号投递，`child.kill()` 一律是终止进程。于是「优雅停机」这条路径在本机**只能同进程内触发**，一个从别的终端启动的常驻，唯一的结束方式是硬杀——而硬杀会让 Runtime 的清理顺序半途而废。

本轮补的就是这一格：

```text
hikari status --data-dir <path>   问一个正在跑的常驻：你现在是什么状态
hikari stop   --data-dir <path>   请求一个正在跑的常驻：按你自己的顺序停下来
```

**这不是运维子系统，是 P4-02 的一条已知限制的收口。** 下面的每一条边界都是为了让它保持这么大。

---

## 1. 冻结边界（逐条对照）

| # | 冻结要求 | 本轮的实现事实 |
| --- | --- | --- |
| 1 | `src/runtime/**` 不修改 | ✅ **零改动**。`git status` 中 `src/runtime/` 无任何条目 |
| 2 | 不创建 Service / Event / Chronicle contract | ✅ 没有新增 Service、没有新增 Event、没有 `chronicle.append` 调用 |
| 3 | 不创建共享 transport 模块 | ✅ `control*.ts` 只被 CLI 自己的三个文件 import，零 Plugin、零 Runtime |
| 4 | 不创建命令注册表 / router / message bus | ✅ 路由是 `src/cli/main.ts` 里两行 `if`；协议只有两个词，见 §3 |
| 5 | 不加入任何 Concern / Goal / Conversation 请求 | ✅ 协议里没有这些词，`readEnvelope` 连多余字段都拒绝 |
| 6 | 不把该 endpoint 宣称为通用 Hikari input | ✅ 头注释明写「不是第二个输入面，不能启动任何东西」 |
| 7 | 不决定未来领域 Plugin 是否共享此 transport | ✅ 未讨论、未预留、未抽象 |
| 8 | 不建立操作员身份认证体系 | ✅ 见 §9 限制 5，明写为**未做**，不做任何暗示 |
| 9 | 不做 daemon / pid / log subsystem | ✅ `git status` 无 pid 文件、无日志文件、无服务安装器 |
| — | 不得写 address file | ✅ **没有写**，见 §2 |

**边界 3 的判据不是「文件放在 `src/cli/` 下」，而是「谁 import 它」。** 全仓 import `control.js` 的只有 `resident.ts`（把 host 交给 endpoint）、`control-endpoint.ts`（监听半边）、`control-command.ts`（发问半边）；import `control-endpoint.ts` 的只有 `resident.ts`。没有任何 Plugin、任何领域模块、任何 Runtime 文件 import 过它们中的任何一个。

---

## 2. Endpoint discovery：派生，而不是发布

**结论：deterministic discovery 成立，没有写 address file。**

```text
canonical dataDir  →  sha256  →  前 16 个 hex  →  \\.\pipe\hikari-resident-<16 hex>
```

`controlEndpointPath(dataDir)` 是两端**共用的同一个函数**，因此它们不是「约定一致」，是**构造上一致**。

选派生而不是发布，是一个关于**「哪个事实回答『有没有常驻在跑』」**的决定：

```text
address file  用一个「记得的事实」回答 —— 文件说常驻还在，而它已经不在了
派生名        由操作系统自己回答 —— 连得上就是活着，连不上就是 ENOENT，
              而 ENOENT 不是缓存的意见，是此刻的真话
```

**canonical 形式**：`realpathSync.native(dataDir)` 给出磁盘上的真实拼写（统一分隔符、去掉尾随分隔符），路径不存在时回落到词法 `resolve()`。两种来源只有在**大小写被剔除**之后才会合流，所以在 win32 上统一转小写。测试用例 4 直接钉死了这一点：`\\.`、尾随 `\`、`toUpperCase()`、`<root>\not-a-subdirectory\..` 四种写法给出**同一个**端点名。

**边界 9 的代价被接受了**：派生名不携带「这个目录是谁的」的任何信息，也无法跨机器寻址。这是**特性**：本轮不打算寻址别的机器。

---

## 3. 协议：一个版本、两个词，封闭

```text
请求   {"protocol":1,"request":"status"}
       {"protocol":1,"request":"stop"}
应答   {"protocol":1,"outcome":"ok",    "lines":[...]}
       {"protocol":1,"outcome":"failed","lines":[...]}
```

**没有 payload、没有 plugin id、没有 routing 字段、没有第三个词。**

这不是靠自律维持的，是靠 `readEnvelope(line, keys)` 的**严格性**维持的：

```text
Object.keys(record).length !== keys.length  →  拒绝
任一 key 缺失                                →  拒绝
```

一个对未知字段宽容的信封，**本身就已经是一个可扩展 schema**——「不预留字段」就从一句对本 build 的描述，变成了一句对下一个 build 的承诺。所以多一个 `payload`、多一个 `pluginId`、多一个 `routing`，今天就会被拒绝（用例 1 逐一断言）。

版本不匹配同样拒绝，不猜、不降级（用例 1）。

**行框定**：管道是字节流，字节流没有消息边界。`ControlLineReader` 只保存「一行的量」的状态，超限即拒绝，不继续缓冲——否则对端可以用一个永不出 `\n` 的流让这一侧无限增长（用例 3，覆盖跨块拼接与两种超限）。

---

## 4. 监听半边（`control-endpoint.ts`）

**它拥有的**：端点的存在、到达字节的框定、以及自己的拆除。
**它不拥有的**：任何请求的含义。它认识的请求交给 host 的两个具名行为，**没有第三个、没有表、没有查表**——因为这两个行为就是它全部的用途。

**它刻意不是一个 handle。** 监听器与**每一个已接受的 socket** 都调用 `unref()`：

```text
常驻用自己 lease 决定自己活多久
→ 一个悄悄接管了这个决定的控制通道，会让那个 lease 变成装饰
```

端点真正要承诺的是**反面**：它必须在进程消失**之前**消失。这就是 `resident.ts` 在 shutdown 里 `await control.close()` 的那一句（见 §6）。

**`close()` 的顺序是「先连接、后监听器」**：只被遗忘的已接受 socket 仍然是一个打开的 handle，那时「已关闭」就只意味着「不再接受新请求」，而不是这个方法承诺的东西。`close()` 幂等，且**在监听器与所有已接受连接都消失之后**才 resolve。

**不说话的客户端**：`setTimeout(5000, () => socket.destroy())`。这不是要报告的错误，是一个要结束的连接；否则一个本地进程可以按住一条连接任意久，而**常驻自己的 shutdown** 会成为等它的那一方（用例 9：原始 `connect()` 不说话，断言该 socket 最终 `destroyed`，且 shutdown 不被拖住）。

---

## 5. 发问半边（`control-command.ts` + `control.ts`）

`status` 与 `stop` 在**同一个文件**里，因为它们是**同一个操作的两个词**：同样的发现、同样的协议、同样的三种失败、同样的退出码。拆成两个文件只会把这具身体逐行复制一遍，然后管结果叫两个命令。

**两种命令在成功路径上都不自己写一句话**——常驻是唯一知道常驻真相的东西，所以它说什么就原样输出什么，退出码跟着它说的走，而不是跟着哪个命令问的走。

**三种结局，其中只有一种是「错误」**：

```text
answered     常驻答了 —— 原样输出，退出码跟随 outcome
absent       ENOENT / ECONNREFUSED —— 「没有正在运行的 Hikari 常驻」，退出码 1
unavailable  其余一切 —— 「无法访问控制通道：<原因>」，退出码 1
```

`ENOENT` 是这里唯一**是答案而不是错误**的失败：这个数据目录的端点上没人听，这恰恰就是「没有常驻在跑」。其余一切——连接被拒、应答读不懂、问话问到一半 socket 关了、超时——都报成**出了事**，因为把它们并入「没有常驻」等于在一个东西存在但坏了的时候，告诉人「这里什么都没有」。

**非 win32**：`controlEndpointPath()` 返回 `undefined`，客户端在**连接之前**就返回 `unavailable`，因此它**永远不会**谎称「没有常驻」——它说的是「本机没有这个通道」。

---

## 6. 常驻侧接线（`resident.ts`）

### 6.1 顺序

```
取得 lease
  ↓  武装终止信号
  ↓  起 endpoint        ← 在加载组合之前
  ↓  加载组合
  ↓  就绪 / 未就绪
  ↓  等到终止被请求
  ↓  finally:  runtime.shutdown()
              ↓  finally:  endpoint.close()
                           ↓  finally:  signals.disarm() → lease.release()
```

**endpoint 在组合加载之前起。** 「正在起来」恰恰是操作者最需要能问一句的窗口，而在 Windows 上这是**唯一**的窗口：宿主无法给另一个进程投递优雅终止，所以在监听器存在之前，结束一个起不来的常驻的唯一办法是硬杀。

**endpoint 在 Runtime 之后关。** 它有意比 Runtime 活得久，并且**只要这个进程还是常驻，它就可达**。这正是让 `ENOENT` 意味「没有常驻」而不是「现在没有」的原因：一个什么都没找到的客户端，被告知的是关于**世界**的真话，而不是关于**时机**的真话。停机没有固定时长，先关掉的 endpoint 会在整段仍在进行的 teardown 期间报告「不存在」。

**承诺换成了另一条**：endpoint 在进程之前消失，而那句 `await` 就是这个承诺。

### 6.2 一个数据目录只有一个端点

操作系统自己执行这件事：同一个管道名上的第二个监听器得到 `EADDRINUSE`。所以这**不是**一个要绕开的端口冲突，它就是「这里是不是已经有一个常驻在跑」的答案——而答案是「是」。

**拒绝启动是唯一诚实的回应。** 一个没有端点却继续跑的常驻，会让两个进程加载同一套组合、写同一个 store，而控制通道继续寻址**先到的那个**：一次 `status` 描述一个进程，一次 `stop` 结束另一个（用例 12）。

原始 errno 不外泄，换成：

```text
数据目录已被另一个 Hikari 常驻占用：<path>。请先运行 hikari stop --data-dir <path> 停止它。
```

---

## 7. `status` 语义：只报告 Runtime 已经知道的事

```text
Hikari 常驻状态：
continuity 状态：active
chronicle 状态：active
...
```

**什么都不探测、什么都不问桌面、什么都不推导。** 一行状态是对**已知**的报告，不是健康检查——`renderStatus` 没有任何办法知道 Runtime 不知道的事。

三条规则：

1. **状态来自 `runtime.getPluginState(id)`**，错误来自 `runtime.getPluginError(id)`。用例 7 故意让组合是「干净的」（`load` 全部报 active），而 fake Runtime 报 `chronicle: 'failed'` 并带着记录下来的错误——打印出来的行必须来自答话**那一刻**的 Runtime，而不是启动那一刻的 `load` 返回值。
2. **「Runtime 里没有这个插件的记录」与「未加载」是两句不同的话**，只有一句会成真。打印 `undefined`、或者借用「未就绪」的措辞，都会把第二句折进第一句。
3. **终止中是一种真实状态**，而且是最需要被看到的一种：shutdown 期间这个 endpoint 按设计仍然可达、Plugin 仍然读作 `active`，所以没有这一行的话，一次发生在 teardown 中途的 status 会描述一个健康但已经在离场的常驻。因此 `signals.isRequested()` 一旦为真就多打一行：

```text
Hikari 常驻正在停止。
```

用例 8 把 shutdown 用一个 promise 按住，断言此刻 status 仍答得出、且带着这一行；随后断言 endpoint 变成 `absent`。

**错误措辞与 `renderNotReady` 共用同一个 `appendFailure`。** 同一份错误用同一种方式描述，无论是从一个没起来的常驻上读到的，还是从一个正在跑的常驻上读到的。第二份拷贝就是同一个问题的第二个答案，而两个答案会漂移。

---

## 8. `stop` 语义：同一条优雅停机路径

`stop` **不是**一条新的停机路径。它走的是 `signals.request()`——与第一个 `SIGINT` / `SIGTERM` 触发的是**同一个**函数、同一个 promise、同一批要摘掉的监听器。

```text
一个要结算的 promise
一处「有人要求这个进程停下」变成可观测的地方
→ 从管道来的请求与作为信号来的请求，不是两套需要保持同步的行为，
  它们是同一个行为
```

**应答先发出去，请求在写操作已 flush 或已死的**先到者**上发出**：

```ts
socket.once('close', ask);
socket.end(encodeControlReply(...), ask);
```

一个问过的人在**任何**情形下都不会同时得到「沉默」和「没有停机」——这两件事不会一起发生。

---

## 9. 已知限制

1. **Windows-only。** Named Pipe 是 Windows 的机制，非 win32 宿主上 `controlEndpointPath()` 返回 `undefined`，常驻**没有**端点（即 P4-02 的行为原样保留），`status` / `stop` 报 `unavailable`。本轮**不打算**做跨平台控制通道，也不做抽象。

2. **没有身份认证。** 任何能在本机连上这个管道名的进程，都能读到状态、都能让常驻停下来。这是**已记录**的限制，不是被忽略的漏洞。
   **范围论证（不是安全论证）**：Pipe 名不发布、不落盘，只在本机内核命名空间内；能连上它的进程与能 `kill` 这个进程的进程是**同一批**——即已经能在本机以同一用户执行代码的进程。因此本轮**没有**新增一个此前不存在的权限边界，也就没有因此建立一个认证体系。**不得**把这句读成「这个通道是安全的」。

3. **`status` 不报告后台 cycle 的健康。** P4-02 §11 限制 1 原样继承：Loop 的 `catch` 是空的，一次采集失败不留痕迹，Runtime 也不会把 active Plugin 的后台 rejection 变成 `failed`。因此 `status` 说 `active` 时，它说的是**Runtime 此刻的记录**，不是「每一轮采集都成功」。

4. **shutdown 没有严格上界。** 继承 P4-02 §11 限制 2：端点会一直等到 `runtime.shutdown()` 结算完成。`close()` 本身不引入新的等待，但它**不会**给一个停不下来的 teardown 设上限。

5. **轮询不是通知。** 本轮没有 `changed` Event、没有订阅、没有推送。`status` 是一次问答，问一次答一次。

---

## 10. 明确没有实现

- ❌ daemon 化 / Windows Service / systemd unit
- ❌ 自动重启 / 崩溃恢复 / 看门狗
- ❌ pid 文件 / 日志文件 / 日志轮转 / 结构化日志
- ❌ 身份认证 / 权限 / ACL
- ❌ 配置重载、运行时改 cadence、任何**写**语义（除 stop 外）
- ❌ 第三个命令词、任何 payload / routing / plugin id
- ❌ 通用 transport / 共享 IPC 模块 / 供 Plugin 使用的通道
- ❌ 非 Windows 实现
- ❌ 任何 P4-03 的内容

**本文件不规划 P4-03。**

---

## 11. 当前文件

| 文件 | 状态 | 内容 |
| --- | --- | --- |
| `src/cli/control.ts` | **新增** | `CONTROL_PROTOCOL_VERSION` / `ControlRequest` / `ControlReply` / `ControlOutcome` / `controlEndpointPath` / `encode*` / `decode*` / `ControlLineReader` / `requestControl` / `controlFailureLines` |
| `src/cli/control-endpoint.ts` | **新增** | `ControlHost` / `ControlEndpoint` / `listenControlEndpoint` |
| `src/cli/control-command.ts` | **新增** | `statusCommand` / `stopCommand` |
| `src/cli/resident.ts` | 修改 | 端点的起停接线、`residentControlHost` / `renderStatus` / `appendFailure`、`TerminationSignals.request()` |
| `src/cli/options.ts` | 修改 | `CliCommand` / `ParsedCommandLine` 扩展、`RESIDENT_HINT`、`USAGE` 两行 |
| `src/cli/main.ts` | 修改 | 两行分派 |
| `test/resident-control.test.mjs` | **新增** | 12 条用例 |
| `test/resident-cli.test.mjs` | 修改 | 探针数据目录改为互异；逻辑用例 stub 掉端点 |
| `docs/development/phase-4-resident-control.md` | **新增** | 本文件 |

**零修改**：`src/runtime/**`、`src/index.ts`、全部 `src/<domain>/**`、`src/cli/start.ts`、`src/cli/init.ts`、`src/cli/chronicle-init.ts`、`test/cli.test.mjs`、`test/runtime.test.mjs`、`package.json`、`tsconfig.json`。

**没有创建 `src/control/`、`src/transport/`、`src/ipc/`。** 这三个文件全部在 `src/cli/` 下，因为控制通道是**这个 CLI 命令的**性质，不是 Hikari 的性质。

---

## 12. 当前测试

`test/resident-control.test.mjs` — **12 条**（3 条跨平台，9 条 win32 门控）：

| # | 测试名 | 承重断言 | 平台 |
| --- | --- | --- | --- |
| 1 | `协议只有一个版本、两个词，多出任何一个字段都被拒绝而不是宽容读取` | `payload` / `pluginId` / `routing` / 错版本 / 缺 key / 数组 / null / 非 JSON 逐一被拒 | 全平台 |
| 2 | `应答的 outcome 与 lines 被检查，而不是被相信` | 未知 outcome、非字符串数组、错版本一律 `unreadable` | 全平台 |
| 3 | `行框定把管道当字节流：跨块的行被拼回，超限的流被拒绝而不是继续缓冲` | 跨块拼接 + 行超限 + 无换行超限 | 全平台 |
| 4 | `端点名由数据目录确定派生，同一目录的不同写法给出同一个端点` | 正则 + 四种等价写法 | win32 |
| 5 | `没有常驻时，控制命令得到的是"没有常驻"而不是一个错误` | `ENOENT` → `absent`，退出 1 + 提示 | win32 |
| 6 | `控制命令只认自己那个数据目录的端点` | 另一个数据目录 → `absent` | win32 |
| 7 | `status 转述的是 Runtime 此刻的记录，stop 走的是同一条优雅停机路径` | 干净组合 + fake Runtime 报 `failed`；stop 后 `isRequested()` 为真 | win32 |
| 8 | `shutdown 进行中 endpoint 仍然在，并且如实报告正在停止` | 按住 shutdown → 仍答得出且带「正在停止」→ 之后 `absent` | win32 |
| 9 | `连接了却不说话的客户端不会拖住 shutdown` | 原始 `connect()` → 被 destroy + shutdown 不被拖 | win32 |
| 10 | `endpoint 不持有进程寿命：没有 lease 时，一个开着端点的常驻照样自行退出` | 无 lease 探针 → 非零退出，且**不**报「未就绪」 | win32 |
| 11 | `真实进程：status 与 stop 通过命名管道找到常驻，并让它优雅退出` | 真实 CLI 常驻 → status 七条 → stop → STOPPED → status `absent` | win32 |
| 12 | `一个数据目录只允许一个常驻：第二个拒绝启动，而不是共用一个端点` | 第二个退出 1 + `已被另一个 Hikari 常驻占用` + stdout 为空 | win32 |

### 测试纪律

- **逻辑用例把端点 stub 掉。** `listenControl` 可被覆盖，因此 8 条 in-process 用例（`test/resident-cli.test.mjs`）派生路径、构造 host，但**不监听任何东西**。理由不是省事：`node --test test/*.test.mjs` 会**并发跑测试文件**，而这些用例一个字都没想说操作系统 handle、没想说文件间顺序、更没想说「一个数据目录一个常驻」。真实监听器有自己的文件，生产接线用例（`test/resident-cli.test.mjs` 第 12 条）与探针用例跑的是**真端点**。
- **探针数据目录必须互异。** 数据目录**就是**控制端点（管道名由它派生），两个探针共用一个路径会派生出同一个名字，第二个会拒绝启动而不是跑成一个无地址的常驻。`probeSequence` 计数器让「互异」不依赖调用者的自觉。
- **win32 门控统一走 `NO_PIPES` 常量**，不是逐条写 `process.platform`。CI 跑在 `ubuntu-latest` 上，这 9 条按设计自我 skip。
- **不断言空 stderr。** 用例 10 断言的是 `doesNotMatch(/Hikari 常驻未启动/)`：探针走的是 Node 的 exit-13 路径（未结算的 top-level await），会打印一条 Node 自己的 warning。那条 warning 正是该路径的**预期签名**，不是失败。

---

## 13. 真实运行结果

```
$ npm test
ℹ tests 234
ℹ pass 233
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 5610.6036
```

### 计数口径

| 环境 | 结果 | 来源 |
| --- | --- | --- |
| 本机 Windows 11 | **234 tests / 233 pass / 0 fail / 1 skipped** | **实际跑过** |
| CI（ubuntu-latest，Runtime Tests #35516173973） | **234 tests / 217 pass / 17 skipped / 0 fail** | **实际跑过**（commit `138cf9c`） |

234 = 222（P4-02 基线）+ 12（本轮），两边的 234 是同一个总数。本机唯一那条 skip 是 `test/resident-cli.test.mjs` 的真实 POSIX 信号用例（win32 无法投递，P4-02 §11 限制 3），它在 CI 上**转成了 pass**；CI 的 17 条 skip 是平台门控的镜像——本轮 9 条 win32 用例自我 skip，其余 8 条是此前就存在的 Windows-only 用例。

**不写耗时常量**：按 P3-03 §13 纪律，只用同一轮同机相对关系下结论。

### Windows 真实进程冒烟（P4-02 §11 限制 3 的直接收口）

```text
ready at t+0s, soaking 40s...
=== alive after 40s: True ===
=== pipes === 1
=== status after 40s ===        （七个 Plugin 全部 active，exit=0）
=== stop ===                   已请求 Hikari 常驻停止。  exit=0
=== resident exit= ===         Hikari 常驻已启动。/ Hikari 常驻已停止。
=== status after stop ===      没有正在运行的 Hikari 常驻。  exit=1
```

**40 s soak 的意义**：测试套件最快也要在几秒内跑完，观察不到「30~40 s 之间慢慢死掉」这一类 bug。这一段确认常驻在 40 s 之后**仍然活着、仍然可寻址（管道恰好 1 个）、仍然答得出完整状态**，并且仍然能被 `stop` 优雅结束。

**这一格从此有了跨进程的直接证据。** P4-02 §11 限制 3 说「Windows 上『真实跨进程信号』这一格没有直接证据」——信号那一格**仍然是空的**（宿主依然不投递），但**「另一个进程能让常驻优雅停机」这一格已经由真实进程填上了**：不是信号，是一个真实存在的第二条通道。

---

## 13.5 图谱变更分析

`git add` 后执行 `detect_changes --scope staged`（索引已先重建，新文件确实进图——重建前 `context("listenControlEndpoint")` 返回 not found）：

```text
changed_files 11 | changed_count 180 | affected_count 36 | risk_level critical
partial / truncated: 无
cycles（check）: clean，cycleCount 0，componentCount 0
```

**`critical` 的构成已逐项定位，没有一项落在 `src/runtime/`：**

| 构成 | 数量 | 说明 |
| --- | --- | --- |
| 文档标题符号 | 36 | 三份 md 的 Section 节点 |
| 新增 `src/cli/control*.ts` 符号 | 76 | 本轮新增文件，全部在 CLI community |
| 新增测试符号 | 39 | 两个测试文件 |
| 修改的既有 CLI 符号 | 29 | `src/cli/resident.ts` / `options.ts` / `main.ts` + 两个测试文件 |

**36 条受影响流程全部落在 CLI community**，分三类：

```text
RunCommandLine → *（12 条）         changed step 全是 execute —— main.ts 新增的两行分派
StatusCommand / StopCommand → *    本轮新增流程
Server / Status / Stop → *         本轮新增流程
ResidentCommand → *                既有流程，changed step 是 residentCommand
```

**`src/runtime/**` 零符号、零流程受影响**——这既与 `git status` 的零改动一致，也是「边界 1」的独立佐证。

**两个既有函数的独立 blast radius 复算**（`impact --direction upstream --summaryOnly`）：

```text
execute（src/cli/main.ts）          risk LOW，direct 1（runCommandLine），module 仅 Cli
residentCommand（src/cli/resident.ts） risk LOW，direct 1（runCommandLine），module 仅 Cli
```

两者 `epistemic: exact`，无 `UNKNOWN`。

**一处已知的工具假阳性，不影响上述结论**：受影响流程里出现 `RunCommandLine → ParseConfig`。`ParseConfig` 是 GitNexus 的**同名符号合并**产物（多处以不同语义存在同名函数），本轮**没有**改动任何 config 解析。该流程的 changed step 仍然只是 `execute`。

---

## 14. 与 P4-02 的关系

本轮**没有**让 P4-02 的任何上限失效，也没有让它的大部分表述改写。两处必须一起读：

```text
P4-02 §11 限制 3   「Windows 无法从外部投递优雅终止」
                   → 信号那一半成立且未变；
                     停机入口那一半由本轮补上（§13）。

P4-02 §12          「❌ hikari status / hikari stop / 任何控制通道」
                   → 该条已被本轮取代。其余各条（daemon / 日志 / 退出码策略表 /
                     配置文件 / 任何 Salience 判断 / 任何 Event consumer / P4-03）
                     **全部仍然成立**。
```

P4-02 §16 的三条限制**一条都没有被本轮改动**：就绪仍然只描述启动那一刻、后台失败仍然在终端上不可见、`assessed@1` 在生产里仍然是 **0 subscriber**。

---

## 15. 一条必须与本轮结论同时出现的上限声明

> **P4-02.1 交付的是「一个操作者能问、能停的常驻」，不是「一个可运维的 Hikari」。**
>
> 本轮真正新增的，是**一个本地进程向另一个本地进程说两句真话的能力**：一句是「你此刻是什么状态」（答案完全来自 Runtime 已经记录的东西），一句是「按你自己的顺序停下来」（走的是与信号完全相同的那一条路）。
>
> 它**一格感知能力都没有新增**，**一条运维能力也没有新增**：没有日志、没有健康检查、没有重启、没有监控、没有认证、没有远程、没有配置。
>
> 四件必须同时记住的事：
>
> 1. **`status` 是转述，不是断言健康**——它说的是 Runtime 此刻的记录（§7、§9 限制 3）；
> 2. **这条通道只在本机、只在 Windows、且**没有任何身份认证****（§9 限制 1、2）；
> 3. **优雅停机有了入口，但没有上界**——停得下来 ≠ 停得快（§9 限制 4）；
> 4. **`desktop-session-awareness-loop.assessed@1` 在生产里仍然是 0 subscriber** —— 常驻现在可以被问了，但**被问不等于被理解**。
