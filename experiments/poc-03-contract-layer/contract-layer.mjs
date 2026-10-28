// PoC-03 契约适配层：在 Cordis 4.0.5 上恢复 Hikari 的 Service / Event / 生命周期纪律。
//
// 这不是「让它能跑」的胶水，而是「把 Hikari 明令禁止的操作恢复成禁止」的一层检查。
// 五条纪律、三层失败、契约键编码、错误转存，各自对应 Hikari 的一个真实语义：
//
//   R1 未声明 get 拒绝        src/runtime/plugin-context.ts:22-32
//   R2 依赖缺失保持 PENDING   src/runtime/runtime.ts:98-110
//   R3 未声明 provide 拒绝    src/runtime/plugin-context.ts:22-32
//   R4 声明 provides 未提供   src/runtime/runtime.ts:134-138
//   R5 重复 provide 拒绝      src/runtime/service-registry.ts
//
// 三层失败（定义验证 / 配置解析 / setup）在 Hikari 里是三种可区分结果：
//   runtime.ts:35   定义验证，同步抛给调用者
//   runtime.ts:38   配置解析，同步抛给调用者
//   runtime.ts:120-142 / :145-157  setup 失败，落成 state='failed' + error，不抛
// Cordis 只有一层 catch（lib/index.js:1355-1363），所以前两层必须由这一层在 ctx.plugin() 之前完成。

import { pathToFileURL } from 'node:url';

export const contractKey = (contract) => {
  if (!contract || typeof contract.id !== 'string' || !Number.isInteger(contract.version)) {
    throw new TypeError(`not a contract: ${JSON.stringify(contract)}`);
  }
  return `${contract.id}@${contract.version}`;
};

/** 与 s2 的 key-codec.mjs 同一套规则；这里只做编解码，不做扫描。 */
export const decodeContractKey = (key) => {
  const cut = key.lastIndexOf('@');
  return { id: key.slice(0, cut), version: Number(key.slice(cut + 1)) };
};

// ---------------------------------------------------------------- 错误类型

/** 与 Hikari 的错误同形：type 用来区分哪一层失败，original 保留宿主抛出的原对象。 */
export class ContractLayerError extends Error {
  constructor(layer, message, original) {
    super(message);
    this.name = 'ContractLayerError';
    this.layer = layer; // 'definition' | 'config' | 'setup' | 'discipline'
    this.original = original;
  }
}

export class UndeclaredDependencyError extends ContractLayerError {
  constructor(pluginId, key) {
    super('discipline', `Plugin ${pluginId} tried to use undeclared service dependency ${key}.`);
    this.name = 'UndeclaredDependencyError';
    this.pluginId = pluginId;
    this.serviceId = key;
  }
}

export class UndeclaredProvisionError extends ContractLayerError {
  constructor(pluginId, key) {
    super('discipline', `Plugin ${pluginId} tried to provide undeclared service ${key}.`);
    this.name = 'UndeclaredProvisionError';
    this.pluginId = pluginId;
    this.serviceId = key;
  }
}

export class MissingDeclaredServiceError extends ContractLayerError {
  constructor(pluginId, key) {
    super('discipline', `Plugin ${pluginId} declared service ${key} but did not provide it during setup.`);
    this.name = 'MissingDeclaredServiceError';
    this.pluginId = pluginId;
    this.serviceId = key;
  }
}

export class ServiceAlreadyProvidedError extends ContractLayerError {
  constructor(key, ownerId) {
    super('discipline', `Service ${key} is already provided by ${ownerId}.`);
    this.name = 'ServiceAlreadyProvidedError';
    this.serviceId = key;
    this.ownerId = ownerId;
  }
}

export class DuplicatePluginError extends ContractLayerError {
  constructor(pluginId) {
    super('definition', `Plugin already loaded: ${pluginId}`);
    this.name = 'DuplicatePluginError';
    this.pluginId = pluginId;
  }
}

// ---------------------------------------------------------------- 适配层

