import { failProtocol } from "#/errors/ProtocolError";
import type { RespValue } from "#/protocol/RespValue";

// Keep a leading BOM so it cannot turn a non-ASCII numeric header into valid syntax.
const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

export const headerText = (bytes: Uint8Array): string => textDecoder.decode(bytes);

export const readLength = (
  bytes: Uint8Array,
  maximum: number,
  offset: number,
  limit: string,
): number => {
  const text = headerText(bytes);
  if (!/^\d+$/.test(text)) return failProtocol("InvalidLength", offset);

  const count = Number(text);
  if (!Number.isSafeInteger(count) || count > maximum)
    return failProtocol("LimitExceeded", offset, limit, maximum);

  return count;
};

export const scalar = (marker: number, bytes: Uint8Array, offset: number): RespValue => {
  if (marker === 43 || marker === 45)
    return { _tag: marker === 43 ? "SimpleString" : "SimpleError", value: bytes };

  const text = headerText(bytes);

  switch (marker) {
    case 58:
    case 40: {
      if (!/^[+-]?\d+$/.test(text)) return failProtocol("InvalidNumber", offset);

      const value = BigInt(text);
      if (marker === 58 && (value < -9223372036854775808n || value > 9223372036854775807n))
        return failProtocol("InvalidNumber", offset);

      return { _tag: marker === 58 ? "Integer" : "BigNumber", value };
    }

    case 95:
      if (bytes.length !== 0) return failProtocol("InvalidType", offset);
      return { _tag: "Null", kind: "resp3" };

    case 35:
      if (text !== "t" && text !== "f") return failProtocol("InvalidBoolean", offset);
      return { _tag: "Boolean", value: text === "t" };

    case 44: {
      // Redis <7.2 can emit libc NaN spellings; preserve rather than normalize them.
      const special = /^(?:-?inf|[+-]?nan(?:\([a-z0-9_]*\))?)$/i.test(text);
      const decimal = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text);

      if (!special && !(decimal && Number.isFinite(Number(text))))
        return failProtocol("InvalidNumber", offset);

      return { _tag: "Double", value: text };
    }

    default:
      return failProtocol("InvalidType", offset);
  }
};
