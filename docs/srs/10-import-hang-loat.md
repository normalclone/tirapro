# 10. Nhập công việc hàng loạt — Đặc tả chi tiết

[← Về mục lục](README.md)

> Phiên bản 0.1 · 2026-10-29 · Đã đối chiếu code. Đường chính là **biểu mẫu Excel** (§2–§6); CSV dán tay, JSON export, lịch sử nhập có ở §7; nhập từ Jira chỉ tóm lược ở §8.

Mã nguồn: `apps/api/src/modules/import/` (`import.controller.ts`, `import.service.ts`, `excel/*`), DTO dùng chung `packages/shared/src/schemas/import.ts`, giao diện `apps/web/src/features/project-config/` (`DataSection.tsx`, `ExcelImportBlock.tsx`).

## 1. Thực thể dữ liệu

Không có bảng mới. Nhập Excel dùng lại `ImportJob` và các bảng công việc sẵn có.

### 1.1 `ImportJob`

| Trường | Kiểu | Bắt buộc | Ràng buộc | Ý nghĩa |
|---|---|---|---|---|
| id | cuid | Có (PK) | | |
| workspaceId | string | Có | FK → Workspace, cascade | Tenant sở hữu |
| source | enum `ImportSource` | Có | `JIRA_CLOUD`, `JIRA_SERVER`, `CSV`, **`EXCEL`** | Nguồn nhập. Nhập JSON ghi `CSV` kèm `config.format = "json"` |
| status | enum `ImportStatus` | Có | `PENDING` (mặc định), `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` | |
| config | Json | Có | mặc định `{}` | Excel: `{ "projectId": "…", "format": "excel" }` |
| progress | int | Có | 0–100 | |
| totalItems | int? | Không | | Excel: số dòng dữ liệu không trống |
| processedItems | int | Có | mặc định 0 | Số công việc đã tạo |
| result | Json? | Không | | Excel: `{ created, failed, labels, errors[≤50] }` |
| errorLog | text? | Không | | Lỗi cấp job (job `FAILED` do ngoại lệ) |
| createdById | string? | Không | | Người nhập |
| startedAt / completedAt / createdAt / updatedAt | DateTime | | | Mốc thời gian |

Chỉ mục `(workspaceId, status)`. Migration thêm giá trị enum: `20261029100000_import_source_excel` (`ALTER TYPE "ImportSource" ADD VALUE IF NOT EXISTS 'EXCEL'`).

### 1.2 Bảng được ghi khi nhập một dòng Excel

| Bảng | Khi nào | Ghi chú |
|---|---|---|
| `Issue` | luôn | Tạo qua `IssuesService.createWithin` (đánh số, mã, rank cuối danh sách, trạng thái khởi tạo, lịch sử `STATUS`) |
| `Issue.reporterId` | cột *Người báo cáo* có giá trị | Đặt NGAY lúc tạo qua tham số nội bộ `overrides.reporterId` của `createWithin` (chỉ đường nhập dùng; API công khai không đặt được) nên sự kiện `ISSUE_CREATED` mang đúng người báo cáo. Mặc định là người nhập tệp |
| `Label`, `IssueLabel` | cột *Nhãn* | Tạo nhãn mới theo `(projectId, name)` bằng `upsert`, gắn qua `IssueLabel` |
| `IssueComponent` | cột *Thành phần* | Chỉ gắn thành phần đã có |
| `IssueFixVersion` | cột *Phiên bản* | `type = FIX` |

## 2. Cấu trúc biểu mẫu Excel

Tệp tải về có **3 sheet**:

| Sheet | Trạng thái | Nội dung |
|---|---|---|
| `Công việc` | hiện | Dòng 1 là tiêu đề (cố định khi cuộn); dòng dữ liệu bắt đầu từ dòng 2; validation áp cho dòng **2–1001** (1000 dòng) |
| `Hướng dẫn` | hiện | Tên dự án và mã, ngày tạo biểu mẫu (`dd/mm/yyyy HH:mm` giờ Việt Nam), cách điền, định dạng ngày, nhiều giá trị dùng `;`, giới hạn, xem trước |
| `DanhSach` | **ẩn hoàn toàn** (`veryHidden`) | Mỗi danh sách một cột (dòng 1 là tên danh sách, giá trị từ dòng 2): A Loại việc, B Ưu tiên, C Trạng thái, D Thành viên, E Sprint, F Epic, G Nhãn, H Thành phần, I Phiên bản |

