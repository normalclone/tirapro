import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { MentionPerson } from './mentionQuery';

/**
 * Danh sách gợi ý @ — neo ở mép dưới khung soạn (không theo toạ độ con trỏ). Giữ focus ở textarea
 * (`onMouseDown` chặn mất focus) nên chọn bằng chuột hay bàn phím đều không làm đóng popup sớm.
 */
export function MentionPopup({
  id,
  people,
  activeIndex,
  onPick,
  onHover,
}: {
  id: string;
  people: MentionPerson[];
  activeIndex: number;
  onPick: (p: MentionPerson) => void;
  onHover: (index: number) => void;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Gợi ý người để nhắc đến"
      className="absolute left-0 top-full z-30 mt-1 max-h-64 w-72 max-w-full overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
    >
      {people.map((p, i) => (
        <li
          key={p.id}
          id={`${id}-opt-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(p);
          }}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
            i === activeIndex ? 'bg-primary-subtle text-ink-strong' : 'text-ink',
          )}
        >
          <Avatar name={p.name} src={p.avatarUrl} size={20} />
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          {(p.position || p.email) && (
            <span className="max-w-[40%] shrink-0 truncate text-xs text-faint">
              {p.position || p.email}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
