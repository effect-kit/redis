import { Effect, Stream } from "effect";

import { scanFamily } from "#/commands/scan/Family";
import { makeSentinelExecutor } from "#/sentinel/execution/Executor";
import type { SentinelSessions } from "#/sentinel/execution/Sessions";
import type { SentinelManager } from "#/sentinel/generation/Manager";
import type { SentinelPolicy } from "#/sentinel/Options";

type Scans = ReturnType<typeof scanFamily>;

/** Opaque cursors belong to their starting generation, even though each page uses a short lease. */
export const makeSentinelScans = (
  manager: Pick<SentinelManager, "ensure">,
  sessions: SentinelSessions,
  policy: SentinelPolicy,
) => {
  const bound = <A, E, R>(read: (scans: Scans) => Stream.Stream<A, E, R>) =>
    Stream.unwrap(
      manager.ensure.pipe(
        Effect.map((generation) =>
          read(scanFamily(makeSentinelExecutor(sessions, policy, false, generation))),
        ),
      ),
    );

  return {
    scanKeys: (...args: Parameters<Scans["scanKeys"]>) => bound((scans) => scans.scanKeys(...args)),
    scanHash: (...args: Parameters<Scans["scanHash"]>) => bound((scans) => scans.scanHash(...args)),
    scanHashFields: (...args: Parameters<Scans["scanHashFields"]>) =>
      bound((scans) => scans.scanHashFields(...args)),
    scanSet: (...args: Parameters<Scans["scanSet"]>) => bound((scans) => scans.scanSet(...args)),
    scanSortedSet: (...args: Parameters<Scans["scanSortedSet"]>) =>
      bound((scans) => scans.scanSortedSet(...args)),
    scanSortedMembers: (...args: Parameters<Scans["scanSortedMembers"]>) =>
      bound((scans) => scans.scanSortedMembers(...args)),
    scanArray: (...args: Parameters<Scans["scanArray"]>) =>
      bound((scans) => scans.scanArray(...args)),
  };
};
