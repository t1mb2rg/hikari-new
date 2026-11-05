/**
 * Hikari Native — Memory 插件（M1-b 接管检索工具；M2-a 接入全局存储）。
 *
 * 职责：接管 `search_memory` / `read_memory` 两个检索工具的注册权，
 * 并持有 Hikari 自己的长期记忆存储（`DSH_HOME/hikari/memory/`）。
 *
 * 边界：
 *   - 检索数据仍然只来自 World 的只读 Service（`hikariWorldFindings`）——
 *     M2-a 只把存储层立起来，还不往里面写，也不从里面读。
 *   - 不拥有 Findings。`record_finding` 永远是 World 的。
 *   - 不做 Finding → Memory 同步，不新增检索算法，不做自动分类与过期。
 */
import { homedir } from 'node:os'

import { MemoryStore } from './store.mjs'
import { installMemoryTools, MEMORY_TOOL_NAMES } from './tools.js'
import { installMemoryWriteTools } from './writing.js'
import { installMemoryRecallTools } from './recall.js'
import { installMemoryStatusTool } from './status.js'

export const name = 'hikari-memory'
export const inject = ['tools', 'hikariWorldFindings']

/**
 * 把绝对路径缩成可读形式。ready 日志会进 stderr，没必要把用户名和完整目录
 * 打出去——任务书 §3 要求日志不含用户信息。
 */
function presentDir(dir) {
  const home = homedir()
  if (dir === home) return '~'
  if (dir.startsWith(`${home}/`) || dir.startsWith(`${home}\\`)) {
    return `~${dir.slice(home.length)}`
  }
  return dir
}

/** 把 damage 计数压成一行；全为 0 时写 none，避免日志里出现四个零。 */
function presentDamage(damage) {
  const parts = []
  if (damage.tailCorrupt !== null) parts.push(`tailCorrupt@${damage.tailCorrupt.line}`)
  if (damage.skippedCorruptLines > 0) parts.push(`skippedCorrupt=${damage.skippedCorruptLines}`)
  if (damage.skippedDuplicates > 0) parts.push(`skippedDup=${damage.skippedDuplicates}`)
  if (damage.metaRepaired) parts.push('metaRepaired')
  return parts.length === 0 ? 'none' : parts.join('+')
}

export async function apply(ctx, config = {}) {
  const service = ctx.get('hikariWorldFindings')
  if (service === undefined) {
    throw new Error(
      'hikari-memory: the "hikariWorldFindings" service is missing — hikari-world must be loaded first',
    )
  }

  // 最终工具注册表里每个工具只能有一个提供者。DSH 在同一 layer 内重名注册时确实会抛
  // （`dsh-tools` 的 NamedEntries），但只说 "already registered"；这里先查一遍，是为了
  // 把「在同一个 patch 里设 world.registerMemoryTools: false」这个解法写进错误信息里。
  // 注意：跨 `agent.ctx` 的 scope 注册是 shadow，不会抛——那条路径不归这里管。
  for (const toolName of MEMORY_TOOL_NAMES) {
    if (ctx.tools.get(toolName) !== undefined) {
      throw new Error(
        `hikari-memory: "${toolName}" is already registered — set world's registerMemoryTools: false ` +
        'in the same patch that loads this plugin, so exactly one plugin provides it',
      )
    }
  }

  // 存储先于工具打开：打不开（schema 不兼容、中间行损坏）就整插件拒绝加载，
  // 而不是先把工具挂上去、再在第一次使用时才暴露问题。任务书 §3.2 要求
  // 「无法安全恢复的数据明确报错」——拒绝加载就是最明确的那种报错。
  const store = await MemoryStore.open({ storeDir: config.storeDir })
  ctx.effect(() => () => {
    void store.close()
  })

  installMemoryTools(ctx, service)
  // 写入工具拿到的是 store 本身（不是 World 的只读 service）：写记忆不需要读 findings，
  // 而读记忆也不该顺手拿到写权限。两者注册在同一 fiber 下，卸载时一起消失。
  installMemoryWriteTools(ctx, store)
  // 发现工具同样是只读的 store 使用者：检索与读取长期记忆，不碰 findings、不写盘。
  installMemoryRecallTools(ctx, store)
  // 状态汇总：回答「一共记了几条、最近记了什么、刚拒了什么」，只读、不做匹配。
  installMemoryStatusTool(ctx, store)

  // 只有在两个工具都注册成功之后才到这里；上面任何一步 throw 都不会打印。
  // 这行日志是「谁在提供这两个工具」的唯一运行时可观测信号——冲突检测的失败
  // 方式是抛错，若 World 那边还开着 registerMemoryTools，工具会退化成由 World
  // 提供，行为一样但来源不同。看到 ready 才算 Memory 真的接管了。
  // 只记来源、可用性与存储计数，不记任何记忆内容、检索词或用户信息。
  //
  // 为什么是 `console.error` 而不是 `ctx.logger.info`：DSH 的 `dsh-app-boot`
  // 只注册了一个 `levels: { default: 2 }` 的 exporter（warn/error 才进 startupLogs，
  // 且仅在启动失败时展示），info 级既不落盘也不进 GUI。写进 logger buffer 等于看不见。
  // stderr 是这条启动路径上唯一确定可被接手的人看到的地方。
  const { sources, available } = service.describe()
  console.error(
    `[hikari-memory] ready — provider=${name}, tools=${MEMORY_TOOL_NAMES.join(',')}, ` +
    `source=${sources.join(',')}, available=${available}, ` +
    `store=${presentDir(store.dir)}, records=${store.size}, seq=${store.lastSeq}, ` +
    `damage=${presentDamage(store.damage)}`,
  )
}
