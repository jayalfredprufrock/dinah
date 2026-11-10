import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { Db, batchBackoffDelay, runBatched } from "../src";

// DynamoDB Local never returns `UnprocessedItems`, so the partial-throttle path
// can't be exercised against the emulator at all. Stubbing `db.client` covers
// every branch deterministically and without Docker.

interface Call {
  size: number;
  items: unknown[];
}

/**
 * A `Db` whose transport is a scripted fake. `respond` receives the zero-based
 * call index and the write requests in that chunk, and returns the subset the
 * "service" refused to process.
 */
function fakeDb(respond: (call: number, chunk: any[]) => any[]) {
  const calls: Call[] = [];
  const db = new Db({
    region: "us-east-1",
    endpoint: "http://localhost:1",
    credentials: { accessKeyId: "t", secretAccessKey: "t" },
  });

  (db as any).client = {
    send: async (cmd: any) => {
      const chunk = cmd.input.RequestItems.t as any[];
      const unprocessed = respond(calls.length, chunk);
      calls.push({ size: chunk.length, items: chunk });
      return unprocessed.length ? { UnprocessedItems: { t: unprocessed } } : {};
    },
  };

  return { db, calls };
}

const puts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ type: "PUT" as const, item: { id: `i${i}` } }));

const written = (calls: Call[]) => {
  const ids = new Set<string>();
  for (const call of calls) {
    for (const req of call.items as any[]) ids.add(req.PutRequest.Item.id);
  }
  return ids;
};

// Backoff sleeps for real, so `Math.random` is pinned to 0, making every
// jittered delay 0. Fake timers can't be used here: the loop awaits a real
// `setTimeout` between passes, so a mocked clock that nothing advances
// deadlocks it.
beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("batch retry loop", () => {
  test("mild partial throttling does not abandon the rest of the job", async () => {
    // One item refused out of every full batch. This is the regression that
    // mattered most: the old loop spent its whole retry budget on calls that
    // were 96% successful and silently dropped 880 of 1000 items.
    const { db, calls } = fakeDb((_call, chunk) => (chunk.length > 1 ? [chunk[0]] : []));

    const result = await db.batchWrite({ t: puts(1000) });

    expect(result.unprocessed).toBeUndefined();
    expect(written(calls).size).toBe(1000);
    expect(calls.length).toBeLessThan(50);
  });

  test("a single early partial failure does not degrade the rest of the job", async () => {
    // Batch size is constant now, so one blip costs one extra round trip
    // rather than permanently halving throughput.
    const { db, calls } = fakeDb((call, chunk) => (call === 0 ? chunk : []));

    await db.batchWrite({ t: puts(1000) });

    expect(calls.length).toBe(41); // 40 chunks of 25, plus the one retry
    expect(new Set(calls.map((c) => c.size))).toEqual(new Set([25]));
  });

  test("alternating throttling still completes in a sane number of calls", async () => {
    // Previously 1,956 calls for 1,000 items, because batch size ratcheted to 1
    // and never recovered.
    const { db, calls } = fakeDb((call, chunk) => (call % 2 === 0 ? chunk : []));

    const result = await db.batchWrite({ t: puts(1000) });

    expect(result.unprocessed).toBeUndefined();
    expect(calls.length).toBeLessThan(100);
  });

  test("gives up only after consecutive zero-progress passes, and reports leftovers", async () => {
    const { db, calls } = fakeDb((_call, chunk) => chunk);

    const result = await db.batchWrite({ t: puts(100) });

    // 4 chunks per pass * 10 stall passes; nothing is lost, it's all returned.
    expect(calls.length).toBe(40);
    expect(result.unprocessed?.t).toHaveLength(100);
  });

  test("retries are paced by backoff rather than spun", async () => {
    const { db } = fakeDb((_call, chunk) => chunk);
    vi.mocked(Math.random).mockReturnValue(0.5);

    const start = Date.now();
    await db.batchWrite({ t: puts(25) }, { maxAttempts: 4 });
    const elapsed = Date.now() - start;

    // Full jitter means the delay is a random point in [0, base * 2^n), so this
    // asserts the loop sleeps at all rather than a precise duration. The old
    // busy loop finished 5 rounds in ~1ms.
    expect(elapsed).toBeGreaterThan(5);
  });

  test("is serial by default, and parallel is capped by the amount of work", async () => {
    let inFlight = 0;
    let peak = 0;
    const db = new Db({ region: "us-east-1", endpoint: "http://localhost:1" });
    (db as any).client = {
      send: async () => {
        peak = Math.max(peak, ++inFlight);
        await Promise.resolve();
        inFlight--;
        return {};
      },
    };

    // Serial default: a stream/queue consumer that already has concurrency
    // above it doesn't silently start fanning out on upgrade.
    await db.batchWrite({ t: puts(500) });
    expect(peak).toBe(1);

    peak = 0;
    await db.batchWrite({ t: puts(500) }, { parallel: 4 });
    expect(peak).toBe(4);

    // Capped by available work: 10 items is a single chunk.
    peak = 0;
    await db.batchWrite({ t: puts(10) }, { parallel: 4 });
    expect(peak).toBe(1);
  });

  test("propagates a transport error instead of silently returning leftovers", async () => {
    const { db } = fakeDb(() => {
      throw new Error("ResourceNotFoundException");
    });

    await expect(db.batchWrite({ t: puts(50) })).rejects.toThrow("ResourceNotFoundException");
  });
});

