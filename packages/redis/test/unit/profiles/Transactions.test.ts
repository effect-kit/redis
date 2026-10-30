import { expect, it } from "vitest";

import { RedisProfiles } from "#/index";
import { canPipelineTransactions } from "#/profiles/Transactions";

it("only explicit standalone Redis and Valkey engine profiles enable queue/EXEC submission", () => {
  expect(canPipelineTransactions(RedisProfiles.redis())).toBe(true);
  expect(canPipelineTransactions(RedisProfiles.valkey())).toBe(true);

  for (const profile of [
    undefined,
    RedisProfiles.redis({ routing: "cluster" }),
    RedisProfiles.valkey({ routing: "sentinel" }),
    RedisProfiles.dragonfly(),
    RedisProfiles.redisCloud({ plan: "free", routing: "proxy", authentication: "password" }),
    { ...RedisProfiles.redis(), restrictedCommands: ["EXEC"] },
  ])
    expect(canPipelineTransactions(profile)).toBe(false);
});
