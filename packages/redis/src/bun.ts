import { nativeLayers } from "#/client/Native";
import { cryptoLayer } from "#/platform/bun/Crypto";
import { layer as transportLayer } from "#/transport/bun/BunTransport";

export const RedisBun = nativeLayers(transportLayer, cryptoLayer);
export type { NativeClientInput, NativeClusterInput, NativeCredentials } from "#/client/Input";
export type { NativeSentinelInput } from "#/client/Topology";

export { connect, layer } from "#/transport/bun/BunTransport";
export { Transport } from "#/transport/Transport";
export type { TransportConnection } from "#/transport/Transport";
export { cryptoLayer } from "#/platform/bun/Crypto";
