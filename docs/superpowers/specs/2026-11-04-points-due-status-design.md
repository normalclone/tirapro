# Điểm tự tính, hạn bắt buộc, trạng thái trong "Việc của tôi" — thiết kế

Ngày: 2026-11-04 · Nhánh: `feat/points-due-status` (tách từ `fix/review-findings` @ 4cc14452)

Ba thay đổi người dùng (chủ sản phẩm, vận hành Tirapro cho TECA) yêu cầu cùng lúc. Triển khai lên VM 172.20.20.128 (production) theo `~/tirapro-data/vm128/deploy.sh`.

---

## 1. Điểm việc tự tính theo Loại × Độ khó × Ưu tiên

### Vì sao
Hiện `Issue.storyPoints` là ô nhập tay số tuỳ ý (đã gặp 80 điểm cho một bug nhỏ, TIRA-BUG-14). Điểm được dùng **cho cả hai việc**: ước lượng khối lượng (sprint, burndown) **và** chấm năng suất/KPI theo người. Số tuỳ ý làm KPI vô nghĩa và không so sánh được giữa người/dự án. Cần một quy tắc chung, ai cũng thấy được cách ra con số.

### Quyết định của người dùng
- **Công thức nhân:** `Điểm = Điểm gốc theo loại × Hệ số độ khó × Hệ số ưu tiên`, làm tròn thành số nguyên (half-up).
- **Hệ số mặc định:**
  - Điểm gốc: Sub-task 1 · Task 2 · Bug 2 · Story 3. **Epic = tổng điểm việc con** (không áp công thức).
  - Độ khó: Dễ ×1 · Trung bình ×2 · Khó ×3 · Rất khó ×5.
  - Ưu tiên: Lowest ×1 · Low ×1 · Medium ×1 · High ×1.5 · Highest ×2.
  - Ví dụ: Bug, Khó, High = 2×3×1.5 = 9; Task, Dễ, Medium = 2.
- **"Mức độ" = Độ ưu tiên** (trường `priority` có sẵn), KHÔNG phải Mức nghiêm trọng.
- **Độ khó là trường mới**, mặc định **Trung bình** khi tạo (không bắt buộc chọn, không thêm bước ở tạo nhanh).
- **Bảng hệ số cố định toàn hệ thống, chỉ SA (Super Admin) chỉnh** — áp cho mọi workspace để KPI so sánh được.
- **Tự tính, PM sửa được:** mặc định điểm do hệ thống tính; Quản trị dự án (quyền `project:admin`) và SA được ghi đè bằng tay. Người khác không sửa điểm được nữa.
- **Việc cũ: tính lại tất cả.** Mọi việc hiện có được gán Độ khó = Trung bình và điểm tính lại theo công thức (kể cả việc đã xong, kể cả điểm nhập tay cũ như 80).

### Dữ liệu (đã khảo sát VM ngày 2026-11-04)
- 155 issue, 40 có `storyPoints`.
- Mọi workspace dùng đúng 5 ưu tiên hệ thống `Lowest/Low/Medium/High/Highest` (rank 1..5, `isSystem`). `Priority` là bảng theo workspace, không có `key` — ánh xạ hệ số theo **tên ưu tiên hệ thống**.
- `IssueType.key` là enum `IssueTypeKey` (EPIC/STORY/TASK/BUG/SUBTASK) hoặc null cho loại tuỳ chỉnh.

