# Product

## Register

product

## Users

Đội ngũ phần mềm — developers, PM/PO, scrum master, QA, designer — quản lý công việc
trên nhiều project và sprint. Bối cảnh: dùng **cả ngày**, nhiều tab mở song song, liên tục
chuyển giữa board → backlog → issue detail → reports. Mật độ thông tin cao, thao tác lặp
nhiều lần mỗi giờ (kéo-thả card, đổi trạng thái, gán người, comment).

Job-to-be-done: lập kế hoạch, theo dõi và ship công việc với ít ma sát nhất; tìm và phân
loại issue thật nhanh; chạy sprint; nắm tiến độ qua báo cáo. Task chính trên mỗi màn:
**một** hành động rõ ràng (board = di chuyển công việc; backlog = xếp ưu tiên & lập sprint;
issue = cập nhật chi tiết; reports = đọc xu hướng).

## Product Purpose

Tirapro là công cụ quản lý dự án & issue tracker tầm Jira cho đội ngũ agile, **nâng cấp** ba
hướng: AI (sinh issue từ ngôn ngữ tự nhiên, tóm tắt, gợi ý assignee/priority/story points,
trợ lý lập sprint), realtime collaboration (board/issue cập nhật tức thời, presence), và
analytics (dashboard tùy biến, burndown/velocity/CFD).

Tồn tại để mang sức mạnh của Jira mà **bỏ đi sự nặng nề** — nhanh hơn, tĩnh hơn, keyboard-first.
Thành công = đội nhóm chạy sprint và triage issue nhanh hơn với tải nhận thức thấp hơn; công
cụ "biến mất" khỏi đường đi của người dùng.

## Brand Personality

Calm, Sharp, Trustworthy. Giọng điệu: rõ ràng, súc tích, chuyên nghiệp nhưng vẫn "người" —
không thuật ngữ rối rắm, không cute kiểu đồ chơi. Mục tiêu cảm xúc: cảm giác **kiểm soát và
bình tĩnh** giữa mật độ thông tin cao. Sự "đắt tiền" đến từ độ chính xác và nhịp khoảng cách,
không từ hiệu ứng phô trương.

## Anti-references

- **AI-slop SaaS**: nền kem/beige, gradient tím, font Inter mặc định, template hero-metric
  (số to + label nhỏ + gradient), lưới card y hệt nhau lặp vô tận, eyebrow chữ hoa nhỏ trên
  mỗi section. Nhìn phát biết AI tạo → cấm.
- **Jira cũ rối rắm**: dày đặc, viền hộp lồng nhau, chrome nặng, menu chằng chịt, nhiễu thị giác.
- **Quá đồ chơi**: màu kẹo, bo góc quá lớn, motion nảy/elastic — làm mất uy tín công cụ doanh nghiệp.
- **Dark-terminal nặng**: nền đen tuyền + chữ neon kiểu hacker — không hợp làm việc lâu dài.

## Design Principles

1. **Density without noise** — hiển thị nhiều thông tin nhưng giữ legible & tĩnh; để whitespace
   và hierarchy gánh việc, không phải đường viền.
2. **Keyboard-first, tốc độ là tính năng** — mọi hành động chính chạm được qua Cmd+K và phím tắt;
   cảm giác phải tức thời (optimistic UI).
3. **Get out of the way** — nội dung (issue, board) là nhân vật chính; chrome lùi lại. Không trang
   trí nào không phục vụ task.
4. **Trust through precision** — căn chỉnh pixel-perfect, nhịp spacing nhất quán, trạng thái trung
   thực (loading/empty/error). Trông như được kỹ sư làm ra, không phải máy sinh.
5. **Progressive power** — đơn giản mặc định, mạnh khi cần (JQL, custom field, AI) lộ ra đúng lúc,
   không bao giờ làm rối đường đi phổ biến.

## Accessibility & Inclusion

WCAG 2.1 AA. Body text contrast ≥ 4.5:1, text lớn ≥ 3:1, placeholder cũng ≥ 4.5:1. Focus ring
luôn nhìn thấy, điều hướng bàn phím đầy đủ. Mọi animation có nhánh `prefers-reduced-motion`.
Màu **không bao giờ** là tín hiệu duy nhất — trạng thái dùng icon + nhãn + màu. Cả light và
dark theme đều đạt AA.
