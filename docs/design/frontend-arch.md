# Frontend Architecture (React)

Tôi sẽ tải skill artifact-design trước khi viết, nhưng vì nhiệm vụ yêu cầu trả về DUY NHẤT nội dung markdown của bản đặc tả (không phải artifact), tôi sẽ tập trung viết bản đặc tả thiết kế. Đây là một tài liệu kỹ thuật trả về dưới dạng chuỗi markdown thuần.

# Đặc tả thiết kế: Frontend Architecture (React) — Tirapro

## 1. Tổng quan & phạm vi subsystem

Subsystem này định nghĩa toàn bộ kiến trúc client của ứng dụng web `apps/web` trong monorepo pnpm. Mục tiêu: một SPA production-grade, keyboard-first, realtime, hỗ trợ PWA, dark mode, mobile-responsive, code-split theo route, kết nối tới backend NestJS qua REST + Socket.io.

**Nguyên tắc kiến trúc cốt lõi:**
- **Feature-based foldering** (không phải layer-based): mỗi domain (issues, board, backlog, sprints, reports...) là một feature module tự chứa (components, hooks, api, store cục bộ).
- **Tách bạch server state vs client state**: TanStack Query sở hữu toàn bộ server state (cache, refetch, mutation, optimistic update); Zustand chỉ giữ client/UI state thuần (auth tokens, theme, command palette, modal stack, presence cục bộ).
- **API client layer tập trung** (axios instance + interceptors) — không component nào gọi axios trực tiếp.
- **Typed contracts**: dùng chung package `@tirapro/types` (xuất từ Prisma/DTO của backend) + Zod schemas cho validation form & runtime parsing.
- **Colocation**: test, story, style colocate cạnh component.

### 1.1. Điểm giao tiếp với subsystem khác (integration points)

| Giao tiếp với | Cơ chế | Hợp đồng (contract) |
|---|---|---|
| Backend API (NestJS) | REST qua axios, base `/api/v1` | DTO types từ `@tirapro/types`; lỗi chuẩn `{ statusCode, message, error, code }` |
| Auth subsystem | JWT access (memory/Zustand) + refresh (httpOnly cookie hoặc localStorage tùy chính sách BE) | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Realtime subsystem | Socket.io client, namespace `/realtime`, rooms theo `project:{id}` / `issue:{id}` | events: `board.updated`, `issue.updated`, `presence.sync`, `comment.created`, `notification.new` |
| AI subsystem | REST `/ai/*` (streaming SSE cho summarize/generate) | phải degrade gracefully: nếu `GET /ai/health` trả `{ enabled:false }` → ẩn/disable UI AI |
| Shared types | package `@tirapro/types`, `@tirapro/zod-schemas` | import trực tiếp, build qua tsup |

---

## 2. Cấu trúc thư mục `apps/web/src`

