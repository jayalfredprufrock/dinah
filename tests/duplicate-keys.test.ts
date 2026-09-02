import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Table } from "../src";
import { createDb } from "./setup";

// DynamoDB rejects any batch containing two operations on one item. Because
// Dinah chunks, that rejection used to be position-dependent: repeats inside a
// single chunk raised a ValidationException, while repeats straddling a chunk
// boundary quietly both applied. These pin the behavior that replaced it.

// Dedicated tables: Vitest runs files in parallel, so sharing the names in
// ./setup would race with index.test.ts dropping and recreating them.
const UserTable = new Table(
  Type.Object({
    userId: Type.String(),
    email: Type.String(),
    name: Type.String(),
    role: Type.String(),
    createdAt: Type.Number(),
  }),
  { name: "dupkey_users", partitionKey: "userId", billingMode: "PAY_PER_REQUEST" },
);

const PostTable = new Table(
  Type.Object({
    authorId: Type.String(),
    postId: Type.String(),
    status: Type.String(),
    createdAt: Type.Number(),
  }),
  {
    name: "dupkey_posts",
    partitionKey: "authorId",
    sortKey: "postId",
    billingMode: "PAY_PER_REQUEST",
  },
);

const TABLES = [UserTable, PostTable];

const db = createDb();
const userRepo = db.makeRepo(UserTable);
const postRepo = db.makeRepo(PostTable);

const user = (id: string, name = "x") => ({
  userId: id,
  email: `${id}@e.com`,
  name,
  role: "user",
  createdAt: 1,
});

const drop = () => Promise.all(TABLES.map((t) => db.deleteTable(t.def.name).catch(() => {})));

beforeAll(async () => {
  await drop();
  await Promise.all(TABLES.map((t) => db.createTable(t)));
});
afterAll(drop);

describe("batchGet deduplicates", () => {
  test("a repeated key is fetched once and returned once", async () => {
    await userRepo.put(user("dg1"));

    const { items } = await userRepo.batchGet([
      { userId: "dg1" },
      { userId: "dg1" },
      { userId: "dg1" },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.userId).toBe("dg1");
  });

  test("repeats straddling the 100-key chunk boundary don't duplicate results", async () => {
    // The silent case: neither request contains a duplicate on its own, so
    // DynamoDB never complains and the item came back twice.
    const items = Array.from({ length: 160 }, (_, i) => ({
      type: "PUT" as const,
      item: user(`sd${i}`),
    }));
    await userRepo.batchWrite(items);

    const keys = Array.from({ length: 160 }, (_, i) => ({ userId: `sd${i}` }));
    keys[150] = { userId: "sd0" };

    const { items: got } = await userRepo.batchGet(keys);
    const ids = got.map((i: any) => i.userId);

    expect(got).toHaveLength(159);
    expect(new Set(ids).size).toBe(159);
  });

  test("order still follows first occurrence of each key", async () => {
    await userRepo.batchWrite([
      { type: "PUT", item: user("do1") },
      { type: "PUT", item: user("do2") },
      { type: "PUT", item: user("do3") },
    ]);

    const { items } = await userRepo.batchGet([
      { userId: "do3" },
      { userId: "do1" },
      { userId: "do3" },
      { userId: "do2" },
    ]);

    expect(items.map((i: any) => i.userId)).toEqual(["do3", "do1", "do2"]);
  });

  test("batchGetOrThrow counts distinct keys, not raw ones", async () => {
    await userRepo.put(user("dt1"));

    // Would previously trip the items-vs-keys length check and throw NOT_FOUND.
    const items = await userRepo.batchGetOrThrow([{ userId: "dt1" }, { userId: "dt1" }]);
    expect(items).toHaveLength(1);
  });

  test("composite keys dedupe on the whole key, not the partition", async () => {
    await postRepo.batchWrite([
      { type: "PUT", item: { authorId: "a1", postId: "p1", status: "live", createdAt: 1 } },
      { type: "PUT", item: { authorId: "a1", postId: "p2", status: "live", createdAt: 2 } },
    ]);

    const { items } = await postRepo.batchGet([
      { authorId: "a1", postId: "p1" },
      { authorId: "a1", postId: "p2" },
      { authorId: "a1", postId: "p1" },
    ]);

    expect(items).toHaveLength(2);
  });
});

describe("batchWrite rejects duplicates", () => {
  test("two PUTs for the same key fail with an actionable error", async () => {
    await expect(
      userRepo.batchWrite([
        { type: "PUT", item: user("dw1", "first") },
        { type: "PUT", item: user("dw1", "second") },
      ]),
    ).rejects.toMatchObject({
      name: "DinahError",
      details: { type: "VALIDATION" },
    });
  });

  test("a PUT and a DELETE for the same key fail too", async () => {
    await expect(
      userRepo.batchWrite([
        { type: "PUT", item: user("dw2") },
        { type: "DELETE", key: { userId: "dw2" } },
      ]),
    ).rejects.toThrow(/same key/);
  });

  test("repeats straddling a chunk boundary fail, rather than silently applying", async () => {
    const requests = Array.from({ length: 31 }, (_, i) => ({
      type: "PUT" as const,
      item: user(i === 30 ? "dw3" : `dws${i}`),
    }));
    requests[0] = { type: "PUT", item: user("dw3") };

    await expect(userRepo.batchWrite(requests)).rejects.toThrow(/same key/);
  });

  test("nothing is written when the batch is rejected", async () => {
    await expect(
      userRepo.batchWrite([
        { type: "PUT", item: user("dw4") },
        { type: "PUT", item: user("dw4") },
      ]),
    ).rejects.toThrow();

    // Validation happens before any request is sent.
    expect(await userRepo.get({ userId: "dw4" })).toBeUndefined();
  });

  test("distinct keys sharing a partition are not duplicates", async () => {
    await expect(
      postRepo.batchWrite([
        { type: "PUT", item: { authorId: "a2", postId: "p1", status: "live", createdAt: 1 } },
        { type: "PUT", item: { authorId: "a2", postId: "p2", status: "live", createdAt: 2 } },
      ]),
    ).resolves.toBeDefined();
  });

  test("batchWriteOrThrow rejects them as well", async () => {
    await expect(
      userRepo.batchWriteOrThrow([
        { type: "PUT", item: user("dw5") },
        { type: "PUT", item: user("dw5") },
      ]),
    ).rejects.toThrow(/same key/);
  });
});

describe("batchUpdate rejects duplicates", () => {
  test("a repeated key fails rather than being collapsed", async () => {
    await userRepo.put(user("du1"));

    // Not deduplicated, because an update need not be idempotent.
    await expect(
      userRepo.batchUpdate([{ userId: "du1" }, { userId: "du1" }], { name: "updated" }),
    ).rejects.toMatchObject({
      name: "DinahError",
      details: { type: "VALIDATION" },
    });
  });

  test("distinct keys still work", async () => {
    await userRepo.batchWrite([
      { type: "PUT", item: user("du2") },
      { type: "PUT", item: user("du3") },
    ]);

    const result = await userRepo.batchUpdate([{ userId: "du2" }, { userId: "du3" }], {
      name: "updated",
    });
    expect(result.unprocessed).toBeUndefined();
  });
});
