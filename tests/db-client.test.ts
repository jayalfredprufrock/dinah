import { DynamoDB, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, test } from "vite-plus/test";
import { Db } from "../src";

// Every field of DynamoDBClientConfig is optional, so any object is assignable
// to the config branch of the constructor's union. That makes these runtime
// instance checks the only thing keeping a passed-in client from being treated
// as a bag of config — which silently produced a default client pointed at the
// wrong region with no credentials.

const settings = async (db: Db) => {
  const { config } = db.client;
  const endpoint = config.endpoint ? await config.endpoint() : undefined;
  return {
    region: await config.region(),
    maxAttempts: await config.maxAttempts(),
    endpoint: endpoint && `${endpoint.hostname}:${endpoint.port}`,
    accessKeyId: (await config.credentials()).accessKeyId,
  };
};

const configured = {
  region: "eu-west-2",
  endpoint: "http://localhost:8000",
  maxAttempts: 7,
  credentials: { accessKeyId: "AAA", secretAccessKey: "BBB" },
};

describe("Db constructor", () => {
  test("preserves the configuration of a DynamoDBClient", async () => {
    const db = new Db(new DynamoDBClient(configured));

    await expect(settings(db)).resolves.toEqual({
      region: "eu-west-2",
      maxAttempts: 7,
      endpoint: "localhost:8000",
      accessKeyId: "AAA",
    });
  });

  test("preserves the configuration of an aggregated DynamoDB client", async () => {
    const db = new Db(new DynamoDB(configured));

    await expect(settings(db)).resolves.toMatchObject({
      region: "eu-west-2",
      maxAttempts: 7,
    });
  });

  test("adopts an existing DynamoDBDocumentClient rather than re-wrapping it", async () => {
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient(configured), {
      marshallOptions: { removeUndefinedValues: true },
    });
    const db = new Db(doc);

    // Same instance: re-wrapping would double up the marshalling middleware and
    // drop the caller's translateConfig.
    expect(db.client).toBe(doc);
    await expect(settings(db)).resolves.toMatchObject({ region: "eu-west-2", maxAttempts: 7 });
  });

  test("still builds a client from a plain config object", async () => {
    const db = new Db(configured);

    await expect(settings(db)).resolves.toEqual({
      region: "eu-west-2",
      maxAttempts: 7,
      endpoint: "localhost:8000",
      accessKeyId: "AAA",
    });
  });

  test("normalizes an empty-string endpoint, so DYNAMODB_ENDPOINT='' is harmless", async () => {
    const db = new Db({ ...configured, endpoint: "" });

    await expect(settings(db)).resolves.toMatchObject({ endpoint: undefined });
  });
});
