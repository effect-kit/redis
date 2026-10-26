import type { Engine } from "#test/support/conformance/Contract";

// Expectations describe these pinned builds. Runtime discovery must not silently select a passing branch.
const missing: Readonly<Record<Engine, ReadonlyArray<string>>> = {
  redis: ["DELIFEQ"],
  valkey: ["DIGEST", "DELEX", "INCREX"],
  dragonfly: ["LCS", "DELIFEQ", "INCREX", "MSETEX", "HGETDEL", "FCALL"],
  keydb: [
    "LCS",
    "DIGEST",
    "DELEX",
    "DELIFEQ",
    "INCREX",
    "MSETEX",
    "HSETEX",
    "HGETEX",
    "HGETDEL",
    "HEXPIRE",
    "LMPOP",
    "ZMPOP",
    "ZINTERCARD",
    "SINTERCARD",
    "SORT_RO",
    "EXPIRETIME",
    "PEXPIRETIME",
    "FCALL",
    "EVAL_RO",
  ],
  redict: [
    "DIGEST",
    "DELEX",
    "DELIFEQ",
    "INCREX",
    "MSETEX",
    "HSETEX",
    "HGETEX",
    "HGETDEL",
    "HEXPIRE",
  ],
  garnet: [
    "DIGEST",
    "DELEX",
    "DELIFEQ",
    "INCREX",
    "MSETEX",
    "HSETEX",
    "HGETEX",
    "HGETDEL",
    "SORT_RO",
    "COPY",
    "TOUCH",
    "XADD",
    "XAUTOCLAIM",
    "XCLAIM",
    "XREADGROUP",
    "FCALL",
    "EVAL_RO",
  ],
  kvrocks: ["DELIFEQ", "INCREX", "HSETEX", "HGETEX", "HGETDEL", "HEXPIRE", "TOUCH"],
};

const versions: Readonly<Record<Engine, string>> = {
  redis: "8.10.2",
  valkey: "9.1.2",
  dragonfly: "2.0.2",
  keydb: "6.3.4",
  redict: "7.3.6",
  garnet: "2.2.4",
  kvrocks: "2.17.0",
};

export const expectations = (engine: Engine, version: string) => {
  if (versions[engine] !== version) throw new Error("Unreviewed engine/version conformance target");
  const unavailable = new Set(missing[engine]);

  return { engine, version, unavailable };
};
export type Expectations = ReturnType<typeof expectations>;
