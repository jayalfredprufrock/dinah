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

`Repository` is the recommended way to interact with DynamoDB. Created from a `Table`, it provides full type inference for keys, items, queries, and projections:

```typescript
const userRepo = db.createRepo(UserTable);
```

#### CRUD

```typescript
// Create (conditional put - fails if item already exists)
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

// Update
const updated = await userRepo.update(
  { userId: "u1" },
  { name: "Alice Smith", updatedAt: Date.now() },
);

// Delete
await userRepo.delete({ userId: "u1" });
```

#### Querying

Queries use a MongoDB-like syntax with operators like `$gt`, `$between`, `$prefix`, and more:

```typescript
// Query by partition key
const admins = await userRepo.query({ userId: "u1" });

// Query a GSI
const adminsByDate = await userRepo.queryGsi("byRole", {
  role: "admin",
  createdAt: { $gt: 1700000000000 },
});

// Scan with filters
const recentUsers = await userRepo.scan({
  filter: { createdAt: { $gte: 1700000000000 } },
});

// Paginated query with async iteration
for await (const page of userRepo.queryGsiPaged("byRole", { role: "admin" })) {
  console.log(page); // each page is an array of items
}
```

#### Batch Operations

```typescript
// Batch get
const { items, unprocessed } = await userRepo.batchGet([
  { userId: "u1" },
  { userId: "u2" },
  { userId: "u3" },
]);

// Batch write (puts and deletes)
await userRepo.batchWrite([
  {
    type: "PUT",
    item: {
      userId: "u4",
      email: "bob@example.com",
      name: "Bob",
      role: "user",
      createdAt: Date.now(),
    },
  },
  { type: "DELETE", key: { userId: "u3" } },
]);
```

#### Transactions

```typescript
await userRepo.trxWrite(
  userRepo.trxPut({
    userId: "u5",
    email: "eve@example.com",
    name: "Eve",
    role: "user",
    createdAt: Date.now(),
  }),
  userRepo.trxUpdate({ userId: "u1" }, { role: "superadmin" }),
  userRepo.trxDelete({ userId: "u2" }),
);
```

### Default Values

To attach defaults like timestamps to every write, subclass `AbstractRepo` and override `defaultPutData` and/or `defaultUpdateData`:

```typescript
import { AbstractRepo } from "dinah";

class UserRepo extends AbstractRepo<typeof UserTable> {
  readonly table = UserTable;

  override get defaultPutData() {
    return { createdAt: Date.now() };
  }

  override get defaultUpdateData() {
    return { updatedAt: Date.now() };
  }
}

const userRepo = new UserRepo(db);
```

`defaultPutData` is merged under every `put` / `create` / `batchWrite` put / `trxPut` / `trxCreate`. `defaultUpdateData` is merged under every `update` / `trxUpdate`. Caller-provided values always win on conflict.

## License

[MIT](LICENSE)
