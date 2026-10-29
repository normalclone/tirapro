# Đánh giá UX theo vai trò: PM / Scrum Master / PO và BA

Người đánh giá: người dùng MỚI, lần đầu dùng Tirapro, đang cân nhắc dùng thay Jira, Linear hoặc ClickUp.
Ngày: 2026-10-15. Môi trường: web :5173, API :4000, không có `ANTHROPIC_API_KEY` (AI chạy heuristic).

- Tài khoản dùng: `admin@projira.dev` (đóng vai PM), `ba@tirapro.dev` (BA), cộng `tester@tirapro.dev` để gửi yêu cầu vào hộp triage.
- Dự án sandbox tự tạo: **PM Sprint Lab (PSL)**, Scrum, 2 sprint, 12 issue. Dự án DEMO chỉ dùng để đọc báo cáo và Gantt, không sửa.
- Ảnh nằm ở `/private/tmp/claude-501/-Users-inrnee-tirapro/c7a3811a-9d86-4438-aa16-daa54e40d122/scratchpad/ux-review/pm-ba/shots/` (viết tắt `shots/`). Script Playwright ở thư mục cha.
- Mọi thao tác đều qua UI. Chỉ đọc DB để xác nhận (ví dụ danh sách quyền, `parentId`) và đọc code để truy nguyên nguyên nhân.
- Số hiệu "bằng chứng" dạng `file:dòng` là tra code thật, không phải suy đoán.

---

# PHẦN A. VAI TRÒ PM (Quản lý dự án / Scrum Master / PO)

## A1. Ấn tượng 5 phút đầu

**Tốt.**
- Đăng nhập xong vào Tổng quan trong chưa đầy 0,3 giây. Trang có tiêu đề, cảnh báo "3 việc sắp đến hạn", 4 chỉ số, biểu đồ và mục "Cần chú ý" (`shots/01-landing.png`).
- Mục "Cảnh báo tiến độ" viết bằng lời thường: "14 ngày qua gần như không có việc nào hoàn tất…". Đây là điều Jira không làm.
- Tạo dự án chỉ cần Tên, tự sinh Key, chọn Scrum hay Kanban. Mất khoảng 2,5 giây. Màn trống hướng dẫn rõ: "Chưa có sprint nào đang chạy … [Mở Backlog]" (`shots/07-new-project.png`).
- Tiếng Việt tự nhiên, có giải thích tại chỗ (WIP, loại bảng, rủi ro RAID…).

**Gây bối rối.**
- Bấm "Dự án" trên thanh trái không ra danh sách dự án. Nó nhảy thẳng vào board của dự án đầu tiên (`ProjectsIndexRedirect`). Người mới có 2 dự án sẽ thấy lạ.
- Thanh điều hướng có tới 3 tầng: sidebar workspace, cột danh sách dự án (224px), rồi tab dự án. Ở 1440px, hai cột bên trái chiếm 415px. Board 4 cột phải cuộn ngang mới thấy cột Done (`shots/59-board-sprint1.png`).
- Từ vựng lẫn lộn:
  - Tab là "Việc chờ" nhưng tiêu đề trang là "Backlog".
  - "Việc", "công việc", "vấn đề" (ô liên kết ghi "Mã vấn đề") và "issue" (kết quả JQL ghi "2 issue") dùng lẫn nhau.
  - Trạng thái (To Do / In Progress / In Review / Done), mức ưu tiên (Highest / High…), loại liên kết ("blocks") và tiêu đề biểu đồ (Burndown / Velocity / Cumulative Flow) đều tiếng Anh giữa giao diện tiếng Việt.
- Công cụ quản lý (Rủi ro, Mục tiêu, Danh mục dự án) nằm dưới menu "Quản trị", cạnh "Nhân lực" và "Khách hàng". PM tìm "rủi ro" sẽ không nghĩ tới menu "Quản trị". Tự động hoá lại nằm ở "Kết nối".
- Nút "Hướng dẫn màn này" (dấu ?) bị vô hiệu ở mọi màn, không giải thích. Nguyên nhân: bảng `Guide` trong DB có 0 dòng, và `GuideLauncher.tsx:122` đặt `disabled={!primaryTour}`. Người mới bấm không được và không biết vì sao.

## A2. Bảng việc thật → kết quả

