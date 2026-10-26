export const ownedSuffixes = [
  "value",
  "absent",
  "integer",
  "schema",
  "hash",
  "list",
  "set",
  "sorted",
  "stream",
  "batch",
  "after-error",
  "vector",
  "document",
  "json-hash",
  "uncertain",
] as const;

export const ownedKeys = (prefix: string): [string, ...string[]] => [
  `${prefix}value`,
  ...ownedSuffixes.slice(1).map((suffix) => `${prefix}${suffix}`),
];
