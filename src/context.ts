import { basename } from "node:path";

import type { Run } from "./run.ts";
import type { Changeset, Context, Environment } from "./types.ts";

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

/** What a changeset shows, as far as that decides where its context comes from. */
type Review = { kind: "commit"; revision: string } | { kind: "branch" };

/**
 * hunk 0.22's Git adapter labels a changeset with the repository root and titles it
 * "<directory name> <what>". A patch or a file comparison is titled otherwise and has no
 * commit or branch behind it.
 */
function reviewOf({ title, sourceLabel }: Pick<Changeset, "title" | "sourceLabel">): Review | null {
  const prefix = `${basename(sourceLabel)} `;
  if (!title.startsWith(prefix)) return null;

  const what = title.slice(prefix.length);

  const revision = /^show (.+)$/.exec(what)?.[1];
  if (revision) return revision.startsWith("-") ? null : { kind: "commit", revision };

  if (what === "working tree" || what === "staged changes") return { kind: "branch" };

  // A stash is not the branch's work, and jj and Sapling review a "working copy".
  if (/^stash( |$)/.test(what) || what === "working copy") return null;

  // What remains is the range of `hunk diff <range>`. One that ends at the working tree
  // (`main`) or at HEAD (`main...`, `main..HEAD`) is the checked-out branch's work; one
  // between two other commits may be anyone's.
  const head = /\.\.\.?(.*)$/.exec(what)?.[1];

  return head === undefined || head === "" || head === "HEAD" ? { kind: "branch" } : null;
}

/** Explicit environment variables win; Git is the fallback, and no context is fine. */
export async function resolveContext(
  changeset: Pick<Changeset, "title" | "sourceLabel">,
  cwd: string,
  env: Environment,
  options: ContextOptions = {},
): Promise<Context | null> {
  const explicitTitle = env.HUNK_TRIAGE_TITLE;

  if (explicitTitle?.trim()) return context(explicitTitle, env.HUNK_TRIAGE_DESCRIPTION ?? "");

  // hunk hands every transform what the one before it returned, so even the title and the
  // label are read inside the try: a changeset without them only loses its context.
  try {
    const review = reviewOf(changeset);
    if (!review) return null;

    const run = options.run ?? execute;

    // Every command shares this deadline, so the review waits for context this long at most.
    const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);

    const git = async (args: string[]) => {
      // Checked before the command starts, so nothing is spawned once the deadline has passed.
      signal.throwIfAborted();

      return abortable(run("git", args, { cwd, signal }), signal);
    };

    if (review.kind === "commit") {
      const message = await git(["log", "-1", "--format=%B", review.revision, "--"]);
      const [subject, ...body] = message.split("\n");

      return subject ? context(subject, body.join("\n")) : null;
    }

    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);

    if (branch && !SHARED_BRANCHES.includes(branch)) return context(branch, "");
  } catch {
    /* Context is optional, including outside a Git repository. */
  }

  return null;
}
