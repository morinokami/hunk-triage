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
- Git, and optionally the [GitHub CLI](https://cli.github.com/) (`gh`), installed and logged in, supply the [context](#context) of a review. Failure to obtain context does not block classification.
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

- Mechanical files are edits a reviewer can verify at a glance: local renames, moved code, formatting, and call sites, tests or docs that only follow a change made elsewhere. Dependency updates and changes to settings, defaults or public types are not mechanical; they are grouped as config, core or supporting.
- Settings and data the application reads at runtime, and database migrations, are meant to count as source rather than config, which places them in core or supporting. Jev judges each file, and one such as `config/production.json` can still land in config.
- Binary files, oversized files, empty patches and failed classifications remain unclassified, at the end. If no files have a valid classification, the original order is retained with one status heading.
- Existing diffs and annotations are preserved. No classification cards are added beside the diff.
- The pane retains filtering, file selection, mouse navigation and `s` to toggle the files pane (subject to hunk's keybindings). hunk may hide the pane at narrower terminal widths; use `--sidebar` to show it explicitly.

## Context

Jev is told what the change is for when the extension can find out, and judges from the list of changed files alone when it cannot. The title and description come from the review itself:

- `hunk show` uses the commit message.
- A review of the checked-out branch's work uses the title and description of the branch's open pull request, and the branch name when there is none; shared branches like `main` get neither. Such reviews are `hunk diff`, `hunk diff --staged` and ranges that end at the working tree or `HEAD`, such as `hunk diff main` and `hunk diff main...HEAD`.
- A patch, a stash and a range between two other commits have no context.

The pull request is read with `gh pr view`, so it is found wherever the GitHub CLI finds it, forks and GitHub Enterprise included, and only when `gh` is installed and logged in. A merged or closed pull request is ignored. `gh` is asked on every load, which usually takes about half a second; Git and `gh` together get 2 seconds, after which the branch name is used.

`HUNK_TRIAGE_TITLE` takes precedence over all of these, with `HUNK_TRIAGE_DESCRIPTION` to accompany it, and nothing is looked up when it is set; a description without a title is ignored. Use them where `gh` cannot reach the pull request, or to give context to a review that has none:

```sh
HUNK_TRIAGE_TITLE='Fix session expiration' hunk patch change.diff
```

Whatever the source, the title is limited to 256 characters and the description to 1,500, with HTML comments removed. A review without context is classified all the same.

To see what a review got, set `HUNK_TRIAGE_DEBUG`: the diagnostics file shows the context, where it came from (`context_source`) and how long finding it took (`context_ms`).

## Configuration

Optional settings in `~/.config/hunk/config.toml`:

```toml
[extension.hunk-triage]
model = "jev-1.13.0"
timeout_ms = 5000
core_threshold = 0.5
```

| Setting          | Default      | Meaning                                                                                                               |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `model`          | `jev-1.13.0` | Model ID. The default is pinned to the evaluated version.                                                             |
| `timeout_ms`     | `5000`       | Total Jev request budget, including queues and retries; clamped to 500-20,000 ms. Context and cache time is separate. |
| `core_threshold` | `0.5`        | Threshold separating core from supporting for source/other files; must be within 0-1.                                 |

Repository `.hunk/config.toml` can override these settings.

| Environment variable      | Purpose                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`        | API authentication; required to classify, including when cached results exist.            |
| `HUNK_TRIAGE_TITLE`       | Optional explicit context, taking precedence over any other; limited to 256 characters.   |
| `HUNK_TRIAGE_DESCRIPTION` | Optional accompanying description; HTML comments removed and limited to 1,500 characters. |
| `HUNK_TRIAGE_DEBUG`       | Optional path to a JSON diagnostics file (e.g. `/tmp/triage.json`), rewritten each run.   |
| `XDG_CACHE_HOME`          | Cache root; absolute paths only. Defaults to `~/.cache` on every platform.                |

## Data and cache

Classification sends the first 16,000 characters of each eligible patch, all changed file paths and line counts, and any resolved context to `https://api.typesafe.ai/v1/systemone`. Binary content is not sent. The key is used only in the authorization header. See [TypeSafe's data handling documentation](https://docs.typesafe.ai/models#data-handling) for the service's policies.

On a feature branch the extension also runs `gh pr view` in the directory under review. `gh` talks to GitHub with its own login, which the extension never reads. What comes back, the pull request's title and description, is sent to TypeSafe as the context, within the limits given under [Context](#context).

Verdicts are stored as JSON under `${XDG_CACHE_HOME:-~/.cache}/hunk-triage/`. The home directory is resolved as hunk resolves its own, from `HOME` then `USERPROFILE`, so macOS and Windows use this same location rather than `~/Library/Caches` or `%LOCALAPPDATA%`. A relative `XDG_CACHE_HOME` is ignored; if no home directory can be resolved, classification continues without a cache.

There is no automatic cache cleanup in the initial release. You can delete this extension's `hunk-triage` cache directory to clear it; results will be requested again. Debug output contains file paths and context, so choose its destination accordingly; the API key and raw patches are not written to diagnostics.
