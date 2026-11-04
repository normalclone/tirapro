# Điểm tự tính · Hạn bắt buộc · Trạng thái hiển thị · Ẩn khối trống — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Story points are computed from Type × Difficulty × Priority, with a system-wide coefficient table that only the SA edits and a PM override. Every issue must have a due date (default: creation date + 1 day). Statuses are shown by name in "Việc của tôi" and in the filter results table. Empty blocks on the issue page are hidden behind a "+ Thêm mục" button.

**Architecture:**
- The pure formula lives in `@tirapro/shared` (`points.ts`) and is used by both the API and the web app.
- The API enforces the formula in the single creation path (`IssuesService.createCore`), in `update`, in `bulkUpdate`, and in an epic roll-up helper.
- The coefficient table is a one-row Prisma model, edited through the system-admin console.
- The due-date rule is enforced on the server with a `DUE_DATE_REQUIRED` error code. Existing data is backfilled by SQL migrations.
- The UI changes are local to the existing components.

**Tech Stack:** NestJS 10 + Prisma + Postgres, zod (packages/shared), React 18 + TanStack Query + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-points-due-status-design.md` (read it whole; sections 1–5 and "Quyết định của người viết").

## Global Constraints
- Branch `feat/points-due-status` in worktree `/Users/inrnee/tirapro-wt/integ`.
- After changing `packages/types` or `packages/shared`, run `pnpm --filter @tirapro/types build && pnpm --filter @tirapro/shared build`.
- After changing a Prisma enum, run `pnpm gen:enums`. Never hand-edit `packages/types/src/enums.ts`.
- Error codes are `SCREAMING_SNAKE`. UI copy is Vietnamese. Every mutation bumps `version` (OCC).
- Default coefficients, copied verbatim from the spec:
  - Base by type: SUBTASK 1, TASK 2, BUG 2, STORY 3. Custom type (key null) uses the TASK base. EPIC = sum of its children.
  - Difficulty: EASY ×1, MEDIUM ×2, HARD ×3, VERY_HARD ×5. Labels: Dễ / Trung bình / Khó / Rất khó. The default is MEDIUM.
  - Priority, keyed by system priority name: Lowest ×1, Low ×1, Medium ×1, High ×1.5, Highest ×2. Any other name, or no priority, is ×1.
  - Round half-up to an integer.
- Manual override: integer 0–100, allowed only for `project:admin` or `isSystemAdmin`. It sets `pointsManual=true`. While manual, changes to type, difficulty or priority do not recompute.
- `dueDate` is a calendar date stored as `YYYY-MM-DDT00:00:00.000Z`. "Ngày tạo + 1" is computed from the calendar day in `Asia/Ho_Chi_Minh`.
- Gates: `pnpm lint` (0 errors), `pnpm -r typecheck`, `pnpm test`.
- Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`

## Review Focus
1. An issue is created through import, automation, AI generation or clone **without** a dueDate or difficulty → it still gets due = created+1 (VN day) and difficulty MEDIUM, and its points are computed. Pin with a createWithin test (Task 3/5).
2. An issue is created at 23:30 Vietnam time (16:30 UTC) → its due date is the next **VN** calendar day, not the UTC one. Pin with a `defaultDueDate` test (Task 1).
3. A sub-task is moved to another epic, deleted, or restored → the totals of the old and new epics are both correct. Pin in Task 3.
4. A non-PM sends `storyPoints` in an update or bulk patch → 403 `POINTS_OVERRIDE_FORBIDDEN`, and nothing is written. Pin in Task 3.
5. Clearing the due date via update, bulk, or the automation "set dueDate = empty" → 422 `DUE_DATE_REQUIRED` (for automation: the action is skipped with a log warning). Pin in Task 5.

---

### Task 1: Pure formula + due-date helper in `@tirapro/shared`

**Files:**
- Create: `packages/shared/src/points.ts`, `packages/shared/src/points.test.ts`.
- Export both from `packages/shared/src/index.ts`.

**Interfaces — Produces:**
- `type Difficulty = 'EASY'|'MEDIUM'|'HARD'|'VERY_HARD'`, and `DIFFICULTIES: readonly Difficulty[]`.
- `DIFFICULTY_LABELS: Record<Difficulty,string>` (Dễ / Trung bình / Khó / Rất khó).
- `interface PointsFormula { base: Record<'SUBTASK'|'TASK'|'BUG'|'STORY', number>; difficulty: Record<Difficulty, number>; priority: Record<'Lowest'|'Low'|'Medium'|'High'|'Highest', number> }`.
- `DEFAULT_POINTS_FORMULA: PointsFormula`.
- `pointsFormulaSchema` (zod). Each value is > 0 and ≤ 100.
- `computePoints(f: PointsFormula, typeKey: string|null, difficulty: Difficulty, priorityName: string|null): number|null`. Returns `null` for EPIC.
- `explainPoints(f, typeKey, typeName, difficulty, priorityName): string`. Example: `"Bug · Khó · High = 2×3×1.5 = 9"`.
- `defaultDueDate(createdAt: Date): string`. Returns the ISO string of the VN calendar date + 1 at `T00:00:00.000Z`.

