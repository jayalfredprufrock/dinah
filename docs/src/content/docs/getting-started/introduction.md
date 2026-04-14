---
title: Introduction
description: What Dinah is and why it exists.
sidebar:
  order: 1
---

Dinah is a type-safe DynamoDB client for TypeScript. It wraps the AWS SDK v3 `DynamoDBDocumentClient` with a thin, expressive API that leans on [typebox](https://github.com/sinclairzx81/typebox) schemas as the single source of truth for your table's shape.

It is closer to a **query builder** than an ORM, and it does not encourage single-table design. You define each table's schema and keys explicitly, then either use the low-level `Db` class to talk to any table by name, or create a `Repo` per table for fully-inferred reads and writes.

## What you get

- **Type-safe reads and writes.** `get`, `query`, `scan`, `put`, `update`, `delete`, batch operations, and transactions all return types derived from your schema and table definition.
- **Projection-aware return types.** Passing `projection: ["name", "email"]` narrows the return type to exactly those fields. GSI projections (`KEYS_ONLY`, `INCLUDE`, `ALL`) flow through the types, so you never pretend the result has attributes DynamoDB didn't return.
- **GSI inference.** `queryGsi` knows which partition/sort keys each GSI accepts, which attributes come back, and what shape a valid `startKey` must have.
- **MongoDB-like query syntax.** Operators like `$gt`, `$between`, `$prefix`, `$exists`, `$in`, `$includes`, and a set of update operators (`$plus`, `$append`, `$setAdd`, `$ifNotExists`, …) compile to DynamoDB expressions under the hood.
- **Batch & transaction support.** `batchGet` / `batchWrite` automatically chunk and retry unprocessed requests. `trxGet` / `trxWrite` support mixed put / update / delete / condition checks.
- **Pagination.** Every paginating read has an async iterator twin (`queryPaged`, `scanPaged`, `queryGsiPaged`, `scanGsiPaged`).
- **Repos you can extend.** Subclass `AbstractRepo` to add computed fields via `transformItem`, attach default values via `defaultPutData` / `defaultUpdateData`, or expose custom methods on a typed repo.

## What Dinah is not

- **Not an ORM.** There are no relations, no change tracking, no unit-of-work. A Repo is a thin, typed wrapper around a single table.
- **Not opinionated about single-table design.** You can use it that way if you want, but nothing steers you toward it.
- **Not a validation layer (yet).** Dinah uses the typebox schema for types only — runtime validation is on the roadmap. See [Validation](/guides/validation/).

## When to use it

Use Dinah when you want static types for your DynamoDB access code without giving up direct control over the underlying API calls. It stays out of your way at runtime — every method compiles down to one or more `DynamoDBDocumentClient` commands — but gives you the type-level guarantees of a schema-driven client.
