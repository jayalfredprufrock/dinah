---
title: Batch & Transactions
description: Batch operations, transactions, and the trade-offs between them.
sidebar:
  order: 6
---

DynamoDB supports two distinct mechanisms for grouping multiple operations:

- **Batch** — multiple reads or writes that succeed or fail independently. DynamoDB may return some as "unprocessed" under load, and batch writes are not atomic.
- **Transaction** — up to 100 operations that all succeed or all fail atomically, with ACID guarantees and roughly 2× the write cost.

Dinah provides typed wrappers for both, on the single-table `Repo` and the multi-table `Db`.

## Batch reads

### `repo.batchGet`

Fetch multiple items by primary key from a single table:

```typescript
const { items, unprocessed } = await userRepo.batchGet([
  { userId: "u1" },
  { userId: "u2" },
  { userId: "u3" },
]);

if (unprocessed?.length) {
  // DynamoDB returned some keys as unprocessed after Dinah's internal retries;
  // you may want to retry them later
}
```

Dinah automatically chunks keys into 100-item batches (DynamoDB's `BatchGetItem` limit), retries unprocessed keys with exponential backoff, and returns any still-unprocessed keys on the `unprocessed` field. See [Throttling & throughput](#throttling--throughput) for how the retry loop behaves and how to tune it.

Results are returned in the **same order** as the input keys — Dinah rebuilds the order using a composite-key lookup so you can index `items[i]` against the corresponding input key.

`batchGetOrThrow` throws if any item was missing or unprocessed.

### `db.batchGet`

Cross-table `batchGet` goes through `Db`:

```typescript
const { items } = await db.batchGet({
  users: { keys: [{ userId: "u1" }, { userId: "u2" }] },
  posts: { keys: [{ postId: "p1" }] },
});

items.users; // Obj[]
items.posts; // Obj[]
```

### Duplicate keys

DynamoDB rejects any batch containing two operations on one item. Dinah handles that up front, but not identically across the three methods, because collapsing a repeat isn't equally safe:

| method                             | behavior                                      |
| ---------------------------------- | --------------------------------------------- |
| `batchGet` / `batchGetOrThrow`     | **deduplicated** — first occurrence wins      |
| `batchWrite` / `batchWriteOrThrow` | **rejected** with a `VALIDATION` `DinahError` |
| `batchUpdate`                      | **rejected** with a `VALIDATION` `DinahError` |

A repeated _read_ carries no information — the same key returns the same item — so dropping it is lossless and `batchGet` just does it. Keys gathered from a list of foreign references routinely repeat, and there's no reason to make that the caller's problem. Results stay ordered by each key's first occurrence, and `batchGetOrThrow` compares against _distinct_ keys requested.

A repeated _write_ is different. A PUT and a DELETE for the same key have no meaningful merge, and honouring "last write wins" would require ordered chunks, which [`parallel`](#should-you-raise-parallel) explicitly gives up — so deduplicating would advertise semantics Dinah can't guarantee. For `batchUpdate` the expression need not be idempotent (`{ count: { $plus: 1 } }` twice is not the same as once). In both cases the caller keeps the choice of which request should win.

The alternative was worse than either: because batches are chunked, an unchecked duplicate was position-dependent. Repeats inside a single chunk raised a raw `ValidationException`, while repeats straddling a chunk boundary quietly both applied — and on a `batchGet`, silently returned the item twice.

Note that duplicate detection for `batchWrite` lives on `Repo`, which knows the table's key schema. `db.batchWrite` receives raw PUT items and can't tell which attributes form the key, so a cross-table `db.batchWrite` still surfaces DynamoDB's own `ValidationException`. `db.batchGet` and `db.batchUpdate` take explicit keys, so both behave as above.

`trxWrite` is unaffected by any of this — DynamoDB rejects duplicate items in a transaction outright ("Transaction request cannot include multiple operations on one item"), and Dinah passes that through.

### Client-side filters

Both `db.batchGet` and `repo.batchGet` accept an optional `filter` option. Because DynamoDB itself doesn't support filter expressions on `BatchGetItem`, Dinah applies the filter **client-side** as a partial match. Items that fail the filter are silently dropped — they appear neither in `items` nor in `unprocessed`.

## Batch writes

### `repo.batchWrite`

Mix puts and deletes for a single table:

```typescript
await userRepo.batchWrite([
  { type: "PUT", item: { userId: "u4" /* … */ } },
  { type: "PUT", item: { userId: "u5" /* … */ } },
  { type: "DELETE", key: { userId: "u3" } },
]);
```

Dinah chunks into 25-item batches (the `BatchWriteItem` limit), retries unprocessed items with exponential backoff, and returns any still-unprocessed requests on the `unprocessed` field.

**`unprocessed` is easy to ignore, and ignoring it means silently losing writes.** For bulk or operator-run jobs, prefer `batchWriteOrThrow`, which raises a `BATCH_UNPROCESSED` `DinahError` instead:

```typescript
await userRepo.batchWriteOrThrow([{ type: "PUT", item: { userId: "u4" /* … */ } }]);
```

### `db.batchWrite`

The `Db` form works across multiple tables at once:

```typescript
await db.batchWrite({
  users: [{ type: "PUT", item: { userId: "u4" } }],
  posts: [{ type: "DELETE", key: { postId: "p99" } }],
});
```

### Limitations

DynamoDB's `BatchWriteItem` **does not** support condition expressions or atomic multi-item updates. If you need either, use a transaction instead.

## Batch updates

`batchUpdate` applies the same update expression to many keys using PartiQL's `BatchExecuteStatement`. Unlike the other batch APIs, it reports failures _per statement_ rather than as a single request error, so Dinah classifies them:

- **Transient** (`ProvisionedThroughputExceeded`, `RequestLimitExceeded`, `ThrottlingError`, `TransactionConflict`, `InternalServerError`) — retried with backoff like any other batch, and returned on `unprocessed` if they never succeed.
- **Permanent** (`ValidationError`, `ConditionalCheckFailed`, `ResourceNotFound`, `DuplicateItem`, `AccessDenied`, `ItemCollectionSizeLimitExceeded`) — not retried. These throw a `BATCH_FAILED` `DinahError` carrying the offending table, key, and error code, since retrying them only burns the retry budget that real throttling needs.

## Throttling & throughput

When DynamoDB throttles a batch _as a whole_, the AWS SDK already retries it with jittered exponential backoff and Dinah never sees it. But when only _some_ items in a batch are throttled, DynamoDB returns **HTTP 200** with the leftovers in `UnprocessedItems` / `UnprocessedKeys` — a success as far as the SDK is concerned. Handling that is the caller's job, and it's what Dinah's batch loop exists to do.

Work is drained in _passes_. Within a pass each chunk is sent exactly once, up to `parallel` requests in flight; anything the service hands back is held until the pass ends, so a retry always costs a backoff delay rather than an immediate re-send.

Termination is based on **progress, not attempts**. A pass that accepts even one item resets the stall counter, so a large job under steady mild throttling runs to completion rather than being abandoned. Only passes that accept _nothing_ count against `maxAttempts`.

Chunk size stays constant. Shrinking batches doesn't reduce the capacity consumed — the same items still land on the same partitions — so backoff, not a smaller batch, is the control for throttling.

### Very large items

One caveat applies to `batchWrite` with items large enough that the table accepts fewer than 25 per call — above roughly 160KB, given typical per-request capacity. The rejected remainder is re-uploaded on the next pass, so a write of 400KB items moves about 2.5× the payload it needs to (5× on a tightly capped table). Round-trip count is unaffected: how many items land per call is set by the table's capacity, not by the chunk size, and the waste is bandwidth rather than billed capacity.

Items in the ordinary range are unaffected — at 4KB or 100KB the overhead is exactly zero, because a full chunk fits within what the table will accept.

If you _are_ writing near-maximum-size items in bulk, set `chunkSize` to the number the table actually accepts per call and the waste goes away:

```typescript
// ~400KB items: send what the table will take, so nothing is re-uploaded
await repo.batchWrite(requests, { chunkSize: 10 });
```

This costs no extra round trips, because how many items land per call is set by the table's capacity rather than by the chunk size. Setting it _below_ what the table accepts does cost round trips, so tune it from observed behaviour rather than guessing low. This is left to the caller instead of adapting automatically: a value chosen by someone who knows the item size beats a heuristic inferring it from unprocessed counts, and it keeps chunk sizing free of the retry state whose entanglement caused the earlier permanent-degradation bug.

`batchGet` has no equivalent problem, so there's nothing to tune there. Responses are capped at 16MB, so a chunk of 100 large keys comes back truncated with the remainder in `UnprocessedKeys` — but each response returns the maximum that fits, which makes the round-trip count optimal already. Lowering `chunkSize` on a get can only add round trips.

All three batch methods accept the same options:

```typescript
await userRepo.batchWrite(requests, {
  parallel: 5, // requests in flight (default 1)
  maxAttempts: 10, // consecutive zero-progress passes before giving up (default 10)
  chunkSize: 25, // items per request (default & max 25 here, 100 for batchGet)
});
```

### Should you raise `parallel`?

**Batches are serial by default, and that's deliberate.** Parallelism is a large win for a single-process bulk job — writing 20,000 items to a local table goes from 5.2s to 1.4s at `parallel: 5` — but only when nothing above you is already running batches concurrently.

Raise it when **your process is the only writer**: an operator CLI doing a table copy, truncate, migration, or seed. (`Seed.put` already defaults to `parallel: 5` for exactly this reason.)

Leave it at 1 when **something above you already provides concurrency**. A Lambda consuming a DynamoDB stream or SQS queue is already running many invocations against the same table; having each one fan out multiplies the request rate against that table without adding throughput the platform wasn't already giving you. The same applies to any request-path write under a load balancer.

`batchGet` defaults to 1 for the same reason, but the calculus is gentler: an eventually-consistent read costs 0.5 RCU per 4KB against 1 WCU per 1KB for a write, so it's roughly 8× cheaper per byte to overshoot on, and a throttled read has no partial-visibility consequences. If a `batchGet` of several hundred keys sits on a latency-critical path, raising it is a reasonable trade.

Then:

- **It only takes effect above one chunk of work** (25 items for writes/updates, 100 keys for gets), so small batches are unaffected either way.
- **Key distribution limits the benefit.** Parallel writes help when keys spread across partitions. Sequential or timestamp-prefixed keys concentrate on one partition, where extra concurrency just produces more throttling.
- **On-demand tables have a warm-up ceiling** — they scale to roughly 2× their previous peak, so a cold table will throttle a large burst no matter how well-behaved the client is. Backoff absorbs this; concurrency cannot beat it.
- **The AWS SDK defaults to 50 max sockets per client**, so values beyond that queue in the HTTP agent instead of adding real parallelism unless you configure the HTTP handler.
- **Concurrency doesn't change WCU/RCU consumed** — the same items are written either way. Only wall-clock changes.

### Deadlines

With the defaults, a batch whose table accepts _nothing_ retries for up to ~45s (typically ~23s) before returning `unprocessed`. That suits a CLI job, but it outlasts a short Lambda timeout — and a function killed mid-retry loses the `unprocessed` result entirely, which is worse than being told about it. Lower `maxAttempts` when your caller has a tighter deadline.

## Transactions

A transaction bundles up to 100 `Put` / `Update` / `Delete` / `ConditionCheck` operations into a single atomic request. Every operation must succeed, or DynamoDB rolls back all of them.

### `repo.trxWrite`

Pass tagged request objects to `trxWrite`. Each request is typed against the Repo's schema:

```typescript
await userRepo.trxWrite(
  { type: "PUT", item: { userId: "u5", email: "eve@example.com" /* … */ } },
  { type: "UPDATE", key: { userId: "u1" }, update: { role: "superadmin" } },
  { type: "DELETE", key: { userId: "u2" } },
  { type: "CONDITION", key: { userId: "u3" }, condition: { banned: true } },
);
```

### Convenience helpers

The Repo also provides bulk helpers when every operation in the transaction is of the same kind:

```typescript
await userRepo.trxPut([item1, item2, item3]);
await userRepo.trxUpdate([{ userId: "u1" }, { userId: "u2" }], { role: "admin" });
await userRepo.trxDelete([{ userId: "u1" }, { userId: "u2" }]);
await userRepo.trxCreate([item1, item2]); // adds the "does not exist" condition
```

### Cross-table transactions

For transactions spanning multiple tables, use per-Repo `trx*Request` builders and pass them to `db.trxWrite`:

```typescript
await db.trxWrite(
  userRepo.trxUpdateRequest({ userId: "u1" }, { role: "admin" }),
  postRepo.trxPutRequest({ postId: "p1", authorId: "u1" /* … */ }),
  auditRepo.trxPutRequest({ eventId: "e1", type: "role-changed" }),
);
```

Each `trx*Request` method returns a `DbTrxWriteRequest` object — a discriminated union that `db.trxWrite` accepts directly.

### Transactional reads

`trxGet` fetches up to 100 items atomically. Use it when you need a consistent snapshot of several related items:

```typescript
const [user, post] = await userRepo.trxGet([
  { userId: "u1" },
  // you can mix repos by going through db.trxGet with trxGetRequest
]);
```

For cross-table transactional reads, use `db.trxGet` with per-Repo `trxGetRequest` builders:

```typescript
const [user, post] = await db.trxGet(
  userRepo.trxGetRequest({ userId: "u1" }),
  postRepo.trxGetRequest({ postId: "p1" }),
);
```

`trxGetOrThrow` throws if any of the requested items was missing.

## When to use which

| Scenario                                             | Use                                                 |
| ---------------------------------------------------- | --------------------------------------------------- |
| Independent writes, best-effort, at-most-25 per call | `batchWrite`                                        |
| Independent reads, best-effort, at-most-100 per call | `batchGet`                                          |
| All-or-nothing writes, or cross-item conditions      | `trxWrite`                                          |
| Consistent multi-item read snapshot                  | `trxGet`                                            |
| Large collections (thousands of items)               | Paginated `query` / `scan`, or chunked `batchWrite` |
