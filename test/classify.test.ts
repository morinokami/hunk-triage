import { expect, test } from "bun:test";

import type { Group } from "../src/types.ts";

import { applyVerdicts, countsLabel, groupFor, groupOf } from "../src/classify.ts";
import { changeset, file, verdict } from "./helpers.ts";

test("group precedence and thresholds follow the specification", () => {
  const cases = [
    [verdict({ role: "generated", mechanical: 1 }), "generated"],
    [verdict({ role: "test", mechanical: 0.5 }), "mechanical"],
    [verdict({ role: "test", core: 1 }), "tests"],
    [verdict({ role: "fixture" }), "fixtures"],
    [verdict({ role: "docs" }), "docs"],
    [verdict({ role: "config" }), "config"],
    [verdict({ role: "other", core: 0.5 }), "core"],
    [verdict({ core: 0.49 }), "supporting"],
    [undefined, "unclassified"],
  ] as const;

  for (const [v, expected] of cases) {
    expect(groupFor(v, 0.5)).toBe(expected);
  }
});

test("sorts groups and scores stably while preserving original data and annotations", () => {
  const paths = [
    "unknown",
    "test-low",
    "support",
    "core-low",
    "generated",
    "core-high",
    "test-high",
    "tie",
    "unknown-2",
  ];

  const original = changeset(...paths.map((path) => file(path)));
  original.agentSummary = "Existing review";
  original.files[5]!.agent = { path: "core-high", summary: "Existing note", annotations: [] };

  const values = new Map([
    ["test-low", verdict({ role: "test", attention: 1 })],
    ["support", verdict({ core: 0.2 })],
    ["core-low", verdict({ core: 0.6, attention: 3 })],
    ["generated", verdict({ role: "generated" })],
    ["core-high", verdict()],
    ["test-high", verdict({ role: "test", attention: 3 })],
    ["tie", verdict()],
  ]);

  const before = structuredClone(original);
  const applied = applyVerdicts(original, values, 0.5);

  expect(applied.changeset.files.map((f) => f.id)).toStrictEqual([
    "core-high",
    "tie",
    "core-low",
    "support",
    "test-high",
    "test-low",
    "generated",
    "unknown",
    "unknown-2",
  ]);
  expect(original).toStrictEqual(before);

  for (const output of applied.changeset.files) {
    const input = original.files.find((f) => f.id === output.id)!;
    expect(output.metadata).toBe(input.metadata);
    expect(output.patch).toBe(input.patch);
  }

  expect(applied.changeset.files[0]!.agent!.annotations).toBe(
    original.files[5]!.agent!.annotations,
  );
  expect(applied.changeset.files[0]!.agent!.summary!).toMatch(/Existing note$/);
  expect(applied.changeset.agentSummary!).toMatch(/Existing review$/);
});

test("counts follow the review order and leave out empty groups", () => {
  const groups = new Map<string, Group>([
    ["a", "unclassified"],
    ["b", "core"],
    ["c", "tests"],
    ["d", "core"],
  ]);

  expect(countsLabel(groups)).toBe("core 2 · tests 1 · unclassified 1");
});

test("a file without a group is unclassified", () => {
  expect(groupOf(new Map([["a", "core"]]), "a")).toBe("core");
  expect(groupOf(new Map(), "a")).toBe("unclassified");
});
