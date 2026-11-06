// @ts-nocheck
import { Type } from "typebox";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vite-plus/test";
import { DinahError, Table } from "../src";
import { createDb } from "./setup";

// Dedicated table: Vitest runs files in parallel, so sharing the names in
// ./setup would race with index.test.ts dropping and recreating them.
const DocTable = new Table(
  Type.Object({
    id: Type.String(),
    title: Type.String(),
    body: Type.Optional(Type.String()),
    count: Type.Optional(Type.Number()),
    tags: Type.Optional(Type.Array(Type.String())),
    meta: Type.Optional(Type.Record(Type.String(), Type.Number())),
    email: Type.Optional(Type.String()),
    sku: Type.Optional(Type.String()),
    a: Type.Optional(Type.String()),
    b: Type.Optional(Type.String()),
    ab: Type.Optional(Type.String()),
    createdAt: Type.Number(),
    updatedAt: Type.Optional(Type.Number()),
  }),
  { name: "patch_docs", partitionKey: "id", billingMode: "PAY_PER_REQUEST" },
);

const db = createDb();
const repo = db.makeRepo(DocTable, {
  defaultCreateData: () => ({ createdAt: 1 }),
  defaultUpdateData: () => ({ updatedAt: 2 }),
  transformAttributes: { email: (v) => v.toLowerCase() },
  computedAttributes: {
    ab: { from: ["a", "b"], compute: (a, b) => (a && b ? `${a}-${b}` : undefined) },
  },
  immutableAttributes: ["sku"],
});

// Runs `interfere` once, between patch's read and its write.
const interceptNextWrite = (interfere: () => Promise<unknown>, times = 1) => {
  let remaining = times;
  let interfering = false;
  db.update = async function (args) {
    if (!interfering && remaining-- > 0) {
      interfering = true;
      await interfere().finally(() => (interfering = false));
    }
    return Object.getPrototypeOf(db).update.call(db, args);
  };
};

afterEach(() => {
  delete db.update;
});

beforeAll(async () => {
  await db.deleteTable(DocTable.def.name).catch(() => {});
  await db.createTable(DocTable);
});

afterAll(async () => {
  await db.deleteTable(DocTable.def.name).catch(() => {});
});

const seed = (id: string, extra = {}) => repo.create({ id, title: "t", ...extra });

