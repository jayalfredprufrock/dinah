---
title: Subclassing Repos
description: Customizing Repos with defaults, transforms, computed fields, and domain methods.
sidebar:
  order: 7
---

`db.makeRepo(table)` returns a plain `Repo` and is enough for most cases. To attach
extra behavior — default values, input/output transforms, computed fields, and
domain-specific methods — extend the class returned by the standalone `makeRepo(table, config)`.

## The base class

`makeRepo(table, config?)` returns a class that already extends `Repo<typeof table>`.
Extend it and add your own members:

```typescript
import { makeRepo } from "dinah";

class PostRepo extends makeRepo(PostTable) {}

const postRepo = new PostRepo(db);
```

All of the methods documented in the [`Repo` reference](/reference/repo/) are available on the subclass, and their return types follow the schema of your `table`.

The optional second argument is a `RepoConfig` object; the sections below cover each field.

## Default values on write

`defaultCreateData` supplies values merged into every `create` / `trxCreate`:

```typescript
class PostRepo extends makeRepo(PostTable, {
  defaultCreateData: () => ({ createdAt: Date.now(), status: "draft" as const }),
}) {}
```

Defaults are merged **under** the item being written — the caller's values win on conflict — and any key covered by a default becomes optional at the call site.

`defaultUpdateData` does the same for every `update` / `batchUpdate` / `trxUpdate`:

```typescript
class PostRepo extends makeRepo(PostTable, {
  defaultUpdateData: () => ({ updatedAt: Date.now() }),
}) {}
```

> Each function runs on every call, so time-based defaults like `Date.now()` are re-evaluated per operation.
>
> `put` (and `batchWrite` puts / `trxPut`) is a raw upsert and does **not** apply these defaults or the input transforms below — use `create` when you want them.

## Input transforms with `transformAttributes`

`transformAttributes` is a per-field map of normalizers applied to write inputs on `create` and `update`:

```typescript
class UserRepo extends makeRepo(UserTable, {
  transformAttributes: {
    email: (email) => email.toLowerCase(),
  },
}) {}
```

Each function receives the field's value and returns the value to store.

## Computed fields with `computedAttributes`

`computedAttributes` declaratively derives a field from one or more other fields. It is
recomputed on `create` / `update`, and the computed field **cannot be set directly** by
the caller (doing so throws a `VALIDATION` `DinahError`):

```typescript
class UserRepo extends makeRepo(UserTable, {
  computedAttributes: {
    // derived from a single field
    emailDomain: { from: "email", compute: (email) => email?.split("@")[1] },
    // derived from multiple fields
    displayName: { from: ["name", "email"], compute: (name, email) => name || email },
  },
}) {}
```

The `from` field(s) and `compute` parameter/return types are checked against the schema.

## Output shape with `transformOutput`

`transformOutput` maps the stored item to your desired return type on every non-projected
read. Its return type flows through every full-item read:

```typescript
type Post = Static<typeof PostSchema>;

class PostRepo extends makeRepo(PostTable, {
  transformOutput: (post): Post & { url: string } => ({
    ...post,
    url: `/posts/${post.postId}`,
  }),
}) {}
```

```typescript
const p = await postRepo.get({ postId: "p1" });
// p is typed as (Post & { url: string }) | undefined
p?.url; // OK
```

### When `transformOutput` is skipped

`transformOutput` is **not** applied when:

- A `projection` option is passed — the result is narrowed to the picked fields.
- A GSI with a `KEYS_ONLY` projection is queried.
- A GSI with an `INCLUDE` (array) projection is queried.

This is intentional: Dinah cannot guarantee the transform's input fields are present in those narrowed results.

## Immutable attributes

`immutableAttributes` lists fields that may be set on create but must not be changed by
updates (attempting to update one throws a `VALIDATION` `DinahError`):

```typescript
class PostRepo extends makeRepo(PostTable, {
  immutableAttributes: ["createdAt"],
}) {}
```

`immutableAttributes` and `computedAttributes` keys are inferred as literal types — no `as const` needed.

## Domain methods

The most natural reason to subclass is to expose method names that match your domain. Base methods called via `this` keep full type safety, including GSI-name autocomplete and query-argument validation:

```typescript
class PostRepo extends makeRepo(PostTable) {
  async findByAuthor(authorId: string) {
    return this.queryGsi("byAuthor", { authorId });
  }

  async findRecentByStatus(status: "draft" | "published", since: number) {
    return this.queryGsi("byStatus", {
      status,
      publishedAt: { $gte: since },
    });
  }

  async archive(postId: string) {
    return this.update({ postId }, { status: "archived" });
  }
}
```

## Overriding base methods

Adding a new domain method (above) is the common case and always keeps full type
safety. **Overriding** a base method is also supported, but the signature you write
depends on whether the method is generic.

Non-generic methods (`delete`, `deleteOrThrow`, `put`, `exists`, `batchWrite`,
`trxWrite`, `trxDelete`, ...) override with a plain `this`-based signature:

```typescript
class PostRepo extends makeRepo(PostTable) {
  override async delete(key: RepoKey<this>) {
    // custom logic here
    return super.delete(key);
  }
}
```

The generic read/write methods (`get`, `getOrThrow`, `query`, `queryGsi`, `scan`,
`batchGet`, `trxGet`, ...) are a special case. Their signatures are written against
an internal _self-type_ so that calls like `this.queryGsi(...)` stay fully typed
inside a subclass method body. A subclass can't name that self-type through `this`,
so use the **`$self` phantom** on the base repo type to write a matching signature:

```typescript
import { makeRepo, Repo } from "dinah";
import type { RepoKey, RepoGetOptions, RepoGetResult } from "dinah";

type Self = Repo<typeof PostTable>["$self"];

class PostRepo extends makeRepo(PostTable) {
  override async get<const O extends RepoGetOptions<Self>>(
    key: RepoKey<Self>,
    options?: O,
  ): Promise<RepoGetResult<Self, O>> {
    // custom logic here
    return super.get(key, options);
  }
}
```

Callers of the override still get precise per-call types (projections, filters, and
so on). If you don't need to change the signature, prefer wrapping the base method in
a new domain method (see [Domain methods](#domain-methods)) rather than overriding —
it's simpler and needs no `$self` annotation.

## Sharing a `db` across repos

Each subclass takes the `Db` instance at construction, so you can share one `db` across many repos:

```typescript
const postRepo = new PostRepo(db);
const userRepo = new UserRepo(db);
```

## Putting it all together

```typescript
type Post = Static<typeof PostSchema>;

class PostRepo extends makeRepo(PostTable, {
  defaultCreateData: () => ({ createdAt: Date.now(), status: "draft" as const }),
  defaultUpdateData: () => ({ updatedAt: Date.now() }),
  transformOutput: (post): Post & { url: string } => ({ ...post, url: `/posts/${post.postId}` }),
  immutableAttributes: ["createdAt"],
}) {
  async findByAuthor(authorId: string) {
    return this.queryGsi("byAuthor", { authorId });
  }

  async publish(postId: string) {
    return this.update(
      { postId },
      { status: "published", publishedAt: Date.now() },
      { condition: { status: "draft" } },
    );
  }
}

const postRepo = new PostRepo(db);

await postRepo.create({
  postId: "p1",
  authorId: "u1",
  title: "Hello",
  body: "...",
  tags: [],
  // createdAt and status are optional at the call site because of defaults
});

const posts = await postRepo.findByAuthor("u1");
// each post has the computed `url` property
```
