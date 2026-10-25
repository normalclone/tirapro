import { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MyWorkspace } from './api';
import { workspaceSubline } from './workspaceSubline';

/** Ô vuông bo góc: hiện logo của không gian làm việc nếu có, không thì chữ cái đầu. */
export function WsBadge({
  name,
  src,
  variant,
}: {
  name: string;
  src?: string | null;
  variant?: 'active';
}) {
  return (
    <span
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md text-xs font-bold',
        variant === 'active'
          ? 'bg-primary text-primary-fg'
          : 'bg-surface-2 font-semibold text-muted',
      )}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

/**
 * Một mục của danh sách không gian làm việc: dòng 1 tên, dòng 2 "12 thành viên · Quản trị chung" (tooltip đầy đủ).
 * Tên truy cập = tên không gian (aria-labelledby); dòng 2 chỉ là mô tả (aria-describedby) — không gộp hết vào tên.
 */
export function WorkspaceOption({
  ws,
  active,
  disabled,
  onPick,
}: {
  ws: MyWorkspace;
  active: boolean;
  disabled: boolean;
  onPick: (ws: MyWorkspace) => void;
}) {
  const nameId = useId();
  const descId = useId();
  const sub = workspaceSubline(ws);
  return (
    <li role="presentation">
      <button
        type="button"
        role="option"
        aria-selected={active}
        aria-labelledby={nameId}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onPick(ws)}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
          'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
          'disabled:pointer-events-none [&:disabled_.text-ink-strong]:text-disabled-fg [&:disabled_.text-muted]:text-disabled-fg',
          active && 'bg-primary-subtle/60',
        )}
      >
        <WsBadge name={ws.name} src={ws.avatarUrl} />
        <span className="min-w-0 flex-1">
          <span id={nameId} className="block truncate text-sm font-medium text-ink-strong">
            {ws.name}
          </span>
          <span id={descId} className="block truncate text-[11px] text-muted" title={sub.title}>
            {sub.count !== null && <span className="tabular-nums">{sub.count}</span>}
            {sub.count !== null ? ` ${sub.text}` : sub.text}
          </span>
        </span>
        {active && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      </button>
    </li>
  );
}
