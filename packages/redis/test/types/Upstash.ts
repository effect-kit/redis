import { Context, Effect, Layer, Redacted } from "effect";
import type { Option, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import type { HttpClient } from "effect/http";

import type { PayloadCodec } from "#/codecs/PayloadCodec";
import { Commands as CoreCommands, Redis, RedisSessions } from "#/index";
import type { BatchExecutor } from "#/index";
import { Commands, layer, makeUpstash, UpstashEvents } from "#/upstash";
import type { UpstashConfigInput, UpstashMessage, UpstashSubscription } from "#/upstash";

class DecodePayload extends Context.Service<DecodePayload, { readonly label: string }>()(
  "test/http/DecodePayload",
) {}
class EncodePayload extends Context.Service<EncodePayload, { readonly label: string }>()(
  "test/http/EncodePayload",
) {}

declare const input: UpstashConfigInput;
declare const codec: PayloadCodec<{ readonly name: string }, DecodePayload, EncodePayload>;
declare const redis: Redis["Service"];

const acquired = makeUpstash(input);
const ordinary = redis.get("key");
const count = redis.upstash.vectorCount("index");
const alias = redis.upstash.searchAliasAdd("alias", "index");
const documents = redis.upstash.searchQueryWith("index", {}, codec);
const prepared = Commands.searchQueryWith("index", {}, codec).prepare;
const batch = redis.pipeline([
  CoreCommands.incr("counter"),
  Commands.searchQueryWith("index", {}, codec),
]);
const events = UpstashEvents.pipe(Effect.flatMap((service) => service.subscribe("updates")));
const live = layer(input).pipe(Layer.provide(FetchHttpClient.layer));
const runnable = Redis.pipe(
  Effect.flatMap((service) => service.incr("counter")),
  Effect.provide(live),
);

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type Documents = Option.Option<
  ReadonlyArray<{
    readonly key: Uint8Array;
    readonly score: number;
    readonly value: { readonly name: string };
  }>
>;

export type UpstashContracts = [
  Assert<Equal<Effect.Services<typeof acquired>, HttpClient.HttpClient | Scope.Scope>>,
  Assert<Equal<Effect.Success<typeof ordinary>, Option.Option<string>>>,
  Assert<Equal<Effect.Services<typeof ordinary>, never>>,
  Assert<Equal<Effect.Success<typeof count>, bigint>>,
  Assert<Equal<Effect.Success<typeof alias>, 1 | 2>>,
  Assert<Equal<Effect.Success<typeof documents>, Documents>>,
  Assert<Equal<Effect.Services<typeof documents>, DecodePayload>>,
  Assert<Equal<Effect.Services<typeof prepared>, never>>,
  Assert<Equal<Effect.Services<typeof batch>, DecodePayload | BatchExecutor>>,
  Assert<Equal<Effect.Success<typeof events>, UpstashSubscription<UpstashMessage>>>,
  Assert<Equal<Effect.Services<typeof events>, UpstashEvents | Scope.Scope>>,
  Assert<Equal<Effect.Success<typeof runnable>, bigint>>,
  Assert<Equal<Effect.Services<typeof runnable>, never>>,
];

// @ts-expect-error HTTP bearer input is explicitly redacted.
makeUpstash({ url: "https://example.test", token: "plain" });

Commands.searchCreate("idx", {
  on: { type: "JSON", prefixes: ["doc:"] },
  // @ts-expect-error TEXT fields do not accept numeric-field FAST options.
  fields: [{ name: "name", type: "TEXT", fast: true }],
});

Commands.searchCreate("idx", {
  // @ts-expect-error STREAM indexes identify one stream instead of key prefixes.
  on: { type: "STREAM", prefixes: ["doc:"] },
  fields: [{ name: "name", type: "TEXT" }],
});

// @ts-expect-error NOCONTENT has no field-selection clause.
Commands.searchQueryKeys("idx", {}, { select: ["name"] });

// @ts-expect-error Upstash embedding input has no Redis V* element-reference variant.
Commands.vectorQuery("idx", { _tag: "Element", element: "one" }, { topK: 2 });

// @ts-expect-error Index metric is a reviewed provider enum.
Commands.vectorCreate("idx", { dimension: 2, metric: "L2" });

// @ts-expect-error Both ACL credential inputs must remain redacted.
Commands.aclRestToken(Redacted.make("user"), "plain");

// @ts-expect-error HTTP Layers do not provide a physical session service.
Effect.runPromise(Effect.scoped(RedisSessions.pipe(Effect.provide(live))));

// @ts-expect-error Decoder requirements remain required at the execution edge.
Effect.runPromise(documents);
