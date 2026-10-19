import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import type { NotificationEmailPrefs } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import type { NotificationPrefsResponse } from './api';

/** Bản vá gửi `PUT /notifications/preferences` (hình dạng payload GIỮ NGUYÊN). */
export interface PrefsPatch {
  preferences?: Partial<Record<string, boolean>>;
  email?: Partial<NotificationEmailPrefs>;
}

/** Loại thông báo in-app có kênh email tương ứng -> khoá `NotificationEmailPrefs`. */
export const EMAIL_KEY_OF_TYPE: Record<string, keyof NotificationEmailPrefs> = {
  MENTIONED: 'mention',
  ISSUE_ASSIGNED: 'assigned',
  COMMENT_ADDED: 'comment',
  STATUS_CHANGED: 'transition',
};

/** Áp bản vá lên dữ liệu (bản sao; không sửa dữ liệu gốc) — dùng cho cập nhật lạc quan. */
export function applyPrefsPatch(
  d: NotificationPrefsResponse,
  patch: PrefsPatch,
): NotificationPrefsResponse {
  const preferences = { ...d.preferences };
  for (const [k, v] of Object.entries(patch.preferences ?? {}))
    if (v !== undefined) preferences[k] = v;
  return { ...d, preferences, email: { ...d.email, ...patch.email } };
}

/**
 * Hoàn tác CHỈ các khoá của `patch` về giá trị trong `before` (khoá không có ở `before` thì xoá). Không đụng khoá khác nên
 * một lần lỗi không xoá cập nhật lạc quan của lần bấm khác đang chờ.
 */
export function revertPrefsPatch(
  current: NotificationPrefsResponse,
  patch: PrefsPatch,
  before: NotificationPrefsResponse,
): NotificationPrefsResponse {
  const preferences = { ...current.preferences };
  for (const k of Object.keys(patch.preferences ?? {})) {
    if (k in before.preferences) preferences[k] = before.preferences[k]!;
    else delete preferences[k];
  }
  const email = { ...current.email };
  for (const k of Object.keys(patch.email ?? {}) as (keyof NotificationEmailPrefs)[])
    email[k] = before.email[k];
  return { ...current, preferences, email };
}

/**
 * Dòng con (tuỳ chọn email) mở hay đóng: người dùng đã chọn thủ công thì theo đó; chưa thì mở khi in-app bật HOẶC email
 * đã bật (email độc lập in-app nên cài đặt "chỉ email" không bị giấu).
 */
export function isOptionsOpen(
  manual: boolean | undefined,
  inApp: boolean,
  emailOn: boolean,
): boolean {
  return manual ?? (inApp || emailOn);
}

const MUTATION_KEY = ['notification-preferences', 'update'] as const;

/**
 * Tuỳ chọn mutation lưu tức thì có cập nhật lạc quan:
 * - `scope.id`: các lần lưu CHẠY NỐI TIẾP đúng thứ tự bấm (react-query xếp hàng theo scope) → máy chủ nhận lần bấm cuối
 *   cuối cùng, lần bấm sau không bị lần trước ghi đè do đến muộn. (`singleFlight` của phần A bỏ qua lần gọi thứ hai nên
 *   không hợp với "lần cuối thắng".)
 * - `onMutate`: huỷ nạp dở, chụp dữ liệu trước, áp bản vá vào cache ngay.
 * - `onError`: hoàn tác CHỈ khoá của bản vá này (không chụp-và-khôi-phục cả cache).
 * - `onSettled`: chỉ nạp lại (đồng bộ với máy chủ) khi đây là lần cuối còn chạy → cache không bị nạp-đè giữa chừng.
 */
export interface PrefsSaveEvents {
  /** Mỗi lần lưu: bắt đầu / thành công / thất bại (kèm bản vá để "Thử lại"). */
  onStart?: () => void;
  onSaved?: () => void;
  onFailed?: (patch: PrefsPatch) => void;
}

export function prefsMutationOptions(
  qc: QueryClient,
  send: (patch: PrefsPatch) => Promise<unknown>,
  events?: () => PrefsSaveEvents | undefined,
): MutationOptions<
  unknown,
  unknown,
  PrefsPatch,
  { before: NotificationPrefsResponse | undefined }
> {
  return {
    mutationKey: MUTATION_KEY,
    scope: { id: 'notification-preferences' },
    mutationFn: (patch) => send(patch),
    onMutate: async (patch) => {
      events?.()?.onStart?.();
      await qc.cancelQueries({ queryKey: keys.notificationPrefs });
      const before = qc.getQueryData<NotificationPrefsResponse>(keys.notificationPrefs);
      if (before) qc.setQueryData(keys.notificationPrefs, applyPrefsPatch(before, patch));
      return { before };
    },
    onSuccess: () => events?.()?.onSaved?.(),
    onError: (_e, patch, ctx) => {
      events?.()?.onFailed?.(patch);
      const before = ctx?.before;
      if (!before) return;
      qc.setQueryData<NotificationPrefsResponse>(keys.notificationPrefs, (cur) =>
        cur ? revertPrefsPatch(cur, patch, before) : cur,
      );
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: MUTATION_KEY }) <= 1)
        void qc.invalidateQueries({ queryKey: keys.notificationPrefs });
    },
  };
}
