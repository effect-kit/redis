import type { TransportConnection } from "#/transport/Transport";

type Write = TransportConnection["write"];

// Capabilities follow exact native operations, not a caller-supplied interface flag.
// Unknown transports keep the public copying path.
const readers = new WeakSet<TransportConnection["read"]>();
const writers = new WeakMap<Write, Write>();

export const ownRead = (read: TransportConnection["read"]) => {
  readers.add(read);
  return read;
};

export const hasOwnedRead = (read: TransportConnection["read"]) => readers.has(read);

export const ownWrite = (write: Write, owned: Write) => {
  writers.set(write, owned);
  return write;
};

export const ownedWrite = (write: Write): Write => writers.get(write) ?? write;
