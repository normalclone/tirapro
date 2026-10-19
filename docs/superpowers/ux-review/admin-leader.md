# Đánh giá UX — Vai trò: Quản trị hệ thống/workspace + Lãnh đạo

Người đánh giá: đóng vai người dùng mới, chưa biết Tirapro. Ngày 2026-10-15, desktop 1440x900 + mobile 390x844.
Ảnh: `scratchpad/ux-review/admin-leader/shots/` (viết tắt `S/`). Script: `scratchpad/ux-review/admin-leader/s*.js`.
Dữ liệu tự tạo (đều có tiền tố "AL"): workspace "AL Công ty Thử nghiệm" (al.sep5374@example.com / Password123) + trong workspace DEMO: 1 chương trình, 1 mục tiêu OKR, 2 rủi ro, 1 digest.

---

## 1. Ấn tượng 5 phút đầu

**Tốt:**
- Đăng ký 4 trường, ~6 giây là vào được app (`S/02-signup.png`, `S/03-after-signup.png`). Tiếng Việt tự nhiên, không bị dịch máy; thuật ngữ khó (OKR, RAID) đều được giải thích ngay dưới tiêu đề.
- Mọi màn "trống" đều có empty-state có lời hướng dẫn và nút hành động (Chương trình, Mục tiêu, Rủi ro, Khách hàng, Nhóm...).
- Giao diện sạch, nhất quán, dialog không rối; Ctrl/Cmd+Enter để lưu ở form dài.

