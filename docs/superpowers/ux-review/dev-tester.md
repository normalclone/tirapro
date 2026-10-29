# Đánh giá UX — Developer (dev@tirapro.dev) và Tester/QA (tester@tirapro.dev)

Phương pháp: Playwright (chromium 1440×900, thêm 390×844), script ở `dev-tester/t*.js`, ảnh ở `dev-tester/shots/`. Thao tác qua UI; DB chỉ đọc. Dữ liệu tôi đã đụng vào: DEMO-STORY-3 (nhận, ghi 1h30m, 2 bình luận, đã trả về To Do nhưng vẫn gán cho Dũng), DEMO-TASK-1 / DEMO-STORY-5 (đã kéo rồi trả lại To Do), tạo DEMO-BUG-6 (tester, **không xoá được** — xem T11) kèm 2 bước checklist, 1 ảnh, 1 liên kết relates-to STORY-3. Ngoài ra tôi thử `POST /dev/repositories` bằng tài khoản admin qua API để dựng webhook (lỗi 404, không tạo gì) và gọi API báo lỗi trùng tiêu đề trên bug của chính mình (DEMO-BUG-6).

Mã nguồn đã tra để lấy bằng chứng: `/Users/inrnee/tirapro/apps/{web,api}/src/...` (chỉ đọc).

---------------------------------------------------------------------

# PHẦN 1 — DEVELOPER (Dũng)

## 1. Ấn tượng 5 phút đầu
- Đăng nhập vào thẳng trang "Tổng quan" chào theo tên ("Chào buổi chiều, Dũng (Dev)") — ngôn ngữ tiếng Việt tự nhiên, nhất quán, không lẫn thuật ngữ khó. Ảnh `shots/d01-landing.png`.
- Ngày đầu chưa được giao việc nào nên trang chủ là 3 khối rỗng ("Không có việc ưu tiên cao…", "Bạn chưa được giao việc nào"). Empty state có chữ giải thích nhưng **không có nút hành động kế tiếp** (xem việc chưa gán / mở board) — vi phạm `UX_CONVENTIONS §8`. Dev mới phải tự đoán đi "Dự án".
- Bấm "Dự án" nhảy thẳng vào board dự án gần nhất (tốt — 1 click). Board nhanh, thẻ gọn, mật độ ổn (`d03-board.png`).
- Có 2 thanh bên (menu chính + danh sách dự án) trong khi chỉ có 2 dự án => ở 1440px chỉ thấy ~2,5 cột, cột Done nằm ngoài màn hình (phải cuộn ngang).
- Không có tour/onboarding hiện ra lần đầu; icon "?" ở topbar bấm không thấy gì rõ ràng trong test của tôi (chưa kết luận được).
- Tốc độ: bấm thẻ → trang issue hiển thị ~100 ms, quay lại board ~17 ms (prefetch/cache hiệu quả). Không lỗi console trong các luồng chính.

## 2. Việc thật → kết quả

