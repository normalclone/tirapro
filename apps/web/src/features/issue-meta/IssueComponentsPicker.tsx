import { useRef } from 'react';
import { Plus, X } from 'lucide-react';
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

export interface GroupVisibility {
  components: boolean;
  fixVersions: boolean;
  affectsVersions: boolean;
}
const ALL_GROUPS: GroupVisibility = { components: true, fixVersions: true, affectsVersions: true };

/**
 * Thành phần & phiên bản của công việc: chỉ hiện cái ĐÃ gắn (chip có nút bỏ) + "+ Thêm" chọn từ danh mục dự án.
 * Phiên bản chia hai nhóm: "Sửa ở phiên bản" (FIX) và "Bị ảnh hưởng ở phiên bản" (AFFECTS). Người chỉ-xem thấy chip
 * không có nút. Cập nhật tức thì (vá cache, không đổi `version` — xem `useToggleComponent`).
 */
export function IssueComponentsPicker({
  issue,
  show = ALL_GROUPS,
}: {
  issue: IssueDto;
  /** Nhóm nào được vẽ (khối tuỳ chọn: nhóm rỗng ẩn sau "+ Thêm mục"). Mặc định cả ba. */
  show?: GroupVisibility;
}) {
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const { data: catalogC = [] } = useProjectComponents(issue.projectId);
  const { data: catalogV = [] } = useProjectVersions(issue.projectId);
  const comp = useToggleComponent(issue);
  const ver = useToggleVersion(issue);

  const fixes = issue.fixVersions.filter((v) => v.type === 'FIX');
  const affects = issue.fixVersions.filter((v) => v.type === 'AFFECTS');
  if (!show.components && !show.fixVersions && !show.affectsVersions) return null;

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
      {show.components && (
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
          catalogHint="Dự án chưa có thành phần nào — quản trị dự án tạo ở Cấu hình"
          options={optsC}
          addLabel="Thêm thành phần"
          sectionId="components"
          onAdd={(id) => comp.attach.mutate({ componentId: id, name: nameOf(catalogC, id) })}
        />
      )}
      {show.fixVersions && (
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
          catalogHint="Dự án chưa có phiên bản nào — quản trị dự án tạo ở Cấu hình"
          options={versionOpts('FIX')}
          addLabel="Thêm phiên bản sửa"
          sectionId="fixVersions"
          onAdd={(id) =>
            ver.attach.mutate({ versionId: id, name: nameOf(catalogV, id), type: 'FIX' })
          }
        />
      )}
      {show.affectsVersions && (
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
          catalogHint="Dự án chưa có phiên bản nào — quản trị dự án tạo ở Cấu hình"
          options={versionOpts('AFFECTS')}
          addLabel="Thêm phiên bản bị ảnh hưởng"
          sectionId="affectsVersions"
          onAdd={(id) =>
            ver.attach.mutate({ versionId: id, name: nameOf(catalogV, id), type: 'AFFECTS' })
          }
        />
      )}
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
  sectionId,
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
  /** Id khối tuỳ chọn (`data-optional-section`) để "+ Thêm mục" cuộn/focus tới đúng nhóm. */
  sectionId: string;
}) {
  const showAdd = canEdit && !catalogEmpty && options.length > 0;
  const groupRef = useRef<HTMLDivElement>(null);
  return (
    // Một hàng mỗi nhóm (nhãn trái, chip phải) để ba nhóm rỗng không chiếm sáu dòng.
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1" data-optional-section={sectionId}>
      <p className="w-44 shrink-0 pt-0.5 text-sm font-medium text-muted">{label}</p>
      <div
        ref={groupRef}
        role="group"
        aria-label={label}
        tabIndex={-1}
        className="flex min-w-[10rem] flex-1 flex-wrap items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
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
                onClick={() => {
                  // Nút sắp biến mất: đưa focus về nhóm để người dùng bàn phím không bị rơi ra đầu trang.
                  groupRef.current?.focus();
                  c.onRemove();
                }}
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
              className="h-6 w-auto rounded-full border-dashed px-2 py-0 text-xs font-medium text-muted hover:border-primary hover:text-ink [@media(pointer:coarse)]:min-h-9"
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
