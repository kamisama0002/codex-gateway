# DSH-style Gateway Visual Language

- Date: 2026-09-01
- Status: approved direction
- Visual source: DeepSeek Harness client (`D:\workspace\agent\deepseek-harness\packages\client`)
- Protocol source: Codex App Server via gateway

## Lock

Look and interact like DSH. Remain a gateway product: SSH Host → Project → Thread, real App Server, multi-browser sync. Do not copy DSH branding (whale, Cordis, DeepSeek marks) or DSH's local workspace runtime.

Gateway-only surfaces (hosts, remote files, git, tmux, host metrics) use the same row height, radius, hover, selection, and menus.

## Archive filter (gateway extra)

DSH's view-options menu is grouping + sorting only. It has no archive toggle.

Gateway adds a third section on that same menu:

- 分组方式: 按工作区 (current Host → Project tree)
- 排序方式: 最近更新 (current recency sort)
- 筛选: 已归档

Turning **已归档** on loads `GET /api/threads?archived=true` for the selected host and shows **only archived threads** under each project. Active threads are hidden. Empty projects show `暂无会话`. Turning it off restores the active tree.

Archive / unarchive / delete stay App Server RPCs. Do not nest 已归档 as a folder.

## Out of scope for the first slice

- DSH 单列表 / 手动排序 (no flat list or drag reorder yet)
- Whale, Cordis, plugin marketplace
- Fake `thread/queue` until App Server queue is wired
