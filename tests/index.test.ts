// @ts-nocheck
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { AuditTable, PostTable, UserTable, createDb, createTables, dropTables } from "./setup";

const db = createDb();
const userRepo = db.createRepo(UserTable);
const postRepo = db.createRepo(PostTable);
const auditRepo = db.createRepo(AuditTable);

beforeAll(async () => {
  await dropTables(db);
  await createTables(db);
});

afterAll(async () => {
  await dropTables(db);
});

// ─── CRUD ──────────────────────────────────────────────────────────────────────

describe("put and get", () => {
  test("put stores and retrieves the item", async () => {
    const item = { userId: "u1", email: "a@b.com", name: "Alice", role: "admin", createdAt: 100 };
    await userRepo.put(item);
    const result = await userRepo.get({ userId: "u1" });
    expect(result).toMatchObject(item);
  });

  test("get retrieves an existing item", async () => {
    const result = await userRepo.get({ userId: "u1" });
    expect(result).toBeDefined();
    expect(result!.name).toBe("Alice");
  });

  test("get returns undefined for missing item", async () => {
    const result = await userRepo.get({ userId: "nonexistent" });
    expect(result).toBeUndefined();
  });

  test("getOrThrow throws for missing item", async () => {
    await expect(userRepo.getOrThrow({ userId: "nonexistent" })).rejects.toThrow("not found");
  });

  test("get with projection returns only requested fields", async () => {
    const result = await userRepo.get({ userId: "u1" }, { projection: ["name", "email"] });
    expect(result).toBeDefined();
    expect(result!.name).toBe("Alice");
    expect(result!.email).toBe("a@b.com");
    expect((result as any).role).toBeUndefined();
  });

  test("get with condition filters result", async () => {
    const match = await userRepo.get({ userId: "u1" }, { condition: { role: "admin" } });
    expect(match).toBeDefined();

    const noMatch = await userRepo.get({ userId: "u1" }, { condition: { role: "viewer" } });
    expect(noMatch).toBeUndefined();
  });
});

describe("create", () => {
  test("creates a new item", async () => {
    const item = {
      userId: "u-create",
      email: "c@d.com",
      name: "Bob",
      role: "user",
      createdAt: 200,
    };
    await userRepo.create(item);
    const result = await userRepo.get({ userId: "u-create" });
    expect(result).toMatchObject(item);
  });

  test("fails when item already exists", async () => {
    const item = {
      userId: "u-create",
      email: "c@d.com",
      name: "Bob",
      role: "user",
      createdAt: 200,
    };
    await expect(userRepo.create(item)).rejects.toThrow(ConditionalCheckFailedException);
  });
});

describe("update", () => {
  test("updates an existing item and returns ALL_NEW by default", async () => {
    const result = await userRepo.update({ userId: "u1" }, { name: "Alice Updated" });
    expect(result).toBeDefined();
    expect(result!.name).toBe("Alice Updated");
    expect(result!.email).toBe("a@b.com");
  });

  test("update with condition succeeds when condition is met", async () => {
    const result = await userRepo.update(
      { userId: "u1" },
      { name: "Alice Conditional" },
      { condition: { role: "admin" } },
    );
    expect(result!.name).toBe("Alice Conditional");
  });

  test("update with condition fails when condition is not met", async () => {
    await expect(
      userRepo.update(
        { userId: "u1" },
        { name: "Should Not Apply" },
        { condition: { role: "viewer" } },
      ),
    ).rejects.toThrow(ConditionalCheckFailedException);
  });

  test("update on nonexistent item throws (implicit exists condition)", async () => {
    await expect(userRepo.update({ userId: "nonexistent" }, { name: "nope" })).rejects.toThrow(
      ConditionalCheckFailedException,
    );
  });

  test("update with $remove removes an attribute", async () => {
    await userRepo.update({ userId: "u1" }, { age: 30 });
    let result = await userRepo.get({ userId: "u1" });
    expect(result!.age).toBe(30);

    await userRepo.update({ userId: "u1" }, { age: undefined });
    result = await userRepo.get({ userId: "u1" });
    expect(result!.age).toBeUndefined();
  });

  test("update with $plus increments a numeric value", async () => {
    await userRepo.update({ userId: "u1" }, { age: 10 });
    await userRepo.update({ userId: "u1" }, { age: { $plus: 5 } });
    const result = await userRepo.get({ userId: "u1" });
    expect(result!.age).toBe(15);
  });

  test("update with $ifNotExists sets default only when missing", async () => {
    await userRepo.update({ userId: "u1" }, { age: undefined }); // remove first
    await userRepo.update({ userId: "u1" }, { age: { $ifNotExists: 42 } });
    let result = await userRepo.get({ userId: "u1" });
    expect(result!.age).toBe(42);

    // should not overwrite
    await userRepo.update({ userId: "u1" }, { age: { $ifNotExists: 99 } });
    result = await userRepo.get({ userId: "u1" });
    expect(result!.age).toBe(42);
  });

  test("update with $append appends to a list", async () => {
    await userRepo.update({ userId: "u1" }, { tags: ["a"] });
    await userRepo.update({ userId: "u1" }, { tags: { $append: "b" } });
    const result = await userRepo.get({ userId: "u1" });
    expect(result!.tags).toEqual(["a", "b"]);
  });

  test("update with $prepend prepends to a list", async () => {
    await userRepo.update({ userId: "u1" }, { tags: { $prepend: "z" } });
    const result = await userRepo.get({ userId: "u1" });
    expect(result!.tags).toEqual(["z", "a", "b"]);
  });
});

