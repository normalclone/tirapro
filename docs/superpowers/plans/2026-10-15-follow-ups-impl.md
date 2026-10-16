# Follow-ups sau review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm hết các mục "không chặn merge" trong `docs/superpowers/plans/2026-10-15-follow-ups.md` rồi verify toàn bộ trên DB/trình duyệt thật trước khi mở PR.

**Architecture:** Giữ nguyên kiến trúc nhánh `fix/review-findings` (NestJS + Prisma + Socket.io; React + TanStack Query). Mỗi task là một thay đổi nhỏ có test riêng; task đụng `issues.service.ts` chạy tuần tự, task tách `RankService` chạy sau cùng trong nhóm API, `prettier --write` toàn repo là task cuối.

**Tech Stack:** pnpm 10 + turbo, NestJS 10, Prisma 6, PostgreSQL 18 (+pgvector/pg_trgm), Redis, Socket.io 4, React 18, Vite 6, TanStack Query 5, Zustand, dnd-kit, Radix, vitest.

**Spec:** `docs/superpowers/plans/2026-10-15-follow-ups.md` (danh sách follow-up do reviewer cuối lập) + `docs/superpowers/specs/2026-10-15-review-findings.md`.

## Global Constraints

- Mọi route mới/sửa phải có policy decorator (`@Permissions`/`@ProjectRef`/`@AuthOnly`/`@OptionalAuth`/`@OwnOnly`) — spec `rbac-coverage` phải pass.
- Query đọc model soft-delete phải lọc `deletedAt: null` — spec `soft-delete-coverage` phải pass.
- Mutation realtime dùng OCC `version` (`updateMany where {id, workspaceId, deletedAt:null, version}`); nhiều write liên quan bọc `$transaction`; phát event SAU commit.
- Rank chỉ API tính (`rankBetween` của `@tirapro/shared`); FE không tự tính rank.
- Naming: REST `api/v1/<plural>`; domain event `domain.action`; WS event `domain:action`; error code `SCREAMING_SNAKE`.
- FE: dùng `queryKeys` factory, `Dialog`/`useConfirm` dùng chung, không `window.confirm`; chuỗi UI tiếng Việt; bám `DESIGN.md` + `docs/UX_CONVENTIONS.md`.
- Gate: `pnpm -r typecheck` 0 lỗi; `pnpm lint` 0 lỗi và số cảnh báo không vượt ratchet; `pnpm test` pass; `pnpm --filter @tirapro/web build` pass; `prisma validate` + `pnpm gen:enums --check` pass.
- Không thêm dependency mới nếu không ghi rõ lý do trong report.
- Migration mới (nếu có) đặt tên `2026101710xxxx_<name>`; phải chạy được bằng `prisma migrate deploy` trên Postgres 18.

## Review Focus

1. Thành viên chỉ có quyền ở mức project (không có quyền workspace): mọi nút FE và endpoint API mới phải nhất quán — không 403 vô lý, không lộ nút không dùng được (W1, W2, S1).
2. Client gửi neighbor rank đã cũ khi người khác vừa kéo thả: trả 409 `RANK_NEIGHBORS_STALE` để client refetch, không rebalance toàn project (C2).
3. Project đã xoá mềm: issue của nó không lộ qua `/issues/:key`, search, JQL, list, links, guard theo issue id (S6, C5).
4. Hai node API cùng chạy: cron digest không gửi đôi; khôi phục job import không đánh dấu FAILED job đang chạy thật ở node khác (heartbeat) (C7, C6).
5. Dữ liệu lớn: CSV 25MB không chặn event loop; bulk > 100 issue chia lô đúng, không mất kết quả/conflict (C6, C3).

**Thứ tự thực hiện (controller chốt):** T2, T3 (đã merge) → T5 (đưa lên đầu) → S1, S4, S5+C7, C1+W2, C4+W5, W3, C6, C9, C8, W6 → S3, S2, C2, W1, W4 → S6, C3 → C5 → T1 → T4.

---

## Tasks


## Nhóm S — Bảo mật / quyền

#### Nhóm S — Bảo mật / quyền (API)

Thứ tự khuyến nghị: **S1 → S3 → S6** (cùng sửa `issues.service.ts`, chạy tuần tự), **S2** sau S1 (cùng sửa `issue-links.*`), **S4**, **S5** độc lập (không đụng file của các task khác trong nhóm).

Quy ước test chung của nhóm: vitest, mock Prisma bằng object thuần + `vi.fn()` (không có DB test); chạy một file bằng
`pnpm --filter @tirapro/api exec vitest run <đường dẫn từ apps/api>`.

---

### Task S1: Gắn `@OwnOnly` cho mọi route ISSUE_EDIT / ISSUE_TRANSITION còn lại

**Mục tiêu:** Người chỉ có `issue:edit:own` (mặc định: vai trò **Project Reporter**) không còn gắn nhãn/thành phần/phiên bản, đổi custom field, upload/xoá đính kèm, tạo/xoá link, sửa checklist/participants, triage trên việc của người khác (403). `transition`/`move` cũng kiểm sở hữu khi quyền chỉ thoả bằng `:own`.

**Hiện trạng:**
- Cơ chế có sẵn: `PermissionsGuard` (`apps/api/src/modules/rbac/permissions.guard.ts:36-39`) cho qua khi có `p` hoặc `p:own`, và ghi `req.ownOnly = new Set(required.filter(p => !effective.has(p)))`. `@OwnOnly(perm)` (`apps/api/src/common/decorators/own-only.decorator.ts:10`) là **param decorator** đọc `req.ownOnly.has(perm)` → `boolean`. Việc kiểm sở hữu nằm ở service, hiện chỉ có 2 chỗ: `IssuesService.update` (`issues.service.ts:362`) và `bulkUpdate` (`:422`) qua `assertOwnsIssue` (`:97-103`: user là `reporterId`/`assigneeId`/`createdById`).
- Guard resolve issue id **không phải** việc của `@OwnOnly`: route khai `@ProjectRef('issue', '<tên param>')` để guard tìm projectId; `@OwnOnly` chỉ cho biết "chỉ qua nhờ :own". Controller lấy id issue từ `@Param`. Vì vậy phải tự tra sở hữu theo issue id (hoặc theo attachment/link id).
- Quyền `:own` thực tế trong catalog: chỉ `issue:edit:own` (`packages/types/src/permissions.ts:20`, gán cho `PROJECT_REPORTER` ở `:166-168`). **`issue:transition:own` KHÔNG có trong `PERMISSION_CATALOG`** nên chưa vai trò nào có; gắn `@OwnOnly(ISSUE_TRANSITION)` là phòng thủ chiều sâu (khi sau này thêm quyền vào catalog/vai trò tuỳ biến), không đổi hành vi mặc định.
- Danh sách CHÍNH XÁC route cần gắn (từ `grep ISSUE_EDIT|ISSUE_TRANSITION` trên mọi `*.controller.ts`; **không** có route nào dùng `ISSUE_LINK/ISSUE_TRIAGE/ISSUE_ASSIGN`):

| # | Controller (`apps/api/src/modules/…`) | Route | Handler | Perm | Cách lấy issue để kiểm |
|---|---|---|---|---|---|
| 1 | `issue-links/issue-links.controller.ts:35` | `POST issues/:issueId/links` | `create` | EDIT | `issueId` (đầu nguồn) |
| 2 | `issue-links/issue-links.controller.ts:47` | `DELETE links/:id` | `remove` | EDIT | nguồn của link `:id` |
| 3 | `labels/labels.controller.ts:77` | `POST issues/:issueId/labels` | `attach` | EDIT | `issueId` |
| 4 | `labels/labels.controller.ts:88` | `DELETE issues/:issueId/labels/:labelId` | `detach` | EDIT | `issueId` |
| 5 | `components/components.controller.ts:126` | `POST issues/:issueId/components` | `attachComponent` | EDIT | `issueId` |
| 6 | `components/components.controller.ts:137` | `DELETE issues/:issueId/components/:componentId` | `detachComponent` | EDIT | `issueId` |
| 7 | `components/components.controller.ts:189` | `POST issues/:issueId/versions` | `attachVersion` | EDIT | `issueId` |
| 8 | `components/components.controller.ts:200` | `DELETE issues/:issueId/versions/:versionId/:type` | `detachVersion` | EDIT | `issueId` |
| 9 | `custom-fields/custom-fields.controller.ts:89` | `PUT issues/:issueId/custom-fields/:fieldId` | `setIssueValue` | EDIT | `issueId` |
| 10 | `attachments/attachments.controller.ts:29` | `POST issues/:issueId/attachments` | `upload` | EDIT | `issueId` |
| 11 | `attachments/attachments.controller.ts:67` | `DELETE attachments/:id` | `remove` | EDIT | issue của attachment (hoặc issue của comment chứa nó) |
| 12 | `triage/triage.controller.ts:60` | `POST triage/:issueId/accept` | `accept` | EDIT | `issueId` |
| 13 | `triage/triage.controller.ts:72` | `POST triage/:issueId/decline` | `decline` | EDIT | `issueId` |
| 14 | `triage/triage.controller.ts:84` | `POST triage/:issueId/snooze` | `snooze` | EDIT | `issueId` |
| 15 | `issue-extras/issue-extras.controller.ts:27` | `PUT issues/:issueId/participants` | `setParticipants` | EDIT | `issueId` |
| 16 | `issue-extras/issue-extras.controller.ts:44` | `POST issues/:issueId/checklist` | `addChecklist` | EDIT | `issueId` |
| 17 | `issue-extras/issue-extras.controller.ts:54` | `PATCH issues/:issueId/checklist/:itemId` | `updateChecklist` | EDIT | `issueId` |
| 18 | `issue-extras/issue-extras.controller.ts:65` | `DELETE issues/:issueId/checklist/:itemId` | `removeChecklist` | EDIT | `issueId` |
| 19 | `issues/issues.controller.ts:87` | `POST issues/:id/transition` | `transition` | TRANSITION | `id` (trong service, có sẵn `current`) |
| 20 | `issues/issues.controller.ts:99` | `POST issues/:id/move` | `move` | TRANSITION | `id` (trong service) |

  Đã có `@OwnOnly`: `PATCH issues/bulk`, `PATCH issues/:id`. Cố ý **không** gắn: `POST ai/suggest-assignee` (`ai/ai.controller.ts:66`, `AI_USE`+`ISSUE_EDIT`) — theo `projectId` trong body, không thuộc một issue cụ thể; `ISSUE_DELETE` (`DELETE issues/:id`) — catalog không có `issue:delete:own`.
- Lỗ hổng thứ hai cùng chỗ: `bulkUpdate` với `patch.statusId` gọi `assertCanTransition` (`issues.service.ts:106-112`) chấp nhận `issue:transition:own` nhưng không kiểm sở hữu theo quyền đó (chỉ kiểm theo cờ `ownOnly` của `issue:edit`).

**Files:**
- Create: `apps/api/src/modules/rbac/issue-ownership.service.ts` — `IssueOwnershipService` (+ hàm thuần `isIssueOwner`, `assertIssueOwner`, hằng `NOT_OWN_ISSUE_MESSAGE`).
- Create: `apps/api/src/modules/rbac/issue-ownership.service.spec.ts`
- Modify: `apps/api/src/modules/rbac/rbac.module.ts` — thêm `IssueOwnershipService` vào `providers` + `exports` (module đã `@Global()` nên các controller inject được, không cần import module).
- Modify: `apps/api/src/common/decorators/own-only.decorator.ts` — export `ownOnlyFactory` (hàm factory) để spec phản chiếu nhận diện được.
- Modify: 7 controller ở bảng trên (+ `issues.controller.ts`) — thêm `@CurrentUser()` nếu thiếu, `@OwnOnly(...) ownOnly: boolean` ở cuối tham số, và gọi `await this.ownership.assertOwns…` TRƯỚC khi gọi service.
- Modify: `apps/api/src/modules/issues/issues.service.ts:97-112, 411-423, 495-497, 524-526` — `assertOwnsIssue` dùng `assertIssueOwner`; `assertCanTransition` trả `{ ownOnly }`; `bulkUpdate`/`transition`/`move` nhận và áp `ownOnly`.
- Create: `apps/api/src/own-only-coverage.spec.ts` — spec phản chiếu: mọi handler có `ISSUE_EDIT`/`ISSUE_TRANSITION` trong `@Permissions` phải có tham số `@OwnOnly` đúng quyền (cùng kiểu `rbac-coverage.spec.ts`).
- Test: `apps/api/src/modules/issues/issues.service.spec.ts` (mở rộng describe `IssuesService — :own (issue:edit:own)` ở `:~506`), `apps/api/src/modules/labels/labels.controller.spec.ts` + `apps/api/src/modules/attachments/attachments.controller.spec.ts` (mới, kiểm thứ tự gọi).

**Interfaces:**
- Produces: `IssueOwnershipService.assertOwnsIssue(ownOnly: boolean, workspaceId: string, userId: string, issueId: string): Promise<void>`; `.assertOwnsAttachment(ownOnly, workspaceId, userId, attachmentId)`; `.assertOwnsLinkSource(ownOnly, workspaceId, userId, linkId)`. Cả ba **no-op khi `ownOnly=false`** (không query). `isIssueOwner(userId, {reporterId,assigneeId,createdById}): boolean` dùng lại ở S2.
- Produces (đổi chữ ký, tương thích ngược vì tham số cuối tuỳ chọn): `IssuesService.transition(workspaceId, userId, id, input, opts?, ownOnly?)`, `IssuesService.move(workspaceId, userId, id, input, ownOnly?)`.
- Consumes: `req.ownOnly` do `PermissionsGuard` ghi.

**Quyết định thiết kế:**
- Kiểm sở hữu ở **controller qua `IssueOwnershipService`** thay vì thêm tham số `userId`/`ownOnly` vào ~17 hàm service (labels/components/… hiện không nhận `userId`): ít đổi chữ ký, một chỗ định nghĩa "sở hữu" (reporter/assignee/createdBy — đúng định nghĩa của `update`). Riêng `transition`/`move` làm trong `IssuesService` vì đã có `current` (không thêm query) và để cùng mẫu với `update`/`bulkUpdate`.
- Đính kèm của comment: tính theo issue chứa comment (không theo người upload) — nhỏ nhất, nhất quán với resolver `attachment` trong `rbac.service.ts:55-65`.
- `DELETE links/:id`: kiểm sở hữu **đầu nguồn** (guard cũng resolve project theo đầu nguồn, `rbac.service.ts:66-82`).
- `assertCanTransition` đổi thứ tự: có `issue:transition` → `ownOnly:false`; system admin → `false`; có `issue:transition:own` → `true`; còn lại 403. (Trước đây `:own` được chấp nhận không kiểm sở hữu.)
- Thêm spec phản chiếu để lỗi "quên gắn" ở route mới sau này bị bắt; có danh sách miễn trừ tường minh `AiController.suggestAssignee`.
- Không thêm `issue:transition:own` vào catalog (ngoài phạm vi; đổi catalog cần seed/migration quyền).

- [ ] **Step 1: Viết test fail**

`apps/api/src/modules/rbac/issue-ownership.service.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { IssueOwnershipService, isIssueOwner } from './issue-ownership.service';

const owners = (over: Record<string, string | null> = {}) => ({ reporterId: 'a', assigneeId: 'b', createdById: 'c', ...over });

function make(found: unknown) {
  const prisma = {
    issue: { findFirst: vi.fn(() => Promise.resolve(found)) },
    attachment: { findFirst: vi.fn(() => Promise.resolve(found)) },
    issueLink: { findFirst: vi.fn(() => Promise.resolve(found)) },
  };
  return { svc: new IssueOwnershipService(prisma as never), prisma };
}

describe('isIssueOwner', () => {
  it.each(['a', 'b', 'c'])('%s là chủ (reporter/assignee/createdBy)', (u) => expect(isIssueOwner(u, owners())).toBe(true));
  it('người khác không phải chủ', () => expect(isIssueOwner('x', owners())).toBe(false));
  it('trường null không khớp userId', () => expect(isIssueOwner('x', owners({ reporterId: null, assigneeId: null, createdById: null }))).toBe(false));
});

describe('IssueOwnershipService', () => {
  it('ownOnly=false → no-op, không đụng DB', async () => {
    const { svc, prisma } = make(owners());
    await svc.assertOwnsIssue(false, 'w1', 'x', 'i1');
    await svc.assertOwnsAttachment(false, 'w1', 'x', 'at1');
    await svc.assertOwnsLinkSource(false, 'w1', 'x', 'l1');
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.issueLink.findFirst).not.toHaveBeenCalled();
  });

  it('assertOwnsIssue: việc của người khác → 403; của mình → qua; không thấy → 404; truy vấn có workspace + deletedAt:null', async () => {
    const other = make(owners());
    await expect(other.svc.assertOwnsIssue(true, 'w1', 'x', 'i1')).rejects.toMatchObject({ status: 403 });
    expect(other.prisma.issue.findFirst.mock.calls[0]![0]).toMatchObject({ where: { id: 'i1', workspaceId: 'w1', deletedAt: null } });
    await expect(make(owners()).svc.assertOwnsIssue(true, 'w1', 'b', 'i1')).resolves.toBeUndefined();
    await expect(make(null).svc.assertOwnsIssue(true, 'w1', 'b', 'i1')).rejects.toMatchObject({ status: 404 });
  });

  it('assertOwnsAttachment: lấy issue trực tiếp hoặc issue của comment', async () => {
    await expect(make({ issue: owners(), comment: null }).svc.assertOwnsAttachment(true, 'w1', 'x', 'at1')).rejects.toMatchObject({ status: 403 });
    await expect(make({ issue: null, comment: { issue: owners() } }).svc.assertOwnsAttachment(true, 'w1', 'a', 'at1')).resolves.toBeUndefined();
    await expect(make({ issue: null, comment: null }).svc.assertOwnsAttachment(true, 'w1', 'a', 'at1')).rejects.toMatchObject({ status: 404 });
  });

  it('assertOwnsLinkSource: kiểm đầu nguồn', async () => {
    await expect(make({ source: owners() }).svc.assertOwnsLinkSource(true, 'w1', 'x', 'l1')).rejects.toMatchObject({ status: 403 });
    await expect(make({ source: owners() }).svc.assertOwnsLinkSource(true, 'w1', 'c', 'l1')).resolves.toBeUndefined();
  });
});
```

`apps/api/src/own-only-coverage.spec.ts`:
```ts
import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS } from '@tirapro/types';
import { describe, expect, it } from 'vitest';
import { ownOnlyFactory } from './common/decorators/own-only.decorator';
import { PERMISSIONS_KEY } from './common/decorators/permissions.decorator';

/** Route cần `:own` cho quyền sửa/chuyển trạng thái issue mà KHÔNG nhận @OwnOnly = lỗ hổng (người chỉ có :own sửa được việc người khác). */
const OWN_AWARE = [PERMISSIONS.ISSUE_EDIT, PERMISSIONS.ISSUE_TRANSITION] as const;
/** Không thuộc một issue cụ thể (theo projectId trong body) nên không có gì để kiểm sở hữu. */
const EXEMPT = new Set(['AiController.suggestAssignee']);

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

type Ctor = (new (...a: never[]) => unknown) & { prototype: Record<string, unknown> };
type ArgMeta = Record<string, { factory?: unknown; data?: unknown }>;

describe('@OwnOnly coverage', () => {
  it('mọi route ISSUE_EDIT/ISSUE_TRANSITION nhận @OwnOnly tương ứng', async () => {
    const root = join(__dirname, 'modules');
    const missing: string[] = [];
    let checked = 0;
    for (const file of controllerFiles(root).sort()) {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function') continue;
        const ctrl = exported as Ctor;
        if (Reflect.getMetadata('path', ctrl) === undefined) continue;
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          const handler = ctrl.prototype[name];
          if (name === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata('method', handler) === undefined) continue;
          const perms = (Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? Reflect.getMetadata(PERMISSIONS_KEY, ctrl) ?? []) as string[];
          const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {}) as ArgMeta;
          for (const p of OWN_AWARE) {
            if (!perms.includes(p)) continue;
            checked++;
            const ok = Object.values(args).some((a) => a.factory === ownOnlyFactory && a.data === p);
            if (!ok && !EXEMPT.has(`${ctrl.name}.${name}`)) missing.push(`${relative(root, file)} → ${ctrl.name}.${name} (${p})`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
    expect(missing, `Route thiếu @OwnOnly:\n${missing.join('\n')}`).toEqual([]);
  });
});
```

`apps/api/src/modules/labels/labels.controller.spec.ts` (mẫu; làm tương tự cho `attachments.controller.spec.ts` với `remove` → `assertOwnsAttachment`):
```ts
import { describe, expect, it, vi } from 'vitest';
import { LabelsController } from './labels.controller';

describe('LabelsController — :own', () => {
  const user = { id: 'u1' } as never;
  const make = (ownershipError?: Error) => {
    const labels = { attach: vi.fn(() => Promise.resolve({ ok: true })), detach: vi.fn(() => Promise.resolve({ ok: true })) };
    const ownership = { assertOwnsIssue: vi.fn(() => (ownershipError ? Promise.reject(ownershipError) : Promise.resolve())) };
    return { ctrl: new LabelsController(labels as never, ownership as never), labels, ownership };
  };

  it('attach: kiểm sở hữu TRƯỚC khi ghi; bị từ chối thì service không được gọi', async () => {
    const { ctrl, labels, ownership } = make(new Error('403'));
    await expect(ctrl.attach('w1', user, 'i1', { labelId: 'l1' }, true)).rejects.toThrow('403');
    expect(ownership.assertOwnsIssue).toHaveBeenCalledWith(true, 'w1', 'u1', 'i1');
    expect(labels.attach).not.toHaveBeenCalled();
  });

  it('detach: truyền đúng cờ ownOnly=false (quyền đầy đủ)', async () => {
    const { ctrl, labels, ownership } = make();
    await ctrl.detach('w1', user, 'i1', 'l1', false);
    expect(ownership.assertOwnsIssue).toHaveBeenCalledWith(false, 'w1', 'u1', 'i1');
    expect(labels.detach).toHaveBeenCalledWith('w1', 'i1', 'l1');
  });
});
```
(Thứ tự tham số handler mới: `(workspaceId, user, …params cũ…, ownOnly)` — spec này khoá thứ tự đó. Với `attach` DTO là `{ labelId }`.)

Bổ sung vào describe `IssuesService — :own (issue:edit:own)` trong `issues.service.spec.ts`:
```ts
  it('transition(ownOnly) trên việc của người khác -> 403, chưa ghi gì, không emit', async () => {
    const tx = ownTx(issueRow({ reporterId: 'u1', createdById: 'u1', assigneeId: null }));
    const { service, events } = makeService(tx);
    await expect(service.transition('w1', 'u9', 'i1', { version: 3, toStatusId: 's2' }, undefined, true)).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('move(ownOnly) trên việc của người khác -> 403; của mình -> qua', async () => {
    const tx = ownTx(issueRow({ reporterId: 'u1', createdById: 'u1', assigneeId: null }));
    const { service } = makeService(tx);
    await expect(service.move('w1', 'u9', 'i1', { version: 3 }, true)).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    await expect(service.move('w1', 'u1', 'i1', { version: 3 }, true)).resolves.toBeDefined();
  });

  it('bulkUpdate chỉ có issue:transition:own + việc của người khác -> 403 cả lô, chưa ghi', async () => {
    const tx = {
      issue: {
        findMany: vi.fn(() => Promise.resolve([issueRow({ id: 'a', reporterId: 'u1', createdById: 'u1' })])),
        updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
        findFirstOrThrow: vi.fn(),
      },
      issueHistory: { createMany: vi.fn(), create: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null, defaultWorkflowId: 'wf' })) },
      user: { findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: false })) },
    };
    const { service, rbac } = makeService(tx);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition:own']));
    await expect(
      service.bulkUpdate('w1', 'u9', { projectId: 'p1', items: [{ id: 'a', version: 3 }], patch: { statusId: 's2' } }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });
```
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/modules/rbac/issue-ownership.service.spec.ts src/own-only-coverage.spec.ts src/modules/labels/labels.controller.spec.ts src/modules/issues/issues.service.spec.ts` → **FAIL** (thiếu module/`ownOnlyFactory`; `transition`/`move` chưa nhận `ownOnly`; spec phản chiếu liệt kê 18 route thiếu).
- [ ] **Step 3: Implementation**
  1. `own-only.decorator.ts`:
     ```ts
     export const ownOnlyFactory = (permission: PermissionKey, ctx: ExecutionContext): boolean => {
       const req = ctx.switchToHttp().getRequest<AuthedRequest>();
       return req.ownOnly?.has(permission) ?? false;
     };
     export const OwnOnly = createParamDecorator(ownOnlyFactory);
     ```
  2. `rbac/issue-ownership.service.ts`:
     ```ts
     import { Injectable } from '@nestjs/common';
     import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
     import { PrismaService } from '../../infra/prisma/prisma.service';

     export const NOT_OWN_ISSUE_MESSAGE =
       'Bạn chỉ được sửa công việc do mình tạo, báo cáo hoặc được giao — hãy nhờ người phụ trách hoặc quản trị viên dự án';
     export interface IssueOwners { reporterId: string | null; assigneeId: string | null; createdById: string | null }
     const OWNERS = { reporterId: true, assigneeId: true, createdById: true } as const;

     export const isIssueOwner = (userId: string, i: IssueOwners): boolean =>
       i.reporterId === userId || i.assigneeId === userId || i.createdById === userId;
     export function assertIssueOwner(userId: string, i: IssueOwners): void {
       if (!isIssueOwner(userId, i)) throw new ForbiddenAppException(NOT_OWN_ISSUE_MESSAGE);
     }

     @Injectable()
     export class IssueOwnershipService {
       constructor(private readonly prisma: PrismaService) {}

       async assertOwnsIssue(ownOnly: boolean, workspaceId: string, userId: string, issueId: string): Promise<void> {
         if (!ownOnly) return;
         const issue = await this.prisma.issue.findFirst({ where: { id: issueId, workspaceId, deletedAt: null }, select: OWNERS });
         if (!issue) throw new NotFoundAppException('Công việc');
         assertIssueOwner(userId, issue);
       }

       async assertOwnsAttachment(ownOnly: boolean, workspaceId: string, userId: string, attachmentId: string): Promise<void> {
         if (!ownOnly) return;
         const live = { workspaceId, deletedAt: null };
         const att = await this.prisma.attachment.findFirst({
           where: { id: attachmentId, OR: [{ issue: live }, { comment: { issue: live } }] },
           select: { issue: { select: OWNERS }, comment: { select: { issue: { select: OWNERS } } } },
         });
         const issue = att?.issue ?? att?.comment?.issue;
         if (!issue) throw new NotFoundAppException('Tệp đính kèm');
         assertIssueOwner(userId, issue);
       }

       async assertOwnsLinkSource(ownOnly: boolean, workspaceId: string, userId: string, linkId: string): Promise<void> {
         if (!ownOnly) return;
         const link = await this.prisma.issueLink.findFirst({
           where: { id: linkId, source: { workspaceId, deletedAt: null } },
           select: { source: { select: OWNERS } },
         });
         if (!link) throw new NotFoundAppException('Liên kết');
         assertIssueOwner(userId, link.source);
       }
     }
     ```
  3. `rbac.module.ts`: `providers: [RbacService, IssueOwnershipService], exports: [RbacService, IssueOwnershipService]`.
  4. Controllers — mẫu cho mọi route trong bảng (thêm `import { CurrentUser }`, `import { OwnOnly }`, `import type { AuthUser }`, `import { IssueOwnershipService }` nếu thiếu; inject `private readonly ownership: IssueOwnershipService` vào constructor):
     ```ts
     @Permissions(PERMISSIONS.ISSUE_EDIT)
     @ProjectRef('issue', 'issueId')
     @Post('issues/:issueId/labels')
     async attach(
       @WorkspaceId() workspaceId: string,
       @CurrentUser() user: AuthUser,
       @Param('issueId') issueId: string,
       @Body(new ZodValidationPipe(attachLabelSchema)) dto: AttachLabelDto,
       @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
     ) {
       await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
       return this.labels.attach(workspaceId, issueId, dto.labelId);
     }
     ```
     Quy tắc áp cho từng dòng bảng: dòng 3–10, 12–18 gọi `assertOwnsIssue(ownOnly, workspaceId, user.id, issueId)`; dòng 11 gọi `assertOwnsAttachment(ownOnly, workspaceId, user.id, id)`; dòng 1 gọi `assertOwnsIssue` (S2 sẽ bổ sung phần đích) và dòng 2 gọi `assertOwnsLinkSource(ownOnly, workspaceId, user.id, id)`. Giữ nguyên thứ tự khai báo decorator hiện có; `attachments.upload` đã có `user`, đặt `@OwnOnly` sau `@UploadedFile()`. Dòng 19–20: thêm `@OwnOnly(PERMISSIONS.ISSUE_TRANSITION) ownOnly: boolean` và truyền `this.issues.transition(workspaceId, user.id, id, dto, undefined, ownOnly)` / `this.issues.move(workspaceId, user.id, id, dto, ownOnly)`.
  5. `issues.service.ts`:
     - `assertOwnsIssue` (`:97-103`) → thân: `assertIssueOwner(userId, issue)` (import từ `'../rbac/issue-ownership.service'`); xoá message trùng.
     - `assertCanTransition` → `Promise<{ ownOnly: boolean }>`:
       ```ts
       const perms = await this.rbac.getEffectivePermissions(userId, workspaceId, projectId);
       if (perms.has(PERMISSIONS.ISSUE_TRANSITION)) return { ownOnly: false };
       const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
       if (u?.isSystemAdmin) return { ownOnly: false };
       if (perms.has(`${PERMISSIONS.ISSUE_TRANSITION}:own`)) return { ownOnly: true };
       throw new ForbiddenAppException('Bạn không có quyền chuyển trạng thái công việc — hãy bỏ phần đổi trạng thái hoặc nhờ quản trị cấp quyền');
       ```
     - `bulkUpdate`: `let transitionOwnOnly = false; if (patch.statusId) transitionOwnOnly = (await this.assertCanTransition(...)).ownOnly;` và đổi dòng `:422` thành `if (ownOnly || transitionOwnOnly) for (const r of rows) this.assertOwnsIssue(userId, r);`.
     - `transition(..., opts?, ownOnly?: boolean)`: sau `requireIssue` thêm `if (ownOnly) this.assertOwnsIssue(userId, current);`. `move(..., input, ownOnly?: boolean)`: tương tự.
- [ ] **Step 4:** chạy lại lệnh Step 2 → **PASS**. Gate: `pnpm --filter @tirapro/api typecheck`; `pnpm --filter @tirapro/api exec eslint src/modules/rbac src/common/decorators src/own-only-coverage.spec.ts src/modules/{issues,labels,components,triage,custom-fields,attachments,issue-extras,issue-links}`; `pnpm --filter @tirapro/api exec vitest run src/rbac-coverage.spec.ts src/infra/prisma/soft-delete-coverage.spec.ts` (phải vẫn pass).
- [ ] **Step 5: Commit** — `API: route sửa/chuyển trạng thái issue còn lại (link, nhãn, thành phần, đính kèm, triage, trường tuỳ biến, checklist, transition, move) kiểm sở hữu khi chỉ có quyền :own`

**Rủi ro/đụng chạm:** `issues.service.ts` và `issues.controller.ts` (cùng S3, S6); `issue-links.controller.ts`/`.service.ts` (cùng S2 — S2 làm sau). Không có migration. Release note: vai trò **Project Reporter** không còn thao tác được (403) trên việc không phải của mình ở các route trên — web nên ẩn/disable nhưng không bắt buộc cho task này. `assertCanTransition` thêm một lần `user.findUnique` cho nhánh `:own`/không có quyền (nhánh `issue:transition` đầy đủ không đổi, không thêm query).

---
### Task S2: RAID đổi dự án và link liên dự án phải kiểm quyền ở đầu kia

**Mục tiêu:** `PUT /raid/:id` chỉ chuyển được mục sang dự án (hoặc về cấp workspace) khi người dùng có `risk:manage` ở **đích**; tạo/xoá link giữa hai dự án khác nhau yêu cầu quyền sửa ở **cả hai** dự án. Không còn "mượn" quyền dự án A để ghi vào dự án B.

**Hiện trạng:**
- `apps/api/src/modules/raid/raid.controller.ts:50-61` — `PUT :id` có `@ProjectRef('raid','id')` + `@Permissions(RISK_MANAGE)`: guard chỉ tính quyền ở dự án HIỆN TẠI của mục. `raid.service.ts:121-125`:
  ```ts
  if (dto.projectId !== undefined) {
    const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
    if (projectId && projectId !== item.projectId) await assertProjectWritable(this.prisma, projectId);
    data.project = projectId ? { connect: { id: projectId } } : { disconnect: true };
  }
  ```
  `resolveProject` (`:154`) chỉ kiểm dự án thuộc workspace + chưa xoá; `assertProjectWritable` chỉ kiểm chưa lưu trữ — không kiểm quyền. (`POST /raid` thì ổn: không có `@ProjectRef`, không có param khác nên guard dùng `body.projectId`, `permissions.guard.ts:76-81`.)
- `apps/api/src/modules/issue-links/issue-links.service.ts:81-100` — `create` gọi `requireIssue` cho cả hai đầu rồi chỉ `assertIssueWritable` (lưu trữ); quyền chỉ do guard kiểm theo `@ProjectRef('issue','issueId')` = đầu NGUỒN. `remove` (`:127-138`) tương tự (guard resolve theo nguồn, `rbac.service.ts:66-82`). Response `create` còn trả `targetIssue` (key, summary, status) → người không có quyền ở dự án đích đọc được thông tin issue đích.

**Files:**
- Modify: `apps/api/src/modules/raid/raid.controller.ts:50-61` — `update` nhận `@CurrentUser() user: AuthUser`, truyền `user` xuống service.
- Modify: `apps/api/src/modules/raid/raid.service.ts:~60 (constructor), 104-133` — inject `RbacService` (global), `update(workspaceId, id, dto, actor)`, thêm `assertCanManageRisk`.
- Modify: `apps/api/src/modules/issue-links/issue-links.controller.ts:34-52` — (sau S1) truyền `user` vào `create`/`remove`.
- Modify: `apps/api/src/modules/issue-links/issue-links.service.ts:81-138, 152-160` — inject `RbacService`; `create(workspaceId, issueId, input, actor)`/`remove(workspaceId, linkId, actor)`; `requireIssue` select thêm `projectId` + 3 cột chủ sở hữu; thêm `assertCanEditAcrossProject`.
- Create: `apps/api/src/modules/raid/raid.service.spec.ts`
- Create: `apps/api/src/modules/issue-links/issue-links.service.spec.ts`

**Interfaces:**
- Consumes: `RbacService.getEffectivePermissions(userId, workspaceId, projectId | null): Promise<Set<string>>`; `isIssueOwner` (S1); `AuthUser` (`isSystemAdmin`).
- Produces: `RaidService.update(workspaceId, id, dto, actor: { id: string; isSystemAdmin: boolean })`; `IssueLinksService.create(workspaceId, issueId, input, actor)` và `.remove(workspaceId, linkId, actor)` với cùng kiểu `actor`. Không đổi route/DTO/response.

**Quyết định thiết kế:**
- RAID: kiểm `risk:manage` ở đích **mỗi khi `projectId` đổi** (kể cả đổi về `null` = cấp workspace: khi đó tính quyền cấp workspace, đúng như `POST /raid` không kèm `projectId`). `projectId` không đổi → không thêm truy vấn. System admin bỏ qua (khớp guard `:28`).
- Link: chỉ kiểm thêm khi **hai đầu khác dự án** (cùng dự án thì quyền nguồn do guard đã đủ — nhỏ nhất, không đổi hành vi cùng-dự-án). Ở dự án đích: cần `issue:edit` đầy đủ, hoặc `issue:edit:own` **và** là chủ issue đích (cùng định nghĩa sở hữu của S1). Không có quyền → 403, không tạo link.
- `remove`: bỏ qua kiểm đích khi issue đích đã xoá mềm (cho phép dọn link mồ côi).
- Không dùng `ISSUE_LINK` (catalog có nhưng không route nào dùng; đổi sang quyền đó là thay đổi hành vi ngoài phạm vi).
- (Ngoài phạm vi, ghi nhận) `GET issues/:issueId/links` trả `otherIssue` của dự án khác mà không kiểm quyền xem dự án đó — rò rỉ đọc cùng loại; xem mục cuối.

- [ ] **Step 1: Viết test fail**

`apps/api/src/modules/raid/raid.service.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { RaidService } from './raid.service';

const raidRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1', workspaceId: 'w1', projectId: 'p1', kind: 'RISK', title: 't', description: null, probability: 3, impact: 3,
  status: 'OPEN', ownerId: null, mitigation: null, dueDate: null, createdAt: new Date(), updatedAt: new Date(),
  owner: null, project: { id: 'p1', key: 'P', name: 'P' }, ...over,
});

function setup(perms: string[] = [], current: { projectId: string | null } = { projectId: 'p1' }) {
  const prisma = {
    raidItem: {
      findFirst: vi.fn((args: { select: Record<string, unknown> }) =>
        Promise.resolve('title' in args.select ? raidRow() : { id: 'r1', ...current })),
      update: vi.fn(() => Promise.resolve({})),
    },
    project: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })),
    },
  };
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))) };
  return { service: new RaidService(prisma as never, rbac as never), prisma, rbac };
}
const member = { id: 'u1', isSystemAdmin: false };

describe('RaidService.update — đổi dự án', () => {
  it('đổi sang dự án đích mà user không có risk:manage ở đó -> 403, không ghi', async () => {
    const { service, prisma, rbac } = setup(['project:view']);
    await expect(service.update('w1', 'r1', { projectId: 'p2' }, member)).rejects.toMatchObject({ status: 403 });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p2');
    expect(prisma.raidItem.update).not.toHaveBeenCalled();
  });

  it('có risk:manage ở đích -> connect dự án đích', async () => {
    const { service, prisma } = setup(['risk:manage']);
    await service.update('w1', 'r1', { projectId: 'p2' }, member);
    expect(prisma.raidItem.update.mock.calls[0]![0]).toMatchObject({ data: { project: { connect: { id: 'p2' } } } });
  });

  it('gỡ khỏi dự án (về cấp workspace) kiểm quyền cấp workspace (projectId=null)', async () => {
    const { service, rbac } = setup([]);
    await expect(service.update('w1', 'r1', { projectId: null }, member)).rejects.toMatchObject({ status: 403 });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', null);
  });

  it('projectId không đổi -> không kiểm quyền thêm', async () => {
    const { service, rbac } = setup([]);
    await service.update('w1', 'r1', { projectId: 'p1', title: 'mới' }, member);
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('system admin bỏ qua kiểm quyền đích', async () => {
    const { service, rbac, prisma } = setup([]);
    await service.update('w1', 'r1', { projectId: 'p2' }, { id: 'u9', isSystemAdmin: true });
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
    expect(prisma.raidItem.update).toHaveBeenCalledTimes(1);
  });
});
```

`apps/api/src/modules/issue-links/issue-links.service.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { IssueLinksService } from './issue-links.service';

const end = (id: string, projectId: string, over: Record<string, unknown> = {}) => ({
  id, key: `K-${id}`, summary: id, status: { name: 'Todo', category: 'TODO' },
  projectId, reporterId: 'owner', assigneeId: null, createdById: 'owner', ...over,
});

function setup(perms: string[], issues: Record<string, ReturnType<typeof end>>) {
  const prisma = {
    issue: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(issues[where.id] ?? null)),
      findUnique: vi.fn(() => Promise.resolve({ project: { archivedAt: null } })),
    },
    linkType: { findFirst: vi.fn(() => Promise.resolve({ id: 'lt', name: 'n', outwardName: 'o', inwardName: 'i' })) },
    issueLink: { create: vi.fn(() => Promise.resolve({ id: 'l1', sourceIssueId: 'a', targetIssueId: 'b', linkTypeId: 'lt' })) },
  };
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))) };
  return { service: new IssueLinksService(prisma as never, rbac as never), prisma, rbac };
}
const input = { targetIssueId: 'b', linkTypeId: 'lt' };
const user = { id: 'u1', isSystemAdmin: false };

describe('IssueLinksService.create — link liên dự án', () => {
  it('khác dự án và không có quyền sửa ở dự án đích -> 403, không tạo link', async () => {
    const { service, prisma, rbac } = setup([], { a: end('a', 'p1'), b: end('b', 'p2') });
    await expect(service.create('w1', 'a', input, user)).rejects.toMatchObject({ status: 403 });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p2');
    expect(prisma.issueLink.create).not.toHaveBeenCalled();
  });

  it('khác dự án, có issue:edit ở đích -> tạo được', async () => {
    const { service, prisma } = setup(['issue:edit'], { a: end('a', 'p1'), b: end('b', 'p2') });
    await expect(service.create('w1', 'a', input, user)).resolves.toMatchObject({ id: 'l1' });
    expect(prisma.issueLink.create).toHaveBeenCalledTimes(1);
  });

  it('khác dự án, chỉ issue:edit:own ở đích: chỉ qua khi là chủ issue đích', async () => {
    const notOwner = setup(['issue:edit:own'], { a: end('a', 'p1'), b: end('b', 'p2') });
    await expect(notOwner.service.create('w1', 'a', input, user)).rejects.toMatchObject({ status: 403 });
    const owner = setup(['issue:edit:own'], { a: end('a', 'p1'), b: end('b', 'p2', { assigneeId: 'u1' }) });
    await expect(owner.service.create('w1', 'a', input, user)).resolves.toBeDefined();
  });

  it('cùng dự án -> không kiểm quyền thêm; system admin bỏ qua', async () => {
    const same = setup([], { a: end('a', 'p1'), b: end('b', 'p1') });
    await same.service.create('w1', 'a', input, user);
    expect(same.rbac.getEffectivePermissions).not.toHaveBeenCalled();
    const admin = setup([], { a: end('a', 'p1'), b: end('b', 'p2') });
    await admin.service.create('w1', 'a', input, { id: 'u9', isSystemAdmin: true });
    expect(admin.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });
});

describe('IssueLinksService.remove — link liên dự án', () => {
  function removeSetup(perms: string[], targetDeleted = false) {
    const s = setup(perms, {});
    (s.prisma as Record<string, unknown>).issueLink = {
      findFirst: vi.fn(() => Promise.resolve({
        id: 'l1', sourceIssueId: 'a', targetIssueId: 'b',
        source: { projectId: 'p1' }, target: { ...end('b', 'p2'), deletedAt: targetDeleted ? new Date() : null },
      })),
      delete: vi.fn(() => Promise.resolve({})),
    };
    return s;
  }

  it('khác dự án, không có quyền ở đích -> 403, không xoá', async () => {
    const s = removeSetup([]);
    await expect(s.service.remove('w1', 'l1', user)).rejects.toMatchObject({ status: 403 });
    expect((s.prisma as never as { issueLink: { delete: ReturnType<typeof vi.fn> } }).issueLink.delete).not.toHaveBeenCalled();
  });

  it('issue đích đã xoá mềm -> dọn link không cần quyền ở đích', async () => {
    const s = removeSetup([], true);
    await expect(s.service.remove('w1', 'l1', user)).resolves.toEqual({ success: true });
  });
});
```
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/modules/raid/raid.service.spec.ts src/modules/issue-links/issue-links.service.spec.ts` → **FAIL** (constructor/`update`/`create` chưa nhận `rbac`/`actor`).
- [ ] **Step 3: Implementation**
  - `raid.service.ts`: `constructor(private readonly prisma: PrismaService, private readonly rbac: RbacService)`; imports `RbacService` từ `'../rbac/rbac.service'`, `PERMISSIONS` từ `@tirapro/types`. Đổi khối `dto.projectId`:
    ```ts
    if (dto.projectId !== undefined) {
      const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
      if (projectId !== item.projectId) {
        await this.assertCanManageRisk(workspaceId, actor, projectId); // quyền Ở ĐÍCH (null = cấp workspace)
        if (projectId) await assertProjectWritable(this.prisma, projectId);
      }
      data.project = projectId ? { connect: { id: projectId } } : { disconnect: true };
    }
    ```
    ```ts
    private async assertCanManageRisk(workspaceId: string, actor: { id: string; isSystemAdmin: boolean }, projectId: string | null): Promise<void> {
      if (actor.isSystemAdmin) return;
      const perms = await this.rbac.getEffectivePermissions(actor.id, workspaceId, projectId);
      if (!perms.has(PERMISSIONS.RISK_MANAGE)) {
        throw new ForbiddenAppException(projectId
          ? 'Bạn không có quyền quản lý rủi ro ở dự án đích — hãy nhờ quản trị viên dự án đó cấp quyền hoặc chọn dự án khác'
          : 'Bạn không có quyền quản lý rủi ro cấp không gian làm việc — hãy giữ mục này trong dự án hiện tại');
      }
    }
    ```
    Controller: `update(@WorkspaceId() workspaceId, @CurrentUser() user: AuthUser, @Param('id') id, @Body(...) dto)` → `this.raid.update(workspaceId, id, dto, user)` (`remove`/`get` không đổi).
  - `issue-links.service.ts`: `constructor(prisma, private readonly rbac: RbacService)`; `type LinkActor = { id: string; isSystemAdmin: boolean }`; thêm
    ```ts
    const linkWriteSelect = { ...linkEndSelect, projectId: true, reporterId: true, assigneeId: true, createdById: true } satisfies Prisma.IssueSelect;
    ```
    `requireIssue` dùng `linkWriteSelect` (kiểu trả về mở rộng; `toLinkedIssue` vẫn chỉ đọc 4 trường cũ). Trong `create`: `const source = await this.requireIssue(...)`, `const target = ...`; sau `assertIssueWritable` thêm `if (target.projectId !== source.projectId) await this.assertCanEditAcrossProject(workspaceId, actor, target);`. Trong `remove`: mở rộng `select` của `findFirst` thành `{ id, sourceIssueId, targetIssueId, source: { select: { projectId: true } }, target: { select: { ...owners, id: true, projectId: true, deletedAt: true } } }`, rồi `if (!link.target.deletedAt && link.target.projectId !== link.source.projectId) await this.assertCanEditAcrossProject(workspaceId, actor, link.target);`.
    ```ts
    private async assertCanEditAcrossProject(workspaceId: string, actor: LinkActor, issue: IssueOwners & { projectId: string }): Promise<void> {
      if (actor.isSystemAdmin) return;
      const perms = await this.rbac.getEffectivePermissions(actor.id, workspaceId, issue.projectId);
      if (perms.has(PERMISSIONS.ISSUE_EDIT)) return;
      if (perms.has(`${PERMISSIONS.ISSUE_EDIT}:own`) && isIssueOwner(actor.id, issue)) return;
      throw new ForbiddenAppException('Bạn không có quyền sửa công việc ở dự án còn lại của liên kết — hãy nhờ quản trị viên dự án đó cấp quyền hoặc chọn công việc cùng dự án');
    }
    ```
    Controller: `create(@WorkspaceId() workspaceId, @CurrentUser() user: AuthUser, @Param('issueId') issueId, @Body(...) dto, @OwnOnly(ISSUE_EDIT) ownOnly)` (khối S1) → `this.links.create(workspaceId, issueId, dto, user)`; `remove` tương tự `this.links.remove(workspaceId, id, user)`.
- [ ] **Step 4:** chạy lại lệnh Step 2 → **PASS**. Gate: `pnpm --filter @tirapro/api typecheck`; `pnpm --filter @tirapro/api exec eslint src/modules/raid src/modules/issue-links`; `pnpm --filter @tirapro/api exec vitest run src/rbac-coverage.spec.ts src/own-only-coverage.spec.ts`.
- [ ] **Step 5: Commit** — `API: RAID đổi dự án và link liên dự án kiểm quyền ở dự án đích`

**Rủi ro/đụng chạm:** `issue-links.controller.ts`/`.service.ts` cùng S1 (làm S1 trước, S2 chỉ thêm tham số `user` + service). Release note: người chỉ có quyền ở một đầu của link giờ nhận 403 khi tạo/xoá link liên dự án; người quản lý RAID không thể "đẩy" mục sang dự án họ không quản lý. Không có migration.

---
### Task S3: `move()` qua workflow + phát `ISSUE_TRANSITIONED`; kiểm `assigneeId` và `sprintId`

**Mục tiêu:** Kéo thẻ sang cột/trạng thái khác (`POST /issues/:id/move` có `statusId`) tuân theo workflow, đặt/xoá `resolvedAt` đúng như `transition`, và phát `issue.transitioned` (automation, SLA, thông báo, watcher, Telegram nghe được). Gán người phụ trách chỉ cho thành viên workspace; gán sprint chỉ cho sprint của CHÍNH dự án của issue.

**Hiện trạng:**
- `apps/api/src/modules/issues/issues.service.ts:524-562` — `move()` ghi `statusId: input.statusId ?? current.statusId` thẳng, không `assertTransitionAllowed`, không đụng `resolutionId/resolvedAt`, chỉ phát `ISSUE_MOVED`:
  ```ts
  const row = await this.updateWithVersion(tx, id, workspaceId, input.version, {
    rank, statusId: input.statusId ?? current.statusId,
    sprintId: input.sprintId !== undefined ? input.sprintId : current.sprintId, updatedById: userId });
  ...
  this.events.emit(DOMAIN_EVENTS.ISSUE_MOVED, { issueId: id, projectId: updated.projectId, fromStatusId: current.statusId, toStatusId: updated.statusId, rank, sprintId: updated.sprintId, version: updated.version, actorId: userId });
  ```
  Trong khi `transition()` (`:495-522`) gọi `workflowIdOf` + `assertTransitionAllowed(workflowId, from, to)` (`:668-675`), tính `isDone` (`statusCategory`), ghi `resolutionId: isDone ? (input.resolutionId ?? undefined) : null` + `resolvedAt`, rồi phát `ISSUE_TRANSITIONED { issue: dto, actorId, fromStatusId }`. `bulkUpdate` (`:425-433, 460-466`) đã làm đúng cách này. Ai nghe `ISSUE_TRANSITIONED`: `rule-engine.service.ts:115`, `sla.service.ts:192`, `notifications.service.ts:259`, `watchers.service.ts:117`, `integrations.service.ts:183`, `realtime.gateway.ts:338` (phát lại `issue:updated`).
- `moveIssueSchema` (`packages/shared/src/schemas/issue.ts:76-85`) KHÔNG có `assigneeId`/`resolutionId`: `move` không đổi người phụ trách. Lỗ hổng `assigneeId` nằm ở `create` (`issues.service.ts:~170-176`, nhận `input.assigneeId`), `update` (`:375`) và `bulkUpdate` (`:423`): `assertMetaInWorkspace` (`:115-135`) không có `assigneeId` → có thể gán user của workspace khác. Cùng lỗ hổng ở import Jira: `apps/api/src/modules/import/import.service.ts:308-310` nạp `user.findMany` **toàn hệ thống** để map email → assigneeId.
- `sprintId`: `assertMetaInWorkspace` kiểm `sprint: { id, deletedAt: null, project: { workspaceId } }` (`:129`) — sprint của dự án khác cùng workspace lọt qua (gọi từ `create :174`, `update :364`, `bulkUpdate :423`, `move :527`).

**Files:**
- Modify: `apps/api/src/modules/issues/issues.service.ts:115-135` — `assertMetaInWorkspace` nhận thêm `projectId?` (ràng buộc sprint cùng dự án); thêm `assertAssigneeInWorkspace`; `:170-176` (create), `:364-367` (update), `:423` (bulkUpdate), `:524-562` (move).
- Modify: `apps/api/src/modules/import/import.service.ts:308-310` — chỉ nạp user là thành viên workspace.
- Test: `apps/api/src/modules/issues/issues.service.spec.ts` (thêm describe mới + sửa `makeService` `:~35`), `apps/api/src/modules/import/import.service.spec.ts` (thêm 1 ca).

**Interfaces:**
- Consumes: `assertTransitionAllowed`, `workflowIdOf`, `statusCategory`, `recordStatusChange` (private, sẵn có trong `IssuesService`).
- Produces: `move()` phát thêm `DOMAIN_EVENTS.ISSUE_TRANSITIONED` payload `{ issue: IssueDto, actorId, fromStatusId }` (cùng hình dạng như `transition`) SAU `ISSUE_MOVED`, chỉ khi `statusId` thật sự đổi. Lỗi mới: `InvalidTransitionException` (409 `INVALID_TRANSITION`) từ `move`; `BusinessRuleException` 422 cho assignee ngoài workspace; `NotFoundAppException` 404 cho sprint khác dự án (qua câu thông báo chung hiện có).

**Quyết định thiết kế:**
- `move()` chỉ chạy kiểm workflow/resolution khi `input.statusId && input.statusId !== current.statusId`; kéo cùng cột/xếp lại thứ tự không đụng workflow (giữ hành vi WIP hiện có). Kiểm workflow đặt TRƯỚC `resolveRank` (tránh rebalance rank rồi mới báo lỗi).
- Resolution: `move` không có `resolutionId` trong schema → sang DONE: `resolutionId: undefined` (giữ nguyên) + `resolvedAt: now`; ra khỏi DONE: `resolutionId: null, resolvedAt: null` — cùng quy ước `bulkUpdate`. Không thêm trường vào schema (ngoài phạm vi).
- Phát **cả hai** sự kiện (`ISSUE_MOVED` cho rank/board realtime, `ISSUE_TRANSITIONED` cho tự động hoá/thông báo). Hệ quả đã biết: gateway phát thêm `issue:updated` cùng dto (idempotent với OCC `version`), nên client nhận `issue:moved` + `issue:updated` cho cùng thao tác.
- `assigneeId`: dùng `workspaceMembership.findFirst({ workspaceId, userId })` (bảng này không có cột trạng thái — `schema.prisma:367-384`; cùng cách kiểm ở `raid.service.ts:169`, `automation/actions/issue-patch.ts:14`). Lỗi `BusinessRuleException` (422) cùng kiểu automation. Chỉ kiểm khi `assigneeId` truthy (bỏ gán `null` luôn hợp lệ). Không kiểm assignee mặc định = `project.leadId` ở `create`.
- `sprintId`: thêm `projectId` vào `assertMetaInWorkspace` thay vì hàm mới; các nơi gọi truyền `projectId` của issue/dự án. Vẫn giữ `project: { workspaceId }`.
- Import: giới hạn nạp user theo `workspaceMemberships: { some: { workspaceId } }` — người không phải thành viên thành "không có assignee" (như email không khớp) thay vì làm hỏng cả lô do lỗi mới.
- Ngoài phạm vi (ghi nhận): `move` đòi quyền `issue:transition` nhưng cũng đổi `sprintId` (hành vi sửa); không tách quyền ở đây. `SprintsService.complete(moveIncompleteTo.sprintId)` cũng nên kiểm cùng dự án — chưa xác minh, không làm.

- [ ] **Step 1: Viết test fail**

Trong `issues.service.spec.ts`, sửa `makeService` để mọi ca cũ có assignee `u2` hợp lệ (giữ được các test hiện có dùng `assigneeId: 'u2'`):
```ts
function makeService(tx: Record<string, unknown>, prismaExtra: Record<string, unknown> = {}) {
  const base = { workspaceMembership: { findFirst: vi.fn(() => Promise.resolve({ userId: 'u2' })) } };
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...base, ...tx, ...prismaExtra };
  // …phần còn lại giữ nguyên
```
Thêm describe mới (dùng `wipTx` từ describe WIP — chuyển `wipTx` ra phạm vi module nếu cần, hoặc khai báo describe mới NGAY SAU describe WIP và để cùng file; nếu hàm không truy cập được thì nâng nó lên đầu file):
```ts
describe('IssuesService.move — workflow, resolution, sự kiện', () => {
  const emitted = (events: { emit: ReturnType<typeof vi.fn> }) => events.emit.mock.calls.map((c) => c[0] as string);

  it('đổi trạng thái sai workflow => 409 INVALID_TRANSITION, không ghi, không emit, chưa tính rank', async () => {
    const tx = wipTx({ count: 0 });
    tx.workflowTransition.findFirst = vi.fn(() => Promise.resolve(null)) as never; // ép kiểu: mock gốc luôn trả {id}
    const { service, events } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2' })).rejects.toMatchObject({ status: 409 });
    expect(tx.workflowTransition.findFirst.mock.calls[0]![0]).toMatchObject({ where: { workflowId: 'wf', toStatusId: 's2' } });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('đổi trạng thái hợp lệ => emit ISSUE_MOVED rồi ISSUE_TRANSITIONED (có fromStatusId), history STATUS', async () => {
    const tx = wipTx({ count: 0 });
    const { service, events } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2' });
    expect(emitted(events)).toEqual([DOMAIN_EVENTS.ISSUE_MOVED, DOMAIN_EVENTS.ISSUE_TRANSITIONED]);
    expect(events.emit).toHaveBeenLastCalledWith(DOMAIN_EVENTS.ISSUE_TRANSITIONED, expect.objectContaining({ actorId: 'u1', fromStatusId: 's1' }));
    expect(tx.issueHistory.create).toHaveBeenCalledTimes(1);
  });

  it('sang trạng thái DONE => resolvedAt được đặt, resolutionId giữ nguyên (undefined); rời DONE => cả hai về null', async () => {
    const done = wipTx({ count: 0 });
    done.status.findUnique = vi.fn(() => Promise.resolve({ category: 'DONE' }));
    await makeService(done).service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2' });
    const d1 = done.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(d1[0].data.resolvedAt).toBeInstanceOf(Date);
    expect(d1[0].data.resolutionId).toBeUndefined();

    const open = wipTx({ count: 0 });
    await makeService(open).service.move('w1', 'u1', 'i1', { version: 3, statusId: 's2' });
    const d2 = open.issue.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(d2[0].data).toMatchObject({ resolvedAt: null, resolutionId: null });
  });

  it('không đổi trạng thái (xếp lại thứ tự / cùng statusId) => không tra workflow, chỉ emit ISSUE_MOVED', async () => {
    const tx = wipTx({ count: 0 });
    tx.issue.findFirstOrThrow = vi.fn(() => Promise.resolve(issueRow({ version: 4 })));
    const { service, events } = makeService(tx);
    await service.move('w1', 'u1', 'i1', { version: 3 });
    await service.move('w1', 'u1', 'i1', { version: 3, statusId: 's1' });
    expect(tx.workflowTransition.findFirst).not.toHaveBeenCalled();
    expect(emitted(events)).toEqual([DOMAIN_EVENTS.ISSUE_MOVED, DOMAIN_EVENTS.ISSUE_MOVED]);
  });
});

describe('IssuesService — assignee phải là thành viên, sprint phải cùng dự án', () => {
  const noMember = { workspaceMembership: { findFirst: vi.fn(() => Promise.resolve(null)) } };

  it('update(assigneeId) người ngoài workspace => 422, chưa ghi', async () => {
    const tx = { issue: { findFirst: vi.fn(() => Promise.resolve(issueRow())), updateMany: vi.fn(), findFirstOrThrow: vi.fn() }, issueHistory: { createMany: vi.fn() } };
    const { service } = makeService(tx, noMember);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, assigneeId: 'xx' })).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update(assigneeId: null) không cần kiểm thành viên', async () => {
    const tx = {
      issue: { findFirst: vi.fn(() => Promise.resolve(issueRow({ assigneeId: 'u2' }))), updateMany: vi.fn(() => Promise.resolve({ count: 1 })), findFirstOrThrow: vi.fn(() => Promise.resolve(issueRow({ version: 4 }))) },
      issueHistory: { createMany: vi.fn() },
    };
    const { service } = makeService(tx, noMember);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, assigneeId: null })).resolves.toBeDefined();
    expect(noMember.workspaceMembership.findFirst).not.toHaveBeenCalled();
  });

  it('bulkUpdate(patch.assigneeId) người ngoài workspace => 422, không mở transaction ghi', async () => {
    const tx = {
      issue: { findMany: vi.fn(() => Promise.resolve([issueRow({ id: 'a' })])), updateMany: vi.fn(), findFirstOrThrow: vi.fn() },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
    };
    const { service } = makeService(tx, noMember);
    await expect(
      service.bulkUpdate('w1', 'u1', { projectId: 'p1', items: [{ id: 'a', version: 3 }], patch: { assigneeId: 'xx' } }),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('move(sprintId) kiểm sprint theo CHÍNH dự án của issue; sprint dự án khác => 404, không ghi', async () => {
    const tx = wipTx({ count: 0 });
    tx.sprint.findFirst = vi.fn(() => Promise.resolve(null)); // không có sprint sp9 trong dự án p1
    const { service } = makeService(tx);
    await expect(service.move('w1', 'u1', 'i1', { version: 3, sprintId: 'sp9' })).rejects.toMatchObject({ status: 404 });
    expect(tx.sprint.findFirst.mock.calls[0]![0]).toMatchObject({ where: { id: 'sp9', projectId: 'p1', deletedAt: null } });
    expect(tx.issue.updateMany).not.toHaveBeenCalled();
  });

  it('update(sprintId) cũng ràng buộc cùng dự án (projectId của issue hiện tại)', async () => {
    const sprintFind = vi.fn(() => Promise.resolve(null));
    const tx = { issue: { findFirst: vi.fn(() => Promise.resolve(issueRow())), updateMany: vi.fn(), findFirstOrThrow: vi.fn() }, sprint: { findFirst: sprintFind } };
    const { service } = makeService(tx);
    await expect(service.update('w1', 'u1', 'i1', { version: 3, sprintId: 'sp9' })).rejects.toMatchObject({ status: 404 });
    expect((sprintFind.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({ id: 'sp9', projectId: 'p1' });
  });
});
```
Ca cho import (`import.service.spec.ts`): thêm assertion vào một test import hiện có (hoặc test mới) rằng `prisma.user.findMany` được gọi với `where: { workspaceMemberships: { some: { workspaceId: <id> } } }`:
```ts
expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceMemberships: { some: { workspaceId: 'w1' } } } }));
```
(dùng đúng tên biến/`workspaceId` của fixture trong spec đó.)
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/modules/issues/issues.service.spec.ts src/modules/import/import.service.spec.ts` → **FAIL** (move không gọi workflow/không emit TRANSITIONED; assignee/sprint chưa kiểm).
- [ ] **Step 3: Implementation** (`issues.service.ts`)
  1. `assertMetaInWorkspace`: kiểu `m` thêm `projectId?: string`; dòng sprint:
     ```ts
     if (m.sprintId) jobs.push(db.sprint.findFirst({
       where: { id: m.sprintId, deletedAt: null, project: { workspaceId }, ...(m.projectId ? { projectId: m.projectId } : {}) },
       select: { id: true } }));
     ```
     và sửa câu lỗi: `'… sprint (phải cùng dự án) … không thuộc không gian làm việc này — hãy chọn lại từ danh sách gợi ý'`.
  2. Thêm
     ```ts
     /** Người được giao phải là thành viên workspace — chặn gán user của tenant khác (cùng quy ước automation `assertMember`). */
     private async assertAssigneeInWorkspace(workspaceId: string, userId: string | null | undefined, db: Prisma.TransactionClient = this.prisma): Promise<void> {
       if (!userId) return;
       const m = await db.workspaceMembership.findFirst({ where: { workspaceId, userId }, select: { userId: true } });
       if (!m) throw new BusinessRuleException('Người được giao không thuộc không gian làm việc này — hãy chọn một thành viên khác');
     }
     ```
  3. Gọi: `createCore` (sau `assertMetaInWorkspace`, truyền `projectId: project.id` vào `m`, thêm `await this.assertAssigneeInWorkspace(workspaceId, input.assigneeId, db)`); `update` (`projectId: current.projectId` vào `m` + `assertAssigneeInWorkspace(workspaceId, input.assigneeId)`); `bulkUpdate` (`{ priorityId, sprintId, projectId }` + `assertAssigneeInWorkspace(workspaceId, patch.assigneeId)`); `move` (`{ sprintId: input.sprintId, projectId: current.projectId }`).
  4. `move()` — thay phần thân (giữ nguyên `resolveRank`, WIP, transaction):
     ```ts
     const statusChanged = !!input.statusId && input.statusId !== current.statusId;
     let toDone = false;
     if (statusChanged) {
       // Kéo sang cột khác là đổi trạng thái: đi đúng workflow như transition()/bulkUpdate().
       await this.assertTransitionAllowed(await this.workflowIdOf(current.projectId), current.statusId, input.statusId!);
       toDone = (await this.statusCategory(input.statusId!)) === 'DONE';
     }
     // …resolveRank + wip (không đổi)…
     const row = await this.updateWithVersion(tx, id, workspaceId, input.version, {
       rank,
       statusId: input.statusId ?? current.statusId,
       sprintId: input.sprintId !== undefined ? input.sprintId : current.sprintId,
       updatedById: userId,
       ...(statusChanged ? { resolutionId: toDone ? undefined : null, resolvedAt: toDone ? new Date() : null } : {}),
     });
     ```
     Sau transaction: giữ `emit(ISSUE_MOVED, …)` rồi thêm
     ```ts
     if (statusChanged) {
       this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, { issue: dto, actorId: userId, fromStatusId: current.statusId });
     }
     ```
  5. `import.service.ts:308`: `this.prisma.user.findMany({ where: { workspaceMemberships: { some: { workspaceId } } }, select: { id: true, email: true } })` (biến `workspaceId` đã có trong phạm vi hàm — đọc lại ngữ cảnh `:290-312` để dùng đúng tên).
- [ ] **Step 4:** chạy lại lệnh Step 2 → **PASS**. Gate: `pnpm --filter @tirapro/api typecheck`; `pnpm --filter @tirapro/api exec eslint src/modules/issues src/modules/import`; `pnpm --filter @tirapro/api exec vitest run src/infra/prisma/soft-delete-coverage.spec.ts src/modules/automation` (automation gọi `issues.update/transition` — phải vẫn pass).
- [ ] **Step 5: Commit** — `API: move() qua workflow/resolution và phát ISSUE_TRANSITIONED, kiểm assignee là thành viên và sprint cùng dự án`

**Rủi ro/đụng chạm:** `issues.service.ts` + `issues.service.spec.ts` (cùng S1, S6 — làm sau S1, trước S6). `issues.controller.ts` không đổi trong S3. Thay đổi hành vi cần release note: (1) kéo thẻ sai workflow giờ 409 (trước đây lọt); web board cần hiển thị lỗi này như `transition` (kiểm trong QA, không đổi FE); (2) client nhận thêm `issue:updated` sau `issue:moved`; (3) quy tắc automation "gán cho trưởng dự án" mà lead không phải thành viên workspace nay báo lỗi ở `AutomationRun` thay vì gán lặng lẽ; (4) import Jira: assignee không phải thành viên → để trống. Rủi ro test: mọi spec cũ có `assigneeId: 'u2'` dựa vào mặc định thêm ở `makeService`.

---
### Task S4: Webhook automation — chặn dải IPv6 chuyển tiếp, ghim mọi IP, DNS trong timeout, mã hoá secret

**Mục tiêu:** Webhook của automation không thể trỏ vào IPv4 nội bộ qua 6to4/Teredo; kết nối thử mọi IP công khai đã kiểm (không chết chỉ vì IP đầu không tới được); tên miền phân giải chậm cũng bị cắt trong 5 giây; khoá bí mật ký HMAC không còn lưu/trả về dạng chữ thường (lưu mã hoá, API trả `********`, giải mã chỉ lúc gửi).

**Hiện trạng:**
- `apps/api/src/modules/automation/actions/webhook.ts:14-23` — `BLOCKED` thiếu `2002::/16` (6to4, nhúng IPv4 tuỳ ý) và `2001::/32` (Teredo). Danh sách IPv6 hiện có: `::/96, fc00::/7, fe80::/10, fec0::/10, 64:ff9b::/96, ff00::/8`.
- `:53-73` `resolveSafeTarget` lấy `found[0]` (`:70`) → `SafeTarget { url, address, family }`; `:109` `new Agent({ connect: { lookup: pinnedLookup(address, family) } })` chỉ trả đúng 1 địa chỉ.
- `:92` `await resolveSafeTarget(a.url)` chạy TRƯỚC `new AbortController()`/`setTimeout` (`:105-108`) → `dns.lookup` (`:62`) không bị `TIMEOUT_MS = 5000` chi phối.
- Secret: `webhookAction.secret` (`packages/shared/src/schemas/automation-rule.schema.ts:43-47`) lưu nguyên văn trong cột JSON `AutomationRule.actions` (`rules.service.ts:106,128`), nằm cả trong cache Redis `automation:rules:{ws}` (`:61-70`) và `toDto` (`:219`) trả lại nguyên cho mọi người xem quy tắc; `runWebhook` ký bằng `a.secret` (`webhook.ts:101`). FE `RuleEditor.tsx:127,156,416` đọc/gửi `secret` như chuỗi thường.
- Helper mã hoá hiện có của integrations: `TelegramService.encrypt/decrypt` (`integrations/telegram.service.ts:85-141`, AES-256-GCM, định dạng `iv:tag:ct`, khoá `INTEGRATION_ENCRYPTION_KEY`, khoá cũ `…_PREVIOUS`; `IntegrationsModule` export `TelegramService`). `INTEGRATION_ENCRYPTION_KEY` luôn có giá trị (mặc định dev, bắt buộc đổi ở production — `env.validation.ts:82-105`) nên `encrypt` không bao giờ ném ở dev.

**Files:**
- Modify: `apps/api/src/modules/automation/actions/webhook.ts` — dải chặn, `resolveSafeTarget(raw, signal?)` trả `addresses`, `pinnedLookup(addresses)`, timeout bao cả DNS, giải mã secret qua `ctx.deps.openSecret`.
- Create: `apps/api/src/modules/automation/webhook-secret.ts` — hằng + hàm thuần seal/open/mask.
- Modify: `apps/api/src/modules/automation/actions/types.ts:7-12` — `ActionDeps.openSecret(stored: string): string | null`.
- Modify: `apps/api/src/modules/automation/rules.service.ts` (constructor `:37-40`, `create :96-111`, `update :113-132`, `toDto :209-225`) — inject `TelegramService`, seal khi ghi, mask khi trả, thêm `openSecret`.
- Modify: `apps/api/src/modules/automation/rule-engine.service.ts:229` — `deps.openSecret = (s) => this.rules.openSecret(s)`.
- Modify: `apps/api/src/modules/automation/automation.module.ts` — `imports: [IssuesModule, CommentsModule, IntegrationsModule]`.
- Create: `apps/api/scripts/seal-webhook-secrets.mjs` — backfill một lần cho dữ liệu cũ (plaintext → `enc:v1:…`); Modify: `apps/api/package.json:23` thêm script `"automation:seal-secrets": "node scripts/seal-webhook-secrets.mjs"`.
- Modify: `apps/api/scripts/rekey-integrations.mjs` — mã hoá lại cả secret webhook `enc:v1:` khi đổi khoá (nếu không, đổi khoá làm webhook mất chữ ký).
- Modify: `docs/DEPLOY.md:~90` — thêm bước chạy `automation:seal-secrets` sau khi nâng cấp (cạnh mục `integrations:rekey`).
- Test: `apps/api/src/modules/automation/actions/webhook.spec.ts` (sửa + thêm), `apps/api/src/modules/automation/actions/webhook-resolve.spec.ts` (mới, mock `node:dns/promises`), `apps/api/src/modules/automation/webhook-secret.spec.ts` (mới), `apps/api/src/modules/automation/rules.service.spec.ts` (mở rộng), `apps/api/src/modules/automation/rule-engine.service.spec.ts` (không đổi nếu `rules` mock không bị gọi `openSecret` — kiểm khi chạy).

**Interfaces:**
- Produces: `resolveSafeTarget(raw: string, signal?: AbortSignal): Promise<SafeTarget>` với `SafeTarget = { url: URL; address: string; family: 4|6; addresses: Array<{ address: string; family: 4|6 }> }` (giữ `address/family` = phần tử đầu để tương thích test cũ); `pinnedLookup(addresses: Array<{address:string; family:4|6}>)` (**đổi chữ ký** — chỉ `webhook.ts` + spec dùng); `RulesService.openSecret(stored: string): string | null`; hằng `WEBHOOK_SECRET_PREFIX = 'enc:v1:'`, `WEBHOOK_SECRET_MASK = '********'`.
- Hành vi API: `POST/PUT /automation/rules` nhận `secret` dạng chữ như cũ; mọi response (`list/get/create/update`) trả `secret: '********'` nếu có. Gửi lại `********` khi sửa quy tắc = "giữ khoá cũ" (theo **vị trí** action webhook trong mảng `actions`). Bỏ trống = xoá khoá. FE **không phải sửa** (ô password hiển thị `********` và gửi lại nguyên).
- Consumes: `TelegramService.encrypt(plain)` / `.decrypt(enc): string | null`.

**Quyết định thiết kế:**
- Dải thêm: `2002::/16`, `2001::/32` (đúng yêu cầu). Giữ nguyên các dải còn lại; không tự thêm dải khác.
- Ghim **tất cả** địa chỉ công khai đã kiểm (đã lọc: nếu BẤT KỲ địa chỉ nào nội bộ thì vẫn từ chối cả tên miền như hiện tại). `lookup` của undici trả danh sách khi `all:true`, kèm `autoSelectFamily: true` để Node thử lần lượt (happy-eyeballs); khi `all:false` trả phần tử đầu.
- Timeout: một `AbortController` + `setTimeout(5000)` bọc **cả** phân giải DNS lẫn kết nối/phản hồi (5 giây tổng). Vì `dns.lookup` không huỷ được, dùng `Promise.race` với sự kiện `abort` (lệnh DNS treo vẫn chạy nền nhưng không giữ request).
- Mã hoá bằng **tiền tố `enc:v1:` + ciphertext của `TelegramService`**: `TelegramService.decrypt` coi chuỗi không có đúng 3 phần là plaintext cũ, nên một secret thuần chứa dấu `:` sẽ bị hiểu nhầm; tiền tố phân biệt tuyệt đối "đã mã hoá" và "dữ liệu cũ chưa mã hoá". Dữ liệu cũ (không tiền tố) vẫn gửi được (đọc như plaintext) cho tới khi chạy script backfill hoặc người dùng lưu lại quy tắc.
- Backfill bằng **script** (không phải migration SQL): khoá mã hoá nằm trong env của app, SQL không có; không có thay đổi schema Prisma → không cần `prisma migrate`. Script idempotent, hỗ trợ `--dry-run`, cùng khuôn `rekey-integrations.mjs`.
- Không giải mã được (đổi khoá, dữ liệu hỏng): `runWebhook` **ném** `BusinessRuleException('Khoá bí mật của webhook không giải mã được — hãy nhập lại khoá trong quy tắc')`, KHÔNG gửi thiếu chữ ký (đồng nhất tinh thần S5: không âm thầm hạ cấp).
- `update`: action webhook có `secret === '********'` lấy lại giá trị đã lưu ở cùng chỉ số mảng của quy tắc hiện tại; nếu vị trí đó không phải webhook có khoá → 422 "Hãy nhập lại khoá bí mật". Mọi `secret` khác (kể cả chuỗi bắt đầu bằng `enc:v1:` do client tự gửi) đều coi là plaintext và mã hoá lại — client không thể nhét ciphertext tuỳ ý.
- Cache Redis/bộ nhớ chứa bản đã mã hoá (vì cache dựng từ cột DB) → không lộ secret.

- [ ] **Step 1: Viết test fail**

`webhook.spec.ts` — cập nhật/thêm:
```ts
// isPrivateAddress: thêm vào danh sách "nội bộ/đặc biệt"
'2002:7f00:1::1', '2002:a9fe:a9fe::', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001::1',
// và danh sách công khai (đảm bảo không chặn nhầm 2001:db8 / 2001:4860):
'2001:4860:4860::8888', '2606:4700::1111',

// pinnedLookup nhận danh sách
describe('pinnedLookup — chống DNS rebinding', () => {
  const list = [{ address: '8.8.8.8', family: 4 as const }, { address: '2606:4700::1111', family: 6 as const }];
  it('all:true trả cả danh sách đã kiểm, bất kể tên miền; all:false trả phần tử đầu', () => {
    const lookup = pinnedLookup(list);
    const all = vi.fn(); lookup('evil.example', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, list);
    const one = vi.fn(); lookup('evil.example', {}, one);
    expect(one).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });
});

// resolveSafeTarget trả addresses
it('IP công khai được chấp nhận và trả đúng địa chỉ để ghim', async () => {
  const t = await resolveSafeTarget('https://8.8.8.8/hook');
  expect(t).toMatchObject({ address: '8.8.8.8', family: 4, addresses: [{ address: '8.8.8.8', family: 4 }] });
});

// ctx của describe runWebhook: bổ sung deps giải mã
const ctx = {
  dryRun: false, trigger: 'ISSUE_CREATED', rule: { id: 'r1', name: 'R' },
  deps: { openSecret: (s: string) => (s.startsWith('enc:v1:') ? s.slice(7).split('').reverse().join('') : s) },
  issue: { … giữ nguyên … },
} as never;

it('secret đã mã hoá được giải mã trước khi ký HMAC', async () => {
  await withServer(200, async (url, seen) => {
    await runWebhook(ctx, { type: 'webhook', url, secret: 'enc:v1:k' }); // openSecret giả: đảo chuỗi → 'k'
    const expected = `sha256=${createHmac('sha256', 'k').update(seen.body ?? '').digest('hex')}`;
    expect(seen.headers?.['x-tirapro-signature']).toBe(expected);
  });
});

it('secret không giải mã được => lỗi rõ ràng, KHÔNG gửi request', async () => {
  const bad = { ...(ctx as object), deps: { openSecret: () => null } } as never;
  await withServer(200, async (url, seen) => {
    await expect(runWebhook(bad, { type: 'webhook', url, secret: 'enc:v1:xx' })).rejects.toThrow(/không giải mã được/);
    expect(seen.body).toBeUndefined();
  });
});
```
`webhook-resolve.spec.ts` (mới) — DNS chậm bị cắt và ghim đủ địa chỉ:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: (...a: unknown[]) => lookup(...a) }));
import { resolveSafeTarget, runWebhook } from './webhook';

beforeEach(() => lookup.mockReset());

describe('resolveSafeTarget — tên miền', () => {
  it('ghim TẤT CẢ địa chỉ công khai, giữ thứ tự', async () => {
    lookup.mockResolvedValue([{ address: '2606:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }]);
    const t = await resolveSafeTarget('https://hook.example.com/x');
    expect(t.addresses).toEqual([{ address: '2606:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }]);
    expect(t).toMatchObject({ address: '2606:4700::1111', family: 6 });
  });

  it('một trong các địa chỉ là nội bộ => từ chối cả tên miền', async () => {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    await expect(resolveSafeTarget('https://mixed.example.com/')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });

  it('địa chỉ 6to4 nhúng IPv4 nội bộ bị chặn', async () => {
    lookup.mockResolvedValue([{ address: '2002:7f00:1::1', family: 6 }]);
    await expect(resolveSafeTarget('https://sixtofour.example.com/')).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });

  it('DNS không bao giờ trả lời => bị cắt khi signal abort, báo lỗi phân giải', async () => {
    lookup.mockReturnValue(new Promise(() => undefined));
    const ac = new AbortController();
    const p = resolveSafeTarget('https://slow.example.com/', ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', message: expect.stringContaining('phân giải') });
  });
});

describe('runWebhook — timeout bao cả DNS', () => {
  it('DNS treo => lỗi trong ~5s (dùng fake timers), không treo vô hạn', async () => {
    vi.useFakeTimers();
    try {
      lookup.mockReturnValue(new Promise(() => undefined));
      const ctx = { dryRun: false, trigger: 'ISSUE_CREATED', rule: { id: 'r', name: 'R' }, deps: { openSecret: (s: string) => s }, issue: {} } as never;
      const p = runWebhook(ctx, { type: 'webhook', url: 'https://slow.example.com/hook' });
      const assertion = expect(p).rejects.toThrow(/5 giây|phân giải/);
      await vi.advanceTimersByTimeAsync(5001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
```
`webhook-secret.spec.ts` (mới):
```ts
import { describe, expect, it } from 'vitest';
import { maskWebhookActions, openSecret, sealWebhookActions, WEBHOOK_SECRET_MASK } from './webhook-secret';

const cipher = {
  encrypt: (p: string) => `E[${p}]`,
  decrypt: (e: string) => (e.startsWith('E[') ? e.slice(2, -1) : null),
};

describe('webhook-secret', () => {
  it('seal mã hoá secret mới, không đụng action khác', () => {
    const out = sealWebhookActions(cipher, [{ type: 'webhook', url: 'https://a', secret: 'k1' }, { type: 'notify' }], undefined) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:E[k1]');
    expect(out[1]).toEqual({ type: 'notify' });
  });

  it('secret là mask => lấy lại giá trị đã lưu cùng chỉ số; sai vị trí => 422', () => {
    const prev = [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:E[old]' }];
    const out = sealWebhookActions(cipher, [{ type: 'webhook', url: 'https://a', secret: WEBHOOK_SECRET_MASK }], prev) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:E[old]');
    expect(() => sealWebhookActions(cipher, [{ type: 'notify' }, { type: 'webhook', url: 'https://a', secret: WEBHOOK_SECRET_MASK }], prev))
      .toThrowError(expect.objectContaining({ code: 'BUSINESS_RULE_VIOLATION' }) as never);
  });

  it('client gửi sẵn "enc:v1:…" vẫn bị coi là plaintext và mã hoá lại', () => {
    const out = sealWebhookActions(cipher, [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:E[evil]' }], undefined) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:E[enc:v1:E[evil]]');
  });

  it('bỏ trống secret => xoá khoá', () => {
    const out = sealWebhookActions(cipher, [{ type: 'webhook', url: 'https://a' }], [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:E[old]' }]) as Array<Record<string, unknown>>;
    expect('secret' in out[0]!).toBe(false);
  });

  it('mask thay mọi secret bằng ******** ; open: mã hoá → giải mã, plaintext cũ → trả nguyên, hỏng → null', () => {
    expect((maskWebhookActions([{ type: 'webhook', url: 'u', secret: 'enc:v1:E[k]' }, { type: 'webhook', url: 'u' }]) as Array<Record<string, unknown>>).map((a) => a.secret))
      .toEqual([WEBHOOK_SECRET_MASK, undefined]);
    expect(openSecret(cipher, 'enc:v1:E[k]')).toBe('k');
    expect(openSecret(cipher, 'legacy:plain')).toBe('legacy:plain');
    expect(openSecret(cipher, 'enc:v1:zzz')).toBeNull();
  });
});
```
`rules.service.spec.ts` — `setup()` thêm tham số thứ 3 và 3 ca:
```ts
const cipher = { encrypt: (p: string) => `E[${p}]`, decrypt: (e: string) => (e.startsWith('E[') ? e.slice(2, -1) : null) };
// trong setup(): new RulesService(prisma as never, redis as never, cipher as never)

it('create: secret webhook được mã hoá khi ghi DB và bị che trong response', async () => {
  const { service, prisma } = setup();
  const dto = await service.create('w1', 'u1', { name: 'n', trigger: 'ISSUE_CREATED', triggerConfig: {}, conditions: [], actions: [{ type: 'webhook', url: 'https://x.test/h', secret: 'k' }] });
  const stored = (prisma.automationRule.create.mock.calls[0] as unknown as [{ data: { actions: Array<{ secret: string }> } }])[0].data.actions[0]!.secret;
  expect(stored).toBe('enc:v1:E[k]');
  expect((dto.actions[0] as { secret?: string }).secret).toBe('********');
});

it('update: gửi lại ******** giữ khoá cũ; gửi khoá mới thì mã hoá lại', async () => {
  const { service, prisma } = setup();
  prisma.automationRule.findFirst.mockResolvedValue(row({ actions: [{ type: 'webhook', url: 'https://x.test/h', secret: 'enc:v1:E[old]' }] }));
  await service.update('w1', 'r1', { actions: [{ type: 'webhook', url: 'https://x.test/h', secret: '********' }] });
  expect((prisma.automationRule.updateMany.mock.calls[0] as unknown as [{ data: { actions: Array<{ secret: string }> } }])[0].data.actions[0]!.secret).toBe('enc:v1:E[old]');
  await service.update('w1', 'r1', { actions: [{ type: 'webhook', url: 'https://x.test/h', secret: 'moi' }] });
  expect((prisma.automationRule.updateMany.mock.calls[1] as unknown as [{ data: { actions: Array<{ secret: string }> } }])[0].data.actions[0]!.secret).toBe('enc:v1:E[moi]');
});

it('cache engine chỉ chứa bản đã mã hoá; openSecret giải mã được cả bản mã hoá lẫn plaintext cũ', () => {
  const { service } = setup();
  expect(service.openSecret('enc:v1:E[k]')).toBe('k');
  expect(service.openSecret('plain-cu')).toBe('plain-cu');
});
```
(`prisma.automationRule.findFirst` trong `setup()` là `vi.fn(() => Promise.resolve(row()))` — gọi `.mockResolvedValue` được; thêm kiểu `as ReturnType<typeof vi.fn>` nếu TS than.)
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/modules/automation` → **FAIL** (thiếu `webhook-secret.ts`, `pinnedLookup` kiểu cũ, 6to4 chưa chặn, `RulesService` không có `openSecret`, DNS không bị cắt).
- [ ] **Step 3: Implementation**
  1. `webhook.ts` — dải chặn: thêm `['2002::', 16], ['2001::', 32]` vào mảng IPv6 (kèm chú thích `// 6to4 và Teredo nhúng IPv4 tuỳ ý`).
  2. `SafeTarget` thêm `addresses`. Thay `resolveSafeTarget`:
     ```ts
     function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined, onAbort: () => Error): Promise<T> {
       if (!signal) return p;
       return new Promise<T>((resolve, reject) => {
         if (signal.aborted) return reject(onAbort());
         const h = () => reject(onAbort());
         signal.addEventListener('abort', h, { once: true });
         p.then(resolve, reject).finally(() => signal.removeEventListener('abort', h));
       });
     }

     export async function resolveSafeTarget(raw: string, signal?: AbortSignal): Promise<SafeTarget> {
       /* …kiểm URL/protocol/user:pass giữ nguyên… */
       const host = url.hostname.replace(/^\[|\]$/g, '');
       const found = isIP(host)
         ? [{ address: host, family: isIP(host) }]
         : await raceAbort(lookup(host, { all: true }).catch(() => []), signal,
             () => new BusinessRuleException('Không phân giải được địa chỉ webhook trong thời gian cho phép — hãy kiểm tra lại tên miền'));
       if (!found.length) throw new BusinessRuleException('Không phân giải được địa chỉ webhook — hãy kiểm tra lại tên miền');
       /* …chặn nội bộ giữ nguyên… */
       const addresses = found.map((r) => ({ address: r.address, family: (r.family === 6 ? 6 : 4) as 4 | 6 }));
       return { url, address: addresses[0]!.address, family: addresses[0]!.family, addresses };
     }
     ```
  3. `pinnedLookup(addresses)`:
     ```ts
     export function pinnedLookup(addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>) {
       return (_h: string, options: { all?: boolean }, cb: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void): void => {
         if (options?.all) cb(null, addresses.map((a) => ({ ...a })));
         else cb(null, addresses[0]!.address, addresses[0]!.family);
       };
     }
     ```
  4. `runWebhook`: tạo `ac` + `timer` ĐẦU HÀM; `let dispatcher: Agent | undefined;` mọi thứ (resolve, dry-run, fetch) nằm trong một `try { … } catch { … } finally { clearTimeout(timer); await dispatcher?.close().catch(() => undefined); }`; `resolveSafeTarget(a.url, ac.signal)`; sau khi có `addresses`: `dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses), autoSelectFamily: true } })`. Secret: `const secret = a.secret ? ctx.deps.openSecret(a.secret) : undefined; if (a.secret && secret == null) throw new BusinessRuleException('Khoá bí mật của webhook không giải mã được — hãy nhập lại khoá trong quy tắc');` rồi ký bằng `secret`. Câu thông báo timeout ở `catch` giữ nguyên (`AbortError` → "không phản hồi trong 5 giây").
  5. `webhook-secret.ts`:
     ```ts
     import { BusinessRuleException } from '../../common/exceptions/app.exception';
     export const WEBHOOK_SECRET_PREFIX = 'enc:v1:';
     export const WEBHOOK_SECRET_MASK = '********';
     export interface SecretCipher { encrypt(plain: string): string; decrypt(enc: string): string | null }
     type Action = Record<string, unknown>;
     const isWebhook = (a: unknown): a is Action & { secret?: string } => !!a && typeof a === 'object' && (a as Action).type === 'webhook';

     export const openSecret = (c: SecretCipher, stored: string): string | null =>
       stored.startsWith(WEBHOOK_SECRET_PREFIX) ? c.decrypt(stored.slice(WEBHOOK_SECRET_PREFIX.length)) : stored; // không tiền tố = dữ liệu cũ (plaintext)

     /** Mã hoá secret webhook trước khi lưu. `previous` = actions hiện có (để giữ khoá khi client gửi lại mask). */
     export function sealWebhookActions(c: SecretCipher, actions: unknown[], previous: unknown[] | undefined): unknown[] {
       return actions.map((a, i) => {
         if (!isWebhook(a) || a.secret === undefined || a.secret === '') {
           if (isWebhook(a)) { const { secret: _drop, ...rest } = a; return rest; }
           return a;
         }
         if (a.secret === WEBHOOK_SECRET_MASK) {
           const old = previous?.[i];
           if (isWebhook(old) && typeof old.secret === 'string' && old.secret) return { ...a, secret: old.secret };
           throw new BusinessRuleException('Khoá bí mật của webhook đã thay đổi — hãy nhập lại khoá bí mật');
         }
         return { ...a, secret: WEBHOOK_SECRET_PREFIX + c.encrypt(a.secret) };
       });
     }

     export const maskWebhookActions = (actions: unknown[]): unknown[] =>
       actions.map((a) => (isWebhook(a) && a.secret ? { ...a, secret: WEBHOOK_SECRET_MASK } : a));
     ```
     (ESLint: bỏ biến `_drop` bằng cách dựng object không có `secret` — ví dụ `Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'secret'))`.)
  6. `rules.service.ts`: constructor thêm `private readonly cipher: TelegramService` (import `../integrations/telegram.service`); `create`: `actions: sealWebhookActions(this.cipher, input.actions, undefined) as Prisma.InputJsonValue`; `update`: `...(input.actions !== undefined ? { actions: sealWebhookActions(this.cipher, input.actions, current.actions as unknown[]) as Prisma.InputJsonValue } : {})`; `toDto`: `actions: maskWebhookActions(r.actions as unknown[]) as Array<Record<string, unknown>>`; thêm `openSecret(stored: string): string | null { return openSecret(this.cipher, stored); }`. `automation.module.ts` import `IntegrationsModule`.
  7. `actions/types.ts`: `ActionDeps` thêm `openSecret(stored: string): string | null;`. `rule-engine.service.ts:229`: thêm `openSecret: (s: string) => this.rules.openSecret(s)` vào `deps`.
  8. `apps/api/scripts/seal-webhook-secrets.mjs` (khuôn `rekey-integrations.mjs`: cùng `derive/encrypt`, cần `DATABASE_URL` + `INTEGRATION_ENCRYPTION_KEY`, cờ `--dry-run`):
     ```js
     // đọc mọi AutomationRule; với mỗi action {type:'webhook', secret} mà secret là chuỗi KHÔNG bắt đầu bằng 'enc:v1:'
     //   → secret = 'enc:v1:' + encrypt(secret); ghi lại actions bằng prisma.automationRule.update (bỏ qua khi --dry-run)
     // in thống kê: đã mã hoá sẵn / vừa mã hoá / không có secret; thoát code 0
     ```
     Thêm vào `rekey-integrations.mjs` một vòng thứ hai trên `automationRule`: với secret `enc:v1:` thử giải bằng khoá hiện tại, rồi khoá cũ, ghi lại bằng khoá hiện tại (cùng thống kê `ok/rekeyed/failed`). Thêm script npm và đoạn hướng dẫn trong `docs/DEPLOY.md`.
- [ ] **Step 4:** chạy lại lệnh Step 2 → **PASS**. Gate: `pnpm --filter @tirapro/api typecheck`; `pnpm --filter @tirapro/api exec eslint src/modules/automation`; `pnpm --filter @tirapro/api exec vitest run src/modules/integrations src/rbac-coverage.spec.ts`; chạy thử script trên DB dev: `pnpm --filter @tirapro/api run automation:seal-secrets -- --dry-run` rồi chạy thật và lặp lại (lần hai báo "đã mã hoá sẵn", idempotent).
- [ ] **Step 5: Commit** — `Automation: webhook chặn 6to4/Teredo, ghim mọi IP đã kiểm, timeout bao cả DNS, mã hoá khoá bí mật (kèm script backfill)`

**Rủi ro/đụng chạm:** nhóm S chỉ S4 sửa các file automation/webhook; `package.json` (apps/api) và `docs/DEPLOY.md` chỉ S4 sửa trong nhóm (kiểm nhóm khác nếu có task đụng `DEPLOY.md`). **Thay đổi hành vi / release note:** (1) API không còn trả khoá webhook thật (thấy `********`); client bên thứ ba đọc `actions[].secret` sẽ không lấy lại được khoá; (2) phải chạy `automation:seal-secrets` sau nâng cấp (không bắt buộc ngay — dữ liệu cũ vẫn chạy); (3) đổi `INTEGRATION_ENCRYPTION_KEY` giờ ảnh hưởng cả webhook → dùng `integrations:rekey`; (4) undici `connect.autoSelectFamily` yêu cầu Node ≥ 22 (đã là `engines` của repo). Không có migration Prisma.

---
### Task S5: Token bot không giải mã được → báo lỗi rõ ràng, không rơi về bot toàn cục

**Mục tiêu:** Khi `botToken` của một tích hợp Telegram không giải mã được (đổi `INTEGRATION_ENCRYPTION_KEY`, dữ liệu hỏng), tin nhắn của workspace đó KHÔNG bị gửi qua bot toàn cục của hệ thống; tích hợp chuyển trạng thái `ERROR` (huy hiệu "Lỗi" sẵn có ở web), nút "Gửi thử" và "Chạy ngay" digest báo "token không dùng được".

**Hiện trạng:**
- `TelegramService.decrypt` (`apps/api/src/modules/integrations/telegram.service.ts:121-135`) trả `null` khi hỏng (đã sửa ở commit `f132288`). Nhưng người gọi coi `null` = "không có token riêng → dùng bot toàn cục":
  - `integrations.service.ts:262-268` `resolveToken` → `return this.telegram.decrypt(cfg.botToken)` (null); dùng ở `test()` (`:168`, rồi `telegram.send(token=null, …)` → dùng `globalBotToken`, `telegram.service.ts:57-63`) và `fanout()` (`:242-247`).
  - `digests.service.ts:276-285` bản sao `resolveToken` y hệt; `send()` (`:253-272`) gửi bằng bot toàn cục.
  → tin nhắn nội bộ của workspace có thể lọt vào chat qua bot của hệ thống (rò rỉ + gửi sai danh tính), và không ai biết token đã hỏng.
- `IntegrationStatus` đã có `ERROR` (`schema.prisma:1330-1334`); `fanout` chỉ chọn `status: ACTIVE` (`integrations.service.ts:233-236`); FE `TelegramSection.tsx:17-29` đã hiển thị nhãn "Lỗi". Chưa có endpoint sửa token (chỉ tạo/xoá).

**Files:**
- Modify: `apps/api/src/modules/integrations/telegram.service.ts` — thêm `resolveBotToken(config)` + hằng thông điệp.
- Modify: `apps/api/src/modules/integrations/integrations.service.ts:160-180 (test), 228-252 (fanout), 262-268 (resolveToken), thêm reportUnusableToken` .
- Modify: `apps/api/src/modules/digests/digests.service.ts:101-110 (run), 253-285 (send/resolveToken), 336-345 (sendScheduled), constructor` — dùng `resolveBotToken`, báo lỗi.
- Test: `apps/api/src/modules/integrations/telegram.service.spec.ts` (thêm), `apps/api/src/modules/integrations/integrations.service.spec.ts` (mới), `apps/api/src/modules/digests/digests.service.spec.ts` (mới).

**Interfaces:**
- Produces: `TelegramService.resolveBotToken(config: Prisma.JsonValue): BotTokenResolution` với `type BotTokenResolution = { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' }`; `export const TELEGRAM_TOKEN_UNUSABLE_MESSAGE`; `IntegrationsService.reportUnusableToken(integrationId: string): Promise<void>` (public — digests dùng). Hành vi API: `POST /integrations/:id/test` và `POST /digests/:id/run` trả 422 `BUSINESS_RULE_VIOLATION` với thông điệp trên khi token hỏng.
- Consumes: `TelegramService.decrypt`, `IntegrationStatus.ERROR`.

**Quyết định thiết kế:**
- Phân biệt 3 trạng thái ở MỘT chỗ (`resolveBotToken`) thay vì hai bản `resolveToken` trùng nhau: không có `botToken` → `global` (đúng thiết kế BYO/global); có `botToken` giải được → `own`; có `botToken` nhưng `decrypt` trả `null` → `unusable`.
- `fanout`/digest: tích hợp `unusable` bị bỏ qua (không gửi gì) và được đánh dấu `ERROR` bằng `updateMany({ where: { id, status: ACTIVE }, data: { status: ERROR } })` — chỉ log cảnh báo ở lần chuyển trạng thái đầu (không spam log mỗi sự kiện; từ đó `fanout` không chọn nó nữa).
- Phục hồi: không có endpoint sửa token nên dùng `test()` làm "kiểm lại": token dùng được và đang `ERROR` → chuyển lại `ACTIVE`; token vẫn hỏng → giữ/đặt `ERROR` và ném 422 hướng dẫn "xoá và thêm lại tích hợp với token mới (hoặc đặt khoá cũ vào INTEGRATION_ENCRYPTION_KEY_PREVIOUS rồi chạy integrations:rekey)".
- Digest `run()` (người dùng bấm tay): ném 422 (FE đã hiển thị `apiErrorMessage` ở `onError`, không cần sửa web). Digest theo cron: không ném, chỉ đánh dấu `ERROR` + `warn`.
- Không đổi nghĩa cờ `useGlobal`; không thêm cột DB.

- [ ] **Step 1: Viết test fail**

`telegram.service.spec.ts` (thêm; dùng `make`, `encryptWith`, `OLD_KEY`, `NEW_KEY` sẵn có):
```ts
describe('TelegramService.resolveBotToken', () => {
  it.each([[{}], [null], [{ botToken: null, useGlobal: true }], [{ botToken: '' }], [[]]])(
    'không có botToken riêng (%j) → global', (cfg) => {
      expect(make(NEW_KEY).resolveBotToken(cfg as never)).toEqual({ kind: 'global' });
    });

  it('botToken giải mã được → own, trả token đã giải', () => {
    const svc = make(NEW_KEY);
    expect(svc.resolveBotToken({ botToken: svc.encrypt('123:ABC') })).toEqual({ kind: 'own', token: '123:ABC' });
  });

  it('botToken mã hoá bằng khoá không còn → unusable (KHÔNG rơi về global)', () => {
    const svc = make(NEW_KEY);
    vi.spyOn((svc as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    expect(svc.resolveBotToken({ botToken: encryptWith(OLD_KEY, '123:ABC') })).toEqual({ kind: 'unusable' });
    expect(svc.resolveBotToken({ botToken: 'zz:yy:xx' })).toEqual({ kind: 'unusable' });
  });
});
```
`integrations.service.spec.ts` (mới):
```ts
import { describe, expect, it, vi } from 'vitest';
import { IntegrationsService } from './integrations.service';

const integ = (over: Record<string, unknown> = {}) => ({
  id: 'g1', workspaceId: 'w1', type: 'TELEGRAM', name: 'n', config: { botToken: 'x' }, status: 'ACTIVE',
  createdById: null, createdAt: new Date(), updatedAt: new Date(),
  channels: [{ externalId: 'c1', events: [], projectId: null, isEnabled: true }], ...over,
});

function setup(resolution: { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' }, row = integ()) {
  const prisma = {
    integration: {
      findMany: vi.fn(() => Promise.resolve([row])),
      findFirst: vi.fn(() => Promise.resolve(row)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    integrationChannel: { findMany: vi.fn(() => Promise.resolve(row.channels)) },
  };
  const telegram = { resolveBotToken: vi.fn(() => resolution), send: vi.fn(() => Promise.resolve(true)), available: vi.fn(() => true) };
  return { service: new IntegrationsService(prisma as never, telegram as never), prisma, telegram };
}
const payload = { issue: { workspaceId: 'w1', key: 'P-1', summary: 's', projectId: 'p1', status: { name: 'Done' } } };

describe('IntegrationsService — token không dùng được', () => {
  it('fanout: unusable → KHÔNG gửi (không rơi về bot toàn cục), đánh dấu ERROR đúng 1 lần có điều kiện ACTIVE', async () => {
    const { service, prisma, telegram } = setup({ kind: 'unusable' });
    await service.onIssueUpdated(payload as never);
    expect(telegram.send).not.toHaveBeenCalled();
    expect(prisma.integration.updateMany).toHaveBeenCalledWith({ where: { id: 'g1', status: 'ACTIVE' }, data: { status: 'ERROR' } });
  });

  it('fanout: own → gửi bằng token riêng; global → gửi với token null', async () => {
    const own = setup({ kind: 'own', token: 'T' });
    await own.service.onIssueUpdated(payload as never);
    expect(own.telegram.send).toHaveBeenCalledWith('T', 'c1', expect.any(String));
    const glob = setup({ kind: 'global' });
    await glob.service.onIssueUpdated(payload as never);
    expect(glob.telegram.send).toHaveBeenCalledWith(null, 'c1', expect.any(String));
  });

  it('test(): unusable → 422 nêu rõ token không dùng được, không gửi, đặt ERROR', async () => {
    const { service, prisma, telegram } = setup({ kind: 'unusable' });
    await expect(service.test('w1', 'g1')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('không dùng được') });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(prisma.integration.updateMany).toHaveBeenCalledWith({ where: { id: 'g1', status: 'ACTIVE' }, data: { status: 'ERROR' } });
  });

  it('test(): token dùng được và đang ERROR → tự phục hồi về ACTIVE', async () => {
    const { service, prisma } = setup({ kind: 'own', token: 'T' }, integ({ status: 'ERROR' }));
    await service.test('w1', 'g1');
    expect(prisma.integration.updateMany).toHaveBeenCalledWith({ where: { id: 'g1', status: 'ERROR' }, data: { status: 'ACTIVE' } });
  });
});
```
`digests.service.spec.ts` (mới):
```ts
import { describe, expect, it, vi } from 'vitest';
import { DigestsService } from './digests.service';

function setup(resolution: { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' }) {
  const prisma = {
    reportSubscription: {
      findFirst: vi.fn(() => Promise.resolve({ id: 's1', workspaceId: 'w1', projectId: null, channelId: 'ch1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    integrationChannel: {
      findFirst: vi.fn(() => Promise.resolve({ externalId: 'c1', integration: { id: 'g1', type: 'TELEGRAM', status: 'ACTIVE', config: { botToken: 'x' } } })),
    },
  };
  const telegram = { resolveBotToken: vi.fn(() => resolution), send: vi.fn(() => Promise.resolve(true)) };
  const integrations = { reportUnusableToken: vi.fn(() => Promise.resolve()) };
  const service = new DigestsService(prisma as never, telegram as never, {} as never, integrations as never);
  vi.spyOn(service, 'buildDigest').mockResolvedValue('tổng kết');
  return { service, prisma, telegram, integrations };
}

describe('DigestsService.run — token không dùng được', () => {
  it('unusable → 422, không gửi bằng bot toàn cục, đánh dấu tích hợp lỗi', async () => {
    const { service, telegram, integrations } = setup({ kind: 'unusable' });
    await expect(service.run('w1', 's1')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('không dùng được') });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(integrations.reportUnusableToken).toHaveBeenCalledWith('g1');
  });

  it('own/global → gửi như cũ', async () => {
    const { service, telegram } = setup({ kind: 'own', token: 'T' });
    await expect(service.run('w1', 's1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith('T', 'c1', 'tổng kết');
  });
});
```
(`requireSubscription` đọc `reportSubscription.findFirst` — nếu hàm dùng `where` khác thì chỉnh mock cho khớp khi viết; mock trả đủ `id/workspaceId/projectId/channelId`.)
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/modules/integrations src/modules/digests` → **FAIL** (`resolveBotToken`/`reportUnusableToken` chưa có; `DigestsService` chưa nhận `integrations`).
- [ ] **Step 3: Implementation**
  1. `telegram.service.ts`:
     ```ts
     export const TELEGRAM_TOKEN_UNUSABLE_MESSAGE =
       'Token bot của tích hợp Telegram này không dùng được (khoá mã hoá đã đổi hoặc dữ liệu hỏng) — hãy xoá rồi thêm lại tích hợp với token mới, hoặc đặt khoá cũ vào INTEGRATION_ENCRYPTION_KEY_PREVIOUS rồi chạy integrations:rekey';
     export type BotTokenResolution = { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' };

     /** Phân biệt "không có token riêng" (dùng bot toàn cục) với "có token riêng nhưng hỏng" (KHÔNG được rơi về toàn cục). */
     resolveBotToken(config: Prisma.JsonValue): BotTokenResolution {
       if (!config || typeof config !== 'object' || Array.isArray(config)) return { kind: 'global' };
       const botToken = (config as Record<string, unknown>).botToken;
       if (typeof botToken !== 'string' || botToken.length === 0) return { kind: 'global' };
       const token = this.decrypt(botToken);
       return token === null ? { kind: 'unusable' } : { kind: 'own', token };
     }
     ```
     (import `type { Prisma } from '@prisma/client'`.)
  2. `integrations.service.ts`: xoá `resolveToken`/`asTelegramConfig` nếu không còn dùng (giữ `asTelegramConfig` nếu chỗ khác cần — grep); `fanout`:
     ```ts
     const res = this.telegram.resolveBotToken(integration.config);
     if (res.kind === 'unusable') { await this.reportUnusableToken(integration.id); continue; }
     const token = res.kind === 'own' ? res.token : null;
     ```
     ```ts
     /** Token riêng không giải mã được: ngừng gửi và đánh dấu ERROR (chỉ chuyển từ ACTIVE, log một lần). */
     async reportUnusableToken(integrationId: string): Promise<void> {
       const { count } = await this.prisma.integration.updateMany({ where: { id: integrationId, status: IntegrationStatus.ACTIVE }, data: { status: IntegrationStatus.ERROR } });
       if (count > 0) this.logger.warn(`Tích hợp ${integrationId}: token bot không dùng được — đã chuyển sang trạng thái ERROR`);
     }
     ```
     `test()`: sau `requireIntegration`:
     ```ts
     const res = this.telegram.resolveBotToken(integration.config);
     if (res.kind === 'unusable') { await this.reportUnusableToken(integration.id); throw new BusinessRuleException(TELEGRAM_TOKEN_UNUSABLE_MESSAGE); }
     if (integration.status === IntegrationStatus.ERROR) {
       await this.prisma.integration.updateMany({ where: { id: integration.id, status: IntegrationStatus.ERROR }, data: { status: IntegrationStatus.ACTIVE } });
     }
     const token = res.kind === 'own' ? res.token : null;
     ```
     (phần gửi/đếm giữ nguyên.)
  3. `digests.service.ts`: constructor thêm `private readonly integrations: IntegrationsService` (import từ `../integrations/integrations.service`; `DigestsModule` đã import `IntegrationsModule` nên không đổi module). Đổi `send` trả `Promise<{ sent: boolean; tokenUnusable: boolean }>`: sau kiểm type/status
     ```ts
     const res = this.telegram.resolveBotToken(integration.config);
     if (res.kind === 'unusable') { await this.integrations.reportUnusableToken(integration.id); return { sent: false, tokenUnusable: true }; }
     return { sent: await this.telegram.send(res.kind === 'own' ? res.token : null, channel.externalId, text), tokenUnusable: false };
     ```
     (các nhánh `return false` cũ thành `{ sent: false, tokenUnusable: false }`.) `run()`: `const { sent, tokenUnusable } = await this.send(...); if (tokenUnusable) throw new BusinessRuleException(TELEGRAM_TOKEN_UNUSABLE_MESSAGE);` (đặt TRƯỚC khi cập nhật `lastRunAt`). `sendScheduled`: `await this.send(...)` bỏ qua kết quả (đã đánh dấu + log trong `reportUnusableToken`). Xoá `resolveToken` của digests.
- [ ] **Step 4:** chạy lại lệnh Step 2 → **PASS**. Gate: `pnpm --filter @tirapro/api typecheck`; `pnpm --filter @tirapro/api exec eslint src/modules/integrations src/modules/digests`.
- [ ] **Step 5: Commit** — `Tích hợp: token bot không giải mã được thì báo lỗi và đánh dấu ERROR thay vì gửi qua bot toàn cục (integrations + digests)`

**Rủi ro/đụng chạm:** không trùng file với task khác trong nhóm S. `TelegramService` là provider dùng chung (`IntegrationsModule` exports) — chỉ thêm method. Release note: tích hợp có token hỏng sẽ hiện "Lỗi" và ngừng gửi (trước đây âm thầm gửi bằng bot toàn cục); khắc phục = đặt khoá cũ + `integrations:rekey`, hoặc xoá và thêm lại tích hợp, rồi bấm "Gửi thử" để về `ACTIVE`. Không có migration.

---

### Task S6: Xoá mềm project phải ẩn issue của nó ở `/issues/:key`, search, list

**Mục tiêu:** Sau khi xoá mềm dự án, issue của dự án đó không còn truy cập được qua `GET /issues/:key`, `GET /issues` (không kèm `projectId`), `GET /search` (JQL và text) và mọi route theo `issue id` (404), thay vì vẫn hiện như đang sống.

**Hiện trạng:**
- `ProjectsService.remove` (`apps/api/src/modules/projects/projects.service.ts:204-212`) chỉ đặt `Project.deletedAt`; issue giữ `deletedAt: null`.
- Các điểm đọc cấp workspace không nhìn `project.deletedAt`:
  - `IssuesService.getByKey` (`issues.service.ts:347-351`): `where: { workspaceId, key, deletedAt: null }`. Route `GET /issues/:key` chỉ có `@Permissions(PROJECT_VIEW)` không `@ProjectRef` (`issues.controller.ts:44-48`) → không qua `assertProjectInWorkspace`.
  - `IssuesService.list` (`:275-290`): `where` không lọc project; khi không truyền `projectId` thì guard không kiểm dự án (`@ProjectRef('query','projectId')`, `raw` undefined → null).
  - `IssuesService.query` (`:301-325`): `scope = { AND: [{ workspaceId, deletedAt: null }, where] }` — mọi `/search` (JQL/text/rawIds) và saved filter đi qua đây; full-text raw SQL (`search/fulltext.ts:58-66`) chỉ lọc `i."deletedAt" IS NULL` rồi ids được lọc lại bởi `query()`.
  - Mọi route theo issue id dùng `@ProjectRef('issue', …)`; resolver (`rbac/rbac.service.ts:28`) `issue: { where: inWorkspace }` = `{ id, workspaceId }` — không loại issue của dự án đã xoá → các route đó vẫn chạy.
- Route theo dự án (`@ProjectRef('param'|'body'|'query','projectId')`) đã 404 nhờ `assertProjectInWorkspace` (`rbac.service.ts:~212-219`, có `deletedAt: null`) nên không cần sửa.

**Files:**
- Modify: `apps/api/src/modules/issues/issues.service.ts:275-290 (list), 309 (query scope), 347-351 (getByKey)` — thêm điều kiện `project: { deletedAt: null }` qua một hằng dùng chung.
- Modify: `apps/api/src/modules/rbac/rbac.service.ts:12-13, 28` — resolver `issue` loại issue của dự án đã xoá mềm.
- Test: `apps/api/src/modules/issues/issues.service.spec.ts` (thêm), `apps/api/src/modules/rbac/rbac.service.spec.ts:~90-96` (sửa assertion `where` của ca `issue` + thêm ca).

**Interfaces:**
- Produces: hằng nội bộ `LIVE_PROJECT: Prisma.IssueWhereInput = { project: { deletedAt: null } }` trong `issues.service.ts`. Hành vi: 404 `Công việc` cho `GET /issues/:key` của dự án đã xoá; `list`/`query` trả tập đã lọc; route `@ProjectRef('issue',…)` → 404 `Tài nguyên` ở guard.
- Không đổi DTO/route.

**Quyết định thiết kế:**
- **Lọc lúc đọc** (join `project.deletedAt`) thay vì xoá mềm dây chuyền issue khi xoá project: nhỏ nhất, không phải có đường khôi phục/đối soát, không đụng `Project` restore (hiện chưa có). Chi phí: một join thêm trên `Issue` (đã có `projectId` index).
- Ba điểm của `IssuesService` (`list`, `query`, `getByKey`) cùng dùng `LIVE_PROJECT` để search/saved filter/JQL được phủ hết (vì mọi đường search qua `query()`); không đổi SQL full-text (ids rác của dự án đã xoá bị `query()` lọc lại; chỉ chiếm một ít chỗ trong top 200 — chấp nhận, ghi chú).
- Sửa resolver `issue` của guard để phủ MỌI route theo issue id (comments, worklog, links, attachments…) một chỗ; không sửa các resolver `viaProject` khác (sprint/board/label…) vì route của chúng đi theo dự án hoặc đã ít rủi ro — ngoài phạm vi.
- Không đụng module khác đọc issue theo workspace (`dev.service.ts:338` tra theo `key`, `goals.service.ts:289`, analytics…): liệt kê ở "Ngoài phạm vi", làm khi cần.

- [ ] **Step 1: Viết test fail**

`issues.service.spec.ts`:
```ts
describe('IssuesService — dự án đã xoá mềm', () => {
  const projectFilter = { project: { deletedAt: null } };

  it('getByKey: lọc project.deletedAt:null; không thấy => 404', async () => {
    const findFirst = vi.fn(() => Promise.resolve(null));
    const { service } = makeService({ issue: { findFirst } });
    await expect(service.getByKey('w1', 'P-TASK-1')).rejects.toMatchObject({ status: 404 });
    expect((findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({ workspaceId: 'w1', key: 'P-TASK-1', deletedAt: null, ...projectFilter });
  });

  it('list (không projectId): lọc project.deletedAt:null', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService({ issue: { findMany } });
    await service.list('w1', {}, undefined, 50);
    expect((findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toMatchObject({ workspaceId: 'w1', deletedAt: null, ...projectFilter });
  });

  it('query (JQL/search) và query theo rawIds (full-text) đều ghép project.deletedAt:null vào scope', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const { service } = makeService({ issue: { findMany } });
    await service.query('w1', {}, [], undefined, 10);
    await service.query('w1', {}, [], undefined, 10, ['a']);
    for (const call of findMany.mock.calls as unknown as Array<[{ where: unknown }]>) {
      expect(JSON.stringify(call[0].where)).toContain('"project":{"deletedAt":null}');
    }
  });
});
```
`rbac.service.spec.ts` — sửa ca `issue` (`where` mới) và thêm ca:
```ts
expect(prisma.issue.findFirst).toHaveBeenCalledWith({
  where: { id: 'I1', workspaceId: 'W1', project: { deletedAt: null } },
  select: { projectId: true },
});
...
it('issue của dự án đã xoá mềm => findFirst không khớp => resolveProjectId trả null (guard 404)', async () => {
  const { svc, prisma } = setup();
  prisma.issue.findFirst.mockResolvedValue(null);
  await expect(svc.resolveProjectId('W1', 'issue', 'I-cua-du-an-da-xoa')).resolves.toBeNull();
});
```
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/modules/issues/issues.service.spec.ts src/modules/rbac/rbac.service.spec.ts` → **FAIL** (`where` chưa có điều kiện project).
- [ ] **Step 3: Implementation**
  - `issues.service.ts` (gần các hằng đầu file):
    ```ts
    /** Issue của dự án đã xoá mềm là "không tồn tại" với mọi truy vấn đọc cấp workspace (getByKey/list/search). */
    const LIVE_PROJECT: Prisma.IssueWhereInput = { project: { deletedAt: null } };
    ```
    `list`: thêm `...LIVE_PROJECT,` vào `where`. `query`: `const scope = { AND: [{ workspaceId, deletedAt: null, ...LIVE_PROJECT }, where] }`. `getByKey`: `where: { workspaceId, key, deletedAt: null, ...LIVE_PROJECT }`. (Chuỗi `deletedAt` vẫn có trong tham số nên `soft-delete-coverage.spec` pass.)
  - `rbac.service.ts`: thêm cạnh `inWorkspace`:
    ```ts
    // Issue của dự án đã xoá mềm = không tồn tại (mọi route theo issue id → guard trả 404).
    const issueInLiveProject = (value: string, workspaceId: string) => ({ id: value, workspaceId, project: { deletedAt: null } });
    ```
    và `issue: { model: 'issue', where: issueInLiveProject, select: projectIdOnly, project: ownProjectId },`.
- [ ] **Step 4:** chạy lại lệnh Step 2 → **PASS**. Gate: `pnpm --filter @tirapro/api typecheck`; `pnpm --filter @tirapro/api exec eslint src/modules/issues src/modules/rbac`; `pnpm --filter @tirapro/api exec vitest run src/infra/prisma/soft-delete-coverage.spec.ts src/modules/search src/rbac-coverage.spec.ts`. Kiểm tay trên DB dev (DoD của nhóm): tạo dự án + 1 issue, `DELETE /projects/:id`, rồi `GET /issues/<KEY>` → 404, `GET /search?mode=text&q=<từ trong summary>` không còn kết quả, `GET /issues` không còn issue đó.
- [ ] **Step 5: Commit** — `API: xoá mềm dự án thì issue của nó biến mất khỏi /issues/:key, list, search và các route theo issue id`

**Rủi ro/đụng chạm:** `issues.service.ts` + `issues.service.spec.ts` (cùng S1, S3 — làm cuối trong ba task); `rbac.service.ts`/`.spec.ts` (không task nào khác của nhóm S sửa; S1 chỉ sửa `rbac.module.ts`). Hành vi: route `@ProjectRef('issue',…)` của issue thuộc dự án đã xoá trả 404 `Tài nguyên` (trước đây vẫn chạy). Link/trích dẫn tới issue của dự án đã xoá ở nơi khác (`IssueLink`, `parentId/epicId`, DTO liên quan) KHÔNG bị ẩn trong task này.

---

#### Bảng đụng chạm

| File | Task sửa | Ghi chú / thứ tự |
|---|---|---|
| `apps/api/src/modules/issues/issues.service.ts` | S1, S3, S6 | Tuần tự **S1 → S3 → S6** (S1: `assertOwnsIssue`/`assertCanTransition`/chữ ký `transition`,`move`,`bulkUpdate`; S3: `assertMetaInWorkspace`, `move`, `create/update/bulkUpdate`; S6: `list/query/getByKey`). Các nhóm khác sửa file này (rank, `bulkUpdate` ISSUE_ASSIGNED…) cũng phải xếp tuần tự theo Global Constraints. |
| `apps/api/src/modules/issues/issues.service.spec.ts` | S1, S3, S6 | Cùng thứ tự; S3 đổi `makeService` (mặc định `workspaceMembership.findFirst`) — S1 viết trước nên các test `:own` của S1 phải vẫn pass sau S3. |
| `apps/api/src/modules/issues/issues.controller.ts` | S1 | Chỉ S1 (transition/move). |
| `apps/api/src/modules/issue-links/issue-links.controller.ts`, `issue-links.service.ts` | S1, S2 | **S1 → S2**. |
| `apps/api/src/modules/rbac/rbac.module.ts` | S1 | |
| `apps/api/src/modules/rbac/rbac.service.ts`, `rbac.service.spec.ts` | S6 | |
| `apps/api/src/modules/import/import.service.ts` | S3 | Nhóm khác sửa import (nếu có) cần xếp sau. |
| `apps/api/src/modules/automation/rules.service.ts`, `rule-engine.service.ts`, `actions/types.ts`, `automation.module.ts` | S4 | Chỉ S4 trong nhóm S; kiểm xung đột với nhóm khác sửa automation. |
| `apps/api/src/modules/integrations/telegram.service.ts` (+spec), `integrations.service.ts`, `digests/digests.service.ts` | S5 | S4 chỉ **dùng** `TelegramService.encrypt/decrypt`, không sửa file này → S4 và S5 độc lập. |
| `apps/api/package.json`, `apps/api/scripts/rekey-integrations.mjs`, `docs/DEPLOY.md` | S4 | |
| `apps/api/src/own-only-coverage.spec.ts` | S1 | Spec mới nhưng ràng buộc mọi controller: task của nhóm khác thêm route `ISSUE_EDIT`/`ISSUE_TRANSITION` mới phải gắn `@OwnOnly` (hoặc thêm vào `EXEMPT`). |

**Thứ tự đề nghị:** S1 → S2 → S3 → S6 (chuỗi đụng `issues.*`/`issue-links.*`), S4 và S5 làm song song/bất kỳ lúc nào (không đụng file các task còn lại). Không task nào có migration Prisma; chỉ S4 cần chạy script backfill dữ liệu sau triển khai.

#### Ngoài phạm vi / không làm

- **`issue:transition:own` không tồn tại trong catalog** (`packages/types/src/permissions.ts:63-117` chỉ có `ISSUE_EDIT_OWN`, `COMMENT_EDIT_OWN`; không vai trò hệ thống nào có transition `:own`). Vì vậy phần `@OwnOnly(ISSUE_TRANSITION)` của S1 chỉ là phòng thủ chiều sâu; không thêm quyền mới vào catalog (cần seed + giao diện vai trò).
- `POST /ai/suggest-assignee` (`AI_USE`+`ISSUE_EDIT`, `ai.controller.ts:66`) không gắn `@OwnOnly` vì thao tác theo `projectId` trong body, không theo một issue — nằm trong `EXEMPT` của spec phản chiếu.
- `DELETE /issues/:id` (`ISSUE_DELETE`): catalog không có `issue:delete:own`, không cần.
- Rò rỉ đọc liên dự án: `GET /issues/:issueId/links` trả `otherIssue` (key, summary, status) của dự án khác mà không kiểm quyền xem dự án đó (`issue-links.service.ts:140-150`) — cùng họ với S2 nhưng follow-up không nêu; đề xuất tách task riêng.
- `DigestsService.send` tra `integrationChannel.findFirst({ where: { id: channelId, isEnabled } })` KHÔNG ràng buộc `workspaceId` (`digests.service.ts:257-260`) và `create/update` digest không kiểm `channelId` thuộc workspace — có thể gửi digest vào kênh của workspace khác. Chưa có trong danh sách follow-up; ghi nhận để người phụ trách quyết định.
- `SprintsService.complete(moveIncompleteTo.sprintId)` và các nơi khác nhận `sprintId` có thể cũng cần ràng buộc cùng dự án — chưa xác minh, S3 chỉ sửa đường `IssuesService`.
- Các điểm đọc issue cấp workspace khác không đi qua `IssuesService` (`dev.service.ts:338`, `goals.service.ts:289`, analytics, export…) chưa lọc `project.deletedAt` — S6 chỉ phủ `getByKey/list/query` + resolver guard theo đúng follow-up.
- Không sửa FE trong nhóm này (ẩn nút theo `:own`, hiển thị mask khoá webhook, thông báo token lỗi): mọi thay đổi hành vi FE nhìn thấy đều đi qua thông điệp lỗi API sẵn có hoặc `********` round-trip.

## Nhóm C — Đúng đắn / dữ liệu

#### Nhóm C — Đúng đắn / dữ liệu (C1–C9)

Quy ước chạy lệnh trong mọi task: API `pnpm --filter @tirapro/api exec vitest run <file>`; web `pnpm --filter @tirapro/web exec vitest run <file>`; typecheck `pnpm --filter <pkg> typecheck`; lint `pnpm --filter @tirapro/api lint` (api có `--max-warnings 0`) / `pnpm --filter @tirapro/web lint`.

---

### Task C1: Burndown dùng "category cuối thắng" như CFD

**Mục tiêu:** đường "còn lại" của burndown (ngày chưa có snapshot) không còn lệch/âm khi chuỗi `IssueHistory` STATUS bị đứt; kết quả nhất quán với CFD (`newCategory` của sự kiện cuối cùng quyết định issue đang DONE hay không).
**Hiện trạng:** `apps/api/src/modules/analytics/analytics.service.ts:397-403` cộng/trừ điểm theo delta `oldCategory`:
```ts
if (ev.newCategory === 'DONE' && ev.oldCategory !== 'DONE') done += pts;
else if (ev.oldCategory === 'DONE' && ev.newCategory !== 'DONE') done -= pts;
```
Nếu một lần đổi status không ghi history (hoặc `oldCategory` sai), `done` có thể bị trừ 2 lần / cộng 2 lần → `remaining` sai, `Math.max(...,0)` chỉ che đáy. CFD đã sửa tại `analytics.service.ts:452-457` (không dùng `oldCategory`).
**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.service.ts:394-404` — thay delta bằng bản đồ trạng thái-hiện-tại theo issue.
- Test: `apps/api/src/modules/analytics/analytics.service.spec.ts` (thêm `it` vào `describe('AnalyticsService.burndown ...')` ở dòng 359; helper `make(snaps)` tại 361 đang cố định `findMany` history → cho `make` nhận tham số `history` tuỳ chọn).
**Interfaces:** Consumes: `issueHistory.findMany` (không đổi query). Produces: không đổi `BurndownReport`.
**Quyết định thiết kế:** giữ nguyên truy vấn history (đã `orderBy occurredAt asc`, lọc `sprintId`+`field STATUS`) — chỉ đổi cách tích luỹ: `doneNow: Map<issueId, boolean>`; mỗi sự kiện đặt `isDone = newCategory === 'DONE'` rồi cộng/trừ `pts` CHỈ khi trạng thái boolean của issue đổi. Sự kiện `newCategory == null` bị bỏ qua (CFD cũng lọc `newCategory IS NOT NULL`). Không động tới nhánh snapshot (đã là nguồn chính). Issue không còn trong sprint (`points` không có id) vẫn `pts = 0` như cũ.
- [ ] Step 1: Viết test fail. Thêm vào describe burndown (mở rộng `make(snaps, history?)`: `findMany: vi.fn(() => Promise.resolve(history ?? [<mặc định cũ>]))`):
```ts
it('chuỗi lịch sử đứt (oldCategory sai) => vẫn theo category cuối, không cộng/trừ đôi và không âm', async () => {
  const { service } = make([], [
    // a (6đ): vào DONE, rồi "DONE→DONE" với oldCategory sai (vd admin đổi category Status) — delta cũ trừ nhầm
    { issueId: 'a', oldCategory: 'IN_PROGRESS', newCategory: 'DONE', occurredAt: at('2026-10-02T10:00:00Z') },
    { issueId: 'a', oldCategory: 'IN_PROGRESS', newCategory: 'DONE', occurredAt: at('2026-10-03T10:00:00Z') }, // đứt: lẽ ra old = DONE
    // b (4đ): mở lại nhưng chưa từng ghi lần vào DONE
    { issueId: 'b', oldCategory: 'DONE', newCategory: 'IN_PROGRESS', occurredAt: at('2026-10-02T11:00:00Z') },
  ]);
  const r = await service.burndown('w1', 'sp1');
  // 01: 10; 02: a done (6) ⇒ 4; 03: a vẫn done (không cộng lần 2) ⇒ 4; b chưa từng DONE nên không bị trừ ⇒ không âm
  expect(r.series.map((x) => x.remaining)).toEqual([10, 4, 4, 4]);
});
it('đóng rồi mở lại trong sprint => remaining quay lại', async () => {
  const { service } = make([], [
    { issueId: 'a', oldCategory: 'IN_PROGRESS', newCategory: 'DONE', occurredAt: at('2026-10-02T10:00:00Z') },
    { issueId: 'a', oldCategory: 'DONE', newCategory: 'IN_PROGRESS', occurredAt: at('2026-10-03T10:00:00Z') },
  ]);
  const r = await service.burndown('w1', 'sp1');
  expect(r.series.map((x) => x.remaining)).toEqual([10, 4, 10, 10]);
});
```
- [ ] Step 2: `pnpm --filter @tirapro/api exec vitest run src/modules/analytics/analytics.service.spec.ts` → kỳ vọng FAIL ở test đầu (delta cũ ra `[10,4,-2→0,...]`).
- [ ] Step 3: Implementation — thay khối `let done = 0; ... while (h < history.length ...)`:
```ts
let done = 0;
const doneNow = new Map<string, boolean>(); // issue đang ở category DONE theo sự kiện STATUS cuối cùng (giống CFD)
let h = 0;
const series = days.map((date, idx) => {
  const endOfDay = new Date(`${date}T23:59:59.999Z`);
  while (h < history.length && history[h]!.occurredAt <= endOfDay) {
    const ev = history[h++]!;
    if (!ev.newCategory) continue;
    const isDone = ev.newCategory === 'DONE';
    if (isDone === (doneNow.get(ev.issueId) ?? false)) continue;
    doneNow.set(ev.issueId, isDone);
    done += isDone ? (points.get(ev.issueId) ?? 0) : -(points.get(ev.issueId) ?? 0);
  }
  ...
```
Bỏ `oldCategory` khỏi `select` (dòng 376) và cập nhật comment "Cố ý KHÔNG dùng oldCategory" tương tự CFD.
- [ ] Step 4: chạy lại file spec → PASS (cả 4 test cũ vẫn xanh); `pnpm --filter @tirapro/api typecheck && pnpm --filter @tirapro/api lint`.
- [ ] Step 5: Commit: `Analytics: burndown dùng "category cuối thắng" như CFD, không cộng/trừ đôi khi lịch sử đứt`
**Rủi ro/đụng chạm:** chỉ `analytics.service.ts` (+spec). Không migration. Số liệu burndown ngày chưa có snapshot có thể thay đổi nhẹ so với trước ở sprint có dữ liệu lịch sử đứt — ghi release note một dòng.

---

### Task C2: Rebalance rank — phát WS cho web + phân biệt "neighbor cũ" (409) với "hết chỗ" (rebalance)

**Mục tiêu:** (a) khi rank cả project được đánh số lại, mọi client đang mở project tự nạp lại danh sách issue (version/rank đã đổi) thay vì giữ cache cũ rồi dính OCC; (b) client gửi `afterId/beforeId` đã lỗi thời (thứ tự hai mốc bị đảo) nhận 409 `RANK_NEIGHBORS_STALE` để refetch, KHÔNG kích hoạt rebalance toàn project.
**Hiện trạng:**
- `issues.service.ts:759-792` `rebalanceProject` bump `version` mọi dòng và `notify()` → `events.emit(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED, { projectId })`; `grep PROJECT_RANKS_REBALANCED` chỉ thấy `packages/types/src/events.ts:12` + dòng 782 — không `@OnEvent` nào, không có `WS_EVENTS` tương ứng (`packages/types/src/events.ts:46-65`), `ServerToClientEvents` thiếu (`packages/shared/src/ws.ts:56-70`), web `lib/realtime.ts` không nghe.
- `resolveRank` (`issues.service.ts:729-751`) bắt mọi `RankGapError` rồi rebalance. Nhưng `rankBetween(prev, next)` ném `RankGapError` cả khi `prev >= next` (`packages/shared/src/lexorank.ts:~30` `if (b !== '' && a >= b) throw new RankGapError`), tức khi client gửi mốc cũ làm thứ tự đảo → rebalance cả project vô cớ và bump version của mọi người.
- Web hiện KHÔNG gọi `POST /issues/:id/move` (grep `afterId|beforeId` trong `apps/web/src` = 0) — nhánh 409 chỉ cần thông điệp lỗi sẵn sàng cho client sau/API client.
**Files:**
- Modify: `packages/types/src/common.ts:45-62` — thêm `RANK_NEIGHBORS_STALE: 'RANK_NEIGHBORS_STALE'` vào `ERROR_CODES`.
- Modify: `packages/types/src/events.ts:46-65` — thêm `PROJECT_RANKS_REBALANCED: 'project:ranks_rebalanced'` vào `WS_EVENTS`.
- Modify: `packages/shared/src/ws.ts` (interface `ServerToClientEvents`) — `'project:ranks_rebalanced': (p: { projectId: ID }) => void;`
- Modify: `apps/api/src/common/exceptions/app.exception.ts` — thêm `RankNeighborsStaleException` (409).
- Modify: `apps/api/src/modules/issues/issues.service.ts:726-751` (`resolveRank`) — phát hiện đảo thứ tự trước khi rebalance. ĐỤNG `move()` của nhóm S (xem rủi ro).
- Modify: `apps/api/src/modules/realtime/realtime.gateway.ts` (cạnh `onIssueMoved`, ~dòng 344) — `@OnEvent(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED)` → `toProject`.
- Modify: `apps/web/src/lib/realtime.ts` — hàm `applyRanksRebalanced(qc, projectId)` + nghe `'project:ranks_rebalanced'` trong `useProjectRealtime`.
- Modify: `apps/web/src/lib/api.ts:66-74` — thêm câu tiếng Việt cho `RANK_NEIGHBORS_STALE`.
- Test: `apps/api/src/modules/issues/issues.service.spec.ts` (thêm vào `describe('IssuesService.move — rebalance ...')` dòng 38), `apps/api/src/modules/realtime/realtime.gateway.spec.ts` (thêm vào describe "bridge notification & sprint" dòng 231), Create `apps/web/src/lib/realtime.test.ts`.
**Interfaces:** Produces: WS `project:ranks_rebalanced {projectId}` (room `project:<id>`); lỗi HTTP 409 `{error:{code:'RANK_NEIGHBORS_STALE'}}`; export web `applyRanksRebalanced(qc: QueryClient, projectId: string)`. Consumes: DOMAIN event `project.ranks_rebalanced` (đã phát sau commit — giữ nguyên).
**Quyết định thiết kế:**
- "Neighbor stale" = HAI mốc đều có và sau khi bỏ số 0 đuôi `prev` **>** `next` NGHIÊM NGẶT (thứ tự đảo). `prev == next` (trùng rank) hoặc `next = prev + '0…'` hoặc dài quá `RANK_MAX_LEN` vẫn là "cạn chỗ" → rebalance như cũ (test hiện có dùng `n` vs `n0` ⇒ phải còn đi nhánh rebalance).
- Kiểm tra làm ở `resolveRank` ngay sau lần `read()` thứ nhất (và thứ hai, nếu vẫn đảo sau rebalance thì cũng 409 thay vì 422 hiện tại) — một chỗ, mọi caller (`createCore` chỉ có `next=null` nên không ảnh hưởng).
- Không thêm cờ "echo" vào WS; web chỉ invalidate (rebalance hiếm, rẻ hơn vá từng issue).
- Web invalidate: `keys.issues.byProject(projectId)`, `keys.issues.byBoard`-theo predicate, và mọi cache `byKey` có `data.projectId === projectId` (version đã đổi → tránh OCC sai khi sửa).
- [ ] Step 1: Viết test fail.
  API (`issues.service.spec.ts`), dùng `issueRow`/`makeService`:
```ts
it('hai mốc bị đảo thứ tự (client cũ) => 409 RANK_NEIGHBORS_STALE, KHÔNG rebalance, không ghi', async () => {
  const ranks: Record<string, string> = { a: 'r', b: 'i' }; // after=a(r) nhưng before=b(i) ⇒ prev > next
  const tx = {
    issue: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => { await Promise.resolve();
        return where.id === 'i1' ? issueRow() : ranks[where.id] ? { rank: ranks[where.id] } : null; }),
      updateMany: vi.fn(), findMany: vi.fn(),
    },
    project: { update: vi.fn() }, $executeRaw: vi.fn(),
  };
  const { service, events } = makeService(tx);
  await expect(service.move('w1', 'u1', 'i1', { version: 3, afterId: 'a', beforeId: 'b' }))
    .rejects.toMatchObject({ status: 409, code: 'RANK_NEIGHBORS_STALE' });
  expect(tx.project.update).not.toHaveBeenCalled();
  expect(tx.$executeRaw).not.toHaveBeenCalled();
  expect(tx.issue.updateMany).not.toHaveBeenCalled();
  expect(events.emit).not.toHaveBeenCalled();
});
```
  (Test cũ "rank hai mốc sát nhau" — `n` vs `n0` — phải tiếp tục PASS: đó là regression guard cho "cạn chỗ".) Thêm test "hai mốc trùng rank ('n','n') => vẫn rebalance" (copy test đầu với `ranks a:['n','i'], b:['n','r']`).
  Gateway: 
```ts
it('project.ranks_rebalanced -> project:ranks_rebalanced tới room project', () => {
  const { gateway, to, emit } = makeGateway();
  gateway.onProjectRanksRebalanced({ projectId: 'P1' });
  expect(to).toHaveBeenCalledWith('project:P1');
  expect(emit).toHaveBeenCalledWith(WS_EVENTS.PROJECT_RANKS_REBALANCED, { projectId: 'P1' });
});
it('bỏ qua payload thiếu projectId', () => { const { gateway, to } = makeGateway(); gateway.onProjectRanksRebalanced({} as never); expect(to).not.toHaveBeenCalled(); });
```
  Web `apps/web/src/lib/realtime.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { keys } from './queryKeys';
vi.mock('./socket', () => ({ acquireRoom: vi.fn(), getSocket: vi.fn() }));
import { applyRanksRebalanced } from './realtime';

describe('applyRanksRebalanced', () => {
  it('invalidate danh sách dự án và chi tiết issue của đúng dự án, giữ nguyên dự án khác', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.byProject('p1'), [{ id: 'i1' }]);
    qc.setQueryData(keys.issues.byProject('p2'), [{ id: 'i2' }]);
    qc.setQueryData(keys.issues.byKey('A-1'), { id: 'i1', projectId: 'p1' } as IssueDto);
    qc.setQueryData(keys.issues.byKey('B-1'), { id: 'i2', projectId: 'p2' } as IssueDto);
    applyRanksRebalanced(qc, 'p1');
    expect(qc.getQueryState(keys.issues.byProject('p1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.byKey('A-1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.byProject('p2'))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keys.issues.byKey('B-1'))?.isInvalidated).toBe(false);
  });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/api exec vitest run src/modules/issues/issues.service.spec.ts src/modules/realtime/realtime.gateway.spec.ts` và `pnpm --filter @tirapro/web exec vitest run src/lib/realtime.test.ts` → FAIL (409 test: hiện rebalance rồi 422; gateway/web: thiếu hàm).
- [ ] Step 3: Implementation.
  `app.exception.ts`:
```ts
/** Mốc kéo-thả (afterId/beforeId) của client đã lỗi thời — thứ tự hai mốc bị đảo. Client tải lại danh sách rồi thả lại. */
export class RankNeighborsStaleException extends AppException {
  constructor(message = 'Thứ tự công việc vừa thay đổi — hãy tải lại danh sách rồi kéo thả lại') {
    super(ERROR_CODES.RANK_NEIGHBORS_STALE, message, HttpStatus.CONFLICT);
  }
}
```
  `issues.service.ts` — thêm helper module-level và sửa `resolveRank`:
```ts
/** Thứ tự hai mốc đã đảo (prev > next nghiêm ngặt, sau khi bỏ số 0 đuôi) ⇒ client giữ mốc cũ, KHÔNG phải cạn chỗ. */
const neighborsInverted = (prev: string | null, next: string | null): boolean =>
  prev !== null && next !== null && prev.replace(/0+$/, '') > next.replace(/0+$/, '');

private async resolveRank(...) {
  const first = await read();
  if (neighborsInverted(first.prev, first.next)) throw new RankNeighborsStaleException();
  try { return rankBetween(first.prev, first.next); } catch (e) { if (!(e instanceof RankGapError)) throw e; }
  await this.rebalanceProject(projectId, db, deferred, movedId);
  const again = await read();
  if (neighborsInverted(again.prev, again.next)) throw new RankNeighborsStaleException();
  ...(giữ phần còn lại)
```
  Gateway:
```ts
@OnEvent(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED)
onProjectRanksRebalanced(p: { projectId?: string }) {
  if (!p?.projectId) return;
  this.toProject(p.projectId, WS_EVENTS.PROJECT_RANKS_REBALANCED, { projectId: p.projectId });
}
```
  Web `realtime.ts`:
```ts
/** project:ranks_rebalanced — rank + version của cả dự án đã đổi: nạp lại danh sách và chi tiết đang giữ (tránh OCC sai). */
export function applyRanksRebalanced(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
  void qc.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === keys.issues.all[0] &&
      (q.queryKey[1] === 'board' ||
        (q.queryKey[1] === 'key' && (q.state.data as IssueDto | undefined)?.projectId === projectId)),
  });
}
```
  Trong `useProjectRealtime`: `const onRebalanced = (p: { projectId: string }) => { if (p.projectId === projectId) applyRanksRebalanced(qc, projectId); };` + `s.on('project:ranks_rebalanced', onRebalanced)` / `s.off(...)`. (Board invalidate là rộng — chấp nhận, board lọc chỉ vài cái.)
  `lib/api.ts` ERROR_MESSAGES: `RANK_NEIGHBORS_STALE: 'Thứ tự công việc vừa thay đổi do người khác — danh sách đã được nạp lại, hãy kéo thả lại.'`
- [ ] Step 4: chạy lại 3 file test → PASS; `pnpm --filter @tirapro/types typecheck && pnpm --filter @tirapro/shared typecheck && pnpm --filter @tirapro/api typecheck && pnpm --filter @tirapro/web typecheck`; `pnpm --filter @tirapro/api lint`; `pnpm gen:enums --check` (types đổi không đụng enums nhưng là gate chung).
- [ ] Step 5: Commit: `Rank: phát project:ranks_rebalanced qua WS cho web nạp lại, mốc kéo thả đảo thứ tự trả 409 thay vì rebalance cả dự án`
**Rủi ro/đụng chạm:** `issues.service.ts` (`resolveRank` ngay cạnh `move()` mà nhóm S sửa — làm SAU S hoặc rebase; không đụng thân `move()`, chỉ `resolveRank`). T4 (tách `RankService`) sẽ mang theo `neighborsInverted` + `resolveRank` — nhắc T4 chuyển luôn test. `realtime.ts` web trùng C8. Thêm một event WS mới ⇒ ghi release note (client WS cũ bỏ qua event lạ nên an toàn).

---

### Task C3: Bulk đổi status + assignee phát đủ sự kiện; web chia lô ≤ 100

**Mục tiêu:** gán người phụ trách hàng loạt kèm đổi status vẫn tạo thông báo "được giao việc" (và automation ISSUE_UPDATED nhận `assigneeId`); chọn > 100 issue ở Backlog không còn bị 422 mà được gửi tuần tự theo lô 100.
**Hiện trạng:**
- `issues.service.ts:482-489`:
```ts
if (before.statusId !== after.statusId) {
  this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, { issue: dto, actorId: userId, fromStatusId: before.statusId });
} else {
  this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, { ..., changedFields: changedFieldsOf(before, after) });
}
```
  `if/else` ⇒ khi đổi cả status lẫn assignee/priority/sprint chỉ có TRANSITIONED. Thông báo "được giao" chỉ sinh ở `NotificationsService.onIssueUpdated` khi `changedFields.includes('assigneeId')` (`notifications.service.ts:289-297`); không có domain event `ISSUE_ASSIGNED` (đó là loại notification, không phải event).
- Web: `apps/web/src/features/backlog/BacklogPage.tsx:234-285` `runBulk` gửi `items` cả lô một request; schema `bulkUpdateIssuesSchema` (`packages/shared/src/schemas/issue.ts:52-66`) `.max(100)`. Hook `useBulkUpdateIssues` ở `apps/web/src/features/backlog/api.ts:80-90`.
**Files:**
- Modify: `apps/api/src/modules/issues/issues.service.ts:480-491` — phát thêm ISSUE_UPDATED khi có field khác ngoài status đổi. ĐỤNG `bulkUpdate` (không đụng `move()` nên không xung đột logic với S, chỉ cùng file).
- Modify: `apps/web/src/features/backlog/api.ts:72-91` — `runBulkInChunks` + dùng trong `useBulkUpdateIssues`.
- Test: `apps/api/src/modules/issues/issues.service.spec.ts` (describe `IssuesService.bulkUpdate`, dòng 208; `bulkTx` ở 211 hardcode `findFirstOrThrow` trả `statusId 's1'` → thêm tham số `after` để trả `statusId: 's2'`), Create `apps/web/src/features/backlog/api.test.ts`.
**Interfaces:** Produces (web): `export async function runBulkInChunks(items, send, size = 100): Promise<BulkUpdateIssuesResult>`; `export const BULK_CHUNK = 100`. API: thêm một lần emit `issue.updated` với `changedFields` (không gồm `statusId` — `TRACKED_FIELDS` không chứa status).
**Quyết định thiết kế:**
- Backend: giữ TRANSITIONED như cũ (workflow/STATUS_CHANGED/automation transition) và PHÁT THÊM ISSUE_UPDATED nếu `changedFieldsOf(before, after).length > 0`. Không tạo event mới, không sửa notifications. Hệ quả chấp nhận: assignee mới nhận cả STATUS_CHANGED lẫn ISSUE_ASSIGNED — giống hệt khi người dùng làm hai thao tác riêng (và `ISSUE_UPDATED`-kèm-`assigneeId` đã tự thay cho "việc được cập nhật" để khỏi báo trùng).
- Web: chia lô tuần tự (không song song — OCC + WIP cần khoá theo lô). Lô đầu lỗi → ném như cũ (chưa ghi gì, kể cả 422 workflow). Lô sau lỗi (mất mạng/403…) → dừng, KHÔNG ném: trả `updated` đã có và đẩy mọi item còn lại (kể cả lô đang lỗi) vào `conflicts` kèm `version` đang giữ, để UI hiện đúng toast "còn N việc chưa xong" và "Hoàn tác" vẫn dùng `updated` đúng. Mutation `onSettled` invalidate vẫn chạy một lần.
- [ ] Step 1: Viết test fail.
  API — thêm test cạnh test "statusId hợp lệ => ghi history STATUS..." (dòng ~293 spec; dùng cùng cách ghi đè `tx.issue.findFirstOrThrow` và `rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']))`). `before` mặc định `assigneeId: null`, `statusId: 's1'`; `after` đổi sang `statusId: 's2'` + `assigneeId: 'u2'`:
```ts
const stage2 = { id: 's2', workflowId: 'wf', name: 'Doing', category: 'IN_PROGRESS', color: null, order: 1, isInitial: false };
it('đổi cả status lẫn assignee => TRANSITIONED + thêm ISSUE_UPDATED mang changedFields ["assigneeId"]', async () => {
  const tx = bulkTx();
  tx.issue.findFirstOrThrow = vi.fn(({ where }: { where: { id: string } }) =>
    Promise.resolve(issueRow({ id: where.id, version: 4, statusId: 's2', status: stage2, assigneeId: 'u2' })));
  const { service, events, rbac } = makeService(tx);
  rbac.getEffectivePermissions.mockResolvedValue(new Set(['issue:transition']));
  await service.bulkUpdate('w1', 'u1', { projectId: 'p1', items: [{ id: 'a', version: 3 }], patch: { statusId: 's2', assigneeId: 'u2' } });
  expect(events.emit.mock.calls.map((c) => c[0])).toEqual(['issue.transitioned', 'issue.updated']);
  expect(events.emit).toHaveBeenLastCalledWith('issue.updated', expect.objectContaining({ changedFields: ['assigneeId'], actorId: 'u1' }));
});
```
  (Test cũ "statusId hợp lệ" ở dòng ~293 giữ nguyên và là guard: chỉ đổi status → vẫn đúng 2 emit `issue.transitioned`, không `issue.updated` thừa. Test "2 item, 1 thua OCC" (assignee đổi) vẫn đúng 1 emit `issue.updated`.)
  Web `apps/web/src/features/backlog/api.test.ts` (mock `@/lib/api` như `features/issues/api.test.ts`):
```ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({ api: { patch: vi.fn() } }));
import { runBulkInChunks } from './api';
const mkItems = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, version: 1 }));
const ok = (items: Array<{ id: string; version: number }>) =>
  Promise.resolve({ updated: items.map((i) => ({ id: i.id, version: 2 })) as never, conflicts: [] });

describe('runBulkInChunks', () => {
  it('250 việc => 3 request (100/100/50), gộp updated + conflicts', async () => {
    const send = vi.fn((items) => ok(items));
    const r = await runBulkInChunks(mkItems(250), send);
    expect(send.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([100, 100, 50]);
    expect(r.updated).toHaveLength(250);
  });
  it('lô đầu lỗi => ném (chưa ghi gì)', async () => {
    const send = vi.fn(() => Promise.reject(new Error('422')));
    await expect(runBulkInChunks(mkItems(150), send)).rejects.toThrow('422');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('lô sau lỗi => dừng, trả phần đã xong + phần còn lại là conflicts', async () => {
    const send = vi.fn().mockImplementationOnce((items) => ok(items)).mockRejectedValueOnce(new Error('net'));
    const r = await runBulkInChunks(mkItems(250), send);
    expect(r.updated).toHaveLength(100);
    expect(r.conflicts).toHaveLength(150);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('≤ 100 => đúng 1 request', async () => { const send = vi.fn((i) => ok(i)); await runBulkInChunks(mkItems(100), send); expect(send).toHaveBeenCalledTimes(1); });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/api exec vitest run src/modules/issues/issues.service.spec.ts -t bulkUpdate` → FAIL (event thứ hai không có); `pnpm --filter @tirapro/web exec vitest run src/features/backlog/api.test.ts` → FAIL (chưa export).
- [ ] Step 3: Implementation.
  API (thay khối emit cuối `bulkUpdate`):
```ts
for (const { before, after } of changed) {
  const dto = this.toDto(after);
  const changedFields = changedFieldsOf(before, after);
  if (before.statusId !== after.statusId) {
    this.events.emit(DOMAIN_EVENTS.ISSUE_TRANSITIONED, { issue: dto, actorId: userId, fromStatusId: before.statusId });
  }
  // Đổi thêm assignee/priority/sprint cùng lúc: vẫn phải có ISSUE_UPDATED (thông báo "được giao", trigger automation).
  if (changedFields.length > 0) {
    this.events.emit(DOMAIN_EVENTS.ISSUE_UPDATED, { issue: dto, actorId: userId, changedFields });
  }
}
```
  Lưu ý: nhánh cũ `else` phát ISSUE_UPDATED cả khi `changedFields` rỗng? Không — khi không đổi status thì chắc chắn có ít nhất một field đổi (sprintId/assigneeId/priorityId đều thuộc TRACKED_FIELDS). Test cũ "emit ISSUE_UPDATED" vẫn đúng.
  Web `backlog/api.ts`:
```ts
/** Máy chủ nhận tối đa 100 việc/lần (`bulkUpdateIssuesSchema`). */
export const BULK_CHUNK = 100;

export async function runBulkInChunks(
  items: Array<{ id: string; version: number }>,
  send: (chunk: Array<{ id: string; version: number }>) => Promise<BulkUpdateIssuesResult>,
  size = BULK_CHUNK,
): Promise<BulkUpdateIssuesResult> {
  const out: BulkUpdateIssuesResult = { updated: [], conflicts: [] };
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    try {
      const r = await send(chunk);
      out.updated.push(...r.updated);
      out.conflicts.push(...r.conflicts);
    } catch (err) {
      if (i === 0) throw err; // lô đầu: chưa ghi gì → báo lỗi nguyên văn
      out.conflicts.push(...items.slice(i).map((x) => ({ id: x.id, version: x.version }))); // phần còn lại: chưa xong
      return out;
    }
  }
  return out;
}
```
  và `mutationFn: (v) => runBulkInChunks(v.items, (items) => api.patch<BulkUpdateIssuesResult>('/issues/bulk', { projectId, items, patch: v.patch }).then((r) => r.data))`. `BacklogPage.runBulk` KHÔNG cần sửa (toast tổng kết dựa `conflicts`); chỉ cập nhật comment "MỘT request" → "tuần tự theo lô ≤ 100". Hoàn tác đi qua cùng hook nên tự chia lô.
- [ ] Step 4: chạy lại 2 file test → PASS; `pnpm --filter @tirapro/api typecheck && lint`; `pnpm --filter @tirapro/web typecheck && pnpm --filter @tirapro/web lint`.
- [ ] Step 5: Commit: `Bulk update: phát thêm ISSUE_UPDATED khi đổi status cùng field khác; web chia lô 100 việc/request`
**Rủi ro/đụng chạm:** `issues.service.ts` (bulkUpdate) cùng file với C2/S/T4; `backlog/api.ts` không task khác trong C đụng. Thay đổi hành vi: bulk "đổi status + giao" nay sinh thêm thông báo ISSUE_ASSIGNED và có thể kích hoạt automation `ISSUE_UPDATED` → release note.

---

### Task C4: Thả vào cột nhiều trạng thái — chọn đúng trạng thái đích

**Mục tiêu:** kéo thẻ sang cột gom nhiều status không còn luôn chuyển sang status đầu tiên; hệ thống chọn status đích hợp lệ theo workflow, hỏi người dùng khi có nhiều lựa chọn, báo rõ khi không có đường chuyển.
**Hiện trạng:** `apps/web/src/features/board/BoardPage.tsx:249-256`:
```ts
const targetStatusId = col?.statusIds[0];
if (!col || !targetStatusId) return;
const statusChanged = canTransition && !col.statusIds.includes(issue.status.id);
```
  → luôn `statusIds[0]`; nếu workflow không cho `from → statusIds[0]` thì máy chủ trả 409 INVALID_TRANSITION dù có status khác trong cột hợp lệ. Cùng giá trị được dùng ở nhánh swimlane-assignee (dòng ~278). `Column.tsx:31` dùng `statusIds[0]` cho QuickAdd (tạo mới — ngoài phạm vi). Dữ liệu workflow đã có sẵn: `useWorkflows()` (`workflow-settings/api.ts:76`, key `keys.workflows`, đã dùng ở `IssueDetailPage.tsx:101`) + hàm thuần `computeNextStatuses(workflows, currentStatusId)` (`features/issues/nextStatuses.ts:12`) trả các status đích hợp lệ.
**Files:**
- Create: `apps/web/src/features/board/dropTarget.ts` — hàm thuần `resolveDropStatuses`.
- Create: `apps/web/src/features/board/StatusPickDialog.tsx` — hộp thoại chọn trạng thái đích (dựng trên `Dialog` chung).
- Modify: `apps/web/src/features/board/BoardPage.tsx:~99-110 (hooks), 138-150 (`runTransition`), 241-300 (`onMove`)`, + render dialog cạnh `ConfirmDialog` (~dòng 440).
- Test: Create `apps/web/src/features/board/dropTarget.test.ts`.
**Interfaces:** Produces: `resolveDropStatuses(col: BoardColumnDto, currentStatusId: string, workflows: Workflow[] | undefined): DropResolution` với
```ts
export type DropResolution =
  | { kind: 'stay' }                                   // đã ở trong cột
  | { kind: 'blocked' }                                // cột có status nhưng workflow không cho chuyển tới cái nào
  | { kind: 'move'; options: NextStatus[] };           // 1 = chuyển luôn, >1 = hỏi
```
Consumes: `computeNextStatuses`, `Workflow`, `NextStatus`.
**Quyết định thiết kế:** (chọn phương án nhỏ nhất đúng) lọc các status của cột theo `computeNextStatuses` (giữ thứ tự trong `col.statusIds`):
- 1 lựa chọn hợp lệ → chuyển thẳng (đa số trường hợp, không thêm thao tác).
- >1 lựa chọn → mở `StatusPickDialog` (danh sách nút, lựa chọn đầu autoFocus, Esc/huỷ = không chuyển). Không làm vùng thả con theo từng status (đổi cấu trúc droppable/Card nhiều hơn mà lợi ích ít).
- 0 → `toast.error('Quy trình không cho chuyển “<status hiện tại>” sang cột “<cột>”. Hãy chọn một trạng thái trong danh sách gợi ý.')`, không gọi API.
- `workflows` chưa tải (undefined/rỗng) hoặc không tìm thấy workflow chứa status hiện tại → degrade như cũ: `options=[status đầu của cột]`, để máy chủ kiểm. (Cần tên status: lấy từ `workflows` nếu có, không thì `col.name`.)
- Tên hiển thị khi chuyển: nếu cột chỉ có 1 status → `col.name` (như cũ); nếu nhiều → tên status được chọn (`statusName` cho optimistic patch + toast).
- [ ] Step 1: Viết test fail `dropTarget.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { BoardColumnDto } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import { resolveDropStatuses } from './dropTarget';

const st = (id: string, order: number, category: 'TODO' | 'IN_PROGRESS' | 'DONE' = 'TODO') =>
  ({ id, name: id.toUpperCase(), category, color: null, order, isInitial: order === 0 });
const wf = (transitions: Array<[string | null, string]>): Workflow => ({
  id: 'wf', name: 'wf', description: null, isTemplate: false, isDefault: true, projectId: 'p1',
  statuses: [st('todo', 0), st('doing', 1, 'IN_PROGRESS'), st('review', 2, 'IN_PROGRESS'), st('done', 3, 'DONE')],
  transitions: transitions.map(([f, t], i) => ({ id: `t${i}`, name: t, fromStatusId: f, toStatusId: t, order: i })),
});
const col = (statusIds: string[]): BoardColumnDto => ({ id: 'c', boardId: 'b', name: 'Cột', order: 0, wipLimit: null, statusIds });

describe('resolveDropStatuses', () => {
  it('thả vào cột đang chứa status hiện tại => stay', () => {
    expect(resolveDropStatuses(col(['doing', 'review']), 'review', [wf([])])).toEqual({ kind: 'stay' });
  });
  it('đúng một status hợp lệ (không phải status đầu) => move với đúng status đó', () => {
    const r = resolveDropStatuses(col(['doing', 'review']), 'todo', [wf([['todo', 'review']])]);
    expect(r).toMatchObject({ kind: 'move', options: [{ id: 'review' }] });
  });
  it('nhiều status hợp lệ => options theo thứ tự trong cột', () => {
    const r = resolveDropStatuses(col(['review', 'doing']), 'todo', [wf([['todo', 'doing'], [null, 'review']])]);
    expect(r.kind === 'move' && r.options.map((o) => o.id)).toEqual(['review', 'doing']);
  });
  it('không status nào trong cột chuyển được => blocked', () => {
    expect(resolveDropStatuses(col(['doing', 'review']), 'todo', [wf([['todo', 'done']])])).toEqual({ kind: 'blocked' });
  });
  it('workflow chưa tải => rơi về status đầu của cột để máy chủ kiểm', () => {
    const r = resolveDropStatuses(col(['doing', 'review']), 'todo', undefined);
    expect(r).toMatchObject({ kind: 'move', options: [{ id: 'doing' }] });
  });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/web exec vitest run src/features/board/dropTarget.test.ts` → FAIL (module không tồn tại).
- [ ] Step 3: Implementation.
  `dropTarget.ts`:
```ts
import type { BoardColumnDto } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import { computeNextStatuses, type NextStatus } from '@/features/issues/nextStatuses';

export type DropResolution = { kind: 'stay' } | { kind: 'blocked' } | { kind: 'move'; options: NextStatus[] };

export function resolveDropStatuses(col: BoardColumnDto, currentStatusId: string, workflows: Workflow[] | undefined): DropResolution {
  if (col.statusIds.includes(currentStatusId)) return { kind: 'stay' };
  const known = (workflows ?? []).some((w) => w.statuses.some((s) => s.id === currentStatusId));
  if (!known) {
    const first = col.statusIds[0];
    return first ? { kind: 'move', options: [{ id: first, name: col.name, category: 'TODO' }] } : { kind: 'blocked' };
  }
  const allowed = new Map(computeNextStatuses(workflows, currentStatusId).map((s) => [s.id, s]));
  const options = col.statusIds.map((id) => allowed.get(id)).filter((s): s is NextStatus => !!s);
  return options.length ? { kind: 'move', options } : { kind: 'blocked' };
}
```
  (category giả `'TODO'` ở nhánh degrade chỉ để thoả kiểu; `runTransition` không dùng category.)
  `StatusPickDialog.tsx`: props `{ open, issueKey, colName, options: NextStatus[], onPick(id: string, name: string): void, onCancel(): void }`; `<Dialog open onOpenChange={(o)=>!o&&onCancel()} title={`Chuyển ${issueKey} sang trạng thái nào?`} description={`Cột “${colName}” gồm nhiều trạng thái.`} size="sm">` + danh sách `Button variant="secondary"` full-width, mỗi nút có chấm màu `categoryColor(category)` (`@/lib/statusColor`) và tên; nút đầu `autoFocus`. Chuỗi UI tiếng Việt, dùng token DESIGN.md (không viền-sọc bên, không gradient).
  `BoardPage.tsx`:
  1. `const { data: workflows } = useWorkflows();`
  2. state `const [pick, setPick] = useState<{ issue: IssueDto; col: BoardColumnDto; options: NextStatus[]; version: number } | null>(null);`
  3. `runTransition(issue, col, toStatusId, force = false, statusName = col.name, version = issue.version)` — dùng `statusName` cho `vars.statusName` và toast; giữ phần Hoàn tác như cũ.
  4. Trong `onMove`: thay 2 dòng `targetStatusId`/`statusChanged` bằng:
```ts
if (!col || col.statusIds.length === 0) return;
const res = canTransition ? resolveDropStatuses(col, issue.status.id, workflows) : ({ kind: 'stay' } as const);
if (res.kind === 'blocked') {
  toast.error(`Quy trình không cho chuyển “${issue.status.name}” sang cột “${col.name}”. Hãy chọn một trạng thái trong danh sách gợi ý.`);
  return;
}
const statusChanged = res.kind === 'move';
const only = res.kind === 'move' && res.options.length === 1 ? res.options[0]! : null;
const labelFor = (o: NextStatus) => (col.statusIds.length > 1 ? o.name : col.name);
```
     Nhánh không đổi người: `if (only) runTransition(issue, col, only.id, false, labelFor(only)); else if (res.kind === 'move') setPick({ issue, col, options: res.options, version: issue.version });`.
     Nhánh đổi người (swimlane assignee): sau `updateIssue` thành công, nếu `only` → như code hiện tại với `toStatusId: only.id`/`statusName: labelFor(only)`; nếu nhiều lựa chọn → `setPick({ ..., version })` rồi `toast.success` phần giao việc và return (người dùng chọn tiếp); khi chặn (`blocked`) vẫn thực hiện đổi người (đã `toast.error` ở trên nên đặt kiểm `blocked` SAU khi xử lý `assigneeChanged`: nếu `blocked && !assigneeChanged` → toast+return; nếu `blocked && assigneeChanged` → đổi người rồi toast lỗi trạng thái).
  5. Render `<StatusPickDialog open={!!pick} ... onPick={(id, name) => { const p = pick!; setPick(null); runTransition(p.issue, p.col, id, false, p.col.statusIds.length > 1 ? name : p.col.name, p.version); }} onCancel={() => setPick(null)} />`. Chú ý `runTransition` nhận `version` mới sau khi đổi người.
- [ ] Step 4: chạy `dropTarget.test.ts` → PASS; `pnpm --filter @tirapro/web typecheck && pnpm --filter @tirapro/web lint && pnpm --filter @tirapro/web build`; chạy `node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/features/board` và sửa findings; smoke tay trên trình duyệt: board có cột gộp 2 status với workflow chỉ cho `todo→review` (thả → chuyển thẳng sang review), cho cả hai (hiện dialog), cho không cái nào (toast).
- [ ] Step 5: Commit: `Board: thả vào cột nhiều trạng thái chọn đúng trạng thái đích theo workflow, hỏi khi có nhiều lựa chọn`
**Rủi ro/đụng chạm:** `BoardPage.tsx` (nhóm W có thể sửa web board/layout — kiểm tra trước khi làm). `Column.tsx` không đổi (QuickAdd vẫn `statusIds[0]`: ghi ở "Ngoài phạm vi"). `useWorkflows()` tải toàn workspace — đã được cache dùng ở trang chi tiết, chấp nhận. Hành vi đổi: thả vào cột gộp có thể nay mở dialog.

---

### Task C5: JQL `text ~` — scope theo project, không mất match substring

**Mục tiêu:** `text ~ "foo"` (kể cả kèm `project = X`, hoặc gọi với `projectId`) trả đủ issue khớp, kể cả khi từ khoá chỉ là chuỗi con trong mô tả/mã issue, và không bị "top 200 của cả workspace rồi mới lọc project".
**Hiện trạng:**
- `search.service.ts:122-128` gọi `this.fulltext.search(workspaceId, term)` KHÔNG truyền `projectId`; `fulltext.ts:55-61` `LIMIT 200` toàn workspace rồi `where id IN (…)` + `projectId`/điều kiện JQL khác ghép SAU (`search.service.ts:140-143`, `issues.service.query` `idScope`). Dự án nhỏ trong workspace lớn ⇒ kết quả rỗng/thiếu.
- SQL chỉ ILIKE trên `summary` (`fulltext.ts:58`: `i."searchVector" @@ q OR i."summary" ILIKE …`); `searchVector` dùng config `'simple'` (`prisma/sql/01_pgvector_fts.sql:12-17`) nên chỉ khớp nguyên token ⇒ chuỗi con ở `description`/`key` bị mất (biên dịch `jql-compiler.ts:133-141` nhánh `ranked` chỉ trả `{ id: { in: ranked } }`, KHÔNG có nhánh contains; contains chỉ dùng khi chưa có `searchVector`).
**Files:**
- Modify: `apps/api/src/modules/search/fulltext.ts:41-76` — nhận `projectIds?: string[]`; thêm ILIKE `description` và `key` vào cùng câu SQL.
- Modify: `apps/api/src/modules/search/jql-compiler.ts` — (a) nhánh `fulltext` (dòng 133-141): `~` ⇒ `OR [ {id in ranked}, summary/description/key contains ]`; `!~` ⇒ `NOT` của cùng điều kiện (thêm `key`); (b) hàm mới `topLevelProjectKeys(node)`.
- Modify: `apps/api/src/modules/search/search.service.ts:107-148` — tính phạm vi project cho FTS, truyền `rankHint` thay vì `rawIds` ở đường JQL; `searchText` cũng truyền sẵn.
- Modify: `apps/api/src/modules/issues/issues.service.ts:301-325` (`query`) — thêm tham số `rankHint?: string[]` + `queryRankFirst`. ĐỤNG `issues.service.ts` (khu vực `query`, cách xa `move()`).
- Modify: `apps/api/prisma/sql/01_pgvector_fts.sql` — thêm index trigram cho `description`, `key` (idempotent; chạy bằng `pnpm --filter @tirapro/api run db:raw`, không phải migration).
- Test: `apps/api/src/modules/search/fulltext.spec.ts`, `jql-compiler.spec.ts`, `search.service.spec.ts`, `apps/api/src/modules/issues/issues.service.spec.ts` (describe mới `IssuesService.query — rankHint`).
**Interfaces:** Produces: `FulltextSearcher.search(workspaceId, raw, { projectId?, projectIds?, limit? })`; `topLevelProjectKeys(node: JqlNode | null): string[] | null` (export từ `jql-compiler.ts`); `IssuesService.query(workspaceId, where, orderBy, cursor, limit, rawIds?, rankHint?)`. `rawIds` giữ nguyên nghĩa "giới hạn cứng" (dùng bởi `searchText`).
**Quyết định thiết kế:**
- Không thể đẩy mọi điều kiện JQL vào SQL FTS (compiler sinh Prisma where). Chốt kiến trúc **lai**: điều kiện `text ~` trở thành điều kiện Prisma ĐẦY ĐỦ (id FTS ∪ ILIKE summary/description/key) ⇒ tính đúng đắn không còn phụ thuộc top-200; danh sách FTS chỉ còn dùng để XẾP HẠNG (`rankHint`: id khớp xếp theo rank lên trước, phần còn lại theo `updatedAt desc`).
- Vẫn thu hẹp SQL FTS theo project (cắt chi phí + làm "rank" có nghĩa): phạm vi = `opts.projectId` ∩ các project của điều kiện `project = X` / `project IN (…)` nằm trên chuỗi AND thuần (không qua OR/NOT). Khoá → id qua một truy vấn `prisma.project.findMany({ where: { workspaceId, key: { in }, deletedAt: null }, select: { id } })`.
- Đồng thời SQL FTS thêm `OR i."description" ILIKE … OR i."key" ILIKE …` (cùng pattern đã escape) để top-200 xếp hạng cũng chứa chúng; index trigram đi kèm để không seq-scan `description`.
- `searchText` (Cmd+K, `mode=text`) giữ `rawIds` (tập kết quả = FTS ≤ 200, đã scope theo `projectId`) — chỉ hưởng lợi từ ILIKE mở rộng.
- Rủi ro hiệu năng chấp nhận: where `contains` trên `description` quét theo index trigram sau `db:raw`; chưa chạy `db:raw` thì Postgres quét tuần tự trong phạm vi workspace (giống đường fallback "contains" hiện có) — ghi release note.
- [ ] Step 1: Viết test fail.
  `fulltext.spec.ts` (dùng `renderCall`):
```ts
it('ILIKE cả summary, description và key; nhận nhiều projectIds (bind, = ANY)', async () => {
  const prisma = makePrisma(() => Promise.resolve([]));
  await new FulltextSearcher(prisma as never).search('W1', 'abc', { projectIds: ['P1', 'P2'] });
  const { sql, values } = renderCall(prisma.$queryRaw.mock.calls[0]!);
  expect(sql).toContain('"description" ILIKE');
  expect(sql).toContain('"key" ILIKE');
  expect(sql).toMatch(/"projectId" = ANY/);
  expect(values).toContainEqual(['P1', 'P2']);
});
it('projectIds rỗng => không chạm DB, ids []', async () => {
  const prisma = makePrisma(() => Promise.resolve([]));
  expect(await new FulltextSearcher(prisma as never).search('W1', 'abc', { projectIds: [] })).toEqual({ ids: [] });
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
});
```
  `jql-compiler.spec.ts` (file hiện có dùng helper `ast(jql)`; thêm import `topLevelProjectKeys`). SỬA 2 test cũ cho khớp hình dạng mới: test "có kết quả full-text -> where id in ids" (dòng 20-26) — vế `text ~` giờ là `{ OR: [{id:{in}}, summary, description, key] }`, vế `!~` vẫn chứa `contains`; test "không có kết quả full-text … contains summary/description" (dòng 28-36) — `OR` giờ có thêm `{ key: { contains: 'foo', mode: 'insensitive' } }`. Test mới:
```ts
it('text ~ có kết quả xếp hạng => OR (id in ranked | summary/description/key contains) — không phụ thuộc top-200', () => {
  const ast = parseJql('text ~ "foo"');
  const { where } = compileJql(ast, { currentUserId: 'u', fulltext: new Map([['foo', ['I1']]]) });
  expect(where).toEqual({ OR: [
    { id: { in: ['I1'] } },
    { summary: { contains: 'foo', mode: 'insensitive' } },
    { description: { contains: 'foo', mode: 'insensitive' } },
    { key: { contains: 'foo', mode: 'insensitive' } },
  ] });
});
it('topLevelProjectKeys: lấy project = / IN trên chuỗi AND; bỏ qua khi nằm trong OR/NOT', () => {
  expect(topLevelProjectKeys(parseJql('project = ABC AND text ~ "x"').where)).toEqual(['ABC']);
  expect(topLevelProjectKeys(parseJql('project IN (A, B) AND status = Done').where)).toEqual(['A', 'B']);
  expect(topLevelProjectKeys(parseJql('project = A OR text ~ "x"').where)).toBeNull();
  expect(topLevelProjectKeys(parseJql('NOT project = A').where)).toBeNull();
  expect(topLevelProjectKeys(parseJql('status = Done').where)).toBeNull();
});
```
  `search.service.spec.ts`: sửa `makeService` để `prisma` có thêm `project: { findMany: vi.fn().mockResolvedValue([{ id: 'P1' }]) }`; sửa 2 test JQL hiện có (kỳ vọng `call[1]` bây giờ là `{ OR: [...] }` và `call[5]` (rawIds) `undefined`, `call[6]` = `['I2','I1']` rankHint) và thêm:
```ts
it('JQL project = ABC AND text ~ => FTS bị giới hạn project đã resolve (bind P1), không quét cả workspace', async () => {
  const { service, queryRaw, prisma } = makeService([{ id: 'I1', rank: 1 }]);
  await service.search('W1', 'U1', { jql: 'project = ABC AND text ~ "foo"', limit: 50 });
  expect(prisma.project.findMany).toHaveBeenCalledWith({ where: { workspaceId: 'W1', key: { in: ['ABC'] }, deletedAt: null }, select: { id: true } });
  expect(JSON.stringify((queryRaw.mock.calls[0] as unknown[]).slice(1))).toContain('P1');
});
it('opts.projectId cũng thu hẹp FTS của JQL', async () => { /* jql: text ~ "foo", projectId: 'P9' => queryRaw nhận P9, project.findMany không gọi */ });
```
  `issues.service.spec.ts` — describe mới cho `query` với `rankHint` (mock `prisma.issue.findMany`):
```ts
describe('IssuesService.query — rankHint (id khớp FTS lên trước, phần còn lại theo updatedAt)', () => {
  const row = (id: string) => issueRow({ id });
  function svc(rankedRows: string[], restRows: string[]) {
    const findMany = vi.fn(({ where }: { where: { AND: unknown[] } }) => {
      const isRanked = JSON.stringify(where).includes('"in"');
      return Promise.resolve((isRanked ? rankedRows : restRows).map(row));
    });
    return { findMany, ...makeService({ issue: { findMany } }) };
  }
  it('trang 1: id xếp hạng theo thứ tự rank rồi bù bằng phần còn lại', async () => {
    const { service } = svc(['b', 'a'], ['x', 'y']); // DB trả ranked không theo thứ tự rank
    const page = await service.query('w1', {}, [], undefined, 3, undefined, ['a', 'b']);
    expect(page.data.map((i) => i.id)).toEqual(['a', 'b', 'x']);
  });
  it('cursor nằm trong phần xếp hạng => tiếp tục sau nó rồi chuyển sang phần còn lại', async () => { /* cursor 'a', limit 2 => ['b','x'] */ });
  it('cursor nằm ở phần còn lại => dùng Prisma cursor+skip cho phần còn lại, không lặp phần xếp hạng', async () => { /* findMany lần gọi cho rest có cursor:{id:'x'}, skip:1 */ });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/api exec vitest run src/modules/search src/modules/issues/issues.service.spec.ts` → FAIL.
- [ ] Step 3: Implementation.
  `fulltext.ts`:
```ts
interface SearchOptions { projectId?: string; projectIds?: string[]; limit?: number }
...
const scope = opts.projectIds ?? (opts.projectId ? [opts.projectId] : null);
if (scope && scope.length === 0) return { ids: [] };
const projectFilter = scope ? Prisma.sql`AND i."projectId" = ANY(${scope}::text[])` : Prisma.empty;
...
AND (i."searchVector" @@ q OR i."summary" ILIKE ${built.like} OR i."description" ILIKE ${built.like} OR i."key" ILIKE ${built.like})
```
  (test cũ "thêm điều kiện projectId (bind)" vẫn pass vì `values` chứa mảng `['P1']` — nếu `values` assert `toContain('P1')` thất bại thì sửa assertion thành `toContainEqual(['P1'])`; ghi trong commit.)
  `jql-compiler.ts` nhánh `fulltext`:
```ts
case 'fulltext': {
  const v = scalarString(value, ctx);
  const like = { contains: v, mode: 'insensitive' as const };
  const ranked = op === '~' ? ctx.fulltext?.get(v) : undefined;
  const match: Where = { OR: [...(ranked?.length ? [{ id: { in: [...ranked] } }] : []), { summary: like }, { description: like }, { key: like }] };
  return op === '!~' ? { NOT: match } : match;
}
```
  Lưu ý: `ranked` rỗng/undefined ⇒ chỉ còn contains (khớp hành vi fallback hiện tại + thêm `key`). Thêm
```ts
/** Khoá project của điều kiện `project = X` / `project IN (…)` nằm trên chuỗi AND thuần; null nếu không có. */
export function topLevelProjectKeys(node: JqlNode | null): string[] | null {
  const walk = (n: JqlNode): string[] | null => {
    if (n.type === 'logical') return n.op === 'AND' ? (walk(n.left) ?? walk(n.right)) : null;
    if (n.type === 'not') return null;
    if (n.field !== 'project' || (n.operator !== '=' && n.operator !== 'IN')) return null;
    const vs = n.value.kind === 'list' ? n.value.value : [n.value];
    const keys = vs.flatMap((x) => (x.kind === 'string' ? [x.value] : []));
    return keys.length ? keys : null;
  };
  return node ? walk(node) : null;
}
```
  (`JqlValue.kind` = `'string'` cho cả giá trị trần lẫn có nháy — `packages/shared/src/jql.ts:68`; test ở Step 1 xác nhận `project = ABC` parse ra `string`.)
  `search.service.ts` đường JQL:
```ts
const terms = collectFulltextTerms(ast.where);
let scopeIds: string[] | undefined = opts.projectId ? [opts.projectId] : undefined;
const jqlKeys = topLevelProjectKeys(ast.where);
if (jqlKeys) {
  const found = (await this.prisma.project.findMany({ where: { workspaceId, key: { in: jqlKeys }, deletedAt: null }, select: { id: true } })).map((p) => p.id);
  scopeIds = scopeIds ? scopeIds.filter((id) => found.includes(id)) : found;
}
for (const term of terms) {
  const res = await this.fulltext.search(workspaceId, term, scopeIds ? { projectIds: scopeIds } : {});
  if (res) fulltext.set(term, res.ids);
}
...
let rankHint: string[] | undefined;
if (ids && !orderBy.length) rankHint = [...ids];
...
return this.issues.query(workspaceId, where, orderBy, opts.cursor, opts.limit, undefined, rankHint);
```
  (bỏ biến `rawIds` ở đường JQL; `searchText` truyền `res.ids` làm `rawIds` như cũ).
  `issues.service.ts`:
```ts
async query(workspaceId, where, orderBy, cursor, limit, rawIds?: string[], rankHint?: string[]) {
  const scope = { AND: [{ workspaceId, deletedAt: null }, where] };
  if (rawIds) { ...(giữ nguyên) }
  if (rankHint?.length && !orderBy.length) return this.queryRankFirst(scope, rankHint, cursor, limit);
  return this.queryOrdered(scope, orderBy, cursor, limit);
}

/** Id trong `rank` (đã xếp hạng) lên trước theo đúng thứ tự, sau đó các việc khớp còn lại theo updatedAt giảm dần. */
private async queryRankFirst(scope: Prisma.IssueWhereInput, rank: string[], cursor: string | undefined, limit: number): Promise<PageResult<IssueDto>> {
  const pos = new Map(rank.map((id, i) => [id, i]));
  const cursorRanked = cursor !== undefined && pos.has(cursor);
  const out: IssueDto[] = [];
  if (!cursor || cursorRanked) {
    const rows = await this.prisma.issue.findMany({ where: { AND: [scope, { id: { in: rank } }] }, include: issueInclude });
    const sorted = rows.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!).map((r) => this.toDto(r));
    const after = cursorRanked ? pos.get(cursor)! : -1;
    out.push(...sorted.filter((i) => pos.get(i.id)! > after).slice(0, limit + 1));
  }
  if (out.length < limit + 1) {
    const rest = await this.prisma.issue.findMany({
      where: { AND: [scope, { id: { notIn: rank } }] }, include: issueInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: limit + 1 - out.length,
      ...(cursor && !cursorRanked ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    out.push(...rest.map((r) => this.toDto(r)));
  }
  return cursorPage(out, limit, (i) => i.id);
}
```
  (thêm comment `// allow-deleted: scope đã gồm deletedAt: null` giống `queryOrdered` cho spec `soft-delete-coverage`.)
  `01_pgvector_fts.sql`: `CREATE INDEX IF NOT EXISTS issue_description_trgm ON "Issue" USING gin ("description" gin_trgm_ops); CREATE INDEX IF NOT EXISTS issue_key_trgm ON "Issue" USING gin ("key" gin_trgm_ops);`
- [ ] Step 4: chạy lại các spec → PASS; `pnpm --filter @tirapro/api test` toàn bộ (có spec `rbac-coverage`/`soft-delete-coverage` — `findMany` mới trong `queryRankFirst` phải lọt qua nhờ `scope` chứa `deletedAt: null` + comment `// allow-deleted:` giống `queryOrdered`); typecheck + lint api; trên DB thật: `pnpm --filter @tirapro/api run db:raw` rồi `GET /api/v1/search?jql=project = X AND text ~ "<chuỗi con của mô tả>"`.
- [ ] Step 5: Commit: `Search: text ~ scope FTS theo project, thêm khớp chuỗi con ở mô tả/mã issue, xếp hạng bằng rankHint thay vì giới hạn top 200`
**Rủi ro/đụng chạm:** `issues.service.ts` (`query`), `search.service.ts`, `jql-compiler.ts` — S và T4 không đụng các hàm này; `BoardsService.listIssues` gọi `search`/`query` (kiểm tra chữ ký `query` không đổi với caller cũ: tham số mới ở cuối, tuỳ chọn). Thay đổi hành vi: `text ~` rộng hơn (khớp chuỗi con description/key); kết quả không còn bị cắt ở 200 → ghi release note; cần chạy `db:raw` để có index trigram mới.

---

### Task C6: Jira import — idempotent theo `analyzeId`, khôi phục job kẹt, parse CSV không chặn event loop

**Mục tiêu:** (a) bấm "Chạy" hai lần (hoặc hai request song song) với cùng `analyzeId` chỉ tạo issue MỘT lần; (b) job `RUNNING` mà process đã chết/restart được đánh `FAILED` kèm lời nhắc rõ ràng; (c) parse CSV tới 25MB không đóng băng server (healthcheck/WS vẫn đáp trong lúc parse).
**Hiện trạng:**
- (a) `jira-import.service.ts:166-257` `run()` nạp tệp bằng `load(analyzeId)` (dòng 695-713) nhưng chỉ xoá tệp ở `finally` của `execute` (dòng ~395) ⇒ trong suốt thời gian chạy, request thứ hai với cùng `analyzeId` qua `load()` thành công và tạo job + issue trùng.
- (b) `execute` chạy nền trong process (`this.running` Map, dòng ~190); không có bước nào quét `ImportJob` `RUNNING` khi khởi động. Restart giữa chừng ⇒ job RUNNING vĩnh viễn (web poll mãi). `ImportService.importCsv/importJson` (`import.service.ts:125,279`) cũng tạo job RUNNING nhưng đồng bộ trong request — cùng rủi ro nếu process chết giữa chừng.
- (c) `jira-csv.parser.ts:166` `parse(input, {...}) as string[][]` dùng `csv-parse/sync` trên toàn bộ buffer (tới 25MB `JIRA_MAX_UPLOAD_BYTES`), gọi đồng bộ ở `analyze()` (dòng 99) và lại ở `load()` (dòng 709).
**Files:**
- Modify: `apps/api/src/modules/import/jira/jira-csv.parser.ts` — tách logic "record → JiraIssueRow" khỏi bước đọc CSV; thêm `parseJiraCsvAsync(input: Buffer | string): Promise<JiraParseResult>` (stream `csv-parse` + nhường event loop); giữ `parseJiraCsv` (đồng bộ) cho test/tương thích.
- Modify: `apps/api/src/modules/import/jira/jira-import.service.ts` — `analyze`/`load` dùng parse async; `claim`/`unclaim` tệp; `recoverStaleJobs` + `OnApplicationBootstrap` + `@Cron`; `removeFiles` xoá cả tệp claim.
- Test: `apps/api/src/modules/import/jira/jira-csv.parser.spec.ts`, `apps/api/src/modules/import/jira/jira-import.service.spec.ts`.
**Interfaces:** Produces: `parseJiraCsvAsync` (cùng kết quả với `parseJiraCsv`); `JiraImportService.recoverStaleJobs(staleMs?: number): Promise<number>`; lỗi nghiệp vụ mới "Phiên phân tích này đã được chạy…" khi `analyzeId` đã bị claim. Không đổi API HTTP/shape response.
**Quyết định thiết kế:**
- Khoá idempotent bằng `fs.rename` nguyên tử `<id>.json → <id>.claimed` ngay trước khi tạo `ImportJob` (sau mọi bước kiểm tra, KHÔNG áp dụng khi `dryRun`). Rename thất bại `ENOENT` ⇒ request khác đã claim ⇒ `BusinessRuleException`. Nếu `importJob.create` ném lỗi ⇒ rename ngược để người dùng thử lại. Không dùng khoá DB vì tệp phân tích vốn nằm trên đĩa local của node (`storage.localDir`) nên claim cùng nơi là đủ và không cần migration. `removeFiles` xoá cả `.claimed`; `load()` thấy `.claimed` tồn tại ⇒ thông báo "đã/đang được import".
- Không requeue job kẹt (issue đã tạo dở ⇒ chạy lại sẽ trùng): chuyển `FAILED`, `errorLog` ghi rõ "bị gián đoạn… số việc đã tạo được giữ nguyên; kiểm tra dự án rồi import lại phần thiếu". Điều kiện "kẹt" = `RUNNING` và `updatedAt` cũ hơn `STALE_JOB_MS = 3 phút` (execute cập nhật `processedItems` mỗi lô ⇒ `updatedAt` là heartbeat) và id không nằm trong `this.running` của node này. Chạy ở `onApplicationBootstrap` và `@Cron(CronExpression.EVERY_5_MINUTES)` (an toàn đa node vì là một `updateMany` idempotent, không cần `withCronLock`). Áp dụng cho MỌI `ImportJob RUNNING` (kể cả CSV/JSON).
- Parse async: `Readable.from(chunks)` (cắt buffer 64KB) `.pipe(parse(opts))` rồi `for await (const rec of parser)`; sau mỗi 500 dòng `await new Promise((r) => setImmediate(r))`. Không thêm dependency (`csv-parse` đã có; stream API nằm trong cùng gói). Không dùng worker thread (đủ với yield, tránh phức tạp). Giữ giới hạn 25MB.
- [ ] Step 1: Viết test fail.
  `jira-csv.parser.spec.ts`:
```ts
describe('parseJiraCsvAsync', () => {
  it('cho kết quả giống hệt parseJiraCsv trên jira-sample.csv', async () => {
    const [a, b] = [parseJiraCsv(fixture), await parseJiraCsvAsync(fixture)];
    expect(b.issues).toEqual(a.issues);
    expect(b.unknownColumns).toEqual(a.unknownColumns);
    expect([...b.accountNames]).toEqual([...a.accountNames]);
  });
  it('không chặn event loop: setImmediate/timer vẫn chạy xen giữa lúc parse tệp lớn', async () => {
    const header = 'Summary,Issue key\n';
    const big = header + Array.from({ length: 60_000 }, (_, i) => `Việc ${i},P-${i}`).join('\n');
    let ticks = 0;
    const t = setInterval(() => { ticks++; }, 0);
    const r = await parseJiraCsvAsync(Buffer.from(big));
    clearInterval(t);
    expect(r.issues).toHaveLength(60_000);
    expect(ticks).toBeGreaterThan(3); // ≥ vài lần nhường event loop
  });
});
```
  `jira-import.service.spec.ts` (theo `setup()`; mock `importJob.updateMany`):
```ts
it('hai run() song song cùng analyzeId => chỉ MỘT job được tạo, lần hai bị từ chối', async () => {
  const { service, prisma, input } = await prepared(); // analyze() rồi dựng input như các test run hiện có
  const results = await Promise.allSettled([service.run('w1', 'u1', input), service.run('w1', 'u1', input)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(prisma.importJob.create).toHaveBeenCalledTimes(1);
  const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(rej.reason).toBeInstanceOf(BusinessRuleException);
});
it('dry-run KHÔNG claim: chạy dry-run rồi chạy thật vẫn được', async () => { /* dryRun true → rồi false */ });
it('importJob.create ném lỗi => nhả claim, lần sau chạy lại được', async () => { /* create.mockRejectedValueOnce */ });
it('recoverStaleJobs: RUNNING quá hạn (không thuộc node này) => FAILED + errorLog; trả số dòng', async () => {
  const { service, prisma } = setup();
  prisma.importJob.updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
  expect(await service.recoverStaleJobs(60_000)).toBe(2);
  const arg = (prisma.importJob.updateMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
  expect(arg.where).toMatchObject({ status: 'RUNNING', updatedAt: { lt: expect.any(Date) as unknown } });
  expect(arg.data).toMatchObject({ status: 'FAILED' });
  expect(String(arg.data.errorLog)).toContain('gián đoạn');
});
it('onApplicationBootstrap gọi recoverStaleJobs và không ném khi DB lỗi', async () => { /* updateMany reject → resolves */ });
```
  (Người làm: `prepared()` nên tái dùng đoạn dựng `input` của test `run — chạy thật` (dòng ~223-240 spec) và thêm `updateMany` vào mock `importJob` của `setup()`.)
- [ ] Step 2: `pnpm --filter @tirapro/api exec vitest run src/modules/import` → FAIL.
- [ ] Step 3: Implementation.
  Parser — tách builder dùng chung:
```ts
class JiraRowBuilder {
  readonly issues: JiraIssueRow[] = [];
  readonly accountNames = new Map<string, string>();
  readonly unknownColumns: string[] = [];
  constructor(header: string[]) { /* toàn bộ phần tính lower/indexesOf/USED_COLUMNS/unknownColumns/spIdx/descIdx + kiểm tra 2 cột bắt buộc (ném Error như cũ) */ }
  add(cells: string[]): void { /* thân vòng `for` hiện tại (dòng 195-239) */ }
  result(): JiraParseResult { return { issues: this.issues, unknownColumns: this.unknownColumns, accountNames: this.accountNames }; }
}
const CSV_OPTS = { bom: true, skip_empty_lines: true, relax_column_count: true, trim: false } as const;

export function parseJiraCsv(input: string | Buffer): JiraParseResult {
  const records = parse(input, CSV_OPTS) as string[][];
  const b = new JiraRowBuilder((records[0] ?? []).map((h) => h.trim()));
  for (let r = 1; r < records.length; r++) b.add(records[r]!);
  return b.result();
}

export async function parseJiraCsvAsync(input: string | Buffer): Promise<JiraParseResult> {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  const chunks = function* () { for (let i = 0; i < buf.length; i += 65_536) yield buf.subarray(i, i + 65_536); };
  const parser = Readable.from(chunks(), { objectMode: false }).pipe(streamParse(CSV_OPTS));
  let builder: JiraRowBuilder | null = null;
  let n = 0;
  for await (const rec of parser as AsyncIterable<string[]>) {
    if (!builder) { builder = new JiraRowBuilder(rec.map((h) => h.trim())); continue; }
    builder.add(rec);
    if (++n % 500 === 0) await new Promise<void>((r) => setImmediate(r));
  }
  return (builder ?? new JiraRowBuilder([])).result(); // header rỗng ⇒ constructor ném lỗi thiếu cột Summary như bản sync
}
```
  với `import { parse as streamParse } from 'csv-parse'; import { Readable } from 'node:stream';` (giữ `parse` từ `csv-parse/sync`). Lưu ý: `row: issues.length + 1` trong `add` phải giữ nguyên.
  Service:
```ts
const STALE_JOB_MS = 3 * 60 * 1000;
const INTERRUPTED_MESSAGE = 'Tiến trình import bị gián đoạn (máy chủ khởi động lại hoặc dừng đột ngột). Các việc đã tạo trước đó được giữ nguyên — hãy kiểm tra dự án rồi import lại phần còn thiếu.';
const ALREADY_RUN_MESSAGE = 'Phiên phân tích này đã (hoặc đang) được import — hãy tải lại tệp CSV để tạo phiên mới nếu muốn import lại';

export class JiraImportService implements OnApplicationBootstrap {
  async onApplicationBootstrap(): Promise<void> {
    await this.recoverStaleJobs().catch((e) => this.logger.warn(`Khôi phục job import kẹt thất bại: ${this.errMessage(e)}`));
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepStaleJobs(): Promise<void> {
    await this.recoverStaleJobs().catch((e) => this.logger.warn(`Quét job import kẹt thất bại: ${this.errMessage(e)}`));
  }

  async recoverStaleJobs(staleMs = STALE_JOB_MS): Promise<number> {
    const { count } = await this.prisma.importJob.updateMany({
      where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - staleMs) }, id: { notIn: [...this.running.keys()] } },
      data: { status: 'FAILED', completedAt: new Date(), errorLog: INTERRUPTED_MESSAGE },
    });
    if (count) this.logger.warn(`Đã đánh FAILED ${count} job import bị gián đoạn`);
    return count;
  }

  /** Claim nguyên tử: chỉ MỘT request đổi tên được `<id>.json` → `<id>.claimed`. */
  private async claim(analyzeId: string): Promise<void> {
    try { await fs.rename(path.join(this.dir(), `${analyzeId}.json`), path.join(this.dir(), `${analyzeId}.claimed`)); }
    catch { throw new BusinessRuleException(ALREADY_RUN_MESSAGE); }
  }
  private async unclaim(analyzeId: string): Promise<void> {
    await fs.rename(path.join(this.dir(), `${analyzeId}.claimed`), path.join(this.dir(), `${analyzeId}.json`)).catch(() => undefined);
  }
```
  Trong `run()`: sau khối `if (input.options.dryRun) {...return}` và TRƯỚC `importJob.create`: `await this.claim(input.analyzeId);` bọc `importJob.create` bằng `try { ... } catch (e) { await this.unclaim(input.analyzeId); throw e; }`. `removeFiles`: `for (const ext of ['csv', 'json', 'claimed'])`. `load()`: ở nhánh `catch` kiểm tra `fs.access(<id>.claimed)` ⇒ ném `ALREADY_RUN_MESSAGE`, ngược lại `EXPIRED_MESSAGE`; `parseJiraCsv(await fs.readFile(csvPath))` → `await parseJiraCsvAsync(...)`; `analyze()` dòng 99 dùng `await parseJiraCsvAsync(file.buffer)`. Import `Cron, CronExpression` từ `@nestjs/schedule`, `OnApplicationBootstrap` từ `@nestjs/common`. `purgeExpired` đã xoá mọi tệp quá hạn (gồm `.claimed`).
- [ ] Step 4: chạy lại `src/modules/import` → PASS (test cũ của parser sync + service giữ nguyên); `pnpm --filter @tirapro/api typecheck && lint`; `pnpm --filter @tirapro/api test` (đảm bảo spec coverage); kiểm thủ công: chạy import fixture 20 dòng qua UI hai lần nhanh liên tiếp → lần hai báo lỗi, 20 issue; kill API giữa job lớn, khởi động lại, sau ≤ 5 phút job thành FAILED.
- [ ] Step 5: Commit: `Import Jira: claim analyzeId chống chạy trùng, tự đánh FAILED job kẹt sau restart, parse CSV dạng stream không chặn event loop`
**Rủi ro/đụng chạm:** chỉ khu `import/jira/*` (không task C khác đụng). Không migration. Nếu process crash GIỮA claim và tạo job, tệp ở trạng thái `.claimed` và người dùng phải tải lại CSV (TTL 1 giờ dọn) — chấp nhận. Release note: job import cũ treo RUNNING sẽ tự chuyển FAILED sau khi deploy.

---

### Task C7: Digest không gửi đôi khi lệch đồng hồ giữa node — compare-and-set `lastRunAt`

**Mục tiêu:** cùng một subscription không nhận digest hai lần trong một lượt 8h sáng dù hai node API có đồng hồ lệch vài giây/phút (node A xong và nhả khoá trước khi cron của node B bắt đầu).
**Hiện trạng:** `digests.service.ts:297-303` bọc `sendScheduled` bằng `withCronLock(redis, 'digests:scheduled', 1800, …)`; `common/cron-lock.ts:62-69` DEL khoá ngay khi `fn` xong. Node B (đồng hồ chậm hơn) kích hoạt cron SAU khi A đã DEL ⇒ lấy lại khoá ⇒ gửi lại. `sendScheduled` (dòng 305-348) đọc subs và gửi, chỉ GHI `lastRunAt` SAU khi gửi (dòng 343) và không đọc nó để chặn.
**Files:**
- Modify: `apps/api/src/modules/digests/digests.service.ts:305-348` (`sendScheduled`) — chọn thêm `lastRunAt`, claim bằng `updateMany` CAS trước khi gửi, hoàn lại khi gửi lỗi.
- Test: Create `apps/api/src/modules/digests/digests.service.spec.ts` (hiện chưa có spec cho module này — kiểm `ls apps/api/src/modules/digests`).
**Interfaces:** Không đổi API/event. Hằng mới nội bộ `DIGEST_DEDUPE_MS = 30 * 60 * 1000` (= TTL khoá cron 1800s).
**Quyết định thiết kế:** `ReportSubscription.lastRunAt` ĐÃ có trong schema (không cần migration) — chỉ chưa dùng làm chốt. Với mỗi sub: bỏ qua nếu `lastRunAt` mới hơn `now - 30 phút`; CAS `updateMany({ where: { id, lastRunAt: <giá trị vừa đọc, null→null> }, data: { lastRunAt: now } })`, `count === 0` ⇒ node khác đã nhận ⇒ bỏ qua. Nếu `buildDigest`/`send` NÉM lỗi ⇒ hoàn `lastRunAt` về giá trị cũ bằng CAS ngược (`where lastRunAt = now`) để lượt retry/tay vẫn chạy được. `send()` trả `false` (không có kênh/token) coi như đã xử lý (giữ `lastRunAt`, đúng như hành vi cũ). Cửa sổ 30 phút còn nghĩa: `run()` thủ công trong 30 phút trước 8h sáng sẽ loại sub đó khỏi lượt cron — chấp nhận và ghi chú. Không đổi `withCronLock` (dùng chung cho 5 cron khác); vẫn giữ khoá như lớp chặn thứ nhất.
- [ ] Step 1: Viết test fail `digests.service.spec.ts` — khởi tạo `new DigestsService(prisma as never, {} as never /* TelegramService */, { isAvailable: () => false, getClient: () => null } as never /* RedisService */)` (constructor `digests.service.ts:45-49`; `buildDigest`/`send` spy qua `vi.spyOn(service, 'buildDigest').mockResolvedValue('text')`, `vi.spyOn(service as never, 'send')`):
```ts
function make(subs: Array<{ id: string; lastRunAt: Date | null }>, casCount = 1) {
  const updateMany = vi.fn(() => Promise.resolve({ count: casCount }));
  const prisma = {
    reportSubscription: {
      findMany: vi.fn(() => Promise.resolve(subs.map((s) => ({ ...s, workspaceId: 'w1', projectId: null, channelId: 'c1', schedule: 'DAILY' })))),
      updateMany,
    },
  };
  const service = new DigestsService(prisma as never, {} as never, { isAvailable: () => false, getClient: () => null } as never);
  const send = vi.spyOn(service as never, 'send' as never).mockResolvedValue(true as never);
  vi.spyOn(service, 'buildDigest').mockResolvedValue('t');
  return { service, prisma, updateMany, send };
}
it('sub vừa chạy < 30 phút trước (node khác nhanh hơn) => không gửi lại', async () => {
  const { service, send } = make([{ id: 's1', lastRunAt: new Date(Date.now() - 60_000) }]);
  await service.runScheduled();
  expect(send).not.toHaveBeenCalled();
});
it('CAS thua (node khác claim cùng lúc) => không gửi', async () => {
  const { service, send, updateMany } = make([{ id: 's1', lastRunAt: new Date('2026-10-14T01:00:00Z') }], 0);
  await service.runScheduled();
  expect(updateMany).toHaveBeenCalledWith({ where: { id: 's1', lastRunAt: new Date('2026-10-14T01:00:00Z') }, data: { lastRunAt: expect.any(Date) as unknown } });
  expect(send).not.toHaveBeenCalled();
});
it('claim thành công => gửi đúng một lần; lastRunAt đã được đặt TRƯỚC khi gửi', async () => {
  const { service, send, updateMany } = make([{ id: 's1', lastRunAt: null }]);
  await service.runScheduled();
  expect(send).toHaveBeenCalledTimes(1);
  expect(updateMany.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!);
});
it('gửi ném lỗi => hoàn lastRunAt về giá trị cũ', async () => {
  const prev = new Date('2026-10-14T01:00:00Z');
  const { service, send, updateMany } = make([{ id: 's1', lastRunAt: prev }]);
  send.mockRejectedValue(new Error('telegram down'));
  await service.runScheduled();
  expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 's1', lastRunAt: expect.any(Date) as unknown }, data: { lastRunAt: prev } });
});
```
  (`redis` giả `isAvailable: false` ⇒ `withCronLock` chạy thẳng `sendScheduled`.)
- [ ] Step 2: `pnpm --filter @tirapro/api exec vitest run src/modules/digests` → FAIL.
- [ ] Step 3: Implementation — trong `sendScheduled`: thêm `lastRunAt: true` vào `select`; kiểu `subs` thêm `lastRunAt: Date | null`; thay thân vòng `for`:
```ts
for (const sub of subs) {
  if (this.stopping) break;
  const now = new Date();
  if (sub.lastRunAt && now.getTime() - sub.lastRunAt.getTime() < DIGEST_DEDUPE_MS) continue; // node khác vừa gửi (lệch đồng hồ)
  try {
    // Compare-and-set: chỉ một node thắng; node thua thấy count 0.
    const claimed = await this.prisma.reportSubscription.updateMany({
      where: { id: sub.id, lastRunAt: sub.lastRunAt }, data: { lastRunAt: now },
    });
    if (claimed.count === 0) continue;
    try {
      const text = await this.buildDigest(sub.workspaceId, sub.projectId ?? undefined);
      await this.send(sub.channelId, text);
    } catch (err) {
      // Chưa gửi được: trả lại để lượt sau còn chạy.
      await this.prisma.reportSubscription.updateMany({ where: { id: sub.id, lastRunAt: now }, data: { lastRunAt: sub.lastRunAt } }).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    this.warn(`runScheduled.sub:${sub.id}`, err);
  }
}
```
  (xoá `update({ lastRunAt })` cũ ở cuối vì đã đặt khi claim). Khai báo `const DIGEST_DEDUPE_MS = 30 * 60 * 1000;` cạnh `SEVEN_DAYS_MS`.
- [ ] Step 4: chạy lại spec → PASS; `pnpm --filter @tirapro/api typecheck && lint`.
- [ ] Step 5: Commit: `Digest: claim subscription bằng compare-and-set lastRunAt để không gửi đôi khi lệch đồng hồ giữa node`
**Rủi ro/đụng chạm:** chỉ `digests.service.ts`. Hành vi mới: `lastRunAt` được ghi trước khi gửi; chạy tay (`run()`) trong 30 phút trước 8h làm cron bỏ qua sub đó — ghi release note.

---

### Task C8: Server phát `comment:updated` / `comment:deleted` qua WebSocket

**Mục tiêu:** sửa/xoá bình luận ở một trình duyệt được phản ánh ngay ở các trình duyệt khác đang xem cùng issue/dự án.
**Hiện trạng:** `comments.service.ts:64,75` đã emit `DOMAIN_EVENTS.COMMENT_UPDATED/DELETED` nhưng payload KHÔNG có `projectId` (`{ comment, issueId, actorId }` / `{ commentId, issueId, actorId }`) và `realtime.gateway.ts` chỉ có `@OnEvent(COMMENT_ADDED)` (dòng ~359) ⇒ không bao giờ ra WS. Hợp đồng đã có sẵn: `ServerToClientEvents['comment:updated'|'comment:deleted']` (`packages/shared/src/ws.ts`), `WS_EVENTS.COMMENT_UPDATED/DELETED`. Web `lib/realtime.ts:131-150` ĐÃ nghe cả ba (`onComment` invalidate `keys.issues.comments(issueId)` + `activity`) ⇒ không cần đổi hành vi web.
**Files:**
- Modify: `apps/api/src/modules/comments/comments.service.ts:53-77` — `requireComment` trả thêm `issue.projectId`; thêm `projectId` vào payload hai event.
- Modify: `apps/api/src/modules/realtime/realtime.gateway.ts` (sau `onCommentAdded`) — `onCommentUpdated`, `onCommentDeleted`.
- Modify: `apps/web/src/lib/realtime.ts:131-136` — tách `onComment` thành hàm xuất khẩu `applyCommentChanged(qc, issueId)` để test được (không đổi hành vi).
- Test: `apps/api/src/modules/comments/comments.service.spec.ts`, `apps/api/src/modules/realtime/realtime.gateway.spec.ts`, `apps/web/src/lib/realtime.test.ts` (file tạo ở C2 — thêm `describe`; nếu C8 chạy trước C2 thì tạo file với cùng mock `./socket`).
**Interfaces:** Produces: DOMAIN `comment.updated {comment, issueId, projectId, actorId}`, `comment.deleted {commentId, issueId, projectId, actorId}`; WS `comment:updated {comment}`, `comment:deleted {commentId, issueId}` tới room `project:<id>`. Consumers khác của hai domain event: kiểm `grep -rn "COMMENT_UPDATED\|COMMENT_DELETED" apps/api/src` — hiện chỉ có chỗ emit.
**Quyết định thiết kế:** giữ nguyên tên/shape WS đã khai báo; chỉ BỔ SUNG `projectId` vào payload domain (tương thích ngược). `requireComment` đổi `findFirst` thêm `include: { issue: { select: { projectId: true } } }` (cùng truy vấn, không thêm round-trip). Web không cần đổi — chỉ thêm test ghim hành vi; điều này cũng xác nhận phần "web lắng nghe cập nhật cache" của follow-up đã đủ.
- [ ] Step 1: Viết test fail.
  `comments.service.spec.ts` (mở rộng `make`: `findFirst` comment trả thêm `issue: { projectId: 'p1' }`; `update` trả đủ trường cho `toDto` — dùng một comment row tối thiểu: xem `toDto` ở `comments.service.ts:90-110` và `commentInclude`):
```ts
it('update() phát comment.updated kèm projectId', async () => {
  const { service, events } = make('u1');
  await service.update('w1', 'u1', 'c1', 'nội dung mới', 1);
  expect(events.emit).toHaveBeenCalledWith('comment.updated', expect.objectContaining({ issueId: 'i1', projectId: 'p1', actorId: 'u1' }));
});
it('softDelete() phát comment.deleted kèm projectId', async () => {
  const { service, events } = make('u1');
  await service.softDelete('w1', 'u1', 'c1');
  expect(events.emit).toHaveBeenCalledWith('comment.deleted', { commentId: 'c1', issueId: 'i1', projectId: 'p1', actorId: 'u1' });
});
```
  `realtime.gateway.spec.ts` (describe "bridge notification & sprint"):
```ts
it('comment.updated -> comment:updated tới room project', () => {
  const { gateway, to, emit } = makeGateway();
  const comment = { id: 'C1', issueId: 'I1' } as never;
  gateway.onCommentUpdated({ comment, issueId: 'I1', projectId: 'P1' });
  expect(to).toHaveBeenCalledWith('project:P1');
  expect(emit).toHaveBeenCalledWith(WS_EVENTS.COMMENT_UPDATED, { comment });
});
it('comment.deleted -> comment:deleted {commentId, issueId} tới room project; thiếu projectId thì bỏ qua', () => {
  const { gateway, to, emit } = makeGateway();
  gateway.onCommentDeleted({ commentId: 'C1', issueId: 'I1', projectId: 'P1' });
  expect(emit).toHaveBeenCalledWith(WS_EVENTS.COMMENT_DELETED, { commentId: 'C1', issueId: 'I1' });
  to.mockClear();
  gateway.onCommentDeleted({ commentId: 'C1', issueId: 'I1' });
  expect(to).not.toHaveBeenCalled();
});
```
  Web `realtime.test.ts`:
```ts
describe('applyCommentChanged', () => {
  it('invalidate bình luận + hoạt động của đúng issue', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.issues.comments('i1'), []); qc.setQueryData(keys.issues.activity('i1'), []);
    qc.setQueryData(keys.issues.comments('i2'), []);
    applyCommentChanged(qc, 'i1');
    expect(qc.getQueryState(keys.issues.comments('i1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.activity('i1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.issues.comments('i2'))?.isInvalidated).toBe(false);
  });
});
```
- [ ] Step 2: chạy `pnpm --filter @tirapro/api exec vitest run src/modules/comments src/modules/realtime/realtime.gateway.spec.ts` và `pnpm --filter @tirapro/web exec vitest run src/lib/realtime.test.ts` → FAIL.
- [ ] Step 3: Implementation.
  `comments.service.ts`: `requireComment` → `findFirst({ where: {...}, include: { issue: { select: { projectId: true } } } })`; `update`: `this.events.emit(COMMENT_UPDATED, { comment: dto, issueId: updated.issueId, projectId: current.issue.projectId, actorId: userId })`; `softDelete`: thêm `projectId: current.issue.projectId`.
  Gateway:
```ts
@OnEvent(DOMAIN_EVENTS.COMMENT_UPDATED)
onCommentUpdated(p: { comment: CommentDto; projectId?: string }) {
  this.toProject(p.projectId, WS_EVENTS.COMMENT_UPDATED, { comment: p.comment });
}

@OnEvent(DOMAIN_EVENTS.COMMENT_DELETED)
onCommentDeleted(p: { commentId: string; issueId: string; projectId?: string }) {
  this.toProject(p.projectId, WS_EVENTS.COMMENT_DELETED, { commentId: p.commentId, issueId: p.issueId });
}
```
  Web: `export function applyCommentChanged(qc: QueryClient, issueId: string) { void qc.invalidateQueries({ queryKey: keys.issues.comments(issueId) }); void qc.invalidateQueries({ queryKey: keys.issues.activity(issueId) }); }` và `onComment` gọi nó.
- [ ] Step 4: chạy lại → PASS; typecheck/lint api + web; smoke 2 trình duyệt: sửa/xoá comment ở tab A, tab B (cùng issue) tự cập nhật.
- [ ] Step 5: Commit: `Comment: phát comment:updated/deleted qua WS kèm projectId, tách applyCommentChanged ở web`
**Rủi ro/đụng chạm:** `realtime.gateway.ts` + `lib/realtime.ts` + `realtime.test.ts` cùng C2. Các listener domain khác của `comment.updated/deleted`: không có (đã kiểm). Không migration.

---

### Task C9: `setColumns` khoá board và bắt P2002

**Mục tiêu:** hai người cùng lưu cấu hình cột board không còn ghi chồng/hỏng dữ liệu hay nhận 500; xung đột hiển thị thông báo tiếng Việt rõ ràng.
**Hiện trạng:** `boards.service.ts:93-153` đọc `board`/cột (`require`, dòng 94) NGOÀI transaction, rồi `$transaction` xoá cột bị bỏ → đổi tên tạm → cập nhật/tạo → ghi lại liên kết. Hai request đồng thời: request sau dùng `existingIds` cũ (xoá/cập nhật cột đã bị request kia xoá ⇒ lỗi Prisma P2025 → 500) hoặc cùng tạo cột tên trùng ⇒ vi phạm `@@unique([boardId, name])` (`schema.prisma:941`) ⇒ P2002 không bắt (filter chung trả 409 chung chung chứ không có hướng dẫn). Cơ chế khoá hiện hữu để bắt chước: `issues.service.ts:~612` `SELECT … FOR UPDATE` khi kiểm WIP.
**Files:**
- Modify: `apps/api/src/modules/boards/boards.service.ts:136-151` — khoá board trong transaction, đọc lại cột để kiểm `existingIds`, bắt P2002/P2025.
- Test: `apps/api/src/modules/boards/boards.service.spec.ts` (mở rộng `make()` ở dòng 24-44: `tx.$queryRaw`, `tx.boardColumn.findMany`).
**Interfaces:** Không đổi API. Lỗi mới (422 `BUSINESS_RULE_VIOLATION`): "Bảng vừa được người khác thay đổi — hãy tải lại trang rồi chỉnh lại" và "Tên cột bị trùng nhau…".
**Quyết định thiết kế:** khoá `Board` (không phải từng cột) bằng `SELECT "id" FROM "Board" WHERE "id" = $1 FOR UPDATE` làm câu ĐẦU trong transaction ⇒ các `setColumns` đồng thời xếp hàng. `enforceWip` chỉ khoá dòng `BoardColumn` (không khoá Board) nên không có chu trình khoá; `deleteMany`/`update` cột sẽ chờ transaction WIP đang giữ dòng cột rồi tiếp tục — chấp nhận. Sau khoá, đọc lại `boardColumn.findMany({ where: { boardId }, select: { id: true } })` và kiểm `existingIds` (thay vì dùng `board.columns` đã cũ): cột client tham chiếu không còn ⇒ `BusinessRuleException` (không `NotFound` 404 mơ hồ). P2002 từ `create/update` ⇒ thông báo tên trùng; P2025 ⇒ thông báo "vừa thay đổi". Phần kiểm tra thuần (status, trùng tên trong payload) giữ NGOÀI transaction.
- [ ] Step 1: Viết test fail (mở rộng `make`: `tx.$queryRaw: vi.fn(() => Promise.resolve([{ id: 'b1' }]))`, `tx.boardColumn.findMany: vi.fn(() => Promise.resolve(board.columns.map(c => ({ id: c.id }))))` — tham số `existingColumnIds?` để test ghi đè):
```ts
it('khoá dòng Board (FOR UPDATE) là câu đầu tiên trong transaction, trước mọi ghi', async () => {
  const { service, tx } = make();
  await service.setColumns('w1', 'b1', { columns: [col('Todo', ['s1'], { id: 'c1' }), col('Doing', ['s2'], { id: 'c2' }), col('Done', ['s3'], { id: 'c3' })] });
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  expect(tx.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(tx.boardColumn.deleteMany.mock.invocationCallOrder[0]!);
});
it('cột client tham chiếu đã bị người khác xoá (so với bản đọc lại sau khoá) => lỗi rõ ràng, không ghi', async () => {
  const { service, tx } = make(boardRow(), { lockedColumnIds: ['c1', 'c3'] }); // c2 đã bị xoá
  await expect(service.setColumns('w1', 'b1', { columns: [col('A', ['s1', 's2'], { id: 'c1' }), col('B', ['s3'], { id: 'c2' })] }))
    .rejects.toMatchObject({ status: 422, message: has('vừa được người khác thay đổi') });
  expect(tx.boardColumn.update).not.toHaveBeenCalled();
});
it('P2002 khi ghi cột => thông báo tên trùng thay vì 500', async () => {
  const { service, tx } = make();
  tx.boardColumn.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
  await expect(service.setColumns('w1', 'b1', { columns: [col('Todo', ['s1'], { id: 'c1' }), col('Doing', ['s2'], { id: 'c2' }), col('Done', ['s3'], { id: 'c3' })] }))
    .rejects.toMatchObject({ status: 422, message: has('trùng') });
});
```
  (thêm `import { Prisma } from '@prisma/client'`; test cũ không đổi vì `findMany` mặc định trả đúng các cột của board.)
- [ ] Step 2: `pnpm --filter @tirapro/api exec vitest run src/modules/boards` → FAIL.
- [ ] Step 3: Implementation — thay khối transaction:
```ts
try {
  await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR UPDATE`;
    const live = new Set((await tx.boardColumn.findMany({ where: { boardId }, select: { id: true } })).map((c) => c.id));
    for (const id of keepIds) {
      if (!live.has(id)) throw new BusinessRuleException('Bảng vừa được người khác thay đổi — hãy tải lại trang rồi chỉnh lại các cột');
    }
    ...(thân cũ: deleteMany, đổi tên tạm, update/create, links)
  });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') throw new BusinessRuleException('Tên cột bị trùng nhau (hoặc vừa có người tạo cột cùng tên) — hãy đặt mỗi cột một tên khác nhau rồi lưu lại');
    if (e.code === 'P2025') throw new BusinessRuleException('Bảng vừa được người khác thay đổi — hãy tải lại trang rồi chỉnh lại các cột');
  }
  throw e;
}
```
  Bỏ kiểm `existingIds` dựa `board.columns` ở dòng 128-134 chỉ nếu muốn gọn; GIỮ nó (lỗi 404 sớm khi id không thuộc board) để các test cũ (`id: 'cột-của-board-khác'` → 404) vẫn đúng — kiểm sau khoá là lớp bổ sung cho race.
- [ ] Step 4: chạy lại → PASS; typecheck + lint api; trên DB thật: hai `PUT /boards/:id/columns` song song (curl `&`) — một thành công, một thành công tuần tự hoặc 422 rõ ràng, không 500.
- [ ] Step 5: Commit: `Board: setColumns khoá dòng Board và dịch P2002/P2025 thành lỗi tiếng Việt`
**Rủi ro/đụng chạm:** chỉ `boards.service.ts`. Không migration. Không đổi hành vi khi không có tranh chấp.

---

#### Bảng đụng chạm

| File | Task trong nhóm C | Ghi chú thứ tự |
|---|---|---|
| `apps/api/src/modules/issues/issues.service.ts` | C2 (`resolveRank`, ~726-751), C3 (`bulkUpdate` emit, ~480-491), C5 (`query` + `queryRankFirst`, ~301-325) | Ba vùng tách biệt, không chồng dòng. Thứ tự: C3 → C2 → C5 (hoặc bất kỳ, rebase đơn giản). Cùng file nhóm S (`move()`, dòng 524-558) — C2 đứng cạnh `move()` ⇒ làm C2 SAU S. T4 (tách `RankService`) làm SAU CÙNG: mang theo `resolveRank/rebalanceProject/rankOf/neighborsInverted` + test của C2. |
| `apps/api/src/modules/issues/issues.service.spec.ts` | C2, C3, C5 | Thêm describe/it mới, không sửa test cũ (trừ mở rộng helper `bulkTx` nếu cần ở C3). |
| `apps/web/src/lib/realtime.ts` + `apps/web/src/lib/realtime.test.ts` (tạo ở C2) | C2, C8 | Làm C2 trước (tạo test + mock `./socket`), C8 thêm describe. |
| `apps/api/src/modules/realtime/realtime.gateway.ts` + `.spec.ts` | C2, C8 | Hai handler độc lập, cuối file; thứ tự tuỳ ý. |
| `packages/types/src/events.ts`, `packages/types/src/common.ts`, `packages/shared/src/ws.ts`, `apps/api/src/common/exceptions/app.exception.ts`, `apps/web/src/lib/api.ts` | C2 (chỉ C2) | Đụng `packages/*` ⇒ chạy typecheck cả `types`, `shared`, `api`, `web`. Nhóm khác (S/W) có thể cũng thêm vào `ERROR_CODES`/`ERROR_MESSAGES` — rebase thủ công. |
| `apps/web/src/features/board/BoardPage.tsx` | C4 (chỉ C4 trong nhóm C) | Nhóm W có thể sửa board/web — kiểm trước khi làm. |
| `apps/web/src/features/backlog/api.ts` | C3 (chỉ C3) | — |
| `apps/api/src/modules/search/*` | C5 | — |
| `apps/api/prisma/sql/01_pgvector_fts.sql` | C5 | Chạy `db:raw` sau deploy. |

Thứ tự đề xuất trong nhóm C: C1 → C9 → C7 → C8 → C2 → C3 → C5 → C6 → C4 (độc lập hầu hết; C8 trước C2 hoặc ngược lại đều được nếu nhớ tạo `realtime.test.ts` ở task đến trước).

#### Ngoài phạm vi / không làm

- **Quick-add ở cột nhiều status (`Column.tsx:31` dùng `col.statusIds[0]`)**: thuộc "tạo mới", không thuộc follow-up C4 (thả thẻ); để nguyên (status đầu của cột thường là trạng thái khởi tạo).
- **C2 phía web "kéo thả backlog gửi afterId/beforeId"**: web hiện KHÔNG gọi `POST /issues/:id/move` (`grep afterId|beforeId apps/web/src` = 0) nên nhánh 409 chỉ phục vụ API client; không thêm UI.
- **C6 requeue job kẹt**: không làm (issue đã tạo dở ⇒ chạy lại sẽ trùng); chỉ đánh FAILED.
- **C7 `lastRunAt`**: cột ĐÃ tồn tại trong `ReportSubscription` (được ghi ở `digests.service.ts:107,343`) — follow-up viết như thể chưa có, nhưng chỉ chưa được dùng làm chốt chống gửi đôi; không cần migration.
- **C8 phần web**: `lib/realtime.ts:148-150` ĐÃ nghe `comment:updated`/`comment:deleted` — chỉ thiếu phía server; web chỉ được tách hàm + test, không đổi hành vi.

## Nhóm W — Web / UX

#### Nhóm W — Web / UX

> Thứ tự làm đề xuất: **W2 → W1 → W3 → W6 → W5 → W4** (lý do ở mục "Bảng đụng chạm" cuối nhóm). Test web chạy bằng vitest ở môi trường `node` (không jsdom, không testing-library): logic thuần test trực tiếp; hook React test bằng `renderToString` + `QueryClient.setQueryData` (xem W1); UI còn lại ghi bước kiểm tay. Lệnh chuẩn: `pnpm --filter @tirapro/web test`, `pnpm --filter @tirapro/web typecheck`, `pnpm --filter @tirapro/web lint`; phía API: `pnpm --filter @tirapro/api test|typecheck|lint`. Nếu đổi `packages/types` thì chạy `pnpm --filter @tirapro/types build` trước khi typecheck web/api (dist không nằm trong git).

### Task W1: Quyền hiệu lực theo dự án trên web (`useCan(projectId)`)

**Mục tiêu:** Trong ngữ cảnh một dự án, nút/hành động (Ghi thời gian, kéo thả board/backlog, quản trị dự án, triage, lịch trình…) hiện theo quyền HIỆU LỰC ở dự án đó (= vai trò workspace ∪ vai trò dự án, đúng như guard API tính), không chỉ theo quyền workspace.
**Hiện trạng:**
- `apps/web/src/stores/auth.ts:61` — `can(perm)` chỉ tra `state.permissions`, mà `permissions` lấy từ `GET /auth/me`, và `AuthService.me()` (`apps/api/src/modules/auth/auth.service.ts:118-120`) gọi `rbac.getEffectivePermissions(userId, workspaceId)` KHÔNG truyền `projectId` ⇒ chỉ vai trò WORKSPACE.
- Vai trò workspace "Workspace Member" chỉ có `workspace:view, project:create, project:view, ai:use, dashboard:manage, filter:manage` (`packages/types/src/permissions.ts:~147`); quyền `issue:*`, `worklog:*`, `backlog:manage`, `report:view`… chỉ đến từ vai trò DỰ ÁN mặc định "Developer" (`DEFAULT_PROJECT_ROLE_BY_WS_ROLE`, `permissions.ts:~232`) hoặc ghi đè `ProjectMembership`. Hệ quả THỰC TẾ nghiêm trọng hơn follow-up mô tả: **Member mặc định (không chỉ người có ghi đè riêng) cũng không thấy "Ghi thời gian", không kéo được thẻ board đổi cột, không tạo/kéo backlog** — vì `can('issue:transition')`, `can('worklog:create')`… đều `false` ở mức workspace. (Từ commit `ec1579f` "thành viên tính trên workspace".) Cần tái hiện bằng tài khoản Member trước khi sửa (xem bước kiểm tay).
- API đã có cách tính theo dự án (`RbacService.getEffectivePermissions(userId, ws, projectId)`, cache Redis 60s, `rbac.service.ts:~97`) nhưng KHÔNG có endpoint nào trả cho FE. `grep -rn "permissions/me\|myPermissions" apps/api/src apps/web/src` → rỗng.
- Call site `can()` nằm trong ngữ cảnh dự án cần đổi (liệt kê đầy đủ bằng `grep -rnE "s\.can\(|= can\(|\bcan\('" apps/web/src`):

| File:dòng | Quyền | Có projectId từ |
|---|---|---|
| `features/projects/ProjectLayout.tsx:46` | `project:admin` | `useProject(key)` (dòng 50 — phải dời khai báo xuống sau `project`) |
| `features/project-config/ProjectConfigPage.tsx:41` | `project:admin` (dòng 42 `import:run` là quyền workspace → GIỮ) | `project?.id` |
| `features/project-config/MembersSection.tsx:24-25` | `project:admin` | prop `projectId` |
| `features/board/BoardPage.tsx:123-127` | `issue:transition`, `issue:assign`, `issue:create`, `board:manage`, `project:admin`\|`workspace:admin` | `project?.id` |
| `features/backlog/BacklogPage.tsx:66-70` | `sprint:manage`, `backlog:manage`, `issue:create`, `issue:assign` (dòng 70 `ai:use` là workspace → GIỮ `useAuth`) | `project?.id` |
| `features/gantt/GanttPage.tsx:98` | `plan:manage` | `project?.id` |
| `features/triage/TriagePage.tsx:32` | `issue:triage` | `project?.id` |
| `features/issues/WorklogPanel.tsx:43,56-58` | `worklog:create`, `project:admin`\|`workspace:admin`, `issue:edit` | `issue.projectId` |
| `features/issue-extras/ChecklistPanel.tsx:13` | `issue:edit` | thêm prop `projectId` (call site `IssueDetailPage.tsx:459`) |
| `features/issue-extras/ParticipantsRow.tsx:18` | `issue:edit` | prop `projectId` đã có |
| `features/issue-edit/IssueProperties.tsx:260` | `ai:use` (workspace) && `issue:edit` (dự án) | `issue.projectId` |
| `features/issues/IssueDetailPage.tsx:84,234-235` | `workspace:admin`, `project:admin` | `issue?.projectId` |

  KHÔNG đổi (cấp workspace hoặc trang không thuộc một dự án): `ClientsPage`, `SeveritySection`, `RolesPage`, `GoalsPage`, `ResourcesPage`, `InvitePanel`, `WorkspaceBrandingPanel`, `WikiPage`, `DashboardPage`, `CustomFieldsAdminSection`, `PrioritiesSection`, `DataSection`, `TeamsPanel`, `PortfolioPage`, `MembersPage`, `SlaPage`, `RulesPage`; `AutomationPage.tsx:31` và `RaidPage.tsx:258-259` là trang đa dự án (`/connect/automation`, `/manage/risks`) — mỗi mục có `projectId` riêng, ghi vào "Ngoài phạm vi".
**Files:**
- Modify: `apps/api/src/modules/projects/projects.controller.ts:~28-60` — thêm `RbacService` vào constructor + route `GET :id/permissions/me`.
- Modify: `packages/types/src/entities.ts:~112` — thêm `ProjectPermissionsDto`.
- Create: `apps/web/src/lib/permissions.ts` — hàm thuần `hasPermission`.
- Create: `apps/web/src/features/projects/permissions.ts` — `useProjectPermissions(projectId)` + `useCan(projectId)`.
- Modify: `apps/web/src/lib/queryKeys.ts:19-25` — thêm `keys.projects.permissions(projectId)`.
- Modify: 12 call site ở bảng trên (đổi `useAuth((s) => s.can(...))` → `const can = useCan(projectId)`; `ChecklistPanel` thêm prop `projectId`).
- Modify: `apps/web/src/features/members/api.ts:210-233` — `useSetProjectMemberRoles`/`useRemoveProjectMember` invalidate thêm `keys.projects.permissions(projectId)`.
- Test: `apps/api/src/modules/projects/projects.controller.spec.ts` (mới), `apps/web/src/lib/permissions.test.ts` (mới), `apps/web/src/features/projects/permissions.test.ts` (mới).
**Interfaces:**
- Produces (API): `GET /api/v1/projects/:id/permissions/me` → `ProjectPermissionsDto { projectId: string; permissions: PermissionKey[] }` (object thô, không envelope; mảng đã sort). Policy: `@Permissions(PERMISSIONS.PROJECT_VIEW)` + `@ProjectRef('param', 'id')` (guard tự kiểm dự án thuộc workspace → 404 nếu không). Quyền trả về là TOÀN BỘ quyền hiệu lực (kể cả dạng `issue:edit:own`).
- Produces (web): `hasPermission(ctx, perm)`, `useProjectPermissions(projectId?)`, `useCan(projectId?: string | null): (perm: PermissionKey) => boolean`, `keys.projects.permissions(projectId)`.
- Consumes: `useAuth` (`user.isSystemAdmin`, `permissions` workspace).
**Quyết định thiết kế:**
- Endpoint riêng thay vì nhét vào `ProjectDto`: `ProjectDto` dùng chung cho list/cache nhiều nơi, thêm quyền vào đó làm cache lệch pha; endpoint riêng cache theo `projectId`, `staleTime` 60s trùng TTL cache Redis của API.
- Dùng `:id` (không phải `:key`): mọi call site đều có sẵn `projectId` (kể cả trang issue qua `issue.projectId`).
- Quyền ở dự án LUÔN ⊇ quyền workspace (`compute()` hợp vai trò workspace + dự án) nên `useCan` = `ws.includes(p) || project.includes(p)`: trong lúc đang tải/lỗi, rơi về quyền workspace (không nhấp nháy mất nút của admin, không bao giờ cấp thừa so với server).
- `system admin`: guard API return sớm (không tính quyền) → endpoint có thể trả `[]`; FE xử lý bằng `user.isSystemAdmin` như `can()` hiện tại.
- `can()` trong store GIỮ NGUYÊN cho nơi cấp workspace — không đổi chữ ký để không đụng 30+ call site ngoài phạm vi.
- `hasPermission` so khớp chuỗi chính xác; KHÔNG tự suy `:own` (giữ hành vi cũ; ví dụ `issue:edit` chỉ true khi có `issue:edit` đầy đủ — nút sửa theo quyền `own` là việc riêng, không làm ở đây).
- [ ] Step 1: Viết test fail.

`apps/api/src/modules/projects/projects.controller.spec.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { ProjectsController } from './projects.controller';

function make(perms: string[]) {
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))) };
  return { ctrl: new ProjectsController({} as never, rbac as never), rbac };
}

describe('ProjectsController.myPermissions', () => {
  it('trả quyền hiệu lực của user ở đúng dự án, đã sắp xếp', async () => {
    const { ctrl, rbac } = make(['worklog:create', 'issue:edit', 'project:view']);
    const res = await ctrl.myPermissions('w1', { id: 'u1' } as never, 'p1');
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p1');
    expect(res).toEqual({ projectId: 'p1', permissions: ['issue:edit', 'project:view', 'worklog:create'] });
  });

  it('khai báo policy: project:view + ProjectRef param id', () => {
    const h = ProjectsController.prototype.myPermissions;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.PROJECT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'param', param: 'id' });
  });
});
```
`apps/web/src/lib/permissions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions';

describe('hasPermission', () => {
  const base = { isSystemAdmin: false, workspace: ['project:view'], project: ['worklog:create'] };
  it('quyền ở dự án mà workspace không có → true', () => expect(hasPermission(base, 'worklog:create')).toBe(true));
  it('quyền ở workspace → true kể cả khi dự án chưa tải', () =>
    expect(hasPermission({ ...base, project: undefined }, 'project:view')).toBe(true));
  it('không có ở đâu → false', () => expect(hasPermission(base, 'issue:delete')).toBe(false));
  it('system admin luôn true', () => expect(hasPermission({ ...base, isSystemAdmin: true }, 'issue:delete')).toBe(true));
  it('không suy :own từ quyền đầy đủ và ngược lại', () => {
    expect(hasPermission({ ...base, project: ['issue:edit:own'] }, 'issue:edit')).toBe(false);
  });
});
```
`apps/web/src/features/projects/permissions.test.ts` (hook, không cần DOM):
```ts
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/lib/queryKeys';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() }, refreshAccessToken: vi.fn(), apiErrorMessage: vi.fn(), wasErrorDescribed: vi.fn(),
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
import { useAuth } from '@/stores/auth';
import { useCan } from './permissions';

/** Vẽ một component dò, trả kết quả `can(perm)` ở lần vẽ đầu (cache đã nạp sẵn nên useQuery trả đồng bộ). */
function probe(qc: QueryClient, projectId: string | undefined, perm: string) {
  let result: boolean | undefined;
  function Probe() {
    result = useCan(projectId)(perm as never);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
  return result;
}

describe('useCan', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    useAuth.setState({ user: { id: 'u1', isSystemAdmin: false } as never, permissions: ['project:view'] });
  });

  it('Member chỉ có worklog:create ở dự án → true khi dự án đã tải', () => {
    qc.setQueryData(keys.projects.permissions('p1'), { projectId: 'p1', permissions: ['worklog:create'] });
    expect(probe(qc, 'p1', 'worklog:create')).toBe(true);
  });
  it('quyền của dự án p1 không rò sang p2', () => {
    qc.setQueryData(keys.projects.permissions('p1'), { projectId: 'p1', permissions: ['worklog:create'] });
    expect(probe(qc, 'p2', 'worklog:create')).toBe(false);
  });
  it('chưa tải/không có projectId → rơi về quyền workspace', () => {
    expect(probe(qc, 'p1', 'project:view')).toBe(true);
    expect(probe(qc, undefined, 'worklog:create')).toBe(false);
  });
  it('system admin luôn true', () => {
    useAuth.setState({ user: { id: 'a', isSystemAdmin: true } as never, permissions: [] });
    expect(probe(qc, 'p1', 'issue:delete')).toBe(true);
  });
});
```
(Nếu `renderToString` + mock `@/lib/api` gây lỗi import môi trường node, hạ xuống: bỏ file hook test, giữ `permissions.test.ts` thuần và ghi bước kiểm tay — báo trong report.)
- [ ] Step 2: `pnpm --filter @tirapro/api test -- projects.controller` và `pnpm --filter @tirapro/web test -- permissions` → FAIL (thiếu `myPermissions`, `./permissions`, `keys.projects.permissions`).
- [ ] Step 3: Implementation.

API — `packages/types/src/entities.ts` (cạnh `AuthMeDto`):
```ts
/** Quyền hiệu lực của người đang đăng nhập ở MỘT dự án (= vai trò workspace ∪ vai trò dự án). */
export interface ProjectPermissionsDto {
  projectId: ID;
  permissions: PermissionKey[];
}
```
`projects.controller.ts`: import `RbacService` từ `'../rbac/rbac.service'`, `PermissionKey`/`ProjectPermissionsDto` từ `@tirapro/types`; constructor `(private readonly projects: ProjectsService, private readonly rbac: RbacService)`; thêm (đặt TRƯỚC `@Patch(':id')`, sau `meta`):
```ts
/** Quyền hiệu lực của chính người gọi ở dự án này — để web hiện đúng nút theo vai trò dự án. */
@Permissions(PERMISSIONS.PROJECT_VIEW)
@ProjectRef('param', 'id')
@Get(':id/permissions/me')
async myPermissions(
  @WorkspaceId() workspaceId: string,
  @CurrentUser() user: AuthUser,
  @Param('id') id: string,
): Promise<ProjectPermissionsDto> {
  const perms = await this.rbac.getEffectivePermissions(user.id, workspaceId, id);
  return { projectId: id, permissions: [...perms].sort() as PermissionKey[] };
}
```
(`RbacModule` là `@Global` nên không cần sửa `ProjectsModule`. `rbac-coverage` spec vẫn pass vì route có `@Permissions`.)

Web — `lib/queryKeys.ts` trong `projects`: `permissions: (projectId: string) => ['project-permissions', projectId] as const,`.

`lib/permissions.ts`:
```ts
export interface PermissionContext {
  isSystemAdmin?: boolean;
  workspace: readonly string[];
  project?: readonly string[] | null;
}
/** Quyền hiệu lực ở dự án ⊇ quyền workspace (API hợp hai tập vai trò), nên chỉ cần tra cả hai tập. */
export function hasPermission(ctx: PermissionContext, perm: string): boolean {
  return ctx.isSystemAdmin === true || ctx.workspace.includes(perm) || !!ctx.project?.includes(perm);
}
```
`features/projects/permissions.ts`:
```ts
import { useCallback } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import type { PermissionKey, ProjectPermissionsDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';

export function useProjectPermissions(projectId?: string | null) {
  return useQuery({
    queryKey: keys.projects.permissions(projectId ?? ''),
    queryFn: projectId
      ? async () => (await api.get<ProjectPermissionsDto>(`/projects/${projectId}/permissions/me`)).data
      : skipToken,
    staleTime: 60_000, // khớp TTL cache RBAC phía API
  });
}

/** `const can = useCan(project?.id); can('worklog:create')` — quyền hiệu lực trong dự án. */
export function useCan(projectId?: string | null): (perm: PermissionKey) => boolean {
  const isSystemAdmin = useAuth((s) => s.user?.isSystemAdmin === true);
  const workspace = useAuth((s) => s.permissions);
  const project = useProjectPermissions(projectId).data?.permissions;
  return useCallback(
    (perm) => hasPermission({ isSystemAdmin, workspace, project }, perm),
    [isSystemAdmin, workspace, project],
  );
}
```
Đổi call site: ví dụ `BoardPage.tsx:123-127` → `const can = useCan(project?.id); const canTransition = can('issue:transition'); …; const canForceWip = can('project:admin') || can('workspace:admin');` (xoá import `useAuth` nếu không còn dùng — BoardPage còn dùng `currentUserId`). `ProjectLayout`: chuyển dòng `canAdminProject` xuống sau `const { data: project } = useProject(key);`. `ChecklistPanel({ issueId, projectId })`, call site `IssueDetailPage.tsx:459` truyền `projectId={issue.projectId}`. `IssueDetailPage`: `const can = useCan(issue?.projectId);` (dòng 84, gọi sau `useIssue`, hook luôn được gọi vô điều kiện). `IssueProperties.tsx:260`: `const can = useCan(issue.projectId); const canSuggest = useAuth((s) => s.can('ai:use')) && can('issue:edit');`. `WorklogPanel`: `const can = useCan(issue.projectId);`. `members/api.ts`: thêm `void qc.invalidateQueries({ queryKey: keys.projects.permissions(projectId) });` ở `onSuccess` của hai mutation.
- [ ] Step 4: `pnpm --filter @tirapro/types build && pnpm --filter @tirapro/api test -- projects.controller rbac-coverage && pnpm --filter @tirapro/web test -- permissions` → PASS; gate: `pnpm --filter @tirapro/api typecheck && pnpm --filter @tirapro/web typecheck && pnpm --filter @tirapro/web lint && pnpm --filter @tirapro/api lint`. `grep -rnE "s\.can\('(issue|worklog|backlog|sprint|board|plan|project:admin)" apps/web/src` chỉ còn nơi bảng "KHÔNG đổi".
  Kiểm tay (cần Postgres/Redis + seed): (1) đăng nhập Member không ghi đè → `/issue/KEY`: thấy nút "Ghi thời gian" + phím `w`; Board kéo thẻ đổi cột được; Backlog tạo/kéo được. (2) Viewer (vai trò dự án mặc định `null`) → không thấy các nút trên. (3) Member được ghi đè "Project Admin" ở dự án A, Developer ở B: link "Cấu hình" của ProjectLayout chỉ hiện ở A. (4) Đổi vai trò ghi đè của chính mình ở tab Thành viên → nút đổi trong ≤ vài giây (invalidate) mà không cần tải lại. (5) `curl -H "Authorization: Bearer …" /api/v1/projects/<id>/permissions/me` trả danh sách; id dự án workspace khác → 404.
- [ ] Step 5: Commit: `Quyền theo dự án: endpoint GET /projects/:id/permissions/me, hook useCan(projectId) và đổi các nút Board/Backlog/Worklog/Triage/Lịch trình sang quyền hiệu lực` (có thể tách 2 commit: `API: …` và `Web: …`).
**Rủi ro/đụng chạm:** `BoardPage.tsx` (cũng W5), `IssueDetailPage.tsx` + `WorklogPanel.tsx` (cũng W3), `ProjectLayout.tsx` (cũng W6 — chỉ dòng `LAST_VIEW_KEY`), `queryKeys.ts`. Thay đổi hành vi cần release note: Member mặc định sẽ THẤY và dùng được các hành động mà trước đây bị ẩn nhầm (API vốn đã cho phép) — kiểm không có nút nào mới lộ ra mà API từ chối (Viewer). Thêm 1 request/dự án/60s.

### Task W2: Burndown kiểm `report:view` theo dự án

**Mục tiêu:** Member (và mọi người có `report:view` qua vai trò dự án) xem được burndown của sprint trong dự án mình có quyền; không còn 403.
**Hiện trạng:**
- `apps/api/src/modules/analytics/analytics.controller.ts:31-37` — `burndown` chỉ có `@Permissions(REPORT_VIEW)`, không `@ProjectRef`, nên guard (`permissions.guard.ts:resolveProject`) không có dự án → chỉ tính quyền workspace. Workspace Member không có `report:view` (chỉ vai trò dự án Developer có) ⇒ 403. Các route anh em (`project`, `velocity`, `cfd`, `created-resolved`) đã có `@ProjectRef('query','projectId')`.
- Guard chỉ hỗ trợ kiểu tài nguyên (`sprint`…) khi id nằm ở `req.params` (`permissions.guard.ts:~66-71`), mà burndown nhận `sprintId` ở query → không thể dùng `@ProjectRef('sprint','sprintId')` nếu không sửa guard.
- `analytics.service.ts:353` `burndown(workspaceId, sprintId)` tìm sprint chỉ theo workspace (`project: { workspaceId }`).
- FE: `apps/web/src/features/reports/api.ts:70-75` `useBurndown(sprintId)` gọi `/reports/burndown?sprintId=…`; duy nhất một chỗ dùng: `ReportsPage.tsx:61` (đã có `projectId` ngay trên đó).
**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.controller.ts:31-37` — thêm `@ProjectRef('query','projectId')`, nhận `projectId` bắt buộc.
- Modify: `apps/api/src/modules/analytics/analytics.service.ts:353-359` — `burndown(workspaceId, projectId, sprintId)`, thêm `projectId` vào `where`.
- Modify: `apps/web/src/features/reports/api.ts:70-75`, `apps/web/src/features/reports/ReportsPage.tsx:61` — truyền `projectId`.
- Test: `apps/api/src/modules/analytics/analytics.service.spec.ts:359-425` (cập nhật 4 lời gọi + thêm 2 case), `apps/api/src/modules/analytics/analytics.controller.spec.ts` (mới, kiểm metadata).
**Interfaces:** Produces: `GET /api/v1/reports/burndown?sprintId=…&projectId=…` (`projectId` BẮT BUỘC — thiếu → 400 `BUSINESS_RULE` "Thiếu projectId", cùng kiểu các route anh em); sprint không thuộc `projectId` → 404. `AnalyticsService.burndown(workspaceId, projectId, sprintId)`. Consumes: guard `ProjectRef('query')`.
**Quyết định thiết kế:**
- Chọn thêm `projectId` ở query + kiểm sprint ∈ project (phương án nhỏ nhất, đồng nhất 4 route cùng controller, không sửa guard dùng chung) thay vì mở rộng guard đọc id tài nguyên từ query. Kiểm "sprint thuộc đúng projectId" ở service là BẮT BUỘC, nếu không client có thể gửi `projectId` của dự án mình có quyền + `sprintId` của dự án khác (leo thang đặc quyền).
- Đổi chữ ký service không giữ tham số tuỳ chọn: chỉ controller gọi (`grep -rn "\.burndown(" apps/api/src`), để compiler bắt sót.
- [ ] Step 1: Viết test fail.
Trong `analytics.service.spec.ts`, ở `make()` giữ nguyên; đổi mọi `service.burndown('w1', 'sp1')` → `service.burndown('w1', 'p1', 'sp1')` và thêm:
```ts
it('chỉ tìm sprint thuộc đúng dự án trong workspace (chặn lấy sprint dự án khác bằng projectId của mình)', async () => {
  const { service, prisma } = make([]);
  await service.burndown('w1', 'p1', 'sp1');
  const where = (prisma.sprint.findFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
  expect(where).toMatchObject({ id: 'sp1', projectId: 'p1', deletedAt: null, project: { workspaceId: 'w1' } });
});

it('sprint không thuộc dự án → NotFound', async () => {
  const { service, prisma } = make([]);
  prisma.sprint.findFirst.mockResolvedValueOnce(null as never);
  await expect(service.burndown('w1', 'p-khac', 'sp1')).rejects.toThrow();
});
```
`analytics.controller.spec.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { AnalyticsController } from './analytics.controller';

describe('AnalyticsController.burndown', () => {
  const h = AnalyticsController.prototype.burndown;
  it('kiểm report:view theo dự án (query projectId), không chỉ theo workspace', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'query', param: 'projectId' });
  });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/api test -- analytics` → FAIL.
- [ ] Step 3: Implementation.
Controller:
```ts
@ProjectRef('query', 'projectId')
@Get('burndown')
@Permissions(PERMISSIONS.REPORT_VIEW)
async burndown(
  @WorkspaceId() workspaceId: string,
  @Query('sprintId') sprintId?: string,
  @Query('projectId') projectId?: string,
) {
  if (!projectId) throw new BusinessRuleException('Thiếu projectId');
  if (!sprintId) throw new BusinessRuleException('Thiếu sprintId');
  return this.analytics.burndown(workspaceId, projectId, sprintId);
}
```
Service: `async burndown(workspaceId: string, projectId: string, sprintId: string)` và `where: { id: sprintId, projectId, deletedAt: null, project: { workspaceId } }`.
Web: `useBurndown(sprintId?: string, projectId?: string)` — `queryFn: sprintId && projectId ? … api.get(`/reports/burndown?sprintId=${sprintId}&projectId=${projectId}`) : skipToken`; key giữ `keys.reports.burndown(sprintId ?? '')` (sprint xác định dự án); `ReportsPage.tsx:61` → `useBurndown(burndownSprint?.id, projectId)`.
- [ ] Step 4: `pnpm --filter @tirapro/api test -- analytics rbac-coverage` PASS; gate: `pnpm --filter @tirapro/api typecheck && pnpm --filter @tirapro/api lint && pnpm --filter @tirapro/web typecheck`. Kiểm tay: Member mở `/p/KEY/reports` → biểu đồ burndown có dữ liệu (trước: toast/ lỗi 403); đổi `projectId` trong URL thành dự án khác (`curl`) → 404.
- [ ] Step 5: Commit: `Báo cáo: burndown kiểm report:view theo dự án (projectId bắt buộc, sprint phải thuộc dự án) và web truyền projectId`
**Rủi ro/đụng chạm:** Đổi hợp đồng API (thêm tham số bắt buộc) — chỉ web gọi (đã grep). Không đụng file nào của task khác trong nhóm ngoài `ReportsPage` (W1 không sửa). Phụ thuộc về mặt ý nghĩa: Member có `report:view` ở dự án nhờ vai trò mặc định Developer; không liên quan `useCan` (ReportsPage không gate bằng `can`).

### Task W3: Viewer không thấy nút lưu bộ lọc; phím `w` hoạt động ngay trên trang issue

**Mục tiêu:** (a) Người không có `filter:manage` (Viewer) không thấy "Tạo bộ lọc"/nút xoá bộ lọc; (b) phím `w` mở form ghi thời gian ngay khi trang issue mở (cuộn tới panel và mở form), không phải đợi panel cuộn vào khung nhìn.
**Hiện trạng:**
- `apps/web/src/features/saved-filters/FiltersPage.tsx:160-163` — nút "Tạo bộ lọc" luôn hiện; `CreateFilterModal` (dòng ~207) luôn mount; `SavedFilterList` hiện nút xoá theo `f.isOwner` (dòng ~362) dù Viewer thiếu `filter:manage` (API `saved-filters.controller.ts:45,55,66` yêu cầu `FILTER_MANAGE`; vai trò "Workspace Viewer" chỉ có `workspace:view, project:view, report:view`). Dòng 325 gợi ý “Bấm ‘Tạo bộ lọc’…” cũng sai với Viewer.
- Phím `w`: `WorklogPanel.tsx:62-79` đăng ký `keydown` trong `useEffect`, nhưng panel được bọc `<LazyPanel minHeight={96}>` (`IssueDetailPage.tsx:502`) — `LazyPanel` (`:58-65`) chỉ mount children khi `useInView` báo đã vào khung nhìn (`rootMargin 200px`) ⇒ chưa cuộn tới thì listener chưa tồn tại, `w` không làm gì. Ngoài ra kiểm "đang có dialog" dùng `document.querySelector('[data-radix-popper-content-wrapper],[role="dialog"]')` — bắt cả dialog đang chạy hiệu ứng đóng (`data-state="closed"`) khiến `w` bị nuốt thêm ~150ms, trong khi `useGlobalHotkeys.ts:~28` đã có `isDialogOpen()` đúng (`[role="dialog"][data-state="open"]`).
**Files:**
- Modify: `apps/web/src/features/saved-filters/FiltersPage.tsx:~71,160-170,207-221,325,362-376` — gate theo `useAuth((s) => s.can('filter:manage'))` (quyền cấp workspace → dùng `useAuth`, không phải `useCan`).
- Create: `apps/web/src/lib/hotkeys.ts` — `isTypingTarget`, `isDialogOpen`, `isWorklogHotkey` (thuần, test được).
- Modify: `apps/web/src/lib/useGlobalHotkeys.ts:9-30` — import `isTypingTarget`/`isDialogOpen` từ `hotkeys.ts` (xoá bản cục bộ).
- Modify: `apps/web/src/features/issues/IssueDetailPage.tsx:58-65,~84,502` — hotkey `w` ở cấp trang + `LazyPanel` nhận `force`.
- Modify: `apps/web/src/features/issues/WorklogPanel.tsx:62-79` — bỏ listener; nhận prop `openRequest`.
- Test: `apps/web/src/lib/hotkeys.test.ts` (mới).
**Interfaces:** Produces `isWorklogHotkey(e, ctx)`; prop mới `WorklogPanel({ issue, openRequest? })`, `LazyPanel({ force? })` (nội bộ file). Consumes `useCan` từ W1 (`can('worklog:create')` theo `issue.projectId`) — nếu làm W3 trước W1 thì tạm dùng `useAuth(s=>s.can('worklog:create'))` rồi W1 đổi.
**Quyết định thiết kế:**
- Hotkey nâng lên `IssueDetailPage` (luôn mount khi xem issue) thay vì cố mount panel sớm: không tải thêm dữ liệu worklog trước khi người dùng cần; khi bấm `w` mới ép mount panel (`force`), cuộn tới và mở form. Tăng một bộ đếm `openRequest` (số) thay vì boolean để bấm `w` lần hai vẫn mở lại được sau khi đóng form.
- Viewer: ẩn hẳn (đúng quy ước ẩn nút không có quyền ở toàn app) thay vì disabled; rail trống có câu riêng: “Chưa có bộ lọc nào được chia sẻ với bạn.”.
- Tách helper vào `lib/hotkeys.ts` để test thuần và để hai nơi dùng cùng một định nghĩa "đang gõ"/"đang có dialog mở".
- [ ] Step 1: Viết test fail — `apps/web/src/lib/hotkeys.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isWorklogHotkey } from './hotkeys';

const ev = (over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key: 'w', metaKey: false, ctrlKey: false, altKey: false, ...over });
const ctx = (over: Partial<{ typing: boolean; dialogOpen: boolean; canLog: boolean }> = {}) =>
  ({ typing: false, dialogOpen: false, canLog: true, ...over });

describe('isWorklogHotkey', () => {
  it('w / W thường, có quyền, không gõ, không dialog → true', () => {
    expect(isWorklogHotkey(ev(), ctx())).toBe(true);
    expect(isWorklogHotkey(ev({ key: 'W' }), ctx())).toBe(true);
  });
  it('phím khác → false', () => expect(isWorklogHotkey(ev({ key: 'x' }), ctx())).toBe(false));
  it('có modifier (⌘W đóng tab…) → false', () => {
    expect(isWorklogHotkey(ev({ metaKey: true }), ctx())).toBe(false);
    expect(isWorklogHotkey(ev({ ctrlKey: true }), ctx())).toBe(false);
    expect(isWorklogHotkey(ev({ altKey: true }), ctx())).toBe(false);
  });
  it('đang gõ / có dialog mở / không có quyền → false', () => {
    expect(isWorklogHotkey(ev(), ctx({ typing: true }))).toBe(false);
    expect(isWorklogHotkey(ev(), ctx({ dialogOpen: true }))).toBe(false);
    expect(isWorklogHotkey(ev(), ctx({ canLog: false }))).toBe(false);
  });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/web test -- hotkeys` → FAIL (module chưa có).
- [ ] Step 3: Implementation.
`lib/hotkeys.ts`:
```ts
/** Có đang gõ trong ô nhập / vùng soạn thảo không → bỏ qua hotkey. */
export function isTypingTarget(el: EventTarget | null): boolean { /* chuyển nguyên văn từ useGlobalHotkeys.ts:9-20 */ }

/** Radix gắn `role="dialog"` cả khi đang chạy hiệu ứng đóng (`data-state="closed"`) nên phải kiểm `open`. */
export function isDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"]');
}

/** Phím `w` (không modifier) mở form ghi thời gian — chỉ khi có quyền, không đang gõ, không có dialog mở. */
export function isWorklogHotkey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  ctx: { typing: boolean; dialogOpen: boolean; canLog: boolean },
): boolean {
  if (!ctx.canLog || ctx.typing || ctx.dialogOpen) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === 'w' || e.key === 'W';
}
```
`IssueDetailPage`: `LazyPanel` thêm `force?: boolean` → `const show = inView || force; … style={show ? undefined : { minHeight }}>{show ? children : null}`. Trong `IssueDetailPage`: `const [worklogRequest, setWorklogRequest] = useState(0); const canLogWork = can('worklog:create');` và
```ts
useEffect(() => {
  if (!canLogWork || !issue) return;
  function onKey(e: KeyboardEvent) {
    if (!isWorklogHotkey(e, { typing: isTypingTarget(e.target), dialogOpen: isDialogOpen(), canLog: true })) return;
    e.preventDefault();
    setWorklogRequest((n) => n + 1);
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [canLogWork, issue]);
```
Render: `<LazyPanel id="issue-worklog" minHeight={96} force={worklogRequest > 0}><WorklogPanel issue={issue} openRequest={worklogRequest} /></LazyPanel>`. `WorklogPanel`: xoá `useEffect` listener (và các import không còn dùng), thêm
```ts
const sectionRef = useRef<HTMLElement>(null);
useEffect(() => {
  if (!openRequest || !canLog) return;
  setEditing(null);
  setFormOpen(true);
  sectionRef.current?.scrollIntoView({ block: 'nearest' }); // CSS `scroll-behavior`/reduced-motion do trình duyệt xử lý
}, [openRequest, canLog]);
```
`<section ref={sectionRef} …>`. `FiltersPage`: `const canManageFilters = useAuth((s) => s.can('filter:manage'));` — bọc nút "Tạo bộ lọc" bằng `{canManageFilters && (…)}`; `<SavedFilterList … canManage={canManageFilters}>` và nút xoá chỉ khi `f.isOwner && canManage`; `emptyState` đổi theo `canManage`; `CreateFilterModal` chỉ render khi `canManageFilters`.
`useGlobalHotkeys.ts`: xoá hai hàm cục bộ, `import { isDialogOpen, isTypingTarget } from './hotkeys';`.
- [ ] Step 4: `pnpm --filter @tirapro/web test` PASS; gate: `pnpm --filter @tirapro/web typecheck && pnpm --filter @tirapro/web lint`. Kiểm tay: (1) Viewer vào `/filters` → không có "Tạo bộ lọc", không có nút xoá; Member vẫn có. (2) Mở `/issue/KEY` có quyền `worklog:create`, KHÔNG cuộn, bấm `w` → trang cuộn tới panel "Thời gian" và form mở; đóng form rồi `w` lại → mở lại. (3) Đang gõ trong comment/ô tiêu đề bấm `w` → không mở; đang mở dialog bất kỳ → không mở; ngay sau khi đóng dialog (≤150ms) `w` hoạt động.
- [ ] Step 5: Commit: `Web: ẩn tạo/xoá bộ lọc khi thiếu filter:manage; phím w ghi thời gian chạy ngay trên trang issue (hotkey ở cấp trang, panel mount theo yêu cầu)`
**Rủi ro/đụng chạm:** `IssueDetailPage.tsx`, `WorklogPanel.tsx` (cũng W1), `FiltersPage.tsx` (cũng W4 — `CreateFilterModal` thêm icon), `useGlobalHotkeys.ts` (cũng W6 — `currentProjectKey`). Làm W1 trước để `can` đã là `useCan`. Không đổi hành vi API.

### Task W6: Dedupe toast lỗi mutation ổn định + `currentProjectKey` decode an toàn

**Mục tiêu:** (a) Mỗi lỗi mutation chỉ hiện đúng một toast, kể cả khi `onError` cấp hook làm việc bất đồng bộ thật; nhiều lỗi giống hệt cùng lúc gộp thành một toast. (b) Đường dẫn `/p/%E0%A4%A` (hỏng) không làm Cmd+K / phím tắt `c`, `g b`, `g l` ném lỗi.
**Hiện trạng:**
- `apps/web/src/lib/queryClient.ts:26-33` — `MutationCache.onError` chờ `setTimeout(…, 0)` rồi kiểm `wasErrorDescribed(error)`; chính comment (dòng 16-21) thừa nhận: callback nào `await` I/O thật rồi mới gọi `apiErrorMessage` sẽ toast đôi. Thứ tự thực tế (query-core 5.101, `mutation.js:148-186`, `mutationObserver.js:75-125`): `cache.onError` → `await options.onError` → `cache.onSettled` → `await options.onSettled` → `#dispatch({type:'error'})` (đồng bộ gọi callback của `mutate(…, {onError})`, rồi `MutationCache.notify({type:'updated', action:{type:'error'}})`) → `throw` (các `catch` quanh `mutateAsync` chạy ở microtask sau đó). Tức hiện đang gọi toast ở điểm SỚM NHẤT (trước cả `options.onError`), được "cứu" bằng một macrotask.
- Không có test nào cho `queryClient.ts` (`find apps/web/src -name "*.test.*"` chỉ có `socket.test.ts`, `issues/api.test.ts`).
- `currentProjectKey` có HAI bản y hệt: `apps/web/src/features/command/CommandPalette.tsx:30-41` và `apps/web/src/lib/useGlobalHotkeys.ts:34-45`, cả hai `decodeURIComponent(m[1]!)` trần ở dòng 32 / 36 (ném `URIError` với `%E0%A4%A`); `CommandPalette.tsx:21-27` đã có `safeDecode` nhưng chỉ dùng cho `issueRouteKey` (dòng 158). `LAST_VIEW_KEY` đang export từ `features/projects/ProjectLayout.tsx:20` và bị `lib/useGlobalHotkeys.ts` import ngược từ feature.
**Files:**
- Modify: `apps/web/src/lib/queryClient.ts:11-33` — chuyển sang `mutationCache.subscribe` + id toast ổn định.
- Create: `apps/web/src/lib/currentProject.ts` — `LAST_VIEW_KEY`, `safeDecode`, `resolveCurrentProjectKey` (thuần), `currentProjectKey(projects)`.
- Modify: `apps/web/src/features/command/CommandPalette.tsx:9,20-41`, `apps/web/src/lib/useGlobalHotkeys.ts:6,31-45` — dùng hàm chung; `CommandPalette` dùng `safeDecode` từ lib.
- Modify: `apps/web/src/features/projects/ProjectLayout.tsx:20` — `import { LAST_VIEW_KEY } from '@/lib/currentProject'` (bỏ `export const`; chỉ còn dùng nội bộ ở dòng 61, 198).
- Test: `apps/web/src/lib/queryClient.test.ts`, `apps/web/src/lib/currentProject.test.ts` (mới).
**Interfaces:** Produces `resolveCurrentProjectKey({ pathname, projects, lastViewRaw })`, `safeDecode(s)`, `currentProjectKey(projects)`; toast lỗi mutation dùng `id: 'mutation-error:<message>'`. Consumes `apiErrorMessage`/`wasErrorDescribed` (`lib/api.ts:80-95`, giữ nguyên).
**Quyết định thiết kế:**
- Không đổi 181 chỗ `toast.error(apiErrorMessage(e))` / 105 chỗ dùng `apiErrorMessage` cho lỗi inline: giữ cơ chế "đã mô tả thì bỏ qua" (cần vì nhiều dialog hiển thị lỗi inline) nhưng dời điểm kiểm sang SAU toàn bộ callback của thư viện (sự kiện `updated`/`error` của `MutationCache`, đồng bộ sau `await options.onError`/`onSettled` và sau callback `mutate(…,{onError})`) rồi mới chờ một macrotask cho các `catch` quanh `mutateAsync`. Còn lại duy nhất một giả định (ghi trong comment): code `await` I/O thật GIỮA lúc `mutateAsync` reject và lúc gọi `apiErrorMessage` — hiếm, và đã có `meta.silent`.
- Dedupe "theo key": `toast.error(message, { id: `mutation-error:${message}` })` — sonner 1.7 cập nhật toast cùng `id` thay vì xếp chồng (5 lần "Không kết nối được máy chủ" chỉ ra 1 toast). Không thêm cửa sổ thời gian tự chế.
- `currentProjectKey` gộp một bản trong `lib/` + hàm thuần nhận `pathname`/`lastViewRaw` để test không cần `window`/`localStorage`; `LAST_VIEW_KEY` chuyển xuống `lib` để `lib` không import ngược từ `features`.
- [ ] Step 1: Viết test fail.
`apps/web/src/lib/currentProject.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveCurrentProjectKey, safeDecode } from './currentProject';

const projects = [{ key: 'AAA' }, { key: 'BBB' }];
const r = (pathname: string, lastViewRaw: string | null = null, p: { key: string }[] | undefined = projects) =>
  resolveCurrentProjectKey({ pathname, projects: p, lastViewRaw });

describe('resolveCurrentProjectKey', () => {
  it('lấy key từ /p/:key', () => expect(r('/p/BBB/board')).toBe('BBB'));
  it('giải mã %-escape hợp lệ', () => expect(r('/p/A%20B/board')).toBe('A B'));
  it('URL hỏng (%E0%A4%A) không ném lỗi, dùng nguyên chuỗi', () => {
    expect(() => r('/p/%E0%A4%A/board')).not.toThrow();
    expect(r('/p/%E0%A4%A/board')).toBe('%E0%A4%A');
  });
  it('ngoài /p → view gần nhất nếu dự án còn tồn tại', () =>
    expect(r('/issue/AAA-1', JSON.stringify({ key: 'BBB', view: 'board' }))).toBe('BBB'));
  it('view gần nhất trỏ dự án đã mất / JSON hỏng → dự án đầu', () => {
    expect(r('/', JSON.stringify({ key: 'ZZZ' }))).toBe('AAA');
    expect(r('/', '{hỏng')).toBe('AAA');
  });
  it('chưa có danh sách dự án → null', () => expect(r('/', null, undefined)).toBeNull());
});

describe('safeDecode', () => {
  it('không ném lỗi', () => expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A'));
});
```
`apps/web/src/lib/queryClient.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const described = new WeakSet<object>();
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./api', () => ({
  apiErrorMessage: (e: unknown) => {
    if (typeof e === 'object' && e) described.add(e);
    return (e as Error).message;
  },
  wasErrorDescribed: (e: unknown) => typeof e === 'object' && e !== null && described.has(e),
}));
import { toast } from 'sonner';
import { apiErrorMessage } from './api';
import { mutationCache, queryClient } from './queryClient';

const build = (err: Error, opts: Record<string, unknown> = {}) =>
  mutationCache.build(queryClient, { mutationFn: () => Promise.reject(err), ...opts } as never);

describe('toast lỗi mutation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(toast.error).mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('không ai tự báo → đúng một toast, id theo nội dung', async () => {
    await build(new Error('Lỗi A')).execute(undefined).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Lỗi A', { id: 'mutation-error:Lỗi A' });
  });

  it('catch quanh mutateAsync tự báo bằng apiErrorMessage → bỏ qua toast chung', async () => {
    const err = new Error('Lỗi B');
    try { await build(err).execute(undefined); } catch (e) { apiErrorMessage(e); }
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('onError cấp hook bất đồng bộ thật (chờ 50ms) rồi mới apiErrorMessage → KHÔNG toast đôi', async () => {
    const err = new Error('Lỗi C');
    const p = build(err, {
      onError: async () => { await new Promise((r) => setTimeout(r, 50)); apiErrorMessage(err); },
    }).execute(undefined).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await p;
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('meta.silent → không toast', async () => {
    await build(new Error('Lỗi D'), { meta: { silent: true } }).execute(undefined).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('hai lỗi giống hệt → cùng id (sonner gộp thành một toast)', async () => {
    await Promise.all([build(new Error('Lỗi E')), build(new Error('Lỗi E'))].map((m) => m.execute(undefined).catch(() => undefined)));
    await vi.advanceTimersByTimeAsync(5);
    const ids = vi.mocked(toast.error).mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(ids).toEqual(['mutation-error:Lỗi E', 'mutation-error:Lỗi E']);
  });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/web test -- currentProject queryClient` → FAIL (thiếu `currentProject.ts`; case "async onError" và "id" fail với code cũ).
- [ ] Step 3: Implementation.
`queryClient.ts` — bỏ `onError` trong `new MutationCache(…)`, giữ `export const mutationCache = new MutationCache();` rồi:
```ts
/**
 * Lỗi mutation: toast chung bằng câu tiếng Việt từ `apiErrorMessage` — không mutation nào thất bại âm thầm
 * khi component quên `onError`. Mutation tự xử lý: `meta: { silent: true }`.
 *
 * Tránh toast đôi: nơi nào đã tự báo qua `apiErrorMessage(e)` thì bản chung bỏ qua. Lắng nghe sự kiện `updated`/`error`
 * (phát đồng bộ SAU `await options.onError/onSettled` và sau callback của `mutate(…, { onError })`), rồi chờ thêm một
 * macrotask cho các `catch` quanh `mutateAsync` (chạy ở microtask sau đó). Giả định còn lại: không `await` I/O thật giữa lúc
 * `mutateAsync` reject và lúc gọi `apiErrorMessage` — nếu cần, dùng `meta.silent`.
 * Toast mang `id` theo nội dung → nhiều lỗi giống hệt cùng lúc chỉ hiện một toast (sonner cập nhật thay vì xếp chồng).
 */
mutationCache.subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'error') return;
  if (event.mutation.meta?.silent) return;
  const error = event.action.error;
  setTimeout(() => {
    if (wasErrorDescribed(error)) return;
    const message = apiErrorMessage(error);
    toast.error(message, { id: `mutation-error:${message}` });
  }, 0);
});
```
(`mutationCache` phải được tạo trước `queryClient`; không còn dùng tham số `mutation` trong config.) Kiểm kiểu của `event.action`/`event.mutation.meta` bằng `typecheck`; nếu `meta` không có trên `Mutation` kiểu thì đọc `event.mutation.options.meta?.silent`.
`currentProject.ts`:
```ts
/** localStorage: view cơ bản người dùng mở gần nhất (để /projects mở lại đúng view). */
export const LAST_VIEW_KEY = 'tirapro:lastProjectView';

/** decodeURIComponent không ném lỗi với đường dẫn hỏng (vd `%E0%A4%A`) — lỗi thì dùng nguyên chuỗi. */
export function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Dự án "hiện tại": `/p/:key` → view mở gần nhất (nếu dự án còn tồn tại) → dự án đầu. Thuần để test. */
export function resolveCurrentProjectKey(input: {
  pathname: string;
  projects: { key: string }[] | undefined;
  lastViewRaw: string | null;
}): string | null {
  const m = /^\/p\/([^/]+)/.exec(input.pathname);
  if (m) return safeDecode(m[1]!);
  try {
    const saved = JSON.parse(input.lastViewRaw || '{}') as { key?: string };
    if (saved.key && (input.projects ?? []).some((p) => p.key === saved.key)) return saved.key;
  } catch { /* JSON hỏng → bỏ qua */ }
  return input.projects?.[0]?.key ?? null;
}

export function currentProjectKey(projects: { key: string }[] | undefined): string | null {
  let lastViewRaw: string | null = null;
  try { lastViewRaw = localStorage.getItem(LAST_VIEW_KEY); } catch { /* bị chặn */ }
  return resolveCurrentProjectKey({ pathname: window.location.pathname, projects, lastViewRaw });
}
```
Hai nơi dùng: xoá bản cục bộ + import `currentProjectKey`; `CommandPalette` thay `safeDecode` cục bộ (dòng 20-27) bằng import.
- [ ] Step 4: `pnpm --filter @tirapro/web test` PASS; gate: `pnpm --filter @tirapro/web typecheck && pnpm --filter @tirapro/web lint`. Kiểm tay: (1) tắt API rồi bấm 3 thao tác lỗi liên tiếp → chỉ một toast "Không kết nối được máy chủ…". (2) Dialog có lỗi inline (vd tạo dự án trùng tên) → vẫn chỉ lỗi inline, không toast. (3) Mở `http://localhost:5173/p/%E0%A4%A/board` rồi Cmd+K → mở được, bấm `c`/`g b` không lỗi console.
- [ ] Step 5: Commit: `Web: toast lỗi mutation dedupe theo nội dung và kiểm sau mọi callback (bỏ phụ thuộc một tick); gộp currentProjectKey với decode an toàn`
**Rủi ro/đụng chạm:** `useGlobalHotkeys.ts` (cũng W3), `ProjectLayout.tsx` (cũng W1 — chỉ dòng 20), `CommandPalette.tsx`. Làm SAU W3/W1. Toast lỗi từ MutationCache đổi hình thức (có `id`) — không đổi nội dung.

### Task W5: Khôi phục toggle cá nhân "Nhóm theo người" (override, mặc định theo cấu hình bảng)

**Mục tiêu:** Mỗi người bật/tắt "Nhóm theo người" riêng trên bảng việc mà không đổi cấu hình chung của bảng; không bật thì bảng chia hàng theo cấu hình board như hiện nay.
**Hiện trạng:**
- Trước commit `dee288b` (`git show dee288b^:apps/web/src/features/board/BoardPage.tsx`): nút `<Users/> Nhóm theo người` (`aria-pressed={groupBy}`, bật = `bg-primary-subtle text-primary`), `groupBy` là boolean lưu `localStorage` key `tirapro:boardPrefs:${projectId}` (`{assignee, groupBy}`), `lanes` chỉ tính khi `groupBy`.
- Hiện tại (`BoardPage.tsx:135,161,335-343`): `swimlaneBy = board?.swimlaneBy ?? 'none'` (cấu hình chung, sửa ở `BoardSettingsDialog`), chỉ có chip tĩnh `Layers` khi `swimlaneBy !== 'none'`. Mọi chỗ khác (`buildLanes`, `assigneeChanged` ở dòng 257, chip) đều đọc biến `swimlaneBy` này.
- Lỗi phụ hiện có: `changeAssignee` (`BoardPage.tsx:152-158`) ghi đè cả `tirapro:boardPrefs:${pid}` chỉ với `{assignee}` — nếu tái dùng key cũ sẽ xoá mất override; dùng key RIÊNG.
**Files:**
- Create: `apps/web/src/features/board/swimlane.ts` — hàm thuần + hook `useSwimlaneOverride(boardId)`.
- Modify: `apps/web/src/features/board/BoardPage.tsx:3,135,335-343` — nút toggle + `swimlaneBy` = hiệu lực.
- Test: `apps/web/src/features/board/swimlane.test.ts` (mới).
**Interfaces:** Produces `effectiveSwimlane(boardBy, override)`, `toggleAssigneeSwimlane(boardBy, override)`, `parseSwimlaneOverride(raw)`, `swimlaneStorageKey(userId, boardId)`, `useSwimlaneOverride(boardId, boardBy)` → `{ swimlaneBy, override, toggleAssignee }`. Consumes `SWIMLANE_BY`/`SwimlaneBy` (`@tirapro/types`), `useAuth().user.id`.
**Quyết định thiết kế:**
- Override lưu `localStorage` key `tirapro:swimlane:${userId}:${boardId}` (cá nhân theo người + theo board; trình duyệt dùng chung nhiều tài khoản không lẫn). Chỉ là sở thích hiển thị → không cần API/migration. Giá trị = một `SwimlaneBy` hợp lệ; thiếu/sai → `null` (theo bảng).
- Toggle chỉ chuyển giữa "theo người" và mặc định của bảng: hiệu lực `assignee` → về mặc định của bảng (nếu mặc định chính là `assignee` thì về `none`); ngược lại → `assignee`. Nếu kết quả trùng cấu hình bảng thì xoá override (`null`) để đổi cấu hình bảng về sau vẫn có hiệu lực. Cách chia khác (epic/ưu tiên/việc cha) vẫn chỉnh ở "Cài đặt bảng" — không biến thành bộ chọn nhiều kiểu (giữ nguyên phạm vi follow-up).
- Ngữ nghĩa kéo-thả giữ như cũ: khi hiệu lực là `assignee`, thả sang hàng người khác = giao việc (`assigneeChanged`, cần `issue:assign`); ghi vào tooltip nút để không bất ngờ.
- Chip tĩnh `Layers` giữ cho các kiểu epic/priority/parent (hiển thị kiểu đang chia); với `assignee` thì nút toggle thay chip.
- [ ] Step 1: Viết test fail — `apps/web/src/features/board/swimlane.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { effectiveSwimlane, parseSwimlaneOverride, swimlaneStorageKey, toggleAssigneeSwimlane } from './swimlane';

describe('swimlane override', () => {
  it('không override → theo cấu hình bảng', () => {
    expect(effectiveSwimlane('epic', null)).toBe('epic');
    expect(effectiveSwimlane('none', 'assignee')).toBe('assignee');
  });
  it('toggle: bảng phẳng ↔ theo người, override được xoá khi trùng cấu hình bảng', () => {
    expect(toggleAssigneeSwimlane('none', null)).toBe('assignee');
    expect(toggleAssigneeSwimlane('none', 'assignee')).toBeNull();
  });
  it('toggle trên bảng đã cấu hình theo người: tắt = override none, bật lại = xoá override', () => {
    expect(toggleAssigneeSwimlane('assignee', null)).toBe('none');
    expect(toggleAssigneeSwimlane('assignee', 'none')).toBeNull();
  });
  it('toggle trên bảng cấu hình epic: bật theo người, tắt trả về epic (override null)', () => {
    expect(toggleAssigneeSwimlane('epic', null)).toBe('assignee');
    expect(toggleAssigneeSwimlane('epic', 'assignee')).toBeNull();
  });
  it('parse: chỉ nhận giá trị hợp lệ', () => {
    expect(parseSwimlaneOverride('assignee')).toBe('assignee');
    expect(parseSwimlaneOverride('none')).toBe('none');
    expect(parseSwimlaneOverride('linh-tinh')).toBeNull();
    expect(parseSwimlaneOverride(null)).toBeNull();
  });
  it('khoá lưu theo người và theo bảng', () => {
    expect(swimlaneStorageKey('u1', 'b1')).toBe('tirapro:swimlane:u1:b1');
  });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/web test -- swimlane` → FAIL (module chưa có).
- [ ] Step 3: Implementation — `swimlane.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { SWIMLANE_BY, type SwimlaneBy } from '@tirapro/types';
import { useAuth } from '@/stores/auth';

/** `null` = theo cấu hình của bảng. */
export type SwimlaneOverride = SwimlaneBy | null;

export const swimlaneStorageKey = (userId: string, boardId: string) => `tirapro:swimlane:${userId}:${boardId}`;

export function parseSwimlaneOverride(raw: string | null): SwimlaneOverride {
  return raw !== null && (SWIMLANE_BY as readonly string[]).includes(raw) ? (raw as SwimlaneBy) : null;
}

export const effectiveSwimlane = (boardBy: SwimlaneBy, override: SwimlaneOverride): SwimlaneBy => override ?? boardBy;

/** Bấm "Nhóm theo người": đang theo người → về mặc định của bảng (hoặc `none` nếu mặc định cũng là người); ngược lại → theo người. */
export function toggleAssigneeSwimlane(boardBy: SwimlaneBy, override: SwimlaneOverride): SwimlaneOverride {
  const next: SwimlaneBy =
    effectiveSwimlane(boardBy, override) === 'assignee' ? (boardBy === 'assignee' ? 'none' : boardBy) : 'assignee';
  return next === boardBy ? null : next;
}

export function useSwimlaneOverride(boardId: string | undefined, boardBy: SwimlaneBy) {
  const userId = useAuth((s) => s.user?.id);
  const [override, setOverride] = useState<SwimlaneOverride>(null);
  const ref = useRef<SwimlaneOverride>(null);
  const storageKey = userId && boardId ? swimlaneStorageKey(userId, boardId) : null;

  useEffect(() => {
    let v: SwimlaneOverride = null;
    try { if (storageKey) v = parseSwimlaneOverride(localStorage.getItem(storageKey)); } catch { /* bị chặn */ }
    ref.current = v;
    setOverride(v);
  }, [storageKey]);

  const toggleAssignee = useCallback(() => {
    const next = toggleAssigneeSwimlane(boardBy, ref.current);
    ref.current = next;
    setOverride(next);
    try {
      if (storageKey) next === null ? localStorage.removeItem(storageKey) : localStorage.setItem(storageKey, next);
    } catch { /* bị chặn */ }
  }, [boardBy, storageKey]);

  return { swimlaneBy: effectiveSwimlane(boardBy, override), override, toggleAssignee };
}
```
`BoardPage.tsx`: thay dòng 135 bằng `const { swimlaneBy, override: swimlaneOverride, toggleAssignee } = useSwimlaneOverride(board?.id, board?.swimlaneBy ?? 'none');` (đặt SAU khai báo `board`); import `Users` từ `lucide-react`. Ở thanh lọc (trước chip `Layers`, dòng ~335) thêm:
```tsx
<button
  type="button"
  onClick={toggleAssignee}
  aria-pressed={swimlaneBy === 'assignee'}
  title={`Chia bảng thành hàng theo người phụ trách — chỉ áp cho bạn${swimlaneOverride === null ? '' : ' (đang khác cấu hình bảng)'}. Kéo việc sang hàng khác để giao cho người đó.`}
  className={cn(
    'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
    swimlaneBy === 'assignee' ? 'border-transparent bg-primary-subtle text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
  )}
>
  <Users className="h-3.5 w-3.5" aria-hidden /> Nhóm theo người
</button>
```
và đổi điều kiện chip thành `swimlaneBy !== 'none' && swimlaneBy !== 'assignee'` (import `cn` từ `@/lib/utils` nếu chưa có). Các chỗ còn lại (`buildLanes`, `assigneeChanged`) tự dùng giá trị hiệu lực vì cùng tên biến.
- [ ] Step 4: `pnpm --filter @tirapro/web test` PASS; gate: `pnpm --filter @tirapro/web typecheck && pnpm --filter @tirapro/web lint && node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/features/board` (không finding mới). Kiểm tay: (1) bảng cấu hình "Không chia hàng": bấm "Nhóm theo người" → chia theo người, tải lại trang vẫn giữ; đăng nhập tài khoản khác → vẫn phẳng. (2) Bấm lại → phẳng; localStorage không còn key (override null). (3) Bảng cấu hình "Theo epic": nút tắt → bấm → theo người; bấm lại → về epic. (4) Bảng cấu hình "theo người": nút sáng sẵn; bấm → phẳng; đổi cấu hình bảng sang "Không chia" rồi mở lại: nút tắt, không kẹt override. (5) Có quyền `issue:assign`: kéo thẻ sang hàng người khác khi bật toggle → đổi người phụ trách; Tab/Enter vào nút được, `aria-pressed` đúng.
- [ ] Step 5: Commit: `Web: khôi phục toggle cá nhân "Nhóm theo người" trên bảng (override lưu theo người và theo bảng, mặc định theo cấu hình bảng)`
**Rủi ro/đụng chạm:** `BoardPage.tsx` (cũng W1 — làm sau W1; hai thay đổi nằm ở vùng khai báo khác nhau nhưng cùng khối đầu component). Release note: nút "Nhóm theo người" trở lại (cá nhân).

### Task W4: Dialog dùng chung — hiệu ứng đóng, icon/màu tiêu đề, PlanningPanel focus-trap

**Mục tiêu:** Mọi hộp thoại/ngăn kéo đóng bằng hiệu ứng (fade/zoom 150ms) thay vì biến mất đột ngột; tiêu đề giữ icon/chấm màu như trước khi chuyển sang `Dialog` dùng chung (commit `cf14c95`→`db14342`…`c54e2e6`); `PlanningPanel` có focus-trap, Esc, trả focus và `data-state` như các dialog khác.
**Hiện trạng:**
- `components/ui/Dialog.tsx` (bọc Radix) có animation `data-[state=open|closed]` nhưng nhiều file bọc nó bằng `if (!open) return null` → khi `open=false` cây bị gỡ NGAY, Radix không kịp phát trạng thái `closed` ⇒ mất animation đóng. Nhiều file còn truyền `open` TRẦN (`<Dialog open …>`) vì đã chặn `!open` ở trên.
- Danh sách chính xác (`grep -rnE "if \(.*!open.*\) return null" apps/web/src`) — 18 file:

| # | File:dòng | Điều kiện | Ghi chú |
|---|---|---|---|
| 1 | `features/clients/ClientEditorModal.tsx:62` | `!open` | |
| 2 | `features/clients/ClientProjectsModal.tsx:34` | `!open \|\| !client` | cần giữ `client` lúc đóng |
| 3 | `features/clients/ContractEditorModal.tsx:98` | `!open \|\| !clientId` | giữ `clientId` (+ `clientName`) |
| 4 | `features/goals/GoalEditorModal.tsx:137` | `!open` | |
| 5 | `features/goals/AttachIssuesModal.tsx:37` | `!open \|\| !goal` | giữ `goal` |
| 6 | `features/projects/CreateProjectModal.tsx:63` | `!open` | `<Dialog open` trần ở dòng 100 |
| 7 | `features/workspace/CreateWorkspaceModal.tsx:40` | `!open` | trần ở dòng 65 |
| 8 | `features/intake/ReportIssueModal.tsx:34` | `!open` | trần ở dòng 63 |
| 9 | `features/ai/GenerateIssuesDialog.tsx:46` | `!open` | trần ở dòng 108 |
| 10 | `features/raid/RaidEditorModal.tsx:124` | `!open` | |
| 11 | `features/teams/AssignTeamModal.tsx:32` | `!open \|\| !team` | giữ `team` |
| 12 | `features/teams/TeamEditorModal.tsx:79` | `!open` | |
| 13 | `features/portfolio/ProgramEditorModal.tsx:96` | `!open` | |
| 14 | `features/portfolio/ProgramProjectsModal.tsx:34` | `!open \|\| !program` | giữ `program` |
| 15 | `features/members/AddPeopleDialog.tsx:118` | `!open` | trần ở dòng 152 |
| 16 | `features/workflow-settings/WorkflowViewDialog.tsx:134` | `!open` | trần ở dòng 138; được `IssueDetailPage` lazy-mount qua `wfSeen` |
| 17 | `features/issues/CreateIssueModal.tsx:180` | `!open` | trần ở dòng 250 |
| 18 | `features/planning/PlanningPanel.tsx:393` | `!open` | KHÔNG dùng `Dialog` — ngăn kéo tự viết (xem dưới) |

  Cùng lỗi ở dạng mount có điều kiện (không có `open` prop, `<Dialog open>` trần): `features/settings/RolesPage.tsx:130-141` (`{(editing || creatingScope) && <RoleDialog …/>}`, `Dialog open` ở dòng 330) và `features/admin/AdminUsersPage.tsx:90` (`{createOpen && <CreateUserModal …/>}`, `Dialog open` ở dòng 150). Các dialog khác (`SprintEditDialog`, `CompleteSprintDialog`, `BoardSettingsDialog`, `SprintAssistantDialog`, `ShortcutsDialog`, `ConfirmDialog`, `ConfirmHost`, CommandPalette…) truyền `open` thật — không đổi.
- `features/planning/PlanningPanel.tsx:379-436`: ngăn kéo tự viết — `window` keydown cho Esc, `role="dialog" aria-modal` nhưng KHÔNG focus-trap, không trả focus về nút mở, không `data-state` (animation chỉ `animate-in`, không có exit), nút nền `<button>` tự đóng; `if (!open) return null` (dòng 393). Nó được gọi ở `GanttPage.tsx:626`.
- Icon/màu tiêu đề đã mất — so với bản trước migrate (`git show <commit>^:<file>`; tất cả là `<Icon className="h-4 w-4 text-primary">` đặt trước chữ tiêu đề, hoặc chấm màu `h-3 w-3 rounded-full`). Hiện `Dialog` chỉ nhận `title: string`:

| File (commit migrate) | Mất |
|---|---|
| `members/AddPeopleDialog.tsx` (ade665d) | icon `Users` primary |
| `projects/CreateProjectModal.tsx` (ade665d) | icon `FolderKanban` primary |
| `workspace/CreateWorkspaceModal.tsx` (ade665d) | icon `Building2` primary |
| `workflow-settings/WorkflowViewDialog.tsx` (ade665d) | pill `bg-primary-subtle text-primary` "Hiện tại: <status>" cạnh tiêu đề (nay chỉ còn `description` chữ xám) |
| `ai/GenerateIssuesDialog.tsx` (9dde2f9) | icon `Sparkles` primary |
| `ai/SprintAssistantDialog.tsx` (9dde2f9) | icon `Sparkles` primary |
| `intake/ReportIssueModal.tsx` (9dde2f9) | icon `Bug` primary |
| `issues/CreateIssueModal.tsx` (9dde2f9) | icon `Plus` primary |
| `components/layout/ShortcutsDialog.tsx` (9dde2f9) | icon `Keyboard` primary |
| `saved-filters/FiltersPage.tsx` `CreateFilterModal` (cc2ddb0) | icon `FilterIcon` primary |
| `settings/RolesPage.tsx` `RoleDialog` (cc2ddb0) | icon `Shield` primary (chế độ sửa/tạo; chế độ chỉ-xem đã chuyển `RoleBadge` + "Chỉ xem" xuống thân — ổn) |
| `portfolio/ProgramEditorModal.tsx` (9a01ee2) | chấm màu theo `color` đang chọn |
| `portfolio/ProgramProjectsModal.tsx` (9a01ee2) | chấm màu `program.color ?? var(--faint)` |
| `teams/TeamEditorModal.tsx` (9a01ee2) | chấm màu theo `color` |
| `components/ui/useConfirm.tsx` `ConfirmHost` + `features/issues/ConfirmDialog.tsx` (db14342) | huy hiệu tròn đỏ `AlertTriangle` (`bg-danger/10 text-danger`) khi `destructive`/`danger` |

  Không mất gì (header cũ không có icon): ClientEditor/ClientProjects/ContractEditor, GoalEditor/AttachIssues, RaidEditor, AssignTeam, Recurring/Template/RuleEditor, SprintEdit/CompleteSprint/BoardSettings, CreateUserModal, SlaPage. Màu `danger` của nút "Xoá" trong footer Role giữ nguyên.
**Files:**
- Modify: `apps/web/src/components/ui/Dialog.tsx:12-110` — thêm `icon`, `iconTone`, `headerExtra`, `placement`.
- Create: `apps/web/src/lib/useRetained.ts` — giữ giá trị khác-null gần nhất qua lúc đóng.
- Modify: 17 file ở bảng 1-17 (bỏ early return; `open={open}`; dùng `useRetained` cho #2,3,5,11,14; thêm `icon`/`headerExtra` theo bảng "mất icon").
- Modify: `features/settings/RolesPage.tsx:130-141,234,330`, `features/admin/AdminUsersPage.tsx:90,~140-150` — luôn mount, nhận `open`.
- Modify: `features/planning/PlanningPanel.tsx:379-436` — dựng trên `Dialog placement="right"`; `features/gantt/GanttPage.tsx:626` không đổi chữ ký.
- Modify: `components/ui/useConfirm.tsx:~48-70`, `features/issues/ConfirmDialog.tsx:~38-60` — `icon={<AlertTriangle/>} iconTone="danger"` khi destructive.
- Modify: `components/layout/ShortcutsDialog.tsx:34`, `features/saved-filters/FiltersPage.tsx:~425`, `features/ai/SprintAssistantDialog.tsx:~87` — thêm icon.
- Test: `apps/web/src/components/ui/dialog-contract.test.ts` (mới — quét mã nguồn chống tái phạm).
**Interfaces:** Produces `DialogProps.icon?: ReactNode`, `iconTone?: 'primary' | 'danger'` (mặc định `primary`), `headerExtra?: ReactNode`, `placement?: 'center' | 'right'` (mặc định `center`); `useRetained<T>(value: T | null | undefined): T | null`. Consumes Radix Dialog đã có; `tailwindcss-animate` đã được dùng (`animate-in`, `slide-in-from-right` ở PlanningPanel hiện tại).
**Quyết định thiết kế:**
- Sửa tận gốc ở `Dialog` + bỏ early return, KHÔNG thêm "exit delay" thủ công: Radix tự giữ phần tử đến hết animation `data-[state=closed]`; chỉ cần để `Dialog` luôn mount với `open` thật. Khi đóng, `Dialog` không render children (Portal chỉ mount lúc mở hoặc đang đóng) nên chi phí thấp.
- Modal có đối tượng đích (`client`, `goal`, `team`, `program`, `clientId`) có thể đổi về `null` ngay khi đóng → dùng `useRetained` để nội dung không biến mất giữa hiệu ứng đóng; `if (!shown) return null` chỉ còn chặn trước lần mở đầu tiên.
- Icon qua prop (không nhét JSX vào `title`): `title` giữ là chuỗi cho tên truy cập (a11y) và vì `Dialog` đang dùng nó cho `RadixDialog.Title`. Icon luôn `aria-hidden`, tone `primary` (đúng DESIGN.md: một màu brand) hoặc `danger` cho xác nhận phá huỷ. Chấm màu (Program/Team) truyền như `icon` với `style={{ background }}` — vẫn bọc `text-primary` nhưng không ảnh hưởng vì dùng `background`.
- Pill "Hiện tại: …" của WorkflowViewDialog trở lại qua `headerExtra`; `description` bỏ để khỏi lặp thông tin.
- PlanningPanel: thêm `placement="right"` vào `Dialog` thay vì tạo component Drawer riêng — tái dùng toàn bộ focus-trap/Esc/trả focus/`data-state`/header/nút đóng và bảo đảm đồng bộ DESIGN.md; ngăn kéo là biến thể bố cục (`inset-y-0 right-0`, không `m-auto`, `slide-in-from-right`/`slide-out-to-right`).
- Mount-có-điều-kiện (RolesPage, AdminUsersPage) đổi sang luôn mount + `open` để cùng được hiệu ứng đóng; state nội bộ phải reset khi mở lại (effect theo `open`).
- Chống tái phạm bằng test quét mã nguồn (rẻ, không cần DOM) thay vì thêm rule eslint tuỳ biến.
- [ ] Step 1: Viết test fail — `apps/web/src/components/ui/dialog-contract.test.ts`:
```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..'); // apps/web/src

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('hợp đồng Dialog', () => {
  const all = files(SRC).map((f) => ({ f: relative(SRC, f), text: readFileSync(f, 'utf8') }));

  it('không file nào chặn `open` bằng early-return trước khi vẽ Dialog (mất hiệu ứng đóng)', () => {
    const bad = all.filter(({ text }) => /if \((?:[^)]*\|\| )?!open\b[^)]*\)\s*return null/.test(text)).map((x) => x.f);
    expect(bad, `Bỏ early-return, dùng useRetained cho đối tượng đích: ${bad.join(', ')}`).toEqual([]);
  });

  it('không dùng `<Dialog open` trần (luôn mount) ngoài components/ui', () => {
    const bad = all
      .filter(({ f, text }) => !f.startsWith('components/ui') && /<Dialog(?:\s+open\s|\s*\n\s*open\s*\n)/.test(text))
      .map((x) => x.f);
    expect(bad, `Truyền open thật: ${bad.join(', ')}`).toEqual([]);
  });

  it('PlanningPanel dựng trên Dialog dùng chung (focus-trap, data-state)', () => {
    const t = all.find((x) => x.f === 'features/planning/PlanningPanel.tsx')!.text;
    expect(t).toContain("from '@/components/ui/Dialog'");
    expect(t).not.toMatch(/role="dialog"/);
  });
});
```
- [ ] Step 2: `pnpm --filter @tirapro/web test -- dialog-contract` → FAIL, liệt kê đúng 18 file + RolesPage/AdminUsersPage (cho case `open` trần) + PlanningPanel.
- [ ] Step 3: Implementation.
`Dialog.tsx`: thêm props và header:
```tsx
  /** Icon đứng trước tiêu đề (aria-hidden) — vd `<Sparkles className="h-4 w-4" />`, hoặc chấm màu. */
  icon?: ReactNode;
  /** Sắc của icon: `primary` (mặc định) hoặc `danger` cho xác nhận phá huỷ. */
  iconTone?: 'primary' | 'danger';
  /** Nội dung phụ cạnh tiêu đề (vd pill trạng thái hiện tại). */
  headerExtra?: ReactNode;
  /** `right` = ngăn kéo cạnh phải, dùng cho panel phụ (PlanningPanel). */
  placement?: 'center' | 'right';
```
Phần tiêu đề:
```tsx
<div className="flex min-w-0 items-center gap-2">
  {icon && (
    <span aria-hidden className={cn('grid shrink-0 place-items-center', iconTone === 'danger' ? 'text-danger' : 'text-primary')}>
      {icon}
    </span>
  )}
  <RadixDialog.Title className="min-w-0 text-base font-semibold text-ink-strong">{title}</RadixDialog.Title>
  {headerExtra}
</div>
```
Class `RadixDialog.Content` theo `placement`: `center` giữ nguyên; `right`:
`'fixed inset-y-0 right-0 z-modal flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-surface shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right'` (không dùng `SIZE`; không `rounded`; không `m-auto`). Giữ overlay hiện có. `useRetained.ts`:
```ts
import { useRef } from 'react';

/** Trả giá trị khác-null gần nhất — để modal còn nội dung suốt hiệu ứng đóng khi đối tượng đích đã về `null`. */
export function useRetained<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(null);
  if (value != null) ref.current = value;
  return ref.current;
}
```
Mỗi file #1-17: (a) xoá `if (!open) return null;`; với #2,3,5,11,14 đặt `const shown = useRetained(client);` ngay sau khai báo hooks hiện có rồi `if (!shown) return null;` và thay mọi `client` dùng sau đó bằng `shown` (effect reset theo `open` vẫn đọc prop gốc); (b) `<Dialog open … >` → `open={open}`; (c) chỗ thân hàm tính toán phụ thuộc đối tượng đích đã non-null nhờ `shown`; (d) thêm `icon`/`headerExtra` theo bảng "mất icon", ví dụ `AddPeopleDialog` → `icon={<Users className="h-4 w-4" />}`; `CreateProjectModal` → `FolderKanban`; `CreateWorkspaceModal` → `Building2`; `GenerateIssuesDialog`/`SprintAssistantDialog` → `Sparkles`; `ReportIssueModal` → `Bug`; `CreateIssueModal` → `Plus`; `ShortcutsDialog` → `Keyboard`; `CreateFilterModal` → `FilterIcon`; `RoleDialog` → `<Shield/>` khi `!readOnly`; Program/Team → `<span className="h-3 w-3 rounded-full" style={{ background: color }} />`; `WorkflowViewDialog` → `headerExtra={currentStatusName && <span className="rounded bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">Hiện tại: {currentStatusName}</span>}` và bỏ `description`. Kiểm `grep` các modal trong danh sách có state khởi tạo bằng `useState(prop)` (không reset bằng effect theo `open`) — vì giờ component không còn bị unmount khi đóng, state đó sẽ không tự reset: với mỗi file chạy rà soát và thêm `useEffect(() => { if (open) setX(init) }, [open])` nếu thiếu (đa số đã có sẵn `if (!open) return;` effect — đã grep thấy ở ClientProjects/ContractEditor/GoalEditor/AttachIssues/RaidEditor/TeamEditor/ProgramEditor/ProgramProjects/AddPeople; cần kiểm riêng ClientEditor, CreateWorkspace, ReportIssue, GenerateIssues, CreateIssue, WorkflowView).
`RolesPage`: `<RoleDialog open={!!(editing || creatingScope)} role={useRetained(editing)} …/>` (đặt `useRetained` ở component cha, không trong JSX điều kiện) và `Dialog open={open}`; `AdminUsersPage`: `<CreateUserModal open={createOpen} …/>`, trong modal `Dialog open={open}` + effect `if (open) { reset form/tempPassword }`.
`PlanningPanel`:
```tsx
export function PlanningPanel({ open, projectId, issues, canManage, onClose }: {…}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Phụ thuộc & cột mốc"
      placement="right"
      bodyClassName="p-0"
    >
      <DependencySection projectId={projectId} issues={issues} canManage={canManage} />
      <MilestoneSection projectId={projectId} canManage={canManage} />
    </Dialog>
  );
}
```
(xoá `useEffect` Esc, header tự viết, nút nền; bỏ import `X`/`Button` nếu không còn dùng; `DependencySection`/`MilestoneSection` giữ nguyên.) `ConfirmHost`/`ConfirmDialog`: `icon={destructive ? <AlertTriangle className="h-4 w-4" /> : undefined} iconTone="danger"`.
- [ ] Step 4: `pnpm --filter @tirapro/web test` PASS; gate: `pnpm --filter @tirapro/web typecheck && pnpm --filter @tirapro/web lint && pnpm --filter @tirapro/web build && node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src`. Kiểm tay (bắt buộc, UI): với MỖI dialog ở bảng 1-17 + RoleDialog + CreateUserModal + PlanningPanel: mở → đóng bằng Esc/nút X/click nền → thấy fade/zoom đóng (không biến mất tức thì); mở lại → form về trạng thái ban đầu (không giữ dữ liệu lần trước, không giữ `tempPassword` của lần tạo tài khoản trước); focus trả về nút mở. PlanningPanel: Tab xoay vòng trong ngăn kéo, Esc đóng, DevTools thấy `data-state="open|closed"`, trượt vào/ra từ phải, bật `prefers-reduced-motion` thì tức thì. Kiểm icon: tiêu đề các dialog trong bảng "mất icon" có icon cobalt/ chấm màu; xác nhận xoá (vd xoá bộ lọc) có huy hiệu cảnh báo đỏ; light + dark đều đạt AA.
- [ ] Step 5: Commit (có thể tách 3 commit): `Web: Dialog nhận icon/headerExtra/placement, khôi phục icon và màu tiêu đề các hộp thoại`; `Web: bỏ early-return !open ở 17 modal (giữ hiệu ứng đóng), RolesPage/AdminUsersPage luôn mount, thêm useRetained + test hợp đồng`; `Web: PlanningPanel dựng trên Dialog (focus-trap, data-state, trả focus)`.
**Rủi ro/đụng chạm:** Chạm ~25 file web nên làm CUỐI nhóm; trùng file với task khác: `FiltersPage.tsx` (W3), `ProjectLayout.tsx` không đụng. Rủi ro chính: state form không còn tự reset do không unmount khi đóng (đã nêu bước rà từng file); `WorkflowViewDialog` và `GenerateIssuesDialog` có query bật theo `open` — kiểm không gọi API khi đóng. Đổi nhìn thấy được: tiêu đề dialog có icon, hiệu ứng đóng mượt — ghi release note ngắn.

#### Bảng đụng chạm

File bị ≥2 task trong nhóm W sửa — thứ tự làm đề xuất **W2 → W1 → W3 → W6 → W5 → W4**:

| File | Task | Ghi chú |
|---|---|---|
| `apps/web/src/features/issues/IssueDetailPage.tsx` | W1 (`useCan`, prop `ChecklistPanel`), W3 (hotkey `w`, `LazyPanel force`, `id="issue-worklog"`) | W1 trước; W3 dùng `can` đã là `useCan` |
| `apps/web/src/features/issues/WorklogPanel.tsx` | W1 (`useCan`), W3 (bỏ listener, `openRequest`) | như trên |
| `apps/web/src/features/board/BoardPage.tsx` | W1 (dòng 123-127), W5 (dòng 135, 335-343, import) | W1 trước W5 |
| `apps/web/src/lib/useGlobalHotkeys.ts` | W3 (import `isTypingTarget`/`isDialogOpen`), W6 (`currentProjectKey`) | W3 trước W6 |
| `apps/web/src/features/projects/ProjectLayout.tsx` | W1 (dòng 46), W6 (dòng 20 `LAST_VIEW_KEY`) | W1 trước W6 |
| `apps/web/src/features/saved-filters/FiltersPage.tsx` | W3 (gate quyền), W4 (icon `CreateFilterModal`) | W3 trước W4 |
| `apps/web/src/lib/queryKeys.ts` | W1 (`projects.permissions`) | W2 không đổi key |
| `apps/web/src/features/reports/api.ts` + `ReportsPage.tsx` | chỉ W2 | |
| `packages/types/src/entities.ts` | chỉ W1 | cần `pnpm --filter @tirapro/types build` |
| Ngoài nhóm cần lưu ý | W1 sửa `projects.controller.ts` (module projects); W2 sửa `analytics.*`; nhóm API khác nếu cũng sửa `permissions.guard.ts`/`rbac.service.ts` thì W1/W2 KHÔNG đụng hai file đó | |

Cổng cuối nhóm: `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @tirapro/web build`, rồi smoke tay theo từng task (cần 3 tài khoản: Admin, Member, Viewer; một Member có ghi đè "Project Admin" ở 1 dự án).

#### Ngoài phạm vi / không làm

- **Quyền ở trang đa dự án**: `AutomationPage.tsx:31` (`project:admin`, `/connect/automation`) và `RaidPage.tsx:258-259` (`risk:manage`, `/manage/risks`) liệt kê mục của nhiều dự án (mỗi mục có `projectId`/có thể không gắn dự án); gate cấp trang theo workspace là xấp xỉ chấp nhận được — để dành, nếu cần thì gate theo từng hàng bằng `useCan(item.projectId)`. Không làm trong W1.
- **Nút theo quyền `:own`** (vd Reporter có `issue:edit:own`): `hasPermission` giữ so khớp chính xác như `can()` cũ; hiển thị nút sửa theo `:own` cần biết chủ issue — việc riêng, không nằm trong follow-up này.
- **`AuthService.me()`** (`auth.service.ts:118`) giữ trả quyền workspace — đổi sang "union mọi dự án" sẽ làm lộ nút sai dự án; hướng đã chọn là endpoint theo dự án.
- Không đổi `permissions.guard.ts` để đọc id tài nguyên từ query (W2 dùng `projectId` + kiểm sprint ∈ project); nếu nhóm API khác muốn khái quát hoá thì tách task riêng.
- Không thêm rule eslint tuỳ biến cho dialog (W4 dùng test quét mã nguồn); không đổi 181 chỗ `toast.error(apiErrorMessage(e))` (W6).
- Mục "Bỏ toggle cá nhân Nhóm theo người" đã **chốt theo hướng khôi phục** (không phải xoá thêm gì): bằng chứng hành vi cũ `git show dee288b^:apps/web/src/features/board/BoardPage.tsx` dòng 67-87, 229-243; hiện `BoardPage.tsx:135,335-343` chỉ còn chip tĩnh.

## Nhóm T — Tooling / nợ kỹ thuật

#### Nhóm T — Tooling / nợ kỹ thuật

**Thứ tự chạy trong toàn plan (khuyến nghị):** T2 → T3 (độc lập, làm sớm; T3 chỉ chạy khi không task nào khác đang sửa `modules/dev`) → … các nhóm S/C/W … → T1 (đo ratchet trên code cuối của các nhóm kia) → **T4** (SAU S3, C2, C3) → **T5 (CUỐI CÙNG toàn plan)**.

Số liệu đo thật ngày 2026-10-15 trên `fix/review-findings` (HEAD `22c116c`): `pnpm exec eslint .` = **0 lỗi, 246 cảnh báo**; `pnpm exec prettier --check .` = **432 file** chưa đạt (follow-up ghi "265+" là số cũ); `issues.service.ts` = **843 dòng** (follow-up ghi "~1000" là số cũ).

---

### Task T1: Hạ ratchet lint và trả họ `no-unsafe-*` ở top file

**Mục tiêu:** `pnpm lint` vẫn 0 lỗi nhưng ngưỡng cảnh báo giảm từ 275 xuống đúng số đo được sau khi trả nợ ở 12 file nhiều cảnh báo nhất (+ quét nốt các `features/*/api.ts` của web); không dùng `as any` / `eslint-disable`.

**Hiện trạng:** `package.json:15` `"lint": "eslint . --max-warnings 275"`. Đo thật: 246 cảnh báo, trong đó 200 thuộc họ `no-unsafe-*` + `no-explicit-any` (mcp 86, web 60, api-spec 44, api-src 10), còn 46 là `max-lines-per-function` (42), `react-hooks/exhaustive-deps` (3), 1 parse-null (không thuộc T1). `docs/superpowers/plans/lint-debt.md` dòng 3 còn ghi 275 và bảng rule đã lệch số.
Top file theo số cảnh báo họ này (lệnh đo ở Step 0):

| File | Số | Gốc vấn đề |
|---|---|---|
| `apps/mcp/src/index.ts` | 78 | `findProject` ép `any[]`; `tira.get()` trả `Promise<any>` → mọi chỗ dùng đều "lan any" |
| `apps/api/src/modules/ai/ai.service.spec.ts` | 14 | `vi.fn()` không kiểu → `complete.mock.calls[0]![0]` là `any` |
| `apps/api/src/common/filters/all-exceptions.filter.spec.ts` | 11 | `json = vi.fn()` → `body` là `any` |
| `apps/mcp/src/tira.ts` | 8 | `req(): Promise<any>`, `let json: any` |
| `apps/api/src/modules/ai/claude.service.spec.ts` | 7 | mock `create` không kiểu |
| `apps/web/src/lib/api.ts` | 6 | `axios.post(...)` không generic → `res.data?.accessToken` là `any` (dòng 24-27) |
| `apps/api/src/modules/ai/ai-quota.service.spec.ts` | 5 | mock không kiểu |
| `apps/api/src/modules/realtime/redis-io.adapter.ts` | 4 | `super.createIOServer()` trả `any` (dòng 111-116) |
| `apps/web/src/features/board/BoardPage.tsx` | 4 | `JSON.parse(...)` gán thẳng (dòng 143-144) |
| `apps/web/src/features/members/api.ts` | 4 | `return (await api.post(...)).data` thiếu generic (dòng 72, 100, 164, 228) |
| `apps/web/src/features/project-config/api.ts` | 4 | như trên |
| `apps/web/src/stores/auth.ts` | 4 | `api.post('/auth/login')` → `res.data.accessToken` (dòng 28, 34) |

Tổng 12 file = **149** cảnh báo. Phần còn lại của web (38 cảnh báo family, rải 1-3 mỗi file ở `features/*/api.ts`, `stores/recentIssues.ts`, `lib/socket.ts`, `CreateIssueModal.tsx`, `ProjectLayout.tsx`) cùng một mẫu cơ học → làm ở Phần B.

**Files:**
- Modify: `package.json:15` — `--max-warnings` về số đo mới (Phần A rồi Phần B).
- Modify: `docs/superpowers/plans/lint-debt.md` — cập nhật số tổng + bảng rule (đo lại bằng script Step 0).
- Modify (Phần A, mcp): `apps/mcp/src/tira.ts`, `apps/mcp/src/index.ts`; Create: `apps/mcp/src/types.ts` — kiểu tối thiểu của phản hồi REST mcp dùng (mcp KHÔNG phụ thuộc `@tirapro/types`, không thêm dependency).
- Modify (Phần A, api): `apps/api/src/modules/ai/ai.service.spec.ts`, `apps/api/src/common/filters/all-exceptions.filter.spec.ts`, `apps/api/src/modules/ai/claude.service.spec.ts`, `apps/api/src/modules/ai/ai-quota.service.spec.ts`, `apps/api/src/modules/realtime/redis-io.adapter.ts`.
- Modify (Phần A, web): `apps/web/src/lib/api.ts`, `apps/web/src/stores/auth.ts`, `apps/web/src/features/members/api.ts`, `apps/web/src/features/project-config/api.ts`, `apps/web/src/features/board/BoardPage.tsx:140-146`.
- Modify (Phần B, web): mọi file còn cảnh báo family sau Phần A (danh sách ở Step 0 chạy lại).
- Test: không thêm spec mới — "test fail" của task này là chính cổng `pnpm lint` với ngưỡng đã hạ; hành vi giữ nguyên nên chạy lại toàn bộ `pnpm test`.

**Interfaces:** Produces: `Tira.get<T>/post<T>/patch<T>` generic (mcp nội bộ); không đổi API công khai nào. Consumes: không.

**Quyết định thiết kế:**
- "Top N" chốt = 12 file ở bảng trên (mọi file ≥ 4 cảnh báo) = 149 cảnh báo, + Phần B quét web. Không đụng `apps/api` non-spec khác (6 cảnh báo lẻ ở `permissions.guard.ts`, `realtime.gateway.ts`, `response.interceptor.ts`) — để lại, ratchet vẫn giữ chúng.
- Kiểu thật thay cho any: mcp dùng `interface` cục bộ + `Tira.req<T>()` trả `json as T` (cast từ `unknown`, không phải `any`); web dùng generic `api.get<T>()`; spec dùng `vi.fn<(arg: X) => Y>()` kiểu theo chữ ký thật (`Parameters<ClaudeService['complete']>[0]`).
- `max-lines-per-function` (42) và `exhaustive-deps` (3) KHÔNG thuộc T1; ratchet hạ về đúng số đo, không hạ xuống 0.
- Ngưỡng cuối **= số đo thật sau khi sửa** (không đoán). Dự kiến từ số hôm nay: sau Phần A = 246 − 149 = **97**; sau Phần B = 97 − 38 = **59**. Nếu lúc chạy các nhóm khác đã đổi số, lấy `BASE` đo lúc bắt đầu rồi trừ cùng các tổng.
- Mỗi Phần một commit để dễ revert; ratchet hạ TRƯỚC khi sửa (TDD với cổng lint).

- [ ] **Step 0: Đo cơ sở**
```bash
cd /Users/inrnee/tirapro
pnpm exec eslint . -f json -o /tmp/lint.json   # dùng scratchpad nếu có
node -e "
const r=require('/tmp/lint.json');const fam=/no-unsafe|no-explicit-any/;let w=0;const f={};
for(const x of r){for(const m of x.messages){if(m.severity===1)w++;if(fam.test(m.ruleId)){const p=x.filePath.replace(process.cwd()+'/','');f[p]=(f[p]||0)+1}}}
console.log('warnings',w);console.log(Object.entries(f).sort((a,b)=>b[1]-a[1]).slice(0,25))"
```
Ghi `BASE` (hôm nay 246) và tổng 12 file (149).

- [ ] **Step 1: Viết "test fail" = hạ ngưỡng trước.** Sửa `package.json:15` thành `"lint": "eslint . --max-warnings <BASE-149>"` (hôm nay `97`).
- [ ] **Step 2:** `pnpm lint` → kỳ vọng **FAIL** (`ESLint found too many warnings (maximum: 97)`), exit 1.
- [ ] **Step 3: Phần A — sửa 12 file bằng kiểu thật.**

  `apps/mcp/src/types.ts` (mới):
  ```ts
  /** Hình dạng tối thiểu của phản hồi REST mà MCP đọc — chỉ các trường thực sự dùng. */
  export interface ProjectLite { id: string; key: string; name: string }
  export interface UserLite { id: string; email: string; displayName: string }
  export interface NamedRef { id: string; name: string; key?: string }
  export interface ProjectMeta { issueTypes: NamedRef[]; priorities: NamedRef[] }
  export interface IssueRef { id: string; version: number }
  ```
  `apps/mcp/src/tira.ts`: đổi `req(...)`: `private async req<T>(path: string, init?: RequestInit): Promise<T>`; `let json: unknown = null;`; lấy message bằng thu hẹp kiểu:
  ```ts
  const errBody = typeof json === 'object' && json !== null ? (json as { error?: { message?: string }; message?: string }) : null;
  const msg = errBody?.error?.message ?? errBody?.message ?? `HTTP ${res.status}`;
  ...
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) return (json as { data: T }).data;
  return json as T;
  ```
  và `get<T>(path)`, `post<T>(path, body)`, `patch<T>(path, body)` chuyển tiếp generic (`this.req<T>(...)`).
  `apps/mcp/src/index.ts`: `findProject` → `const projects = await tira.get<ProjectLite[]>('/projects');`; `get_context` → `tira.get<ProjectLite[]>('/projects')`, `tira.get<UserLite[]>('/users')`, `ctx` đổi thành object literal có kiểu (`const ctx: { projects: ...; members: ...; issueKeyFormat: string; project?: {...} }`), bỏ `(p: any)`; `meta = await tira.get<ProjectMeta>(...)`; `create_issue`: `tira.get<ProjectMeta>`, `tira.get<UserLite[]>('/users')`; `update_issue`: `const issue = await tira.get<IssueRef>(...)`, `const patch: { version: number; summary?: string; description?: string } = { version: issue.version }`; `add_comment`: `tira.get<IssueRef>`. Không còn `any` nào trong `apps/mcp/src`.

  `apps/web/src/lib/api.ts` (dòng 24): `const res = await axios.post<{ accessToken?: string }>(...)`; `const token = res.data?.accessToken ?? null;`.
  `apps/web/src/stores/auth.ts` (dòng 27-35): `api.post<{ accessToken: string }>('/auth/login', ...)`, tương tự `/auth/register`.
  `members/api.ts`, `project-config/api.ts`: mỗi `(await api.post('/x', input)).data` → thêm generic thật theo response server (`{ success: true }`/DTO tương ứng; nếu server trả rỗng dùng `api.post<void>`); đọc controller phía API để chọn kiểu, không dùng `unknown` cho dữ liệu mà caller dùng.
  `BoardPage.tsx:143`: `const p = JSON.parse(localStorage.getItem(...) || '{}') as { assignee?: unknown };` rồi giữ `typeof p.assignee === 'string'` (dòng 144 đã thu hẹp).
  `redis-io.adapter.ts`: `import type { Server, ServerOptions } from 'socket.io';` và
  ```ts
  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, { ...options, cors: buildSocketCors(...) }) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
  ```
  Specs api: định nghĩa kiểu cục bộ đầu file rồi gắn vào `vi.fn`:
  - `ai.service.spec.ts`: `type CompleteArg = Parameters<ClaudeService['complete']>[0]; const complete = vi.fn<(arg: CompleteArg) => Promise<{ data: string }>>().mockResolvedValue({ data: 'tóm tắt' });` → `arg.model/ctx/system/prompt` có kiểu; `arg.prompt.match(...)` hợp lệ.
  - `all-exceptions.filter.spec.ts`: `interface ErrBody { error: { code?: string; message: string; requestId?: string } }`, `const json = vi.fn<(b: ErrBody) => void>(); const status = vi.fn<(c: number) => unknown>().mockReturnThis()`; `run()` trả `{ status: res.status.mock.calls[0]?.[0], body: json.mock.calls[0]![0] }`.
  - `claude.service.spec.ts`, `ai-quota.service.spec.ts`: cùng mẫu (kiểu tham số từ chữ ký hàm thật; đọc 2 file để chọn).
- [ ] **Step 4 (Phần A):**
```bash
pnpm lint                       # exit 0, "(maximum: 97)" không bị vượt; đo lại số thật = X
pnpm --filter @tirapro/mcp typecheck && pnpm --filter @tirapro/api typecheck && pnpm --filter @tirapro/web typecheck
pnpm --filter @tirapro/api test && pnpm --filter @tirapro/web test
```
  Nếu X < 97, hạ `--max-warnings` xuống X (không để thừa chỗ). Nếu X > 97 → còn cảnh báo family ở 12 file, quay lại Step 3.
- [ ] **Step 5 (Phần A): Commit:** `Lint: gắn kiểu thật cho mcp/spec api/web auth, hạ ngưỡng cảnh báo từ 275 xuống <X>`
- [ ] **Step 3B (Phần B):** chạy lại Step 0, với MỖI file web còn cảnh báo family: `features/*/api.ts` thêm generic `api.get<T>/post<T>/...` (kiểu lấy từ interface đã có trong chính file), `stores/recentIssues.ts` (`JSON.parse(...) as unknown` rồi thu hẹp/ép kiểu đã khai báo), `lib/socket.ts`, `CreateIssueModal.tsx`, `ProjectLayout.tsx` theo mẫu `unknown` + thu hẹp. Hạ `--max-warnings` về số đo thật (dự kiến 59), gõ lệnh Step 4.
- [ ] **Step 5B: Commit:** `Web: gắn generic cho các lớp api và store còn lại, ngưỡng cảnh báo còn <Y>`; cập nhật `lint-debt.md` (ngày, tổng, bảng phân bố theo rule + "Đã sửa trong Task T1") trong commit riêng hoặc gộp commit B.

**Rủi ro/đụng chạm:** `features/*/api.ts` còn bị nhóm W/S/C sửa (thêm hook mới) → T1 chạy SAU các nhóm đó; xung đột nếu không. `package.json` (root) bị T5 sửa nữa (script format). Hành vi runtime không đổi (chỉ kiểu) — không cần release note. Nếu kiểu thật làm lộ lỗi typecheck (generic sai) thì sửa kiểu, không `as`.

---

### Task T2: CI thêm job Postgres kiểm tra migration

**Mục tiêu:** Mỗi PR chạy `prisma migrate deploy` trên Postgres thật (pgvector), `prisma migrate diff --exit-code` để bắt migration lệch `schema.prisma`, và `db:raw` (chạy 2 lần để chứng minh idempotent).

**Hiện trạng:** `.github/workflows/ci.yml` chỉ có một job `check` (validate/generate/typecheck/lint/test/gen-enums), không có DB nào; `DATABASE_URL` chỉ là chuỗi giả. Có 16 migration trong `apps/api/prisma/migrations/`; `apps/api/prisma/sql/01_pgvector_fts.sql` tạo extension (`vector`, `pg_trgm`, `btree_gin`) + cột `Issue.searchVector`, `IssueEmbedding.embedding` + index một phần NGOÀI Prisma. `docker-compose.yml:3` dùng `pgvector/pgvector:pg16`. Lưu ý đã kiểm thật trên DB verify (PG18, cổng 5433): `prisma migrate diff --from-url <DB đã chạy db:raw> --to-schema-datamodel` **FAIL** (báo "Removed column searchVector/embedding…" vì cột raw không có trong schema), còn `--from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <db rỗng> --exit-code` → "No difference detected", exit 0.
Global Constraints yêu cầu migration chạy được trên Postgres 18.

**Files:**
- Modify: `.github/workflows/ci.yml` — thêm job `db` (không sửa job `check`).
- Test: không có spec vitest (là workflow). Kiểm bằng `actionlint` nếu có và chạy lệnh tương đương cục bộ (Step 2/4).

**Interfaces:** Produces: job CI `db`. Consumes: scripts `pnpm --filter @tirapro/api db:migrate:deploy|db:raw` đã có (`apps/api/package.json:12-14`).

**Quyết định thiết kế:**
- Dùng `--from-migrations` + `--shadow-database-url` (không dùng `--from-url`) vì cột/index raw của `db:raw` nằm ngoài schema — so với DB đã chạy raw luôn lệch.
- Matrix `pg: [16, 18]` với image `pgvector/pgvector:pg${{ matrix.pg }}`: follow-up chỉ định `pg16` (khớp docker-compose), Global Constraints đòi chạy được trên PG18. Hai phiên bản rẻ, đủ.
- `db:raw` chạy 2 lần (file khai báo idempotent `IF NOT EXISTS`) rồi kiểm cột tồn tại bằng `prisma db execute --stdin`.
- Job độc lập với `check` (không `needs`) để chạy song song; không cache DB.
- Không thêm secret; mật khẩu `tirapro` chỉ trong service container cục bộ của runner.

- [ ] **Step 1: "Test fail" = chạy cục bộ trước khi sửa workflow** (kiểm lệnh đúng trước khi đưa vào CI), trên DB trống riêng:
```bash
cd /Users/inrnee/tirapro/apps/api
U="postgresql://projira@localhost:5433/ci_probe?schema=public"; S="postgresql://projira@localhost:5433/ci_shadow?schema=public"
psql -h localhost -p 5433 -U projira -d postgres -c 'create database ci_probe' -c 'create database ci_shadow'
DATABASE_URL=$U DIRECT_URL=$U pnpm exec prisma migrate deploy
DATABASE_URL=$U DIRECT_URL=$U pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$S" --exit-code
```
- [ ] **Step 2:** Kỳ vọng: `migrate deploy` áp 16 migration không lỗi; `migrate diff` in "No difference detected" exit 0. (Để chứng minh cổng bắt được lỗi: sửa tạm một cột trong `schema.prisma` không kèm migration → diff exit 2; hoàn tác.) Dọn: `drop database ci_probe, ci_shadow`.
- [ ] **Step 3: Implementation** — thêm vào `ci.yml`:
```yaml
  db:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: { pg: [16, 18] }
    services:
      postgres:
        image: pgvector/pgvector:pg${{ matrix.pg }}
        env: { POSTGRES_USER: tirapro, POSTGRES_PASSWORD: tirapro, POSTGRES_DB: tirapro }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U tirapro" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://tirapro:tirapro@localhost:5432/tirapro
      DIRECT_URL: postgresql://tirapro:tirapro@localhost:5432/tirapro
      SHADOW_DATABASE_URL: postgresql://tirapro:tirapro@localhost:5432/tirapro_shadow
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @tirapro/api db:generate
      - name: migrate deploy trên DB trống
        run: pnpm --filter @tirapro/api db:migrate:deploy
      - name: migration không được lệch schema.prisma
        run: |
          PGPASSWORD=tirapro psql -h localhost -U tirapro -d postgres -c 'CREATE DATABASE tirapro_shadow'
          pnpm --filter @tirapro/api exec prisma migrate diff \
            --from-migrations prisma/migrations \
            --to-schema-datamodel prisma/schema.prisma \
            --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
      - name: db:raw (pgvector/FTS) chạy 2 lần, phải idempotent
        run: |
          pnpm --filter @tirapro/api db:raw
          pnpm --filter @tirapro/api db:raw
      - name: cột raw tồn tại
        run: |
          echo 'SELECT "searchVector" FROM "Issue" LIMIT 0; SELECT "embedding" FROM "IssueEmbedding" LIMIT 0;' \
            | pnpm --filter @tirapro/api exec prisma db execute --stdin --schema prisma/schema.prisma
```
  (`psql` có sẵn trên `ubuntu-latest`.) Không đụng job `check`.
- [ ] **Step 4:** Kiểm cú pháp: `pnpm dlx actionlint .github/workflows/ci.yml` (hoặc `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`) → không lỗi. Cổng thật: PR mở lên hai job `db (16)`, `db (18)` xanh.
- [ ] **Step 5: Commit:** `CI: thêm job Postgres (pgvector 16/18) chạy migrate deploy, migrate diff --exit-code và db:raw hai lần`

**Rủi ro/đụng chạm:** chỉ `ci.yml` (T5 cũng thêm một bước vào job `check` → sửa khác khu vực, xung đột thấp). Nếu migration tương lai tạo extension cần quyền superuser — user `POSTGRES_USER` của container là superuser nên ổn. Cần ghi release note ngắn: "PR phải có migration kèm mọi thay đổi schema.prisma".

---

### Task T3: Đổi tên module `dev` → `dev-links`, cấu hình `knip`, dựng `HEALTH_PATHS` từ config

**Mục tiêu:** (a) thư mục/lớp module tích hợp GitHub/GitLab tên `dev-links`, REST path GIỮ NGUYÊN (`/dev/repositories`, `/dev/webhook/:repositoryId`, `/issues/:issueId/dev-links`) nên client/webhook đã cấu hình không gãy; (b) `pnpm knip` chạy với cấu hình rõ ràng, thoát 0; (c) log bỏ qua đúng đường dẫn health dù `API_GLOBAL_PREFIX`/`API_VERSION` đổi.

**Hiện trạng:**
- `apps/api/src/modules/dev/` = `dev.module.ts` (header comment dòng 1-2 ghi "Việc cần làm sau: đổi tên thư mục thành `dev-links`"), `dev.controller.ts` (`DevController`, `@ApiTags('dev')`, route `dev/repositories`, `dev/webhook/:repositoryId`, `issues/:issueId/dev-links`), `dev.service.ts` (`DevService`, 483 dòng), `webhook-signature.ts` + `.spec.ts`. Chỉ `apps/api/src/app.module.ts:43,155` import `DevModule`; `rbac-coverage.spec.ts:21` quét theo đuôi `*.controller.ts` nên đổi tên file vẫn được quét. Web gọi `/dev/repositories` (`features/integrations/api.ts:159-177`) và `/issues/${id}/dev-links` (`features/issues/api.ts:26`), `RepositorySection.tsx:241,245` hiển thị `/api/v1/dev/webhook/${repo.id}` — KHÔNG đổi. `docs/MASTER_PLAN.md:1167` ghi việc treo này.
- `apps/api/src/app.module.ts:73` `const HEALTH_PATHS = new Set(['/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready']);` dùng ở dòng 103 `autoLogging.ignore`. Prefix thật đến từ `configuration.ts:13-14` (`api.globalPrefix`, `api.version`; env `API_GLOBAL_PREFIX=api`, `API_VERSION=v1`) và `main.ts:27-29` `setGlobalPrefix(`${globalPrefix}/${version}`)` — nên đổi env là log health lại ồn ào.
- `knip` đã là devDependency (`package.json:44`, script `"knip": "knip"`) nhưng KHÔNG có file cấu hình; chạy zero-config thoát 1 vì: 3 file "unused" (`apps/api/scripts/e2e.mjs`, `apps/web/scripts/gen-pwa-icons.mjs` — script chạy tay; `apps/web/src/features/ai/AiIssuePanel.tsx` — không file nào import), 3 devDependency "unused" (`@nestjs/testing`, `pino-pretty` — được tham chiếu bằng chuỗi `transport.target`, `vitest` ở root), 76 export + 35 type "unused".

**Files:**
- Rename (dùng `git mv`): `apps/api/src/modules/dev` → `apps/api/src/modules/dev-links`; `dev.module.ts` → `dev-links.module.ts`; `dev.controller.ts` → `dev-links.controller.ts`; `dev.service.ts` → `dev-links.service.ts`.
- Modify: `apps/api/src/app.module.ts:43,73,103,155` — import `DevLinksModule`, bỏ `HEALTH_PATHS`, dựng từ config.
- Modify: `apps/api/src/main.ts:71` (tuỳ chọn, 1 dòng) — chuỗi swagger `GET /api/v1/help` dựng từ `${globalPrefix}/${version}`.
- Modify: `docs/MASTER_PLAN.md:1167` — đánh dấu đã đổi tên (module `dev-links`, REST path vẫn `/dev/...`).
- Create: `apps/api/src/common/health-paths.ts` — `buildHealthPaths`, `isHealthPath`.
- Create: `knip.jsonc` (gốc repo).
- Test: Create `apps/api/src/common/health-paths.spec.ts`; Create `apps/api/src/modules/dev-links/dev-links.controller.spec.ts` (khoá route REST không đổi).

**Interfaces:** Produces: `DevLinksModule`, `DevLinksController`, `DevLinksService` (cùng method như `DevService`; `exports: [DevLinksService]`), `buildHealthPaths(globalPrefix: string, version: string): Set<string>`, `isHealthPath(url: string | undefined, paths: ReadonlySet<string>): boolean`. Consumes: `ConfigService` keys `api.globalPrefix`, `api.version` (đã có).

**Quyết định thiết kế:**
- Route REST và `@ApiTags('dev')` giữ nguyên (spec nói rõ không phá client; webhook URL đã dán vào GitHub/GitLab). Chỉ đổi tên module/thư mục/file/lớp; field `private readonly dev` đổi thành `devLinks`.
- Khoảng tên Prisma `DevLinkType`/`DevLinkState` KHÔNG đụng (là enum DB).
- `buildHealthPaths` tách ra file riêng để test thuần (không dựng cả `AppModule`); cắt `/` thừa ở prefix/version giống cách `main.ts` ghép.
- knip: dùng `knip.jsonc` (cho phép comment giải thích) theo workspace; `rules: { exports: 'warn', types: 'warn' }` → vẫn in 111 mục nhưng **exit code 0** (CLAUDE.md quy định knip "chỉ báo cáo"); file script chạy tay vào `entry`; `pino-pretty`, `@nestjs/testing`, root `vitest` vào `ignoreDependencies` kèm lý do; `AiIssuePanel.tsx` vào `ignore` (chưa chắc là rác — có thể nhóm W/AI sắp nối vào UI; xoá là việc khác, ghi chú trong cấu hình). Không xoá dependency/lockfile.
- Không đổi `apps/api/prisma/*` hay migration.

- [ ] **Step 1: Viết test fail**

`apps/api/src/common/health-paths.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildHealthPaths, isHealthPath } from './health-paths';

describe('buildHealthPaths / isHealthPath', () => {
  it('mặc định api/v1 → đúng ba đường probe', () => {
    expect([...buildHealthPaths('api', 'v1')].sort()).toEqual(['/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready']);
  });
  it('đổi prefix/version theo config', () => {
    const p = buildHealthPaths('svc', 'v2');
    expect(isHealthPath('/svc/v2/health/live', p)).toBe(true);
    expect(isHealthPath('/api/v1/health/live', p)).toBe(false);
  });
  it('bỏ query string, chịu được / thừa ở prefix', () => {
    const p = buildHealthPaths('/api/', '/v1/');
    expect(isHealthPath('/api/v1/health/ready?probe=1', p)).toBe(true);
  });
  it('khớp chính xác: health/version, health/announcement, healthz không bị bỏ qua', () => {
    const p = buildHealthPaths('api', 'v1');
    for (const u of ['/api/v1/health/version', '/api/v1/health/announcement', '/api/v1/healthz', undefined]) {
      expect(isHealthPath(u, p)).toBe(false);
    }
  });
});
```
`apps/api/src/modules/dev-links/dev-links.controller.spec.ts`:
```ts
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DevLinksController } from './dev-links.controller';

const route = (fn: unknown) => [Reflect.getMetadata(METHOD_METADATA, fn as object) as RequestMethod, Reflect.getMetadata(PATH_METADATA, fn as object) as string];

describe('DevLinksController — route REST giữ nguyên sau khi đổi tên module', () => {
  const p = DevLinksController.prototype;
  it.each([
    ['createRepository', RequestMethod.POST, 'dev/repositories'],
    ['listRepositories', RequestMethod.GET, 'dev/repositories'],
    ['removeRepository', RequestMethod.DELETE, 'dev/repositories/:id'],
    ['listIssueDevLinks', RequestMethod.GET, 'issues/:issueId/dev-links'],
    ['webhook', RequestMethod.POST, 'dev/webhook/:repositoryId'],
  ])('%s → %s /%s', (name, method, path) => {
    expect(route(p[name as keyof typeof p])).toEqual([method, path]);
  });
});
```
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/common/health-paths.spec.ts src/modules/dev-links` → kỳ vọng **FAIL** (không tìm thấy module `./health-paths`, `./dev-links.controller`).
- [ ] **Step 3: Implementation**
  1. Đổi tên:
  ```bash
  cd /Users/inrnee/tirapro/apps/api/src/modules
  git mv dev dev-links && cd dev-links
  git mv dev.module.ts dev-links.module.ts && git mv dev.controller.ts dev-links.controller.ts && git mv dev.service.ts dev-links.service.ts
  sed -i '' -E 's/\bDevModule\b/DevLinksModule/g; s/\bDevController\b/DevLinksController/g; s/\bDevService\b/DevLinksService/g; s#\./dev\.(module|controller|service)#./dev-links.\1#g' dev-links.module.ts dev-links.controller.ts dev-links.service.ts
  sed -i '' -E 's/private readonly dev: /private readonly devLinks: /; s/this\.dev\./this.devLinks./g' dev-links.controller.ts
  sed -i '' -E "s#modules/dev/dev\.module#modules/dev-links/dev-links.module#; s/\bDevModule\b/DevLinksModule/g" ../../app.module.ts
  ```
  Xoá dòng 1-2 comment cũ trong `dev-links.module.ts` và thay bằng: `// Module `dev-links` = tích hợp GitHub/GitLab (repository, webhook, link commit/PR vào issue). REST path `/dev/...` giữ nguyên để không phá client/webhook.` Rà `grep -rn "DevService\|DevModule\|DevController\|modules/dev/" apps docs/MASTER_PLAN.md` còn 0 chỗ (ngoài lịch sử trong `docs/superpowers/plans/*`, giữ nguyên).
  2. `apps/api/src/common/health-paths.ts`:
  ```ts
  const trim = (s: string) => s.replace(/^\/+|\/+$/g, '');

  /** Đường probe sức khoẻ (khớp CHÍNH XÁC theo pathname), dựng từ cùng prefix/version mà `main.ts` dùng cho setGlobalPrefix. */
  export function buildHealthPaths(globalPrefix: string, version: string): Set<string> {
    const base = '/' + [trim(globalPrefix), trim(version), 'health'].filter(Boolean).join('/');
    return new Set([base, `${base}/live`, `${base}/ready`]);
  }

  export function isHealthPath(url: string | undefined, paths: ReadonlySet<string>): boolean {
    return paths.has((url ?? '').split('?')[0] ?? '');
  }
  ```
  3. `app.module.ts`: xoá dòng 72-73 (`HEALTH_PATHS`), import `{ buildHealthPaths, isHealthPath } from './common/health-paths'`; trong `useFactory` (hiện có `config`) thêm đầu hàm
  `const healthPaths = buildHealthPaths(config.get<string>('api.globalPrefix') ?? 'api', config.get<string>('api.version') ?? 'v1');`
  và đổi `autoLogging: { ignore: (req) => isHealthPath(req.url, healthPaths) }`.
  4. `main.ts:71`: chuỗi `'Tổng quan nhanh: `GET /api/v1/help`.'` → template dùng `${globalPrefix}/${version}` (biến đã có dòng 26-27, phải khai báo trước `DocumentBuilder` — đã đúng thứ tự).
  5. `knip.jsonc`:
  ```jsonc
  {
    "$schema": "https://unpkg.com/knip@6/schema.json",
    // Export/type "thừa" chỉ báo cáo (warn) — CLAUDE.md: knip chỉ liệt kê, xoá phải grep -r xác nhận 0 import.
    // File chưa dùng và dependency thừa là lỗi (exit 1) để không tích thêm rác.
    "rules": { "exports": "warn", "types": "warn" },
    "workspaces": {
      ".": { "ignoreDependencies": ["vitest"] }, // vitest cài ở từng workspace; bản gốc để IDE/npx nhận cùng phiên bản
      "apps/api": {
        "entry": ["src/main.ts", "prisma/seed.ts", "prisma/*.mjs", "scripts/*.mjs"],
        "project": ["src/**/*.ts", "prisma/**/*.{ts,mjs}", "scripts/**/*.mjs"],
        "ignoreDependencies": ["pino-pretty", "@nestjs/testing"] // pino-pretty nạp bằng chuỗi transport.target; @nestjs/testing dành cho spec DI tương lai
      },
      "apps/web": {
        "entry": ["scripts/*.mjs"],
        "ignore": ["src/features/ai/AiIssuePanel.tsx"] // chưa nối vào UI; xoá hay nối là quyết định riêng
      },
      "apps/mcp": { "entry": ["src/index.ts"], "project": ["src/**/*.ts"] },
      "packages/*": {}
    }
  }
  ```
  6. `docs/MASTER_PLAN.md:1167`: đổi đoạn "Việc dọn dẹp còn treo" thành "Đã đổi tên module `dev` → `dev-links` (REST path `/dev/...` giữ nguyên)".
- [ ] **Step 4:**
```bash
cd /Users/inrnee/tirapro
pnpm --filter @tirapro/api exec vitest run src/common/health-paths.spec.ts src/modules/dev-links   # PASS (kèm webhook-signature.spec 8 test)
pnpm --filter @tirapro/api test                  # rbac-coverage + soft-delete-coverage vẫn pass (quét *.controller.ts)
pnpm -r typecheck && pnpm lint
pnpm knip; echo "exit=$?"                       # kỳ vọng exit=0, không có dòng "Configuration hints" báo lỗi cấu hình
```
  Nếu knip in "Configuration hints" (pattern ignore/entry thừa) thì xoá mục đó cho sạch. Kiểm tay: khởi động API (`pnpm --filter @tirapro/api dev`), `curl localhost:4000/api/v1/dev/repositories` (không token) → 401 chứ không 404.
- [ ] **Step 5: Commit** (nên tách 3 commit): `API: đổi tên module dev thành dev-links (giữ nguyên route REST /dev/...)`; `API: dựng đường probe health từ API_GLOBAL_PREFIX/API_VERSION thay vì hardcode /api/v1`; `Tooling: thêm knip.jsonc theo workspace, pnpm knip thoát 0`.

**Rủi ro/đụng chạm:** `app.module.ts` (T3 duy nhất trong nhóm; nhóm khác có thể thêm module → xung đột import danh sách, dễ gộp); đổi tên thư mục xung đột với bất kỳ task nào đang sửa `modules/dev/*` (không thấy trong nhóm T; `review-fixes` đã merge). `knip.jsonc` sẽ bị T1/T4 làm số export "unused" đổi nhưng chỉ warn. Không migration. Không đổi hành vi API → không release note, chỉ ghi "log health theo config".

---

### Task T4: Tách `RankService` và WIP helper khỏi `issues.service.ts` (không đổi hành vi)

**Mục tiêu:** `IssuesService` ngắn lại (843 → ~700 dòng) bằng cách chuyển phần tính rank/rebalance và phần giới hạn WIP sang hai service riêng; mọi API/hành vi/event giữ nguyên, spec hiện có pass nguyên vẹn không sửa.

**Hiện trạng:** `apps/api/src/modules/issues/issues.service.ts` (843 dòng, HEAD `22c116c`) chứa:
- Rank: `rankOf` (:719-724), `resolveRank` (:729-752), `rebalanceProject` (:759-792, chứa `// allow-deleted:` ngay trên `tx.issue.findMany` — `soft-delete-coverage.spec` đọc đúng dòng trước lời gọi). Gọi tại `createCore` :201, `move` :529-532.
- WIP: interface `WipColumn` (:39-46), `resolveWipColumn` (:586-607), `enforceWip` (:609-635), `assertCanForceWip` (:637-644). Gọi tại `bulkUpdate` :435/:447, `transition` :506/:509, `move` :536/:540.
- Constructor `(prisma, events, rbac)` (:73-77) và `issues.service.spec.ts:33-38` `makeService` khởi tạo `new IssuesService(prisma, events, rbac)` bằng 3 đối số, nên ba đối số này KHÔNG được đổi.
- `issues.module.ts`: `providers: [IssuesService]`. Chỉ `search/intake/boards/worklogs/automation` inject `IssuesService` (không ai gọi các hàm private).

**⚠ Task này chạy SAU S3 (sửa `move()`), C2 (sửa rebalance / stale neighbor), C3 (sửa `bulkUpdate`).** Số dòng trên sẽ lệch; người làm áp theo TÊN HÀM / RANH GIỚI dưới đây lên code đã merge, không theo số dòng.

**Ranh giới tách (theo tên hàm):**
| Sang `RankService` (`rank.service.ts`) | Sang `WipService` (`wip.service.ts`) | Ở LẠI `IssuesService` |
|---|---|---|
| `rankOf`, `resolveRank`, `rebalanceProject` và MỌI helper rank mới C2 thêm (vd. đọc lại mốc/neighbor, kiểm stale) | interface `WipColumn`, `resolveWipColumn`, `enforceWip`, `assertCanForceWip` và helper WIP mới nếu có | toàn bộ method công khai, `requireIssue`, `updateWithVersion`, `assertVersion`, `recordStatusChange/recordChanges`, `toDto`, kiểm quyền `assertCan*`, `assertMetaInWorkspace`, `assertNoParentCycle`, workflow helper; phần ghép transaction + phát event (gồm `ISSUE_MOVED`) của `move()` |
| Phụ thuộc: `PrismaService`, `EventEmitter2` | Phụ thuộc: `PrismaService`, `RbacService` | |
| Import mang theo: `rankBetween`, `initialRanks`, `RankGapError`, `DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED`, `AppException`, `ERROR_CODES`, `HttpStatus`, `BusinessRuleException` | Import mang theo: `PERMISSIONS`, `WipLimitReachedException`, `ForbiddenAppException`, `Prisma` (type) | `BusinessRuleException`, `ForbiddenAppException`, `PERMISSIONS`, `DOMAIN_EVENTS` vẫn dùng ở IssuesService (giữ import) |

Sau khi tách, import không còn dùng ở `issues.service.ts` (xoá, lint `no-unused-vars` bắt): `HttpStatus`, `ERROR_CODES`, `AppException`, `WipLimitReachedException`, `rankBetween`, `initialRanks`, `RankGapError` (kiểm bằng `grep -n "\b<tên>\b"` sau khi chuyển; nếu S3/C2/C3 dùng thêm chỗ khác thì giữ).

**Files:**
- Create: `apps/api/src/modules/issues/rank.service.ts` — `@Injectable() RankService`.
- Create: `apps/api/src/modules/issues/wip.service.ts` — `@Injectable() WipService` + `export interface WipColumn`.
- Modify: `apps/api/src/modules/issues/issues.service.ts` — xoá các hàm đã chuyển, thêm hai field, đổi call-site.
- Modify: `apps/api/src/modules/issues/issues.module.ts` — `providers: [IssuesService, RankService, WipService]`.
- Test: Create `apps/api/src/modules/issues/rank.service.spec.ts` (mới); `issues.service.spec.ts` KHÔNG sửa (là bằng chứng không đổi hành vi). Tuỳ chọn `wip.service.spec.ts` (một test `resolveWipColumn` không boardId → null, không chạm DB).

**Interfaces:**
- Produces `RankService`: `rankOf(workspaceId: string, projectId: string, id: string): Promise<string>`; `resolveRank(projectId: string, db: Prisma.TransactionClient, deferred: Array<() => void> | null, movedId: string | null, read: () => Promise<{ prev: string | null; next: string | null }>): Promise<string>`; `rebalanceProject` giữ `private`. Chữ ký giữ đúng như code sau S3/C2 (nếu C2 đã đổi chữ ký thì dùng chữ ký đó).
- Produces `WipService`: `resolveWipColumn(boardId: string | undefined, projectId: string, toStatusId: string, fromStatusId?: string): Promise<WipColumn | null>`; `enforceWip(tx: Prisma.TransactionClient, wip: WipColumn, ctx: { userId; workspaceId; projectId; incoming: number; force?: boolean }): Promise<void>`; `assertCanForceWip` giữ `private`.
- Consumes: không đổi event/error code nào (`PROJECT_RANKS_REBALANCED`, `WIP_LIMIT_REACHED`).

**Quyết định thiết kế:**
- Spec hiện tại khởi tạo `new IssuesService(prisma, events, rbac)` → thêm hai tham số THỨ 4 và 5 có giá trị mặc định: `private readonly rankService: RankService = new RankService(prisma, events)`, `private readonly wipService: WipService = new WipService(prisma, rbac)`. Nest DI vẫn tiêm bản thật (design:paramtypes theo kiểu khai báo); spec cũ nhận bản mặc định dựng từ CÙNG `prisma/events/rbac` nên so sánh `db === this.prisma` trong `rebalanceProject` vẫn đúng. Đặt tên field `rankService`/`wipService` để không trùng biến cục bộ `rank`/`wip` trong `move()`.
- Chuyển NGUYÊN VĂN thân hàm (kể cả comment tiếng Việt và dòng `// allow-deleted:` ngay trên `findMany`); chỉ đổi `this.prisma/this.events/this.rbac` giữ nguyên tên field vì constructor của service mới dùng đúng tên đó.
- Không tách `WIP` thành "helper tĩnh" vì `enforceWip` cần `rbac` + `prisma`; service Injectable đơn giản nhất.
- Không đổi tên/ chữ ký các hàm công khai của `IssuesService`; không động `bulkUpdate`/`move`/`transition` ngoài việc đổi `this.x(` thành `this.rankService.x(`/`this.wipService.x(`.
- Nếu muốn nhỏ hơn nữa (`createCore` ~115 dòng, `bulkUpdate`) → ngoài phạm vi, để lại.

- [ ] **Step 1: Viết test fail** — `apps/api/src/modules/issues/rank.service.spec.ts` (đặc tả hành vi đã có ở `issues.service.spec.ts:38-125`, nay chạy riêng trên `RankService`):
```ts
import { describe, expect, it, vi } from 'vitest';
import { RankService } from './rank.service';

function make(txOverrides: Record<string, unknown> = {}) {
  const tx = {
    project: { update: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    issue: { findMany: vi.fn(() => Promise.resolve([{ id: 'a' }, { id: 'm' }, { id: 'b' }])), findFirst: vi.fn() },
    $executeRaw: vi.fn(() => Promise.resolve(3)),
    ...txOverrides,
  };
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx };
  const events = { emit: vi.fn() };
  return { svc: new RankService(prisma as never, events as never), tx, prisma, events };
}

describe('RankService.resolveRank', () => {
  it('còn chỗ chèn => tính 1 lần, không rebalance', async () => {
    const { svc, tx, events } = make();
    const read = vi.fn(() => Promise.resolve({ prev: 'a', next: 'z' }));
    const rank = await svc.resolveRank('p1', tx as never, null, null, read);
    expect(rank > 'a' && rank < 'z').toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('hai mốc đảo ngược (RankGapError) => đúng 1 câu UPDATE cho cả project, đọc lại mốc, phát PROJECT_RANKS_REBALANCED', async () => {
    const { svc, prisma, tx, events } = make();
    let rebalanced = false;
    tx.project.update.mockImplementation(() => { rebalanced = true; return Promise.resolve({ id: 'p1' }); });
    const read = vi.fn(() => Promise.resolve(rebalanced ? { prev: 'i', next: 'r' } : { prev: 'n', next: 'i' }));
    const rank = await svc.resolveRank('p1', prisma as never, null, 'm', read);
    expect(rank > 'i' && rank < 'r').toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('project.ranks_rebalanced', { projectId: 'p1' });
  });

  it('trong transaction của bên gọi: sự kiện chạy qua `deferred`, chưa phát ngay', async () => {
    const { svc, tx, events } = make();
    let n = 0;
    const read = vi.fn(() => Promise.resolve(n++ === 0 ? { prev: 'n', next: 'i' } : { prev: 'i', next: 'r' }));
    const deferred: Array<() => void> = [];
    await svc.resolveRank('p1', tx as never, deferred, null, read);
    expect(events.emit).not.toHaveBeenCalled();
    deferred.forEach((f) => f());
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('sau rebalance vẫn hết chỗ => BusinessRuleException, không lặp vô hạn', async () => {
    const { svc, tx } = make();
    const read = vi.fn(() => Promise.resolve({ prev: 'n', next: 'i' }));
    await expect(svc.resolveRank('p1', tx as never, null, null, read)).rejects.toThrow(/tải lại trang/);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('RankService.rankOf', () => {
  it('mốc không tồn tại => 404', async () => {
    const { svc, tx } = make();
    (tx.issue.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(svc.rankOf('w1', 'p1', 'x')).rejects.toMatchObject({ status: 404 });
  });
});
```
  (Sau S3/C2 điều chỉnh chữ ký/ hành vi nếu đã đổi; mục đích là test thuần RankService, không phụ thuộc IssuesService.)
- [ ] **Step 2:** `pnpm --filter @tirapro/api exec vitest run src/modules/issues/rank.service.spec.ts` → kỳ vọng **FAIL** (không có `./rank.service`). Đồng thời chạy baseline `pnpm --filter @tirapro/api exec vitest run src/modules/issues src/infra src/rbac-coverage.spec.ts` → PASS (ghi số test để so sánh).
- [ ] **Step 3: Implementation**
  1. Tạo `rank.service.ts`:
  ```ts
  import { HttpStatus, Injectable } from '@nestjs/common';
  import { EventEmitter2 } from '@nestjs/event-emitter';
  import { Prisma } from '@prisma/client';
  import { DOMAIN_EVENTS, ERROR_CODES } from '@tirapro/types';
  import { initialRanks, rankBetween, RankGapError } from '@tirapro/shared';
  import { PrismaService } from '../../infra/prisma/prisma.service';
  import { AppException, BusinessRuleException } from '../../common/exceptions/app.exception';

  /** Tính rank (LexoRank) cho issue và đánh số lại cả project khi hết chỗ chèn. Tách từ IssuesService, không đổi hành vi. */
  @Injectable()
  export class RankService {
    constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}
    // rankOf, resolveRank, rebalanceProject: DÁN NGUYÊN VĂN từ issues.service.ts (kể cả JSDoc và dòng `// allow-deleted:` ngay trên tx.issue.findMany)
  }
  ```
  `rankOf` và `resolveRank` đổi `private` → công khai; `rebalanceProject` giữ `private`.
  2. Tạo `wip.service.ts` tương tự: `export interface WipColumn {...}` (chuyển từ :39-46), `@Injectable() WipService` với `constructor(private readonly prisma: PrismaService, private readonly rbac: RbacService)`, dán nguyên văn `resolveWipColumn`, `enforceWip` (công khai) và `assertCanForceWip` (private). Import `Prisma`, `PERMISSIONS`, `ForbiddenAppException`, `WipLimitReachedException`, `RbacService`.
  3. `issues.service.ts`: xoá phần đã chuyển + `WipColumn`; constructor:
  ```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly rbac: RbacService,
    private readonly rankService: RankService = new RankService(prisma, events),
    private readonly wipService: WipService = new WipService(prisma, rbac),
  ) {}
  ```
  Đổi call-site cơ học:
  ```bash
  sed -i '' -E 's/this\.resolveRank\(/this.rankService.resolveRank(/g; s/this\.rankOf\(/this.rankService.rankOf(/g; s/this\.resolveWipColumn\(/this.wipService.resolveWipColumn(/g; s/this\.enforceWip\(/this.wipService.enforceWip(/g' apps/api/src/modules/issues/issues.service.ts
  ```
  Thêm import `RankService`, `WipService`; dọn import thừa (xem bảng). `issues.module.ts`: `providers: [IssuesService, RankService, WipService]`.
  4. Chứng minh "dán nguyên văn": trước khi xoá, lưu thân hàm gốc (`sed -n 'a,bp'`) và `diff` với thân trong file mới sau khi bỏ `private/async` khác biệt chữ ký — chỉ được lệch ở từ khoá truy cập.
- [ ] **Step 4:**
```bash
pnpm --filter @tirapro/api exec vitest run src/modules/issues src/infra src/rbac-coverage.spec.ts   # PASS, số test = baseline + 5 test mới; issues.service.spec.ts không bị sửa (git diff --stat chứng minh)
pnpm --filter @tirapro/api test
pnpm --filter @tirapro/api typecheck && pnpm lint
wc -l apps/api/src/modules/issues/issues.service.ts            # giảm ~140 dòng so với trước khi tách
```
  Kiểm tay DI: `pnpm --filter @tirapro/api build` rồi khởi động API, `GET /api/v1/health/ready` ok (Nest dựng được `IssuesService` với cả 5 tham số); kéo một thẻ trên board và đổi trạng thái vào cột WIP (đường `move`) vẫn đúng.
- [ ] **Step 5: Commit:** `API: tách RankService và WipService khỏi IssuesService (không đổi hành vi)`

**Rủi ro/đụng chạm:** `issues.service.ts` bị S3 (`move`), C2 (rank/rebalance), C3 (`bulkUpdate`), và có thể các nhóm khác — T4 PHẢI chạy sau cùng trong nhóm API; nếu C2 đã tạo `rank.service.ts` hoặc đổi chữ ký `resolveRank`, dùng bản của C2 và bỏ phần tạo mới trùng. `issues.module.ts` (thêm 2 provider). Spec `issues.service.spec.ts` vẫn dùng 3 tham số nhờ giá trị mặc định — nếu S3/C2/C3 đã đổi `makeService` thì giữ nguyên cách khởi tạo của họ miễn là không truyền 4-5 đối số. Không migration, không đổi hành vi → không release note.

---

### Task T5: Một commit `prettier --write` toàn repo + siết kiểm tra format (CUỐI CÙNG toàn plan)

**Mục tiêu:** Toàn bộ mã nguồn đạt chuẩn Prettier trong đúng một commit cơ học; từ đó CI chặn code chưa format và lint-staged không bao giờ để lọt, mà không chặn người dùng vì cảnh báo ESLint tồn đọng.

**Hiện trạng:** `pnpm exec prettier --check .` → **432 file** không đạt (follow-up ghi 265+ là số cũ): apps/web 214, apps/api 198, packages/shared 10, packages/types 3, apps/mcp 1, còn lại là cấu hình/md ở gốc (`render.yaml`, `pnpm-workspace.yaml`, `docker-compose.yml`, `DESIGN.md`, `CLAUDE.md`) và 1 file trong `.superpowers/sdd`. Theo đuôi: 271 `.ts`, 149 `.tsx`, 4 `.mjs`, 3 `.md`, 2 `.yaml`, 1 `.yml`, 1 `.json`, 1 `.html`. `pnpm format:check` (glob `**/*.{ts,tsx,js,jsx,json,md,yml,yaml}`) đếm 427 — hai lệnh không cùng phạm vi. `.prettierrc.json`: printWidth 100, singleQuote, trailingComma all. `.prettierignore` đã loại `node_modules`, `dist`, `build`, `coverage`, `.turbo`, `pnpm-lock.yaml`, `apps/api/prisma/migrations`, `docs`. Lint-staged ở `package.json:60-69`:
```json
"*.{ts,tsx}": ["eslint --fix", "prettier --write"],
"*.{js,jsx,json,md,yml,yaml}": ["prettier --write"]
```
Hook `.husky/pre-commit` = `pnpm lint-staged`. ESLint ở lint-staged KHÔNG có `--max-warnings` (nên cảnh báo hiện tại không chặn commit); `pnpm lint` ở CI mới có ratchet (`package.json:15`). CI (`ci.yml`) chưa chạy `format:check`. Hai ràng buộc có thể vỡ khi reflow:
- `apps/api/src/infra/prisma/soft-delete-coverage.spec.ts` đòi comment `// allow-deleted:` nằm ĐÚNG DÒNG TRƯỚC dòng bắt đầu lời gọi `findMany/findFirst/count…` — Prettier có thể ngắt `const x =\n  await tx.issue.findMany(...)` làm comment lệch dòng.
- `max-lines-per-function` đếm dòng — Prettier ngắt dòng dài (>100 ký tự) nên số hàm vượt 150 dòng có thể tăng → số cảnh báo ESLint tăng.

**Files:**
- Modify (toàn bộ file mã): kết quả của `prettier --write` — một commit riêng, không lẫn thay đổi logic.
- Modify: `.prettierignore` — thêm `.superpowers`, `.claude`, `.codex` (tài liệu/plan/hook của công cụ, không phải mã sản phẩm), giữ nguyên các mục cũ.
- Modify: `package.json` — script `format` → `prettier --write .`, `format:check` → `prettier --check .` (cùng phạm vi lệnh đếm); `lint` `--max-warnings` về số đo sau khi format (nếu tăng, xem Rủi ro); `lint-staged` giữ cấu trúc, xem Quyết định.
- Modify: `.github/workflows/ci.yml` — job `check` thêm `- run: pnpm format:check` (sau `pnpm lint`).
- Create: `.git-blame-ignore-revs` — hash của commit format (commit thứ hai).
- Modify: `CLAUDE.md` (mục Lệnh) — thêm `pnpm format` / `pnpm format:check`; `docs/superpowers/plans/lint-debt.md` ghi số mới.
- Test: không có spec mới; bằng chứng = `pnpm format:check` exit 0 + toàn bộ gate xanh.

**Interfaces:** Produces: cổng CI `format:check`. Không đổi API/kiểu.

**Quyết định thiết kế:**
- `--max-warnings 0` KHÔNG bật cho ESLint trong lint-staged lúc này: ESLint còn khoảng 60-100 cảnh báo nền (`max-lines-per-function` 42, `exhaustive-deps` 3, …); `eslint --max-warnings 0` trên file staged sẽ chặn mọi commit đụng vào file có cảnh báo cũ — vô lý với người dùng. Lint-staged ESLint giữ nguyên (lỗi chặn, cảnh báo không), ngưỡng cảnh báo do ratchet ở `pnpm lint`/CI quản. Khi ratchet về 0 (xem `lint-debt.md:4-6`) mới đổi thành `--max-warnings 0` ở lint-staged và `apps/*` lint.
- "Chặt hoá" thực tế cho format: Prettier không có `max-warnings`; thay bằng (1) `prettier --write` trong lint-staged (đã có, tự sửa file staged), (2) `pnpm format:check` bắt buộc ở CI để `--no-verify` cũng không lọt.
- Phạm vi dùng `prettier --write .` (tôn trọng `.prettierignore` và `.gitignore`), không glob đuôi riêng, để số đếm của lệnh kiểm = số của lệnh ghi. `docs/` giữ trong ignore (không format hàng loạt tài liệu).
- Thêm `.git-blame-ignore-revs` (commit thứ hai) và hướng dẫn `git config blame.ignoreRevsFile .git-blame-ignore-revs` trong `CLAUDE.md`.
- Task là CUỐI CÙNG toàn plan để không gây xung đột với mọi task khác (432 file đổi).

- [ ] **Step 1: "Test fail" = cổng kiểm format.** Đo cơ sở và thêm cổng trước khi sửa:
```bash
cd /Users/inrnee/tirapro
git status --short | head        # phải sạch (mọi task khác đã merge)
pnpm exec prettier --check . | tail -2     # hôm nay: 432 file
```
  Sửa `.prettierignore` (+`.superpowers`, `.claude`, `.codex`) và hai script `format`, `format:check` trong `package.json`; thêm bước `pnpm format:check` vào `ci.yml`.
- [ ] **Step 2:** `pnpm format:check` → kỳ vọng **FAIL** (`Code style issues found in ~430 files`), exit 1.
- [ ] **Step 3: Implementation**
  1. Chốt baseline hành vi trước khi format: `pnpm -r typecheck && pnpm lint && pnpm test` (ghi số warning `W0` và số test).
  2. `pnpm exec prettier --write .` (mã nguồn, một lần).
  3. Chạy ngay:
  ```bash
  pnpm --filter @tirapro/api exec vitest run src/infra/prisma/soft-delete-coverage.spec.ts src/rbac-coverage.spec.ts
  ```
  Nếu `soft-delete-coverage` báo vi phạm: mở từng chỗ được báo, chuyển dòng `// allow-deleted: <lý do>` xuống NGAY DÒNG TRƯỚC dòng chứa `<model>.findMany(`/`findFirst(`/`count(` (ví dụ Prettier đổi `const rows = await tx.issue.findMany(...)` thành `const rows =` xuống dòng rồi `await tx.issue.findMany(...)` thì comment phải nằm trên dòng `await ...`). Chỉ sửa vị trí comment, không đổi logic.
  4. `pnpm exec eslint . -f json` đếm lại số cảnh báo `W1`. Nếu `W1 > ngưỡng hiện tại` (do reflow làm thêm hàm >150 dòng): đặt `--max-warnings W1` ở `package.json` trong commit format và ghi vào `lint-debt.md` ("tăng do Prettier ngắt dòng, không phải nợ mới"); nếu `W1` ≤ ngưỡng, hạ ngưỡng về `W1`.
  5. Commit 1 (xem Step 5). Sau đó lấy hash `git rev-parse HEAD`, tạo `.git-blame-ignore-revs` với dòng `# Prettier toàn repo (T5)` + hash, commit 2; thêm vào `CLAUDE.md` dòng hướng dẫn `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
  6. `lint-staged` không đổi cấu trúc; thêm `*.{css,html,mjs}` vào mảng thứ hai nếu muốn phủ các đuôi mới (`["prettier --write"]`).
- [ ] **Step 4:**
```bash
pnpm format:check                          # exit 0, "All matched files use Prettier code style!"
pnpm -r typecheck && pnpm lint && pnpm test
pnpm --filter @tirapro/web build
node scripts/gen-enums.mjs --check
pnpm --filter @tirapro/api exec prisma validate
git diff --stat HEAD~1 | tail -1           # ~430 file, chỉ khoảng trắng/ngắt dòng/dấu phẩy
git diff -w --ignore-blank-lines HEAD~1 -- apps packages | head   # rà nhanh: mọi thay đổi chỉ là định dạng
```
  Kiểm tay hook: sửa thử một file `.ts` đã format, `git add` + `git commit` thử (rồi huỷ) → lint-staged chạy xong, không bị chặn bởi cảnh báo cũ.
- [ ] **Step 5: Commit** — hai commit: (1) `Format: prettier --write toàn repo (432 file), thêm format:check vào CI và scripts format theo .prettierignore`; (2) `Thêm .git-blame-ignore-revs cho commit format`.

**Rủi ro/đụng chạm:** đụng gần như mọi file (432) — vì vậy phải là task cuối; mọi nhánh/PR đang mở của người khác sẽ xung đột → thông báo trong release note ("rebase sau commit format; chạy `git config blame.ignoreRevsFile .git-blame-ignore-revs`"). Rủi ro kỹ thuật cụ thể: `soft-delete-coverage.spec` (vị trí comment `allow-deleted`), `max-lines-per-function` tăng, `index.html`/`render.yaml`/`docker-compose.yml` bị reformat (kiểm tra `render.yaml` và `docker-compose.yml` vẫn parse: `docker compose config -q`, `python3 -c "import yaml;yaml.safe_load(open('render.yaml'))"`). `package.json` bị T1 (ngưỡng lint) và T5 cùng sửa → làm tuần tự T1 trước T5. `ci.yml` bị T2 và T5 sửa ở hai chỗ khác nhau.

---

#### Bảng đụng chạm

| File | Task trong nhóm | Thứ tự nên làm |
|---|---|---|
| `package.json` (root) | T1 (`--max-warnings`), T5 (scripts format, `--max-warnings` sau format) | T1 → T5 |
| `.github/workflows/ci.yml` | T2 (job `db`), T5 (bước `format:check` ở job `check`) | T2 → T5 |
| `docs/superpowers/plans/lint-debt.md` | T1, T5 | T1 → T5 |
| `docs/MASTER_PLAN.md` | T3 (dòng 1167) | — |
| `apps/api/src/app.module.ts` | T3 (import đổi tên + health paths); T5 reformat | T3 → T5 |
| `apps/api/src/modules/issues/issues.service.ts` | T4 (cũng bị S3, C2, C3 ngoài nhóm); T5 reformat | S3/C2/C3 → T4 → T5 |
| `apps/api/src/modules/issues/issues.module.ts` | T4 | — |
| `apps/web/src/features/*/api.ts`, `stores/*`, `lib/api.ts` | T1 (gắn generic); nhóm W/S/C cũng thêm hook | nhóm khác → T1 |
| `apps/api/src/modules/dev/*` → `dev-links/*` | T3 (rename); T4/T1 không đụng | T3 sớm, khi không ai khác sửa |
| Mọi file mã | T5 (prettier) | CUỐI CÙNG |

Thứ tự toàn nhóm: **T2 → T3 → (nhóm khác) → T1 → T4 (sau S3/C2/C3) → T5 (cuối)**.

#### Ngoài phạm vi / không làm

- `issues.service.ts` hiện **843 dòng**, không phải "~1000" như follow-up (đã trừ cả `RankService` + WIP helper: mục tiêu ≈ 700). Không tách thêm `createCore`/`bulkUpdate` trong T4.
- "265+ file chưa đạt" đã lỗi thời: đo thật **432** (`pnpm exec prettier --check .`).
- `apps/api/package.json:11` có `"lint": "eslint \"src/**/*.ts\" --max-warnings 0"` — script cục bộ này KHÔNG được CI/gốc gọi (root `eslint .` mới là cổng), và nếu chạy riêng sẽ fail vì api còn cảnh báo (`max-lines-per-function` 2, spec/redis adapter). Không sửa trong T1; xử lý khi ratchet về 0.
- `pnpm knip` hôm nay đã chạy được không cần cấu hình (không có lỗi cấu hình, chỉ exit 1 vì có finding) — T3 thêm cấu hình để exit 0 chứ không phải để "sửa lỗi cấu hình".
- Không xoá 76 export + 35 type "unused" mà knip báo, cũng không xoá `AiIssuePanel.tsx`/`useSummarizeIssue`/`useSuggestIssue` (có thể nhóm AI/W sắp nối vào UI) — để ở mức `warn`/`ignore` trong `knip.jsonc`.
- Không bật `eslint --max-warnings 0` trong lint-staged ở T5 (xem Quyết định) — chỉ làm khi ratchet = 0.
- Không đổi route REST `/dev/*` hay `@ApiTags('dev')` trong T3.
