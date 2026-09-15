export interface OriginRecordV1 {
  readonly kind: 'hikari-origin';
  readonly version: 1;
  readonly hikariId: string;
  readonly createdAt: string;
}

export interface HikariIdentity {
  readonly hikariId: string;
  readonly createdAt: string;
}
