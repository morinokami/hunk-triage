import { execFile } from "node:child_process";

/**
 * Runs a program and resolves with its trimmed output. A program that is missing, exits
 * with an error or is aborted rejects, and callers take any rejection as "no answer".
 */
export type Run = (
  program: string,
  args: readonly string[],
  options: { cwd: string; signal: AbortSignal },
) => Promise<string>;

/** The child's streams are pipes, never the terminal that hunk's renderer owns. */
export const execute: Run = (program, args, { cwd, signal }) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      program,
      [...args],
      { cwd, signal, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );

    // Nobody types into the child: a program that asks a question fails at once on the end
    // of its input instead of waiting for the deadline.
    child.stdin?.end();
  });