| # | Việc thật của PM | Kết quả | Ghi chú | Ảnh |
|---|---|---|---|---|
| 1 | Tạo dự án Scrum mới | **Dễ** | 3 trường, 1 click, toast xác nhận | `06`, `07` |
| 2 | Đổ backlog (thêm nhanh 10+ việc) | **Được** | Ô thêm nhanh Enter là tạo, nhanh. Nhưng không đặt được loại, điểm, ưu tiên. Gõ `!cao ~5` bị lưu nguyên văn vào tiêu đề (xem 🟠-5). Dùng modal thì có token `!ưu-tiên @người ~điểm ^hạn` (xem 🟠-4). | `12`, `21`, `22` |
| 3 | Ước lượng, xếp ưu tiên backlog | **Khó** | Click vào dòng backlog **không làm gì** (xem 🔴-1). Phải mở từng việc bằng URL hoặc ⌘K rồi đặt điểm. Bulk chỉ có "Gán" và "Chuyển sprint". Mỗi việc tốn khoảng 4 thao tác (mở, bấm, gõ, Enter) cộng thêm quay lại backlog. | `42`, `46` |
| 4 | Lập kế hoạch sprint: kéo việc vào sprint | **Dễ** | Kéo thả mượt, cộng điểm tức thì ("5 việc · 24 điểm"). Có checkbox chọn nhiều rồi "Chuyển sprint". | `113` |
| 5 | Trợ lý lập sprint (AI) | **Được** | Nhập năng lực 25 điểm, trợ lý chọn đúng 24 điểm kèm lý do và việc bị bỏ. Hạn chế: lý do ghi cứng "Độ ưu tiên cao" cho cả việc Medium, và bỏ qua mục tiêu sprint (xem 🟠-6). | `56` |
| 6 | Đặt mục tiêu, ngày cho sprint | **Được** | Tạo sprint chỉ hỏi tên. Mục tiêu và ngày phải mở dialog bút chì. Sau khi lưu, ngày không hiện ở header sprint. | `50`, `53`, `54` |
| 7 | Bắt đầu sprint | **Dễ nhưng nguy hiểm** | 1 click là chạy, không xác nhận, không kiểm tra thiếu ngày hay mục tiêu. Sprint 2 của tôi chạy được dù không có ngày nào. | `58` |
| 8 | Theo dõi board hằng ngày | **Được** | Quick filter "Của tôi / Quá hạn / Chưa gán", nhóm theo người một click. Đổi trạng thái trong trang việc bằng một click. Board 4 cột phải cuộn ngang. | `59`, `119` |
| 9 | Cấu hình board (cột, WIP, swimlane, bộ lọc) | **Dễ** | Dialog có 4 tab và lời giải thích tốt. Kéo vượt WIP ra hộp thoại "Vẫn chuyển" (chỉ quản trị dự án mới có quyền). Bộ lọc có chế độ Đơn giản và JQL. | `60`–`64` |
| 10 | Kết thúc sprint | **Dễ** | Dialog rõ: về Backlog, sang sprint mới, hay sang sprint có sẵn. Nhưng không có tổng kết (đã xong x/y điểm, tốc độ). | `108`–`111` |
| 11 | Burndown, velocity, CFD | **Được** | Có đủ 4 biểu đồ. Nhưng ở cuối trang dài, không chọn được sprint, không xuất file (xem 🟠-8). | `70`, `71` |
| 12 | Gantt / lộ trình, phụ thuộc | **Khó** | Việc không có hạn bị ẩn. Không có trường "ngày bắt đầu" nên mọi thanh chỉ là một ô vuông 1 ngày (xem 🟠-9). | `74`–`76` |
| 13 | Rủi ro và phụ thuộc (RAID) | **Dễ** | Làm rất tốt: ma trận 5×5, điểm = xác suất × ảnh hưởng, 4 loại. Không gắn được rủi ro vào issue hay sprint. | `121`, `122` |
| 14 | Quy tắc tự động hoá | **Dễ** | Trình dựng Khi, Nếu, Thì rõ. Chưa có công thức mẫu (recipe). Tôi chỉ xem và mở form, chưa kiểm tra quy tắc chạy ra sao. | `107` |
| 15 | Triage yêu cầu mới | **Được** | Có Nhận / Tạm hoãn / Từ chối. Hạn chế ở 🟠-7. | `105` |
| 16 | Báo cáo cho lãnh đạo | **Được** | Có chương trình/danh mục dự án, digest hằng tuần (Telegram), OKR. Không xuất PDF/CSV, không có "báo cáo sprint" để gửi đi. | `82`, `123` |
| 17 | Chuyển từ Jira sang | **Được** | Có Wizard nhập CSV Jira 3 bước, hướng dẫn xuất từ Jira ngay trên trang. | `125` |

## A3. Góp ý xếp theo mức ảnh hưởng

### 🔴 Chặn công việc

**🔴-1. Backlog: click vào việc không mở gì cả**
- Hiện trạng: click, double-click, Enter hay chuột phải vào một dòng ở trang Việc chờ đều không có phản hồi (`shots/42-click-key.png`, URL giữ nguyên `/p/PSL/backlog`).
  - Nguyên nhân: dòng backlog chỉ gắn handler kéo-thả, không có `onClick` mở issue. Bằng chứng: `apps/web/src/features/backlog/IssueRow.tsx:205` (`rootProps` chỉ gồm `listeners` và `attributes` của dnd-kit).
  - Không có peek panel hay link `<a>` nào thay thế.
  - So sánh: click thẻ ở Board (`BoardPage.tsx:330 openIssue`), dòng ở Cây việc và dòng kết quả JQL đều mở được issue. Chỉ **Backlog** và **Triage** là không (đã thử từng nơi). Hai màn "làm việc nhiều nhất" của PM lại là hai màn duy nhất bị thiếu.
- Vì sao quan trọng: làm backlog (ước lượng, viết mô tả, xếp ưu tiên) là việc đầu tiên của PM. Jira và Linear đều mở panel ngay khi click. Người mới sẽ nghĩ app bị treo, rồi mất thời gian đoán ra phải dùng ⌘K hoặc đổi URL.
- Đề xuất: click (không kéo) mở issue ở side panel hoặc drawer, giữ nguyên ngữ cảnh backlog. Thêm link thật trên mã issue (để Cmd+click mở tab mới). Thêm cả phím `Enter` khi dòng đang focus. Làm tương tự ở Triage (dòng triage cũng không click được).
- Công: **M** (side panel tái dùng nội dung `IssueDetailPage`; nếu chỉ navigate thì **S**).

