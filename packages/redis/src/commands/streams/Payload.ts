import { Effect } from "effect";

import { fromPreparation } from "#/command/Command";
import { parse } from "#/commands/internal/Input";
import { xadd } from "#/commands/streams/Entries";
import type { StreamAddOptions } from "#/commands/streams/Entries";
import type { AddId } from "#/commands/streams/Id";
import { AddOptions } from "#/commands/streams/internal/AddOptions";
import type { RedisArgument } from "#/RedisArgument";
import type { StreamPayload } from "#/streams/Payload";

export const xaddPayload = <A, RD, RE>(
  key: RedisArgument,
  id: AddId,
  payload: StreamPayload<A, RD, RE>,
  value: NoInfer<A>,
  options: StreamAddOptions = {},
) =>
  fromPreparation(
    Effect.gen(function* () {
      // Snapshot wire flags before a caller-provided codec can suspend or mutate its inputs.
      const selected = yield* parse(AddOptions, options);
      const fields = yield* payload.encode(value);
      return yield* xadd(key, id, fields, selected).prepare;
    }),
  );