Drop-list **không** dùng danh sách inline (giới hạn 255 ký tự, vỡ khi giá trị có dấu phẩy) mà tham chiếu range tuyệt đối, vd `DanhSach!$A$2:$A$40`. Danh sách rỗng thì **bỏ validation** của cột đó. Giá trị có dấu `;` bị loại khỏi danh sách (vì `;` là ký tự tách nhiều giá trị).

### 2.1 Các cột (theo thứ tự)

`*` là bắt buộc — tiêu đề ghi `Tiêu đề*`, `Loại việc*`, cột được tô nền vàng nhạt. Mỗi ô tiêu đề có ghi chú hướng dẫn.

| # | Cột | Kiểu | Validation trong Excel | Nguồn drop-list / quy tắc khi đọc |
|---|---|---|---|---|
| A | Tiêu đề* | chữ ≤ 255 | — | Bắt buộc |
| B | Mô tả | chữ (Markdown) | — | ≤ 50.000 ký tự; lưu `descriptionFormat = MARKDOWN` |
| C | Loại việc* | list | `list`, chặn (`stop`) | Loại việc của workspace **trừ loại việc con (sub-task)** — loại này cần việc cha mà biểu mẫu không có; không phân biệt hoa/thường |
| D | Ưu tiên | list | `list`, chặn | `Priority` của workspace, xếp theo `rank` giảm dần; bỏ trống = ưu tiên mặc định của workspace |
| E | Trạng thái | list | `list`, chặn | Trạng thái trong workflow mặc định của dự án, theo `order`; bỏ trống = trạng thái khởi tạo |
| F | Người phụ trách | list | `list`, cảnh báo (`warning`, cho gõ email) | Thành viên dự án đang `ACTIVE`, hiển thị `Tên <email>` |
| G | Người báo cáo | list | `list`, cảnh báo (`warning`) | Như trên; bỏ trống = người nhập tệp |
| H | Sprint | list | `list`, chặn | Sprint chưa xoá và chưa đóng (`ACTIVE`, `FUTURE`), theo `sequence`; bỏ trống = Việc chờ |
| I | Epic | list | `list`, cảnh báo (`warning`, cho gõ mã epic) | Công việc loại Epic của dự án (`key = EPIC` hoặc `hierarchyLevel ≥ 1`), hiển thị `KEY — tiêu đề`; nhận cả mã epic trần |
| J | Nhãn | list gợi ý | `list`, `errorStyle = information` (không chặn) | Nhãn của dự án; nhiều nhãn cách nhau `;`; nhãn mới được tạo |
| K | Điểm | số thập phân | `decimal` giữa 0 và 1000, chặn | Chấp nhận dấu phẩy thập phân |
| L | Ngày bắt đầu | ngày | `date` > 01/01/1900, ô định dạng `dd/mm/yyyy` | Xem §3.3 |
| M | Hạn hoàn thành | ngày | như trên | Phải ≥ Ngày bắt đầu nếu cả hai có |
| N | Thành phần | list | `list`, `errorStyle = information` | Thành phần của dự án; nhiều giá trị cách nhau `;`; **phải đã có** |
| O | Phiên bản | list | `list`, chặn | Phiên bản `UNRELEASED` của dự án (fix version) |

## 3. API

Tiền tố `/api/v1`. Cả ba endpoint cần quyền `import:run` (`PERMISSIONS.IMPORT_RUN`). Hai `POST` (xem trước, nhập) có throttle riêng **10 lần/phút/IP** vì mỗi lần giải nén và duyệt cả bảng (vượt: 429). Lỗi có dạng `{ success:false, error:{ code, message, statusCode, details? }, meta }`.

### 3.1 Tải biểu mẫu — `GET /import/excel/template?projectId=…`

| Tham số | Validation | Thông báo lỗi |
|---|---|---|
| projectId (query) | bắt buộc, chuỗi không rỗng | 400 `VALIDATION_ERROR` — "Thiếu mã dự án" |