- [ ] **Step 1: Write the failing tests.**
  - `computePoints(DEFAULT,'BUG','HARD','High') === 9`.
  - `computePoints(DEFAULT,'TASK','EASY','Medium') === 2`.
  - `computePoints(DEFAULT,null,'MEDIUM',null) === 4` (custom type uses the TASK base).
  - `computePoints(DEFAULT,'EPIC','MEDIUM','High') === null`.
  - Half-up rounding: a formula with base 1, difficulty ×1, priority ×1.5 gives 2.
  - `explainPoints(...)` returns exactly `'Bug · Khó · High = 2×3×1.5 = 9'`.
  - `defaultDueDate(new Date('2026-11-04T16:30:00Z')) === '2026-11-06T00:00:00.000Z'` (it is already 2026-11-05 in VN).
  - `defaultDueDate(new Date('2026-11-04T03:00:00Z')) === '2026-11-05T00:00:00.000Z'`.
- [ ] **Step 2: Run the tests.** `pnpm --filter @tirapro/shared test points` → FAIL.
- [ ] **Step 3: Implement.** Compute the VN date as UTC+7 (fixed offset; Vietnam has no DST).
- [ ] **Step 4: Run again** → PASS. Then build types and shared.
- [ ] **Step 5: Commit.**

### Task 2: Prisma schema + migrations (difficulty, pointsManual, formula table, data backfill)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`.
- Create the migrations:
  - `apps/api/prisma/migrations/20261104100000_points_difficulty/migration.sql`
  - `apps/api/prisma/migrations/20261104100100_due_date_backfill/migration.sql`

**Interfaces — Produces:**
- `enum IssueDifficulty { EASY MEDIUM HARD VERY_HARD }`.
- `Issue.difficulty IssueDifficulty @default(MEDIUM)`.
- `Issue.pointsManual Boolean @default(false)`.
- `model PointsFormulaConfig { id String @id @default("default"); formula Json; updatedAt DateTime @updatedAt; updatedById String? }`.

- [ ] **Step 1: Points migration.** Add the enum and columns. Every existing row gets MEDIUM and `pointsManual=false` through the column defaults. Insert the default row: `INSERT INTO "PointsFormulaConfig"(id, formula, "updatedAt") VALUES ('default', '<DEFAULT_POINTS_FORMULA as JSON>', now()) ON CONFLICT DO NOTHING`. Recomputing old points is NOT done in SQL; Task 4's script does it.
- [ ] **Step 2: Due-date backfill migration (idempotent: only rows where `dueDate IS NULL`).**
  - Not done: the status category is not DONE → `dueDate = ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1)::timestamp AT TIME ZONE 'UTC'`.
  - DONE → `dueDate = (COALESCE("resolvedAt","updatedAt") AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` at 00:00 UTC.
  - The DONE row may then be earlier than `createdAt`'s date; that is accepted, because this is a historical backfill.
  - The column stays nullable, so imports of old data cannot fail at the DB level; the rule is enforced in the service.
- [ ] **Step 3: Generate and verify.** Run `pnpm gen:enums`, `npx prisma generate`, then `npx prisma migrate diff` against the schema → no drift. Build types.
- [ ] **Step 4: Verify the SQL.** Apply both migrations to a throwaway Postgres (pg18 at `/opt/homebrew/opt/postgresql@18/bin`, data dir in the scratchpad, port 5499, `--locale=C`, TCP only). Run `prisma migrate deploy`, then check the row counts in a seeded sample.
- [ ] **Step 5: Commit.**

### Task 3: API — compute points on every write path + epic roll-up + override

**Files:**
- Create: `apps/api/src/modules/issues/points.service.ts` and `points.service.spec.ts`.
- Modify:
  - `apps/api/src/modules/issues/issues.service.ts` (`createCore`, `update`, `bulkUpdate`, delete/restore, `epicId` changes, DTO mapping around L2150)
  - `packages/shared/src/schemas/issue.ts` (add `difficulty` to create/update/bulk patch)
  - `packages/types` IssueDto (`difficulty`, `pointsManual`, `pointsExplain`)
  - `apps/api/src/modules/issues/issues.module.ts`
  - `apps/api/src/modules/issues/issues.controller.ts` (new route)

