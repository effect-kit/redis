process.env.EFFECT_REDIS_TEST_HTTP_ONLY = "1";

await import("#test/runners/live/run");
