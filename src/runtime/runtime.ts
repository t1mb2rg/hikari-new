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
  /** This record's most recent activation, so an unload can wait for one still in flight. */
  activation: Promise<void> | undefined;
  /** True once an unload has claimed a record whose setup had not returned yet. */
  unloading: boolean;
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
      activation: undefined,
      unloading: false,
    };
    this.#plugins.set(definition.id, record);
    await this.#reconcile();
    return record.state;
  }

  // Unload resolves once the plugin is no longer running and no longer producing anything.
  // That is a stronger promise than "the record is gone", and the difference is a setup
  // that had not returned yet: a setup cannot be cancelled and its scope cannot be disposed
  // while it is still being filled, so the activation disposes it itself the moment it
  // notices the unload. Deleting the record before then would leave the activation running
  // with nothing in the Runtime owning it — the state `loadPlugin` reports would be one
  // this call had already given up on, and whatever setup opened after the delete would
  // never be closed.
  async unloadPlugin(pluginId: string): Promise<void> {
    const record = this.#plugins.get(pluginId);
    if (!record) return;
    await this.#deactivateTree(pluginId, new Set());
    await record.activation;
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
        // A record an unload has claimed is on its way out, whatever state it lands in on
        // the way. Activating it here would start it a second time for nobody.
        if (record.unloading) continue;
        if (record.state === 'waiting' && this.#requirementsSatisfied(record.definition)) {
          // The activation is held on the record, not just awaited here: an unload arriving
          // while it is in flight has to be able to wait for this very promise.
          record.activation = this.#activate(record);
          await record.activation;
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

      // An unload arrived while this setup was still running. It could not dispose this
      // scope — it was still being filled — so the teardown was left to here, the only
      // moment at which the scope holds everything this activation registered. Reporting
      // `active` instead would announce a plugin the Runtime has already given up on.
      if (record.unloading) {
        await this.#tearDown(record);
        return;
      }

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
    // A setup in flight owns its scope until it returns, and nothing here can cancel it.
    // Claim the record instead and leave the scope alone: the activation tears it down
    // itself once it has finished filling it, and the unload that is waiting on this walk
    // does not treat the record as gone until that has happened.
    if (record.state === 'starting') {
      record.unloading = true;
      return;
    }

    if (record.state !== 'active') {
      if (record.state !== 'failed') record.state = 'waiting';
      return;
    }

    await this.#tearDown(record);
  }

  /** Disposes the record's scope and leaves the record `waiting`. */
  async #tearDown(record: PluginRecord): Promise<void> {
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
