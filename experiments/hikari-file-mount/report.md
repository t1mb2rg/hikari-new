# dsh-file-mount 兼容性测试报告

> 测试对象：`dsh-file-mount` 0.9.0（GitHub Release tarball，sha256 `87C5900B8DA7400A2F4133C9ACB21CA1A04905CD2DE9A9042698DDA06C9F6C1F`）
> 宿主：DSH `0.2.1-rc.3`；profile `hikari`；测试实例 `127.0.0.1:3090`（`--patch experiments/hikari-file-mount/test.patch.yml`）
> 测试会话：`session-12b5e144-62a0-4b92-9968-14acefbbddc9`
> 方法：用户按指令实际调用工具并原样回贴返回值；结果再从 session 日志（`session.v4.jsonl.zstd`，多帧 zstd）逐条核对。报告以 session 事件为准，用户回贴作为旁证。

## 0. 结论摘要

| 阶段 | 结论 | 关键证据 |
|---|---|---|
| 一、加载确认 | **PASS** | `request/header` tools 含 `file_mount_forget`；组合树 `- id: file-mount` / `name: dsh-file-mount` |
| 二、重复读取 | **PASS** | 第一次 `read` 原文未被替换；第二次同范围 `read` 的 `tool/result` 被替换为 `already mounted` 占位；另有独立挂载标记 user 消息 |
| 三、文件变化 | **PASS**（1 个观察点） | hash 变化 `2a21c583` → `bc12d3a3`；返回行级 diff `+3/-2 lines`，仅 L3、L7 两段 |
| 四、主动强制重读 | **PASS** | `file_mount_forget` 返回 `Mount ledger entry forgotten`；随后 `read` 返回 21 行完整正文 |
| 五、报告 | 本文件 | — |

## 1. 环境确认

- DSH 版本：`0.2.1-rc.3`（`G:\深度求索马具\resources\app.asar\dsh\package.json` → `version`）。
- 插件安装：`dsh plugin --profile hikari add file:%TEMP%\dsh-file-mount.tgz` 成功（0.9.0，pnpm v11.28.5）。`%USERPROFILE%\.dsh\profiles\hikari\package.json` 的 `dsh.profile.bundles` 追加 `dsh-file-mount`。
- 组合树验证：`dsh --profile hikari --dump-config` 输出 1314 行，含 `- id: file-mount` / `name: dsh-file-mount` / `enabled: true`。
- 测试覆盖层 `experiments/hikari-file-mount/test.patch.yml`：
  - 禁用 `hikari-perception` / `hikari-world` / `hikari-activation` / `hikari-replay` / `hikari-scoped-fs` / `hikari-project-status`（避免自动唤醒、避免 read 被 scoped-fs 替换）；
  - 启用原生 `tool-fs`（`read`/`write`/`edit`/`readImage`）与 `tool-fs-search`；
  - `file-mount` 保持启用。
  - 该覆盖层只通过 `--patch` 生效，不写回 profile 的 `cordis.patch.yml`。
- `request/header`（seq 25，reason=initial）tools 列表：
  `ask_user_question, create_goal, edit, exit_plan_mode, file_mount_forget, get_goal, glob, grep, interrupt_agent, job_kill, job_list, job_output, list_agents, present, pwsh, read, read_image, schedule_*, send_message, skill, subagent, subagent_fork, todo_write, update_goal, web_fetch, web_search, workflow, working_directory, write`
  → `file_mount_forget` 已注册，`read` 为原生 `dsh-tool-fs`。

## 2. 阶段二：重复读取

测试文件：`experiments/hikari-file-mount/probe.txt`（初始 20 行，内容 `line 01 — alpha` … `line 20 — tango`）。

| 事件 | seq | 内容 |
|---|---|---|
| 第一次 `read`（offset=1, limit=10） | 33 | 参数 `{"file_path": "...probe.txt", "offset": 1, "limit": 10}` |
| 第一次结果 | 34 | **原生全文**：`<path>…</path>` + `<content>` 10 行 + `(Showing lines 1-10 of 20…)`；**未被改写** |
| 挂载标记 | 39 | `user/message`：`[file-mount: experiments/hikari-file-mount/probe.txt hash:2a21c583 mounted:L1-10]` |
| 第二次 `read`（同 path/offset/limit） | 42 | 参数与第一次等价（JSON 键顺序不同：`limit` 在前） |
| 第二次结果 | 43 | **被替换**为：`[file-mount: … hash:2a21c583 mounted:L1-10] - already mounted, not re-added. If this content is not in the conversation above, call file_mount_forget then read the file again.`（无正文） |
| 节省标记 | 48 | `user/message`：`[file-mount: … mounted:L1-10] - already mounted, saved ≈ 42 tokens` |

