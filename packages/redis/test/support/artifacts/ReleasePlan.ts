import { createHash } from "node:crypto";

import { Schema } from "effect";

const PublishPlan = Schema.Struct({
  version: Schema.Literal(1),
  plan: Schema.Array(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literal("publish"),
        name: Schema.Literal("@effect-kit/redis"),
        version: Schema.NonEmptyString,
        access: Schema.Literal("public"),
        tag: Schema.Literal("latest"),
        tarball: Schema.Struct({ path: Schema.NonEmptyString, integrity: Schema.NonEmptyString }),
      }),
    ),
  ),
});

/** Bind publication to one reviewed package/version; never follow arbitrary plan paths. */
export const releasePlan = (input: unknown, version: string) => {
  const plan = Schema.decodeUnknownSync(PublishPlan, { onExcessProperty: "error" })(input);
  const releases = plan.plan.flat();
  const release = releases[0];

  if (
    releases.length !== 1 ||
    release === undefined ||
    release.version !== version ||
    release.tarball.path !== `packages/effect-kit-redis-${version}.tgz` ||
    !/^sha256-[A-Za-z0-9+/]{43}=$/.test(release.tarball.integrity)
  )
    throw new Error("Release plan does not match the candidate package");

  return release;
};

export const archiveIntegrity = (bytes: Uint8Array, algorithm: "sha256" | "sha512") =>
  `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`;

export const verifyReleaseIntegrity = (bytes: Uint8Array, integrity: string) => {
  if (archiveIntegrity(bytes, "sha256") !== integrity)
    throw new Error("Packed archive differs from the Changesets publish plan");
};
