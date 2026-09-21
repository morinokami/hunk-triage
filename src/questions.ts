// Evaluated v3 wording. Re-evaluate before changing.
export const QUESTIONS_VERSION = "v3";

export const ROLE_CRITERIA = {
  source:
    "Application or library code that ships, including type definitions, runtime settings and data, and database migrations",
  test: "Automated tests or test helpers",
  fixture: "Test fixtures, snapshots or test data",
  docs: "Documentation, README, docs site pages, changelog or release notes",
  config:
    "Build, CI, lint, tooling or package manifest configuration, not settings the application reads at runtime",
  generated: "Lockfiles, generated code or vendored third-party code",
  other: "None of the above",
} as const;
export type Role = keyof typeof ROLE_CRITERIA;

const CORE_CRITERIA = {
  true: "The file contains the main logic or behavior change; a reviewer must read it to understand what the change does",
  false:
    "The file only supports, adapts to, tests, documents or configures the main change, or is incidental cleanup",
};

/** Questions about one file; `ref` is the state path of that file (`file` or `files[3]`). */
export function questions(hasContext: boolean, ref = "file") {
  const patch = `\`${ref}.patch\``;
  return {
    role: {
      type: "choice",
      instructions: `What kind of file is \`${ref}.path\`, judging from its path and ${patch}?`,
      criteria: ROLE_CRITERIA,
    },

    mechanical: {
      type: "noul",
      instructions: `Is the change in ${patch} mechanical, so that a reviewer can verify it at a glance without reasoning about new behavior?`,
      criteria: {
        true: "Renames of local identifiers, equivalent moved code, import path updates, call sites updated only to follow a rename or signature change made elsewhere, formatting, lint autofixes, typo or comment edits, the package's own release version bump, regenerated code or lockfiles, redundant type annotations that preserve the public type contract, or tests, fixtures and docs updated only to match a value or name changed elsewhere",
        false:
          "Adds or changes logic, behavior, defaults or settings, upgrades a dependency, changes a public API or public type contract, adds new test cases or assertions or new test fixtures, or adds or rewrites documentation content",
      },
    },

    core: {
      type: "noul",
      criteria: CORE_CRITERIA,
      instructions: hasContext
        ? `Does ${patch} implement the primary change that \`pull_request\` describes?`
        : `Does ${patch} implement the primary change of the changeset listed in \`changed_files\`?`,
    },

    attention: {
      type: "score",
      instructions: `How much careful reviewer attention does ${patch} deserve?`,
      criteria: [
        "Skip: generated files, lockfiles or trivial churn nobody needs to read",
        "Skim: a quick glance is enough, such as small doc wording, changelog entries or simple mechanical edits",
        "Read: normal careful reading, such as tests, supporting code, or meaningful config or doc changes",
        "Scrutinize: core logic or risky behavior changes where bugs are likely to hide",
      ],
    },
  };
}
