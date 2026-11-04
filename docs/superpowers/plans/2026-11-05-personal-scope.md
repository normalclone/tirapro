# Personal scope (cross-workspace overview + personal filters) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user who belongs to several workspaces gets a personal overview (`/me`) and personal saved filters / cross-workspace JQL that span every project they can see, without switching workspace.

**Architecture:**
- New `/me/*` API endpoints that are **not** workspace-scoped. They enumerate the user's active workspace memberships and call the existing `SearchService.search(workspaceId, userId, …)` per workspace, so RBAC/private-project rules apply unchanged. Results are merged with a composite cursor.
- `SavedFilter` gets `scope` (`WORKSPACE` | `PERSONAL`); PERSONAL rows have `workspaceId = null`.
- Web: a new route `/me` and a scope toggle plus a "Cá nhân" group on the Filters page. Opening an issue from another workspace switches workspace first.

**Tech Stack:** NestJS + Prisma, zod, React + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-personal-scope-design.md` (read whole).

**Branch:** `feat/personal-scope` in `/Users/inrnee/tirapro-wt/me`, off `fix/review-findings` @ 97de541a. Runs in parallel with `feat/workflow-per-type`, so keep changes inside the files listed here where possible.

## Global Constraints
- Never bypass RBAC: per workspace, reuse the same visibility logic the workspace-scoped search uses (`SearchService.buildWhere` / project-view checks). A private project the user isn't a member of must never appear.
- Workspaces counted: memberships whose workspace is not archived or deleted.
- Every result item carries `workspace: { id, name }`. The list envelope is `{success, data, pageInfo, meta}`.
- Unknown JQL value in some workspaces means those workspaces return 0 rows. If the value is unknown in **all** of them, return the same 422 error shape the workspace search returns.
- The new JQL field `workspace` (`=`, `!=`, `in`, `not in`, by name, case-insensitive) is valid only in personal scope. In workspace scope it returns 422 `FIELD_NOT_ALLOWED_IN_SCOPE`.
- Page limit is 200, and the cursor is opaque base64 JSON `{ wsCursors: Record<wsId, string|null> }`.
- Vietnamese UI copy. Error codes are `SCREAMING_SNAKE`. Gates: `pnpm lint` 0 errors, typecheck, tests, `format:check`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`. Add paths explicitly, and never use `git commit -a`.

## Review Focus
1. A user in workspace A only must get exactly the same results from `/me/search` as from the workspace search in A.
2. A private project in workspace B where the user isn't a member must never leak, and neither may an archived workspace.
3. Sorting and pagination across workspaces: there are no duplicates or gaps when paging through 3 pages, and the order is stable by `(sortKey, id)`.
4. A PERSONAL saved filter must not be visible to other users, or listed under any workspace's filters.
5. Clicking a foreign-workspace issue must switch workspace and open the issue. Pressing Back must not leave the app in a half-switched state.

---

### Task 1: API — `/me/search` (cross-workspace JQL) + `workspace` field
- **Files:**
  - Create `apps/api/src/modules/me/me.module.ts`, `me.controller.ts` (`@Controller('me')`), `me-search.service.ts` (+ spec).
  - Modify the JQL grammar and compiler for the `workspace` field (`packages/shared` JQL + `apps/api/src/modules/search/jql-compiler.ts`). Pass `scope: 'workspace' | 'personal'` into compile.
- **Produces:**
  - `GET /me/search?jql=&cursor=&limit=`, which returns `PageResult<IssueDto & { workspace: {id,name} }>`.
  - `MeSearchService.myWorkspaces(userId): Promise<{id,name}[]>`.
- **Tests:**
  - A single workspace gives identical ids to the workspace search.
  - A private-project leak test.
  - `workspace = "X"` narrows results.
  - An unknown value in one workspace → 0 rows there; an unknown value everywhere → 422.
  - Pagination over 3 pages with no dupes or gaps.
  - Archived workspaces are excluded.

