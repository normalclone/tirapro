import { Package, Plus, X } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { useCanEditIssue } from '@/features/projects/permissions';
import {
  useProjectComponents,
  useProjectVersions,
  useToggleComponent,
  useToggleVersion,
} from './api';
import { availableToAdd } from './issueSets';

/**
 * Thành phần & phiên bản của công việc: chỉ hiện cái ĐÃ gắn (chip có nút bỏ) + "+ Thêm" chọn từ danh mục dự án.
 * Phiên bản chia hai nhóm: "Sửa ở phiên bản" (FIX) và "Bị ảnh hưởng ở phiên bản" (AFFECTS). Người chỉ-xem thấy chip
 * không có nút. Cập nhật tức thì (vá cache, không đổi `version` — xem `useToggleComponent`).
 */
export function IssueComponentsPicker({ issue }: { issue: IssueDto }) {
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const { data: catalogC = [] } = useProjectComponents(issue.projectId);
  const { data: catalogV = [] } = useProjectVersions(issue.projectId);
  const comp = useToggleComponent(issue);
  const ver = useToggleVersion(issue);

  const fixes = issue.fixVersions.filter((v) => v.type === 'FIX');
  const affects = issue.fixVersions.filter((v) => v.type === 'AFFECTS');
  const nothing = issue.components.length === 0 && issue.fixVersions.length === 0;

  // Không có gì để hiện/thêm: giữ một dòng gọn như trước.
  if (nothing && (!canEdit || (catalogC.length === 0 && catalogV.length === 0))) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-muted">
          <Package className="h-3.5 w-3.5" aria-hidden="true" />
          Thành phần &amp; phiên bản
        </span>
        <span className="text-faint">
          {canEdit ? 'Dự án chưa có — quản trị dự án tạo ở Cấu hình' : '—'}
        </span>
      </div>
    );
  }

  const optsC: SearchSelectOption[] = availableToAdd(catalogC, issue.components).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const versionOpts = (type: 'FIX' | 'AFFECTS'): SearchSelectOption[] =>
    availableToAdd(catalogV, issue.fixVersions, type).map((v) => ({ value: v.id, label: v.name }));
  const nameOf = (list: { id: string; name: string }[], id: string) =>
    list.find((x) => x.id === id)?.name ?? '';

  return (
    <div className="space-y-3">
      <ChipGroup
        label="Thành phần"
        emptyText="Chưa gắn thành phần nào"
        chips={issue.components.map((c) => ({
          id: c.id,
          name: c.name,
          removeLabel: `Bỏ thành phần ${c.name}`,
          onRemove: () => comp.detach.mutate(c.id),
        }))}
        canEdit={canEdit}
        catalogEmpty={catalogC.length === 0}
        catalogHint="Dự án chưa có thành phần — quản trị dự án tạo ở Cấu hình"
        options={optsC}
        addLabel="Thêm thành phần"
        onAdd={(id) => comp.attach.mutate({ componentId: id, name: nameOf(catalogC, id) })}
      />
      <ChipGroup
        label="Sửa ở phiên bản"
        emptyText="Chưa gắn phiên bản nào"
        chips={fixes.map((v) => ({
          id: v.id,
          name: v.name,
          removeLabel: `Bỏ phiên bản sửa ${v.name}`,
          onRemove: () => ver.detach.mutate({ versionId: v.id, type: 'FIX' }),
        }))}
        canEdit={canEdit}
        catalogEmpty={catalogV.length === 0}
        catalogHint="Dự án chưa có phiên bản — quản trị dự án tạo ở Cấu hình"
        options={versionOpts('FIX')}
        addLabel="Thêm phiên bản sửa"
        onAdd={(id) =>
          ver.attach.mutate({ versionId: id, name: nameOf(catalogV, id), type: 'FIX' })
        }
      />
      <ChipGroup
        label="Bị ảnh hưởng ở phiên bản"
        emptyText="Chưa gắn phiên bản nào"
        chips={affects.map((v) => ({
          id: v.id,
          name: v.name,
          removeLabel: `Bỏ phiên bản bị ảnh hưởng ${v.name}`,
          onRemove: () => ver.detach.mutate({ versionId: v.id, type: 'AFFECTS' }),
        }))}
        canEdit={canEdit}
        catalogEmpty={catalogV.length === 0}
        catalogHint="Dự án chưa có phiên bản — quản trị dự án tạo ở Cấu hình"
        options={versionOpts('AFFECTS')}
        addLabel="Thêm phiên bản bị ảnh hưởng"
        onAdd={(id) =>
          ver.attach.mutate({ versionId: id, name: nameOf(catalogV, id), type: 'AFFECTS' })
        }
      />
    </div>
  );
}

interface ChipSpec {
  id: string;
  name: string;
  removeLabel: string;
  onRemove: () => void;
}

function ChipGroup({
  label,
  emptyText,
  chips,
  canEdit,
  catalogEmpty,
  catalogHint,
  options,
  addLabel,
  onAdd,
}: {
  label: string;
  emptyText: string;
  chips: ChipSpec[];
  canEdit: boolean;
  catalogEmpty: boolean;
  catalogHint: string;
  options: SearchSelectOption[];
  addLabel: string;
  onAdd: (id: string) => void;
}) {
  // Danh mục rỗng: không có gì để thêm → bỏ hẳn nhóm nếu cũng chưa gắn gì (gợi ý chỉ hiện ở dòng gọn/nhóm đầu).
  const showAdd = canEdit && !catalogEmpty && options.length > 0;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink"
            title={c.name}
          >
            <span className="max-w-[12rem] truncate">{c.name}</span>
            {canEdit && (
              <button
                type="button"
                aria-label={c.removeLabel}
                onClick={c.onRemove}
                className="-mr-1 grid h-4 w-4 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {chips.length === 0 && (
          <span className="text-xs text-faint">
            {canEdit && catalogEmpty ? catalogHint : emptyText}
          </span>
        )}
        {showAdd && (
          <span className="inline-block">
            <SearchSelect
              value=""
              onChange={onAdd}
              options={options}
              ariaLabel={addLabel}
              searchPlaceholder="Tìm…"
              hideChevron
              className="h-6 w-auto rounded-full border-dashed px-2 py-0 text-xs font-medium text-muted hover:border-primary hover:text-ink"
              renderTrigger={() => (
                <span className="inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" aria-hidden />
                  Thêm
                </span>
              )}
            />
          </span>
        )}
      </div>
    </div>
  );
}
