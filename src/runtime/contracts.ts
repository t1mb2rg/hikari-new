export interface ServiceContract<T> {
  readonly id: string;
  readonly version: number;
  readonly __serviceType?: T;
}

export interface EventContract<T> {
  readonly id: string;
  readonly version: number;
  readonly __eventType?: T;
}

export type AnyServiceContract = ServiceContract<unknown>;
export type Cleanup = () => void | Promise<void>;

export function defineService<T>(id: string, version = 1): ServiceContract<T> {
  assertContractId(id);
  assertVersion(version);
  return Object.freeze({ id, version }) as ServiceContract<T>;
}

export function defineEvent<T>(id: string, version = 1): EventContract<T> {
  assertContractId(id);
  assertVersion(version);
  return Object.freeze({ id, version }) as EventContract<T>;
}

export function serviceKey(contract: AnyServiceContract): string {
  return `${contract.id}@${contract.version}`;
}

export function eventKey(contract: EventContract<unknown>): string {
  return `${contract.id}@${contract.version}`;
}

function assertContractId(id: string): void {
  if (!id.trim()) {
    throw new Error('Contract id must not be empty.');
  }
}

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error('Contract version must be a positive integer.');
  }
}
