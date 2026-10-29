import { Batch, Decoder, GlideClient, ProtocolVersion } from "@valkey/valkey-glide";

import { large, promiseOperation, small } from "#test/runners/benchmarks/Operation";
import type { Input } from "#test/runners/benchmarks/Options";

export const glide = async (input: Input) => {
  const client = await GlideClient.createClient({
    addresses: [{ host: "127.0.0.1", port: input.port }],
    protocol: ProtocolVersion.RESP2,
    requestTimeout: 10_000,
  });

  try {
    const key = `${input.prefix}small`;
    await client.set(key, small);
    await client.set(`${input.prefix}large`, large);
    await client.set(`${input.prefix}counter`, "0");

    const command = () => {
      switch (input.workload) {
        case "get-256b-c1":
        case "get-256b-c32":
          return client.get(key, { decoder: Decoder.Bytes });
        case "get-64k-c8":
          return client.get(`${input.prefix}large`, { decoder: Decoder.Bytes });
        case "set-256b-c16":
          return client.set(`${input.prefix}write`, small);
        case "incr-c16":
          return client.incr(`${input.prefix}counter`);
        default: {
          const batch = new Batch(input.workload === "transaction-8-c1");
          for (let index = 0; index < (input.workload === "pipeline-32-c4" ? 32 : 8); index++)
            batch.get(key);
          return client.exec(batch, true, { decoder: Decoder.Bytes });
        }
      }
    };

    return promiseOperation(
      input,
      command,
      async () => {
        client.close();
      },
      {
        protocol: "resp2",
        automaticPipelining: "native multiplexing",
        reconnect: "GLIDE default",
      },
    );
  } catch (cause) {
    client.close();
    throw cause;
  }
};
