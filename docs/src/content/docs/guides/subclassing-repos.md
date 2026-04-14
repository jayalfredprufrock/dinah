---
title: Subclassing Repos
description: Customizing Repos with defaults, transforms, and domain methods.
sidebar:
  order: 7
---

`db.createRepo(table)` is enough for most cases, but Dinah also lets you subclass `AbstractRepo<T>` to get a typed repo with extra behavior attached. Subclassing is the way to add default values, computed fields, and domain-specific methods.

## The base class

```typescript
import { AbstractRepo } from "dinah";

class PostRepo extends AbstractRepo<typeof PostTable> {
  readonly table = PostTable;
}

const postRepo = new PostRepo(db);
```

The `readonly table = ...` assignment is required — `AbstractRepo` declares it as `abstract`.

All of the methods documented in the [`Repo` reference](/reference/repo/) are available on the subclass, and their return types follow the schema of your `table`.

## Default values on write

Override the `defaultPutData` getter to supply values merged into every `put` / `create` / `batchWrite` put / `trxPut` / `trxCreate`:

```typescript
class PostRepo extends AbstractRepo<typeof PostTable> {
  readonly table = PostTable;

  override get defaultPutData() {
    return { createdAt: Date.now() };
  }
}
```

`defaultPutData` is merged **under** the item being written — the caller's values win on conflict. The type system treats any key covered by `defaultPutData` as optional on the `put` call site.

`defaultUpdateData` does the same thing for every `update` and `trxUpdate`:

```typescript
class PostRepo extends AbstractRepo<typeof PostTable> {
  readonly table = PostTable;

  override get defaultUpdateData() {
    return { updatedAt: Date.now() };
  }
}
```

> The getter runs on every call, so time-based defaults like `Date.now()` will be re-evaluated per operation.

## Computed fields with `transformItem`

`transformItem` is called on every item returned by a non-projected read. Override it to add computed properties:

```typescript
type Post = Static<typeof PostSchema>;

class PostRepo extends AbstractRepo<typeof PostTable> {
  readonly table = PostTable;

  override transformItem(post: Post): Post & { isDraft: boolean; url: string } {
    return {
      ...post,
      isDraft: post.status === "draft",
      url: `/posts/${post.postId}`,
    };
  }
}
```

The return type of `transformItem` flows through every full-item read:

```typescript
const p = await postRepo.get({ postId: "p1" });
// p is typed as (Post & { isDraft: boolean; url: string }) | undefined
p?.isDraft; // OK
p?.url;     // OK
```

### When transforms are skipped

`transformItem` is **not** applied when:

- A `projection` option is passed — the result is narrowed to the picked fields, not the transformed shape.
- A GSI with `KEYS_ONLY` projection is queried.
- A GSI with `INCLUDE` projection is queried.

This is intentional: Dinah cannot guarantee that the transform's input fields will be present in those narrowed results.

## Domain methods

The most natural reason to subclass is to expose method names that match your domain:

```typescript
class PostRepo extends AbstractRepo<typeof PostTable> {
  readonly table = PostTable;

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

All of `this.get`, `this.query`, `this.queryGsi`, `this.update`, `this.trxPut`, `this.trxUpdateRequest`, etc. are typed against the subclass's `table`, including the GSI name autocomplete and query-argument validation shown above.

## Using a subclass through `db.createRepo`

`db.createRepo(table)` always returns a plain `Repo<T>`. If you want an instance of your subclass, construct it directly:

```typescript
const postRepo = new PostRepo(db);
```

You can still share the same `db` across multiple repos.

## Putting it all together

```typescript
type Post = Static<typeof PostSchema>;

class PostRepo extends AbstractRepo<typeof PostTable> {
  readonly table = PostTable;

  override get defaultPutData() {
    return { createdAt: Date.now(), status: "draft" as const };
  }

  override get defaultUpdateData() {
    return { updatedAt: Date.now() };
  }

  override transformItem(post: Post): Post & { url: string } {
    return { ...post, url: `/posts/${post.postId}` };
  }

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

await postRepo.put({
  postId: "p1",
  authorId: "u1",
  title: "Hello",
  body: "...",
  tags: [],
  // createdAt, status, updatedAt are optional on the call site because of defaults
});

const posts = await postRepo.findByAuthor("u1");
// each post has the computed `url` property
```
