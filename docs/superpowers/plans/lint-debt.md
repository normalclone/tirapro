# Nợ lint (ESLint 9, `pnpm lint`)

Cập nhật: 2026-10-15 (đợt cuối FW-OPS, đo lại sau khi gộp mọi task). `pnpm lint` thoát 0 với **0 lỗi, 91 cảnh báo** (root `eslint . --max-warnings 91`).
Đợt cuối: ngưỡng hạ 92 -> 91 = số đo thật (api: `no-unsafe-*` 12 + `max-lines-per-function` 10; mcp `max-lines-per-function` 1; web `max-lines-per-function` 65 + `exhaustive-deps` 3), để không còn chỗ trống cho 1 cảnh báo mới lọt qua. Nếu nhánh FW-API/FW-WEB đổi số này thì đo lại trước khi merge và đặt ngưỡng = số đo.
T1: đo lại trước khi sửa = 281 cảnh báo (sau Prettier toàn repo ở T5; trong đó 201 thuộc họ `no-unsafe-*` + `no-explicit-any`),
sau khi gắn kiểu thật = 92 (**-189**, không dùng `as any`/`eslint-disable`). Ngưỡng đặt = số đo thật.
`eslint .` ở root hiện KHÔNG có `--max-warnings 0` — đó là "ngân sách cảnh báo" tạm: số
cảnh báo không được tăng. Khi trả hết nợ dưới đây, đổi script thành `eslint . --max-warnings 0`
(cả `lint-staged` ở root và `lint` trong `apps/api`, `apps/web`).

Lệnh đếm lại: `pnpm exec eslint . -f json -o lint.json` rồi gom theo `ruleId` và package (hoặc đọc dòng cuối của `pnpm lint`).

## Rule đang hạ xuống `warn` (không tắt hẳn)

Họ `no-unsafe-*` vẫn để `warn` trong `eslint.config.mjs` (còn 12 chỗ ở `apps/api`); `apps/mcp` và `apps/web` hiện 0 cảnh báo họ này,
và `no-explicit-any` đã về `error` cho toàn repo (bỏ override riêng của mcp).

| Rule | Trước T1 | Sau T1 | Phân bố còn lại | Cách trả |
|---|---|---|---|---|
| `@typescript-eslint/no-unsafe-return` | 45 | 1 | api 1 | Gắn kiểu cho interceptor/guard/payload socket |
| `@typescript-eslint/no-unsafe-member-access` | 65 | 4 | api 4 | Như trên |
| `@typescript-eslint/no-unsafe-assignment` | 52 | 1 | api 1 | Như trên |
| `@typescript-eslint/no-unsafe-argument` | 18 | 6 | api 6 | Như trên + `vi.fn<...>()` có kiểu theo chữ ký thật cho spec |
| `@typescript-eslint/no-unsafe-call` | 9 | 0 | — | Đã trả |
| `@typescript-eslint/no-explicit-any` | 12 (chỉ mcp) | 0 | — | Đã trả; rule về `error` toàn repo |
| `@typescript-eslint/consistent-type-imports` | 0 | 0 | — | Hạ `warn` vì các nhánh song song còn đang sửa import (tránh xung đột gộp). Nâng lại `error` sau khi gộp nhánh |

Còn lại 12 chỗ họ `no-unsafe-*` nằm ở `apps/api`: `permissions.guard.ts` (3), `permissions.guard.spec.ts` (2), `rbac.service.spec.ts` (2), `jwt.strategy.spec.ts` (2), `realtime.gateway.ts` (2), `response.interceptor.ts` (1).

## Rule `warn` theo thiết kế

| Rule | Cảnh báo | Ghi chú |
|---|---|---|
| `max-lines-per-function` (150 dòng) | 76 (web 65, api 10, mcp 1; trước format 42; T1 không đụng; web giảm 66 -> 65 khi W4 gộp) | Component React dài; tách dần khi chạm vào file. D4 đã tách ProjectConfigPage/IntegrationsPage/SettingsLayout thành file theo mục (cảnh báo chuyển sang từng section, chưa giảm) |
| `react-hooks/exhaustive-deps` | 3 (web 3) | `IssueDetailPage.tsx` (2 `useEffect` thiếu dep `issue`), 1 `useMemo` thừa dep `open`; cần xem từng hook, không sửa máy móc |

## Đã sửa trong Task T1

- `apps/mcp`: `Tira.get<T>/post<T>/patch<T>` generic (`req<T>` trả `json as T` từ `unknown`), kiểu phản hồi tối thiểu ở `apps/mcp/src/types.ts`; không còn `any` trong `apps/mcp/src` (-86: `index.ts` 78, `tira.ts` 8).
- `apps/web`: generic `api.get/post/delete<T>` cho `lib/api.ts` (refresh), `stores/auth.ts`, mọi `features/*/api.ts` (delete không dùng body → `<void>`, avatar → DTO thật), `JSON.parse(...) as <kiểu cục bộ>` ở `BoardPage`, `CreateIssueModal`, `ProjectLayout`, `recentIssues`; `src/env.d.ts` khai báo `ImportMetaEnv` (`VITE_API_URL`, `VITE_WS_URL`) để `import.meta.env.*` hết `any`.
- `apps/api`: `vi.fn<(arg: X) => Y>()` có kiểu ở `ai.service.spec`, `all-exceptions.filter.spec`, `claude.service.spec`, `ai-quota.service.spec`; `RedisIoAdapter.createIOServer(): Server`.

## Đã sửa trong Task A1

- `no-unnecessary-type-assertion` (~60 chỗ, autofix), `no-unused-vars` (14), `no-unused-expressions` (3),
  `require-await` (3), `no-floating-promises` (1), `no-explicit-any` ở api (1),
  `no-redundant-type-constituents` (1), `no-unsafe-enum-comparison` (1), `prefer-const` (1).
- `tsconfig`: bật `noUncheckedIndexedAccess`, bỏ `noImplicitAny: false` /
  `strictPropertyInitialization: false` ở api, web nay `extends` tsconfig gốc.
