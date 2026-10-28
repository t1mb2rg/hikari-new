# 真实带写入插件 `human-delivery` 在契约层下的投递、资源关闭与重新装载

## 为什么是它

前面几轮真实装载过的插件全是只读的：`foreground` / `input-activity` / `desktop-session-world` / `desktop-session-awareness` / `desktop-session-awareness-loop`，它们读屏幕、读输入、读窗口，不改任何东西。`human-delivery` 是链上第一个**会在操作系统里真的建东西**的领域插件——它 `setup` 时在 Windows 命名管道命名空间里创建一个监听，`defer` 时关掉它。

这正好压在适配层最薄的一处：资源释放不是"状态回滚"，而是真的内核对象消失。

## 被测对象

| 项 | 值 | 源码 |
| --- | --- | --- |
| 插件 id | `human-delivery` | `src/human-delivery/plugin.ts:45-75` |
| 配置 | `{ rootDir: string }`，非空 | `src/human-delivery/plugin.ts:32-43` |
| 管道名 | `\\.\pipe\hikari-human-delivery-` + sha256(rootDir) 前 16 位 | `src/human-delivery/endpoint-path.ts:27-36` |
| 三态投递 | `delivered` / `failed` / `unavailable` | `src/human-delivery/endpoint.ts:97-140` |
| 消息帧 | 一行 JSON 数组 + `\n` | `src/human-delivery/protocol.ts:31-33` |
| 写超时 | 5000 ms | `src/human-delivery/endpoint.ts:14` |

## 读数

脚本 `human-delivery.mjs`，读数 `human-delivery.json`。`rootDir` 是 `os.tmpdir()` 下的临时目录；客户端是本脚本内的受控测试客户端——**没有向任何真实用户终端或外部服务投递**。

| 步骤 | 读数 | 判定 |
| --- | --- | --- |
| 装载（契约层，真实 `config.parse`） | `active` | 配置经真实 `parse` 通过，`setup` 建成监听 |
| 无人连接时投递 | `{outcome:'unavailable'}` | 与 `endpoint.ts` 的三态一致 |
| 测试客户端连上后投递 3 行 | `{outcome:'delivered'}`；客户端收到 1 帧，`JSON.parse` 后与输入逐字相等 | 真投递，真到达 |
| 第二个客户端同时连接 | `gotData:false, closedByHost:true` | 宿主主动断开第二个连接，符合 `endpoint.ts` 的单客户端语义 |
| 客户端连上但不读，灌 60 行 × 60 KB | `{outcome:'failed'}`，**elapsedMs 5013** | 写超时真的走到，不是直接放弃 |
| 卸载插件 | `state` 无记录；`serviceResolvable:false`；客户端 `closed:true`；重连 `ENOENT` | 内核对象真的消失，连接被挂断 |
| 重新装载 | `active` | 同一条管道名可以重建成新监听，未撞 `EADDRINUSE` |
| 重装后再投递 | `{outcome:'delivered'}`，1 帧 | 新监听可用 |
| 收尾卸载 | 重连 `ENOENT` | 干净 |

## 三个值得单独说的点

**一、三态全部走到了。** 只读插件的"资源释放"可以用状态位糊过去；这里不行——`unavailable` / `delivered` / `failed` 三种返回各自对应内核里真实不同的处境，任何一种没有真实走到，就不能说这条路径通。特别是 `failed` 需要客户端真的不读、管道缓冲真的被灌满、5000 ms 真的超时才发生（实测 5013 ms）。

**二、重装没撞 `EADDRINUSE` 是资源关干净的直接证据。** 管道名只由 `rootDir` 决定，同一目录重装必然同名。如果卸载时旧监听没有真的关闭，第二次 `listen` 会直接 `EADDRINUSE`——s1 里就撞过一次（当时用 `app.stop()` 收尾，没 `dispose`）。这一轮顺序是对的，所以能重装。

**三、客户端 `connect` 与服务端 `connection` 不在同一个 tick。** 第一版脚本连上后立刻投递，拿到的是 `unavailable`——服务端的 `client` 引用还没建立。等 150 ms 才稳定。这是读脚本的人容易踩的坑，和适配层无关。

## 这一节证明了什么、没证明什么

证明：

- 带真实副作用的领域插件在契约层下可以完成「装载 → 真实投递 → 真实超时失败 → 卸载 → 资源消失 → 重装 → 再投递」的完整循环，领域代码零改动。
- 资源释放是内核层面可验证的（`ENOENT`、客户端被挂断、服务不可解析），不是状态位声明。
- `config.parse` 的拒绝语义在这个插件上也成立（s1 的 `rootDir` 空串/空白/数字三例）。

没证明：

- 向**真实**人类投递链路（`src/cli/resident.ts` 那侧接的终端）的行为——本轮只用了合成客户端。
- 并发多客户端竞争、超大消息跨帧重组。
- `rootDir` 指向一个不可创建管道的路径（权限拒绝）时的失败语义。
