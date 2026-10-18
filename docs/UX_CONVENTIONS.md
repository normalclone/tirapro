# Tirapro — UX Conventions (ease-of-use là acceptance criterion)

> Ưu tiên SỐ 1: **thật thuận tiện, dễ dùng**. Mỗi màn/component build xong phải đối chiếu
> checklist này + chạy `/impeccable critique <màn>` trước khi coi là done. Bám `DESIGN.md`
> (token/typography/motion) và `PRODUCT.md` (calm, get out of the way).

## 1. Tốc độ cảm nhận (feels instant)
> **Triết lý spinner:** spinner KHÔNG bị cấm — nó là fallback cho trường hợp chậm hiếm hoi.
> Mục tiêu là **phần mềm nhanh đến mức thao tác hoàn tất TRƯỚC khi spinner kịp hiện**.
> Đầu tư tốc độ trước; spinner chỉ là lưới an toàn, và phải có **độ trễ** để không "nháy".

- **Optimistic UI** cho MỌI mutation thường gặp: kéo-thả card, đổi status/assignee/priority,
  tạo issue, comment → cập nhật UI ngay, reconcile khi server trả/realtime (thường xong <100ms → spinner không bao giờ xuất hiện).
- **Delayed spinner** (chống "spinner flash"/giật): chỉ render spinner sau **ngưỡng ~300–500ms**;
  nếu đã hiện thì giữ tối thiểu ~500ms để không nhấp nháy. Thao tác nhanh hơn ngưỡng → KHÔNG bao giờ thấy spinner.
- **Skeleton khớp layout** cho lần load đầu màn lớn (board/backlog/issue) — cũng theo ngưỡng trễ; render-from-cache thì bỏ qua hẳn.
- **Prefetch on hover/intent** (TanStack Query) cho link issue/project → mở là thấy ngay, không kịp loader.
- **Virtualized** mọi list dài (backlog, search results, board column nhiều card).
- Route-level **code-splitting**; nhớ và khôi phục scroll/filter khi quay lại.
- Đầu tư tốc độ THẬT (không chỉ che bằng loader): index/cache/payload nhỏ/perf budget (mục dưới) để spinner gần như không bao giờ chạm ngưỡng.

## 2. Keyboard-first
- **Cmd/Ctrl+K** command palette: điều hướng + mọi hành động (tạo issue, đổi project, mở report,
  bắt đầu tour, toggle theme...). Tìm kiếm fuzzy.
- Phím tắt toàn cục: `c` tạo issue, `/` focus search, `g b` go board, `g l` backlog, `g d` dashboard,
  `j/k` di chuyển, `e` edit, `a` assign, `m` bình luận, `?` mở bảng phím tắt. Hiện hint trong tooltip.
- Mọi dialog: `Esc` đóng, `Enter`/`Cmd+Enter` submit, focus-trap, focus về nơi mở.

## 3. Ít ma sát khi nhập liệu
- **Quick-add**: tạo issue chỉ cần **summary** (type/status/priority lấy default cấu hình). Ô quick-add
  ngay trên board column & backlog (Enter tạo, tiếp tục gõ cái kế).
- **Inline edit**: click thẳng summary/status/assignee/priority/labels để sửa tại chỗ — không mở form lớn.
- **Smart defaults**: status = initial của workflow, assignee theo `defaultAssigneeMode`, reporter = current user.
- **Autosave draft** (description/comment) vào localStorage; không mất khi lỡ đóng.
- Validation **inline, thân thiện, tiếng Việt**, hiện ngay tại field (zod dùng chung).

## 4. Làm nhanh hàng loạt & lặp lại
- **Bulk actions**: chọn nhiều issue (shift/ctrl) → đổi status/assignee/sprint/label/xóa một lần.
- **Drag-and-drop** (dnd-kit): board, sắp xếp backlog, kéo vào/ra sprint, đổi thứ tự cột.
- **Create từ mọi nơi**: nút "+ Tạo" ở topbar, Cmd+K, phím `c`, và Telegram `/newtask`.

## 5. Tha thứ lỗi (forgiving)
- **Undo** qua toast ("Đã chuyển sang Done · Hoàn tác") thay vì hỏi xác nhận, cho hành động đảo được.
- Chỉ confirm với hành động **phá hủy/không đảo được** (xóa project, xóa sprint có issue).
- Không bao giờ mất dữ liệu người dùng đang gõ; thao tác sai khôi phục được (soft-delete + restore).

