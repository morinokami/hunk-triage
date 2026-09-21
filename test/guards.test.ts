import { expect, test } from "bun:test";

import { isVerdict } from "../src/guards.ts";
import { verdict } from "./helpers.ts";

test("rejects corrupt verdicts", () => {
  const corrupt = [
    null,
    [],
    verdict({ attention: NaN }),
    verdict({ core: 2 }),
    { ...verdict(), role: "constructor" },
    { ...verdict(), mechanical: "0.5" },
  ];

  for (const value of corrupt) {
    expect(isVerdict(value)).toBe(false);
  }
});
