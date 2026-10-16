import { TELEGRAM_WIZARD_HREF } from '@/features/integrations/telegramWizard';

/** Việc cần làm khi bấm vào một mục của checklist "Bắt đầu". */
export type OnboardingTarget =
  | { kind: 'modal-create-project' }
  | { kind: 'modal-add-member' }
  | { kind: 'link'; to: string }
  | { kind: 'disabled'; reason: string };

/**
 * Đích của từng mục — hàm thuần để test. Nhãn/đường dẫn nằm ở bản ghi Guide; còn việc MỞ gì (hộp thoại tại chỗ hay
 * điều hướng) là logic giao diện theo `key`. Khoá lạ: dùng `href` của Guide nếu có.
 */
export function onboardingTarget(
  item: { key: string; href?: string | null },
  ctx: { firstProjectKey: string | null },
): OnboardingTarget {
  switch (item.key) {
    case 'create_project':
      return { kind: 'modal-create-project' };
    case 'add_members':
      return { kind: 'modal-add-member' };
    case 'start_sprint':
      return ctx.firstProjectKey
        ? { kind: 'link', to: `/p/${ctx.firstProjectKey}/backlog` }
        : { kind: 'disabled', reason: 'Tạo dự án trước' };
    case 'connect_telegram':
      return { kind: 'link', to: TELEGRAM_WIZARD_HREF };
    default:
      return item.href
        ? { kind: 'link', to: item.href }
        : { kind: 'disabled', reason: 'Chưa có hướng dẫn cho bước này' };
  }
}

/** Nhãn NÚT hành động (động từ), khác với nhãn mục (danh từ) trong Guide. */
export function onboardingActionLabel(key: string): string {
  switch (key) {
    case 'create_project':
      return 'Tạo dự án';
    case 'add_members':
      return 'Thêm thành viên';
    case 'start_sprint':
      return 'Mở Việc chờ';
    case 'connect_telegram':
      return 'Kết nối';
    default:
      return 'Mở';
  }
}
