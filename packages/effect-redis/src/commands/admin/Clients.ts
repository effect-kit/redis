import { Effect, Schema } from "effect";

import { boolean, unsigned } from "#/command/reply/Data";
import { blob, integer, optional, status, text } from "#/command/reply/Scalars";
import { help, nodeCommand, reportText, sensitive } from "#/commands/admin/Build";
import { Argument, NonNegative, Positive, parse } from "#/commands/internal/Input";
import type { Integer } from "#/commands/internal/Input";
import type { RedisArgument } from "#/RedisArgument";

const ClientType = Schema.Literals(["normal", "master", "slave", "replica", "pubsub"]);
const ListOptions = Schema.Struct({
  type: Schema.optionalKey(ClientType),
  ids: Schema.optionalKey(Schema.NonEmptyArray(Positive)),
});
export type ClientListOptions = typeof ListOptions.Type;

export const clientId = () => nodeCommand("CLIENT ID", unsigned);
export const clientGetName = () => nodeCommand("CLIENT GETNAME", optional(text));
export const clientGetRedir = () => nodeCommand("CLIENT GETREDIR", integer);
export const clientInfo = () => nodeCommand("CLIENT INFO", sensitive(reportText));
export const clientHelp = () => nodeCommand("CLIENT HELP", help);
export const echo = (value: RedisArgument) =>
  nodeCommand("ECHO", blob, parse(Argument, value).pipe(Effect.map((selected) => [selected])));

export const clientList = (options: ClientListOptions = {}) =>
  nodeCommand(
    "CLIENT LIST",
    sensitive(reportText),
    parse(ListOptions, options).pipe(
      Effect.map((selected) => [
        ...(selected.type === undefined ? [] : ["TYPE", selected.type]),
        ...(selected.ids === undefined ? [] : ["ID", ...selected.ids.map(String)]),
      ]),
    ),
  );

export const clientSetName = (name: RedisArgument) =>
  nodeCommand(
    "CLIENT SETNAME",
    status("OK"),
    parse(Argument, name).pipe(Effect.map((selected) => [selected])),
  );

export const clientSetInfo = (attribute: "lib-name" | "lib-ver", value: RedisArgument) =>
  nodeCommand(
    "CLIENT SETINFO",
    status("OK"),
    parse(Schema.Tuple([Schema.Literals(["lib-name", "lib-ver"]), Argument]), [attribute, value]),
  );

const toggle = (name: string, enabled: boolean) =>
  nodeCommand(
    name,
    status("OK"),
    parse(Schema.Boolean, enabled).pipe(Effect.map((selected) => [selected ? "ON" : "OFF"])),
  );
export const clientNoEvict = (enabled: boolean) => toggle("CLIENT NO-EVICT", enabled);
export const clientNoTouch = (enabled: boolean) => toggle("CLIENT NO-TOUCH", enabled);

export const clientPause = (timeoutMillis: Integer, mode?: "WRITE" | "ALL") =>
  nodeCommand(
    "CLIENT PAUSE",
    status("OK"),
    parse(Schema.Tuple([NonNegative, Schema.optional(Schema.Literals(["WRITE", "ALL"]))]), [
      timeoutMillis,
      mode,
    ]).pipe(
      Effect.map(([timeout, selected]) => [
        String(timeout),
        ...(selected === undefined ? [] : [selected]),
      ]),
    ),
  );
export const clientUnpause = () => nodeCommand("CLIENT UNPAUSE", status("OK"));
export const clientUnblock = (id: Integer, mode?: "TIMEOUT" | "ERROR") =>
  nodeCommand(
    "CLIENT UNBLOCK",
    boolean,
    parse(Schema.Tuple([Positive, Schema.optional(Schema.Literals(["TIMEOUT", "ERROR"]))]), [
      id,
      mode,
    ]).pipe(
      Effect.map(([client, selected]) => [
        String(client),
        ...(selected === undefined ? [] : [selected]),
      ]),
    ),
  );

const KillOptions = Schema.Struct({
  id: Schema.optionalKey(Positive),
  type: Schema.optionalKey(ClientType),
  user: Schema.optionalKey(Argument),
  address: Schema.optionalKey(Argument),
  localAddress: Schema.optionalKey(Argument),
  skipMe: Schema.optionalKey(Schema.Boolean),
  maxAgeSeconds: Schema.optionalKey(NonNegative),
});
export type ClientKillOptions = typeof KillOptions.Type;

export const clientKill = (options: ClientKillOptions) =>
  nodeCommand(
    "CLIENT KILL",
    unsigned,
    Effect.gen(function* () {
      const selected = yield* parse(KillOptions, options);
      const tokens = [
        ...(selected.id === undefined ? [] : ["ID", String(selected.id)]),
        ...(selected.type === undefined ? [] : ["TYPE", selected.type]),
        ...(selected.user === undefined ? [] : ["USER", selected.user]),
        ...(selected.address === undefined ? [] : ["ADDR", selected.address]),
        ...(selected.localAddress === undefined ? [] : ["LADDR", selected.localAddress]),
        ...(selected.maxAgeSeconds === undefined ? [] : ["MAXAGE", String(selected.maxAgeSeconds)]),
        ...(selected.skipMe === undefined ? [] : ["SKIPME", selected.skipMe ? "YES" : "NO"]),
      ];
      if (tokens.length === 0) return yield* parse(Schema.Never, options);

      return tokens;
    }),
  );

export const clientKillAddress = (address: RedisArgument) =>
  nodeCommand(
    "CLIENT KILL",
    status("OK"),
    parse(Argument, address).pipe(Effect.map((selected) => [selected])),
  );
