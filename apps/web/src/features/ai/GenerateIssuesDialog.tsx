import { useState, type ComponentProps } from 'react';
import axios from 'axios';
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
import { useAiCapabilities, useGenerateIssues, useProjectMeta } from './api';
import { createSequentially, summarizeFailures } from './createSequence';
import { AiFallbackNote } from './AiFallbackNote';
import { aiSourceLabel } from './fallbackNote';
import { keys } from '@/lib/queryKeys';

interface Row extends AiGeneratedIssue {
  selected: boolean;
  /** Lý do lần tạo gần nhất bị lỗi (việc chưa tạo được) — hiện ngay dưới dòng. */
  error?: string;
}

/** Lỗi mang tính hệ thống: lặp lại cho các việc sau chỉ vô ích (hết phiên / thiếu quyền / bị giới hạn tốc độ). */
const HALT_STATUSES = new Set([401, 403, 429]);

/** Lý do tạo việc lỗi bằng câu tiếng Việt, theo mã HTTP. */
function describeCreateError(e: unknown): { message: string; halt: boolean } {
  const status = axios.isAxiosError(e) ? e.response?.status : undefined;
  const halt = status !== undefined && HALT_STATUSES.has(status);
  if (status === 429) return { message: 'Thao tác quá nhanh — hãy đợi một lát rồi thử lại.', halt };
  if (status === 401) return { message: 'Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.', halt };
  if (status === 403) return { message: 'Bạn không có quyền tạo công việc trong dự án này.', halt };
  const message = apiErrorMessage(e);
  // Không có phản hồi: máy chủ có thể đã tạo việc nhưng client không nhận được kết quả.
  if (axios.isAxiosError(e) && !e.response)
    return {
      message: `${message} Việc này có thể đã được tạo — hãy kiểm tra Việc chờ trước khi thử lại.`,
      halt: false,
    };
  return { message, halt };
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
  const { data: caps } = useAiCapabilities();
  const basic = caps?.available === false; // chế độ cơ bản: không nhận mình là AI
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<'claude' | 'heuristic' | null>(null);
  const [reason, setReason] = useState<AiFallbackReason | undefined>();
  const [more, setMore] = useState<{ count: number; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const defaultTypeId =
    meta?.issueTypes.find((t) => !t.isSubtask)?.id ?? meta?.issueTypes[0]?.id ?? '';

  function resolveTypeId(name?: string): string {
    if (!meta) return '';
    const match = meta.issueTypes.find((t) => t.name.toLowerCase() === (name ?? '').toLowerCase());
    return match?.id ?? defaultTypeId;
  }

  /** `rest` = phần còn lại chưa hiển thị của lần phân tích trước: phân tích tiếp và NỐI vào danh sách. */
  async function analyze(rest?: string) {
    const input = (rest ?? text).trim();
    if (input.length < 3) return;
    try {
      const res = await generate.mutateAsync({ projectId, text: input });
      setSource(res.source);
      setReason(res.reason);
      const fresh = res.issues.map((i) => ({ ...i, selected: true }));
      setRows((cur) => (rest && cur ? [...cur, ...fresh] : fresh));
      setMore(
        res.remainingText && res.total
          ? { count: res.total - res.issues.length, text: res.remainingText }
          : null,
      );
      setNotice(null);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  function patch(idx: number, p: Partial<Row>) {
    setRows((r) => (r ? r.map((row, i) => (i === idx ? { ...row, ...p } : row)) : r));
  }

  /**
   * Tạo TUẦN TỰ để số hiệu và thứ tự trong Việc chờ khớp thứ tự danh sách. Việc đã tạo bị bỏ khỏi danh sách;
   * việc lỗi ở lại kèm lý do; lỗi hệ thống (401/403/429) dừng sớm và giữ nguyên phần chưa tạo để thử lại.
   */
  async function createSelected() {
    if (!rows || creating) return;
    const chosen = rows
      .map((row, idx) => ({ id: idx, payload: row }))
      .filter((x) => x.payload.selected && x.payload.summary.trim());
    if (!chosen.length) {
      toast.error('Chưa chọn công việc nào');
      return;
    }
    setCreating(true);
    setNotice(null);
    setProgress({ done: 0, total: chosen.length });
    const res = await createSequentially(
      chosen,
      (r) =>
        api.post('/issues', {
          projectId,
          typeId: resolveTypeId(r.type),
          summary: r.summary.trim(),
          description: r.description ?? null,
          descriptionFormat: 'MARKDOWN',
          storyPoints: typeof r.storyPoints === 'number' ? r.storyPoints : undefined,
        }),
      describeCreateError,
      (done, total) => setProgress({ done, total }),
    );
    setCreating(false);
    setProgress(null);
    const done = new Set(res.created);
    const errorOf = new Map(res.failed.map((f) => [f.id, f.message]));
    if (done.size) void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    if (!res.failed.length) {
      toast.success(`Đã tạo ${done.size} công việc`);
      onClose();
      return;
    }
    const left = res.failed.length + res.notTried.length;
    const why = summarizeFailures(res.failed);
    setNotice(
      `${done.size ? `Đã tạo ${done.size} công việc. ` : ''}${res.halted ? 'Đã dừng sớm. ' : ''}Còn ${left} việc chưa tạo — ${why}`,
    );
    toast.error(done.size ? `Đã tạo ${done.size}, còn ${left} việc chưa tạo: ${why}` : why);
    // Bỏ các dòng đã tạo, gắn lý do lên đúng dòng lỗi (khoá sửa khi đang tạo nên `rows` không đổi giữa chừng).
    setRows(
      rows
        .map((r, i) => ({ ...r, error: errorOf.get(i), keep: !done.has(i) }))
        .filter((r) => r.keep)
        .map(({ keep: _keep, ...r }) => r),
    );
  }

  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;

  return (
    <Dialog
      open={open}
      icon={<Sparkles className="h-4 w-4" />}
      // Đang tạo: khoá đóng (X, Esc, bấm nền) để vòng tạo không chạy ngầm không ai thấy.
      onOpenChange={(o) => {
        if (!o && !creating) onClose();
      }}
      onEscapeKeyDown={(e) => {
        if (creating) e.preventDefault();
      }}
      title={basic ? 'Tạo công việc từ danh sách' : 'Tạo công việc bằng AI'}
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
              {progress
                ? `Đang tạo ${progress.done}/${progress.total}…`
                : `Tạo ${selectedCount} công việc`}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm text-muted">
            {basic
              ? 'Dán danh sách yêu cầu — hệ thống tách theo từng dòng (hoặc từng câu nếu chỉ có một dòng). Chưa dùng AI.'
              : 'Mô tả yêu cầu — AI sẽ tách thành các công việc nhỏ.'}
          </p>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            disabled={creating}
            placeholder={
              basic
                ? 'VD (mỗi việc một dòng):\n- Xây màn hình đăng nhập\n- Đăng nhập Google\n- Sửa lỗi token hết hạn'
                : 'VD: Xây màn hình đăng nhập email/mật khẩu, validate input, đăng nhập Google, sửa lỗi token hết hạn…'
            }
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

        {notice && (
          <p role="alert" className="rounded-md bg-surface-2 px-3 py-2 text-sm text-danger">
            {notice}
          </p>
        )}
        <span role="status" aria-live="polite" className="sr-only">
          {progress ? `Đang tạo ${progress.done}/${progress.total}` : ''}
        </span>

        {rows && (
          <fieldset disabled={creating} className="m-0 min-w-0 space-y-2 border-0 p-0">
            <p className="text-sm font-medium text-muted">
              Đề xuất ({rows.length}) — bỏ chọn / sửa trước khi tạo
            </p>
            {more && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">
                <span>Còn {more.count} mục chưa hiển thị.</span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={generate.isPending}
                  onClick={() => void analyze(more.text)}
                >
                  Hiện {Math.min(more.count, 15)} mục tiếp
                </Button>
              </div>
            )}
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
                  {row.error && <p className="text-xs text-danger">{row.error}</p>}
                </div>
              </div>
            ))}
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
