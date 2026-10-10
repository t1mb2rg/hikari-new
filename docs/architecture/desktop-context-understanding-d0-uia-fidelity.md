# HIKARI D0 · UIA Content Fidelity Evaluation

> 本轮为**感知能力评估**，不是实现。不修改生产代码，不 commit，不 push。
>
> 上游：`docs/architecture/desktop-context-understanding-v0-research.md`（VERDICT = NARROW）
>
> 探测脚本：`docs/research/d0-uia-fidelity/`（只读；复现方法见该目录 `README.md`）

---

## 0. 结论摘要

上一轮测的是「**能读到多少**」——8 个真实应用里只有 1 个能通过 UIA 读到文本。本轮测的是「**读到的东西够不够准、够不够新、能不能归属**」。

> **那个「1/8」本轮被部分修正，但修正幅度要说准。** 对上一轮报 0 字符的应用逐个在 `maxDepth=40` 下重测（§2.2.2）：**QQ 与 VS Code 是深度上限造成的假阴性**（2 283 / 3 254 字符，均未截断），**另外 4 个走完整棵树仍是 0 字符**（Weixin / cloudmusic / PowerToys / SystemSettings，深度只到 1 / 3 / 0 / 0 就自然结束）。**所以不是「深度是约束」这么简单——可读的从 1 个升到 3 个，剩下 4 个是真的读不到。**

结论按三问回答：

| 问题 | 实测答案 | 证据 |
| --- | --- | --- |
| 当前正文能否读取 | **能，且完整**。三个目标应用类全部读出正文，全部 walk 都未触发任何截断 | §2.1、§2.4 |
| 内容是否及时 | **是实时的**，不是快照。静态窗口 4 秒后逐字节相同；变化的页面 4 秒内正文增减千字符 | §4 |
| 归属是否正确 | **可判定，但不会自动正确**。归属判据有效，然而「读焦点元素」这条捷径实测会把别的应用的内容当成本窗口的 | §3.4 |

**VERDICT: NARROW**

UIA 在机械层面**足以**充当 D0 第一阶段的正文来源：文本完整、实时、可归属、可控延迟（单窗口 0.4–2.7 s）。但本轮的测量同时给出了**七条必须由读取方自己加的守卫**（§7.3），缺一即产生错误结果；且**内容正确性本身尚未被验证**——没有 ground truth 时只能说「完整、实时、可归属」，不能说「读到的就是用户看到的」。后者需要 §8 的合成标记实验，那是真正的闸门。

一个数字概括失败面：**42 个顶层窗口里只有 3 个是真实内容窗口**（另一组 5 个进程上是 68 → 6），其余是诱饵或噪声（§5.1）。

---

## 1. 方法与证据等级

### 1.1 探测脚本

本轮共五个脚本，都在 `docs/research/d0-uia-fidelity/`：

| 脚本 | 回答什么 | 输出 |
| --- | --- | --- |
| `uia-matrix.ps1` | **读多少**：每个窗口跑一遍读取策略矩阵 | 节点数、字符数、深度、控制类型、耗时、文本哈希、越界字符占比 |
| `uia-consistency.ps1` | **读得对不对**：同一窗口跨策略比对 | 文本包含关系、名称与正文重叠、ValuePattern 与 TextPattern 的交集、焦点元素归属、前台窗口 |
| `uia-ping.ps1` | **目标应用还在响应吗**：发 `WM_NULL` 量应答时延 | 带 epoch 时间戳的响应时延序列 |
| `uia-walk-once.ps1` | **一次走查的边界**：单窗口单次走查 | 节点/字符/哈希 + epoch 起止戳 |
| `uia-hwnd-coverage.ps1` | **树里有没有 HWND**：RawView 走查统计自带 `NativeWindowHandle` 的元素占比 | 逐深度层节点数 / 带 HWND 数 + `TextPattern` 元素的 HWND 覆盖 |

数据：`full-run-1.json`（42 窗口）、`depth-probe-1.json`（68 窗口，重测）、`consistency-1.json`（3 窗口）、`blocking-1.json`（并发实验）、`hwnd-coverage-1.json`（3 应用）、`smoke-out.json`（早期冒烟）。**每个数字在正文里都标了它来自哪一个。**

### 1.2 数据边界遵守

| mandate 约束 | 遵守方式 |
| --- | --- |
| 只读，不进行 GUI 操作 | 无 `SetValue`、无 `InvokePattern`、无 `SetFocus`、无点击/输入/滚动/抢前台/启动应用 |
| 不在报告里转录真实窗口正文 | 每段文本只被归约为**字符数**与 **SHA-256 前缀（12 位十六进制）**；本报告不含任何窗口正文、窗口标题或 URL 原文 |
| 不向外部模型发送真实桌面正文 | 探测全程不联网；没有任何模型调用 |
| 不增加生产 Plugin / Service / Runtime / Language 能力 | 本轮未改 `src/` 下任何文件 |
| 不修改架构冻结，不做 Composition Boundary Review | 未触及 |
| 脚本保留在明确的研究目录 | `docs/research/d0-uia-fidelity/`，含 `README.md` 复现说明 |

### 1.3 证据等级（读本报告前必读）

| 等级 | 含义 | 本报告中的范围 |
| --- | --- | --- |
| **A · 本机实测** | 本机跑出的 JSON，可复现 | §2 §3 §4 §5 全部 |
| **B · 官方文档** | 上游项目的官方文档/源码 | §6（视各条标注） |
| **C · 二手** | 检索结果、未逐字打开的页面 | §6 中标 **[未锚定]** 的条目 |
| **D · 未执行** | 本轮没做的实验 | §8 |

**§6 的特别声明**：§6 是**外部项目调研**，证据来自各项目自身的源码与文档，**不是本机实测**。

调研过程中本机的网页抓取工具对外部域名被拦截，四路调研都改走 shell 的 `curl`（`cdn.jsdelivr.net` / `files.pythonhosted.org` / `raw.githubusercontent.com` / 仓库 tarball），因此**四个项目全部达到源码级**。

其中 **pywinauto 与 UFO² 两节，主 Agent 在本轮自行下载了原始发行物并逐条复核**（PyPI 官方 sdist `pywinauto-0.6.9.tar.gz`；`microsoft/UFO` 的 `ufo/` 源码），本节引用的每一处行号都来自复核过的文件，不是转述子调研的结论。按 `CLAUDE.md` 第九节，**子调研的结论只是候选**，这一层复核是必须的。

**仍未达源码级的**只有 §6.6 CDP 与 §6.7 浏览器扩展两节——它们以文档与摘要为主，各条已按其自身证据标注。

每条结论都带标记：

| 标记 | 含义 |
| --- | --- |
| **[源码]** | 直接读到的该项目源码 |
| **[文档]** | 该项目官方文档 |
| **[未锚定]** | 检索摘要 / 社区来源 / 推断，**未经原始页面确认** |
| **[未读]** | 调研者明示自己没有覆盖到的部分 |

**按 `CLAUDE.md` 第九节，以下全部是候选结论。§7 的判定不依赖 §6。**

---

## 2. 实验矩阵

目标应用：ChatGPT（Electron）、msedge（Chromium）、VS Code（Electron）。配置 `maxDepth=40, maxNodes=3000, timeBudget=30s`。

### 2.1 策略矩阵（仅 3 个真实内容窗口）

`cv` = ControlView，`rv` = RawView，`tv` = ContentView。

| 应用 | hwnd | 标题长 | cv 节点 | **cv 字符** | rv 节点 | **rv 字符** | **tv 字符** | cv/rv/tv 耗时 (ms) | cv/rv 深度 | **cv 越界字符占比** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| msedge | 1118906 | 53 | 1136 | 13 932 | 2448 | 15 090 | 14 892 | 1193 / 2670 / 1465 | 19 / 28 | **36.2 %** |
| Code | 724028 | 62 | 412 | 3 254 | 940 | 4 485 | 3 254 | 399 / 1046 / 583 | 17 / 39 | 1.5 % |
| ChatGPT | 199628 | 7 | 1490 | **28 237** | 2400 | **30 907** | 28 237 | 1453 / 2434 / 1554 | 22 / 35 | **40.8 %** |

### 2.2 与上一轮的对比：把「读不到」拆成两类

#### 2.2.1 同一窗口只改深度上限

同一台机器、同一个 VS Code 窗口（`hwnd=724028`），只改深度上限：

| 配置 | ControlView | RawView | `truncatedBy` |
| --- | --- | --- | --- |
| `maxDepth=6`（`smoke-out.json`） | 12 节点 / **0 字符** | 13 节点 / 0 字符 | **`"depth"`** |
| `maxDepth=40`（`full-run-1.json`） | 412 节点 / **3 254 字符** | 940 节点 / 4 485 字符 | 空（未截断） |

关键在第三列：冒烟跑的空结果**带着 `truncatedBy: "depth"` 标记**——它不是「这个应用读不到」，是「我停在深度 6」。节点数上限（200/3000）两次都没触发。

#### 2.2.2 上一轮那批应用的重测（`depth-probe-1.json`）

单看 VS Code 只能证明「深度上限能造成假阴性」，**证明不了它是不是上一轮那 6 个应用读不到的原因**。所以本轮用同一个探针，对上一轮报告里 0 字符的应用**逐个在 `maxDepth=40` 下重测**（上一轮是深度 10 / 800 节点）。当时 `StarPie` 已不在运行，实测 5 个。

下表把 VS Code 一并列出（它的 ControlView 在上一轮同样是 0 字符），但**它的数据来自主跑 `full-run-1.json`，不在 `depth-probe-1.json` 里**——主跑的目标集是 ChatGPT / msedge / Code：

| 应用 | 上一轮（深度 10）cv / rv | 本轮（深度 40）cv | 本次走查到达深度 | `truncatedBy` | 判定 |
| --- | --- | --- | --- | --- | --- |
| QQ ᵈ | **0 / 0 字符** | cv 457 节点 / **2 283 字符** | 17（rv 29） | 空 | **上一轮判错**，是深度上限 |
| Code (VS Code) ᶠ | **0 / 629 字符** | cv 412 / **3 254 字符** | 17（rv **39**） | 空 | **cv 判错**，是深度上限；rv 上一轮就已部分可读 |
| Weixin | 0 / 0 字符 | cv 3 / **0 字符** | **1** | 空 | 上一轮成立 |
| cloudmusic | 0 / 0 字符 | cv 5 / **0 字符** | **3** | 空 | 上一轮成立 |
| PowerToys.QuickAccess | 0 / 0 字符 | 1 / **0 字符** | **0** | 空 | 上一轮成立 |
| SystemSettings | 0 / 0 字符 | 1 / **0 字符** | **0** | 空 | 上一轮成立 |

