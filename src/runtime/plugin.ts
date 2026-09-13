import type { Cleanup, EventContract, ServiceContract } from './contracts.js';
import { serviceKey } from './contracts.js';

export type PluginState = 'waiting' | 'starting' | 'active' | 'stopping' | 'failed';

type MaybePromise<T> = T | Promise<T>;

export interface PluginServiceContext {
  get<T>(contract: ServiceContract<T>): T;
  provide<T>(contract: ServiceContract<T>, provider: T): void;
}

export interface PluginEventContext {
  on<T>(contract: EventContract<T>, handler: (payload: T) => void | Promise<void>): void;
  emit<T>(contract: EventContract<T>, payload: T): Promise<void>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly services: PluginServiceContext;
  readonly events: PluginEventContext;
  defer(cleanup: Cleanup): void;
}

export interface PluginDefinition {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly ServiceContract<unknown>[];
  readonly provides?: readonly ServiceContract<unknown>[];
  setup(context: PluginContext): MaybePromise<void | Cleanup>;
}

export function validatePluginDefinition(definition: PluginDefinition): void {
  if (!definition.id.trim()) throw new Error('Plugin id must not be empty.');
  if (!definition.version.trim()) throw new Error(`Plugin ${definition.id} must have a version.`);
  assertUnique(definition.id, 'requires', definition.requires ?? []);
  assertUnique(definition.id, 'provides', definition.provides ?? []);

  const required = new Set((definition.requires ?? []).map(serviceKey));
  for (const contract of definition.provides ?? []) {
    const key = serviceKey(contract);
    if (required.has(key)) {
      throw new Error(`Plugin ${definition.id} cannot both require and provide ${key}.`);
    }
  }
}

function assertUnique(
  pluginId: string,
  field: string,
  contracts: readonly ServiceContract<unknown>[],
): void {
  const seen = new Set<string>();
  for (const contract of contracts) {
    const key = serviceKey(contract);
    if (seen.has(key)) throw new Error(`Plugin ${pluginId} has duplicate ${field} contract ${key}.`);
    seen.add(key);
  }
}
