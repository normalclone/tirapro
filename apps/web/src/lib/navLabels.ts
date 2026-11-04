/**
 * Nguồn DUY NHẤT của nhãn điều hướng. Tên mục menu là chuẩn; tiêu đề trang (h1, hoặc tiêu đề thẻ chính khi chưa có h1)
 * phải dùng đúng chuỗi này. Cụm mô tả dài hơn đặt ở dòng mô tả dưới tiêu đề.
 * Dùng ở: `components/layout/navItems.tsx`, `lib/routeSuggest.ts`, các layout sub-nav và trang tương ứng.
 */

/** Điều hướng chính (sidebar, thanh tab đáy, sheet "Tôi"). */
export const APP_NAV_LABELS = {
  me: 'Của tôi',
  home: 'Tổng quan',
  projects: 'Dự án',
  filters: 'Bộ lọc đã lưu',
  members: 'Thành viên',
  wiki: 'Wiki',
  connect: 'Kết nối',
  settings: 'Cài đặt',
  admin: 'Quản trị hệ thống',
  notifications: 'Thông báo',
  account: 'Tài khoản',
  documentation: 'Tài liệu hướng dẫn',
} as const;

/** Mục con của Cài đặt (`/settings/*`). */
export const SETTINGS_LABELS = {
  general: 'Thương hiệu',
  notifications: 'Thông báo',
  roles: 'Vai trò & quyền',
  audit: 'Nhật ký quản trị',
  workflows: 'Quy trình',
  priorities: 'Mức ưu tiên',
  severities: 'Mức nghiêm trọng',
  fields: 'Trường thông tin thêm',
  import: 'Nhập dữ liệu',
  api: 'API & kết nối lập trình',
} as const;

/** Nhãn của các màn từng nằm trong "Danh mục" (nay: tab dự án Mục tiêu / Rủi ro, tab Nhân lực của Thành viên). */
export const MANAGE_LABELS = {
  goals: 'Mục tiêu',
  risks: 'Rủi ro & vướng mắc',
  resources: 'Nhân lực',
} as const;

/** Mục con của Kết nối (`/connect/*`). */
export const CONNECT_LABELS = {
  integrations: 'Ứng dụng bên ngoài',
  automation: 'Tự động hoá',
} as const;

/** Console quản trị hệ thống (`/admin/*`). */
export const ADMIN_LABELS = {
  overview: 'Tổng quan',
  organizations: 'Tổ chức',
  accounts: 'Tài khoản',
  config: 'Cấu hình',
  system: 'Hệ thống',
  points: 'Cách tính điểm',
} as const;

/** Nhãn NGẮN cho ô trên thanh tab đáy khi nhãn đầy đủ bị cắt trên màn hẹp (nhãn đầy đủ giữ làm `aria-label`). */
export const TAB_SHORT_LABELS = {
  adminOrganizations: 'Tổ chức',
} as const;

/** Mục con của Cấu hình dự án (`/p/:key/config`). */
export const PROJECT_CONFIG_LABELS = {
  general: 'Chung',
  members: 'Thành viên',
  components: 'Thành phần',
  versions: 'Phiên bản',
  labels: 'Nhãn',
  workflow: 'Quy trình',
  responseTime: 'Thời gian xử lý',
  data: 'Xuất / Nhập dữ liệu',
} as const;
