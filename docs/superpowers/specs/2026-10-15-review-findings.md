# Phát hiện từ đợt review 2026-10-15 (tóm tắt làm spec cho plan sửa)

Nguồn: review toàn bộ repo (4 lượt rà song song: backend, frontend, luồng chức năng, chất lượng code) + kiểm chứng tay.

## Đã kiểm chứng trực tiếp

- LexoRank (`packages/shared/src/lexorank.ts`): chuỗi "đưa lên đầu" `b > 5 > 2 > 1 > 0 > 0h` sai thứ tự ở bước 6; `rankBetween('n','n0')` = `n0h` > `n0`; 40 lần append → `zzzzzzy`, không rebalance.
- `PermissionsGuard` (`apps/api/src/modules/rbac/permissions.guard.ts:29-35`) lấy `projectId` từ params/body/query; `rbac.service.ts:66-69` tra project membership không kiểm project thuộc workspace → leo quyền chéo project/workspace.
- WS `onSubscribe` (`realtime.gateway.ts:52-56`) join bất kỳ room nào.
- `issues.service.ts`: OCC check-then-update; history ngoài transaction; `rankOf` không scope workspace.
- Search chỉ dùng `contains` (ILIKE); FTS/pgvector trong `01_pgvector_fts.sql` không có call site.
- `pnpm lint` gọi eslint không được cài; 0 test; không CI; husky không init; `pnpm setup` build `shared` trước `types`.

## Backend (từ lượt rà)

Tenant/authz: refresh rotation không atomic; refresh về workspace đầu tiên; JWT không kiểm membership mỗi request; webhook dev so secret bằng `!==`, không HMAC; khoá mã hoá có default + `encrypt()` trả plaintext khi thiếu; invite trả mật khẩu trong response, không tx; API key `argon2.verify` mỗi request; RBAC invalidate bằng `KEYS`; `ws(user)` copy 37 controller.
Hiệu năng: analytics load toàn bộ issue/history vào JS; sprint list include toàn bộ issue để sum; `issueInclude` fan-out full User; thiếu index `(projectId,sprintId,rank)`, `(workspaceId,assigneeId)`, `(workspaceId,dueDate)`; cron trong process API không lock; BullMQ/Redis adapter/pino/throttler Redis khai báo nhưng không wire; throttler không `trust proxy`; broadcast full DTO; gateway `cors: origin:true`.
Giao dịch: sprint start/complete 3 write không tx; sprint sequence đếm+1 không unique; import từng dòng không tx; `addWorkspaceMany` loop.
AI: quota không enforce/log; SDK 0.32; `modelFast` không dùng; không timeout; lỗi gộp thành null; summary không bọc delimiter.
Ops: không pino; ALS định nghĩa nhưng không `run()`; lỗi nội bộ lộ message; helmet CSP/CORP tắt; health không tách live/ready; shutdown không dừng cron.
Nhất quán: 15/49 controller không `@Permissions` (guard trả true); 3 body không validate; 24 `toDto/userDto` trùng; `SOFT_DELETE_MODELS`/`notDeleted()` không dùng; nhiều query thiếu `deletedAt: null`.

## Frontend (từ lượt rà)

Không ErrorBoundary; realtime = invalidate + refetch 200 issue mỗi event, chỉ board subscribe; optimistic 6/162 mutation; board & backlog fetch cùng list dưới 2 key; cap 200/100 không báo; `qk` factory chết, 77 key rời + 28 literal; invalidate quá rộng; 31 `?? ''`+`enabled`; bulk = N PATCH song song, undo đoán `version+1`; socket untyped, không teardown; 53 mutation không `onError`; 0 `memo`, không virtualization; detail mở ~15-20 query; `distribute()` mỗi render; `InstantTooltip` xoá `title`; 31 overlay tự viết + 32 `window.confirm`, không focus-trap, hotkey lọt; 13 file >500 dòng; RHF/zod/5 Radix/dnd-sortable khai báo không dùng; `driver.js` eager; `WorkflowViewDialog` kéo reactflow vào detail; shell >2 MiB; PWA không icon; Cmd+K không có hành động theo issue; search Cmd+K không debounce; 58 file có loading không có error; locale inline 4 chỗ; dnd announcements tiếng Anh.

## Chất lượng/DX

7 enum Prisma thiếu trong `@tirapro/types`; `as never` để né; 3 nguồn validation; JQL/LexoRank không test; API tsconfig tắt `noImplicitAny`; web tsconfig không extends base; mcp lệch version; không Dockerfile; CLAUDE.md đường dẫn Windows, "shadcn/ui" sai, FTS sai; `.codex/hooks.json` Windows; `tasks.md` rỗng; `enrich-demo.ts`/`seed-rich.mjs` mồ côi; `docker-compose` tên `projira`; MASTER_PLAN không trạng thái.

## Ngoài phạm vi sửa code (quyết định sản phẩm)

Gộp/cắt module ngoài spec; email; worklog; Jira importer; rule engine; dashboard tuỳ biến; export PDF/Excel; presence/typing; thống nhất envelope list; gom validation một layer; OpenAPI codegen; auto-inject tenant qua `$extends`.
