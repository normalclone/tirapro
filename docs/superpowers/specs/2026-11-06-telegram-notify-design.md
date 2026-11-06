# Thông báo qua Telegram (cá nhân + kênh dự án) — thiết kế

Ngày: 2026-11-06. Người dùng yêu cầu: "phần cài đặt thông báo cho phép cấu hình thông báo qua channel và bot telegram",
chọn **cả hai**: (A) mỗi người nhận thông báo của mình qua bot Telegram, (B) quản trị dự án tự gắn nhóm/kênh Telegram cho
dự án mình quản lý — đều ngay trong **Cài đặt › Thông báo** (`/settings/notifications`).

## Hiện trạng (đọc code trước khi làm)
- Bot do quản trị tổ chức cài ở **Kết nối › Telegram** (`/connect/integrations/telegram`): model `Integration`
  (type TELEGRAM, `config` chứa token đã mã hoá), `IntegrationChannel` (chat đích + `events` + `projectId?`),
  `ChannelLinkToken` (mã tạm). Module `apps/api/src/modules/integrations` (`telegram.service.ts`, `link-codes.service.ts`,
  `integrations.controller.ts` — mọi route cần `integration:manage`). Gắn nhóm: gõ `/link MÃ` trong nhóm, máy chủ poll
  (`POST :id/link-codes/:code/poll`). Tìm hiểu cách nhận update (getUpdates/webhook, offset) và TÁI DÙNG, không dựng cơ chế thứ hai.
- Cài đặt thông báo cá nhân: trang `apps/web/src/features/settings/SettingsNotificationsPage.tsx` và API tương ứng (tìm model/
  bảng lưu tuỳ chọn theo loại thông báo, có "Tuỳ chọn email"). Nơi phát thông báo (in-app + email) — tìm dispatcher.

## A. Telegram cá nhân
1. **Liên kết** — nút "Liên kết Telegram" trong Cài đặt › Thông báo:
   - Máy chủ tạo mã một lần (hết hạn 10 phút) gắn với (người dùng, tổ chức), trả về deep link `https://t.me/<bot_username>?start=<mã>`.
   - Người dùng bấm → Telegram mở bot → Start. Máy chủ nhận `/start <mã>` từ **chat riêng** (private) → lưu liên kết, bot trả lời
     "Đã liên kết với Tirapro (<tên tổ chức>)". FE chờ (poll như cơ chế hiện có) rồi hiện "Đã liên kết với @username".
   - Có nút "Huỷ liên kết". Gõ `/stop` trong bot cũng huỷ. Mã sai/hết hạn → bot báo rõ.
   - Tổ chức chưa cài bot (không có Integration TELEGRAM ACTIVE) → hiện "Quản trị tổ chức cần cài bot Telegram ở Kết nối › Telegram"
     (không có nút).
   - Lưu: model mới (vd `UserTelegramLink { userId, organizationId, integrationId, chatId, username?, linkedAt }`, unique
     (userId, organizationId)). chatId không lộ ra API cho người khác.
2. **Chọn loại** — mỗi loại thông báo trong trang có thêm công tắc **Telegram** (cạnh tuỳ chọn email). Mặc định bật cho: được giao
   việc, được nhắc tên (@); còn lại tắt. Công tắc mờ (kèm gợi ý) khi chưa liên kết. Bấm là lưu như các công tắc khác.
3. **Gửi** — khi phát một thông báo cho người dùng: nếu loại đó bật Telegram + người đó có liên kết ở tổ chức đó + bot còn hoạt động
   → gửi tin nhắn riêng: một dòng tiêu đề như thông báo trong app (vd "Nguyễn Thị Thuỳ Linh giao TIRA-BUG-28 cho bạn"), dòng tiêu đề
   việc, và liên kết mở việc (URL công khai của web — tìm biến cấu hình base URL đang dùng cho email). Lỗi gửi không làm hỏng luồng
   thông báo (log cảnh báo). Bot bị người dùng chặn (403) → tự đánh dấu liên kết hỏng/xoá để không gửi lại mãi.
   Không gửi cho chính người gây ra sự kiện (giữ đúng luật của in-app).

## B. Kênh Telegram của dự án
- Mục "Kênh Telegram của dự án" trong Cài đặt › Thông báo, **chỉ hiện với người là Project Admin của ít nhất một dự án**
  (quản trị tổ chức thấy mọi dự án). Liệt kê các dự án người đó quản trị, mỗi dự án: các kênh đã gắn (tên chat, sự kiện, bật/tắt, gỡ)
  và nút "Gắn nhóm/kênh" → hiện mã + hướng dẫn: thêm bot vào nhóm/kênh rồi gõ `/link MÃ` (như hiện có), chờ xác nhận.
- Chọn sự kiện gửi vào kênh bằng danh sách loại thông báo hiện có (`events`).
- API mới theo dự án, quyền `project:admin` của **chính dự án đó** (`@ProjectRef`), tái dùng service hiện có:
  list / tạo mã / poll / sửa events + bật tắt / gỡ — chỉ đụng `IntegrationChannel` có `projectId` = dự án đó.
  Không cho tạo/sửa bot, không đụng kênh cấp tổ chức (projectId null) hay của dự án khác.
- Trang Kết nối › Telegram của quản trị tổ chức giữ nguyên.

## Ràng buộc
- Tiếng Việt, "tổ chức" (không "workspace"/"công ty"); bám DESIGN.md + UX_CONVENTIONS (thao tác lưu ngay, trạng thái rỗng rõ ràng,
  vùng chạm 44px trên cảm ứng).
- Không in/ghi token bot ra log hay response. Không gọi Telegram thật trong test (mock).
- Migration Prisma mới (prod chạy `migrate deploy`); cập nhật `@tirapro/types`/`@tirapro/shared` nếu thêm DTO/zod; `pnpm gen:enums`
  nếu đổi enum.
- Degrade: Telegram/Redis lỗi → thông báo in-app/email vẫn chạy.
- Gate: build types+shared, `pnpm -r typecheck`, `pnpm lint` (0 lỗi, ≤88 cảnh báo), `pnpm test`, `pnpm format:check`, `pnpm knip`,
  `node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src` không thêm finding.

## Ngoài phạm vi
- Nhận lệnh từ Telegram để thao tác việc (trả lời bình luận, đổi trạng thái).
- Telegram cho người ngoài tổ chức.
