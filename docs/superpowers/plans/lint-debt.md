# Nợ lint (ESLint 9, `pnpm lint`)

Cập nhật: 2026-10-15 (Task A1). `pnpm lint` thoát 0 với **0 lỗi, 275 cảnh báo** (cập nhật sau Task D4; root `eslint . --max-warnings 275`).
`eslint .` ở root hiện KHÔNG có `--max-warnings 0` — đó là "ngân sách cảnh báo" tạm: số
cảnh báo không được tăng. Khi trả hết nợ dưới đây, đổi script thành `eslint . --max-warnings 0`
(cả `lint-staged` ở root và `lint` trong `apps/api`, `apps/web`).

Lệnh đếm lại: `pnpm exec eslint . -f json | node -e "..."` hoặc đọc dòng cuối của `pnpm lint`.

## Rule đang hạ xuống `warn` (không tắt hẳn)

| Rule | Cảnh báo hiện tại | Phân bố | Lý do hạ | Cách trả |
|---|---|---|---|---|
| `@typescript-eslint/no-unsafe-return` | 44 | web 40, mcp 3, api 1 | Hầu hết là `return (await api.get(...)).data` — phản hồi axios chưa gắn kiểu | Gắn generic `api.get<T>()` trong từng `features/*/api.ts` |
| `@typescript-eslint/no-unsafe-member-access` | 42 | mcp 32, web 7, api 3 | Cùng nguồn "any lan truyền" | Như trên + gõ kiểu cho payload socket/JWT |
| `@typescript-eslint/no-unsafe-assignment` | 35 | mcp 26, web 9 | Cùng nguồn | Như trên |
| `@typescript-eslint/no-unsafe-argument` | 12 | mcp 7, web 5 | Cùng nguồn | Như trên |
| `@typescript-eslint/no-unsafe-call` | 6 | mcp 6 | Cùng nguồn | Như trên |
| `@typescript-eslint/no-explicit-any` | 12 | mcp 12 (chỉ `apps/mcp/src`; api/web vẫn là `error`) | MCP là client JSON mỏng, phản hồi REST chưa có schema | Dùng kiểu từ `@tirapro/types` / zod parse phản hồi |
| `@typescript-eslint/consistent-type-imports` | 0 | — | Hạ `warn` vì các nhánh song song còn đang sửa import (tránh xung đột gộp). 3 chỗ vi phạm cũ đã sửa | Nâng lại `error` sau khi gộp nhánh |

Cả họ `no-unsafe-*` cộng lại 139 — vượt ngưỡng 100 nên hạ cả họ thay vì sửa tay (đồng thời một số
file thuộc `features/goals|raid|resources|planning` đang do Task A2 sửa, không đụng được ở A1).

## Rule `warn` theo thiết kế

| Rule | Cảnh báo | Ghi chú |
|---|---|---|
| `max-lines-per-function` (150 dòng) | 41 (web 39, api 2) | Component React dài; tách dần khi chạm vào file. D4 đã tách ProjectConfigPage/IntegrationsPage/SettingsLayout thành file theo mục (cảnh báo chuyển sang từng section, chưa giảm) |
| `react-hooks/exhaustive-deps` | 3 (web 3) | `IssueDetailPage.tsx` (2 `useEffect` thiếu dep `issue`), 1 `useMemo` thừa dep `open`; cần xem từng hook, không sửa máy móc |

## Đã sửa trong Task A1

- `no-unnecessary-type-assertion` (~60 chỗ, autofix), `no-unused-vars` (14), `no-unused-expressions` (3),
  `require-await` (3), `no-floating-promises` (1), `no-explicit-any` ở api (1),
  `no-redundant-type-constituents` (1), `no-unsafe-enum-comparison` (1), `prefer-const` (1).
- `tsconfig`: bật `noUncheckedIndexedAccess`, bỏ `noImplicitAny: false` /
  `strictPropertyInitialization: false` ở api, web nay `extends` tsconfig gốc.
