import { TransportError } from "#/errors/TransportError";
import { Transport } from "#/transport/Transport";
import { gatedTransport } from "#test/support/networking/GatedTransport";

export const replyGate = (trigger: Uint8Array) =>
  gatedTransport(Transport, trigger, new TransportError({ stage: "read", reason: "io" }));
