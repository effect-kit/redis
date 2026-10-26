import { Effect, Schema } from "effect";

import type { ReplyDecoder } from "#/command/Command";
import { nodeCommand, reportText } from "#/commands/admin/Build";
import { Argument, parse } from "#/commands/internal/Input";

export interface InfoSection {
  readonly name: string;
  readonly fields: ReadonlyArray<readonly [string, string]>;
  readonly unparsed: ReadonlyArray<string>;
}

export interface ServerInfo {
  readonly raw: string;
  readonly sections: ReadonlyArray<InfoSection>;
}

/** Values remain strings: versions and counters must not silently coerce to JS numbers. */
export const decodeInfo: ReplyDecoder<ServerInfo> = (reply) =>
  reportText(reply).pipe(
    Effect.map((raw) => {
      const sections: Array<{
        name: string;
        fields: Array<readonly [string, string]>;
        unparsed: string[];
      }> = [];
      let current = {
        name: "",
        fields: [] as Array<readonly [string, string]>,
        unparsed: [] as string[],
      };
      sections.push(current);

      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("# ")) {
          current = { name: line.slice(2), fields: [], unparsed: [] };
          sections.push(current);
          continue;
        }
        if (line.length === 0) continue;

        const colon = line.indexOf(":");
        if (colon < 1) current.unparsed.push(line);
        else current.fields.push([line.slice(0, colon), line.slice(colon + 1)]);
      }

      return {
        raw,
        sections: sections.filter(
          (section) =>
            section.name !== "" || section.fields.length > 0 || section.unparsed.length > 0,
        ),
      };
    }),
  );

export const info = (sections: ReadonlyArray<string> = []) =>
  nodeCommand("INFO", decodeInfo, parse(Schema.Array(Argument), sections));
