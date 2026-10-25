import { Context } from "effect";

import type { BatchExecutorService } from "#/sessions/batch/Types";

/** Batch transport capability; an HTTP implementation need not provide physical sessions. */
export class BatchExecutor extends Context.Service<BatchExecutor, BatchExecutorService>()(
  "@envoy1084/effect-redis/BatchExecutor",
) {}
