import { useEffect, useState, type FormEvent } from 'react';
import { Bug, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useDuplicateCheck, useReportIssue, type DuplicateSuggestion } from './api';

export function ReportIssueModal({
  projectKey,
  projectId,
  open,
  onClose,
}: {
  projectKey: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');

  const report = useReportIssue(projectId);
  const { data: duplicates, isFetching: checkingDup } = useDuplicateCheck(projectId, summary);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setSummary('');
      setDescription('');
    }
  }, [open]);

  if (!open) return null;

  const trimmedSummary = summary.trim();
  const canSubmit = trimmedSummary.length > 0;
  const matches: DuplicateSuggestion[] = duplicates ?? [];
  const showDup = trimmedSummary.length >= 4 && matches.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const res = await report.mutateAsync({
        projectId,
        summary: trimmedSummary,
        description: description.trim() || undefined,
      });
      if (res.deduped) {
        toast.success(`Đã gộp vào issue trùng (lần thứ ${res.occurrenceCount ?? '?'})`);
      } else {
        toast.success(`Đã tạo ${res.key ?? 'issue'}`);
      }
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
        onClick={onClose}
        aria-label="Đóng"
      />
      <div className="relative flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Bug className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-ink">Báo lỗi / sự cố</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label htmlFor="ri-summary" className="mb-1.5 block text-sm font-medium text-muted">
                Tiêu đề
              </label>
              <Input
                id="ri-summary"
                autoFocus
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Mô tả ngắn gọn lỗi/sự cố gặp phải…"
                className="text-sm"
                aria-describedby={showDup ? 'ri-dup' : undefined}
              />

              {showDup && (
                <div
                  id="ri-dup"
                  className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 animate-in fade-in duration-150"
                >
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    Có thể trùng:
                  </p>
                  <ul className="space-y-1">
                    {matches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={onClose}
                          title="Đã có issue tương tự — bấm để đóng"
                          className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                        >
                          <span className="font-mono text-xs font-medium text-primary">{m.key}</span>
                          <span className="min-w-0 flex-1 truncate text-ink">{m.summary}</span>
                          {m.occurrenceCount > 1 && (
                            <span className="shrink-0 text-xs text-faint">×{m.occurrenceCount}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {checkingDup && !showDup && trimmedSummary.length >= 4 && (
                <p className="mt-1.5 text-xs text-faint">Đang kiểm tra trùng lặp…</p>
              )}
            </div>

            <div>
              <label htmlFor="ri-desc" className="mb-1.5 block text-sm font-medium text-muted">
                Mô tả <span className="font-normal text-faint">(tùy chọn)</span>
              </label>
              <textarea
                id="ri-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Các bước tái hiện, kết quả mong đợi vs thực tế…"
                className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus-visible:border-primary"
              />
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" loading={report.isPending} disabled={!canSubmit}>
              Gửi
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
