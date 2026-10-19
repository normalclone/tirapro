import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { apiErrorMessage } from '@/lib/api';
import { focusFirstError, type FieldError } from '@/lib/formErrors';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { useProjects } from '@/features/projects/api';
import { useCreateDigest, usePreviewDigest, useUpdateDigest, type Digest } from './api';
import {
  BlocksField,
  ChannelFields,
  Field,
  ScheduleFields,
  type SetDigestForm,
} from './DigestFormFields';
import {
  effectiveAllowPrivate,
  initialForm,
  toCreatePayload,
  toUpdatePayload,
  validateForm,
  type DigestField,
  type DigestFormState,
} from './digestForm';

/** Trường của form → id phần tử trong hộp + nhãn hiện ở phần tóm tắt lỗi. */
const FIELD_META: Record<DigestField, { id: string; label: string }> = {
  name: { id: 'digest-name', label: 'Tên báo cáo' },
  blocks: { id: 'digest-blocks', label: 'Nội dung báo cáo' },
  recipients: { id: 'digest-recipients', label: 'Người nhận email' },
};

/**
 * Tạo / sửa báo cáo định kỳ trong MỘT hộp thoại: tên, phạm vi, lịch, kênh (Telegram + Email), khối nội dung, xem
 * trước. Luôn mount với `open` thật (Radix cần để chạy hiệu ứng đóng); `key` của nơi gọi reset form mỗi lần mở.
 */
