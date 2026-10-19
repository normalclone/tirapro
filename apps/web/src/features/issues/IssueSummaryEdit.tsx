import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { InlineText } from '@/components/ui/InlineText';
import { api, apiErrorCode, apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useUpdateIssue } from './api';
import { SummaryConflictError, saveSummaryOnce } from './summarySave';

/** Lời báo xung đột phiên bản (409): nói rõ chuyện gì xảy ra và lựa chọn — KHÔNG tự ghi đè. */
export const SUMMARY_CONFLICT_MESSAGE =
  'Người khác vừa sửa công việc này. Bấm Lưu để ghi đè bằng tiêu đề của bạn, hoặc Huỷ để giữ bản mới.';

/** Lỗi lưu tiêu đề → câu hiển thị. `apiErrorMessage` luôn được gọi để MutationCache không toast thêm lần hai. */
export function summaryErrorText(e: unknown): string {
  const generic = apiErrorMessage(e);
  if (e instanceof SummaryConflictError)
    return `Tiêu đề vừa được đổi thành “${e.serverSummary}”. ${SUMMARY_CONFLICT_MESSAGE}`;
  return apiErrorCode(e) === 'VERSION_CONFLICT' ? SUMMARY_CONFLICT_MESSAGE : generic;
}

/**
 * Lỗi lưu tiêu đề đến SAU khi ô sửa đã gỡ (đã chuyển việc/đóng panel): không còn ô để hiện lỗi nên báo bằng toast. Xung đột thật
 * không nhắc "Bấm Lưu/Huỷ" (ô đã mất), chỉ nói tiêu đề chưa được lưu. Luôn qua `apiErrorMessage` (đánh dấu đã mô tả).
 */
export function lateSummaryErrorText(e: unknown, key: string): string {
  const generic = apiErrorMessage(e);
  if (e instanceof SummaryConflictError)
    return `Tiêu đề ${key} chưa được lưu vì người khác vừa đổi thành “${e.serverSummary}”.`;
  return `Tiêu đề ${key} chưa được lưu: ${generic}`;
}

/**
 * Tiêu đề công việc sửa tại chỗ — dùng chung cho trang chi tiết (h1) và panel xem nhanh (h2).
 * Giữ khoá lạc quan (`summarySave`): lần lưu đầu gửi version chụp lúc mở ô. Gặp 409: nạp lại bản mới — nếu TIÊU ĐỀ không ai đổi
 * (chỉ trường khác đổi) thì tự thử lại đúng một lần với version mới (người dùng chỉ thấy Đang lưu… → Đã lưu); nếu tiêu đề đã
 * đổi thì báo xung đột kèm tiêu đề hiện tại, giữ chữ người dùng đang gõ. Chỉ SAU KHI đã thấy báo xung đột, "Lưu"/"Thử lại" mới
 * gửi version MỚI NHẤT (ghi đè có chủ đích); sau lỗi 500/mất mạng vẫn giữ version đã chụp. Không bao giờ ghi đè âm thầm. Lỗi do ô
 * tự hiển thị nên mutation `silent` (không toast chung); nếu lỗi đến sau khi ô đã gỡ thì toast (`lateSummaryErrorText`).
 */
export function IssueSummaryEdit({
  issue,
  canEdit,
  as,
  className,
  textClassName,
  inputClassName,
  title,
  editRequest,
  onEditingChange,
}: {
  issue: IssueDto;
  canEdit: boolean;
  as: 'h1' | 'h2';
  className?: string;
  textClassName?: string;
  inputClassName?: string;
  title?: string;
  editRequest?: number;
  onEditingChange?: (editing: boolean) => void;
}) {
  const qc = useQueryClient();
  const update = useUpdateIssue(issue.projectId, { silent: true });
  const issueRef = useRef(issue);
  issueRef.current = issue;
  const captured = useRef<{ version: number; summary: string } | null>(null);
  const conflictSeen = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <InlineText
      value={issue.summary}
      label="Tiêu đề"
      as={as}
      canEdit={canEdit}
      className={className}
      textClassName={textClassName}
      inputClassName={inputClassName}
      title={title}
      editRequest={editRequest}
      onEditingChange={onEditingChange}
      onEditStart={() => {
        conflictSeen.current = false;
        captured.current = {
          version: issueRef.current.version,
          summary: issueRef.current.summary,
        };
      }}
      describeError={summaryErrorText}
      onSave={(next) => {
        const cur = issueRef.current;
        return saveSummaryOnce({
          conflictSeen: conflictSeen.current,
          startVersion: captured.current?.version ?? null,
          startSummary: captured.current?.summary ?? null,
          latestVersion: () => issueRef.current.version,
          send: (version) =>
            update.mutateAsync({
              id: cur.id,
              key: cur.key,
              patch: { summary: next },
              version,
            }),
          refetch: () =>
            qc.fetchQuery({
              queryKey: keys.issues.byKey(cur.key),
              queryFn: async () => (await api.get<IssueDto>(`/issues/${cur.key}`)).data,
              staleTime: 0,
            }),
          isConflict: (e) => apiErrorCode(e) === 'VERSION_CONFLICT',
          isMounted: () => mounted.current,
          notifyLate: (e) => {
            // Nói rõ việc nào (ô đã gỡ, người dùng đang ở việc khác); id theo việc → hai việc lỗi cùng lúc không gộp toast.
            toast.error(lateSummaryErrorText(e, cur.key), { id: `summary-late:${cur.key}` });
          },
          onConflictShown: () => {
            conflictSeen.current = true;
          },
        });
      }}
    />
  );
}
