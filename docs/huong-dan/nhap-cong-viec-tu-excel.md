# Hướng dẫn nhập task / bug hàng loạt từ Excel

Áp dụng cho Tirapro tại http://172.20.20.128:8088 · cập nhật 29/10/2026

Bạn có thể tạo tối đa **1000 công việc** (task, bug, story…) trong một lần bằng cách điền vào biểu mẫu Excel của dự án rồi tải lên. Biểu mẫu có sẵn **danh sách thả xuống** lấy từ cấu hình dự án, nên bạn chỉ cần chọn chứ không phải gõ tay.

**Ai làm được:** người có quyền *Nhập dữ liệu* (`import:run`). Mặc định là quản trị workspace. Nếu không thấy khối "Nhập từ Excel" thì nhờ quản trị cấp quyền.

---

## Bước 1. Mở màn nhập

Chọn một trong hai cách:

- Vào dự án → **Cấu hình dự án** → tab **Dữ liệu** → khối **"Nhập từ Excel"**.
- Hoặc nhấn **⌘K** (Windows: **Ctrl+K**) → gõ "excel" → chọn **"Nhập công việc từ Excel"**.

## Bước 2. Tải biểu mẫu

Bấm **"Tải biểu mẫu Excel"**. Tệp tải về có tên `Mau-nhap-cong-viec-<MÃ DỰ ÁN>.xlsx` và gồm hai sheet:

- **Công việc** — nơi điền dữ liệu. Dòng 1 là tiêu đề; điền từ **dòng 2**.
- **Hướng dẫn** — tóm tắt cách điền ngay trong tệp.

> Danh sách thả xuống chụp theo cấu hình dự án **tại lúc tải**. Nếu sau đó dự án thêm thành viên, sprint, thành phần hay phiên bản mới thì hãy **tải lại biểu mẫu**.

## Bước 3. Điền dữ liệu

Cột có dấu `*` và nền vàng nhạt là **bắt buộc**. Mỗi dòng là một công việc.

| Cột | Cách điền | Bỏ trống thì |
|---|---|---|
| **Tiêu đề*** | Gõ tay, tối đa 255 ký tự | — (bắt buộc) |
| Mô tả | Gõ tay, hỗ trợ Markdown, tối đa 50.000 ký tự | Không có mô tả |
| **Loại việc*** | Chọn từ danh sách: **Task**, **Bug**, Story, Epic… | — (bắt buộc) |
| Ưu tiên | Chọn từ danh sách | Ưu tiên mặc định |
| Trạng thái | Chọn từ danh sách (theo quy trình của dự án) | Trạng thái khởi tạo (vd "Cần làm") |
| Người phụ trách | Chọn `Tên <email>` hoặc gõ email | Chưa giao |
| Người báo cáo | Chọn `Tên <email>` hoặc gõ email | Chính bạn (người nhập) |
| Sprint | Chọn sprint đang chạy hoặc sắp tới | Vào **Việc chờ** |
| Epic | Chọn `MÃ — tiêu đề`, hoặc gõ mã epic | Không thuộc epic |
| Nhãn | Chọn hoặc gõ; nhiều nhãn cách nhau bằng `;` | Không có nhãn |
| Điểm | Số từ 0 đến 1000; nhận cả `2,5` và `2.5` | Không có điểm |
| Ngày bắt đầu | Dạng `dd/mm/yyyy`, vd `15/03/2026` | Không có |
| Hạn hoàn thành | Dạng `dd/mm/yyyy`; phải **sau hoặc bằng** Ngày bắt đầu | Không có |
| Thành phần | Chọn; nhiều giá trị cách nhau `;` | Không có |
| Phiên bản | Chọn phiên bản chưa phát hành | Không có |

**Lưu ý khi điền:**

- **Nhập bug:** chọn Loại việc = **Bug**, ghi các bước tái hiện, kết quả mong đợi và kết quả thực tế vào cột *Mô tả*, rồi đặt *Ưu tiên* phù hợp. Ví dụ:
  ```
  **Các bước:** 1. Mở trang đăng nhập 2. Nhập sai mật khẩu 3 lần
  **Mong đợi:** Hiện thông báo khoá tạm
  **Thực tế:** Trang trắng
  ```
  Trong một ô Excel, xuống dòng bằng **Alt+Enter** (Mac: **⌥+Enter** hoặc **Ctrl+⌥+Enter**).
