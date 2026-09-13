import type { Cleanup, ServiceContract } from './contracts.js';
import { serviceKey } from './contracts.js';
import { ServiceAlreadyProvidedError, ServiceUnavailableError } from './errors.js';

interface ProviderRecord {
  readonly ownerId: string;
  readonly value: unknown;
}

export class ServiceRegistry {
  readonly #providers = new Map<string, ProviderRecord>();

  has(contract: ServiceContract<unknown>): boolean {
    return this.#providers.has(serviceKey(contract));
  }

  get<T>(contract: ServiceContract<T>): T {
    const key = serviceKey(contract);
    const record = this.#providers.get(key);
    if (!record) {
      throw new ServiceUnavailableError(key);
    }
    return record.value as T;
  }

  isProvidedBy(contract: ServiceContract<unknown>, ownerId: string): boolean {
    return this.#providers.get(serviceKey(contract))?.ownerId === ownerId;
  }

  register<T>(contract: ServiceContract<T>, value: T, ownerId: string): Cleanup {
    const key = serviceKey(contract);
    const existing = this.#providers.get(key);
    if (existing) {
      throw new ServiceAlreadyProvidedError(key, existing.ownerId);
    }

    const record: ProviderRecord = { ownerId, value };
    this.#providers.set(key, record);

    return () => {
      if (this.#providers.get(key) === record) {
        this.#providers.delete(key);
      }
    };
  }
}
