// @ts-nocheck
import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { DinahError, DiscriminatedUnion, Table } from "../src";
import { createDb } from "./setup";

// Dedicated tables: test files run in parallel.
const DocTable = new Table(
  Type.Object({
    id: Type.String(),
    title: Type.String(),
    body: Type.Optional(Type.String()),
    a: Type.Optional(Type.String()),
    b: Type.Optional(Type.String()),
    ab: Type.Optional(Type.String()),
    note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  { name: "required_removal_docs", partitionKey: "id", billingMode: "PAY_PER_REQUEST" },
);

const Cat = Type.Object({
  id: Type.String(),
  kind: Type.Literal("cat"),
  name: Type.String(),
  lives: Type.Number(),
  owner: Type.Optional(Type.String()),
});
const Dog = Type.Object({
  id: Type.String(),
  kind: Type.Literal("dog"),
  name: Type.String(),
  lives: Type.Optional(Type.Number()),
  owner: Type.Optional(Type.String()),
});
const PetTable = new Table(DiscriminatedUnion("kind", [Cat, Dog]), {
  name: "required_removal_pets",
  partitionKey: "id",
  billingMode: "PAY_PER_REQUEST",
});

const db = createDb();
const docs = db.makeRepo(DocTable, {
  computedAttributes: {
    ab: { from: ["a", "b"], compute: (a, b) => (a && b ? `${a}-${b}` : undefined) },
  },
});
const pets = db.makeRepo(PetTable);
const removingDb = createDb({ updateUndefinedBehavior: "$remove" });
const removingDocs = removingDb.makeRepo(DocTable);

beforeAll(async () => {
  for (const t of [DocTable, PetTable]) {
    await db.deleteTable(t.def.name).catch(() => {});
    await db.createTable(t);
  }
});

afterAll(async () => {
  for (const t of [DocTable, PetTable]) await db.deleteTable(t.def.name).catch(() => {});
});

const rejects = (p: Promise<unknown>, field: string) =>
  expect(p).rejects.toSatisfy(
    (e) =>
      e instanceof DinahError &&
      e.details.type === "VALIDATION" &&
      e.message.includes(`"${field}" is required`),
  );

describe("removing a required field", () => {
  test("patch / createOrPatch", async () => {
    await docs.create({ id: "d1", title: "t", body: "b" });
    await rejects(docs.patch({ id: "d1" }, { title: undefined }), "title");
    await rejects(
      docs.createOrPatch({ id: "d1", title: "t" }, () => ({ title: undefined })),
      "title",
    );
    expect(await docs.patch({ id: "d1" }, { body: undefined })).toEqual({ id: "d1", title: "t" });
  });

  test("update with $remove, and undefined under updateUndefinedBehavior: $remove", async () => {
    await docs.create({ id: "d2", title: "t", body: "b" });
    await rejects(docs.update({ id: "d2" }, { title: { $remove: true } }), "title");
    await rejects(removingDocs.update({ id: "d2" }, { title: undefined }), "title");
    await removingDocs.update({ id: "d2" }, { body: undefined });
    expect(await docs.get({ id: "d2" })).toEqual({ id: "d2", title: "t" });
  });

  test("batchUpdate and trxWrite", async () => {
    await docs.create({ id: "d3", title: "t", body: "b" });
    await rejects(docs.batchUpdate([{ id: "d3" }], { title: { $remove: true } }), "title");
    expect(() => docs.trxUpdateRequest({ id: "d3" }, { title: { $remove: true } })).toThrow(
      /"title" is required/,
    );
    await docs.trxWrite(docs.trxUpdateRequest({ id: "d3" }, { body: { $remove: true } }));
    expect(await docs.get({ id: "d3" })).toEqual({ id: "d3", title: "t" });
  });

  test("dinah's own computed-attribute removals still work", async () => {
    await docs.create({ id: "d4", title: "t", a: "x", b: "y" });
    expect((await docs.get({ id: "d4" })).ab).toBe("x-y");
    const result = await docs.patch({ id: "d4" }, { a: undefined });
    expect(result).toEqual({ id: "d4", title: "t", b: "y" });
  });
});

describe("discriminated unions", () => {
  test("patch uses the stored variant", async () => {
    await pets.create({ id: "p1", kind: "cat", name: "c", lives: 9 });
    await pets.create({ id: "p2", kind: "dog", name: "d", lives: 1 });
    await rejects(pets.patch({ id: "p1" }, { lives: undefined }), "lives");
    expect(await pets.patch({ id: "p2" }, { lives: undefined })).toEqual({
      id: "p2",
      kind: "dog",
      name: "d",
    });
  });

  test("patch uses the new variant when it changes the discriminator", async () => {
    await pets.create({ id: "p3", kind: "cat", name: "c", lives: 9 });
    expect(await pets.patch({ id: "p3" }, { kind: "dog", lives: undefined })).toEqual({
      id: "p3",
      kind: "dog",
      name: "c",
    });
  });

  test("update uses the variant in the key or update, else fields required by every variant", async () => {
    await pets.create({ id: "p4", kind: "dog", name: "d", lives: 1 });
    await rejects(pets.update({ id: "p4", kind: "cat" }, { lives: { $remove: true } }), "lives");
    await rejects(pets.update({ id: "p4" }, { name: { $remove: true } }), "name");
    // Unknown variant: `lives` isn't required by every variant, so it's allowed.
    await pets.update({ id: "p4" }, { lives: { $remove: true } });
    await pets.update({ id: "p4", kind: "dog" }, { owner: { $remove: true } });
    expect(await pets.get({ id: "p4" })).toEqual({ id: "p4", kind: "dog", name: "d" });
  });
});

describe("stored null", () => {
  test("patch conditions on a field holding NULL", async () => {
    await docs.create({ id: "n1", title: "t", note: null });
    expect(await docs.get({ id: "n1" })).toEqual({ id: "n1", title: "t", note: null });
    expect(await docs.patch({ id: "n1" }, { note: "x", title: "u" })).toEqual({
      id: "n1",
      title: "u",
      note: "x",
    });
    await docs.patch({ id: "n1" }, { note: null });
    expect(await docs.patch({ id: "n1" }, { note: undefined, body: "b" })).toEqual({
      id: "n1",
      title: "u",
      body: "b",
    });
  });
});
