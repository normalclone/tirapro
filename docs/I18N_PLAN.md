# Tirapro — Kế hoạch Quốc tế hoá (i18n) Việt–Anh

> Trạng thái: **bản kế hoạch để duyệt** (2026-11-10). Chưa triển khai. Đây là một dự án riêng,
> làm sau đợt sửa bug.

## Mục tiêu & quyết định đã chốt

Thêm tiếng Anh song song tiếng Việt cho toàn bộ Tirapro, người dùng tự chuyển ngôn ngữ.

| Quyết định | Chốt |
|---|---|
| Hướng ngôn ngữ | **Song ngữ Việt–Anh**, người dùng tự chuyển. Tiếng Việt là ngôn ngữ nguồn (bản gốc). |
| Thư viện (FE) | **react-i18next** (+ `i18next`), namespace theo feature, lazy-load. |
| Phạm vi | **Toàn bộ app** (frontend + backend) — làm một đợt. |
| Backend | **Có dịch** thông báo lỗi/hệ thống từ API theo ngôn ngữ người dùng. |

**Không mục tiêu (non-goals):** thêm ngôn ngữ thứ ba (chỉ dựng sao cho dễ thêm sau); RTL; dịch
dữ liệu người dùng nhập (tên dự án, nội dung việc — giữ nguyên); dịch tài liệu `docs/`.

## Hiện trạng (khảo sát 2026-11-10)

- **FE:** `apps/web/src` ~793 file nguồn, **788 file** có chuỗi tiếng Việt, ~**22.5k dòng** có ký tự tiếng Việt.
- **BE:** `apps/api/src` ~**13.1k dòng** có ký tự tiếng Việt (chủ yếu message exception + vài chuỗi hệ thống).
- **Chưa có** hạ tầng i18n nào (không `i18next`/`react-intl`).
- **Đã có sẵn nền:** `User.locale String @default("en")` trong Prisma schema; định dạng ngày tập trung ở
  `apps/web/src/lib/dateFormat.ts`; mã lỗi API đã chuẩn `SCREAMING_SNAKE` (`{code, message}`).
- **Ràng buộc chất lượng hiện hành phải xử lý:** `apps/web/src/lib/terminology.test.ts` và
  `copySource.test.ts` đang lint chuỗi tiếng Việt trong **mã nguồn** (cấm "task/issue" làm danh từ
  chung…). Khi tách chuỗi ra file locale, các test này phải chuyển sang lint **file locale `vi`**,
  không lint mã nữa.

**Hệ quả quan trọng:** với ~35k dòng chuỗi trải trên gần 800 file, **không thể sửa tay**. Trụ cột của
dự án là **công cụ trích xuất bán tự động (codemod)** + rà soát người. Mục tiêu "toàn bộ một đợt" làm
PR rất lớn — xem phần Rủi ro.

## Kiến trúc

### Chọn ngôn ngữ & lưu
- Nguồn locale ưu tiên: `User.locale` (đã persist) → `localStorage` (khách chưa đăng nhập) →
  `navigator.language` → mặc định `vi`.
- Giá trị hợp lệ: `vi` | `en`. Đặt `vi` làm **fallbackLng** (bản gốc đầy đủ nhất).
- **⚠️ BẮT BUỘC ở giai đoạn Khung — di trú dữ liệu hiện có.** Schema đang là `locale @default("en")`
  và dữ liệu prod (2026-11-10) có **22/23 người dùng đang ở `"en"`** dù thực tế họ đang dùng giao
  diện tiếng Việt. Nếu bật i18n mà đọc thẳng `User.locale`, toàn bộ 22 người này sẽ **bị nhảy sang
  tiếng Anh ngay** — sai. Vì vậy, khi ship i18n phải làm MỘT trong hai, trước/cùng lúc:
  (a) chạy di trú `UPDATE "User" SET locale='vi'` cho các tài khoản hiện có (giữ nguyên ngôn ngữ họ
  đang thực dùng), **và** đổi `@default` của schema sang `"vi"`; hoặc
  (b) coi giá trị default/chưa-đặt là "chưa chọn" (vd cột `locale` cho phép `null`, `null` = auto-detect
  rồi mặc định `vi`). Cách (a) đơn giản, rõ ràng hơn — khuyến nghị.
- Đổi ngôn ngữ trong *Trang cá nhân* (`ProfilePanel.tsx`) và Cmd+K: gọi API cập nhật `User.locale`
  + `i18n.changeLanguage()`; áp ngay không cần tải lại trang.

### Frontend — react-i18next
- Gói: `i18next`, `react-i18next`, `i18next-browser-languagedetector`; số nhiều/giới tính dùng
  **ICU** qua `i18next-icu` (hoặc cú pháp plural gốc của i18next nếu đủ) — chốt khi dựng khung.
- **Namespace theo feature**, ánh xạ gần như 1–1 với thư mục `apps/web/src/features/*`
  (auth, issues, board, tree, sla, project-config, settings, …) + một namespace `common`.
  File: `apps/web/src/locales/<vi|en>/<namespace>.json`. Lazy-load theo route để không phình bundle.
- **Khoá (key):** theo feature + ý nghĩa, ví dụ `sla.overlapWarning`, `tree.rejectSameLevel`.
  Không dùng câu tiếng Việt làm khoá (tránh khoá đổi khi sửa chữ).
- **Nội suy & format:** biến `{{name}}`; ngày/giờ/số qua `Intl` theo locale (nâng cấp `dateFormat.ts`
  nhận locale thay vì cứng `vi-VN`).
- **An toàn:** tiếp tục KHÔNG `dangerouslySetInnerHTML`; chuỗi có markup dùng `<Trans>`.

