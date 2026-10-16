import type { GuideContent } from './guides';

/**
 * Hướng dẫn mặc định (Guide TOÀN CỤC, `workspaceId = null`) — nạp lúc khởi động API (`GuidesBootstrapService`), mọi
 * workspace (mới và cũ) thấy ngay. Nội dung nằm ở code để sửa qua review; muốn đổi thì TĂNG `version` (bản trong DB cũ
 * hơn sẽ được cập nhật). `selector` trỏ tới thuộc tính `data-tour` ở giao diện web — test `tourSelectors` giữ chúng khớp.
 */
export interface GuideSeed {
  key: string;
  type: 'TOUR' | 'CHECKLIST';
  /** Mẫu route (cùng dạng `routeToScreen` của web), vd `/p/:key/board`. */
  screen: string;
  title: string;
  description: string;
  content: GuideContent;
  order: number;
  version: number;
}

const sel = (name: string): string => `[data-tour="${name}"]`;

export const DEFAULT_GUIDES: GuideSeed[] = [
  {
    key: 'tour-home',
    type: 'TOUR',
    screen: '/',
    title: 'Làm quen Tổng quan',
    description: 'Bốn điểm cần biết khi mới vào Tirapro.',
    order: 0,
    version: 1,
    content: {
      autoStart: true,
      steps: [
        {
          selector: sel('home-overview'),
          title: 'Tổng quan',
          body: 'Việc của bạn và tiến độ chung hiện ở đây. Mở trang này đầu ngày là biết hôm nay cần làm gì.',
          placement: 'over',
          order: 0,
        },
        {
          selector: sel('nav-main'),
          title: 'Menu chính',
          body: 'Chuyển giữa Tổng quan, Dự án, Thành viên… Menu thay đổi theo quyền của bạn.',
          placement: 'right',
          order: 1,
        },
        {
          selector: sel('topbar-notifications'),
          title: 'Thông báo',
          body: 'Khi ai đó giao công việc, nhắc tên (@) hoặc bình luận vào công việc của bạn, chuông sẽ báo.',
          placement: 'bottom',
          order: 2,
        },
        {
          selector: sel('cmdk-hint'),
          title: 'Lệnh nhanh',
          body: 'Nhấn ⌘K (Ctrl+K trên Windows) để tìm công việc, dự án hoặc chạy lệnh mà không cần rời bàn phím.',
          placement: 'right',
          order: 3,
        },
      ],
    },
  },
  {
    key: 'tour-board',
    type: 'TOUR',
    screen: '/p/:key/board',
    title: 'Bảng việc',
    description: 'Kéo công việc qua các cột để cập nhật trạng thái.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('project-views'),
          title: 'Các cách xem',
          body: 'Bảng việc, Việc chờ, Lịch trình, Cây việc, Báo cáo là các cách nhìn khác nhau của cùng một dự án.',
          placement: 'bottom',
          order: 0,
        },
        {
          selector: sel('board-columns'),
          title: 'Cột trạng thái',
          body: 'Mỗi cột là một trạng thái. Kéo thẻ công việc sang cột khác để chuyển trạng thái, bấm vào thẻ để xem chi tiết.',
          placement: 'top',
          order: 1,
        },
        {
          selector: sel('project-create-issue'),
          title: 'Tạo công việc',
          body: 'Thêm công việc mới ở đây hoặc nhấn phím C. Cuối mỗi cột cũng có ô thêm nhanh.',
          placement: 'bottom',
          order: 2,
        },
        {
          selector: sel('board-backlog'),
          title: 'Việc chờ',
          body: 'Công việc chưa vào Sprint nằm ở Việc chờ — mở tab này để lập kế hoạch.',
          placement: 'bottom',
          order: 3,
        },
      ],
    },
  },
  {
    key: 'tour-backlog',
    type: 'TOUR',
    screen: '/p/:key/backlog',
    title: 'Việc chờ & Sprint',
    description: 'Thêm nhanh công việc và xếp vào Sprint.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('backlog-quickadd'),
          title: 'Thêm nhanh',
          body: 'Gõ tên công việc rồi Enter để thêm nhanh — thêm !cao @tên ~3 để đặt ưu tiên, người làm, điểm.',
          placement: 'top',
          order: 0,
        },
        {
          selector: sel('backlog-sprint'),
          title: 'Sprint',
          body: 'Kéo công việc vào Sprint để lập kế hoạch. Mỗi Sprint hiện tổng điểm và số công việc.',
          placement: 'bottom',
          order: 1,
        },
        {
          selector: sel('board-backlog'),
          title: 'Việc chờ',
          body: 'Việc chờ gom mọi công việc chưa vào Sprint.',
          placement: 'bottom',
          order: 2,
        },
      ],
    },
  },
  {
    key: 'tour-members',
    type: 'TOUR',
    screen: '/members',
    title: 'Thành viên & nhóm',
    description: 'Thêm người và gom thành nhóm.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('members-add'),
          title: 'Thêm thành viên',
          body: 'Chọn người có sẵn trong hệ thống hoặc tạo tài khoản mới. Người được thêm vào là dùng được ngay, không cần lời mời.',
          placement: 'bottom',
          order: 0,
        },
        {
          selector: sel('members-list'),
          title: 'Danh sách thành viên',
          body: 'Xem ai đang ở trong không gian làm việc, đổi vai trò hoặc gỡ khỏi không gian.',
          placement: 'top',
          order: 1,
        },
        {
          selector: sel('members-tabs'),
          title: 'Nhóm',
          body: 'Gom người theo chức năng thành nhóm để giao vai trò hàng loạt.',
          placement: 'bottom',
          order: 2,
        },
      ],
    },
  },
  {
    key: 'tour-roles',
    type: 'TOUR',
    screen: '/settings/roles',
    title: 'Vai trò & quyền',
    description: 'Vai trò quyết định ai làm được gì.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('roles-list'),
          title: 'Danh sách vai trò',
          body: 'Vai trò gom các quyền để giao cho thành viên. Vai trò hệ thống là cố định; bạn có thể tạo vai trò riêng.',
          placement: 'top',
          order: 0,
        },
        {
          selector: sel('roles-tabs'),
          title: 'So sánh vai trò',
          body: 'Chuyển sang "So sánh vai trò" để xem bảng quyền của mọi vai trò cạnh nhau.',
          placement: 'bottom',
          order: 1,
        },
        {
          selector: sel('roles-create'),
          title: 'Tạo vai trò',
          body: 'Tạo vai trò tuỳ chỉnh khi các vai trò có sẵn chưa vừa với cách làm việc của nhóm bạn.',
          placement: 'left',
          order: 2,
        },
      ],
    },
  },
  {
    key: 'onboarding-start',
    type: 'CHECKLIST',
    screen: '/',
    title: 'Bắt đầu với Tirapro',
    description: 'Bốn bước để không gian làm việc của bạn chạy được',
    order: 0,
    version: 1,
    // Tiến độ (`done`) tính từ dữ liệu thật theo `key` (OnboardingService); nhãn và đường dẫn lấy từ đây nên sửa không cần
    // deploy giao diện. `href: null` = giao diện tự mở hộp/đường dẫn phù hợp (xem `onboardingTarget`).
    content: {
      items: [
        { key: 'create_project', label: 'Tạo dự án đầu tiên' },
        { key: 'add_members', label: 'Thêm thành viên', href: '/members' },
        { key: 'start_sprint', label: 'Bắt đầu một Sprint' },
        { key: 'connect_telegram', label: 'Kết nối Telegram', href: '/connect/integrations' },
      ],
    },
  },
];
