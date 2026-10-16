import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { useRetained } from '@/lib/useRetained';
import { cn } from '@/lib/utils';
import { useAttachGoalIssues, useIssueSearch, type GoalDto } from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';

/**
 * Chọn công việc (issue/epic) để gắn vào mục tiêu. Tìm theo mã hoặc tiêu đề, chọn nhiều
 * rồi gắn một lượt. Công việc đã gắn hiện dấu tích và không chọn lại được.
 */
export function AttachIssuesModal({
  open,
  goal,
  onClose,
}: {
  open: boolean;
  goal: GoalDto | null;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const attach = useAttachGoalIssues();
  // Giữ mục tiêu gần nhất để nội dung không biến mất giữa hiệu ứng đóng.
  const shown = useRetained(goal);

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

  const resultsQuery = useIssueSearch(debounced, shown?.projectId ?? null, open && !!shown);

  if (!shown) return null;

  const attached = new Set(shown.issues.map((i) => i.id));

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (picked.length === 0 || !shown) return;
    try {
      await attach.mutateAsync({ goalId: shown.id, issueIds: picked });
      toast.success(`Đã gắn ${picked.length} công việc vào mục tiêu`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Gắn công việc · ${shown.name}`}
      size="md"
      bodyClassName="flex flex-col overflow-hidden p-0"
      footer={
        <>
          <span className="mr-auto text-xs text-faint">
            {picked.length > 0
              ? `Đã chọn ${picked.length} công việc`
              : 'Chọn một hoặc nhiều công việc'}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            onClick={() => void submit()}
            loading={attach.isPending}
            disabled={picked.length === 0}
          >
            Gắn vào mục tiêu
          </Button>
        </>
      }
    >
      <div className="border-b border-border px-5 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nhập mã công việc hoặc vài chữ trong tiêu đề…"
            className="pl-8"
            autoFocus
            aria-label="Tìm công việc để gắn"
          />
        </div>
        {shown.project && (
          <p className="mt-1.5 text-xs text-faint">
            Mục tiêu này thuộc dự án {shown.project.name} nên chỉ tìm công việc trong dự án đó.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <QueryBoundary
          query={resultsQuery}
          skeleton={
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          }
          empty={(d) => d.length === 0}
          emptyState={
            <p className="px-3 py-8 text-center text-sm text-muted">
              Không có công việc nào khớp. Thử từ khoá ngắn hơn, hoặc nhập đúng mã công việc.
            </p>
          }
        >
          {(results) => (
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
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0 text-primary',
                          selected || already ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
                      <span className="shrink-0 font-mono text-xs text-muted">{r.key}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.summary}</span>
                      {already && <span className="shrink-0 text-xs text-faint">Đã gắn</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryBoundary>
      </div>
    </Dialog>
  );
}
