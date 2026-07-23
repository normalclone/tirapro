import { Package } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { useProjectComponents, useProjectVersions } from './api';

/**
 * Picker thành phần & phiên bản (fix) cho chi tiết issue.
 *
 * BE chưa expose danh sách thành phần/phiên bản HIỆN ĐANG GẮN của issue (không có trong IssueDto).
 * Nếu render toggle tương tác mà mặc định "chưa gắn" thì bấm gỡ sẽ 404 / bấm gắn lần 2 sẽ nhân đôi.
 * → Hiển thị READ-ONLY (chip tắt, không bấm được) kèm ghi chú, cho tới khi BE trả về tập đã gắn.
 * KHÔNG bịa endpoint.
 */
export function IssueComponentsPicker({ issue }: { issue: IssueDto }) {
  const { data: components } = useProjectComponents(issue.projectId);
  const { data: versions } = useProjectVersions(issue.projectId);

  const hasComponents = (components ?? []).length > 0;
  const hasVersions = (versions ?? []).length > 0;

  // Cả hai danh sách đều rỗng → chỉ hiển thị giá trị "—".
  if (!hasComponents && !hasVersions) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-muted">
          <Package className="h-3.5 w-3.5" aria-hidden="true" />
          Thành phần &amp; phiên bản
        </span>
        <span className="text-faint">—</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-faint">
        Chưa thể chỉnh sửa thành phần &amp; phiên bản của issue tại đây — chỉ xem danh mục của dự án.
      </p>

      {hasComponents && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted">Thành phần</p>
          <div className="flex flex-wrap gap-1.5">
            {(components ?? []).map((c) => (
              <Chip key={c.id} label={c.name} />
            ))}
          </div>
        </div>
      )}

      {hasVersions && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-muted">Phiên bản (fix)</p>
          <div className="flex flex-wrap gap-1.5">
            {(versions ?? []).map((v) => (
              <Chip key={v.id} label={v.name} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Chip read-only (danh mục dự án) — chưa xác định được trạng thái gắn nên không tương tác. */
function Chip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex max-w-[12rem] items-center rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted"
      title={label}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
