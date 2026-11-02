import type { DbBatchOptions } from "./db.types";
import type { RepoBase } from "./repo";
import type { Table } from "./table";
import type {
  AllKeys,
  Condition,
  DistOmit,
  DistPartialSome,
  ExtractKey,
  ExtractTableDef,
  ExtractTableSchema,
  Obj,
  Simplify,
  SortKeyQuery,
  ToUnion,
  UpdateExpression,
} from "./types";

// True when the repo has no custom `transformOutput` (its output type is the raw
// schema). Wrapped in tuples so unions compare whole, not distributively.
type IsRawOutput<R extends RepoBase> = [RepoOutput<R>] extends [R["$schema"]]
  ? [R["$schema"]] extends [RepoOutput<R>]
    ? true
    : false
  : false;

// Simplify a full-item result for display, but ONLY when it is the raw schema.
// A custom `transformOutput` type (e.g. a class instance) is passed through
// verbatim so it keeps its nominal identity — see the `Simplify` doc comment.
type SimplifyItem<R extends RepoBase, T> = IsRawOutput<R> extends true ? Simplify<T> : T;

//-----------------------------------------------------------------------------------------------------
// Repository Types - all of these types should except a generic R of type RepoBase
//-----------------------------------------------------------------------------------------------------

export type RepoKey<R extends RepoBase> = Partial<R["$schema"]> &
  ExtractKey<R["$schema"], R["$def"]>;

export type RepoPutItem<R extends RepoBase> = R["$schema"];

export type RepoUpdateItem<R extends RepoBase> = DistPartialSome<
  Omit<R["$schema"], R["$computedAttributes"] | R["$immutableAttributes"]>,
  keyof R["defaultUpdateData"]
>;

export type RepoUpdateInput<R extends RepoBase> = RepoUpdateData<
  Omit<R["$schema"], R["$computedAttributes"] | R["$immutableAttributes"]>
>;

// Narrows the update input based on the key argument. When the repo has a
// discriminator and the key carries a literal value for it, the union variant
// is selected and variant-specific fields become writable.
export type RepoUpdateInputFor<R extends RepoBase, K> = [R["$discriminator"]] extends [never]
  ? RepoUpdateInput<R>
  : [ExtractDiscriminatorValue<K, R["$discriminator"]>] extends [never]
    ? RepoUpdateInput<R>
    : RepoUpdateData<
        DistOmit<
          NarrowByDiscriminator<R["$schema"], R["$discriminator"], K>,
          R["$computedAttributes"] | R["$immutableAttributes"]
        >
      >;

export type GsiNames<R extends RepoBase> = keyof NonNullable<R["table"]["def"]["gsis"]> & string;

export type TableGsiNames<T extends Table> = keyof NonNullable<ExtractTableDef<T>["gsis"]> & string;

export type GsiKey<R extends RepoBase, G extends GsiNames<R>> = ExtractKey<
  R["$schema"],
  GsiDef<R, G>
>;

export type Projection<R extends RepoBase> = AllKeys<R["$schema"]>[];

export type RepoOutput<R extends RepoBase> = ReturnType<R["transformOutput"]>;

export type ApplyProjection<R extends RepoBase, O> = O extends {
  projection: ReadonlyArray<infer P extends AllKeys<R["$schema"]>>;
}
  ? Simplify<Pick<R["$schema"], P>>
  : SimplifyItem<R, RepoOutput<R>>;

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

// Distributes over T so that union variants survive. Without distribution, the
// inner `Omit` collapses through `keyof (A | B)` and the result loses every
// variant-specific key — breaking GSI projection result types for discriminated
// unions.
type MakeRequired<T, K extends keyof any> = T extends unknown
  ? Omit<T, Extract<K, keyof T>> & Required<Pick<T, Extract<K, keyof T>>>
  : never;

export type ApplyGsiProjection<R extends RepoBase, O, G extends string> = O extends {
  projection: ReadonlyArray<infer P extends AllKeys<R["$schema"]>>;
}
  ? Simplify<Pick<R["$schema"], P | Extract<GsiAllKeyAttributes<R, G>, keyof R["$schema"]>>>
  : GsiProjectionType<R, G> extends "ALL" | undefined
    ? // ALL projection returns the full item. For the raw schema, promote the
      // GSI's own key attributes to required and simplify for display; for a
      // custom `transformOutput` type, use it directly (no key promotion).
      IsRawOutput<R> extends true
      ? Simplify<
          MakeRequired<RepoOutput<R>, Extract<GsiOwnKeyAttributes<R, G>, keyof RepoOutput<R>>>
        >
      : RepoOutput<R>
    : Simplify<
        Pick<
          R["$schema"],
          Extract<GsiAllKeyAttributes<R, G> | GsiIncludedAttributes<R, G>, keyof R["$schema"]>
        >
      >;