### Backend — dịch thông báo API
Hai lớp, làm cả hai:
1. **Mã lỗi là nguồn sự thật (ưu tiên):** API trả `{code, params?}`; FE map `code → chuỗi` qua
   namespace `errors`. Đa số lỗi nghiệp vụ đã có `code` nên đây là đường rẻ & sạch nhất, và client
   nào cũng dịch được. → Dựng từ điển `errors.json` (vi/en) khớp danh mục mã ở
   `packages/types/src/common.ts` + `apps/api/src/common/exceptions/*`.
2. **Message do server sinh** (vài chỗ ghép động, email/Telegram, log hướng người dùng): dùng
   `nestjs-i18n` với locale lấy từ `Accept-Language` hoặc `User.locale` (JWT claim). Thêm `locale`
   vào context request.
- **Quy ước mới:** exception ném kèm `code` + `params`, message tiếng Việt chỉ là fallback khi thiếu
  bản dịch. Bổ sung lint chặn exception mới không có `code`.

### Công cụ trích xuất (trụ cột)
- **Codemod AST** (ts-morph/jscodeshift) quét `apps/web/src`: tìm literal tiếng Việt trong JSX text,
  thuộc tính (`title`, `placeholder`, `aria-label`, `alt`…), `toast.*`, `throw`, hằng chuỗi; thay bằng
  `t('<ns>.<key>')` / `<Trans>`; sinh `vi/<ns>.json`. Chạy theo thư mục feature, **người rà soát từng PR nhỏ nội bộ**
  (ngay cả khi gộp "một đợt", vẫn chia commit theo feature để review được).
- **Khoá sinh tự động** + cho sửa tay chỗ khó (plural, chuỗi ghép).
- **Bản `en`:** sinh khung rỗng từ `vi`, rồi dịch — dịch máy mồi + người rà soát thuật ngữ
  (đối chiếu `docs/UX_CONVENTIONS.md`; ví dụ "việc" → work item, "cam kết" → SLA/commitment…).
- Lập **bảng thuật ngữ (glossary) Việt–Anh** trước khi dịch để nhất quán.

### CI / chất lượng
- **Kiểm khoá thiếu:** script so `vi` vs `en`, thiếu khoá hoặc khoá thừa → đỏ CI.
- **Pseudo-localization** (chế độ `en-XA`) để soi chuỗi cứng còn sót & chỗ vỡ layout.
- **Chuyển copy-lint:** `terminology.test.ts`/`copySource.test.ts` lint **`vi/*.json`** thay vì mã nguồn.
- **Kiểm chuỗi cứng còn sót:** lint cấm literal tiếng Việt mới trong `apps/web/src` (trừ file locale).

## Lộ trình thực thi (dù gộp một đợt, chia giai đoạn nội bộ để kiểm soát)

1. **Khung (foundation).** Cài gói; `i18n.ts` (init, detector, fallback `vi`, lazy namespace);
   `<I18nProvider>`; bộ chọn ngôn ngữ + lưu `User.locale`; nâng `dateFormat.ts` theo locale;
   glossary + quy ước khoá. *Chạy được với 1–2 namespace mẫu.*
2. **Công cụ.** Viết & kiểm codemod trên một feature nhỏ (vd `sla`), chốt chất lượng trích xuất.
3. **Trích xuất FE toàn bộ.** Chạy codemod theo từng feature; rà soát; sinh `vi/*`; khung `en/*`.
4. **Backend.** Từ điển `errors` (vi/en) theo mã; `nestjs-i18n` cho message động; thêm `locale` context;
   FE map code→chuỗi.
5. **Dịch `en`.** Dịch mồi + rà soát người theo glossary; QA pseudo-loc; sửa layout.
6. **CI & dọn.** Kiểm khoá thiếu; chuyển copy-lint sang locale; lint cấm chuỗi cứng mới; tài liệu.

## Rủi ro & đánh đổi

- **PR khổng lồ (do chọn "toàn bộ một đợt").** ~800 file đổi → review cực khó, dễ xung đột, dễ sót.
  *Giảm thiểu:* dù một đợt vẫn commit theo feature, dựa vào codemod + CI kiểm khoá, và pseudo-loc để
  bắt sót. *Khuyến nghị cân nhắc:* cho phép ship khung + CI trước, rồi trích xuất theo đợt — an toàn
  hơn nhiều; nếu A/C muốn giữ "một đợt" thì chấp nhận rủi ro review trên.
- **Chất lượng dịch `en`** phụ thuộc glossary + rà soát người; dịch máy thuần sẽ lệch thuật ngữ sản phẩm.
- **Chuỗi ghép động** (nối chuỗi, số nhiều, ngày) hay vỡ nghĩa khi dịch — cần ICU, không nối tay.
- **Message backend ad-hoc** nhiều chỗ chưa có `code` — phải bổ sung mã, tốn công.
- **Bundle size** nếu không lazy-load namespace.

## Ước lượng sơ bộ

Đây là dự án lớn (nhiều tuần-người): phần nặng nhất là **viết/kiểm codemod** và **rà soát bản dịch
`en`** (thuật ngữ sản phẩm), không phải dựng khung. Khung + công cụ có thể xong nhanh; trích xuất +
dịch + QA toàn app là phần dài.

## Việc cần A/C quyết thêm (khi bắt tay)

1. Dịch máy mồi bản `en` (ai/công cụ) rồi ai rà soát thuật ngữ?
2. Có chấp nhận tách "khung trước, trích xuất theo đợt sau" để giảm rủi ro PR khổng lồ không?

(Vấn đề "ngôn ngữ mặc định cho tài khoản hiện có" đã được chốt là **yêu cầu bắt buộc** ở giai đoạn
Khung — xem phần Kiến trúc > Chọn ngôn ngữ & lưu — không còn là câu hỏi mở.)