## 6. Tìm & thấy nhanh
- **Global search** (Cmd+K) xuyên issue/project/people; gõ key `PROJ-123` nhảy thẳng.
- **JQL** cho power user nhưng có **filter builder** trực quan cho người thường; saved + recent filters.
- Bộ lọc board/backlog **dính** theo người dùng; chip filter xóa nhanh.

## 7. AI như "phím tắt thông minh" (giảm gõ tay)
- "Mô tả việc cần làm" → AI sinh issue (title/desc/AC/points). Tóm tắt thread dài. Gợi ý
  assignee/priority/points. Luôn cho **xem trước + sửa** trước khi áp dụng; degrade khi không có key.

## 8. Hướng dẫn ngay trong luồng
- **Empty state** mỗi list = giải thích + nút hành động kế tiếp (không phải màn trống).
- **Tour driver.js** first-run mỗi màn (dismissible) + **Help drawer** ("?") + onboarding checklist.
- Seed **sample data/template** để user thấy giá trị ngay, không cần dựng từ số 0.

## 9. Nhất quán & dự đoán được
- Cùng một cách làm ở mọi nơi (cách edit, cách mở menu, cùng phím tắt). Cùng component, cùng spacing.
- Trạng thái = **icon + nhãn + màu** (không chỉ màu). Nhớ ngữ cảnh (project/board/filter/theme gần nhất). Ưu tiên luôn là `PriorityIcon` (mũi tên theo hạng), không phải chấm màu.
- **Nên có một hành động chính (primary) mỗi màn/hộp thoại/thanh** — các nút còn lại là secondary/ghost (hướng dẫn, chưa có test ép). Nút vô hiệu dùng token `disabled-bg`/`disabled-fg`, không giảm độ mờ.
- **Ô chọn:** cấm `<select>` native (test `noNativeSelect`). ≤ 4 lựa chọn ngắn, cố định → `SegmentedControl`; còn lại → `SearchSelect`. Bật/tắt có hiệu lực ngay → `Switch`; chọn trong biểu mẫu rồi mới Lưu → `Checkbox` (giữ nguyên).
- **Form có nút Lưu cấp trang** dùng `UnsavedBar` ("Có thay đổi chưa lưu · Bỏ thay đổi · Lưu"); rời trang/đổi mục khi đang sửa thì hỏi xác nhận (`useLeaveGuard`).

## 10. Responsive & accessible = dễ cho tất cả
- Mobile (dưới `lg`): **thanh tab đáy** Tổng quan · Dự án · ＋ Tạo · Thông báo · Tôi (không drawer, không hamburger, **không nút nổi** — nút nổi "Tạo" chỉ từ `lg` trở lên); "Tạo"/"Tôi" mở sheet đáy; nút Tìm (Bảng lệnh) ở topbar. Board vuốt ngang, touch target ≥44px, thao tác chính 1 tay.
- **Không gợi ý phím trên màn cảm ứng:** gợi ý chỉ-để-nhắc (⌘K, ↵, số phím tắt) gắn `.kbd-hint` (ẩn khi `hover:none` + `pointer:coarse`); trang Hướng dẫn và bảng phím tắt giữ nguyên tên phím. Thanh "chưa lưu" và thanh hàng loạt nằm **ngay trên** thanh tab đáy, không đè lên.
- Mobile 390px: không cuộn ngang trang; ô nhập ≥16px dưới `sm` (iOS không phóng to); dải/bảng cuộn ngang phải có mờ mép báo còn nội dung (`.scroll-fade-x` + `useScrollFade`); phần tử cố định (thanh tab, toast, nút nổi desktop) tránh vùng an toàn iOS (`env(safe-area-inset-bottom)`); vùng chạm của điều khiển nhỏ trên dòng ≥ 36px chiều cao (cảm ứng: mở rộng vùng bấm lên ≥ 44px bằng `TOUCH_HIT`/`pointer:coarse`, không đổi cỡ hiển thị desktop). Kiểm bằng `pnpm --filter @tirapro/web mobile:audit` (và `-- --dialogs` cho hộp thoại); bộ đo cũng báo khi thiếu thanh tab đáy hoặc có phần tử cố định chồng lên.
- WCAG AA: keyboard đầy đủ, focus rõ, screen-reader label, `prefers-reduced-motion`.