> ᵈ 来自 `depth-probe-1.json`。ᶠ 来自 `full-run-1.json`。

> **VS Code 那一行要说准，不能一概说「上一轮判错」。** 上一轮它在 ControlView 下是 0 字符，但在 **RawView 下已经有 629 字符**——上一轮报告自己也在正文里记了这一条。所以对 VS Code 的修正是：**换 ControlView 时它被判成不可读，是深度上限所致**；它的 RawView 当时就部分可读。**QQ 才是干净的「上一轮双向都判成 0、实际可读」案例。**

**上一轮「6 个读不到」不是一个结论，是两个被混在一起的结论。** 现在它们分开了：

1. **深度上限造成的假阴性（QQ、以及 VS Code 的 ControlView 读数）——上一轮判错。** 这两个应用在深度 40 下分别给出 2 283 / 3 254 字符，且**未截断**。
2. **确实没有可读内容（Weixin、cloudmusic、PowerToys、SystemSettings）——上一轮成立。** 这四个的走查在深度 **1 / 3 / 0 / 0** 就自然结束了，**没有触碰任何上限**。原树就那么小，不是「我停早了」。

第 2 类是本轮唯一能给出的**否定性结论**，而且它比第 1 类更强：`truncatedBy` 为空说明遍历跑完了整棵树，所以「0 字符」是**读完了但没有**，不是**没读完**。

#### 2.2.3 分界线是应用的技术栈，不是「应用种类」

把两组按渲染栈排一下就看出规律：

| 应用 | 顶层窗口类名 | 栈 | 深度上限是否是约束 |
| --- | --- | --- | --- |
| QQ | `Chrome_WidgetWin_1`（另有 `Electron_*`） | Electron / Chromium | **是** |
| Code (VS Code) | `Chrome_WidgetWin_1` | Electron / Chromium | **是** |
| ChatGPT | `Chrome_WidgetWin_1` | Electron | 是（但浅界也已可读） |
| msedge | `Chrome_WidgetWin_1` | Chromium | 是 |
| Weixin | `Qt51514QWindowIcon` | Qt | 否（树只有 1 层） |
| cloudmusic | `OrpheusBrowserHost` | 自有宿主 | 否（3 层） |

**Chromium / Electron 系的辅助树深而窄，浅的深度上限会静默返回空；原生 / Qt 系的树本来就浅，浅上限足够，返回的空是真的空。** 这条规则可以解释上一轮的全部读数，而且它给出一条可执行的判据：

> 只看字符数，「读不到」和「读得少」无法区分；**必须同时看 `truncatedBy`**。空结果而 `truncatedBy` 非空 = 我停早了；空结果而 `truncatedBy` 为空 = 真的没有。

#### 2.2.4 重测不改变的东西

QQ 那个有正文的窗口，标题只有 **2 字符**，而同类 `Chrome_WidgetWin_1` 顶层窗口有 **7 个**，其中**只有 1 个可见**。也就是说：**上面对 QQ 的修正是「应用可读」，不是「QQ 容易定位」**——§3.4 / §3.5 的归属与误导问题在 QQ 上原样存在，且比在 ChatGPT 上更严重（ChatGPT 是 3 个同类窗口，QQ 是 7 个）。

同时注意 §2.1 的 3 个窗口是**完整读取**（`truncatedBy` 全空），本节新增的 QQ 也是——**2 283 字符里 284 字在屏幕外（12.4%）**，控制类型分布 `Group=210 Text=131 Image=51 Button=47 Pane=12 ToolBar=3`，**`ToolBar` 与正文混在同一个 ControlView 走查里**（§3.6）。

### 2.3 读取完整性

三个窗口的全部五次 walk（cv / rv / tv / cv-cached / rv-cached）**`truncatedBy` 均为空**——没有一次因节点数、深度或时间预算被截断。

**因此 §2.1 的数字是完整读取，不是抽样。** 这一点让后面的保真度结论有意义：我们比较的是完整文本，不是完整文本的前缀。

### 2.4 策略差异

| 观测 | 结果 |
| --- | --- |
| ContentView vs ControlView | VS Code 与 ChatGPT **完全同哈希**；Edge 不同（该页在两次 walk 之间变化，见 §4） |
| RawView vs ControlView | **三个窗口全部不同哈希**，且 RawView 总是更多字符（1.08× / 1.38× / 1.10×） |
| RawView ⊇ ControlView 文本？ | **否，三个窗口全部 `false`**（§3.1） |
| CacheRequest 是否改变文本 | 静态树（VS Code、ChatGPT）**逐字节相同**；Edge 不同（页面在变化） |
| CacheRequest 是否更快 | **否，三例全部更慢**：1193→2107、399→511、1453→1688 ms |

CacheRequest 更慢有明确原因，不是噪声：本探测缓存的是 `Name` / `ControlType` / `IsOffscreen` 三个属性，而**耗时大头 `TextPattern.DocumentRange.GetText(-1)` 不在缓存范围内**——UIA 的 `CacheRequest` 只批量化你显式 `Add` 的属性，**不缓存 pattern 取值**。因此缓存只增加了激活/停用与查表开销。

> 单样本，不作为基准测试结论。可复现的定性结论是：**缓存对文本提取无收益**。

---

## 3. 内容准确性（保真度）

没有 ground truth，就没有「读得对不对」的绝对答案。但**一批正确性问题不依赖 ground truth 也能判定**——因为一个正确的读取结果必须内部自洽。以下五条都是「内部不自洽就会被抓住」的测量。

### 3.1 跨策略文本不可互相还原（`containment` 全假）

三个窗口，四种包含关系（rv⊇cv、rv⊇tv、cv⊇tv、cv⊇rv）共 12 个布尔值，**唯一为真的是 ChatGPT 的 cv⊇tv**（因为它俩同哈希）。

其余全部为假——**包括 `rawContainsControl`**。RawView 的树是 ControlView 的超集，但拼接出来的**文本不是子串**。

> **含义：换 walker 不是换「读多读少」，是换一串不同的字符串。** 不能用「RawView 覆盖了 ControlView，所以只读 RawView 即可」来简化；也不能拿一个 walker 的哈希去校验另一个 walker 有没有变化。

### 3.2 ValuePattern 与 TextPattern 的文本不相交

| 应用 | TextPattern 字符 | ValuePattern 字符 | `valueInsideText` | LegacyIAccessible 元素 |
| --- | --- | --- | --- | --- |
| msedge | 2 239 | **3 206** | false | **0** |
| Code | 3 266 | 485 | false | **0** |
| ChatGPT | 28 237 | 2 827 | false | **0** |

两件事：

- **ValuePattern 不是 TextPattern 的子集**（三例全 false），Edge 上 ValuePattern 甚至**字符更多**。只读 TextPattern 会漏掉 ValuePattern 独有的那部分。
- **LegacyIAccessiblePattern 在三个应用上都是 0 个元素**。这条兜底路线对 Chromium/Electron 无效，不必再考虑。

### 3.3 名称与正文的重叠

| 应用 | 标题长 | 标题出现在正文中？ | 标题在 RawView 文本中出现次数 |
| --- | --- | --- | --- |
| msedge | 42 | 否 | 0 |
| Code | 62 | 否 | 0 |
| ChatGPT | 7 | **是** | **27** |

ChatGPT 的窗口标题（7 字符）在正文里出现 **27 次**。两个后果：

1. 拼接 `Name + "\n" + 正文` 会重复，且**无法用标题定位正文起点**。
2. 7 字符的标题做子串判断几乎没有信息量——**短标题上，`Contains` 不是有效判据**。

### 3.4 归属：判据有效，但捷径会错

这是本轮最硬的一条，且是**直接实测**而非推断。

`consistency-1.json` 在开头记录了一次全局前台窗口：`process = msedge, hwnd = 1118906`。然后在遍历每个窗口时读 `AutomationElement.FocusedElement`，并沿父链求它所属的顶层 hwnd。

（`full-run-1.json` 用另一套判据独立复现了同一结论：Edge `belongsToThisWindow=true`，VS Code 与 ChatGPT 均为 `false`。两套算法结果一致。）

| 正在遍历的窗口 | 焦点元素所属 hwnd | `isThisWindow` | 焦点元素 ControlType | **焦点元素字符数** |
| --- | --- | --- | --- | --- |
| msedge (1118906) | 1118906 | **true** | Document | 1 486 |
| Code (724028) | **1118906** | **false** | Document | 1 526 |
| ChatGPT (199628) | **1118906** | **false** | Document | 1 253 |

读法：

- **归属判据本身是有效的。** 遍历 VS Code 与 ChatGPT 时，它正确地判定「这个焦点元素不属于本窗口」，没有误判。
- **但捷径会错。** 「读焦点元素」这条路线在遍历 VS Code 时返回的是 **Edge 页面的 1526 个字符**，在遍历 ChatGPT 时返回 Edge 的 1253 个字符。一个不做归属检查的读取方，会把这些字符当成 VS Code / ChatGPT 的内容上报。**这是有具体失败场景的错误结果，不是一个理论风险。**
- 顺带一个正向数字：`FocusedElement` + `GetText` 的耗时是 **4–14 ms**，而整树 walk 是 399–2434 ms。捷径快两个数量级——**这正是它危险的原因**。

**判据自身的边界（必须声明）**：求「所属顶层 hwnd」的方法是从焦点元素沿父链向上找第一个非零 `NativeWindowHandle`，本轮的实现把它**限制在 40 步**，超限就返回 0（即判定「无归属」）。

这个上限不是宽裕的：§6.3 新增的 `uia-hwnd-coverage.ps1` 实测，**三个应用里 100% 的 `TextPattern` 元素都没有自己的 HWND**（msedge 134/134、Code 200/200、ChatGPT 1048/1048），所以这条上行走查**必须**一路爬到窗口根才拿得到 handle。而同一份实测里树的**最深深度是 39**（VS Code）。**39 对 40——余量只有一层。**

> 也就是说：**本轮这张表是正确的，但判据的安全余量几乎为零**。比 VS Code 更深的树会让 `Get-OwningHwnd` 返回 0，`isThisWindow` 随之变成 `false`——**一个「无归属」会被读成「不属于本窗口」**。这是本轮探针自身的缺陷，不是 UIA 的；如果要把它变成守卫（§7.3 第 3 条），**上限必须改成「跟到根为止」或直接与焦点元素所属的顶层窗口做一次 `CompareElements`，而不是数步数。**

