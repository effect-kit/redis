import { Effect } from "effect";

import type { PreparedCommand } from "#/command/Command";
import { checkOrdinary, commandToken } from "#/connection/OrdinaryCommand";
import { UpstashError } from "#/errors/UpstashError";
import type { RedisArgument } from "#/RedisArgument";
import type { UpstashSettings } from "#/upstash/Config";

const utf8 = new TextEncoder();
const unpaired = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const unsupported = () =>
  new UpstashError({ stage: "request", reason: "unsupported", delivery: "unsent" });
const encoding = () =>
  new UpstashError({ stage: "request", reason: "encoding", delivery: "unsent" });
const limit = () => new UpstashError({ stage: "request", reason: "limit", delivery: "unsent" });

// Measure escaped UTF8 before allocating a JSON token; control-heavy input can expand sixfold.
const tokenSize = (value: string, maximum: number) => {
  let length = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) length += 2;
    else if (code < 32) length += 6;
    else if (code < 128) length++;
    else if (code < 2048) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      length += 4;
      index++;
    } else length += 3;
    if (length > maximum) throw limit();
  }
  if (length > maximum) throw limit();
};

export const validateHttpCommand = (command: PreparedCommand<unknown, unknown, unknown>) =>
  Effect.suspend(() => {
    const name = commandToken(command.tokens[0]);
    if (
      command.metadata.execution !== "ordinary" ||
      command.routing._tag === "Node" ||
      command.routing._tag === "Slot" ||
      checkOrdinary(command.tokens) !== undefined ||
      ["CLUSTER", "SENTINEL", "CLIENT"].includes(name)
    )
      return Effect.fail(unsupported());

    return Effect.void;
  });

const text = (argument: RedisArgument): string => {
  if (typeof argument === "string") {
    if (unpaired.test(argument)) throw encoding();
    return argument;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(argument);
  } catch {
    throw encoding();
  }
};

export interface HttpRequestBody {
  readonly path: string;
  readonly body: Uint8Array;
  readonly contentType: string;
}

/** JSON arrays cannot encode arbitrary binary arguments. Only an explicit final-body form can. */
export const encodeRequest = (
  commands: ReadonlyArray<PreparedCommand<unknown, unknown, unknown>>,
  mode: "ordinary" | "pipeline" | "transaction",
  config: UpstashSettings,
) =>
  Effect.try({
    try: (): HttpRequestBody => {
      const parts: Array<string> = [];
      let total = 0;
      const append = (fragment: string) => {
        total += utf8.encode(fragment).length;
        if (total > config.maxRequestBytes) throw limit();
        parts.push(fragment);
      };

      if (mode !== "ordinary") append("[");
      for (const [commandIndex, command] of commands.entries()) {
        if (commandIndex > 0) append(",");
        append("[");
        for (const [index, argument] of command.tokens.entries()) {
          if (argument.length > config.maxRequestBytes) throw limit();
          if (index > 0) append(",");

          let selected: string;
          try {
            selected = text(argument);
          } catch (error) {
            if (
              !(error instanceof UpstashError) ||
              mode !== "ordinary" ||
              index !== command.tokens.length - 1 ||
              index === 0 ||
              typeof argument === "string"
            )
              throw error;

            const segments = command.tokens.slice(0, -1).map(text);
            // WHATWG URLs normalize dot segments even when their dots are percent encoded.
            if (segments.some((segment) => segment === "." || segment === "..")) throw encoding();
            const path = `/${segments.map(encodeURIComponent).join("/")}`;
            if (utf8.encode(path).length + argument.length > config.maxRequestBytes) throw limit();
            return {
              path,
              body: new Uint8Array(argument),
              contentType: "application/octet-stream",
            };
          }

          tokenSize(selected, config.maxRequestBytes - total);
          append(JSON.stringify(selected));
        }
        append("]");
      }
      if (mode !== "ordinary") append("]");

      return {
        path: mode === "ordinary" ? "" : mode === "pipeline" ? "/pipeline" : "/multi-exec",
        body: utf8.encode(parts.join("")),
        contentType: "application/json",
      };
    },
    catch: (error) => {
      if (error instanceof UpstashError) return error;
      throw error;
    },
  });
