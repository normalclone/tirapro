import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/dateFormat';

/** Dung lượng người-đọc-được. */
export function fmtBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Thời gian tương đối gọn ("5 phút trước", "3 ngày trước"). */
export function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return fmtDate(iso);
}

type Tone = 'ok' | 'warn' | 'down' | 'muted';
const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  down: 'bg-danger',
  muted: 'bg-faint',
};
const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  down: 'text-danger',
  muted: 'text-faint',
};

/** Viên trạng thái dịch vụ: chấm màu + nhãn + ghi chú. */
export function StatusPill({ tone, label, note }: { tone: Tone; label: string; note?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
      <span className="font-medium text-ink">{label}</span>
      {note && <span className={cn('text-xs', TONE_TEXT[tone])}>{note}</span>}
    </span>
  );
}

/** Nhãn giá trị dạng dòng (dùng cho panel cấu hình). */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-ink">{children}</span>
    </div>
  );
}
