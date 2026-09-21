import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename } from "node:path";

import type { Run } from "../src/run.ts";
import type { Environment } from "../src/types.ts";

import { resolveContext } from "../src/context.ts";
import { pullRequest, runner, withTempDir } from "./helpers.ts";

type Git = (...args: string[]) => void;

/** A review with no repository behind it, as `hunk patch` loads one from standard input. */
const patch = { title: "Patch review: stdin patch", sourceLabel: "stdin patch" };

/** The title and label hunk's Git adapter gives a review of the repository in `dir`. */
const review = (dir: string, what: string) => ({
  title: `${basename(dir)} ${what}`,
  sourceLabel: dir,
});

/** What gh does on a branch without a pull request, and without a login or a network. */
const noPullRequest: Run = async () => {
  throw new Error("no pull requests found");
};

/** Resolves the context of a review of `dir`; `gh` is a stand-in in every test. */
const resolve = (dir: string, what: string, env: Environment = {}, gh = noPullRequest) =>
  resolveContext(review(dir, what), dir, env, { run: runner(gh) });

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
    expect(await resolve(dir, "working tree")).toBe(null);

    git("checkout", "-b", "fix/review-order");
    expect(await resolve(dir, "staged changes")).toStrictEqual({
      context: { title: "fix/review-order", description: "" },
      source: "branch",
    });
  }));

test("a range takes the branch name when it ends at the working tree or HEAD", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    for (const range of ["main", "HEAD~1", "main..", "main...HEAD"]) {
      expect((await resolve(dir, range))?.context.title).toBe("fix/review-order");
    }

    // Between two other commits, the checked-out branch says nothing about the change.
    for (const range of ["main..other", "v1...v2", "1a2b3c4..5d6e7f8"]) {
      expect(await resolve(dir, range)).toBe(null);
    }
  }));

test("a stash and another VCS's working copy have no branch behind them", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    for (const what of ["stash", "stash stash@{1}", "working copy"]) {
      expect(await resolve(dir, what)).toBe(null);
    }
  }));

test("a feature branch takes its open pull request, asked of gh in the review's directory", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");
    const asked: unknown[] = [];

    const gh: Run = async (_program, args, options) => {
      asked.push([args, options.cwd]);
      return pullRequest({ body: "<!-- left by the template -->\nWhy and how." });
    };

    expect(await resolve(dir, "main", {}, gh)).toStrictEqual({
      context: { title: "Fix the review order", description: "Why and how." },
      source: "pull-request",
    });
    expect(asked).toStrictEqual([[["pr", "view", "--json", "title,body,state"], dir]]);
  }));

test("the branch name stands when gh has no open pull request to show", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    const answers = [
      pullRequest({ state: "MERGED" }),
      pullRequest({ state: "CLOSED" }),
      pullRequest({ title: "  " }),
      JSON.stringify([pullRequest()]),
      "To get started with GitHub CLI, please run: gh auth login",
    ];

    for (const answer of answers) {
      expect((await resolve(dir, "working tree", {}, async () => answer))?.source).toBe("branch");
    }

    expect((await resolve(dir, "working tree", {}, noPullRequest))?.source).toBe("branch");
  }));

test("gh is not asked about a shared branch, a commit or an explicit context", () =>
  withRepo(async (dir, git) => {
    let asked = 0;

    const gh: Run = async () => {
      asked++;
      return pullRequest();
    };

    expect(await resolve(dir, "working tree", {}, gh)).toBe(null);
    expect((await resolve(dir, "show HEAD", {}, gh))?.source).toBe("commit");

    git("checkout", "-b", "fix/review-order");
    const explicit = await resolve(dir, "working tree", { HUNK_TRIAGE_TITLE: "Explicit" }, gh);
    expect(explicit?.source).toBe("env");

    expect(asked).toBe(0);
  }));

test("a gh that never answers costs the pull request, not the branch name", async () => {
  const signals: AbortSignal[] = [];

  // Git answers at once and gh hangs without watching its signal, as a stuck connection would.
  const run: Run = (program, _args, options) => {
    signals.push(options.signal);
    return program === "git" ? Promise.resolve("fix/review-order") : new Promise(() => {});
  };

  const resolved = await resolveContext(
    review(tmpdir(), "main"),
    tmpdir(),
    {},
    {
      run,
      timeoutMs: 20,
    },
  );

  expect(resolved).toStrictEqual({
    context: { title: "fix/review-order", description: "" },
    source: "branch",
  });

  // Both programs were held to one deadline, not given one each.
  expect(signals).toHaveLength(2);
  expect(signals[0]).toBe(signals[1]!);
});

test("show reads the commit message and ignores option-like revisions", () =>
  withRepo(async (dir) => {
    expect(await resolve(dir, "show HEAD")).toStrictEqual({
      context: { title: "Fix ordering", description: "Commit body" },
      source: "commit",
    });
    expect(await resolve(dir, "show --help")).toBe(null);
  }));

test("explicit context wins over Git and loses its HTML comments", () =>
  withRepo(async (dir) => {
    expect(
      await resolve(dir, "show HEAD", {
        HUNK_TRIAGE_TITLE: "Explicit",
        HUNK_TRIAGE_DESCRIPTION: "a<!-- hidden -->b",
      }),
    ).toStrictEqual({ context: { title: "Explicit", description: "ab" }, source: "env" });
  }));

test("every source loses its HTML comments and is cut to the limits", () =>
  withRepo(async (dir, git) => {
    const body = `<!-- left by the template -->\n${"b".repeat(2000)}`;
    git("commit", "--allow-empty", "-m", `${"s".repeat(300)}\n\n${body}`);

    const commit = await resolve(dir, "show HEAD");
    expect(commit!.context).toStrictEqual({
      title: "s".repeat(256),
      description: "b".repeat(1500),
    });

    const explicit = await resolve(dir, "show HEAD", {
      HUNK_TRIAGE_TITLE: "t".repeat(300),
      HUNK_TRIAGE_DESCRIPTION: "  padded  ",
    });
    expect(explicit!.context).toStrictEqual({ title: "t".repeat(256), description: "padded" });
  }));

test("a comment that is never closed stays, and a flood of them costs no time", async () => {
  const describe = async (description: string) => {
    const env = { HUNK_TRIAGE_TITLE: "Explicit", HUNK_TRIAGE_DESCRIPTION: description };

    return (await resolveContext(patch, tmpdir(), env))!.context.description;
  };

  expect(await describe("a<!-- one --><!-- two\n-->b<!-- open")).toBe("ab<!-- open");

  // A regex with a lazy quantifier needs over a minute for this megabyte.
  const start = performance.now();
  expect(await describe("<!--".repeat(262_144))).toBe("<!--".repeat(375));
  expect(performance.now() - start).toBeLessThan(2000);
});

test("a limit that falls inside an emoji does not leave half of it behind", async () => {
  const env = { HUNK_TRIAGE_TITLE: `${"t".repeat(255)}\u{1F680}` };
  const { title } = (await resolveContext(patch, tmpdir(), env))!.context;

  expect(title).toHaveLength(256);
  expect(title.isWellFormed()).toBe(true);
});

test("a patch review has no context, even on a feature branch", () =>
  withRepo(async (dir, git) => {
    git("checkout", "-b", "fix/review-order");

    expect(await resolveContext(patch, dir, {}, { run: runner(noPullRequest) })).toBe(null);
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
