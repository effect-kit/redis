import { describe, expect, it } from "vitest";

import { liveOptions } from "../../tools/LiveOptions.ts";

describe("explicit live execution modes", () => {
  it("defaults to disposable containers and accepts a reviewed engine", () => {
    expect(liveOptions([], {})).toEqual({ mode: "containers", engine: "all", binary: undefined });
    expect(liveOptions(["--engine", "valkey"], {}).engine).toBe("valkey");
    expect(() => liveOptions(["--engine", "unknown"], {})).toThrow();
  });
  it("requires explicit endpoint input and keeps it out of parsed options", () => {
    expect(() => liveOptions(["--mode", "endpoint"], {})).toThrow();
    const options = liveOptions(["--mode", "endpoint"], {
      EFFECT_REDIS_TEST_URL: "redis://user:secret@localhost:6379",
    });
    expect(JSON.stringify(options)).not.toContain("secret");
  });
  it("requires an absolute binary and a supported local engine", () => {
    expect(() =>
      liveOptions(["--mode", "binary", "--binary", "redis-server", "--engine", "redis"], {}),
    ).toThrow();
    expect(() =>
      liveOptions(["--mode", "binary", "--binary", "/tmp/server", "--engine", "garnet"], {}),
    ).toThrow();
    expect(
      liveOptions(["--mode", "binary", "--binary", "/tmp/redis-server", "--engine", "redis"], {})
        .mode,
    ).toBe("binary");
    expect(() => liveOptions(["--binary", "/tmp/server"], {})).toThrow();
  });
  it("rejects unknown modes and flags instead of falling back", () => {
    expect(() => liveOptions(["--mode", "external"], {})).toThrow();
    expect(() => liveOptions(["--flush-all"], {})).toThrow();
  });
});
