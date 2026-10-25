import { undecorate } from "#/command/reply/Scalars";
import type { RespValue } from "#/protocol/RespValue";

/** Only the reserved cache-miss responses from the pinned servers authorize managed loading. */
export const isMissingScriptReply = (reply: RespValue) => {
  const value = undecorate(reply);
  return (
    (value._tag === "SimpleError" || value._tag === "BlobError") &&
    ["NOSCRIPT No matching script. Please use EVAL.", "NOSCRIPT No matching script."].some(
      (expected) =>
        value.value.length === expected.length &&
        value.value.every((byte, index) => byte === expected.charCodeAt(index)),
    )
  );
};
