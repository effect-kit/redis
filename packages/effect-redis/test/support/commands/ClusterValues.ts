import type { RespValue } from "#/protocol/RespValue";

export const clusterText = (text: string): RespValue => ({
  _tag: "BlobString",
  value: new TextEncoder().encode(text),
});
export const clusterInteger = (value: bigint): RespValue => ({ _tag: "Integer", value });
export const clusterArray = (...values: RespValue[]): RespValue => ({ _tag: "Array", values });
export const clusterOk: RespValue = { _tag: "SimpleString", value: new TextEncoder().encode("OK") };
