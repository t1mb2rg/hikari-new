import type { Cleanup, EventContract, ServiceContract } from './contracts.js';

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
