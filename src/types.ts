import type { Static } from "typebox";
import type { Table } from "./table";

export type Obj<T = any> = Record<string, T>;

export interface DbConfig {
  tableNamePrefix?: string;
}

export interface DbListTables {
  limit?: number;
}

export interface DbGet {
  table: string;
  key: Obj;
  consistent?: boolean;
  projection?: string[];
  condition?: Obj;
}

export interface DbPut {
  table: string;
  item: Obj;
  return?: "ALL_OLD" | "ALL_NEW";
  condition?: Obj;
}

export interface DbUpdate {
  table: string;
  key: Obj;
  update: Obj;
  return?: "NONE" | "ALL_OLD" | "UPDATED_OLD" | "ALL_NEW" | "UPDATED_NEW";
  condition?: Obj;
}

export interface DbCreate {
  table: string;
  partitionKeyName: string;
  item: Obj;
  condition?: Obj;
}

export interface DbUpsert {
  table: string;
  key: Obj;
  update: Obj;
  item: Obj;
  condition?: Obj;
}

export interface DbDelete {
  table: string;
  key: Obj;
  return?: "NONE" | "ALL_OLD";
  condition?: Obj;
}

export interface DbQuery {
  table: string;
  query: Obj;
  startKey?: Obj;
  filter?: Obj;
  projection?: string[];
  limit?: number;
  index?: string;
  consistent?: boolean;
  sort?: "ASC" | "DESC";
}

export interface DbScan {
  table: string;
  startKey?: Obj;
  filter?: Obj;
  projection?: string[];
  limit?: number;
  index?: string;
  consistent?: boolean;
  parallel?: number;
}

export interface DbExists {
  table: string;
  query?: Obj;
  filter?: Obj;
  index?: string;
  projection?: string[];
  consistent?: boolean;
}

