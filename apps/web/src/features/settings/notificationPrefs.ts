import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import type { NotificationEmailPrefs } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { registerSessionCleaner } from '@/lib/sessionCache';
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
 * Đặt lại CHỈ các khoá được nêu về giá trị cho trước (`undefined` = xoá khoá). Không đụng khoá khác nên một lần lỗi không
 * xoá cập nhật lạc quan của khoá khác đang chờ.
 */
export function restorePrefsKeys(
  current: NotificationPrefsResponse,
  values: {
    preferences?: Record<string, boolean | undefined>;
    email?: Partial<NotificationEmailPrefs>;
  },
): NotificationPrefsResponse {
  const preferences = { ...current.preferences };
  for (const [k, v] of Object.entries(values.preferences ?? {})) {
    if (v === undefined) delete preferences[k];
    else preferences[k] = v;
  }
  return { ...current, preferences, email: { ...current.email, ...values.email } };
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
 * Trạng thái theo TỪNG KHOÁ (`p:<LOẠI>` in-app, `e:<khoá>` email) trong lúc còn lần lưu chạy/xếp hàng:
 * - `confirmed`: giá trị máy chủ đã xác nhận gần nhất (gieo từ cache trước khi áp lần bấm đầu tiên của khoá; cập nhật khi
 *   một lần lưu THÀNH CÔNG). Hoàn tác khi lỗi luôn về giá trị này, KHÔNG về ảnh chụp lạc quan lúc bấm (ảnh chụp có thể là
 *   trạng thái chưa bao giờ được lưu).
 * - `pending`: số lần lưu của khoá chưa xong (đang chạy + xếp hàng). Lỗi mà còn lần sau cho cùng khoá thì KHÔNG hoàn tác —
 *   lần sau (nối tiếp, đúng thứ tự) sẽ định đoạt; chỉ lần cuối còn lại mới hoàn tác về `confirmed`.
 * Hết `pending` thì xoá mục (cache lại là nguồn sự thật, lần bấm sau gieo lại).
 */
interface KeyState {
  confirmed: boolean | undefined;
  pending: number;
}
const keyStates = new WeakMap<QueryClient, Map<string, KeyState>>();
const statesOf = (qc: QueryClient): Map<string, KeyState> => {
  let m = keyStates.get(qc);
  if (!m) keyStates.set(qc, (m = new Map<string, KeyState>()));
  return m;
};

/**
 * Bỏ toàn bộ trạng thái theo khoá của `qc` (đổi phiên: đăng xuất / đổi workspace). Lần lưu còn đang chạy giữ tham chiếu
 * bản đồ CŨ trong context nên không còn ghi/trừ vào bản đồ của người dùng sau.
 */
export function resetPrefsKeyStates(qc: QueryClient): void {
  keyStates.delete(qc);
}
registerSessionCleaner(() => resetPrefsKeyStates(queryClient));

/** Context của mutation: bản đồ trạng thái mà lần này ĐÃ tăng `pending` (null = onMutate thoát sớm, không tăng). */
interface PrefsMutationContext {
  states: Map<string, KeyState> | null;
}
/** Bản đồ còn hiệu lực của lần lưu này, hoặc undefined nếu không tăng gì / phiên đã đổi. */
const liveStates = (
  qc: QueryClient,
  ctx: PrefsMutationContext | undefined,
): Map<string, KeyState> | undefined =>
  ctx?.states && keyStates.get(qc) === ctx.states ? ctx.states : undefined;

function patchEntries(patch: PrefsPatch): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = [];
  for (const [k, v] of Object.entries(patch.preferences ?? {}))
    if (v !== undefined) out.push([`p:${k}`, v]);
  for (const [k, v] of Object.entries(patch.email ?? {}))
    if (v !== undefined) out.push([`e:${k}`, v]);
  return out;
}

function readKey(d: NotificationPrefsResponse, key: string): boolean | undefined {
  const name = key.slice(2);
  return key.startsWith('p:') ? d.preferences[name] : d.email[name as keyof NotificationEmailPrefs];
}