describe("upsert", () => {
  test("updates existing item", async () => {
    const result = await userRepo.upsert({
      key: { userId: "u1" },
      item: { userId: "u1", email: "x@y.com", name: "Fallback", role: "user", createdAt: 0 },
      update: { name: "Upserted" },
    });
    expect(result.name).toBe("Upserted");
    expect(result.email).toBe("a@b.com"); // original email preserved
  });

  test("creates item when it doesn't exist", async () => {
    await userRepo.upsert({
      key: { userId: "u-upsert-new" },
      item: {
        userId: "u-upsert-new",
        email: "new@upsert.com",
        name: "New",
        role: "user",
        createdAt: 300,
      },
      update: { name: "Updated" },
    });
    const result = await userRepo.get({ userId: "u-upsert-new" });
    expect(result).toBeDefined();
    expect(result!.email).toBe("new@upsert.com");
  });
});

describe("delete", () => {
  test("delete returns the old item", async () => {
    await userRepo.put({
      userId: "u-del",
      email: "d@e.com",
      name: "Del",
      role: "user",
      createdAt: 400,
    });
    const deleted = await userRepo.delete({ userId: "u-del" });
    expect(deleted).toBeDefined();
    expect(deleted!.name).toBe("Del");

    const after = await userRepo.get({ userId: "u-del" });
    expect(after).toBeUndefined();
  });

  test("delete on nonexistent item returns undefined", async () => {
    const result = await userRepo.delete({ userId: "nonexistent" });
    expect(result).toBeUndefined();
  });

  test("deleteOrThrow throws for missing item", async () => {
    await expect(userRepo.deleteOrThrow({ userId: "nonexistent" })).rejects.toThrow("not found");
  });

  test("delete with condition", async () => {
    await userRepo.put({
      userId: "u-del-cond",
      email: "dc@e.com",
      name: "DC",
      role: "admin",
      createdAt: 500,
    });

    await expect(
      userRepo.delete({ userId: "u-del-cond" }, { condition: { role: "viewer" } }),
    ).rejects.toThrow(ConditionalCheckFailedException);

    // should still exist
    const still = await userRepo.get({ userId: "u-del-cond" });
    expect(still).toBeDefined();
  });
});

describe("composite key table", () => {
  test("put and get with partition + sort key", async () => {
    const post = {
      authorId: "a1",
      postId: "p1",
      title: "Hello",
      status: "published",
      createdAt: 100,
    };
    await postRepo.put(post);
    const result = await postRepo.get({ authorId: "a1", postId: "p1" });
    expect(result).toBeDefined();
    expect(result!.title).toBe("Hello");
  });

  test("update composite key item", async () => {
    const result = await postRepo.update(
      { authorId: "a1", postId: "p1" },
      { title: "Hello Updated" },
    );
    expect(result!.title).toBe("Hello Updated");
  });

  test("delete composite key item", async () => {
    const deleted = await postRepo.delete({ authorId: "a1", postId: "p1" });
    expect(deleted!.title).toBe("Hello Updated");
  });
});

