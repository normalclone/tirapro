# Workflow per issue type (workspace scheme) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Each workspace maps issue type → workflow, and every project in that workspace follows the mapping.
- Workspace Admin may give a project its own override per type.
- The default set is Standard / Bug / Epic (English names, with Pending and Cancelled).
- Existing issues are migrated with a reviewed status mapping.

**Architecture:**
- Two new tables: `WorkspaceWorkflowScheme` (workspace × issueType → workflow) and `ProjectWorkflowOverride` (project × issueType → workflow).
- A single resolver, `WorkflowResolver.forIssue(projectId, typeId)`, replaces every read of `Project.defaultWorkflowId`. The resolver checks override, then scheme, then falls back to `defaultWorkflowId`.
- Workspace workflows are `Workflow` rows with `projectId = null`, `isTemplate = false`.
- A one-off idempotent script creates the default workflows and schemes and migrates issue statuses, board columns and automation rules. It has a dry-run that prints counts.

**Tech Stack:** NestJS + Prisma + Postgres, zod (packages/shared), React + TanStack Query + reactflow, vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-workflow-per-issue-type-design.md`. Read it whole. The user approved it on 2026-11-04 by choosing "Làm ngay tính năng theo loại việc".

**Base:** start from the merged result of `feat/points-due-status`, after it is reviewed and deployed. Use branch `feat/workflow-per-type`.

## Global Constraints
- Standard Workflow:
  - Statuses: To Do (TODO, initial), Ready (TODO), In Progress, In Review, Rework, Pending (IN_PROGRESS), Done, Cancelled (DONE).
  - Applies to TASK, STORY, SUBTASK and custom types.
- Bug Workflow:
  - Statuses: New (TODO, initial), To Do (TODO), In Progress, Ready for Retest, Reopened, Pending (IN_PROGRESS), Done, Closed, Cancelled (DONE).
  - Applies to BUG.
- Epic Workflow:
  - Statuses: Not Started (TODO, initial), In Progress, Awaiting Acceptance, Pending (IN_PROGRESS), Done, Cancelled (DONE).
  - Applies to EPIC.
- Transitions are exactly as in the spec table, plus: any open status → Pending; Pending → any open status; any open status → Cancelled.
- When leaving Pending, the UI suggests the status the issue had before Pending (taken from status history).
- Permissions:
  - Workspace scheme and workspace workflows: `workspace:admin` or `isSystemAdmin`.
  - Project override: the same (Workspace Admin), not Project Admin.
- Migration:
  - The status mapping comes from the spec table for the "Phát triển phần mềm" workflow. Other workflows map by same name, otherwise by category (TODO → initial, IN_PROGRESS → In Progress, DONE → Done).
  - The script prints the full mapping and per-project counts in `--dry-run`, and must be run with `--dry-run` first on production. The controller shows that output to the user before the real run.
  - The script is idempotent and does not bump `updatedAt`. It writes one `IssueHistory` STATUS row per moved issue, with the actor = system.
- The user's own workspace workflow named "Bug" (TECA – Opendata) must be selectable in the scheme. The default scheme for BUG uses the generated "Bug Workflow"; do not overwrite or rename the user's "Bug".
- Error codes:
  - `STATUS_MAPPING_REQUIRED` (422): type change across workflows without a target status.
  - `WORKFLOW_IN_USE` (409).
  - `STATUS_HAS_ISSUES` (409): deleting a status without a replacement.
- Gates: `pnpm lint` 0 errors, `pnpm -r typecheck`, `pnpm test`, and `format:check`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`.

## Review Focus
1. **Type change between workflows** (Task → Bug, Bug → Epic), in the detail page, bulk edit and import. The status always lands in the target workflow, and is never left pointing at another workflow's status.
2. **Board column holding statuses from several workflows.** Dragging a Bug into a column is allowed only when the Bug workflow has a valid transition into one of that column's statuses. The card shows the target status chosen.
3. **Automation rules / SLA / WIP / blocked-by-done rule** referencing old status ids keep working after migration. A rule that can't be mapped is disabled and its owner notified, not silently broken.
4. **JQL `status = "In Progress"`** matches across all three workflows. `statusCategory` is unchanged. Saved filters with old status names are still valid, or a warning is shown.
5. **Re-running the migration script** changes 0 rows, and a project with an override keeps its own workflow.

---

