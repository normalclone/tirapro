# Assistant bulk operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Bulk assign issues and bulk add/remove project members through the Tirapro assistant, with preview card, confirm, undo.
**Spec:** `docs/superpowers/specs/2026-11-04-assistant-bulk-assign-design.md` (read whole incl. "Bổ sung 2026-11-05").
**Branch:** `feat/assistant-bulk` in `/Users/inrnee/tirapro-wt/bulk`, off prod `c81a38d2`.

## Global Constraints
- Rule-based parsing (no free-form NLU); preview card always required before any write; per-row permission checks server-side (reuse existing APIs: PATCH /issues/bulk, project members API).
- Undo restores exactly the previous state (previous assignees; removed memberships with their roles).
- Copy Vietnamese, "tổ chức"; no "workspace" (guard test).
- Gates: root lint exit 0 (≤91), typecheck, test, format:check, knip, impeccable on touched web dirs.
- Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`.

## Review Focus
1. No write without explicit confirm; rows the user lacks permission for never execute.
2. Ambiguous person names force a choice.
3. Undo after partial failure restores only what was changed.
4. Ranges/lists parse correctly (`KYHOP-SUB-11..20`, `11, 12, 15`).

---
### Task 1: Parser + intents (bulk-assign, bulk-add-member, bulk-remove-member) + resolution (people, projects, my groups, issues, JQL filters) — pure functions + tests
### Task 2: Preview cards (distribution options for assign; person×project×role table for members), confirm, execute via existing APIs, result + undo
### Task 3: Final review + deploy