describe("lifecycle hooks", () => {
  test("beforePut sets defaults on create", async () => {
    await auditRepo.create({ auditId: "a1", action: "login", createdAt: 9999 });
    const result = await auditRepo.get({ auditId: "a1" });
    expect(result).toBeDefined();
    // createdAt from hook is 1000, but user value 9999 wins because of spread order in repo.create
    expect(result!.createdAt).toBe(9999);
    expect(result!.updatedAt).toBe(1000);
  });

  test("beforeUpdate sets defaults on update", async () => {
    const result = await auditRepo.update({ auditId: "a1" }, { action: "logout" });
    expect(result!.action).toBe("logout");
    expect(result!.updatedAt).toBe(2000);
  });
});

// ─── QUERY & SCAN ──────────────────────────────────────────────────────────────

describe("query", () => {
  beforeAll(async () => {
    // seed posts for query tests
    const posts = Array.from({ length: 10 }, (_, i) => ({
      authorId: "author-q",
      postId: `post-${String(i).padStart(2, "0")}`,
      title: `Post ${i}`,
      status: i < 5 ? "published" : "draft",
      score: i * 10,
      createdAt: 1000 + i,
    }));
    await postRepo.batchWrite(posts.map((item) => ({ type: "PUT" as const, item })));
  });

  test("query returns items by partition key", async () => {
    const results = await postRepo.query({ authorId: "author-q" });
    expect(results.length).toBe(10);
  });

  test("query with sort key condition", async () => {
    const results = await postRepo.query({
      authorId: "author-q",
      postId: { $gte: "post-05" },
    });
    expect(results.length).toBe(5);
  });

  test("query with $between on sort key", async () => {
    const results = await postRepo.query({
      authorId: "author-q",
      postId: { $between: ["post-02", "post-07"] },
    });
    expect(results.length).toBe(6);
  });

  test("query with $prefix on sort key", async () => {
    const results = await postRepo.query({
      authorId: "author-q",
      postId: { $prefix: "post-0" },
    });
    expect(results.length).toBe(10); // post-00 through post-09
  });

  test("query with filter", async () => {
    const results = await postRepo.query({ authorId: "author-q" }, { filter: { status: "draft" } });
    expect(results.length).toBe(5);
  });

  test("query with filter using $gt", async () => {
    const results = await postRepo.query(
      { authorId: "author-q" },
      { filter: { score: { $gt: 50 } } },
    );
    expect(results.length).toBe(4); // scores 60,70,80,90
  });

  test("query with limit paginates correctly", async () => {
    // limit is per-page; query() aggregates all pages, so we use queryPaged to verify
    const pages: number[] = [];
    for await (const page of postRepo.queryPaged({ authorId: "author-q" }, { limit: 3 })) {
      pages.push(page.length);
    }
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((size) => size <= 3)).toBe(true);
  });

  test("query with sort DESC", async () => {
    const results = await postRepo.query({ authorId: "author-q" }, { sort: "DESC" });
    expect(results[0]!.postId).toBe("post-09");
    expect(results[9]!.postId).toBe("post-00");
  });

  test("query with projection", async () => {
    const results = await postRepo.query(
      { authorId: "author-q" },
      { projection: ["postId", "title"], limit: 1 },
    );
    expect(results[0]!.postId).toBeDefined();
    expect(results[0]!.title).toBeDefined();
    expect((results[0] as any).status).toBeUndefined();
  });
});

describe("queryGsi", () => {
  test("queries a GSI", async () => {
    const results = await postRepo.queryGsi("byStatus", { status: "published" });
    expect(results.length).toBe(5);
  });

  test("queryGsi with sort key condition on GSI", async () => {
    const results = await postRepo.queryGsi("byStatus", {
      status: "published",
      createdAt: { $gte: 1003 },
    });
    expect(results.length).toBe(2); // createdAt 1003, 1004
  });
});

describe("queryPaged", () => {
  test("paginates through results", async () => {
    let pageCount = 0;
    let totalItems = 0;
    for await (const page of postRepo.queryPaged({ authorId: "author-q" }, { limit: 3 })) {
      pageCount++;
      totalItems += page.length;
      expect(page.length).toBeLessThanOrEqual(3);
    }
    expect(pageCount).toBeGreaterThan(1);
    expect(totalItems).toBe(10);
  });
});

describe("scan", () => {
  test("scan returns all items in the table", async () => {
    const results = await postRepo.scan();
    expect(results.length).toBeGreaterThanOrEqual(10);
  });

  test("scan with filter", async () => {
    const results = await postRepo.scan({ filter: { status: "draft" } });
    expect(results.length).toBeGreaterThanOrEqual(5);
  });

  test("scanPaged paginates", async () => {
    let totalItems = 0;
    for await (const page of postRepo.scanPaged({ limit: 3 })) {
      totalItems += page.length;
    }
    expect(totalItems).toBeGreaterThanOrEqual(10);
  });
});