**Interfaces — Produces:**
- `PointsService.getFormula(): Promise<PointsFormula>`. Cached in memory and invalidated by `setFormula`.
- `PointsService.pointsFor(tx, issue: {typeId, difficulty, priorityId}): Promise<number|null>`.
- `PointsService.rollupEpics(tx, epicIds: string[]): Promise<void>`. Sets each epic's `storyPoints` to the sum of `storyPoints` over its non-deleted issues with that `epicId` (sub-tasks included), and bumps its version.
- Route `POST /issues/:id/points/reset`, permission `project:admin` or SA → `pointsManual=false` plus a recompute.
- Error `POINTS_OVERRIDE_FORBIDDEN` (403).

- [ ] **Step 1: Failing tests in `issues.service.spec.ts` / `points.service.spec.ts`:**
  - Create with no `storyPoints`: Bug/HARD/High → 9, with `pointsManual=false`.
  - Changing the priority of a non-manual issue recomputes its points. A manual issue keeps them.
  - A non-PM update with `storyPoints` → 403 `POINTS_OVERRIDE_FORBIDDEN`. A PM update → `pointsManual=true`, and the value must be an integer 0–100.
  - A bulk patch with `storyPoints` from a non-PM → 403. A bulk patch of `difficulty` recomputes each non-manual issue.
  - `epicId` A→B on a 3-point issue: epic A drops by 3, epic B gains 3. Deleting or restoring the issue updates its epic's total.
  - `createWithin` (import) ignores incoming `storyPoints` and computes them.
- [ ] **Step 2: Run the tests** → FAIL.
- [ ] **Step 3: Implement.**
  - The override check is `rbac.getEffectivePermissions(user, ws, projectId).has('project:admin') || user.isSystemAdmin`.
  - Remove the old comment at L1342 ("storyPoints không cần kiểm quyền riêng").
  - The epic roll-up runs inside the same transaction.
- [ ] **Step 4: Gates.** `pnpm --filter @tirapro/api test` → all PASS. Then run typecheck.
- [ ] **Step 5: Commit.**

### Task 4: API — formula admin endpoint, background recompute, AI and automation paths, one-off recompute script

**Files:**
- Modify:
  - `apps/api/src/modules/admin/admin-console.controller.ts` + `admin-console.schemas.ts`
  - `apps/api/src/modules/ai/ai.service.ts` (L30–L245)
  - `apps/api/src/modules/automation/actions/issue-patch.ts` + `automation.schemas.ts`
  - `/Users/inrnee/tirapro-data/vm128/deploy.sh` (outside the repo): add the line `sudo -u tirapro /opt/tirapro/run-as-tirapro.sh $N/apps/api node scripts/recompute-points.mjs 2>&1 | tail -1` after `seed-system-roles`.
- Create: `apps/api/scripts/recompute-points.mjs`.

**Interfaces — Produces:**
- `GET /admin/points-formula` → `PointsFormula`.
- `PUT /admin/points-formula` with a `pointsFormulaSchema` body → `PointsFormula`. Only `assertSysAdmin` may call it. It writes one audit entry `points.formula_changed`, then starts `PointsService.recomputeAll()` without awaiting it.
- `PointsService.recomputeAll(): Promise<{updated:number}>`.
  - Works project by project in batches of 500.
  - Only touches non-manual, non-EPIC issues whose computed value differs. Bumps `version` on those.
  - Then rolls up every epic.
  - Emits the project-level realtime event the codebase already uses for bulk changes (find it next to the `bulkUpdate` emit), so open clients refetch.
  - No per-issue activity entries.
- `scripts/recompute-points.mjs`: same algorithm through a plain `PrismaClient`, idempotent. Prints `recomputed N issues, M epics`.
- AI suggest: replace `storyPoints` with `difficulty` (enum of the four values) in the tool schema and the heuristic. The heuristic is length <80 → EASY, <200 → MEDIUM, <500 → HARD, otherwise VERY_HARD. The response field is renamed to `difficulty`; update the web consumer in Task 6.
- Automation: remove `storyPoints` from the settable fields and add `difficulty`. An existing rule that still sets `storyPoints` skips that action and logs a warning in the run log. Setting `dueDate` to null/empty is skipped the same way, with warning `DUE_DATE_REQUIRED`.