Phản hồi 200: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Cache-Control: no-store`, `Content-Disposition: attachment; filename="Mau-nhap-cong-viec-<KEY>.xlsx"; filename*=UTF-8''Mau-nhap-cong-viec-<KEY>.xlsx`, thân là tệp `.xlsx`. Dự án không thuộc workspace của request: 404 "Dự án không tồn tại". Dự án lưu trữ vẫn tải được biểu mẫu (chỉ chặn khi xem trước/nhập).

### 3.2 Xem trước — `POST /import/excel/preview`

`multipart/form-data`: `file` (tệp `.xlsx`), `projectId` (chuỗi). **Không ghi DB.** Trả 200:

```json
{
  "total": 5, "valid": 3, "invalid": 2,
  "rows": [
    { "row": 4, "summary": "RT Người lạ",
      "errors":   [{ "column": "Người phụ trách", "message": "'abc@x.com' không phải thành viên dự án" }],
      "warnings": [] }
  ]
}
```

- `row` là **số dòng Excel thật** (dòng 1 là tiêu đề nên dữ liệu từ 2). Dòng trống hoàn toàn không xuất hiện và không tính vào `total`.
- `valid` = số dòng không có lỗi; `invalid` = số dòng có ≥ 1 lỗi. Cảnh báo không làm dòng thành lỗi.
- Một dòng có thể có nhiều lỗi (mỗi cột tối đa một lỗi, trừ cột nhiều giá trị).

### 3.3 Nhập — `POST /import/excel`

Cùng input như xem trước. Máy chủ **kiểm tra lại từ đầu** (không tin bản xem trước), nhập các dòng hợp lệ, bỏ dòng lỗi. Trả 201:

```json
{ "jobId": "…", "source": "EXCEL", "created": 3, "failed": 2, "total": 5,
  "errors": [{ "row": 4, "error": "Dòng 4 · Người phụ trách: 'abc@x.com' không phải thành viên dự án" }] }
