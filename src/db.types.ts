import type { AllKeys, Condition, KeyCondition, Obj, UpdateExpression } from "./types";

export interface DbConfig {
  tableNamePrefix?: string;
  updateUndefinedBehavior?: "throw" | "strip" | "$remove";
}

export interface DbListTables {
  limit?: number;
}

export interface DbGet<T = Obj> {
  table: string;
  key: Partial<NoInfer<T>>;
  resource?: string;
  consistent?: boolean;
  projection?: AllKeys<NoInfer<T>>[];
  filter?: Partial<NoInfer<T>>;
}

export interface DbPut<T = Obj> {
  table: string;
  item: T;
  resource?: string;
  returnOld?: boolean;
  condition?: Condition<T>;
}

export interface DbCreate<T = Obj> {
  table: string;
  partitionKeyName: string;
  item: T;
  condition?: Condition<T>;
}

export interface DbUpdate<T = Obj> {
  table: string;
  key: Partial<NoInfer<T>>;
  resource?: string;
  update: UpdateExpression<T>;
  condition?: Condition<NoInfer<T>>;
}

export interface DbUpsert<T = Obj> {
  table: string;
  key: Partial<NoInfer<T>>;
  update: UpdateExpression<T>;
  item: T;
  condition?: Condition<NoInfer<T>>;
}

export interface DbDelete<T = Obj> {
  table: string;
  key: Partial<NoInfer<T>>;
  resource?: string;
  condition?: Condition<NoInfer<T>>;
}

export interface DbQuery<T = Obj> {
  table: string;
  query: KeyCondition<T>;
  startKey?: Partial<NoInfer<T>>;
  filter?: Condition<T>;
  projection?: AllKeys<NoInfer<T>>[];
  limit?: number;
  index?: string;
  consistent?: boolean;
  sort?: "ASC" | "DESC";
}

export interface DbScan<T = Obj> {
  table: string;
  startKey?: Partial<NoInfer<T>>;
  filter?: Condition<T>;
  projection?: AllKeys<NoInfer<T>>[];
  limit?: number;
  index?: string;
  consistent?: boolean;
  parallel?: number;
}

export interface DbExists<T = Obj> {
  table: string;
  query?: KeyCondition<T>;
  filter?: Condition<T>;
  index?: string;
  projection?: AllKeys<NoInfer<T>>[];
  consistent?: boolean;
}

export interface DbBatchGetRequest<T = Obj> {
  keys: Partial<NoInfer<T>>[];
  resource?: string;
  consistent?: boolean;
  projection?: AllKeys<NoInfer<T>>[];
  filter?: Partial<NoInfer<T>>;
}

export type DbBatchGet = Obj<DbBatchGetRequest>;

/** Tuning shared by `batchGet` / `batchWrite` / `batchUpdate`. */
export interface DbBatchOptions {
  /**
   * Requests in flight at once. Defaults to 5. Only has an effect above one
   * chunk of work (25 items for writes/updates, 100 keys for gets), so small
   * request-path batches behave exactly as they did when serial.
   *
   * Parallelism only helps when keys spread across partitions — sequential or
   * timestamp-prefixed keys concentrate on one partition, where extra
   * concurrency just produces more throttling. Note also that the AWS SDK
   * defaults to 50 max sockets per client, so values beyond that queue in the
   * HTTP agent rather than adding real parallelism.
   */
  parallel?: number;
  /**
   * Consecutive passes that accept *zero* items before giving up and returning
   * the remainder as `unprocessed`. Defaults to 10, roughly 45s of retrying.
   * Passes that make any progress don't count against this, so it is not a cap
   * on total requests.
   */
  maxAttempts?: number;
  /**
   * Items per request. Defaults to — and is clamped to — DynamoDB's maximum: 25
   * for `batchWrite` / `batchUpdate`, 100 for `batchGet`.
   *
   * Worth lowering only for consistently large items on `batchWrite`. Once
   * items are big enough that the table accepts fewer than 25 per call (above
   * roughly 160KB), the rejected remainder is re-uploaded on the next pass —
   * about 2.5x the payload at 400KB items. Setting this to the number the table
   * actually accepts removes that waste without costing round trips, since how
   * many items land per call is set by capacity rather than chunk size. Setting
   * it *below* that number does cost round trips.
   */
  chunkSize?: number;
}

export interface DbBatchGetResponse {
  items: Obj<Obj[]>;
  unprocessed?: DbBatchGet;
}

export interface DbBatchDeleteRequest {
  type: "DELETE";
  key: Obj;
}

export interface DbBatchPutRequest {
  type: "PUT";
  item: Obj;
}

export type DbBatchWrite = Obj<(DbBatchDeleteRequest | DbBatchPutRequest)[]>;

export interface DbBatchWriteResponse {
  /**
   * @deprecated Always empty. `BatchWriteItem` does not return the items it
   * wrote, so this has never been populated. Will be removed in a future minor.
   */
  items: Obj<Obj[]>;
  unprocessed?: DbBatchWrite;
}

// batch update ------------------------------------------------------------------------------------

export interface DbBatchUpdateRequest<T = Obj> {
  keys: Partial<NoInfer<T>>[];
  update: UpdateExpression<T>;
}

export type DbBatchUpdate = Obj<DbBatchUpdateRequest>;

export interface DbBatchUpdateResponse {
  unprocessed?: DbBatchUpdate;
}

export interface DbTrxGetRequest<T = Obj> {
  table: string;
  key: Partial<NoInfer<T>>;
  resource?: string;
  projection?: AllKeys<NoInfer<T>>[];
  filter?: Partial<NoInfer<T>>;
}

export type DbTrxGetResult<R extends DbTrxGetRequest[]> = {
  [K in keyof R]: R[K] extends DbTrxGetRequest<infer T> ? T | undefined : Obj | undefined;
};
export type DbTrxGetOrThrowResult<R extends DbTrxGetRequest[]> = {
  [K in keyof R]: R[K] extends DbTrxGetRequest<infer T> ? (T extends Obj ? T : Obj) : Obj;
};

export interface DbTrxDeleteRequest<T = Obj> {
  table: string;
  type: "DELETE";
  key: Partial<NoInfer<T>>;
  condition?: Condition<NoInfer<T>>;
}

export interface DbTrxPutRequest<T = Obj> {
  table: string;
  type: "PUT";
  item: T;
  condition?: Condition<T>;
}

export interface DbTrxUpdateRequest<T = Obj> {
  table: string;
  type: "UPDATE";
  key: Partial<NoInfer<T>>;
  update: UpdateExpression<T>;
  condition?: Condition<NoInfer<T>>;
}

export interface DbTrxConditionRequest<T = Obj> {
  table: string;
  type: "CONDITION";
  key: Partial<NoInfer<T>>;
  condition: Condition<NoInfer<T>>;
}

export type DbTrxWriteRequest<T = Obj> =
  | DbTrxDeleteRequest<T>
  | DbTrxPutRequest<T>
  | DbTrxUpdateRequest<T>
  | DbTrxConditionRequest<T>;

export interface DbEnableEventStreams {
  tables?: string[];
  startTime?: number;
}

export interface DbDisableEventStreams {
  tables?: string[];
}

export interface DbStreamEvent {
  id: string;
  time: number;
  table: string;
  key: Obj;
  type: "INSERT" | "MODIFY" | "REMOVE";
  oldItem?: Obj;
  newItem?: Obj;
}

export type DbStreamEventListener = (event: DbStreamEvent) => void;
