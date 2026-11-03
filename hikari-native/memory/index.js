/**
 * Hikari Native — Memory 插件骨架（M1-b）。
 *
 * 职责：接管 `search_memory` / `read_memory` 两个检索工具的注册权，
 * 数据仍然只来自 World 的只读 Service（`hikariWorldFindings`）。
 *
 * 边界：
 *   - 不拥有任何数据。Findings 的所有者始终是 World；这里只读。
 *   - 不做 Finding → Memory 同步，不新增持久化，不引入检索算法。
 *   - 不提供统一入口之外的任何写能力：写仍然只有 World 的 `record_finding`。
 */
import { installMemoryTools, MEMORY_TOOL_NAMES } from './tools.js'

export const name = 'hikari-memory'
export const inject = ['tools', 'hikariWorldFindings']

export function apply(ctx) {
  const service = ctx.get('hikariWorldFindings')
  if (service === undefined) {
    throw new Error(
      'hikari-memory: the "hikariWorldFindings" service is missing — hikari-world must be loaded first',
    )
  }

  // 最终工具注册表里每个工具只能有一个提供者。DSH 自己不做这个检查
  // （`tools.register` 无同名校验），所以防护写在这里。
  for (const toolName of MEMORY_TOOL_NAMES) {
    if (ctx.tools.get(toolName) !== undefined) {
      throw new Error(
        `hikari-memory: "${toolName}" is already registered — set world's registerMemoryTools: false ` +
        'in the same patch that loads this plugin, so exactly one plugin provides it',
      )
    }
  }

  installMemoryTools(ctx, service)

  const { sources, available } = service.describe()
  ctx.logger.info(`hikari memory ready (sources=${sources.join(',')}, available=${available})`)
}
