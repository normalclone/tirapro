import { useRelaxCounts } from './api';
import { RelaxList } from './RelaxList';
import { planRelax, shouldRequestRelax } from './relaxPlan';

/**
 * Gợi ý nới bộ lọc trong trạng thái trống (092): hỏi máy chủ số việc khi bỏ từng điều kiện, hiện tối đa 5 dòng bấm được.
 * Lỗi/máy chủ cũ → không hiện gì (phần phụ của trạng thái trống, không phải lỗi của trang).
 */
export function RelaxSuggestions({
  jql,
  onApplyJql,
}: {
  jql: string;
  onApplyJql: (jql: string) => void;
}) {
  const query = useRelaxCounts(jql, shouldRequestRelax(jql));
  if (!shouldRequestRelax(jql) || query.isError) return null;
  return (
    <RelaxList
      plan={planRelax(query.data)}
      loaded={query.data !== undefined}
      onApply={onApplyJql}
    />
  );
}
