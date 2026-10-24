/** Ordered pairs retain binary/duplicate keys. No object-key coercion is implicit. */
export type RespPairs = ReadonlyArray<readonly [RespValue, RespValue]>;

/** Lossless wire values; framing and grammar validation belong to the decoder. */
export type RespValue =
  | { readonly _tag: "SimpleString"; readonly value: Uint8Array }
  | { readonly _tag: "BlobString"; readonly value: Uint8Array }
  | { readonly _tag: "SimpleError"; readonly value: Uint8Array }
  | { readonly _tag: "BlobError"; readonly value: Uint8Array }
  | { readonly _tag: "Integer"; readonly value: bigint }
  | { readonly _tag: "BigNumber"; readonly value: bigint }
  | { readonly _tag: "Double"; readonly value: string }
  | { readonly _tag: "Boolean"; readonly value: boolean }
  | { readonly _tag: "Null"; readonly kind: "resp3" | "bulk" | "array" }
  | { readonly _tag: "VerbatimString"; readonly format: Uint8Array; readonly value: Uint8Array }
  | { readonly _tag: "Array"; readonly values: ReadonlyArray<RespValue> }
  | { readonly _tag: "Map"; readonly entries: RespPairs }
  | { readonly _tag: "Set"; readonly values: ReadonlyArray<RespValue> }
  | { readonly _tag: "Push"; readonly values: ReadonlyArray<RespValue> }
  | { readonly _tag: "Attribute"; readonly entries: RespPairs; readonly value: RespValue };
