# UX vòng 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thực hiện toàn bộ 28 quyết định UX ở `docs/superpowers/specs/2026-10-16-ux-round2.md` (góp ý người dùng mới theo vai trò quản trị/lãnh đạo/PM/BA/dev/tester), verify trên môi trường thật, gộp vào PR #1.

**Architecture:** Giữ kiến trúc hiện tại (NestJS + Prisma + Socket.io; React + TanStack Query + Zustand + Radix + dnd-kit). Thứ tự đợt: việc nhỏ (S) → vừa (M) → lớn (L); task cùng file chạy nối tiếp.

**Tech Stack:** pnpm 10 + turbo, NestJS 10, Prisma 6, PostgreSQL 18, Redis, Socket.io 4, React 18, Vite 6, TanStack Query 5, vitest, Playwright (verify).

**Spec:** `docs/superpowers/specs/2026-10-16-ux-round2.md` (quyết định ràng buộc) + báo cáo `docs/superpowers/ux-review/*.md`.

## Global Constraints

- Quyết định trong spec là ràng buộc: pool người dùng chung (không cách ly), KHÔNG có lời mời (thêm trực tiếp), thuật ngữ "công việc"/"Việc chờ" + giữ thuật ngữ Agile tiếng Anh, ẩn GitHub/GitLab, không SSO/2FA.
- Mọi route mới/sửa có policy decorator (`rbac-coverage`, `own-only-coverage` pass); đọc model soft-delete lọc `deletedAt` (`soft-delete-coverage`); ghi dữ liệu dự án qua guard lưu trữ (`archived-coverage` theo phương thức).
- Mutation realtime dùng OCC `version`; nhiều write bọc `$transaction`; event phát SAU commit; migration mới tên `20261016xxxxxx_<name>`, chạy được `prisma migrate deploy` trên Postgres 16/18, `migrate diff --exit-code` sạch.
- FE: `queryKeys` factory, `Dialog`/`useConfirm` dùng chung (giữ animation đóng — dialog-contract test), quyền qua `useCan`/`useCanIn`/`useCanEditIssue`/`useProjectCan`, bám `DESIGN.md` + `docs/UX_CONVENTIONS.md`, a11y bàn phím.
- Gate: `pnpm -r typecheck` 0 lỗi; `pnpm lint` 0 lỗi và không vượt ratchet (`--max-warnings 91`); `pnpm test` pass; `pnpm format:check`; `pnpm knip`; `pnpm --filter @tirapro/web build`; `prisma validate`; `gen:enums --check`.
- Không thêm dependency nếu không ghi lý do (vd markdown GFM, dashboard grid).

## Review Focus
(điền sau khi các section được viết)

---

## Tasks

(các section chi tiết được ghép bên dưới)
