import { useState } from 'react';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_DIGEST_BLOCKS, resolveDigestBlocks } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { apiErrorMessage } from '@/lib/api';
import { useProjects } from '@/features/projects/api';
import { useCreateDigest, usePreviewDigest, useUpdateDigest, type Digest } from './api';
import {
  BlocksField,
  ChannelFields,
  Field,
  ScheduleFields,
  type DigestFormState,
  type SetDigestForm,
} from './DigestFormFields';
import { browserTimeZone } from './schedule';

function initialForm(digest: Digest | null): DigestFormState {
  if (!digest) {
    return {
      name: '',
      projectId: '',
      schedule: 'WEEKLY',
      weekday: 1,
      hour: 8,
      // Đề xuất múi giờ trình duyệt; người dùng ở Việt Nam sẽ thấy sẵn Asia/Ho_Chi_Minh.
      timezone: browserTimeZone(),
      channelId: '',
      deliverEmail: false,
      recipients: [],
      blocks: [...DEFAULT_DIGEST_BLOCKS],
    };
  }
  return {
    name: digest.name,
    projectId: digest.projectId ?? '',
    schedule: digest.schedule,
    weekday: digest.weekday,
    hour: digest.hour,
    timezone: digest.timezone,
    channelId: digest.channelId ?? '',
    deliverEmail: digest.deliverEmail,
    recipients: digest.recipients,
    // Digest cũ (metrics rỗng) hiện đúng 2 khối nó vẫn gửi từ trước tới nay.
    blocks: resolveDigestBlocks(digest.metrics),
  };
}

/** Lỗi nhập liệu phía giao diện (server vẫn kiểm lại); null = hợp lệ. */
function validate(f: DigestFormState): string | null {
  if (!f.name.trim()) return 'Vui lòng nhập tên báo cáo.';
  if (f.blocks.length === 0) return 'Chọn ít nhất một khối nội dung.';
  if (f.deliverEmail && f.recipients.length === 0) return 'Chọn ít nhất một người nhận email.';
  return null;
}

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
  const [preview, setPreview] = useState<string | null>(null);
  const create = useCreateDigest();
  const update = useUpdateDigest();
  const previewMutation = usePreviewDigest();
  const saving = create.isPending || update.isPending;
  const set: SetDigestForm = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setPreview(null); // nội dung xem trước không còn khớp cấu hình
  };

  function submit() {
    const error = validate(form);
    if (error) {
      toast.error(error);
      return;
    }
    const common = {
      name: form.name.trim(),
      schedule: form.schedule,
      weekday: form.weekday,
      hour: form.hour,
      timezone: form.timezone,
      metrics: form.blocks,
      deliverEmail: form.deliverEmail,
      recipients: form.recipients,
    };
    const done = {
      onSuccess: () => {
        toast.success(digest ? 'Đã lưu báo cáo.' : 'Đã tạo báo cáo định kỳ.');
        onOpenChange(false);
      },
      onError: (e: unknown) => toast.error(apiErrorMessage(e)),
    };
    if (digest) {
      update.mutate({ id: digest.id, ...common, channelId: form.channelId || null }, done);
    } else {
      create.mutate(
        {
          ...common,
          projectId: form.projectId || undefined,
          channelId: form.channelId || undefined,
        },
        done,
      );
    }
  }

  function showPreview() {
    previewMutation.mutate(
      { projectId: form.projectId || undefined, metrics: form.blocks },
      {
        onSuccess: (r) => setPreview(r.summaryText),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="digest-name" label="Tên báo cáo">
            <Input
              id="digest-name"
              value={form.name}
              autoFocus
              placeholder="VD: Tổng kết tuần"
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <ProjectField form={form} set={set} locked={digest !== null} />
        </div>
        <ScheduleFields form={form} set={set} />
        <ChannelFields form={form} set={set} />
        <BlocksField value={form.blocks} onChange={(v) => set('blocks', v)} />
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={showPreview}
            loading={previewMutation.isPending}
            disabled={form.blocks.length === 0}
          >
            <Eye className="h-4 w-4" />
            Xem trước
          </Button>
          <p className="mt-1 text-xs text-faint">
            Xem trước theo quyền của bạn. Tin gửi vào nhóm Telegram chỉ gồm dữ liệu dự án công khai
            (trừ báo cáo gắn một dự án cụ thể); mỗi email theo quyền của người nhận.
          </p>
          {preview !== null && (
            <pre
              aria-label="Nội dung xem trước"
              className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 font-mono text-xs text-ink"
            >
              {preview || 'Không có nội dung.'}
            </pre>
          )}
        </div>
      </div>
    </Dialog>
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
