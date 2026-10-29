import { routeToScreen } from '@/features/guides/routeToScreen';

/**
 * Mô tả tĩnh từng màn cho Trợ lý: dùng khi hỏi "màn này dùng để làm gì" và để chọn chip gợi ý hợp màn.
 * Tour từng bước (nếu có) lấy từ API guides — ở đây chỉ là mô tả + anchor tài liệu.
 */
export interface ScreenInfo {
  /** Mẫu màn (đã chuẩn hoá bằng `screenPattern`). */
  pattern: string;
  name: string;
  purpose: string;
  /** Anchor trang Hướng dẫn liên quan. */
  docAnchor?: string;
  /** Chip gợi ý riêng của màn (câu hỏi gửi thẳng cho trợ lý). */
  chips: string[];
}

/** Như `routeToScreen` + gộp các đường dẫn có tham số: `/issue/:key`, `/dashboards/:id`, `/filters`. */
export function screenPattern(pathname: string): string {
  const base = routeToScreen(pathname);
  if (/^\/issue\/[^/]+/.test(base)) return '/issue/:key';
  if (/^\/dashboards\/[^/]+/.test(base)) return '/dashboards/:id';
  if (/^\/filters(\/|$)/.test(base)) return '/filters';
  if (/^\/p\/:key\/config(\/|$)/.test(base)) return '/p/:key/config';
  if (/^\/admin(\/|$)/.test(base)) return '/admin';
  return base;
}