```

`failed` = dòng lỗi kiểm tra + dòng lỗi khi ghi DB. `errors` tối đa 20 mục (job lưu tối đa 50), sắp theo số dòng; lỗi kiểm tra có dạng `Dòng <n> · <Cột>: <lý do>` (nhiều lỗi của một dòng nối bằng `; `), lỗi ghi DB có dạng `Dòng <n>: <lỗi>`.

### 3.4 Lỗi cấp tệp / yêu cầu (preview và nhập)

| Điều kiện | Mã HTTP | Thông báo (nguyên văn) |
|---|---|---|
| Thiếu `projectId` | 400 | "Dữ liệu không hợp lệ" (`details[0].message` = "Thiếu mã dự án") |
| Không có tệp | 422 | "Thiếu tệp Excel — hãy chọn tệp .xlsx tải từ biểu mẫu rồi thử lại" |
| Sai đuôi `.xlsx`, mimetype không thuộc nhóm xlsx/zip/octet-stream **hoặc rỗng** (trình duyệt hay không gửi mimetype), hoặc 2 byte đầu khác `PK` | 422 | "Chỉ nhận tệp .xlsx — hãy dùng biểu mẫu Excel tải từ Tirapro (không nhận .xls, .csv hay tệp đổi đuôi)" |
| Tệp > 5 MB (multer `limits.fileSize`) | 413 | mã `PAYLOAD_TOO_LARGE`; "Tệp quá lớn — vượt giới hạn dung lượng của chức năng này (biểu mẫu Excel tối đa 5 MB). Hãy giảm dung lượng hoặc chia thành nhiều tệp nhỏ hơn" (web còn chặn trước ở trình duyệt) |
| Zip bất thường, kiểm central directory TRƯỚC khi nạp: tổng giải nén > 50 MB, > 100 entry, entry > 30 MB, entry > 1 MB nén quá 100:1, zip64, tên entry ngoài `xl/`, `docProps/`, `_rels/`, `customXml/`, `[Content_Types].xml` hoặc chứa `..` | 422 | "Tệp Excel giải nén quá lớn hoặc có cấu trúc bất thường — hãy dùng biểu mẫu tải từ Tirapro, tối đa 1000 dòng" |
| Sheet khai báo dòng cuối > 10.000 (kể cả dòng chỉ có định dạng) | 422 | "Sheet khai báo tới dòng N, vượt giới hạn — hãy xoá các dòng thừa (kể cả dòng chỉ có định dạng) hoặc dùng biểu mẫu mới, tối đa 1000 dòng dữ liệu" |
| Vượt throttle | 429 | |
| Mở zip/xlsx thất bại | 422 | "Không đọc được tệp Excel — tệp có thể bị hỏng hoặc không phải .xlsx. Hãy tải lại biểu mẫu và điền lại" |
| Không có sheet `Công việc` và không có sheet hiện nào khác ngoài `Hướng dẫn`/`DanhSach` | 422 | `Không thấy sheet "Công việc" — hãy dùng biểu mẫu Excel tải từ Tirapro` |
| Thiếu cột bắt buộc (so theo tên) | 422 | "Thiếu cột bắt buộc: Tiêu đề, Loại việc — hãy kiểm tra dòng tiêu đề (dòng 1) hoặc tải lại biểu mẫu" (liệt kê cột thiếu) |
| > 1000 dòng dữ liệu không trống | 422 | "Tệp có N dòng dữ liệu, vượt giới hạn 1000 dòng — hãy chia thành nhiều tệp" |
| Dự án không thuộc workspace / không tồn tại | 404 | "Dự án không tồn tại" |
| Dự án đã lưu trữ | 422 | "Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi" |
| Thiếu quyền `import:run` | 403 | |

### 3.5 Thông báo lỗi theo cột (trường `message`; cột là trường `column`)

| Cột | Điều kiện | Thông báo |
|---|---|---|
| Tiêu đề | rỗng | "Bắt buộc nhập tiêu đề" |
| Tiêu đề | > 255 ký tự | "Tiêu đề dài N ký tự, tối đa 255 — hãy rút gọn" |
| Mô tả | > 50.000 ký tự | "Mô tả quá dài (tối đa 50.000 ký tự)" |
| Loại việc | rỗng | "Bắt buộc chọn loại việc" |
| Loại việc | không khớp | "'X' không phải loại việc của dự án — hãy chọn từ danh sách" |
| Loại việc | là loại việc con (gõ tay) | "'X' cần việc cha nên không nhập được từ biểu mẫu — hãy chọn loại khác" |
| Ưu tiên | không khớp | "'X' không phải mức ưu tiên hợp lệ — hãy chọn từ danh sách" |
| Trạng thái | không khớp | "'X' không có trong quy trình của dự án — hãy chọn từ danh sách" |
| Người phụ trách / Người báo cáo | email không thuộc thành viên dự án (kể cả đã bị khoá) | "'X' không phải thành viên dự án" |
| Sprint | không có trong sprint chưa đóng | "'X' không phải sprint đang chạy hoặc sắp tới của dự án — hãy chọn từ danh sách" |
| Sprint | ≥ 2 sprint trùng tên | "Có N sprint trùng tên 'X' — hãy đổi tên sprint rồi tải lại biểu mẫu" |
| Epic | không khớp | "'X' không phải epic của dự án — hãy chọn từ danh sách" |
| Epic | loại việc của dòng là Epic | "Epic là cấp cao nhất — không thể đặt một Epic vào epic khác" |
| Nhãn | một nhãn > 100 ký tự | "Nhãn 'xxxxxxxxxxxxxxxxxxxx…' dài quá 100 ký tự" |
| Điểm | không phải số | "'X' không phải số" |
| Điểm | ngoài 0–1000 | "Điểm X ngoài khoảng 0–1000" |
| Ngày bắt đầu / Hạn hoàn thành | không hiểu được | "'X' không phải ngày hợp lệ — hãy nhập dạng dd/mm/yyyy" |
| Hạn hoàn thành | < Ngày bắt đầu | "Hạn hoàn thành phải sau hoặc bằng Ngày bắt đầu" |
| Thành phần | không phải thành phần của dự án | "'X' không phải thành phần của dự án — hãy chọn từ danh sách" |
| Phiên bản | không phải bản chưa phát hành | "'X' không phải phiên bản chưa phát hành của dự án — hãy chọn từ danh sách" |

Cảnh báo (không chặn): cột **Nhãn** — "Nhãn mới 'X' sẽ được tạo" cho mỗi nhãn chưa có trong dự án.

## 4. Luồng nghiệp vụ và quy tắc

### 4.1 Tải biểu mẫu
1. Kiểm quyền `import:run`; kiểm dự án thuộc `workspaceId` của request.
2. Nạp danh mục theo `projectId`: loại việc và ưu tiên (theo workspace), trạng thái (workflow mặc định của dự án), thành viên `ACTIVE` của dự án, sprint chưa đóng, epic, nhãn, thành phần, phiên bản `UNRELEASED`.
3. Dựng 3 sheet theo §2 và trả tệp. Danh mục lấy **tại thời điểm tải**: thêm thành viên/sprint/thành phần sau đó thì phải tải lại biểu mẫu (tệp cũ vẫn dùng được; giá trị đã bị xoá sẽ báo lỗi dòng).

### 4.2 Đọc tệp (dùng chung cho xem trước và nhập)
1. Kiểm tệp (§3.4): có tệp, đuôi `.xlsx`, mimetype, magic bytes `PK`.
2. Kiểm dự án tồn tại trong workspace; **dự án lưu trữ thì chặn** (trước khi tạo `ImportJob`).
3. Mở sheet `Công việc` (nếu không có: sheet hiện đầu tiên không phải `Hướng dẫn`/`DanhSach`).
4. **Khớp cột theo tên tiêu đề** ở dòng 1: bỏ dấu `*`, gom khoảng trắng, không phân biệt hoa/thường; thứ tự cột tự do; cột lạ bị bỏ qua; tên trùng thì lấy cột đầu tiên.
5. Lấy giá trị ô: chuỗi/số/ngày; **rich text** nối các đoạn; **hyperlink** lấy chữ hiển thị; **công thức** lấy kết quả; ô lỗi (`#N/A`…) coi như trống.
6. **Dòng không có giá trị ở bất kỳ cột nào đã biết thì bỏ qua**; còn lại tính vào `total`. Quá 1000 dòng: dừng với lỗi cấp tệp.
7. Kiểm từng dòng theo §3.5; nhãn/thành phần tách theo `;`, bỏ rỗng và bỏ trùng (không phân biệt hoa/thường).