| # | Việc thật của dev | Kết quả | Ghi chú / ảnh |
|---|---|---|---|
| D1 | Sáng mở app xem "việc của tôi" | Được | Trang chủ có "Ưu tiên cao / Sắp trễ hạn / Việc của tôi" + 3 số liệu (`d35-bell.png`). Không hiện trạng thái từng việc, không nhóm theo dự án. Ngày đầu rỗng, không CTA. |
| D2 | Nhận việc (gán cho mình) | Dễ | Nút "Gán cho tôi" + phím `i` + Cmd+K "Giao cho tôi"; toast "Đã giao việc này cho bạn" (`d08-after-i.png`). |
| D3 | Chuyển trạng thái bằng bàn phím / Cmd+K | Dễ | Phím `1..9` = bước kế tiếp, nút hiện số gợi ý, toast "Đã chuyển sang … · Hoàn tác" (`d09-after-1.png`). Cmd+K có "Đổi trạng thái →". **Nhưng** `i`, `y`, `1-9` không có trong bảng phím tắt `?` (xem D-4). |
| D4 | Kéo thẻ trên board | Dễ | Chuột OK + bàn phím (Tab tới thẻ, Space, mũi tên, Space) OK, có aria-live "Đã thả … vị trí 2/6" (`d23/d24`). Tab phải qua ~30 điểm dừng mới tới thẻ đầu tiên, không có "skip to board". |
| D5 | Ghi thời gian | Dễ | Phím `w` mở form inline, gõ `1h 30m` + Enter → ghi ngay (`d12/d13`). Có chip 30m/1h/2h/1d. Nút FAB tròn che phần dưới form khi form mở ở cột phải. |
| D6 | Bình luận + @mention đồng nghiệp | **Không làm được @mention** | Bình luận được (Cmd+Enter), nhưng gõ `@Tester` chỉ là chữ thường — không có popup chọn người, không có thông báo (bảng `Mention` = 0 dòng). Xem D-1. Ngoài ra nút "Bình luận" trên toolbar không focus ô nhập (D-3). |
| D7 | Liên kết commit/PR (dev-links, webhook) | **Không làm được** | Form "Thêm repo" lỗi cho cả admin: "Không tìm thấy dữ liệu…" (`d31-admin-add-repo.png`). Xem D-2. |
| D8 | Xem chi tiết issue nhanh | Được | Mở trang đầy đủ, rất nhanh nhưng mất bối cảnh board (không có peek/side panel). Bình luận nằm dưới màn hình, phải cuộn qua mô tả/checklist/liên kết/đính kèm. |
| D9 | Tìm issue (không dấu, mã, JQL) | Dễ (Cmd+K) / Được (JQL) | Cmd+K: `gio hang` → DEMO-BUG-2; `safari`, `DEMO-BUG-2`, `bug-2` đều ra. `/` mở palette. JQL: `text ~ "gio hang"` OK, `labels = frontend` OK. Xem D-9 cho lỗi gợi ý. |
| D10 | Thông báo | Được | Chuông có số, danh sách theo thời gian, bấm vào mở issue. Thiếu ai làm gì, giờ tiếng Anh, không gộp (xem D-6). |
| D11 | Làm việc hoàn toàn bằng bàn phím | Được | Có: `c`, `/`, `g b`, `g l`, `g d`, `?`, `w`, `i`, `y`, `1-9`, Cmd+K, kéo thả bằng phím. Thiếu: `j/k`, `e`, `a`, `m` (UX_CONVENTIONS §2 hứa) — bấm `j` trên board không làm gì (`d20`). |
| D12 | Tích hợp API / MCP | Khó | Dev không tự tạo được API key (403, "Chỉ quản trị chung…"). Trang vẫn gọi `/api-keys` và lỗi 403 x2 trong console (`d37-api.png`). |
| D13 | Dùng trên điện thoại | Được | Không tràn ngang; board 1 cột; nhưng tiêu đề issue bị ép 7 dòng cạnh nút "Theo dõi" (`m03-issue.png`). |

## 3. Góp ý (theo mức ảnh hưởng)

### 🔴 D-1. @mention không tồn tại trên giao diện (backend có, FE không nối)
- Hiện trạng: ô bình luận chỉ có B / I / code / H2 / list / link / image (`d15-mention-popup.png`). Gõ `@tes` không có gợi ý. `grep mentionUserIds apps/web/src` = 0 kết quả; backend đã nhận `mentionUserIds` ở `apps/api/src/modules/comments/comments.service.ts:55-66` và Cài đặt → Thông báo còn hứa "Được nhắc đến (@) — Khi ai đó @ bạn trong bình luận" (`features/settings/NotificationSection.tsx:13`). Tôi gửi bình luận "nhờ @Tester kiểm tra giúp": tester **không** nhận thông báo, `select count(*) from "Mention"` = 0 (`d16-comment-posted.png`).
- Vì sao quan trọng: dev→tester là vòng giao việc thường xuyên nhất ("code xong, nhờ test"). Không @ được = phải nhắn Slack/Zalo bên ngoài, sản phẩm mất đúng vai trò trung tâm. Tệ hơn: UI hứa mà không làm (lỗi niềm tin).
- Đề xuất: gõ `@` mở popup thành viên dự án (đã có `GET /users` "picker assignee/@mention", `users.controller.ts:38`), chèn `@Tên` và gom `mentionUserIds` khi gửi; nút `@` trên toolbar; hiển thị mention dưới dạng chip trong bình luận đã đăng.
- Công: M.