export const SCREENS: ScreenInfo[] = [
  {
    pattern: '/',
    name: 'Tổng quan',
    purpose:
      'Trang chủ cá nhân: việc được giao cho bạn, việc bạn báo, công việc đang theo dõi, mục vừa mở và các thẻ tổng hợp.',
    docAnchor: 'ca-nhan',
    chips: ['Việc của tôi', 'Việc quá hạn', 'Việc đến hạn tuần này', 'Phím tắt'],
  },
  {
    pattern: '/projects',
    name: 'Dự án',
    purpose: 'Danh sách các dự án bạn thấy; mở một dự án để vào Bảng việc, Việc chờ, Báo cáo…',
    docAnchor: 'khai-niem',
    chips: ['Tạo dự án', 'Việc của tôi', 'Khái niệm cơ bản'],
  },
  {
    pattern: '/p/:key',
    name: 'Dự án',
    purpose: 'Trang dự án: mở các view của dự án (Bảng việc, Việc chờ, Lịch trình, Báo cáo…).',
    docAnchor: 'khai-niem',
    chips: ['Sprint hiện tại thế nào', 'Việc của tôi', 'Việc quá hạn'],
  },
  {
    pattern: '/p/:key/board',
    name: 'Bảng việc',
    purpose:
      'Xem công việc của dự án theo cột trạng thái; kéo-thả thẻ để chuyển trạng thái, bấm thẻ để xem nhanh, ô "+ Thêm việc…" cuối cột để thêm nhanh.',
    docAnchor: 'lam-viec-issue',
    chips: ['Sprint hiện tại thế nào', 'Việc quá hạn', 'Tạo task', 'Phím tắt'],
  },
  {
    pattern: '/p/:key/backlog',
    name: 'Việc chờ',
    purpose:
      'Danh sách việc chờ của dự án: xếp thứ tự ưu tiên, kéo việc vào sprint, tạo/bắt đầu/kết thúc sprint, thao tác hàng loạt.',
    docAnchor: 'lap-chay-sprint',
    chips: ['Làm sao tạo sprint?', 'Sprint hiện tại thế nào', 'Việc của tôi', 'Tạo task'],
  },
  {
    pattern: '/p/:key/triage',
    name: 'Việc mới vào',
    purpose: 'Hộp thư việc mới (báo lỗi, yêu cầu) chờ duyệt: nhận, gán, hoãn hoặc từ chối.',
    docAnchor: 'vt-reporter',
    chips: ['Báo lỗi thế nào?', 'Việc quá hạn', 'Việc của tôi'],
  },
  {
    pattern: '/p/:key/reports',
    name: 'Báo cáo',
    purpose:
      'Báo cáo sprint, Burndown, Velocity, CFD, QA và sức khoẻ dự án; xuất CSV hoặc in/lưu PDF.',
    docAnchor: 'bao-cao',
    chips: ['Báo cáo cho biết gì', 'Sprint hiện tại thế nào', 'Việc quá hạn'],
  },
  {
    pattern: '/p/:key/gantt',
    name: 'Lịch trình',
    purpose:
      'Lịch trình dự án theo thời gian: phụ thuộc giữa các việc, đường găng, cột mốc và kế hoạch gốc.',
    docAnchor: 'quan-ly-nang-cao',
    chips: ['Lịch trình là gì', 'Việc đến hạn tuần này', 'Việc quá hạn'],
  },
  {
    pattern: '/p/:key/tree',
    name: 'Cây việc',
    purpose: 'Xem công việc theo phân cấp Epic → việc → việc con.',
    docAnchor: 'lam-viec-issue',
    chips: ['Epic là gì', 'Tạo epic', 'Việc của tôi'],
  },
  {
    pattern: '/p/:key/activity',
    name: 'Hoạt động dự án',
    purpose: 'Dòng thay đổi gần đây trong dự án: ai làm gì với công việc nào.',
    docAnchor: 'thong-bao',
    chips: ['Việc của tôi', 'Việc quá hạn'],
  },
  {
    pattern: '/p/:key/trash',
    name: 'Thùng rác',
    purpose: 'Công việc đã xoá của dự án — khôi phục được trong thời hạn lưu.',
    docAnchor: 'lam-viec-issue',
    chips: ['Việc của tôi', 'Thao tác với công việc'],
  },
  {
    pattern: '/p/:key/config',
    name: 'Cấu hình dự án',
    purpose:
      'Thành viên, quy trình, thành phần, phiên bản, nhãn, bảng việc, tự động hoá, xuất/nhập dữ liệu và các thiết lập khác của dự án.',
    docAnchor: 'vt-lead',
    chips: ['Nhập Excel ở đâu?', 'Phân quyền thế nào?', 'Thêm người vào dự án'],
  },
  {
    pattern: '/issue/:key',
    name: 'Công việc',
    purpose:
      'Chi tiết một công việc: mô tả, trường, bình luận, liên kết, việc con, lịch sử. Sửa tại chỗ; phím i gán cho tôi, m bình luận, e sửa tiêu đề.',
    docAnchor: 'lam-viec-issue',
    chips: ['Tóm tắt việc này', 'Phím tắt', 'Tạo task'],
  },
  {
    pattern: '/filters',
    name: 'Bộ lọc & tìm kiếm',
    purpose: 'Tìm công việc bằng bộ dựng truy vấn hoặc JQL, lưu bộ lọc, xuất CSV.',
    docAnchor: 'tim-kiem',
    chips: ['Cú pháp JQL', 'Việc quá hạn', 'Việc của tôi'],
  },
  {
    pattern: '/notifications',
    name: 'Thông báo',
    purpose: 'Trung tâm thông báo: lọc Chưa đọc, Được nhắc, Được giao; đánh dấu đã đọc.',
    docAnchor: 'thong-bao',
    chips: ['Theo dõi công việc thế nào', 'Việc của tôi'],
  },
  {
    pattern: '/members',
    name: 'Thành viên',
    purpose: 'Quản lý thành viên của không gian làm việc: thêm người, đặt vai trò chung.',
    docAnchor: 'them-nguoi-phan-quyen',
    chips: ['Phân quyền thế nào?', 'Thêm người mới'],
  },
  {
    pattern: '/account',
    name: 'Tài khoản',
    purpose: 'Hồ sơ cá nhân: tên hiển thị, ảnh, múi giờ, đổi mật khẩu.',
    docAnchor: 'ca-nhan',
    chips: ['Đổi mật khẩu', 'Phím tắt'],
  },
  {
    pattern: '/wiki',
    name: 'Wiki',
    purpose: 'Tài liệu nội bộ dạng cây, có tìm kiếm, lịch sử phiên bản và nhúng công việc.',
    docAnchor: 'quan-ly-nang-cao',
    chips: ['Wiki là gì', 'Việc của tôi'],
  },
  {
    pattern: '/dashboards/:id',
    name: 'Bảng tổng quan',
    purpose: 'Bảng tổng quan tuỳ biến ghép từ các widget; chỉ chủ bảng được sửa.',
    docAnchor: 'bao-cao',
    chips: ['Báo cáo cho biết gì', 'Việc của tôi'],
  },
  {
    pattern: '/settings/roles',
    name: 'Vai trò',
    purpose: 'Danh sách vai trò và quyền; tạo vai trò tuỳ biến rồi gán cho người dùng.',
    docAnchor: 'vai-tro',
    chips: ['Phân quyền thế nào?', 'Thêm người mới'],
  },
  {
    pattern: '/admin',
    name: 'Quản trị hệ thống',
    purpose:
      'Console quản trị: tổng quan hệ thống, không gian làm việc, tài khoản, cấu hình và feature flags.',
    docAnchor: 'vt-sys-admin',
    chips: ['Quản trị hệ thống làm gì', 'Phím tắt'],
  },
];

