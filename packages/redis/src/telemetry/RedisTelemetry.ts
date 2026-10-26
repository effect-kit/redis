import { Layer } from "effect";

import { decodeOptions, TelemetrySettings } from "#/telemetry/Options";
import type { TelemetryOptions } from "#/telemetry/Options";

export type { TelemetryOptions } from "#/telemetry/Options";

/** Enable fixed-cardinality facade metrics and optional payload-free operation spans. */
export const layer = (options: TelemetryOptions = {}) =>
  Layer.effect(TelemetrySettings, decodeOptions(options));
