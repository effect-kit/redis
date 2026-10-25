import { Effect } from "effect";

import { makeConnection, makeExecutor, makeRedis, makeRedisStreams } from "#/index";
import { sessionFixture } from "#test/support/sessions/Fixture";

export const streamFixture = Effect.fnUntraced(function* () {
  const fixture = yield* sessionFixture({ maxBlockingConnections: 1 });
  const connection = yield* makeConnection(fixture.config).pipe(Effect.provide(fixture.layer));
  const redis = makeRedis(makeExecutor(connection));
  return {
    ...fixture,
    redis,
    connection,
    streams: makeRedisStreams(redis, fixture.sessions),
    ordinary: fixture.primary,
    blocking: fixture.secondary,
  };
});

/** The fixture owns only RESP bytes; every request still traverses the production scheduler. */
export const groupReply = (id = "1-0") =>
  `*1\r\n*2\r\n$1\r\ns\r\n*1\r\n*2\r\n$${id.length}\r\n${id}\r\n*2\r\n$1\r\nf\r\n$1\r\nv\r\n`;
