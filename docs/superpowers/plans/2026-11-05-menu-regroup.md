# Gộp menu Danh mục — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the "Danh mục" (`/manage`) area by moving each screen next to the feature it belongs to, per the spec.
**Architecture:** Prisma migrations (Project↔Program many-to-many; required projectId for Objective/RaidItem/SlaPolicy; drop Client/Contract), API adjustments, web IA moves reusing existing pages.
**Tech Stack:** NestJS + Prisma, React + TanStack Query, vitest.
**Spec:** `docs/superpowers/specs/2026-11-04-menu-regroup-design.md` (read whole).
**Branch:** `feat/menu-regroup` in `/Users/inrnee/tirapro-wt/menu`, off prod `3803d1d8`.

## Global Constraints
- Migrations must apply on current prod data (3 programs / 8 project links; 2 objectives all with project; 0 raid; 0 SLA; 0 client/contract) and be verified on a prod snapshot before deploy.
- No "workspace"/"không gian" in UI copy (terminology test). Vietnamese copy. Error codes SCREAMING_SNAKE. List envelope unchanged.
- Gates: `pnpm lint` 0 errors, `pnpm -r typecheck`, `pnpm test`, `pnpm format:check`, impeccable detect on touched web dirs, `pnpm knip` no new unused files/deps.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`. Explicit-path commits.

## Review Focus
1. Program membership edits respect permissions (project admin of A can't change B's groups; SA/org admin can).
2. Private projects never appear in another user's group tree/popover counts.
3. Old URLs redirect without loops; Cmd+K/assistant/docs no longer point to `/manage`.
4. Migration preserves every existing project→program link.
5. Removing Client leaves no dangling imports, API routes, or JQL fields.

---
### Task 1: API + schema
- Migration: `ProjectProgram(projectId, programId)` PK composite, cascade, index programId; copy from `Project.programId`; drop `programId`. `Objective.projectId`, `RaidItem.projectId`, `SlaPolicy.projectId` → required (migration fails loudly if nulls exist; prod has none). Drop `Client`, `Contract` (if Contract is only client-related — verify), `Project.clientId`, and any enum/JQL/import field tied to them.
- API: project DTO gets `programs: {id,name,color}[]` (and list endpoint); `PUT /projects/:id/programs { programIds }` (project:admin of that project or workspace:admin); programs endpoints return `projectCount` counting only projects the caller can see; Objective/Raid/SLA create require `projectId` (422 `PROJECT_REQUIRED`); SLA evaluation only per project. Remove clients module/routes.
- Tests: migration int-spec on a seeded pre-migration DB (links preserved); permission tests for programs PUT; visibility of counts; projectId required.

### Task 2: Web — Projects page groups
- Column "Nhóm" + popover (list, add/remove with permission, create group inline if allowed), "Danh sách / Theo nhóm" toggle with tree (multi-group duplicates, "Chưa thuộc nhóm"), "Quản lý nhóm" dialog (reuse existing program editor). Tests for popover, toggle persistence, tree grouping, permissions.

### Task 3: Web — move Goals, Risks into project tabs; SLA into project config; Resources into Members
- Project tabs `goals`, `risks` (reuse pages with fixed project; hide project filter), project config section for SLA (policies + board for that project), Members page tab "Nhân lực". Update ProjectLayout tab list / "Thêm" menu, config sections list.
- Tests for each placement + create flows default to current project.

### Task 4: Web — remove /manage, Clients; redirects; nav/Cmd+K/assistant/docs/routeSuggest cleanup
- Delete ManageLayout + ClientsPage + nav item "Danh mục"; redirects per spec; update assistant screens, docs index, routeSuggest, command palette, release notes entry. Tests: redirects, nav no longer has /manage, no reference to clients.

### Task 5: Final review + merge + deploy
- Whole-branch review; verify migrations on prod snapshot; deploy with deploy.sh; screenshots to Telegram.
