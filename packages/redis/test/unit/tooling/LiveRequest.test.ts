import { describe, expect, it } from "vitest";

// This trusted controller is root-owned; package import targets cannot escape the package.
import {
  liveMatrix,
  pullNumber,
  verifiedSha,
} from "../../../../../.github/scripts/live-request.mjs";

describe("trusted live request boundary", () => {
  it("expands every suite and rejects unreviewed matrix values", () => {
    expect(liveMatrix("all").suite).toHaveLength(8);
    expect(liveMatrix("valkey")).toEqual({ suite: ["valkey"] });
    expect(() => liveMatrix("redis; echo injected")).toThrow();
  });

  it.each(["0", "-1", "1;echo", "1.5", "9007199254740992"])("rejects invalid PR %s", (value) => {
    expect(() => pullNumber(value)).toThrow();
  });

  it("requires an immutable full commit SHA", () => {
    expect(pullNumber("123")).toBe(123);
    expect(verifiedSha("a".repeat(40))).toBe("a".repeat(40));
    expect(() => verifiedSha("main")).toThrow();
    expect(() => verifiedSha("a".repeat(7))).toThrow();
  });
});