```
apps/web/
├── public/
│   ├── icons/                      # PWA icons (192,512, maskable)
│   └── manifest.webmanifest        # (sinh bởi vite-plugin-pwa, hoặc override)
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env / .env.example
└── src/
    ├── main.tsx                    # entry: createRoot, Providers, PWA register
    ├── App.tsx                     # RouterProvider
    ├── vite-env.d.ts
    │
    ├── app/                        # cấu hình cấp ứng dụng (cross-cutting)
    │   ├── providers/
    │   │   ├── AppProviders.tsx     # gom QueryClientProvider, ThemeProvider, TooltipProvider, Toaster
    │   │   ├── QueryProvider.tsx    # QueryClient + persistQueryClient (optional)
    │   │   ├── ThemeProvider.tsx    # dark/light/system
    │   │   └── SocketProvider.tsx   # khởi tạo socket sau khi auth
    │   ├── router/
    │   │   ├── router.tsx           # createBrowserRouter, lazy routes
    │   │   ├── routes.ts            # hằng số path + helper buildPath()
    │   │   ├── guards.tsx           # <RequireAuth>, <RequirePermission>
    │   │   └── ErrorBoundary.tsx    # route-level errorElement
    │   └── config/
    │       ├── env.ts               # parse import.meta.env qua zod
    │       └── constants.ts
    │
    ├── components/                 # UI primitives DÙNG CHUNG, không chứa logic domain
    │   ├── ui/                      # shadcn/ui generated (button, dialog, input, select, popover, command, dropdown-menu, sheet, tabs, toast, tooltip, avatar, badge, skeleton, scroll-area...)
    │   ├── layout/
    │   │   ├── AppShell.tsx          # sidebar + topbar + outlet
    │   │   ├── Sidebar.tsx
    │   │   ├── Topbar.tsx
    │   │   ├── ProjectSwitcher.tsx
    │   │   └── MobileNav.tsx
    │   ├── feedback/
    │   │   ├── EmptyState.tsx
    │   │   ├── ErrorState.tsx
    │   │   ├── LoadingScreen.tsx
    │   │   └── QueryBoundary.tsx     # wrapper Suspense + ErrorBoundary cho query
    │   ├── data-display/
    │   │   ├── DataTable.tsx         # generic table (TanStack Table)
    │   │   ├── UserAvatar.tsx
    │   │   └── PriorityIcon.tsx / IssueTypeIcon.tsx / StatusBadge.tsx
    │   └── form/                     # bọc react-hook-form + shadcn
    │       ├── Form.tsx (FormField, FormItem, FormControl, FormMessage)
    │       ├── RHFTextField.tsx
    │       ├── RHFSelect.tsx
    │       ├── RHFCombobox.tsx
    │       ├── RHFRichText.tsx       # editor (Tiptap) cho description/comment
    │       └── RHFDatePicker.tsx
    │
    ├── features/                   # ⭐ TRÁI TIM — mỗi domain một folder
    │   ├── auth/
    │   │   ├── api/ (login, refresh, me)  # hooks + fetchers
    │   │   ├── components/ (LoginForm, RegisterForm)
    │   │   ├── pages/ (LoginPage, RegisterPage, ForgotPasswordPage)
    │   │   ├── store/ authStore.ts
    │   │   └── hooks/ useAuth.ts, usePermissions.ts
    │   ├── projects/
    │   │   ├── api/ useProjects.ts useProject.ts useCreateProject.ts
    │   │   ├── components/ ProjectCard, ProjectList, CreateProjectDialog, ProjectHeader
    │   │   └── pages/ ProjectsListPage, ProjectOverviewPage
    │   ├── board/                   # Kanban + Scrum board
    │   │   ├── api/ useBoard.ts useMoveIssue.ts
    │   │   ├── components/
    │   │   │   ├── Board.tsx          # DndContext gốc
    │   │   │   ├── BoardColumn.tsx    # droppable column = status
    │   │   │   ├── BoardCard.tsx      # draggable issue card
    │   │   │   ├── BoardCardOverlay.tsx
    │   │   │   ├── SwimlaneGroup.tsx  # group theo assignee/epic
    │   │   │   └── BoardFilters.tsx
    │   │   ├── hooks/ useBoardDnd.ts (dnd-kit sensors + collision + optimistic move)
    │   │   └── pages/ BoardPage.tsx
    │   ├── backlog/
    │   │   ├── components/ BacklogList, BacklogRow, SprintSection, CreateSprintBar, SprintHeader
    │   │   ├── hooks/ useBacklogDnd.ts  # kéo issue giữa backlog ↔ sprint
    │   │   └── pages/ BacklogPage.tsx
    │   ├── sprints/
    │   │   ├── api/ useSprints, useStartSprint, useCompleteSprint
    │   │   └── components/ StartSprintDialog, CompleteSprintDialog
    │   ├── issues/
    │   │   ├── api/ useIssue, useIssues, useCreateIssue, useUpdateIssue, useTransitionIssue
    │   │   ├── components/
    │   │   │   ├── IssueDetail.tsx     # body chung (dùng cho modal & route)
    │   │   │   ├── IssueDetailModal.tsx
    │   │   │   ├── IssueFields.tsx     # custom fields renderer
    │   │   │   ├── IssueActivity.tsx   # tabs: comments / history / worklog
    │   │   │   ├── IssueLinks.tsx, SubtaskList.tsx
    │   │   │   ├── TransitionButton.tsx (workflow transitions)
    │   │   │   └── CreateIssueDialog.tsx
    │   │   └── pages/ IssueDetailPage.tsx
    │   ├── comments/
    │   │   └── components/ CommentList, CommentItem, CommentEditor (@mentions via combobox)
    │   ├── attachments/
    │   │   └── components/ AttachmentDropzone, AttachmentGrid
    │   ├── search/                  # JQL-like + semantic
    │   │   ├── components/ JqlInput, SearchResults, SavedFilters
    │   │   └── pages/ SearchPage.tsx
    │   ├── reports/
    │   │   ├── components/ BurndownChart, VelocityChart, CumulativeFlowChart, ReportFilters
    │   │   └── pages/ ReportsPage.tsx
    │   ├── dashboard/
    │   │   ├── components/ DashboardGrid (react-grid-layout), GadgetCard, gadgets/*
    │   │   ├── hooks/ useDashboardLayout.ts
    │   │   └── pages/ DashboardPage.tsx
    │   ├── workflows/               # editor status + transitions (admin/project setting)
    │   │   └── components/ WorkflowEditor (dnd-kit nodes), StatusEditor, TransitionEditor
    │   ├── notifications/
    │   │   ├── api/ useNotifications, useMarkRead
    │   │   └── components/ NotificationBell, NotificationPanel, ActivityFeed
    │   ├── ai/                      # tất cả UI AI, degrade gracefully
    │   │   ├── api/ useAiHealth, useGenerateIssue, useSummarize(SSE), useSuggestAssignee, useSprintPlan
    │   │   ├── components/ AiGenerateIssueDialog, AiSummaryButton, AiSuggestChip, SprintPlannerDrawer, SemanticSearchToggle
    │   │   └── hooks/ useAiEnabled.ts  # gate toàn bộ UI AI
    │   ├── command-palette/
    │   │   ├── components/ CommandPalette.tsx (cmdk)
    │   │   ├── commands/ (registry: navigate, createIssue, switchProject, toggleTheme, ai...)
    │   │   └── hooks/ useCommandPalette.ts (Cmd+K)
    │   ├── presence/
    │   │   └── components/ PresenceAvatars, TypingIndicator
    │   ├── settings/
    │   │   └── pages/ ProfileSettings, ProjectSettings, MembersSettings, FieldsSettings, WorkflowSettings
    │   └── admin/
    │       └── pages/ AdminUsers, AdminRoles, AdminSystem
    │
    ├── lib/                        # utilities thuần, không React
    │   ├── api/
    │   │   ├── axios.ts              # instance + interceptors
    │   │   ├── queryClient.ts        # QueryClient config
    │   │   ├── queryKeys.ts          # ⭐ query key factory tập trung
    │   │   ├── refreshToken.ts       # logic refresh + queue
    │   │   └── errors.ts             # ApiError, normalize
    │   ├── socket/
    │   │   ├── socket.ts             # io() singleton
    │   │   └── events.ts             # type-safe event map
    │   ├── utils/ cn.ts, date.ts, format.ts, jql.ts
    │   └── pwa/ registerSW.ts
    │
    ├── hooks/                      # hooks dùng chung cross-feature
    │   ├── useSocketEvent.ts
    │   ├── useDebounce.ts
    │   ├── useMediaQuery.ts
    │   ├── useKeyboardShortcut.ts
    │   └── useOptimisticList.ts
    │
    ├── stores/                     # Zustand stores GLOBAL (UI/client state)
    │   ├── authStore.ts
    │   ├── uiStore.ts               # sidebar, theme, modals stack
    │   ├── commandStore.ts
    │   └── presenceStore.ts
    │
    ├── types/                      # types FE-only (re-export @tirapro/types)
    │   └── index.ts
    │
    └── styles/
        ├── globals.css             # tailwind layers + CSS vars (shadcn theme tokens)
        └── themes.css
```

