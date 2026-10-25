import type { Cause, Effect, Scope } from "effect";

import type { SentinelAddress } from "#/commands/sentinel/Discovery";
import type { ExpectedRole } from "#/connection/Role";
import type { SentinelView } from "#/sentinel/discovery/Discovery";
import type { LeasePool } from "#/sessions/pool/LeasePool";

export interface SentinelGeneration {
  readonly id: number;
  readonly view: SentinelView;
  readonly scope: Scope.Closeable;
  readonly pools: Map<string, LeasePool>;
  readonly observers: Set<Effect.Effect<void>>;
  obsolete: boolean;
  fatal?: Cause.Cause<never>;
}

export interface SentinelNode {
  readonly address: SentinelAddress;
  readonly role: ExpectedRole;
}