**Chưa tốt (người mới bị bỏ rơi):**
- Sau đăng ký rơi thẳng vào màn "Tổng quan" 0 dự án. Dòng "Tạo dự án đầu tiên để bắt đầu" **không có nút** (`S/03-after-signup.png`); phải tự đoán nút tròn "+" góc dưới phải hoặc menu Dự án.
- **Không có tour/onboarding**: nút "Hướng dẫn màn này" trên thanh trên bị *disabled* ở mọi màn mình thử; Ctrl+K lại có mục "Bắt đầu tour màn này". Bảng `Guide` trong DB có 0 dòng và UI không có chỗ nào để admin tạo hướng dẫn dù có quyền `guide:manage` (xem 🟠 #8).
- Tài liệu "Hướng dẫn sử dụng" (`/documentation`) khá tốt, chia theo vai trò, nhưng chỉ nằm trong menu người dùng.
- Sidebar có hai thứ cùng tên "Quản trị": mục "Quản trị" trong app (thực chất là Danh mục dự án/OKR/RAID/Nhân lực — dành cho lãnh đạo) và "Quản trị" của admin hệ thống (`/admin`). Người dùng thường bấm "Quản trị" kỳ vọng thấy người dùng/bảo mật thì lại ra portfolio. Admin hệ thống thật sự lại không có mục này trên sidebar, phải vào menu người dùng.
- Menu Dự án/Kết nối/Cài đặt/Thành viên hiện cho **mọi** vai trò kể cả Member (xem 🟠 #9).

---

## 2. Bảng việc thật → kết quả

### Vai Quản trị

| # | Việc thật | Kết quả | Ghi chú | Ảnh |
|---|---|---|---|---|
| A1 | Đăng ký tài khoản + workspace mới | **Dễ** | 6s; không có onboarding/checklist sau đó | 02, 03 |
| A2 | Tạo dự án đầu tiên (chọn template/workflow) | **Được** | Dialog chỉ có Tên/Key/Loại(Scrum-Kanban)/Mô tả. Key tự sinh (CKHA). **Không chọn được template, workflow, người phụ trách, ngày**. Mỗi dự án tạo thêm 1 bản "Scrum mặc định" trong Quy trình (xem 🟡) | 07, 08, 48 |
| A3 | Mời thành viên bằng email + gán vai trò | **Được, có ma sát** | Link mời chỉ hiện 1 lần ngay sau khi tạo (email giả lập). Không có danh sách lời mời đang chờ/gửi lại/thu hồi. Trang nhận lời mời không nói mời vào workspace nào. Nhận xong phải đăng nhập lại | 12, 15 |
| A4 | Thêm người có sẵn vào workspace | **Dễ nhưng rò rỉ** | Danh sách người dùng liệt kê *toàn nền tảng* (xem 🔴 #1) | 09 |
| A5 | Tạo vai trò tuỳ biến | **Được** | Dialog rõ, có xem trước màu. Quyền hiển thị key thô (`member:manage`), nửa Việt nửa Anh. Không có "nhân bản vai trò"/mẫu | 14, 17 |
| A6 | Gán vai trò cho thành viên / tạo nhóm | **Được** | Bút chì icon-only, hộp nhỏ; Nhóm dùng ổn. Chủ workspace hiện "Chưa có vai trò" (xem 🔴 #2) | 18, 19, 58 |
| A7 | Vai trò cấp dự án + thành viên dự án | **Được** | Trang thành viên dự án có tìm kiếm, "mặc định/riêng". Nhưng "Mọi thành viên workspace đều tham gia mọi dự án" → không có dự án riêng tư | 59 |
| A8 | Kết nối Telegram | **Khó** | Chỉ có "Tên kết nối" + "Bot token". Không hướng dẫn lấy token/chat_id. Báo "Đã kết nối/Hoạt động" dù chưa dùng được (xem 🟠 #4) | 37, 40, 42 |
| A9 | API key / MCP | **Được (chỉ xem form)** | Trang rõ: endpoint REST/MCP, hạn key, quyền ghi. Member thấy trang này nhưng báo "không có quyền" — tốt | 38, 56-api |
| A10 | Nhập dữ liệu từ Jira CSV | **Dễ — điểm sáng** | Wizard 3 bước, tự ghép loại/trạng thái/ưu tiên, có "Chạy thử", báo cáo cảnh báo rõ, nhập 4/4 trong vài giây. Yếu: người dùng Jira chưa là thành viên thì mất người phụ trách (xem 🟠 #6) | 43-46 |
| A11 | Khoá/mở tài khoản, đặt lại mật khẩu cho người khác | **Không làm được** | Trang Tài khoản chỉ có 2 công tắc (được lập workspace / admin HT) | 20-a-accounts |
| A12 | Tạo tài khoản bởi admin hệ thống | **Được, có bẫy** | Có mật khẩu tạm hiện 1 lần (tốt). Nhưng tài khoản "0 workspace" đăng nhập vào app lỗi (xem 🟠 #5) | 63-65 |
| A13 | Bảo mật/giám sát (audit log, phiên, 2FA/SSO) | **Gần như không có** | Nhật ký kiểm toán trống dù đã có tạo vai trò/mời/xoá; không 2FA/SSO/chính sách mật khẩu | 20-a-system |

### Vai Lãnh đạo

| # | Việc thật | Kết quả | Ghi chú | Ảnh |
|---|---|---|---|---|
| L1 | Mở app xem tình hình tất cả dự án | **Dễ — điểm sáng** | Cảnh báo trên cùng, KPI, biểu đồ, bảng dự án/sprint/tiến độ, "Dự báo" (ước tính còn ~24 tuần), "Cần chú ý" | 21-home |
| L2 | Gom dự án thành chương trình, xem tiến độ chung | **Được** | Tạo trong 1 dialog; có dòng thời gian. Nhãn "đúng hạn" xuất hiện cả khi dự án chưa có ngày → vô nghĩa | 22-26 |
| L3 | Đặt OKR quý và theo dõi | **Dễ** | KR đo ngược (6→0) tính đúng 33%. KR không tự lấy số từ dự án — phải gõ tay | 27, 28 |
| L4 | Sổ rủi ro RAID + ma trận | **Dễ — điểm sáng** | Chấm xác suất x ảnh hưởng, ma trận 5x5 bấm lọc | 29, 30 |
| L5 | Phân bổ nguồn lực/quá tải | **Được (chỉ xem)** | Heatmap người x tuần dễ đọc (An Quản Trị 310%). Chưa thử nhập phân bổ/nghỉ phép | 21-resources |
| L6 | Xuất báo cáo cho ban giám đốc | **Không làm được** | Chỉ có "Sao lưu JSON dự án". Không CSV/Excel/PDF/in (xem 🔴 #3) | 31-reports |
| L7 | Nhận digest định kỳ | **Được, thiếu** | Chỉ qua Telegram, không email; không chọn thứ/giờ, người nhận, nội dung; thực đơn nằm sâu; có lỗi `&amp;` | 33-36 |
| L8 | Tuỳ biến dashboard của mình | **Không làm được** | "Tuỳ biến" ở nút "+" chỉ chọn nút nổi, không phải dashboard | 61 |
| L9 | Xem trên điện thoại | **Được/Khó** | Không tràn trang, hamburger OK; nhưng bảng/ma trận bị cắt, thẻ chương trình bóp méo | m-sheet |

---

## 3. Góp ý theo mức ảnh hưởng

### 🔴 Chặn công việc / rủi ro lớn

**#1. Quản trị workspace liệt kê và thêm được người dùng của MỌI workspace khác (rò rỉ đa-tenant).**
- Hiện trạng: workspace mới tinh, vào Thành viên → "Chọn người dùng…" thấy admin@projira.dev, ba@/dev@/tester@tirapro.dev, automation@tirapro.local (`S/09-user-picker.png`). Back-end: `apps/api/src/modules/users/users.controller.ts:46` (`@Get('all')`, quyền chỉ `member:manage`) → `users.service.ts:66 listAllUsers` không lọc theo workspace, trả tối đa 100 người (tên + email). Comment trong code ghi "pool do admin hệ thống quản trị" — đúng với self-hosted một công ty, sai khi đăng ký công khai bật. Cũng cho phép kéo người lạ vào workspace của mình không cần họ đồng ý (`members.service.ts addWorkspace`).
- Liên quan: số "thành viên" trên mỗi vai trò đếm toàn hệ thống — workspace mới có 1 người nhưng "Thành viên: 3 thành viên" (`S/13-roles.png`; `roles.service.ts:112` đếm theo roleId không lọc workspace).
- Vì sao quan trọng: người làm quản trị cho nhiều khách/phòng ban hoặc triển khai SaaS sẽ coi đây là lỗi chặn mua (lộ email nhân viên công ty khác, lộ quy mô).
- Đề xuất: `GET /users/all` chỉ cho admin hệ thống; với workspace admin, thêm người = nhập email → gửi lời mời (luồng invite đã có). Lọc `memberCount` theo `workspaceId`. Công: **S–M**.

**#2. Chủ workspace vừa tạo hiển thị "Chưa có vai trò" (và chủ dự án hiển thị "Chỉ xem").**
- Hiện trạng: `S/06-members.png`: "AL Giám đốc Test (bạn) — Chưa có vai trò" trong khi admin seed hiện "Quản trị chung". DB: `WorkspaceMembership.roleId` = Workspace Admin nhưng `WorkspaceMembershipRole` rỗng. Nguyên nhân: đăng ký (`auth/auth.service.ts:56`) và tạo workspace thứ hai (`workspaces/workspaces.service.ts:55`) chỉ ghi cột cũ `roleId`, không ghi `roles: { create: [...] }` như `invite.service.ts:168`. Cùng kiểu: `projects/projects.service.ts:125` tạo project membership không có `ProjectMembershipRole` → thành viên dự án hiện "Chỉ xem (riêng)" cho chính chủ dự án (`S/59-proj-members.png`; DB cho thấy Project Admin).
- Quyền thực tế vẫn chạy (RBAC đọc cột cũ) nên không vỡ chức năng, nhưng người quản trị đầu tiên nhìn vào trang phân quyền sẽ thấy mình "không có vai trò" và chủ dự án "chỉ xem" → mất lòng tin vào hệ thống phân quyền. Nếu họ bấm sửa và lưu, cột cũ bị đổi theo.
- Đề xuất: ghi cả bảng nối khi tạo; viết migration vá dữ liệu cũ (`INSERT ... SELECT` từ roleId). Công: **S**.

**#3. Lãnh đạo không xuất được báo cáo; tài liệu trong app hứa điều không có.**
- Hiện trạng: trang Báo cáo (`S/31-reports.png`) có burndown/velocity/CFD nhưng không có nút Xuất/Chia sẻ/In/khoảng thời gian. Chỉ có `GET /export/project/:id` = sao lưu JSON (`features/project-config/DataSection.tsx`). `DocumentationPage.tsx:553` nói "Xuất PDF/Excel khi cần chia sẻ ngoài"; `:559` nói "Dashboard tuỳ biến — Ghép các widget số liệu". `FEATURES_BY_ACTOR.md §2.3/§5` cũng hứa cả hai. Không có UI/API cho Dashboard/Widget (bảng DB tồn tại, 0 controller).
- Vì sao: giám đốc chuẩn bị họp giao ban cần file/slide, không ai họp bằng URL đăng nhập. Đây là nhu cầu số 1 của vai trò lãnh đạo khi so Jira/ClickUp.
- Đề xuất: (a) nút "Xuất" trên mọi bảng/báo cáo: CSV + "In/Lưu PDF" (CSS print) cho Tổng quan, Danh mục dự án, RAID, Nhân lực — công **M**; (b) tối thiểu: sửa tài liệu để không hứa quá. Dashboard tuỳ biến: **L**.

### 🟠 Gây khó chịu thường xuyên

**#4. Telegram: báo thành công giả, không hướng dẫn, thông báo lỗi là jargon.**
- Hiện trạng: bấm "Kết nối" chỉ với tên → toast "Đã kết nối Telegram" + nhãn xanh "Hoạt động" + "token: ***" (`S/40-telegram-linked.png`) dù không có token, không có kênh, và hệ thống tắt Telegram. Bấm "Kiểm tra" → "Chưa cấu hình bot token (global), bỏ qua gửi." (toast, `S/41-tg-test.png`). Muốn thêm kênh phải biết `chat_id` âm kiểu -100123… (`S/42-tg-expanded.png`). Có sẵn bảng `ChannelLinkToken` nhưng không dùng cho luồng này. "Lọc theo từng loại sẽ bổ sung sau" là lời hứa trong UI.
- Đề xuất: wizard 3 bước (tạo bot ở @BotFather → dán token → thêm bot vào nhóm → "Gửi tin thử" tự bắt chat_id qua getUpdates hoặc mã liên kết `/link ABC123`); trạng thái phải phản ánh thật ("Chưa có kênh", "Bot token thiếu") thay vì "Hoạt động". Công: **M**.

**#5. Tài khoản do admin hệ thống tạo (không workspace) đăng nhập vào màn hỏng.**
- Hiện trạng: tạo "al.orphan" không tick "Được lập workspace" → đăng nhập thấy workspace ma "Tirapro", sidebar đầy đủ, hai ô đỏ "Không tải được danh sách việc của bạn." (`S/65-orphan-login.png`). Trang Tài khoản không cho gán vào workspace có sẵn (`S/20-a-accounts.png`).
- Đề xuất: màn "Bạn chưa thuộc không gian nào — nhờ quản trị viên mời hoặc tạo mới"; trong Tài khoản thêm "Thêm vào workspace…". Công: **S**.

**#6. Mời người dùng thiếu vòng đời.**
- Lời mời không liệt kê trong danh sách thành viên ("1 người" trong khi đã mời; `S/12-invited.png`), API chỉ có `POST /auth/invites` và `/invites/accept` (`auth/auth.controller.ts:169,185`) — không list/resend/revoke. Link mời chỉ hiện 1 lần (reload là mất; phải mò log). Trang nhận lời mời không ghi mời vào đâu, ai mời, email nào (`S/15-accept-invite.png`); sau khi tạo mật khẩu bị bắt đăng nhập lại (`S/16-after-accept.png`) thay vì vào luôn. Vai trò trong dropdown mời hiển thị tiếng Anh "Workspace Admin/Member/Viewer" trong khi trang Vai trò dùng "Quản trị chung/Thành viên/Người xem" (`S/11` so `S/13`); bộ chuyển workspace cũng hiện "Workspace Admin".
- Với nhập Jira: người phụ trách Jira chưa là thành viên bị mất (3/4 việc không có người), cảnh báo bảo "mời họ rồi gán lại" bằng tay (`S/46-import-done.png`).
- Đề xuất: bảng "Lời mời đang chờ" (email, vai trò, hạn, Gửi lại/Sao chép/Thu hồi); trang accept hiển thị "X mời bạn vào Y (email)" + tự đăng nhập; mời hàng loạt (dán nhiều email); import Jira nhớ email Jira để tự gán khi người đó tham gia / nút "Mời những người này". Công: **M**.

**#7. Quản lý tài khoản của admin quá nghèo.**
- Không khoá/vô hiệu hoá (trong khi `User.status = DEACTIVATED` có trong DB và overview báo "0 vô hiệu"; `admin.controller.ts` chỉ có list/create/update-quyền), không đặt lại mật khẩu cho người khác, không tìm kiếm/lọc, không "đăng nhập lần cuối", không ép đổi mật khẩu tạm. Chính sách mật khẩu lệch: đăng ký đòi ≥8 ký tự + hoa/thường/số, admin tạo ghi "Tối thiểu 6 ký tự" (`S/64-admin-created.png`). Khi nhân viên nghỉ việc, quản trị chỉ có nút "Xoá khỏi workspace" (thùng rác) ở trang Thành viên — không có "vô hiệu hoá nhưng giữ lịch sử".
- Đề xuất: hàng hành động ⋯ (Vô hiệu hoá / Đặt lại mật khẩu — sinh link hoặc mật khẩu tạm / Đăng xuất mọi thiết bị), cột "Hoạt động gần nhất", ô tìm kiếm. Công: **M**.

**#8. Không có onboarding, và "Hướng dẫn" là hàng chết.**
- Nút "Hướng dẫn màn này" disabled (aria-label "Hướng dẫn màn này", `features/guides/GuideLauncher.tsx`), Ctrl+K có "Bắt đầu tour màn này", bảng `Guide` = 0 dòng (`SELECT count(*) FROM "Guide"` = 0), không màn nào để admin tạo hướng dẫn mặc dù vai trò có quyền "Tùy biến hướng dẫn/tour cho workspace" (`guide:manage` trong `S/14-role-create.png`).
- Đề xuất: seed 4–5 tour mặc định (Tổng quan, Dự án, Backlog, Thành viên, Quản trị); checklist "Bắt đầu" trên Tổng quan cho workspace mới (Tạo dự án → Mời thành viên → Bắt đầu sprint → Kết nối Telegram) — mỗi mục là một nút. Công: **M**.

**#9. Phân quyền "hiển thị" không khớp phân quyền "thật".**
- Member (vai trò "Thành viên") thấy toàn bộ menu Cài đặt/Kết nối/Quản trị, trang Vai trò đủ dữ liệu, và các nút Kết nối/Xoá Telegram. Chỉ khi bấm Kết nối mới báo "Bạn không có quyền…" (403) sau khi đã điền form (`S/56-member-integrations.png`; console 403 ở `S/56-member-api`). Trang API làm đúng (báo "Chỉ quản trị chung mới tạo…") — nên không nhất quán. Mở `/admin` bằng non-admin bị chuyển về `/` im lặng (không báo gì).
- Đề xuất: ẩn mục menu/nút theo `can()`; trang chỉ-xem thì hiện chế độ read-only; `/admin` trả "Bạn không có quyền" thay vì redirect im. Công: **S–M**.

**#10. Màn hình lãnh đạo trên điện thoại bị cắt.** (`S/m-sheet.png`)
- Thẻ chương trình: tên bị cắt thành "AL C…", "D…", "P…", thông tin người phụ trách xếp dọc từng từ; ma trận rủi ro mất cột 5; bảng nhân lực chỉ thấy 1,5 tuần; hàng vai trò mất "43 quyền"; Tài khoản admin mất nhãn "Admin HT"; nút "+" nổi che hành động cuối hàng. Thanh phụ Quản trị/Cài đặt là dải tab cuộn ngang không báo hiệu còn nữa.
- Đề xuất: card hoá trên mobile (xếp chồng, ẩn cột phụ), ma trận co lại 5 cột đều, FAB ẩn khi cuộn/có hành động inline. Công: **M**.

### 🟡 Nên cải thiện

**#11. Digest cho lãnh đạo còn sơ sài + lỗi chữ.** Form chỉ có Tên/Lịch (Hằng tuần — không chọn thứ/giờ)/Dự án (`S/34-digest-form.png`). Không kênh email dù hệ thống đã có email thông báo; không chọn người nhận; nội dung cố định 4 dòng (không có rủi ro, OKR, quá hạn, nhân lực). Hiển thị "Tài khoản &amp; Giỏ hàng" vì UI chỉ bỏ thẻ HTML (`features/digests/DigestsSection.tsx: stripTags`) còn thực thể do `escapeHtml` ở `digests.service.ts:443`. Đặt tận "Kết nối > Ứng dụng bên ngoài > Digest" nên lãnh đạo khó tìm. Đề xuất: lịch có thứ/giờ/múi giờ, kênh Email+Telegram, người nhận, chọn khối nội dung; giải mã thực thể. Công: **M**.

**#12. Tổng quan lãnh đạo thiếu "đèn tín hiệu" và rủi ro.** Tiến độ = xong/tổng; "đúng hạn" ở Danh mục dự án hiển thị cả khi dự án không có sprint/ngày (PSL 0/11 → "đúng hạn"). Không có trạng thái Xanh/Vàng/Đỏ do PM đặt kèm ghi chú, không thấy RAID/OKR/quá tải nhân lực trên trang Tổng quan (phải mở 3 trang khác). Đề xuất: cột "Sức khoẻ" (tự tính + PM ghi đè), thẻ "Top rủi ro / OKR chậm / người quá tải" trên Tổng quan. Công: **M**.

**#13. Văn bản lẫn ngôn ngữ/nhãn sai.** Chart trạng thái ở Báo cáo dự án dùng "To Do/In Progress/In Review/Done" trong khi Tổng quan dùng "Cần làm/Đang làm/Hoàn thành" (`S/31`); ô tìm trong chọn nhiều Dự án của dialog Chương trình ghi "Tìm vai trò…" (`S/23-prog-projects.png`; component tái dùng `AddPeopleDialog.tsx:254`, `InvitePanel.tsx:274`); quyền ghi `project`, `saved filter`, `migration`, `tour` tiếng Anh; validation gốc của trình duyệt hiện tiếng Anh ("Please include an '@'…", `S/63`). Công: **S**.

**#14. Chi tiết nhỏ khác.**
- Hai nút "Tạo vai trò" trùng (đầu trang + từng nhóm); hai vai trò cùng tên "Lập trình viên" ("Lập trình viên" và "Lập trình viên (chung)") (`S/13-roles.png`).
- Danh sách Quy trình có nhiều "Scrum mặc định" giống hệt (1 bản/dự án) mà không nói dự án nào dùng, kèm thùng rác trên từng dòng nguy hiểm (`S/48-workflows.png`). Cần nhóm "Dùng bởi: …" hoặc chỉ giữ 1 template.
- Dialog tạo dự án không hỏi mẫu (Scrum/Kanban/Quản lý yêu cầu), workflow, người phụ trách; key tự sinh đôi khi lạ ("AL Dự án của nhân viên" → ADNCNV).
- Mã công việc nhập từ Jira thành `JRA-STORY-1` thay vì giữ `JRA-1` (có tuỳ chọn giữ mã trong mô tả nhưng người dùng Jira quen mã cũ).
- KR trong OKR chỉ hiện "4 / 0", không hiện giá trị bắt đầu/đơn vị; không có lịch sử check-in/bình luận.
- Danh sách thành viên thiếu tìm kiếm/lọc/đếm theo vai trò khi lên 50+ người; nút sửa là bút chì không nhãn.
- Nhật ký kiểm toán hệ thống chỉ gồm hoạt động công việc; tạo/sửa vai trò, mời, xoá thành viên, đổi gói workspace không được ghi (`admin-system.service.ts:50` đọc `ActivityLog`; bảng rỗng dù đã có nhiều thao tác).
- Đăng nhập hiện khối "Tài khoản demo + Mật khẩu chung" (`LoginPage.tsx:17` ghi "chỉ khi dev") — cần chắc chắn ẩn ở production.
- Date picker dùng mm/dd/yyyy theo locale trình duyệt (headless en-US) — nên ép định dạng dd/MM/yyyy cho tiếng Việt.

---

## 4. Tính năng còn thiếu so với nhu cầu vai trò (so Jira/Linear/ClickUp), theo ưu tiên

**Cao**
1. Xuất báo cáo (CSV/Excel/PDF/in) + liên kết chia sẻ chỉ-đọc cho giám đốc/khách hàng (Jira Dashboards/Confluence, ClickUp Export).
2. Dashboard tuỳ biến theo widget (đã hứa trong tài liệu; Jira/ClickUp có sẵn) + dashboard riêng cho lãnh đạo (portfolio health).
3. Vòng đời lời mời + vô hiệu hoá/đặt lại mật khẩu + nhật ký kiểm toán cho sự kiện quản trị.
4. Cách ly dữ liệu đa-tenant trong danh sách người dùng (xem 🔴 #1).
5. Onboarding workspace mới: checklist + tour + dữ liệu mẫu tuỳ chọn.

**Trung bình**
6. Dự án riêng tư (giới hạn thành viên) — hiện "ai ở workspace đều tham gia mọi dự án"; lãnh đạo cần dự án nhạy cảm (nhân sự, M&A).
7. Trạng thái sức khoẻ dự án Xanh/Vàng/Đỏ + cập nhật trạng thái định kỳ (Linear Project Updates / Jira Align).
8. Digest qua email, chọn thứ/giờ/người nhận; thông báo email cho rủi ro đến hạn, OKR chậm.
9. SSO/SAML/Google login và 2FA (nhà quản trị doanh nghiệp hỏi đầu tiên); chính sách mật khẩu/phiên.
10. Template dự án khi tạo (Scrum, Kanban, Yêu cầu khách hàng...) kèm workflow tương ứng.
11. KR tự đo từ dữ liệu (số bug mở, % sprint) thay vì gõ tay.
12. Cấp phép/gói (FREE/PRO/ENTERPRISE chỉ là nhãn, không thấy giới hạn/ý nghĩa) và hạn ngạch dùng cho admin.

**Thấp**
13. Nhân bản vai trò/mẫu quyền; so sánh vai trò.
14. Tìm kiếm trong quản trị; xuất danh sách thành viên.

---

## 5. Điểm làm tốt nên giữ

- **Tổng quan lãnh đạo** (`S/21-home.png`): cảnh báo trước, KPI, bảng dự án theo sprint, "Dự báo / Dự kiến hoàn tất" và danh sách "Cần chú ý" bấm vào được — đúng kiểu "mở lên là biết cần làm gì".
- **RAID + ma trận 5x5** (`S/30-raid.png`): tính điểm tức thì khi chọn mức, tổng hợp theo dự án/toàn tổ chức, tab Rủi ro/Giả định/Vấn đề/Phụ thuộc. Tốt hơn nhiều Jira mặc định.
- **OKR** (`S/28`): kết quả then chốt đo ngược hoạt động đúng, form gọn, tạo ngay trong một dialog.
- **Wizard nhập Jira CSV** (`S/44-import-map.png`, `S/46`): tự ghép, "Chạy thử", cảnh báo cụ thể, hướng dẫn xuất từ Jira ngay ở bước 1 — giảm rủi ro chuyển đổi.
- **Empty-state viết tốt**, giải thích khái niệm (OKR, RAID, Chương trình, Nhóm) bằng ngôn ngữ thường.
- **Mật khẩu tạm của admin hệ thống chỉ hiện một lần kèm nút sao chép** (`S/64`); lỗi mật khẩu chung chung "Email hoặc mật khẩu không đúng" (không lộ tài khoản tồn tại).
- **Trang Quản trị hệ thống** (`/admin`): tổng quan sức khoẻ (DB/Redis/AI), cờ tính năng bật/tắt không cần deploy (đăng ký công khai, kill-switch AI, banner bảo trì) — đúng thứ ops cần.
- **Phản hồi 403 của trang API key** ("Chỉ quản trị chung…") và thông báo "Bạn không có quyền làm việc này. Liên hệ quản trị viên…" — thân thiện.
- **Responsive cơ bản không tràn trang** (scrollWidth = 390 trên mọi màn thử), menu hamburger hoạt động.
- Hai dạng tài liệu trong app (`/documentation` theo vai trò) và Ctrl+K có đủ lệnh điều hướng.
