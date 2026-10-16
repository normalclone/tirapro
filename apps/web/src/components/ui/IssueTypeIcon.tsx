import { BookOpen, Bug, CheckSquare, Circle, ListTree, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_BY_KEY: Record<string, LucideIcon> = {
  EPIC: Zap,
  STORY: BookOpen,
  TASK: CheckSquare,
  BUG: Bug,
  SUBTASK: ListTree,
};

/** Biểu tượng LOẠI công việc (Epic/Story/Task/Bug/Sub-task) tô theo màu loại — nhận ra loại ngay từ cái liếc đầu. */
export function IssueTypeIcon({
  type,
  className,
}: {
  type: { key: string | null; name: string; color?: string | null };
  className?: string;
}) {
  const Icon = (type.key && ICON_BY_KEY[type.key]) || Circle;
  return (
    <Icon
      role="img"
      aria-label={`Loại: ${type.name}`}
      className={cn('h-3.5 w-3.5 shrink-0', className)}
      style={{ color: type.color || 'var(--faint)' }}
    >
      <title>{type.name}</title>
    </Icon>
  );
}
