---
title: Update Operators
description: Expressing DynamoDB update expressions with $ operators.
sidebar:
  order: 4
---

The `update` argument to `repo.update(key, update)` and `db.update({ update })` is an object whose keys are attribute paths and whose values are either:

- A primitive (sets the attribute to that value),
- `undefined` (removes the attribute),
- Or an object containing `$` operators that express more complex updates.

## Setting values

The simplest case is a plain object of values:

```typescript
await repo.update({ postId: "p1" }, { title: "New title", updatedAt: Date.now() });
```

This compiles to:

```
SET #0 = :0, #1 = :1
```

## Removing attributes

Set a field to `undefined`, or use `$remove`:

```typescript
await repo.update({ postId: "p1" }, { draftNote: undefined });
await repo.update({ postId: "p1" }, { draftNote: { $remove: true } });
```

Both produce `REMOVE #0`.

## Arithmetic: `$plus` and `$minus`

```typescript
// viewCount = viewCount + 1
{
  viewCount: {
    $plus: 1;
  }
}

// score = score - 10
{
  score: {
    $minus: 10;
  }
}
```

You can pass an explicit two-operand form to do arithmetic between arbitrary operands:

```typescript
// total = subtotal + tax
{
  total: {
    $plus: [{ $path: "subtotal" }, { $path: "tax" }];
  }
}
```

## Setting only if missing: `$ifNotExists`

```typescript
// createdAt = if_not_exists(createdAt, :now)
{
  createdAt: {
    $ifNotExists: Date.now();
  }
}
```

Pass a tuple to reference a different attribute:

```typescript
// createdAt = if_not_exists(firstSeenAt, :now)
{
  createdAt: {
    $ifNotExists: ["firstSeenAt", Date.now()];
  }
}
```

## Explicit `$set`

The plain-value form is already a `SET`, but you can use `$set` explicitly when composing operators:

```typescript
{
  title: {
    $set: "New title";
  }
}
```

## Literal values: `$literal`

An object whose keys all start with `$` is read as an operator. To write one as a value, wrap it in `$literal`:

```typescript
// meta = { $views: 3 }
await repo.update({ postId: "p1" }, { meta: { $literal: { $views: 3 } } });
```

`$literal` nests like `$set`, e.g. `{ $ifNotExists: { $literal: { $views: 0 } } }`. Empty objects (`{}`) are always values and need no wrapping.

## List operations: `$append` and `$prepend`

These compile to `list_append`:

```typescript
// tags = list_append(tags, :newTags)
{ tags: { $append: ["typescript", "dynamodb"] } }

// history = list_append(:entry, history)
{ history: { $prepend: { event: "viewed", at: Date.now() } } }
```

Single values are wrapped in a list automatically.

## Set operations: `$setAdd` and `$setDel`

For DynamoDB `Set` attributes (string sets, number sets, binary sets), use `$setAdd` / `$setDel`. These compile to `ADD` and `DELETE`:

```typescript
{
  tags: {
    $setAdd: "featured";
  }
} // ADD tags {"featured"}
{
  tags: {
    $setAdd: ["a", "b", "c"];
  }
} // ADD tags {"a","b","c"}
{
  tags: {
    $setDel: "obsolete";
  }
} // DELETE tags {"obsolete"}
```

Pass a JavaScript `Set` to avoid the array-wrapping step:

```typescript
{
  tags: {
    $setAdd: new Set(["a", "b"]);
  }
}
```

## Combining operators in one update

A single `update` call can mix `SET`, `REMOVE`, `ADD`, and `DELETE` clauses — Dinah groups them automatically:

```typescript
await repo.update(
  { postId: "p1" },
  {
    title: "Updated", // SET
    draftNote: undefined, // REMOVE
    viewCount: { $plus: 1 }, // SET with arithmetic
    tags: { $setAdd: "featured" }, // ADD
    archivedTags: { $setDel: "old" }, // DELETE
    updatedAt: Date.now(), // SET
  },
);
```

## Conditional updates

Every update supports a `condition` option using the same [query operators](/guides/query-operators/) as reads. The update only succeeds if the condition matches:

```typescript
// Increment only if the current value is below 100.
await repo.update(
  { postId: "p1" },
  { viewCount: { $plus: 1 } },
  { condition: { viewCount: { $lt: 100 } } },
);
```

If the condition fails, DynamoDB throws a `ConditionalCheckFailedException`. Dinah implicitly adds an `$exists: true` condition for every primary key attribute, so an `update` call on a non-existent key will also fail rather than create a new item.

## Read-modify-write: `patch` and `createOrPatch`

`repo.patch(key, patch)` reads the item, applies `patch` (an object, or a function of the stored item), and writes only the fields that changed. Fields set to `undefined` are removed; fields left out are untouched.

```typescript
await repo.patch({ blockId }, (current) => ({ content: render(current) }));
```

The write is conditioned on every written field still holding the value that was read. On a conflict, `patch` re-reads and re-runs the function, up to `maxAttempts` times (default 5), then rethrows the conflict. Since writes never include unchanged fields, concurrent writes elsewhere on the item (such as `$plus` counters) neither conflict nor get clobbered.

- If nothing changed, nothing is written and `defaultUpdateData` isn't applied.
- A patch function must be pure: it can run more than once.
- A missing item throws `NOT_FOUND`. Changing a key or immutable field throws `VALIDATION`.

`repo.createOrPatch(item, update?)` creates `item` if its key doesn't exist, otherwise patches the existing item with `update(current)`, or with `item` itself if no function is given. Fields `item` doesn't mention, like `createdAt` from `defaultCreateData`, are left alone.

**`update` or `patch`?** If you can write the change without reading first, use `update`: it's one round trip, and its operators are atomic under contention. Use `patch` when the new values depend on the stored item, or when writing a set of fields that may already match. Avoid `patch` on hot items, where contention just turns into retries.
