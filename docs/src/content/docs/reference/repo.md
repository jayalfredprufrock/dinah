---
title: Repo
description: Complete method reference for Repo and AbstractRepo.
sidebar:
  order: 2
---

`Repo<T>` is the typed facade over `Db` for a specific `Table`. It inherits every method from `AbstractRepo<T>` and adds nothing of its own — the only difference is that `Repo` requires you to pass the table at construction, while `AbstractRepo` is meant to be subclassed with `readonly table = ...`.

Every method below is inherited by any subclass of `AbstractRepo`.

```typescript
const userRepo = db.createRepo(UserTable);
// equivalent to:
const userRepo = new Repo(db, UserTable);
```

## Constructor

```typescript
new Repo<T extends Table>(db: Db, table: T)
```

For subclasses:

```typescript
abstract class AbstractRepo<T extends Table> {
  constructor(db: Db);
  abstract readonly table: T;
}
```

## Properties

- **`db: Db`** — the `Db` instance this repo was constructed with.
- **`table: T`** — the `Table` this repo operates on.
- **`tableName: string`** — the effective table name, `${db.config?.tableNamePrefix ?? ""}${table.def.name}`. Used by every method that talks to DynamoDB.
- **`defaultPutData`** *(overridable)* — partial item merged under every `put` / `create` / `trxPut` / `trxCreate`. Default: `{}`.
- **`defaultUpdateData`** *(overridable)* — partial update merged under every `update` / `trxUpdate`. Default: `{}`.

## Overridable hooks

- **`transformItem(item)`** — called on every item returned by a non-projected read. Override to add computed fields. See [Subclassing Repos](/guides/subclassing-repos/).
- **`extractKey(item)`** — extracts the primary key from an item-like value. Override only if you need custom key derivation (rare).

## Reads

### `get(key, options?)`

```typescript
get(key, options?: {
  consistent?: boolean;
  projection?: Projection;
  condition?: Obj;
}): Promise<Item | undefined>
```

Fetches a single item by primary key. `key` must include the table's partition key (and sort key, if the table has one); any other properties are ignored after `extractKey` runs, so it's safe to pass an entire item.

- **`consistent`** — `true` performs a strongly consistent read.
- **`projection`** — narrows the return type to `Pick<Item, P>`. Transform is skipped.
- **`condition`** — client-side `sift` condition. A non-matching item becomes `undefined`.

### `getOrThrow(key, options?)`

```typescript
getOrThrow(key, options?): Promise<Item>
```

Same as `get`, but throws if the item is missing.

### `query(query, options?)`

```typescript
query(query: Obj, options?: {
  startKey?: RepoKey<this>;
  filter?: Obj;
  projection?: Projection;
  limit?: number;
  consistent?: boolean;
  sort?: "ASC" | "DESC";
}): Promise<Item[]>
```

Exhausts all pages of a `Query` against the base table and returns the items. `query` is the key-condition expression — must target the partition key (and optionally the sort key with comparison operators).

- **`startKey`** must be a valid primary key for this table.
- **`sort: "DESC"`** reverses the iteration order (`ScanIndexForward: false`).
- See [Query Operators](/guides/query-operators/) for `query` / `filter` syntax.

### `queryPaged(query, options?)`

```typescript
queryPaged(query: Obj, options?): AsyncGenerator<Item[]>
```

Async generator form of `query`. Yields one page of items per iteration, automatically following `LastEvaluatedKey` across pages.

### `queryGsi(gsi, query, options?)`

```typescript
queryGsi<G extends GsiName>(
  gsi: G,
  query: GsiQuery<T, G>,
  options?: {
    startKey?: GsiStartKey<T, G>;
    filter?: Obj;
    projection?: Projection;
    limit?: number;
    sort?: "ASC" | "DESC";
  },
): Promise<GsiResult<T, G>[]>
```

Queries a GSI by name. The types enforce:

