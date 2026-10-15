import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { environmentSchema, normalizeEnvironment } from '@tirapro/shared';
import { apiErrorMessage } from '@/lib/api';
import { uploadAttachmentFile, uploadCommentAttachmentFile } from '@/features/attachments/api';
import { useReportIssue, type ReportIssueResult } from './api';
import { buildReportPayload, canSubmitReport, type ReportFormState } from './reportForm';

/**
 * Gửi form báo lỗi: kiểm môi trường, tải tệp (đúng bug đích ở nhánh gộp), báo kết quả có liên kết "Mở".
 * Trả `busy` + `submit`; `onDone` chạy sau khi gửi thành công (xoá nháp, đóng hộp).
 */
export function useReportSubmit({
  form,
  files,
  onEnvInvalid,
  onDone,
}: {
  form: ReportFormState;
  files: File[];
  onEnvInvalid: (message: string) => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const report = useReportIssue();
  const [busy, setBusy] = useState(false);
  const canSubmit = canSubmitReport(form) && !busy;

  async function send(): Promise<{ res: ReportIssueResult; failed: string[] }> {
    const payload = buildReportPayload(form);
    const upload = (issueId: string, viaComment: boolean) =>
      Promise.allSettled(
        files.map((f) =>
          viaComment ? uploadCommentAttachmentFile(issueId, f) : uploadAttachmentFile(issueId, f),
        ),
      );
    const failedOf = (up: PromiseSettledResult<unknown>[]) =>
      files.filter((_, i) => up[i]!.status === 'rejected').map((f) => f.name);

    if (payload.mergeIntoIssueId) {
      // Nhánh gộp: tải tệp lên bug ĐÍCH trước (quyền bình luận), rồi báo cùng danh sách id.
      const up = await upload(payload.mergeIntoIssueId, true);
      const attachmentIds = up.flatMap((r) => (r.status === 'fulfilled' ? [r.value.id] : []));
      const res = await report.mutateAsync({
        ...payload,
        ...(attachmentIds.length ? { attachmentIds } : {}),
      });
      return { res, failed: failedOf(up) };
    }
    const res = await report.mutateAsync(payload);
    return { res, failed: files.length ? failedOf(await upload(res.issueId, res.deduped)) : [] };
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    if (form.kind === 'BUG') {
      const env = normalizeEnvironment(form.environment);
      const parsed = env ? environmentSchema.safeParse(env) : null;
      if (parsed && !parsed.success) {
        onEnvInvalid(parsed.error.issues[0]?.message ?? 'Thông tin môi trường không hợp lệ');
        return;
      }
    }
    setBusy(true);
    try {
      const { res, failed } = await send();
      if (failed.length > 0) {
        toast.error(`${failed.length}/${files.length} tệp chưa tải lên được`, {
          description: `${failed.join(', ')} — nội dung đã được gửi, hãy mở công việc và đính kèm lại các tệp này.`,
          duration: 6000,
        });
      }
      toast.success(
        res.deduped
          ? `Đã thêm ghi chú vào ${res.key} (lần ${res.occurrenceCount})`
          : `Đã gửi ${res.key} vào Việc mới vào`,
        { duration: 6000, action: { label: 'Mở', onClick: () => navigate(`/issue/${res.key}`) } },
      );
      onDone();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { busy, canSubmit, submit };
}
