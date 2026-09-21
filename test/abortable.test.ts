import { expect, test } from "bun:test";

import { abortable } from "../src/abortable.ts";

test("an operation that settles first keeps its result", async () => {
  expect(await abortable(Promise.resolve("done"), AbortSignal.timeout(10_000))).toBe("done");
});

test("an operation that ignores its signal is still given up when the signal aborts", async () => {
  const deadline = new Error("deadline");
  const controller = new AbortController();
  setTimeout(() => controller.abort(deadline), 10);

  await expect(abortable(new Promise(() => {}), controller.signal)).rejects.toBe(deadline);
});

test("an already aborted signal rejects without waiting", async () => {
  const signal = AbortSignal.abort(new Error("too late"));

  await expect(abortable(new Promise(() => {}), signal)).rejects.toThrow("too late");
});
