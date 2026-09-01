# Cursor-style Workspace Dock

- Date: 2026-09-01
- Status: approved for phase 3 implementation
- Scope: existing workspace dock chrome plus Files / Changes / Terminal / Browser interiors

## Goal

Phase 3 restyles the gateway workspace dock toward Cursor's inspector panel. Dockview lifecycle, panel registry, and remote file / git / PTY / browser-preview protocols stay unchanged.

Visual language follows Cursor. Data still follows gateway App Server.

Visual thesis: a thin tab strip and dense explorer, not a dashboard of cards. Secondary context sits beside the Agent pane.

## Out of scope

- Cursor cloud agents, worktrees, or repository grouping.
- Replacing Host → Project → Thread.
- Host metrics and tmux monitor interior redesign.
- Settings dock.
- Fake file trees, fake diffs, or mock terminals.

## UX

Dock chrome:

- Shorter tab strip (~2rem).
- Quieter active-group outline.
- Compact maximize / float / popout actions.
- Existing testids stay: `workspace-dock-frame`, `workspace-dock-tab`, `dock-popout-group`.

Files:

- Denser explorer header, tree rows, and open-file tabs.
- Files / Changes switcher stays; change count stays.
- Keep `workspace-file-panel`, `remote-file-tree`, `file-workspace-tab`, `file-workspace-separator`.

Changes / review:

- Compact branch toolbar and change rows.
- Review panel keeps `git-review-panel` and `git-changes-tree`.

Terminal:

- Compact session title bar.
- xterm flush to the panel, less inner padding.
- Keep `terminal-panel`, `terminal-root`.

Browser:

- Compact address bar.
- Keep existing preview navigation and TLS / external-open actions.

## Hard boundary

Opening a file still opens a remote file. Git still reads the real worktree. Terminal still uses the gateway PTY. Browser still uses the gateway preview session.
