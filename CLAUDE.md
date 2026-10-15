# Tirapro — Hướng dẫn cho AI agent

Jira clone + nâng cấp (AI, realtime, analytics). Monorepo pnpm + Turborepo.

## Stack

- **apps/api** — NestJS 10 + Prisma + PostgreSQL (pgvector) + Redis + Socket.io. Port 4000, prefix `/api/v1`.
- **apps/web** — React 18 + Vite + TS + Tailwind + primitives tự viết trên Radix + TanStack Query + Zustand. Port 5173.
- **packages/types** — `@tirapro/types`: enums (mirror Prisma), permission catalog, event names, DTO interfaces. Zero-dep.
- **packages/shared** — `@tirapro/shared`: zod schemas, WS typed contracts, JQL grammar, LexoRank (`rankBetween` — chỉ API gọi, FE không tự tính rank). Re-export types.

## Tài liệu nền (đọc trước khi làm)

- `docs/MASTER_PLAN.md` — kiến trúc tích hợp, Prisma schema, build order 34 chunk, cross-cutting decisions, `.env`.
- `docs/design/*.md` — đặc tả sâu 9 subsystem.
- `PRODUCT.md` — register (product), users, anti-references, design principles (impeccable).
- `DESIGN.md` — hệ thống thị giác: token OKLCH (light/dark), typography (Geist), spacing, motion, bans. **Frontend bám sát file này.**
- `docs/UX_CONVENTIONS.md` — **ƯU TIÊN SỐ 1: thật thuận tiện, dễ dùng.** Checklist enforceable + Definition of Done (UX) cho mỗi màn. Bắt buộc đối chiếu trước khi coi màn là done.
- `docs/FEATURES_BY_ACTOR.md` — chức năng & quyền theo actor.
- `docs/RESEARCH_UX_LESSONS.md` + `docs/RESEARCH_FEEDBACK_DEEP.md` — bài học từ feedback Jira & đối thủ (do's/don'ts, pain catalog, triage, severity, data-ownership).
- `docs/RESEARCH_UX_CRAFT.md` — playbook craft (micro-interaction, motion tokens, IA, forms, onboarding, a11y).
- `docs/ARCHITECTURE_SCALE.md` — lộ trình scale dữ liệu (index/partition/multi-tenancy/caching/realtime); §3.2 isolation `$extends`+ALS là P0.

## Quy ước chốt

- ID = **CUID**. Tenant = `Workspace` (REST `/workspaces`, JWT claim `workspaceId`, room `ws:{id}`).
- Issue title field = `summary`. OCC `version` cho mọi mutation realtime.
- Auth: JWT access (in-memory FE) + refresh rotation (httpOnly cookie). RBAC = permission string `resource:action`.
- Response: list bọc envelope `{success,data,pageInfo,meta}`; single trả raw object. Error `{success:false,error:{code,...}}`.
- Naming: REST `api/v1/<plural>`; domain event `domain.action`; WS event `domain:action`; error code `SCREAMING_SNAKE`.
- Degrade gracefully: thiếu `ANTHROPIC_API_KEY` → AI heuristic; Redis down → REST vẫn chạy; search = JQL → Prisma `where`; ô tìm văn bản dùng full-text Postgres (`searchVector` trong `apps/api/prisma/sql/01_pgvector_fts.sql`, bật bằng `pnpm --filter @tirapro/api run db:raw`) — chưa chạy `db:raw` thì tự rơi về ILIKE. Phần pgvector (embedding) trong file đó vẫn **chưa dùng**.

## Thiết kế UI — impeccable + ease-of-use

Dự án dùng skill **impeccable** cho frontend. **Ưu tiên cao nhất: thật thuận tiện, dễ dùng** (`docs/UX_CONVENTIONS.md` — keyboard-first/Cmd+K, optimistic UI, inline edit, quick-add, undo, empty states, AI giảm gõ tay). Khi build/sửa UI:

- Bám `DESIGN.md` (token, type, spacing, motion) + `UX_CONVENTIONS.md` (Definition of Done UX). Tránh **Absolute Bans** (side-stripe border, gradient text, glassmorphism mặc định, hero-metric, lưới card lặp, eyebrow chữ hoa, nền cream, gradient tím AI-slop).
- Font: Geist Sans + Geist Mono (KHÔNG Inter). Màu OKLCH. WCAG AA.
- Gate chất lượng: `node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src` rồi sửa findings. Có thể dùng `/impeccable critique|polish|audit <surface>`.

## Lệnh

- `pnpm setup` — install + docker up + build types/shared + migrate + db:raw + seed.
- `pnpm dev` — chạy api + web song song (turbo).
- `pnpm --filter @tirapro/api db:migrate|db:raw|db:seed`.
- `pnpm lint` — eslint toàn repo (phải 0 lỗi). `pnpm test` — vitest qua turbo. `pnpm -r typecheck` — tsc mọi package.
- `pnpm format` / `pnpm format:check` — `prettier --write .` / `--check .` (theo `.prettierignore`); CI chạy `format:check`. Sau commit format toàn repo (T5) chạy một lần: `git config blame.ignoreRevsFile .git-blame-ignore-revs`; nhánh đang mở cần rebase. PR chứa commit format này phải merge bằng **merge commit** (không squash/rebase-merge) — đổi SHA thì `.git-blame-ignore-revs` mất hiệu lực.
- `pnpm gen:enums` — sinh `packages/types/src/enums.ts` từ Prisma schema (file sinh tự động, không sửa tay).
- `pnpm knip` — liệt kê dependency/file/export không dùng (export/type thừa chỉ cảnh báo; file/dependency thừa làm lệnh thoát 1 — xem `knip.jsonc`; xoá thì `grep -r` xác nhận 0 import trước).
- Vận hành (một lần, cần `DATABASE_URL` + `INTEGRATION_ENCRYPTION_KEY` trong môi trường): `pnpm --filter @tirapro/api run integrations:rekey|automation:seal-secrets [-- --dry-run]`. Thứ tự triển khai `migrate deploy → db:raw → rekey → seal-secrets` và cảnh báo khoá bảng `Issue`: `docs/DEPLOY.md` mục "Checklist triển khai".
- `pnpm --filter @tirapro/api db:seed:rich` — nạp demo giàu dữ liệu (cần API chạy ở :4000).
- Docker API: `docker build -f apps/api/Dockerfile -t tirapro-api .` (build từ gốc repo).
