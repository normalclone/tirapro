/**
 * Nguồn DUY NHẤT của nhãn điều hướng. Tên mục menu là chuẩn; tiêu đề trang (h1, hoặc tiêu đề thẻ chính khi chưa có h1)
 * phải dùng đúng chuỗi này. Cụm mô tả dài hơn đặt ở dòng mô tả dưới tiêu đề.
 * Dùng ở: `components/layout/navItems.tsx`, `lib/routeSuggest.ts`, các layout sub-nav và trang tương ứng.
 */

/** Điều hướng chính (sidebar, thanh tab đáy, sheet "Tôi"). */
export const APP_NAV_LABELS = {
  home: 'Tổng quan',
  projects: 'Dự án',
  filters: 'Bộ lọc đã lưu',
  members: 'Thành viên',
  manage: 'Danh mục',
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
  responseTime: 'Cam kết thời gian',
  import: 'Nhập dữ liệu',
  api: 'API & kết nối lập trình',
} as const;

/** Mục con của Danh mục (`/manage/*`). */
export const MANAGE_LABELS = {
  portfolio: 'Danh mục dự án',
  goals: 'Mục tiêu',
  risks: 'Rủi ro & vướng mắc',
  resources: 'Nhân lực',
  responseTime: 'Thời gian xử lý',
  clients: 'Khách hàng',
} as const;

/** Mục con của Kết nối (`/connect/*`). */
export const CONNECT_LABELS = {
  integrations: 'Ứng dụng bên ngoài',
  automation: 'Tự động hoá',
} as const;

/** Console quản trị hệ thống (`/admin/*`). */
export const ADMIN_LABELS = {
  overview: 'Tổng quan',
  workspaces: 'Không gian làm việc',
  accounts: 'Tài khoản',
  config: 'Cấu hình',
  system: 'Hệ thống',
} as const;

/** Nhãn NGẮN cho ô trên thanh tab đáy khi nhãn đầy đủ bị cắt trên màn hẹp (nhãn đầy đủ giữ làm `aria-label`). */
export const TAB_SHORT_LABELS = {
  adminWorkspaces: 'Không gian',
} as const;

/** Mục con của Cấu hình dự án (`/p/:key/config`). */
export const PROJECT_CONFIG_LABELS = {
  general: 'Chung',
  members: 'Thành viên',
  components: 'Thành phần',
  versions: 'Phiên bản',
  labels: 'Nhãn',
  data: 'Xuất / Nhập dữ liệu',
} as const;