### Hành vi
- Giữ cột `Issue.storyPoints` làm nơi lưu điểm cuối cùng → sprint, burndown, báo cáo, bộ lọc, JQL `storyPoints` không phải sửa.
- Thêm `Issue.difficulty` (enum 4 mức) và cờ `Issue.pointsManual` (boolean, mặc định false).
- Điểm được tính lại ở server mỗi khi tạo việc hoặc đổi loại / độ khó / ưu tiên, **trừ khi** `pointsManual = true`.
- PM ghi đè điểm → `pointsManual = true`; giao diện hiện "đã chỉnh tay" và nút **"Tính lại theo công thức"** (đặt `pointsManual=false` và tính lại).
- Epic: điểm = tổng `storyPoints` các việc con chưa xoá (theo `epicId`); cập nhật khi việc con đổi điểm/thêm/bớt/xoá/khôi phục/chuyển epic. Epic không ghi đè tay được.
- Ô điểm trên trang việc / dòng Việc chờ / sửa hàng loạt: người không có quyền ghi đè thấy điểm ở dạng chỉ đọc kèm tooltip giải thích cách tính (vd "Bug · Khó · High = 2×3×1.5 = 9").
- Độ khó hiển thị và sửa được ở trang việc (gần Ưu tiên), dòng Việc chờ nếu có chỗ, sửa hàng loạt, form tạo việc (mặc định Trung bình).
- SA có trang **Quản trị hệ thống → Cách tính điểm**: sửa ba bảng hệ số, xem ví dụ trực tiếp. Lưu xong → tính lại điểm mọi việc không ghi đè tay (toàn hệ thống).
- Loại tuỳ chỉnh (key null): dùng điểm gốc của Task. Ưu tiên tuỳ chỉnh (tên không thuộc 5 tên hệ thống) hoặc không có ưu tiên: hệ số ×1.

### Không làm (non-goals)
- Không đổi tên trường "Điểm ước lượng" trong báo cáo, không xây báo cáo KPI mới ở đợt này.
- Không cho từng workspace/dự án có bảng riêng.
- Không dùng Mức nghiêm trọng trong công thức.

---

## 2. Hạn mặc định 1 ngày sau ngày tạo, không được xoá trống

### Quyết định của người dùng
- Việc tạo mới không nhập hạn → **hạn = ngày tạo + 1 ngày**.
- Ô Hạn **không xoá trống được** (đổi ngày được, xoá thì không) — ở mọi đường sửa.
- Việc cũ chưa có hạn (105/155 trên VM):
  - **Chưa xong** → hạn = ngày triển khai + 1 ngày.
  - **Đã xong** → hạn = **ngày kết thúc** của việc (`resolvedAt`; thiếu thì lấy `updatedAt`).

### Hành vi
- `dueDate` là ngày lịch: lưu `YYYY-MM-DDT00:00:00.000Z` (xem `apps/web/src/lib/calendarDate.ts`). "Ngày tạo + 1" tính theo **ngày lịch giờ Việt Nam (Asia/Ho_Chi_Minh)**, không tính giờ.
- Server: tạo việc thiếu `dueDate` → tự điền. Cập nhật với `dueDate: null` → lỗi 422 `DUE_DATE_REQUIRED`, thông điệp tiếng Việt. Áp cho cả sửa hàng loạt và tự động hoá (hành động đặt hạn = rỗng bị từ chối hoặc bỏ khỏi lựa chọn).
- Nhập Jira/Excel thiếu hạn: cùng quy tắc ngày tạo + 1 (ngày tạo của bản ghi trong Tirapro).
- Form tạo việc điền sẵn hạn = hôm nay + 1 (người dùng thấy và đổi được). Ô Hạn trên trang việc bỏ nút xoá.
- Kiểm tra sẵn có "hạn không trước ngày tạo" giữ nguyên.
- Quyền sửa hạn (biểu tượng khoá trên ô Hạn) giữ nguyên.

---

## 3. "Việc của tôi" hiện đúng trạng thái

### Vì sao
Danh sách "Việc của tôi" trên trang Tổng quan (`apps/web/src/features/dashboard/DashboardPage.tsx`, quanh dòng 814) chỉ có một chấm màu theo nhóm trạng thái; người dùng không biết việc đang "Chờ test", "Đang làm" hay "Hoàn thành".

### Hành vi
- Mỗi dòng hiện **tên trạng thái thật** của việc (theo workflow dự án) dạng nhãn nhỏ, màu theo nhóm trạng thái (TODO/IN_PROGRESS/DONE) như board đang dùng. Chấm màu bỏ hoặc gộp vào nhãn.
- Áp dụng tương tự cho gadget "Việc của tôi chưa xong" trong Dashboards (`apps/web/src/features/dashboards/registry.tsx`) nếu nó cũng chỉ hiện chấm.

