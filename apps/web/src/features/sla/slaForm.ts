type SlaField = 'name';
export interface SlaFieldIssue {
  field: SlaField;
  message: string;
}

/** Lỗi nhập liệu của hộp "Thêm cam kết" theo trường (quy tắc giữ nguyên: chỉ bắt buộc tên); [] = hợp lệ. */
export function validateSlaForm(f: { name: string }): SlaFieldIssue[] {
  return f.name.trim()
    ? []
    : [{ field: 'name', message: 'Hãy nhập tên cam kết để dễ nhận ra sau này' }];
}
