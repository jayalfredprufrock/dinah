import {
  type _Record,
  DescribeStreamCommand,
  type DynamoDBStreams,
  GetRecordsCommand,
  GetShardIteratorCommand,
  ResourceNotFoundException,
  type Shard,
  type ShardIteratorType,
  TrimmedDataAccessException,
} from "@aws-sdk/client-dynamodb-streams";

export class EventStreamer {
  readonly client: DynamoDBStreams;
  readonly streamArn: string;

  private pollTimer: NodeJS.Timeout | undefined;

  // a map of shard ids to shards
  protected shards = new Map<string, { shard: Shard; iterator?: string }>();

  constructor(client: DynamoDBStreams, streamArn: string) {
    this.client = client;
    this.streamArn = streamArn;
  }

  protected async syncShards(
    iteratorType?: ShardIteratorType,
    sequenceNumber?: string,
  ): Promise<void> {
    // TODO: technically this will only return a maximum of 100 shards, pagination is required otherwise
    // DescribeStream can only be called 10 times per second
    // Closed streams can be returned, and will contain a EndingSequenceNumber
    const { StreamDescription } = await this.client.send(
      new DescribeStreamCommand({ StreamArn: this.streamArn }),
    );

    const availableShards = StreamDescription?.Shards ?? [];

    const newShards = availableShards.filter(
      (shard) => shard.ShardId && !this.shards.has(shard.ShardId),
    );

    // TODO: is this safe to process in parallel? Probably since its unlikely a large number
    // of shards would show up out of nowhere, but consider batching...
    await Promise.all(
      newShards.map(async (shard) => {
        // TODO: handle TrimmedDataAccessException which can happen if a sequence
        // number outside the 24hr sliding window is specified or the shard iterator
        // goes unused for 24 hrs (shouldn't be possible with this library)
        const { ShardIterator } = await this.client.send(
          new GetShardIteratorCommand({
            StreamArn: this.streamArn,
            ShardIteratorType: iteratorType ?? "LATEST",
            ShardId: shard.ShardId,
            SequenceNumber: sequenceNumber,
          }),
        );

        this.shards.set(shard.ShardId!, { shard, iterator: ShardIterator });
      }),
    );

    // clear out any shards that are no longer returned
    for (const shardId in this.shards.keys()) {
      const availableShard = availableShards.find((shard) => shard.ShardId === shardId);
      if (!availableShard) {
        this.shards.delete(shardId);
      }
    }
  }

  protected async getShardRecords(shardId: string): Promise<_Record[]> {
    const shard = this.shards.get(shardId);
    if (!shard?.iterator) return [];

    const data = await this.client
      .send(
        new GetRecordsCommand({
          ShardIterator: shard.iterator,
        }),
      )
      .catch((e) => {
        // we need to handle this case gracefully because of a quirk with dynamodb-local shard creation
        if (e instanceof ResourceNotFoundException || e instanceof TrimmedDataAccessException) {
          return { Records: [], NextShardIterator: undefined };
        }

        throw e;
      });

    shard.iterator = data.NextShardIterator;

    return data.Records ?? [];
  }

  protected async processStream(): Promise<void> {
    await this.syncShards("TRIM_HORIZON");

    // topologically sort shard ids (parents come before children)
    // TODO: this could be optimized, but probably isn't worth it
    const sortedShardIds: string[] = [];
    while (sortedShardIds.length !== this.shards.size) {
      let shardAdded = false;
      this.shards.forEach(({ shard }, shardId) => {
        if (sortedShardIds.includes(shardId)) return;
        if (shard.ParentShardId && !sortedShardIds.includes(shard.ParentShardId)) return;

        sortedShardIds.push(shardId);
        shardAdded = true;
      });

      // this check is just to avoid an infinite loop and should
      // never happen if the API behaves as documented
      if (!shardAdded) {
        console.warn("Failed to topologically sort shards.");
        break;
      }
    }

    // TODO: we could potentitally fetch shard records in parallel
    let recordCount = 0;
    for (const shardId of sortedShardIds) {
      const records = await this.getShardRecords(shardId);
      recordCount += records.length;
    }

    console.log(`Found ${recordCount} records across ${sortedShardIds.length} shards.`);
  }

  startPolling(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.processStream().then(() => {
        if (this.pollTimer) this.startPolling();
      });
    }, 5000);
  }

  stopPolling(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }
}
