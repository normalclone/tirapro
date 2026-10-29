# 11. Trợ lý Tirapro (chatbot chế độ cơ bản) — Đặc tả chi tiết

[← Về mục lục](README.md)

> Phiên bản 0.1 · 2026-10-29 · Đã đối chiếu code. Chạy hoàn toàn ở **web**, không thêm API, không gọi AI/LLM ngoài.

Mã nguồn: `apps/web/src/features/assistant/` (`intents.ts`, `knowledge.ts`, `screens.ts`, `queries.ts`, `draft.ts`, `respond.ts`, `deps.ts`, `conversation.ts`, `panelStore.ts`, `useAssistant.ts`, `AssistantPanel.tsx`, `DraftCard.tsx`). Mục lục Hướng dẫn dùng chung: `apps/web/src/features/docs/docsIndex.ts`.

## 1. Phạm vi và giới hạn của chế độ cơ bản

**Trong phạm vi**
1. Hỏi đáp **theo màn hình đang đứng** và **theo hệ thống** (tra việc, mã việc, sprint).
2. **Hướng dẫn sử dụng** (FAQ) lấy từ trang Hướng dẫn `/documentation`.
3. **Hỗ trợ tạo việc**: soạn thẻ nháp từ một câu lệnh, người dùng bấm **Tạo** mới tạo.

**Giới hạn (chủ ý)**
- Không gửi chữ người dùng hay dữ liệu hệ thống tới dịch vụ AI nào. Nhận diện ý định bằng luật + từ khoá không dấu; trả lời bằng tra cứu dữ liệu có sẵn.
- Không hiểu ngôn ngữ tự do: câu ngoài luật và ngoài kho tri thức nhận câu "chưa hiểu" kèm gợi ý.
- **Không lưu hội thoại ở máy chủ.** Hội thoại chỉ ở state trình duyệt và `sessionStorage` (khoá `tirapro:assistant:v1:<userId>`), mất khi đóng tab/đăng xuất.
- Không có endpoint mới: mọi dữ liệu đọc qua API sẵn có bằng token của người dùng (xem §4).
- Ẩn trong khu `/admin` (Trợ lý gắn với không gian làm việc, cùng điều kiện với nút trợ lý AI).

## 2. Giao diện: ô chat nổi

- **Bong bóng tròn** (`MessageCircle`) nổi góc dưới phải. Desktop (từ `lg`): nằm **bên trái nút nổi "+"** để menu của nút "+" (mở lên trên) không đè bong bóng. Dưới `lg`: ngay trên thanh tab đáy. Có chấm đỏ cho tới lần mở đầu tiên trong phiên (`sessionStorage` `tirapro:assistant:seen`).
- **Cửa sổ chat** `role="dialog" aria-modal="false"`: desktop 360px × tối đa 520px, neo trên hàng nút nổi; dưới `lg` neo **phải** (rộng `100vw − 16px`, từ `sm` rộng 360px), cao từ đỉnh tới trên thanh tab đáy. Có bàn phím ảo (`visualViewport`) thì cửa sổ neo **trên bàn phím** để ô nhập luôn thấy (`layout.ts`). **Không modal**: không lớp phủ, không khoá cuộn, không bẫy focus — trang phía sau vẫn thao tác được.
- Header: biểu tượng trợ lý, "Trợ lý Tirapro", nút **Xoá hội thoại**, **Thu nhỏ** (còn thanh tiêu đề, bấm để bung), **Đóng**.
- Tin nhắn: người dùng bên phải (màu primary), trợ lý bên trái; chip gợi ý dưới tin trợ lý; thẻ nháp trong luồng chat. Vùng tin có `role="log" aria-live="polite"`.
- Ô nhập dưới cùng: **Enter gửi, Shift+Enter xuống dòng** (không gửi khi đang gõ dở bằng bộ gõ IME). Gợi ý phím ẩn trên cảm ứng.
- **Esc** (khi focus trong cửa sổ) đóng và trả focus về bong bóng (hoặc nút trên thanh đầu trang). Mở → focus vào ô nhập.
- Trạng thái mở/thu nhỏ **toàn cục** (`panelStore`, Zustand) nên giữ nguyên khi chuyển trang. Chuyển sang `/admin` thì đóng.
- Lối mở khác: nút "Trợ lý Tirapro" trên thanh đầu trang (cạnh nút trợ lý AI/hướng dẫn), lệnh Cmd+K **"Hỏi trợ lý"**, phím **`g` rồi `a`** (khai ở `lib/shortcuts.ts`, id `global.assistant`). Các lối này chỉ mở ô chat.
- Mở bằng Cmd+K: focus vào ô nhập được kéo lại vài nhịp (60/200/450ms) nếu Radix của bảng lệnh trả focus về trang sau đó. Thu nhỏ → focus sang nút Bung. Đóng → chạy animation thoát (150ms) rồi trả focus về bong bóng.
- Chuyển động: vào/ra bằng `animate-in fade-in slide-in-from-bottom-2` với token `duration-base`; tắt khi `prefers-reduced-motion` (`motion-reduce:animate-none`).
- Mọi chữ do người dùng/dữ liệu việc hiển thị dạng **TEXT** (không `dangerouslySetInnerHTML`). Liên kết nội bộ dùng router; riêng liên kết tới trang Hướng dẫn (nằm ngoài khung ứng dụng, công khai) mở **tab mới** (`rel="noopener noreferrer"`) để ô chat không mất.