---

---

## 4. Trang chi tiết việc: ẩn khối trống, thay bằng nút "+ Thêm mục"

Người dùng duyệt 2026-11-04.
- Các khối sau **ẩn khi không có dữ liệu**:
  - Tiêu chí chấp nhận
  - Các bước cần làm
  - Thành phần
  - Sửa ở phiên bản
  - Bị ảnh hưởng ở phiên bản
  - Liên kết
  - Tài liệu liên quan
  - Thông tin môi trường
- **Tệp đính kèm vẫn hiện như cũ**, và Mô tả cũng giữ nguyên.
- Thay các khối ẩn bằng **một nút "+ Thêm mục"** (không gọi là "Thêm thành phần" vì trùng tên trường Thành phần/Component).
  - Bấm vào sẽ ra danh sách các khối đang ẩn; chọn khối nào thì khối đó hiện ra (ở đúng vị trí cũ của nó) và đặt con trỏ vào ô nhập.
  - Hết khối ẩn thì nút biến mất.
- Một khối đã có dữ liệu thì luôn hiện. Khối được mở bằng nút mà người dùng bỏ trống rồi tải lại trang thì ẩn lại (trạng thái "đang mở" chỉ sống trong phiên xem trang).
- Người không có quyền sửa việc thì không thấy nút; họ chỉ thấy các khối có dữ liệu.
- Áp cho cả trang việc đầy đủ và khung xem nhanh bên phải.

## 5. Bảng kết quả bộ lọc: luôn thấy Trạng thái, Người được giao

Bảng kết quả JQL/bộ lọc (`apps/web/src/features/saved-filters/`) đã có sẵn cột mặc định (Trạng thái, Ưu tiên, Người được giao, Điểm, Hạn). Lỗi nằm ở chỗ: khi mở khung xem việc bên phải, cột Tiêu đề chiếm hết bề ngang và đẩy các cột kia ra ngoài vùng cuộn ngang.

Cách sửa:
- Cột Tiêu đề có độ rộng tối đa và cắt chữ bằng `…`, có tooltip hiện tiêu đề đầy đủ.
- Các cột còn lại giữ độ rộng tối thiểu vừa nội dung, để Mã, Tiêu đề, Trạng thái và Người được giao cùng nhìn thấy được ở khổ 1500px khi khung xem nhanh đang mở.
- Trạng thái hiện dạng nhãn màu theo nhóm trạng thái (dùng chung thành phần với mục 3).

## Không làm
- Khoá bug do Tester tạo: người dùng chọn **không khoá** (giữ quyền như hiện tại).
- Workflow riêng theo loại việc: chưa làm. Người dùng tự thêm trạng thái ở Cài đặt → Quy trình (mỗi dự án có bản riêng).

## Quyết định của người viết (sau vòng kiểm tra của builder — người dùng xem lại khi duyệt)
1. **SA = `User.isSystemAdmin`.** Trang "Cách tính điểm" chỉ hiện và chỉ ghi được với `isSystemAdmin`.
2. **Mọi đường ghi điểm khác đi qua công thức:**
   - Nhập Jira/Excel: bỏ qua điểm trong file, tính theo công thức (nhất quán với "tính lại tất cả").
   - Nút AI "Gợi ý ưu tiên & điểm": gợi ý **độ khó** (và ưu tiên) thay vì số điểm; điểm suy ra từ công thức.
   - Tự động hoá: bỏ `storyPoints` khỏi danh sách trường "đặt giá trị"; thêm `difficulty`. Quy tắc cũ đang đặt `storyPoints` bị bỏ qua hành động đó (ghi cảnh báo trong log chạy quy tắc).
   - Sửa hàng loạt điểm: chỉ người có quyền ghi đè, và đặt `pointsManual=true`. Sửa hàng loạt độ khó: ai sửa được việc thì sửa được.