const CORDIS_STATE = { 0: 'waiting', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' };

/**
 * @param app Cordis Context
 * @param options.validateDefinition 可选：Hikari 的 validatePluginDefinition（从 dist 导入后传进来）
 */
export function createContractLayer(app, options = {}) {
  const validateDefinition = options.validateDefinition ?? (() => {});
  /** pluginId -> { definition, config, fiber, state, error, layer, provided: Set<string> } */
  const records = new Map();
  /** 契约键 -> 提供者 pluginId */
  const providedBy = new Map();

  const fail = (pluginId, layer, error) => {
    const record = records.get(pluginId);
    if (record) {
      record.state = 'failed';
      record.layer = layer;
      // 转存，不重建：调用方拿到的就是宿主抛出的那个对象。
      // 若 cleanup 也失败，按 Hikari 的形状合成（runtime.ts:145-157）：
      //   AggregateError([setupError, AggregateError(cleanupErrors, 'One or more plugin resources failed to clean up.')],
      //                  'Plugin <id> failed during setup and cleanup.')
      record.error = record.cleanupErrors.length
        ? new AggregateError(
            [
              error,
              new AggregateError(record.cleanupErrors, 'One or more plugin resources failed to clean up.'),
            ],
            `Plugin ${pluginId} failed during setup and cleanup.`,
          )
        : error;
    }
    return error;
  };

  const makeContext = (fiberCtx, definition) => {
    const declared = new Set((definition.requires ?? []).map(contractKey));
    const declaredProvides = new Set((definition.provides ?? []).map(contractKey));

    return {
      pluginId: definition.id,
      services: {
        get(contract) {
          const key = contractKey(contract);
          if (!declared.has(key)) throw new UndeclaredDependencyError(definition.id, key);
          const value = fiberCtx.get(key, false);
          if (value === undefined) throw new Error(`Service is unavailable: ${key}`);
          return value;
        },
        provide(contract, provider) {
          const key = contractKey(contract);
          if (!declaredProvides.has(key)) throw new UndeclaredProvisionError(definition.id, key);
          const owner = providedBy.get(key);
          if (owner && owner !== definition.id) throw new ServiceAlreadyProvidedError(key, owner);
          providedBy.set(key, definition.id);
          const record = records.get(definition.id);
          record?.provided.add(key);
          return fiberCtx.provide(key, provider);
        },
      },
      events: {
        on(contract, handler) {
          fiberCtx.on(`${contract.id}@${contract.version}`, handler);
        },
        async emit(contract, payload) {
          const name = `${contract.id}@${contract.version}`;
          try {
            await fiberCtx.parallel(name, payload);
          } catch (error) {
            if (error instanceof AggregateError) {
              throw new AggregateError(error.errors, `Event ${name} had failing subscribers.`);
            }
            throw error;
          }
        },
      },
      defer(cleanup) {
        fiberCtx.effect(() => async () => {
          try {
            await cleanup();
          } catch (error) {
            // Cordis 会吃掉 effect 清理错误；这里先记下来，由失败路径按 Hikari 的形状合成。
            const record = records.get(definition.id);
            record?.cleanupErrors.push(error);
            throw error;
          }
        });
      },
    };
  };

  const toCordisPlugin = (definition) => {
    const plugin = async (fiberCtx) => {
      const hikariContext = makeContext(fiberCtx, definition);
      const returned = await definition.setup(hikariContext, records.get(definition.id)?.config);
      if (typeof returned === 'function') {
        fiberCtx.effect(() => async () => {
          await returned();
        });
      }
      // R4：声明的 provides 必须在本插件 setup 期间真的提供出去
      for (const contract of definition.provides ?? []) {
        const key = contractKey(contract);
        if (providedBy.get(key) !== definition.id) {
          throw new MissingDeclaredServiceError(definition.id, key);
        }
      }
    };
    // R2：requires 未满足时 Cordis 保持 PENDING（不失败），与 Hikari 的 waiting 对应
    plugin.inject = (definition.requires ?? []).map(contractKey);
    return plugin;
  };

  /**
   * 按宿主的真实注册表校准簿记。
   *
   * 为什么需要它：Cordis 的 inject 在提供方消失时会自行停用下游并把它的 provide 撤掉，
   * 这个过程不经过本层的 unloadPlugin，所以 providedBy / record.provided 会留下属主已死的条目。
   * 不校准的后果不是显示问题：下一个想提供同一契约的插件会被「already provided by <已停用的插件>」误拒。
   */
  const reconcile = () => {
    for (const [key, owner] of providedBy) {
      if (app.get(key, false) === undefined) providedBy.delete(key);
    }
    for (const record of records.values()) {
      for (const key of record.provided) {
        if (!providedBy.has(key)) record.provided.delete(key);
      }
    }
  };

  return {
    async loadPlugin(definition, configInput) {
      reconcile();
      // —— 层 1：定义验证。同步抛，不建 record。
      try {
        validateDefinition(definition);
      } catch (error) {
        throw new ContractLayerError('definition', error?.message ?? String(error), error);
      }
      if (records.has(definition.id)) throw new DuplicatePluginError(definition.id);

      // —— 层 2：配置解析。同步抛，不建 record。
      let config;
      if (definition.config) {
        try {
          config = definition.config.parse(configInput);
        } catch (error) {
          throw new ContractLayerError('config', error?.message ?? String(error), error);
        }
      }

      // —— 层 3：setup。异步，失败不抛给调用者，落成记录。
      const record = {
        definition,
        config,
        fiber: undefined,
        state: 'waiting',
        error: undefined,
        layer: undefined,
        provided: new Set(),
        cleanupErrors: [],
      };
      records.set(definition.id, record);

      const plugin = toCordisPlugin(definition);
      const fiber = app.plugin(plugin);
      record.fiber = fiber;

      try {
        await fiber.await();
      } catch (error) {
        // Cordis 在失败后自行清理 effect；给它一轮宏任务，cleanup 的错误才进得来。
        await new Promise((r) => setTimeout(r, 0));
        fail(definition.id, 'setup', error);
        return 'failed';
      }

      record.state = CORDIS_STATE[fiber.state] ?? 'unknown';
      return record.state;
    },

    async unloadPlugin(pluginId) {
      const record = records.get(pluginId);
      if (!record) return;
      for (const [key, owner] of providedBy) if (owner === pluginId) providedBy.delete(key);
      try {
        await record.fiber?.dispose?.();
      } catch {
        /* dispose 后的错误不影响记录删除 */
      }
      records.delete(pluginId);
    },

    getPluginState(pluginId) {
      const record = records.get(pluginId);
      if (!record) return undefined;
      // 'failed' 是装载结束时就定的结论，不会被级联改写；
      // 其余状态必须实时问宿主——级联停用（inject 失效）不会经过本层，缓存的 'active' 会失真。
      if (record.state === 'failed') return 'failed';
      if (!record.fiber) return record.state;
      return CORDIS_STATE[record.fiber.state] ?? 'unknown';
    },

    /** 转存的原对象：类型、instanceof、自定义字段、堆栈全部保留。 */
    getPluginError(pluginId) {
      return records.get(pluginId)?.error;
    },

    getPluginLayer(pluginId) {
      return records.get(pluginId)?.layer;
    },

    /** 供验证脚本观察内部登记，不是产品 API。会先按宿主真实注册表校准一次。 */
    inspect() {
      reconcile();
      return {
        records: [...records.entries()].map(([id, r]) => ({
          id,
          state: r.state,
          fiberState: r.fiber?.state,
          fiberStateName: CORDIS_STATE[r.fiber?.state],
          layer: r.layer,
          hasError: r.error !== undefined,
          provided: [...r.provided],
        })),
        providedBy: [...providedBy.entries()],
      };
    },
  };
}

/** 从 hikari-new 的 dist 取定义验证器，避免在适配层重写一份。 */
export async function loadHikariValidator(repoRoot) {
  const url = pathToFileURL(`${repoRoot}/dist/runtime/plugin.js`).href;
  const mod = await import(url);
  return mod.validatePluginDefinition;
}