**🔴-2. Không có cách đặt hàng loạt điểm / ưu tiên / epic / nhãn ngoài việc mở từng issue**
- Hiện trạng: BulkActionBar chỉ có "Gán cho tôi", "Đổi người phụ trách", "Chuyển sprint" (`shots/46-bulk.png`). Backlog quick-add (`components/ui/QuickAddRow.tsx:38-46`) luôn tạo loại mặc định, không nhận token `!` `~` `@` `^` như modal.
- Ước lượng 7 việc của tôi phải vào/ra trang issue 7 lần (mở trang, bấm "Đặt điểm ước lượng", gõ số, Enter, quay lại).
- Vì sao quan trọng: planning poker xong là phải nhập điểm cho cả loạt. Đó là việc lặp nhiều nhất của buổi grooming.
- Đề xuất: (a) cột điểm trong backlog sửa trực tiếp (click vào chip điểm, gõ số, Enter); (b) bulk thêm "Đặt điểm", "Đặt ưu tiên", "Gắn nhãn", "Gắn vào epic"; (c) QuickAddRow dùng lại `TokenTitleInput` (đã có sẵn trong modal).
- Công: **M**.

**🔴-3. Không có cách đặt hoặc đổi Epic/việc cha cho issue đã tồn tại**
- Hiện trạng: trang issue không có ô "Epic" hay "Việc cha". Việc duy nhất liên quan là nút "Tạo việc con" ở trang cha. Đã xác minh: tạo story con từ epic thì `parentId` được set (DB), nhưng với story tạo trước thì không có đường nào gắn vào epic (`IssueDetailPage.tsx:147` chỉ đọc cha để làm breadcrumb). API thì hỗ trợ `PATCH { epicId }` (`issues.service.spec.ts:1297`).
- Ngoài ra, backlog không nhóm theo epic, không có panel epic như Jira. Epic nằm lẫn trong danh sách phẳng.
- Vì sao quan trọng: PM và BA phải chia epic thành story để theo dõi tiến độ theo mảng lớn. Với mô hình hiện tại, nhập từ AI hoặc từ quick-add rồi sắp xếp lại là không làm được.
- Đề xuất: thêm ô "Epic / Việc cha" trong dải thuộc tính của issue (picker có tìm kiếm). Trong backlog thêm panel Epic ở bên trái để lọc và để kéo issue vào epic.
- Công: **M**.

### 🟠 Gây khó chịu thường xuyên

**🟠-4. Gõ nhanh `!ưu-tiên` không phản hồi ngay và có nhầm lẫn**
- Hiện trạng: modal tạo việc có hint `!ưu-tiên @người #sprint ~điểm ^hạn`, tô sáng token khi gõ (rất tốt). Nhưng:
  - Các ô bên dưới (Ưu tiên, Điểm, Người phụ trách) vẫn hiện "Medium", "VD: 3", "Chưa gán" cho tới khi bấm Tạo (`shots/21-token-ok.png`). Người dùng dễ nghĩ token hỏng và sửa tay lần nữa.
  - Mức ưu tiên là tiếng Anh (Highest/High/Medium/Low). `!cao` không khớp và nằm nguyên trong tiêu đề, trong khi UI là tiếng Việt.
  - Gõ `!high` ở cuối tiêu đề rồi ⌘+Enter thì popup gợi ý nuốt phím, chọn **Highest** thay vì High, và modal không tạo (`shots/26-child-story.png`). Cần gõ dấu cách sau token.
- Đề xuất: đồng bộ giá trị vào các ô ngay khi token khớp; thêm bí danh tiếng Việt cho ưu tiên (`cao`, `thấp`, `trung bình`, `khẩn`); ⌘+Enter khi popup đang mở thì ưu tiên tạo, hoặc chỉ chọn gợi ý bằng Tab.
- Công: **S**.

**🟠-5. Quick-add ghi nguyên văn `!cao ~5` vào tiêu đề**
- Hiện trạng: `PSL-STORY-1 "Đăng ký tài khoản bằng email !cao ~5"` (`shots/12-quickadd-done.png`). Cùng một chức năng, hai nơi hành xử khác nhau (modal có token, quick-add thì không). Ngoài ra không có chỗ chọn loại, mọi quick-add đều là Story.
- Đề xuất: dùng chung parser ở `titleTokens.ts`; hoặc chí ít cảnh báo khi tiêu đề chứa `!` `~` `^`.
- Công: **S**.

**🟠-6. Trợ lý lập sprint: lý do thiếu trung thực và bỏ qua mục tiêu**
- Hiện trạng: tôi đặt mục tiêu "giữ giỏ hàng" và năng lực 25 điểm. Trợ lý chọn "Thanh toán", "Tìm kiếm", "sắp xếp theo giá" và bỏ việc "Giỏ hàng" (5 điểm) là việc khớp mục tiêu nhất. Lý do hiển thị "Độ ưu tiên cao, đứng đầu backlog" cho cả việc ưu tiên Medium (`shots/56-assistant-result.png`).
- Vì sao quan trọng: lý do sai làm PM mất niềm tin vào gợi ý, sau đó bỏ luôn tính năng. Đây là một trong các điểm bán chính ("nâng cấp AI") của sản phẩm. Lưu ý: môi trường này chạy heuristic, nên có thể khác khi có API key. Giao diện hiển thị đúng "Nguồn: gợi ý cơ bản" khi tạo bằng AI, nhưng ở trợ lý sprint thì không ghi nguồn.
- Đề xuất: lý do sinh từ dữ liệu thật (ưu tiên thực, hạn, khớp từ khoá với mục tiêu); ghi rõ "heuristic / AI" ở trợ lý sprint; cho phép kéo lại hoặc đổi đề xuất ngay trong dialog.
- Công: **S** (lý do) / **M** (khớp mục tiêu).