export interface DbBatchGetRequest {
  keys: Obj[];
  consistent?: boolean;
  projection?: string[];
  condition?: Obj;
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

export interface DbTrxGetRequest<T = Obj> {
  table: string;
  key: Obj;
  projection?: string[];
  condition?: Obj;
}

export type DbTrxGetResult<R extends DbTrxGetRequest[]> = {
  [K in keyof R]: R[K] extends DbTrxGetRequest<infer T> ? T | undefined : Obj | undefined;
};
export type DbTrxGetOrThrowResult<R extends DbTrxGetRequest[]> = {
  [K in keyof R]: R[K] extends DbTrxGetRequest<infer T> ? (T extends Obj ? T : Obj) : Obj;
};

export interface DbTrxDeleteRequest {
  table: string;
  type: "DELETE";
  key: Obj;
  condition?: Obj;
}

export interface DbTrxPutRequest {
  table: string;
  type: "PUT";
  item: Obj;
  condition?: Obj;
}

export interface DbTrxUpdateRequest {
  table: string;
  type: "UPDATE";
  key: Obj;
  update: Obj;
  condition?: Obj;
}

export interface DbTrxConditionRequest {
  table: string;
  type: "CONDITION";
  key: Obj;
  condition: Obj;
}

export type DbTrxWriteRequest =
  | DbTrxDeleteRequest
  | DbTrxPutRequest
  | DbTrxUpdateRequest
  | DbTrxConditionRequest;

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

//-----------------------------------------------------------------------------------------------------
// Repository Types
//-----------------------------------------------------------------------------------------------------

export type AllKeys<T> = Extract<T extends any ? keyof T : never, string>;
export type PartialSome<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type DistPartialSome<T, K extends AllKeys<T>> = T extends unknown
  ? PartialSome<T, K>
  : never;

export type ExtractTableDef<T> = T extends Table<any, infer Def> ? Def : never;
export type ExtractTableSchema<T> = T extends Table<infer Schema, any> ? Static<Schema> : never;

export type ExtractKey<S, D> = D extends { partitionKey: infer PK; sortKey?: infer SK }
  ? PK extends keyof S
    ? SK extends keyof S
      ? Pick<S, PK | SK>
      : Pick<S, PK>
    : never
  : never;

export type Func = (...args: any[]) => any;
export type RepoKey<T> = Partial<ExtractTableSchema<T>> &
  ExtractKey<ExtractTableSchema<T>, ExtractTableDef<T>>;

export type Item<T> = ExtractTableDef<T>["beforePut"] extends Func
  ? keyof ReturnType<ExtractTableDef<T>["beforePut"]> extends AllKeys<ExtractTableSchema<T>>
    ? DistPartialSome<ExtractTableSchema<T>, keyof ReturnType<ExtractTableDef<T>["beforePut"]>>
    : ExtractTableSchema<T>
  : ExtractTableSchema<T>;

export type GsiNames<T> = Extract<keyof ExtractTableDef<T>["gsis"], string>;

export type GsiKey<T, G extends GsiNames<T>> = ExtractKey<
  ExtractTableSchema<T>,
  ExtractTableDef<T>["gsis"][G]
>;

export type Projection<T> = AllKeys<ExtractTableSchema<T>>[];
export type ApplyProjection<T, O> = O extends {
  projection: Array<infer P extends keyof ExtractTableSchema<T>>;
}
  ? Pick<ExtractTableSchema<T>, P>
  : ExtractTableSchema<T>;

// get ------------------------------------------------------------------------------------------------

export interface RepoGet<T> {
  consistent?: boolean;
  projection?: Projection<T>;
  condition?: Obj;
}

export type RepoGetResult<T, O extends RepoGet<T>> = undefined | ApplyProjection<T, O>;
export type RepoGetOrThrowResult<T, O extends RepoGet<T>> = ApplyProjection<T, O>;

// put ------------------------------------------------------------------------------------------------

export type RepoPutItem<T> = Item<T>;

export interface RepoPut<_T> {
  return?: "ALL_OLD" | "ALL_NEW";
  condition?: Obj;
}

export type RepoPutResult<T, O extends RepoPut<T>> = O["return"] extends "NONE"
  ? undefined
  : ExtractTableSchema<T>;

// create ---------------------------------------------------------------------------------------------

export type RepoCreateItem<T> = Item<T>;

export interface RepoCreate<_T> {
  condition?: Obj;
}

export type RepoCreateResult<T, _O extends RepoPut<T>> = ExtractTableSchema<T>;

// upsert ---------------------------------------------------------------------------------------------

export interface RepoUpsert<T> {
  key: RepoKey<T>;
  update: Obj;
  item: Item<T>;
  condition?: Obj;
}

export type RepoUpsertResult<T> = ExtractTableSchema<T>;

// update ---------------------------------------------------------------------------------------------

export type RepoUpdateData<_T> = Obj;

export interface RepoUpdate<_T> {
  return?: "NONE" | "ALL_OLD" | "ALL_NEW";
  condition?: Obj;
}

export type RepoUpdateResult<T, O extends RepoUpdate<T>> = O["return"] extends "NONE"
  ? undefined
  : ExtractTableSchema<T>;

// delete ---------------------------------------------------------------------------------------------

export interface RepoDelete<_T> {
  return?: "NONE" | "ALL_OLD";
  condition?: Obj;
}

export type RepoDeleteResult<T> = ExtractTableSchema<T> | undefined;
export type RepoDeleteOrThrowResult<T> = ExtractTableSchema<T>;

// query ---------------------------------------------------------------------------------------------

export interface RepoQuery<T> {
  startKey?: RepoKey<T>;
  filter?: Obj;
  projection?: Projection<T>;
  limit?: number;
  consistent?: boolean;
  sort?: "ASC" | "DESC";
}

export type RepoQueryResult<T, O extends RepoQuery<T>> = ApplyProjection<T, O>[];
export type RepoQueryPagedResult<T, O extends RepoQuery<T>> = AsyncGenerator<
  ApplyProjection<T, O>[]
>;

// query gsi -----------------------------------------------------------------------------------------

export interface RepoQueryGsi<T> {
  startKey?: RepoKey<T>; //TODO: should include GSI key
  filter?: Obj;
  projection?: Projection<T>;
  limit?: number;
  sort?: "ASC" | "DESC";
}

export type RepoQueryGsiResult<T, O extends RepoQueryGsi<T>> = ApplyProjection<T, O>[];
export type RepoQueryGsiPagedResult<T, O extends RepoQueryGsi<T>> = AsyncGenerator<
  ApplyProjection<T, O>[]
>;

// scan ----------------------------------------------------------------------------------------------

export interface RepoScan<T> {
  startKey?: RepoKey<T>;
  filter?: Obj;
  projection?: Projection<T>;
  limit?: number;
  consistent?: boolean;
  parallel?: number;
}

export type RepoScanResult<T, O extends RepoScan<T>> = ApplyProjection<T, O>[];
export type RepoScanPagedResult<T, O extends RepoScan<T>> = AsyncGenerator<ApplyProjection<T, O>[]>;

// scan gsi ------------------------------------------------------------------------------------------

export interface RepoScanGsi<T> {
  startKey?: RepoKey<T>; //TODO: should include GSI key
  filter?: Obj;
  projection?: Projection<T>;
  limit?: number;
  parallel?: number;
}

export type RepoScanGsiResult<T, O extends RepoScanGsi<T>> = ApplyProjection<T, O>[];
export type RepoScanGsiPagedResult<T, O extends RepoScanGsi<T>> = AsyncGenerator<
  ApplyProjection<T, O>[]
>;

// exists -------------------------------------------------------------------------------------------

export interface RepoExists<_T> {
  query?: Obj;
  filter?: Obj;
  consistent?: boolean;
}

// trx get -----------------------------------------------------------------------------------------

export interface RepoTrxGet<T> {
  projection?: Projection<T>;
  condition?: Obj;
}

export type RepoTrxGetResult<T, O extends RepoTrxGet<T>> = (ApplyProjection<T, O> | undefined)[];
export type RepoTrxGetOrThrowResult<T, O extends RepoTrxGet<T>> = ApplyProjection<T, O>[];
export type RepoTrxGetRequestResult<T> = { table: string };

// trx write ----------------------------------------------------------------------------------------

export interface RepoTrxDeleteRequest<T> {
  type: "DELETE";
  key: RepoKey<T>;
  condition?: Obj;
}

export interface RepoTrxPutRequest<T> {
  type: "PUT";
  item: RepoPutItem<T>;
  condition?: Obj;
}

export interface RepoTrxUpdateRequest<T> {
  table: string;
  type: "UPDATE";
  key: RepoKey<T>;
  update: RepoUpdateData<T>;
  condition?: Obj;
}

export interface RepoTrxConditionRequest<T> {
  type: "CONDITION";
  key: RepoKey<T>;
  condition: Obj;
}

export type RepoTrxWriteRequest<T> =
  | RepoTrxDeleteRequest<T>
  | RepoTrxPutRequest<T>
  | RepoTrxUpdateRequest<T>
  | RepoTrxConditionRequest<T>;

// batch get ----------------------------------------------------------------------------------------

export interface RepoBatchGet<T> {
  consistent?: boolean;
  projection?: Projection<T>;
  condition?: Obj;
}

export type RepoBatchGetResult<T, O extends RepoBatchGet<T>> = {
  items: ApplyProjection<T, O>[];
  unprocessed?: RepoKey<T>[];
};
export type RepoBatchGetOrThrowResult<T, O extends RepoBatchGet<T>> = ApplyProjection<T, O>[];

// batch write --------------------------------------------------------------------------------------

type RepoBatchWritePutRequest<T> = { type: "PUT"; item: Item<T> };
type RepoBatchWriteDeleteRequest<T> = { type: "DELETE"; key: RepoKey<T> };

export type RepoBatchWrite<T> = (RepoBatchWritePutRequest<T> | RepoBatchWriteDeleteRequest<T>)[];
export type RepoBatchWriteResult<T> = { items: Item<T>[]; unprocessed?: RepoBatchWrite<T> };

// batch put ------------------------------------------------------------------------------------

export type RepoBatchPut<T> = Item<T>[];
export type RepoBatchPutResult<T> = { items: Item<T>[]; unprocessed?: RepoBatchPut<T> };

// batch delete ---------------------------------------------------------------------------------

export type RepoBatchDelete<T> = RepoKey<T>[];
export type RepoBatchDeleteResponse<T> = RepoBatchDelete<T> | undefined;

export type PickTypeOf<T, K extends AllKeys<T>, O> = T extends { [k in K]?: O } ? T[K] : never;

// TODO: is this the best way to extract keys of a specific type
// across all union objects?
export type ExtractKeys<T, O> = {
  [K in AllKeys<T>]: PickTypeOf<T, K, O> extends never ? never : { k: K; v: PickTypeOf<T, K, O> };
}[AllKeys<T>]["k"];

// primary keys must exist across all union objects,
// cant be optional, and can either be strings or numbers
export type ValidPrimaryKeys<T> = {
  [K in keyof T]: T[K] extends string | number ? K : never;
}[keyof T];

// TTL keys can be optional, and don't have to exist
// on every union object, however they must be a number
export type ValidTtlKeys<T> = ExtractKeys<T, number>;

// GSI keys can be optional, and don't have to exist
// on every union object, but must be strings or numbers
export type ValidGsiKeys<T> = ExtractKeys<T, string | number>;

export interface Gsi<T> {
  partitionKey: ValidGsiKeys<T>;
  sortKey?: ValidGsiKeys<T>;
  projection?: "ALL" | "KEYS_ONLY" | AllKeys<T>[];
}

/*
export interface GenericGsi {
	partitionKey: string;
	sortKey?: string;
	projection?: 'ALL' | 'KEYS_ONLY' | string[];
}

export interface GenericTableDef {
	name: string;
	partitionKey: string;
	sortKey?: string;
	gsis?: Record<string, GenericGsi>;
	ttlAttribute?: string;
	billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
	stream?: 'KEYS_ONLY' | 'NEW_IMAGE' | 'OLD_IMAGE' | 'NEW_AND_OLD_IMAGES';
	beforePut?: (data: Obj) => Obj;
	beforeUpdate?: (update: Obj) => Obj;
}
*/

export interface TableDef<T = any> {
  name: string;
  partitionKey: ValidPrimaryKeys<T>;
  sortKey?: ValidPrimaryKeys<T>;
  gsis?: Record<string, Gsi<T>>;
  ttlAttribute?: ValidTtlKeys<T>;
  billingMode?: "PAY_PER_REQUEST" | "PROVISIONED";
  stream?: "KEYS_ONLY" | "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES";
  beforePut?: (data: Partial<T>) => Partial<T>;
  beforeUpdate?: (update: Obj) => Partial<T>;
}

export interface TableKey {
  name: string;
  type: "S" | "N";
}

export interface TableGsi {
  indexName: string;
  projectionType: "KEYS_ONLY" | "ALL" | "INCLUDE";
  partitionKey: TableKey;
  sortKey?: TableKey;
  nonKeyAttributes?: string[];
}

export interface TableDesc {
  tableName: string;
  billingMode: "PAY_PER_REQUEST" | "PROVISIONED";
  partitionKey: TableKey;
  sortKey?: TableKey;
  ttlAttribute?: string;
  gsis?: TableGsi[];
  stream?: "KEYS_ONLY" | "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES";
}

export type ResolvedAttrType = ("S" | "N" | undefined)[];