// get ------------------------------------------------------------------------------------------------

export interface RepoGetOptions<R extends RepoBase> {
  consistent?: boolean;
  projection?: Projection<R>;
  filter?: Partial<R["$schema"]>;
}

export type RepoGetResult<R extends RepoBase, O extends RepoGetOptions<R>> =
  | NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>
  | undefined;

export type RepoGetOrThrowResult<
  R extends RepoBase,
  O extends RepoGetOptions<R>,
> = NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>;

// put ------------------------------------------------------------------------------------------------

export interface RepoPutOptions<R extends RepoBase> {
  condition?: Condition<R["$schema"]>;
}

export type RepoPutResult<R extends RepoBase, TItem = {}> = SimplifyItem<
  R,
  NarrowByDiscriminator<RepoOutput<R>, R["$discriminator"], TItem>
>;

// create ---------------------------------------------------------------------------------------------

export type RepoCreateItem<R extends RepoBase> = Omit<
  DistPartialSome<R["$schema"], keyof R["defaultCreateData"]>,
  R["$computedAttributes"]
> & { readonly [K in R["$computedAttributes"]]?: never };

export type RepoCreateResult<R extends RepoBase, TItem = {}> = SimplifyItem<
  R,
  NarrowByDiscriminator<RepoOutput<R>, R["$discriminator"], TItem>
>;

// update ---------------------------------------------------------------------------------------------

export type RepoUpdateData<T = Obj> = UpdateExpression<T>;

export interface RepoUpdateOptions<R extends RepoBase> {
  condition?: Condition<R["$schema"]>;
}

export type RepoUpdateResult<R extends RepoBase> = SimplifyItem<R, RepoOutput<R>>;

// delete ---------------------------------------------------------------------------------------------

export interface RepoDeleteOptions<R extends RepoBase> {
  condition?: Condition<R["$schema"]>;
}

export type RepoDeleteResult<R extends RepoBase> = SimplifyItem<R, RepoOutput<R>> | undefined;
export type RepoDeleteOrThrowResult<R extends RepoBase> = SimplifyItem<R, RepoOutput<R>>;

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

export type RepoQueryResult<
  R extends RepoBase,
  O extends RepoQueryOptions<R>,
> = NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>[];

export type RepoQueryPagedResult<
  R extends RepoBase,
  O extends RepoQueryOptions<R>,
> = AsyncGenerator<
  NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>[]
>;

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
> = NarrowByDiscriminator<ApplyGsiProjection<R, O, G>, R["$discriminator"], FilterOf<O>>[];

export type RepoQueryGsiPagedResult<
  R extends RepoBase,
  O extends RepoQueryGsiOptions<R>,
  G extends string = string,
> = AsyncGenerator<
  NarrowByDiscriminator<ApplyGsiProjection<R, O, G>, R["$discriminator"], FilterOf<O>>[]
>;

// get gsi -------------------------------------------------------------------------------------------

export type RepoGetGsiOptions<
  R extends RepoBase,
  T extends Table = Table,
  G extends string = string,
> = Omit<RepoQueryGsiOptions<R, T, G>, "sort" | "limit" | "startKey" | "filter"> & {
  filter?: Partial<R["$schema"]>;
};

export type RepoGetGsiResult<
  R extends RepoBase,
  O extends RepoGetGsiOptions<R>,
  G extends string = string,
> =
  | NarrowByDiscriminator<ApplyGsiProjection<R, O, G>, R["$discriminator"], FilterOf<O>>
  | undefined;

export type RepoGetGsiOrThrowResult<
  R extends RepoBase,
  O extends RepoGetGsiOptions<R>,
  G extends string = string,
> = NarrowByDiscriminator<ApplyGsiProjection<R, O, G>, R["$discriminator"], FilterOf<O>>;

// scan ----------------------------------------------------------------------------------------------

export interface RepoScanOptions<R extends RepoBase> {
  startKey?: RepoKey<R>;
  filter?: Condition<R["$schema"]>;
  projection?: Projection<R>;
  limit?: number;
  consistent?: boolean;
  parallel?: number;
}

export type RepoScanResult<
  R extends RepoBase,
  O extends RepoScanOptions<R>,
> = NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>[];

export type RepoScanPagedResult<R extends RepoBase, O extends RepoScanOptions<R>> = AsyncGenerator<
  NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>[]
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
> = NarrowByDiscriminator<ApplyGsiProjection<R, O, G>, R["$discriminator"], FilterOf<O>>[];

