/**
 * Đường dẫn cũ đã chuyển chỗ khi bỏ mục "Danh mục" (`/manage`) → chuyển hướng + (có `message`) một thông báo ngắn nói nó đã nằm ở đâu.
 * Một nguồn cho router và test: mọi `to` phải là chỗ THẬT (không phải đường dẫn cũ khác) nên không thể vòng lặp.
 * `from` là đường dẫn ở cấp gốc (không có "/" đầu), khớp từng route phẳng trong router.
 */
export interface LegacyRoute {
  from: string;
  to: string;
  message?: string;
}

const GOALS_MOVED = 'Mục tiêu giờ nằm trong từng dự án — mở một dự án rồi chọn Thêm → Mục tiêu.';
const RISKS_MOVED =
  'Rủi ro & vướng mắc giờ nằm trong từng dự án — mở một dự án rồi chọn Thêm → Rủi ro & vướng mắc.';
const SLA_MOVED = 'Thời gian xử lý giờ nằm trong Cấu hình của từng dự án.';
const RESOURCES_MOVED = 'Nhân lực giờ là một tab của trang Thành viên.';
const PORTFOLIO_MOVED = 'Danh mục dự án giờ là chế độ “Theo nhóm” của trang Dự án.';
const CLIENTS_MOVED = 'Màn Khách hàng đã được bỏ.';

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { from: 'manage', to: '/projects?view=groups' },
  { from: 'manage/portfolio', to: '/projects?view=groups', message: PORTFOLIO_MOVED },
  { from: 'manage/goals', to: '/projects', message: GOALS_MOVED },
  { from: 'manage/risks', to: '/projects', message: RISKS_MOVED },
  { from: 'manage/resources', to: '/members?tab=resources', message: RESOURCES_MOVED },
  { from: 'manage/response-time', to: '/projects', message: SLA_MOVED },
  { from: 'manage/clients', to: '/projects', message: CLIENTS_MOVED },
  { from: 'settings/response-time', to: '/projects', message: SLA_MOVED },
  { from: 'portfolio', to: '/projects?view=groups', message: PORTFOLIO_MOVED },
  { from: 'goals', to: '/projects', message: GOALS_MOVED },
  { from: 'raid', to: '/projects', message: RISKS_MOVED },
  { from: 'resources', to: '/members?tab=resources', message: RESOURCES_MOVED },
  { from: 'sla', to: '/projects', message: SLA_MOVED },
  { from: 'clients', to: '/projects', message: CLIENTS_MOVED },
];
