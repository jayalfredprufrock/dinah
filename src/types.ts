import type { Static } from "typebox";
import type { Table } from "./table";

export type Obj<T = any> = Record<string, T>;

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

export type PickTypeOf<T, K extends AllKeys<T>, O> = T extends { [k in K]?: O } ? T[K] : never;

// Normalize string | readonly string[] to a union of strings
export type ToUnion<T> = T extends readonly (infer U)[] ? U : T;

/** Operators valid in a KeyConditionExpression (sort key). */
export type SortKeyOps<V> = { $eq?: V; $gt?: V; $gte?: V; $lt?: V; $lte?: V } & ([
  NonNullable<V>,
] extends [string]
  ? { $between?: [string, string]; $prefix?: string }
  : [NonNullable<V>] extends [number]
    ? { $between?: [number, number] }
    : {});

type SortKeyFieldCondition<V> = V | SortKeyOps<V>;

type SortKeyPick<Schema, Keys extends keyof Schema> = {
  [K in Keys]: SortKeyFieldCondition<Schema[K]>;
};

// Enumerate valid left-to-right sort key combinations for multi-key GSIs (max 4 attributes)
export type SortKeyQuery<Schema, SK> = SK extends readonly [
  infer A extends string & keyof Schema,
  infer B extends string & keyof Schema,
  infer C extends string & keyof Schema,
  infer D extends string & keyof Schema,
]
  ?
      | {}
      | SortKeyPick<Schema, A>
      | SortKeyPick<Schema, A | B>
      | SortKeyPick<Schema, A | B | C>
      | SortKeyPick<Schema, A | B | C | D>
  : SK extends readonly [
        infer A extends string & keyof Schema,
        infer B extends string & keyof Schema,
        infer C extends string & keyof Schema,
      ]
    ? {} | SortKeyPick<Schema, A> | SortKeyPick<Schema, A | B> | SortKeyPick<Schema, A | B | C>
    : SK extends readonly [
          infer A extends string & keyof Schema,
          infer B extends string & keyof Schema,
        ]
      ? {} | SortKeyPick<Schema, A> | SortKeyPick<Schema, A | B>
      : SK extends readonly [infer A extends string & keyof Schema]
        ? {} | SortKeyPick<Schema, A>
        : SK extends string & keyof Schema
          ? { [K in SK]?: SortKeyFieldCondition<Schema[K]> }
          : {};

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

// ── Condition typing ──────────────────────────────────────────────────────────

/** Extract the type of field K across all members of union T */
export type ValueOfUnion<T, K extends string> = T extends unknown
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
export interface PathRef {
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

/** Key condition expression — only KeyConditionExpression-valid operators, no compound operators. */
export type KeyCondition<T> = {
  [K in AllKeys<T>]?: ValueOfUnion<T, K> | SortKeyOps<ValueOfUnion<T, K>>;
};

// ── Update expression typing ─────────────────────────────────────────────────

interface UpdateNumberOps {
  $plus?: number | [number | PathRef, number | PathRef];
  $minus?: number | [number | PathRef, number | PathRef];
}

interface UpdateListOps<E> {
  $append?: E | E[] | PathRef;
  $prepend?: E | E[] | PathRef;
}

interface UpdateCommonOps<V> {
  $set?: V;
  $remove?: true;
  $ifNotExists?: V | [string, V];
  $setAdd?: V | V[];
  $setDel?: V | V[];
}

type UpdateFieldOps<V> = [NonNullable<V>] extends [number]
  ? UpdateCommonOps<V> & UpdateNumberOps
  : [NonNullable<V>] extends [(infer E)[]]
    ? UpdateCommonOps<V> & UpdateListOps<E>
    : UpdateCommonOps<V>;

export type UpdateExpression<T> = {
  [K in AllKeys<T>]?: ValueOfUnion<T, K> | UpdateFieldOps<ValueOfUnion<T, K>> | undefined;
};

//-----------------------------------------------------------------------------------------------------
// Table Definition Types
//-----------------------------------------------------------------------------------------------------

export interface Gsi<T> {
  readonly partitionKey: ValidGsiKeys<T> | readonly ValidGsiKeys<T>[];
  readonly sortKey?: ValidGsiKeys<T> | readonly ValidGsiKeys<T>[];
  readonly projection?: "ALL" | "KEYS_ONLY" | readonly AllKeys<T>[];
}

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
