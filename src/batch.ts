/**
 * Shared machinery for `batchGet` / `batchWrite` / `batchUpdate`.
 *
 * DynamoDB reports *partial* throttling as an HTTP 200 with the leftovers in
 * `UnprocessedItems` / `UnprocessedKeys` (or a per-statement `Error` for
 * PartiQL). The AWS SDK's retry strategy only sees a successful response, so
 * its backoff never engages and this is the one throttling case a client has
 * to handle itself. Whole-request throttles are already retried by the SDK
 * with jittered exponential backoff — we deliberately do not layer a second
 * backoff over that.
 */

/**
 * Requests in flight at once. Serial by default.
 *
 * Parallelism is a real win for single-process bulk jobs (an operator CLI, a
 * seed), but the library can't tell those apart from a workload that already
 * has concurrency above it. A Lambda consuming a stream or queue is already
 * running N invocations against the same table; making each one fan out 5x
 * multiplies the request rate against that table without adding throughput the
 * platform wasn't already providing. Callers who know they're the only writer
 * opt in — see `Seed.put`, which does exactly that.
 */
export const DEFAULT_BATCH_PARALLEL = 1;

/**
 * Consecutive passes that accept *zero* items before giving up. Combined with
 * the backoff below this is up to ~45s of retrying before a table is declared
 * unable to accept the write. Lower it when the caller has a shorter deadline
 * than that — a Lambda killed mid-retry loses the `unprocessed` result
 * entirely, which is worse than being told about it.
 */
export const DEFAULT_BATCH_MAX_STALLS = 10;

/**
 * Base backoff delay. Lower than the SDK's 500ms throttling base because a
 * partial throttle is a weaker signal than a 429, and this delay is paid once
 * per pass in a loop that may run many passes.
 */
export const DEFAULT_BATCH_BASE_DELAY = 50;

/** Matches the SDK's `MAXIMUM_RETRY_DELAY`. */
const MAX_BATCH_DELAY = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Full-jitter exponential backoff, mirroring the shape of the AWS SDK's own
 * `DefaultRetryBackoffStrategy`: a random point in `[0, min(base * 2^n, cap))`.
 * Jitter is what keeps concurrent workers from retrying in lockstep.
 */
export const batchBackoffDelay = (attempt: number, base = DEFAULT_BATCH_BASE_DELAY): number =>
  Math.floor(Math.random() * Math.min(base * 2 ** attempt, MAX_BATCH_DELAY));

export interface BatchRunOptions {
  /**
   * DynamoDB's hard per-request maximum — 25 for writes/statements, 100 for
   * gets. Also the default chunk size, and the ceiling `chunkSize` is clamped to.
   */
  limit: number;
  /** Caller override for items per request. Clamped to `[1, limit]`. */
  chunkSize?: number;
  /** Max requests in flight. Defaults to {@link DEFAULT_BATCH_PARALLEL}. */
  parallel?: number;
  /** Consecutive zero-progress passes tolerated before returning leftovers. */
  maxStalls?: number;
  /** Base backoff delay in ms. */
  baseDelay?: number;
}

/**
 * Drives a batch operation to completion, returning whatever could not be
 * processed.
 *
 * Work is drained in *passes*. Within a pass, up to `parallel` requests are in
 * flight and each chunk is sent exactly once; anything the service hands back
 * is held aside rather than immediately re-sent, so a retry always costs a
 * backoff delay instead of spinning.
 *
 * Termination is based on progress, not attempts: a pass that accepts even one
 * item resets the stall counter, so a large job under steady mild throttling
 * runs to completion. Only passes that accept *nothing* count against the
 * budget, and since every other pass strictly reduces the remaining work, the
 * loop always terminates.
 *
 * Chunk size is constant. Shrinking it doesn't reduce the capacity consumed —
 * the same items still land on the same partitions — so backoff, not a smaller
 * batch, is the control for throttling.
 *
 * The exception is items large enough that the table accepts fewer than a full
 * chunk per call (above roughly 160KB, given typical per-request capacity).
 * There the rejected remainder is re-uploaded on the next pass, wasting
 * bandwidth — ~2.5x at 400KB items, ~5x on a tightly capped table. Round-trip
 * count is unaffected, since how many items land per call is set by the table's
 * capacity rather than by our chunk size.
 *
 * A caller who knows their item size can set `chunkSize` to the number the
 * table actually accepts and recover all of it, which is why this adapts on
 * request rather than automatically: a static value chosen by someone who knows
 * the workload beats a heuristic guessing from unprocessed counts, and it keeps
 * sizing free of the retry state that made the previous implementation degrade
 * permanently after a single throttle.
 */
export async function runBatched<T>(
  items: T[],
  send: (chunk: T[]) => Promise<T[]>,
  {
    limit,
    chunkSize,
    parallel = DEFAULT_BATCH_PARALLEL,
    maxStalls = DEFAULT_BATCH_MAX_STALLS,
    baseDelay = DEFAULT_BATCH_BASE_DELAY,
  }: BatchRunOptions,
): Promise<T[]> {
  // Clamped rather than validated: a chunk above the API maximum is rejected
  // outright by DynamoDB, and there's nothing useful to do with 0 or NaN. Both
  // values are guarded because this helper is exported, so an untyped caller
  // could otherwise land on a NaN chunk and silently process nothing.
  const cap = Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 1));
  const size = Number.isFinite(chunkSize)
    ? Math.min(Math.max(1, Math.trunc(chunkSize as number)), cap)
    : cap;

  let pending = items;
  let stalls = 0;

  while (pending.length && stalls < maxStalls) {
    const current = pending;
    const retry: T[] = [];
    let cursor = 0;
    let unprocessed = 0;

    // Workers share a cursor rather than splicing off the front, so draining a
    // large queue stays linear. Reading and advancing the cursor is a single
    // synchronous step, so concurrent workers can't claim the same chunk.
    const worker = async (): Promise<void> => {
      while (cursor < current.length) {
        const chunk = current.slice(cursor, cursor + size);
        cursor += chunk.length;

        const left = await send(chunk);
        if (left.length) {
          unprocessed += left.length;
          retry.push(...left);
        }
      }
    };

    const workerCount = Math.max(1, Math.min(parallel, Math.ceil(current.length / size)));
    const settled = await Promise.allSettled(Array.from({ length: workerCount }, worker));

    // `allSettled` rather than `all` so a rejection doesn't leave the other
    // workers' failures unhandled. The first error still propagates.
    const failure = settled.find((r) => r.status === "rejected");
    if (failure) throw failure.reason;

    if (!retry.length) return [];

    stalls = unprocessed < current.length ? 0 : stalls + 1;
    pending = retry;

    if (stalls >= maxStalls) break;

    await sleep(batchBackoffDelay(stalls, baseDelay));
  }

  return pending;
}
