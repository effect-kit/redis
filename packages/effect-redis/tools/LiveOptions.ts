import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";

import { selectEngine } from "#tools/FixtureTargets";

export const liveOptions = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv) => {
  const { values } = parseArgs({
    args: [...args],
    options: {
      engine: { type: "string" },
      mode: { type: "string", default: "containers" },
      binary: { type: "string" },
    },
    strict: true,
  });
  const engine = selectEngine(values.engine ?? env.EFFECT_REDIS_TEST_ENGINE);
  const mode = values.mode;
  if (!["containers", "binary", "endpoint"].includes(mode))
    throw new Error("Expected containers, binary or endpoint mode");
  if (
    mode === "binary" &&
    (!values.binary || !isAbsolute(values.binary) || !["redis", "valkey"].includes(engine))
  )
    throw new Error("Binary mode requires --engine redis|valkey and an absolute --binary path");
  if (mode === "endpoint" && !env.EFFECT_REDIS_TEST_URL)
    throw new Error("Endpoint mode requires EFFECT_REDIS_TEST_URL");
  if (mode !== "binary" && values.binary !== undefined)
    throw new Error("--binary requires binary mode");
  return { mode, engine, binary: values.binary };
};
