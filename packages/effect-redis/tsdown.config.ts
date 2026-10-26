import defineConfig from "klarity/tsdown/library";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    node: "src/node.ts",
    bun: "src/bun.ts",
    upstash: "src/upstash.ts",
  },
  tsconfig: "tsconfig.node.json",
  exports: false,
  deps: { neverBundle: [/^node:/, /^bun$/] },
  unbundle: true,
});
