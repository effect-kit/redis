import { Effect, Redacted, Schema } from "effect";

import { text } from "#/command/reply/Scalars";
import { parse } from "#/commands/internal/Input";
import { command } from "#/commands/upstash/Build";

const Secret = Schema.Redacted(Schema.NonEmptyString);

/** Inputs and the generated bearer token remain secrets outside command encoding/decoding. */
export const aclRestToken = (
  username: Redacted.Redacted<string>,
  password: Redacted.Redacted<string>,
) =>
  command(
    "ACL RESTTOKEN",
    (reply) => text(reply).pipe(Effect.map(Redacted.make)),
    Effect.all([parse(Secret, username), parse(Secret, password)]).pipe(
      Effect.map(([user, secret]) => [Redacted.value(user), Redacted.value(secret)]),
    ),
  );
