import defineConfig from "klarity/tsdown/library";

export default defineConfig({
  entry: { index: "src/index.ts" },
  exports: false,
  unbundle: true,
});
