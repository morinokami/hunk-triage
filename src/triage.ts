import { writeFile } from "node:fs/promises";

import type { Cache } from "./cache.ts";
import type { Config } from "./config.ts";
import type { Fetch } from "./jev.ts";
import type { Run } from "./run.ts";
import type { Changeset, Environment, TriageResult, Verdict } from "./types.ts";

import { cacheKey, defaultCache } from "./cache.ts";
import { applyVerdicts, countsLabel, eligible, groupOf } from "./classify.ts";
import { resolveContext } from "./context.ts";
import { queryFiles } from "./jev.ts";

interface TriageOptions {
  env?: Environment;
  cache?: Cache;
  fetch?: Fetch;
  run?: Run;
}

export async function triage(
  changeset: Changeset,
  cwd: string,
  config: Config,
  options: TriageOptions = {},
): Promise<TriageResult> {
  const started = performance.now();
  const env = options.env ?? process.env;

  const result: TriageResult = {
    changeset,
    state: { mode: "unavailable", groups: new Map() },
    context: null,
    contextSource: null,
    contextMs: 0,
    verdicts: new Map(),
    asked: 0,
    cached: 0,
    failed: 0,
    elapsedMs: 0,
  };

  try {
    if (!changeset.files.length) {
      result.state = { mode: "empty", groups: new Map() };
      return result;
    }

    const apiKey = env.TYPESAFE_API_KEY?.trim();
    if (!apiKey) {
      result.reason = "TYPESAFE_API_KEY is not set";
      return result;
    }

    const targets = changeset.files.filter(eligible);
    if (!targets.length) {
      result.state = { mode: "no-targets", groups: new Map() };
      return result;
    }

    // Only a review with something to classify is worth the wait for gh.
    const resolving = performance.now();
    const resolved = await resolveContext(changeset, cwd, env, { run: options.run });
    result.context = resolved?.context ?? null;
    result.contextSource = resolved?.source ?? null;
    result.contextMs = Math.round(performance.now() - resolving);

    // Cached verdicts come first; only the files without one reach Jev.
    const cache = options.cache ?? defaultCache(env);
    const paths = changeset.files.map((file) => file.path);

    const entries = await Promise.all(
      targets.map(async (file) => {
        const key = cacheKey(config.model, result.context, paths, file);
        return { file, key, verdict: await cache.read(key).catch(() => undefined) };
      }),
    );

    const verdicts = new Map<string, Verdict>();
    for (const { file, verdict } of entries) {
      if (verdict) verdicts.set(file.id, verdict);
    }
    result.cached = verdicts.size;

    const misses = entries.filter((entry) => !entry.verdict);
    result.asked = misses.length;

    const queried = await queryFiles({
      model: config.model,
      context: result.context,
      allFiles: changeset.files,
      pending: misses.map((entry) => entry.file),
      apiKey,
      timeoutMs: config.timeoutMs,
      fetch: options.fetch,
    });

    result.failed = queried.failed;
    for (const [id, verdict] of queried.verdicts) {
      verdicts.set(id, verdict);
    }
    result.verdicts = verdicts;

    await Promise.all(
      misses.map(async ({ file, key }) => {
        const verdict = queried.verdicts.get(file.id);
        if (verdict) await cache.write(key, verdict).catch(() => {});
      }),
    );

    if (!verdicts.size) {
      result.reason = "Jev returned no valid classifications";
      return result;
    }

    const applied = applyVerdicts(changeset, verdicts, config.coreThreshold);
    result.changeset = applied.changeset;
    result.state = { mode: "classified", groups: applied.groups };

    return result;
  } catch {
    // Do not expose transport errors, request data or secrets in the UI.
    result.reason = "Classification failed";
    result.state = { mode: "unavailable", groups: new Map() };
    result.changeset = changeset;

    return result;
  } finally {
    result.elapsedMs = Math.round(performance.now() - started);

    if (env.HUNK_TRIAGE_DEBUG) {
      await writeDebug(env.HUNK_TRIAGE_DEBUG, changeset, result);
    }
  }
}

/** Diagnostics for one run. Never contains the API key or raw patches. */
async function writeDebug(path: string, changeset: Changeset, result: TriageResult) {
  const debug = {
    title: changeset.title,
    context: result.context,
    context_source: result.contextSource,
    context_ms: result.contextMs,
    mode: result.state.mode,
    elapsed_ms: result.elapsedMs,
    asked: result.asked,
    cached: result.cached,
    failed: result.failed,
    ...(result.reason ? { reason: result.reason } : {}),
    files: result.changeset.files.map((file) => ({
      path: file.path,
      group: groupOf(result.state.groups, file.id),
      verdict: result.verdicts.get(file.id) ?? null,
    })),
  };

  await writeFile(path, JSON.stringify(debug, null, 2), { mode: 0o600 }).catch(() => {});
}

interface Toast {
  message: string;
  type: "info" | "warning";
}

/** What the user is told about a load; a review with nothing to classify stays quiet. */
export function notification(result: TriageResult): Toast | null {
  const { mode } = result.state;

  if (mode === "empty" || mode === "no-targets") return null;

  if (mode === "unavailable") {
    const message = `hunk-triage: ${result.reason ?? "Jev unavailable"}; original order`;

    return { message, type: "warning" };
  }

  const counts = countsLabel(result.state.groups);
  const failed = result.failed ? `, ${result.failed} failed` : "";
  const message = `hunk-triage: ${counts} (${result.elapsedMs} ms, ${result.asked} asked, ${result.cached} cached${failed})`;

  return { message, type: "info" };
}
