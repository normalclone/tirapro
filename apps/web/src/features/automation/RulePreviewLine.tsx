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
}: {
  conditions: RuleCondition[] | null;
  /** '' = quy tắc cấp workspace. */
  projectId: string;
}) {
  const preview = useRulePreview(conditions, projectId);
  const view = previewView({
    hasConditions: !!conditions && conditions.length > 0,
    pending: preview.pending,
    isError: preview.isError,
    data: preview.data,
    scoped: projectId !== '',
  });
  if (!view) return null;
  return (
    <div className="px-1">
      <p className="text-xs text-muted">{view.text}</p>
      {view.warning && <p className="mt-0.5 text-xs text-warning-ink">{view.warning}</p>}
    </div>
  );
}