- **Sub-task không nhập được** bằng biểu mẫu, vì sub-task cần có việc cha. Hãy tạo sub-task trực tiếp trong việc cha.
- **Nhãn mới** chưa có trong dự án sẽ được tự tạo. Ngược lại, **Thành phần** và **Phiên bản** phải đã có sẵn trong dự án.
- **Người phụ trách và người báo cáo** phải là thành viên đang hoạt động **của dự án**. Thành viên chỉ thuộc workspace mà không thuộc dự án sẽ bị báo lỗi.
- **Thứ tự và tên cột:** có thể đổi thứ tự cột hoặc thêm cột ghi chú riêng. Cột lạ được bỏ qua. Không đổi tên tiêu đề các cột chuẩn.
- **Dòng trống** được bỏ qua.
- **Có thể dán dữ liệu** từ file khác vào biểu mẫu. Dữ liệu dán vào có thể không đi qua danh sách thả xuống, nhưng hệ thống vẫn kiểm lại từng ô ở bước sau.

## Bước 4. Tải tệp lên và xem trước

Ở khối "Nhập từ Excel", bấm **"Chọn tệp .xlsx…"** hoặc kéo thả tệp vào. Tệp phải là `.xlsx` và **không quá 5 MB**.

Hệ thống kiểm tra ngay, **chưa tạo gì**, rồi hiện:

- Tóm tắt dạng **"N dòng hợp lệ · M dòng lỗi"**.
- Bảng lỗi gồm *Dòng · Tiêu đề · Cột · Lý do*. Số dòng khớp với số dòng trong Excel.
- Ô **"Chỉ dòng lỗi"** để ẩn các dòng chỉ có lưu ý (vd "Nhãn mới 'X' sẽ được tạo").

Các lỗi thường gặp và cách sửa:

| Thông báo | Cách sửa |
|---|---|
| Bắt buộc nhập tiêu đề / Bắt buộc chọn loại việc | Điền cột Tiêu đề / Loại việc |
| 'X' không phải thành viên dự án | Thêm người đó vào dự án, hoặc chọn người khác |
| 'X' không phải ngày hợp lệ — hãy nhập dạng dd/mm/yyyy | Sửa thành `dd/mm/yyyy`, vd `05/11/2026` |
| Hạn hoàn thành phải sau hoặc bằng Ngày bắt đầu | Đổi lại một trong hai ngày |
| 'X' không phải sprint đang chạy hoặc sắp tới… | Sprint đã đóng hoặc bị đổi tên: tải lại biểu mẫu |
| 'X' cần việc cha nên không nhập được từ biểu mẫu | Đổi Loại việc (vd Task), hoặc tạo sub-task trực tiếp trong việc cha |
| 'X' không phải thành phần của dự án | Tạo thành phần đó trong dự án trước, hoặc bỏ trống |

## Bước 5. Nhập

Bấm **"Nhập N công việc"**.

- Chỉ các **dòng hợp lệ** được tạo; các dòng lỗi bị bỏ qua.
- Xong, bấm **"Xem trong Việc chờ"** để xem các việc vừa tạo.
- Mỗi lần nhập được ghi vào **Lịch sử nhập** (nguồn `EXCEL`).

> ⚠️ **Đừng nhập cùng một tệp hai lần.** Hệ thống không chống trùng, nên nhập lại sẽ tạo thêm một bản của mỗi việc. Khi cần nhập lại các dòng lỗi:
> 1. Sửa các dòng lỗi trong tệp.
> 2. **Xoá những dòng đã nhập thành công.**
> 3. Chọn lại tệp và nhập.

## Giới hạn

- Tối đa **1000 dòng** mỗi tệp; nhiều hơn thì chia thành nhiều tệp.
- Kích thước tệp tối đa **5 MB**. Chỉ nhận định dạng `.xlsx`, không nhận `.xls` hay `.csv` đổi đuôi.
- Tối đa **10 lần** tải lên mỗi phút.
- **Dự án đã lưu trữ:** vẫn tải được biểu mẫu nhưng không nhập được. Hãy khôi phục dự án trước.
