import { Effect, Layer } from "effect";
import type { Config, Crypto } from "effect";

import type { NativeClientInput, NativeClusterInput } from "#/client/Input";
import { standaloneLayer } from "#/client/Standalone";
import { clusterLayer, sentinelLayer } from "#/client/Topology";
import type { NativeSentinelInput } from "#/client/Topology";
import type { Transport } from "#/transport/Transport";

/** Runtime entrypoints supply platform services; universal modules never choose a runtime. */
export const nativeLayers = (
  transport: Layer.Layer<Transport>,
  crypto: Layer.Layer<Crypto.Crypto>,
) => {
  const layer = <R = never>(input: NativeClientInput<R>) =>
    standaloneLayer(input).pipe(Layer.provide(transport), Layer.provideMerge(crypto));
  const layerCluster = <R = never>(input: NativeClusterInput<R>) =>
    clusterLayer(input).pipe(Layer.provide(transport), Layer.provideMerge(crypto));
  const layerSentinel = <RD = never, RC = RD>(input: NativeSentinelInput<RD, RC>) =>
    sentinelLayer(input).pipe(Layer.provide(transport), Layer.provideMerge(crypto));

  return {
    layer,
    layerConfig: <R = never>(config: Config.Config<NativeClientInput<R>>) =>
      Layer.unwrap(Effect.map(config, layer<R>)),
    layerCluster,
    layerClusterConfig: <R = never>(config: Config.Config<NativeClusterInput<R>>) =>
      Layer.unwrap(Effect.map(config, layerCluster<R>)),
    layerSentinel,
    layerSentinelConfig: <RD = never, RC = RD>(
      config: Config.Config<NativeSentinelInput<RD, RC>>,
    ) => Layer.unwrap(Effect.map(config, layerSentinel<RD, RC>)),
  };
};
