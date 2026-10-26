# 文件与系统访问（JustMutsumi M0.32）

行号均指 `G:/work/LAB/code/releases/_analysis/JustMutsumi-M0.32/src/<module>.py.txt`。

## 0. 结论先行

**「主动读取玩家文件」真实存在，但它读的是文件名，不读内容，而且结果从不进入模型。**

产品对玩家机器的访问一共 8 处，全部由确定性代码发起，全部只在「触发 → 查表 → 选预设台词」这条链上使用。没有一处把文件内容、进程内容或屏幕像素交给模型。

## 1. 全部访问点

| # | 访问什么 | 位置 | 方式 | 结果去处 |
| --- | --- | --- | --- | --- |
| 1 | 桌面文件名 | `desktop_pet.py.txt:627-700` | `os.listdir(~/Desktop)` | 关键词匹配 → 预设台词 |
| 2 | 运行中的程序名 | `desktop_pet.py.txt:463-550` | `powershell Get-Process ... MainWindowTitle` | 关键词匹配 → 预设台词 |
| 3 | 电量 | `desktop_pet.py.txt:552-625` | `ctypes GetSystemPowerStatus` | 阈值 → 预设台词 |
| 4 | 鼠标位置 | `desktop_pet.py.txt:~505` `pet_detect_mouse` | `ctypes GetCursorPos` | 速度阈值 → 预设台词 |
| 5 | 前台窗口归属 | `meta_deep.py.txt:292-302` | `GetForegroundWindow` + `GetWindowThreadProcessId` 比对自身 PID | 布尔 → 焦点状态 |
| 6 | 写桌面便签 / 读其时间戳 | `meta_deep.py.txt:139-200` | `open(<桌面>/<预设名>.txt,'w')`；`os.path.getatime/getmtime` | `"read"/"unread"/"deleted"` → 预设台词 |
| 7 | 电脑用户名 | `meta_deep.py.txt:417-432` | `os.getlogin()`，失败退 `socket.gethostname()` | 一次弹窗台词 |
| 8 | 整屏截图 | `mortis_mode_metamanager.py.txt:10-43`、`mutsumi_runner.py.txt:3705-3743` | `mss` 截主屏 → `<gamedir>/desktop_cache.png` | **只当演出背景显示** |

另外三处是对**游戏自己目录**的读写，不触及玩家个人数据：`music.py.txt:44-60`（扫 `music/` 导入曲子）、`definitions.py.txt:639/656`（读写配置文件）、`splash.py.txt:40`（写玩家输入）。

## 2. 四处关键的调用链

### 2.1 桌面文件名（最接近「自主读文件」的一处）

```
screen desktop_pet  timer 20s            desktop_pet.py.txt:722-724
  └─ pet_idle_tick()                     :233
       └─ roll ∈ [0.32, 0.40) → pet_detect_desktop_files()   :627
            ├─ 限频：now - _pet_last_file_check < 600 → return :634
            ├─ desktop = %USERPROFILE%/Desktop                   :640
            ├─ os.listdir(desktop)                               :~660
            ├─ 文件名在 _PET_FILE_RULES 里做子串匹配（作业/简历/照片/游戏/音乐/新建文件夹）
            └─ 命中 → store._pet_line = random.choice(该组预设台词)
                 → screen 显示该行
```

**读的是 `os.listdir` 返回的字符串，文件不打开、内容不读取。** 一个名为「作业.docx」的空文件与真实作业文件触发同一句台词（已确认）。

### 2.2 运行中的程序

```
pet_idle_tick → pet_detect_programs()      desktop_pet.py.txt:463
  ├─ 限频 60 s                                                    :469
  ├─ subprocess.run(["powershell","-command",
  │     "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty MainWindowTitle"])
  ├─ 逐个标题在 _PET_PROGRAM_RULES 13 组里做子串匹配
  └─ 命中 → 预设台词
```

**只拿窗口标题字符串**，不拿 PID、路径、命令行。

### 2.3 桌面便签与 atime

```
config.quit_callbacks → meta_on_quit()      meta_deep.py.txt:464, 547
  └─ 30% 概率 meta_leave_desktop_note()      :139
       ├─ desktop = %USERPROFILE%/Desktop
       ├─ 按 persistent.meta_desktop_notes_left 取第 idx 条预设（文件名+正文）
       ├─ 已存在同名文件 → 跳过（不覆盖玩家文件）
       └─ open(fpath,'w',encoding='utf-8').write(正文.replace("[player]",玩家名))
```

