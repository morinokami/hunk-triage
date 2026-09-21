import type { ScrollBoxRenderable } from "@opentui/core";
import type { ExtensionPaneProps } from "hunkdiff/extension";

import { useEffect, useRef } from "react";

import type { PaneState } from "./types.ts";

import { countGroups, groupOf } from "./classify.ts";

// The directory line is the first thing dropped when the pane gets narrow.
const DIRECTORY_MIN_WIDTH = 24;

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

  const classified = state.mode === "classified";
  const rows = files.map((file) => ({ file, group: groupOf(state.groups, file.id) }));
  const counts = countGroups(rows.map((row) => row.group));

  return (
    <scrollbox ref={scroll} width={width} height={height} scrollX={false}>
      {state.mode !== "classified" && state.mode !== "empty" && (
        <text fg={theme.muted} flexShrink={0}>
          {state.mode === "no-targets"
            ? "Not classified · original order"
            : "Jev unavailable · original order"}
        </text>
      )}

      {rows.map(({ file, group }, index) => {
        // Files arrive in review order, so a group heading belongs on the first file of each run.
        const heading = classified && group !== rows[index - 1]?.group;

        const { directory, basename } = splitPath(file.path);
        const selected = file.id === selectedFileId;
        const dimmed = classified && (group === "mechanical" || group === "generated");

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