- [ ] **Step 1: Failing tests.**
  - A non-SA calls `PUT /admin/points-formula` → 403.
  - A valid PUT persists the formula, writes the audit entry, and calls `recomputeAll`.
  - `recomputeAll` skips manual issues and epics, bumps version only on changed rows, and the epic total equals the sum of its children.
  - The AI heuristic returns `difficulty`.
  - An automation action that sets `storyPoints` → skipped with a warning.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the script against a throwaway DB.**
  1. Apply the Task 2 migrations to the throwaway Postgres.
  2. Seed 2 issues: one manual with 80 points, one with no points (Bug/MEDIUM/High).
  3. Run `node scripts/recompute-points.mjs` → the manual issue is unchanged and the other has 6. A second run updates 0.
- [ ] **Step 5: Gates, then commit.**

### Task 5: API — due date default and "cannot clear"

**Files:**
- Modify: `apps/api/src/modules/issues/issues.service.ts` (`createCore` ~L776/870, `update` ~L1245–1276, `bulkUpdate` patch), `packages/shared/src/schemas/issue.ts`, `issues.service.spec.ts`.

**Interfaces:**
- Consumes `defaultDueDate` from Task 1.
- Produces error `DUE_DATE_REQUIRED` (422) with the message `'Hạn là bắt buộc — chọn một ngày thay vì xoá trống'`.

- [ ] **Step 1: Failing tests.**
  - Create without `dueDate` at a mocked `now = 2026-11-04T16:30Z` → `dueDate = 2026-11-06T00:00:00.000Z`.
  - `createWithin` (import) without `dueDate` → it gets the default.
  - `update({dueDate:null})` → 422 `DUE_DATE_REQUIRED`.
  - A bulk patch with `dueDate:null` → 422.
  - `update({dueDate:'2026-12-01T00:00:00.000Z'})` still works.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** The zod update schema keeps `.nullable()` for wire compatibility; the service rejects null.
- [ ] **Step 4: Gates.**
- [ ] **Step 5: Commit.**

### Task 6: Web — difficulty, computed points, PM override, admin formula page

**Files:**
- Modify:
  - `apps/web/src/features/issue-edit/IssueProperties.tsx` (`IssueStoryPointsInline` L383+, plus a new `IssueDifficultyInline` next to the priority control)
  - `apps/web/src/features/issues/CreateIssueModal.tsx` (difficulty select, default "Trung bình"; remove the points input)
  - `apps/web/src/features/bulk/bulkEdit.ts`, `useBulkEdit.ts`, `useGroupedBulkEdit.ts` (add difficulty; points only for PM)
  - `apps/web/src/features/backlog/InlineEdits.tsx` (points cell read-only for non-PM)
  - the AI consumers `features/ai/*` and `features/assistant/draft.ts` (rename to `difficulty`)
  - `apps/web/src/app/router.tsx` + `features/admin/AdminLayout.tsx` (nav item "Cách tính điểm")
- Create: `apps/web/src/features/admin/AdminPointsPage.tsx` + test.

**Interfaces:**
- Consumes `IssueDto.difficulty`, `pointsManual`, `pointsExplain`; `GET/PUT /admin/points-formula`; `POST /issues/:id/points/reset`; `DIFFICULTY_LABELS`.
- Points display:
  - Read-only for users without `project:admin`. Tooltip = `pointsExplain`.
  - For a PM, clicking edits the value (integer 0–100). When `pointsManual`, show the small text "đã chỉnh tay" and a button "Tính lại theo công thức".
- Admin page:
  - Three small number tables (base / difficulty / priority) and a live example row "Bug · Khó · High = 9".
  - Saving shows the toast "Đã lưu — đang tính lại điểm toàn hệ thống".

- [ ] **Step 1: Failing component tests.**
  - A non-PM sees no editable points button, and the tooltip contains `=`.
  - A PM sees the reset button when `pointsManual`.
  - The create modal defaults difficulty to MEDIUM and has no points input.
  - The admin page validates values > 0.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Bám DESIGN.md.
- [ ] **Step 4: Gates.** Also run `node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/features/admin apps/web/src/features/issue-edit` and fix the findings.
- [ ] **Step 5: Commit.**

### Task 7: Web — due date prefilled and not clearable

**Files:**
- Modify: `IssueProperties.tsx` (the due inline around L860–890: no clear control; an empty value reverts), `CreateIssueModal.tsx` (prefill today+1 VN), bulk-edit due (no "Xoá hạn" option).

- [ ] **Step 1: Failing tests.**
  - The create modal's due date field initially shows tomorrow.
  - The due inline has no clear button, and blurring an empty input sends no patch.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 8: Web — status names in "Việc của tôi" and in the results table

