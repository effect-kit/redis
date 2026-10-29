# Benchmarks

| Setup    | Measured configuration                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Run      | 288 measurements in 15.8 minutes; 2026-10-29 UTC; source `8dd02ab`                                                                             |
| Host     | Apple M3 Pro, 18 GiB RAM; Node.js 24.22.0; Effect 4.0.6                                                                                        |
| Clients  | Effect Redis development build; ioredis 6.0.0; node-redis 6.3.0; Valkey GLIDE 2.5.3                                                            |
| Servers  | Redis 8.10.2 and Valkey 9.1.2; local Docker TCP; RESP2; persistence disabled                                                                   |
| Samples  | Four fresh-process trials per combination; 1-second warm-up + 2-second sample; rotated client order                                            |
| Evidence | [All trials](benchmarks/trials.csv); [medians, min–max ranges, latency and resources](benchmarks/summary.csv); [settings](benchmarks/run.json) |

## Throughput

Median commands/second, higher is better. `cN` = concurrent operations. Batches count 32 GETs; transactions count eight. Batch replies are 256 B.

### Redis server

| Workload             | Effect Redis | ioredis | node-redis | Valkey GLIDE |
| -------------------- | -----------: | ------: | ---------: | -----------: |
| GET 256 B / c1       |       10,215 |  12,877 |     12,264 |        9,114 |
| GET 256 B / c32      |       97,383 | 167,277 |    161,322 |      146,602 |
| GET 64 KiB / c8      |       14,705 |  30,543 |     20,134 |       27,993 |
| SET 256 B / c16      |       76,964 | 107,004 |    104,730 |       90,809 |
| INCR / c16           |       77,498 | 108,758 |    107,110 |       88,793 |
| Pipeline 32 / c4     |      268,836 | 447,775 |    475,549 |      497,371 |
| Values batch 32 / c4 |      268,391 | 448,679 |    479,215 |      493,929 |
| Compiled 32 / c4     |      359,553 | 447,369 |    474,905 |      503,615 |
| Transaction 8 / c1   |       19,712 |  73,456 |     76,920 |       52,077 |

### Valkey server

| Workload             | Effect Redis | ioredis | node-redis | Valkey GLIDE |
| -------------------- | -----------: | ------: | ---------: | -----------: |
| GET 256 B / c1       |        9,084 |  12,741 |     12,055 |        8,874 |
| GET 256 B / c32      |       97,024 | 172,187 |    160,073 |      146,296 |
| GET 64 KiB / c8      |       14,270 |  33,271 |     21,004 |       28,904 |
| SET 256 B / c16      |       69,500 | 103,796 |    102,045 |       88,095 |
| INCR / c16           |       77,802 | 111,133 |    108,944 |       90,417 |
| Pipeline 32 / c4     |      267,309 | 446,438 |    452,533 |      519,204 |
| Values batch 32 / c4 |      269,101 | 448,157 |    457,810 |      515,001 |
| Compiled 32 / c4     |      356,123 | 446,869 |    453,423 |      496,691 |
| Transaction 8 / c1   |       19,671 |  64,810 |     70,425 |       57,815 |

## Effect Redis throughput gap

Geometric mean of matching median-throughput ratios across both servers; negative means lower throughput. “Existing APIs” excludes the values-batch and compiled variants.

| Scope                             | vs ioredis | vs node-redis | vs Valkey GLIDE |
| --------------------------------- | ---------: | ------------: | --------------: |
| Seven existing APIs × two servers |     -44.4% |        -40.5% |          -35.1% |
| Values batch × two servers        |     -40.1% |        -42.6% |          -46.7% |
| Compiled plan × two servers       |     -20.0% |        -22.9% |          -28.5% |

## Reading the results

| Detail       | Meaning                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timing       | All clients run inside Effect. Throughput uses the in-program workload timer; operation latency uses `Effect.timed`. Setup is excluded.                                                                              |
| Compiled API | Fixed arguments, preparation and first encoding outside timing. Other clients use their normal pipelines for the batch/compiled rows.                                                                                |
| Policies     | node-redis automatic pipelining enabled; ioredis/Effect Redis disabled; GLIDE native multiplexing. Effect pipelines use up to four session connections; values batches/compiled plans share one ordinary connection. |
| Variation    | Summary CSV shows all trial ranges. Four trials are descriptive observations, not confidence bounds. The implementation is unchanged from the short run; historical samples are excluded.                            |
| Scope        | Hot keys, successful local operations. Results do not establish production rankings, error recovery, TLS/WAN or topology performance.                                                                                |

## Reproduce

After `pnpm install --frozen-lockfile`, `pnpm fixtures:check` and `pnpm fixtures:pull`:

```sh
pnpm bench:clients --engine all --execution effect --client all --workload all --trials 4 --warmup-ms 1000 --sample-ms 2000 --latency-clock effect --construction reuse --session-connections 4
```
