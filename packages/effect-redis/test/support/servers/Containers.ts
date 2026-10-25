import { randomUUID } from "node:crypto";

import { Effect, Redacted } from "effect";

import {
  GenericContainer,
  getContainerRuntimeClient,
  getReaper,
  ImageName,
  PullPolicy,
} from "testcontainers";

import { FixtureError } from "#test/support/servers/FixtureError";
import { imageReference, reaperImage } from "#tools/FixtureTargets";

process.env.RYUK_CONTAINER_IMAGE = imageReference(reaperImage);
process.env.TESTCONTAINERS_REUSE_ENABLE = "false";
process.env.TESTCONTAINERS_RYUK_DISABLED = "false";

export const containerRequest = <A>(stage: string, request: () => Promise<A>) =>
  Effect.tryPromise({
    try: request,
    catch: (cause) => new FixtureError({ stage, cause: Redacted.make(cause) }),
  });

/** Add Docker options absent from GenericContainer's public fluent methods. */
export class FixtureContainer extends GenericContainer {
  readonly fixtureName = `effect-redis-${randomUUID()}`;
  diagnostic = "";
  constructor(readonly reference: string) {
    super(reference);
    this.withLogConsumer((stream) => {
      stream.on("data", (chunk) => {
        this.diagnostic = (this.diagnostic + String(chunk)).slice(-2048);
      });
      stream.on("error", () => {
        this.diagnostic = "Container log stream failed";
      });
    });
    this.withName(this.fixtureName)
      .withLabels({ "effect-redis.fixture": "true" })
      .withPullPolicy(PullPolicy.neverPull())
      .withUser("0:0");
    this.hostConfig.ReadonlyRootfs = true;
  }
  loopbackPort(port: number) {
    this.withExposedPorts(port);
    this.hostConfig.PortBindings = { [`${port}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: "0" }] };
    return this;
  }
  sharedVolume(volume: string, path: string) {
    this.hostConfig.Binds = [...(this.hostConfig.Binds ?? []), `${volume}:${path}:rw`];
    return this;
  }
}

const missing = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "statusCode" in cause && cause.statusCode === 404;

const requireImage = Effect.fnUntraced(function* (reference: string) {
  const client = yield* containerRequest("container-runtime", getContainerRuntimeClient);
  const exists = yield* containerRequest("image-inspect", () =>
    client.image.exists(ImageName.fromString(reference)),
  );
  if (!exists)
    return yield* new FixtureError({
      stage: "image-missing",
      diagnostic: "Run pnpm fixtures:pull before live tests",
    });
});

/** Own the name before start: copying files or starting can fail before TC returns a handle. */
export const scopedContainer = Effect.fnUntraced(function* (container: FixtureContainer) {
  const client = yield* containerRequest("container-runtime", getContainerRuntimeClient);
  yield* requireImage(container.reference);
  yield* requireImage(imageReference(reaperImage));
  yield* Effect.acquireRelease(Effect.succeed(container.fixtureName), (name) =>
    containerRequest("container-remove", async () => {
      try {
        await client.container.dockerode.getContainer(name).remove({ force: true, v: true });
      } catch (cause) {
        if (!missing(cause)) throw cause;
      }
    }).pipe(Effect.orDie),
  );
  // Otherwise SDK acquisition could create a container after interruption has run cleanup.
  return yield* containerRequest("container-start", () => container.start()).pipe(
    Effect.uninterruptible,
    Effect.mapError(
      (error) =>
        new FixtureError({
          stage: error.stage,
          diagnostic: container.diagnostic,
          cause: Redacted.make(error),
        }),
    ),
  );
});

export const containerExists = (name: string) =>
  containerRequest("container-inspect", async () => {
    const client = await getContainerRuntimeClient();
    const containers = await client.container.dockerode.listContainers({
      all: true,
      filters: { name: [`^/${name}$`] },
    });
    return containers.length !== 0;
  });

export const sharedVolume = Effect.gen(function* () {
  const client = yield* containerRequest("container-runtime", getContainerRuntimeClient);
  yield* requireImage(imageReference(reaperImage));
  const reaper = yield* containerRequest("container-reaper", () => getReaper(client));
  const name = `effect-redis-${randomUUID()}`;
  yield* Effect.acquireRelease(Effect.succeed(name), () =>
    containerRequest("volume-remove", async () => {
      try {
        await client.container.dockerode.getVolume(name).remove();
      } catch (cause) {
        if (!missing(cause)) throw cause;
      }
    }).pipe(Effect.orDie),
  );
  yield* containerRequest("volume-create", () =>
    client.container.dockerode.createVolume({
      Name: name,
      Labels: {
        "effect-redis.fixture": "true",
        "org.testcontainers.session-id": reaper.sessionId,
      },
    }),
  ).pipe(Effect.uninterruptible);
  return name;
});
