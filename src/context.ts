import type { Run } from "./run.ts";
import type { Context, Environment } from "./types.ts";

import { abortable } from "./abortable.ts";
import { execute } from "./run.ts";

const DESCRIPTION_LIMIT = 1500;

// Git answers from the local repository in milliseconds; this only bounds a stuck one.
const TIMEOUT_MS = 1000;

// A branch name only describes the change while it is not the line everyone works on.
const SHARED_BRANCHES: readonly string[] = ["HEAD", "main", "master", "trunk", "develop"];

interface ContextOptions {
  run?: Run;
  timeoutMs?: number;
}

/** Explicit environment variables win; Git is the fallback, and no context is fine. */
export async function resolveContext(
  title: string,
  cwd: string,
  env: Environment,
  options: ContextOptions = {},
): Promise<Context | null> {
  const explicitTitle = env.HUNK_TRIAGE_TITLE;

  if (explicitTitle?.trim()) {
    const description = (env.HUNK_TRIAGE_DESCRIPTION ?? "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .slice(0, DESCRIPTION_LIMIT);

    return { title: explicitTitle, description };
  }

  const run = options.run ?? execute;

  // Every command shares this deadline, so the review waits for context this long at most.
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);

  const git = async (args: string[]) => {
    // Checked before the command starts, so nothing is spawned once the deadline has passed.
    signal.throwIfAborted();

    return abortable(run("git", args, { cwd, signal }), signal);
  };

  try {
    const revision = /^.+ show (.+)$/.exec(title)?.[1];

    if (revision && !revision.startsWith("-")) {
      const message = await git(["log", "-1", "--format=%B", revision, "--"]);
      const [subject, ...body] = message.split("\n");
      if (!subject) return null;

      return { title: subject, description: body.join("\n").trim().slice(0, DESCRIPTION_LIMIT) };
    }

    if (/ (working tree|staged changes)$/.test(title)) {
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);

      if (branch && !SHARED_BRANCHES.includes(branch)) {
        return { title: branch, description: "" };
      }
    }
  } catch {
    /* Context is optional, including outside a Git repository. */
  }

  return null;
}
