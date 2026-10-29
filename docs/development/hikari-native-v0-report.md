# Hikari Native v0 完成记录

> 日期：2026-10-29
> 基于 DSH `0.2.1-rc.3`（deepseek-harness）与 Cordis `4.0.5`
> 状态：**v0 技术闭环完成**，可交接。

## 一句话结论

Hikari Native v0 已经跑通「感知 → 注意 → 唤醒 → 推理 → 记录」的自主认知闭环，并在真实桌面环境上验证了重启恢复、persona 和工具继承。它还不是自我驱动的自主循环，但技术底座成立。

## 已完成

1. **独立 profile `hikari`**
   - 位置：`%USERPROFILE%\.dsh\profiles\hikari`
   - 由 `dsh --profile hikari --from-default-profile web --dump-config` 初始化
   - bundles：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`hikari-native-v0`
   - 与 `desktop` profile 完全隔离（studio GUI 固定 desktop，hikari 只能用 CLI 启动）

2. **运行时形状确认**（desktop 与 hikari 两实例逐项一致）
   - `agentLoop`：`create(id, options={}, meta={cwd})` / `createAgent(ownerCtx, CreateAgentOptions)` / `resume(ownerCtx, ResumeAgentOptions)`
   - `agents`：`currentInitiator/requireInitiator/withInitiator/withoutInitiator/setFactory/create/resume/register/enter/announce/get/isOwnedBy/list/roots`
   - `sessions`：`registerMessageProjection/create/prepare/enter/announce/flush/get/list/fork`
   - 13 个 agent 事件（emit 8 / serial 2 / waterfall 3）+ 4 个 session 事件（`created/disposed/event/flush`）

3. **v0 插件包**：`G:\work\LAB\code\projects\own\hikari-new\hikari-native\`
   - `package.json`（`dsh.bundle.patch` 指向 `cordis.patch.yml`）
   - `cordis.patch.yml`（配置式 Agent + 三个插件行 + 全局工具覆盖）
   - `index.js`、`perception/index.js`、`world/index.js`、`activation/index.js`
   - `locale/en.json`、`locale/zh.json`、`icon.svg`

4. **安装生效**
   - 通过 `plugin_manager install_bundle`（3080 创造模式会话）安装
   - profile `package.json` 已出现 `"hikari-native-v0": "link:G:/work/LAB/code/projects/own/hikari-new/hikari-native"`
   - `dsh --profile hikari --dump-config` 已验证组合树

5. **真实运行验证**
   - 3 次以上无人触发的自主 turn（21:42 / 21:45 / 22:07），分别由 Notepad 窗口切换触发
   - 重启恢复：turn 1→7 连续、seq 57→78，session header 只有一份 → `restoreOrCreateConfigured` 走 resume 分支
   - persona 生效：`system/message` 含 Hikari 观察者身份
   - 工具继承：全局启用 `tool-fs-search` 后，`request/header` 的 tools 出现 `glob, grep, working_directory`，Agent 真实调用了两次 `glob`
   - 全程回复「无需行动」，未主动打扰用户

## 关键架构结论（后续复用）

- **Agent 所有权**：配置式 Agent 由 `agent-loop` 服务的 `FactoryOwnership` 持有；`Activation` 插件重载不影响 Agent，`agent-loop` 重载才会 dispose。
- **Session / World 分工**：Session 保存推理与对话历史；World 保存环境状态、观察、Attention 判断。不复制对话正文。
- **`agent/pre-step` 在 `followup()` 之后**，不能替代 Attention 的唤醒前判断。
- **`session/event` 是 scope-filtered 的**：World 必须 `session.id === 'session-hikari-v0'` 才处理。
- **工具作用域**：`plugin_manager` / `cordis_inspect_*` 是 per-profile 的；工具注册在 profile 全局层，`dsh-base` 默认禁用大部分 tool 行，由 preset 启用；配置式 Agent 继承全局已启用工具。
- **创造模式不是全局的**：desktop 会话的 plugin_manager 只能改 desktop profile，对 Hikari 无效。

## 当前运行状态

- hikari 实例：`dsh --profile hikari --no-open`（后台 job `pwsh-23557dfefdf04109`）
- URL：`http://127.0.0.1:3080/`（token 已省略）
- Session：`%USERPROFILE%\.dsh\sessions\--G-work-LAB-code-projects-own-hikari-new--\session-hikari-v0\session.v4.jsonl.zstd`
- 解压脚本：`%TEMP%\unzstd-session.mjs`（多帧 zstd → JSONL）

## 未完成 / 下一步

自主循环还缺四件事：

1. 驱动源单一（只有窗口事件，没有目标/心跳）
2. 没有跨 turn 保持的自持目标
3. 没有可改变环境的行动能力（当前只有只读 glob/grep）
4. World 是内存态，重启即丢；Agent 判断结论没有回写 World

最小切片建议：**World 持久化** —— 一个 JSON 状态文件 + 启动恢复，把「观察 + 结论」写回，下一轮 Attention 能读到「上次看过什么、判断是什么」。

其他待决：

- 是否给 Agent 加 `tool-fs`（只读 read）——注意它会暴露工作区文件内容，需要能力作用域判断
- 是否加心跳唤醒（只思考、不通知用户）
- 是否把 v0 后续迭代仍放在 `hikari-native/`，还是拆成独立包

## 边界声明

- 未修改 DSH/Cordis 上游源码
- 未修改 `hikari-new/src/`、`hikari-new/test/`（旧 Runtime 完整保留作参考）
- v0 不主动打扰用户
