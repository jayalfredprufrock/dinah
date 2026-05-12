<p align="center">
  <img src="dinah-logo.png" alt="dinah" width="300" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dinah"><img src="https://img.shields.io/npm/v/dinah.svg" alt="npm version" /></a>
  <a href="https://github.com/jayalfredprufrock/dinah/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/dinah.svg" alt="license" /></a>
</p>

[In my world](https://youtu.be/UD8hATR4B8s?si=HvSFmgrrxwucR91x&t=68), working with DynamoDb would be painless, safe, and fun. Dinah provides a type-safe, expressive API for interacting with DynamoDB, featuring schema-driven table definitions, a repository pattern with full type inference, MongoDB-like query syntax, and first-class support for batch operations, transactions, pagination, and GSIs. It is closer to a query builder than an ORM, and doesn't encourage single-table design. Nonsense? That's for you to decide.

## Installation

```bash
npm install dinah @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Quick Start

### Create a Db Instance

`Db` wraps the AWS SDK v3 DynamoDB client. Pass it a `DynamoDBClient`, a `DynamoDBClientConfig`, or an existing client instance:

```typescript
import { Db } from "dinah";

const db = new Db({ region: "us-east-1" });
```

### Using the Db Class Directly

The `Db` class exposes low-level operations that work with any table by name:

```typescript
// Put an item
await db.put({
  table: "users",
  item: {
    userId: "u1",
    email: "alice@example.com",
    name: "Alice",
    role: "admin",
    createdAt: Date.now(),
  },
});

// Get an item
const user = await db.get<{ userId: string; name: string }>({
  table: "users",
  key: { userId: "u1" },
});

// Query
const users = await db.query<{ userId: string; name: string }>({
  table: "users",
  query: { role: "admin" },
  index: "byRole",
});

// Update
await db.update({
  table: "users",
  key: { userId: "u1" },
  update: { name: "Alice Smith", updatedAt: Date.now() },
});

// Delete
await db.delete({ table: "users", key: { userId: "u1" } });
```

### Define a Table

Use [TypeBox](https://github.com/sinclairzx81/typebox) schemas to define your table's shape, then pass it to `Table` along with key configuration:

```typescript
import { Type } from "typebox";
import { Table } from "dinah";

const UserTable = new Table(
  Type.Object({
    userId: Type.String(),
    email: Type.String(),
    name: Type.String(),
    role: Type.String(),
    createdAt: Type.Number(),
    updatedAt: Type.Optional(Type.Number()),
  }),
  {
    name: "users",
    partitionKey: "userId",
    billingMode: "PAY_PER_REQUEST",
    gsis: {
      byEmail: { partitionKey: "email" },
      byRole: { partitionKey: "role", sortKey: "createdAt" },
    },
  },
);
```

### Using the Repository Class

`Repo` is the recommended way to interact with DynamoDB. For a plain repo with no configuration, use `db.createRepo`:

```typescript
const userRepo = db.createRepo(UserTable);
```

For repos with defaults, transforms, or attribute rules, use `makeRepo` to define a class (see [Repository Configuration](#repository-configuration)):

```typescript
import { makeRepo } from "dinah";

class UserRepo extends makeRepo(UserTable, {
  defaultPutData: () => ({ createdAt: Date.now() }),
  defaultUpdateData: () => ({ updatedAt: Date.now() }),
}) {}

const userRepo = new UserRepo(db);
```

#### CRUD

```typescript
// Create (conditional put — fails if item already exists)
const user = await userRepo.create({
  userId: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: "admin",
  createdAt: Date.now(),
});

// Get
const alice = await userRepo.get({ userId: "u1" });

// Get with projection (return type narrows to projected fields)
const partial = await userRepo.get({ userId: "u1" }, { projection: ["name", "email"] });

// getOrThrow (throws if item not found)
const aliceOrThrow = await userRepo.getOrThrow({ userId: "u1" });

// Put (upsert)
await userRepo.put({
  userId: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: "admin",
  createdAt: Date.now(),
});

// Update (throws if item does not exist)
const updated = await userRepo.update(
  { userId: "u1" },
  { name: "Alice Smith", updatedAt: Date.now() },
);

// Delete (returns old item or undefined)
const deleted = await userRepo.delete({ userId: "u1" });

// deleteOrThrow (throws if item not found)
const item = await userRepo.deleteOrThrow({ userId: "u1" });
```

#### Update Expressions

The update argument supports MongoDB-style operators:

```typescript
await userRepo.update(
  { userId: "u1" },
  {
    name: "Alice", // set
    age: undefined, // remove
    score: { $plus: 10 }, // increment
    score: { $minus: 5 }, // decrement
    score: { $ifNotExists: 0 }, // set only if missing
    tags: { $append: "vip" }, // list_append to end
    tags: { $prepend: "featured" }, // list_append to front
    followers: { $setAdd: "user-99" }, // ADD to DynamoDB set
    followers: { $setDel: "user-99" }, // DELETE from DynamoDB set
  },
);
```

#### Querying

Queries use a MongoDB-like syntax with operators like `$gt`, `$between`, `$prefix`, and more:

```typescript
// Query by partition key
const posts = await postRepo.query({ authorId: "u1" });

// Query with sort key condition
const recent = await postRepo.query({ authorId: "u1" }, { postId: { $gte: "2024-" } });

// Query a GSI
const adminsByDate = await userRepo.queryGsi("byRole", {
  role: "admin",
  createdAt: { $gt: 1700000000000 },
});

// Paginated query (async generator, one page at a time)
for await (const page of postRepo.queryPaged({ authorId: "u1" }, { limit: 20 })) {
  console.log(page);
}

// Paginated GSI query
for await (const page of userRepo.queryGsiPaged("byRole", { role: "admin" })) {
  console.log(page);
}

// Scan with filters
const recentUsers = await userRepo.scan({
  filter: { createdAt: { $gte: 1700000000000 } },
});

// Scan a GSI
const allByStatus = await postRepo.scanGsi("byStatus");

// Check existence (uses query or scan, no data returned)
const hasAdmins = await userRepo.existsGsi("byRole", { query: { role: "admin" } });
const exists = await postRepo.exists({ query: { authorId: "u1" } });
```

Filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$between`, `$in`, `$nin`, `$prefix`, `$includes`, `$exists`, `$size`, `$type`.

#### Batch Operations

```typescript
// Batch get
const { items, unprocessed } = await userRepo.batchGet([{ userId: "u1" }, { userId: "u2" }]);

// Batch get (throws on missing or unprocessed)
const items = await userRepo.batchGetOrThrow([{ userId: "u1" }, { userId: "u2" }]);

// Batch write (puts and deletes mixed)
await userRepo.batchWrite([
  {
    type: "PUT",
    item: { userId: "u3", email: "c@d.com", name: "Carol", role: "user", createdAt: Date.now() },
  },
  { type: "DELETE", key: { userId: "u2" } },
]);

// Batch update (same update applied to multiple keys via PartiQL)
await userRepo.batchUpdate([{ userId: "u1" }, { userId: "u3" }], { role: "admin" });
```

#### Transactions

`trxWrite` accepts plain request objects and executes them as a single DynamoDB transaction:

```typescript
await userRepo.trxWrite(
  {
    type: "PUT",
    item: {
      userId: "u5",
      email: "eve@example.com",
      name: "Eve",
      role: "user",
      createdAt: Date.now(),
    },
  },
  { type: "UPDATE", key: { userId: "u1" }, update: { role: "superadmin" } },
  { type: "DELETE", key: { userId: "u2" } },
  { type: "CONDITION", key: { userId: "u3" }, condition: { role: "admin" } },
);
```

Convenience methods operate on multiple keys/items atomically:

```typescript
// Transactional get
const [u1, u2] = await userRepo.trxGet([{ userId: "u1" }, { userId: "u2" }]);
const items = await userRepo.trxGetOrThrow([{ userId: "u1" }, { userId: "u2" }]);

// Transactional writes
await userRepo.trxPut([item1, item2]);
await userRepo.trxUpdate([{ userId: "u1" }, { userId: "u2" }], { role: "admin" });
await userRepo.trxDelete([{ userId: "u1" }, { userId: "u2" }]);
await userRepo.trxCreate([item1, item2]); // fails if any item already exists
```

To build cross-repo transactions, use the `*Request` methods to produce request objects and pass them to `db.trxWrite`:

```typescript
await db.trxWrite(
  userRepo.trxPutRequest(userItem),
  postRepo.trxDeleteRequest({ authorId: "u1", postId: "p1" }),
);
```

## Repository Configuration

`makeRepo` accepts a config object that controls defaults, transforms, and attribute rules. Extend the result to create a named repo class:

```typescript
class UserRepo extends makeRepo(UserTable, {
  defaultPutData: () => ({ createdAt: Date.now() }),
  defaultUpdateData: () => ({ updatedAt: Date.now() }),
}) {}
```

`defaultPutData` is merged under every `put` / `create` / `batchWrite` put / `trxPut` / `trxCreate`. `defaultUpdateData` is merged under every `update` / `batchUpdate` / `trxUpdate`. Caller-provided values always win.

### transformInput / transformOutput

`transformInput` runs on every write (after defaults are merged) and receives a partial of the schema. `transformOutput` runs on every read and maps the stored shape to your desired return type:

```typescript
class UserRepo extends makeRepo(UserTable, {
  transformInput: (item) => ({
    ...item,
    email: item.email?.toLowerCase(),
  }),
  transformOutput: (item): UserWithDisplayName => ({
    ...item,
    displayName: `${item.name} <${item.email}>`,
  }),
}) {}
```

Transforms are skipped when a `projection` option is provided, since only a subset of fields is available.

### derivedAttributes / immutableAttributes

`derivedAttributes` lists fields that are computed by `transformInput` and should never be written directly by the caller. They are stripped from put and update inputs:

```typescript
class UserRepo extends makeRepo(UserTable, {
  transformInput: (item) => ({
    ...item,
    emailDomain: item.email ? item.email.split("@")[1] : undefined,
  }),
  derivedAttributes: ["emailDomain"],
}) {}
```

`immutableAttributes` lists fields that may be set on create but must not be changed by updates:

```typescript
class UserRepo extends makeRepo(UserTable, {
  immutableAttributes: ["createdAt"],
}) {}
```

Both arrays are inferred as literal types — no `as const` needed.

## License

[MIT](LICENSE)