### 3.5 读取失败时的误导性结果

全库 42 个顶层窗口里，**38 个不是内容窗口**。其中：

| 类别 | 数量 | 特征 |
| --- | --- | --- |
| `IME` / `MSCTFIME UI` | 13 | **标题长 11、根 nameLen 11、正文字符 0** → `nameIsOnlySignal = true` |
| 其它 `Chrome_WidgetWin_1`（与真实窗口**同类名**） | 3 | ChatGPT 有 3 个 `Chrome_WidgetWin_1`，只有 1 个可见；另两个隐藏但**有内容**（13 节点/7 字符、8 节点/1 字符） |
| `OleDdeWndClass` | 1 | nameLen 17、正文字符 0 → `nameIsOnlySignal = true` |
| 其余（`Chrome_WidgetWin_0`、`crashpad_*`、`Base_PowerMessageWindow`、`OwlElectron_NotifyIconHostWindow`、`Chrome_StatusTrayWindow`、`Electron_SystemPreferencesHostWindow`） | 21 | 1 节点、0 字符 |

`nameIsOnlySignal = true` 共 **14 个窗口**（13 IME/MSCTFIME + 1 OleDde）。

**误导性返回的具体形态**：这 14 个窗口有一个非空的 `Name` 和零个字符的正文。任何在正文为空时回退到 `Name` 的读取方，都会**把这些名字当成内容上报**——而它们不是内容，是窗口标题。13 个 IME 窗口长得一模一样（都是 11 字符），上报出来会是 13 条互相冲突的「内容」。

**归属的危险不只是「选错」，还有「选重」**：按进程名选得到 12–19 个窗口，按窗口类名选（`Chrome_WidgetWin_1`）在 ChatGPT 上得到 3 个。本轮唯一可靠的择一判据是 **可见 + 标题非空**，它在 42 个窗口里恰好选出 3 个。

### 3.6 导航 / 工具栏 / 正文能否区分

在第一层子节点粒度上：**不能。**

| 应用 | 顶层子节点（ControlView） |
| --- | --- |
| msedge | `[Pane nameLen=9, 1 节点, 0 字符]` `[Pane nameLen=0, 1 节点, 0 字符]` `[Pane nameLen=37, **1132 节点, 14894 字符**]` |
| Code | `[Pane nameLen=0, 1 节点, 0 字符]` `[Pane nameLen=62, **410 节点, 3254 字符**]` |
| ChatGPT | `[Pane nameLen=0, 1 节点, 0 字符]` `[Pane nameLen=7, **1488 节点, 28237 字符**]` |

结构非常干净——**一棵大树 + 几个 1 节点空壳**——但**导航、工具栏、标签栏全都在这棵大树里面**。控制类型普查显示 VS Code 的 ControlView 里有 `ToolBar=16`、`TabItem=20`，ChatGPT 里有 `Button=254`；这些都不是正文，但它们和正文在同一个子树内。

**要区分，必须按控制类型二次过滤**，而不是按子树切分。

### 3.7 Targeted Element 的静默截断

按 `ControlType ∈ {Document, Text}` 做 `FindAll`：

| 应用 | matched | scanned | withText | 命中字符 | 占完整 cv 字符 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| msedge | 508 | 400 | 399 | 13 713 | 98.4 % | 174 ms |
| Code | 47 | 47 | 40 | 2 947 | 90.6 % | 42 ms |
| ChatGPT | **737** | **400** | 378 | 19 111 | **67.7 %** | 177 ms |

`FindAll` 本身很快（42–177 ms），但**在 ChatGPT 上，400 的扫描上限让读取方丢掉 32 % 的正文，且不报错**。注意 `matched=737` 与 `scanned=400` 是分开返回的——**读取方必须自己比对这两个数才知道自己截断了**。

> `matched 737 / scanned 400` 这个组合，就是一个「看起来成功、实际漏了三成」的返回。

### 3.8 准确性小结

| # | 判定 | 等级 |
| --- | --- | --- |
| 1 | 文本**完整**：三个应用类全部读出正文，无截断 | A |
| 2 | 换 walker 得到**不同字符串**，不可互相还原 | A |
| 3 | 只读 TextPattern 会漏 ValuePattern 独有内容；LegacyIAccessible 不可用 | A |
| 4 | 焦点元素捷径**会跨应用误取**（实测取到 Edge 内容） | A |
| 5 | 14 个窗口 `nameIsOnlySignal`，回退到 `Name` 即上报垃圾 | A |
| 6 | 导航与正文**不能**按子树切分，只能按控制类型 | A |
| 7 | Targeted 有静默截断（ChatGPT −32 %） | A |
| 8 | **读到的内容与用户所见是否一致** | **未验证（§8）** |

第 8 条是唯一的关键缺口：前七条回答的是「读出来的东西自不自洽」，不是「读出来的东西对不对」。

---

## 4. 新鲜度

同一窗口，间隔 4 秒复读，比较文本哈希。

| 应用 | ControlView 4 秒后相同？ | 字符增减 | RawView 4 秒后相同？ | 字符增减 |
| --- | --- | --- | --- | --- |
| msedge | **否** | **+1 290** | **否** | **+530** |
| Code | 是 | 0 | 是 | 0 |
| ChatGPT | 是 | 0 | 是 | 0 |

读法：

- **读取是实时的，不是快照。** 变化的页面立刻反映出来（Edge 4 秒内正文增加 1290 字符），静态窗口逐字节稳定。
- **但有代价：判不出「这是动态页面」。** 唯一知道内容会变的方法就是**读两次**——那意味着至少 4 秒延迟，而且第二次读数本身也可能已经过期。
- **没有「滚动」或「视口内容变化」的事件原语**（§5.4）。时效性只能靠轮询。

另有一处独立佐证：三次 `FocusedElement` 读数，同一焦点文档在两次读数间从 8627 字符变成 8798 字符（+171），与 Edge 的 +1290/4s 量级一致——**同一个页面在两个不同的测量里独立地表现出了变化**。

### 4.1 本轮**未测**的新鲜度维度（必须声明）

Mandate 点名要求验证的两项，**本轮没有测，因为测它们需要 GUI 操作**，与数据边界冲突：

| 未测项 | 为什么测不了 | 已知的替代证据 |
| --- | --- | --- |
| **窗口与标签页切换后的新鲜度** | 切换标签页/前台窗口是 GUI 操作 | 间接证据：`hwnd` 与前台窗口的绑定是实测的（§3.4）；但「切换后多久读到新内容」没有测 |
| **滚动后的变化** | 滚动是 GUI 操作 | 间接证据：`IsOffscreen` 确实随布局变化（浏览器类 36–44 % 越界），说明越界标记是活的；但「滚动后标记是否立刻翻转」没有测 |
| **内容编辑后的变化** | 编辑是 GUI 操作 | 间接证据：4 秒复读能捕捉到页面自身变化（Edge +1290 字符），说明读取不是快照；但「编辑后多久读到」没有测 |

§8 的合成标记实验正是为了补上这三项——那个实验里，创建的是**研究脚本自己的**窗口，切换/滚动/编辑因此可以在受控前提下执行。

**在此之前，「切换 / 滚动 / 编辑后的新鲜度」一律记为 NOT RUN，不得当作通过。**

---

## 5. 可读范围与限制

### 5.1 窗口层面

| | 数量 |
| --- | --- |
| 三个进程的顶层窗口总数 | **42** |
| 真实内容窗口（可见 + 标题非空） | **3** |
| 比例 | **7.1 %** |

按进程：msedge 12（真 1）、Code 11（真 1）、ChatGPT 19（真 1）。

**这个比例在另一组应用上也成立**，不是三个目标应用的巧合：`depth-probe-1.json` 的 5 个进程（QQ / Weixin / cloudmusic / PowerToys.QuickAccess / SystemSettings）**68 个顶层窗口，只有 6 个可见且有标题**（8.8 %）。**顶层窗口里的绝大多数从来就不是给人看的内容窗口。**

### 5.2 内容层面

| 应用 | 完整正文（cv 字符） | 其中越界 | 完整正文（rv 字符） | 其中越界 |
| --- | --- | --- | --- | --- |
| msedge | 13 932 | **36.2 %** | 15 090 | 34.1 % |
| Code | 3 254 | 1.5 % | 4 485 | 1.1 % |
| ChatGPT | 28 237 | **40.8 %** | 30 907 | **44.4 %** |

**「非当前可见内容是否被混入」的答案：是，浏览器类窗口有三分之一到四成。** ChatGPT 的 ControlView 里 **1217 / 1490 个节点（82 %）被标记为越界**（节点级计数来自 `consistency-1.json` 的 `visibility.offscreenNodes`，它按节点 `IsOffscreen` 逐个数；两次跑的 ChatGPT cv 字符数一致，是同一棵树）。

好消息是 UIA **确实提供了 `IsOffscreen`**，所以这部分是**可过滤的**——但过滤这件事**必须由读取方主动做**，UIA 不会替你排除。

### 5.3 延迟

| 操作 | 耗时 |
| --- | --- |
| 单窗口 ControlView 全文 | 399 / 1193 / 1453 ms |
| 单窗口 RawView 全文 | 1046 / 2434 / 2670 ms |
| 单窗口 ContentView 全文 | 583 / 1465 / 1554 ms |
| Targeted `FindAll` | 42 / 174 / 177 ms |
| **焦点元素 + GetText** | **4 / 14 / 14 ms** |
| 4 窗口矩阵全跑一遍（含 5 策略 + 焦点 + targeted + 子节点 + 新鲜度复读） | 33.9 s（进程墙钟 56.1 s） |

### 5.4 读取是否阻塞目标应用（实测，与外部项目结论相反）

Screenpipe 的仓库文档记录了 UIA 走查会造成目标应用 UI 线程冻结（Edge p95 **213 ms**，2 分钟内 97 次 >100 ms 停顿），并因此把整窗周期走查默认关闭（见 §6.5）。这直接关系到「读一下会不会卡住用户正在用的应用」，所以在本机单独测了一次。

**方法**：两个**互相独立**的进程并发——

- `uia-ping.ps1`：对被读窗口发 `SendMessageTimeoutW(WM_NULL)`（无副作用的空消息），每次带 epoch 时间戳。窗口消息泵若在正常运转，应答在亚毫秒级；若 UI 线程被占住，应答会超时。
- `uia-walk-once.ps1`：对**同一个窗口**跑一次 ControlView 走查，打上 epoch 起止戳。