### Task 2: API — `/me/overview`
- **Produces:** `GET /me/overview` returning:
  ```
  {
    counts: {open, overdue, dueSoon, donePointsThisWeek},
    myIssues: Item[] (open, assignee = me, sorted dueDate asc nulls last, then priority rank desc; max 50),
    bugs: { awaitingRetest: Item[], reopened: Item[], assignedToMe: Item[] },
    weeklyDonePoints: { weekStart: string, byProject: {projectKey, workspaceName, points}[] }[] (8 weeks, leaf-only via LEAF_POINTS_ONLY)
  }
  ```
- **Status matching:** awaitingRetest uses status name `Ready for Retest`, OR an IN_PROGRESS-category status whose name contains "test" (case/diacritic-insensitive). Reopened uses name `Reopened` / "Mở lại". Both count bugs **reported by me** (`reporterId` or `creatorId` = me).
- **Tests:** counts across 2 workspaces; leaf-only points; retest heuristics; RBAC.

### Task 3: API — personal saved filters
- **Files:** `schema.prisma` + migration: `SavedFilter.scope FilterScope @default(WORKSPACE)`, `workspaceId String?`; `saved-filters.service.ts/controller.ts`; and `me.controller.ts` with `GET/POST/PATCH/DELETE /me/filters` and `GET /me/filters/:id/run`.
- **Behaviour:**
  - A PERSONAL filter is owner-only: visibility is forced to PRIVATE, there is no project sharing, and it is never returned by workspace `/filters`.
  - Existing rows stay WORKSPACE.
  - Running a filter delegates to `/me/search`.
- **Tests:** owner isolation; workspace list excludes personal filters; run works; migration keeps existing rows.

### Task 4: Web — `/me` personal overview page
- **Files:** create `apps/web/src/features/me/{api.ts, MeOverviewPage.tsx, openForeignIssue.ts}` (+ tests); add the route `/me` in `app/router.tsx`; add the sidebar item "Của tôi" (icon `UserRound`, above "Tổng quan").
- **UI:**
  - Stat tiles.
  - The "Việc của tôi" list, with workspace/project chip, `StatusPill alwaysShowName`, points, due date (date-only `formatCalendarDmy`) and quick filter chips per workspace.
  - The "Bug liên quan đến tôi" tabs.
  - A weekly stacked bar chart, using the repo's existing chart lib and pattern (grep `features/reports` for the chart component in use).
  - Empty states.
  - Follows DESIGN.md.
- **`openForeignIssue(issue)`:** if `issue.workspace.id !== current`, call the existing switch-workspace action, then navigate to `/issue/:key`; otherwise navigate directly.
- **Tests:** renders items from 2 workspaces with chips; clicking a foreign item calls switch then navigate; the workspace chip filter works.

### Task 5: Web — Filters page: scope toggle + "Cá nhân" filters
- **Files:**
  - `features/saved-filters/FiltersPage.tsx`, `api.ts`.
  - `ResultsTable.tsx`: add `workspace` and `project` columns, shown by default in personal scope.
  - `resultColumns.ts`.
  - The save dialog: a radio "Cá nhân (mọi workspace)" / "Workspace này".
- **UI:**
  - The left rail has two groups, "Của workspace này" and "Cá nhân".
  - The JQL bar has a segmented toggle "Workspace này / Mọi workspace của tôi" (remember the last choice per user in localStorage, wrapped in try/catch).
  - The bulk dock is disabled with the note "Chọn việc cùng một workspace để sửa hàng loạt" when the selection spans more than one workspace.
  - Clicking a row uses `openForeignIssue`.
- **Tests:** the toggle calls `/me/search`; saving as personal posts to `/me/filters`; mixed-workspace selection disables bulk; a single-workspace selection keeps bulk working.

### Task 6: Final review + merge + deploy
- Run the whole-branch review.
- Rebase onto `fix/review-findings` if `feat/workflow-per-type` merged first; resolve conflicts in saved-filters/JQL.
- Deploy with `deploy.sh` (it takes a backup).
- Verify by logging in as a user in 2 workspaces (phucnv: KTA + Opendata) and checking that `/me` shows TIRA + KYHOP items together. Send a screenshot to Telegram.
