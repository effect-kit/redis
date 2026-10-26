import { Effect, Option } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { nullable, pairs, tuple, unsigned } from "#/command/reply/Data";
import { blob } from "#/command/reply/Scalars";
import { streamId } from "#/commands/streams/Id";
import { at, elements } from "#/commands/streams/reply/Structure";
import type {
  ClaimedGroupEntry,
  GroupEntry,
  StreamEntry,
  StreamRead,
} from "#/commands/streams/Types";

export const fields = pairs(blob, blob);

export const entry: ReplyDecoder<StreamEntry> = (reply) =>
  tuple(streamId, fields)(reply).pipe(Effect.map(([id, values]) => ({ id, fields: values })));

export const groupEntry: ReplyDecoder<GroupEntry> = (reply) =>
  tuple(
    streamId,
    nullable(fields),
  )(reply).pipe(Effect.map(([id, values]) => ({ id, fields: values })));

export const claimedEntry: ReplyDecoder<ClaimedGroupEntry> = (reply) =>
  Effect.gen(function* () {
    const values = yield* elements(reply, 4);
    return {
      id: yield* at(values, 0, streamId),
      fields: yield* at(values, 1, nullable(fields)),
      idleMillis: yield* at(values, 2, unsigned),
      deliveries: yield* at(values, 3, unsigned),
    };
  });

export const reads =
  <A>(decode: ReplyDecoder<A>): ReplyDecoder<Option.Option<ReadonlyArray<StreamRead<A>>>> =>
  (reply) =>
    nullable(pairs(blob, array(decode)))(reply).pipe(
      Effect.map(Option.map((streams) => streams.map(([key, entries]) => ({ key, entries })))),
    );
