import { Redis } from "ioredis";

import { large, promiseOperation, small } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";

export const ioredis = async (input: Input) => {
  const client = new Redis({
    host: "127.0.0.1",
    port: input.port,
    lazyConnect: true,
    enableOfflineQueue: false,
    enableAutoPipelining: false,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    commandTimeout: 10_000,
  });
  let failure: Error | undefined;
  client.on("error", (error: Error) => {
    failure = error;
  });

  try {
    await client.connect();
    const key = `${input.prefix}small`;
    await client.set(key, small);
    await client.set(`${input.prefix}large`, large);
    await client.set(`${input.prefix}counter`, "0");

    const command = () => {
      switch (input.workload) {
        case "get-256b-c1":
        case "get-256b-c32":
          return client.getBuffer(key);
        case "get-64k-c8":
          return client.getBuffer(`${input.prefix}large`);
        case "set-256b-c16":
          return client.set(`${input.prefix}write`, small);
        case "incr-c16":
          return client.incr(`${input.prefix}counter`);
        default: {
          const batch = input.workload === "pipeline-32-c4" ? client.pipeline() : client.multi();
          for (let index = 0; index < (input.workload === "pipeline-32-c4" ? 32 : 8); index++)
            batch.getBuffer(key);
          return batch.exec().then((replies) => {
            if (replies === null) throw new Error("Unexpected aborted batch");
            return replies.map(([error, value]) => {
              if (error !== null) throw error;
              return value;
            });
          });
        }
      }
    };

    return promiseOperation(
      input,
      () => {
        if (failure !== undefined) return Promise.reject(failure);
        return command();
      },
      async () => {
        client.disconnect();
      },
      {
        protocol: "resp2",
        automaticPipelining: false,
        offlineQueue: false,
        reconnect: false,
      },
    );
  } catch (cause) {
    client.disconnect();
    throw cause;
  }
};
