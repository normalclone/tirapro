Đây là báo cáo Markdown được yêu cầu, dựa hoàn toàn trên kết quả nghiên cứu đã cung cấp.

---

# UX/UI Craft & Friendliness cho Tirapro

> Tài liệu craft cho sản phẩm có ease-of-use là ưu tiên SỐ 1, impeccable design. Mọi nguyên tắc dưới đây bám sát nghiên cứu Linear / Stripe / Superhuman / Notion + NNGroup + Laws of UX + WCAG 2.2 + Refactoring UI, và được ánh xạ vào hạ tầng sẵn có của Tirapro (TanStack Query, Socket.io + redis-adapter, BullMQ, IssueHistory append-only, ReportCache/SprintSnapshot, soft-delete `deletedAt`, FTS tsvector + pgvector, multi-tenant theo `workspaceId`).

---

## 1. 10 nguyên tắc craft quan trọng nhất

### 1.1. Optimistic-first cho mọi mutation low-risk, reversible
- **Pattern:** Cập nhật UI đồng bộ từ state local trong bộ nhớ, gọi API chạy nền, rollback khi lỗi. Linear: *"The UI re-renders synchronously off the local, in-memory update. There are no spinners because there is nothing to wait for."* Ngưỡng cảm nhận "tức thì" của con người là <100ms (NNGroup).
- **Ví dụ tool:** TanStack Query `useMutation` (`onMutate` / `onError` / `onSettled`) + Linear sync model.
- **Áp dụng Tirapro:** Optimistic cho status drag trên Board, đổi assignee, label/priority, comment, like/star, reorder backlog — `setQueryData` ngay rồi gọi API, rollback bằng context đã snapshot. **KHÔNG** optimistic cho hành động nguy hiểm/khó đảo (xóa workspace, đổi quyền RBAC, bulk delete vĩnh viễn). Optimistic-delete an toàn nhờ soft-delete: ẩn ngay khỏi list + snackbar "Undo" 5s; server set `deletedAt`; Undo = clear `deletedAt`. **Cache key BẮT BUỘC gồm `workspaceId`** để rollback không lẫn tenant.

### 1.2. Idempotency + reconciliation chống double-apply
- **Pattern:** Mỗi mutation mang `clientMutationId` (idempotency key); dedupe echo realtime của chính mình; nguồn chân lý để reconcile là server. Pitfall optimistic: *"always save state before changing; never silent-fail; retry queue, chỉ undo sau nhiều lần fail."*
- **Ví dụ tool:** `clientMutationId` + Redis dedupe + Socket.io echo-skip.
- **Áp dụng Tirapro:** Server lưu `clientMutationId` (Redis, TTL ngắn) để chống double-apply khi BullMQ retry. Khi redis-adapter broadcast event về chính client đã optimistic-apply → dedupe theo `clientMutationId` (bỏ qua echo của chính mình). IssueHistory append-only là nguồn reconcile: nếu optimistic value lệch history mới nhất → lấy theo server. **ReportCache/SprintSnapshot KHÔNG cập nhật optimistic** — chỉ phản ánh sau khi server confirm để số liệu report luôn đúng.

### 1.3. Ngưỡng phản hồi phân tầng (<1s / 1–10s / >10s)
- **Pattern:** <1s không loader; 1–10s skeleton/spinner; >10s progress bar thật. Áp loader cho thao tác <1s làm UI *cảm thấy chậm hơn* thực tế (NNGroup Skeleton Screens, Progress Indicators).
- **Ví dụ tool:** NNGroup Skeleton Screens 101 + Progress Indicators.
- **Áp dụng Tirapro:** (1) Optimistic / cache hit (đổi status, mở issue đã prefetch) → KHÔNG loader. (2) Lần đầu load Board/Backlog/Issue-detail → skeleton khớp layout thật. (3) JQL search / report nặng → spinner cục bộ trong panel + giữ kết quả cũ mờ đi (interstitial), không xóa trắng. (4) Jira import/export/digest (BullMQ) → progress bar thật theo % hoặc số item. Nếu ReportCache/SprintSnapshot có cache → render ngay; chỉ skeleton khi cache miss.

### 1.4. Skeleton khớp layout thật (CLS = 0), tôn trọng reduced-motion
- **Pattern:** Skeleton phải tái dùng đúng grid/spacing của layout thật; tránh frame rỗng chỉ header/footer (người dùng tưởng trang hỏng); pulse/shimmer nhẹ và bọc `prefers-reduced-motion` (NNGroup).
- **Ví dụ tool:** Skeleton component khớp design token + `prefers-reduced-motion`.
- **Áp dụng Tirapro:** Skeleton của Board card, backlog row, issue panel dùng cùng token spacing/border-radius để khi data về không nhảy layout. Số skeleton item = số item trang trước (lưu count). Pulse bọc trong `@media (prefers-reduced-motion: reduce)`. Không skeleton quá 10s — nếu lâu hơn chuyển sang progress/empty-with-retry.

