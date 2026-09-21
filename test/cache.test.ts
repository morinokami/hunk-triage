import { expect, test } from "bun:test";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cacheDirectory, cacheKey, diskCache } from "../src/cache.ts";
import { readConfig } from "../src/config.ts";
import { file, verdict, withTempDir } from "./helpers.ts";

const config = readConfig();

test("disk cache validates what it reads and writes atomically", () =>
  withTempDir(async (dir) => {
    const cache = diskCache(dir);
    const v = verdict();

    await cache.write("entry", v);
    expect(await cache.read("entry")).toStrictEqual(v);

    await writeFile(join(dir, "entry.json"), '{"role":"source"}');
    expect(await cache.read("entry")).toBe(undefined);

    await writeFile(join(dir, "entry.json"), "invalid JSON");
    expect(await cache.read("entry")).toBe(undefined);
    expect(await readdir(dir)).toStrictEqual(["entry.json"]);
  }));

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
