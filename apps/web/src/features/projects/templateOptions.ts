import {
  DEFAULT_WORKFLOW_TEMPLATES,
  PROJECT_TEMPLATES,
  type ProjectTemplateDef,
} from '@tirapro/types';

export interface TemplateOption extends ProjectTemplateDef {
  /** Tên các bước của quy trình theo thứ tự cột (hiện thành dải chip trên thẻ chọn mẫu). */
  steps: string[];
}

/** Ba mẫu dự án kèm các bước quy trình lấy từ cùng hằng số mà API dùng để sinh quy trình/cột. */
export function templateOptions(): TemplateOption[] {
  return PROJECT_TEMPLATES.map((t) => {
    const wf = DEFAULT_WORKFLOW_TEMPLATES.find((w) => w.name === t.workflowName);
    const steps = [...(wf?.statuses ?? [])].sort((a, b) => a.order - b.order).map((s) => s.name);
    return { ...t, steps };
  });
}
