import config from "klarity/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [config],
  rules: { "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }] },
});
