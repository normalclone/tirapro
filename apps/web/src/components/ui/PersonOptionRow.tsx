import { useId } from 'react';
import { Check } from 'lucide-react';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { PersonOption } from './PeoplePicker';

/** Gợi ý phụ cạnh một người (vd "còn trống ~6 giờ/tuần"); `kind` chỉ để chọn màu — chữ luôn nói đủ. */
export interface PersonHint {
  kind: 'free' | 'full' | 'over' | 'off';
  text: string;
}

const HINT_TONE: Record<PersonHint['kind'], string> = {
  free: 'text-muted',
  off: 'text-muted',
  full: 'text-warning-ink',
  over: 'font-medium text-danger',
};

function MiniTeam({ name, color }: { name: string; color?: string | null }) {
  const c = color ?? 'var(--faint)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium"
      style={{ backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`, color: c }}
    >
      <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
      {name}
    </span>
  );
}

/**
 * Một dòng người trong danh sách chọn. `hint` (còn trống/quá tải) là phụ: khi có, TÊN vẫn là tên truy cập
 * (`aria-labelledby` → span tên) và gợi ý đọc qua `aria-describedby` (quy tắc Task 7: tên = nhãn nhìn thấy chính, mô tả riêng).
 * Không có `hint` thì giữ nguyên hành vi cũ (tên truy cập = toàn bộ nội dung nút).
 */
export function PersonOptionRow({
  option: o,
  active,
  onPick,
  hint,
}: {
  option: PersonOption;
  active: boolean;
  onPick: () => void;
  hint?: PersonHint | null;
}) {
  const base = useId();
  const nameId = `${base}-n`;
  const hintId = `${base}-h`;
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-labelledby={hint ? nameId : undefined}
      aria-describedby={hint ? hintId : undefined}
      onClick={onPick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
        active && 'bg-surface-2',
      )}
    >
      <Check
        className={cn('mt-1.5 h-4 w-4 shrink-0 text-primary', active ? 'opacity-100' : 'opacity-0')}
        aria-hidden
      />
      <Avatar name={o.name} src={o.avatarUrl} size={28} />
      <span className="min-w-0 flex-1">
        <span id={nameId} className="block truncate text-sm text-ink">
          {o.name}
        </span>
        {(o.position || (o.teams && o.teams.length > 0)) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            {o.position && <span className="truncate">{o.position}</span>}
            {o.teams?.map((t) => (
              <MiniTeam key={t.name} name={t.name} color={t.color} />
            ))}
          </span>
        )}
        {hint && (
          <span
            id={hintId}
            className={cn('mt-0.5 block text-[11px] tabular-nums', HINT_TONE[hint.kind])}
          >
            {hint.text}
          </span>
        )}
      </span>
    </button>
  );
}