---

## 3. Routing (React Router v6 — Data Router)

Dùng `createBrowserRouter` với route-level code-splitting (`lazy`), `loader` nhẹ (chủ yếu prefetch qua queryClient), `errorElement`.

### 3.1. Bảng route chính

| Path | Component (lazy) | Guard | Ghi chú |
|---|---|---|---|
| `/login` | `LoginPage` | public, redirect nếu đã auth | |
| `/register`, `/forgot-password` | tương ứng | public | |
| `/` | redirect → `/projects` | RequireAuth | |
| `/projects` | `ProjectsListPage` | RequireAuth | grid project đa team |
| `/projects/:projectKey` | `ProjectLayout` (AppShell con) | RequireAuth + RequireMember | layout cha cho project |
| `/projects/:projectKey/board` | `BoardPage` | + perm `board:view` | Kanban/Scrum |
| `/projects/:projectKey/backlog` | `BacklogPage` | | Scrum backlog |
| `/projects/:projectKey/board?selectedIssue=KEY-1` | board + `IssueDetailModal` | | **modal qua searchParam** |
| `/projects/:projectKey/issues/:issueKey` | `IssueDetailPage` | | **full-page route** (deep link, refresh) |
| `/projects/:projectKey/reports` | `ReportsPage` | perm `report:view` | tabs: burndown/velocity/cfd |
| `/projects/:projectKey/settings/*` | `ProjectSettingsLayout` | perm `project:admin` | details/members/fields/workflow |
| `/dashboard` | `DashboardPage` | RequireAuth | dashboard tùy biến cá nhân |
| `/search` | `SearchPage` | RequireAuth | JQL + semantic |
| `/settings/profile` | `ProfileSettings` | RequireAuth | |
| `/admin/*` | `AdminLayout` | perm `system:admin` | users/roles/system |
| `*` | `NotFoundPage` | — | |

