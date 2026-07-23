import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Các loại field tùy chỉnh (mirror Prisma `CustomFieldType`). */
export type CustomFieldType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'DATE'
  | 'DATETIME'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'CHECKBOX'
  | 'USER'
  | 'URL';

/** Lựa chọn của field SELECT/MULTI_SELECT. API trả `{ id, value, color, order }`. */
export interface CustomFieldOption {
  id: string;
  value: string;
  color?: string | null;
  order?: number;
}

export interface CustomFieldDefinition {
  id: string;
  name: string;
  type: CustomFieldType;
  isRequired: boolean;
  options?: CustomFieldOption[];
}

/** Giá trị đã chuẩn hoá: string | number | boolean | string[] (option ids) | null. */
export type CustomFieldValue = string | number | boolean | string[] | null;

export interface IssueCustomField {
  field: CustomFieldDefinition;
  value: CustomFieldValue;
}

export const issueCustomFieldsKey = (issueId: string) => ['issue-custom-fields', issueId] as const;

/** Field tùy chỉnh + giá trị hiện tại của một issue. */
export function useIssueCustomFields(issueId?: string) {
  return useQuery({
    queryKey: issueCustomFieldsKey(issueId ?? ''),
    queryFn: async () =>
      (await api.get<IssueCustomField[]>(`/issues/${issueId}/custom-fields`)).data,
    enabled: !!issueId,
  });
}

/** Đặt giá trị cho một field; `value` ở dạng raw tuỳ loại field. */
export function useSetCustomField(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { fieldId: string; value: unknown }) =>
      api.put(`/issues/${issueId}/custom-fields/${v.fieldId}`, { value: v.value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: issueCustomFieldsKey(issueId) });
    },
  });
}
