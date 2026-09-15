export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface FactSource {
  readonly kind: string;
  readonly reference?: string;
}

export interface FactDraft {
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly source: FactSource;
  readonly payload: JsonValue;
}

export interface DurableFact {
  readonly factId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly source: FactSource;
  readonly payload: JsonValue;
}

export interface ChronicleStoreHeaderV1 {
  readonly kind: 'hikari-chronicle';
  readonly version: 1;
  readonly owner: string;
}
