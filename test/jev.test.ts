import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import { ENDPOINT, parseAnswers, queryFiles, requestBody } from "../src/jev.ts";
import { answer, file, requested, verdict } from "./helpers.ts";

const options = (count = 1) => {
  const files = Array.from({ length: count }, (_, i) => file(`${i}.ts`));

  return {
    model: "jev-1.13.0",
    context: null,
    allFiles: files,
    pending: files,
    apiKey: "test-only",
    timeoutMs: 2000,
  };
};

test("request contract includes all paths, truncates patches and uses indexed questions", () => {
  const large = file("a", { patch: "x".repeat(20000) });
  const binary = file("b", { isBinary: true });

  const body = requestBody("jev-1.13.0", null, [large, binary], [large]);

  // A single-file batch must send `file`, not `files`; the check also narrows the union.
  const { state } = body;
  if (!("file" in state)) throw new Error("expected a single-file request body");

  expect(state.file!.patch.length).toBe(16000);
  expect(state.changed_files.length).toBe(2);
  expect(state.pull_request).toBe(undefined);
  expect(Object.keys(body.questions)).toStrictEqual([
    "role_0",
    "mechanical_0",
    "core_0",
    "attention_0",
  ]);
});

test("a response without the expected answers is rejected", () => {
  expect(() => parseAnswers({ answers: {} }, 1)).toThrow();
});

test("batching uses one file through 40, then batches of eight; concurrency stays at twelve", async () => {
  for (const count of [40, 41]) {
    let active = 0;
    let peak = 0;
    const sizes: number[] = [];

    const result = await queryFiles({
      ...options(count),
      fetch: async (url, init) => {
        expect(url).toBe(ENDPOINT);
        expect(init.redirect).toBe("error");

        const { body, files } = requested(init);
        sizes.push(files.length);
        if (files.length > 1) expect(body.questions.core_0.instructions).toMatch(/files\[0\]/);

        peak = Math.max(peak, ++active);
        await delay(2);
        active--;

        return answer(files.map(() => verdict()));
      },
    });

    expect(result.verdicts.size).toBe(count);
    expect(peak).toBeLessThanOrEqual(12);
    expect(sizes).toStrictEqual(count === 40 ? Array(40).fill(1) : [8, 8, 8, 8, 8, 1]);
  }
});

test("retries overload statuses, using up to three retries", async () => {
  let calls = 0;

  const result = await queryFiles({
    ...options(),
    fetch: async () => {
      calls++;
      if (calls < 4) return new Response("", { status: calls === 2 ? 529 : 429 });

      return answer([verdict()]);
    },
  });

  expect(calls).toBe(4);
  expect(result.failed).toBe(0);
});

test("does not retry other error statuses", async () => {
  for (const status of [401, 422, 500]) {
    let calls = 0;

    const result = await queryFiles({
      ...options(),
      fetch: async () => {
        calls++;
        return new Response("", { status });
      },
    });

    expect(calls).toBe(1);
    expect(result.failed).toBe(1);
  }
});

test("one global deadline bounds active requests and queued work; completed results survive", async () => {
  let calls = 0;
  const start = performance.now();

  const result = await queryFiles({
    ...options(20),
    timeoutMs: 40,
    fetch: async () => {
      calls++;
      if (calls === 1) return answer([verdict()]);

      // Every later request hangs until the deadline aborts it.
      return new Promise<Response>(() => {});
    },
  });

  expect(performance.now() - start).toBeLessThan(1000);
  expect(result.verdicts.size).toBe(1);
  expect(result.failed).toBe(19);
  expect(calls).toBeLessThanOrEqual(13);
});

test("the deadline also bounds backoff", async () => {
  const result = await queryFiles({
    ...options(),
    timeoutMs: 20,
    fetch: async () => new Response("", { status: 429 }),
  });

  expect(result.failed).toBe(1);
});

test("malformed member invalidates its entire batch", async () => {
  const result = await queryFiles({
    ...options(41),
    fetch: async (_, init) => {
      const { files } = requested(init);
      const response = (await answer(files.map(() => verdict())).json()) as {
        answers: { attention_7: { score: number } };
      };

      // Corrupt one answer of the batch that starts at the first file.
      if (files[0]!.path === "0.ts") response.answers.attention_7.score = 4;

      return Response.json(response);
    },
  });

  expect(result.failed).toBe(8);
  expect(result.verdicts.size).toBe(33);
});