export function DigestEditorDialog({
  open,
  onOpenChange,
  digest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  digest: Digest | null;
}) {
  const [form, setForm] = useState<DigestFormState>(() => initialForm(digest));
  // Gồm dự án đã lưu trữ: sửa báo cáo của dự án lưu trữ không được âm thầm coi là công khai (reset `allowPrivateToChannel`).
  const projects = useProjects(true);
  const create = useCreateDigest();
  const update = useUpdateDigest();
  const saving = create.isPending || update.isPending;
  const projectIsPrivate = !!projects.data?.find((p) => p.id === form.projectId)?.isPrivate;
  // Danh sách dự án chưa tải xong thì chưa biết dự án có riêng tư không → giữ cờ như đang có (đừng xoá nhầm lúc sửa).
  const privacyKnown = projects.data !== undefined;
  const flagPrivate = privacyKnown ? projectIsPrivate : form.projectId !== '';
  const set: SetDigestForm = (key, value) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      // Đổi dự án → cờ "đăng dự án riêng tư vào nhóm" về tắt (phải bật lại, có cảnh báo, cho dự án mới).
      ...(key === 'projectId' ? { allowPrivateToChannel: false } : {}),
    }));

  // Sau lần Lưu lỗi đầu tiên, lỗi được tính lại theo form: sửa tới đâu hết lỗi tới đó.
  const [showErrors, setShowErrors] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const issues = showErrors ? validateForm(form) : [];
  const errors: FieldError[] = issues.map((i) => ({ ...FIELD_META[i.field], message: i.message }));
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  const errorOf = (f: DigestField) => issues.find((i) => i.field === f)?.message;
  // Đưa tới lỗi đầu tiên SAU khi phần tóm tắt đã hiện (nếu không, bố cục dịch xuống làm lệch vị trí cuộn).
  useEffect(() => {
    if (focusTick > 0) focusFirstError(errorsRef.current);
  }, [focusTick]);

  function submit() {
    if (validateForm(form).length > 0) {
      setShowErrors(true);
      setFocusTick((n) => n + 1);
      return;
    }
    const done = {
      onSuccess: () => {
        toast.success(digest ? 'Đã lưu báo cáo.' : 'Đã tạo báo cáo định kỳ.');
        onOpenChange(false);
      },
      onError: (e: unknown) => toast.error(apiErrorMessage(e)),
    };
    if (digest) update.mutate(toUpdatePayload(digest.id, form, flagPrivate), done);
    else create.mutate(toCreatePayload(form, flagPrivate), done);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={digest ? 'Sửa báo cáo định kỳ' : 'Tạo báo cáo định kỳ'}
      description="Tổng hợp tiến độ theo lịch và gửi qua Telegram và/hoặc email."
      size="lg"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={submit} loading={saving}>
            {digest ? 'Lưu' : 'Tạo báo cáo'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-1">
        <ErrorSummary errors={errors} />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="digest-name" label="Tên báo cáo" error={errorOf('name')}>
            {(a11y) => (
              <Input
                {...a11y}
                value={form.name}
                placeholder="VD: Tổng kết tuần"
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </FormField>
          <ProjectField form={form} set={set} locked={digest !== null} />
        </div>
        <ScheduleFields form={form} set={set} />
        <ChannelFields
          form={form}
          set={set}
          projectIsPrivate={projectIsPrivate}
          recipientsError={errorOf('recipients')}
        />
        <BlocksField
          value={form.blocks}
          onChange={(v) => set('blocks', v)}
          error={errorOf('blocks')}
        />
        <PreviewPanel form={form} projectIsPrivate={flagPrivate} />
      </div>
    </Dialog>
  );
}

/**
 * Xem trước KHỚP nội dung thật: "Nhóm Telegram" = đúng bản sẽ đăng (công khai; dự án riêng tư chỉ khi đã bật cho phép),
 * "Email của tôi" = bản theo quyền của bạn như một người nhận. Đổi cấu hình thì bản đã xem bị xoá (không còn khớp).
 */
function PreviewPanel({
  form,
  projectIsPrivate,
}: {
  form: DigestFormState;
  projectIsPrivate: boolean;
}) {
  // API xem trước (`POST /digests/preview`) cùng quyền với việc mở hộp soạn: integration:manage → không bày nút rồi bị 403.
  const canPreview = useAuth((s) => s.can('integration:manage'));
  const hasChannel = form.channelId !== '';
  const [as, setAs] = useState<'channel' | 'me'>(hasChannel ? 'channel' : 'me');
  const mode = hasChannel ? as : 'me';
  const preview = usePreviewDigest();
  const { reset } = preview;
  const signature = JSON.stringify([
    form.projectId,
    form.blocks,
    form.channelId,
    form.allowPrivateToChannel,
    projectIsPrivate,
    mode,
  ]);
  useEffect(() => reset(), [signature, reset]);

  function run() {
    preview.mutate(
      {
        projectId: form.projectId || undefined,
        metrics: form.blocks,
        as: mode,
        allowPrivateToChannel: effectiveAllowPrivate(form, projectIsPrivate),
      },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  const result = preview.data;
  if (!canPreview)
    return (
      <p className="text-xs text-faint">
        Xem trước cần quyền quản lý kết nối — bạn vẫn lưu được cấu hình, báo cáo sẽ gửi đúng lịch.
      </p>
    );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {hasChannel && (
          <div
            role="group"
            aria-label="Xem trước như"
            className="inline-flex rounded-md border border-border p-0.5"
          >
            {(
              [
                ['channel', 'Nhóm Telegram'],
                ['me', 'Email của tôi'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setAs(value)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  mode === value ? 'bg-primary-subtle text-primary' : 'text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={run}
          loading={preview.isPending}
          disabled={form.blocks.length === 0}
        >
          <Eye className="h-4 w-4" />
          Xem trước
        </Button>
      </div>
      <p className="mt-1 text-xs text-faint">
        {mode === 'channel'
          ? 'Đúng nội dung sẽ đăng vào nhóm Telegram: chỉ dự án công khai (dự án riêng tư chỉ khi bạn cho phép).'
          : 'Theo quyền xem của bạn; mỗi người nhận email thấy nội dung theo quyền của chính họ.'}
      </p>
      {result?.channelSkipped && (
        <p className="mt-2 rounded-md bg-surface-2 p-3 text-sm text-muted">
          Dự án riêng tư chưa được phép đăng vào nhóm Telegram nên báo cáo này sẽ KHÔNG gửi vào nhóm
          (chỉ email nếu có).
        </p>
      )}
      {result && !result.channelSkipped && (
        <pre
          aria-label="Nội dung xem trước"
          className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 font-mono text-xs text-ink"
        >
          {result.summaryText || 'Không có nội dung.'}
        </pre>
      )}
    </div>
  );
}

function ProjectField({
  form,
  set,
  locked,
}: {
  form: DigestFormState;
  set: SetDigestForm;
  /** Sửa: không đổi phạm vi dự án của báo cáo đã tạo. */
  locked: boolean;
}) {
  const { data } = useProjects();
  return (
    <Field
      id="digest-project"
      label="Phạm vi"
      hint={locked ? 'Không đổi được phạm vi sau khi tạo.' : undefined}
    >
      <SearchSelect
        id="digest-project"
        value={form.projectId}
        onChange={(v) => set('projectId', v)}
        options={[
          { value: '', label: 'Tất cả dự án' },
          ...(data ?? []).map((p) => ({ value: p.id, label: p.name })),
        ]}
        disabled={locked}
        className="w-full"
      />
    </Field>
  );
}