按 epoch 把 ping 序列切成走查前 / 走查中 / 走查后三段。

**结果**（`blocking-1.json`，ping 超时阈值 200 ms）：

| 应用 | 走查耗时 | 本次走查规模 | 走查前 p50/p95/max | **走查中 p50/p95/max** | 走查后 p50/p95/max | **超时次数** |
| --- | --- | --- | --- | --- | --- | --- |
| ChatGPT | 1057 ms | 1 490 节点 / 28 237 字符 | 0.31 / 0.72 / 7.32 | **0.26 / 0.77 / 9.95** | 0.32 / 0.71 / 8.21 | **0 / 0 / 0** |
| msedge | 360 ms | **492 节点 / 2 803 字符** | 0.30 / 0.65 / 7.01 | **0.25 / 3.40 / 4.03** | 0.34 / 1.50 / 7.06 | **0 / 0 / 0** |
| Code | 339 ms | 412 节点 / 3 254 字符 | 0.35 / 0.82 / 8.61 | **0.30 / 0.87 / 0.91** | 0.31 / 0.74 / 3.70 | **0 / 0 / 0** |

**本机没有观测到阻塞。** 三个应用在走查期间的全部 ping 都在亚毫秒到几毫秒内应答，**零超时**。

> **msedge 那一行的证据强度弱于另两行，必须说明。** 它这次的树只有 492 节点，而 §2.1 的同一窗口是 1 136 节点（13 932 字符）——Edge 页面在两次运行之间变了（§4.1）。所以它 360 ms 的走查**不是**「大页面也不卡」的证据，只是「这棵较小的树不卡」。ChatGPT 那一行规模与 §2.1 完全一致（1 490 / 28 237 逐字相同），是本表最可依托的一行。

**这不推翻 Screenpipe 的结论**，两者条件不同，差异至少有四处：

1. **占空比**：他们跑的是**周期性**整窗走查（2 s 一轮）叠加 focus-change 走查；本轮是**单次**走查。
2. **树是热的**：本轮之前已经跑过 `full-run-1.json` 与 `consistency-1.json`，Chromium 的无障碍树早已建好。**首次**触碰一个 Chromium 窗口要现场构建整棵 AX 树，代价完全不同。
3. **规模**：他们 `max_nodes=5000`、`max_depth=35` 且遍历**所有**应用；本轮 3 个应用、单窗。
4. **归属**：他们那份数字来自**项目自述的文档**（[未锚定]，§1.3 等级 C），不是我在本机复现的。

**结论与未决**：**单次、热树、Chromium/Electron 场景下，读取不阻塞目标应用——这是实测（等级 A）。**「冷树首次读取是否阻塞」「高频周期读取是否阻塞」两个问题本轮**没有测**，它们才是 Screenpipe 那条教训真正指向的场景，应与 §8 的合成标记实验一并做。

**关于第 2 点（热树），§6.4.3c 找到了一条外部旁证**：UFO² 在 `inspector.py:184-186` 留下一句注释，说 UIA COM 枚举**在应用刚启动时会严重变慢**，所以它改用 Win32 取 handle 再转 UIA。

> **这提高了「冷树首读」的优先级，但不能替代实测。** UFO² 描述的是**变慢**，本报告 §5.4 量的是**阻塞**，两者不等价；而且他们说这话时并没有给出数字。它只是把这件事从「我猜可能有」变成「有人确实为此改了实现」。

### 5.5 明确做不到的

- **没有「只读视口内文本」的原语。** UIA 只给 `IsOffscreen` 布尔量，不给几何求交。要「用户此刻看得见的那段」，得自己按 BoundingRectangle 过滤，或者接受越界污染。
- **没有滚动 / 视口变化事件。** 只有属性变更与结构变更事件；时效性靠轮询。
- **没有跨应用统一的「当前文档」概念。** `FocusedElement` 是全局的（§3.4），`Document` 控制类型的语义按应用自定（VS Code 的编辑器、Chromium 的页面都叫 Document，字符规模差一个数量级）。
- **无法从文本反推结构。** §3.1 已证：文本是拼接结果，跨 walker 不可还原，正文与导航在同一条字符串里。

---

## 6. 外部开源项目可借鉴的机制

> **本节证据等级见 §1.3。** 以下均为**候选结论**，不是本机实测。

### 6.1 四个桌面自动化项目 · 四个关键问题

| | Windows-MCP | pywinauto | Microsoft UFO² | Screenpipe |
| --- | --- | --- | --- | --- |
| **怎样定位目标窗口** | `EnumWindows` 枚举全部可见顶层窗口；前台窗口单独标记为 `active` 并排在首位 | `Desktop().window(...)` 惰性 `WindowSpecification`；根节点 `children()` 走 `EnumWindows`（win32）/ `FindAll(Children)`（uia）。**默认后端是 win32**，uia 要显式指定 | 先 `Desktop(backend="win32").windows()` 枚举，**再按 Win32 handle 转成 `UIAWrapper`**（注释：UIA COM 枚举在应用刚启动时会严重变慢）；**默认 attach 已运行窗口**，Bash 启动仅兜底 | `GetForegroundWindow` + `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`；**只走前台那一个窗口** |
| **窗口择一判据** | 需同时具备 `WindowPattern` 且 `CanMinimize`/`CanMaximize`；名字空 **且** 零子元素判为 overlay 丢弃 | `find_element` 要求**恰好一个**命中，否则 `ElementNotFoundError` / `ElementAmbiguousError`；过滤链含 `best_match` 模糊匹配与 `ctrl_index`/`found_index`；0.6.9 的 `windows()` 强制 `visible_only=False` | 由**模型按序号 id 选窗**；`_verify_id` 校验 id 与 name 是否一致，不一致就返回一句给模型的警告而非报错；`remove_empty` 滤掉空标题并**按类名排除 `IME`/`MSCTFIME UI`** | 无需择一（前台唯一）；只有「承载焦点的那块显示器」的帧才配 app/window 元数据 |
| **遍历哪棵树** | **RawViewWalker**（源码里把 ControlView 那行注释掉了） | 默认**不加视图判据**（无判据时返回 `true_condition`，≈RawView）；要 `content_only=True` 才 AND 上 ContentView 条件；唯一显式带视图的是 `parent` → **ControlViewWalker** | UIA 路径固定全 `TreeScope_Descendants`，**没有视图判据**；树（`ui_tree.py`）**只落盘日志**（`SAVE_UI_TREE` 默认 False），**不进 prompt** | **ControlViewWalker**（源码注释：*「Control View … ~50% fewer nodes」*）；RawView 仅可选 |
| **预算** | 500 元素；UIA 路径**无深度上限**，靠预算 + 环检测收敛 | **无默认深度上限**；`descendants(depth=N)` 是**遍历完再筛**，不省遍历成本；判据是 `control_id` 身份比较 | **UIA 路径无深度限制**（`depth` 形参只有 Win32 后端用）；剪枝靠 **15 类控制类型白名单 + 3 个 UIA 谓词 + 硬截断 500**；**语义/图标 top-k 过滤是死代码**（`ControlFilterFactory` 无调用点） | depth 35 / nodes 5000 / **单次走查 250 ms**；按应用自适应降级 |
| **文本从哪来** | `Name` 为主；`LegacyIAccessibleValueProperty` 给 Edit/Document/Image/ComboBox；`TextPattern` **只取选中文本**；**不用 `DocumentRange.GetText`** | `window_text()` = `rich_text` = **`TextPattern.DocumentRange.GetText(-1)`**，任何异常**静默退化为 `Name`**；唯一链条是 `TextPattern → Name`；`ValuePattern`/`LegacyIAccessible` 是独立访问器、**不参与链**；`IME`/`MSCTFIME UI` **按类名硬编码特判** | 进 prompt 的是**扁平 `[{id, name, type}]`** + 两张截图（clean + SoM 标注）；`control_text` 就是 **UIA `Name`**；进度快路径**主动**把 `Name` 写进 `rich_text` 占位（源码注释自陈）；正文另靠 pywinauto `texts()` | ControlView 树文本为主；判定树「稀疏」或为空时 **OCR 兜底** |
| **不可访问怎么办** | dead element **静默剪枝**；walker 坏掉则 latch 永久改用 `FindAll`；**UIA 调用无超时**，缓解手段是**按进程排除** | 失败**大面积静默**：`NoPatternInterfaceError`、`COMError` → `''`/`None`/`False`、子元素枚举失败 → `[]` 且只记日志；响的是 `ElementNotEnabled`/`ElementNotVisible` 与 win32 的 `IsHungAppWindow`；**UIA 的 `wait_for_idle()` 是空实现**；**文本读取无超时** | 失败**降级不抛**：`return []` + `logger.warning`（与 §3.5 同类的静默空）；可加 `omniparser` 视觉后端兜底、按 IoU 去重合并（OCR 在 OmniParser 侧）；`MCP_FALLBACK_TO_UI` 默认开 | 单次 250 ms 预算 + 专用单线程 worker（上限 2 条）；逐应用自适应预算 |

### 6.2 Windows-MCP — 值得借鉴的三条

**[源码]** 仓库 `CursorTouch/Windows-MCP`，默认分支 `main`（`pyproject.toml` 0.8.7）。

1. **浏览器按 `RootWebArea` 门槛切到「DOM 模式」，然后把 chrome 整体丢弃。**
   条件挂在子元素的 `AutomationId == "RootWebArea"`（Chrome/Edge 约定）上；进入后把 DOM 节点的坐标**裁剪到 `dom_bounding_box`**，且 `use_dom` 为真时 `get_nodes` **只返回 DOM 节点**——导航、工具栏、标签栏一并消失。Firefox 没有 `RootWebArea`，改走 IA2 的 `ROLE_DOCUMENT` 门槛达到同一效果。

   > **这一条正面回答了本报告 §3.6 的未解问题。** 本轮实测「导航与正文不能按子树切分」；Windows-MCP 的做法是**不按子树切，而按一个约定标记切**，并且切得比 ControlView 更狠。

2. **环检测必须独立于预算，因为环不吃预算。**
   用 `RuntimeId` 与祖先链比对，重复即剪枝。源码注释点名触发场景是 **Edge 展开的 `<select>`**，并明确写道：环不产生输出节点、不吃 budget，所以预算抓不到它。

   > 本轮**没有做环检测**（无深度环，未触发）。这条说明：预算上限不能替代环检测。

