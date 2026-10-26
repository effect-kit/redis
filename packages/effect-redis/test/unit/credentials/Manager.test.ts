import { expect, it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Redacted,
  Ref,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";

import { makeCredentialManager } from "#/credentials/Manager";
import type { CredentialSnapshot } from "#/credentials/Manager";
import { provider } from "#/credentials/Provider";

const password = (snapshot: CredentialSnapshot) =>
  Redacted.value(Option.getOrThrow(Option.fromUndefinedOr(snapshot.credentials)).password);

it.effect(
  "credential snapshots refresh before expiry, preserve exact expiry and invalidate deliberately",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      const manager = yield* makeCredentialManager(
        provider(
          Effect.gen(function* () {
            calls++;
            return {
              password: Redacted.make(`synthetic-${calls}`),
              expiresAtMillis: (yield* Clock.currentTimeMillis) + 1000,
            };
          }),
          { refreshBeforeMillis: 100 },
        ),
      );

      expect((yield* manager.get).credentials?.expiresAtMillis).toBe(1000);
      expect(password(yield* manager.get)).toBe("synthetic-1");
      expect(calls).toBe(1);
      yield* TestClock.adjust(901);
      expect(password(yield* manager.get)).toBe("synthetic-2");

      yield* manager.invalidate;
      expect((yield* manager.get).revision).toBe(1);
      expect(calls).toBe(3);
      expect(yield* manager.snapshot).toMatchObject({
        waiting: 0,
        acquisitions: 3,
        cacheHits: 1,
        revision: 1,
      });
    }),
);

it.effect("concurrent refresh is coalesced and one cancelled waiter does not cancel another", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let calls = 0;
    const manager = yield* makeCredentialManager(
      provider(
        Effect.gen(function* () {
          calls++;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return { password: Redacted.make("synthetic"), expiresAtMillis: 1000 };
        }),
        { refreshBeforeMillis: 0, maxWaiters: 2 },
      ),
    );
    const first = yield* manager.get.pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const second = yield* manager.get.pipe(Effect.forkChild);
    while ((yield* manager.snapshot).waiting !== 2) yield* Effect.yieldNow;

    expect(yield* Effect.flip(manager.get)).toMatchObject({ reason: "capacity" });
    yield* Fiber.interrupt(first);
    expect((yield* manager.snapshot).waiting).toBe(1);
    yield* Deferred.succeed(release, undefined);
    expect((yield* Fiber.join(second)).credentials?.expiresAtMillis).toBe(1000);
    expect(calls).toBe(1);
  }),
);

class Identity extends Context.Service<Identity, { readonly label: string }>()(
  "test/credentials/Identity",
) {}

it.effect("the same provider declaration captures isolated deployment identities and caches", () =>
  Effect.gen(function* () {
    const source = provider(
      Identity.pipe(
        Effect.map(({ label }) => ({ password: Redacted.make(label), expiresAtMillis: 1000 })),
      ),
      { refreshBeforeMillis: 0 },
    );
    const first = yield* makeCredentialManager(source).pipe(
      Effect.provideService(Identity, { label: "synthetic-a" }),
    );
    const second = yield* makeCredentialManager(source).pipe(
      Effect.provideService(Identity, { label: "synthetic-b" }),
    );

    expect(password(yield* first.get)).toBe("synthetic-a");
    expect(password(yield* second.get)).toBe("synthetic-b");
    yield* first.invalidate;
    expect((yield* second.get).revision).toBe(0);
  }),
);

it.effect(
  "acquisition failures are redacted, expired snapshots fail closed and unknown-expiry sources are reacquired",
  () =>
    Effect.gen(function* () {
      const failed = yield* makeCredentialManager(
        provider(Effect.fail({ token: "synthetic-secret" })),
      );
      const error = yield* Effect.flip(failed.get);
      expect(error).toMatchObject({ _tag: "CredentialError", reason: "acquisition" });
      expect(JSON.stringify(error)).not.toContain("synthetic-secret");

      const expired = yield* makeCredentialManager(
        provider(Effect.succeed({ password: Redacted.make("synthetic"), expiresAtMillis: 100 }), {
          refreshBeforeMillis: 100,
        }),
      );
      expect(yield* Effect.flip(expired.get)).toMatchObject({ reason: "expired" });
      let calls = 0;
      const rotating = yield* makeCredentialManager(
        provider(Effect.sync(() => ({ password: Redacted.make(`synthetic-${++calls}`) }))),
      );
      yield* rotating.get;
      yield* rotating.get;
      expect(calls).toBe(2);
    }),
);

it.effect(
  "acquisition timeout joins the credential resource scope and releases waiter capacity",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const released = yield* Ref.make(false);
      const manager = yield* makeCredentialManager(
        provider(
          Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
            Ref.set(released, true),
          ).pipe(Effect.andThen(Effect.never)),
          { acquisitionTimeoutMillis: 10 },
        ),
      );
      const running = yield* manager.get.pipe(Effect.forkChild);
      yield* Deferred.await(started);

      yield* TestClock.adjust(10);
      expect(yield* Effect.flip(Fiber.join(running))).toMatchObject({ reason: "timeout" });
      expect(yield* Ref.get(released)).toBe(true);
      expect((yield* manager.snapshot).waiting).toBe(0);
    }),
);

it.effect(
  "invalidating an in-progress refresh fences stale results and permits a fresh acquisition",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let calls = 0;
      const manager = yield* makeCredentialManager(
        provider(
          Effect.suspend(() => {
            calls++;
            return calls === 1
              ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.succeed({ password: Redacted.make("synthetic-new"), expiresAtMillis: 1000 });
          }),
          { refreshBeforeMillis: 0 },
        ),
      );
      const stale = yield* manager.get.pipe(Effect.forkChild);
      yield* Deferred.await(started);

      yield* manager.invalidate;
      expect(yield* Effect.flip(Fiber.join(stale))).toMatchObject({ reason: "rotated" });
      expect((yield* manager.get).revision).toBe(1);
      expect(calls).toBe(2);
    }),
);

it.effect("credential defects remain defects and prevent automatic repeat acquisition", () =>
  Effect.gen(function* () {
    let calls = 0;
    const manager = yield* makeCredentialManager(
      provider(
        Effect.sync(() => {
          calls++;
        }).pipe(Effect.andThen(Effect.die("synthetic-credential-defect"))),
      ),
    );

    for (let attempt = 0; attempt < 2; attempt++) {
      const exit = yield* Effect.exit(manager.get);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }
    expect(calls).toBe(1);
  }),
);

it.effect(
  "closing the owner interrupts credential refresh and retained managers reject new acquisition",
  () =>
    Effect.gen(function* () {
      const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const started = yield* Deferred.make<void>();
      const manager = yield* makeCredentialManager(
        provider(Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))),
      ).pipe(Scope.provide(owner));
      const running = yield* manager.get.pipe(Effect.forkChild);
      yield* Deferred.await(started);

      yield* Scope.close(owner, Exit.void);
      const exit = yield* Fiber.await(running);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(yield* Effect.flip(manager.get)).toMatchObject({ reason: "closed" });
    }),
);
