import { createClient, RESP_TYPES } from "redis";

import { keySequence, smallKeys } from "#test/runners/benchmarks/Fixtures";
import { large, promiseOperation, small } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";

export const nodeRedis = async (input: Input) => {
  const client = createClient({
    socket: { host: "127.0.0.1", port: input.port, reconnectStrategy: false },
    RESP: 2,
    disableOfflineQueue: true,
    commandOptions: { timeout: 10_000 },
  }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
  let failure: Error | undefined;
  client.on("error", (error: Error) => {
    failure = error;
  });

  try {
    await client.connect();
    const key = `${input.prefix}small`;
    const keys = smallKeys(input);
    const nextKey = keySequence(keys);
    await Promise.all(keys.map((fixtureKey) => client.set(fixtureKey, small)));
    await client.set(`${input.prefix}large`, large);
    await client.set(`${input.prefix}counter`, "0");

    const command = () => {
      switch (input.workload) {
        case "get-256b-c1":
        case "get-256b-c32":
          return client.get(nextKey());
        case "get-64k-c8":
          return client.get(`${input.prefix}large`);
        case "set-256b-c16":
          return client.set(`${input.prefix}write`, small);
        case "incr-c16":
          return client.incr(`${input.prefix}counter`);
        default: {
          const batch = client.multi();
          for (let index = 0; index < (input.workload === "transaction-8-c1" ? 8 : 32); index++)
            batch.get(key);
          if (input.workload !== "transaction-8-c1") return batch.execAsPipeline();

          // This version omits the Buffer mapping on EXEC. Our fixed ASCII payload
          // can be restored losslessly; the conversion cost stays inside the measurement.
          return batch
            .exec()
            .then((replies) =>
              replies.map((reply: unknown) =>
                typeof reply === "string" ? Buffer.from(reply, "utf8") : reply,
              ),
            );
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
        if (client.isOpen) client.destroy();
      },
      {
        protocol: "resp2",
        automaticPipelining: true,
        transactionDecoding: "ASCII string to Buffer (measured)",
        offlineQueue: false,
        reconnect: false,
      },
    );
  } catch (cause) {
    if (client.isOpen) client.destroy();
    throw cause;
  }
};