### 🔴 D-2. Tích hợp GitHub/GitLab (dev-links, webhook) không thể thiết lập — kể cả admin
- Hiện trạng: `RepositorySection.tsx:77` gửi `integrationId: provider` (chuỗi "GITHUB"), chú thích bảo "backend tự khớp theo workspace" nhưng `dev-links.service.ts:152-156` tìm `integration.findFirst({ id: input.integrationId })` → luôn `NotFound`. Không có endpoint nào tạo Integration loại GITHUB/GITLAB (`integrations.controller.ts` chỉ có `POST integrations/telegram`). Kết quả UI: admin bấm "Thêm repo" → toast "Không tìm thấy dữ liệu. Có thể nó vừa bị xoá hoặc đường dẫn không đúng." (`d31-admin-add-repo.png`; API trả 404 `POST /dev/repositories`; `Integration`=0, `CodeRepository`=0). Do đó panel "Liên kết code" trong issue (`IssueDetailPage.tsx:688`) và webhook `/dev/webhook/:repositoryId` không bao giờ có dữ liệu — tôi không thể kiểm thử luồng commit→issue.
- Vấn đề phụ: (a) Dev không có quyền (`integration:manage`) vẫn thấy form và chỉ biết 403 sau khi điền hết (toast "Bạn không có quyền…", `d29`), (b) nhãn "externalId" chưa Việt hoá và bắt người dùng tự tìm ID số của repo, (c) nút sao chép webhook chỉ chép đường dẫn tương đối `/api/v1/dev/webhook/{id}` (`RepositorySection.tsx:251`) — không phải URL đầy đủ để dán vào GitHub, (d) không có hướng dẫn "dán vào GitHub → Settings → Webhooks, chọn push + pull request", không hiện secret/ping thử.
- Vì sao quan trọng: "liên kết commit/PR vào issue" là lý do chính dev chọn tool thay Jira; hiện chức năng này chết hoàn toàn.
- Đề xuất: sửa BE tự tạo/tìm Integration theo `(workspaceId, type)` khi thêm repo; ẩn form theo quyền; chép URL tuyệt đối; thêm hướng dẫn 3 bước + nút "Gửi ping thử"; hiển thị commit/PR gần nhất trên thẻ board (icon nhánh).
- Công: M.

### 🟠 D-3. Nút "Bình luận" cuộn xuống nhưng không đặt con trỏ → gõ tiếp bị phím tắt toàn cục nuốt
- Hiện trạng: `IssueDetailPage.tsx:321-327` (`jumpToComments`) chỉ `scrollIntoView`, trong khi đường Cmd+K "Thêm bình luận" (`:331-350`) mới focus textarea. Test: bấm nút "Bình luận", gõ "Đã code xong… nhờ @Tester" → focus vẫn ở nút (`activeElement=BUTTON`), phím `c` bật hộp "Tạo công việc" và phần còn lại của câu rơi vào ô Tiêu đề (`d17`, kết quả dump: Tiêu đề = "ode xong phần UI, nhờ @Tester…").
- Vì sao quan trọng: người dùng bấm nút tưởng sẽ viết ngay; mất chữ và mở hộp tạo việc ngoài ý muốn — cảm giác "app hỏng".
- Đề xuất: dùng cùng hàm focus như đường Cmd+K (retry tới khi textarea lazy-mount); thêm phím tắt `m`/`Enter` trên issue.
- Công: S.

### 🟠 D-4. Phím tắt hứa nhiều hơn làm được và không khám phá được
- Hiện trạng: bảng `?` chỉ có 8 phím (`components/layout/ShortcutsDialog.tsx:10-27`); thiếu `i` (gán cho tôi), `y` (chép link), `1-9` (đổi trạng thái) — những phím mạnh nhất của dev, hiện chỉ có `1/2` mờ trên nút (`IssueDetailPage.tsx:254-268`). UX_CONVENTIONS §2 hứa `j/k`, `e`, `a`, `m` — không có (bấm `j` trên board: không focus thẻ nào, `d20`). Tab tới thẻ đầu phải ~30 lần (`t12.js`), không có "skip to content".
- Vì sao quan trọng: nguyên tắc "keyboard-first" là điểm bán so với Jira; phím tắt giấu kín thì không ai dùng.
- Đề xuất: bổ sung đủ phím vào `?` (nhóm theo "Trong issue/Trên board"), thêm `j/k` di chuyển giữa thẻ và `Enter` mở, `a` gán, `m` chuyển cột; tooltip hiện phím trên nút.
- Công: M.

### 🟠 D-5. "Thành phần" và "Phiên bản (fix)" trông như đã gắn vào issue nhưng thực ra là danh mục dự án
- Hiện trạng: `IssueComponentsPicker.tsx:36` hiển thị dòng nhỏ "Chưa thể chỉnh sửa thành phần & phiên bản của công việc tại đây — chỉ xem danh mục của dự án" rồi render **mọi** thành phần/phiên bản dưới dạng chip giống nhau (`d06-issue-page.png`). Người đọc hiểu "issue này thuộc Backend + Frontend + Hạ tầng + Thanh toán, fix v1.0 + v1.1 + v2.0", bấm không có gì xảy ra. File ghi rõ lý do: BE chưa trả tập đã gắn (`:7-10`).
- Vì sao quan trọng: thông tin sai trên mọi issue; dev release/QA dựa vào "fix version".
- Đề xuất: ẩn khối này cho tới khi BE trả `components[]/fixVersions[]` của issue; khi có thì chip chọn/bỏ.
- Công: M (BE) / S (tạm ẩn).