### 4.3 Quy tắc chuẩn hoá
- **Ngày** là ngày lịch, không phụ thuộc múi giờ máy chủ. Ô có thể là `Date` (đọc theo thành phần **UTC**), số serial Excel, hoặc chuỗi `dd/mm/yyyy` (cũng nhận `d/m/yyyy`, `dd-mm-yyyy`, `dd.mm.yyyy`) hay `yyyy-mm-dd`. Kết quả lưu `YYYY-MM-DDT00:00:00.000Z`. Ngày không tồn tại (31/02) bị báo lỗi.
- **Người**: chấp nhận `Tên <email>` hoặc chỉ email; so khớp theo email (không phân biệt hoa/thường) với thành viên dự án đang `ACTIVE` — tên trùng nhau không gây nhầm. Thành viên cấp workspace nhưng không thuộc dự án bị báo lỗi.
- **Epic**: nhận `KEY — tiêu đề` hoặc chỉ `KEY`.
- **Số**: nhận `2,5` và `2.5`.

### 4.4 Xem trước
Đọc tệp (§4.2) rồi trả `ExcelPreviewResult`. Không tạo `ImportJob`, không ghi DB.

### 4.5 Nhập
1. Đọc và kiểm tra lại toàn bộ tệp (§4.2). Lỗi cấp tệp thì **không** tạo `ImportJob`.
2. Tạo `ImportJob` (`source = EXCEL`, `status = RUNNING`, `totalItems = total`, `config = { projectId, format: "excel" }`).
3. Chỉ các dòng hợp lệ được ghi, theo lô 100 dòng / transaction (`createIssuesInChunks`). Mỗi dòng: tạo công việc (người báo cáo đặt ngay lúc tạo) rồi trong **cùng transaction** gắn nhãn (tạo nhãn mới nếu cần; hai dòng cùng nhãn mới chỉ tạo một lần, không phân biệt hoa/thường), thành phần, phiên bản (`FIX`). Một dòng lỗi DB làm lô rollback và chạy lại từng dòng để cô lập; sự kiện `ISSUE_CREATED` chỉ phát sau commit.
4. Kết thúc: `status = COMPLETED`, hoặc `FAILED` nếu `created = 0` và `failed > 0`; `processedItems = created`; `result = { created, failed, labels, errors }`. Ngoại lệ không lường trước: `status = FAILED`, `errorLog` ghi lỗi, ném lại lỗi.
5. Công việc tạo bằng đường `import` của `IssuesService`: không đòi quyền chuyển trạng thái khi chọn trạng thái khác trạng thái khởi tạo; chọn trạng thái thuộc nhóm DONE thì tự đặt `resolvedAt` và resolution mặc định.
6. Nhập lại cùng một tệp **tạo trùng** công việc (không có khoá chống trùng) — ⚠️ người dùng cần được nhắc không nhập hai lần; sửa các dòng lỗi rồi nhập lại thì chỉ nên giữ các dòng chưa nhập.

