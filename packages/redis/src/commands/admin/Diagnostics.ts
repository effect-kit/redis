import { Effect, Schema } from "effect";

import { array } from "#/command/reply/Collections";
import { tuple, unsigned } from "#/command/reply/Data";
import { mismatch, status, undecorate } from "#/command/reply/Scalars";
import { fields, help, lossless, nodeCommand, reportText, sensitive } from "#/commands/admin/Build";
import { Argument, Integer, NonNegative, parse } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

const optionalCount = (count?: Integer) =>
  parse(Schema.optional(Integer), count).pipe(
    Effect.map((selected) => (selected === undefined ? [] : [String(selected)])),
  );

/** Log payloads can contain command arguments; observing them requires explicit unredaction. */
export const slowlogGet = (count?: Integer) =>
  nodeCommand("SLOWLOG GET", sensitive(array(lossless)), optionalCount(count));
export const slowlogLen = () => nodeCommand("SLOWLOG LEN", unsigned);

export const slowlogReset = () => nodeCommand("SLOWLOG RESET", status("OK"));

export const slowlogHelp = () => nodeCommand("SLOWLOG HELP", help);

const LogKind = Schema.Literals(["slow", "large-request", "large-reply"]);
export type CommandLogKind = typeof LogKind.Type;

export const commandlogGet = (count: Integer, kind: CommandLogKind) =>
  nodeCommand(
    "COMMANDLOG GET",
    sensitive(array(lossless)),
    parse(Schema.Tuple([Integer, LogKind]), [count, kind]).pipe(
      Effect.map(([limit, selected]) => [String(limit), selected]),
    ),
    undefined,
    ["Valkey since 8.1.0"],
  );
export const commandlogLen = (kind: CommandLogKind) =>
  nodeCommand(
    "COMMANDLOG LEN",
    unsigned,
    parse(LogKind, kind).pipe(Effect.map((selected) => [selected])),
    undefined,
    ["Valkey since 8.1.0"],
  );
export const commandlogReset = (kind: CommandLogKind) =>
  nodeCommand(
    "COMMANDLOG RESET",
    status("OK"),
    parse(LogKind, kind).pipe(Effect.map((selected) => [selected])),
    undefined,
    ["Valkey since 8.1.0"],
  );
export const commandlogHelp = () => nodeCommand("COMMANDLOG HELP", help);

export const latencyDoctor = () => nodeCommand("LATENCY DOCTOR", reportText);

export const latencyHelp = () => nodeCommand("LATENCY HELP", help);

export const latencyGraph = (event: RedisArgument) =>
  nodeCommand(
    "LATENCY GRAPH",
    reportText,
    parse(Argument, event).pipe(Effect.map((selected) => [selected])),
  );
export const latencyHistory = (event: RedisArgument) =>
  nodeCommand(
    "LATENCY HISTORY",
    array(tuple(unsigned, unsigned)),
    parse(Argument, event).pipe(Effect.map((selected) => [selected])),
  );
export const latencyLatest = () =>
  nodeCommand(
    "LATENCY LATEST",
    array<readonly [string, bigint, bigint, bigint], never, never>((reply) => {
      const value = undecorate(reply);
      if (value._tag !== "Array" || value.values.length !== 4)
        return Effect.fail(mismatch("array", reply));
      const [event, timestamp, latest, maximum] = value.values;
      if (
        event === undefined ||
        timestamp === undefined ||
        latest === undefined ||
        maximum === undefined
      )
        return Effect.fail(mismatch("array", reply));

      return Effect.all([
        reportText(event),
        unsigned(timestamp),
        unsigned(latest),
        unsigned(maximum),
      ]);
    }),
  );

export const latencyReset = (events: ReadonlyArray<RedisArgument> = []) =>
  nodeCommand("LATENCY RESET", unsigned, parse(Schema.Array(Argument), events));
export const latencyHistogram = (commands: ReadonlyArray<RedisArgument> = []) =>
  nodeCommand("LATENCY HISTOGRAM", fields, parse(Schema.Array(Argument), commands));

const Slots = Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16383 })));
const HotkeysOptions = Schema.Struct({
  metrics: Schema.NonEmptyArray(Schema.Literals(["CPU", "NET"])),
  count: Schema.optionalKey(NonNegative),
  durationSeconds: Schema.optionalKey(NonNegative),
  sampleRatio: Schema.optionalKey(NonNegative),
  slots: Schema.optionalKey(Slots),
});
export type HotkeysOptions = typeof HotkeysOptions.Type;

export const hotkeysStart = (options: HotkeysOptions) =>
  nodeCommand(
    "HOTKEYS START",
    status("OK"),
    Effect.gen(function* () {
      const selected = yield* parse(HotkeysOptions, options);

      return [
        "METRICS",
        String(selected.metrics.length),
        ...selected.metrics,
        ...(selected.count === undefined ? [] : ["COUNT", String(selected.count)]),
        ...(selected.durationSeconds === undefined
          ? []
          : ["DURATION", String(selected.durationSeconds)]),
        ...(selected.sampleRatio === undefined ? [] : ["SAMPLE", String(selected.sampleRatio)]),
        ...(selected.slots === undefined
          ? []
          : ["SLOTS", String(selected.slots.length), ...selected.slots.map(String)]),
      ];
    }),
    undefined,
    ["Redis since 8.6.0"],
  );

export const hotkeysGet = () => nodeCommand("HOTKEYS GET", sensitive(array(fields)));

export const hotkeysStop = () => nodeCommand("HOTKEYS STOP", status("OK"));

export const hotkeysReset = () => nodeCommand("HOTKEYS RESET", status("OK"));

export const hotkeysHelp = () => nodeCommand("HOTKEYS HELP", help);
