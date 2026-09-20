import type { ScrollBoxRenderable } from "@opentui/core";
import type { ExtensionPaneProps } from "hunkdiff/extension";

import { useEffect, useRef } from "react";

import type { Group, PaneState } from "./types.ts";

type PaneFile = ExtensionPaneProps["files"][number];

// The directory line is the first thing dropped when the pane gets narrow.
const DIRECTORY_MIN_WIDTH = 24;

function countByGroup(files: readonly PaneFile[], state: PaneState): Map<Group, number> {
  const counts = new Map<Group, number>();

  for (const file of files) {
    const group = state.groups.get(file.id) ?? "unclassified";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  return counts;
}

function splitPath(path: string) {
  const slash = path.lastIndexOf("/");

  return {
    directory: slash >= 0 ? path.slice(0, slash) : ".",
    basename: path.slice(slash + 1),
  };
}

export function GroupsPane({
  files,
  selectedFileId,
  width,
  height,
  theme,
  actions,
  state,
}: ExtensionPaneProps & { state: PaneState }) {
  const scroll = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    if (selectedFileId) scroll.current?.scrollChildIntoView(`triage-${selectedFileId}`);
  }, [selectedFileId, files, width, height]);

  const counts = countByGroup(files, state);

  // Files arrive in review order, so a group heading belongs on the first file of each run.
  let previous: Group | undefined;

  return (
    <scrollbox ref={scroll} width={width} height={height} scrollX={false}>
      {state.mode !== "classified" && state.mode !== "empty" && (
        <text fg={theme.muted} flexShrink={0}>
          {state.mode === "no-targets"
            ? "Not classified · original order"
            : "Jev unavailable · original order"}
        </text>
      )}

      {files.map((file) => {
        const group = state.groups.get(file.id) ?? "unclassified";
        const heading = state.mode === "classified" && group !== previous;
        previous = group;

        const { directory, basename } = splitPath(file.path);
        const selected = file.id === selectedFileId;
        const dimmed =
          state.mode === "classified" && (group === "mechanical" || group === "generated");

        return (
          <box key={file.id} flexDirection="column" flexShrink={0}>
            {heading && (
              <text fg={theme.accent} flexShrink={0}>{`${group} (${counts.get(group)})`}</text>
            )}

            <box
              id={`triage-${file.id}`}
              flexDirection="column"
              flexShrink={0}
              backgroundColor={selected ? theme.selectedHunk : undefined}
              onMouseDown={(event) => {
                if (event.button === 0) actions.selectFile(file.id);
              }}
            >
              <text
                fg={dimmed ? theme.muted : theme.text}
                wrapMode="none"
              >{`${selected ? "▌" : " "} ${basename}  +${file.stats.additions} -${file.stats.deletions}`}</text>

              {/* Indented past the file name: at an equal indent the line reads as a heading
                  for the file below it, which is what the built-in pane's directories mean. */}
              {width >= DIRECTORY_MIN_WIDTH && (
                <text fg={theme.muted} wrapMode="none">{`    ${directory}`}</text>
              )}
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
}
