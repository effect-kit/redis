import type * as Native from "#/bun";
import type * as Core from "#/index";

// The same portable programs exercise built artifacts locally and in runtime containers.
export const core = (await import(
  new URL("../../../dist/index.js", import.meta.url).href
)) as typeof Core;
export const native = (await import(
  new URL("../../../dist/bun.js", import.meta.url).href
)) as typeof Native;

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const equalBytes = (left: Uint8Array | undefined, right: Uint8Array) =>
  left !== undefined &&
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);
import { Effect } from "effect";

/** Observe fixture progress without retrying the operation whose outcome is under test. */
export const eventually = Effect.fnUntraced(function* <E, R>(
  observation: Effect.Effect<boolean, E, R>,
  message: string,
  attempts = 200,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (yield* observation) return;
    yield* Effect.sleep(10);
  }

  return yield* Effect.fail(new Error(message));
});
