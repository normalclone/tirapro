import { useState, type ComponentProps } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AiFallbackReason, AiGeneratedIssue } from '@tirapro/shared';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useOpenSession } from '@/lib/useOpenSession';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { DelayedSpinner } from '@/components/ui/primitives';
import { useGenerateIssues, useProjectMeta } from './api';
import { AiFallbackNote } from './AiFallbackNote';
import { aiSourceLabel } from './fallbackNote';
import { keys } from '@/lib/queryKeys';

interface Row extends AiGeneratedIssue {
  selected: boolean;
}

/**
 * Luôn mount (có hiệu ứng đóng); `key` theo lần mở → mỗi lần mở là mount mới nên form khởi tạo lại, không có
 * khung hình nội dung cũ. Lúc đóng `key` giữ nguyên nên nội dung ở lại suốt hiệu ứng.
 */
export function GenerateIssuesDialog(props: ComponentProps<typeof GenerateIssuesDialogInner>) {
  const session = useOpenSession(props.open);
  return <GenerateIssuesDialogInner key={session} {...props} />;
}

function GenerateIssuesDialogInner({
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
  const [reason, setReason] = useState<AiFallbackReason | undefined>();
  const [creating, setCreating] = useState(false);

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
      setReason(res.reason);
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
      toast.error('Chưa chọn công việc nào');
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
      toast.success(`Đã tạo ${ok} công việc${failed ? `, ${failed} việc lỗi` : ''}`);
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
      onClose();
    } else {
      toast.error('Không tạo được công việc nào');
    }
  }

  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;

  return (
    <Dialog
      open={open}
      icon={<Sparkles className="h-4 w-4" />}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Tạo công việc bằng AI"
      size="lg"
      footer={
        rows ? (
          <>
            <span className="mr-auto text-xs text-muted">{selectedCount} đã chọn</span>
            <Button
              loading={creating}
              onClick={() => void createSelected()}
              disabled={!selectedCount || !meta}
            >
              Tạo {selectedCount} công việc
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm text-muted">
            Mô tả yêu cầu — AI sẽ tách thành các công việc nhỏ.
          </p>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="VD: Xây màn hình đăng nhập email/mật khẩu, validate input, đăng nhập Google, sửa lỗi token hết hạn…"
            className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus-visible:border-primary"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              loading={generate.isPending}
              onClick={() => void analyze()}
              disabled={text.trim().length < 3}
            >
              <Wand2 className="h-4 w-4" />
              Phân tích
            </Button>
            {source && (
              <span className="text-xs text-faint">Nguồn: {aiSourceLabel(source, reason)}</span>
            )}
          </div>
          {source === 'heuristic' && (
            <div className="mt-2">
              <AiFallbackNote reason={reason} />
            </div>
          )}
        </div>

        {generate.isPending && <DelayedSpinner />}

        {rows && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted">
              Đề xuất ({rows.length}) — bỏ chọn / sửa trước khi tạo
            </p>
            {rows.map((row, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 rounded-md border border-border bg-bg p-2.5"
              >
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={(e) => patch(idx, { selected: e.target.checked })}
                  className="mt-2 h-4 w-4 accent-[var(--primary)]"
                  aria-label="Chọn"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input
                    value={row.summary}
                    onChange={(e) => patch(idx, { summary: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <SearchSelect
                      value={resolveTypeId(row.type)}
                      onChange={(v) => {
                        const name = meta?.issueTypes.find((t) => t.id === v)?.name;
                        patch(idx, { type: name });
                      }}
                      options={(meta?.issueTypes ?? []).map((t) => ({
                        value: t.id,
                        label: t.name,
                      }))}
                      ariaLabel="Loại công việc"
                      className="w-40"
                    />
                    {typeof row.storyPoints === 'number' && (
                      <span className="tabular rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {row.storyPoints} pts
                      </span>
                    )}
                    {row.description && (
                      <span className="truncate text-xs text-faint">{row.description}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
