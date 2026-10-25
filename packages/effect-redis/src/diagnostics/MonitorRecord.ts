import { Redacted } from "effect";

import { undecorate } from "#/command/reply/Scalars";
import type { RespValue } from "#/protocol/RespValue";

export type MonitorRecord =
  | {
      readonly _tag: "Command";
      /** Decimal Unix seconds, preserving the server's microsecond precision. */
      readonly timestamp: string;
      readonly database: bigint;
      readonly client: Redacted.Redacted<string>;
      /** Server-escaped command text; this is not a reconstructable RedisCommand token array. */
      readonly commandLine: Redacted.Redacted<string>;
      readonly raw: Redacted.Redacted<RespValue>;
    }
  | {
      readonly _tag: "Unknown";
      readonly raw: Redacted.Redacted<RespValue>;
    };

/** MONITOR is a diagnostic line protocol inside RESP, not a Pub/Sub push envelope. */
export const monitorRecord = (reply: RespValue): MonitorRecord => {
  const raw = Redacted.make(reply);
  const value = undecorate(reply);
  if (value._tag !== "SimpleString") return { _tag: "Unknown", raw };

  let line: string;
  try {
    line = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value.value);
  } catch {
    return { _tag: "Unknown", raw };
  }

  // Bound decimal parsing independently of the outer RESP byte limit.
  const matched = /^([0-9]{1,20}\.[0-9]{6}) \[([0-9]{1,10}) /.exec(line);
  if (matched === null) return { _tag: "Unknown", raw };
  const [, timestamp, database] = matched;
  const end = line.indexOf("] ", matched[0].length);
  if (timestamp === undefined || database === undefined || end <= matched[0].length)
    return { _tag: "Unknown", raw };

  return {
    _tag: "Command",
    timestamp,
    database: BigInt(database),
    client: Redacted.make(line.slice(matched[0].length, end)),
    commandLine: Redacted.make(line.slice(end + 2)),
    raw,
  };
};
