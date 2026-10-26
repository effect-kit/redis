export const selectRuntime = (runtime: string | undefined) => {
  if (runtime === undefined || runtime === "all" || runtime === "node" || runtime === "bun")
    return runtime ?? "all";

  throw new Error("Expected node, bun or all runtimes");
};