### 4.6 Giao diện (Cấu hình dự án → Dữ liệu)
Khối **"Nhập từ Excel"** nằm trên khối "Nhập dữ liệu khác" (Dán CSV, tải JSON), hiển thị khi có quyền `import:run`:
1. Nút **"Tải biểu mẫu Excel"** (tải bằng helper `lib/download.ts`, có refresh token khi 401).
2. Vùng chọn tệp `.xlsx`: nút "Chọn tệp .xlsx…" (bàn phím) hoặc kéo-thả; kiểm đuôi/5 MB/tệp trống ngay ở trình duyệt; chọn xong **gọi xem trước ngay**.
3. Tóm tắt "N dòng hợp lệ · M dòng lỗi"; bảng *Dòng · Tiêu đề · Cột · Lý do* (tối đa 200 mục, phần còn lại ghi "Đang hiện X/Y"); ô **"Chỉ dòng lỗi"** (mặc định bật khi có lỗi) ẩn các cảnh báo "Lưu ý". Màn hẹp: cột Tiêu đề chuyển xuống dưới Lý do, không tràn ngang.
4. Nút chính **"Nhập N công việc"** — vô hiệu khi N = 0 (kèm câu "Không có dòng hợp lệ để nhập — hãy sửa tệp rồi chọn lại."); khi có lỗi ghi "Bỏ qua M dòng lỗi (sửa trong tệp rồi nhập lại sau)."
5. Kết quả: toast (xanh nếu không lỗi, cảnh báo nếu có), bảng kết quả, danh sách lỗi (≤ 20), liên kết **"Xem trong Việc chờ"** (`/p/<KEY>/backlog`), nút **"Chọn tệp khác"**; **Lịch sử nhập** được làm mới (nguồn hiển thị `EXCEL`).
6. Trạng thái: đang kiểm tra tệp (nút loading + "Đang kiểm tra tệp…"), lỗi xem trước (khung báo lỗi `role="alert"`, giữ khả năng chọn lại tệp), tệp không có dòng ("Tệp chưa có dòng dữ liệu nào — hãy điền từ dòng 2 rồi chọn lại."), không lỗi ("Không có lỗi hay lưu ý nào.").
7. Dự án đã lưu trữ: khối vẫn hiện, ghi "Dự án đã lưu trữ — hãy khôi phục dự án trước khi nhập. Bạn vẫn tải được biểu mẫu."; nút/ô chọn tệp bị khoá, nút tải biểu mẫu vẫn dùng được. Ô chọn tệp ẩn có tên truy cập "Chọn tệp Excel .xlsx"; tệp bị sửa/xoá sau khi chọn → "Tệp đã thay đổi hoặc không đọc được — hãy chọn lại tệp."
8. **Cmd+K → "Nhập công việc từ Excel"** (nhóm lệnh *Dự án hiện tại*, hiện khi có `import:run` và dự án chưa lưu trữ) → `/p/<KEY>/config/data`.

