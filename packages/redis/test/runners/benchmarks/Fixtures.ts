import type { Input } from "#test/runners/benchmarks/Options";

/** Equal-length keys keep construction-mode comparisons independent of request byte size. */
export const smallKeys = (input: Input) =>
  (input.construction === "call" && input.workload.startsWith("get-256b")
    ? ["small", "smal1", "smal2", "smal3"]
    : ["small"]
  ).map((suffix) => `${input.prefix}${suffix}`);

export const keySequence = (keys: ReadonlyArray<string>) => {
  let index = 0;

  return () => {
    const key = keys[index++ % keys.length];
    if (key === undefined) throw new Error("Empty benchmark key sequence");
    return key;
  };
};
