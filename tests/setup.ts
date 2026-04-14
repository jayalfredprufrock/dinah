import { Type } from "typebox";
import { Db, Table, AbstractRepo } from "../src";

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";

// Simple table: partition key only
export const UserSchema = Type.Object({
  userId: Type.String(),
  email: Type.String(),
  name: Type.String(),
  role: Type.String(),
  age: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.Array(Type.String())),
  createdAt: Type.Number(),
  updatedAt: Type.Optional(Type.Number()),
});

export const UserTable = new Table(UserSchema, {
  name: "users",
  partitionKey: "userId",
  billingMode: "PAY_PER_REQUEST",
  gsis: {
    byEmail: { partitionKey: "email" },
    byRole: { partitionKey: "role", sortKey: "createdAt" },
  },
});

// Composite key table: partition key + sort key
export const PostSchema = Type.Object({
  authorId: Type.String(),
  postId: Type.String(),
  title: Type.String(),
  body: Type.Optional(Type.String()),
  status: Type.String(),
  score: Type.Optional(Type.Number()),
  createdAt: Type.Number(),
});

export const PostTable = new Table(PostSchema, {
  name: "posts",
  partitionKey: "authorId",
  sortKey: "postId",
  billingMode: "PAY_PER_REQUEST",
  gsis: {
    byStatus: { partitionKey: "status", sortKey: "createdAt" },
  },
});

// Table with lifecycle hooks
export const AuditSchema = Type.Object({
  auditId: Type.String(),
  action: Type.String(),
  createdAt: Type.Number(),
  updatedAt: Type.Optional(Type.Number()),
});

export const AuditTable = new Table(AuditSchema, {
  name: "audits",
  partitionKey: "auditId",
  billingMode: "PAY_PER_REQUEST",
});

export class AuditRepo extends AbstractRepo<typeof AuditTable> {
  readonly table = AuditTable;

  override get defaultPutData() {
    return { createdAt: 1000, updatedAt: 1000 };
  }

  override get defaultUpdateData() {
    return { updatedAt: 2000 };
  }
}

export const ALL_TABLES = [UserTable, PostTable, AuditTable];

export function createDb(): Db {
  return new Db({
    region: "us-east-1",
    endpoint: DYNAMODB_ENDPOINT,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
}

export async function createTables(db: Db): Promise<void> {
  await Promise.all(ALL_TABLES.map((t) => db.createTable(t)));
}

export async function dropTables(db: Db): Promise<void> {
  await Promise.all(ALL_TABLES.map((t) => db.deleteTable(t.def.name).catch(() => {})));
}

