// @ts-nocheck
import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { DiscriminatedUnion, IsDiscriminatedUnion, Table } from "../src";
import { createDb } from "./setup";

const Cat = Type.Object({ id: Type.String(), kind: Type.Literal("cat"), meow: Type.String() });
const Dog = Type.Object({ id: Type.String(), kind: Type.Literal("dog"), bark: Type.Number() });

const PetTable = new Table(DiscriminatedUnion("kind", [Cat, Dog]), {
  name: "discriminator_pets",
  partitionKey: "id",
  billingMode: "PAY_PER_REQUEST",
});

const db = createDb();
const repo = db.makeRepo(PetTable);

beforeAll(async () => {
  await db.deleteTable(PetTable.def.name).catch(() => {});
  await db.createTable(PetTable);
});

afterAll(async () => {
  await db.deleteTable(PetTable.def.name).catch(() => {});
});

describe("DiscriminatedUnion", () => {
  test("flattens variant groups into one flat anyOf", () => {
    const Fish = Type.Object({ id: Type.String(), kind: Type.Literal("fish") });
    const Pet = DiscriminatedUnion("kind", [Type.Union([Cat, Dog]), Fish]);
    expect(Pet.anyOf).toEqual([Cat, Dog, Fish]);
    expect(Pet.discriminator).toEqual({ propertyName: "kind" });
  });
});

describe("IsDiscriminatedUnion", () => {
  test("reads the annotation, ignores plain unions and objects", () => {
    expect(IsDiscriminatedUnion(PetTable.schema)).toBe(true);
    expect(IsDiscriminatedUnion(Type.Union([Cat, Dog]))).toBe(false);
    expect(IsDiscriminatedUnion(Cat)).toBe(false);
  });
});

describe("update guard from schema discriminator", () => {
  test("rejects an update whose key names a different variant", async () => {
    await repo.create({ id: "p1", kind: "cat", meow: "soft" });
    await expect(repo.update({ id: "p1", kind: "dog" }, { bark: 3 })).rejects.toThrow();
    expect(await repo.get({ id: "p1" })).toEqual({ id: "p1", kind: "cat", meow: "soft" });
  });

  test("allows an update whose key names the stored variant", async () => {
    await repo.update({ id: "p1", kind: "cat" }, { meow: "loud" });
    expect((await repo.get({ id: "p1" })).meow).toBe("loud");
  });
});
