import { execFileSync } from "node:child_process";

import type { Context, Environment } from "./types.ts";

const DESCRIPTION_LIMIT = 1500;

// A branch name only describes the change while it is not the line everyone works on.
const SHARED_BRANCHES: readonly string[] = ["HEAD", "main", "master", "trunk", "develop"];

/** Explicit environment variables win; Git is the fallback, and no context is fine. */
export function resolveContext(title: string, cwd: string, env: Environment): Context | null {
  const explicitTitle = env.HUNK_TRIAGE_TITLE;

  if (explicitTitle?.trim()) {
    const description = (env.HUNK_TRIAGE_DESCRIPTION ?? "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .slice(0, DESCRIPTION_LIMIT);

    return { title: explicitTitle, description };
  }

  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 1000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  try {
    const revision = /^.+ show (.+)$/.exec(title)?.[1];

    if (revision && !revision.startsWith("-")) {
      const [subject, ...body] = git(["log", "-1", "--format=%B", revision, "--"]).split("\n");
      if (!subject) return null;

      return { title: subject, description: body.join("\n").trim().slice(0, DESCRIPTION_LIMIT) };
    }

    if (/ (working tree|staged changes)$/.test(title)) {
      const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

      if (branch && !SHARED_BRANCHES.includes(branch)) {
        return { title: branch, description: "" };
      }
    }
  } catch {
    /* Context is optional, including outside a Git repository. */
  }

  return null;
}
