import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cacheDirectory, cacheKey, diskCache } from "../src/cache.ts";
import { readConfig } from "../src/config.ts";
import { resolveContext } from "../src/context.ts";
import { triage } from "../src/triage.ts";
import { answer, changeset, file, memoryCache, verdict } from "./helpers.ts";

const env = { TYPESAFE_API_KEY: "test-only" };
const config = readConfig();

// These runs never reach Git, because the helper title is neither a `show` nor a working
// tree; the directory only has to exist on every platform.
const cwd = tmpdir();

test("partial failure puts failed/skipped files last; all failure preserves exact changeset", async () => {
  const input = changeset(file("fail"), file("binary", { isBinary: true }), file("ok"));

  const result = await triage(input, cwd, config, {
    env,
    cache: memoryCache(),
    fetch: async (_, init) => {
      const body = JSON.parse(init.body as string);

      return body.state.file.path === "ok"
        ? answer([verdict()])
        : new Response("", { status: 401 });
    },
  });

  expect(result.changeset.files.map((f) => f.path)).toStrictEqual(["ok", "fail", "binary"]);
  expect(result.failed).toBe(1);
  expect(result.asked).toBe(2);
  expect(result.state.groups.get("binary")).toBe("unclassified");

  const failed = await triage(input, cwd, config, {
    env,
    cache: memoryCache(),
    fetch: async () => new Response("", { status: 401 }),
  });

  expect(failed.changeset).toBe(input);
  expect(failed.state.mode).toBe("unavailable");
  expect(failed.state.groups.size).toBe(0);
});

test("empty, missing-key and no-targets paths never invoke transport", async () => {
  const transport = async (): Promise<Response> => {
    throw new Error("must not call");
  };

  const empty = await triage(changeset(), cwd, config, { env: {}, fetch: transport });
  expect(empty.state.mode).toBe("empty");

  const input = changeset(file("a"));
  const missing = await triage(input, cwd, config, { env: {}, fetch: transport });
  expect(missing.changeset).toBe(input);
  expect(missing.reason!).toMatch(/TYPESAFE_API_KEY/);

  const skipped = await triage(changeset(file("a", { patch: "" })), cwd, config, {
    env,
    fetch: transport,
  });
  expect(skipped.state.mode).toBe("no-targets");
});

test("reload reuses cache, reclassifies changed patches and invalidates on added paths or context", async () => {
  const cache = memoryCache();
  let calls = 0;

  const transport = async () => {
    calls++;
    return answer([verdict()]);
  };

  const run = (input = changeset(file("a"), file("b")), extra = {}) =>
    triage(input, cwd, config, { cache, fetch: transport, env: { ...env, ...extra } });

  await run();
  expect(calls).toBe(2);

  expect((await run()).cached).toBe(2);
  expect(calls).toBe(2);

  await run(changeset(file("a", { patch: "changed" }), file("b")));
  expect(calls).toBe(3);

  await run(changeset(file("a"), file("b"), file("c")));
  expect(calls).toBe(6);

  await run(undefined, { HUNK_TRIAGE_TITLE: "different intent" });
  expect(calls).toBe(8);

  const mixed = await triage(changeset(file("a"), file("b", { patch: "bad" })), cwd, config, {
    cache,
    env,
    fetch: async () => new Response("", { status: 401 }),
  });

  expect(mixed.state.mode).toBe("classified");
  expect(mixed.cached).toBe(1);
  expect(mixed.failed).toBe(1);
});

test("cache is validated and writes atomically; unavailable cache/debug do not break classification", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hunk-triage-cache-"));

  try {
    const cache = diskCache(dir);
    const v = verdict();

    await cache.write("entry", v);
    expect(await cache.read("entry")).toStrictEqual(v);

    await writeFile(join(dir, "entry.json"), '{"role":"source"}');
    expect(await cache.read("entry")).toBe(undefined);

    await writeFile(join(dir, "entry.json"), "invalid JSON");
    expect(await cache.read("entry")).toBe(undefined);
    expect(await readdir(dir)).toStrictEqual(["entry.json"]);

    // An unusable cache directory and an unwritable debug path must not stop a review.
    const result = await triage(changeset(file("a")), cwd, config, {
      env: { ...env, HUNK_TRIAGE_DEBUG: join(dir, "missing", "debug.json") },
      cache: diskCache(join(dir, "entry.json", "impossible")),
      fetch: async () => answer([v]),
    });
    expect(result.state.mode).toBe("classified");

    const debugPath = join(dir, "debug.json");
    await triage(changeset(file("a")), cwd, config, {
      env: { ...env, HUNK_TRIAGE_DEBUG: debugPath },
      cache: memoryCache(),
      fetch: async () => answer([v]),
    });

    const debug = await readFile(debugPath, "utf8");
    expect(debug).not.toContain("test-only");
    expect(JSON.parse(debug).files[0].group).toBe("core");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cache keys include model, context, paths and patch while ignoring original path order", () => {
  const f = file("a");
  const key = cacheKey(config.model, null, ["b", "a"], f);

  expect(key).toBe(cacheKey(config.model, null, ["a", "b"], f));
  expect(key).not.toBe(cacheKey("jev-other", null, ["a", "b"], f));
  expect(key).not.toBe(cacheKey(config.model, { title: "x", description: "" }, ["a", "b"], f));
  expect(key).not.toBe(cacheKey(config.model, null, ["a"], f));
});

test("cache directory follows hunk's home resolution and ignores relative settings", () => {
  const home = join("/home", "someone");

  expect(cacheDirectory({ XDG_CACHE_HOME: home })).toBe(join(home, "hunk-triage"));
  expect(cacheDirectory({ HOME: home })).toBe(join(home, ".cache", "hunk-triage"));
  expect(cacheDirectory({ USERPROFILE: home })).toBe(join(home, ".cache", "hunk-triage"));

  // HOME before USERPROFILE, as hunk does, so Git Bash on Windows agrees with the host.
  const both = { HOME: home, USERPROFILE: join("/elsewhere") };
  expect(cacheDirectory(both)).toBe(join(home, ".cache", "hunk-triage"));

  // A relative setting must never put the cache inside the repository under review.
  expect(cacheDirectory({ XDG_CACHE_HOME: "cache", HOME: home })).toBe(
    join(home, ".cache", "hunk-triage"),
  );
  expect(cacheDirectory({ HOME: "cache" })).toBe(undefined);
});

test("context is optional, explicit context wins, git resolves commits and feature branches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hunk-triage-git-"));

  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid"];

    git("init", "-b", "main");
    git(...identity, "commit", "--allow-empty", "-m", "Fix ordering\n\nCommit body");

    expect(resolveContext("repo working tree", dir, {})).toBe(null);

    git("checkout", "-b", "fix/review-order");
    expect(resolveContext("repo staged changes", dir, {})!.title).toBe("fix/review-order");

    expect(resolveContext("repo show HEAD", dir, {})).toStrictEqual({
      title: "Fix ordering",
      description: "Commit body",
    });
    expect(resolveContext("repo show --help", dir, {})).toBe(null);

    expect(
      resolveContext("repo show HEAD", dir, {
        HUNK_TRIAGE_TITLE: "Explicit",
        HUNK_TRIAGE_DESCRIPTION: "a<!-- hidden -->b",
      }),
    ).toStrictEqual({ title: "Explicit", description: "ab" });
    expect(resolveContext("Patch review: stdin patch", dir, {})).toBe(null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
