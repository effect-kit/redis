import { Effect, Schema } from "effect";

import type { ClusterAddress, ClusterNode, ClusterShard } from "#/cluster/topology/Types";
import { array } from "#/command/reply/Collections";
import { pairs, simpleText } from "#/command/reply/Data";
import { safeInteger, undecorate } from "#/command/reply/Scalars";
import { ClusterError } from "#/errors/ClusterError";
import type { RespValue } from "#/protocol/RespValue";

const Address = Schema.Struct({
  host: Schema.NonEmptyString.check(
    Schema.isPattern(/^[^\s/@?#]+$/),
    Schema.makeFilter((host) => !host.includes("\0")),
  ),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
});
const invalid = () => new ClusterError({ reason: "invalid-topology", delivery: "replied" });
const values = array(Effect.succeed);
const fields = pairs(simpleText, Effect.succeed);

export const decodeAddress = (address: ClusterAddress) =>
  Schema.decodeUnknownEffect(Address)(address).pipe(Effect.mapError(invalid));

const address = Effect.fnUntraced(function* (host: RespValue, port: RespValue, peer: string) {
  const value = undecorate(host);
  const name = value._tag === "Null" ? "" : yield* simpleText(host);
  return yield* decodeAddress({ host: name === "" ? peer : name, port: yield* safeInteger(port) });
});

export const decodeSlots = Effect.fnUntraced(function* (reply: RespValue, peer: string) {
  const shards: ClusterShard[] = [];
  for (const entry of yield* values(reply)) {
    const [start, end, primary, ...replicas] = yield* values(entry);
    if (start === undefined || end === undefined || primary === undefined) return yield* invalid();

    const node = Effect.fnUntraced(function* (input: RespValue, primaryId?: string) {
      const [host, port, id] = yield* values(input);
      if (host === undefined || port === undefined) return yield* invalid();
      const endpoint = yield* address(host, port, peer);
      const identity = id === undefined ? JSON.stringify(endpoint) : yield* simpleText(id);
      return {
        id: identity,
        address: endpoint,
        role: primaryId === undefined ? "primary" : "replica",
        primaryId: primaryId ?? identity,
      } satisfies ClusterNode;
    });
    const master = yield* node(primary);
    shards.push({
      slots: [[yield* safeInteger(start), yield* safeInteger(end)]],
      primary: master,
      replicas: yield* Effect.forEach(replicas, (replica) => node(replica, master.id)),
    });
  }

  return shards;
});

export const decodeShards = Effect.fnUntraced(function* (
  reply: RespValue,
  peer: string,
  tls: boolean,
) {
  const shards: ClusterShard[] = [];
  for (const input of yield* values(reply)) {
    const properties = new Map(yield* fields(input));
    const ranges = properties.get("slots");
    const entries = properties.get("nodes");
    if (ranges === undefined || entries === undefined) return yield* invalid();
    const bounds = yield* array(safeInteger)(ranges);
    if (bounds.length % 2 !== 0) return yield* invalid();
    const slots: Array<readonly [number, number]> = [];
    for (let i = 0; i < bounds.length; i += 2) {
      const first = bounds[i];
      const last = bounds[i + 1];
      if (first === undefined || last === undefined) return yield* invalid();
      slots.push([first, last]);
    }

    const nodes: ClusterNode[] = [];
    for (const entry of yield* values(entries)) {
      const node = new Map(yield* fields(entry));
      const id = node.get("id");
      const role = node.get("role");
      const endpoint = node.get("endpoint") ?? node.get("ip");
      const port = node.get(tls ? "tls-port" : "port");
      const health = node.get("health");
      if (id === undefined || role === undefined || endpoint === undefined || port === undefined)
        return yield* invalid();
      if (health !== undefined && (yield* simpleText(health)) !== "online") continue;

      const kind = yield* simpleText(role);
      if (kind !== "master" && kind !== "replica") return yield* invalid();
      nodes.push({
        id: yield* simpleText(id),
        address: yield* address(endpoint, port, peer),
        role: kind === "master" ? "primary" : "replica",
        primaryId: "",
      });
    }
    const primaries = nodes.filter((node) => node.role === "primary");
    const master = primaries[0];
    if (primaries.length !== 1 || master === undefined) return yield* invalid();
    const primary = { ...master, primaryId: master.id };
    shards.push({
      slots,
      primary,
      replicas: nodes
        .filter((node) => node.role === "replica")
        .map((node) => ({
          id: node.id,
          role: node.role,
          address: node.address,
          primaryId: primary.id,
        })),
    });
  }

  return shards;
});

/** Publish only complete, nonoverlapping maps; malformed discovery cannot replace a valid snapshot. */
export const validateTopology = Effect.fnUntraced(function* (
  shards: ClusterShard[],
  maxNodes: number,
) {
  const occupied = new Uint8Array(16384);
  const nodes = new Map<string, string>();
  for (const shard of shards) {
    for (const node of [shard.primary, ...shard.replicas]) {
      const identity = JSON.stringify(node.address);
      if (nodes.has(node.id) && nodes.get(node.id) !== identity) return yield* invalid();
      nodes.set(node.id, identity);
    }
    for (const [first, last] of shard.slots) {
      if (first < 0 || last >= 16384 || first > last) return yield* invalid();
      for (let slot = first; slot <= last; slot++) {
        if (occupied[slot] !== 0) return yield* invalid();
        occupied[slot] = 1;
      }
    }
  }
  if (nodes.size > maxNodes || occupied.some((value) => value === 0)) return yield* invalid();
  return shards;
});