**Files:**
- Modify:
  - `apps/web/src/features/dashboard/DashboardPage.tsx` (row ~L930: replace the dot with `<StatusPill>`, and make the name always visible on this list)
  - the "Việc của tôi chưa xong" gadget in `features/dashboards/registry.tsx`, if it renders the same dot
  - `apps/web/src/features/saved-filters/ResultsTable.tsx` (summary column `max-w-[28rem] truncate` with a `title`; the other columns `whitespace-nowrap`; the status cell uses `StatusPill`)
- Optionally add a prop `alwaysShowName` to `components/ui/StatusPill.tsx`.

- [ ] **Step 1: Failing tests.**
  - A My-work row renders the text `Chờ test` for an issue whose status is Chờ test.
  - The results table's summary cell has the `truncate` class.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 9: Web — hide empty blocks behind "+ Thêm mục"

**Files:**
- Create: `apps/web/src/features/issues/OptionalSections.tsx` + test.
- Modify: `apps/web/src/features/issues/IssueDetailPage.tsx`, `apps/web/src/features/issues/peek/IssuePeekPanel.tsx`.

**Interfaces — Produces:**
- `type OptionalSectionId = 'acceptance'|'checklist'|'components'|'fixVersions'|'affectsVersions'|'links'|'docs'|'environment'`.
- `useOptionalSections(issue, data): { visible(id): boolean; hidden: OptionalSectionId[]; open(id): void }`.
  - A section is visible when it has data or was opened in this page session (component state; no persistence).
- `<AddSectionButton hidden={...} onPick={open} />` renders "+ Thêm mục" with a menu of Vietnamese labels:
  - Tiêu chí chấp nhận
  - Các bước cần làm
  - Thành phần
  - Sửa ở phiên bản
  - Bị ảnh hưởng ở phiên bản
  - Liên kết
  - Tài liệu liên quan
  - Thông tin môi trường

  It renders nothing when `hidden` is empty or the user cannot edit.
- Opening a section scrolls it into view and focuses its first input.
- The Description and Attachments blocks are untouched.
- "Has data" sources:
  - `acceptanceCriteria` is non-blank
  - the checklist has ≥1 item
  - `components`, `fixVersions` or `affectsVersions` has length ≥1
  - links ≥1
  - related docs ≥1 (use the query the panel already makes; hide while it loads)
  - `environment` is non-null

- [ ] **Step 1: Failing tests.**
  - An issue with all of these empty renders none of the 8 sections, plus the button.
  - Picking "Liên kết" shows the links section and removes "Liên kết" from the menu.
  - An issue with acceptance criteria shows that section without clicking.
  - A viewer without edit permission sees no button.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Use it in both the page and the peek panel.
- [ ] **Step 4: Gates, plus the impeccable detect.**
- [ ] **Step 5: Commit.**

### Task 10: Web — AI off hides every AI suggestion; "Gán cho tôi" next to Người phụ trách

Two requests the user added on 2026-11-04.

**1. Turning the AI assistant off hides every AI suggestion.**
- The header toggle "Trợ lý AI: Tắt" is backed by the store `useAi((s) => s.enabled)` (see `components/layout/AppShell.tsx:51`).
- The assignee "Gợi ý" button stays visible while AI is off (it lives in `features/ai/AssigneeSuggestButton.tsx`, used from `IssueProperties.tsx` around L468).
- Every AI-only control must render nothing while `enabled === false`:
  - `AssigneeSuggestButton`
  - the "Trợ lý AI" card / `AiIssuePanel` ("Tóm tắt", "Gợi ý ưu tiên & điểm"/difficulty)
  - any other `features/ai/*` entry point found on the issue page, peek panel or create modal (grep for imports from `features/ai`)
- Non-AI features stay visible.

**2. Add a "Gán cho tôi" button next to Người phụ trách.**
- It goes in the Người phụ trách row on the issue page and in the peek panel.
- It appears only when the current user may assign (`issue:assign`, the same check the assignee picker uses) **and** the issue is not already assigned to them.
- Clicking it patches `assigneeId = me` with OCC and an optimistic update, then shows the toast "Đã gán cho bạn".
- Reuse the assign mutation the picker already uses.

**Files:**
- Modify: `features/ai/AssigneeSuggestButton.tsx`, `features/ai/AiIssuePanel.tsx` (or their call sites), `features/issue-edit/IssueProperties.tsx`.

- [ ] **Step 1: Failing tests.**
  - With the store `enabled=false`, `AssigneeSuggestButton` renders null and the AI card renders null.
  - With `enabled=true`, both render.
  - "Gán cho tôi" is visible when the assignee is someone else and the user can assign; hidden when the issue is assigned to me; hidden without permission.
  - Clicking it calls the patch with `{assigneeId: me.id, version}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**
