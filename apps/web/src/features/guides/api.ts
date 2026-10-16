import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuideContent } from '@tirapro/shared';
import type { GuideType } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/**
 * Guide như API trả về cho FE. Tái dùng `GuideContent` (union TourContent | HelpContent
 * | ChecklistContent) từ @tirapro/shared; bổ sung các field tiến trình theo user
 * (`seen`, `state`) mà endpoint /guides trả thêm.
 */
export interface ScreenGuide {
  id: string;
  key: string;
  type: GuideType;
  screen: string;
  title: string;
  description: string | null;
  content: GuideContent;
  order: number;
  /** Đã xem (intro tour) chưa — dùng cho auto-start một lần. */
  seen: boolean;
  /** Tiến trình tổng quát (vd 'NEW' | 'SEEN' | 'COMPLETED'). */
  state: string | null;
}

/** Lấy guides cho 1 màn (screen pattern, vd `/p/:key/board`). */
export function useScreenGuides(screen: string) {
  return useQuery({
    queryKey: keys.guides.screen(screen),
    queryFn: async () =>
      (await api.get<ScreenGuide[]>(`/guides?screen=${encodeURIComponent(screen)}`)).data,
    staleTime: 5 * 60_000,
  });
}

/** Đánh dấu guide đã xem (seen) hoặc hoàn thành (complete). */
export function useMarkGuide() {
  return useMutation({
    mutationFn: (v: { key: string; action: 'seen' | 'complete' }) =>
      api.post(`/guides/${v.key}/${v.action}`),
  });
}

/** Một mục của checklist "Bắt đầu" (GET /guides/onboarding). `done` do server tính từ dữ liệu thật. */
export interface OnboardingItem {
  key: string;
  label: string;
  done: boolean;
  href: string | null;
}

export interface Onboarding {
  items: OnboardingItem[];
  doneCount: number;
  total: number;
  dismissed: boolean;
  /** Server quyết định hiện khối: chưa ẩn, chưa xong cả bốn, workspace dưới 30 ngày. */
  visible: boolean;
}

/** Checklist "Bắt đầu" của workspace — chỉ quản trị gọi được (403 với người khác → khối không hiện). */
export function useOnboarding(enabled = true) {
  return useQuery({
    queryKey: keys.guides.onboarding,
    queryFn: async () => (await api.get<Onboarding>('/guides/onboarding')).data,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/** "Ẩn khối này": ghi ở server (theo người dùng) rồi làm mới để khối biến mất và reload vẫn ẩn. */
export function useDismissOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/guides/onboarding/dismiss'),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.guides.onboarding }),
  });
}
