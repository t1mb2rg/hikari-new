# D0 UIA content-fidelity probe

研究脚本，**不是生产代码**，不被 `src/` 引用，不参与构建。

配套报告：`docs/architecture/desktop-context-understanding-d0-uia-fidelity.md`

## 五个探测脚本

| 脚本 | 回答什么问题 | 输出 |
| --- | --- | --- |
| `uia-matrix.ps1` | **读多少**：每个窗口跑一遍读取策略矩阵 | 节点数、字符数、深度、控制类型、耗时、文本哈希、越界字符占比、新鲜度复读 |
| `uia-consistency.ps1` | **读得对不对**：同一窗口跨策略比对 | 文本包含关系、名称与正文重叠、ValuePattern/TextPattern 交集、焦点元素归属、前台窗口 |
| `uia-ping.ps1` | **目标应用还在响应吗**：发 `WM_NULL` 量应答时延 | 带 epoch 时间戳的响应时延序列 |
| `uia-walk-once.ps1` | **一次走查的边界**：单窗口单次走查 | 节点/字符/哈希 + epoch 起止戳 |
| `uia-hwnd-coverage.ps1` | **树里有没有 HWND**：RawView 走查统计自带 `NativeWindowHandle` 的元素占比 | 逐深度层的节点数 / 带 HWND 数 + `TextPattern` 元素的 HWND 覆盖 |

`uia-hwnd-coverage.ps1` 是为了核查 pywinauto 的深度过滤判据而写的：它对 UIA 后端用 `NativeWindowHandle` 推导 `control_id`，再用它比较深度（报告 §6.3.4）。实测三个应用里**承载正文的 `TextPattern` 元素 100% 没有自己的 HWND**。它**不经过 `run.mjs`**，直接跑即可，配置走环境变量 `HIKARI_HWNDCFG_B64`，结果已落盘为 `hwnd-coverage-1.json`。

## 落盘的结果文件

| 文件 | 内容 |
| --- | --- |
| `full-run-1.json` | 主跑：ChatGPT / msedge / Code 的策略矩阵 |
| `depth-probe-1.json` | 上一轮 0 字符应用的深度 40 重测（QQ / Weixin / cloudmusic / PowerToys.QuickAccess / SystemSettings） |
| `consistency-1.json` | 跨策略一致性、焦点元素归属、前台窗口 | 
| `blocking-1.json` | 并发 ping + walk 的响应性实验 |
| `hwnd-coverage-1.json` | 三个应用的 HWND 覆盖率（报告 §6.3.4） |
| `smoke-out.json` | 深度 6 的冒烟跑，用于证明 `truncatedBy: "depth"` 会随空结果一起返回 |

`uia-consistency.ps1` 是本目录里**不需要 ground truth** 的保真度测量——它抓的是「内部不自洽」这类错误，例如跨 walker 文本不可还原、焦点元素属于别的应用。

`uia-ping.ps1` + `uia-walk-once.ps1` 由 `run-blocking.mjs` 并发驱动：一个进程 ping，另一个走查同一个窗口，按 epoch 切成走查前/中/后三段。`WM_NULL` 是空消息，窗口的消息泵若被占住就答不上来——**只测量，不改变任何东西**。

## 这些脚本做什么

枚举指定进程的**全部顶层窗口**（不只看前台），对每个窗口跑读取策略矩阵，输出**结构、规模与哈希**。

## 这些脚本刻意不做什么

- **不转录任何窗口正文。** 每段文本只被归约为字符数与 SHA-256 前缀（12 位十六进制）。两次读取可以据此比较是否变化，而两次读取的内容都不必被读出来。
- **不调用任何写入模式**：没有 `ValuePattern.SetValue`，没有 `InvokePattern`，没有 `SetFocus`。
- **不点击、不输入、不滚动、不抢前台。**
- **不启动任何应用**（见下「为什么没有合成标记实验」）。

## 环境

- Windows（UI Automation 是 Windows 专有）
- Windows PowerShell 5.1（`powershell.exe`）
- Node.js（仅用于跑批与解析，脚本本身不依赖 node ABI）

## 复现

```bash
cd docs/research/d0-uia-fidelity

# 策略矩阵
node run.mjs config.json full-run-1.json

# 上一轮 0 字符应用的重测（QQ / Weixin / cloudmusic / PowerToys.QuickAccess / SystemSettings）
# 跑之前这些应用必须已在运行，否则探针会跳过，重测不成立
node run.mjs depth-probe.json depth-probe-1.json

# 内部一致性（第三个参数指定脚本，默认 uia-matrix.ps1）
node run.mjs config.json consistency-1.json uia-consistency.ps1

# 阻塞/响应性实验（并发跑 ping 与 walk）
node run-blocking.mjs blocking.json blocking-1.json

# HWND 覆盖率（不经 run.mjs；配置走 HIKARI_HWNDCFG_B64）
# 对 msedge / Code / ChatGPT 各跑一次；目标应用必须已在运行。
# 落盘结果见 hwnd-coverage-1.json（报告 §6.3.4 那张表的来源）
CFG=$(node -e "console.log(Buffer.from(JSON.stringify({target:'Code',maxNodes:4000,maxDepth:40})).toString('base64'))")
HIKARI_HWNDCFG_B64="$CFG" powershell.exe -NoProfile -NonInteractive -File ./uia-hwnd-coverage.ps1
```

> 注意：**不要**加 `-ExecutionPolicy Bypass`——本环境不允许，而且不需要（`-NoProfile -NonInteractive -File` 就够了，`run.mjs` 也是这么调的）。

`config.json`：

| 字段 | 含义 |
| --- | --- |
| `targets` | 目标**进程名**列表（`Get-Process` 的 `ProcessName`，不带 `.exe`） |
| `maxNodes` | 单次遍历节点上限 |
| `maxDepth` | 单次遍历深度上限 |
| `timeBudgetMs` | 单次遍历时间上限（超过则 `truncatedBy: "time"`） |
| `charCap` | 单个 `TextPattern` 元素的取字符上限 |
| `delayMs` | 新鲜度复读的间隔；`0` 表示跳过新鲜度检查 |
| `hardTimeoutMs` | 外层 node 对整个 PowerShell 进程的硬超时 |

## 为什么用 `-File` 而不是 `-EncodedCommand`

第一版照搬了 `src/foreground/windows.ts` 的 `-EncodedCommand` 形状，**失败在 `ENAMETOOLONG`**：base64 之后远超 Windows 约 32 KB 的命令行上限。改用 `-File` 后，复现命令也变成人能读懂、能照着敲的一行。配置仍以 base64 JSON 走环境变量 `HIKARI_PROBE_CONFIG_B64`，因为 PowerShell 5.1 的 `-File` 没有传结构化参数的正规途径。

## 为什么没有合成标记（synthetic marker）实验

D0 mandate 要求「使用合成标记和可控内容验证结果」。**本轮没有做，这是有意的。**

合成标记要求把已知内容放进一个 UIA 可读的窗口，而让内容进入窗口的唯一途径是**创建或驱动一个窗口**（启动一个查看器、或往既有窗口里写字）。这与同一份 mandate 的数据边界「只读，不进行 GUI 操作」冲突，所以在没有 Human 明确许可之前没有执行。

本轮用不依赖 ground truth 的方式覆盖了同一批问题——包含关系、越界污染、名称与正文的重叠、多窗口归属、失败时的误导性返回——见报告 §3。合成标记实验被列为**推荐的下一项有界实验**（报告 §7），方法已写明，拿到许可即可执行。