describe("scanGsi", () => {
  test("scan a GSI", async () => {
    const results = await postRepo.scanGsi("byStatus");
    expect(results.length).toBeGreaterThanOrEqual(10);
  });
});

describe("exists", () => {
  test("returns true when items exist", async () => {
    const result = await postRepo.exists({ query: { authorId: "author-q" } });
    expect(result).toBe(true);
  });

  test("returns false when no items match", async () => {
    const result = await postRepo.exists({ query: { authorId: "nonexistent-author" } });
    expect(result).toBe(false);
  });

  test("existsGsi checks a GSI", async () => {
    const result = await postRepo.existsGsi("byStatus", { query: { status: "published" } });
    expect(result).toBe(true);

    const result2 = await postRepo.existsGsi("byStatus", { query: { status: "archived" } });
    expect(result2).toBe(false);
  });
});

// ─── BATCH OPERATIONS ──────────────────────────────────────────────────────────

describe("batchGet", () => {
  beforeAll(async () => {
    await userRepo.batchWrite([
      {
        type: "PUT",
        item: { userId: "bg1", email: "bg1@x.com", name: "BG1", role: "user", createdAt: 1 },
      },
      {
        type: "PUT",
        item: { userId: "bg2", email: "bg2@x.com", name: "BG2", role: "user", createdAt: 2 },
      },
      {
        type: "PUT",
        item: { userId: "bg3", email: "bg3@x.com", name: "BG3", role: "user", createdAt: 3 },
      },
    ]);
  });

  test("retrieves multiple items", async () => {
    const { items } = await userRepo.batchGet([
      { userId: "bg1" },
      { userId: "bg2" },
      { userId: "bg3" },
    ]);
    expect(items.length).toBe(3);
  });

  test("preserves order of requested keys", async () => {
    const { items } = await userRepo.batchGet([
      { userId: "bg3" },
      { userId: "bg1" },
      { userId: "bg2" },
    ]);
    expect(items[0]!.userId).toBe("bg3");
    expect(items[1]!.userId).toBe("bg1");
    expect(items[2]!.userId).toBe("bg2");
  });

  test("batchGet with projection", async () => {
    const { items } = await userRepo.batchGet([{ userId: "bg1" }], {
      projection: ["userId", "name"],
    });
    expect(items[0]!.name).toBe("BG1");
    expect((items[0] as any).email).toBeUndefined();
  });

  test("batchGetOrThrow throws when items are missing", async () => {
    await expect(
      userRepo.batchGetOrThrow([{ userId: "bg1" }, { userId: "nonexistent-batch" }]),
    ).rejects.toThrow("not found");
  });
});

describe("batchWrite", () => {
  test("puts and deletes in a single batch", async () => {
    await userRepo.batchWrite([
      {
        type: "PUT",
        item: { userId: "bw1", email: "bw1@x.com", name: "BW1", role: "user", createdAt: 1 },
      },
      {
        type: "PUT",
        item: { userId: "bw2", email: "bw2@x.com", name: "BW2", role: "user", createdAt: 2 },
      },
    ]);

    const { items } = await userRepo.batchGet([{ userId: "bw1" }, { userId: "bw2" }]);
    expect(items.length).toBe(2);

    await userRepo.batchWrite([
      { type: "DELETE", key: { userId: "bw1" } },
      { type: "DELETE", key: { userId: "bw2" } },
    ]);

    const { items: afterDelete } = await userRepo.batchGet([{ userId: "bw1" }, { userId: "bw2" }]);
    expect(afterDelete.length).toBe(0);
  });
});

// ─── TRANSACTIONS ──────────────────────────────────────────────────────────────

