import type { RepoBase } from "./repo";
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
  UpdateExpression,
} from "./types";

//-----------------------------------------------------------------------------------------------------
// Repository Types - all of these types should except a generic R of type RepoBase
//-----------------------------------------------------------------------------------------------------

export type RepoKey<R extends RepoBase> = Partial<R["$schema"]> &
  ExtractKey<R["$schema"], R["$def"]>;

export type RepoPutItem<R extends RepoBase> = Omit<
  DistPartialSome<R["$schema"], keyof R["defaultPutData"]>,
  R["$derivedAttributes"]
>;

export type RepoUpdateItem<R extends RepoBase> = DistPartialSome<
  Omit<R["$schema"], R["$derivedAttributes"] | R["$immutableAttributes"]>,
  keyof R["defaultUpdateData"]
>;

export type GsiNames<R extends RepoBase> = keyof R["table"]["def"]["gsis"] & string;

export type TableGsiNames<T extends Table> = keyof NonNullable<ExtractTableDef<T>["gsis"]> & string;

export type GsiKey<R extends RepoBase, G extends GsiNames<R>> = ExtractKey<
  R["$schema"],
  GsiDef<R, G>
>;

export type Projection<R extends RepoBase> = AllKeys<R["$schema"]>[];

export type RepoOutput<R extends RepoBase> = ReturnType<R["transformOutput"]>;

export type ApplyProjection<R extends RepoBase, O> = O extends {
  projection: Array<infer P extends AllKeys<R["$schema"]>>;
}
  ? Pick<R["$schema"], P>
  : RepoOutput<R>;

export type GsiProjectionType<R extends RepoBase, G extends string> =
  GsiDef<R, G> extends { projection: infer P } ? P : undefined;

type GsiDef<R extends RepoBase, G extends string> = NonNullable<R["table"]["def"]["gsis"]>[G];

type TableKeyAttributes<R extends RepoBase> =
  | R["table"]["def"]["partitionKey"]
  | (R["table"]["def"]["sortKey"] & string);

type GsiOwnKeyAttributes<R extends RepoBase, G extends string> =
  | (ToUnion<GsiDef<R, G>["partitionKey"]> & string)
  | (ToUnion<GsiDef<R, G>["sortKey"]> & string);

type GsiAllKeyAttributes<R extends RepoBase, G extends string> =
  | TableKeyAttributes<R>
  | GsiOwnKeyAttributes<R, G>;

type GsiIncludedAttributes<R extends RepoBase, G extends string> = Extract<
  GsiDef<R, G>["projection"],
  readonly any[]
>[number];

