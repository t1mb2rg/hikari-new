# D0 controlled content ground-truth experiment

研究脚本与结果工件，**不是生产代码**：不被 `src/` 引用，不参与构建，不修改任何架构冻结。

配套报告：`docs/architecture/desktop-context-understanding-d0-content-groundtruth.md`

本实验回答一个问题：**UIA 返回的内容，能否被证明属于指定窗口、指定内容区域和当前状态。**

## 复现

```bash
cd docs/research/d0-uia-groundtruth
node run.mjs out        # 起受控测试窗口，跑 10 个状态 × 4 个策略，落盘全部读取结果
node verify-claims.mjs out   # 把报告要说的每条断言重新锚回磁盘工件；全 PASS 才退出 0
node visibility-rule.mjs out # 三条候选可见性判据 vs PrintWindow 像素
node report-data.mjs out     # 生成报告 §2 的表格
```

`run.mjs` 每次启动会清空 `out/channel/`。**不要手动复用 channel 目录**：残留的 `ready.json` 会让启动逻辑立刻返回一个已经死掉的窗口句柄，残留的 `truth.json` 会静默变成基准真值——两种失败的现场都长得像探针 bug，都不是。

## 分层的两个真值来源

| 来源 | 怎么来的 | 独立于 UIA？ |
| --- | --- | --- |
| **WPF 布局真值** | 测试窗口自己的 `TransformToAncestor` + `ViewportHeight/ExtentHeight/VerticalOffset` | 是 |
| **像素真值** | `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` 抓图，比对标记的唯一颜色 | 是，唯一的非 UIA 通道 |

两者与 UIA 的 `IsOffscreen` / `BoundingRectangle` 构成**三种互不依赖的「可见」定义**，本实验靠它们互相证伪。

## 脚本

| 脚本 | 角色 |
| --- | --- |
| `run.mjs` | 状态矩阵驱动。逐状态下发命令、等状态稳定、重取真值、每策略一个独立进程跑探针（探针挂死由驱动杀掉，这样「应用拒绝回答」才可测） |
| `testwindow.ps1` | 受控 WPF 测试窗口 + 合成内容 + 文件命令通道（`scroll` / `selectTab` / `edit` / `minimize` / `block` / `truth` / `quit`） |
| `focuswindow.ps1` | 抢全局焦点的第三个进程，用来测归属 |
| `probe.ps1` | UIA 读取探针。四种策略：`control` / `raw` / `content` / `targeted`，外加 `focused` |
| `verify-claims.mjs` | 断言核验（74 条）。报告里 §2–§6 的每个数字都从这里出来 |
| `visibility-rule.mjs` | 三条候选「可见性判据」对像素真值的命中/误报 |
| `report-data.mjs` | 从工件生成报告表格 |

## 合成内容

标记文本形如 `GT-A-0001` / `GT-SIDE-0001` / `GT-H-COLLAPSED-0001` / `GT-H-ZEROOPACITY-0001` / `GT-W2-0001` / `GT-FOCUS-0001`，**全局不重复**，因此「读回来了哪个标记」本身就是归属证据。

每个标记有自己的唯一颜色 `RGB(20+(i*37)%200, 20+(i*61)%200, 20+(i*97)%200)`，像素探针按 `PointToScreen` 给出的坐标 ±2 容差比色，以此判定该行是否真的被绘制。

真值文件（`truth-<state>.json`）逐标记记录：区域、所属标签页、声明的隐藏方式（`visible` / `collapsed` / `visibility-hidden` / `zero-opacity` / `automation-name-only`）、有效不透明度、是否在视口内、是否完全在视口内、采样点坐标。

## 状态矩阵

| 状态 | 测什么 |
| --- | --- |
| `baseline` | Alpha 标签页，滚动偏移 0 |
| `scrolled` | 同一标签页滚到 400 |
| `tab-bravo` | 切换到第二个标签页 |
| `tab-hidden` | 切换到含 collapsed / hidden / opacity:0 三种隐藏方式的标签页 |
| `edited` | 回到 Alpha 并改写文本框 |
| `shallow` | `maxDepth=2`，验证截断 |
| `minimized` | 最小化 |
| `foreign-focus` | 第三个进程持有全局焦点 |
| `blocked` | UI 线程停 12 s，探针 6 s 超时 |
| `crosswindow` | 第二个窗口存活时读第一个 |

## 数据边界

- 只操作本实验自己创建的测试窗口。**不驱动任何真实个人应用。**
- `focused` 策略会把全局焦点元素解析出来，但**先确定它属于哪个窗口，只有属于目标窗口时才记录文本**；属于其他窗口的文本只计数、随即丢弃，不落盘。报告 §3.4 引用这条。
- 不向任何外部模型传输内容。本实验没有网络调用。
