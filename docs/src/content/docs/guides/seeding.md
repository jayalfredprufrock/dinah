---
title: Seeding
description: Define deterministic fixture data for a table and write it in a batch.
sidebar:
  order: 9
---

`dinah/seed` is an optional subpath (with **zero runtime dependencies**) for defining fixture data and loading it into a table. It is intentionally small: you supply the items, typed against the table's schema, and call `.put(db)`.

```typescript
import { createSeed } from "dinah/seed";
```

## Curated items

Pass an array of items. Each item is typed as the full static type of the table's schema:

```typescript
const users = createSeed(UserTable, [
  { userId: "u1", email: "alice@example.com", name: "Alice", role: "admin", createdAt: 0 },
  { userId: "u2", email: "bob@example.com", name: "Bob", role: "user", createdAt: 0 },
]);

await users.put(db);
```

`.put(db)` writes every item to the table via a batched `PUT` (`db.makeRepo(table).batchWrite(...)`), which overwrites by primary key and is chunked and retried under the hood. Because it is a raw `PUT`, seed items must be complete — repo-config defaults, `transformAttributes`, and `computedAttributes` are **not** applied (see [Subclassing Repos](/guides/subclassing-repos/)).

## The `.items` getter

`.items` exposes the resolved items. It is generated once on first access and memoized, so repeated reads — including references from other seeds — are cheap and consistent:

```typescript
const [alice] = users.items;
alice.userId; // "u1"
```

## Relationships between seeds

A seed's `.items` is just a value, so reference another seed directly — no dependency declarations needed. An already-defined seed resolves eagerly, so a plain array is enough:

```typescript
const posts = createSeed(PostTable, [
  { postId: "p1", authorId: users.items[0].userId, title: "Hello" },
  { postId: "p2", authorId: users.items[1].userId, title: "World" },
]);

await users.put(db);
await posts.put(db);
```

Reach for a **thunk** (`() => Item[]`) only when the reference can't be resolved at definition time — forward or mutual references, where the other seed is declared later. The thunk defers evaluation until `.items` (or `.put`) is called, by which point every seed exists; an eager array reference to a not-yet-declared seed throws `Cannot access '…' before initialization`. Either way, consistency falls out of `.items` being memoized — every reader sees the same resolved items.

Write order does not affect referential correctness — DynamoDB has no foreign keys, so a reference is only dangling if you forget to `put` the seed it points at. Just make sure every referenced seed is written.

### Cycle detection

If two seeds reference each other (or a seed references itself), accessing `.items` throws a clear error instead of overflowing the stack:

```typescript
// createSeed(A, () => [{ ref: B.items[0]... }])
// createSeed(B, () => [{ ref: A.items[0]... }])
// A.items  ->  Error: Circular seed reference detected: a → b → a
```

## Determinism

Curated seeds are deterministic by construction — the items are exactly what you wrote. Support for large, randomly generated lists (a seeded PRNG with generator helpers) is planned as a follow-up and will build on this same `createSeed` / `.items` / `.put` surface.