export type ApplyGsiProjection<R extends RepoBase, O, G extends string> = O extends {
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

export interface RepoGetOptions<R extends RepoBase> {
  consistent?: boolean;
  projection?: Projection<R>;
  filter?: (item: R["$schema"]) => boolean;
}

export type RepoGetResult<R extends RepoBase, O extends RepoGetOptions<R>> =
  | undefined
  | ApplyProjection<R, O>;
export type RepoGetOrThrowResult<R extends RepoBase, O extends RepoGetOptions<R>> = ApplyProjection<
  R,
  O
>;

// put ------------------------------------------------------------------------------------------------

export interface RepoPutOptions<R extends RepoBase> {
  condition?: Condition<R["$schema"]>;
}

export type RepoPutResult<R extends RepoBase> = RepoOutput<R>;

// create ---------------------------------------------------------------------------------------------

export type RepoCreateItem<R extends RepoBase> = RepoPutItem<R>;

export interface RepoCreateOptions<R extends RepoBase> {
  condition?: Condition<R["$schema"]>;
}

export type RepoCreateResult<R extends RepoBase> = RepoOutput<R>;

// update ---------------------------------------------------------------------------------------------

export type RepoUpdateData<T = Obj> = UpdateExpression<T>;

export interface RepoUpdateOptions<R extends RepoBase> {
  condition?: Condition<R["$schema"]>;
}

export type RepoUpdateResult<R extends RepoBase> = RepoOutput<R>;

// delete ---------------------------------------------------------------------------------------------

export interface RepoDeleteOptions<R extends RepoBase> {
  condition?: Condition<R["$schema"]>;
}

export type RepoDeleteResult<R extends RepoBase> = RepoOutput<R> | undefined;
export type RepoDeleteOrThrowResult<R extends RepoBase> = RepoOutput<R>;

// query ---------------------------------------------------------------------------------------------

export type RepoQueryQuery<R extends RepoBase> = Pick<
  R["$schema"],
  Extract<R["table"]["def"]["partitionKey"], keyof R["$schema"]>
> &
  SortKeyQuery<R["$schema"], R["table"]["def"]["sortKey"]>;

export interface RepoQueryOptions<R extends RepoBase> {
  startKey?: RepoKey<R>;
  filter?: Condition<R["$schema"]>;
  projection?: Projection<R>;
  limit?: number;
  consistent?: boolean;
  sort?: "ASC" | "DESC";
}

export type RepoQueryResult<R extends RepoBase, O extends RepoQueryOptions<R>> = ApplyProjection<
  R,
  O
>[];

export type RepoQueryPagedResult<
  R extends RepoBase,
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
  R extends RepoBase,
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
  R extends RepoBase,
  O extends RepoQueryGsiOptions<R>,
  G extends string = string,
> = ApplyGsiProjection<R, O, G>[];

export type RepoQueryGsiPagedResult<
  R extends RepoBase,
  O extends RepoQueryGsiOptions<R>,
  G extends string = string,
> = AsyncGenerator<ApplyGsiProjection<R, O, G>[]>;

// scan ----------------------------------------------------------------------------------------------

export interface RepoScanOptions<R extends RepoBase> {
  startKey?: RepoKey<R>;
  filter?: Condition<R["$schema"]>;
  projection?: Projection<R>;
  limit?: number;
  consistent?: boolean;
  parallel?: number;
}

export type RepoScanResult<R extends RepoBase, O extends RepoScanOptions<R>> = ApplyProjection<
  R,
  O
>[];

export type RepoScanPagedResult<R extends RepoBase, O extends RepoScanOptions<R>> = AsyncGenerator<
  ApplyProjection<R, O>[]
>;

// scan gsi ------------------------------------------------------------------------------------------

export interface RepoScanGsiOptions<
  R extends RepoBase,
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
  R extends RepoBase,
  O extends RepoScanGsiOptions<R>,
  G extends string = string,
> = ApplyGsiProjection<R, O, G>[];

export type RepoScanGsiPagedResult<
  R extends RepoBase,
  O extends RepoScanGsiOptions<R>,
  G extends string = string,
> = AsyncGenerator<ApplyGsiProjection<R, O, G>[]>;

// exists -------------------------------------------------------------------------------------------

export interface RepoExistsOptions<R extends RepoBase> {
  query?: Obj;
  filter?: Condition<R["$schema"]>;
  consistent?: boolean;
}

// trx get -----------------------------------------------------------------------------------------

export interface RepoTrxGetOptions<R extends RepoBase> {
  projection?: Projection<R>;
  filter?: (item: R["$schema"]) => boolean;
}

export type RepoTrxGetResult<R extends RepoBase, O extends RepoTrxGetOptions<R>> = (
  | ApplyProjection<R, O>
  | undefined
)[];

export type RepoTrxGetOrThrowResult<
  R extends RepoBase,
  O extends RepoTrxGetOptions<R>,
> = ApplyProjection<R, O>[];

export type RepoTrxGetRequestResult = { table: string };

// trx write ----------------------------------------------------------------------------------------

export interface RepoTrxDeleteRequest<R extends RepoBase> {
  type: "DELETE";
  key: RepoKey<R>;
  condition?: Condition<R["$schema"]>;
}

export interface RepoTrxPutRequest<R extends RepoBase> {
  type: "PUT";
  item: RepoPutItem<R>;
  condition?: Condition<R["$schema"]>;
}

export interface RepoTrxUpdateRequest<R extends RepoBase> {
  table: string;
  type: "UPDATE";
  key: RepoKey<R>;
  update: RepoUpdateData<Omit<R["$schema"], R["$derivedAttributes"] | R["$immutableAttributes"]>>;
  condition?: Condition<R["$schema"]>;
}

export interface RepoTrxConditionRequest<R extends RepoBase> {
  type: "CONDITION";
  key: RepoKey<R>;
  condition: Condition<R["$schema"]>;
}

export type RepoTrxWriteRequest<R extends RepoBase> =
  | RepoTrxDeleteRequest<R>
  | RepoTrxPutRequest<R>
  | RepoTrxUpdateRequest<R>
  | RepoTrxConditionRequest<R>;

// batch get ----------------------------------------------------------------------------------------

export interface RepoBatchGetOptions<R extends RepoBase> {
  consistent?: boolean;
  projection?: Projection<R>;
  filter?: (item: R["$schema"]) => boolean;
}

export type RepoBatchGetResult<R extends RepoBase, O extends RepoBatchGetOptions<R>> = {
  items: ApplyProjection<R, O>[];
  unprocessed?: RepoKey<R>[];
};

export type RepoBatchGetOrThrowResult<
  R extends RepoBase,
  O extends RepoBatchGetOptions<R>,
> = ApplyProjection<R, O>[];

// batch write --------------------------------------------------------------------------------------

type RepoBatchWritePutRequest<R extends RepoBase> = {
  type: "PUT";
  item: RepoPutItem<R>;
};
type RepoBatchWriteDeleteRequest<R extends RepoBase> = {
  type: "DELETE";
  key: RepoKey<R>;
};

export type RepoBatchWrite<R extends RepoBase> = (
  | RepoBatchWritePutRequest<R>
  | RepoBatchWriteDeleteRequest<R>
)[];

export type RepoBatchWriteResult<R extends RepoBase> = {
  items: RepoPutItem<R>[];
  unprocessed?: RepoBatchWrite<R>;
};

// batch put ------------------------------------------------------------------------------------

export type RepoBatchPutRequest<R extends RepoBase> = RepoPutItem<R>[];
export type RepoBatchPutResult<R extends RepoBase> = {
  items: RepoPutItem<R>[];
  unprocessed?: RepoBatchPutRequest<R>;
};

// batch update ---------------------------------------------------------------------------------

export type RepoBatchUpdateResult<R extends RepoBase> = {
  unprocessed?: RepoKey<R>[];
};

// batch delete ---------------------------------------------------------------------------------

export type RepoBatchDeleteRequest<R extends RepoBase> = RepoKey<R>[];
export type RepoBatchDeleteResponse<R extends RepoBase> = RepoBatchDeleteRequest<R> | undefined;
