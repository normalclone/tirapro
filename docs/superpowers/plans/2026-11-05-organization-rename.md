# Organization rename (bỏ khái niệm workspace trong code) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rename the tenant concept Workspace → Organization everywhere in code/DB/API/tokens/realtime/permissions/docs with zero behaviour change.
**Architecture:** One Prisma migration of pure renames (tables, columns, enum values, indexes, constraints, permission keys, system role names) + mechanical code rename across packages, API, web, scripts, docs; JWT accepts the old claim during transition.
**Tech Stack:** Prisma/Postgres, NestJS, React, vitest.
**Spec:** `docs/superpowers/specs/2026-11-05-organization-rename-design.md` (read whole).
**Branch:** `feat/organization-rename` in `/Users/inrnee/tirapro-wt/org`, off prod `8e6d4fa8`.

## Global Constraints
- Zero behaviour change; UI copy already says "tổ chức" (terminology test bans "không gian").
- Migration = renames only (no data copy), single transaction, verified on a restored prod snapshot (`/Users/inrnee/tirapro-data/vm128/backups/` newest `*-snapshot.dump`, or take a fresh one via the controller); row counts identical before/after; `prisma migrate diff` clean (except known db:raw columns).
- Seed-system-roles must not create duplicate roles after the rename.
- Old access tokens (claim `workspaceId`) keep working until expiry.
- Gates: root `pnpm lint` exit 0 (≤91 warnings), `pnpm -r typecheck`, `pnpm test`, `pnpm format:check`, `pnpm knip` no new, int specs on throwaway PG.
- Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`. Explicit-path commits.

## Review Focus
1. No data loss: every table/column/enum renamed, counts unchanged, FKs/indexes intact.
2. RBAC: renamed permission keys resolve; no user loses or gains a permission; Redis cache cleared.
3. Auth: old tokens accepted, new tokens carry `organizationId`; switch endpoint works; refresh works.
4. Realtime rooms join/emit consistently (`org:{id}`).
5. A leftover `workspace` anywhere in src (guard test) except a reasoned allowlist.

---
### Task 1: DB + packages + API rename
- Prisma schema + migration (renames incl. `WorkspaceWorkflowScheme`, enum values, permission rows `workspace:*`→`organization:*`, system role names), `prisma/sql/01_pgvector_fts.sql`, seeds (seed-system-roles: rename-before-upsert), `pnpm gen:enums`.
- `packages/types`, `packages/shared`: rename DTOs, permission catalog, event names, WS contracts, error codes.
- `apps/api`: modules/files/classes/decorators/routes (`/organizations`, `/auth/organizations`, `/auth/switch-organization`, `/admin/organizations`), JWT claim (accept old), rooms `org:{id}`, Redis key prefixes, scripts in `apps/api/scripts`.
- Tests: migration int-spec on prod snapshot (counts, no duplicate roles after seed), auth old-token test, RBAC permission parity test (effective permissions per user identical before/after on snapshot).

### Task 2: Web rename
- `features/workspace`→`features/organization`, store `organizationId`, query keys, API paths, routes (`/admin/organizations` + redirect from `/admin/workspaces`), tests. Copy unchanged.

### Task 3: Docs, CLAUDE.md, guard test
- Update CLAUDE.md "Quy ước chốt", MASTER_PLAN, DEPLOY, ARCHITECTURE_SCALE, api-contract, FEATURES_BY_ACTOR, release notes entry. Add a guard test that fails on `workspace` (case-insensitive) in `apps/*/src`, `packages/*/src` outside an allowlist with reasons.

### Task 4: Final review + deploy
- Whole-branch review; snapshot dry-run; deploy with backup; clear `rbac:*`; verify login (old session continues), switch, realtime, screenshots to Telegram.
