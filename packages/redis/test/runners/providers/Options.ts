import { parseArgs } from "node:util";

import { ProviderTestError } from "#test/support/providers/Failures";
import { providerCaseId, providerCases } from "#test/support/providers/Matrix";

export const providerOptions = (args: ReadonlyArray<string>) => {
  try {
    const { values } = parseArgs({
      args: [...args],
      strict: true,
      options: {
        "credentials-file": { type: "string" },
        env: { type: "boolean" },
        provider: { type: "string", default: "all" },
        runtime: { type: "string", default: "all" },
        case: { type: "string", multiple: true },
      },
    });
    if ((values["credentials-file"] === undefined) === (values.env !== true))
      throw new Error("Invalid provider selection");
    const cases = providerCases(values.provider, values.runtime);
    const ids = values.case ?? [];
    if (ids.some((id) => !cases.some((scenario) => providerCaseId(scenario) === id)))
      throw new Error("Invalid provider selection");
    return {
      ...(values["credentials-file"] === undefined ? {} : { envFile: values["credentials-file"] }),
      fromEnv: values.env === true,
      provider: values.provider ?? "all",
      runtime: values.runtime ?? "all",
      ids,
    };
  } catch {
    throw new ProviderTestError({
      stage: "options",
      reason: "Use an explicit credentials source and valid provider/runtime/case selection",
    });
  }
};