3. **walker 本身会坏，且要 latch。**
   某些配置下（注释点名 Windows ARM64 跑 x86 模拟）`RawViewWalker.GetFirstChildElement` 对每个元素都返回 NULL。策略：只对**前 3 次**空遍历用 `FindAll` 交叉验证，一旦发现漏子就**永久 latch**，之后跳过 walker。

   > 这是「读取器静默返回空」的一种**具体成因**，正是 §3.5 那类误导性结果的上游。本轮三应用中未出现，但不能假定不存在。

**另记两条与本轮直接对照的差异**：

- Windows-MCP **不使用 `TextPattern.DocumentRange.GetText` 取整段正文**，正文靠 `Name` 与词级 `TextRange.Move(TextUnit.Word, 1)` 拼。本轮恰恰只用 `DocumentRange.GetText`。**两条文本路线没有互相验证过。**
- Windows-MCP **UIA 调用没有超时**（阻塞 COM），README 承认「一个病态的 accessibility provider 可以拖住捕获」，给的办法是**按进程排除**而不是超时。本轮同样**没有超时**，只有节点/深度/时间预算——而时间预算只在节点之间检查，**卡在单个元素上的调用它救不回来**。

### 6.3 pywinauto — 值得借鉴的三条，与一条**不要照抄**的

**[源码]** `pywinauto` 0.6.9 官方 sdist（PyPI `pywinauto-0.6.9.tar.gz`，本轮自行下载解包核对，非转述）。引用格式 `pywinauto/<file>:<line>`。**本轮没有运行 pywinauto**，以下均为源码阅读 + 与本机实测对照；标 **[未运行]** 的是纯静态结论。

#### 6.3.1 它的 `window_text()` 就是我们用的那一次调用，且回退是静默的

```python
# pywinauto/base_wrapper.py:293
return self.element_info.rich_text

# pywinauto/uia_element_info.py:149-157
if not self.class_name:
    return self.name
try:
    pattern = get_elem_interface(self._element, "Text")
    return pattern.DocumentRange.GetText(-1)
except Exception:
    return self.name  # TODO: probably we should raise an exception here
```

**[源码]** 这是**第三个独立实现**落在同一个原语上：pywinauto 的「窗口文本」对本轮关心的元素类型就是 `TextPattern.DocumentRange.GetText(-1)`，与本报告 §2 用法一致；Windows-MCP 则**刻意不用它**（§6.2）。

**更值得注意的是那个 `except Exception: return self.name`**：任何异常都静默退化成 `Name`，且作者自己在同一行留了 `# TODO: probably we should raise an exception here`。

> **这是 §3.5 `nameIsOnlySignal` 陷阱的第三方确认——而且是一个成熟库在源码里承认自己那一手是错的。** 本报告 §7.3 守卫集里「`Name` 不是正文」那条，因此不是本轮的孤立发现。

#### 6.3.2 它对 IME / MSCTFIME 窗口做了硬编码特判——正是本轮量到的那 13 个

```python
# pywinauto/handleprops.py:60-63
if class_name == 'IME':
    return 'Default IME'
if class_name == 'MSCTFIME UI':
    return 'M'
```

**[源码]** 本轮 §3.5 实测：机器上 **13 个 `IME` / `MSCTFIME UI` 顶层窗口，标题长 11 字符、零正文**，是「有名字所以看起来可读」的主要来源。

> pywinauto 独立踩到了同一个坑，并**按类名逐个打补丁**。它说明这不是这台机器的偶然现象，而是这一类窗口的固有行为。同时它也说明**打补丁不是好办法**——补丁只覆盖了两个已知类名，本轮实测里还有一个 `OleDdeWndClass`（nameLen=17）属于同一类。**可执行的判据是「有没有正文」，不是「类名在不在名单里」。**

#### 6.3.3 它把「新鲜」当默认，并且显式在返回前把缓存关掉

```python
# pywinauto/findwindows.py:309-318
for elem in elements:
    elem.set_cache_strategy(cached=False)
```

**[源码]** 枚举期间开着 `cache_enable=True` 求快，**返回前再把每个元素的缓存关掉**。win32 后端则是**完全没有缓存**（`win32_element_info.py:71-73`，`pass  # TODO: implement a cache strategy for native elements`）。UIA 后端默认读 `Current*` 活值，只有显式 `set_cache_strategy(cached=True)` 才记忆化——且那是 **Python 层记忆化，不是 UIA `CacheRequest`**。

> 与本轮 §4 的新鲜度结论、以及 §2.4「`CacheRequest` 只增开销不增新鲜」**方向一致**：一个成熟库的选择是「宁可慢，也不要陈旧」。这是支持 §7.3 不做读取缓存的独立旁证。

#### 6.3.4 **不要照抄**：它的深度上限不是遍历界，而且身份判据在本轮关心的树上缺失

**[源码]** 两件事分开说。

**(a) `depth` 是遍历完之后的后置过滤，不省遍历成本。**

```python
# pywinauto/element_info.py:138-146
return [element for element in elements if element.has_depth(root, depth)]
```

`descendants()` 先把整棵子树 `FindAll` 物化成 Python 列表，**再**按深度筛。所以传 `depth=N` 不会让你少走一个节点——它只让你少拿到一些。**照抄这个形状不会得到任何遍历保护**，而 §2.2.3 已经证明深度恰恰是浏览器系真正会咬人的那一维。

**(b) 它的深度判据是 `control_id` 身份比较，而正文元素没有 `control_id`。**

```python
# pywinauto/element_info.py:126-135
def has_depth(self, root, depth):
    if self.control_id != root.control_id:
        if depth > 0:
            return self.parent.has_depth(root, depth - 1)
        else:
            return False
    else:
        return True

# pywinauto/uia_element_info.py:206-211
def control_id(self):
    if (self.handle):
        return controlid(self.handle)
    else:
        return None
```

对 UIA 后端，`control_id` **由 `NativeWindowHandle` 推导**，没有自己的 HWND 就是 `None`。

用本轮新增的 `uia-hwnd-coverage.ps1` 直接量了这件事（RawView，`maxDepth=40`）【实测】：

| 应用 | 树节点 | 自带 HWND 的节点 | 覆盖率 | `TextPattern` 元素 | **其中无自带 HWND** |
| --- | ---: | ---: | ---: | ---: | ---: |
| msedge | 1 125 | 4 | **0.4%** | 134 | **134（100%）** |
| Code (VS Code) | 940 | 4 | **0.4%** | 200 | **200（100%）** |
| ChatGPT | 2 400 | 3 | **0.1%** | 1 048 | **1 048（100%）** |

（三次运行的原始输出落在 `docs/research/d0-uia-fidelity/hwnd-coverage-1.json`。复查时复跑了一遍：`withHwnd`、覆盖率、`textEls`、`textElsWithoutOwnHwnd` **四个数逐字复现**；只有 ChatGPT 的节点数从 2 400 变成 2 399——活动中的会话窗口在两次运行之间多/少一个节点，不是判据变化。另：三棵树的最深到达深度分别是 33 / 39 / 35，全部低于契约深度上限 40，说明这张表量的是完整的树。）

**三个应用里，承载正文的 `TextPattern` 元素 100% 没有自己的 HWND。** 也就是说：`has_depth` 所依赖的那个身份值，在**每一个真正有文本的元素上都是同一个 `None`**，它无法区分「在第 3 层」与「在第 30 层」。

> **[未运行]** 本轮没有执行 pywinauto，所以**没有**观测到 `descendants(depth=N)` 实际多返回还是少返回。能站得住的只是：**它用来判深度的那个量，在本轮关心的三类应用上不存在。** 一条设计纪律由此成立——**当你的内容元素没有 HWND 时，不要把深度界建在从 HWND 推导出的身份上。**

#### 6.3.5 另外两条对照

- **「先找后读」的超时与「读」无关。** `Timings.window_find_timeout=5s` / `window_find_retry=0.09s` 只作用于**定位**控件；**文本提取没有 pywinauto 层的超时**。win32 路径上唯一的保护是长度探测那 500 ms（`handleprops.py:71-79`，`SendMessageTimeout` + `SMTO_ABORTIFHUNG`），而**紧接着的 `WM_GETTEXT` 是普通 `SendMessageW`——阻塞、无超时**（`handleprops.py:93-94`；`win32functions.py:510`）。UIA 后端的 `wait_for_idle()` 则是**空的**：`pass # do nothing by deafault`（`base_wrapper.py:913-916`，原文拼写如此）。

  > **第三个实现，同样没有读超时**（对照 §6.2 Windows-MCP 与 §5.4 本轮的探针）。§7.3 的「单次读取必须有超时」因此是三个实现共同的空缺，不是本轮的苛求。

- **视图选择：默认不是 ContentView。** `build_condition` 在无判据时返回 `true_condition`（`uia_defines.py:125`），要 `content_only=True` 才 AND 上 `UIA_IsContentElementPropertyId`（`:115-117`）；唯一显式带视图的 walker 是 `parent` 用的 **`ControlViewWalker`**（`uia_element_info.py:258-264`）。

  > 这与 §6.8 的跨项目冲突一致：**walker 的选择在三个项目里三种答案**，而且 §3.1 已经证明它们的文本**互相不可还原**。没有一条「正确」的 walker，只有「对本应用可读性更好」的 walker。

### 6.4 Microsoft UFO² — 值得借鉴的两条，与三条**与传言不符**的事实

**[源码]** `github.com/microsoft/UFO` 默认分支，UFO² 是其中的 `ufo/` 子目录（仓库 README 整体已换到 UFO³ 品牌，**只读 `ufo/` 才是 UFO²**）。本轮自行下载源码核对，引用格式 `ufo/<file>:<line>`。**本轮没有运行 UFO²。**

#### 6.4.1 它默认**不**给模型看控制树——这条最容易被传错

| 常见说法 | 源码实际 |
| --- | --- |
| 「UFO² 把 UIA 控制树喂给模型」 | **错。** 进 prompt 的是**扁平列表** `[{id, name, type}]`（`ufo/agents/processors/strategies/app_agent_processing_strategy.py:855-857` 的 `to_list(keep_keys=["id","name","type"])`，序列化点 `ufo/prompter/agent_prompter.py:268`）。**没有 rect、没有父子关系。** |
| 「它的 UI tree 是核心表示」 | **树只写日志。** `ufo/automator/ui_control/ui_tree.py` 确实存在，唯一调用点 `_capture_ui_tree`（`app_agent_processing_strategy.py:148-150, 292`）把它 `json.dump` 落盘，且被 `save_ui_tree` 门控——默认 **`SAVE_UI_TREE: False`**。 |
| 「它靠启动应用来做事」 | **错。** 默认是 **attach 到已运行窗口**：`Desktop(backend="win32").windows()` 枚举 → 转 `UIAWrapper` → 用**枚举序号**当 id 选窗（`ufo/automator/ui_control/inspector.py:179-204`、`ufo/client/mcp/local_servers/ui_mcp_server.py:201-243`）。Bash 启动只是枚举不到时的兜底。 |

