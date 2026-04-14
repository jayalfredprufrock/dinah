---
title: Db
description: Complete method reference for the Db class.
sidebar:
  order: 1
---

`Db` is the low-level client that wraps the AWS SDK v3 `DynamoDBDocumentClient`. It exposes operations that work against any table by name, plus cross-table batch and transaction methods. Use it directly for untyped utility code, or pass it to `createRepo()` / `new MyRepo(db)` to get a typed `Repo`.

## Constructor

```typescript
new Db(
  clientOrConfig: DynamoDBClient | DynamoDB | DynamoDBClientConfig,
  dbConfig?: DbConfig,
)
```

- **`clientOrConfig`** — one of:
  - a `DynamoDBClientConfig` — Dinah constructs a new `DynamoDBClient` and wraps it in a `DynamoDBDocumentClient`.
  - an existing `DynamoDBClient` — Dinah wraps it in a new document client.
  - an existing `DynamoDB` — Dinah unwraps it and wraps in a document client.
- **`dbConfig`** (optional) — `{ tableNamePrefix?: string }`. When set, every Repo prefixes its `tableName` with this value, which is useful for environment-scoped tables (`staging_users`, `prod_users`, …).

If `clientOrConfig.endpoint` is an empty string, Dinah normalizes it to `undefined` before constructing the client, so local DynamoDB configs that read from environment variables don't trip over `DYNAMODB_ENDPOINT=""`.

## Properties

- **`client: DynamoDBDocumentClient`** — the wrapped document client. Use this when you need to send raw commands that Dinah doesn't cover (`DescribeTable`, `UpdateTable`, etc.).
- **`config: DbConfig | undefined`** — the `DbConfig` passed at construction.

## Methods

### `createRepo(table)`

```typescript
createRepo<T extends Table>(table: T): Repo<T>
```

Creates a new `Repo` bound to this `Db` and the given `Table`. The returned repo's type is inferred from the table's schema and definition.

```typescript
const userRepo = db.createRepo(UserTable);
```

### `createTable(table)`

```typescript
createTable(table: Table): Promise<void>
```

Provisions the physical table via `CreateTable`, including its GSIs and billing mode. If `table.def.ttlAttribute` is set, issues a follow-up `UpdateTimeToLive` to enable TTL.

Primarily useful for tests and local development — in production you'll typically provision tables through IaC (CloudFormation, Terraform, CDK).

### `deleteTable(tableName)`

```typescript
deleteTable(tableName: string): Promise<void>
```

Deletes the table by sending a `DeleteTable` command. No confirmation, no soft-delete.

### `listTables(data?)`

```typescript
listTables(data?: { limit?: number }): Promise<string[]>
```

Lists all table names in the account and region, paginating through `ListTables` until DynamoDB returns no `LastEvaluatedTableName`. The `limit` option caps **per-page** results, not the total.

### `get(data)`

```typescript
get<R = Obj>(data: {
  table: string;
  key: Obj;
  consistent?: boolean;
  projection?: string[];
  condition?: Obj;
}): Promise<R | undefined>
```

Sends a `GetItem` and returns the item, or `undefined` if not found.

- **`condition`** is applied **client-side** with `sift` after the item is fetched. An item that fails the condition is treated as not found.
- **`projection`** compiles to a DynamoDB projection expression.
- The generic `R` lets you assert a return shape; prefer using a `Repo` for real inference.

### `getOrThrow(data)`

```typescript
getOrThrow<R = Obj>(data: DbGet): Promise<R>
```

Same as `get`, but throws `Error("Item not found in <table> table.")` when no item is returned.

### `put(data)`

```typescript
put<R = Obj>(data: {
  table: string;
  item: Obj;
  returnOld?: boolean;
  condition?: Obj;
}): Promise<R>
```

Sends a `PutItem`. Undefined properties on `item` are stripped out before the request.

- **`condition`** compiles to a DynamoDB condition expression.
- **`returnOld: true`** returns the previous value (from `ALL_OLD`). Otherwise returns the put item.

### `update(data)`

```typescript
update<R = Obj>(data: {
  table: string;
  key: Obj;
  update: Obj;
  condition?: Obj;
}): Promise<R>
```

Sends an `UpdateItem` with `ReturnValues: "ALL_NEW"`. See [Update Operators](/guides/update-operators/) for the `update` syntax.

Dinah automatically adds an `$exists: true` check for every primary key attribute, so updating a non-existent key fails rather than silently upserting.

### `delete(data)`

```typescript
delete<R = Obj>(data: {
  table: string;
  key: Obj;
  condition?: Obj;
}): Promise<R | undefined>
```

Sends a `DeleteItem` with `ReturnValues: "ALL_OLD"` and returns the deleted item (or `undefined` if nothing existed).

### `deleteOrThrow(data)`

```typescript
deleteOrThrow<R = Obj>(data: DbDelete): Promise<R>
```

Same as `delete`, but throws if no item was deleted.

### `query(data)`

```typescript
query<R = Obj>(data: {
  table: string;
  query: Obj;
  startKey?: Obj;
  filter?: Obj;
  projection?: string[];
  limit?: number;
  index?: string;
  consistent?: boolean;
  sort?: "ASC" | "DESC";
}): Promise<R[]>
```

