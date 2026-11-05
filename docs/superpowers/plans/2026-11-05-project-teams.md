# Project teams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Org teams linked to projects with synced membership + project-internal teams for board/report filtering.
**Spec:** `docs/superpowers/specs/2026-11-05-project-teams-design.md` (read whole).
**Branch:** `feat/project-teams` in `/Users/inrnee/tirapro-wt/teams`, off prod `ad9f233b`.

## Global Constraints
- Prod Postgres 16 — verify migrations on PG16 + PG18 with a prod snapshot (controller can provide a fresh dump).
- Sync must never remove a DIRECT role; idempotent; concurrency-safe (transactions).
- Gates: root lint exit 0 (≤91), typecheck, test, format:check, knip, impeccable on touched web dirs, no-workspace guard.
- Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`.

## Review Focus
1. Removing a team member keeps their direct roles and roles from other teams.
2. Permission: only project:admin (or org admin) links teams; can't link to a project they can't admin.
3. Sub-team members must be project members; removing someone from the project removes them from its sub-teams.
4. JQL `team` field scoped per project; unknown team → validation error like other fields.

---
### Task 1: API — team↔project link with role sources + sync
### Task 2: API — project sub-teams + JQL `team` + board/report filters
### Task 3: Web — project config Team tabs, member source display, board quick filter/swimlane, report by team
### Task 4: Final review + deploy