### 3.2. Pattern Issue Detail: modal vs route (dual)

Vấn đề Jira-like: mở issue từ board nên là **modal overlay** (giữ context board), nhưng phải **deep-linkable & refresh-safe**.

Giải pháp: dùng `searchParams` (`?selectedIssue=KEY-123`) cho modal trên các trang list/board, và route đầy đủ `/issues/:issueKey` cho deep-link/full view. `IssueDetail` là component thân chung, hai vỏ bọc khác nhau.

```tsx
// trong BoardPage / BacklogPage
const [params, setParams] = useSearchParams();
const selectedIssue = params.get('selectedIssue');
// ...
<IssueDetailModal
  issueKey={selectedIssue}
  open={!!selectedIssue}
  onClose={() => { params.delete('selectedIssue'); setParams(params); }}
/>
```

### 3.3. Cấu hình router (rút gọn)

```tsx
// app/router/router.tsx
export const router = createBrowserRouter([
  { path: '/login', lazy: () => import('@/features/auth/pages/LoginPage') },
  {
    element: <RequireAuth><AppShell /></RequireAuth>,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, loader: () => redirect(ROUTES.projects) },
      { path: 'projects', lazy: () => import('@/features/projects/pages/ProjectsListPage') },
      {
        path: 'projects/:projectKey',
        lazy: () => import('@/features/projects/ProjectLayout'),
        loader: projectLoader(queryClient), // prefetch project + members
        children: [
          { path: 'board', lazy: () => import('@/features/board/pages/BoardPage') },
          { path: 'backlog', lazy: () => import('@/features/backlog/pages/BacklogPage') },
          { path: 'issues/:issueKey', lazy: () => import('@/features/issues/pages/IssueDetailPage') },
          { path: 'reports', lazy: () => import('@/features/reports/pages/ReportsPage') },
          { path: 'settings/*', lazy: () => import('@/features/settings/ProjectSettingsLayout') },
        ],
      },
      { path: 'dashboard', lazy: () => import('@/features/dashboard/pages/DashboardPage') },
      { path: 'search', lazy: () => import('@/features/search/pages/SearchPage') },
      { path: 'admin/*', element: <RequirePermission perm="system:admin"><AdminLayout/></RequirePermission> },
    ],
  },
  { path: '*', lazy: () => import('@/features/misc/NotFoundPage') },
]);
```

> Lưu ý: với `lazy`, file page export `Component` (và optional `loader`, `ErrorBoundary`) theo convention của React Router data API.

---

## 4. State management

### 4.1. Phân vai trò

| Loại state | Công cụ | Ví dụ |
|---|---|---|
| Server state (mọi data từ API) | **TanStack Query** | issues, board, sprints, comments, reports |
| Auth (token, user hiện tại) | **Zustand** `authStore` (persist refresh-related) | accessToken, user, permissions |
| UI ephemeral | **Zustand** `uiStore` | theme, sidebar collapsed, modal stack |
| Command palette | **Zustand** `commandStore` | open, query, pages |
| Presence (realtime) | **Zustand** `presenceStore` | online users theo room |
| Form state | **react-hook-form** (cục bộ component) | mọi form |
| URL state | **React Router searchParams** | selectedIssue, filters, board grouping |

### 4.2. Zustand stores (mẫu)

