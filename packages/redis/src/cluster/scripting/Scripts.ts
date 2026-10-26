import { Deferred, Effect, Redacted } from "effect";

import { sameSlot } from "#/cluster/routing/Route";
import type { ClusterRouter } from "#/cluster/routing/Router";
import type { ClusterTarget } from "#/cluster/sessions/Sessions";
import { addressIdentity } from "#/cluster/topology/Types";
import { checkServerReply, decodeReply } from "#/command/Decode";
import type { RedisError } from "#/command/Executor";
import { status, text } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import { invocation, Invocation } from "#/commands/scripting/Invocation";
import type { ScriptArguments } from "#/commands/scripting/Invocation";
import { ClusterError } from "#/errors/ClusterError";
import { CommandInputError } from "#/errors/CommandInputError";
import { ReplyError } from "#/errors/ReplyError";
import { isMissingScriptReply } from "#/scripting/NoScript";
import { decodeScriptOptions } from "#/scripting/Options";
import type { ScriptOptions } from "#/scripting/Options";
import type { RedisScript } from "#/scripting/RedisScript";

export const makeClusterScripts = Effect.fnUntraced(function* (
  router: ClusterRouter,
  target: ClusterTarget,
  options: ScriptOptions = {},
) {
  const policy = yield* decodeScriptOptions(options);
  const loads = new Map<string, Deferred.Deferred<void, RedisError>>();

  const execute = Effect.fnUntraced(function* <A, E, R>(
    script: RedisScript<A, E, R>,
    input: ScriptArguments,
  ) {
    const selected = yield* parse(Invocation, input);
    let retained = 0;
    for (const argument of [...selected.keys, ...(selected.args ?? [])]) {
      if (typeof argument !== "string") retained += argument.byteLength;
      if (retained > policy.maxSnapshotBytes)
        return yield* new CommandInputError({ delivery: "unsent", reason: "arguments" });
    }
    if ("key" in target) yield* sameSlot([target.key, ...selected.keys]);
    if (selected.keys.length === 0 && "key" in target)
      return yield* new ClusterError({ reason: "explicit-target-required", delivery: "unsent" });
    const prepared = yield* invocation(
      script.readOnly ? "EVALSHA_RO" : "EVALSHA",
      script.sha1,
      selected,
      Effect.succeed,
    ).prepare;

    const reply = yield* router.reply(
      prepared,
      "node" in target ? target.node : undefined,
      false,
      (wire, command, destination) =>
        Effect.gen(function* () {
          const result = yield* wire.execute(command.tokens);
          if (!isMissingScriptReply(result)) return result;
          const identity = `${addressIdentity(destination.address)}:${policy.loadScope === "server" ? "server" : wire.id}:${script.sha1}`;
          const pending = loads.get(identity);
          if (pending !== undefined) yield* Deferred.await(pending);
          else {
            if (loads.size >= policy.maxConcurrentLoads)
              return yield* new ClusterError({ reason: "capacity", delivery: "replied" });
            const receipt = Deferred.makeUnsafe<void, RedisError>();
            loads.set(identity, receipt);
            yield* wire.execute(["SCRIPT", "LOAD", Redacted.value(script.source)]).pipe(
              Effect.flatMap(checkServerReply),
              Effect.flatMap(text),
              Effect.flatMap((digest) =>
                digest === script.sha1
                  ? Effect.void
                  : Effect.fail(
                      new ReplyError({
                        delivery: "replied",
                        expected: "custom",
                        actual: "BlobString",
                        path: [],
                      }),
                    ),
              ),
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  loads.delete(identity);
                  Deferred.doneUnsafe(receipt, exit);
                }),
              ),
            );
          }
          // The rejected EVALSHA consumed ASKING. Re-arm it on this same exclusive lease after loading.
          if (destination.asking)
            yield* wire
              .execute(["ASKING"])
              .pipe(Effect.flatMap(checkServerReply), Effect.flatMap(status("OK")));
          return yield* wire.execute(command.tokens);
        }),
    );

    // All redirect/load recovery finishes before application code sees a completed reply.
    return yield* decodeReply({ ...prepared, decode: script.decode }, reply);
  });

  return { execute };
});
