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
