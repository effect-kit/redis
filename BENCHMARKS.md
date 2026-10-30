# Benchmarks

| Setup    | Measured configuration                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Run      | 288 measurements in 20.7 minutes; 2026-10-30 UTC; source `a1a561b`                                                                             |
| Host     | Apple M3 Pro, 18 GiB RAM; Node.js 24.22.0; Effect 4.0.6                                                                                        |
| Clients  | Effect Redis development build; ioredis 6.0.0; node-redis 6.3.0; Valkey GLIDE 2.5.3                                                            |
| Servers  | Redis 8.10.2 and Valkey 9.1.2; local Docker TCP; RESP2; persistence disabled                                                                   |
| Samples  | Four fresh-process trials per combination; 1-second warm-up + 3-second sample; rotated client order                                            |
| Evidence | [All trials](benchmarks/trials.csv); [medians, min–max ranges, latency and resources](benchmarks/summary.csv); [settings](benchmarks/run.json) |

## Throughput

Median commands/second, higher is better. `cN` = concurrent operations. Batches count 32 GETs; transactions count eight. Batch replies are 256 B.

### Redis server

| Workload             | Effect Redis | ioredis | node-redis | Valkey GLIDE |
| -------------------- | -----------: | ------: | ---------: | -----------: |
| GET 256 B / c1       |        9,234 |  12,330 |     12,265 |        8,822 |
| GET 256 B / c32      |      107,874 | 179,120 |    174,446 |      143,121 |
| GET 64 KiB / c8      |       16,696 |  31,658 |     19,969 |       27,153 |
| SET 256 B / c16      |       74,507 |  97,542 |     96,404 |       84,319 |
| INCR / c16           |       80,805 | 109,219 |    109,846 |       88,240 |
| Pipeline 32 / c4     |      300,759 | 450,479 |    476,739 |      512,663 |
| Values batch 32 / c4 |      313,188 | 455,073 |    482,130 |      506,914 |
| Compiled 32 / c4     |      443,769 | 448,484 |    485,518 |      506,821 |
| Transaction 8 / c1   |       23,577 |  66,797 |     68,981 |       59,159 |

### Valkey server

| Workload             | Effect Redis | ioredis | node-redis | Valkey GLIDE |
| -------------------- | -----------: | ------: | ---------: | -----------: |
| GET 256 B / c1       |        9,372 |  12,231 |     12,273 |        8,863 |
| GET 256 B / c32      |      110,562 | 173,062 |    173,992 |      150,814 |
| GET 64 KiB / c8      |       17,433 |  34,580 |     21,587 |       28,930 |
| SET 256 B / c16      |       78,113 | 103,864 |    102,307 |       88,809 |
| INCR / c16           |       81,460 | 110,847 |    113,895 |       90,565 |
| Pipeline 32 / c4     |      297,775 | 457,366 |    472,532 |      521,648 |
| Values batch 32 / c4 |      317,246 | 457,987 |    473,054 |      507,390 |
| Compiled 32 / c4     |      451,297 | 461,221 |    473,531 |      513,083 |
| Transaction 8 / c1   |       22,594 |  71,592 |     68,217 |       58,335 |

## Effect Redis throughput gap

Geometric mean of matching median-throughput ratios across both servers; negative means lower throughput. “Existing APIs” excludes the values-batch and compiled variants.

| Scope                             | vs ioredis | vs node-redis | vs Valkey GLIDE |
| --------------------------------- | ---------: | ------------: | --------------: |
| Seven existing APIs × two servers |     -39.5% |        -35.6% |          -29.5% |
| Values batch × two servers        |     -31.0% |        -34.0% |          -37.8% |
| Compiled plan × two servers       |      -1.6% |         -6.7% |          -12.2% |

## Reading the results

| Detail       | Meaning                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timing       | All clients run inside Effect. Throughput uses the in-program workload timer; operation latency uses `Effect.timed`. Setup is excluded.                                                                              |
| Compiled API | Fixed arguments, preparation and first encoding outside timing. Other clients use their normal pipelines for the batch/compiled rows.                                                                                |
| Policies     | node-redis automatic pipelining enabled; ioredis/Effect Redis disabled; GLIDE native multiplexing. Effect pipelines use up to four session connections; values batches/compiled plans share one ordinary connection. |
| Transactions | Effect Redis uses the default profile; the explicit Redis/Valkey profile optimization for combined queue/EXEC submission is not enabled.                                                                             |
| Variation    | Summary CSV shows all trial ranges. Four trials are descriptive observations, not confidence bounds. Only this complete run is summarized; historical samples are excluded.                                          |
| Scope        | Hot keys, successful local operations. Results do not establish production rankings, error recovery, TLS/WAN or topology performance.                                                                                |

## Reproduce

After `pnpm install --frozen-lockfile`, `pnpm fixtures:check` and `pnpm fixtures:pull`:

```sh
pnpm bench:clients --engine all --execution effect --client all --workload all --trials 4 --warmup-ms 1000 --sample-ms 3000 --latency-clock effect --construction reuse --session-connections 4
```
