import type { RespValue } from "../../../src/protocol/RespValue.js";
import { bytes, joinBytes } from "./Decode.js";

export const generatedValue = (selector: number, depth: number, binary: Uint8Array): RespValue => {
  const kind = depth === 0 ? selector % 9 : selector % 14;
  const child = () => generatedValue(selector + 3, depth - 1, binary);
  switch (kind) {
    case 0:
      return { _tag: "BlobString", value: binary };
    case 1:
      return { _tag: "SimpleString", value: bytes(`s${selector}`) };
    case 2:
      return { _tag: "Integer", value: BigInt(selector) * 9007199254740993n };
    case 3:
      return { _tag: "BigNumber", value: BigInt(selector) * 1000000000000000000000000000000n };
    case 4:
      return { _tag: "Double", value: selector % 2 === 0 ? "-0" : "1.25E-9" };
    case 5:
      return { _tag: "Null", kind: selector % 2 === 0 ? "bulk" : "resp3" };
    case 6:
      return { _tag: "Boolean", value: selector % 2 === 0 };
    case 7:
      return { _tag: "BlobError", value: binary };
    case 8:
      return { _tag: "VerbatimString", format: bytes("txt"), value: binary };
    case 9:
      return { _tag: "Array", values: [child(), generatedValue(selector + 5, depth - 1, binary)] };
    case 10:
      return { _tag: "Set", values: [child(), child()] };
    case 11:
      return {
        _tag: "Map",
        entries: [
          [{ _tag: "BlobString", value: binary }, child()],
          [{ _tag: "BlobString", value: binary }, child()],
        ],
      };
    case 12:
      return { _tag: "Attribute", entries: [], value: child() };
    default:
      return {
        _tag: "Attribute",
        entries: [[{ _tag: "SimpleString", value: bytes("meta") }, child()]],
        value: generatedValue(selector + 2, depth - 1, binary),
      };
  }
};

/** Test-only independent wire writer, including the alternate streamed encodings. */
export const wireValue = (value: RespValue, streamed: boolean): Uint8Array => {
  const child = (nested: RespValue) => wireValue(nested, streamed);
  switch (value._tag) {
    case "SimpleString":
      return joinBytes(bytes("+"), value.value, bytes("\r\n"));
    case "SimpleError":
      return joinBytes(bytes("-"), value.value, bytes("\r\n"));
    case "Integer":
      return bytes(`:${value.value}\r\n`);
    case "BigNumber":
      return bytes(`(${value.value}\r\n`);
    case "Double":
      return bytes(`,${value.value}\r\n`);
    case "Boolean":
      return bytes(value.value ? "#t\r\n" : "#f\r\n");
    case "Null":
      return bytes(
        value.kind === "bulk" ? "$-1\r\n" : value.kind === "array" ? "*-1\r\n" : "_\r\n",
      );
    case "BlobString":
      if (streamed)
        return value.value.length === 0
          ? bytes("$?\r\n;0\r\n")
          : joinBytes(bytes(`$?\r\n;${value.value.length}\r\n`), value.value, bytes("\r\n;0\r\n"));
      return joinBytes(bytes(`$${value.value.length}\r\n`), value.value, bytes("\r\n"));
    case "BlobError":
      return joinBytes(bytes(`!${value.value.length}\r\n`), value.value, bytes("\r\n"));
    case "VerbatimString":
      return joinBytes(
        bytes(`=${value.value.length + 4}\r\n`),
        value.format,
        bytes(":"),
        value.value,
        bytes("\r\n"),
      );
    case "Array":
    case "Set":
    case "Push": {
      const marker = value._tag === "Array" ? "*" : value._tag === "Set" ? "~" : ">";
      const stream = streamed && value._tag !== "Push";
      return joinBytes(
        bytes(`${marker}${stream ? "?" : value.values.length}\r\n`),
        ...value.values.map(child),
        bytes(stream ? ".\r\n" : ""),
      );
    }
    case "Map":
      return joinBytes(
        bytes(`%${streamed ? "?" : value.entries.length}\r\n`),
        ...value.entries.flatMap(([key, entry]) => [child(key), child(entry)]),
        bytes(streamed ? ".\r\n" : ""),
      );
    case "Attribute":
      return joinBytes(
        bytes(`|${value.entries.length}\r\n`),
        ...value.entries.flatMap(([key, entry]) => [child(key), child(entry)]),
        child(value.value),
      );
  }
};
