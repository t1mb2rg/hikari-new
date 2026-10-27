// PoC-02 适配层：在 PoC-01 的服务桥接之上补事件桥接。
//
// 两条映射是本轮实测的对象，不是设计决定：
//   Hikari events.emit  →  Cordis ctx.parallel（emit 是同步不等的，只有 parallel 才 await）
//   Hikari events.on    →  Cordis ctx.on（disposer 作为 effect 随 fiber 卸载自动清理）
//
// Hikari 的 AggregateError 带 message；Cordis 的 parallel 抛的 AggregateError 没有 message
// （cordis/lib/index.js:273 只传 errors）。这里补一层包装是「需适配」的实证，不是美化。

export const serviceName = (contract) =>
  `${contract.id.replace(/[^A-Za-z0-9]/g, '_')}_v${contract.version}`;

export const eventName = (contract) => `${contract.id}@${contract.version}`;

export function toCordisPlugin(def, config, label = def.id) {
  const trace = { label, provided: [], emitted: 0, cleanups: [] };

  const plugin = async (ctx) => {
    const hikariContext = {
      pluginId: def.id,
      services: {
        get(contract) {
          const name = serviceName(contract);
          const value = ctx.get(name, false);
          if (value === undefined) throw new Error(`[adapter] service ${name} is not provided`);
          return value;
        },
        provide(contract, provider) {
          const name = serviceName(contract);
          trace.provided.push(name);
          return ctx.provide(name, provider);
        },
      },
      events: {
        on(contract, handler) {
          ctx.on(eventName(contract), handler);
        },
        async emit(contract, payload) {
          trace.emitted += 1;
          try {
            await ctx.parallel(eventName(contract), payload);
          } catch (error) {
            if (error instanceof AggregateError) {
              throw new AggregateError(
                error.errors,
                `Event ${eventName(contract)} had failing subscribers.`,
              );
            }
            throw error;
          }
        },
      },
      defer(cleanup) {
        ctx.effect(() => async () => {
          trace.cleanups.push('ran');
          await cleanup();
        });
      },
    };

    await def.setup(hikariContext, config);
  };

  plugin.inject = (def.requires ?? []).map(serviceName);
  return { plugin, trace };
}
