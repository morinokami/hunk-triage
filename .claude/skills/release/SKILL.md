---
name: release
description: Cut a hunk-triage release - choose the version, open the version-bump PR whose body is the release notes, tag the merged commit and draft the GitHub Release. Re-entrant; it reads where the release stands from git and GitHub and continues from the next step, so it is run once to open the PR and again after the PR is merged. Use whenever the user wants to release, ship, tag or publish a version, bump the version, asks what changed since the last release, or wants release notes written, even if they don't type /release.
argument-hint: "[version]"
---

# Release hunk-triage

The policy is in AGENTS.md under "Releasing": why `main` must stay shippable, what a release is for, how to choose the version, and that there is no CHANGELOG.md. This skill is the procedure.

A release takes two runs, each ending in a step that belongs to the user:

1. Propose the version and notes, and open the release PR. The user reviews both there and merges.
2. Tag the merged commit and draft the GitHub Release. The user reads the draft on GitHub and publishes it.

Nothing carries over between runs except what is on GitHub, so every run starts by finding out where the release stands. An argument, if given, is the version to release (`0.2.0` or `v0.2.0`).

## Find out where the release stands

```sh
git fetch origin --tags --prune
git describe --tags --abbrev=0 --match 'v*' origin/main      # LATEST: the newest release tag on main
git show origin/main:package.json | grep '"version"'         # the version main declares
gh pr list --state open --json number,title,url,headRefName  # is a chore/release-* PR open?
gh release view LATEST --json isDraft,url                    # does LATEST have a Release, and is it published?
```

| What you see                                    | Where you are                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| An open PR from `chore/release-vX.Y.Z`          | Waiting for the user to merge. Report its URL and CI state, and stop.                                            |
| `main` declares a version newer than LATEST     | The release PR is merged. Go to [Tag](#tag).                                                                     |
| The version equals LATEST, which has no Release | The tag is pushed. Go to [Draft the Release](#draft-the-release).                                                |
| LATEST's Release is a draft                     | Waiting for the user to publish. Report its URL; publish only if asked (`gh release edit LATEST --draft=false`). |
| LATEST's Release is published                   | Nothing is in flight. Go to [Propose](#propose).                                                                 |

## Propose

```sh
git log --oneline LATEST..origin/main
git diff LATEST..origin/main -- README.md package.json
```

- README.md is the user-facing contract and changes in the same PR as the behavior, so its diff is the list of user-visible changes. The `package.json` diff shows a raised `hunk.apiVersion` or `hunkdiff`. Read the PR behind anything unclear (`gh pr view N`).
- If there are no commits, or only refactors, tests, tooling and dependency bumps, say that no release is needed and stop. Those changes already reached users through `main`; a release would tell them nothing.
- Choose the version by the policy in AGENTS.md. If the user named one the policy contradicts (a patch number for a changed default, say), point that out before going on.
- Write the notes as described under [Notes](#notes).

Then open the PR. Start from a clean working tree (`git status --short`); if it isn't clean, stop and say so rather than carry unrelated changes into the release commit.

```sh
git switch -c chore/release-vX.Y.Z origin/main
# set "version" in package.json to X.Y.Z and nothing else; bun.lock does not record it
bun run check
git commit -am "chore(release): vX.Y.Z"
git push -u origin chore/release-vX.Y.Z
gh pr create --title "chore(release): vX.Y.Z" --body-file <notes>
```

The PR body is the release notes and nothing else, because the next run reuses it as the Release text, and it is where the user edits the wording. Squash merges here take the commit message, not the PR body, so the notes don't end up in history. If the harness requires an attribution footer on PR descriptions, put it below the notes; it is dropped later.

Tell the user the version and why, show the notes, give the PR URL, and stop. Merging is their approval.

## Tag

Tag the commit the release PR was squashed into, not whatever `main` points at now; another PR may have been merged since.

```sh
gh pr list --state merged --head chore/release-vX.Y.Z --json number,mergeCommit,url
git show <sha>:package.json | grep '"version"'               # must declare X.Y.Z
gh run list --commit <sha> --json name,status,conclusion     # CI on main for that commit
git tag -a vX.Y.Z -m "hunk-triage vX.Y.Z" <sha>
git push origin vX.Y.Z
```

- If CI for the commit is red or still running, stop and report. The tag is the one step here that can't be taken back: `@vX.Y.Z` installs clone it, so a pushed tag is never moved or deleted, and a mistake is fixed by the next patch release.
- Go straight on to the draft.

## Draft the Release

```sh
git describe --tags --abbrev=0 --match 'v*' vX.Y.Z^          # PREV: the release tag before this one
gh pr view <number> --json body --jq .body > <notes>         # the notes as the user left them
gh release create vX.Y.Z --verify-tag --draft --title vX.Y.Z \
  --generate-notes --notes-start-tag PREV --notes-file <notes>
```

- Remove anything that isn't release notes, such as an attribution footer, from the file first. Keep it outside the repository.
- The notes land above the generated PR list, which `.github/release.yml` groups into Changes and Dependencies. `--notes-start-tag` is explicit so the list doesn't depend on which earlier Release GitHub considers the previous one.
- Keep it a draft. Give the user the URL; they read it on GitHub and publish it, or ask you to (`gh release edit vX.Y.Z --draft=false`).

## Notes

```markdown
One or two sentences on what this release is about.

## Highlights

- A user-visible change, in the user's terms.

## Requirements

- hunk 0.22.0 or later (extension API 25).
```

- Write for someone deciding whether to run `hunk extension update`: what will behave differently, and what they have to change. PR titles describe the code, and the generated list below the notes already carries them, so don't paraphrase them.
- Say so explicitly when what is sent to the API changes: patch size, paths, context, endpoint, default model. README's "Data and cache" section is a promise to users, and this is the one kind of change they must not discover by accident.
- Requirements always gives the minimum hunk version and extension API from README's Requirements. When either was raised, say so and name the tag to pin for users who can't upgrade hunk (`hunk extension install morinokami/hunk-triage@PREV`).
- A changed default, a renamed setting or a removed behavior gets an `## Upgrading` section that says what to do.
- A few bullets, in English, in README's tone: plain statements, no marketing. `gh release view v0.1.0` shows the shape.