### 🟠 D-6. Thông báo thiếu ngữ cảnh, giờ tiếng Anh, không gộp
- Hiện trạng: mục "Đổi trạng thái DEMO-STORY-3 — Thêm xác thực 2 lớp (2FA)" không nói ai đổi, đổi sang đâu; "Bình luận" không có trích đoạn; thời gian "less than a minute ago", "5 minutes ago" (tiếng Anh giữa giao diện tiếng Việt, trong khi bình luận dùng "dưới 1 phút trước"). 3 thông báo "Đổi trạng thái PSL-STORY-2" liên tiếp không được gộp (`d38-dev-bell-after-qa.png`) dù UX_CONVENTIONS §11 yêu cầu coalesce. "Được giao" không nói ai giao. Không có trang "Tất cả thông báo", không lọc "chưa đọc".
- Đề xuất: tiêu đề kiểu "Trang chuyển DEMO-STORY-3 → In Review", trích 80 ký tự bình luận; dùng cùng formatter thời gian Việt hoá; gộp theo issue trong 60s; thêm trang /notifications.
- Công: S–M.

### 🟠 D-7. Bố cục: FAB và hai thanh bên cạnh tranh không gian
- Hiện trạng: FAB tròn bên phải dưới che toast "Hoàn tác" (`d09-after-1.png`), che nút lưu worklog (`d12-worklog-w.png`), che nút "Thêm việc…" của cột cuối. Hai thanh bên chiếm ~415px ở 1440px nên board chỉ thấy 2,5 cột (`d03-board.png`).
- Đề xuất: dời toast lên trên FAB (hoặc dịch FAB khi toast hiện), tự thu gọn thanh danh sách dự án khi < 4 dự án / cho ghim ẩn; cho "Done" cột thu gọn.
- Công: S.

### 🟡 D-8. JQL còn thô
- Không autocomplete tên trường/giá trị; ô JQL trống khi chọn bộ lọc đã lưu (không thấy câu lệnh của chính nó) (`d33`); `status = "In Progresss"` (sai giá trị) trả "Bộ lọc hiện tại quá hẹp" thay vì "Không có trạng thái 'In Progresss' — ý bạn là 'In Progress'?"; `assignee = me` trả rỗng im lặng (phải dùng `currentUser()`); JQL lỗi cú pháp thì hiện lỗi **và** khối "Không có công việc nào khớp" cùng lúc (`d34`). Kết quả chỉ có mã, tiêu đề, avatar — không có cột trạng thái/loại/người, không sắp xếp, không xuất.
- Đề xuất: autocomplete + validate giá trị + alias `me`; cột kết quả cấu hình được; xuất CSV.
- Công: M.

### 🟡 D-9. Khác
- Trang chủ ngày đầu rỗng không có CTA (xem 1). Công S.
- Dev không tự cấp API key/PAT (D12); MCP URL `http://localhost:4100/mcp` hiện ra nhưng server không chạy ở môi trường test (không kiểm chứng được tool). Công M.
- Mobile: tiêu đề issue bị ép hẹp cạnh nút "Theo dõi" (`m03`); nên xuống dòng nút. Công S.
- Ô "Hạn hoàn thành" trong hộp tạo việc là input date native hiện `mm/dd/yyyy` kiểu Mỹ (`d21-create-c.png`) trong khi hộp gợi ý `^15/8` kiểu Việt. Công S.
- Loại liên kết hiển thị tiếng Anh ("blocks", "relates to", "is blocked by") dù giao diện tiếng Việt. Công S.

## 4. Tính năng còn thiếu (so Jira/Linear) — ưu tiên
1. P0: @mention + thông báo; webhook GitHub/GitLab hoạt động; tên nhánh/PR hiển thị trên thẻ.
2. P1: tạo tên nhánh git từ issue ("Chép tên nhánh `feature/DEMO-3-...`" — Linear làm bằng 1 phím); PAT cá nhân; phím `j/k/e/a/m`.
3. P1: xem nhanh issue ở panel bên (peek) từ board/backlog; bộ lọc "Của tôi + loại + nhãn" trên board.
4. P2: "Subscribe" thông báo theo mức (tất cả/@/không); trang thông báo đầy đủ; bulk edit trên backlog bằng phím.

