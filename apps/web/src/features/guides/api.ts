import { useMutation, useQuery } from '@tanstack/react-query';
import type { GuideContent } from '@tirapro/shared';
import type { GuideType } from '@tirapro/types';
import { api } from '@/lib/api';

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

export const screenGuidesKey = (screen: string) => ['guides', screen] as const;

/** Lấy guides cho 1 màn (screen pattern, vd `/p/:key/board`). */
export function useScreenGuides(screen: string) {
  return useQuery({
    queryKey: screenGuidesKey(screen),
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