## 11. Notification — im lặng theo mặc định (từ nghiên cứu)
- Default CHỈ thông báo: **assigned-to-me / @mention / state-change-affecting-me / thứ mình watch**. Auto-watch OFF hoặc scope hẹp.
- **Coalesce** edit cùng session thành 1 notification + 1 activity entry (debounce 30–60s, expand xem từng field).
- Matrix per (user, event, channel: in-app/email/Telegram/off) sửa < 30s, có preview "bạn sẽ nhận thông báo khi...". Email default = **digest**; chỉ @mention/urgent đẩy instant. "Mute thread" 1-click mọi nơi. (Tránh thảm hoạ Jira 60 email/ngày.)

## 12. Permission dễ hiểu & auditable
- 3–4 **role preset** ngôn ngữ người (Admin/Member/Viewer/Guest) + mô tả "làm được gì"; custom role là advanced opt-in. Nút **"View as <role>"**. Màn **"Access overview"** (chọn user → thấy truy cập gì; chọn issue → ai xem được). Cảnh báo trước khi mở rộng visibility. Không per-person permission spiral.

## 13. Progressive power & chống config bloat
- **Simple mode mặc định**; tính năng enterprise (custom field, workflow editor, automation, JQL) opt-in **per-project**, ẩn sau "Advanced".
- **Tắt được module** không dùng per-project (Sprints/Backlog/Reports/Time tracking/Components).
- **Share** field/workflow definition giữa project (không copy per-project). Report "unused config" + 1-click archive; cảnh báo khi role/field tăng bất thường.

## 14. IA điều hướng ổn định
- Chốt IA sớm, giữ ổn định. Đổi layout → tooltip "X chuyển sang đây" tạm thời, **không đổi im lặng** (tránh thảm hoạ ClickUp 4.0). `data-tour` anchor ổn định.

## 15. Triage-first cho input ngoài
- Mọi issue từ nguồn ngoài (Jira import / Telegram / GitHub-GitLab / AI / reporter ngoài team) vào **Triage inbox**, KHÔNG thẳng backlog.
- **One-key**: Accept `1`, Mark Duplicate `2` (merge, reversible), Decline `3` (+lý do), **Snooze** `H`. Tự nhảy issue kế. Snooze trở lại theo timer HOẶC khi có activity mới.
- **Dedupe tại creation**: panel "Possible duplicates" trước submit; merge mang attachments/comments/watchers/links sang canonical, hiển thị "merged from #N", undoable. Double-report tự động collapse theo `fingerprint` + occurrence counter.

## 16. AI là trợ lý, không tự quyết
- AI luôn dạng **đề xuất accept/edit chip**, hiển thị căn cứ (dependency/capacity/code-ownership). Không tự áp lịch/estimate. **Suspect commits** gợi ý assignee từ git blame. Bug form: AI pre-fill steps/severity/labels để **confirm thay vì gõ**.
- **AI opt-in & tắt được** per-workspace/user (không ép như Rovo). Mọi AI write hiển thị **diff + xác nhận**; **KHÔNG BAO GIỜ báo "đã làm xong" khi chưa verify** (lỗi niềm tin lớn nhất). Ground vào field model thật, không bịa field/giá trị.

## 17. Data ownership & an toàn dữ liệu (từ deep-dive — nỗi đau lớn nhất)
- **Recycle Bin / Trash**: xóa issue/comment/attachment vào thùng rác (soft-delete `deletedAt`), **restore 1-click**, retention cấu hình (mặc định 30–90 ngày) rồi mới purge. Xóa vĩnh viễn phải confirm rõ. KHÔNG có thao tác nào mất dữ liệu không khôi phục được.
- **Autosave draft** (description/comment) — không mất khi rời trang/đổi tab (lỗi Jira tồn nhiều năm).
- **One-click full export** (issue+comment+attachment+history+links) round-trippable với import — chống lock-in, là điểm bán. Self-host = user sở hữu DB.
- Không "data disappearing": optimistic phải reconcile chắc; báo lỗi rõ khi save fail, không nuốt im lặng.

