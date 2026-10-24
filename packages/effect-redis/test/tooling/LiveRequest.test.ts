import { describe, expect, it } from "vitest";

import {
  canRunLive,
  liveMatrix,
  parseLiveCommand,
  pullNumber,
  verifiedSha,
} from "../../../../.github/scripts/live-request.mjs";

describe("trusted live request boundary", () => {
  it.each(["/test live", "/test live all", " /test live redis\n"])(
    "accepts exact command %s",
    (text) => {
      expect(parseLiveCommand(text)).toBe(text.includes("redis") ? "redis" : "all");
    },
  );
  it.each([
    "/test live redis; echo injected",
    "/test live\nall",
    "/test live unknown",
    "please /test live",
    "/test live redis extra",
  ])("ignores malformed command %s", (text) => {
    expect(parseLiveCommand(text)).toBeUndefined();
  });
  it("authorizes only repository writers", () => {
    expect(["admin", "maintain", "write"].every(canRunLive)).toBe(true);
    expect(["read", "triage", "none", "", "owner"].some(canRunLive)).toBe(false);
  });
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
