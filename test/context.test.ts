import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

import type { Run } from "../src/run.ts";

import { resolveContext } from "../src/context.ts";
import { withTempDir } from "./helpers.ts";

type Git = (...args: string[]) => void;

/** Runs `body` in a fresh repository whose only commit is on `main`. */
const withRepo = (body: (dir: string, git: Git) => Promise<void>) =>
  withTempDir(async (dir) => {
    const git: Git = (...args) => void execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];

    git("init", "-b", "main");
    git(...identity, "commit", "--allow-empty", "-m", "Fix ordering\n\nCommit body");

    await body(dir, git);
  });

test("working tree and staged reviews take a feature branch name, never a shared one", () =>
  withRepo(async (dir, git) => {
    expect(await resolveContext("repo working tree", dir, {})).toBe(null);

    git("checkout", "-b", "fix/review-order");
    expect((await resolveContext("repo staged changes", dir, {}))!.title).toBe("fix/review-order");
  }));

test("show reads the commit message and ignores option-like revisions", () =>
  withRepo(async (dir) => {
    expect(await resolveContext("repo show HEAD", dir, {})).toStrictEqual({
      title: "Fix ordering",
      description: "Commit body",
    });
    expect(await resolveContext("repo show --help", dir, {})).toBe(null);
  }));

test("explicit context wins over Git and loses its HTML comments", () =>
  withRepo(async (dir) => {
    expect(
      await resolveContext("repo show HEAD", dir, {
        HUNK_TRIAGE_TITLE: "Explicit",
        HUNK_TRIAGE_DESCRIPTION: "a<!-- hidden -->b",
      }),
    ).toStrictEqual({ title: "Explicit", description: "ab" });
  }));

test("a patch review has no context, even on a feature branch", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    expect(await resolveContext("Patch review: stdin patch", dir, {})).toBe(null);
  }));

test("a Git that never answers is given up at the deadline, leaving no context", async () => {
  let signal: AbortSignal | undefined;

  // Hangs without watching its signal, as a stuck child process would.
  const run: Run = (_program, _args, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };

  expect(await resolveContext("repo show HEAD", tmpdir(), {}, { run, timeoutMs: 20 })).toBe(null);
  expect(signal!.aborted).toBe(true);
});
