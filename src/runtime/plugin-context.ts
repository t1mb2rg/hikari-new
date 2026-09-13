import { serviceKey, type ServiceContract } from './contracts.js';
import { EffectScope } from './effect-scope.js';
import { EventBus } from './event-bus.js';
import {
  UndeclaredServiceDependencyError,
  UndeclaredServiceProviderError,
} from './errors.js';
import type { AnyPluginDefinition, PluginContext } from './plugin.js';
import { ServiceRegistry } from './service-registry.js';

export function createPluginContext(
  definition: AnyPluginDefinition,
  scope: EffectScope,
  services: ServiceRegistry,
  events: EventBus,
): PluginContext {
  const required = new Set((definition.requires ?? []).map(serviceKey));
  const provided = new Set((definition.provides ?? []).map(serviceKey));

  return {
    pluginId: definition.id,
    services: {
      get: <T>(contract: ServiceContract<T>): T => {
        const key = serviceKey(contract);
        if (!required.has(key)) throw new UndeclaredServiceDependencyError(definition.id, key);
        return services.get(contract);
      },
      provide: <T>(contract: ServiceContract<T>, provider: T): void => {
        const key = serviceKey(contract);
        if (!provided.has(key)) throw new UndeclaredServiceProviderError(definition.id, key);
        scope.defer(services.register(contract, provider, definition.id));
      },
    },
    events: {
      on: (contract, handler): void => {
        scope.defer(events.subscribe(contract, definition.id, handler));
      },
      emit: (contract, payload): Promise<void> => events.emit(contract, payload),
    },
    defer: (cleanup): void => scope.defer(cleanup),
  };
}