**🟠-7. Triage chỉ nhận "Báo lỗi", và dòng triage không cho xem chi tiết**
- Hiện trạng: nút duy nhất là "Báo lỗi". Form chỉ có Tiêu đề và Mô tả, mọi thứ lưu thành loại **Bug**. Tôi gửi "Yêu cầu từ khách: cho phép đăng nhập bằng Zalo" và nó thành `PSL-BUG-2`. Dòng triage cắt tiêu đề, không hiện mô tả, không hiện người gửi hay thời gian, không click mở được. Nhận xong thì vào Backlog dưới dạng Bug, không đổi loại, không đặt ưu tiên (`shots/103`, `105`).
- Vì sao quan trọng: PO và BA nhận yêu cầu tính năng nhiều hơn bug. Từ chối không hỏi lý do thì người gửi không biết tại sao.
- Đề xuất: form "Gửi yêu cầu" có chọn Loại (Bug / Yêu cầu / Câu hỏi). Dòng triage mở rộng được (mô tả, người gửi, giờ gửi). Nút Nhận cho chọn loại và ưu tiên. Từ chối cho nhập lý do (gửi lại cho người báo).
- Công: **M**.

**🟠-8. Báo cáo: mở ra là thống kê chung, burndown nằm tận cuối**
- Hiện trạng: `/p/*/reports` là một trang dài 10 biểu đồ. Thứ PM cần mỗi ngày (burndown sprint đang chạy) nằm ở dưới màn hình thứ hai (`shots/70`, `71`). Không chọn sprint, không khoảng thời gian, không xuất PDF/CSV, không có "báo cáo kết thúc sprint". Đường "Còn lại" kéo dài phẳng tới cuối sprint, không có vạch "hôm nay". Tiêu đề tiếng Anh. Burndown hiển thị theo điểm nhưng mọi issue trong PSL có tổng điểm chỉ 44 trong khi sprint 1 chỉ 24 (không nói là tổng dự án hay tổng sprint).
- Đề xuất: tab "Sprint" (burndown + velocity + tóm tắt) đứng trước; chọn sprint; vạch hôm nay; nút "Xuất PDF/CSV"; trang tổng kết sau Kết thúc sprint (hoàn thành x/y điểm, việc chuyển tiếp, so với velocity trung bình).
- Công: **M**.

**🟠-9. Gantt thiếu ngày bắt đầu, ẩn việc chưa có ngày**
- Hiện trạng: dữ liệu có `startDate` (`GanttPage.tsx:156`) nhưng trang issue chỉ có "Hạn", không có ô "Ngày bắt đầu" (xem mục "Mốc thời gian"). Kết quả mọi thanh Gantt là một ô vuông 1 ngày (`shots/75-gantt-demo.png`). 9–10 việc "chưa hiện ở đây" chỉ được nhắc bằng một dòng chữ nhỏ, không bấm để xem hay đặt ngày. "Đường găng" bị xám mà không nói cần điều kiện gì. Biểu đồ chỉ rộng một nửa trang.
- Đề xuất: thêm Ngày bắt đầu vào issue; kéo thanh để đổi ngày; danh sách "Chưa lên lịch" bấm mở được; giải thích điều kiện bật Đường găng; tự nối sprint thành dải màu.
- Công: **M**.

**🟠-10. @mention không hoạt động, và thông báo ghi thời gian bằng tiếng Anh**
- Chi tiết ở phần B (🔴-B2). Phần chung cho PM: Hoạt động, Lịch sử và Thông báo hiển thị "less than a minute ago", "6 minutes ago" bằng tiếng Anh vì `ActivityPanel.tsx:63` gọi `formatDistanceToNow` không truyền locale `vi` (`shots/114-history.png`, `126-notifs.png`). Thông báo chỉ ghi "Đổi trạng thái DEMO-STORY-5" mà không nói ai đổi, từ đâu sang đâu.
- Công: **S**.

**🟠-11. Mobile: trang issue vỡ bố cục**
- Hiện trạng: ở 390px, tiêu đề issue bị ép vào một cột hẹp, mỗi từ một dòng, và nút "Theo dõi" đè lên tiêu đề (`shots/m-issue.png`). Header dự án lặp tên dự án hai lần. Nút "Bắt đầu sprint" tràn mép phải (`shots/m-backlog.png`). Board và backlog dùng được.
- Công: **S**.

### 🟡 Nên cải thiện

- **🟡-12.** Bắt đầu sprint không xác nhận và không cảnh báo thiếu ngày hay mục tiêu. Nên hiện hộp "Bắt đầu Sprint X? 5 việc, 24 điểm, 15/10 → 28/10", cho sửa ngày ngay và có Hoàn tác. Công **S**.
- **🟡-13.** Ngày và mục tiêu sprint không hiện ở header sprint sau khi đã lưu (chỉ hiện mục tiêu). Board cũng không nói sprint đang chạy tới ngày nào, còn mấy ngày. Công **S**.
- **🟡-14.** Danh sách backlog không hiện icon loại việc, chỉ có chấm ưu tiên và mã `PSL-TASK-3`. Khó phân biệt Epic, Story và Bug. Công **S**.
- **🟡-15.** AI tạo việc (heuristic) sắp thứ tự lộn xộn (tạo song song nên `TASK-1` là mục cuối trong yêu cầu), tách "sắp xếp theo giá" khỏi câu "tìm kiếm…" thành việc riêng, mọi mục thành Task. Xem phần B. Công **S**.
- **🟡-16.** Cmd+K chỉ có "Tạo công việc", "Đổi giao diện", "Tổng quan", "Board/Backlog". Thiếu "Bắt đầu/Kết thúc sprint", "Mở báo cáo/Gantt/Triage", "Tạo sprint" (`shots/117-cmdk.png`). Công **S**.
- **🟡-17.** Phân quyền vai trò PM có chỗ lạ (đọc từ DB):
  - **Scrum Master** có `sprint:manage`, `board:manage`, `workflow:edit` nhưng **không có `issue:create`**.
  - **Product Owner** không có `issue:transition`, `board:manage`.
  - Các vai này tồn tại sẵn nhưng người mới không biết vai nào làm được gì (trang Vai trò không so sánh). Công **S** (xem lại bộ quyền mặc định) / **M** (ma trận quyền).
