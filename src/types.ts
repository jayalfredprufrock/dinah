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

export interface DbGet<R = Obj> {
  table: string;
  key: Obj;
  consistent?: boolean;
  projection?: string[];
  filter?: (item: R) => boolean;
}

export interface DbPut<R = Obj> {
  table: string;
  item: R;
  returnOld?: boolean;
  condition?: Obj;
}

export interface DbUpdate {
  table: string;
  key: Obj;
  update: Obj;
  condition?: Obj;
}

export interface DbCreate<R = Obj> {
  table: string;
  partitionKeyName: string;
  item: R;
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
  filter?: (item: Obj) => boolean;
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

// Normalize string | readonly string[] to a union of strings
type ToUnion<T> = T extends readonly (infer U)[] ? U : T;

// Enumerate valid left-to-right sort key combinations for multi-key GSIs (max 4 attributes)
type SortKeyQuery<Schema, SK> = SK extends readonly [
  infer A extends string & keyof Schema,
  infer B extends string & keyof Schema,
  infer C extends string & keyof Schema,
  infer D extends string & keyof Schema,
]
  ?
      | {}
      | Pick<Schema, A>
      | Pick<Schema, A | B>
      | Pick<Schema, A | B | C>
      | Pick<Schema, A | B | C | D>
  : SK extends readonly [
        infer A extends string & keyof Schema,
        infer B extends string & keyof Schema,
        infer C extends string & keyof Schema,
      ]
    ? {} | Pick<Schema, A> | Pick<Schema, A | B> | Pick<Schema, A | B | C>
    : SK extends readonly [
          infer A extends string & keyof Schema,
          infer B extends string & keyof Schema,
        ]
      ? {} | Pick<Schema, A> | Pick<Schema, A | B>
      : SK extends readonly [infer A extends string & keyof Schema]
        ? {} | Pick<Schema, A>
        : SK extends string & keyof Schema
          ? Partial<Pick<Schema, SK>>
          : {};

// ── Condition typing ──────────────────────────────────────────────────────────

/** Extract the type of field K across all members of union T */
type ValueOfUnion<T, K extends string> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : never
  : never;

/** Comparison operators valid for ordered types (string, number) */
interface ComparatorOps<V> {
  $eq?: V;
  $ne?: V;
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
}

/** String-specific operators */
interface StringOps {
  $prefix?: string;
  $includes?: string;
  $between?: [string, string];
}

/** Number-specific operators */
interface NumberOps {
  $between?: [number, number];
}

/** Operators valid for any attribute type */
interface CommonOps<V> {
  $eq?: V;
  $ne?: V;
  $exists?: boolean;
  $type?: "S" | "SS" | "N" | "NS" | "B" | "BS" | "BOOL" | "NULL" | "L" | "M";
  $in?: V[];
  $nin?: V[];
}

/** Size operator — accepts a number or a comparator on number */
interface SizeOps {
  $size?: number | ComparatorOps<number>;
}

/** Path reference for cross-attribute comparisons */
interface PathRef {
  $path: string;
}

/**
 * Map a field's value type to the set of valid operators.
 * Uses `[V] extends [X]` (wrapped) to prevent distribution over unions.
 */
type FieldOps<V> = [V] extends [string]
  ? CommonOps<V | PathRef> & ComparatorOps<V | PathRef> & StringOps & SizeOps
  : [V] extends [number]
    ? CommonOps<V | PathRef> & ComparatorOps<V | PathRef> & NumberOps & SizeOps
    : [V] extends [boolean]
      ? CommonOps<V | PathRef>
      : [V] extends [any[]]
        ? CommonOps<V | PathRef> & { $includes?: V[number] } & SizeOps
        : CommonOps<V | PathRef> & SizeOps;

/**
 * A single field condition: either a direct value (shorthand for $eq)
 * or an operator object.
 */
type FieldCondition<T> = {
  [K in AllKeys<T>]?: ValueOfUnion<T, K> | FieldOps<ValueOfUnion<T, K>>;
};

/**
 * Full condition expression with compound operators.
 */
export type Condition<T> = FieldCondition<T> & {
  $and?: Condition<T>[];
  $or?: Condition<T>[];
  $not?: Condition<T>;
};

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
  | (ToUnion<GsiDef<R, G>["partitionKey"]> & string)
  | (ToUnion<GsiDef<R, G>["sortKey"]> & string);

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
  filter?: (item: R["$schema"]) => boolean;
}

export type RepoGetResult<R extends AbstractRepo<any>, O extends RepoGetOptions<R>> =
  | undefined
  | ApplyProjection<R, O>;