describe("batchWriteOrThrow", () => {
  test("throws with a per-table count when items are left unprocessed", async () => {
    const { db } = fakeDb((_call, chunk) => chunk);

    await expect(db.batchWriteOrThrow({ t: puts(25) })).rejects.toMatchObject({
      name: "DinahError",
      details: { type: "BATCH_UNPROCESSED", unprocessed: { t: 25 } },
    });
  });

  test("resolves when everything is written", async () => {
    const { db } = fakeDb(() => []);
    await expect(db.batchWriteOrThrow({ t: puts(60) })).resolves.toBeUndefined();
  });
});

describe("batchUpdate error classification", () => {
  function fakeUpdateDb(respond: (call: number, count: number) => any[]) {
    const calls: any[][] = [];
    const db = new Db({ region: "us-east-1", endpoint: "http://localhost:1" });
    (db as any).client = {
      send: async (cmd: any) => {
        const statements = cmd.input.Statements as any[];
        const responses = respond(calls.length, statements.length);
        calls.push(statements);
        return { Responses: responses };
      },
    };
    return { db, calls };
  }

  const keys = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));

  test("retries throttling errors", async () => {
    const { db, calls } = fakeUpdateDb((call, count) =>
      Array.from({ length: count }, (_, i) =>
        call === 0 && i === 0 ? { Error: { Code: "ThrottlingError" } } : {},
      ),
    );

    const result = await db.batchUpdate({ t: { keys: keys(5), update: { name: "x" } } });

    expect(result.unprocessed).toBeUndefined();
    expect(calls.length).toBe(2); // the throttled statement was retried
  });

  test("surfaces permanent errors instead of retrying and dropping them", async () => {
    const { db, calls } = fakeUpdateDb((_call, count) =>
      Array.from({ length: count }, (_, i) =>
        i === 0 ? { Error: { Code: "ValidationError", Message: "bad update" } } : {},
      ),
    );

    await expect(
      db.batchUpdate({ t: { keys: keys(5), update: { name: "x" } } }),
    ).rejects.toMatchObject({
      name: "DinahError",
      details: {
        type: "BATCH_FAILED",
        failures: [{ table: "t", key: { id: "i0" }, code: "ValidationError" }],
      },
    });

    expect(calls.length).toBe(1); // not retried
  });

  test("a failed conditional check is permanent, not transient", async () => {
    const { db } = fakeUpdateDb((_call, count) =>
      Array.from({ length: count }, () => ({ Error: { Code: "ConditionalCheckFailed" } })),
    );

    await expect(db.batchUpdate({ t: { keys: keys(2), update: { name: "x" } } })).rejects.toThrow(
      /permanent error \(ConditionalCheckFailed\)/,
    );
  });
});

describe("runBatched", () => {
  test("a pass that accepts anything resets the stall budget", async () => {
    let sends = 0;
    // Refuse everything but one item each pass: always progressing, never fast.
    const leftover = await runBatched<number>(
      Array.from({ length: 20 }, (_, i) => i),
      async (chunk) => {
        sends++;
        return chunk.slice(1);
      },
      { limit: 5, parallel: 1 },
    );

    expect(leftover).toEqual([]);
    expect(sends).toBeGreaterThan(10);
  });

  test("every item is sent exactly once per pass", async () => {
    const seen: number[] = [];
    await runBatched<number>(
      Array.from({ length: 97 }, (_, i) => i),
      async (chunk) => {
        seen.push(...chunk);
        return [];
      },
      { limit: 10, parallel: 4 },
    );

    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 97 }, (_, i) => i));
  });
});

describe("batchBackoffDelay", () => {
  test("is bounded by an exponentially growing cap", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      for (let i = 0; i < 50; i++) {
        const delay = batchBackoffDelay(attempt, 50);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(50 * 2 ** attempt);
      }
    }
  });

  test("never exceeds the SDK's 20s ceiling", () => {
    for (let i = 0; i < 100; i++) {
      expect(batchBackoffDelay(40, 50)).toBeLessThanOrEqual(20_000);
    }
  });
});