### Task 1: Shared definitions + types
- **Files:** create `packages/shared/src/workflow-defaults.ts` (+ spec); export from index; add DTO types in `packages/types`.
- **Produces:**
  - `DEFAULT_WORKFLOWS: Record<'STANDARD'|'BUG'|'EPIC', { name: string; statuses: {name, category, isInitial}[]; transitions: {name, from: string|null|'*OPEN', to}[] }>` with the exact names above.
  - `DEFAULT_SCHEME: Record<IssueTypeKey|'CUSTOM', 'STANDARD'|'BUG'|'EPIC'>`.
  - `LEGACY_STATUS_MAP: Record<string /*old name*/, Record<'STANDARD'|'BUG'|'EPIC', string>>`, which is the spec table.
  - `mapStatusByCategory(category, target)`.
  - Zod schemas: `setWorkspaceSchemeSchema = { items: {issueTypeId, workflowId}[] }` and `setProjectOverrideSchema = { issueTypeId, workflowId | null, statusMap: Record<oldStatusId, newStatusId> }`.
- **Tests:** every transition endpoint exists in the statuses; each workflow has exactly one initial status; LEGACY_STATUS_MAP covers all 9 old names for all 3 targets; the targets exist in the definitions.

### Task 2: Prisma schema + resolver
- **Files:** `schema.prisma` + migration `2026110510xxxx_workflow_schemes`; create `apps/api/src/modules/workflow-admin/workflow-resolver.service.ts` (+ spec).
- **Produces:**
  - `model WorkspaceWorkflowScheme { id, workspaceId, issueTypeId, workflowId, @@unique([workspaceId, issueTypeId]) }`.
  - `model ProjectWorkflowOverride { id, projectId, issueTypeId, workflowId, @@unique([projectId, issueTypeId]) }`.
  - Both use FKs with `onDelete: Restrict` on the workflow.
  - `WorkflowResolver.forIssue(tx, projectId, typeId): Promise<{workflowId}>`, checking override, then scheme, then `project.defaultWorkflowId`. The result is cached per request.
  - `forProject(tx, projectId): Promise<Map<typeId, workflowId>>`.
- **Tests:** the precedence order; the fallback when there is no scheme; that a cached result is reused within one request.

### Task 3: API — every workflow read goes through the resolver
- **Files** (the 33 `defaultWorkflowId` references):
  - `issues.service.ts`: initial status on create, transition validation ~L2702, move/rank, bulk transition.
  - `boards.service.ts`.
  - `import/jira`, `import/excel`.
  - `workflow-admin.service.ts` ~L521.
  - `sla`, `automation` transition actions.
  - Grep `defaultWorkflowId` and `workflowTransition` across `apps/api/src`.
- **Behaviour:**
  - Create uses the initial status of the issue type's workflow.
  - Transitions are validated against that workflow.
  - A type change whose target uses a different workflow requires `targetStatusId`, which must belong to the target workflow. Without it the API returns 422 `STATUS_MAPPING_REQUIRED`, with a `suggestedStatusId` (same name, otherwise the first status of the same category) in the error body. Bulk type change takes a `statusMap`.
  - `GET /issues/:id/transitions` returns transitions from the issue's own workflow. When the current status is Pending, it adds `suggestedResumeStatusId` (the last non-Pending status from history).
- **Tests:** create a Bug → New; create a Task → To Do; a Task transition invalid under the Bug workflow → 422; type change with/without target; bulk; import; and the Pending resume suggestion.

### Task 4: API — scheme and override admin endpoints
- **Endpoints**, all `workspace:admin` or SA:
  - `GET/PUT /workflow-schemes` for the workspace scheme (only workflows of this workspace that are non-template and `projectId = null`).
  - `GET/PUT/DELETE /projects/:id/workflow-overrides`. PUT copies the chosen workspace workflow into a project-owned copy when `copy=true`, or uses it directly. It takes a `statusMap` for the existing issues of that type, moves them in one transaction, bumps `version`, and writes STATUS history.
  - Changing the workspace scheme for a type moves the issues of that type in every project without an override, again with a `statusMap`. The endpoint returns a preview when `?dryRun=1` (counts per project/status).
  - Deleting a status needs `replacementStatusId` when issues use it (409 `STATUS_HAS_ISSUES` otherwise).
  - Deleting a workflow used by any scheme or override returns 409 `WORKFLOW_IN_USE`.
- `GET /workflows` returns `usedBy: { scheme: typeKeys[], overrides: {projectKey, typeKey}[], projects: [...] }` so the list can show "Dùng cho: Bug (cả workspace)".
- **Tests:** permission 403s; dryRun counts; a real move with history; idempotent PUT; the in-use guards.