判定：**PASS**。第二次读取的 `tool/result` 不含正文，正文只在上文历史里出现一次；原始第一次结果未被插件改写。

## 3. 阶段三：文件变化后重读

操作：修改 `probe.txt` 三处——L3 `charlie` → `charlie-changed`，L7 `golf` → `golf-updated`，末尾追加 `line 21 — uniform`；新 SHA256 `BC12D3A3D3C13DF179DD4AA75BE7177D285C7733C184DC4D80DE913CF2901617`。

| 事件 | seq | 内容 |
|---|---|---|
| 第三次 `read`（同范围） | 60 | 参数 `{"file_path": "...probe.txt", "limit": 10, "offset": 1}` |
| 第三次结果 | 61 | `[file-mount: … hash:bc12d3a3 mounted:L1-10] - file changed: +3/-2 lines (~18 unchanged) since last mount` + `--- L3 ---` `3: line 03 — charlie-changed` + `--- L7 ---` `7: line 07 — golf-updated` |
| 变化标记 | 66 | `user/message`：同一条 `file changed: +3/-2 lines…` 文本 |

判定：**PASS**。
- 内容变化被检测：hash 从 `2a21c583` 变为 `bc12d3a3`，不是只看 mtime。
- 只返回差异片段（L3、L7），没有重发 10 行正文。
- 旧内容未被错误隐藏：第一次 `read` 的全文仍保留在会话历史（seq 34 未被改写）。

**观察点（未判定为失败）**：追加的 `line 21` 未在 diff 中单独出现。本轮读取范围是 `L1-10`，line 21 在挂载范围之外；`+3/-2` 的 `+3` 与「L3、L7 两处替换 = +2/-2」不一致，多出的 `+1` 可能是文件总行数变化（20→21）被计入统计，但仅凭返回文本无法确认是「行数统计」还是「漏展示追加行」。报告如实记录，不作为 PASS 依据。

## 4. 阶段四：主动强制重读

| 事件 | seq | 内容 |
|---|---|---|
| `file_mount_forget` | 78 | 参数 `{"file_path": "...probe.txt"}` |
| 返回 | 79 | `Mount ledger entry forgotten; the next read will re-send the file content.`（无独立挂载标记） |
| 重读 `read`（offset=1, limit=10） | 84 | 参数同前 |
| 重读结果 | 85 | **完整正文**：`<path>…</path>` + `<content>` 10 行（含 `charlie-changed`、`golf-updated`）+ `(Showing lines 1-10 of 21…)` |
| 重新挂载标记 | 90 | `user/message`：`[file-mount: … hash:bc12d3a3 mounted:L1-10]`（无 `already mounted` 后缀） |

判定：**PASS**。账本条目被作废，重读恢复全文；文件未再变化（hash 仍 `bc12d3a3`），差异仅来自账本清空。

## 5. 未覆盖 / 限制

- 未测试 `write` / `edit` 后的「读免单」行为（README 声称 write 后读免单），也未测试 `capacity` / `ttlMs` / `maxPinnedFiles` / 排除规则等配置项。
- 未测试多文件并发、跨会话账本隔离、文件被删除后的行为。
- 本测试只覆盖 `read` 路径；`edit` / `write` 的 post-execute 拦截未实测。
- 测试使用 `--patch` 覆盖实例，`hikari` profile 的正式 `cordis.patch.yml` 未被修改；desktop 实例未安装、未重启、未改动。
- 报告中的返回值均来自用户回贴 + session 日志双源核对；`probe.txt` 最终 hash 为 `BC12D3A3…`（21 行）。

## 6. 清理

测试实例（3090，pid 50676 / 子进程 65500）当前仍在运行。是否卸载 `dsh-file-mount` 并重启回 hikari 基线，等确认后再执行。
