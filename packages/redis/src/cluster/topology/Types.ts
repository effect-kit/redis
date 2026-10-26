export interface ClusterAddress {
  readonly host: string;
  readonly port: number;
}

export interface ClusterNode {
  readonly id: string;
  readonly address: ClusterAddress;
  readonly role: "primary" | "replica";
  readonly primaryId: string;
}

export interface ClusterShard {
  readonly slots: ReadonlyArray<readonly [number, number]>;
  readonly primary: ClusterNode;
  readonly replicas: ReadonlyArray<ClusterNode>;
}

export interface ClusterTopology {
  readonly revision: number;
  readonly shards: ReadonlyArray<ClusterShard>;
}

export const addressIdentity = (address: ClusterAddress): string =>
  JSON.stringify([address.host, address.port]);

export const primaryForSlot = (topology: ClusterTopology, slot: number): ClusterShard | undefined =>
  topology.shards.find((shard) =>
    shard.slots.some(([first, last]) => first <= slot && slot <= last),
  );

export const topologyIdentity = (shards: ReadonlyArray<ClusterShard>): string =>
  JSON.stringify(
    Array.sort(
      shards
        .map((shard) => [
          shard.primary.id,
          addressIdentity(shard.primary.address),
          Array.sort(shard.slots, (a: readonly [number, number], b: readonly [number, number]) =>
            Order.Number(a[0], b[0]),
          ),
          Array.sort(
            shard.replicas.map((node) => JSON.stringify([node.id, addressIdentity(node.address)])),
            Order.String,
          ),
        ])
        .map((shard) => JSON.stringify(shard)),
      Order.String,
    ),
  );

const ownNode = (node: ClusterNode): ClusterNode =>
  Object.freeze({ ...node, address: Object.freeze({ ...node.address }) });

export const ownTopology = (shards: ReadonlyArray<ClusterShard>): ReadonlyArray<ClusterShard> =>
  Object.freeze(
    shards.map((shard) =>
      Object.freeze({
        primary: ownNode(shard.primary),
        replicas: Object.freeze(shard.replicas.map(ownNode)),
        slots: Object.freeze(
          shard.slots.map(([first, last]) => Object.freeze([first, last] as const)),
        ),
      }),
    ),
  );
import { Array, Order } from "effect";
