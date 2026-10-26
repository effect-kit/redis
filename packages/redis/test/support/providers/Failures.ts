import { Schema } from "effect";

export class ProviderTestError extends Schema.TaggedError<ProviderTestError>()(
  "ProviderTestError",
  {
    stage: Schema.NonEmptyString,
    reason: Schema.NonEmptyString,
  },
) {}

/** External errors may contain addresses or request bodies; expose only reviewed enum-like fields. */
export const safeFailure = (error: unknown) => {
  if (typeof error !== "object" || error === null) return { tag: "UnknownFailure" };

  const selected: Record<string, string | number> = {};
  if (error instanceof ProviderTestError) selected.reason = error.reason;
  for (const key of ["_tag", "stage", "code", "delivery", "status"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    const value: unknown = descriptor?.value;
    if (typeof value === "number" && Number.isSafeInteger(value)) selected[key] = value;
    else if (typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value))
      selected[key] = value;
  }
  const reason: unknown = Object.getOwnPropertyDescriptor(error, "reason")?.value;
  if (
    selected._tag === "ConnectionError" &&
    typeof reason === "string" &&
    [
      "closed",
      "transport",
      "protocol",
      "timeout",
      "aborted",
      "push-overflow",
      "unavailable",
      "shutdown-timeout",
    ].includes(reason)
  )
    selected.reason = reason;

  return selected;
};
