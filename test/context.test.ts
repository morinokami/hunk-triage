import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename } from "node:path";

import type { Run } from "../src/run.ts";

import { resolveContext } from "../src/context.ts";
import { withTempDir } from "./helpers.ts";

type Git = (...args: string[]) => void;

/** A review with no repository behind it, as `hunk patch` loads one from standard input. */
const patch = { title: "Patch review: stdin patch", sourceLabel: "stdin patch" };

/** The title and label hunk's Git adapter gives a review of the repository in `dir`. */
const review = (dir: string, what: string) => ({
  title: `${basename(dir)} ${what}`,
  sourceLabel: dir,
});

/** Runs `body` in a fresh repository whose only commit is on `main`. */
const withRepo = (body: (dir: string, git: Git) => Promise<void>) =>
  withTempDir(async (dir) => {
    const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];
    const git: Git = (...args) =>
      void execFileSync("git", [...identity, ...args], { cwd: dir, stdio: "pipe" });

    git("init", "-b", "main");
    git("commit", "--allow-empty", "-m", "Fix ordering\n\nCommit body");

    await body(dir, git);
  });

test("working tree and staged reviews take a feature branch name, never a shared one", () =>
  withRepo(async (dir, git) => {
    expect(await resolveContext(review(dir, "working tree"), dir, {})).toBe(null);

    git("checkout", "-b", "fix/review-order");
    expect(await resolveContext(review(dir, "staged changes"), dir, {})).toStrictEqual({
      title: "fix/review-order",
      description: "",
    });
  }));

test("a range takes the branch name when it ends at the working tree or HEAD", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    for (const range of ["main", "HEAD~1", "main..", "main...HEAD"]) {
      expect((await resolveContext(review(dir, range), dir, {}))?.title).toBe("fix/review-order");
    }

    // Between two other commits, the checked-out branch says nothing about the change.
    for (const range of ["main..other", "v1...v2", "1a2b3c4..5d6e7f8"]) {
      expect(await resolveContext(review(dir, range), dir, {})).toBe(null);
    }
  }));

test("a stash and another VCS's working copy have no branch behind them", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    for (const what of ["stash", "stash stash@{1}", "working copy"]) {
      expect(await resolveContext(review(dir, what), dir, {})).toBe(null);
    }
  }));

test("show reads the commit message and ignores option-like revisions", () =>
  withRepo(async (dir) => {
    expect(await resolveContext(review(dir, "show HEAD"), dir, {})).toStrictEqual({
      title: "Fix ordering",
      description: "Commit body",
    });
    expect(await resolveContext(review(dir, "show --help"), dir, {})).toBe(null);
  }));

test("explicit context wins over Git and loses its HTML comments", () =>
  withRepo(async (dir) => {
    expect(
      await resolveContext(review(dir, "show HEAD"), dir, {
        HUNK_TRIAGE_TITLE: "Explicit",
        HUNK_TRIAGE_DESCRIPTION: "a<!-- hidden -->b",
      }),
    ).toStrictEqual({ title: "Explicit", description: "ab" });
  }));

test("every source loses its HTML comments and is cut to the limits", () =>
  withRepo(async (dir, git) => {
    const body = `<!-- left by the template -->\n${"b".repeat(2000)}`;
    git("commit", "--allow-empty", "-m", `${"s".repeat(300)}\n\n${body}`);

    const commit = (await resolveContext(review(dir, "show HEAD"), dir, {}))!;
    expect(commit.title).toBe("s".repeat(256));
    expect(commit.description).toBe("b".repeat(1500));

    const explicit = await resolveContext(review(dir, "show HEAD"), dir, {
      HUNK_TRIAGE_TITLE: "t".repeat(300),
      HUNK_TRIAGE_DESCRIPTION: "  padded  ",
    });
    expect(explicit).toStrictEqual({ title: "t".repeat(256), description: "padded" });
  }));

test("a comment that is never closed stays, and a flood of them costs no time", async () => {
  const describe = async (description: string) => {
    const env = { HUNK_TRIAGE_TITLE: "Explicit", HUNK_TRIAGE_DESCRIPTION: description };

    return (await resolveContext(patch, tmpdir(), env))!.description;
  };

  expect(await describe("a<!-- one --><!-- two\n-->b<!-- open")).toBe("ab<!-- open");

  // A regex with a lazy quantifier needs over a minute for this megabyte.
  const start = performance.now();
  expect(await describe("<!--".repeat(262_144))).toBe("<!--".repeat(375));
  expect(performance.now() - start).toBeLessThan(2000);
});

test("a limit that falls inside an emoji does not leave half of it behind", async () => {
  const env = { HUNK_TRIAGE_TITLE: `${"t".repeat(255)}\u{1F680}` };
  const { title } = (await resolveContext(patch, tmpdir(), env))!;

  expect(title).toHaveLength(256);
  expect(title.isWellFormed()).toBe(true);
});

test("a patch review has no context, even on a feature branch", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    expect(await resolveContext(patch, dir, {})).toBe(null);
  }));

test("a changeset that another extension left without its label only loses its context", async () => {
  const broken = { title: "repo working tree" } as unknown as typeof patch;

  expect(await resolveContext(broken, tmpdir(), {})).toBe(null);
});

test("a Git that never answers is given up at the deadline, leaving no context", async () => {
  let signal: AbortSignal | undefined;

  // Hangs without watching its signal, as a stuck child process would.
  const run: Run = (_program, _args, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };

  const stuck = await resolveContext(
    review(tmpdir(), "show HEAD"),
    tmpdir(),
    {},
    {
      run,
      timeoutMs: 20,
    },
  );

  expect(stuck).toBe(null);
  expect(signal!.aborted).toBe(true);
});
