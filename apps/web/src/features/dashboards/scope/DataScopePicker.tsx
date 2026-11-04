import { useMemo } from 'react';
import type { DashboardDataScopeValue } from '@tirapro/shared';
import { RadioCard, type RadioCardOption } from '@/components/ui/RadioCard';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { useProjects } from '@/features/projects/api';
import { usePrograms } from '@/features/projects/groups/programsApi';
import {
  DATA_SCOPE_HINT,
  DATA_SCOPE_LABEL,
  ORG_SCOPE_LOCKED,
  type DataScopeValue,
} from './dataScopeModel';

/**
 * Chọn phạm vi DỮ LIỆU: một dự án / một nhóm dự án của tôi / toàn tổ chức (khoá nếu không phải quản trị viên tổ chức).
 * Dùng ở thư viện mẫu và ở cài đặt dashboard. `allowed` = phạm vi mà mẫu/nơi gọi hỗ trợ (mục ngoài danh sách bị khoá kèm lý do).
 */
export function DataScopePicker({
  value,
  onChange,
  canOrg,
  allowed = ['PROJECT', 'GROUP', 'ORG'],
  ariaLabel = 'Phạm vi dữ liệu',
}: {
  value: DataScopeValue;
  onChange: (v: DataScopeValue) => void;
  canOrg: boolean;
  allowed?: readonly DashboardDataScopeValue[];
  ariaLabel?: string;
}) {
  const { data: projects } = useProjects();
  const { data: programs } = usePrograms();

  const projectOptions = useMemo<SearchSelectOption[]>(
    () => (projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    [projects],
  );
  const programOptions = useMemo<SearchSelectOption[]>(
    () =>
      (programs ?? []).map((g) => ({
        value: g.id,
        label: g.name,
        hint: `${g.projectCount} dự án`,
      })),
    [programs],
  );

  const options: RadioCardOption<DashboardDataScopeValue>[] = (
    ['PROJECT', 'GROUP', 'ORG'] as const
  ).map((s) => {
    const locked = s === 'ORG' && !canOrg;
    const unsupported = !allowed.includes(s);
    return {
      value: s,
      label: DATA_SCOPE_LABEL[s],
      description: unsupported
        ? 'Mẫu này không dùng được với phạm vi này'
        : locked
          ? ORG_SCOPE_LOCKED
          : DATA_SCOPE_HINT[s],
      disabled: locked || unsupported,
      children:
        s === 'PROJECT' ? (
          <SearchSelect
            value={value.scopeProjectId}
            onChange={(v) => onChange({ ...value, dataScope: 'PROJECT', scopeProjectId: v })}
            options={projectOptions}
            placeholder="Chọn dự án…"
            searchPlaceholder="Tìm dự án…"
            ariaLabel="Dự án"
          />
        ) : s === 'GROUP' ? (
          programs && programs.length === 0 ? (
            <p className="text-sm text-muted">
              Bạn chưa có nhóm dự án nào. Tạo nhóm ở trang Dự án (nút “Nhóm”), rồi quay lại đây.
            </p>
          ) : (
            <SearchSelect
              value={value.scopeProgramId}
              onChange={(v) => onChange({ ...value, dataScope: 'GROUP', scopeProgramId: v })}
              options={programOptions}
              placeholder="Chọn nhóm dự án…"
              searchPlaceholder="Tìm nhóm…"
              ariaLabel="Nhóm dự án"
            />
          )
        ) : undefined,
    };
  });

  return (
    <RadioCard
      ariaLabel={ariaLabel}
      value={value.dataScope}
      onChange={(s) => onChange({ ...value, dataScope: s })}
      options={options}
      size="sm"
    />
  );
}
