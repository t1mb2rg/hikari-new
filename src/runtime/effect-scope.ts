import type { Cleanup } from './contracts.js';

export class EffectScope {
  readonly #cleanups: Cleanup[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  defer(cleanup: Cleanup): void {
    if (this.#disposed) {
      throw new Error('Cannot register cleanup on a disposed effect scope.');
    }
    this.#cleanups.push(cleanup);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    const errors: unknown[] = [];
    for (let i = this.#cleanups.length - 1; i >= 0; i -= 1) {
      const cleanup = this.#cleanups[i];
      if (!cleanup) continue;
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#cleanups.length = 0;

    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more plugin resources failed to clean up.');
    }
  }
}
