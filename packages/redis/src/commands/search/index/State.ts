import { Effect } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { array } from "#/command/reply/Collections";
import { mismatch } from "#/command/reply/Scalars";
import { fields } from "#/commands/admin/Build";
import { moduleKeyless } from "#/commands/modules/Build";
import { searchBytes } from "#/commands/search/reply/Fields";
import type { RespValue } from "#/protocol/RespValue";

export interface SearchIndexState {
  readonly index: Uint8Array;
  /** Either the server's OK token or a structured warning/shard/schema report, retained losslessly. */
  readonly status: RespValue;
}

const indexState: ReplyDecoder<SearchIndexState> = (reply) =>
  Effect.gen(function* () {
    const report = yield* fields(reply);
    const index = report.find(([key]) => key === "index")?.[1];
    const status = report.find(([key]) => key === "status")?.[1];
    if (index === undefined || status === undefined) return yield* mismatch("custom", reply);

    return { index: yield* searchBytes(index), status };
  });

export const ftListWithClusterState = () =>
  moduleKeyless("search", "FT._LIST", array(indexState), Effect.succeed(["WITHCLUSTERSTATE"]));
