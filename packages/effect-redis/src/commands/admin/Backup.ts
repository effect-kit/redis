import { Effect, Redacted } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { simpleText, unsigned } from "#/command/reply/Data";
import { blob, mismatch, status } from "#/command/reply/Scalars";
import { fields, help, nodeCommand, sensitive } from "#/commands/admin/Build";
import type { RespValue } from "#/protocol/RespValue";

export interface BackupStatus {
  /** Unknown future state strings are preserved. */
  readonly state: string;
  readonly error: Redacted.Redacted<string>;
  readonly startTimeSeconds: bigint;
  readonly endTimeSeconds: bigint;
  readonly fields: Redacted.Redacted<ReadonlyArray<readonly [string, RespValue]>>;
}

const decodeStatus: ReplyDecoder<BackupStatus> = (reply) =>
  fields(reply).pipe(
    Effect.flatMap((entries) => {
      const field = (name: string) => {
        const matches = entries.filter(([key]) => key === name);
        const value = matches[0]?.[1];

        return matches.length === 1 && value !== undefined
          ? Effect.succeed(value)
          : Effect.fail(mismatch("custom", reply));
      };

      return Effect.gen(function* () {
        const state = yield* simpleText(yield* field("state"));
        const error = yield* simpleText(yield* field("error"));
        const startTimeSeconds = yield* unsigned(yield* field("start_time"));
        const endTimeSeconds = yield* unsigned(yield* field("end_time"));

        return {
          state,
          error: Redacted.make(error),
          startTimeSeconds,
          endTimeSeconds,
          fields: Redacted.make(entries),
        };
      });
    }),
  );

export const backupStart = () =>
  nodeCommand("BACKUP START", status("OK"), undefined, undefined, ["Redis since 8.10.0"]);

export const backupSeal = () =>
  nodeCommand("BACKUP SEAL", status("OK"), undefined, undefined, ["Redis since 8.10.0"]);

export const backupAbort = () =>
  nodeCommand("BACKUP ABORT", status("OK"), undefined, undefined, ["Redis since 8.10.0"]);

export const backupCleanup = () =>
  nodeCommand("BACKUP CLEANUP", status("OK"), undefined, undefined, ["Redis since 8.10.0"]);

export const backupHelp = () =>
  nodeCommand("BACKUP HELP", help, undefined, undefined, ["Redis since 8.10.0"]);

export const backupList = () =>
  nodeCommand("BACKUP LIST", sensitive(array(blob)), undefined, undefined, ["Redis since 8.10.0"]);

export const backupStatus = () =>
  nodeCommand("BACKUP STATUS", decodeStatus, undefined, undefined, ["Redis since 8.10.0"]);
