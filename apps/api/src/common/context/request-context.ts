import { AsyncLocalStorage } from 'node:async_hooks';

/** Ngữ cảnh request xuyên suốt (REST + worker) — nền cho tenant isolation & logging. */
export interface RequestStore {
  requestId: string;
  userId?: string;
  workspaceId?: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function getStore(): RequestStore | undefined {
  return requestContext.getStore();
}

export function currentWorkspaceId(): string | null | undefined {
  return requestContext.getStore()?.workspaceId;
}
