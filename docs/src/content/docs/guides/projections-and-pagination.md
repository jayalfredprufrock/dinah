---
title: Projections & Pagination
description: Narrowing return types with projection and iterating over pages.
sidebar:
  order: 5
---

## Projections

Every read method on a `Repo` accepts an optional `projection: string[]` — an array of attribute names that DynamoDB should return. Dinah reflects this in the return type so you never access fields that weren't fetched.

```typescript
// Full item: Post | undefined
const full = await postRepo.get({ postId: "p1" });

// Pick<Post, 'postId' | 'title'> | undefined
const narrow = await postRepo.get(
  { postId: "p1" },
  { projection: ["postId", "title"] },
);

narrow?.title;   // OK
narrow?.body;    // type error: Property 'body' does not exist
```

Projections work across `get`, `getOrThrow`, `query`, `queryPaged`, `scan`, `scanPaged`, `queryGsi`, `scanGsi`, `batchGet`, `batchGetOrThrow`, `trxGet`, and `trxGetOrThrow`.

### Projections and `transformItem`

If your Repo subclass overrides `transformItem` to add computed fields, projected reads **skip** the transform — Dinah has no guarantee that the transform's input fields are present. The narrowed return type reflects the raw `Pick<Schema, ...>` in that case, not the transformed shape.

### GSI projections

GSIs have their own projection setting (`ALL`, `KEYS_ONLY`, or `INCLUDE`) that determines which attributes DynamoDB will return *regardless* of what you request. Dinah combines this with your explicit `projection`:

- **`ALL`** (default) — the full item type flows through. A `projection` option narrows further.
- **`KEYS_ONLY`** — the return type is `Pick<Schema, TableKeys | GsiKeys>` and `transformItem` is skipped.
- **`INCLUDE`** (an array) — the return type is `Pick<Schema, TableKeys | GsiKeys | IncludedAttrs>` and `transformItem` is skipped.

See [Defining Tables → GSIs](/guides/defining-tables/#projection-types) for examples.

## Pagination

DynamoDB paginates query and scan results. Every Dinah read method that could span multiple pages has **two forms**:

- `query(...)` / `scan(...)` / `queryGsi(...)` / `scanGsi(...)` — these exhaust every page internally and return a single array.
- `queryPaged(...)` / `scanPaged(...)` / `queryGsiPaged(...)` / `scanGsiPaged(...)` — these return an `AsyncGenerator` that yields one page at a time.

### Exhaustive form

```typescript
const allAdmins = await userRepo.queryGsi("byRole", { role: "admin" });
```

Use this when you're confident the result set is small enough to fit in memory, or when you genuinely need every result.

### Paged form

```typescript
for await (const page of userRepo.queryGsiPaged("byRole", { role: "admin" })) {
  // page is an array: one page from DynamoDB
  await processBatch(page);
}
```

The generator automatically follows `LastEvaluatedKey` across pages. When the last page comes back without a `LastEvaluatedKey`, the generator ends.

### Limits

Every query and scan accepts `limit`. The paged form enforces it per page; the exhaustive form enforces it per underlying `QueryCommand` call, which may effectively cap the total items returned depending on how DynamoDB batches your request.

### Resuming later

For true resumable pagination across process boundaries, grab the last returned item's key attributes and pass them as `startKey` on the next call:

```typescript
const firstPage = await userRepo.queryGsi(
  "byRole",
  { role: "admin" },
  { limit: 50 },
);

const last = firstPage.at(-1);

if (last) {
  const nextPage = await userRepo.queryGsi(
    "byRole",
    { role: "admin" },
    {
      limit: 50,
      startKey: {
        userId: last.userId,     // table PK
        role: last.role,         // GSI PK
        createdAt: last.createdAt, // GSI SK
      },
    },
  );
}
```

The `startKey` type on `queryGsi` / `scanGsi` is inferred to require exactly the attributes DynamoDB needs — the table's primary key plus the GSI's key(s). Missing any of them is a type error.

### Parallel scans

`scan`, `scanPaged`, `scanGsi`, and `scanGsiPaged` accept `parallel: N` to issue `N` concurrent segment scans. The paged form merges all segments' results into its yielded pages.

```typescript
const everything = await userRepo.scan({ parallel: 4 });
```
