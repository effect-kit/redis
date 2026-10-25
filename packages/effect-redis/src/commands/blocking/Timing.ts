import { Duration, Effect, Schema } from "effect";

import { parse } from "#/commands/internal/Input";
import { PositiveInteger } from "#/config/Validation";
import { CommandInputError } from "#/errors/CommandInputError";

const Wait = Schema.Union([Schema.Duration, Schema.Literal("forever")]);
const Options = Schema.Struct({ blockFor: Wait, timeout: Schema.optionalKey(Wait) });

export type BlockingOptions = typeof Options.Type;

/** Server wait and client deadline are independent; socket writes retain their own bounded deadline. */
export const blockingTiming = Effect.fnUntraced(function* (
  options: BlockingOptions,
  unit: "seconds" | "milliseconds" = "seconds",
) {
  const selected = yield* parse(Options, options);
  const millis = selected.blockFor === "forever" ? undefined : Duration.toMillis(selected.blockFor);
  if (
    millis !== undefined &&
    (!Number.isFinite(millis) ||
      millis <= 0 ||
      (unit === "milliseconds" && !Number.isInteger(millis)))
  )
    return yield* new CommandInputError({ delivery: "unsent", reason: "options" });

  const deadline =
    selected.timeout === "forever"
      ? "forever"
      : selected.timeout === undefined
        ? millis === undefined
          ? "forever"
          : Math.ceil(millis) + 1000
        : Math.ceil(Duration.toMillis(selected.timeout));
  const replyTimeoutMillis: number | "forever" =
    deadline === "forever" ? deadline : yield* parse(PositiveInteger, deadline);

  let token = millis === undefined ? "0" : String(millis);
  if (millis !== undefined && unit === "seconds" && selected.blockFor !== "forever") {
    const value = selected.blockFor.value;
    if (value._tag === "Nanos") {
      const whole = value.nanos / 1000000000n;
      const fraction = String(value.nanos % 1000000000n)
        .padStart(9, "0")
        .replace(/0+$/, "");
      token = fraction.length === 0 ? String(whole) : `${whole}.${fraction}`;
    } else token = String(millis / 1000);
  }

  return { token, replyTimeoutMillis };
});
