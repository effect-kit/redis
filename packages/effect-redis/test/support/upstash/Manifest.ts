import { readFileSync } from "node:fs";

import { Schema } from "effect";

const ProxyFixture = Schema.Struct({
  version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/)),
  source: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
  image: Schema.NonEmptyString,
  digest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  architectures: Schema.NonEmptyArray(Schema.Literals(["arm64", "x64"])),
}).check(
  Schema.makeFilter(
    (fixture) =>
      fixture.image === `ghcr.io/nelsonlaidev/uprest:v${fixture.version}` &&
      fixture.architectures.length === 2 &&
      new Set(fixture.architectures).size === 2,
  ),
);

/** Resolve the reviewed proxy image before Docker acquisition; research is never an input. */
export const loadProxyFixture = () =>
  Schema.decodeUnknownSync(ProxyFixture, { onExcessProperty: "error" })(
    JSON.parse(readFileSync(new URL("../../fixtures/upstash/proxy.json", import.meta.url), "utf8")),
  );

export const proxyFixture = loadProxyFixture();
export const proxyImage = `${proxyFixture.image}@${proxyFixture.digest}`;
