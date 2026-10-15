import { fmtDate, fmtDateTime } from '@/lib/dateFormat';
import type { CustomFieldDefinition, CustomFieldValue } from './api';

/** Chuỗi hiển thị (chỉ-đọc) của giá trị trường tuỳ chỉnh; `null` = chưa có giá trị. */
export function displayCustomFieldValue(
  field: CustomFieldDefinition,
  value: CustomFieldValue,
): string | null {
  if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  const optionName = (id: string) => field.options?.find((o) => o.id === id)?.value ?? id;
  switch (field.type) {
    case 'CHECKBOX':
      return value === true ? 'Có' : 'Không';
    case 'SELECT':
      return typeof value === 'string' ? optionName(value) : null;
    case 'MULTI_SELECT':
      return Array.isArray(value) ? value.map(optionName).join(', ') : null;
    case 'DATE':
    case 'DATETIME': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return field.type === 'DATE' ? fmtDate(d) : fmtDateTime(d);
    }
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}
