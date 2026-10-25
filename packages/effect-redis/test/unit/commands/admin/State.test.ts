import { expect, it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";

import type { Command } from "#/command/Command";
import { Commands } from "#/index";
import { adminCases } from "#test/support/commands/AdminCase";
import { array, blob, bytes, integer, missing, ok } from "#test/support/commands/CoreCase";

adminCases("client", [
  {
    command: Commands.clientId(),
    tokens: ["CLIENT", "ID"],
    reply: integer(9007199254740993n),
    expected: 9007199254740993n,
  },
  {
    command: Commands.clientGetName(),
    tokens: ["CLIENT", "GETNAME"],
    reply: missing,
    expected: Option.none(),
  },
  {
    command: Commands.clientGetRedir(),
    tokens: ["CLIENT", "GETREDIR"],
    reply: integer(-1n),
    expected: -1n,
  },
  {
    command: Commands.clientInfo(),
    tokens: ["CLIENT", "INFO"],
    reply: blob("private"),
    expected: "private",
  },
  { command: Commands.clientHelp(), tokens: ["CLIENT", "HELP"], reply: array(), expected: [] },
  {
    command: Commands.echo(bytes("binary")),
    execution: "ordinary",
    tokens: ["ECHO", bytes("binary")],
    reply: blob("binary"),
    expected: bytes("binary"),
  },
  {
    command: Commands.clientList({ type: "normal", ids: [4n] }),
    tokens: ["CLIENT", "LIST", "TYPE", "normal", "ID", "4"],
    reply: blob("private"),
    expected: "private",
  },
  {
    command: Commands.clientSetName("name"),
    tokens: ["CLIENT", "SETNAME", "name"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.clientSetInfo("lib-name", "effect"),
    tokens: ["CLIENT", "SETINFO", "lib-name", "effect"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.clientNoEvict(true),
    tokens: ["CLIENT", "NO-EVICT", "ON"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.clientNoTouch(false),
    tokens: ["CLIENT", "NO-TOUCH", "OFF"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.clientPause(2, "WRITE"),
    tokens: ["CLIENT", "PAUSE", "2", "WRITE"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.clientUnpause(),
    tokens: ["CLIENT", "UNPAUSE"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.clientUnblock(8n, "ERROR"),
    tokens: ["CLIENT", "UNBLOCK", "8", "ERROR"],
    reply: integer(0n),
    expected: false,
  },
  {
    command: Commands.clientKill({
      id: 9n,
      type: "normal",
      user: "u",
      address: "a",
      localAddress: "l",
      skipMe: true,
      maxAgeSeconds: 5,
    }),
    tokens: [
      "CLIENT",
      "KILL",
      "ID",
      "9",
      "TYPE",
      "normal",
      "USER",
      "u",
      "ADDR",
      "a",
      "LADDR",
      "l",
      "MAXAGE",
      "5",
      "SKIPME",
      "YES",
    ],
    reply: integer(1n),
    expected: 1n,
  },
  {
    command: Commands.clientKillAddress("a"),
    tokens: ["CLIENT", "KILL", "a"],
    reply: ok,
    expected: undefined,
  },
]);

adminCases("persistence", [
  { command: Commands.dbsize(), tokens: ["DBSIZE"], reply: integer(8n), expected: 8n },
  { command: Commands.lastSave(), tokens: ["LASTSAVE"], reply: integer(10n), expected: 10n },
  {
    command: Commands.time(),
    tokens: ["TIME"],
    reply: array(blob("1000"), blob("123")),
    expected: [1000n, 123n],
  },
  {
    command: Commands.role(),
    tokens: ["ROLE"],
    reply: array(blob("master"), integer(0n), array()),
    expected: [blob("master"), integer(0n), array()],
  },
  { command: Commands.save(), tokens: ["SAVE"], reply: ok, expected: undefined },
  {
    command: Commands.bgrewriteaof(),
    tokens: ["BGREWRITEAOF"],
    reply: blob("started"),
    expected: "started",
  },
  {
    command: Commands.bgsave(true),
    tokens: ["BGSAVE", "SCHEDULE"],
    reply: blob("started"),
    expected: "started",
  },
  {
    command: Commands.flushDb("SYNC"),
    tokens: ["FLUSHDB", "SYNC"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.flushAll("ASYNC"),
    tokens: ["FLUSHALL", "ASYNC"],
    reply: ok,
    expected: undefined,
  },
  { command: Commands.swapDb(1, 2), tokens: ["SWAPDB", "1", "2"], reply: ok, expected: undefined },
  {
    command: Commands.replicaOf({ host: "primary", port: 6379 }),
    tokens: ["REPLICAOF", "primary", "6379"],
    reply: ok,
    expected: "OK",
  },
  {
    command: Commands.slaveOf("NO ONE"),
    tokens: ["SLAVEOF", "NO", "ONE"],
    reply: ok,
    expected: "OK",
  },
  {
    command: Commands.failover({
      to: { host: "replica", port: 6379, force: true },
      timeoutMillis: 100,
    }),
    tokens: ["FAILOVER", "TO", "replica", "6379", "FORCE", "TIMEOUT", "100"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.failover({ abort: true }),
    tokens: ["FAILOVER", "ABORT"],
    reply: ok,
    expected: undefined,
  },
  {
    command: Commands.lolwut({ version: 6, args: [10, 5] }),
    tokens: ["LOLWUT", "VERSION", "6", "10", "5"],
    reply: blob("art"),
    expected: "art",
  },
  {
    command: Commands.flushSlots([[0, 2]], "SYNC"),
    tokens: ["SFLUSH", "0", "2", "SYNC"],
    reply: array(array(integer(0n), integer(2n))),
    expected: [[0n, 2n]],
  },
]);

it.effect("ADMIN MIGRATE: exact key indexes include authentication and destination tokens", () =>
  Effect.gen(function* () {
    const prepared = yield* Commands.migrate(["a", "b"], {
      host: "destination",
      port: 6379,
      database: 2,
      timeoutMillis: 500,
      copy: true,
      replace: true,
      auth: { username: "u", password: Redacted.make("secret") },
    }).prepare;
    expect(prepared.tokens).toEqual([
      "MIGRATE",
      "destination",
      "6379",
      "",
      "2",
      "500",
      "COPY",
      "REPLACE",
      "AUTH2",
      "u",
      "secret",
      "KEYS",
      "a",
      "b",
    ]);
    expect(prepared.routing).toEqual({
      _tag: "Keys",
      keys: [
        { index: 12, access: "read-write" },
        { index: 13, access: "read-write" },
      ],
    });
    expect(yield* prepared.decode({ _tag: "SimpleString", value: bytes("NOKEY") })).toBe("NOKEY");

    const invalid: ReadonlyArray<Command<unknown>> = [
      Commands.clientKill({}),
      Commands.flushSlots([[3, 2]]),
      Commands.migrate(["k"], { host: "h", port: 65536, database: 0, timeoutMillis: 1 }),
    ];

    for (const command of invalid)
      expect(yield* Effect.flip(command.prepare)).toMatchObject({
        _tag: "CommandInputError",
        delivery: "unsent",
      });
  }),
);
