# Cursor-style Chat Timeline and Composer

- Date: 2026-09-01
- Status: approved for phase 2 implementation
- Scope: main chat timeline, compact title bar, composer density/typography

## Goal

Phase 2 restyles the main Agent pane toward Cursor Agents. Protocol, event model, send/steer/interrupt, and workspace dock stay unchanged.

Visual language follows Cursor. Data still follows gateway App Server.

Visual thesis: a calm conversation column with unboxed assistant markdown, muted user pills, a thin title bar, and a compact bordered composer docked at the bottom.

## Out of scope

- Workspace dock / Files / Changes / Terminal / Browser restyle (phase 3).
- Cursor repository grouping, cloud agents, or worktrees.
- Composer controller, CodeMirror mention logic, virtualizer, or RPC changes.
- Fake empty-state data.

## UX

Composer:

- Compact rounded input (`rounded-xl`), hairline border, no gradient wash or large drop shadow.
- Auto-growing editor with a one-to-two line rest height.
- Bottom row stays Plus / approval / usage / model / send.
- Send control is a small rounded square, not a large circular FAB.
- New-thread placeholder is distinct from follow-up placeholder.
- Existing testids stay: `composer-input`, `composer-editor`, `send-turn-button`.

Timeline:

- Centered conversation column aligned with the composer (`max-w-3xl`).
- Denser vertical rhythm.
- User messages: small muted pills, not large cards.
- Assistant messages: unboxed markdown.
- Intermediate-steps toggle stays, with quieter chrome.

Title bar:

- Desktop only: compact header showing the real thread title from App Server / gateway thread.
- Mobile keeps the existing workspace header title; do not duplicate it.
- Do not invent a Cursor agent name that is not backed by the thread.

Empty / new-thread:

- Selected project with no open thread: keep `project-thread-list` and row testids.
- Drop the marketing-card empty copy; denser project header and rows.
- No-project state: muted text, not a rounded card.

## Hard boundary

Archive still archives. Delete still hard-deletes including subagent descendants. Send still sends. Interrupt still interrupts.
