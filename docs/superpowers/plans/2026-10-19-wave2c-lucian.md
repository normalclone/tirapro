# Đợt 2 · Phần C — Gợi ý Lucian còn lại — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm các mẫu Lucian ở danh sách "Làm" của spec phần C (bỏ/hoãn theo spec), mỗi mẫu bám hành vi Lucian nhưng dùng token/primitive Tirapro.

**Architecture:** Đa số web; API đọc thuần additive cho 037, 092, 132b, 254, 163 (`expectedProgress`), 224; một migration cho 077 (`20261019100000_comment_reaction`). Một dependency mới có chủ đích: `@radix-ui/react-context-menu@2.3.1` (Task 19, pin đúng bản để dùng chung `@radix-ui/react-menu@2.1.18`).

**Tech Stack:** React 18, Radix, TanStack Query, dnd-kit, NestJS + Prisma, Socket.io, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-ui-std-wave2.md` (phần C). Kiểm kê: `inv-C1.md` (danh sách & biểu mẫu — mục theo mã mẫu, đề xuất chia task §C) và `inv-C2.md` (dữ liệu & cộng tác — mục theo mã mẫu, thứ tự rủi ro, bỏ/hoãn, ghi chú sai lệch) trong workspace SDD. Mỗi task ghi mã mẫu — ĐỌC mục tương ứng trước khi làm. Mô tả gốc từng mẫu: `docs/superpowers/ux-review/2026-10-17-lucian-mapping.md`.

## Global Constraints

- Như phần A/B (ràng buộc đợt 1, primitive đợt 1 + `Tabs`/`PageFrame`/`PageHeader`/`SectionCard` của phần A/B bắt buộc, test thuần/đọc-source, gate, không đụng hạ tầng dùng chung).
- Không thêm dependency ngoài `@radix-ui/react-context-menu@2.3.1` (Task 19).
- API mới: policy decorator, không lộ dự án riêng tư (`private-project-coverage`), ghi qua guard lưu trữ (`archived-coverage`), đọc model soft-delete lọc `deletedAt` (`soft-delete-project-scope`), OCC `version` cho mutation realtime, sự kiện sau commit. Migration tên `20261019xxxxxx_<name>`, `migrate deploy` chạy trên PG 16/18, `migrate diff --exit-code` sạch, `gen:enums --check`.
- Mỗi mẫu: không gradient/glass/bounce/side-stripe; `motion-reduce`; bàn phím đầy đủ; nhãn tiếng Việt §19.
- Mẫu nào đụng cùng file với task trước phải giữ hành vi task trước (ledger ghi lại).

## Review Focus

1. Quyền & riêng tư ở mọi API mới (092 đếm, 132b đếm, 254 người có quyền, 037 số thành viên, 077 reaction, 224 nguồn AI): người không xem được dự án không suy ra được gì.
2. Hàng loạt (178) & menu chuột phải (038): không phá kéo-thả (dnd-kit, nhấn giữ trên cảm ứng), có Hoàn tác, đúng quyền từng dự án.
3. Sheet đáy mobile (336) và panel xem nhanh: Esc/back/focus, không chặn cuộn trang, phím j/k không xung đột.
4. Biểu mẫu (244, 010, 030, 029): không đổi giá trị gửi API; lỗi được đọc bởi trình đọc màn hình.
5. 077 migration an toàn với dữ liệu thật, xoá bình luận xoá reaction, realtime không lộ ra phòng sai.

---

## Tasks

### Task 1: 008 — Sao chép mã/link chuẩn hoá
inv-C1 §008. Hook `useCopyToClipboard` + `issueUrl(key)` dùng chung (chi tiết, panel xem nhanh, nơi có nút sao chép); trạng thái ✓ 1.2s + toast ngắn; test thuần `issueUrl`. Commit `feat(web): sao chép mã và liên kết công việc dùng chung một cách`.

### Task 2: 269 — Gõ tên để xác nhận thao tác không đảo được
inv-C1 §269. `useConfirm`/`ConfirmDialog` thêm `requireText` (ô nhập, nút chính chỉ bật khi khớp, chuẩn hoá khoảng trắng; nêu hậu quả 1 dòng); áp cho Thu hồi API key và các xoá cứng inv-C1 liệt kê. Không làm purge Thùng rác/xoá dự án (hoãn). Test thuần `matchesConfirmText`. Commit `feat(web): xác nhận bằng cách gõ tên cho thao tác không đảo được`.

### Task 3: 244 nền — trường lỗi + tóm tắt lỗi
inv-C1 §244. `Input`/`SearchSelect`/`SegmentedControl` nhận `invalid` (aria-invalid + aria-describedby tới lời lỗi), `lib/formErrors.ts` (focus trường lỗi đầu tiên theo thứ tự DOM, đếm lỗi), `components/ui/ErrorSummary.tsx` ("3 trường cần sửa", liên kết tới từng trường, `role="alert"`). Không rung. Test thuần. Commit `feat(web): nền tảng báo lỗi biểu mẫu — trường lỗi, tóm tắt, đưa tới lỗi đầu tiên`.

### Task 4: 244 áp dụng — Báo cáo định kỳ, SLA, Tạo việc/Báo lỗi
inv-C1 §244. Submit lỗi → `ErrorSummary` đầu form + focus trường lỗi đầu; giữ nguyên validate hiện có. Commit `feat(web): biểu mẫu báo cáo định kỳ, SLA, tạo việc dẫn thẳng tới lỗi`.

### Task 5: 244 + 132a — Quy tắc tự động hoá: lỗi theo trường + điều kiện thành câu
inv-C1 §244, inv-C2 §132. RuleEditor: thay banner lỗi đầu tiên bằng lỗi theo trường + `ErrorSummary`; điều kiện hiển thị thành câu "Loại việc là Bug **và** …" (VÀ cố định — engine chỉ VÀ; gợi ý dùng điều kiện JQL nếu cần HOẶC). Không đổi payload. Commit `feat(web): quy tắc tự động hoá báo lỗi theo trường và đọc điều kiện thành câu`.

### Task 6: 015a — Nhóm chip ngắn → `SegmentedControl`
inv-C1 §015 (HealthOverrideCard, ReportIssueModal ×2, RaidEditorModal). Commit `refactor(web): nhóm chọn ngắn dùng SegmentedControl`.

### Task 7: 015b — `RadioCard` cho lựa chọn có mô tả
inv-C1 §015. `components/ui/RadioCard.tsx` (radiogroup, roving tabindex qua `lib/radioNav`, mô tả, icon tuỳ chọn, `disabled`, `invalid`); thay ≥6 khối lặp. Test đọc-source + thuần. Commit `feat(web): RadioCard dùng chung cho lựa chọn có mô tả`.

### Task 8: 355 + 023 — `SaveStatus`, `Switch`, cài đặt thông báo mở rộng
inv-C1 §355, §023. `components/ui/Switch.tsx` (role switch, nhãn, mô tả), `components/ui/SaveStatus.tsx` (Đang lưu… / Đã lưu lúc HH:mm / Lỗi · Thử lại, `aria-live="polite"`); `NotificationSection`: bật một kênh thì mở tuỳ chọn con ngay dưới, lưu ngay có optimistic + SaveStatus thay toast "Đã lưu". Commit `feat(web): Switch và chỉ báo lưu dùng chung; cài đặt thông báo bật là mở tuỳ chọn con`.

### Task 9: 144 — Sửa cột bảng kết quả bộ lọc
inv-C1 §144. Bấm tiêu đề cột → menu "Dời trái/Dời phải/Ẩn cột" + "Hiện lại cột ẩn"; lưu theo người dùng (localStorage có try/catch hoặc lưu vào bộ lọc nếu đã có trường — theo inv). Test thuần thao tác thứ tự cột. Commit `feat(web): sắp xếp và ẩn cột ở bảng kết quả bộ lọc`.

### Task 10: 010 — Nút tách ở footer Tạo công việc
inv-C1 §010. `components/ui/SplitButton.tsx` (nút chính + menu ▾: "Tạo & nhập tiếp", "Tạo & mở"); footer còn Huỷ + 1 nút tách; Cmd+Enter giữ hành vi cũ. Commit `feat(web): nút tách ở footer tạo công việc`.

### Task 11: 033 — `InlineText` dùng chung
inv-C1 §033. Sửa tiêu đề inline (chi tiết + panel xem nhanh): Enter lưu, Esc huỷ, IME an toàn (không gửi khi đang gõ dấu), không gửi đôi; ✓/✕ + SaveStatus. Test thuần reducer. Commit `feat(web): sửa tiêu đề tại chỗ dùng chung, an toàn với bộ gõ tiếng Việt`.

### Task 12: 273a — Panel xem nhanh: ‹ ›, "n/N", tô thẻ đang xem
inv-C1 §273. Nút ‹ › trong header peek (đồng bộ j/k hiện có), "3/25", thẻ/dòng đang xem được tô ở Bảng việc/Việc chờ. Commit `feat(web): panel xem nhanh có nút trước/sau và vị trí n/N`.

### Task 13: 273b — Panel xem nhanh cho Bộ lọc và Cây việc
inv-C1 §273. `PeekOrderContext` cung cấp thứ tự danh sách; Bộ lọc/Cây việc mở peek thay vì rời trang (giữ Cmd/Ctrl+click mở trang). Commit `feat(web): xem nhanh công việc từ kết quả bộ lọc và cây việc`.

### Task 14: 030 — `DateRangeInput`
inv-C1 §030. Hai ô ngày + tóm tắt "14 ngày · 20/10 – 02/11", kiểm kết thúc ≥ bắt đầu; thay 6 cặp ngày (sprint bắt đầu/sửa, …). Lịch hai đầu hoãn. Test thuần. Commit `feat(web): ô khoảng ngày dùng chung cho sprint và các form có cặp ngày`.

### Task 15: 029a — `LABEL_PALETTE` + `ColorPicker`
inv-C1 §029. 8 màu (lưu hex như API yêu cầu, hiển thị qua ánh xạ token OKLCH sáng/tối), `ColorPicker` chung, `labelTone()`; thay 4 bảng màu + `<input type=color>` ở các form nhãn/nhóm/vai trò. Không migration. Test thuần ánh xạ. Commit `feat(web): một bảng màu nhãn và bộ chọn màu dùng chung`.

### Task 16: 029b — Ô nhãn có màu, tạo nhãn khi gắn (người có quyền)
inv-C1 §029. Combobox nhãn: chip màu theo palette, Enter tạo nhãn mới chỉ khi người dùng có quyền quản trị dự án (như hiện nay), Backspace 2 lần gỡ chip cuối; người không có quyền thấy gợi ý "Nhờ quản trị dự án tạo nhãn". Commit `feat(web): ô nhãn có màu, tạo nhãn ngay khi gắn với người có quyền`.

### Task 17: 289 — Popover "Hiển thị" của Bảng việc
inv-C1 §289. Mật độ (Gọn/Thường), trường hiện trên thẻ (người phụ trách, điểm, hạn, nhãn…), xem trước trực tiếp; lưu theo người dùng. Commit `feat(web): tuỳ chọn hiển thị thẻ trên bảng việc`.

### Task 18: 336c — Dải thuộc tính chính trên trang chi tiết mobile
inv-C1 §336. Dưới `md`: dải trạng thái/người phụ trách/hạn/ưu tiên ngay dưới tiêu đề (bấm để sửa như cũ); phần thuộc tính còn lại gom accordion "Thuộc tính khác". Commit `feat(web): chi tiết công việc trên điện thoại hiện thuộc tính chính ngay dưới tiêu đề`.

### Task 19: 038 — Menu chuột phải
inv-C1 §038. Thêm `@radix-ui/react-context-menu@2.3.1` (pin chính xác); `IssueContextMenu` dùng chung nội dung với menu "…" (mở, sao chép mã/link, đổi trạng thái, giao cho tôi, chuyển sprint…, theo quyền); áp cho thẻ Bảng việc, dòng Việc chờ trước, rồi dòng bộ lọc, cây việc; tắt trên `pointer: coarse` (không đụng nhấn giữ của dnd-kit); Shift+F10 mở bằng bàn phím. Commit `feat(web): menu chuột phải cho thẻ và dòng công việc`.

### Task 20: 178a — Chọn nhiều + dock hàng loạt cho Bảng việc
inv-C1 §178. Tách `useBulkSelection` + `BulkDock` (dock nổi đáy, mobile 1 hàng + "…") + `useBulkEdit` có invalidate đúng cache board; Việc chờ chuyển sang dùng (không đổi hành vi); Bảng việc: chọn bằng ô chọn trên thẻ/Shift-click; sau thao tác toast Hoàn tác. Commit `feat(web): chọn nhiều và thao tác hàng loạt trên bảng việc`.

### Task 21: 178b — Hàng loạt cho kết quả Bộ lọc (nhóm theo dự án)
inv-C1 §178. Chọn nhiều ở bảng kết quả; hành động áp theo từng dự án (gọi bulk API theo nhóm dự án, báo kết quả từng nhóm), ẩn hành động không áp được đa dự án; Hoàn tác theo nhóm. Commit `feat(web): thao tác hàng loạt trên kết quả bộ lọc nhiều dự án`.

### Task 22: 336a/b — Panel xem nhanh dạng sheet đáy trên mobile
inv-C1 §336. Dưới `md`, peek mở bằng `Dialog placement="bottom"` 2 nấc (nửa màn / toàn màn) đổi bằng tay nắm hoặc nút; Esc/back đóng; focus trả về thẻ; không chặn j/k trên desktop. Commit `feat(web): xem nhanh công việc dạng sheet đáy trên điện thoại`.

### Task 23: 091 — Banner trạng thái kết nối
inv-C2 §091. Mất kết nối realtime > 3s → banner "Mất kết nối thời gian thực — đang thử lại… (thay đổi vẫn được lưu)"; nối lại → "Đã kết nối lại" rồi ẩn; `aria-live`. Không làm hàng đợi. Commit `feat(web): báo trạng thái kết nối thời gian thực`.

### Task 24: 197 — Tour có "Bỏ qua"
inv-C2 §197. Nút "Bỏ qua" mọi bước; phân biệt hoàn thành vs đã xem theo inv. Commit `feat(web): tour hướng dẫn có nút Bỏ qua`.

### Task 25: 299 — Đồng hồ WIP + sức chứa sprint bản nhẹ
inv-C2 §299. `LimitMeter` (số/giới hạn, cam ≥80%, đỏ khi vượt, chữ + màu) thay chip chữ WIP; sprint: so tổng điểm với velocity trung bình (không thêm cột). Test thuần ngưỡng. Commit `feat(web): đồng hồ giới hạn WIP và sức chứa sprint`.

### Task 26: 163 — `BulletBar`/`StatRow` hợp nhất, bỏ số to còn lại
inv-C2 §163. Hợp nhất `StatRow`/`StatStrip`/`PaceBar` thành `StatRow` + `BulletBar` (thực tế + vạch mục tiêu + "so với cam kết ±n") ở `components/ui`; thay `StatNumberWidget` số to; API thêm `GoalDto.expectedProgress` (đọc thuần) cho KR. Commit `feat: thanh tiến độ có vạch mục tiêu thay ô số to; StatRow dùng chung`.

### Task 27: 074 — Chuông thông báo có tab
inv-C2 §074. Tab Tất cả / Nhắc đến / Được giao trong popover (dùng `Tabs`), avatar người làm + icon loại hành động. Commit `feat(web): popover thông báo có tab và avatar người làm`.

### Task 28: 285 thích nghi — Đổi vai trò ngay trên hàng thành viên
inv-C2 §285. Bấm badge vai trò trên hàng → `SearchSelect`/`RoleMultiSelect` đổi ngay (đúng quyền), Hoàn tác; không có lời mời/hàng "Đang chờ". Commit `feat(web): đổi vai trò thành viên ngay trên hàng`.

### Task 29: 268 — "Sẽ thông báo" dưới ô bình luận
inv-C2 §268. Hiển thị avatar những người sẽ nhận thông báo (người được @, người phụ trách, người theo dõi — theo quy tắc thật của server) khi đang gõ. Commit `feat(web): cho biết ai sẽ được thông báo khi gửi bình luận`.

### Task 30: 037 — Số thành viên trong bộ chọn không gian
inv-C2 §037. API `/auth/workspaces` thêm `memberCount` (đếm thành viên đang hoạt động); switcher mục 2 dòng. Spec API. Commit `feat: bộ chọn không gian làm việc hiện số thành viên`.

### Task 31: 092 — Gợi ý nới bộ lọc khi không có kết quả
inv-C2 §092. `POST /search/relax-counts` (JQL → đếm khi bỏ từng mệnh đề cấp cao, tối đa 8 mệnh đề, timeout, cùng bộ lọc quyền như tìm kiếm) + `serializeJqlNode`; UI trạng thái trống liệt kê "Bỏ <điều kiện> → N việc" bấm được. Spec quyền riêng tư. Commit `feat: gợi ý bỏ bớt điều kiện khi bộ lọc không có kết quả`.

### Task 32: 132b — "Khớp N việc hiện có" cho quy tắc tự động hoá
inv-C2 §132. `POST /automation/rules/preview-match` (điều kiện trường → Prisma where, spec đối chứng với `evalFieldCondition`; điều kiện JQL qua JQL); hiển thị dưới câu điều kiện. Commit `feat: xem trước số việc khớp điều kiện quy tắc`.

### Task 33: 254 — Chia sẻ: ai có quyền + sao chép link nội bộ
inv-C2 §254. ShareDialog bảng tổng quan: danh sách người/nhóm có quyền xem, đổi phạm vi như hiện có, "Sao chép liên kết"; bộ lọc: hook cập nhật + route `/filters/:id` + cùng hộp chia sẻ. Không link công khai. Commit `feat: hộp chia sẻ cho bảng tổng quan và bộ lọc`.

### Task 34: 184 — Ma trận quyền chỉnh được cho vai trò tuỳ chỉnh
inv-C2 §184. Bảng nhóm quyền × vai trò; ô của vai trò tuỳ chỉnh bấm bật/tắt (PATCH sẵn có, OCC), vai trò hệ thống khoá + nút "Nhân bản vai trò"; Hoàn tác; test sự kiện `ACCESS_CHANGED`. Commit `feat(web): chỉnh quyền vai trò tuỳ chỉnh ngay trên ma trận`.

### Task 35: 171/181 — Nhân lực: ngân sách năng lực + "còn trống"
inv-C2 §109/181/171. Đồng hồ phân bổ theo nhóm (dùng `LimitMeter`), ô chọn người phụ trách hiện "còn trống N giờ/tuần" khi có dữ liệu. Không đổi model. Commit `feat(web): đồng hồ năng lực và gợi ý người còn trống`.

### Task 36: 077 — Thả cảm xúc vào bình luận
inv-C2 §077. Migration `20261019100000_comment_reaction` (`CommentReaction` commentId,userId,emoji, unique; xoá theo bình luận), endpoint toggle (quyền xem công việc + guard lưu trữ), 6 emoji cố định, WS `comment:reaction` chỉ `{commentId, issueId}` vào phòng của công việc; cập nhật 4 spec bảo vệ (`rbac-coverage`, `private-project-coverage` PROJECT_MODELS/READ_ALLOWLIST, `archived-coverage`, `soft-delete-project-scope`); UI popover chọn emoji + chip đếm (bàn phím được). Commit `feat: thả cảm xúc vào bình luận`.

### Task 37: 224 — Câu trả lời AI có nguồn
inv-C2 §224. `AiSuggestResult.sources` (id/mã công việc đã lọc theo quyền người xem); UI số nguồn bấm mở công việc; "Đang phân tích…" + Huỷ phía client; không stream. Heuristic khi không có khoá AI vẫn chạy. Commit `feat: câu trả lời AI kèm nguồn công việc`.

### Task 38: Tài liệu & release notes phần C
`DESIGN.md`/`UX_CONVENTIONS.md`: các primitive mới (ErrorSummary, RadioCard, Switch, SaveStatus, SplitButton, InlineText, DateRangeInput, ColorPicker/LABEL_PALETTE, BulkDock, IssueContextMenu, LimitMeter, BulletBar/StatRow); release notes "# Giao diện đợt 2 · Phần C" (Cần làm khi triển khai: migration 077 + deploy API; thay đổi người dùng thấy; còn mở: các mục hoãn của spec). Commit `docs: release notes và tài liệu chuẩn phần C`.