### 1.5. Button states đầy đủ + pressed feedback <150ms + focus ring rõ
- **Pattern:** Thiết kế đủ 6 state: default/hover/focus/pressed/disabled/loading. Pressed phải xuất hiện trong 100–150ms để cảm thấy tức thì; focus dùng stroke/outline (không chỉ đổi màu); disabled cần `aria-disabled` (NNGroup Button States).
- **Ví dụ tool:** NNGroup Button States + `:focus-visible`.
- **Áp dụng Tirapro:** Định nghĩa 6 state token-based cho mọi button/menu-item/row. `:active` phản hồi <100ms (transform scale nhẹ hoặc đổi nền), không chờ network. Submit không-optimistic có loading state + disable để chống double-submit; với optimistic action thì KHÔNG cần loading — đóng modal/đổi ngay. `:focus-visible` ring 2px (keyboard-first). Hover tooltip/preview có delay ~150ms để tránh trigger nhầm.

### 1.6. Hệ thống Toast vs Snackbar có ARIA live, dedupe, không chồng đống
- **Pattern:** Toast passive auto-dismiss ~4s (`role=status`, `aria-live=polite`); snackbar có Undo/Retry persist tới khi tương tác; lỗi dùng `role=alert` / `aria-live=assertive`; giới hạn số toast (LogRocket/NNGroup-aligned).
- **Ví dụ tool:** Snackbar Undo + `role=status`/`aria-live` + dedupe.
- **Áp dụng Tirapro:** (a) Toast xác nhận nhẹ cho optimistic-confirm ("Issue moved to In Progress"), 4s, đặt bottom/bottom-right. (b) Snackbar Undo 5–7s cho hành động đảo được (delete/move/archive) — Undo = clear `deletedAt`. Lỗi rollback PHẢI có toast `role=alert` + Retry, KHÔNG silent-fail. Giới hạn 3 toast đồng thời, gộp/đếm nếu trùng loại. Realtime event từ người khác → quiet in-place update / banner, KHÔNG toast spam mỗi thay đổi.

### 1.7. Drag affordance đầy đủ + keyboard alternative bắt buộc
- **Pattern:** Chuỗi idle→hover→grab→move→drop: grab-handle/cursor, ghost translucent + drop shadow khi kéo, drop-zone highlight + placeholder gap, reshuffle khi tâm vật kéo chạm mép (~100ms easing). Bắt buộc keyboard alternative (NNGroup Drag-Drop, Smart Interface Patterns).
- **Ví dụ tool:** NNGroup Drag-Drop + dnd-kit (keyboard sensor sẵn).
- **Áp dụng Tirapro:** Board & Backlog reorder: grab cursor + handle khi hover; khi kéo card gốc mờ + ghost theo chuột + drop shadow; cột/row đích highlight + placeholder gap transition ~100–150ms ease-out; trigger reorder khi tâm card chạm mép. Drop = optimistic apply + snap. **Keyboard alternative bắt buộc** (chọn card → phím di chuyển status/vị trí, công bố qua `aria-live`) — đây cũng là yêu cầu WCAG 2.5.7. `prefers-reduced-motion`: bỏ ghost-follow, đổi vị trí tức thì.

### 1.8. Animation discipline — chỉ transform/opacity, ngắn & bất đối xứng
- **Pattern:** *"Never animate layout-triggering properties... Animate only transform & opacity, durations <150ms, asymmetric (instant appear, brief fade-out)"* (Linear). Exit nhanh hơn enter; ease-out cho enter, ease-in/accelerate cho exit (Material Motion).
- **Ví dụ tool:** transform/opacity + Material easing tokens + FLIP.
- **Áp dụng Tirapro:** Token motion: `duration-fast` 100ms (press/hover), 150ms (drag snap, dropdown), 200–250ms (modal/panel enter); exit ngắn hơn enter ~20%. Chỉ animate transform & opacity (panel trượt vào, modal scale+fade, toast slide+fade); dùng FLIP nếu cần animate layout. Mọi animation bọc `prefers-reduced-motion: reduce`. Không gây layout thrash trên Board nhiều card.

### 1.9. Prefetch on intent + render-from-cache ("mở là thấy ngay")
- **Pattern:** Assume-success, render từ cache trước, validate sau; prefetch trên mouseover/touchstart để click là instant (Linear, Superhuman).
- **Ví dụ tool:** TanStack `prefetchQuery` on hover + `keepPreviousData`.
- **Áp dụng Tirapro:** Prefetch issue detail khi hover card trên Board (`mouseenter` → `prefetchQuery`) để mở panel render ngay, không skeleton. Dùng cursor pagination để prefetch trang kế của Backlog/list khi cuộn gần cuối. Cmd+K palette hiển thị recent issues/projects đã cache tức thì rồi mới gọi server (FTS/pgvector). `keepPreviousData` khi đổi filter/JQL để không chớp trắng.

