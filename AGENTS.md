# hunk-triage

A [hunk](https://www.hunk.dev/) extension that orders changed files for review with TypeSafe's Jev API. hunk imports `src/index.tsx` directly at startup; there is no build step. README.md is the user-facing contract for behavior, settings, limits and what data leaves the machine.

## Workflow

- Run `bun run check` after every series of changes. It is the CI gate (format check, typecheck, tests) and takes a few seconds.
- Run `bun run fmt` after editing anything, docs and config included: oxfmt sorts imports and also checks Markdown, JSON and YAML.
- When a change alters behavior, defaults, limits, environment variables or what is sent to the API, update README.md in the same change.

## Verifying hunk-facing changes

- Never launch the hunk TUI yourself (`hunk diff`, `hunk show`, …), not even piped or with a timeout. It has no headless mode and hangs holding the terminal. Ask the user to run `hunk diff --extension .` from this checkout and report what the pane and toasts show; with `HUNK_TRIAGE_DEBUG=<file>` set, the run also writes JSON diagnostics you can read afterwards.
- Never write to stdout or stderr from extension code, `console.log` included; hunk's renderer owns the terminal. Messages for the user go through `ctx.notify`.
- The hunk extension API is experimental and pinned by the `hunkdiff` devDependency. Don't guess at it: read `node_modules/hunkdiff/skills/hunk-extensions/SKILL.md` ("Rules that bite" first) and the contract in `node_modules/hunkdiff/dist/npm/extension/extension-api/types.d.ts`. Jev's request and answer shapes are documented at https://docs.typesafe.ai/api.

## Design rules

- Fail open. A review must work as it would without the extension: a missing key, timeout, HTTP error, corrupt cache entry, unwritable path or Git failure degrades to "unclassified" or the original order. `triage()` never throws, and every wait is bounded by a deadline.
- Do not leak. The API key, raw patches and transport error details never reach notifications, debug output or the cache.
- Treat `hunk.config` (a reviewed repository's `.hunk/config.toml` can set it), cache files and Jev responses as untrusted: validate and fall back, as `readConfig` and `isVerdict` do.
- The question wording in `src/questions.ts` and the default model are an evaluated pair; don't reword or bump them in passing. Anything that changes what Jev is asked must also change the cache key (bump `QUESTIONS_VERSION` or add the input to `cacheKey`), or stale verdicts are served.
- No runtime dependencies. hunk supplies `hunkdiff`, `react` and `@opentui/*` at runtime, and a second React copy breaks the pane, so they are devDependencies for types only. Everything else is Node built-ins.

## Testing

- Tests use `bun:test` and inject `fetch`, `cache` and `env` through the options of `triage()` and `queryFiles()`; builders live in `test/helpers.ts`. Never call the real API, read the real environment or touch the real cache directory, and prefer this injection over module mocks.
- CI runs on Linux, macOS and Windows. Keep code and tests platform-neutral: `node:path` and `os.tmpdir()`, no hard-coded POSIX paths or shell commands.
