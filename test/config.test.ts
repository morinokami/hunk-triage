import { expect, test } from "bun:test";

import { readConfig } from "../src/config.ts";

test("untrusted configuration values fall back to the defaults", () => {
  expect(
    readConfig({ model: "https://evil.test", timeout_ms: Infinity, core_threshold: -1 }),
  ).toStrictEqual(readConfig());
});

test("the timeout is clamped to its bounds", () => {
  expect(readConfig({ timeout_ms: 30 }).timeoutMs).toBe(500);
  expect(readConfig({ timeout_ms: 90000 }).timeoutMs).toBe(20000);
});