describe("batchGet response-size truncation", () => {
  // `batchGet` chunks 100 keys per request, but DynamoDB also caps a response at
  // 16MB — so with large items a full chunk comes back truncated, with the rest
  // in `UnprocessedKeys`. That is *not* throttling, and unlike `batchWrite`
  // (25 x 400KB = 10MB, under the cap) it's reachable. This is the case the
  // long-standing "test wildly different item sizes" TODO was about.
  //
  // It can't be pre-empted by sizing the chunk: a get only holds keys, so the
  // response size is unknowable until it arrives. What matters is that the loop
  // converges, keeps making progress, and still returns items in input order.
  function fakeGetDb(maxItemsPerResponse: number) {
    const calls: number[] = [];
    const db = new Db({ region: "us-east-1", endpoint: "http://localhost:1" });

    (db as any).client = {
      send: async (cmd: any) => {
        const keys = cmd.input.RequestItems.t.Keys as { id: string }[];
        calls.push(keys.length);

        const fits = keys.slice(0, maxItemsPerResponse);
        const overflow = keys.slice(maxItemsPerResponse);

        return {
          Responses: { t: fits.map((k) => ({ id: k.id, size: "big" })) },
          ...(overflow.length ? { UnprocessedKeys: { t: { Keys: overflow } } } : {}),
        };
      },
    };

    return { db, calls };
  }

  const keys = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}` }));

  test("converges without stalling when every response is truncated", async () => {
    // 40 items per response models ~400KB items against the 16MB cap.
    const { db, calls } = fakeGetDb(40);

    const result = await db.batchGet({ t: { keys: keys(250) } });

    expect(result.unprocessed).toBeUndefined();
    expect(result.items.t).toHaveLength(250);
    // Every pass makes progress, so the stall budget is never touched.
    expect(calls.length).toBeLessThan(12);
  });

  test("preserves input order despite truncation and parallelism", async () => {
    const { db } = fakeGetDb(7);

    const input = keys(300);
    const result = await db.batchGet({ t: { keys: input } }, { parallel: 4 });

    expect(result.items.t).toHaveLength(300);
    expect(result.items.t?.map((i: any) => i.id)).toEqual(input.map((k) => k.id));
  });

  test("a response that fits is a single round trip", async () => {
    const { db, calls } = fakeGetDb(100);

    await db.batchGet({ t: { keys: keys(100) } });
    expect(calls).toEqual([100]);
  });
});

describe("chunkSize", () => {
  const sizes = async (n: number, options?: Record<string, unknown>) => {
    const { db, calls } = fakeDb(() => []);
    await db.batchWrite({ t: puts(n) }, options as never);
    return calls.map((c) => c.size);
  };

  test("defaults to the API maximum", async () => {
    await expect(sizes(60)).resolves.toEqual([25, 25, 10]);
  });

  test("can be lowered for consistently large items", async () => {
    // The point of the option: at ~400KB an item, a 25-item chunk exceeds what
    // the table accepts per call and the remainder is re-uploaded next pass.
    await expect(sizes(30, { chunkSize: 10 })).resolves.toEqual([10, 10, 10]);
  });

  test("is clamped to the API maximum, which DynamoDB would otherwise reject", async () => {
    await expect(sizes(60, { chunkSize: 500 })).resolves.toEqual([25, 25, 10]);
  });

  test("is clamped to at least one, and ignores nonsense", async () => {
    await expect(sizes(3, { chunkSize: 0 })).resolves.toEqual([1, 1, 1]);
    await expect(sizes(3, { chunkSize: -5 })).resolves.toEqual([1, 1, 1]);
    await expect(sizes(3, { chunkSize: 2.7 })).resolves.toEqual([2, 1]);
    await expect(sizes(60, { chunkSize: Number.NaN })).resolves.toEqual([25, 25, 10]);
  });

  test("batchGet has its own, higher maximum", async () => {
    const { db, calls } = fakeGetKeyCounts();
    await db.batchGet({ t: { keys: Array.from({ length: 250 }, (_, i) => ({ id: `k${i}` })) } });
    expect(calls).toEqual([100, 100, 50]);

    const second = fakeGetKeyCounts();
    await second.db.batchGet(
      { t: { keys: Array.from({ length: 250 }, (_, i) => ({ id: `k${i}` })) } },
      { chunkSize: 1000 },
    );
    expect(second.calls).toEqual([100, 100, 50]);
  });

  function fakeGetKeyCounts() {
    const calls: number[] = [];
    const db = new Db({ region: "us-east-1", endpoint: "http://localhost:1" });
    (db as any).client = {
      send: async (cmd: any) => {
        const keys = cmd.input.RequestItems.t.Keys as { id: string }[];
        calls.push(keys.length);
        return { Responses: { t: keys.map((k) => ({ id: k.id })) } };
      },
    };
    return { db, calls };
  }
});
