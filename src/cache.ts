import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { Context, DiffFile, Environment, Verdict } from "./types.ts";

import { isVerdict } from "./guards.ts";
import { sentPatch } from "./jev.ts";
import { QUESTIONS_VERSION } from "./questions.ts";

export interface Cache {
  read(key: string): Promise<Verdict | undefined>;
  write(key: string, verdict: Verdict): Promise<void>;
}

/**
 * Everything the classification depends on goes into the key, so a verdict survives
 * only while the question wording, model, context and patch all stay the same.
 */
export function cacheKey(
  model: string,
  context: Context | null,
  paths: readonly string[],
  file: DiffFile,
): string {
  const inputs = JSON.stringify([
    QUESTIONS_VERSION,
    model,
    context,
    [...paths].sort(),
    file.path,
    sentPatch(file),
  ]);

  return createHash("sha256").update(inputs).digest("hex").slice(0, 32);
}

/**
 * hunk resolves its own user directories from HOME/USERPROFILE on every platform, Windows
 * included, so the cache follows it rather than `~/Library/Caches` or `%LOCALAPPDATA%`.
 * A relative setting is ignored instead of resolved against the working directory, and an
 * unresolvable home disables the cache rather than writing somewhere arbitrary.
 */
export function cacheDirectory(env: Environment): string | undefined {
  const configured = env.XDG_CACHE_HOME;
  if (configured && isAbsolute(configured)) return join(configured, "hunk-triage");

  const home = env.HOME || env.USERPROFILE || homedir();
  return isAbsolute(home) ? join(home, ".cache", "hunk-triage") : undefined;
}

/** A review has to work without a cache, so an unresolvable directory degrades to this. */
function noCache(): Cache {
  return {
    async read() {
      return undefined;
    },

    async write() {},
  };
}

export function diskCache(directory: string): Cache {
  const entryPath = (key: string) => join(directory, `${key}.json`);

  return {
    async read(key) {
      try {
        const contents = await readFile(entryPath(key), "utf8");
        const value: unknown = JSON.parse(contents);

        return isVerdict(value) ? value : undefined;
      } catch {
        return undefined;
      }
    },

    async write(key, verdict) {
      // Write beside the entry and rename, so a reader never sees a half-written file.
      const temp = join(directory, `${key}.${randomUUID()}.tmp`);

      try {
        await mkdir(directory, { recursive: true });
        await writeFile(temp, JSON.stringify(verdict), { mode: 0o600, flag: "wx" });
        await rename(temp, entryPath(key));
      } catch {
        /* Cache writes must never prevent a review. */
      } finally {
        await rm(temp, { force: true }).catch(() => {});
      }
    },
  };
}

/** The cache of a review that was not handed another one. */
export function defaultCache(env: Environment): Cache {
  const directory = cacheDirectory(env);

  return directory ? diskCache(directory) : noCache();
}
