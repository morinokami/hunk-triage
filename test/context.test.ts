import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";

import { resolveContext } from "../src/context.ts";
import { withTempDir } from "./helpers.ts";

type Git = (...args: string[]) => void;

/** Runs `body` in a fresh repository whose only commit is on `main`. */
const withRepo = (body: (dir: string, git: Git) => void) =>
  withTempDir((dir) => {
    const git: Git = (...args) => void execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];

    git("init", "-b", "main");
    git(...identity, "commit", "--allow-empty", "-m", "Fix ordering\n\nCommit body");

    body(dir, git);
  });

test("working tree and staged reviews take a feature branch name, never a shared one", () =>
  withRepo((dir, git) => {
    expect(resolveContext("repo working tree", dir, {})).toBe(null);

    git("checkout", "-b", "fix/review-order");
    expect(resolveContext("repo staged changes", dir, {})!.title).toBe("fix/review-order");
  }));

test("show reads the commit message and ignores option-like revisions", () =>
  withRepo((dir) => {
    expect(resolveContext("repo show HEAD", dir, {})).toStrictEqual({
      title: "Fix ordering",
      description: "Commit body",
    });
    expect(resolveContext("repo show --help", dir, {})).toBe(null);
  }));

test("explicit context wins over Git and loses its HTML comments", () =>
  withRepo((dir) => {
    expect(
      resolveContext("repo show HEAD", dir, {
        HUNK_TRIAGE_TITLE: "Explicit",
        HUNK_TRIAGE_DESCRIPTION: "a<!-- hidden -->b",
      }),
    ).toStrictEqual({ title: "Explicit", description: "ab" });
  }));

test("a patch review has no context, even on a feature branch", () =>
  withRepo((dir, git) => {
    git("checkout", "-b", "fix/review-order");

    expect(resolveContext("Patch review: stdin patch", dir, {})).toBe(null);
  }));