```ts
// stores/authStore.ts
interface AuthState {
  user: User | null;
  accessToken: string | null;     // chỉ trong memory (bảo mật); refresh token do BE quản qua httpOnly cookie
  permissions: Set<string>;       // resolved RBAC permissions
  status: 'idle' | 'authenticated' | 'unauthenticated';
  setSession: (user: User, accessToken: string, permissions: string[]) => void;
  clear: () => void;
}
export const useAuthStore = create<AuthState>()((set) => ({
  user: null, accessToken: null, permissions: new Set(), status: 'idle',
  setSession: (user, accessToken, permissions) =>
    set({ user, accessToken, permissions: new Set(permissions), status: 'authenticated' }),
  clear: () => set({ user: null, accessToken: null, permissions: new Set(), status: 'unauthenticated' }),
}));
```

```ts
// stores/uiStore.ts — persist theme + sidebar
export const useUiStore = create<UiState>()(persist((set) => ({
  theme: 'system',
  sidebarCollapsed: false,
  setTheme: (t) => set({ theme: t }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}), { name: 'tirapro-ui', partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }) }));
```

> Quyết định bảo mật: access token giữ trong memory (Zustand không persist) để tránh XSS đọc localStorage; refresh token nên là httpOnly cookie do BE set. Nếu BE chọn refresh trong body, fallback lưu vào `localStorage` với cảnh báo — đây là **điểm cần BE chốt**.

### 4.3. TanStack Query — config & query key factory

```ts
// lib/api/queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});
```

```ts
// lib/api/queryKeys.ts — KEY FACTORY (bắt buộc dùng, không hardcode key rời rạc)
export const qk = {
  auth: { me: ['auth', 'me'] as const },
  projects: {
    all: ['projects'] as const,
    detail: (key: string) => ['projects', key] as const,
    members: (key: string) => ['projects', key, 'members'] as const,
  },
  board: (projectKey: string, boardId: string, filters?: BoardFilters) =>
    ['board', projectKey, boardId, filters ?? {}] as const,
  backlog: (projectKey: string) => ['backlog', projectKey] as const,
  sprints: (projectKey: string) => ['sprints', projectKey] as const,
  issues: {
    list: (projectKey: string, jql?: string) => ['issues', projectKey, jql ?? ''] as const,
    detail: (issueKey: string) => ['issues', 'detail', issueKey] as const,
    comments: (issueKey: string) => ['issues', issueKey, 'comments'] as const,
    activity: (issueKey: string) => ['issues', issueKey, 'activity'] as const,
  },
  reports: { burndown: (sprintId: string) => ['reports', 'burndown', sprintId] as const, /* ... */ },
  notifications: ['notifications'] as const,
  ai: { health: ['ai', 'health'] as const },
};
```

---

## 5. API client layer (axios + interceptors refresh token)

### 5.1. Axios instance

```ts
// lib/api/axios.ts
export const api = axios.create({
  baseURL: env.VITE_API_URL,        // ví dụ http://localhost:3000/api/v1
  withCredentials: true,            // gửi httpOnly refresh cookie
  timeout: 20_000,
});

// Request interceptor — gắn access token từ store (không import React)
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

### 5.2. Response interceptor — refresh token với queue chống race

```ts
// lib/api/refreshToken.ts
let isRefreshing = false;
let waiters: Array<(token: string | null) => void> = [];

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig;
    const status = error.response?.status;

    if (status !== 401 || original._retry || original.url?.includes('/auth/refresh')) {
      return Promise.reject(toApiError(error));
    }
    original._retry = true;

    if (isRefreshing) {
      // chờ refresh đang chạy
      return new Promise((resolve, reject) => {
        waiters.push((token) => {
          if (!token) return reject(toApiError(error));
          original.headers.Authorization = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }

    isRefreshing = true;
    try {
      const { data } = await api.post('/auth/refresh'); // cookie tự gửi
      useAuthStore.getState().setSession(data.user, data.accessToken, data.permissions);
      waiters.forEach((w) => w(data.accessToken));
      waiters = [];
      original.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(original);
    } catch (e) {
      waiters.forEach((w) => w(null));
      waiters = [];
      useAuthStore.getState().clear();
      router.navigate('/login');
      return Promise.reject(toApiError(error));
    } finally {
      isRefreshing = false;
    }
  },
);
```

### 5.3. Error normalization

```ts
// lib/api/errors.ts
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) { super(message); }
}
export function toApiError(e: AxiosError): ApiError {
  const d = e.response?.data as any;
  return new ApiError(e.response?.status ?? 0, d?.message ?? e.message, d?.code, d?.details);
}
```

### 5.4. Fetcher convention (mỗi feature có api/)

```ts
// features/issues/api/useIssue.ts
const getIssue = (key: string) => api.get<IssueDetailDto>(`/issues/${key}`).then((r) => r.data);