## 18. API & Integration ổn định (từ deep-dive — nỗi đau dev lớn nhất)
- **Versioning cộng dồn** (`/api/v1`); đổi/bỏ field → sunset song song có thông báo, không phá đột ngột.
- **Giữ `total` count** ở offset pagination (đừng bắt full-pagination chỉ để đếm — lỗi Jira /search/jql).
- Tên field/endpoint ổn định, không "magic constant". **Contract tests trong CI** để bắt breaking change. Official SDK/typed client (đã có `@tirapro/types` + zod).

## Accessibility & Offline (bổ sung mục 10)
- Test **screen reader thật** trước release (Jira bị chê đến mức nhân viên khiếm thị bỏ việc).
- **Offline-tolerant**: PWA cache đọc; optimistic + **queue write offline**, reconcile khi online; báo trạng thái offline rõ.

## Bug form & severity (bổ sung mục 3)
- Bug create **progressive**: chỉ `Title` + `Description` bắt buộc; Steps / Expected-Actual / **Severity** / Environment / Attachments **inline-expand**. Nút "dùng session hiện tại" tự điền browser/OS/URL/viewport.
- **Severity TÁCH Priority** — 2 field riêng, định nghĩa + ví dụ inline khi hover ("Critical severity ở feature đã ngừng vẫn có thể Low priority").

## Perf budget (bổ sung mục 1)
- **Đo trong CI**: p95 tương tác board/list < 100ms; first-paint < 1s với 1.000 issue; mọi tương tác > 200ms coi là **bug**.
- **Cấm** view load-toàn-workspace ("Everything"). Reserve space chống layout shift. Virtualize list dài, lazy-load issue detail/history.

## Search (bổ sung mục 6)
- Global search **fuzzy + typo-tolerant + ranked + instant-as-you-type**; **change-history queryable từ ngày 1**; JQL có autocomplete + lỗi thân thiện + **AI tiếng Việt → query**.

