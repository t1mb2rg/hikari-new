# 主动触发链（JustMutsumi M0.32）

行号均指 `G:/work/LAB/code/releases/_analysis/JustMutsumi-M0.32/src/<module>.py.txt`。

## 0. 结论先行

**产品里没有「模型主动」这种东西。** 所有不需要玩家输入的说话与行为，都由**定时器 + 随机数 + 关键词表 + 预设台词表**产生，模型完全不参与（已确认）。

主动触发只有两条通道，都很窄：

| 通道 | 载体 | 何时生效 | 谁决定内容 |
| --- | --- | --- | --- |
| 桌面宠物 | `screen desktop_pet` 的 `timer` | 宠物窗口开着时，**每 20 秒** | 程序：`random()` + 规则表 + 台词表 |
| 元层面行为 | `screen meta_deep` 的 `timer` | 主界面开着时，**每 2 秒** | 程序：时钟 + 焦点状态 + 随机数 |

## 1. 桌面宠物：`desktop_pet.py.txt`

定时器（`:722-724`）：

```
# [776] Function(pet_idle_tick)
# [776] True
# [776] 20.0        → timer 20.0 repeat True action Function(pet_idle_tick)
```

`pet_idle_tick()`（`:233`）每 20 秒掷一次骰子，按区间分派到一个检测器：

| 区间 | 调用 | 做什么 | 限频 |
| --- | --- | --- | --- |
| `<0.15` | `pet_detect_programs()`（`:463` 起） | `powershell Get-Process` 拿所有窗口标题，在 13 组关键词里匹配 | 60 s（`:469`） |
| `<0.25` | `pet_detect_mouse()` | `GetCursorPos` 算速度：>2000 说「鼠标动得好急」，连续 4 次几乎不动说「你还在吗」 | 无 |
| `<0.32` | `pet_detect_battery()`（`:552`） | `GetSystemPowerStatus`，≤10% / ≤20% / 充电中 / ≥95% | 300 s（`:558`） |
| `<0.40` | `pet_detect_desktop_files()`（`:627`） | `os.listdir(~/Desktop)`，按文件名关键词匹配 | 600 s（`:634`） |
| `<0.55` | `pet_update_taskbar()` | 改窗口标题（12 条基础 + 桌面文件数 / 回收站非空） | — |
| `<0.70` | 按时段选 `_PET_TIME_LINES` | 预设台词 | — |
| 其他 | `_PET_IDLE_LINES` | 预设台词 | — |

**关键词表就是它的「理解」**：`_PET_PROGRAM_RULES` 13 组（bilibili / 微信 / QQ / Discord / VS Code / Steam / 音乐 / Word / Excel / PPT / PS / 浏览器 / 二游），`_PET_FILE_RULES` 按「作业 / 简历 / 照片 / 游戏 / 音乐 / 新建文件夹」匹配文件名。命中一次 → `random.choice(预设台词)`。

另有 `pet_open_tool(idx)`：**8 个预设工具**（记事本、计算器、画图、资源管理器、浏览器、cmd、截图工具、任务管理器），`subprocess.Popen(cmd)` 拉起真实进程——但选哪个由玩家点按钮，**不是模型决定**。

## 2. 元层面行为：`meta_deep.py.txt`

定时器（`:470-474`）：`timer 2.0 repeat True action Function(meta_deep_periodic)`。

`meta_deep_periodic()`（`:455`）每次调用两件事：`meta_focus_tick()`，以及 20% 概率 `meta_update_title()`。

### 2.1 焦点检测（`:292-334`）

- `meta_check_focus()` 用 `ctypes.windll.user32.GetForegroundWindow()` + `GetWindowThreadProcessId` 比对 PID，判断游戏窗口是否在前台。
- **失去焦点**：改标题为「Just Mutsumi — ……你去哪了？」，并起一个 **300 秒的 `threading.Timer`** 发 Windows Toast 通知（`:319`）。
- **恢复焦点**：按离开时长选台词——>600 s 用 `_FOCUS_BACK_LONG`，>10 s 用 `_FOCUS_BACK_LINES`，否则清空（`:321-331`）。
- 通知内容从 `_NOTIFY_MESSAGES` 六条里 `random.choice`（`:340-347`），通过 Powershell 的 WinRT Toast API 弹出（`:349-381`）。

