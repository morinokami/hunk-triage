import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Cache } from "../src/cache.ts";
import type { Changeset, DiffFile, Verdict } from "../src/types.ts";

export const verdict = (patch: Partial<Verdict> = {}): Verdict => ({
  role: "source",
  core: 0.9,
  mechanical: 0.1,
  attention: 2.5,
  ...patch,
});

export const file = (path: string, patch: Partial<DiffFile> = {}): DiffFile => ({
  id: path,
  path,
  patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
  stats: { additions: 1, deletions: 1 },
  metadata: { original: path },
  agent: null,
  ...patch,
});

export const changeset = (...files: DiffFile[]): Changeset => ({
  id: "review",
  title: "Patch review: test",
  sourceLabel: "test",
  files,
});

export function memoryCache(): Cache & { entries: Map<string, Verdict> } {
  const entries = new Map<string, Verdict>();

  return {
    entries,

    async read(key) {
      return entries.get(key);
    },

    async write(key, value) {
      entries.set(key, value);
    },
  };
}

/** Runs `body` with a fresh temporary directory and removes it afterwards. */
export async function withTempDir<T>(body: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "hunk-triage-test-"));

  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What a fake transport was asked: the decoded body, and its files under either state key. */
export function requested(init: RequestInit) {
  const body = JSON.parse(init.body as string);
  const files: { path: string; patch: string }[] = body.state.files ?? [body.state.file];

  return { body, files };
}

/** One Jev response carrying the given verdicts, in the shape the parser expects. */
export function answer(values: Verdict[]): Response {
  const answers = values.flatMap(
    (v, i) =>
      [
        [`role_${i}`, { type: "choice", choice: v.role }],
        [`mechanical_${i}`, { type: "noul", noul: v.mechanical }],
        [`core_${i}`, { type: "noul", noul: v.core }],
        [`attention_${i}`, { type: "score", score: v.attention }],
      ] as const,
  );

  return Response.json({
    model: "jev-1.13.0",
    usage: { input_tokens: 100, output_tokens: 0 },
    answers: Object.fromEntries(answers),
  });
}
