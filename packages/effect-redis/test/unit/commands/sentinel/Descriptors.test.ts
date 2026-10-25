import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import { decodeReply } from "#/command/Decode";
import * as Commands from "#/commands/sentinel/index";
import type { RespValue } from "#/protocol/RespValue";

const blob = (value: string): RespValue => ({
  _tag: "BlobString",
  value: new TextEncoder().encode(value),
});
const array = (...values: RespValue[]): RespValue => ({ _tag: "Array", values });

it.effect("Sentinel address replies distinguish unknown service and validate host/port", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.sentinelGetMasterAddrByName("cache").prepare;
    expect(prepared.tokens).toEqual(["SENTINEL", "GET-MASTER-ADDR-BY-NAME", "cache"]);
    expect(yield* decodeReply(prepared, array(blob("data"), blob("6379")))).toEqual(
      Option.some({ host: "data", port: 6379 }),
    );
    expect(yield* decodeReply(prepared, { _tag: "Null", kind: "array" })).toEqual(Option.none());

    for (const malformed of [
      array(blob(""), blob("6379")),
      array(blob("data"), blob("65536")),
      array(blob("data")),
    ]) {
      expect((yield* Effect.flip(decodeReply(prepared, malformed)))._tag).toBe("ReplyError");
    }
  }),
);

it.effect("peer vote epochs remain exact and parameter settings stay explicitly redacted", () =>
  Effect.gen(function* () {
    const peer = yield* Commands.sentinelIsMasterDownByAddr("data", 6379, 9007199254740993n, "*")
      .prepare;
    expect(peer.tokens).toEqual([
      "SENTINEL",
      "IS-MASTER-DOWN-BY-ADDR",
      "data",
      "6379",
      "9007199254740993",
      "*",
    ]);
    expect(
      yield* decodeReply(
        peer,
        array({ _tag: "Integer", value: 0n }, blob("*"), {
          _tag: "Integer",
          value: 9007199254740993n,
        }),
      ),
    ).toEqual([false, "*", 9007199254740993n]);

    const config = yield* Commands.sentinelConfigGet(["sentinel-pass"]).prepare;
    const result = yield* decodeReply(
      config,
      array(blob("sentinel-pass"), blob("synthetic-secret")),
    );
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    expect(Redacted.value(result)).toEqual([["sentinel-pass", "synthetic-secret"]]);
  }),
);

it.effect(
  "named variants fix option-dependent replies and invalid administration never prepares",
  () =>
    Effect.gen(function* () {
      const help = yield* Commands.sentinelSimulateFailureHelp().prepare;
      expect(yield* decodeReply(help, array(blob("crash-after-election")))).toEqual([
        "crash-after-election",
      ]);
      const debug = yield* Commands.sentinelDebugSet(
        Redacted.make([["ping-period", "500"]] as const),
      ).prepare;
      expect(debug.tokens).toEqual(["SENTINEL", "DEBUG", "ping-period", "500"]);
      expect(
        yield* decodeReply(debug, { _tag: "SimpleString", value: new TextEncoder().encode("OK") }),
      ).toBeUndefined();

      for (const command of [
        Commands.sentinelMonitor("", "host", 6379, 2),
        Commands.sentinelMonitor("cache", "host", 0, 2),
        Commands.sentinelGetPrimaryAddrByName(""),
      ])
        expect((yield* Effect.flip(command.prepare))._tag).toBe("CommandInputError");
    }),
);
