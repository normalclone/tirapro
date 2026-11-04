# Dashboard templates + data scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Create dashboards from templates and scope a dashboard's data to a project or a personal project group (or the whole org for org admins).
**Spec:** `docs/superpowers/specs/2026-11-05-dashboard-templates-design.md` (read whole).
**Branch:** `feat/dashboard-templates` in `/Users/inrnee/tirapro-wt/dash`, off prod `ad9f233b`.

## Global Constraints
- Prod Postgres is 16 — test migrations on PG16 (`/opt/homebrew/opt/postgresql@16/bin`) and PG18.
- Visibility: a viewer never sees data of projects they can't view, including via a group dashboard.
- Gates: root `pnpm lint` exit 0 (≤91 warnings), `pnpm -r typecheck`, `pnpm test`, `format:check`, knip no new, impeccable detect on touched web dirs, the no-workspace guard test.
- Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01UyXyiG8CW8csVM5RoBsjjU`.

## Review Focus
1. Group-scoped dashboard viewed by someone else → only their visible projects' data.
2. Org scope only for organization:admin.
3. Changing dashboard scope updates inheriting widgets, not widgets with explicit project.
4. Templates only reference existing widget types/configs (validated by a test).

---
### Task 1: API — data scope + templates
- Schema: Dashboard `dataScope` (PROJECT | GROUP | ORG), `scopeProjectId?`, `scopeProgramId?`; migration (existing dashboards: PROJECT if projectId set else ORG? — choose so current behaviour is unchanged; document).
- Widget data resolution reads dashboard scope → project id list (group → its projects ∩ viewer-visible).
- `POST /dashboards/from-template { templateKey, dataScope, scopeProjectId?, scopeProgramId?, name? }`; `GET /dashboard-templates`. Templates in packages/shared with a validation test.
- Tests: scope resolution, visibility, org-admin gate, template creation.

### Task 2: Web — template gallery + scope picker + settings
- Gallery dialog with previews; scope picker (project / my groups / org if admin); dashboard settings to change scope; widgets show inherited scope. Tests.

### Task 3: Final review + deploy