### Task 5: Migration script + deploy step
- **Files:** create `apps/api/scripts/migrate-workflow-schemes.mjs`; add one line to `/Users/inrnee/tirapro-data/vm128/deploy.sh` that is guarded by file existence and runs **only with `--dry-run`** inside deploy. The controller runs the real migration manually after the user sees the dry-run.
- **Algorithm, per workspace:**
  1. Ensure the 3 default workflows exist (by exact name; create from `DEFAULT_WORKFLOWS` if missing). Never touch other workflows.
  2. Ensure scheme rows for every issue type (`DEFAULT_SCHEME`). Existing rows win, so the script is re-runnable after admins change them.
  3. For each live issue whose status does not belong to its resolved workflow, map via `LEGACY_STATUS_MAP` (by old status name), otherwise by name, otherwise by category. Use raw SQL that leaves `updatedAt` alone, bumps `version`, and inserts IssueHistory STATUS rows.
  4. Boards: for each column, add the mapped new statuses next to the old ones, so columns keep their cards.
  5. Automation rules: rewrite status ids by the same map; rules that can't be mapped get `enabled=false`, and the owner gets a notification "Quy tắc … đã tắt vì trạng thái không còn".
  6. SLA policies and WIP: rewrite ids by the map.
  7. Old project workflows are kept as-is (not deleted) and stay as `defaultWorkflowId` fallback.
- **Output:** a table of workspace/project/type/oldStatus→newStatus/count, plus totals. `--dry-run` writes nothing.
- **Tests:** a throwaway Postgres 18 (same recipe as before: initdb `--locale=C`, port 5499, `-k ''`, TCP). Seed a project with the 9-status workflow and issues of each type in every status, plus a board, a rule and an SLA. Dry-run shows the right counts. The real run moves everything correctly. A second run changes 0 rows. Each `updatedAt` is unchanged.

### Task 6: Web — Quy trình settings: scheme table + workflow dialogs
- **Files:** `features/workflow-settings/*` (builds on Task 14 of the previous plan, so workflows open in a dialog).
- **UI:**
  - At the top, a section "Quy trình theo loại việc" with one row per issue type: type icon + name → a select of workspace workflows. Saving runs a dry-run preview ("Sẽ chuyển 12 Bug ở KYHOP: Chờ test → Ready for Retest …") and asks for confirmation.
  - The workflow list shows "Dùng cho: …" from `usedBy`.
  - Project overrides are listed under the scheme, with a "Quay về dùng chung" action.
- **Project level, a new project config section "Quy trình"** (`/p/:key/config/workflow`):
  - Today this URL falls back to "Chung" because no such section exists. Add it to `features/project-config/configSections.ts` and `ProjectConfigPage.tsx`.
  - The section is a table with one row per issue type. Columns: "Đang dùng" (workflow name + a badge "Theo workspace" or "Riêng của dự án"), and a select. The select offers "Theo workspace (<name>)", every workspace workflow, and "Tạo bản riêng từ …", which copies the workflow into the project and opens the workflow dialog to edit it.
  - Saving runs the same dry-run preview (counts per status move) with confirm.
  - Each row has a "Xem sơ đồ" link that opens the workflow dialog read-only.
  - Editable by Project Admin, Workspace Admin and SA. Everyone else sees it read-only.
  - Tests: route `/p/THCHUNG/config/workflow` renders the section; Project Admin can change it; a Developer sees it read-only; choosing "Theo workspace" sends DELETE override.
- **Tests:** a select change, then the preview, then confirm sends PUT; non-admins see read-only.

### Task 7: Web — issue flows per type
- **Files:**
  - `features/issues/useIssueTransitions.tsx`
  - `issues/menu/IssueMenuItems.tsx`
  - `command/IssueContextGroup.tsx`
  - `board/BoardPage.tsx` + `BoardBulkDock.tsx`
  - `backlog/BacklogPage.tsx`
  - `saved-filters/FiltersBulkDock.tsx`
  - `dashboard/MyBugsSection.tsx`
  - `automation/RuleEditor.tsx`
  - `workflow-settings/WorkflowViewDialog.tsx` (shows the issue's own workflow)
  - JQL value suggestions
- **Behaviour:**
  - Transition buttons come from the issue's workflow. Leaving Pending highlights the suggested resume status.
  - Changing the type opens a dialog "Chọn trạng thái trong quy trình mới", preselecting `suggestedStatusId`.
  - Board drag uses only valid targets for that card, with a toast when there are none.
  - Bulk transition on a mixed selection groups by workflow, and offers per-group status choices or "chỉ những việc có bước chuyển này".
  - The status filter lists are merged by name.
- **Tests:** one per surface for a Bug vs Task in the same project.

### Task 8: Final whole-branch review + deploy
- Run the final review on the most capable model.
- Deploy: `deploy.sh` (backup, migrate, dry-run printed).
- The controller shows the dry-run to the user, then runs the real migration, then verifies counts and screenshots and sends them to Telegram.
