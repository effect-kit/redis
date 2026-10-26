import { failProtocol } from "#/errors/ProtocolError";
import type { RespPairs, RespValue } from "#/protocol/RespValue";

export interface AggregateFrame {
  readonly tag: "Array" | "Map" | "Set" | "Push" | "Attribute";
  readonly expected: number | undefined;
  readonly metadataCount: number;
  readonly values: Array<RespValue>;
  readonly offset: number;
}

const pairs = (values: ReadonlyArray<RespValue>, count: number): RespPairs => {
  const entries: Array<readonly [RespValue, RespValue]> = [];

  for (let index = 0; index < count; index += 2) {
    const key = values[index];
    const value = values[index + 1];

    if (key === undefined || value === undefined)
      throw new Error("Aggregate pair ownership invariant");

    entries.push([key, value]);
  }

  return entries;
};

export const completeAggregate = (frame: AggregateFrame): RespValue => {
  switch (frame.tag) {
    case "Attribute": {
      const value = frame.values[frame.metadataCount];
      if (value === undefined) throw new Error("Attribute value ownership invariant");

      return { _tag: "Attribute", entries: pairs(frame.values, frame.metadataCount), value };
    }

    case "Map":
      if (frame.values.length % 2 !== 0) return failProtocol("InvalidLength", frame.offset);

      return { _tag: "Map", entries: pairs(frame.values, frame.values.length) };

    case "Push": {
      let first = frame.values[0];
      while (first?._tag === "Attribute") first = first.value;

      if (first?._tag !== "SimpleString" && first?._tag !== "BlobString")
        return failProtocol("InvalidPush", frame.offset);

      return { _tag: "Push", values: frame.values };
    }

    default:
      return { _tag: frame.tag, values: frame.values };
  }
};
