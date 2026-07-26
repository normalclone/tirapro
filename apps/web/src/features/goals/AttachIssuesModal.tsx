import { useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAttachGoalIssues, useIssueSearch, type GoalDto } from './api';

/**
 * Chọn công việc (issue/epic) để gắn vào mục tiêu. Tìm theo mã hoặc tiêu đề, chọn nhiều
 * rồi gắn một lượt. Công việc đã gắn hiện dấu tích và không chọn lại được.
 */
export function AttachIssuesModal({ open, goal, onClose }: { open: boolean; goal: GoalDto | null; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const attach = useAttachGoalIssues();

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setDebounced('');
    setPicked([]);
  }, [open, goal?.id]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 200);
    return () => clearTimeout(t);
  }, [term]);

  const { data: results, isLoading } = useIssueSearch(debounced, goal?.projectId ?? null, open && !!goal);

  if (!open || !goal) return null;

  const attached = new Set(goal.issues.map((i) => i.id));

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (picked.length === 0 || !goal) return;
    try {
      await attach.mutateAsync({ goalId: goal.id, issueIds: picked });
      toast.success(`Đã gắn ${picked.length} công việc vào mục tiêu`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gắn công việc vào mục tiêu"
        className="relative flex max-h-[76vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="min-w-0 truncate text-sm font-medium text-ink">Gắn công việc · {goal.name}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Nhập mã công việc hoặc vài chữ trong tiêu đề…"
              className="pl-8"
              autoFocus
              aria-label="Tìm công việc để gắn"
            />
          </div>
          {goal.project && (
            <p className="mt-1.5 text-xs text-faint">
              Mục tiêu này thuộc dự án {goal.project.name} nên chỉ tìm công việc trong dự án đó.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !results || results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Không có công việc nào khớp. Thử từ khoá ngắn hơn, hoặc nhập đúng mã công việc.
            </p>
          ) : (
            <ul role="listbox" aria-label="Kết quả tìm công việc" aria-multiselectable="true">
              {results.map((r) => {
                const already = attached.has(r.id);
                const selected = picked.includes(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected || already}
                      disabled={already}
                      title={already ? 'Công việc này đã nằm trong mục tiêu' : undefined}
                      onClick={() => toggle(r.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors',
                        already ? 'cursor-default opacity-60' : 'hover:bg-surface-2',
                        selected && 'bg-primary-subtle',
                      )}
                    >
                      <Check className={cn('h-4 w-4 shrink-0 text-primary', selected || already ? 'opacity-100' : 'opacity-0')} aria-hidden />
                      <span className="shrink-0 font-mono text-xs text-muted">{r.key}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.summary}</span>
                      {already && <span className="shrink-0 text-xs text-faint">Đã gắn</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <span className="mr-auto text-xs text-faint">
            {picked.length > 0 ? `Đã chọn ${picked.length} công việc` : 'Chọn một hoặc nhiều công việc'}
          </span>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void submit()} loading={attach.isPending} disabled={picked.length === 0}>
            Gắn vào mục tiêu
          </Button>
        </footer>
      </div>
    </div>
  );
}
