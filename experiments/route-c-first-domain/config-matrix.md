# 真实 `config.parse` 在三侧的拦截对照

对象是两个真实的 Hikari 领域插件，不是探针：

| 插件 | config.parse 位置 | 接受什么 |
| --- | --- | --- |
| `desktop-session-awareness-loop` | `src/desktop-session-awareness-loop/plugin.ts:19-41` | `delayMs` 为 1..2 147 483 647 的整数 |
| `human-delivery` | `src/human-delivery/plugin.ts:32-43` | `rootDir` 为非空字符串 |

三侧：

- **hikari** —— `Runtime.loadPlugin`。配置解析在 `src/runtime/runtime.ts:38`，位于任何记录建立之前，同步抛。
- **cordis** —— `Context.plugin`。裸宿主，`definition.config.parse` 从不被调用（`node_modules/@deepseek-ai/cordis/lib/index.js:957-968` 的 `resolveConfig` 走 Cordis 自己的 `~standard.validate`）。
- **contractLayer** —— PoC-03 契约层。层 2 调 `parse`，抛 `ContractLayerError('config')`。

脚本 `config-matrix.mjs`，读数 `config-matrix.json`。运行 `node experiments/route-c-first-domain/config-matrix.mjs`。

## 汇总

14 个输入 × 3 侧：

| 侧 | 拒绝 | 放行 |
| --- | --- | --- |
| Hikari | 12 | 2 |
| 契约层 | 12 | 2 |
| 裸 Cordis（装载期） | **0** | 14 |

`sameDecisionAll: true`、`sameMessageAll: true` —— Hikari 与契约层对同一批输入的判定与错误消息**逐字相同**。

## 逐行对照

| 输入 | Hikari | 裸 Cordis（装载期） | 契约层 |
| --- | --- | --- | --- |
| `delayMs=100`（合法） | 放行，`waiting` | 放行，`PENDING(0)`，无错 | 放行，`waiting` |
| `delayMs=0` | **拒绝** | 放行 | **拒绝**（layer=config） |
| `delayMs=-1` | **拒绝** | 放行 | **拒绝** |
| `delayMs=1.5` | **拒绝** | 放行 | **拒绝** |
| `delayMs='100'` | **拒绝** | 放行 | **拒绝** |
| `delayMs` 缺字段 | **拒绝** | 放行 | **拒绝** |
| `input=null` | **拒绝** | 放行 | **拒绝** |
| `delayMs=2147483648` | **拒绝** | 放行 | **拒绝** |
| `rootDir=临时目录`（合法） | 放行，`active` | 放行，`ACTIVE(2)`，无错 | 放行，`active` |
| `rootDir=''` | **拒绝** | 放行，**`ACTIVE(2)`** | **拒绝** |
| `rootDir='   '` | **拒绝** | 放行，**`ACTIVE(2)`** | **拒绝** |
| `rootDir=123` | **拒绝** | 放行，`FAILED(3)`，错在 `path.resolve` | **拒绝** |
| `rootDir` 缺字段 | **拒绝** | 放行，`FAILED(3)`，错在 `path.resolve` | **拒绝** |
| `input=null` | **拒绝** | 放行，`FAILED(3)`，错在读 `rootDir` | **拒绝** |

错误消息原文（两侧一致）：

- `desktop-session-awareness-loop requires an integer delayMs between 1 and 2147483647, received 0.`
- `human-delivery requires a non-empty rootDir, received .`

## 关键读数：裸 Cordis「放行」之后分三档

「全部放行」这一句太粗，实际后果是三档，危险程度递增：

1. **静默停住** —— `desktop-session-awareness-loop` 有 `inject` 依赖，依赖没满足时 Cordis 让它停在 `PENDING(0)`，`setup` 从未运行。非法配置**没有任何一处被看过**，而状态看起来是「在等」，不是「错了」。
2. **带病激活** —— `rootDir=''` 与 `'   '` 通过了 `typeof` 检查之后，`humanDeliveryEndpointPath` 照样算出一个管道名，插件真的到 `ACTIVE(2)`，真的开始监听。一个本该被拒的配置变成了一个跑起来的插件。
3. **以无关的错失败** —— `rootDir=123` / 缺字段 / `null` 在后续 `path.resolve` 处抛出类型错误，`FAILED(3)` 的原因指向 `paths[0]` 的类型，与「配置不对」无关。

第 2 档是这三档里唯一「错的东西真的发生了」的一档。

## 与预测的对照

预测是「Hikari 与契约层拒绝同一批输入且消息相同；裸 Cordis 全部放过」。前一条逐字成立；后一条在「装载期是否拒绝」这一维度上成立（0/14），但后果分三档，见上。

## 一条实测中暴露的清理要求

第一版脚本在裸 Cordis 侧只用 `app.stop()` 收尾，`human-delivery` 建的管道没被关掉，于是契约层那一次撞上 `listen EADDRINUSE: address already in use \\.\pipe\hikari-human-delivery-4755568660a78d5a`。改成 `await fiber.dispose()` 后三侧读数才干净。这说明：**资源释放取决于宿主是否真的 dispose，而 `commonest` 的「跑完了」不等于「释放了」**。管道关闭本身的实测在 s3。

## 这一节证明了什么、没证明什么

证明：

- 真实 `config.parse` 在契约层被调用，且拒绝判定与错误消息与 Hikari 逐字一致（3 条判断之一「配置拦截可等价」的直接证据）。
- 裸 Cordis 不具备配置层，且「不具备」的后果不是无害的。

没证明：

- 激活之后的语义（依赖满足后的真实运行）——在 s2。
- 管道的投递与关闭——在 s3。
- 配置对象被冻结（`Object.freeze`）之后的写入行为——本轮未测。
