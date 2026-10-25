import { Effect, Schema } from "effect";

import { boolean, simpleText, triple, unsigned } from "#/command/reply/Data";
import { status } from "#/command/reply/Scalars";
import { help } from "#/commands/admin/Build";
import { NonNegative, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import { Name, Port, sentinelCommand } from "#/commands/sentinel/Build";

const down = (command: string, host: string, port: number, epoch: Integer, runId: string) =>
  sentinelCommand(
    command,
    triple(boolean, simpleText, unsigned),
    parse(Schema.Tuple([Name, Port, NonNegative, Name]), [host, port, epoch, runId]).pipe(
      Effect.map(([h, p, e, r]) => [h, String(p), String(e), r]),
    ),
  );

/** Explicit peer-vote RPC: a non-'*' runId can participate in an election. */
export const sentinelIsMasterDownByAddr = (
  host: string,
  port: number,
  epoch: Integer,
  runId: string,
) => down("IS-MASTER-DOWN-BY-ADDR", host, port, epoch, runId);
export const sentinelIsPrimaryDownByAddr = (
  host: string,
  port: number,
  epoch: Integer,
  runId: string,
) => down("IS-PRIMARY-DOWN-BY-ADDR", host, port, epoch, runId);

export const sentinelSimulateFailure = (
  modes: readonly [
    "crash-after-election" | "crash-after-promotion",
    ...Array<"crash-after-election" | "crash-after-promotion">,
  ],
) =>
  sentinelCommand(
    "SIMULATE-FAILURE",
    status("OK"),
    parse(
      Schema.NonEmptyArray(Schema.Literals(["crash-after-election", "crash-after-promotion"])),
      modes,
    ),
  );
export const sentinelSimulateFailureHelp = () =>
  sentinelCommand("SIMULATE-FAILURE", help, Effect.succeed(["help"]));