- **🟡-18.** Cảnh báo React `Encountered two children with the same key` trong console khi mở Trợ lý lập sprint. Công **S**.
- **🟡-19.** Emoji 🎉 trong empty state triage trái tông "calm, trustworthy" của PRODUCT.md. Công **S**.

## A4. Tính năng còn thiếu của PM (so Jira / Linear), xếp ưu tiên

1. **Mở issue từ backlog bằng click / side panel** (xem 🔴-1). Thiếu thì không dùng nổi.
2. **Epic**: ô chọn epic, panel epic ở backlog, tiến độ epic theo điểm (hiện chỉ "0/1" theo số việc).
3. **Sửa điểm, ưu tiên trực tiếp trên dòng backlog; bulk edit** (xem 🔴-2).
4. **Báo cáo kết thúc sprint** và xuất PDF/CSV cho lãnh đạo. Hiện chỉ có biểu đồ.
5. **Ngày bắt đầu + Gantt kéo thả** (xem 🟠-9).
6. **Sprint planning tương tác**: capacity theo người và theo ngày nghỉ (đã có `/manage/resources`, nhưng chưa nối vào Trợ lý lập sprint).
7. **Scope change trong sprint**: đánh dấu việc thêm vào sau khi sprint đã bắt đầu trên burndown (chưa thấy). Tôi chưa kiểm chứng đủ.
8. **Retro / sprint review** (ghi chú, hành động). Không thấy.
9. **Mẫu quy tắc tự động hoá có sẵn** (khi done thì đóng epic, khi quá hạn thì báo lead).
10. **Kéo thả ngay trong Gantt để nối phụ thuộc**; hiện phải mở drawer và chọn hai issue từ dropdown.

## A5. Điểm làm tốt nên giữ (PM)

- Ngôn ngữ tự nhiên, giải thích bằng ví dụ ngay trong form (WIP, loại bảng, RAID, OKR). Giảm hẳn nhu cầu đọc tài liệu.
- Ma trận RAID 5×5 với điểm rủi ro tự tính và lọc theo ô là tốt hơn nhiều so với Jira mặc định.
- Dialog "Kết thúc sprint" rõ ràng về nơi đi của việc chưa xong. Đây là chỗ Jira hay bị chê.
- Trợ lý lập sprint nói rõ việc nào được chọn, vì sao, việc nào bị bỏ vì chưa ước lượng ("1 việc chưa có điểm nên bị bỏ qua — hãy ước lượng trước"). Chỉ cần sửa lý do cho đúng là thuyết phục.
- WIP: khi vượt giới hạn có hộp thoại rõ, kèm tag "WIP 2/2" ngay trên cột; board Scrum không có sprint thì có empty state hướng dẫn.
- Kéo thả backlog mượt, tổng điểm cập nhật tức thì; kéo qua sprint khác mất ~2,6 giây theo script.
- Trang Tổng quan có "Cảnh báo tiến độ" bằng chữ và cụm "Cần chú ý".
- Trình dựng bộ lọc Đơn giản/JQL và Khi/Nếu/Thì dễ hiểu cho người mới.
- Wizard nhập Jira 3 bước là điểm cộng lớn khi thuyết phục chuyển đổi.

---

# PHẦN B. VAI TRÒ BA (Business Analyst)

## B1. Ấn tượng 5 phút đầu

- Trang chủ của BA (`shots/13-ba-landing.png`) là bảng "Ưu tiên cao / Sắp trễ hạn / Việc của tôi", cả ba đều trống vì BA chưa được giao việc. Đây là dashboard cho người thực thi, không phải cho người viết yêu cầu. Không có gợi ý đầu tiên ("Viết user story đầu tiên", "Tạo tài liệu").
- BA thấy menu "Quản trị" và "Cài đặt" giống người khác. Chưa kiểm tra bấm vào có bị chặn không.
- Tốt: tạo việc có **mẫu mô tả theo loại** (Story tự điền "Bối cảnh / Tiêu chí hoàn thành") sau khi đổi loại việc (`shots/26`), editor Markdown có thanh công cụ, tạo việc con từ trang cha.
- Chặn lớn: không có chỗ viết tài liệu (Wiki chỉ đọc cho BA), @mention không hoạt động, comment ghi chữ thô (xem dưới).

## B2. Bảng việc thật → kết quả