3. **Tổng điểm Epic** = tổng `storyPoints` của mọi việc chưa xoá có `epicId` = epic đó, **kể cả sub-task**. Mỗi việc (Story, Task, Bug, Sub-task) là một phần việc riêng nên mỗi cái được cộng một lần.
4. **Ghi đè tay:** chỉ số nguyên 0–100. Cột `storyPoints` vẫn là `Float?`; các giá trị lẻ cũ sẽ mất khi tính lại tất cả.
5. **Khi đã ghi đè tay:** đổi loại, độ khó hay ưu tiên **không** tính lại điểm. Muốn tính lại thì bấm nút "Tính lại theo công thức".
6. **"Đã xong"** (khi điền hạn cho việc cũ) = trạng thái thuộc nhóm DONE. Mở lại việc sau này không đổi hạn.
7. **Hạn mặc định** đặt ở lõi tạo việc (`createCore`/`createWithin`), nên **mọi** đường tạo đều được: form, tạo nhanh, nhân bản, AI, nhập file, việc định kỳ. Nhập file có hạn rỗng cũng theo quy tắc ngày tạo + 1.
8. **Khi SA lưu bảng hệ số:** tính lại trong một job nền, chia lô theo dự án.
   - Mỗi việc đổi điểm được tăng `version` để OCC đúng.
   - Không ghi lịch sử hoạt động cho từng việc; ghi **một** dòng audit `points.formula_changed`.
   - Phát sự kiện realtime ở mức dự án để client tải lại.
   - Tổng điểm Epic được tính lại sau cùng.
   - Migration "tính lại tất cả" lúc deploy dùng cùng hàm này.

## Ràng buộc chung
- Tuân `CLAUDE.md` dự án: zod schema trong `packages/shared`, enum Prisma → `pnpm gen:enums`, rebuild types/shared sau khi đổi kiểu, lỗi `SCREAMING_SNAKE`, OCC `version`.
- UI bám `DESIGN.md` + `docs/UX_CONVENTIONS.md`; chữ giao diện tiếng Việt.
- Migration dữ liệu (độ khó mặc định, tính lại điểm, điền hạn) chạy **một lần** trong `prisma migrate deploy` hoặc script vận hành chạy sau migrate trong `deploy.sh`; phải idempotent. Deploy đã tự pg_dump trước.
- `pnpm lint` 0 lỗi, `pnpm -r typecheck`, `pnpm test` xanh.

## Để người làm tự quyết
- Tên enum/giá trị độ khó, nơi lưu bảng hệ số (bảng mới một dòng hay key-value), cách cache.
- Cập nhật điểm Epic: đồng bộ trong transaction hay qua event.
- Bố cục trang cấu hình hệ số và vị trí ô Độ khó, miễn đúng DESIGN.md.

## Bổ sung 2026-11-04: điểm Task có Sub-task (người dùng chọn "cách 2")

Quy ước của người dùng: Epic = Module/Chức năng, Task = công việc của Dev/Tester/BA, Sub-task = việc nhỏ hơn.

- **Việc cha (không phải Epic) đang có ≥1 việc con chưa xoá** (qua `parentId`): điểm = **tổng điểm các việc con**. Điểm này không áp công thức và không ghi đè tay được, giống Epic. Hết việc con thì việc cha quay về tính theo công thức (hoặc giữ giá trị đã ghi đè tay trước đó nếu `pointsManual`).
- **Tổng điểm Epic** = tổng điểm các việc **cấp trên** thuộc Epic (`epicId` = epic và `parentId` IS NULL). Điểm của Task đã bao gồm điểm Sub-task của nó, nên Sub-task không bị cộng thêm lần nữa. **Thay cho quyết định số 3 ở trên.**
- **Mọi phép cộng điểm** (sprint, burndown, velocity, báo cáo theo người, KPI, digest, nguồn lực, và tổng phía web) chỉ đếm **việc lá**: bỏ Epic và bỏ việc đang có việc con chưa xoá. Nhờ vậy công được ghi đúng cho người làm Sub-task và không bị cộng trùng.
- Việc cha được cập nhật khi việc con được tạo, xoá, khôi phục, đổi `parentId`, đổi điểm, hoặc đổi loại / độ khó / ưu tiên. Sau đó Epic của việc cha được cộng lại.