export function useIssue(issueKey: string) {
  return useQuery({ queryKey: qk.issues.detail(issueKey), queryFn: () => getIssue(issueKey), enabled: !!issueKey });
}

export function useUpdateIssue(issueKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateIssueDto) => api.patch(`/issues/${issueKey}`, patch).then(r => r.data),
    onMutate: async (patch) => {                          // optimistic
      await qc.cancelQueries({ queryKey: qk.issues.detail(issueKey) });
      const prev = qc.getQueryData<IssueDetailDto>(qk.issues.detail(issueKey));
      qc.setQueryData(qk.issues.detail(issueKey), (old: any) => ({ ...old, ...patch }));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.issues.detail(issueKey), ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.issues.detail(issueKey) }),
  });
}
```

---

## 6. Socket client hook (realtime)

### 6.1. Type-safe event map

```ts
// lib/socket/events.ts
export interface ServerToClientEvents {
  'board.updated': (p: { boardId: string; issueId: string; from: string; to: string; rank: string; actorId: string }) => void;
  'issue.updated': (p: { issueKey: string; patch: Partial<IssueDetailDto>; actorId: string }) => void;
  'comment.created': (p: { issueKey: string; comment: CommentDto }) => void;
  'presence.sync': (p: { room: string; users: PresenceUser[] }) => void;
  'notification.new': (p: NotificationDto) => void;
}
export interface ClientToServerEvents {
  'room.join': (room: string) => void;
  'room.leave': (room: string) => void;
  'presence.ping': (p: { room: string; cursor?: unknown }) => void;
}
```

### 6.2. Singleton + provider

```ts
// lib/socket/socket.ts
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
  io(env.VITE_WS_URL, { path: '/realtime', autoConnect: false, transports: ['websocket'],
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }) });
```

`SocketProvider` connect khi `status === 'authenticated'`, disconnect khi logout; re-auth socket khi access token đổi.

### 6.3. Hook tiêu thụ event → cập nhật query cache

```ts
// hooks/useSocketEvent.ts
export function useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
  useEffect(() => {
    socket.on(event, handler as any);
    return () => { socket.off(event, handler as any); };
  }, [event, handler]);
}

