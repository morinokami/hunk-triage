import type { ExtensionChangeset, ExtensionDiffFile } from "hunkdiff/extension";

import type { Role } from "./questions.ts";

export type { ExtensionChangeset as Changeset, ExtensionDiffFile as DiffFile };

/** One file's four answers, as Jev returns them and the cache stores them. */
export interface Verdict {
  role: Role;
  mechanical: number;
  core: number;
  attention: number;
}

/** The process environment, or the stand-in a test injects. */
export type Environment = Record<string, string | undefined>;

/** What the changeset is about, from an explicit variable, a commit message or a branch. */
export interface Context {
  title: string;
  description: string;
}

/** Review order: files are grouped in this order, and sorted by score inside a group. */
export const GROUPS = [
  "core",
  "supporting",
  "tests",
  "fixtures",
  "docs",
  "config",
  "mechanical",
  "generated",
  "unclassified",
] as const;

export type Group = (typeof GROUPS)[number];

export type Mode = "classified" | "unavailable" | "no-targets" | "empty";

export interface PaneState {
  mode: Mode;
  groups: ReadonlyMap<string, Group>;
}

export interface TriageResult {
  changeset: ExtensionChangeset;
  state: PaneState;
  context: Context | null;
  verdicts: ReadonlyMap<string, Verdict>;
  asked: number;
  cached: number;
  failed: number;
  elapsedMs: number;
  reason?: string;
}