- `gsi` autocompletes to the set of GSI names on this table.
- `query` must include the GSI's partition key and may include the GSI's sort key with comparison operators. No other fields are accepted at the top level.
- `startKey`, if provided, must have the table's primary key **and** the GSI's key attributes.
- The return type reflects the GSI's projection: `Item[]` for `ALL`, `Pick<Item, KeysOnly>[]` for `KEYS_ONLY`, `Pick<Item, Keys | Included>[]` for an array projection.

See [Defining Tables → GSIs](/guides/defining-tables/#gsis) for projection examples.

### `queryGsiPaged(gsi, query, options?)`

```typescript
queryGsiPaged<G extends GsiName>(
  gsi: G,
  query: GsiQuery<T, G>,
  options?,
): AsyncGenerator<GsiResult<T, G>[]>
```

Async generator form of `queryGsi`.

### `scan(options?)`

```typescript
scan(options?: {
  startKey?: RepoKey<this>;
  filter?: Obj;
  projection?: Projection;
  limit?: number;
  consistent?: boolean;
  parallel?: number;
}): Promise<Item[]>
```

Exhausts all pages of a `Scan` against the base table. With `parallel: N`, issues N concurrent segment scans and merges them.

### `scanPaged(options?)`

```typescript
scanPaged(options?): AsyncGenerator<Item[]>
```

Async generator form of `scan`. Each yielded page contains merged items from all in-flight segments.

### `scanGsi(gsi, options?)`

```typescript
scanGsi<G extends GsiName>(
  gsi: G,
  options?: {
    startKey?: GsiStartKey<T, G>;
    filter?: Obj;
    projection?: Projection;
    limit?: number;
    parallel?: number;
  },
): Promise<GsiResult<T, G>[]>
```

Scans a GSI. Like `queryGsi`, the return type reflects the GSI's projection.

### `scanGsiPaged(gsi, options?)`

```typescript
scanGsiPaged<G extends GsiName>(gsi: G, options?): AsyncGenerator<GsiResult<T, G>[]>
```

Async generator form of `scanGsi`.

### `exists(options?)`

```typescript
exists(options?: {
  query?: Obj;
  filter?: Obj;
  consistent?: boolean;
}): Promise<boolean>
```

Returns `true` if at least one item on this table matches the query/filter. Internally uses `db.exists` with `projection: [partitionKey]` to avoid transferring full items.

### `existsGsi(gsi, options?)`

```typescript
existsGsi(gsi: GsiName, options?): Promise<boolean>
```

Same as `exists`, but targets a named GSI.

## Writes

### `put(item, options?)`

```typescript
put(item: PutItem, options?: { condition?: Obj }): Promise<Item>
```

Puts an item. `defaultPutData` is merged **under** `item` (caller wins on conflict). Returns the put item (with defaults applied and `transformItem` applied).

- **`condition`** is added to the `PutItem` request.

### `create(item, options?)`

```typescript
create(item: PutItem, options?: { condition?: Obj }): Promise<Item>
```

Like `put`, but fails if an item with the same primary key already exists. Dinah adds a `{ [partitionKey]: { $exists: false } }` condition, combined with your condition via `$and` if you supply one. On conflict, DynamoDB throws a `ConditionalCheckFailedException`.

### `update(key, update, options?)`

```typescript
update(
  key: Key,
  update: UpdateData,
  options?: { condition?: Obj },
): Promise<Item>
```

Runs an `UpdateItem` and returns the new item. `defaultUpdateData` is merged under `update`. See [Update Operators](/guides/update-operators/) for `update` syntax.

Dinah implicitly adds `$exists: true` checks for every primary key attribute, so updating a non-existent key fails rather than silently upserting.

### `delete(key, options?)`

```typescript
delete(key: Key, options?: { condition?: Obj }): Promise<Item | undefined>
```

Deletes an item and returns the deleted value (or `undefined` if nothing existed).

### `deleteOrThrow(key, options?)`

```typescript
deleteOrThrow(key: Key, options?): Promise<Item>
```

Same as `delete`, but throws if no item was deleted.

## Batch

### `batchGet(keys, options?)`

```typescript
batchGet(keys: Key[], options?: {
  consistent?: boolean;
  projection?: Projection;
  condition?: Obj;
}): Promise<{
  items: Item[];
  unprocessed?: Key[];
}>
```

Batch-fetches up to any number of items — Dinah chunks and retries under the hood (see [`Db.batchGet`](/reference/db/#batchgetdata)). Results preserve input order. The `condition` option is applied client-side via `sift`.

### `batchGetOrThrow(keys, options?)`

```typescript
batchGetOrThrow(keys: Key[], options?): Promise<Item[]>
```

Returns the items directly and throws if any key was missing or unprocessed.

### `batchWrite(requests)`

```typescript
batchWrite(requests: Array<
  | { type: "PUT"; item: PutItem }
  | { type: "DELETE"; key: Key }
>): Promise<{
  items: PutItem[];
  unprocessed?: Array<{ type: "PUT"; item } | { type: "DELETE"; key }>;
}>
```

Mixes put and delete requests for a single table. `defaultPutData` is merged into every put. See [Batch & Transactions](/guides/batch-and-transactions/#batch-writes) for retry semantics.

## Transactions

### `trxGet(keys, options?)`

```typescript
trxGet(keys: Key[], options?: {
  projection?: Projection;
  condition?: Obj;
}): Promise<Array<Item | undefined>>
```

Performs a transactional `TransactGetItems` against this table for the given keys. Up to 100 keys per call (DynamoDB limit).

### `trxGetOrThrow(keys, options?)`

```typescript
trxGetOrThrow(keys: Key[], options?): Promise<Item[]>
```

Same as `trxGet`, but throws if any requested key was missing.

### `trxWrite(...requests)`

```typescript
trxWrite(...requests: Array<
  | { type: "PUT"; item: PutItem; condition? }
  | { type: "UPDATE"; key: Key; update: UpdateData; condition? }
  | { type: "DELETE"; key: Key; condition? }
  | { type: "CONDITION"; key: Key; condition: Obj }
>): Promise<void>
```

Bundles multiple writes against this table into a single `TransactWriteItems`. All-or-nothing; up to 100 operations. `defaultPutData` / `defaultUpdateData` are applied to `PUT` / `UPDATE` requests respectively.

### Bulk transaction helpers

Shorthand helpers for homogeneous transactions:

```typescript
trxPut(items: PutItem[], options?): Promise<void>
trxCreate(items: PutItem[], options?): Promise<void>   // adds "$exists: false" for each
trxUpdate(keys: Key[], update: UpdateData, options?): Promise<void>
trxDelete(keys: Key[], options?): Promise<void>
```

### Cross-table transaction request builders

For transactions spanning multiple tables, use the `*Request` builders on each repo and pass the results to `db.trxWrite` or `db.trxGet`:

```typescript
trxGetRequest(key: Key, options?): DbTrxGetRequest
trxPutRequest(item: PutItem, options?): DbTrxWriteRequest     // type: "PUT"
trxUpdateRequest(key: Key, update: UpdateData, options?): DbTrxWriteRequest  // type: "UPDATE"
trxDeleteRequest(key: Key, options?): DbTrxWriteRequest       // type: "DELETE"
trxConditionRequest(key: Key, condition: Obj, options?): DbTrxWriteRequest   // type: "CONDITION"
trxCreateRequest(item: PutItem, options?): DbTrxWriteRequest  // type: "PUT" with $exists: false
```

Example:

```typescript
await db.trxWrite(
  userRepo.trxUpdateRequest({ userId: "u1" }, { role: "admin" }),
  postRepo.trxPutRequest({ postId: "p1", authorId: "u1", /* … */ }),
  auditRepo.trxCreateRequest({ eventId: crypto.randomUUID(), type: "role-granted" }),
);
```

Each builder fills in `table: this.tableName` automatically, merges defaults, and wraps the request in the correct discriminated-union shape for `db.trxWrite` / `db.trxGet`.

## Utilities

### `extractKey(item)`

```typescript
extractKey(item: Key): Key
```

Returns a new object containing only the primary key attributes from `item`. Called automatically by every keyed operation on the repo, so you can pass an entire item to `get` / `update` / `delete` and have the extra attributes ignored.
