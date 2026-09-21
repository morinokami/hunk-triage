import { setMaxListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import type { Context, DiffFile, Verdict } from "./types.ts";

import { abortable } from "./abortable.ts";
import { isRecord, isVerdict } from "./guards.ts";
import { questions } from "./questions.ts";

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const PATCH_LIMIT = 16_000;

// Up to this many files are asked about one at a time; beyond it they share a request.
const SINGLE_FILE_LIMIT = 40;
const BATCH_SIZE = 8;
const MAX_CONCURRENCY = 12;
const MAX_RETRIES = 3;

/** The part of a patch that Jev sees, which is also the part a cached verdict depends on. */
export function sentPatch(file: DiffFile): string {
  return file.patch.slice(0, PATCH_LIMIT);
}

export function requestBody(
  model: string,
  context: Context | null,
  allFiles: readonly DiffFile[],
  batch: readonly DiffFile[],
) {
  const files = batch.map((file) => ({ path: file.path, patch: sentPatch(file) }));

  const changedFiles = allFiles.map(
    (file) => `${file.path} (+${file.stats.additions} -${file.stats.deletions})`,
  );

  // Each question carries its file's index and points at that file's path in the state.
  const indexed = batch.flatMap((_, index) => {
    const ref = batch.length === 1 ? "file" : `files[${index}]`;

    return Object.entries(questions(context !== null, ref)).map(
      ([id, question]) => [`${id}_${index}`, question] as const,
    );
  });

  return {
    model,
    state: {
      ...(context ? { pull_request: context } : {}),
      changed_files: changedFiles,
      ...(files.length === 1 ? { file: files[0] } : { files }),
    },
    questions: Object.fromEntries(indexed),
  };
}

/** Reads one answer of the expected Jev type, or rejects the response it came in. */
function answerOf(answers: Record<string, unknown>, id: string, type: string) {
  const answer = answers[id];
  if (!isRecord(answer) || answer.type !== type) throw new Error("Invalid Jev answer types");

  return answer;
}

export function parseAnswers(value: unknown, count: number): Verdict[] {
  if (!isRecord(value) || !isRecord(value.answers)) throw new Error("Invalid Jev response");
  const answers = value.answers;

  return Array.from({ length: count }, (_, index) => {
    const verdict = {
      role: answerOf(answers, `role_${index}`, "choice").choice,
      mechanical: answerOf(answers, `mechanical_${index}`, "noul").noul,
      core: answerOf(answers, `core_${index}`, "noul").noul,
      attention: answerOf(answers, `attention_${index}`, "score").score,
    };
    if (!isVerdict(verdict)) throw new Error("Invalid Jev verdict");

    return verdict;
  });
}

/** Releases the connection of a response whose body is never read. */
function discard(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

/** Posts one request, waiting out an overloaded Jev, and returns the decoded response. */
async function post(
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
  transport: Fetch,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();

    const request = transport(ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const response = await abortable(request, signal);

    const overloaded = response.status === 429 || response.status === 529;
    if (overloaded && attempt < MAX_RETRIES) {
      discard(response);
      await delay(250 * 2 ** attempt, undefined, { signal });
      continue;
    }

    if (!response.ok) {
      discard(response);
      throw new Error(`Jev HTTP ${response.status}`);
    }

    return abortable(response.json(), signal);
  }
}

function batchFiles(pending: readonly DiffFile[]): DiffFile[][] {
  const size = pending.length > SINGLE_FILE_LIMIT ? BATCH_SIZE : 1;

  return Array.from({ length: Math.ceil(pending.length / size) }, (_, i) =>
    pending.slice(i * size, (i + 1) * size),
  );
}

export async function queryFiles(options: {
  model: string;
  context: Context | null;
  allFiles: readonly DiffFile[];
  pending: readonly DiffFile[];
  apiKey: string;
  timeoutMs: number;
  fetch?: Fetch;
}) {
  const { pending } = options;
  const verdicts = new Map<string, Verdict>();
  if (!pending.length) return { verdicts, failed: 0 };

  const batches = batchFiles(pending);
  const transport = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();

  // Twelve concurrent requests and cancellation races share this signal.
  setMaxListeners(50, controller.signal);
  const timer = setTimeout(() => controller.abort(new Error("Jev timed out")), options.timeoutMs);

  // Workers take the next batch until the queue empties or the deadline aborts them.
  let next = 0;
  const worker = async () => {
    while (!controller.signal.aborted) {
      const batch = batches[next++];
      if (!batch) return;

      try {
        const body = requestBody(options.model, options.context, options.allFiles, batch);
        const payload = await post(body, options.apiKey, controller.signal, transport);
        const values = parseAnswers(payload, batch.length);
        if (controller.signal.aborted) return;

        batch.forEach((file, i) => verdicts.set(file.id, values[i]!));
      } catch {
        /* A failed request invalidates its entire batch. */
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, batches.length) }, worker));
  } finally {
    clearTimeout(timer);
  }

  return { verdicts, failed: pending.length - verdicts.size };
}