/** Màn không có mục riêng (cài đặt, quản lý, kết nối…) → mô tả chung theo nhóm đường dẫn. */
const GROUPS: { re: RegExp; info: Omit<ScreenInfo, 'pattern'> }[] = [
  {
    re: /^\/settings(\/|$)/,
    info: {
      name: 'Cài đặt',
      purpose:
        'Thiết lập không gian làm việc: thông tin chung, vai trò, nhật ký, thông báo, mức ưu tiên, trường, quy trình, nhập dữ liệu, API key.',
      docAnchor: 'vt-ws-admin',
      chips: ['Phân quyền thế nào?', 'Nhập Excel ở đâu?'],
    },
  },
  {
    re: /^\/manage(\/|$)/,
    info: {
      name: 'Danh mục (quản lý nâng cao)',
      purpose:
        'Danh mục dự án, mục tiêu OKR, rủi ro, nhân lực, cam kết thời gian xử lý, khách hàng.',
      docAnchor: 'quan-ly-nang-cao',
      chips: ['Quản lý nâng cao gồm gì', 'Việc của tôi'],
    },
  },
  {
    re: /^\/connect(\/|$)/,
    info: {
      name: 'Kết nối',
      purpose: 'Tích hợp (Telegram, báo cáo định kỳ, nhập từ Jira) và tự động hoá.',
      docAnchor: 'tich-hop',
      chips: ['Tích hợp Telegram', 'Nhập Excel ở đâu?'],
    },
  },
];

const FALLBACK: ScreenInfo = {
  pattern: '*',
  name: 'Tirapro',
  purpose: 'Màn này chưa có mô tả riêng — hãy mở trang Hướng dẫn để xem tổng quan.',
  docAnchor: 'gioi-thieu',
  chips: ['Việc của tôi', 'Việc quá hạn', 'Phím tắt', 'Bạn làm được gì?'],
};

/** Thông tin màn theo đường dẫn; không có thì mô tả theo nhóm, rồi mô tả chung. */
export function screenInfoOf(pathname: string): ScreenInfo {
  const pattern = screenPattern(pathname);
  const exact = SCREENS.find((s) => s.pattern === pattern);
  if (exact) return exact;
  const g = GROUPS.find((x) => x.re.test(pathname));
  return g ? { pattern, ...g.info } : FALLBACK;
}
