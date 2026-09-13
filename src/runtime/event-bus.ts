import type { Cleanup, EventContract } from './contracts.js';
import { eventKey } from './contracts.js';

type EventHandler<T> = (payload: T) => void | Promise<void>;

interface Subscription {
  readonly ownerId: string;
  readonly handler: EventHandler<unknown>;
}

export class EventBus {
  readonly #subscriptions = new Map<string, Set<Subscription>>();

  subscribe<T>(contract: EventContract<T>, ownerId: string, handler: EventHandler<T>): Cleanup {
    const key = eventKey(contract as EventContract<unknown>);
    const subscription: Subscription = {
      ownerId,
      handler: handler as EventHandler<unknown>,
    };

    let bucket = this.#subscriptions.get(key);
    if (!bucket) {
      bucket = new Set();
      this.#subscriptions.set(key, bucket);
    }
    bucket.add(subscription);

    return () => {
      const current = this.#subscriptions.get(key);
      if (!current) return;
      current.delete(subscription);
      if (current.size === 0) {
        this.#subscriptions.delete(key);
      }
    };
  }

  async emit<T>(contract: EventContract<T>, payload: T): Promise<void> {
    const key = eventKey(contract as EventContract<unknown>);
    const handlers = [...(this.#subscriptions.get(key) ?? [])];
    const results = await Promise.allSettled(
      handlers.map(({ handler }) => handler(payload)),
    );

    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);

    if (errors.length > 0) {
      throw new AggregateError(errors, `Event ${key} had failing subscribers.`);
    }
  }
}
