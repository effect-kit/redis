import { expect, it } from "vitest";

import { RedisProfiles } from "#/index";
import { commandPolicy } from "#/profiles/Commands";

it("Garnet rejects ignored NOSCORES flags without mistaking keys or MATCH values for options", () => {
  const policy = commandPolicy(RedisProfiles.garnet());
  expect(policy(["ZSCAN", "key", "0", "NOSCORES"])).toMatchObject({
    _tag: "ProfileError",
    delivery: "unsent",
    reason: "restricted-command",
  });
  expect(
    policy(["zscan", "key", "0", "COUNT", "5", new TextEncoder().encode("noscores")])?.reason,
  ).toBe("restricted-command");
  expect(policy(["ZSCAN", "NOSCORES", "0", "MATCH", "NOSCORES"])).toBeUndefined();
  expect(commandPolicy(RedisProfiles.valkey())(["ZSCAN", "key", "0", "NOSCORES"])).toBeUndefined();
});

it("two-token restrictions preserve permitted sibling operations and binary token spelling", () => {
  const policy = commandPolicy(
    RedisProfiles.memorystoreValkey({
      routing: "standalone",
      authentication: "optional",
      tls: "optional",
    }),
  );
  expect(policy([new TextEncoder().encode("client"), "unblock", "1"])?.reason).toBe(
    "restricted-command",
  );
  expect(policy(["CLIENT", "SETNAME", "application"])).toBeUndefined();
  expect(policy(["CONFIG", "GET", "save"])).toBeUndefined();
  expect(policy(["CONFIG", "SET", "save", ""])?.reason).toBe("restricted-command");
});

it("engine and user-specific restrictions do not become provider-wide denials", () => {
  const redis = commandPolicy(
    RedisProfiles.elasticache({
      engine: "redis",
      deployment: "replication-group",
      routing: "standalone",
      authentication: "password",
    }),
  );
  const valkey = commandPolicy(
    RedisProfiles.elasticache({
      engine: "valkey",
      deployment: "replication-group",
      routing: "standalone",
      authentication: "password",
    }),
  );
  expect(redis(["CONFIG", "GET", "save"])?.reason).toBe("restricted-command");
  expect(valkey(["CONFIG", "GET", "save"])).toBeUndefined();
  expect(
    commandPolicy(RedisProfiles.aivenValkey({ user: "default" }))(["ACL", "LIST"])?.reason,
  ).toBe("restricted-command");
  expect(
    commandPolicy(RedisProfiles.aivenValkey({ user: "custom" }))(["ACL", "LIST"]),
  ).toBeUndefined();
});

it("DigitalOcean restrictions retain scripts and topology-specific introspection", () => {
  const standalone = commandPolicy(RedisProfiles.digitalOceanValkey({ routing: "standalone" }));
  const cluster = commandPolicy(RedisProfiles.digitalOceanValkey({ routing: "cluster" }));
  expect(standalone(["MONITOR"])?.reason).toBe("restricted-command");
  expect(standalone(["COMMAND", "INFO", "GET"])?.reason).toBe("restricted-command");
  expect(cluster(["COMMAND", "INFO", "GET"])).toBeUndefined();
  expect(standalone(["SCRIPT", "LOAD", "return 1"])).toBeUndefined();
});

it("module gates keep provider vector dialects distinct and unknown commands server-owned", () => {
  const selected = commandPolicy(
    RedisProfiles.upstash({ transport: "http", modules: ["upstash-vector"] }),
  );
  expect(selected(["VECTOR.COUNT", "index"])).toBeUndefined();
  expect(selected(["VCARD", "index"])?.reason).toBe("module");
  expect(selected(["FUTURE.COMMAND", "index"])).toBeUndefined();
  const azure = commandPolicy(
    RedisProfiles.azureManagedRedis({ clustering: "oss", authentication: "password" }),
  );
  expect(azure(["FT.SEARCH", "index", "*"])?.reason).toBe("module");
});