Exhausts all pages of a `Query` and returns the concatenated results. Internally calls `queryPaged`. See [Query Operators](/guides/query-operators/) for the `query` / `filter` syntax.

- **`index`** targets a GSI or LSI.
- **`sort`** controls `ScanIndexForward` — `"DESC"` reverses the order.

### `queryPaged(data)`

```typescript
queryPaged<R = Obj>(data: DbQuery): AsyncGenerator<R[]>
```

Async generator form of `query` — yields one page of items per iteration. Stops when DynamoDB returns no `LastEvaluatedKey`.

### `scan(data)`

```typescript
scan<R = Obj>(data: {
  table: string;
  startKey?: Obj;
  filter?: Obj;
  projection?: string[];
  limit?: number;
  index?: string;
  consistent?: boolean;
  parallel?: number;
}): Promise<R[]>
```

Exhausts all pages of a `Scan` and returns the concatenated results. If `parallel: N` is set, issues `N` concurrent segment scans and merges them.

### `scanPaged(data)`

```typescript
scanPaged<R = Obj>(data: DbScan): AsyncGenerator<R[]>
```

Async generator form of `scan`. With `parallel: N`, each yielded page contains merged results from all currently-progressing segments.

### `exists(data)`

```typescript
exists(data: {
  table: string;
  query?: Obj;
  filter?: Obj;
  index?: string;
  projection?: string[];
  consistent?: boolean;
}): Promise<boolean>
```

Returns `true` if any item matches. Dispatches to `queryPaged` when `query` is provided, `scanPaged` otherwise. When there is no `filter`, `limit: 1` is applied for efficiency; with a filter, it pages through results looking for the first match, because filters run after the query page is assembled.

### `batchGet(data)`

```typescript
batchGet(data: Record<string, {
  keys: Obj[];
  consistent?: boolean;
  projection?: string[];
  condition?: Obj;
}>): Promise<{
  items: Record<string, Obj[]>;
  unprocessed?: Record<string, { keys: Obj[]; /* options */ }>;
}>
```

Cross-table batch get. Dinah:

1. Chunks keys across all tables into batches of 100 (DynamoDB's `BatchGetItem` limit).
2. Sends `BatchGetCommand`s and collects results.
3. Re-queues any `UnprocessedKeys` with a progressively smaller batch size, up to 5 retry rounds.
4. Sorts returned items back into the original input order per table.
5. Applies any per-table `condition` client-side via `sift`. Items that fail the condition are dropped (not included in `items` or `unprocessed`).
6. Returns any still-unprocessed keys after the final retry round on `unprocessed`.

### `batchGetOrThrow(data)`

```typescript
batchGetOrThrow(data: DbBatchGet): Promise<Record<string, Obj[]>>
```

Same as `batchGet`, but throws if any table has unprocessed keys or fewer returned items than requested keys.

### `batchWrite(data)`

```typescript
batchWrite(data: Record<string, Array<
  | { type: "PUT"; item: Obj }
  | { type: "DELETE"; key: Obj }
>>): Promise<{
  items: Record<string, Obj[]>;
  unprocessed?: Record<string, Array<{ type: "PUT"; item: Obj } | { type: "DELETE"; key: Obj }>>;
}>
```

Cross-table batch write (put + delete). Dinah:

1. Chunks requests across all tables into batches of 25 (DynamoDB's `BatchWriteItem` limit).
2. Sends `BatchWriteCommand`s.
3. Re-queues `UnprocessedItems` with a shrinking batch size, up to 5 retry rounds.
4. Returns any still-unprocessed requests on `unprocessed`.

`BatchWriteItem` does not support condition expressions — use `trxWrite` if you need them.

### `trxGet(...requests)`

```typescript
trxGet<R extends DbTrxGetRequest[]>(...requests: R): Promise<DbTrxGetResult<R>>
```

Sends a `TransactGetItems` with up to 100 requests. Each request is:

```typescript
{ table: string; key: Obj; projection?: string[]; condition?: Obj }
```

Returns a tuple-typed array where each slot corresponds to a request. An item that fails its client-side `condition` (via `sift`) becomes `undefined` in the returned tuple.

### `trxGetOrThrow(...requests)`

```typescript
trxGetOrThrow<R extends DbTrxGetRequest[]>(...requests: R): Promise<DbTrxGetOrThrowResult<R>>
```

Same as `trxGet`, but throws if any response slot is `undefined`.

### `trxWrite(...requests)`

```typescript
trxWrite(...requests: DbTrxWriteRequest[]): Promise<void>
```

Sends a `TransactWriteItems` with up to 100 operations. Each request is a discriminated union:

```typescript
| { table; type: "PUT"; item; condition? }
| { table; type: "UPDATE"; key; update; condition? }
| { table; type: "DELETE"; key; condition? }
| { table; type: "CONDITION"; key; condition }
```

`CONDITION` translates to DynamoDB's `ConditionCheck`, which asserts a predicate without modifying anything — useful for enforcing cross-item invariants inside a transaction.

The entire transaction succeeds or fails atomically. If any condition check fails, DynamoDB throws a `TransactionCanceledException` with per-operation cancellation reasons.