| # | Việc thật của BA | Kết quả | Ghi chú | Ảnh |
|---|---|---|---|---|
| 1 | Viết epic với mô tả có tiêu chí chấp nhận | **Được** | Markdown nhập được, nhưng danh sách `- [ ]` hiển thị chữ "[ ]" trong dấu đầu dòng (không phải checkbox) và bảng `| a | b |` hiển thị chữ thô (xem 🔴-B1). | `20-after-create` |
| 2 | Epic → Story → Subtask | **Khó** | Chỉ làm được bằng "Tạo việc con" từ trang cha, đổi loại thành Story trong dialog. Không có ô chọn epic cho issue đã có (xem 🔴-3). | `25`, `28`, `29` |
| 3 | Viết user story có tiêu chí chấp nhận | **Được** | Có mẫu Story tự điền, nhưng chỉ khi tạo từ "Tạo việc con". Tạo từ nút "Tạo công việc" thì mô tả trống. Không có trường tiêu chí chấp nhận riêng. | `26`, `28` |
| 4 | Tài liệu yêu cầu / Wiki | **Không làm được** | Chỉ vai Workspace Admin có `wiki:manage`. BA thấy "Chưa có trang nào ở phạm vi này… chờ người phụ trách thêm tài liệu" và không có nút tạo (`shots/91-wiki-ba.png`). | `91` |
| 5 | Liên kết yêu cầu với issue | **Được** | Phải gõ chính xác mã (`PSL-TASK-3`), không có gợi ý tìm kiếm. Loại liên kết là "blocks" tiếng Anh. | `24`, `116` |
| 6 | Tạo hàng loạt từ mô tả (AI) | **Được** | Nhận danh sách đánh số, bảng xem trước sửa/bỏ chọn được, nhãn "Nguồn: gợi ý cơ bản" minh bạch. Nhưng heuristic chỉ tách theo dòng/dấu `;`. | `34`, `35`, `36` |
| 7 | Bộ lọc/JQL đã lưu | **Dễ** | Trình dựng Đơn giản và JQL, lỗi JQL báo tiếng Việt kèm vị trí. Không có gợi ý tự hoàn thành trong ô JQL, kết quả hiển thị rất sơ sài (xem 🟠-B4). | `95`–`101` |
| 8 | Comment @mention dev/tester | **Không làm được** | Gõ `@` không hiện gợi ý, "Chào @Dũng" lưu thành chữ thường. Backend hỗ trợ `mentionUserIds` nhưng frontend không bao giờ gửi (xem 🔴-B2). | `92`–`94` |
| 9 | Theo dõi thay đổi phạm vi (lịch sử) | **Được** | Tab Lịch sử có từ → sang ("đổi điểm: 5 → 85"). Thời gian bằng tiếng Anh. Không so sánh được phiên bản mô tả. | `114` |
| 10 | Triage yêu cầu mới | **Được** | Xem 🟠-7 ở phần A. Form chỉ là "Báo lỗi / sự cố". | `103` |
| 11 | Tạo story nhập nhanh bằng token (`~5 !high @Dũng ^t6`) | **Dễ** | Hoạt động tốt, token được tô sáng ngay khi gõ, ngày "t6" ra đúng 16/10. | `21`, `22` |

## B3. Góp ý xếp theo mức ảnh hưởng

### 🔴 Chặn công việc

**🔴-B1. Mô tả (Markdown) không render danh sách checkbox và bảng, nhưng form lại mời viết Markdown**
- Hiện trạng: tôi viết "Tiêu chí chấp nhận" bằng `- [ ] Đăng ký bằng email…` và bảng quyền `| Vai trò | Quyền |`. Hiển thị: bullet có chữ "[ ]" và các dòng `| Vai trò | Quyền | |---|---|` thô (`shots/20-after-create.png`). Placeholder của editor ghi "viết được Markdown", toolbar chỉ có B, I, code, H2, danh sách, link, ảnh (không có checklist, không có bảng).
- Vì sao quan trọng: tiêu chí chấp nhận và ma trận quyền/quy tắc nghiệp vụ là phần lõi của một user story. Dev và tester cần tick được từng tiêu chí. Chữ "[ ]" nhìn như lỗi.
- Đề xuất: render GFM đầy đủ (task list tick được, tick lưu ngược vào Markdown; bảng). Thêm nút "Checklist" và "Bảng" trong toolbar. Tạo thêm khối "Tiêu chí chấp nhận" riêng cho Story (tick được, đếm "2/5 đạt" trên thẻ).
- Công: **M**.

**🔴-B2. @mention không hoạt động**
- Hiện trạng: gõ `@` trong ô bình luận không ra gợi ý người, Enter xuống dòng, và comment lưu "Chào @Dũng" thành chữ (`shots/94-comment-posted.png`). Backend nhận `mentionUserIds` (`comments.service.ts:55`) và tạo `Mention`, nhưng `grep mentionUserIds apps/web/src` cho 0 kết quả: frontend không gửi trường này. Dũng chỉ nhận thông báo `COMMENT_ADDED` vì là người được giao, không phải vì bị nhắc.
- Vì sao quan trọng: BA hỏi lại dev/tester hằng ngày ("@Dũng xác nhận AC này giúp"). Đây là chức năng giao tiếp chính trong một công cụ làm việc nhóm. Tài liệu `FEATURES_BY_ACTOR.md` còn hứa "Comment + @mention".
- Đề xuất: popup gợi ý khi gõ `@` (dùng lại `PeoplePicker`), chèn token mention, gửi `mentionUserIds`, tô sáng khi hiển thị, thông báo loại "Được nhắc đến".
- Công: **M**.

