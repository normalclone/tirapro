import { formatCalendarDmy } from '@/lib/calendarDate';
import type { LeadershipCard, LeadershipOverview } from './api';

type Risk = LeadershipOverview['topRisks'][number];
type Goal = LeadershipOverview['slowGoals'][number];
type Overloaded = LeadershipOverview['overloaded'][number];

/** Chữ cho thẻ rỗng — nói rõ "tốt" chứ không để thẻ trống khó hiểu. */
export const LEADERSHIP_EMPTY = {
  risks: 'Không có rủi ro mở',
  goals: 'Không có OKR nào chậm so với thời gian',
  overloaded: 'Không ai quá tải trong 2 tuần tới',
} as const;

/** Giải thích cách tính, hiện ở tooltip của dấu hỏi trên thẻ. */
export const LEADERSHIP_HINT = {
  risks: 'Rủi ro chưa xử lý, điểm cao nhất trước (điểm = xác suất × ảnh hưởng).',
  goals:
    'Mục tiêu đang chạy chậm hơn thời gian đã trôi từ 15 điểm phần trăm. Chỉ tính mục tiêu có kỳ dạng 2026-Q4.',
  overloaded: 'Người được giao nhiều giờ hơn năng lực ở tuần này hoặc tuần sau.',
} as const;

/** `3.1` → `310%`. */
export function ratioText(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function hours(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/** `DEMO · Hạn 09/10/2026` — bỏ phần nào không có. */
export function riskMetaText(r: Pick<Risk, 'project' | 'dueDate'>): string {
  const parts: string[] = [];
  if (r.project) parts.push(r.project.key);
  if (r.dueDate) parts.push(`Hạn ${formatCalendarDmy(r.dueDate)}`);
  return parts.join(' · ');
}

/** `10% · đáng ra ~51%` — tiến độ thật cạnh phần thời gian đã trôi. */
export function goalPaceText(g: Pick<Goal, 'progress' | 'expectedProgress' | 'period'>): string {
  return `${g.progress}% · đáng ra ~${g.expectedProgress}% (${g.period})`;
}

/** `124/40 giờ · 23/11 – 29/11`. */
export function overloadDetailText(
  o: Pick<Overloaded, 'assignedHours' | 'capacityHours' | 'weekLabel'>,
): string {
  return `${hours(o.assignedHours)}/${hours(o.capacityHours)} giờ · ${o.weekLabel}`;
}

/** Nguồn của thẻ lỗi (máy chủ báo qua `unavailable`)? Máy chủ cũ không có cờ → coi là không lỗi. */
export function isUnavailable(
  data: Pick<LeadershipOverview, 'unavailable'> | undefined,
  card: LeadershipCard,
): boolean {
  return data?.unavailable?.includes(card) ?? false;
}
