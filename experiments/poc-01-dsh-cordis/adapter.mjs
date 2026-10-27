// PoC-01 共享适配层：把 Hikari 的 PluginDefinition 桥接成 Cordis 插件。
//
// 只做四件事：契约键编码、services.get/provide 转发、defer 收集、requires → inject。
// 任何领域判断都不在这里，全部来自 hikari-new 的 dist/。

export const serviceName = (contract) =>
  `${contract.id.replace(/[^A-Za-z0-9]/g, '_')}_v${contract.version}`;

/**
 * @param def Hikari PluginDefinition
 * @param config 传给 setup 的配置
 * @param label 用于 trace 的短名
 */
export function toCordisPlugin(def, config, label = def.id) {
  const trace = { label, provided: [], cleanups: [], setupReturned: false };

  const plugin = async (ctx) => {
    const disposers = [];

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
          disposers.push(ctx.provide(name, provider));
        },
      },
      events: {
        on() {
          throw new Error('[adapter] events are out of scope for PoC-01');
        },
        emit() {
          throw new Error('[adapter] events are out of scope for PoC-01');
        },
      },
      defer(cleanup) {
        trace.cleanups.push('defer');
        disposers.push(cleanup);
      },
    };

    const returned = await def.setup(hikariContext, config);
    if (typeof returned === 'function') {
      trace.setupReturned = true;
      disposers.push(returned);
    }

    ctx.effect(() => async () => {
      for (const dispose of disposers.reverse()) {
        trace.cleanups.push('ran');
        await dispose();
      }
    });
  };

  plugin.inject = (def.requires ?? []).map(serviceName);
  return { plugin, trace };
}
