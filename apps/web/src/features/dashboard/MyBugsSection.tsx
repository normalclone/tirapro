import { useMemo, type ReactNode } from 'react';
import { Bug, CheckCheck } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { Skeleton } from '@/components/ui/primitives';
import { useWorkflows } from '@/features/workflow-settings/api';
import { useMyReportedBugs } from './api';
import { splitMyBugs, verifyStageStatusIds } from './myBugs';

const LIMIT = 6;

/**
 * "Bug tôi báo chưa đóng" + "Chờ tôi xác nhận" cho người báo lỗi (tester/reporter, ít khi được giao việc).
 * Không có bug nào → khối biến mất hoàn toàn; lần tải đầu hiện 2 dòng giữ chỗ (không nhảy layout).
 * `renderRow` do trang chủ truyền vào để dùng lại dòng sẵn có (tránh import vòng).
 */
export function MyBugsSection({ renderRow }: { renderRow: (issue: IssueDto) => ReactNode }) {
  const { data: bugs, isLoading } = useMyReportedBugs();
  const { data: workflows } = useWorkflows();
  const { awaiting, open } = useMemo(
    () => splitMyBugs(bugs ?? [], verifyStageStatusIds(workflows)),
    [bugs, workflows],
  );

  if (isLoading) {
    return (
      <div
        className="mb-10 space-y-px overflow-hidden rounded-lg border border-border bg-surface"
        aria-hidden
      >
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    );
  }
  if (awaiting.length === 0 && open.length === 0) return null;

  return (
    <div className="mb-10 space-y-6">
      {open.length > 0 && (
        <BugList
          icon={<Bug className="h-4 w-4 text-danger" aria-hidden />}
          title="Bug tôi báo chưa đóng"
          total={open.length}
          rows={open}
          renderRow={renderRow}
        />
      )}
      {awaiting.length > 0 && (
        <BugList
          icon={<CheckCheck className="h-4 w-4 text-primary" aria-hidden />}
          title="Chờ tôi xác nhận"
          total={awaiting.length}
          rows={awaiting}
          renderRow={renderRow}
        />
      )}
    </div>
  );
}

function BugList({
  icon,
  title,
  total,
  rows,
  renderRow,
}: {
  icon: ReactNode;
  title: string;
  total: number;
  rows: IssueDto[];
  renderRow: (issue: IssueDto) => ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
        <span className="tabular text-xs text-faint">{total}</span>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {rows.slice(0, LIMIT).map(renderRow)}
      </ul>
      {total > LIMIT && <p className="mt-1.5 text-xs text-faint">và {total - LIMIT} bug nữa</p>}
    </section>
  );
}
