import { fileURLToPath } from "node:url";

import { build } from "tsdown";

const outDir = fileURLToPath(new URL("../../.cache/providers/bundle/", import.meta.url));

// Resolve the public package exports from dist; development-only source type aliases do not enter the bundle.
await build({
  config: false,
  tsconfig: false,
  entry: {
    http: fileURLToPath(new URL("./http-main.ts", import.meta.url)),
    worker: fileURLToPath(new URL("./worker.ts", import.meta.url)),
  },
  platform: "neutral",
  format: "esm",
  target: "es2022",
  outDir,
  clean: true,
  dts: false,
  minify: true,
  sourcemap: false,
  deps: { alwaysBundle: [/^effect(?:\/|$)/, /^@effect-kit\/redis(?:\/|$)/], onlyImport: [] },
});
