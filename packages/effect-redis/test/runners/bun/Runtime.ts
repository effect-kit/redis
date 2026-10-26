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
