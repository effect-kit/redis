import { Result } from "effect";

import { UpstashError } from "#/errors/UpstashError";

export interface JsonNumber {
  readonly _tag: "NumberToken";
  readonly token: string;
}
export type JsonValue =
  | null
  | boolean
  | string
  | JsonNumber
  | ReadonlyArray<JsonValue>
  | ReadonlyMap<string, JsonValue>;

const invalid = (): never => {
  throw new SyntaxError("Invalid provider JSON");
};

/** Numeric lexemes must survive JSON decoding before any IEEE-number conversion. */
export const parseJson = (
  text: string,
  limits: { readonly maxNestingDepth: number; readonly maxAggregateEntries: number },
): Result.Result<JsonValue, UpstashError> => {
  let offset = 0;
  let entries = 0;
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const whitespace = () => {
    while (/[\t\n\r ]/.test(text[offset] ?? "x")) offset++;
  };

  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === "\\") offset++;
      else if (character === '"') return JSON.parse(text.slice(start, offset));
    }
    return invalid();
  };

  const value = (depth: number): JsonValue => {
    whitespace();
    if (++entries > limits.maxAggregateEntries || depth > limits.maxNestingDepth) return invalid();

    const character = text[offset];
    if (character === '"') return string();
    if (character === "[" || character === "{") {
      offset++;
      whitespace();
      const object = character === "{";
      const end = object ? "}" : "]";
      const array: Array<JsonValue> = [];
      const fields = new Map<string, JsonValue>();
      if (text[offset] === end) {
        offset++;
        return object ? fields : array;
      }

      while (true) {
        whitespace();
        if (object) {
          if (text[offset] !== '"') return invalid();
          const key = string();
          whitespace();
          if (text[offset++] !== ":" || fields.has(key)) return invalid();
          fields.set(key, value(depth + 1));
        } else array.push(value(depth + 1));

        whitespace();
        const separator = text[offset++];
        if (separator === end) return object ? fields : array;
        if (separator !== ",") return invalid();
      }
    }

    for (const [literal, decoded] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return decoded;
      }
    }

    number.lastIndex = offset;
    const matched = number.exec(text);
    if (matched === null) return invalid();
    offset += matched[0].length;
    return { _tag: "NumberToken", token: matched[0] };
  };

  try {
    const decoded = value(0);
    whitespace();
    if (offset !== text.length) return invalid();
    return Result.succeed(decoded);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return Result.fail(
      new UpstashError({ stage: "response", reason: "malformed", delivery: "unknown" }),
    );
  }
};