describe("patch", () => {
  test("writes only changed fields and applies update defaults", async () => {
    await seed("p1", { body: "b", count: 3 });
    const result = await repo.patch({ id: "p1" }, { title: "new", body: "b" });
    expect(result).toEqual({
      id: "p1",
      title: "new",
      body: "b",
      count: 3,
      createdAt: 1,
      updatedAt: 2,
    });
  });

  test("accepts a function of the current item", async () => {
    await seed("p2", { count: 3 });
    const result = await repo.patch({ id: "p2" }, (cur) => ({ title: `${cur.title}!` }));
    expect(result.title).toBe("t!");
  });

  test("no-op skips the write and update defaults", async () => {
    await seed("p3", { tags: ["x", "y"], meta: { a: 1, b: 2 }, email: "x@y.com" });
    const result = await repo.patch(
      { id: "p3" },
      { title: "t", tags: ["x", "y"], meta: { b: 2, a: 1 }, email: "X@Y.COM" },
    );
    expect(result.updatedAt).toBeUndefined();
    expect((await repo.get({ id: "p3" })).updatedAt).toBeUndefined();
  });

  test("detects list order changes", async () => {
    await seed("p4", { tags: ["x", "y"] });
    const result = await repo.patch({ id: "p4" }, { tags: ["y", "x"] });
    expect(result.tags).toEqual(["y", "x"]);
  });

  test("undefined removes a field; omitted fields are untouched", async () => {
    await seed("p5", { body: "b", count: 3 });
    const result = await repo.patch({ id: "p5" }, { body: undefined });
    expect(result).not.toHaveProperty("body");
    expect(result.count).toBe(3);
  });

  test("concurrent writes to other fields are preserved without a retry", async () => {
    await seed("p6", { count: 0 });
    let calls = 0;
    interceptNextWrite(() => repo.update({ id: "p6" }, { count: { $plus: 1 } }));
    const result = await repo.patch({ id: "p6" }, () => (calls++, { title: "new" }));
    expect(calls).toBe(1);
    expect(result).toMatchObject({ title: "new", count: 1 });
  });

  test("retries from a fresh read when a patched field changed concurrently", async () => {
    await seed("p7");
    const seen: string[] = [];
    interceptNextWrite(() => repo.update({ id: "p7" }, { title: "other" }));
    const result = await repo.patch(
      { id: "p7" },
      (cur) => (seen.push(cur.title), { title: `${cur.title}+` }),
    );
    expect(seen).toEqual(["t", "other"]);
    expect(result.title).toBe("other+");
  });

  test("conditions on fields that were absent when read", async () => {
    await seed("p8");
    let calls = 0;
    interceptNextWrite(() => repo.update({ id: "p8" }, { body: "other" }));
    const result = await repo.patch(
      { id: "p8" },
      (cur) => (calls++, { body: cur.body ?? "first" }),
    );
    expect(calls).toBe(2);
    expect(result.body).toBe("other");
  });

  test("throws the last conflict after maxAttempts", async () => {
    await seed("p9");
    let calls = 0;
    let n = 0;
    interceptNextWrite(() => repo.update({ id: "p9" }, { title: `other-${n++}` }), 10);
    const err = await repo
      .patch({ id: "p9" }, () => (calls++, { title: "mine" }), { maxAttempts: 3 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(DinahError);
    expect(err.details.type).toBe("CONDITIONAL_CHECK_FAILED");
    expect(calls).toBe(3);
  });

  test("throws NOT_FOUND for a missing item", async () => {
    const err = await repo.patch({ id: "missing" }, { title: "x" }).catch((e) => e);
    expect(err.details.type).toBe("NOT_FOUND");
  });

  test("rejects a different key, allows the same one", async () => {
    await seed("p10");
    expect((await repo.patch({ id: "p10" }, { id: "p10" })).id).toBe("p10");
    const err = await repo.patch({ id: "p10" }, { id: "other" }).catch((e) => e);
    expect(err.details.type).toBe("VALIDATION");
  });

  test("immutables: same value is a no-op, a different one throws", async () => {
    await seed("p11", { sku: "s1" });
    await expect(repo.patch({ id: "p11" }, { sku: "s1" })).resolves.toBeDefined();
    const err = await repo.patch({ id: "p11" }, { sku: "s2" }).catch((e) => e);
    expect(err.details.type).toBe("VALIDATION");
  });

  test("rejects computed fields", async () => {
    await seed("p12");
    const err = await repo.patch({ id: "p12" }, { ab: "x" }).catch((e) => e);
    expect(err.details.type).toBe("VALIDATION");
  });

  test("recomputes multi-source computed fields from the stored sources", async () => {
    await seed("p13", { a: "1", b: "2" });
    const result = await repo.patch({ id: "p13" }, { a: "3" });
    expect(result).toMatchObject({ a: "3", b: "2", ab: "3-2" });
  });

  test("does not re-transform stored values filled in for computed sources", async () => {
    const tdb = createDb();
    const trepo = tdb.makeRepo(DocTable, {
      transformAttributes: { b: (v) => `${v}!` },
      computedAttributes: { ab: { from: ["a", "b"], compute: (a, b) => `${a}-${b}` } },
    });
    await trepo.create({ id: "p14", title: "t", createdAt: 1, a: "1", b: "2" });
    const result = await trepo.patch({ id: "p14" }, { a: "3" });
    expect(result).toMatchObject({ b: "2!", ab: "3-2!" });
  });
});

describe("createOrPatch", () => {
  test("creates through the create path when missing", async () => {
    const result = await repo.createOrPatch({ id: "c1", title: "t", email: "A@B.COM" });
    expect(result).toEqual({ id: "c1", title: "t", email: "a@b.com", createdAt: 1 });
  });

  test("merges the item into an existing one, leaving other fields alone", async () => {
    await seed("c2", { count: 5 });
    const result = await repo.createOrPatch({ id: "c2", title: "new" });
    expect(result).toEqual({ id: "c2", title: "new", count: 5, createdAt: 1, updatedAt: 2 });
  });

  test("uses the update function when the item exists", async () => {
    await seed("c3");
    const result = await repo.createOrPatch({ id: "c3", title: "ignored" }, (cur) => ({
      title: `${cur.title}+`,
    }));
    expect(result.title).toBe("t+");
  });

  test("falls back to patching when the create loses a race", async () => {
    repo.create = async (item) => {
      delete repo.create;
      await seed("c4", { count: 7 });
      return repo.create(item);
    };
    const result = await repo.createOrPatch({ id: "c4", title: "mine" });
    expect(result).toMatchObject({ title: "mine", count: 7 });
  });
});