> **对本报告的意义**：UFO² 是这条路上最完整的公开实现之一，而它的选择是**不把树给模型**。这与本报告 §7 的取向一致——D0 第一阶段要交付的是**可归属的文本**，不是一棵完整的树。

#### 6.4.2 它的剪枝**完全**靠查询条件与白名单，不靠相关性打分

**[源码]** 三层，全部在 UIA 查询侧：

1. **控制类型白名单**（`config/ufo/system.yaml:31`，15 类：`Button/Edit/TabItem/Document/ListItem/MenuItem/ScrollBar/TreeItem/Hyperlink/ComboBox/RadioButton/Spinner/CheckBox/Group/Text`）。全仓库只用在一处：`ui_mcp_server.py:758-759, 784-785`。
2. **三个 UIA 属性谓词**，`CreateAndConditionFromArray` 组装（`inspector.py:333-370`）：

   ```python
   UIA_IsEnabledPropertyId      == True
   UIA_IsOffscreenPropertyId    == not is_visible     # is_visible 默认 True
   UIA_IsControlElementPropertyId == True
   CreateOrConditionFromArray([ControlType == t for t in control_type_list])
   ```

3. **硬截断 500**：`inspector.py:266` — `for n in range(min(com_elem_array.Length, 500))`。

**注意两件事**：

- **白名单之外没有深度限制。** `find_control_elements_in_descendants` 有 `depth` 形参，但**只有 Win32 后端用**（`inspector.py:434-437`）；UIA 路径强制全 `TreeScope_Descendants`。与 §6.3.4 对照：**pywinauto 与 UFO² 都没有在 UIA 路径上真正限制深度**，而 §2.2.3 已经证明深度正是浏览器系会咬人的那一维。
- **语义 / 图标 top-k 过滤是死代码。** `control_filter.py` 里的 `TextControlFilter` / `SemanticControlFilter` / `IconControlFilter` 都在，但 repo 级 grep：`ControlFilterFactory` 与 `CONTROL_FILTER_TYPE` **只出现在自身定义和配置 schema 里，没有任何调用点**，默认值 `CONTROL_FILTER_TYPE: []`。

  > **所以「UFO² 证明了相关性过滤有效」是不成立的——那段代码不在管线上。** 本报告不能把它当作先例。

- **`UIA_IsOffscreenPropertyId == False` 是本报告可以直接借鉴的一条。** 它把越界过滤放在**查询条件里**，而不是查完再筛。对照 §5.2：本轮实测 msedge 36.2% / ChatGPT 40.8% 的字符在屏幕外；**在查询侧排除越界元素，比读完之后按 `IsOffscreen` 过滤更省也更早**。（Screenpipe 的几何做法更强，见 §6.5——两者不冲突，可叠加。）

#### 6.4.3 它对本报告 §3.5 的确认，以及一句直接印证 §5.4 未测项的注释

**（a）第四次独立确认「`Name` 被当作正文」。** `inspector.py:294-296`：

```python
# currently rich text is not used, skip fetching but use name as alternative
# this could be reverted if some control requires rich text
element_info._cached_rich_text = elem_name
```

作者**主动**用 `Name` 顶替 rich text，并注明「如果某些控件需要 rich text 可以改回来」。加上 pywinauto 的 `except Exception: return self.name`（§6.3.1）、Windows-MCP 的 `Name` 为主（§6.2），**这是第四个独立实现落进同一个坑**。§7.3 那条守卫不是本轮的苛求。

**（b）第三家把 `IME` / `MSCTFIME UI` 按类名排除。** `inspector.py:190-197` 的 `remove_empty`：

```python
app.window_text() != ""
and app.element_info.class_name not in ["IME", "MSCTFIME UI"]
```

加上 pywinauto 的 `IME → 'Default IME'` / `MSCTFIME UI → 'M'` 特判（§6.3.2），**三个互不相关的项目为同一类窗口打了三份不同的补丁**，而本轮实测这类窗口有 13 个（§3.5）。**这是本报告最干净的一条跨项目收敛。**

**（c）它观测到的现象，正是本轮 §5.4 留下的未测项。** `inspector.py:184-186` 的注释：

```python
# UIA Com API would incur severe performance occasionally (such as a new app just started)
# so we use Win32 to acquire the handle and then convert it to UIA interface
```

> §5.4 记录的两个未测场景之一是 **「冷树首读」**——本轮三棵树的数字都是在多次预热之后取的，所以「阻塞为零」不能外推到刚启动的应用。UFO² 的注释说明**有人确实遇到了「应用刚启动时 UIA COM 严重变慢」**，并为此绕道 Win32 取 handle。
>
> **这不能替代实测**（UFO² 说的是「变慢」，本报告 §5.4 量的是「阻塞」，两者不等价），但它把「冷树首读」从猜测提升为**有外部先例的待测项**，支持把它列进 §8 的下一项实验。

#### 6.4.4 它的失败形态与本报告同源，且论文自己承认了

`_collect_uia_controls` / `_collect_grounding_controls` 失败时 `return []` + `logger.warning`；`find_control_elements_in_descendants` 在 `window.is_enabled()` 抛异常时直接 `return []`。

> 这与 §3.5 是**同一类**误导性返回：**读失败伪装成「这里没有内容」**。

**[文档]** 论文（arXiv:2504.14603）Failure Analysis 自述：

> *"On the WAA benchmark, more than 62% of failures were attributed to Control Detection Failures, highlighting significant gaps in standard UIA API coverage—especially for third-party applications (e.g., LibreOffice) that do not strictly comply with UIA guidelines."*

> **这条对本报告的判定很关键。** 一个把 UIA + 视觉混合、有完整 agent 系统支撑的实现，**最大的失败来源仍然是「读不到控件」**——即本报告在评的同一件事。它不证明 UIA 不可用（UFO² 也确实在跑），但它证明：**「读取失败」是这条路线的一等公民，不是边角情况。** §7.3 把失败语义单列一条守卫，与此一致。

### 6.5 Screenpipe — 值得借鉴的四条

**[源码]** 仓库 `screenpipe/screenpipe` `main`（HEAD `b1c2736`，2026-10-09 tarball）。该仓库内部多数 `docs/*_SPEC.md` 自带 *"Historical / the code wins"* 声明，调研以源码为准。

1. **「用树还是用像素」不是开关，是一次每帧的内容判定。**
   主路径是「无障碍树优先，OCR 兜底」：`has_accessibility_text` 为真则**完全跳过 OCR**；树为空、或 `a11y_content_is_thin`（画布类应用如 Google Docs/Figma 只看得到工具栏）才触发 OCR。终端白名单（wezterm/alacritty/kitty/hyper/warp）强制 OCR，因为其 `AXTextArea` 返回的是原始缓冲、没有 bbox。

   > 与本轮的关系：本轮三应用全部**不 thin**（725–28237 字符），所以按这个判据都会走树、不做 OCR。**本轮的结论只覆盖「树够厚」的情形**，没有覆盖画布类应用。

2. **越界内容按几何求交过滤，而不是只信 `IsOffscreen`。**
   落库节点的 `on_screen` = `element_rect ∩ focused_window_rect`，用途明确写着「过滤终端滚回缓冲、IDE 滚动出屏的文本」。

   > **这一条是对本报告守卫集第 4 条的改进。** 本轮只看 `IsOffscreen`（浏览器类 36–44 % 越界）；几何求交更严格，且能处理 `IsOffscreen` 报错的情形。

3. **走查要有硬预算 + 专用线程，并且按应用降级。**
   单次走查 250 ms 预算、深度 35、节点 5000；走查跑在**专用单线程 worker**（COM MTA，保 UIA 缓存），最多允许 2 条隔离线程；`budget.rs` 记录每个应用的走查耗时，慢的应用自动降 tier。

   > 本轮同样是「预算 + 上限」结构，但**没有按应用降级**，也没有专用线程。

4. **整窗周期走查会造成目标应用 UI 线程冻结——他们自己的实测，也是他们把它默认关掉的原因。**
   仓库 `docs/TESTING.md` §15 记录：旧的 2 s 周期走查 + focus-change 走查造成 Edge p95 **213 ms** 消息泵停顿，2 分钟内 ~97 次 >100 ms 冻结；移除后 p95 156 ms → **1.6 ms**，>100 ms 停顿 108 → **4**。`capture_tree` 因此默认 `false`。

   > **本轮在本机单独测了这件事，结论不同**——见 §5.4。两者条件不同（占空比、树是否已热、遍历规模），**不是矛盾，是范围不同**。

**另有一条最直接的架构教训**（[源码]）：Screenpipe 的 UIA 走查**只走前台窗口**，RawView 仅在可选的 semantic 捕获里使用。也就是说，本报告 §7.3 守卫集里最麻烦的那条（多窗口择一）在它的设计里**被回避掉了**——代价是它只看得到用户当前聚焦的那一个应用。

**隐私侧（与本报告 §7.4 的「无权限层」相关，仅作对照，不作为建议）**：`IsPassword` 属性跳过；插入前 PII 正则脱敏（信用卡/SSN/邮箱/电话/IPv4/JWT/私钥块，默认开）；默认排除密码管理器与 `lockapp`/`searchhost` 等；**Windows 无痕检测只能按本地化标题匹配**（无原生 API）；聚焦 DRM 应用时暂停截图。这些机制 Hikari **一个都没有**。

### 6.6 浏览器 CDP 路线（独立评估）

**证据等级：[未锚定]。** 这一路只拿到检索摘要（原始 spec 页未能直接打开），**没有一条经过源码或原始 spec 确认**。按 `CLAUDE.md` 第九节，以下全部是**候选结论**，不作为判定依据。