### 2.2 窗口标题（`:241-263`）

按优先级：凌晨 0–5 点 → `_TITLE_LATE_NIGHT`；在线 >7200 s → `_TITLE_LONG_SESSION`；`roll<0.1` → `_TITLE_SPECIAL`；`roll<0.5` → `_TITLE_IDLE`；否则默认标题。用 `pygame.display.set_caption` 修改。

### 2.3 桌面便签——最精巧的一处「感知玩家真实行为」（`:139-200`）

- `meta_leave_desktop_note()`：**往玩家真实桌面写一个 txt**（`USERPROFILE/Desktop/<预设文件名>`），内容是 `_DESKTOP_NOTES` 列表里按序取的一条，把 `[player]` 替换成玩家名。
- `meta_check_note_read()`：**用文件系统的 atime 与 mtime 比较判断玩家是否打开过它**——`atime > mtime + 2` 判为 `"read"`；文件不存在判为 `"deleted"`；否则 `"unread"`。
- 触发时机：`meta_on_quit()`（`:464`）在退出时以 **30% 概率**留便签；`config.quit_callbacks` 注册在 `:547`。

这是全产品唯一一处「从玩家在操作系统里的真实行为（打开/删除一个文件）推断心理状态」的机制，**它不经过模型，只决定下次显示哪条预设台词**。

### 2.4 其它

| 行为 | 位置 | 机制 |
| --- | --- | --- |
| 截图键 | `:396` `meta_on_screenshot`，绑 `K_PRINT` / `K_F12`（`:492-493`） | 计数 +1，显示预设台词 3 秒 |
| 读电脑用户名 | `:417` `meta_get_hostname` | `os.getlogin()`，失败退到 `socket.gethostname()`；过滤 user/admin/administrator/default；**只触发一次**（`:436`），300 秒后弹窗说一句 `_HOSTNAME_LINES` |
| 在线时长记录 | `:449` `meta_deep_init` | 启动时写 `persistent.meta_online_start` |

## 3. 「随机搭话」模块的真相

`mortis_random_talks`（22 行）、`meta_random_talks`（9 行）、`wakaba_random_talks`（93 行）**全都只有 `add_hgd(...)` 调用**——那是给角色加好感度的注册语句（`goodwill_system.py.txt:83` 定义：带 `once_id` 一次性标记与 `daily_id` 每日上限），不是触发引擎。名字有误导性。

真正的「主动说话」发生在剧情 `label` 被调度时，台词来自 `topics.py.txt` 这类**纯数据语句库**（595 行，按时段 midnight/morning/… 分组，每组几十条 `[["句子1","句子2"], ...]`，用 `random.choice` 选）。

## 4. 不存在的东西（已确认）

| 期待中的机制 | 实际 |
| --- | --- |
| 后台线程定时调模型 | 不存在。`threading` 只用于 API 请求、天气拉取、Toast 定时器、截图 |
| 文件系统事件监听（watchdog 之类） | 不存在。只有轮询 `os.listdir` |
| 屏幕内容理解 | 不存在。`mss` 截图只用于 Mortis 模式的「把真实桌面当背景」演出（`mortis_mode_metamanager.py.txt:10-43`、`mutsumi_runner.py.txt:3705-3743`），图片从不进入模型 |
| 模型自主决定「现在该说话」 | 不存在 |
| 模型自主决定「该看什么」 | 不存在 |

## 5. 频率与规模（估算，非实测）

- 桌面宠物：每 20 s 一次 tick，落到某个检测器约 70% 概率；其中读进程/文件受 60/600 s 限频约束。即**最长 10 分钟内一定会对玩家的程序与桌面文件做一次检查**。
- 元层面：每 2 s 一次焦点检查，每秒级采样；标题更新平均每 10 s 一次。

**无法确认**：这些定时器在发行版运行时的真实触发频率（本报告未运行游戏，所有间隔读数来自脚本常量）。
