# Benchmarks

| Setup    | Measured configuration                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Run      | 72 measurements in 239 seconds; 2026-10-29 UTC; source `292f540`                                                      |
| Host     | Apple M3 Pro, 18 GiB RAM; Node.js 24.22.0; Effect 4.0.6                                                               |
| Clients  | Effect Redis development build; ioredis 6.0.0; node-redis 6.3.0; Valkey GLIDE 2.5.3                                   |
| Servers  | Redis 8.10.2 and Valkey 9.1.2; local Docker TCP; RESP2; persistence disabled                                          |
| Samples  | One 2.5-second sample after 0.5-second warm-up per combination; no repeat-trial uncertainty estimate                  |
| Evidence | [All measurements](benchmarks/trials.csv), including latency/CPU/memory; [versions and settings](benchmarks/run.json) |

## Throughput

Commands/second, higher is better. `cN` = concurrent operations. Batches count 32 GETs; transactions count eight. Batch replies are 256 B.

### Redis server

| Workload             | Effect Redis | ioredis | node-redis | Valkey GLIDE |
| -------------------- | -----------: | ------: | ---------: | -----------: |
| GET 256 B / c1       |        9,857 |  11,632 |     11,985 |        8,410 |
| GET 256 B / c32      |       93,453 | 157,987 |    175,885 |      141,907 |
| GET 64 KiB / c8      |       14,201 |  31,093 |     20,303 |       26,742 |
| SET 256 B / c16      |       72,937 | 106,613 |    104,885 |       88,105 |
| INCR / c16           |       75,170 |  71,282 |    115,336 |       86,208 |
| Pipeline 32 / c4     |      265,750 | 432,256 |    444,669 |      486,235 |
| Values batch 32 / c4 |      267,563 | 440,193 |    458,870 |      487,036 |
| Compiled 32 / c4     |      349,373 | 429,027 |    471,442 |      517,894 |
| Transaction 8 / c1   |       18,356 |  60,022 |     72,106 |       51,894 |

### Valkey server

| Workload             | Effect Redis | ioredis | node-redis | Valkey GLIDE |
| -------------------- | -----------: | ------: | ---------: | -----------: |
| GET 256 B / c1       |        9,522 |   9,975 |     11,670 |        8,582 |
| GET 256 B / c32      |       95,612 | 167,704 |    151,057 |      139,295 |
| GET 64 KiB / c8      |       14,843 |  31,971 |     21,404 |       25,239 |
| SET 256 B / c16      |       72,178 |  98,918 |    101,829 |       87,505 |
| INCR / c16           |       76,895 | 107,590 |    109,429 |       89,966 |
| Pipeline 32 / c4     |      267,006 | 440,249 |    444,368 |      488,205 |
| Values batch 32 / c4 |      267,071 | 448,790 |    464,133 |      494,771 |
| Compiled 32 / c4     |      352,835 | 434,864 |    462,031 |      532,820 |
| Transaction 8 / c1   |       20,025 |  60,775 |     66,583 |       55,556 |

## Effect Redis throughput gap

Geometric mean of matching throughput ratios across both servers; negative means lower throughput. “Existing APIs” excludes the values-batch and compiled variants.

| Scope                             | vs ioredis | vs node-redis | vs Valkey GLIDE |
| --------------------------------- | ---------: | ------------: | --------------: |
| Seven existing APIs × two servers |     -39.8% |        -40.6% |          -33.1% |
| Values batch × two servers        |     -39.9% |        -42.1% |          -45.5% |
| Compiled plan × two servers       |     -18.7% |        -24.8% |          -33.2% |

## Reading the results

| Detail       | Meaning                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timing       | All clients run inside Effect. Throughput uses the in-program workload timer; operation latency uses `Effect.timed`. Setup is excluded.                                                                              |
| Compiled API | Fixed arguments, preparation and first encoding outside timing. Other clients use their normal pipelines for the batch/compiled rows.                                                                                |
| Policies     | node-redis automatic pipelining enabled; ioredis/Effect Redis disabled; GLIDE native multiplexing. Effect pipelines use up to four session connections; values batches/compiled plans share one ordinary connection. |
| Scope        | Hot keys, successful local operations. Results do not establish production rankings, error recovery, TLS/WAN or topology performance. Small differences need repeated trials.                                        |

## Reproduce

After `pnpm install --frozen-lockfile`, `pnpm fixtures:check` and `pnpm fixtures:pull`:

```sh
pnpm bench:clients --engine all --execution effect --client all --workload all --trials 1 --warmup-ms 500 --sample-ms 2500 --latency-clock effect --construction reuse --session-connections 4
```