要点（均 [未锚定]）：
- `Runtime.evaluate` + `document.body.innerText` 是最接近「渲染后可见文本」的取法；`Accessibility.getFullAXTree` 是替代。
- **没有任何方法只返回视口内文本**；视口过滤必须在页内用 `getBoundingClientRect` 自己算。
- **附着到用户正常启动的浏览器不可行**：`--remote-debugging-port` 只在启动时读取；Chrome 136+ 在默认 user-data-dir 下**静默忽略**该 flag，必须配非默认 profile——**那会丢掉用户已登录的会话**。
- 协议长期**没有 active tab 概念**（devtools-protocol issue #297）；较新版本新增的 tab 元数据是 pull-based，且 `tabActive` 只表示「在窗口内被选中」，**不表示该窗口是 OS 前台**。
- 调试端口**无认证**：任何能连上该 loopback 端口的同用户进程都可 `Network.getAllCookies` 与 `Runtime.evaluate`。

> **对本项目的直接含义**：这条路线的前提是**改变用户的浏览器启动方式**，与「不修改启动方式」冲突；且它把用户全部已登录会话暴露给任何同用户本地进程。**这是产品姿态级别的变更，不是实现细节。** 建议列为 Human 裁决项（§9 H5），本轮不推进。

### 6.7 浏览器扩展路线（独立评估）

**证据等级：混合。** 官方文档经 Google 镜像域 `developer.chrome.google.cn` 与 Microsoft Learn 实际读取（[文档] 级，比 6.6 强），部分为社区来源 [未锚定]。

**这条路线与 CDP 方向相反、失败模式不同，必须分开评估**：CDP 是「本地进程连到浏览器」；扩展路线是**浏览器反过来 spawn 一个本地宿主进程**（native messaging），或**扩展主动连出去**（本地 WebSocket 服务）。

要点：

1. **`chrome.tabs` 拿不到正文。** `"tabs"` 权限只解锁 `url` / `pendingUrl` / `title` / `favIconUrl` 四个属性。要正文必须 `chrome.scripting.executeScript` 或 content script。
2. **「无用户手势 + 无安装摩擦 + 普通用户机」三者不可能同时成立。**
   - `activeTab` 无安装警告，但**每次读取都要用户手势**（点击图标 / 菜单 / 快捷键 / omnibox），且跨源导航即撤销。
   - 无手势持续读**必须**用 host permissions，而它**会触发安装警告**。
   - 安装侧：Windows/macOS 上只有 **Chrome Web Store 签名扩展**能被用户直接安装；自托管仅限**纳管环境**，且 `update_URL` 必须指向 CWS。开发者模式 `Load unpacked` 是开发流程。**「用户什么都不做」只在企业策略静默安装下成立。**
3. **常驻形态有摩擦**：native messaging 的宿主是**被浏览器 spawn 的子进程**——一个已经常驻的 Hikari 不能被直接连上，需要一层 shim 或改由浏览器管理其生命周期。替代方案（扩展连本地 WebSocket）不需要 registry/manifest，但**要自己造鉴权**（本地任意进程都能连那个端口），而 native messaging 由 `allowed_origins` 保证只有指定扩展能连。
4. **读不到的页面**：`chrome://` 等受限页（[文档] 明示）；PDF 内置查看器（内部扩展 + 闭合 shadow root，按「读不到」处理）；canvas 渲染的文字与虚拟列表结构性缺失 [未锚定]。
5. **新鲜度可以是推送的**：`tabs.onActivated` / `onUpdated` / content script 的 DOM 监听，无需轮询。但 MV3 service worker **30 秒空闲即被回收**，要维持常驻得靠长连接把它拉活。

> **对本项目的直接含义**：扩展路线能读到正文、能事件驱动推送，但**代价落在用户身上**（装扩展 + 授权或安装警告），且**部署形态与「常驻助手」有真实摩擦**。它比 CDP 干净（不需要改启动方式、不需要暴露调试端口），但也不是「零成本」。**同样列为 Human 裁决项（§9 H5）。**

### 6.8 跨项目收敛：本报告守卫集的对照

把 §7.3 的七条守卫与各项目的实际做法并排：

| 本轮守卫 | 各项目怎么做 |
| --- | --- |
| 1 可见 + 标题非空 择一 | Screenpipe 用**前台窗口**回避了择一；Windows-MCP 用 `WindowPattern` + `CanMinimize/CanMaximize`；pywinauto 要求**恰好一个**命中否则报 `ElementAmbiguousError`；UFO² 把 `IME`/`MSCTFIME UI` 排除出窗口列表 |
| 2 正文空时不回退 `Name` | **四个项目里三个都回退**（详见下） |
| 3 校验焦点元素归属 | **未见** |
| 4 按 `IsOffscreen` 过滤越界 | Screenpipe **用几何求交**（更强，见 6.5-2）；UFO² **把 `UIA_IsOffscreenPropertyId == False` 放进 UIA 查询条件**（见 6.4-2）；pywinauto 的 `visible` 虽也来自 `CurrentIsOffscreen`，但只在 `find_elements(visible_only=True)` 时**枚举完再筛**，`descendants()` **完全不过滤** |
| 5 `matched` vs `scanned` 一起看 | 各项目用**硬预算 + 显式 truncated 标记**（Windows-MCP 的 `truncated=True` 会告知模型；UFO² 的 500 是**静默截断**，不告知） |
| 6 固定并记录 walker | **三个项目的选择不一致**：Windows-MCP 用 RawView，Screenpipe 用 ControlView，pywinauto 默认**不加视图判据**（≈RawView）而 `parent` 用 ControlView，UFO² 用 `TreeScope_Descendants` 全范围 |
| 7 不依赖 LegacyIAccessible | **Windows-MCP 仍是孤例**：它用其 value 给 Edit/Document/Image/ComboBox。pywinauto 有 `legacy_properties()` 但**只是原始转储、不进文本链**；UFO² **只**用它取勾选/选中态；本轮实测三应用 **0 元素** |

#### 6.8.1 守卫 2 被新证据推翻了：**四个项目里三个回退到 `Name`**

§6.8 上一版写的是「未见任何项目回退到 Name」。补完 pywinauto 与 UFO² 之后，这条**不成立**——回退不但有人做，而且是主流：

| 项目 | 做法 | 性质 |
| --- | --- | --- |
| pywinauto | `except Exception: return self.name`（`uia_element_info.py:156-157`） | **静默**，且作者在同一行留了 `# TODO: probably we should raise an exception here` |
| UFO² | `element_info._cached_rich_text = elem_name`（`inspector.py:294-296`） | **主动**，注释自陈「rich text 当前不用，拿 name 顶着」 |
| Windows-MCP | `Name` 为主，`TextPattern` 只取选中文本 | **路线选择**，不是回退 |
| Screenpipe | ControlView 树文本，稀疏时 **OCR 兜底** | 不用 `Name` |

> **这条修正很重要，而且方向和上一版相反。** 它意味着「不要回退到 `Name`」**不是一个行业惯例，而是一个反惯例的判断**——三个成熟实现都在回退，其中两个还在源码里承认了这一点。§7.3 保留这条守卫，理由**不能是「大家都这么做」，只能是本轮实测**：§3.5 量到 14 个窗口 `nameIsOnlySignal=true`，回退会稳定产出误导性正文。
>
> **同时也要如实说**：本轮**没有**测「回退到 `Name` 会造成多大的下游损害」——只测到「回退会拿到非正文的字符串」。这属于 §9 待裁决事项。

#### 6.8.2 仍然成立的两条

第 6 与第 7 条依旧是**真冲突**，需要按应用实测判定，不能按惯例选。

**无人做的**从三处变成两处：守卫 3（焦点归属）依然没人做；**显式超时四个项目都没有**（Windows-MCP、Screenpipe、pywinauto、UFO² 一致空缺，见 §6.3.5），本轮的探针也没有——这是一个**全行业空缺**，不是本轮独有的短板。环检测 Windows-MCP 做了，本轮没做。

---

## 7. UIA 是否足够作为 D0 第一阶段感知来源

### 7.1 按 D0 的三个要求逐条判

| 要求 | UIA 是否满足 | 依据 |
| --- | --- | --- |
| 读到当前桌面情境的**正文** | **满足**，三个目标应用类全部可读、完整、不截断 | §2.3 |
| 区分**当前/非当前**内容 | **部分满足**：有 `IsOffscreen`，但需读取方自行过滤；没有视口语义 | §5.2、§5.4 |
| **归属**到正确窗口 | **部分满足**：判据有效，但默认路径（焦点元素）实测会跨应用误取 | §3.4、§3.5 |

### 7.2 判定

**NARROW —— 足以作为来源，但不足以作为无守卫的来源。**

支持继续：
- 正文可读且**完整**（三个目标类 `truncatedBy` 全空）
- 读取实时（4 秒复读逐字节相同或按真实变化）
- 归属**可**判定
- 延迟可控（单窗口 0.4–2.7 s，焦点元素 4–14 ms）
- 越界内容**可**识别

对上一轮「1/8 可读」的修正**要说准，不能笼统说「深度是约束」**（§2.2.2）：上一轮那 6 个「读不到」的应用里**只有 2 个（QQ、VS Code）是深度上限造成的假阴性**，另外 **4 个（Weixin、cloudmusic、PowerToys、SystemSettings）在深度 40 下走完整棵树仍然 0 字符、且未截断**——它们是真的读不到，不是读得少。（第 6 个 `StarPie` 本轮未在运行，无法重测。）**修正的幅度是 8 个里可读从 1 个升到 3 个，不是「全都可读」。**

不足以直接落地：
- 42 个窗口里 39 个不是内容窗口，其中 14 个有名称无正文
- 焦点元素捷径会跨应用取错内容（实测）
- 浏览器类三分之一到四成正文越界
- 换 walker 得到不同字符串
- 深度上限会**静默**把可读应用读成空（QQ、VS Code 各一例）
- 无 ground truth，**正确性未验证**

### 7.3 若继续，读取方必须自带的最小守卫集

这些是**从本轮实测反推出来的必要条件**，不是设计建议：