```
下一局 meta_check_note_read()               meta_deep.py.txt:177
  ├─ 文件不存在 → "deleted"
  ├─ os.path.getatime(fpath) > os.path.getmtime(fpath) + 2 → "read"
  └─ 否则 → "unread"
```

这是唯一一处**推断玩家真实行为**的机制：玩家双击打开过便签，atime 会晚于 mtime（Windows NTFS 默认启用 last access 更新），于是下次她说一句「你看了」；玩家把文件删了，她说另一句。**判定完全在本地，不联网，不经过模型。**

### 2.4 截图

```
Mortis 模式剧情节点 → capture_desktop_safely()   mortis_mode_metamanager.py.txt:10
  ├─ 平台检查（android/ios 直接返回 False）
  ├─ pygame_sdl2.display.iconify()   # 先最小化自己，避免截到自己
  ├─ time.sleep(0.5)
  ├─ mss().shot(mon=1, output=<gamedir>/desktop_cache.png)
  └─ renpy.cache_pin("desktop_cache.png") + start_predict
```

`mutsumi_runner.py.txt:3705-3743` 是同一动作的另一次实现（带 `PIL.ImageGrab` 兜底）。
截到的图**只作为全屏背景显示**（`# [270] "desktop_cache.png"`），用于「角色真的站在你桌面上」的演出效果。图片数据不进任何网络请求（已确认：`ai_chat` 与 `round_table` 的请求体都没有图片字段，也没有 base64 编码）。

## 3. 「是否进入模型」逐项判定

| 访问点 | 进入模型？ | 依据 |
| --- | --- | --- |
| 桌面文件名 | **否** | 只写 `store._pet_line`；模型调用的 messages 构造里无相关变量（`ai_chat.py.txt:268-273`） |
| 程序窗口标题 | **否** | 同上 |
| 电量 / 鼠标 / 焦点 | **否** | 同上 |
| 电脑用户名 | **否** | 只用于弹窗台词（`meta_deep.py.txt:434-443`） |
| 桌面便签 atime | **否** | 只决定 `_meta_focus_back_line` 一类显示 |
| 截图 | **否** | 只作背景图片；请求体无图片字段 |

模型唯一能「知道」的玩家信息是：玩家自己填的名字、性别、生日、好感度数值、当前时间。

## 4. 权限、同意与作用域

| 问题 | 实际情况 |
| --- | --- |
| 有无用户授权提示？ | **没有**。装好游戏、打开桌面宠物就开始每 20 秒轮询，无任何「允许我查看你的桌面吗」提示 |
| 有无开关？ | 桌宠要求玩家主动开「桌面宠物」窗口才会跑（`screen desktop_pet` 存在才有 timer）；元层面行为随主界面运行，**无开关** |
| 读取范围是否受限？ | 受限但硬编码：只读 `~/Desktop` 一层的文件名、只读窗口标题、只读电量与光标。**不递归、不读内容、不读文档/浏览器历史/聊天记录** |
| 有无上传？ | **无**。上述数据全部留在本地；联网只发生在天气、站内信、云存档、排行榜、模型调用 |
| 有无写玩家文件？ | 有，仅一处：向桌面写**自己命名**的 txt 便签（同名已存在则跳过，不覆盖） |

## 5. 与「AI 角色主动了解玩家」的关系

**这些感知能力与模型的对话完全解耦。**

- 感知 → 关键词表 → 预设台词（`desktop_pet`）
- 感知 → 时间戳比较 → 预设台词（`meta_deep`）
- 模型 → 只处理玩家输入的文字

两者之间没有数据通道。也就是说：桌宠「看到」你在写作业，只会说「作业还没写完吗」这句固定台词；如果你接着在 AI 对话框里问「你觉得我刚才在干什么」，模型**无从知道**——它的上下文里没有任何相关信息。

## 6. 无法确认

- 发行版运行时 `mss` 截图是否真的成功（依赖 `python-packages/mss` 与 SDL 环境；脚本有 try/except，失败静默）。
- `atime` 判断在关闭 last-access 更新的系统上会全部返回 `"unread"`（脚本无兜底）。
- 未运行程序，因此上述轮询的实际触发节奏只有脚本常量依据。
