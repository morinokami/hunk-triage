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
    const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];
    const git: Git = (...args) =>
      void execFileSync("git", [...identity, ...args], { cwd: dir, stdio: "pipe" });

    git("init", "-b", "main");
    git("commit", "--allow-empty", "-m", "Fix ordering\n\nCommit body");

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

test("every source loses its HTML comments and is cut to the limits", () =>
  withRepo(async (dir, git) => {
    const body = `<!-- left by the template -->\n${"b".repeat(2000)}`;
    git("commit", "--allow-empty", "-m", `${"s".repeat(300)}\n\n${body}`);

    const commit = (await resolveContext("repo show HEAD", dir, {}))!;
    expect(commit.title).toBe("s".repeat(256));
    expect(commit.description).toBe("b".repeat(1500));

    const explicit = await resolveContext("repo show HEAD", dir, {
      HUNK_TRIAGE_TITLE: "t".repeat(300),
      HUNK_TRIAGE_DESCRIPTION: "  padded  ",
    });
    expect(explicit).toStrictEqual({ title: "t".repeat(256), description: "padded" });
  }));

test("a comment that is never closed stays, and a flood of them costs no time", async () => {
  const describe = async (description: string) => {
    const env = { HUNK_TRIAGE_TITLE: "Explicit", HUNK_TRIAGE_DESCRIPTION: description };

    return (await resolveContext("Patch review: stdin patch", tmpdir(), env))!.description;
  };

  expect(await describe("a<!-- one --><!-- two\n-->b<!-- open")).toBe("ab<!-- open");

  // A regex with a lazy quantifier needs over a minute for this megabyte.
  const start = performance.now();
  expect(await describe("<!--".repeat(262_144))).toBe("<!--".repeat(375));
  expect(performance.now() - start).toBeLessThan(2000);
});

test("a limit that falls inside an emoji does not leave half of it behind", async () => {
  const env = { HUNK_TRIAGE_TITLE: `${"t".repeat(255)}\u{1F680}` };
  const { title } = (await resolveContext("Patch review: stdin patch", tmpdir(), env))!;

  expect(title).toHaveLength(256);
  expect(title.isWellFormed()).toBe(true);
});

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
