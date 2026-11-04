import { DEFAULT_WORKFLOWS, expandWorkflowTransitions } from '@tirapro/shared';
import type { WorkflowDefaultKey } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';

/**
 * Dữ liệu thử: ba quy trình mặc định (Standard / Bug / Epic) đúng như API tạo — id trạng thái mang tiền tố quy trình nên
 * "To Do" của Standard và "To Do" của Bug là HAI trạng thái khác nhau (như thật). Chỉ dùng trong test.
 */
export function defaultWorkflow(key: WorkflowDefaultKey): Workflow {
  const def = DEFAULT_WORKFLOWS[key];
  const prefix = key.toLowerCase();
  const id = (name: string) => `${prefix}:${name}`;
  return {
    id: `wf-${prefix}`,
    name: def.name,
    description: null,
    isTemplate: false,
    isDefault: key === 'STANDARD',
    projectId: null,
    statuses: def.statuses.map((s, order) => ({
      id: id(s.name),
      name: s.name,
      category: s.category,
      color: null,
      order,
      isInitial: s.isInitial,
    })),
    transitions: expandWorkflowTransitions(def).map((t, order) => ({
      id: `${prefix}-t${order}`,
      name: t.name,
      fromStatusId: t.from === null ? null : id(t.from),
      toStatusId: id(t.to),
      order,
    })),
  };
}

export const statusIdOf = (key: WorkflowDefaultKey, name: string) => `${key.toLowerCase()}:${name}`;
