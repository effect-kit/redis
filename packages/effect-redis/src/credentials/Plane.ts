import { Context } from "effect";

/** Sentinel discovery/control identity must never inherit a data-plane credential lifetime. */
export const CredentialPlane = Context.Reference<"data" | "sentinel">(
  "@envoy1084/effect-redis/CredentialPlane",
  { defaultValue: () => "data" },
);