## 5. Điểm làm tốt nên giữ
- Tốc độ: 100 ms mở issue, optimistic + Hoàn tác toast cho mọi chuyển trạng thái.
- Phím `1..9`, `i`, `w` trên trang issue — rất hợp tay dev; chuỗi `1h 30m` hiểu tự nhiên.
- Cmd+K: tìm không dấu, nhảy theo mã (`bug-2`), hành động theo ngữ cảnh issue.
- Kéo thả có bàn phím + thông báo cho trình đọc màn hình.
- Quick-add token trong hộp tạo việc (`!ưu-tiên @người #sprint ~điểm ^hạn`) và mẫu mô tả tự điền theo loại (Bug/Story/Task).
- Cài đặt thông báo mặc định "yên tĩnh"; thông báo gửi đúng người (assign/comment/đổi trạng thái đến dev sau khi tester thao tác).
- Visual filter builder sinh JQL song song cho người mới.

---------------------------------------------------------------------

# PHẦN 2 — TESTER / QA (Trang)

## 1. Ấn tượng 5 phút đầu
- Giao diện giống Dev: trang chủ rỗng ("Bạn chưa được giao việc nào") — tester thường không được giao việc nên trang chủ vô dụng; không có khối "Bug tôi báo / Bug chờ tôi xác nhận".
- Không thấy chỗ báo lỗi: nút "Tạo công việc" (xanh, nổi bật) dẫn tới form chung; "Báo lỗi" nằm ẩn trong speed-dial của nút FAB (`t07-fab.png`) và **không có trong Cmd+K** (palette chỉ có "Tạo công việc", đổi theme, tour, tài liệu).
- Menu "Phân loại (Triage)" nằm trong mục "Thêm" của project — rõ ràng là nơi bug đi tới, nhưng không được nhắc khi vừa gửi báo lỗi (toast trống trong test; chỉ biết vì tôi tự vào xem).
- Ngôn ngữ tiếng Việt thân thiện ("Báo lỗi / sự cố", "Có thể trùng"). Bug tạo từ "Tạo công việc" có mẫu "Các bước tái hiện / Kết quả hiện tại / Kết quả mong muốn" tự điền (`t06-create-bug.png`) — rất tốt.

## 2. Việc thật → kết quả