### 1.10. Defaults thông minh + saved views + nhớ trạng thái (Tesler's Law)
- **Pattern:** Mọi quy trình có độ phức tạp tối thiểu — hệ thống phải gánh thay người dùng (Tesler's Law). Defaults hợp lý, pattern nhất quán, giảm số quyết định đồng thời (Cognitive Load, Krug "Don't make me think").
- **Ví dụ tool:** Linear saved views + instant UI; Tesler's Law (Laws of UX).
- **Áp dụng Tirapro:** Default view mỗi project (Board active sprint). Saved Views per-user + per-project (filter/sort/group/columns). Nhớ trạng thái: view cuối, độ rộng cột, panel mở/đóng, filter — khôi phục khi quay lại. Tận dụng ReportCache/SprintSnapshot để load tức thì. Empty state hướng dẫn hành động kế tiếp. Soft-delete → Undo thay confirm dialog nặng.

---

## 2. Micro-interaction & Motion Playbook

### 2.1. Motion tokens (single source of truth)
| Token | Giá trị | Dùng cho |
|---|---|---|
| `--dur-fast` | 100–120ms | press/hover, pressed feedback |
| `--dur-base` | 150–180ms | drag snap, dropdown, drawer |
| `--dur-enter` | 200–250ms | modal/panel enter |
| Exit | enter − ~20% | mọi exit (nhanh hơn enter) |
| `--ease-out` | decelerate | phần tử xuất hiện (enter) |
| `--ease-in` | accelerate | phần tử biến mất (exit) |

### 2.2. Quy tắc bất biến
- **Chỉ animate `transform` & `opacity`.** Không animate `width/height/top/left/margin` (reflow/jank, đặc biệt Board nhiều card). Cần animate layout → dùng FLIP.
- **Exit nhanh hơn enter.** Enter = exit cùng tốc độ → cảm giác ì.
- **Pressed feedback <150ms**, không chờ network.
- **Mọi animation bọc `prefers-reduced-motion: reduce`** → giảm về fade tối thiểu hoặc tắt; với JS/spring (dnd-kit, Framer Motion) gate bằng `useReducedMotion()`.

### 2.3. Feedback theo loại hành động
- **Optimistic action:** đổi ngay, KHÔNG loader, toast xác nhận nhẹ 4s.
- **Hành động đảo được:** snackbar Undo 5–7s (soft-delete).
- **Lỗi rollback:** toast `role=alert` + Retry, không bao giờ silent-fail.
- **Realtime inbound (Socket.io):** fade/highlight tĩnh, KHÔNG slide/jump, KHÔNG toast spam; reduced-motion → chỉ static highlight.

### 2.4. Drag micro-interaction (Board/Backlog)
idle (grab cursor + handle khi hover) → grab → move (card mờ + ghost + drop shadow) → drop-zone highlight + placeholder gap (~100–150ms ease-out) → drop (optimistic + snap). Trigger reorder khi **tâm** card chạm mép. Luôn kèm keyboard path + `aria-live` announce.

---

## 3. IA / Navigation & Cognitive Load

### 3.1. Conceptual model 1 trục
- Chốt **một cây canonical duy nhất: Workspace › Project › Issue.**
- Sprint/Epic/Label/Assignee/Filter/saved-search là **VIEWS cắt ngang** (như Linear cycles/views), KHÔNG phải tầng sidebar riêng. Giảm intrinsic cognitive load (chỉ giữ 1 mô hình tinh thần), khớp Jakob's Law.
- Mỗi Issue có khóa `PREFIX-123` (vd `PRJ-482`) ổn định cho breadcrumb, Cmd+K, deep-link, share.
- Tránh Sprint vừa là mục sidebar vừa là filter — chọn 1 (đề xuất: Sprint = view trong Project).

### 3.2. Inverted-L chrome cố định
- **Sidebar trái** = chỉ NAVIGATION (Workspace switcher trên cùng → Inbox/My Issues → Projects → Saved Views).
- **Topbar ngữ cảnh** = breadcrumb + view-switcher (List/Board/Timeline) + Filter/Sort/Group + search + Cmd+K + avatar.
- **Vùng giữa** = bảng/board mật độ cao.
- Side panel issue detail mở dạng split/overlay, **KHÔNG đẩy layout nhảy / reflow**. Giữ chiều cao topbar và spacing tuyệt đối nhất quán giữa các trang.

### 3.3. Sidebar (Miller 7±2, active state rõ)
- 3 nhóm có nhãn: "Của tôi" (Inbox, My Issues, Recent) / "Projects" (collapsible, mỗi project là link + caret để bung sub-views) / "Views đã lưu". Mỗi nhóm cố gắng ≤7 mục nhìn thấy.
- Project list dài → pin/favorite + cuộn + search-in-sidebar, **không xổ hết**.
- **Active item:** nền + thanh accent trái + đậm chữ — không chỉ dựa màu (lỗi #1 NNGroup là không đánh dấu active). Tên project front-load ("Mobile — iOS"). Cho phép collapse/reorder/pin.

### 3.4. Breadcrumb (hierarchy, không phải lịch sử)
- Dạng: `Workspace › Project › (Sprint/View) › PRJ-482`.
- Chọn **một đường canonical** = Project là cha chuẩn; ngữ cảnh sprint/filter để ở **chip "từ view X" riêng**, không nhồi vào breadcrumb.
- Item cuối (mã/tiêu đề issue) **không-link, in đậm**. Mỗi node click được tới trang thật.
- **Bỏ breadcrumb** ở list cấp 1 (board/backlog) vì chỉ 1 tầng. Mobile rút còn `Project › PRJ-482`.

### 3.5. Command palette (Cmd+K) — đường tắt xuyên IA
1. **Contextual-first:** đang ở Project X → "Create issue in X", "Switch view" lên đầu; đang chọn 1 issue → "Assign / Change status / Move sprint" trên cùng.
2. **Fuzzy + FTS tsvector + pgvector** để match cả lệnh lẫn nội dung (issue, project, người).
3. **Gom nhóm:** Hành động / Đi tới / Issues / Người / Gần đây.
4. **Hiện phím tắt inline** bên phải mỗi lệnh để DẠY (vd "Assign to me  I").
5. **Recent + suggested** ở empty state (chưa gõ đã thấy 5 hành động + issue gần đây).
6. **4 lối song song:** mọi hành động làm được qua nút / menu / shortcut / Cmd+K — không phụ thuộc duy nhất Cmd+K.
7. Điều hướng hoàn toàn bằng bàn phím (Esc đóng, mũi tên + Enter), có loading state khi query server.

### 3.6. Progressive disclosure (theo tần suất thật)
- Issue create/detail lớp đầu chỉ trường hay dùng (Title, Status, Assignee, Project/Sprint, Priority); đẩy Estimate/Labels/Due date/Parent/Custom fields vào "Thêm chi tiết".
- Board card: ít field mặc định + density toggle. Filter bar: vài filter phổ biến, "Nâng cao / JQL" bung lớp 2.
- Dùng IssueHistory + analytics đo field hay sửa để tinh chỉnh ranh giới core/advanced. **Không lồng quá 2 tầng.**
- Quy trình bước phụ thuộc nhau (import Jira, tạo Sprint từ backlog) → dùng **STAGED/wizard**, không progressive.

---

## 4. Forms / Data-entry Patterns

### 4.1. Inline edit in place vs side panel
- **Field hẹp** (status, assignee, priority, story points, sprint, labels) → edit in place trên Board card / Backlog row; render input/select overlay, commit on blur/Enter. Trên Board, **kéo card = inline status edit**.
- **Whole-issue edit** → mở **side panel phải (non-modal)**, KHÔNG modal — giữ board/backlog visible để người dùng nhận diện value ranges.
- Cell đang edit có outline/background phân biệt; **không đặt Delete cạnh Save/commit**.

### 4.2. Quick-add row + smart inherited defaults (EAS: Eliminate → Automate → Simplify)
- Input always-visible: gõ title + Enter tạo issue ngay, kế thừa context (workspace/project/sprint/column), default type=Task, status=cột đầu, reporter=current user, no assignee.
- Hỗ trợ inline token: `@phuc` (assignee), `/bug` (type), `!high` (priority) parse từ title.
- Defer description/estimate/labels sang inline edit sau. Pre-fill quick-add kế tiếp bằng sprint/type của lần trước.
- **Không pre-select default nguy hiểm/đắt** (đừng default status=Done hay notify everyone) — users hiếm khi đổi default.

### 4.3. Keyboard-first flow
- **Enter** = commit + advance sang cell editable kế (hoặc next row trong quick-add loop). **Esc / Shift+Enter** = cancel + khôi phục giá trị cũ. **Tab/Shift+Tab** = traverse field. Arrow keys = navigate grid khi không edit.
- Sau quick-add Enter, **giữ focus trong add row** để gõ issue kế tiếp không cần chuột.
- `novalidate`-style để browser không hijack Enter bằng native validation popup.

### 4.4. Friendly validation (không bao giờ block typing)
- **Single inline field:** validate **on blur/commit only**, message cạnh field ("Story points must be a number" — không "Invalid input"), red border + icon + text, clear ngay khi value hợp lệ.
- **Multi-field dialog (settings, create-issue):** validate **on submit**, render error-summary focusable link tới từng field, mirror wording, re-render **giữ nguyên input đã nhập**.
- Dùng Prisma/Zod message human-readable, không phải tên constraint thô.

### 4.5. Autosave + save-state feedback + Undo
- Inline property edit (status/assignee/priority/points) **autosave on commit** (atomic, reversible) → "Saving… → Saved" trên field/row + toast Undo cho thay đổi hệ trọng (moved to Done, reassigned).
- Free-text dài (description) autosave dạng draft với "Saving… / All changes saved HH:MM" + vẫn giữ affordance lưu rõ.
- Multi-field dialog giữ **nút Save thật**.
- IssueHistory append-only = backbone cho Undo/revert; hiển thị "changed by X".

### 4.6. Input affordances đúng
- Width khớp content (points = ô numeric nhỏ, title = rộng, date = date-picker). **Label/column-header luôn hiện** — không placeholder-only.
- Date/estimate chấp nhận input lỏng ("2d", "tomorrow", "2026-06-30") và normalize server-side. Email/mention disable autocapitalize.
- Giá trị inferred (auto-suggest assignee, default sprint) render dạng **prefill editable** rõ ràng, không phải text khóa cứng.

---

## 5. Onboarding / Empty-state

### 5.1. Empty state = hợp đồng 3 phần (status + teach + action)
Mỗi surface zero-data là **màn hạng nhất**, không phải fallback: empty Board column, Backlog, Sprint, Reports/Dashboard, Search (JQL), Activity/IssueHistory, notifications. Mỗi cái: (1) status 1 dòng ("No issues in this sprint yet" — không phải void), (2) teach 1 dòng WHY, (3) CTA chính wired vào action thật (Create issue, Start sprint, Import from Jira, Run sample JQL).
- **Reports/Dashboard đặc biệt:** vì ReportCache/SprintSnapshot cần IssueHistory tích lũy, empty state phải giải thích "reports populate after you complete issues / finish a sprint" + offer "Load sample sprint data" để chart không là ghost vĩnh viễn.

### 5.2. Seed sample data (reversible, labeled, tenant-scoped)
- Promote Prisma seed thành **tính năng sản phẩm**. Khi tạo Workspace → option "Start with a sample project": seed demo scoped `workspaceId` (~1 sprint, ~8–12 issues qua các status với IssueHistory transition thật) để Board, Backlog, SprintSnapshot **và** burndown/velocity render value ngay màn đầu — đây là aha moment của Tirapro.
- Mọi item badge **"Sample"** + one-click **"Clear sample data"** (dùng soft-delete để reversible/undo).
- **Bắt buộc:** tag để loại khỏi ReportCache/SprintSnapshot thật và khỏi activation metric; chỉ trong `workspaceId` đó.

### 5.3. Một activation event + magic number
- Chọn rõ và instrument: ứng viên mạnh = *"tạo sprint AND move ≥1 issue → Done (burndown khác rỗng) trong session đầu"* hoặc đơn giản *"first issue created + first status transition"*.
- Đo từ **IssueHistory append-only** (đã là nguồn chân lý) — thêm BullMQ job tính Time-To-Activation + activation rate, lưu vào ReportCache infra. Gate aha moment **last, không phải first**; strip mọi bước thừa (defer avatar, integrations, notif prefs).

### 5.4. Contextual "pull" help > upfront tour
- **Không** mở bằng full tour. Mặc định tooltip/hotspot just-in-time: lần đầu mở Board → 1 tooltip drag-to-change-status; lần đầu Backlog → "drag to sprint"; lần đầu Search → 1 JQL ví dụ chạy trên sample data; lần đầu AI/semantic → "describe an issue in plain language".
- Nếu giữ tour: **cap 3–5 step** (3-step ~72% completion, 5-step ~21%, 7-step 16% — mỗi step thừa giảm ~½), copy value-framed <~140 ký tự, step đầu auto-open, always-skippable, re-accessible từ help menu.

### 5.5. Getting-started checklist 3–5 item, progress visible
- Vd: (1) Create first project [hoặc done qua sample data] (2) Create issue (3) Start sprint (4) Invite teammate (5) View first report.
- Pre-check item mà sample-data đã thỏa → bar bắt đầu ~40% (momentum). State per-user theo `workspaceId`; detect "done" từ IssueHistory/domain events; **recompute live qua Socket.io** để tick box realtime. Instrument step-level drop-off vào ReportCache.

### 5.6. Persona/role branching tại signup
- 1 câu hỏi 2–5 option ("What will you track?" Software dev / Marketing / Ops / Personal). Branch CẢ sample project seed LẪN feature surfaced: dev thấy Sprints/Backlog/burndown front-and-center; persona nhẹ thấy board đơn giản, defer JQL/sprint analytics. Lưu choice trên Workspace. **Chỉ MỘT câu hỏi** — không multi-screen wizard.

---

## 6. Visual + Accessibility Checklist

### 6.1. Spacing & layout
- [ ] Spacing tokens trên grid 4px (`--space-1..12`), **không magic number** (13px/17px là tell amateur). Board/IssueCard/Backlog/modal/form chỉ dùng token.
- [ ] Step nhỏ (4/8) trong surface dày (card, row); step lớn (24/32) cho gutter/section.
- [ ] Depth bằng shadow/surface-tint/spacing thay vì border nặng; **một** `--radius` scale dùng chung button/input/card/chip/modal.

### 6.2. Typography
- [ ] Type tokens (`--text-xs..3xl`) tính bằng **rem**, ≤2 family.
- [ ] Hierarchy bằng **weight + color ramp 3 tier**, không chỉ size. Dense UI ở 13–14px.
- [ ] Body/description cap ~65ch. Số (points, sprint metrics, ReportCache) dùng `font-variant-numeric: tabular-nums`.

### 6.3. Color
- [ ] Ramp 50–900 cho neutral + brand + mỗi semantic status/priority; grayscale-first.
- [ ] Status badge: hue darkened trên hue-tint (green-800 on green-100), **không grey-on-color**.
- [ ] Label màu custom của workspace → auto-derive text color accessible (contrast check), không tin hue user chọn.

### 6.4. Motion
- [ ] Motion tokens 120–220ms; ease-out enter / ease-in exit.
- [ ] **Global `@media (prefers-reduced-motion: reduce)`** kill transform/long transition (~1ms); JS/spring + drag-drop gate bằng `useReducedMotion()`.
- [ ] Realtime inbound = fade/highlight, không slide/jump.

### 6.5. Dark mode
- [ ] Token set thứ hai (semantic: `--surface-1/2/3`, `--border`, `--text-*`), **không invert màu**. Base ~`#121212`, không `#000` (halation).
- [ ] Elevation bằng surface tint sáng dần (Board base → column surface-1 → card surface-2 → modal surface-3), không shadow nặng.
- [ ] Accent/status **desaturate** trong dark; verify 4.5:1 text / 3:1 large-text & UI ở CẢ hai theme.

### 6.6. WCAG 2.2 (bắt buộc)
- [ ] **2.4.7 / 2.4.13 Focus visible:** `:focus-visible` ring 2px, contrast ≥3:1, offset; **không bao giờ `outline:none`** thiếu replacement (grep regression).
- [ ] **2.4.11 Focus Not Obscured:** sticky Board/Backlog header, toast region, Cmd+K không che focused row (`scroll-margin` + z-index).
- [ ] **2.5.8 Target Size:** target ≥24×24 CSS px (pad hit area icon button: row actions, card menu, chip remover, pagination).
- [ ] **2.5.7 Dragging:** Board drag-to-move & Backlog drag-to-rank có path keyboard/menu ("Move to column / Move to sprint").
- [ ] **1.4.1 Use of Color:** status/priority/blocked/error/required = color + icon + text; chart phân biệt bằng pattern/label/direct-label, không chỉ hue.
- [ ] **4.1.2 / 4.1.3 Name/Role/Value + Status messages:** semantic HTML (`<button>/<a>/<nav>/<main>/<ul>`), `aria-label` cho icon-only; `aria-live=polite` cho toast + realtime ("Issue PROJ-42 moved to Done by Anh"); async/optimistic announce busy/done.
- [ ] Modal/drawer: focus trap on open, return focus to trigger on close, Esc đóng.
- [ ] Cmd+K: roles combobox/listbox, arrow-key nav, announce result count.

---

## 7. Bổ sung đề xuất cho docs/

### 7.1. `docs/UX_CONVENTIONS.md` (quy ước hành vi — "khi nào làm gì")

1. **Optimistic vs server-confirm matrix.** Liệt kê hành động: optimistic (status drag, assignee, label/priority, comment, star, reorder, soft-delete) vs PHẢI chờ server (xóa workspace, đổi RBAC, bulk delete vĩnh viễn). Quy ước: cache key luôn gồm `workspaceId`; mọi mutation mang `clientMutationId`; ReportCache/SprintSnapshot không bao giờ optimistic.
2. **Reconciliation & echo-skip.** Quy ước Redis dedupe TTL, bỏ qua Socket.io echo của chính mình theo `clientMutationId`, reconcile theo IssueHistory mới nhất.
3. **Bảng ngưỡng loader:** <1s không loader / 1–10s skeleton-or-spinner / >10s progress bar; cache hit → render ngay.
4. **Toast vs Snackbar:** khi nào passive toast (4s, `role=status`) vs snackbar Undo (5–7s) vs error (`role=alert` + Retry); giới hạn 3 toast + dedupe; realtime của người khác = quiet in-place, không toast.
5. **Keyboard contract:** Enter commit+advance / Esc revert / Tab traverse / arrow navigate grid; quick-add giữ focus; Cmd+K 4-lối-song-song; mọi action sidebar/menu phải có trong Cmd+K.
6. **Validation policy:** single field on blur/commit; multi-field on submit + error-summary + preserve input; message human-readable; không validate mid-keystroke.
7. **Autosave policy:** atomic field autosave + "Saving…/Saved" + Undo cho hành động hệ trọng; dialog giữ Save thật.
8. **IA rules:** một cây canonical Workspace›Project›Issue; view ≠ tầng IA; breadcrumb = hierarchy, item cuối không-link, bỏ ở list 1 tầng; sidebar active state = nền+accent+đậm.
9. **Progressive disclosure:** core/advanced theo tần suất (đo từ IssueHistory), không lồng >2 tầng; bước phụ thuộc → staged/wizard.
10. **Empty-state contract:** status + teach + action cho từng surface; loading state phải khác visually với empty thật.
11. **Onboarding:** một activation event đo từ IssueHistory; sample data badge "Sample" + clear-1-click + tenant-scoped + loại khỏi analytics; tour ≤5 step; checklist 3–5 item recompute qua Socket.io.

### 7.2. `docs/DESIGN.md` (foundation hữu hình — "giá trị gì")

1. **Spacing tokens** `--space-1..12` trên grid 4px (4,8,12,16,24,32,48,64,96); quy ước dense vs gutter.
2. **Type tokens** `--text-xs..3xl` (rem) + `--leading-tight/normal/relaxed`; 3-tier text color; ≤2 family; `tabular-nums` cho số.
3. **Color ramps** 50–900 cho neutral/brand/từng status/priority; quy tắc badge hue-on-hue; auto-derive text color cho label custom.
4. **Motion tokens** `--dur-fast/base/enter` + `--ease-out/in`; quy tắc chỉ transform/opacity, exit < enter, FLIP cho layout, global reduced-motion block.
5. **Elevation/radius tokens** shadow-sm/md/lg (light) + surface-tint (dark); một `--radius` scale.
6. **Dark theme token set** độc lập (`--surface-1/2/3`, `--border`, `--text-*`), base ~#121212, accent desaturate, contrast verified cả 2 theme.
7. **Focus ring token** `:focus-visible` 2px ≥3:1 offset, hoạt động cả 2 theme; cấm `outline:none` trần.
8. **Button 6-state spec** (default/hover/focus/pressed/disabled/loading) token-based, pressed <150ms.
9. **Skeleton components** khớp grid/spacing thật của Board card / backlog row / issue panel (CLS=0), pulse bọc reduced-motion.
10. **Component a11y baseline:** target ≥24×24, color-not-sole-signal (status/priority/chart kèm icon+text+pattern), `aria-live` region cho toast/realtime, drag có keyboard alternative.

---

### Nguồn (theo nghiên cứu cung cấp)
NNGroup: Microinteractions, Button States, Skeleton Screens 101, Progress Indicators, Drag-and-Drop, Breadcrumbs (11 guidelines), Menu-Design Checklist, Progressive Disclosure, 4 Principles to Reduce Cognitive Load, Empty States (3 Guidelines), Onboarding Tutorials vs Contextual Help, Instructional Overlays/Coach Marks, Data Tables (Four User Tasks), Errors in Forms (10 Guidelines), Efficiency vs Expectations. — Linear: How is Linear so fast (performance.dev), How we redesigned the Linear UI (part II), Linear Docs Conceptual Model. — Superhuman Command Palette; Sam Solomon Designing Command Palettes; Mobbin Command Palette; Command Palette UX Patterns (Bootcamp). — Simon Hearne Optimistic UI Patterns. — Material Design 3 Easing & Duration; MDN `prefers-reduced-motion`; Pope Tech accessible animation. — Smashing Drag-and-Drop UX; LogRocket Toast Notifications. — Laws of UX (Cognitive Load, Tesler's Law). — Baymard: EAS Framework, Input Fields, Mobile Forms inline labels; GOV.UK Validation / Error summary / Error message; UX Movement instant inline validation. — Appcues: Aha Moment Guide, Onboarding UX patterns, Best Practices; Growth.Design case studies; Intercom/Appcues Samuel Hulick; Formbricks 2026; Amplitude activation rate; Digital Applied TTV 2026. — WCAG 2.2 (W3C), What's New in 2.2 (WAI), Deque WCAG 2.2, WCAG 1.4.1 (tabnav); Refactoring UI (sglavoie summary, 7 Practical Tips); Dark Mode Accessibility (AccessibilityChecker, Medium).

---

## Nguồn (54)

- [Microinteractions in User Experience — Nielsen Norman Group](https://www.nngroup.com/articles/microinteractions/)
- [Button States: Communicate Interaction — Nielsen Norman Group](https://www.nngroup.com/articles/button-states-communicate-interaction/)
- [Skeleton Screens 101 — Nielsen Norman Group](https://www.nngroup.com/articles/skeleton-screens/)
- [Progress Indicators Make a Slow System Less Insufferable — Nielsen Norman Group](https://www.nngroup.com/articles/progress-indicators/)
- [Drag–and–Drop: How to Design for Ease of Use — Nielsen Norman Group](https://www.nngroup.com/articles/drag-drop/)
- [Optimistic UI Patterns for Improved Perceived Performance — Simon Hearne](https://simonhearne.com/2021/optimistic-ui-patterns/)
- [How's Linear so fast? A technical breakdown — performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)
- [Easing and duration — Material Design 3](https://m3.material.io/styles/motion/easing-and-duration)
- [prefers-reduced-motion CSS media feature — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [Drag-and-Drop UX: Guidelines and Best Practices — Smart Interface Design Patterns (Smashing)](https://smart-interface-design-patterns.com/articles/drag-and-drop-ux/)
- [What is a toast notification? Best practices for UX — LogRocket](https://blog.logrocket.com/ux-design/toast-notifications/)
- [How we redesigned the Linear UI (part II) — inverted-L chrome, giảm visual noise, tăng hierarchy/density](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Linear Docs — Concepts / conceptual model (Workspace>Team>Issue, cycles/projects/views, 4 lối hành động song song)](https://linear.app/docs/conceptual-model)
- [NNGroup — Breadcrumbs: 11 Design Guidelines for Desktop and Mobile](https://www.nngroup.com/articles/breadcrumbs/)
- [NNGroup — Menu-Design Checklist: 17 UX Guidelines (active state, labels, chunking, signifiers)](https://www.nngroup.com/articles/menu-design/)
- [NNGroup — Progressive Disclosure (core vs advanced, chia theo tần suất, staged vs progressive)](https://www.nngroup.com/articles/progressive-disclosure/)
- [NNGroup — Few Guesses, More Success: 4 Principles to Reduce Cognitive Load](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/)
- [Laws of UX — Cognitive Load (intrinsic vs extraneous, Miller's Law, chunking)](https://lawsofux.com/cognitive-load/)
- [Command Palette UX Patterns #1 (contextual, fuzzy, recent, group, dạy shortcut) — Bootcamp/Medium](https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1)
- [How to build a remarkable command palette — Superhuman (một Cmd+K cai trị, dạy phím tắt)](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- [Designing Command Palettes — Sam Solomon (fuzzy match, nudge thứ tự theo tần suất)](https://solomon.io/designing-command-palettes/)
- [Command Palette UI Design — Mobbin glossary (best practices, variants)](https://mobbin.com/glossary/command-palette)
- [Less Effort, More Completion: The EAS Framework for Simplifying Forms — NN/G](https://www.nngroup.com/articles/eas-framework-simplify-forms/)
- [10 Design Guidelines for Reporting Errors in Forms — NN/G](https://www.nngroup.com/articles/errors-forms-design-guidelines/)
- [Data Tables: Four Major User Tasks (inline edit-in-place vs modal vs side panel) — NN/G](https://www.nngroup.com/articles/data-tables/)
- [Don't Prioritize Efficiency Over Expectations (autosave vs explicit Save) — NN/G](https://www.nngroup.com/articles/efficiency-vs-expectations/)
- [8 Recommendations for Creating Effective Input Fields — Baymard Institute](https://baymard.com/learn/input-fields)
- [Mobile Form Usability: Never Use Inline Labels — Baymard Institute](https://baymard.com/blog/mobile-forms-avoid-inline-labels)
- [Recover from validation errors (validation pattern) — GOV.UK Design System](https://design-system.service.gov.uk/patterns/validation/)
- [Error summary component — GOV.UK Design System](https://design-system.service.gov.uk/components/error-summary/)
- [Error message component — GOV.UK Design System](https://design-system.service.gov.uk/components/error-message/)
- [Why Users Make More Errors with Instant Inline Validation — UX Movement](https://uxmovement.com/forms/why-users-make-more-errors-with-instant-inline-validation/)
- [Designing Empty States in Complex Applications: 3 Guidelines — Nielsen Norman Group](https://www.nngroup.com/articles/empty-state-interface-design/)
- [Onboarding Tutorials vs. Contextual Help — Nielsen Norman Group](https://www.nngroup.com/articles/onboarding-tutorials/)
- [Instructional Overlays and Coach Marks for Mobile Apps — Nielsen Norman Group](https://www.nngroup.com/articles/mobile-instructional-overlay/)
- [The Aha Moment Guide: How to find, optimize, and design for your product — Appcues](https://www.appcues.com/blog/aha-moment-guide)
- [Onboarding UX: 10 patterns, best practices, and real examples — Appcues](https://www.appcues.com/blog/user-onboarding-ui-ux-patterns)
- [User Onboarding Best Practices: 10 Strategies That Drive SaaS Activation — Appcues](https://www.appcues.com/blog/user-onboarding-best-practices)
- [47 UX Case Studies (onboarding, aha moment, time-to-value) — Growth.Design](https://growth.design/case-studies)
- [Talking user onboarding with Samuel Hulick (UserOnboard) — Intercom Blog](https://www.intercom.com/blog/podcasts/user-onboarding-interview-samuel-hulick/)
- [Onboarding new users — an interview with Samuel Hulick (UserOnboard) — Appcues](https://www.appcues.com/blog/onboarding-new-users-an-interview-with-samuel-hulick)
- [9 User Onboarding Best Practices for 2026 (sample data vs blank slate) — Formbricks](https://formbricks.com/blog/user-onboarding-best-practices)
- [What is Activation Rate for SaaS Companies? — Amplitude](https://amplitude.com/explore/digital-analytics/what-is-activation-rate)
- [Time to Value: The 2026 SaaS Onboarding Metrics Framework — Digital Applied](https://www.digitalapplied.com/blog/customer-onboarding-time-to-value-2026-saas-metrics-framework)
- [WCAG 2.2 — W3C Recommendation (full spec)](https://www.w3.org/TR/WCAG22/)
- [What's New in WCAG 2.2 — W3C WAI](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
- [WCAG 2.2 Updates & code examples — Deque University](https://dequeuniversity.com/resources/wcag-2.2/)
- [WCAG 1.4.1 Use of Color — Understanding (tabnav Academy)](https://tabnav.com/academy/wcag/success-criterion-1.4.1)
- [prefers-reduced-motion — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [Design accessible animation and movement (with code) — Pope Tech](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)
- [Book summary: Refactoring UI — sglavoie.com (spacing/type/color/depth specifics)](https://www.sglavoie.com/posts/2023/09/09/book-summary-refactoring-ui/)
- [7 Practical Tips for Cheating at Design — Refactoring UI (Wathan & Schoger)](https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886)
- [The Designer's Guide to Dark Mode Accessibility — AccessibilityChecker](https://www.accessibilitychecker.org/blog/dark-mode-accessibility/)
- [Designing Effective Dark Mode Interfaces (elevation/desaturation)](https://medium.com/@tundehercules/designing-effective-dark-mode-interfaces-17f38ecea2e9)
