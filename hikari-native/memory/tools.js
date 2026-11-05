/**
 * Hikari Native — Memory 的两个检索工具。
 *
 * 定义从 `world/findings.js` 逐字搬来（M1-b），只把执行体换成调用 World 的
 * 只读 Service：模型可见的工具名、描述、参数与输出 schema 都不变。
 *
 * 边界：这里只做「检索与读取」，不写、不改状态、不做 Finding → Memory 同步。
 */
// 七个名字：两个检索（World 也能提供）、两个写入（writing.js）、两个发现（recall.js）、
// 一个状态汇总（status.js）。
// 顺序即 ready 行与测试里 tools.order 的顺序。
export const MEMORY_TOOL_NAMES = [
  'search_memory',
  'read_memory',
  'write_memory',
  'revise_memory',
  'search_memories',
  'get_memory',
  'memory_status',
]

export function installMemoryTools(ctx, service) {
  ctx.tools.register({
    name: 'search_memory',
    description:
      'Search your own persisted findings about this project, using whatever words describe what you are trying to remember. ' +
      'Returns candidates only — id, a short excerpt, when, status and full length — never the full text. ' +
      'Call read_memory with one id to read it completely. Use it when the findings already in your context are not enough; ' +
      'skip it when they are. Searching is your choice, not a required step.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'What you are trying to remember, in your own words.' },
        limit: { type: 'number', description: 'Maximum candidates to return (default 4, max 20). A cap, not a promise.' },
        offset: { type: 'number', description: 'Skip this many matches, to browse further in the same query.' },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                line: { type: 'string' },
                at: { type: 'string' },
                status: { type: 'string' },
                chars: { type: 'number' },
              },
              required: ['id'],
            },
          },
          total: { type: 'number' },
          shown: { type: 'number' },
          hasMore: { type: 'boolean' },
          // 只在还有下一页时出现。dsh-tools 不接受类型数组（type: ['number','null']），
          // 实测会让整个插件激活失败，所以这里只声明数字、缺省即无下一页。
          nextOffset: { type: 'number' },
        },
        required: ['results', 'total', 'shown', 'hasMore'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      return service.search(args)
    },
  })

  ctx.tools.register({
    name: 'read_memory',
    description:
      'Read one persisted finding completely, by an id returned from search_memory. ' +
      'Returns the claim, its recorded status together with a plain-language reading of what that status does and does not mean, ' +
      'and the evidence pointers recorded when it was written. Those pointers locate the session events of that moment; ' +
      'after a restart they may no longer resolve, and they never prove the claim still holds. One finding per call — ' +
      'reading several is several decisions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Finding id from search_memory (e.g. "f-004").' },
        offset: { type: 'number', description: 'Character offset into the text, default 0.' },
        limit: { type: 'number', description: 'Characters to return, default 2000, max 6000.' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          findingId: { type: 'string' },
          recordedAt: { type: 'number' },
          status: { type: 'string' },
          statusReading: { type: 'string' },
          provenance: { type: 'string' },
          claim: { type: 'string' },
          evidence: { type: 'array', items: { type: 'object', additionalProperties: true } },
          scope: { type: 'object', additionalProperties: true },
          text: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
          totalChars: { type: 'number' },
          truncated: { type: 'boolean' },
        },
        required: ['id', 'status', 'statusReading', 'text'],
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      return service.read(args)
    },
  })
}
