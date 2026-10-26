import assert from "node:assert/strict";

import { Effect } from "effect";

import type { RespValue } from "#/protocol/RespValue";
import type { Client } from "#test/runners/conformance/Client";

const text = (value: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(value);

export const inventory = Effect.fnUntraced(function* ({ raw, policy }: Client) {
  const reply = yield* raw(["COMMAND"]);
  assert.equal(reply._tag, "Array");
  if (reply._tag !== "Array") return yield* Effect.die("Expected command inventory");

  const names: string[] = [];
  for (const command of reply.values) {
    if (command._tag === "Null") {
      assert.equal(policy.engine, "garnet");
      continue;
    }
    assert.equal(command._tag, "Array");
    if (command._tag !== "Array") return yield* Effect.die("Malformed command inventory entry");
    const name = command.values[0];
    assert.ok(name?._tag === "BlobString" || name?._tag === "SimpleString");
    names.push(text(name.value).toUpperCase());
  }
  const commands = names.toSorted();
  assert.ok(commands.includes("GET") && commands.includes("SET"));
  assert.equal(commands.includes("XADD"), policy.engine !== "garnet");
  assert.equal(commands.includes("JSON.GET"), ["dragonfly", "kvrocks"].includes(policy.engine));

  const modulesReply = yield* raw(["MODULE", "LIST"]);
  const modules: Array<{ name: string; version: string }> = [];
  const moduleInventory = ["garnet", "kvrocks"].includes(policy.engine)
    ? ("unavailable" as const)
    : ("listed" as const);
  if (moduleInventory === "unavailable") {
    assert.equal(modulesReply._tag, "SimpleError");
    if (modulesReply._tag !== "SimpleError")
      return yield* Effect.die("Expected MODULE LIST rejection");
    assert.match(text(modulesReply.value), /^ERR.*(?:unknown command|unknown subcommand)/i);
  } else {
    assert.equal(modulesReply._tag, "Array");
    if (modulesReply._tag !== "Array") return yield* Effect.die("Expected module inventory");
    for (const entry of modulesReply.values) {
      assert.equal(entry._tag, "Array");
      if (entry._tag !== "Array") return yield* Effect.die("Malformed module inventory entry");
      let name: string | undefined;
      let version: string | undefined;
      for (let index = 0; index < entry.values.length; index += 2) {
        const field = entry.values[index];
        const value: RespValue | undefined = entry.values[index + 1];
        assert.ok(field?._tag === "BlobString" || field?._tag === "SimpleString");
        if (text(field.value) === "name") {
          assert.ok(value?._tag === "BlobString" || value?._tag === "SimpleString");
          name = text(value.value);
        }
        if (text(field.value) === "ver") {
          assert.equal(value?._tag, "Integer");
          if (value?._tag === "Integer") version = String(value.value);
        }
      }
      assert.ok(name !== undefined && version !== undefined);
      modules.push({ name, version });
    }
  }

  // The digest binds the complete observed command-name set, not a claim about option/semantic parity.
  const hash = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(commands))),
  );
  return { commands, commandDigest: Buffer.from(hash).toString("hex"), moduleInventory, modules };
});
