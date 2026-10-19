import { useRef } from 'react';
import type { IssueDto } from '@tirapro/types';
import { InlineText } from '@/components/ui/InlineText';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useUpdateIssue } from './api';

/** Lời báo xung đột phiên bản (409): nói rõ chuyện gì xảy ra và lựa chọn — KHÔNG tự ghi đè. */
export const SUMMARY_CONFLICT_MESSAGE =
  'Người khác vừa sửa công việc này. Bấm Lưu để ghi đè bằng tiêu đề của bạn, hoặc Huỷ để giữ bản mới.';

/** Lỗi lưu tiêu đề → câu hiển thị. `apiErrorMessage` luôn được gọi để MutationCache không toast thêm lần hai. */
export function summaryErrorText(e: unknown): string {
  const generic = apiErrorMessage(e);
  return apiErrorCode(e) === 'VERSION_CONFLICT' ? SUMMARY_CONFLICT_MESSAGE : generic;
}

/**
 * Tiêu đề công việc sửa tại chỗ — dùng chung cho trang chi tiết (h1) và panel xem nhanh (h2).
 * Giữ khoá lạc quan: mỗi lần lưu gửi `version` MỚI NHẤT của việc (đọc qua ref lúc gửi, nên "Thử lại" sau khi nạp lại bản mới
 * dùng version mới; còn nếu bản mới chưa về thì máy chủ lại trả 409 — không bao giờ ghi đè âm thầm). Lỗi 409 hiện lời báo
 * xung đột ngay dưới ô, giữ nguyên chữ người dùng đang gõ.
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
  const update = useUpdateIssue(issue.projectId);
  const issueRef = useRef(issue);
  issueRef.current = issue;
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
      describeError={summaryErrorText}
      onSave={(next) => {
        const cur = issueRef.current;
        return update.mutateAsync({
          id: cur.id,
          key: cur.key,
          patch: { summary: next },
          version: cur.version,
        });
      }}
    />
  );
}