// ví dụ trong BoardPage: realtime move → patch cache board (không refetch)
useSocketEvent('board.updated', (p) => {
  if (p.actorId === me.id) return;                 // bỏ qua echo của chính mình
  qc.setQueryData(qk.board(projectKey, boardId), (b) => applyMove(b, p));
});
```

Room lifecycle: vào `BoardPage`/`IssueDetail` → emit `room.join('project:{key}')` / `issue:{key}`, rời thì `room.leave`. Presence cập nhật `presenceStore`.

---

## 7. Form handling (react-hook-form + zod)

- Mọi form dùng `react-hook-form` + `zodResolver`.
- Zod schemas dùng chung với BE qua package `@tirapro/zod-schemas` khi khả thi; FE-only schema đặt cạnh form.
- Wrapper `RHF*` (mục 2) bọc shadcn input để DX nhất quán + hiển thị `FormMessage` lỗi.

```ts
// features/issues/components/CreateIssueDialog.tsx
const createIssueSchema = z.object({
  type: z.enum(['EPIC','STORY','TASK','BUG','SUBTASK']),
  summary: z.string().min(1, 'Bắt buộc').max(255),
  description: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(['LOWEST','LOW','MEDIUM','HIGH','HIGHEST']).default('MEDIUM'),
  storyPoints: z.coerce.number().int().min(0).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
type CreateIssueForm = z.infer<typeof createIssueSchema>;

const form = useForm<CreateIssueForm>({ resolver: zodResolver(createIssueSchema), defaultValues: {...} });
```

Custom fields render động: map `field.type` (`TEXT|NUMBER|SELECT|MULTISELECT|DATE|USER|CHECKBOX`) → component RHF tương ứng; schema build runtime từ định nghĩa field của project.

---

## 8. Drag & drop (dnd-kit) — board & backlog

Dùng `@dnd-kit/core` + `@dnd-kit/sortable`. **Ranking dùng LexoRank/fractional indexing** (chuỗi rank) để chèn giữa không cần reindex; BE trả & nhận `rank`.

### 8.1. Board (Kanban/Scrum)

- `DndContext` ở `Board.tsx`, sensors: `PointerSensor` (activation distance 8px để không nhầm click), `KeyboardSensor` (keyboard-first).
- Mỗi `BoardColumn` là droppable (id = statusId), chứa `SortableContext` các card.
- `onDragEnd`: tính status đích + rank mới (giữa card trên/dưới) → gọi `useMoveIssue` (optimistic) → BE → broadcast socket.

```ts
// features/board/hooks/useBoardDnd.ts (lõi)
function onDragEnd(e: DragEndEvent) {
  const { active, over } = e;
  if (!over) return;
  const issueId = active.id as string;
  const { statusId, rank } = computeTarget(over, active, columns); // fractional rank
  moveIssue.mutate({ issueId, statusId, rank }, {
    onMutate: () => optimisticallyMove(qc, queryKey, issueId, statusId, rank),
  });
}
```

Optimistic UI: cập nhật cache ngay, rollback nếu mutation lỗi; transition workflow phải hợp lệ (BE validate; FE disable column không có transition hợp lệ qua `validTransitions`).

### 8.2. Backlog

- Kéo issue trong cùng list (reorder rank) và **kéo giữa backlog ↔ sprint** (đổi `sprintId` + rank).
- Multi-select drag (Shift/Ctrl) để move nhiều issue — optional nâng cao.

---

## 9. Code-splitting & performance

- **Route-level**: mỗi page `lazy()` (đã ở router). Charts (recharts) và editor (Tiptap) là chunk nặng → lazy import trong feature.
- **Vendor chunking** trong `vite.config.ts` `build.rollupOptions.output.manualChunks`: tách `react`, `tanstack`, `dnd-kit`, `recharts`, `socket.io-client`.
- **Prefetch**: `onMouseEnter` link → `queryClient.prefetchQuery` + dynamic import page (router `lazy` tự cache).
- **Suspense + QueryBoundary** cho loading nhất quán; skeleton thay vì spinner toàn trang.
- **Virtualization** (`@tanstack/react-virtual`) cho backlog/search list dài.
- Memo hóa card board (`React.memo` + so sánh shallow) để DnD mượt.

```ts
// vite.config.ts (trích)
build: {
  rollupOptions: {
    output: { manualChunks: {
      'react-vendor': ['react','react-dom','react-router-dom'],
      'query': ['@tanstack/react-query'],
      'dnd': ['@dnd-kit/core','@dnd-kit/sortable'],
      'charts': ['recharts'],
    }},
  },
},
```

---

## 10. PWA setup (vite-plugin-pwa)

```ts
// vite.config.ts (trích plugin)
VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'auto',
  workbox: {
    navigateFallback: '/index.html',
    runtimeCaching: [
      { urlPattern: /\/api\/v1\/(projects|issues)/, handler: 'NetworkFirst',
        options: { cacheName: 'api-cache', networkTimeoutSeconds: 5, expiration: { maxEntries: 200, maxAgeSeconds: 86400 } } },
      { urlPattern: /\.(?:png|svg|woff2)$/, handler: 'CacheFirst', options: { cacheName: 'assets' } },
    ],
    // KHÔNG cache socket.io & /auth — luôn network
    navigateFallbackDenylist: [/^\/api/, /socket\.io/],
  },
  manifest: {
    name: 'Tirapro', short_name: 'Tirapro', theme_color: '#0f172a', background_color: '#0f172a',
    display: 'standalone', start_url: '/',
    icons: [ { src:'/icons/192.png', sizes:'192x192', type:'image/png' },
             { src:'/icons/512.png', sizes:'512x512', type:'image/png' },
             { src:'/icons/maskable.png', sizes:'512x512', type:'image/png', purpose:'maskable' } ],
  },
  devOptions: { enabled: false },
})
```

- UI prompt "có bản cập nhật mới → reload" qua `useRegisterSW`.
- Offline: shell + cached project/issue đọc được; mutation khi offline → hàng đợi (TanStack Query `onlineManager`) hoặc thông báo offline (mức cơ bản: chặn + toast).

---

## 11. AI features (degrade gracefully)

- `useAiEnabled()` đọc `GET /ai/health` (cached, staleTime dài). Nếu `enabled:false` → mọi component AI render `null` hoặc nút disabled với tooltip "AI chưa cấu hình".
- Streaming (summarize, generate issue): dùng `fetch` + `ReadableStream`/SSE thay vì axios (axios không stream tốt ở browser); hook `useStreamingCompletion`.
- Các điểm tích hợp AI vào UI: nút "Generate" trong `CreateIssueDialog`, "Summarize" trong `IssueDetail`/comments, suggest chip cho assignee/priority/story points, `SprintPlannerDrawer` trong backlog, toggle semantic search trong `SearchPage`.

```tsx
// features/ai/hooks/useAiEnabled.ts
export function useAiEnabled() {
  const { data } = useQuery({ queryKey: qk.ai.health, queryFn: () => api.get('/ai/health').then(r=>r.data),
    staleTime: 10*60_000, retry: false });
  return data?.enabled ?? false;
}
```

---

## 12. Command palette (Cmd+K), keyboard-first, dark mode, responsive

- **Command palette**: thư viện `cmdk` bọc trong shadcn `Command`. Mở bằng `useKeyboardShortcut('mod+k')`. Command registry phân nhóm: Navigation, Issue actions, Project switch, Theme, AI. Hỗ trợ "pages" (nhấn Enter để vào nhóm con).
- **Keyboard shortcuts** toàn cục: `c` tạo issue, `g b` → board, `g l` → backlog, `/` focus search, `?` mở help. Quản lý qua hook đăng ký + bảng shortcut.
- **Dark mode**: Tailwind `darkMode: 'class'`; `ThemeProvider` set class trên `<html>` từ `uiStore.theme` (light/dark/system + lắng nghe `prefers-color-scheme`). shadcn tokens qua CSS vars trong `globals.css`.
- **Responsive/mobile**: AppShell đổi sidebar → `Sheet`/`MobileNav` dưới breakpoint `md`; board chuyển horizontal-scroll columns; bảng → card list. `useMediaQuery` điều hướng layout.

---

## 13. Bảng dependencies chính (apps/web)

| Nhóm | Package |
|---|---|
| Core | react, react-dom, react-router-dom |
| Build | vite, @vitejs/plugin-react, vite-plugin-pwa, vite-tsconfig-paths |
| Styling | tailwindcss, autoprefixer, class-variance-authority, tailwind-merge, clsx, lucide-react |
| UI | shadcn/ui (radix-ui primitives), cmdk, sonner (toast) |
| Server state | @tanstack/react-query, @tanstack/react-query-devtools, @tanstack/react-virtual, @tanstack/react-table |
| Client state | zustand |
| HTTP | axios |
| Realtime | socket.io-client |
| Forms | react-hook-form, @hookform/resolvers, zod |
| DnD | @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities |
| Charts | recharts |
| Dashboard grid | react-grid-layout |
| Editor | @tiptap/react, @tiptap/starter-kit, @tiptap/extension-mention |
| Export | xlsx (Excel), jspdf + html2canvas (PDF) |
| Shared | @tirapro/types, @tirapro/zod-schemas (workspace) |

---

## 14. Biến môi trường (FE)

```ts
// app/config/env.ts
const schema = z.object({
  VITE_API_URL: z.string().url(),         // http://localhost:3000/api/v1
  VITE_WS_URL: z.string().url(),           // http://localhost:3000
  VITE_ENABLE_PWA: z.enum(['true','false']).default('true'),
});
export const env = schema.parse(import.meta.env);
```

---

## 15. Checklist contract cần BE/subsystem khác chốt

1. **Refresh token**: httpOnly cookie (khuyến nghị) hay body? → quyết định lưu trữ access/refresh.
2. **Shape lỗi chuẩn** `{ statusCode, message, error, code, details }` thống nhất cho `toApiError`.
3. **Ranking**: BE dùng LexoRank/fractional string `rank` cho issue trên board & backlog.
4. **Socket**: path `/realtime`, auth qua `auth.token`, danh sách event & payload (mục 6.1) khớp BE gateway.
5. **AI health**: `GET /ai/health → { enabled: boolean, models: string[] }`; streaming endpoint format (SSE chunks).
6. **RBAC**: BE trả `permissions: string[]` trong `/auth/me` & `/auth/refresh` để FE gate UI (`RequirePermission`).
7. **Workflow**: issue detail trả `validTransitions: { id, name, toStatusId }[]` để render `TransitionButton` & gate DnD.
8. **Custom fields**: định nghĩa field theo project trả về để FE render động form & detail.