export type RepoGetOrThrowResult<
  R extends AbstractRepo<any>,
  O extends RepoGetOptions<R>,
> = ApplyProjection<R, O>;

// put ------------------------------------------------------------------------------------------------

export interface RepoPutOptions<R extends AbstractRepo<any>> {
  condition?: Condition<R["$schema"]>;
}

export type RepoPutResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// create ---------------------------------------------------------------------------------------------

export type RepoCreateItem<R extends AbstractRepo<any>> = RepoPutItem<R>;

export interface RepoCreateOptions<R extends AbstractRepo<any>> {
  condition?: Condition<R["$schema"]>;
}

export type RepoCreateResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// update ---------------------------------------------------------------------------------------------

export type RepoUpdateData = Obj;

export interface RepoUpdateOptions<R extends AbstractRepo<any>> {
  condition?: Condition<R["$schema"]>;
}

export type RepoUpdateResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// delete ---------------------------------------------------------------------------------------------

export interface RepoDeleteOptions<R extends AbstractRepo<any>> {
  condition?: Condition<R["$schema"]>;
}

export type RepoDeleteResult<R extends AbstractRepo<any>> = RepoOutput<R> | undefined;
export type RepoDeleteOrThrowResult<R extends AbstractRepo<any>> = RepoOutput<R>;

// query ---------------------------------------------------------------------------------------------

export type RepoQueryQuery<R extends AbstractRepo<any>> = Pick<
  R["$schema"],
  R["table"]["def"]["partitionKey"]
> &
  SortKeyQuery<R["$schema"], R["table"]["def"]["sortKey"]>;

export interface RepoQueryOptions<R extends AbstractRepo<any>> {
  startKey?: RepoKey<R>;
  filter?: Condition<R["$schema"]>;
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
  ToUnion<NonNullable<ExtractTableDef<T>["gsis"]>[G]["partitionKey"]> & string
> &
  SortKeyQuery<ExtractTableSchema<T>, NonNullable<ExtractTableDef<T>["gsis"]>[G]["sortKey"]>;

type GsiSortKeyOf<T extends Table, G extends string> = ToUnion<
  NonNullable<ExtractTableDef<T>["gsis"]>[G] extends { sortKey: infer SK } ? SK : never
> &
  string;

type TableSortKeyOf<T extends Table> =
  ExtractTableDef<T> extends { sortKey: infer SK extends string } ? SK : never;

export type RepoGsiStartKey<T extends Table, G extends string> = Pick<
  ExtractTableSchema<T>,
  | ExtractTableDef<T>["partitionKey"]
  | TableSortKeyOf<T>
  | (ToUnion<NonNullable<ExtractTableDef<T>["gsis"]>[G]["partitionKey"]> & string)
  | GsiSortKeyOf<T, G>
>;

export interface RepoQueryGsiOptions<
  R extends AbstractRepo<any>,
  T extends Table = Table,
  G extends string = string,
> {
  startKey?: RepoGsiStartKey<T, G>;
  filter?: Condition<R["$schema"]>;
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
  filter?: Condition<R["$schema"]>;
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

export interface RepoScanGsiOptions<
  R extends AbstractRepo<any>,
  T extends Table = Table,
  G extends string = string,
> {
  startKey?: RepoGsiStartKey<T, G>;
  filter?: Condition<R["$schema"]>;
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

export interface RepoExistsOptions<R extends AbstractRepo<any>> {
  query?: Obj;
  filter?: Condition<R["$schema"]>;
  consistent?: boolean;
}

// trx get -----------------------------------------------------------------------------------------

export interface RepoTrxGetOptions<R extends AbstractRepo<any>> {
  projection?: Projection<R>;
  condition?: Condition<R["$schema"]>;
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
  condition?: Condition<R["$schema"]>;
}

export interface RepoTrxPutRequest<R extends AbstractRepo<any>> {
  type: "PUT";
  item: RepoPutItem<R>;
  condition?: Condition<R["$schema"]>;
}

export interface RepoTrxUpdateRequest<R extends AbstractRepo<any>> {
  table: string;
  type: "UPDATE";
  key: RepoKey<R>;
  update: RepoUpdateData;
  condition?: Condition<R["$schema"]>;
}

export interface RepoTrxConditionRequest<R extends AbstractRepo<any>> {
  type: "CONDITION";
  key: RepoKey<R>;
  condition: Condition<R["$schema"]>;
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
  filter?: (item: R["$schema"]) => boolean;
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
  readonly partitionKey: ValidGsiKeys<T> | readonly ValidGsiKeys<T>[];
  readonly sortKey?: ValidGsiKeys<T> | readonly ValidGsiKeys<T>[];
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
