import defineConfig from "klarity/tsdown/library";

export default defineConfig({
  entry: { index: "src/index.ts", node: "src/node.ts" },
  tsconfig: "tsconfig.node.json",
  exports: false,
  deps: { neverBundle: [/^node:/] },
  unbundle: true,
});
