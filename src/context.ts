import type { Run } from "./run.ts";
import type { Context, Environment } from "./types.ts";

import { abortable } from "./abortable.ts";
import { execute } from "./run.ts";

const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 1500;

// Git answers from the local repository in milliseconds; this only bounds a stuck one.
const TIMEOUT_MS = 1000;

// A branch name only describes the change while it is not the line everyone works on.
const SHARED_BRANCHES: readonly string[] = ["HEAD", "main", "master", "trunk", "develop"];

interface ContextOptions {
  run?: Run;
  timeoutMs?: number;
}

/**
 * Removes HTML comments in one pass. The obvious regex rescans the rest of the text for every
 * "<!--" that is never closed, and a reviewed repository's commit message can be long enough
 * to turn that into minutes of a blocked event loop.
 */
function withoutComments(text: string): string {
  let kept = "";
  let from = 0;

  for (;;) {
    const open = text.indexOf("<!--", from);
    const close = open === -1 ? -1 : text.indexOf("-->", open + 4);
    if (close === -1) return kept + text.slice(from);

    kept += text.slice(from, open);
    from = close + 3;
  }
}

/** A cut can fall between the two halves of an emoji, and half of one is not text to send. */
function cut(text: string, limit: number): string {
  return text.slice(0, limit).toWellFormed();
}

/**
 * Every source is cleaned here. A pull request template leaves its instructions behind in
 * HTML comments, and a squash merge copies them into the commit message; the limits bound
 * what a reviewed repository can add to every request.
 */
function context(title: string, description: string): Context {
  return {
    title: cut(title, TITLE_LIMIT),
    description: cut(withoutComments(description).trim(), DESCRIPTION_LIMIT),
  };
}

/** Explicit environment variables win; Git is the fallback, and no context is fine. */
export async function resolveContext(
  title: string,
  cwd: string,
  env: Environment,
  options: ContextOptions = {},
): Promise<Context | null> {
  const explicitTitle = env.HUNK_TRIAGE_TITLE;

  if (explicitTitle?.trim()) return context(explicitTitle, env.HUNK_TRIAGE_DESCRIPTION ?? "");

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

      return context(subject, body.join("\n"));
    }

    if (/ (working tree|staged changes)$/.test(title)) {
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);

      if (branch && !SHARED_BRANCHES.includes(branch)) {
        return context(branch, "");
      }
    }
  } catch {
    /* Context is optional, including outside a Git repository. */
  }

  return null;
}