| # | Việc thật của tester | Kết quả | Ghi chú / ảnh |
|---|---|---|---|
| T1 | Báo bug mới (bước tái hiện, môi trường, ảnh) | Được, nhưng thiếu Severity/Environment ở form | Hai cửa vào khác nhau (xem T-3). Form "Tạo công việc" loại Bug có mẫu repro + đính kèm, **không có Severity, Môi trường**; "Báo lỗi" chỉ có Tiêu đề + Mô tả (`t08-report-modal.png`). Môi trường chỉ chọn được sau khi tạo (select production/staging/dev). |
| T2 | Kiểm tra trùng lặp | Khó / hiệu quả thấp | "Báo lỗi" có cảnh báo vàng "Có thể trùng: DEMO-BUG-2 …" (`t10-report-dup-match.png`) nhưng chỉ khi tiêu đề gõ là **chuỗi con** của tiêu đề cũ. `gio hang mat san pham`, `Giỏ hàng bị mất`, `Lỗi đăng nhập Safari` → rỗng (API `GET /intake/duplicates`). Xem T-2. |
| T3 | Gắn ảnh/nhật ký đính kèm | Được | Tải lên trong issue (toast "Đã tải lên tệp") — nhưng không có thumbnail/preview, chỉ tên tệp + dung lượng (`t16`). Chưa kiểm chứng dán ảnh từ clipboard. |
| T4 | Checklist kiểm thử | Được | "Các bước cần làm" có hộp tick + % tiến độ (`t15-attach-checklist.png`) — dùng được cho checklist tái hiện nhưng không phải test-case/test-run. |
| T5 | Chuyển trạng thái QA (In Review → Done / Reopen) | Dễ về thao tác, thiếu nghiệp vụ | Phím `1/2` và nút chuyển ngay, toast Hoàn tác. Nhưng: Done không hỏi **Resolution** (Done / Won't Do / Duplicate / Cannot Reproduce — bảng có sẵn nhưng `resolutionId` luôn null), Trả lại/Mở lại không hỏi lý do; nút đề tên trạng thái đích ("To Do", "In Progress") thay vì hành động ("Mở lại", "Trả lại") dù workflow có tên đó (`t18-workflow-dlg.png`). |
| T6 | Gắn bug vào story | Được | "Thêm liên kết" → chọn loại + gõ tay mã `demo-story-3` (không phân biệt hoa/thường) → ra liên kết "relates to DEMO-STORY-3" (`t35/t48`). Không có ô tìm issue, loại liên kết tiếng Anh, thiếu "gây ra bởi / kiểm thử bởi". |
| T7 | Theo dõi bug của sprint | Được | Board có huy hiệu Bug đỏ + hạn; báo cáo có "Công việc theo loại", "Tạo mới vs Đã xử lý" (`t28`). Backlog không hiện loại/trạng thái trên từng dòng (`t27-backlog.png`); board không có bộ lọc "Loại = Bug". |
| T8 | Bộ lọc "bug tôi báo" | Được nhưng 6+ bước | Phải vào Bộ lọc đã lưu → Tạo bộ lọc → thêm điều kiện "Người báo cáo = Tôi" + "Loại = Bug" (sinh `reporter IN (currentUser())`, `t25-built.png`). Không có chip nhanh "Tôi báo cáo" trên board/backlog. **Không** thể lọc theo Mức nghiêm trọng (không có trong 16 trường của builder). |
| T9 | Quy tắc tự động khi reopen | Không làm được (không có quyền) | Tester vào Kết nối → Tự động hoá: phạm vi mặc định là "PM Sprint Lab" thay vì dự án đang xem → "Bạn không có quyền quản lý quy tắc ở dự án này" (`t30-automation.png`). Không biết có/không quy tắc nào khi reopen (ví dụ giao lại cho dev). |
| T10 | Xuất danh sách bug | Không làm được | Chỉ có "Xuất / Nhập dữ liệu" trong cấu hình dự án = JSON cả dự án, cần quyền `import:run` (`export.controller.ts:15-31`). Không có CSV cho kết quả bộ lọc / backlog. |
| T11 | Phân loại (Triage) | Được | Hàng đợi với ×N lần báo, huy hiệu Major/Critical, "Nhận / Tạm hoãn / Từ chối" (`t12-triage.png`). Tester nhìn thấy cả nút xử lý. |

## 3. Góp ý (theo mức ảnh hưởng)

### 🔴 T-1. Severity (mức nghiêm trọng) có trong hệ thống nhưng không đặt/lọc/xem được ở đâu
- Hiện trạng: bảng `Severity` có Critical/Major/Minor/Trivial, Cài đặt → "Mức nghiêm trọng" cấu hình được, Triage hiển thị huy hiệu (`TriagePage.tsx:144-156`, chỉ hiện với dữ liệu seed). Nhưng `grep severity apps/web/src` chỉ ra Settings + Triage: **không** có ở form tạo (`CreateIssueModal.tsx`), form Báo lỗi, trang chi tiết issue (`d06`, `t13-bug-detail.png` chỉ có "Medium" priority), hay bộ lọc (`QueryBuilder.tsx:28-45`). Bug DEMO-BUG-6 của tôi hiển thị trong Triage với chấm vàng, không có huy hiệu mức độ (`t12-triage.png`).
- Vì sao quan trọng: tester quyết định thứ tự xử lý bằng Severity; UX_CONVENTIONS "Bug form & severity" yêu cầu Severity tách Priority, hover giải nghĩa. Hiện chỉ có Priority nên "Critical nhưng ít gấp" hay "Low priority nhưng crash" không diễn đạt được.
- Đề xuất: thêm trường Severity vào chi tiết issue (chỉ hiện với loại Bug), vào "Báo lỗi" dạng "mở rộng thêm" (Severity, Môi trường, Bước tái hiện), và vào bộ lọc/board; tooltip định nghĩa từng mức.
- Công: M.

### 🔴 T-2. Báo lỗi trùng tiêu đề bị gộp im lặng và nội dung mới bị vứt; gợi ý trùng quá yếu
- Hiện trạng: `intake.service.ts:60-90` — nếu tiêu đề chuẩn hoá (lowercase + gộp khoảng trắng) trùng một issue còn sống thì chỉ `occurrenceCount +1` và mở lại triage; **mô tả, đính kèm, người báo cáo mới không được lưu**. Thử: gửi lại đúng tiêu đề DEMO-BUG-6 với mô tả "BÁO LẠI trên iPad Pro 12.9 iOS 17.5 – có video" → API trả `deduped:true, occurrenceCount:2`; DB giữ nguyên mô tả cũ. Hộp "Có thể trùng" (`ReportIssueModal.tsx`, `intake.service.ts:132-147`) chỉ dùng `summary.includes(query)` sau khi bỏ hoa/thường — không bỏ dấu, không so từ khoá, không xếp hạng: `Lỗi đăng nhập Safari` không gợi ý "Lỗi đăng nhập trên Safari iOS"; còn mỗi lần gõ phím đọc **toàn bộ issue của dự án** trong bộ nhớ (hiệu năng khi dự án lớn). Gợi ý hiển thị nhưng không có hành động ("Vẫn tạo mới" / "Gộp vào DEMO-BUG-2 và thêm ghi chú"), không bấm xem được; người gửi không biết bấm "Gửi" sẽ gộp, chỉ thấy toast sau đó.
- Vì sao quan trọng: bug trùng tiêu đề nhưng khác môi trường là trường hợp rất phổ biến ("Nút đặt hàng không phản hồi" trên Android vs iOS). Mất bằng chứng là mất việc của tester.
- Đề xuất: (1) dùng `searchVector`/trigram + bỏ dấu cho gợi ý; (2) gợi ý có link mở tab mới, hai nút "Thêm ghi chú vào DEMO-BUG-2" (lưu mô tả/ảnh thành bình luận + người báo cáo thành watcher) / "Vẫn tạo bug mới"; (3) khi dedupe vẫn lưu mô tả mới thành bình luận; (4) toast nêu rõ "Đã gộp vào DEMO-BUG-2 (lần 2)" kèm link + Hoàn tác.
- Công: M.

### 🟠 T-3. Hai cửa báo bug khác nhau, mỗi cái thiếu một nửa
- "Báo lỗi" (speed-dial FAB, trang Triage): có kiểm tra trùng, đi vào Triage; **không** có đính kèm, loại, mẫu repro, Severity. "Tạo công việc" + Loại "Bug": có mẫu repro + đính kèm + sprint/điểm/hạn; **không** kiểm tra trùng, có vẻ đi thẳng backlog thay vì Triage (chưa kiểm chứng, so `UX_CONVENTIONS §15`), không Severity. Cmd+K không có "Báo lỗi". Nút nổi bật trên board là "Tạo công việc".
- Đề xuất: một form Bug duy nhất — "Báo lỗi" trong Cmd+K, nút trên header board và FAB; có đủ: Tiêu đề (+gợi ý trùng), Mô tả có mẫu, Severity, Môi trường, Đính kèm/dán ảnh, "Điền từ phiên hiện tại" (trình duyệt/OS/độ phân giải).
- Công: M.

### 🟠 T-4. Đóng/mở lại bug thiếu Resolution và lý do
- Hiện trạng: In Review → Done bằng một phím (`t40.js`: không dialog nào, `resolutionId` null — `select ... resolution` = rỗng); Reopen từ Done sang To Do cũng 1 phím không hỏi lý do. Bảng `Resolution` có Done / Won't Do / Duplicate / Cannot Reproduce / Incomplete nhưng UI chỉ dùng nó trong bộ lọc (`QueryBuilder.tsx:38`). Nút chuyển ghi tên trạng thái đích, không ghi tên hành động "Trả lại" / "Mở lại" dù workflow đặt tên (`t18-workflow-dlg.png`).
- Vì sao quan trọng: "Cannot Reproduce" / "Won't Fix" là kết luận hằng ngày của QA; báo cáo bug cần Resolution; trả bug lại không kèm lý do làm dev phải hỏi lại.
- Đề xuất: khi chuyển sang trạng thái nhóm Done hiện chọn nhanh Resolution (mặc định Done); khi Trả lại/Mở lại hiện ô "Lý do (tuỳ chọn)" tạo bình luận kèm; nhãn nút theo tên transition ("Mở lại").
- Công: M.

### 🟠 T-5. Theo dõi bug khó vì list không hiện loại/trạng thái/mức độ
- Backlog (`t27-backlog.png`): mỗi dòng = chấm ưu tiên + mã + tiêu đề + nhãn + điểm + người; không có icon loại, không trạng thái, không severity → không phân biệt Bug và Story ngoài đoán tên "BUG". Board không có bộ lọc theo Loại / Nhãn / Người báo cáo (chỉ Của tôi, Quá hạn, Chưa gán, Mọi người, Nhóm theo người). Kết quả JQL/Filter cũng thiếu cột (`d33`).
- Đề xuất: icon/loại + trạng thái trên dòng backlog; chip "Chỉ Bug", "Tôi báo cáo" trên board/backlog (nhớ theo người dùng); cột Severity.
- Công: S.

### 🟠 T-6. Quy tắc tự động mặc định sai phạm vi, tester không biết gì xảy ra khi reopen
- `/connect/automation` mở với phạm vi "PM Sprint Lab" (dự án khác dự án đang xem) và báo "Bạn không có quyền…" (`t30`). Nên mặc định theo dự án hiện tại và cho xem (read-only) danh sách quy tắc để tester biết "bug reopen sẽ tự giao lại cho dev".
- Công: S.

### 🟠 T-7. Liên kết & môi trường chưa phục vụ QA
- Liên kết phải gõ tay mã (không tìm kiếm tiêu đề), loại tiếng Anh ("blocks/clones/duplicates/relates to"), thiếu "gây ra bởi", "được kiểm thử bởi", "tìm thấy trong". "Môi trường" là select 1 giá trị (production/staging/dev), không có trình duyệt/OS/phiên bản/URL (`t48`).
- Đề xuất: ô tìm issue (typeahead tiêu đề+mã), Việt hoá loại liên kết, thêm "gây ra bởi/ được test bởi"; trường Môi trường nhiều dòng (trình duyệt, OS, build) có nút điền tự động.
- Công: S–M.

### 🟡 T-8. Khác
- Không xoá được bug tạo nhầm: menu "Thêm" của tester chỉ có "Sao chép liên kết" (`d10-more-menu.png`); DEMO-BUG-6 của tôi phải để lại. Reporter nên huỷ/xoá bug mình tạo trong 5 phút (vào Thùng rác). Công S.
- Xuất danh sách bug: chỉ JSON toàn dự án cho người có `import:run`; thiếu "Xuất CSV" cho kết quả bộ lọc/backlog/triage. Công M.
- Đính kèm không có thumbnail/lightbox, không thấy gợi ý dán ảnh (Ctrl+V) vào mô tả/bình luận. Công S.
- Trang chủ tester không có khối "Bug tôi báo chưa đóng", "Chờ tôi xác nhận". Công S.
- Báo cáo chưa có số liệu QA riêng: bug mở theo mức độ, tỷ lệ reopen, thời gian đóng trung bình, bug rò rỉ theo release. Công M.

## 4. Tính năng còn thiếu (so Jira/Linear) — ưu tiên
1. P0: Severity (đặt, lọc, hiện), Resolution khi đóng, lý do khi trả lại/mở lại.
2. P0: Dedupe thông minh + cho thêm ghi chú vào bug cũ thay vì nuốt.
3. P1: Form báo lỗi duy nhất + Environment có cấu trúc + dán ảnh/quay màn hình; mẫu bug theo dự án (Mẫu công việc đang trống mặc định).
4. P1: Quick filter "Bug", "Tôi báo cáo", cột loại/trạng thái trên backlog; xuất CSV.
5. P2: Quản lý test case/test run (Xray/Zephyr kiểu nhẹ) hoặc checklist có mẫu tái sử dụng; liên kết "kiểm thử bởi"; bảng điều khiển QA.

## 5. Điểm làm tốt nên giữ
- Mẫu mô tả Bug tự điền khi đổi loại; quick-add token; dán/kéo tệp trong form tạo.
- Cảnh báo "Có thể trùng" ngay lúc gõ + bộ đếm ×N trong Triage + nút Nhận/Tạm hoãn/Từ chối một chạm.
- Chuyển trạng thái cực nhanh (phím số, Hoàn tác); thông báo đổi trạng thái/bình luận tới đúng dev.
- Visual filter builder + "JQL sinh ra" + phạm vi chia sẻ (Riêng tư/Tổ chức/Dự án).
- Backlog ẩn thao tác sprint với tester (không gây nhầm lẫn quyền).
- Checklist gắn issue với % tiến độ, form worklog inline.

---------------------------------------------------------------------

## Phụ lục
- Ảnh chính: `d01-landing, d03-board, d05..d09 (issue, phím tắt), d12-worklog-w, d15-mention-popup, d16-comment-posted, d17-after-comment-btn, d21-create-c, d28/d31 (repo), d33/d34 (JQL), d35/d38 (chuông), d37-api, m02/m03 (mobile), t06-create-bug, t07-fab, t10-report-dup-match, t12-triage, t13-bug-detail, t15-attach-checklist, t16-link-dialog, t18-workflow-dlg, t25-built, t27-backlog, t28-reports, t30-automation`.
- Script tái chạy: `dev-tester/lib.js` + `t1..t52.js`; truy vấn DB: `dev-tester/q.sh`.
- Chưa kiểm chứng được: panel "Liên kết code" với dữ liệu thật (do D-2), MCP :4100 (không chạy), dán ảnh clipboard, hộp "?" (help) ở topbar, quy tắc automation khi reopen (không có quyền xem).
