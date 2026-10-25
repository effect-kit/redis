import type { Effect, Scope, Stream } from "effect";

import { makeRedisMonitor, makeRedisShutdown } from "#/index";
import type { MonitorRecord, RedisConfig, ShutdownClosed, Transport } from "#/index";

declare const config: RedisConfig;
const monitor = makeRedisMonitor(config);
declare const acquired: Effect.Success<typeof monitor>;
const shutdown = makeRedisShutdown(config);
declare const control: Effect.Success<typeof shutdown>;
const stopped = control.shutdown({ save: "NOSAVE" });

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type DiagnosticContracts = [
  Assert<Equal<Effect.Services<typeof monitor>, Transport | Scope.Scope>>,
  Assert<Equal<Stream.Success<typeof acquired.events>, MonitorRecord>>,
  Assert<Equal<Stream.Services<typeof acquired.events>, never>>,
  Assert<Equal<Effect.Services<typeof shutdown>, Transport>>,
  Assert<Equal<Effect.Services<typeof stopped>, never>>,
  Assert<Equal<Effect.Success<typeof stopped>, ShutdownClosed>>,
];

// @ts-expect-error Diagnostic loss cannot silently reconnect or replay missed commands.
makeRedisMonitor(config, { recovery: "replay" });
declare const record: Extract<MonitorRecord, { readonly _tag: "Command" }>;
// @ts-expect-error Sensitive diagnostic fields require explicit unredaction after narrowing.
const line: string = record.commandLine;
void line;
// @ts-expect-error ABORT is a separately named operation with a different reply contract.
control.shutdown({ abort: true });