describe("transactions", () => {
  test("trxWrite with put, update, and delete", async () => {
    // seed an item to update and one to delete
    await userRepo.put({
      userId: "trx-upd",
      email: "tu@x.com",
      name: "TU",
      role: "user",
      createdAt: 1,
    });
    await userRepo.put({
      userId: "trx-del",
      email: "td@x.com",
      name: "TD",
      role: "user",
      createdAt: 2,
    });

    await userRepo.trxWrite(
      {
        type: "PUT",
        item: { userId: "trx-new", email: "tn@x.com", name: "TN", role: "user", createdAt: 3 },
      },
      { type: "UPDATE", key: { userId: "trx-upd" }, update: { name: "TU Updated" } },
      { type: "DELETE", key: { userId: "trx-del" } },
    );

    const created = await userRepo.get({ userId: "trx-new" });
    expect(created).toBeDefined();
    expect(created!.name).toBe("TN");

    const updated = await userRepo.get({ userId: "trx-upd" });
    expect(updated!.name).toBe("TU Updated");

    const deleted = await userRepo.get({ userId: "trx-del" });
    expect(deleted).toBeUndefined();
  });

  test("trxGet retrieves multiple items transactionally", async () => {
    const results = await userRepo.trxGet([{ userId: "trx-new" }, { userId: "trx-upd" }]);
    expect(results.length).toBe(2);
    expect(results[0]!.name).toBe("TN");
    expect(results[1]!.name).toBe("TU Updated");
  });

  test("trxGetOrThrow throws when an item is missing", async () => {
    await expect(
      userRepo.trxGetOrThrow([{ userId: "trx-new" }, { userId: "nonexistent-trx" }]),
    ).rejects.toThrow("not found");
  });

  test("trxPut puts multiple items", async () => {
    await userRepo.trxPut([
      { userId: "trx-p1", email: "tp1@x.com", name: "TP1", role: "user", createdAt: 1 },
      { userId: "trx-p2", email: "tp2@x.com", name: "TP2", role: "user", createdAt: 2 },
    ]);
    const { items } = await userRepo.batchGet([{ userId: "trx-p1" }, { userId: "trx-p2" }]);
    expect(items.length).toBe(2);
  });

  test("trxUpdate updates multiple items", async () => {
    await userRepo.trxUpdate([{ userId: "trx-p1" }, { userId: "trx-p2" }], { role: "admin" });
    const { items } = await userRepo.batchGet([{ userId: "trx-p1" }, { userId: "trx-p2" }]);
    expect(items.every((item) => item.role === "admin")).toBe(true);
  });

  test("trxDelete deletes multiple items", async () => {
    await userRepo.trxDelete([{ userId: "trx-p1" }, { userId: "trx-p2" }]);
    const { items } = await userRepo.batchGet([{ userId: "trx-p1" }, { userId: "trx-p2" }]);
    expect(items.length).toBe(0);
  });

  test("trxCreate fails if item already exists", async () => {
    await userRepo.put({
      userId: "trx-exists",
      email: "te@x.com",
      name: "TE",
      role: "user",
      createdAt: 1,
    });
    await expect(
      userRepo.trxCreate([
        { userId: "trx-exists", email: "te@x.com", name: "TE", role: "user", createdAt: 1 },
      ]),
    ).rejects.toThrow();
  });

  test("trxWrite with condition check", async () => {
    await userRepo.put({
      userId: "trx-cond",
      email: "tc@x.com",
      name: "TC",
      role: "admin",
      createdAt: 1,
    });

    // condition passes
    await userRepo.trxWrite(
      { type: "CONDITION", key: { userId: "trx-cond" }, condition: { role: "admin" } },
      {
        type: "PUT",
        item: { userId: "trx-cond-ok", email: "ok@x.com", name: "OK", role: "user", createdAt: 2 },
      },
    );
    expect(await userRepo.get({ userId: "trx-cond-ok" })).toBeDefined();

    // condition fails
    await expect(
      userRepo.trxWrite(
        { type: "CONDITION", key: { userId: "trx-cond" }, condition: { role: "viewer" } },
        {
          type: "PUT",
          item: {
            userId: "trx-cond-fail",
            email: "f@x.com",
            name: "F",
            role: "user",
            createdAt: 3,
          },
        },
      ),
    ).rejects.toThrow();
    expect(await userRepo.get({ userId: "trx-cond-fail" })).toBeUndefined();
  });
});

// ─── Db DIRECT ─────────────────────────────────────────────────────────────────

describe("Db direct operations", () => {
  test("listTables returns table names", async () => {
    const tables = await db.listTables();
    expect(tables).toContain("users");
    expect(tables).toContain("posts");
    expect(tables).toContain("audits");
  });

  test("tableNamePrefix is applied", async () => {
    const prefixedDb = new (await import("../src")).Db(
      { region: "us-east-1", endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000" },
      { tableNamePrefix: "test-" },
    );
    const repo = prefixedDb.createRepo(UserTable);
    expect(repo.tableName).toBe("test-users");
  });
});
