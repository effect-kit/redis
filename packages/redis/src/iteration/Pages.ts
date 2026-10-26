import { Effect, Option, Stream } from "effect";

import type { ScanPage } from "#/commands/scan/Page";

/** Empty nonterminal pages are valid, and duplicate values are deliberately preserved. */
export const scanEntries = <A, E, R>(read: (cursor: string) => Effect.Effect<ScanPage<A>, E, R>) =>
  Stream.paginate("0", (cursor) =>
    read(cursor).pipe(
      Effect.map(
        (page) =>
          [
            page.entries,
            page.cursor === "0" ? Option.none<string>() : Option.some(page.cursor),
          ] as const,
      ),
    ),
  );
