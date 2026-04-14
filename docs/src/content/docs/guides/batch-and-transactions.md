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

Dinah automatically chunks keys into 100-item batches (DynamoDB's `BatchGetItem` limit), retries unprocessed items with a shrinking batch size for up to 5 rounds, and returns any still-unprocessed keys on the `unprocessed` field.

Results are returned in the **same order** as the input keys — Dinah rebuilds the order using a composite-key lookup so you can index `items[i]` against the corresponding input key.

`batchGetOrThrow` throws if any item was missing or unprocessed.

### `db.batchGet`

Cross-table `batchGet` goes through `Db`:

```typescript
const { items } = await db.batchGet({
  users: { keys: [{ userId: "u1" }, { userId: "u2" }] },
  posts: { keys: [{ postId: "p1" }] },
});

items.users;  // Obj[]
items.posts;  // Obj[]
```

### Client-side conditions

Both `db.batchGet` and `repo.batchGet` accept an optional `condition` option. Because DynamoDB itself doesn't support conditional expressions on `BatchGetItem`, Dinah applies the condition **client-side** using [`sift`](https://github.com/crcn/sift.js). Items that fail the condition are silently dropped — they appear neither in `items` nor in `unprocessed`.

## Batch writes

### `repo.batchWrite`

Mix puts and deletes for a single table:

```typescript
await userRepo.batchWrite([
  { type: "PUT", item: { userId: "u4", /* … */ } },
  { type: "PUT", item: { userId: "u5", /* … */ } },
  { type: "DELETE", key: { userId: "u3" } },
]);
```

Dinah chunks into 25-item batches (the `BatchWriteItem` limit), retries unprocessed items with a shrinking batch size for up to 5 rounds, and returns any still-unprocessed requests in the response.

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

## Transactions

A transaction bundles up to 100 `Put` / `Update` / `Delete` / `ConditionCheck` operations into a single atomic request. Every operation must succeed, or DynamoDB rolls back all of them.

### `repo.trxWrite`

Pass tagged request objects to `trxWrite`. Each request is typed against the Repo's schema:

```typescript
await userRepo.trxWrite(
  { type: "PUT", item: { userId: "u5", email: "eve@example.com", /* … */ } },
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
  postRepo.trxPutRequest({ postId: "p1", authorId: "u1", /* … */ }),
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

| Scenario | Use |
| --- | --- |
| Independent writes, best-effort, at-most-25 per call | `batchWrite` |
| Independent reads, best-effort, at-most-100 per call | `batchGet` |
| All-or-nothing writes, or cross-item conditions | `trxWrite` |
| Consistent multi-item read snapshot | `trxGet` |
| Large collections (thousands of items) | Paginated `query` / `scan`, or chunked `batchWrite` |
