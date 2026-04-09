import type { Static } from "typebox";
import type { Table } from "./table";
import type { AbstractRepo } from "./repo";

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
  returnOld?: boolean;
  condition?: Obj;
}

export interface DbUpdate {
  table: string;
  key: Obj;
  update: Obj;
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
// Utility Types
//-----------------------------------------------------------------------------------------------------

export type AllKeys<T> = Extract<T extends any ? keyof T : never, string>;

export type PartialSome<T, K extends string | number | symbol> = Omit<T, K> &
  Partial<Pick<T, Extract<K, keyof T>>>;

export type DistPartialSome<T, K extends string | number | symbol> = T extends unknown
  ? PartialSome<T, K>
  : never;

export type ExtractTableDef<T> = T extends Table<any, infer Def> ? Def : never;
export type ExtractTableSchema<T> =
  T extends Table<infer Schema, any>
    ? unknown extends Static<Schema>
      ? any
      : Static<Schema>
    : never;

export type ExtractKey<S, D> = D extends { partitionKey: infer PK; sortKey?: infer SK }
  ? PK extends keyof S
    ? SK extends keyof S
      ? Pick<S, PK | SK>
      : Pick<S, PK>
    : never
  : never;

export type Func = (...args: any[]) => any;

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

//-----------------------------------------------------------------------------------------------------
// Repository Types - all of these types should except a generic R of type AbstractRepo<any>
//-----------------------------------------------------------------------------------------------------

export type RepoKey<R extends AbstractRepo<any>> = Partial<R["$schema"]> &
  ExtractKey<R["$schema"], R["$def"]>;

export type RepoPutItem<R extends AbstractRepo<any>> = DistPartialSome<
  R["$schema"],
  keyof R["defaultPutData"]
>;

export type RepoUpdateItem<R extends AbstractRepo<any>> = DistPartialSome<
  R["$schema"],
  keyof R["defaultUpdateData"]
>;

export type GsiNames<R extends AbstractRepo<any>> = keyof R["table"]["def"]["gsis"] & string;

export type TableGsiNames<T extends Table> = keyof NonNullable<ExtractTableDef<T>["gsis"]> & string;

export type GsiKey<R extends AbstractRepo<any>, G extends GsiNames<R>> = ExtractKey<
  R["$schema"],
  GsiDef<R, G>
>;

export type Projection<R extends AbstractRepo<any>> = AllKeys<R["$schema"]>[];

export type RepoOutput<R extends AbstractRepo<any>> = ReturnType<R["transformItem"]>;

export type ApplyProjection<R extends AbstractRepo<any>, O> = O extends {
  projection: Array<infer P extends AllKeys<R["$schema"]>>;
}
  ? Pick<R["$schema"], P>
  : RepoOutput<R>;

export type GsiProjectionType<R extends AbstractRepo<any>, G extends string> =
  GsiDef<R, G> extends { projection: infer P } ? P : undefined;

type GsiDef<R extends AbstractRepo<any>, G extends string> = NonNullable<
  R["table"]["def"]["gsis"]
>[G];

type TableKeyAttributes<R extends AbstractRepo<any>> =
  | R["table"]["def"]["partitionKey"]
  | (R["table"]["def"]["sortKey"] & string);

type GsiOwnKeyAttributes<R extends AbstractRepo<any>, G extends string> =
  | GsiDef<R, G>["partitionKey"]
  | (GsiDef<R, G>["sortKey"] & string);

type GsiAllKeyAttributes<R extends AbstractRepo<any>, G extends string> =
  | TableKeyAttributes<R>
  | GsiOwnKeyAttributes<R, G>;

type GsiIncludedAttributes<R extends AbstractRepo<any>, G extends string> = Extract<
  GsiDef<R, G>["projection"],
  readonly any[]
>[number];

export type ApplyGsiProjection<R extends AbstractRepo<any>, O, G extends string> = O extends {
  projection: Array<infer P extends AllKeys<R["$schema"]>>;
}
  ? Pick<R["$schema"], P | Extract<GsiAllKeyAttributes<R, G>, keyof R["$schema"]>>
  : GsiProjectionType<R, G> extends "ALL" | undefined
    ? RepoOutput<R>
    : Pick<
        R["$schema"],
        Extract<GsiAllKeyAttributes<R, G> | GsiIncludedAttributes<R, G>, keyof R["$schema"]>
      >;

// get ------------------------------------------------------------------------------------------------

export interface RepoGetOptions<R extends AbstractRepo<any>> {
  consistent?: boolean;
  projection?: Projection<R>;
  condition?: Obj;
}

export type RepoGetResult<R extends AbstractRepo<any>, O extends RepoGetOptions<R>> =
  | undefined
  | ApplyProjection<R, O>;
export type RepoGetOrThrowResult<
  R extends AbstractRepo<any>,
  O extends RepoGetOptions<R>,
> = ApplyProjection<R, O>;

// put ------------------------------------------------------------------------------------------------

export interface RepoPutOptions {
  condition?: Obj;
}

export type RepoPutResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// create ---------------------------------------------------------------------------------------------

export type RepoCreateItem<R extends AbstractRepo<any>> = RepoPutItem<R>;

export interface RepoCreateOptions {
  condition?: Obj;
}

export type RepoCreateResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// update ---------------------------------------------------------------------------------------------

export type RepoUpdateData = Obj;

export interface RepoUpdateOptions {
  condition?: Obj;
}

export type RepoUpdateResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// delete ---------------------------------------------------------------------------------------------

export interface RepoDeleteOptions {
  condition?: Obj;
}

export type RepoDeleteResult<R extends AbstractRepo<any>> = RepoOutput<R> | undefined;
export type RepoDeleteOrThrowResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// query ---------------------------------------------------------------------------------------------

export interface RepoQueryOptions<R extends AbstractRepo<any>> {
  startKey?: RepoKey<R>;
  filter?: Obj;
  projection?: Projection<R>;
  limit?: number;
  consistent?: boolean;
  sort?: "ASC" | "DESC";
}

export type RepoQueryResult<
  R extends AbstractRepo<any>,
  O extends RepoQueryOptions<R>,
> = ApplyProjection<R, O>[];

export type RepoQueryPagedResult<
  R extends AbstractRepo<any>,
  O extends RepoQueryOptions<R>,
> = AsyncGenerator<ApplyProjection<R, O>[]>;

// query gsi -----------------------------------------------------------------------------------------

export type RepoQueryGsiQuery<T extends Table, G extends string> = Pick<
  ExtractTableSchema<T>,
  NonNullable<ExtractTableDef<T>["gsis"]>[G]["partitionKey"]
> &
  Partial<
    Pick<ExtractTableSchema<T>, NonNullable<ExtractTableDef<T>["gsis"]>[G]["sortKey"] & string>
  >;

export interface RepoQueryGsiOptions<R extends AbstractRepo<any>> {
  startKey?: RepoKey<R>; //TODO: should include GSI key
  filter?: Obj;
  projection?: Projection<R>;
  limit?: number;
  sort?: "ASC" | "DESC";
}

export type RepoQueryGsiResult<
  R extends AbstractRepo<any>,
  O extends RepoQueryGsiOptions<R>,
  G extends string = string,
> = ApplyGsiProjection<R, O, G>[];

export type RepoQueryGsiPagedResult<
  R extends AbstractRepo<any>,
  O extends RepoQueryGsiOptions<R>,
  G extends string = string,
> = AsyncGenerator<ApplyGsiProjection<R, O, G>[]>;

// scan ----------------------------------------------------------------------------------------------

export interface RepoScanOptions<R extends AbstractRepo<any>> {
  startKey?: RepoKey<R>;
  filter?: Obj;
  projection?: Projection<R>;
  limit?: number;
  consistent?: boolean;
  parallel?: number;
}

export type RepoScanResult<
  R extends AbstractRepo<any>,
  O extends RepoScanOptions<R>,
> = ApplyProjection<R, O>[];

export type RepoScanPagedResult<
  R extends AbstractRepo<any>,
  O extends RepoScanOptions<R>,
> = AsyncGenerator<ApplyProjection<R, O>[]>;

// scan gsi ------------------------------------------------------------------------------------------

export interface RepoScanGsiOptions<R extends AbstractRepo<any>> {
  startKey?: RepoKey<R>; //TODO: should include GSI key
  filter?: Obj;
  projection?: Projection<R>;
  limit?: number;
  parallel?: number;
}

export type RepoScanGsiResult<
  R extends AbstractRepo<any>,
  O extends RepoScanGsiOptions<R>,
  G extends string = string,
> = ApplyGsiProjection<R, O, G>[];

export type RepoScanGsiPagedResult<
  R extends AbstractRepo<any>,
  O extends RepoScanGsiOptions<R>,
  G extends string = string,
> = AsyncGenerator<ApplyGsiProjection<R, O, G>[]>;

// exists -------------------------------------------------------------------------------------------

export interface RepoExistsOptions {
  query?: Obj;
  filter?: Obj;
  consistent?: boolean;
}

// trx get -----------------------------------------------------------------------------------------

export interface RepoTrxGetOptions<R extends AbstractRepo<any>> {
  projection?: Projection<R>;
  condition?: Obj;
}

export type RepoTrxGetResult<R extends AbstractRepo<any>, O extends RepoTrxGetOptions<R>> = (
  | ApplyProjection<R, O>
  | undefined
)[];

export type RepoTrxGetOrThrowResult<
  R extends AbstractRepo<any>,
  O extends RepoTrxGetOptions<R>,
> = ApplyProjection<R, O>[];

export type RepoTrxGetRequestResult = { table: string };

// trx write ----------------------------------------------------------------------------------------

export interface RepoTrxDeleteRequest<R extends AbstractRepo<any>> {
  type: "DELETE";
  key: RepoKey<R>;
  condition?: Obj;
}

export interface RepoTrxPutRequest<R extends AbstractRepo<any>> {
  type: "PUT";
  item: RepoPutItem<R>;
  condition?: Obj;
}

export interface RepoTrxUpdateRequest<R extends AbstractRepo<any>> {
  table: string;
  type: "UPDATE";
  key: RepoKey<R>;
  update: RepoUpdateData;
  condition?: Obj;
}

export interface RepoTrxConditionRequest<R extends AbstractRepo<any>> {
  type: "CONDITION";
  key: RepoKey<R>;
  condition: Obj;
}

export type RepoTrxWriteRequest<R extends AbstractRepo<any>> =
  | RepoTrxDeleteRequest<R>
  | RepoTrxPutRequest<R>
  | RepoTrxUpdateRequest<R>
  | RepoTrxConditionRequest<R>;

// batch get ----------------------------------------------------------------------------------------

export interface RepoBatchGetOptions<R extends AbstractRepo<any>> {
  consistent?: boolean;
  projection?: Projection<R>;
  condition?: Obj;
}

export type RepoBatchGetResult<R extends AbstractRepo<any>, O extends RepoBatchGetOptions<R>> = {
  items: ApplyProjection<R, O>[];
  unprocessed?: RepoKey<R>[];
};

export type RepoBatchGetOrThrowResult<
  R extends AbstractRepo<any>,
  O extends RepoBatchGetOptions<R>,
> = ApplyProjection<R, O>[];

// batch write --------------------------------------------------------------------------------------

type RepoBatchWritePutRequest<R extends AbstractRepo<any>> = { type: "PUT"; item: RepoPutItem<R> };
type RepoBatchWriteDeleteRequest<R extends AbstractRepo<any>> = { type: "DELETE"; key: RepoKey<R> };

export type RepoBatchWrite<R extends AbstractRepo<any>> = (
  | RepoBatchWritePutRequest<R>
  | RepoBatchWriteDeleteRequest<R>
)[];

export type RepoBatchWriteResult<R extends AbstractRepo<any>> = {
  items: RepoPutItem<R>[];
  unprocessed?: RepoBatchWrite<R>;
};

// batch put ------------------------------------------------------------------------------------

export type RepoBatchPutRequest<R extends AbstractRepo<any>> = RepoPutItem<R>[];
export type RepoBatchPutResult<R extends AbstractRepo<any>> = {
  items: RepoPutItem<R>[];
  unprocessed?: RepoBatchPutRequest<R>;
};

// batch delete ---------------------------------------------------------------------------------

export type RepoBatchDeleteRequest<R extends AbstractRepo<any>> = RepoKey<R>[];
export type RepoBatchDeleteResponse<R extends AbstractRepo<any>> =
  | RepoBatchDeleteRequest<R>
  | undefined;

export type PickTypeOf<T, K extends AllKeys<T>, O> = T extends { [k in K]?: O } ? T[K] : never;

export interface Gsi<T> {
  readonly partitionKey: ValidGsiKeys<T>;
  readonly sortKey?: ValidGsiKeys<T>;
  readonly projection?: "ALL" | "KEYS_ONLY" | readonly AllKeys<T>[];
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
}
*/

export interface TableDef<T = any> {
  readonly name: string;
  readonly partitionKey: ValidPrimaryKeys<T>;
  readonly sortKey?: ValidPrimaryKeys<T>;
  readonly gsis?: Readonly<Record<string, Gsi<T>>>;
  readonly ttlAttribute?: ValidTtlKeys<T>;
  readonly billingMode?: "PAY_PER_REQUEST" | "PROVISIONED";
  readonly stream?: "KEYS_ONLY" | "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES";
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
