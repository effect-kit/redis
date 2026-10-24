import { Schema } from "effect";

export class ProtocolError extends Schema.TaggedError<ProtocolError>()("ProtocolError", {
  stage: Schema.Literals(["config", "encode", "decode"]),
  kind: Schema.Literals([
    "InvalidLimits",
    "InvalidArguments",
    "InvalidType",
    "InvalidLength",
    "InvalidNumber",
    "InvalidBoolean",
    "InvalidTerminator",
    "InvalidVerbatim",
    "InvalidPush",
    "UnexpectedEnd",
    "LimitExceeded",
    "InvalidState",
  ]),
  offset: Schema.Number,
  limit: Schema.optionalKey(Schema.String),
  maximum: Schema.optionalKey(Schema.Number),
}) {}

/** Internal framing failures are caught only at the public Result boundary. */
export const failProtocol = (
  kind: ProtocolError["kind"],
  offset: number,
  limit?: string,
  maximum?: number,
): never => {
  throw new ProtocolError({
    stage: "decode",
    kind,
    offset,
    ...(limit === undefined ? {} : { limit }),
    ...(maximum === undefined ? {} : { maximum }),
  });
};