**🔴-B3. BA không viết được tài liệu: Wiki chỉ cho Workspace Admin**
- Hiện trạng: `/wiki` với tài khoản BA không có nút "Tạo trang mới". Chỉ vai `Workspace Admin` có `wiki:manage` (DB: `Role`/`Permission`, `wiki.controller.ts:49,59,71,82`). Vai dự án "Business Analyst" (19 quyền) không có `wiki:manage` vì quyền này ở cấp WORKSPACE. Câu thông báo "chờ người phụ trách thêm tài liệu" là bế tắc, không cho BA biết cần xin quyền ai.
- Vì sao quan trọng: tài liệu yêu cầu (PRD, SRS, quy trình) là sản phẩm chính của BA. Không có nơi để viết thì phải đưa vào mô tả issue, mà mô tả issue lại không render bảng (🔴-B1).
- Đề xuất: đưa `wiki:manage` (hoặc `wiki:edit`) vào vai Business Analyst, Product Owner và Scrum Master ở phạm vi dự án; thông báo "Bạn chưa có quyền tạo tài liệu. Hãy nhờ quản trị viên cấp quyền." thay vì "chờ người phụ trách".
- Công: **S** (quyền) / **M** (wiki phạm vi dự án).

### 🟠 Gây khó chịu thường xuyên

**🟠-B4. Danh sách kết quả JQL/bộ lọc quá sơ sài**
- Hiện trạng: mỗi dòng kết quả chỉ có mã, tiêu đề, chấm ưu tiên và tag dự án (`shots/97-jql-3.png`). Không có trạng thái, người phụ trách, điểm, hạn; không chọn cột (bấm dòng thì mở được issue). Ô JQL là textarea thường, không gợi ý tên trường. Muốn lưu truy vấn phải mở "Tạo bộ lọc" và gõ lại.
- Đề xuất: chọn cột hiển thị; nút "Lưu truy vấn này" ngay cạnh "Chạy JQL"; tự hoàn thành tên trường (có ví dụ). Mục bộ lọc có sẵn có chip hiện số kết quả.
- Công: **M**.

**🟠-B5. Không có trường "Tiêu chí chấp nhận" và "Epic" khi tạo issue**
- Hiện trạng: modal tạo việc có Dự án, Loại, Tiêu đề, Người phụ trách, Ưu tiên, Sprint, Điểm, Hạn, Mô tả, Tệp. Không có Epic/Việc cha, Nhãn, Thành phần, Phiên bản, hay trường tuỳ chỉnh (`shots/16-create-modal.png`). Mẫu "Bối cảnh / Tiêu chí hoàn thành" chỉ tự điền khi đổi loại trong dialog "Tạo việc con".
- Đề xuất: tự điền mẫu cho Story ở mọi đường tạo; thêm Epic/Nhãn; BA nên có khối riêng cho AC.
- Công: **S** (mẫu) / **M** (Epic, Nhãn).

**🟠-B6. AI "Tạo bằng AI" (heuristic) cho kết quả thô nhưng có thể sửa**
- Hiện trạng: từ danh sách đánh số 5 mục + 1 bug, AI trả 8 đề xuất: dòng dẫn nhập "Hệ thống cửa hàng online cần các chức năng sau:" thành một Task; "sắp xếp theo giá…" tách khỏi "Tìm kiếm…" vì dấu `;`; mọi mục là Task; không có điểm, ưu tiên, mô tả hay epic (`shots/35-ai-result.png`). Sau khi tạo, thứ tự backlog đảo ngược so với yêu cầu (TASK-1 là mục cuối) vì tạo song song.
- Điểm tốt: có nhãn "Nguồn: gợi ý cơ bản", từng dòng sửa/bỏ chọn được, loại việc đổi được.
- Đề xuất: (a) bỏ qua dòng dẫn nhập kết thúc bằng `:`, gộp mục chỉ cách nhau dấu `;` trong cùng dòng đánh số; (b) tạo tuần tự để giữ thứ tự; (c) gợi ý nhóm vào một Epic; (d) khi thiếu API key thì hiện lời nhắc "Cấu hình khoá AI để AI tách tốt hơn".
- Công: **S**.

**🟠-B7. Liên kết issue phải nhớ chính xác mã, nhãn tiếng Anh**
- Hiện trạng: ô "Mã vấn đề (vd: DEMO-2)", không gợi ý tìm theo tiêu đề; chọn kiểu liên kết là "blocks" (`shots/24-link-dialog.png`, `116`). Dòng liên kết không hiện trạng thái của issue đích.
- Đề xuất: picker tìm kiếm theo tiêu đề và mã; nhãn tiếng Việt ("chặn", "bị chặn bởi", "liên quan", "trùng với"); hiển thị trạng thái đích.
- Công: **S**.

**🟠-B8. Khó theo dõi thay đổi phạm vi**
- Hiện trạng: Lịch sử ghi từng thay đổi nhỏ (có), nhưng không cho lọc theo "chỉ thay đổi mô tả/điểm", không so sánh bản mô tả cũ và mới. Tôi đổi điểm một Story đã Done trong sprint đã đóng (5 → 85, do tôi gõ nhầm) và hệ thống im lặng cho phép, không cảnh báo "việc này nằm trong sprint đã kết thúc, đổi điểm sẽ làm lệch velocity". Điểm không có giới hạn hay gợi ý dãy Fibonacci.
- Đề xuất: cảnh báo khi sửa điểm việc đã Done/sprint đã đóng; xem diff mô tả; lọc lịch sử theo loại thay đổi.
- Công: **M**.

### 🟡 Nên cải thiện

- **🟡-B9.** Dashboard BA mặc định rỗng và chỉ nói về "việc của tôi". Nên có lối tắt "Tạo story", "Viết tài liệu", "Việc chưa có tiêu chí chấp nhận", "Yêu cầu mới chờ triage". Công **S**.
- **🟡-B10.** Từ khoá "Epic" nên có chỗ nhìn tổng quan: trang Cây việc có nhóm Epic → Story (có tiến độ), nhưng không sửa được (kéo thả để đổi cha) và không hiện điểm cộng dồn (`shots/30-tree.png`). Công **M**.
- **🟡-B11.** Báo "Đã tạo công việc PSL-EPIC-1" nhưng sau đó người dùng bị chuyển hẳn sang trang issue mới. Với BA tạo hàng loạt story, "Tạo & nhập tiếp" tốt hơn nhưng không phải mặc định. Chấp nhận được.
- **🟡-B12.** Tiêu đề epic của tôi giữ nguyên chữ "!cao" vì token không khớp, và không có cảnh báo nào cho biết. Gộp với 🟠-4.

