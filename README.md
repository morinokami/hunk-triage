# hunk-triage

Read the important changes first. hunk-triage is a [hunk](https://www.hunk.dev/) extension that uses [TypeSafe](https://typesafe.ai/) Jev to classify changed files, then orders them for review.

The extension replaces hunk's file pane with a grouped list. The groups appear in this order:

```text
core → supporting → tests → fixtures → docs → config
     → mechanical → generated → unclassified
```

It helps choose where to start reading; it does not find bugs or certify that a change is safe.

## Requirements

- hunk 0.22.0 or later. The extension requires extension API 25, which first shipped in 0.22.0; 0.21 provides API 16. Only 0.22.0 has been tested, and the API is experimental, so later releases may break it.
- A TypeSafe API key in `TYPESAFE_API_KEY`.
- Git is used for optional commit/branch context. Failure to obtain context does not block classification.
- Linux, macOS or Windows.

## Install

```sh
hunk extension install morinokami/hunk-triage
```

Installation follows [hunk's extension workflow](https://www.hunk.dev/docs/extend/extensions/); the extension loads automatically on subsequent launches.

This installs the latest `main`, and `hunk extension update hunk-triage` fetches it again. [Releases](https://github.com/morinokami/hunk-triage/releases) describe what changed. To stay on one release instead, install its tag:

```sh
hunk extension install morinokami/hunk-triage@<tag>
```

A pinned install stays on that tag when updated. To move to another release, remove the extension and install the new tag.

Set `TYPESAFE_API_KEY` in the environment used to launch hunk, then review normally:

```sh
hunk diff
hunk diff --staged
hunk show HEAD
hunk diff main
hunk patch change.diff
```

Without a key, hunk remains usable and shows the original file order.

Disable all user extensions for one launch with `hunk diff --no-extensions`. Remove this managed extension with `hunk extension remove hunk-triage`.

## Behavior

- Binary files, oversized files, empty patches and failed classifications remain unclassified, at the end. If no files have a valid classification, the original order is retained with one status heading.
- Existing diffs and annotations are preserved. No classification cards are added beside the diff.
- The pane retains filtering, file selection, mouse navigation and `s` to toggle the files pane (subject to hunk's keybindings). hunk may hide the pane at narrower terminal widths; use `--sidebar` to show it explicitly.
- `hunk show` can use the commit message. Working-tree and staged reviews can use a feature branch name, except on shared branches like `main`. Supply a PR description yourself with `HUNK_TRIAGE_TITLE` / `HUNK_TRIAGE_DESCRIPTION`. Whatever the source, the title is limited to 256 characters and the description to 1,500, with HTML comments removed.

## Configuration

Optional settings in `~/.config/hunk/config.toml`:

```toml
[extension.hunk-triage]
model = "jev-1.13.0"
timeout_ms = 5000
core_threshold = 0.5
```

| Setting          | Default      | Meaning                                                                                                       |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `model`          | `jev-1.13.0` | Model ID. The default is pinned to the evaluated version.                                                     |
| `timeout_ms`     | `5000`       | Total Jev request budget, including queues and retries; clamped to 500-20,000 ms. Git/cache time is separate. |
| `core_threshold` | `0.5`        | Threshold separating core from supporting for source/other files; must be within 0-1.                         |

Repository `.hunk/config.toml` can override these settings.

| Environment variable      | Purpose                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`        | API authentication; required to classify, including when cached results exist.            |
| `HUNK_TRIAGE_TITLE`       | Optional explicit context, taking precedence over Git context; limited to 256 characters. |
| `HUNK_TRIAGE_DESCRIPTION` | Optional accompanying description; HTML comments removed and limited to 1,500 characters. |
| `HUNK_TRIAGE_DEBUG`       | Optional path to a JSON diagnostics file (e.g. `/tmp/triage.json`), rewritten each run.   |
| `XDG_CACHE_HOME`          | Cache root; absolute paths only. Defaults to `~/.cache` on every platform.                |

To give a patch context (`hunk patch` has no commit or branch to read from):

```sh
HUNK_TRIAGE_TITLE='Fix session expiration' hunk patch change.diff
```

## Data and cache

Classification sends the first 16,000 characters of each eligible patch, all changed file paths and line counts, and any resolved context to `https://api.typesafe.ai/v1/systemone`. Binary content is not sent. The key is used only in the authorization header. See [TypeSafe's data handling documentation](https://docs.typesafe.ai/models#data-handling) for the service's policies.

Verdicts are stored as JSON under `${XDG_CACHE_HOME:-~/.cache}/hunk-triage/`. The home directory is resolved as hunk resolves its own, from `HOME` then `USERPROFILE`, so macOS and Windows use this same location rather than `~/Library/Caches` or `%LOCALAPPDATA%`. A relative `XDG_CACHE_HOME` is ignored; if no home directory can be resolved, classification continues without a cache.

There is no automatic cache cleanup in the initial release. You can delete this extension's `hunk-triage` cache directory to clear it; results will be requested again. Debug output contains file paths and context, so choose its destination accordingly; the API key and raw patches are not written to diagnostics.
