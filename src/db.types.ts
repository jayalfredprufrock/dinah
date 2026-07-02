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
