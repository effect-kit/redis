export const suites = [
  "core",
  "redis",
  "valkey",
  "dragonfly",
  "keydb",
  "redict",
  "garnet",
  "kvrocks",
];

/** @param {string} suite */
export function liveMatrix(suite) {
  if (suite === "all") return { suite: suites };
  if (!suites.includes(suite)) throw new Error("Unknown live suite");
  return { suite: [suite] };
}

/** @param {unknown} number */
export function pullNumber(number) {
  if (
    typeof number !== "string" ||
    !/^[1-9]\d*$/.test(number) ||
    !Number.isSafeInteger(Number(number))
  )
    throw new Error("Expected a positive PR number");
  return Number(number);
}

/** @param {string} sha */
export function verifiedSha(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid commit SHA");
  return sha;
}