1. **可见 + 标题非空** 作为窗口择一判据（42 → 3）。**并且按类名排除 `IME` / `MSCTFIME UI`**——UFO² 与 pywinauto 各自独立做了这件事（§6.3.2、§6.4.3b），本轮实测这三个类名贡献了 13 个诱饵窗口。
2. **正文为空时绝不回退到 `Name`**（否则命中 14 个诱饵窗口）。**注意这条是反惯例的**：四个参考项目里三个都回退（§6.8.1），其中两个在源码里承认了。保留它的理由是本轮实测（14 个 `nameIsOnlySignal` 窗口），**不是「大家都这么做」**。
3. **每个窗口读之前/之后校验焦点元素归属**，`isThisWindow == false` 时不得把焦点内容当本窗口内容。
4. **按 `IsOffscreen` 过滤越界内容**，或至少要如实上报越界占比。
5. **`matched` 与 `scanned` 必须一起看**，两者不等即表示发生了静默截断。**并且深度上限不能静默**——§2.2.2 的两个假阴性都是「`truncatedBy` 被忽略」造成的；只要看过这个字段，QQ 与 VS Code 就不会被判成不可读。**空结果必须连同「走查是否走完」一起上报。**
6. **walker 的选择要固定并记录**——换 walker 就是换字符串。
7. **不依赖 LegacyIAccessiblePattern**（三应用均为 0 元素）——但注意这与 Windows-MCP 的做法**冲突**（它用该 pattern 的 value 给 Edit/Document/Image/ComboBox 取文本），需按应用实测，不能按惯例选（§6.8）。

第 6 条要展开一句：两个参考项目的 walker 选择**正好相反**（Windows-MCP 用 RawView，Screenpipe 用 ControlView），而 §3.1 已证两者文本**不可互相还原**。**这不是风格差异，是结果差异。**

### 7.4 与 Hikari 现状的关系

本轮这七条守卫，**当前 Hikari 没有任何一处承载它们**：

- `src/desktop-session-awareness/` 只读**前台窗口与会话基线**，不读正文。
- `src/language/read.ts:26-30` 的「owner's own renderer」先例说明渲染归各自 owner，但那是**输出**方向；本轮的问题是**输入**方向，该先例不覆盖。
- `docs/architecture/hikari-current.md:527` 记录的「权限 / 授权层 无」（并引 `src/language/exposure.ts:56-59` 的「不携带任何权限」）仍然成立——本轮的守卫集是**正确性**守卫，与权限/同意是两件事，两者都不存在。

因此本轮不构成「可以直接加一个 reader」的结论。若 Human 决定推进，仍需先走 Composition Boundary Review（`src/language/exposure.ts:40-48` 的守卫），因为「桌面正文读取」是一个**独立可选的领域能力**。

---

## 8. 推荐的下一项有界实验：合成标记 ground truth

### 8.1 为什么本轮没做

Mandate 要求「使用合成标记和可控内容验证结果」。**本轮没有做，这是有意的**：让已知内容进入一个 UIA 可读窗口的唯一途径是**创建或驱动窗口**，与同一份 mandate 的数据边界「只读，不进行 GUI 操作」冲突。在拿到 Human 明确许可之前不执行。

代价必须说清楚：**没有 ground truth，§3 的全部结论都只是内部自洽性检查。** 我们证明了「读出来的东西不矛盾」，没有证明「读出来的东西是对的」。

### 8.2 建议形态

一个**受控的最小实验**，仍然不碰生产代码：

1. 由一个**研究脚本**创建一个窗口（记事本 / 自建 WinForms 窗口），写入**已知的合成文本**：带编号的标记行、已知的重复行、已知的隐藏行、足量内容以产生滚动条。
2. 用同一套探测脚本读取，**与已知内容逐字比对**，而不是比对哈希。
3. 回答本轮回答不了的四个问题：
   - 读到的字符序列与写入的**是否逐字一致**（换行、空白、Unicode 是否保真）？
   - **滚动出去的部分**是否被标记为 `IsOffscreen`？标记是否准确？
   - **重复内容**是否被去重或重复计入？
   - **编辑之后**，读取反映的是新内容还是旧内容，延迟多久？
4. 同一实验在 Chromium 里重复一遍（本地 HTML 文件 + 已知文本），验证浏览器类的差异。
5. **补上 §5.4 的两个未测项**：用同一个 `WM_NULL` ping 方法测「**冷树**首次读取是否阻塞」（实验 4 里那个 Chromium 进程是全新启动的，树必然是冷的）与「**高频周期**读取是否阻塞」（把走查串成 2 s 一轮，复现 Screenpipe 的占空比）。这两项才决定「能不能常驻读取」。
6. **定下深度策略**。§2.2.2 证明一个有界的深度上限会**静默**把可读应用读成空（QQ、VS Code 各一例），而本轮实测**RawView 深度**已经到 **39**（VS Code）、35（ChatGPT）、29（QQ）、28（msedge）——注意 ControlView 的深度普遍更浅（17/22/17/19）。所以真正要回答的是：**「走到底」在延迟上可不可行**（本轮 cv 最慢 2 670 ms，未到「不可接受」但也绝不便宜），以及**如果必须有界，界该按什么定**——按应用自适应（Screenpipe 的做法）还是按一个足够大的固定值 + 明确的 `truncatedBy` 上报。**没有这一项，§7.3 第 5 条守卫就没有落地参数。**

### 8.3 需要的许可

- 允许研究脚本**创建并写内容到自己的窗口**（一次性的、合成内容的、非用户数据的窗口）。
- 仍然是**不驱动用户的窗口**、不读取真实正文、不联网。

---

## 9. 尚待 Human 裁决

| # | 事项 | 为什么需要 Human |
| --- | --- | --- |
| H1 | 是否批准 §8 的合成标记实验（含「创建并写入自有窗口」这一例外） | 这是对本轮数据边界的一次**有意放宽**，只有 Human 能批 |
| H2 | UIA 若继续，§7.3 的七条守卫该落在哪个 owner 上 | 归属判断，且触及 `exposure.ts` 的 Composition Boundary 守卫 |
| H3 | 「桌面正文读取」是否作为独立可选能力进入产品 | 越过冻结架构边界 |
| H4 | 越界内容（36–44 %）默认丢弃还是默认保留并标注 | 产品语义：Hikari 该不该「知道」用户没在看的部分 |
| H5 | 浏览器路线：UIA / CDP / 扩展三者如何取舍 | 见 §6；三条路线前提条件不同，不是同一决策 |
| H6 | 本轮对上一轮「1/8 可读」结论的修正是否接受（**可读 1 → 3，另 4 个确认读不到**，§2.2.2） | 修正上游已交付的结论，需 Human 确认；且它改变了 D0 第一阶段「具名可读应用类别」能选多大 |
| H7 | 「正文为空时回退到 `Name`」这条守卫是否保留 | §6.8.1：**四个参考项目里三个都回退**，其中两个在源码里承认了这一手；本轮只测到「回退会拿到非正文的字符串」（14 个窗口），**没测下游损害有多大**。是反惯例的本轮判断，应由 Human 定 |

---

## 10. 复现

```bash
cd docs/research/d0-uia-fidelity

# 策略矩阵          -> full-run-1.json / depth-probe-1.json
node run.mjs config.json full-run-1.json
node run.mjs depth-probe.json depth-probe-1.json

# 内部一致性        -> consistency-1.json
node run.mjs config.json consistency-1.json uia-consistency.ps1

# 阻塞/响应性实验    -> blocking-1.json
node run-blocking.mjs blocking.json blocking-1.json

# HWND 覆盖率（单脚本，直接跑，不经 run.mjs）-> hwnd-coverage-1.json，见 §6.3.4 / §3.4 的数字
# 对 msedge / Code / ChatGPT 各跑一次（目标应用必须已在运行）
CFG=$(node -e "console.log(Buffer.from(JSON.stringify({target:'Code',maxNodes:4000,maxDepth:40})).toString('base64'))")
HIKARI_HWNDCFG_B64="$CFG" powershell.exe -NoProfile -NonInteractive -File ./uia-hwnd-coverage.ps1
```

> 脚本一律用 `-NoProfile -NonInteractive -File` 调用，**不要加 `-ExecutionPolicy Bypass`**：本环境不允许，且没有必要。落盘的结果文件清单见 `docs/research/d0-uia-fidelity/README.md`。

环境：Windows + Windows PowerShell 5.1 + Node.js。目标进程需在运行时已启动。

`config.json` 用的是本轮三个目标应用（`ChatGPT` / `msedge` / `Code`）；`depth-probe.json` 用的是**上一轮那批 0 字符的应用**（`QQ` / `Weixin` / `cloudmusic` / `PowerToys.QuickAccess` / `SystemSettings`），用于 §2.2.2 的重测——**跑它之前那些应用必须已经在运行**，否则探针会跳过，重测就不成立。

脚本读的是**当前机器状态**，窗口数量与正文规模会随机器状态变化；本轮数字对应的机器状态见各 JSON 的 `wallClockMs` 与窗口清单。

---

## 附：本轮的六处方法论修正

1. **`-EncodedCommand` → `-File`**：脚本 base64 后超过 Windows 约 32 KB 命令行上限，首次运行失败在 `ENAMETOOLONG`。改 `-File` 后复现命令也变成可直接照抄的一行。
2. **深度是约束，不是节点数**：`maxDepth=6` 时 VS Code 只得 12 节点 / 0 字符；`maxDepth=40` 时得到 412 节点 / 3254 字符。**且必须看 `truncatedBy`**——见 §2.2.2 对上一轮 6 个应用的重测。
3. **归属判据的「无归属」会被读成「不属于本窗口」**：求所属 hwnd 的父链上行走查原本限 40 步，而实测树深已达 39。见 §3.4 末尾——这是本轮探针自身的缺陷，不是 UIA 的。
4. **「未见任何项目回退到 `Name`」被证伪**：补完 pywinauto 与 UFO² 之后，四个参考项目里**三个都回退**，两个还在源码里承认了。§6.8 那一版结论**方向相反**，已按 §6.8.1 改写——守卫 2 因此从「行业惯例」降级为「反惯例的本轮实测判断」。
5. **真实内容窗口是 3 个，不是 4 个**：初稿 §5.1 写「42 → 4」（9.5%），与它自己的分进程明细（1+1+1）自相矛盾。回查 `full-run-1.json` 的 `windows` 数组逐条数：`visible && titleLen > 0` 恰好 **3** 条，比例 **7.1%**。全文四处引用一并订正，并补上 `depth-probe-1.json` 的独立复核（68 → 6，8.8%）——**同一结论要有两组应用集各自支撑**，不能只看一组。
6. **跨工件引用要有归属**：`depth-probe-1.json` 的目标集是上一轮那 5 个 0 字符应用，**不含 VS Code**；§2.2.2 表里 VS Code 那一行来自主跑 `full-run-1.json`。原稿把整张表挂在 `depth-probe-1.json` 名下，属张冠李戴，已按行标注来源（ᵈ / ᶠ）。同理 §5.2 的「1217 / 1490 节点越界」出自 `consistency-1.json` 的节点级计数，也已标注——**本轮的数字分散在五个工件里，每个数都要能指回它实际来自哪一个。**
