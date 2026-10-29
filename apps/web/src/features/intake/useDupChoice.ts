import { useState } from 'react';
import type { DuplicateSuggestion } from './api';
import { dupDecision, type DupSelection } from './dupDecision';

/** Lựa chọn trước gợi ý trùng (none/merge/new), trạng thái đóng panel và quyết định gửi suy ra từ đó. */
export function useDupChoice(
  matches: DuplicateSuggestion[],
  summary: string,
  opts: { canComment: boolean; kind: string },
) {
  const [sel, setSel] = useState<DupSelection>({ mode: 'none' });
  const [dismissed, setDismissed] = useState(false);
  const decision = dupDecision(sel, matches, summary, opts);
  /** Gọi mỗi lần tiêu đề đổi: panel mở lại; "vẫn tạo mới" của tiêu đề cũ không áp sang tiêu đề mới (gộp đã chọn thì giữ). */
  const onSummaryChange = () => {
    setDismissed(false);
    setSel((s) => (s.mode === 'new' ? { mode: 'none' } : s));
  };
  return { sel, setSel, dismissed, setDismissed, decision, onSummaryChange };
}
