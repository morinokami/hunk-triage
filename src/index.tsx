import type { HunkExtensionAPI } from "hunkdiff/extension";

import type { PaneState } from "./types.ts";

import { readConfig } from "./config.ts";
import { GroupsPane } from "./pane.tsx";
import { notification, triage } from "./triage.ts";

export default function (hunk: HunkExtensionAPI) {
  const config = readConfig(hunk.config);

  // Transform completes before hunk publishes new files to the pane. IDs are
  // scoped to that changeset; replace the map on every load, never retain IDs.
  let state: PaneState = { mode: "empty", groups: new Map() };
  let generation = 0;

  hunk.transformChangeset(async (changeset, ctx) => {
    const current = ++generation;
    const result = await triage(changeset, ctx.cwd, config);

    // Only the newest load may speak for the pane.
    if (current === generation) {
      state = result.state;

      const toast = notification(result);
      if (toast) ctx.notify(toast.message, toast.type);
    }

    return result.changeset;
  });

  hunk.registerPane({
    id: "groups",
    title: "Files by review priority",
    placement: "left",
    replaces: "hunk:files",
    width: { preferred: 38, min: 24 },
    component: (props) => <GroupsPane {...props} state={state} />,
  });
}