## 5. Phân quyền

| Thao tác | Quyền | Ghi chú |
|---|---|---|
| Tải biểu mẫu, xem trước, nhập Excel | `import:run` | Guard theo quyền workspace như CSV/JSON; dự án không thuộc workspace → 404 |
| Nhập vào dự án lưu trữ | — | Chặn (xem/nhập) |
| Xem Lịch sử nhập (`GET /import/jobs`, `/import/jobs/:id`) | `import:run` | Lọc theo `workspaceId` |
| Nhập từ Jira (§8) | `workspace:admin` | |

Người được gán/báo cáo bởi biểu mẫu phải là thành viên dự án; công việc tạo ra thuộc `workspaceId` của request.

## 6. Tiêu chí chấp nhận (Given / When / Then)

- **AC-6.1 Biểu mẫu có drop-list từ cấu hình.** Given dự án DEMO có 3 loại việc (một tên chứa dấu phẩy), 2 sprint chưa đóng, 1 sprint đã đóng; When người có `import:run` gọi `GET /import/excel/template?projectId=<DEMO>`; Then nhận `.xlsx` tên `Mau-nhap-cong-viec-DEMO.xlsx`, `Cache-Control: no-store`; sheet `DanhSach` là `veryHidden`, cột Loại việc có validation `list` tham chiếu `DanhSach!$A$2:$A$4`, cột Sprint chỉ chứa 2 sprint chưa đóng, tên có dấu phẩy nằm đúng một ô.
- **AC-6.2 Danh sách rỗng bỏ validation.** Given dự án chưa có thành phần; When tải biểu mẫu; Then cột Thành phần không có validation.
- **AC-6.3 Xem trước chỉ ra lỗi từng dòng/cột.** Given tệp 5 dòng, dòng 4 có Người phụ trách `abc@x.com` không thuộc dự án, dòng 6 có Hạn hoàn thành trước Ngày bắt đầu; When `POST /import/excel/preview`; Then `total=5, valid=3, invalid=2`, dòng `row=4` có lỗi cột "Người phụ trách": "'abc@x.com' không phải thành viên dự án", dòng `row=6` có lỗi cột "Hạn hoàn thành": "Hạn hoàn thành phải sau hoặc bằng Ngày bắt đầu", và không có công việc nào được tạo.
- **AC-6.4 Header theo tên, không theo vị trí.** Given tệp đảo thứ tự cột, tiêu đề `TIÊU ĐỀ *` và một cột lạ; When xem trước; Then các cột vẫn khớp đúng, cột lạ bị bỏ qua.
- **AC-6.5 Ngày không lệch.** Given Ngày bắt đầu được nhập dạng ô ngày, số serial 46096 và chuỗi `15/03/2026`; When nhập; Then cả ba cho ngày lưu `2026-03-15T00:00:00.000Z` bất kể múi giờ máy chủ.
- **AC-6.6 Nhập bỏ dòng lỗi.** Given tệp 3 dòng, một dòng lỗi kiểm tra và một dòng lỗi DB; When `POST /import/excel`; Then trả `created=1, failed=2, total=3, source="EXCEL"`, `errors[0].error` bắt đầu bằng "Dòng 3 · …", `ImportJob.status = COMPLETED`, `processedItems = 1`.
- **AC-6.7 Nhãn mới, thành phần, phiên bản, người báo cáo.** Given dòng hợp lệ có Nhãn `ui; mới` (chỉ `ui` đã có), Thành phần `Backend`, Phiên bản `1.0`, Người báo cáo là thành viên khác người nhập; When nhập; Then nhãn `mới` được tạo trong dự án, công việc có 2 nhãn, 1 thành phần, fix version `1.0` (`type = FIX`) và `reporterId` là người được chọn.
- **AC-6.8 Không tin xem trước.** Given tệp toàn dòng lỗi; When gọi thẳng `POST /import/excel`; Then `created = 0`, job `FAILED`, không tạo công việc.
- **AC-6.9 Giới hạn tệp.** Given tệp có 1001 dòng dữ liệu; When xem trước; Then 422 "Tệp có 1001 dòng dữ liệu, vượt giới hạn 1000 dòng — hãy chia thành nhiều tệp". Given tệp CSV đổi đuôi `.xlsx`; Then 422 "Chỉ nhận tệp .xlsx — …". Given tệp > 5 MB; Then 413 với mã `PAYLOAD_TOO_LARGE` và thông báo "Tệp quá lớn — …".
- **AC-6.9b Chặn tệp độc hại.** Given tệp .xlsx ≤ 5 MB có một entry giải nén 60 MB (zip bomb) hoặc entry tên `xl/../../x`; When xem trước; Then 422 "Tệp Excel giải nén quá lớn hoặc có cấu trúc bất thường — …" và exceljs không được nạp tệp.
- **AC-6.9c Sub-task.** Given dự án có loại việc con "Sub-task"; When tải biểu mẫu; Then drop-list Loại việc không chứa "Sub-task"; When dòng gõ tay "Sub-task"; Then lỗi cột Loại việc "'Sub-task' cần việc cha nên không nhập được từ biểu mẫu — hãy chọn loại khác".
- **AC-6.10 Cô lập và quyền.** Given người dùng workspace B; When gọi template/preview/nhập với `projectId` của workspace A; Then 404 "Dự án không tồn tại". Given người không có `import:run`; Then 403. Given dự án lưu trữ; When xem trước hoặc nhập; Then 422 "Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi".
- **AC-6.11 Giao diện.** Given tệp có 2 dòng lỗi; When người dùng chọn tệp ở khối "Nhập từ Excel"; Then bảng xem trước hiện ngay "N dòng hợp lệ · 2 dòng lỗi", ô "Chỉ dòng lỗi" bật, nút "Nhập N công việc" kèm "Bỏ qua 2 dòng lỗi"; khi N = 0 nút bị vô hiệu; sau khi nhập hiện toast, liên kết "Xem trong Việc chờ", nút "Chọn tệp khác" và dòng mới (nguồn `EXCEL`) ở Lịch sử nhập.
- **AC-6.12 Cmd+K.** Given người dùng có `import:run` đang ở một dự án; When mở Cmd+K và chọn "Nhập công việc từ Excel"; Then chuyển tới `/p/<KEY>/config/data`.

