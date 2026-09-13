import { serviceKey } from './contracts.js';
import { EffectScope } from './effect-scope.js';
import { EventBus } from './event-bus.js';
import { DuplicatePluginError, MissingDeclaredServiceError } from './errors.js';
import { createPluginContext } from './plugin-context.js';
import {
  type AnyPluginDefinition,
  type PluginDefinition,
  type PluginState,
  validatePluginDefinition,
} from './plugin.js';
import { ServiceRegistry } from './service-registry.js';

interface PluginRecord {
  readonly definition: AnyPluginDefinition;
  readonly config: unknown;
  state: PluginState;
  scope: EffectScope | undefined;
  error: unknown | undefined;
}

export class Runtime {
  readonly #services = new ServiceRegistry();
  readonly #events = new EventBus();
  readonly #plugins = new Map<string, PluginRecord>();

  async loadPlugin<TConfig>(
    definition: PluginDefinition<TConfig>,
    configInput?: unknown,
  ): Promise<PluginState> {
    validatePluginDefinition(definition);
    if (this.#plugins.has(definition.id)) throw new DuplicatePluginError(definition.id);

    const config = definition.config ? definition.config.parse(configInput) : undefined;
    const record: PluginRecord = {
      definition,
      config,
      state: 'waiting',
      scope: undefined,
      error: undefined,
    };
    this.#plugins.set(definition.id, record);
    await this.#reconcile();
    return record.state;
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    if (!this.#plugins.has(pluginId)) return;
    await this.#deactivateTree(pluginId, new Set());
    this.#plugins.delete(pluginId);
    await this.#reconcile();
  }

  getPluginState(pluginId: string): PluginState | undefined {
    return this.#plugins.get(pluginId)?.state;
  }

  getPluginError(pluginId: string): unknown {
    return this.#plugins.get(pluginId)?.error;
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.#plugins.keys()].reverse()) {
      if (this.#plugins.has(id)) await this.unloadPlugin(id);
    }
  }

  async #reconcile(): Promise<void> {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, record] of this.#plugins) {
        if (record.state === 'active' && !this.#requirementsSatisfied(record.definition)) {
          await this.#deactivateTree(id, new Set());
          changed = true;
        }
      }
      for (const record of this.#plugins.values()) {
        if (record.state === 'waiting' && this.#requirementsSatisfied(record.definition)) {
          await this.#activate(record);
          changed = true;
        }
      }
    }
  }

  #requirementsSatisfied(definition: AnyPluginDefinition): boolean {
    return (definition.requires ?? []).every((contract) => this.#services.has(contract));
  }

  async #activate(record: PluginRecord): Promise<void> {
    const { definition } = record;
    record.state = 'starting';
    record.error = undefined;
    const scope = new EffectScope();
    record.scope = scope;

    try {
      const context = createPluginContext(definition, scope, this.#services, this.#events);
      const cleanup = await definition.setup(context, record.config);
      if (cleanup) scope.defer(cleanup);

      for (const contract of definition.provides ?? []) {
        if (!this.#services.isProvidedBy(contract, definition.id)) {
          throw new MissingDeclaredServiceError(definition.id, serviceKey(contract));
        }
      }
      record.state = 'active';
    } catch (error) {
      await this.#failActivation(record, scope, error);
    }
  }

  async #failActivation(record: PluginRecord, scope: EffectScope, error: unknown): Promise<void> {
    record.error = error;
    record.state = 'failed';
    try {
      await scope.dispose();
    } catch (cleanupError) {
      record.error = new AggregateError(
        [error, cleanupError],
        `Plugin ${record.definition.id} failed during setup and cleanup.`,
      );
    }
    record.scope = undefined;
  }

  async #deactivateTree(pluginId: string, visited: Set<string>): Promise<void> {
    if (visited.has(pluginId)) return;
    visited.add(pluginId);
    const record = this.#plugins.get(pluginId);
    if (!record) return;

    const provided = new Set((record.definition.provides ?? []).map(serviceKey));
    for (const [dependentId, dependent] of this.#plugins) {
      if (dependentId === pluginId || dependent.state !== 'active') continue;
      if ((dependent.definition.requires ?? []).some((item) => provided.has(serviceKey(item)))) {
        await this.#deactivateTree(dependentId, visited);
      }
    }
    await this.#deactivate(record);
  }

  async #deactivate(record: PluginRecord): Promise<void> {
    if (record.state !== 'active' && record.state !== 'starting') {
      if (record.state !== 'failed') record.state = 'waiting';
      return;
    }

    record.state = 'stopping';
    const scope = record.scope;
    record.scope = undefined;
    try {
      await scope?.dispose();
      record.state = 'waiting';
    } catch (error) {
      record.error = error;
      record.state = 'failed';
    }
  }
}
