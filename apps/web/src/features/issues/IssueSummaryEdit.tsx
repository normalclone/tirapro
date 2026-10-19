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
 * Version gửi kèm lần lưu: LẦN ĐẦU của một lần sửa dùng version chụp lúc mở ô (thay đổi xen giữa → máy chủ trả 409, không
 * bị ghi đè âm thầm); sau một lần lỗi ("Thử lại", ✓ sau 409) người dùng đã thấy xung đột nên dùng bản mới nhất — ghi đè có chủ đích.
 */
export function saveVersion(v: {
  captured: number | null;
  latest: number;
  attempt: number;
}): number {
  return v.attempt === 0 && v.captured !== null ? v.captured : v.latest;
}

/**
 * Tiêu đề công việc sửa tại chỗ — dùng chung cho trang chi tiết (h1) và panel xem nhanh (h2).
 * Giữ khoá lạc quan (`saveVersion`): lần lưu đầu gửi version chụp lúc mở ô; "Thử lại"/✓ sau lỗi gửi version MỚI NHẤT (đọc qua
 * ref lúc gửi; nếu bản mới chưa về thì máy chủ lại trả 409 — không bao giờ ghi đè âm thầm). Lỗi 409 hiện lời báo xung đột
 * ngay dưới ô, giữ nguyên chữ người dùng đang gõ.
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
  const captured = useRef<number | null>(null);
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
        captured.current = issueRef.current.version;
      }}
      describeError={summaryErrorText}
      onSave={(next, attempt) => {
        const cur = issueRef.current;
        return update.mutateAsync({
          id: cur.id,
          key: cur.key,
          patch: { summary: next },
          version: saveVersion({
            captured: captured.current,
            latest: cur.version,
            attempt,
          }),
        });
      }}
    />
  );
}
