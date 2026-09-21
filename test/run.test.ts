import { expect, test } from "bun:test";
import { tmpdir } from "node:os";

import { execute } from "../src/run.ts";

// The test runtime is the one program every CI platform is sure to have.
const script = (source: string, signal = AbortSignal.timeout(10_000)) =>
  execute(process.execPath, ["-e", source], { cwd: tmpdir(), signal });

test("resolves with the program's output, trimmed", async () => {
  expect(await script("console.log('  answer  ')")).toBe("answer");
});

test("a failing exit and a missing program both reject", async () => {
  await expect(script("process.exit(3)")).rejects.toThrow();

  const missing = execute("hunk-triage-no-such-program", [], {
    cwd: tmpdir(),
    signal: AbortSignal.timeout(10_000),
  });
  await expect(missing).rejects.toThrow();
});

test("a program that reads its input finds it already ended", async () => {
  const source = "process.stdin.resume(); process.stdin.on('end', () => console.log('ended'))";

  expect(await script(source)).toBe("ended");
});

// Left waiting for the program, the test would run into its own timeout.
test("an aborted signal ends the wait for a program that is still running", async () => {
  await expect(script("setTimeout(() => {}, 60_000)", AbortSignal.timeout(50))).rejects.toThrow();
});
