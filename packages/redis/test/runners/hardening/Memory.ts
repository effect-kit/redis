/** Force GC only outside timed workloads; peak allocator RSS and retained JS heap are different signals. */
export const collect = () => {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof globalThis.gc === "function") globalThis.gc();
  else throw new Error("Hardening requires Node --expose-gc");
};

export const resources = (name: string) =>
  typeof Bun === "undefined"
    ? process.getActiveResourcesInfo().filter((entry) => entry === name).length
    : null;

export const memory = () => {
  const usage = process.memoryUsage();
  return {
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
    externalBytes: usage.external,
    arrayBufferBytes: usage.arrayBuffers,
  };
};
