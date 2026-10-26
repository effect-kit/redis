import { nativeLayers } from "#/client/Native";
import { cryptoLayer } from "#/platform/node/Crypto";
import { layer as transportLayer } from "#/transport/node/NodeTransport";

export const RedisNode = nativeLayers(transportLayer, cryptoLayer);
export type { NativeClientInput, NativeClusterInput, NativeCredentials } from "#/client/Input";
export type { NativeSentinelInput } from "#/client/Topology";

export { connect, layer } from "#/transport/node/NodeTransport";
export { Transport } from "#/transport/Transport";
export type { TransportConnection } from "#/transport/Transport";
export { cryptoLayer } from "#/platform/node/Crypto";