## 3. Ý định, câu mẫu, nguồn dữ liệu và phản hồi

Nhận diện không dấu, không phân biệt hoa/thường (`normalizeVi` của `lib/text.ts`). Thứ tự luật: chào → "làm được gì" → lệnh tạo việc → màn này → tóm tắt việc → sprint → quá hạn → đến hạn → việc của tôi → tìm → mã việc → hỏi cách dùng. Câu có dấu hiệu hỏi cách làm ("làm sao", "cách", "ở đâu", "hướng dẫn", "tạo/bắt đầu/kết thúc sprint"…) **không** bị hiểu là lệnh.

| # | Ý định | Câu mẫu | Nguồn dữ liệu | Phản hồi |
|---|---|---|---|---|
| 1 | Hướng dẫn / FAQ | "làm sao tạo sprint", "phân quyền thế nào", "nhập excel ở đâu", "phím tắt" | `docsIndex` + mục bổ sung (`knowledge.ts`) | 1–3 mục khớp nhất (tóm tắt + "Xem hướng dẫn" → `/documentation#anchor`); mục Nhập Excel có thêm nút mở Cấu hình → Dữ liệu của dự án hiện tại. Không khớp → ý định 5 |
| 2a | Màn hiện tại | "màn này dùng để làm gì", "hướng dẫn màn này", "có gì ở đây" | `screens.ts` (mô tả tĩnh theo `routeToScreen`) + `GET /guides?screen=` | Mô tả màn, link Hướng dẫn; nếu màn có tour: dòng mô tả tour và nút **Chạy hướng dẫn từng bước** (phát `tirapro:tour`, cơ chế `GuideLauncher`) |
| 2b | Tóm tắt việc | "tóm tắt việc này" (trang `/issue/:key`) | `GET /issues/:key`, `GET /issues/:id/comments`, danh sách việc dự án | Loại, trạng thái, người phụ trách, ưu tiên, hạn (kèm "quá hạn N ngày"), số việc con, số bình luận, link mở |
| 2c | Sprint | "sprint hiện tại thế nào" (trong dự án) | `GET /sprints?projectId=`, danh sách việc dự án (cache Bảng việc) | Tên sprint ACTIVE, ngày kết thúc (còn/quá N ngày), số việc, đếm theo To Do / In Progress / Done, mục tiêu. Ngoài dự án: hỏi chọn dự án (chip) |
| 2d | Chip theo màn | mở ô chat | `screens.ts` | Lời chào + 3–4 chip hợp màn (vd Bảng việc: "Sprint hiện tại thế nào", "Việc quá hạn", "Tạo việc", "Phím tắt") |
| 3a | Việc của tôi | "việc của tôi", "việc tôi được giao" | `GET /search?jql=` | `assignee = currentUser() AND statusCategory != DONE` |
| 3b | Quá hạn | "việc quá hạn" | `GET /search?jql=` | `due < startOfDay() AND statusCategory != DONE` |
| 3c | Đến hạn | "việc đến hạn tuần này", "…hôm nay" | `GET /search?jql=` | `due >= startOfDay() AND due <= endOfWeek()` (hoặc `endOfDay()`) và chưa Done; không nói khoảng → tuần này |
| 3d | Tìm | "tìm đăng nhập" | `GET /search?jql=` | `text ~ "<từ khoá>"` (từ khoá thoát `\` và `"`) |
| 3e | Mã việc | "BUG-12", "mở DEMO-TASK-3" | `GET /issues/:key` | Như 2b; không có/không được xem → "Không thấy công việc …" |
| 4 | Tạo việc | "tạo việc Sửa lỗi login !cao @an ^mai #sprint ~3", "thêm bug …", "tạo story/epic …" | `GET /projects/:key/meta`, `GET /users?projectId=`, sprint, `GET /projects/:id/permissions/me` | Thẻ nháp (§5) |
| 5 | Không hiểu | câu ngoài luật | `POPULAR_QUESTIONS`, chip theo màn | Câu thân thiện + chip câu hỏi phổ biến + nút **Tìm "<câu>" trong công việc** |

Việc trong danh sách (3a–3d): trong dự án (URL `/p/:key` hoặc việc đang xem thuộc dự án) thì thêm `project = "KEY"`, ngoài dự án thì toàn workspace. Hiện **tối đa 5 việc** (mã, tiêu đề, trạng thái, hạn; quá hạn tô đỏ), kèm "Xem tất cả" → `/filters?jql=<JQL>`. Còn trang kế → ghi "hơn N". Lỗi API → "Mình chưa lấy được dữ liệu: <thông báo>".

Từ đồng nghĩa (task = việc = công việc = issue; tạo = thêm = lập; quyền = phân quyền = vai trò…) cài ở `knowledge.ts`. Điểm: từ khớp tiêu đề ×3, từ khoá ×2, tóm tắt ×1, nhân độ hiếm của từ; cụm cả câu khớp +3; cần ít nhất một từ khớp tiêu đề/từ khoá và điểm ≥ ngưỡng `MIN_SCORE`.

## 4. Nguồn dữ liệu và quyền

Chỉ dùng API sẵn có qua `queryClient.fetchQuery` trên **cùng khoá cache** với Bảng việc/hộp tạo việc, token của chính người dùng — nên RBAC và cô lập workspace do API đảm bảo như mọi màn khác. Không thêm endpoint, không thêm bảng, không migration. Danh sách "Xem tất cả" đi qua trang Bộ lọc nên cũng chịu quyền như tìm kiếm thường.

## 5. Luồng tạo việc (nháp → xác nhận)

1. Người dùng gõ lệnh: động từ (tạo/thêm/new/create/add/lập) + danh từ (việc/công việc/task/issue/bug/lỗi/story/epic) + tiêu đề kèm token `! @ # ~ ^`. "báo lỗi …" cũng là tạo Bug. Câu hỏi cách làm ("báo lỗi thế nào", "làm sao tạo task") không phải lệnh.
2. **Chọn dự án:** dự án hiện tại nếu còn hoạt động; ngoài dự án (hoặc dự án đã lưu trữ) → hỏi bằng chip dự án (gần dùng trước, tối đa 5); bấm chip gửi lại đúng câu lệnh cho dự án đó (chỉ lượt đó).
3. **Quyền:** `issue:create` (quyền workspace/system admin hoặc quyền dự án). Biết chắc không có → "Bạn không có quyền tạo việc trong dự án KEY…", không dựng thẻ. Chưa biết (đang tải/lỗi) → vẫn soạn nháp, API kiểm lúc tạo.
4. **Tiêu đề rỗng** (chỉ lệnh, hoặc chỉ toàn token) → hỏi lại kèm câu mẫu; không dựng thẻ.
5. **Thẻ nháp** dựng bằng chính `buildQuickAddInput`/`parseTitleTokens` của hộp tạo việc: dự án, loại, tiêu đề (đã bỏ token), ưu tiên, người phụ trách, sprint, điểm, hạn. Loại: theo gợi ý (Bug/Story/Epic, so khớp `key` rồi tên); dự án không có loại đó → dùng loại mặc định (Task) kèm cảnh báo. Không bao giờ chọn loại sub-task. Epic không gửi `epicId`. Token không khớp ở lại trong tiêu đề và có cảnh báo kèm gợi ý sửa.
6. **Nút trên thẻ:**
   - **Tạo** — gọi mutation `useCreateIssue(projectId)` có sẵn (`POST /issues`) với đúng payload của thẻ. Đây là **lối duy nhất** tạo việc của Trợ lý (`confirmDraft`); lệnh gõ chỉ dựng nháp, **không bao giờ tự tạo**. Thành công: thẻ ghi "Đã tạo KEY" (link `/issue/KEY`) + toast; lỗi: thẻ hiện lỗi và cho "Tạo lại".
   - **Mở form đầy đủ** — mở `CreateIssueModal` điền sẵn dự án, loại, tiêu đề (giữ token, form tự áp) qua `preset.summary`/`preset.typeId` của `stores/createIssue.ts`; thẻ chuyển "Đã mở trong form đầy đủ".
   - **Bỏ** — thẻ ghi "Đã bỏ nháp này".
7. Tải lại trang khi thẻ đang "creating" → quay về "pending" (không coi là đã tạo).

## 6. Phân quyền

| Hành động | Điều kiện |
|---|---|
| Dùng Trợ lý (hỏi đáp, hướng dẫn) | Đã đăng nhập, không ở khu `/admin` |
| Tra việc / mã việc / sprint | Như quyền xem của API tương ứng (việc ngoài quyền xem → "Không thấy công việc …") |
| Tạo việc | `issue:create` ở dự án đích; dự án lưu trữ không nhận việc |

## 7. Bảo mật và riêng tư

- Không có lời gọi ra ngoài hệ thống Tirapro; không bên thứ ba nhận nội dung hội thoại.
- Hội thoại chỉ trong `sessionStorage` theo người dùng (mọi đọc/ghi bọc `try/catch`; dữ liệu hỏng/sai hình dạng bị bỏ khi đọc); xoá bằng nút "Xoá hội thoại".
- JQL dựng bằng chuỗi cố định; từ khoá người dùng luôn trong nháy kép đã thoát nên không chèn được điều kiện (test kiểm bằng `parseJql`).
- Chữ người dùng và tiêu đề việc luôn hiển thị TEXT (test render kiểm `<img …>` bị thoát).
- Liên kết tới trang Hướng dẫn là đường dẫn nội bộ cố định (`/documentation#…`), không URL ngoài.

## 8. Tiêu chí chấp nhận (Given / When / Then)

- **AC-11-01** Given đang ở Bảng việc, When mở ô chat lần đầu, Then thấy lời chào và 3–4 chip hợp Bảng việc, focus ở ô nhập.
- **AC-11-02** Given ô chat đang mở, When bấm một thao tác ở trang phía sau, Then thao tác chạy bình thường (không lớp phủ), và ô chat vẫn mở khi chuyển trang.
- **AC-11-03** Given ô chat có focus, When nhấn Esc, Then ô chat đóng và focus về bong bóng.
- **AC-11-04** Given gõ "Làm sao tạo sprint?" (hoặc không dấu), When gửi, Then nhận 1–3 mục hướng dẫn, mục đầu là "Lập & chạy một sprint", mỗi mục có tóm tắt và liên kết `/documentation#lap-chay-sprint`.
- **AC-11-05** Given trong dự án DEMO, When hỏi "việc quá hạn", Then nhận tối đa 5 việc quá hạn của DEMO chưa Done và liên kết "Xem tất cả" tới `/filters?jql=…project = "DEMO" AND due < startOfDay()…`.
- **AC-11-06** Given ở trang một công việc, When hỏi "tóm tắt việc này", Then thấy trạng thái, người phụ trách, hạn, ưu tiên, số việc con, số bình luận.
- **AC-11-07** Given trong dự án có sprint đang chạy, When hỏi "sprint hiện tại thế nào", Then thấy tên sprint, ngày kết thúc và số việc theo To Do / In Progress / Done.
- **AC-11-08** Given trong dự án, When gõ "tạo việc Sửa lỗi login !high @an ^mai ~3", Then xuất hiện thẻ nháp đúng dự án/loại/tiêu đề "Sửa lỗi login"/ưu tiên/người/hạn/điểm và **chưa có việc nào được tạo**.
- **AC-11-09** Given thẻ nháp đang chờ, When bấm **Tạo**, Then gọi `POST /issues` đúng một lần với payload của thẻ, thẻ ghi "Đã tạo KEY" kèm liên kết và có toast.
- **AC-11-10** Given thẻ nháp có token không khớp (vd `@khongco`), Then thẻ cảnh báo và token vẫn nằm trong tiêu đề.
- **AC-11-11** Given gõ "thêm bug …" và dự án có loại Bug, Then thẻ có loại Bug; Given dự án không có loại Bug, Then thẻ dùng loại mặc định kèm cảnh báo.
- **AC-11-12** Given ngoài dự án, When gõ lệnh tạo việc, Then trợ lý hỏi chọn dự án bằng chip, và chọn chip dựng thẻ ở dự án đó.
- **AC-11-13** Given người dùng không có `issue:create` ở dự án, When gõ lệnh tạo việc, Then nhận thông báo không có quyền và không có thẻ nháp.
- **AC-11-14** Given thẻ nháp, When bấm **Mở form đầy đủ**, Then hộp tạo việc mở với dự án, loại và tiêu đề điền sẵn, thẻ ghi đã mở form.
- **AC-11-15** Given gõ câu ngoài luật và ngoài kho, Then nhận câu "chưa hiểu", chip câu hỏi phổ biến và nút Tìm "<câu>" trong công việc.
- **AC-11-16** Given đã có hội thoại, When tải lại trang trong cùng tab, Then hội thoại còn; When bấm Xoá hội thoại, Then rỗng và sessionStorage bị xoá; Given sessionStorage bị chặn, Then Trợ lý vẫn chạy (chỉ không lưu).
- **AC-11-17** Given tiêu đề việc chứa `<img src=x onerror=…>`, Then hiển thị đúng chữ, không thực thi.
- **AC-11-18** Given ở `/admin`, Then không có nút, bong bóng, lệnh Cmd+K hay phím `g a` mở Trợ lý.

## 9. ⚠️ Ghi chú / giới hạn đã biết

- "Việc của tôi" chỉ gồm việc **chưa xong** (khác chip lọc nhanh "Của tôi" của Bảng việc vốn hiện cả việc đã xong).
- Số việc của sprint đếm từ danh sách việc dự án nạp ở FE (trần `ISSUE_LIST_HARD_CAP` của Bảng việc).
- Thẻ nháp đang "creating" mà tải lại trang quay về "pending": nếu request đã thành công trước đó, bấm Tạo lần nữa sẽ tạo bản sao (người dùng tự bấm; chấp nhận).
- Toast "Đã tạo KEY" chỉ hiện khi ô chat đang thu nhỏ/đóng (khi đang mở, thẻ trong luồng đã báo — toast không đè ô nhập).
- Câu ngắn (≤4 từ) có mã việc luôn tra theo mã (vd "BUG-12 quá hạn chưa").
- Hội thoại đã lưu được lọc khi đọc: chỉ nhận liên kết nội bộ (bắt đầu bằng `/`, không `//`).
- Phát hiện `tirapro:tour` chỉ chạy được khi màn có tour; màn không có thì không có nút.
