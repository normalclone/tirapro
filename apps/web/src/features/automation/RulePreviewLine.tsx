import type { RuleCondition } from '@tirapro/shared';
import { useRulePreview } from './rules-api';
import { previewView } from './rulePreview';

/**
 * Một dòng nhỏ dưới câu điều kiện: "Khớp N việc hiện có" (132b). Cố ý KHÔNG phải vùng thông báo (trình đọc màn hình không đọc to):
 * số đổi theo từng lần sửa, đọc to mỗi lần là phiền. `conditions = null` khi còn điều kiện dở → không hiện gì.
 */
export function RulePreviewLine({
  conditions,
  projectId,
  scheduled = false,
}: {
  conditions: RuleCondition[] | null;
  /** '' = quy tắc cấp workspace. */
  projectId: string;
  /** Quy tắc theo lịch: nhắc giới hạn mỗi lần chạy khi số khớp lớn. */
  scheduled?: boolean;
}) {
  const preview = useRulePreview(conditions, projectId);
  const view = previewView({
    hasConditions: !!conditions && conditions.length > 0,
    pending: preview.pending,
    isError: preview.isError,
    data: preview.data,
    scoped: projectId !== '',
    scheduled,
  });
  if (!view) return null;
  return (
    <div className="px-1">
      <p className="text-xs text-muted">{view.text}</p>
      {view.warning && <p className="mt-0.5 text-xs text-warning-ink">{view.warning}</p>}
    </div>
  );
}
