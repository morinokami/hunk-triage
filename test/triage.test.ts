import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diskCache } from "../src/cache.ts";
import { readConfig } from "../src/config.ts";
import { triage } from "../src/triage.ts";
import { answer, changeset, file, memoryCache, verdict, withTempDir } from "./helpers.ts";

const env = { TYPESAFE_API_KEY: "test-only" };
const config = readConfig();

// These runs never reach Git, because the helper title is neither a `show` nor a working
// tree; the directory only has to exist on every platform.
const cwd = tmpdir();

test("partial failure puts failed and skipped files last", async () => {
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
});

test("total failure preserves the exact changeset", async () => {
  const input = changeset(file("fail"), file("binary", { isBinary: true }), file("ok"));

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
});

test("cached verdicts still classify the review when Jev fails for the rest", async () => {
  const cache = memoryCache();

  await triage(changeset(file("a"), file("b")), cwd, config, {
    cache,
    env,
    fetch: async () => answer([verdict()]),
  });

  const mixed = await triage(changeset(file("a"), file("b", { patch: "bad" })), cwd, config, {
    cache,
    env,
    fetch: async () => new Response("", { status: 401 }),
  });

  expect(mixed.state.mode).toBe("classified");
  expect(mixed.cached).toBe(1);
  expect(mixed.failed).toBe(1);
});

test("an unusable cache directory and an unwritable debug path do not stop a review", () =>
  withTempDir(async (dir) => {
    // A directory cannot be created below a file, and the debug path's parent does not exist.
    const blocker = join(dir, "blocker");
    await writeFile(blocker, "");

    const result = await triage(changeset(file("a")), cwd, config, {
      env: { ...env, HUNK_TRIAGE_DEBUG: join(dir, "missing", "debug.json") },
      cache: diskCache(join(blocker, "impossible")),
      fetch: async () => answer([verdict()]),
    });

    expect(result.state.mode).toBe("classified");
  }));

test("debug output names each file's group and never contains the API key", () =>
  withTempDir(async (dir) => {
    const debugPath = join(dir, "debug.json");

    await triage(changeset(file("a")), cwd, config, {
      env: { ...env, HUNK_TRIAGE_DEBUG: debugPath },
      cache: memoryCache(),
      fetch: async () => answer([verdict()]),
    });

    const debug = await readFile(debugPath, "utf8");
    expect(debug).not.toContain("test-only");
    expect(JSON.parse(debug).files[0].group).toBe("core");
  }));
