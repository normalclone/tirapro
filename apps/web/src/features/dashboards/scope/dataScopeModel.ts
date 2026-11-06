import {
  type CustomDashboardDto,
  type DashboardDataScopeValue,
  type DashboardTemplate,
} from '@tirapro/shared';

/** Phạm vi dữ liệu đang chọn trong giao diện (id rỗng = chưa chọn). */
export interface DataScopeValue {
  dataScope: DashboardDataScopeValue;
  scopeProjectId: string;
  scopeProgramId: string;
}

export const DATA_SCOPE_LABEL: Record<DashboardDataScopeValue, string> = {
  PROJECT: 'Một dự án',
  GROUP: 'Một nhóm dự án của tôi',
  ORG: 'Toàn tổ chức',
};

export const DATA_SCOPE_HINT: Record<DashboardDataScopeValue, string> = {
  PROJECT: 'Số liệu của đúng một dự án.',
  GROUP:
    'Gộp các dự án trong một nhóm của bạn — mỗi người xem chỉ thấy phần thuộc dự án họ được xem.',
  ORG: 'Mọi dự án người xem được thấy. Chỉ Quản trị chọn được.',
};

export const ORG_SCOPE_LOCKED = 'Chỉ Quản trị chọn được phạm vi này';

/** Chưa chọn đích thì chưa lưu được (khớp luật `dataScopeRules` của máy chủ). `null` = hợp lệ. */
export function dataScopeIssue(v: DataScopeValue): string | null {
  if (v.dataScope === 'PROJECT' && !v.scopeProjectId) return 'Chọn dự án';
  if (v.dataScope === 'GROUP' && !v.scopeProgramId) return 'Chọn nhóm dự án';
  return null;
}

/** Trường gửi lên máy chủ: chỉ id của phạm vi đang chọn. */
export function toScopeFields(v: DataScopeValue): {
  dataScope: DashboardDataScopeValue;
  scopeProjectId?: string;
  scopeProgramId?: string;
} {
  return {
    dataScope: v.dataScope,
    ...(v.dataScope === 'PROJECT' && v.scopeProjectId ? { scopeProjectId: v.scopeProjectId } : {}),
    ...(v.dataScope === 'GROUP' && v.scopeProgramId ? { scopeProgramId: v.scopeProgramId } : {}),
  };
}

export const sameScope = (a: DataScopeValue, b: DataScopeValue): boolean =>
  a.dataScope === b.dataScope &&
  (a.dataScope !== 'PROJECT' || a.scopeProjectId === b.scopeProjectId) &&
  (a.dataScope !== 'GROUP' || a.scopeProgramId === b.scopeProgramId);

export function scopeValueOf(
  d: Pick<CustomDashboardDto, 'dataScope' | 'scopeProjectId' | 'scopeProgramId'>,
): DataScopeValue {
  return {
    dataScope: d.dataScope,
    scopeProjectId: d.scopeProjectId ?? '',
    scopeProgramId: d.scopeProgramId ?? '',
  };
}

/** Phạm vi chọn sẵn cho một mẫu: phạm vi gợi ý của mẫu, nếu bị khoá (ORG không phải admin) thì phạm vi đầu tiên dùng được. */
export function initialScopeFor(template: DashboardTemplate, canOrg: boolean): DataScopeValue {
  const usable = template.scopes.filter((s) => s !== 'ORG' || canOrg);
  const dataScope = usable.includes(template.defaultScope)
    ? template.defaultScope
    : (usable[0] ?? template.defaultScope);
  return { dataScope, scopeProjectId: '', scopeProgramId: '' };
}
