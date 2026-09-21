import type { Changeset, DiffFile, Group, Verdict } from "./types.ts";

import { GROUPS } from "./types.ts";

export function eligible(file: DiffFile): boolean {
  return !file.isBinary && !file.isTooLarge && file.patch.length > 0;
}

export function groupFor(verdict: Verdict | undefined, threshold: number): Group {
  if (!verdict) return "unclassified";
  if (verdict.role === "generated") return "generated";
  if (verdict.mechanical >= 0.5) return "mechanical";

  switch (verdict.role) {
    case "test":
      return "tests";
    case "fixture":
      return "fixtures";
    case "docs":
      return "docs";
    case "config":
      return "config";
    default:
      return verdict.core >= threshold ? "core" : "supporting";
  }
}

/** A file without an entry is unclassified, as every file is while a review has no groups. */
export function groupOf(groups: ReadonlyMap<string, Group>, fileId: string): Group {
  return groups.get(fileId) ?? "unclassified";
}

export function countGroups(groups: Iterable<Group>): Map<Group, number> {
  const counts = new Map<Group, number>();

  for (const group of groups) {
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  return counts;
}

export function countsLabel(groups: ReadonlyMap<string, Group>): string {
  const counts = countGroups(groups.values());

  return GROUPS.filter((group) => counts.has(group))
    .map((group) => `${group} ${counts.get(group)}`)
    .join(" · ");
}

interface Row {
  file: DiffFile;
  index: number;
  verdict: Verdict | undefined;
  group: Group;
}

/** Groups lead; inside a group the dominant score wins, and ties keep the original order. */
function byReviewOrder(a: Row, b: Row): number {
  const byGroup = GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group);
  if (byGroup) return byGroup;

  // Source files lead with how central they are; every other group leads with attention.
  const centralFirst = a.group === "core" || a.group === "supporting";
  const first = centralFirst ? "core" : "attention";
  const second = centralFirst ? "attention" : "core";

  return (
    (b.verdict?.[first] ?? 0) - (a.verdict?.[first] ?? 0) ||
    (b.verdict?.[second] ?? 0) - (a.verdict?.[second] ?? 0) ||
    a.index - b.index
  );
}

function scoreLabel(verdict: Verdict | undefined, group: Group): string {
  if (!verdict) return "unclassified · not classified";

  const core = verdict.core.toFixed(2);
  const attention = verdict.attention.toFixed(1);
  const mechanical = verdict.mechanical.toFixed(2);

  return `${group} · core ${core} · attention ${attention}/3 · mechanical ${mechanical}`;
}

export function applyVerdicts(
  changeset: Changeset,
  verdicts: ReadonlyMap<string, Verdict>,
  threshold: number,
) {
  const rows: Row[] = changeset.files.map((file, index) => {
    const verdict = verdicts.get(file.id);
    return { file, index, verdict, group: groupFor(verdict, threshold) };
  });
  rows.sort(byReviewOrder);

  const groups = new Map(rows.map((row) => [row.file.id, row.group]));

  // The scores go in beside hunk's own notes; existing annotations are carried over.
  const files = rows.map(({ file, verdict, group }) => ({
    ...file,
    agent: {
      ...file.agent,
      path: file.path,
      summary: [scoreLabel(verdict, group), file.agent?.summary].filter(Boolean).join("\n"),
      annotations: file.agent?.annotations ?? [],
    },
  }));

  const heading = `Review order by hunk-triage: ${countsLabel(groups)}`;
  const agentSummary = [heading, changeset.agentSummary].filter(Boolean).join("\n");

  return { groups, changeset: { ...changeset, agentSummary, files } };
}
