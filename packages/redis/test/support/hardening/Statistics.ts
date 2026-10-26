/** Exact bounded samples: overflow fails instead of silently biasing latency percentiles. */
export class Latencies {
  private readonly samples: Float64Array;
  private count = 0;

  constructor(capacity = 100_000) {
    this.samples = new Float64Array(capacity);
  }

  add(millis: number) {
    if (!Number.isFinite(millis) || millis < 0) throw new Error("Invalid latency sample");
    if (this.count === this.samples.length) throw new Error("Latency sample capacity exhausted");
    this.samples[this.count++] = millis;
  }

  result() {
    if (this.count === 0) throw new Error("Empty latency measurement");
    const sorted = this.samples.subarray(0, this.count).toSorted();
    const percentile = (fraction: number) => {
      const value = sorted[Math.max(0, Math.ceil(fraction * this.count) - 1)];
      if (value === undefined) throw new Error("Missing measured percentile");
      return value;
    };
    return {
      count: this.count,
      p50Millis: percentile(0.5),
      p95Millis: percentile(0.95),
      p99Millis: percentile(0.99),
      maximumMillis: percentile(1),
    };
  }
}

/** Fit only retained post-GC samples; allocation throughput is not a memory leak measurement. */
export const heapSlope = (
  samples: ReadonlyArray<{ readonly elapsedMillis: number; readonly heapUsedBytes: number }>,
) => {
  if (samples.length < 2) throw new Error("Too few retained-heap observations");
  const meanTime = samples.reduce((sum, sample) => sum + sample.elapsedMillis, 0) / samples.length;
  const meanHeap = samples.reduce((sum, sample) => sum + sample.heapUsedBytes, 0) / samples.length;
  let covariance = 0;
  let variance = 0;
  for (const sample of samples) {
    const elapsed = sample.elapsedMillis - meanTime;
    covariance += elapsed * (sample.heapUsedBytes - meanHeap);
    variance += elapsed * elapsed;
  }
  if (variance === 0) throw new Error("Retained-heap observations have no elapsed time");
  return (covariance / variance) * 1000;
};
