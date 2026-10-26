import type * as Bun from "#/bun";
import type * as Core from "#/index";
import type * as Node from "#/node";

export const core = (await import(
  new URL("../../../dist/index.js", import.meta.url).href
)) as typeof Core;
const node =
  process.versions.bun === undefined
    ? ((await import(new URL("../../../dist/node.js", import.meta.url).href)) as typeof Node)
    : undefined;
const bun =
  process.versions.bun === undefined
    ? undefined
    : ((await import(new URL("../../../dist/bun.js", import.meta.url).href)) as typeof Bun);

export const readyLayer = node?.RedisNode.layer ?? bun?.RedisBun.layer;
export const connect = node?.connect ?? bun?.connect;