## B4. Tính năng còn thiếu của BA (so Jira / Confluence / Linear), xếp ưu tiên

1. **Wiki/tài liệu viết được cho BA**, kèm liên kết hai chiều giữa trang wiki và issue (hiện không thấy cách nhúng issue vào wiki hay ngược lại).
2. **@mention hoạt động** + thông báo "Được nhắc đến".
3. **Render Markdown đầy đủ** (checklist tick được, bảng) + khối Tiêu chí chấp nhận.
4. **Epic/việc cha** chọn được trên mọi issue; tiến độ epic theo điểm; panel Epic.
5. **Mẫu mô tả (template)** cho Story/Bug/Task chọn được khi tạo, và quản lý mẫu (tab "Mẫu" ở Tự động hoá có nhưng chưa nối với modal tạo việc theo quan sát của tôi).
6. **Nhập từ Word/Excel** hoặc dán bảng yêu cầu để tạo nhiều story (ngoài "Tạo bằng AI").
7. **Truy vết yêu cầu** (traceability): bảng yêu cầu ↔ story ↔ test case.
8. **So sánh phiên bản mô tả** (diff) và **phê duyệt yêu cầu** (trạng thái "Đã duyệt" cho story).
9. **Lưu truy vấn JQL ngay từ ô chạy nhanh**, hiển thị nhiều cột, xuất CSV.
10. **Sơ đồ** (luồng nghiệp vụ, BPMN/mermaid) trong wiki hoặc mô tả.

## B5. Điểm làm tốt nên giữ (BA)

- Token gõ nhanh `!ưu-tiên @người #sprint ~điểm ^hạn (mai · t6 · 3d · 2w · 15/8)` có tô sáng ngay khi gõ. Đây là kiểu "Linear-like" mà Jira không có. Chỉ cần đồng bộ ô bên dưới và thêm bí danh tiếng Việt.
- Đổi loại việc sang Story tự điền mẫu "Bối cảnh / Tiêu chí hoàn thành".
- Trình dựng bộ lọc kiểu "Đơn giản" sinh JQL tự động ("Cho người mới") và lỗi JQL báo tiếng Việt kèm vị trí ("Cần tên trường (field) (vị trí 18)").
- AI tạo việc minh bạch về nguồn ("gợi ý cơ bản") và cho xem trước/sửa từng dòng.
- Trang Lịch sử hiển thị rõ từ → sang cho từng trường; "Các bước cần làm" (checklist) cho sub-step tick được.
- Vai dự án được đặt tên đúng persona (Business Analyst, Product Owner, Scrum Master), dễ gán quyền.

---

# PHẦN C. TỔNG KẾT

Điểm mạnh: giao diện sạch, ngôn ngữ thân thiện, các tính năng "khó" (WIP, RAID, kết thúc sprint, trợ lý lập sprint, trình dựng Khi/Nếu/Thì) làm khá hơn kỳ vọng so với Jira.

Điểm yếu nằm ở các thao tác cơ bản nhất, chứ không ở tính năng nâng cao:
1. Không mở được issue từ backlog bằng click.
2. Không đặt được epic cho issue có sẵn.
3. @mention và Markdown (checklist, bảng) bị hỏng hoặc không hoàn thiện.
4. BA không viết được wiki.
5. Hộp triage chỉ nhận bug.

Sửa 5 điểm này thì cả PM và BA đều dùng thay Jira được ở mức cơ bản; các điểm 🟠 còn lại là mài giũa trải nghiệm.

## Danh sách ảnh chính (thư mục `shots/`)

- `01-landing`, `07-new-project`, `08-psl-backlog-empty`: ấn tượng đầu, empty state tốt.
- `12-quickadd-done`: quick-add ghi nguyên `!cao ~5`.
- `16-create-modal`, `21-token-ok`, `22-after-token`, `26-child-story`: modal tạo việc, token, mẫu Story.
- `20-after-create`, `29-epic-page`: Markdown không render checklist/bảng; epic và việc con.
- `35-ai-result`, `36-after-ai-create`: AI tạo việc (heuristic).
- `42-click-key`, `46-bulk`: click backlog không mở, bulk chỉ có Gán/Chuyển sprint.
- `55`, `56-assistant-result`: trợ lý lập sprint.
- `58-start-sprint`, `59-board-sprint1`, `60-board-settings`, `64-wip-exceeded`: sprint và board.
- `70-reports-demo`, `71-reports-demo-lower`: báo cáo.
- `75-gantt-demo`, `76-gantt-deps`: Gantt, phụ thuộc.
- `91-wiki-ba`: BA không tạo được trang wiki.
- `94-comment-posted`: @mention không hoạt động.
- `97-jql-3`, `99`–`101`: JQL và bộ lọc.
- `103`, `105-triage-item`: triage chỉ có "Báo lỗi".
- `108-complete-sprint`, `111-closed-sprints`: kết thúc sprint.
- `114-history`, `116-linked`: lịch sử, liên kết issue.
- `122-risk-form`: RAID.
- `m-board`, `m-backlog`, `m-issue`: mobile.
