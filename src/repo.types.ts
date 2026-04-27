import type { AbstractRepo } from "./repo";
import type { Table } from "./table";
import type {
  AllKeys,
  Condition,
  DistPartialSome,
  ExtractKey,
  ExtractTableDef,
  ExtractTableSchema,
  Obj,
  SortKeyQuery,
  ToUnion,
} from "./types";

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
  filter?: (item: R["$schema"]) => boolean;
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