export type RepoScanGsiPagedResult<
  R extends RepoBase,
  O extends RepoScanGsiOptions<R>,
  G extends string = string,
> = AsyncGenerator<
  NarrowByDiscriminator<ApplyGsiProjection<R, O, G>, R["$discriminator"], FilterOf<O>>[]
>;

// exists -------------------------------------------------------------------------------------------

export interface RepoExistsOptions<R extends RepoBase> {
  query?: Obj;
  filter?: Condition<R["$schema"]>;
  consistent?: boolean;
}

// trx get -----------------------------------------------------------------------------------------

export interface RepoTrxGetOptions<R extends RepoBase> {
  projection?: Projection<R>;
  filter?: Partial<R["$schema"]>;
}

export type RepoTrxGetResult<R extends RepoBase, O extends RepoTrxGetOptions<R>> = (
  | NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>
  | undefined
)[];

export type RepoTrxGetOrThrowResult<
  R extends RepoBase,
  O extends RepoTrxGetOptions<R>,
> = NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>[];

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
  update: RepoUpdateData<Omit<R["$schema"], R["$computedAttributes"] | R["$immutableAttributes"]>>;
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

export interface RepoBatchGetOptions<R extends RepoBase> extends DbBatchOptions {
  consistent?: boolean;
  projection?: Projection<R>;
  filter?: Partial<R["$schema"]>;
}

export type RepoBatchGetResult<R extends RepoBase, O extends RepoBatchGetOptions<R>> = {
  items: NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>[];
  unprocessed?: RepoKey<R>[];
};

export type RepoBatchGetOrThrowResult<
  R extends RepoBase,
  O extends RepoBatchGetOptions<R>,
> = NarrowByDiscriminator<ApplyProjection<R, O>, R["$discriminator"], FilterOf<O>>[];

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
  /**
   * @deprecated Always `undefined`. `BatchWriteItem` does not return the items
   * it wrote, so this has never been populated. Will be removed in a future minor.
   */
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

// strict options --------------------------------------------------------------------------------

// An object type (rather than a string/never) so intersecting it with the inferred value
// can't collapse the whole options object to `never`; the error then names the key.
type Unknown<What extends string, K> = { [M in `Unknown ${What} "${K & string}"`]: never };

// (separate alias so the mapped type is homomorphic and preserves tuples/arrays)
type StrictFilters<A, T> = { [I in keyof A]: StrictFilter<A[I], T> };

/** Maps an inferred filter to itself, replacing fields unknown to `T` (at any depth) with an error type. */
export type StrictFilter<F, T> = {
  [K in keyof F]: K extends "$and" | "$or"
    ? StrictFilters<F[K], T>
    : K extends "$not"
      ? StrictFilter<F[K], T>
      : K extends AllKeys<T>
        ? F[K]
        : Unknown<"field", K>;
};

/**
 * Maps options inferred from a literal (via a `const` type parameter) to themselves,
 * replacing option names unknown to `Base`, and filter fields unknown to `T`, with an
 * error type. Intersect it with the inferred options to reject unknown keys, which
 * inference otherwise doesn't check.
 */
export type StrictOptions<O, Base, T> = {
  [K in keyof O]: K extends "filter"
    ? StrictFilter<O[K], T>
    : K extends AllKeys<Base>
      ? O[K]
      : Unknown<"option", K>;
};

// discriminator narrowing -----------------------------------------------------------------------

type DiscriminatorLiteral = string | number | boolean;

// literal(s) from a shorthand `$eq`, `{ $eq: literal }` or `{ $in: [literals] }` condition
type DiscriminatorOperand<C> = C extends DiscriminatorLiteral
  ? C
  : C extends { $eq: infer L extends DiscriminatorLiteral }
    ? L
    : C extends { $in: readonly (infer L extends DiscriminatorLiteral)[] }
      ? L
      : never;

type ExtractDiscriminatorValue<Q, D extends keyof any> = D extends keyof Q
  ? DiscriminatorOperand<Q[D]>
  : never;

// Extracts the filter object from options (non-function, non-undefined only)
export type FilterOf<O> = O extends { filter: infer F } ? (F extends object ? F : {}) : {};

export type NarrowByDiscriminator<TOutput, TDiscriminator extends keyof any, Q> = [
  TDiscriminator,
] extends [never]
  ? TOutput
  : [ExtractDiscriminatorValue<Q, TDiscriminator>] extends [never]
    ? TOutput
    : Extract<
        TOutput,
        { [K in TDiscriminator & keyof TOutput]: ExtractDiscriminatorValue<Q, TDiscriminator> }
      >;
