import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, X, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AiGeneratedIssue } from '@tirapro/shared';
import { api, apiErrorMessage } from '@/lib/api';
import { boardIssuesKey } from '@/features/board/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { DelayedSpinner } from '@/components/ui/primitives';
import { useGenerateIssues, useProjectMeta } from './api';

interface Row extends AiGeneratedIssue {
  selected: boolean;
}

export function GenerateIssuesDialog({
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
  const qc = useQueryClient();
  const { data: meta } = useProjectMeta(open ? projectKey : undefined);
  const generate = useGenerateIssues();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<'claude' | 'heuristic' | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setText('');
      setRows(null);
      setSource(null);
    }
  }, [open]);

  if (!open) return null;

  const defaultTypeId =
    meta?.issueTypes.find((t) => !t.isSubtask)?.id ?? meta?.issueTypes[0]?.id ?? '';

  function resolveTypeId(name?: string): string {
    if (!meta) return '';
    const match = meta.issueTypes.find((t) => t.name.toLowerCase() === (name ?? '').toLowerCase());
    return match?.id ?? defaultTypeId;
  }

  async function analyze() {
    if (text.trim().length < 3) return;
    try {
      const res = await generate.mutateAsync({ projectId, text: text.trim() });
      setSource(res.source);
      setRows(res.issues.map((i) => ({ ...i, selected: true })));
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  function patch(idx: number, p: Partial<Row>) {
    setRows((r) => (r ? r.map((row, i) => (i === idx ? { ...row, ...p } : row)) : r));
  }

  async function createSelected() {
    if (!rows) return;
    const chosen = rows.filter((r) => r.selected && r.summary.trim());
    if (!chosen.length) {
      toast.error('Chưa chọn issue nào');
      return;
    }
    setCreating(true);
    const results = await Promise.allSettled(
      chosen.map((r) =>
        api.post('/issues', {
          projectId,
          typeId: resolveTypeId(r.type),
          summary: r.summary.trim(),
          description: r.description ?? null,
          descriptionFormat: 'MARKDOWN',
          storyPoints: typeof r.storyPoints === 'number' ? r.storyPoints : undefined,
        }),
      ),
    );
    setCreating(false);
    const ok = results.filter((x) => x.status === 'fulfilled').length;
    const failed = results.length - ok;
    if (ok) {
      toast.success(`Đã tạo ${ok} issue${failed ? `, ${failed} lỗi` : ''}`);
      void qc.invalidateQueries({ queryKey: boardIssuesKey(projectId) });
      onClose();
    } else {
      toast.error('Không tạo được issue nào');
    }
  }

  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div className="relative flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-ink">Tạo issue bằng AI</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-1.5 text-sm text-muted">Mô tả yêu cầu — AI sẽ phân rã thành các issue.</p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="VD: Xây màn hình đăng nhập email/mật khẩu, validate input, đăng nhập Google, sửa lỗi token hết hạn…"
              className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus-visible:border-primary"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" loading={generate.isPending} onClick={() => void analyze()} disabled={text.trim().length < 3}>
                <Wand2 className="h-4 w-4" />
                Phân tích
              </Button>
              {source && (
                <span className="text-xs text-faint">
                  Nguồn: {source === 'claude' ? 'Claude' : 'gợi ý cơ bản'}
                </span>
              )}
            </div>
          </div>

          {generate.isPending && <DelayedSpinner />}

          {rows && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted">Đề xuất ({rows.length}) — bỏ chọn / sửa trước khi tạo</p>
              {rows.map((row, idx) => (
                <div key={idx} className="flex items-start gap-2 rounded-md border border-border bg-bg p-2.5">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => patch(idx, { selected: e.target.checked })}
                    className="mt-2 h-4 w-4 accent-[var(--primary)]"
                    aria-label="Chọn"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Input value={row.summary} onChange={(e) => patch(idx, { summary: e.target.value })} className="h-8 text-sm" />
                    <div className="flex items-center gap-2">
                      <SearchSelect
                        value={resolveTypeId(row.type)}
                        onChange={(v) => {
                          const name = meta?.issueTypes.find((t) => t.id === v)?.name;
                          patch(idx, { type: name });
                        }}
                        options={(meta?.issueTypes ?? []).map((t) => ({ value: t.id, label: t.name }))}
                        ariaLabel="Loại issue"
                        className="w-40"
                      />
                      {typeof row.storyPoints === 'number' && (
                        <span className="tabular rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                          {row.storyPoints} pts
                        </span>
                      )}
                      {row.description && <span className="truncate text-xs text-faint">{row.description}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {rows && (
          <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
            <span className="text-xs text-muted">{selectedCount} đã chọn</span>
            <Button className="ml-auto" loading={creating} onClick={() => void createSelected()} disabled={!selectedCount || !meta}>
              Tạo {selectedCount} issue
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