function valuesFor(keys: Array<[string, boolean | undefined]>) {
  const preferences: Record<string, boolean | undefined> = {};
  const email: Partial<NotificationEmailPrefs> = {};
  for (const [key, v] of keys) {
    if (key.startsWith('p:')) preferences[key.slice(2)] = v;
    else if (v !== undefined) email[key.slice(2) as keyof NotificationEmailPrefs] = v;
  }
  return { preferences, email };
}

export interface PrefsSaveEvents {
  /** Mỗi lần lưu: bắt đầu / thành công / thất bại (kèm bản vá để "Thử lại"). */
  onStart?: () => void;
  onSaved?: () => void;
  onFailed?: (patch: PrefsPatch) => void;
}

/**
 * Tuỳ chọn mutation lưu tức thì có cập nhật lạc quan:
 * - `scope.id`: các lần lưu CHẠY NỐI TIẾP đúng thứ tự bấm (react-query xếp hàng theo scope) → máy chủ nhận lần bấm cuối
 *   cuối cùng, lần bấm sau không bị lần trước ghi đè do đến muộn. (`singleFlight` của phần A bỏ qua lần gọi thứ hai nên
 *   không hợp với "lần cuối thắng".)
 * - `onMutate`: huỷ nạp dở, gieo `confirmed` từ cache (nếu khoá chưa có), tăng `pending`, áp bản vá vào cache ngay.
 * - `onSuccess`: `confirmed` = giá trị vừa lưu.
 * - `onError`: mỗi khoá — còn lần lưu sau cho khoá đó → để nguyên; không còn → về `confirmed`.
 * - `onSettled`: giảm `pending`; chỉ nạp lại (đồng bộ máy chủ) khi đây là lần cuối còn chạy.
 */
export function prefsMutationOptions(
  qc: QueryClient,
  send: (patch: PrefsPatch) => Promise<unknown>,
  events?: () => PrefsSaveEvents | undefined,
): MutationOptions<unknown, unknown, PrefsPatch, PrefsMutationContext> {
  return {
    mutationKey: MUTATION_KEY,
    scope: { id: 'notification-preferences' },
    mutationFn: (patch) => send(patch),
    onMutate: async (patch) => {
      events?.()?.onStart?.();
      await qc.cancelQueries({ queryKey: keys.notificationPrefs });
      const cur = qc.getQueryData<NotificationPrefsResponse>(keys.notificationPrefs);
      if (!cur) return { states: null }; // không tăng pending → onSettled không được trừ
      const states = statesOf(qc);
      for (const [key] of patchEntries(patch)) {
        const st = states.get(key) ?? { confirmed: readKey(cur, key), pending: 0 };
        st.pending += 1;
        states.set(key, st);
      }
      qc.setQueryData(keys.notificationPrefs, applyPrefsPatch(cur, patch));
      return { states };
    },
    onSuccess: (_d, patch, ctx) => {
      const states = liveStates(qc, ctx);
      if (states)
        for (const [key, v] of patchEntries(patch)) {
          const st = states.get(key);
          if (st) st.confirmed = v;
        }
      events?.()?.onSaved?.();
    },
    onError: (_e, patch, ctx) => {
      events?.()?.onFailed?.(patch);
      const states = liveStates(qc, ctx);
      if (!states) return; // phiên đã đổi hoặc lần này không áp gì lạc quan: không có gì để hoàn tác
      const revert: Array<[string, boolean | undefined]> = [];
      for (const [key] of patchEntries(patch)) {
        const st = states.get(key);
        if (st && st.pending <= 1) revert.push([key, st.confirmed]); // không còn lần sau cho khoá này
      }
      if (revert.length === 0) return;
      qc.setQueryData<NotificationPrefsResponse>(keys.notificationPrefs, (cur) =>
        cur ? restorePrefsKeys(cur, valuesFor(revert)) : cur,
      );
    },
    onSettled: (_d, _e, patch, ctx) => {
      const states = liveStates(qc, ctx); // chỉ trừ nếu CHÍNH lần này đã tăng, trong đúng phiên
      if (states)
        for (const [key] of patchEntries(patch)) {
          const st = states.get(key);
          if (!st) continue;
          st.pending -= 1;
          if (st.pending <= 0) states.delete(key);
        }
      if (qc.isMutating({ mutationKey: MUTATION_KEY }) <= 1)
        void qc.invalidateQueries({ queryKey: keys.notificationPrefs });
    },
  };
}
