import { SYSTEM_ROLES } from '@tirapro/types';

/** Câu giải nghĩa ngắn cho tooltip — người mới đọc là hiểu vai trò làm được gì. */
const ROLE_HINTS: Record<string, string> = {
  [SYSTEM_ROLES.WORKSPACE_ADMIN]: 'Toàn quyền: lập dự án, phân vai trò, đổi cấu hình chung.',
  [SYSTEM_ROLES.WORKSPACE_MEMBER]: 'Làm việc bình thường: lập dự án, tạo và xử lý công việc.',
  [SYSTEM_ROLES.WORKSPACE_VIEWER]: 'Chỉ xem, không sửa được gì.',
  [SYSTEM_ROLES.PROJECT_ADMIN]: 'Quản lý một dự án: cấu hình, quy trình, thành viên của dự án đó.',
  [SYSTEM_ROLES.PROJECT_DEVELOPER]:
    'Bộ quyền cơ bản: nhận việc, cập nhật tiến độ, bình luận (bản cũ — thường dùng vai trò "Lập trình viên").',
  [SYSTEM_ROLES.PROJECT_REPORTER]: 'Tạo và theo dõi công việc, không sửa việc của người khác.',
  [SYSTEM_ROLES.BUSINESS_ANALYST]: 'Làm rõ yêu cầu, viết mô tả và tiêu chí nghiệm thu.',
  [SYSTEM_ROLES.PRODUCT_OWNER]: 'Quyết định làm gì trước, chốt phạm vi và nghiệm thu.',
  [SYSTEM_ROLES.SCRUM_MASTER]: 'Điều phối sprint, gỡ vướng cho nhóm.',
  [SYSTEM_ROLES.DEVELOPER]: 'Nhận việc, cập nhật tiến độ, bình luận.',
  [SYSTEM_ROLES.TESTER]: 'Kiểm tra kết quả, báo lỗi, xác nhận đã sửa xong.',
  [SYSTEM_ROLES.DESIGNER]: 'Thiết kế giao diện và trải nghiệm.',
  [SYSTEM_ROLES.DEVOPS]: 'Triển khai, vận hành, theo dõi hệ thống chạy thật.',
  [SYSTEM_ROLES.REVIEWER]: 'Xem xét và duyệt kết quả trước khi coi là xong.',
  [SYSTEM_ROLES.STAKEHOLDER]: 'Theo dõi tiến độ, góp ý; không trực tiếp làm việc.',
};

/** Câu giải nghĩa cho tooltip. Vai trò tự đặt → không có, trả về undefined. */
export function roleHint(name: string): string | undefined {
  return ROLE_HINTS[name];
}