## Craft addendum (từ docs/RESEARCH_UX_CRAFT.md — playbook chi tiết)
- **Idempotency + reconciliation**: mỗi mutation mang `clientMutationId`; server dedupe (Redis TTL) chống double-apply khi BullMQ retry; client **bỏ qua echo của chính mình** khi Socket.io broadcast (chống nhấp nháy/double-count). `ReportCache`/`SprintSnapshot` KHÔNG cập nhật optimistic — chỉ sau server confirm.
- **Prefetch on intent + render-from-cache**: hover/focus link issue → prefetch; có cache → mở **không loader**. Ngưỡng loader phân tầng: <1s không indicator · 1–10s skeleton-khớp-layout (CLS=0, tôn trọng reduced-motion) · >10s progress bar thật (import/export/digest).
- **Toast vs Snackbar**: toast xác nhận nhẹ (auto 4s, `aria-live=polite`) vs snackbar có **Undo** (5–7s, dùng soft-delete) cho hành động đảo được; lỗi rollback có toast `role=alert` + Retry, **không silent-fail**; tối đa 3 toast, dedupe trùng loại; realtime của người khác = quiet in-place update, không toast spam.
- **Button 6-state** (default/hover/focus-visible/pressed/disabled/loading), pressed feedback <150ms (`:active` không chờ network). **Drag** đủ affordance (ghost+drop-shadow+placeholder gap ~120ms) + **keyboard alternative bắt buộc** (dnd-kit keyboard sensor) + công bố qua aria-live.
- **Motion tokens** (single source, đã ở DESIGN.md): chỉ animate transform/opacity, duration <150–240ms **bất đối xứng** (enter chậm hơn exit), ease-out; reduced-motion → crossfade/instant.
- **Saved views + nhớ trạng thái** (Tesler's Law): nhớ filter/sort/board/theme gần nhất per user; sort default đẩy overdue lên đầu.

## 19. Thuật ngữ (một khái niệm = một từ)
Giao diện chỉ có tiếng Việt, nhưng GIỮ thuật ngữ Agile tiếng Anh. Mọi chuỗi hiển thị (web, API, digest, thông báo) theo bảng này; hằng số dùng chung ở `apps/web/src/lib/terms.ts` (`TERM`, `STATUS_CATEGORY_LABEL`).

| Khái niệm | Chữ dùng | Ghi chú |
|---|---|---|
| Issue | **Công việc** / **việc** (khi chật chỗ) | Tuyệt đối không "issue", "vấn đề", "ticket", "task" làm danh từ chung. `Task` chỉ là TÊN LOẠI. |
| Backlog | **Việc chờ** | Tab, tiêu đề khu, nút "Về Việc chờ". |
| Board | **Bảng việc** | "Board" chỉ còn trong tên riêng / URL; nhóm phím tắt ghi "Trên bảng việc". |
| Dashboard | **Bảng tổng quan** | Không "dashboard" trong chữ hiển thị; chỉ còn trong route/khoá cache/mã quyền. |
| Sprint, Epic | **Sprint**, **Epic** | Giữ nguyên; không "đợt làm việc". |
| Nhóm trạng thái | **To Do / In Progress / Done** | Không "Cần làm / Đang làm / Hoàn thành". "Hoàn thành" chỉ làm động từ (nút "Hoàn thành sprint"). |
| Trạng thái (tên) | To Do / In Progress / In Review / Done | Theo cấu hình workflow. |
| Ưu tiên | Highest / High / Medium / Low / Lowest | Theo cấu hình. |
| Severity | **Mức nghiêm trọng** | Theo tên cấu hình. |
| Burndown, Velocity, Cumulative Flow | Giữ nguyên | |
| Story points | **điểm** | |
| Project | **Dự án** | |
| Workspace | **Không gian làm việc** | |
| Huỷ | **Huỷ** | Nút huỷ luôn viết "Huỷ", không "Hủy". |
| Mã dự án | **Dự án** | Không "Project ID" ở chữ hiển thị. |
| Chỉ hướng | — | Không "bên trái"/"cột trái" (trên mobile cột đó nằm trên nội dung). |
| Cổng quản lý cấp công ty | **Danh mục** | Trước đây "Quản trị". |
| `/admin` | **Quản trị hệ thống** | |
| Workflow | **Quy trình** | |
| Component / Version | **Thành phần** / **Phiên bản** | |
| RAID | **Rủi ro & vướng mắc** | |
| Assignee / Reporter | **Người phụ trách** / **Người báo cáo** | |
| Triage | **Việc mới vào** | Đúng tên tab hiện có. |
| Loại liên kết | `blocks`, `is blocked by`, `relates to`, `duplicates`, `clones`, `is caused by`, `is tested by` | Giữ tiếng Anh; loại mới theo bảng này. |
| Ngày / giờ | `dd/MM/yyyy`, `HH:mm` (24h) | Thời gian tương đối tiếng Việt ("khoảng 5 giờ trước"). Chỉ qua `lib/dateFormat.ts`: `fmtDate` 17/10/2026, `fmtDayMonth` 17/10 (trục/chỗ hẹp), `fmtMonthYear` **T10/2026** (không "thg", không `T${…}` tự dựng), `fmtLongDate` "Thứ Bảy, 17/10/2026"; không ISO thô, không `toLocaleString`. |
| Tên menu / tiêu đề trang | **Một nhãn** | Tên mục menu = tiêu đề trang (h1); nguồn duy nhất `apps/web/src/lib/navLabels.ts` (sidebar, thanh tab, gợi ý trang gần đúng ở 404, sub-nav, trang). Cụm dài hơn đặt ở dòng mô tả. |
| Người thực hiện không rõ | **Hệ thống** / **Một thành viên** | "Hệ thống" CHỈ khi không có người thực hiện (automation/hệ thống); có người mà không tra được (tài khoản đã xoá) → "Một thành viên"; tên thật điền lúc đọc. Không "Ai đó". |
| Vai trò | **Tên tiếng Việt** (`roleLabel`) | Không hiện tên enum/khoá vai trò thô. |
| Giá trị enum / mã hành động | **Nhãn tiếng Việt** | Không lộ `TIME_SPENT`, `FUTURE/ACTIVE/CLOSED`…; hoạt động dự án in nhãn + icon. |
| Worklog / Saved filter / Custom field | **Nhật ký thời gian** / **Bộ lọc đã lưu** / **Trường thông tin thêm** | Mọi chuỗi hiển thị (nút, toast, aria-label, mô tả quyền, lỗi, hướng dẫn); chỉ `key`/route/mã giữ tiếng Anh. |
| Trạng thái sprint (người dùng thấy) | **chưa bắt đầu / đang chạy / đã kết thúc** | Không lộ enum `FUTURE / ACTIVE / CLOSED` trong thông báo lỗi. |

**Kiểm bằng máy (chặn tái phạm):** `apps/web/src/lib/terminology.test.ts` (Backlog / "đợt làm việc" / Cần làm–Đang làm / Board / issue / "vấn đề" ngoài RAID / task làm danh từ chung / mô tả quyền và vai trò), `apps/web/src/components/ui/noNativeDate.test.ts` (không `<input type=date|datetime-local|time>` ngoài `DateInput.tsx`), `apps/web/src/lib/terminology2.test.ts` (đợt 1 UI: "Huỷ", "Project ID", "bên trái", "dashboard", nhãn menu = tiêu đề qua `navLabels`, "Ai đó", enum thô, vai trò thô, ngày/tháng tự dựng), `apps/web/src/components/ui/noNativeSelect.test.ts` (không `<select>` native), `apps/api/src/common/terminology.spec.ts` (chuỗi API trả cho người dùng). Ngoại lệ được ghi chú ngay trong test: gloss "Việc chờ (backlog)" / "Bảng việc (Board)" ở trang Hướng dẫn, tên menu thật của Jira ("Export issues", "Xem tất cả issue"), thẻ phân tách prompt `<issue>`, dòng RAID "vấn đề". Nhãn nhóm trạng thái dùng chung `STATUS_CATEGORY_LABEL` (`@tirapro/types`, web re-export ở `lib/terms.ts`).

## Definition of Done (UX) cho mỗi màn
- [ ] Có thể hoàn thành task chính **chỉ bằng bàn phím**.
- [ ] Hành động chính ≤ 2 click / hoặc 1 lệnh Cmd+K.
- [ ] Optimistic + skeleton, không spinner chặn.
- [ ] Empty / loading / error / first-run state đầy đủ, dùng `EmptyState` (có icon; `compact` trong ô nhỏ) và `StatusPanel` (không tìm thấy / không có quyền / lỗi) — **không tự vẽ** khối trống hay màn lỗi.
- [ ] Ô chọn dùng `SegmentedControl` (≤ 4 mục ngắn) hoặc `SearchSelect`; không `<select>` native, không tự dựng dropdown. Ưu tiên hiện bằng `PriorityIcon`.
- [ ] Inline edit + quick-add nơi phù hợp.
- [ ] Undo cho hành động đảo được; confirm chỉ cho phá hủy.
- [ ] Tour + help cho màn; có `data-tour` anchors.
- [ ] Responsive (mobile→desktop) + AA + reduced-motion; dưới `lg` không phần tử cố định nào đè thanh tab đáy, không gợi ý phím trên cảm ứng.
- [ ] Concurrent edit: conflict hiện merge banner, không crash (OCC `version`).
- [ ] Notification của màn tuân quiet-by-default + coalesce.
- [ ] Nếu màn nhận input ngoài → đi qua Triage, không thẳng backlog.
- [ ] Bug/issue form: field nâng cao inline-expand, không dump; Severity tách Priority.
- [ ] Xóa = vào Trash, restore được; không mất dữ liệu không khôi phục; autosave draft.
- [ ] AI (nếu có ở màn): opt-in, write hiển thị diff + confirm, không báo done giả.
- [ ] Perf budget đạt (p95 < 100ms tương tác; first-paint < 1s/1.000 issue).
- [ ] Tính năng mới qua "thuế tĩnh lặng" (không làm màn chính ồn hơn).
- [ ] `/impeccable critique` không còn P0/P1.
- [ ] Chuỗi hiển thị đúng bảng thuật ngữ §19; ngày qua `dateFormat` (dd/MM/yyyy, T10/2026); thời gian tương đối tiếng Việt; tên menu = tiêu đề trang.
- [ ] Chạy `pnpm --filter @tirapro/web mobile:audit -- --route=<route mới>` (390px; 0 lỗi chặn hoặc có mục trong `scripts/mobile-audit.allow.json` kèm lý do). Màn có hộp thoại/popover mới: thêm kịch bản vào `DIALOG_SCENARIOS` trong `scripts/mobile-audit.mjs` rồi chạy `mobile:audit -- --dialogs`. Cần web + API + DB seed đang chạy (không nằm trong `pnpm test`).
