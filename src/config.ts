export interface Config {
  model: string;
  timeoutMs: number;
  coreThreshold: number;
}

const DEFAULTS: Config = {
  model: "jev-1.13.0",
  timeoutMs: 5_000,
  coreThreshold: 0.5,
};

const MODEL_PATTERN = /^jev[-.\w]*$/;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 20_000;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Settings come from user-editable TOML, so every field falls back to its default. */
export function readConfig(raw: Record<string, unknown> = {}): Config {
  const { model, timeout_ms: timeout, core_threshold: threshold } = raw;

  return {
    model: typeof model === "string" && MODEL_PATTERN.test(model) ? model : DEFAULTS.model,

    timeoutMs: finite(timeout)
      ? Math.round(Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeout)))
      : DEFAULTS.timeoutMs,

    coreThreshold:
      finite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : DEFAULTS.coreThreshold,
  };
}
