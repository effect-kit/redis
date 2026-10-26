import { Context } from "effect";

/** Sentinel discovery/control identity must never inherit a data-plane credential lifetime. */
export const CredentialPlane = Context.Reference<"data" | "sentinel">(
  "@effect-kit/redis/CredentialPlane",
  { defaultValue: () => "data" },
);