## 7. Các đường nhập khác (đã có trước)

| Đường | Endpoint | Input | Quyền | Ghi chú |
|---|---|---|---|---|
| CSV dán tay | `POST /import/csv` | `{ projectId, csv }` (zod: cả hai chuỗi không rỗng) | `import:run` | Cột nhận: `summary`/`title`, `type`/`issue type`, `description`, `priority`, `story points`/`points` (không phân biệt hoa/thường). Dòng không có tiêu đề bị bỏ qua. Loại việc mặc định `Task` (hoặc loại đầu tiên). Kết quả `ImportCsvResult` `{ jobId, source:"CSV", created, failed, total, errors:[{row,error}] }` (`row` đánh số từ 0, khác Excel) |
| JSON export | `POST /import/json` | `{ projectId, data:{ issues[] } }` | `import:run` | Round-trip với Export; tạo nhãn, bình luận; người phụ trách không khớp email thì bỏ gán và đếm `skippedAssignees`; ghi `source = CSV` + `config.format = "json"` |
| Lịch sử | `GET /import/jobs?cursor&limit` (mặc định 20, tối đa 100), `GET /import/jobs/:id` | | `import:run` | Mới nhất trước; 404 "Lần nhập dữ liệu không tồn tại" nếu sai workspace |

⚠️ Giao diện web khai báo trạng thái job `PROCESSING` trong khi enum DB là `RUNNING` — job đang chạy hiển thị không đúng nhãn "Đang xử lý" (chưa sửa trong phạm vi này).

## 8. Nhập từ Jira (tóm lược)

Nhập CSV export của Jira qua 3 bước (`POST /import/jira/analyze` ≤ 25 MB → `GET /import/jira/targets` → `POST /import/jira/run`), quyền `workspace:admin`, giữ mã gốc (`JRA-1`), chạy nền có tiến độ, nhớ email người phụ trách chưa là thành viên để tự gán khi họ được thêm. Chưa đặc tả chi tiết trong tài liệu này.
