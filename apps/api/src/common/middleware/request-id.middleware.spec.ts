import { describe, expect, it, vi } from 'vitest';
import { getStore } from '../context/request-context';
import { RequestIdMiddleware, resolveRequestId } from './request-id.middleware';

function makeReq(headers: Record<string, string> = {}) {
  return { headers, id: undefined as string | undefined } as never;
}

describe('RequestIdMiddleware', () => {
  it('mở AsyncLocalStorage với requestId trong suốt chuỗi next()', async () => {
    const setHeader = vi.fn();
    let seen: ReturnType<typeof getStore>;
    const next = () => {
      // bất đồng bộ vẫn giữ context
      return Promise.resolve().then(() => {
        seen = getStore();
      });
    };
    const req = makeReq({ 'x-request-id': 'abc-123' });
    new RequestIdMiddleware().use(req, { setHeader } as never, next as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual({ requestId: 'abc-123', userId: undefined, workspaceId: undefined });
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'abc-123');
    expect(getStore()).toBeUndefined(); // ngoài request không rò context
  });

  it('guard điền userId/workspaceId vào đúng store của request', () => {
    const req = makeReq();
    new RequestIdMiddleware().use(req, { setHeader: vi.fn() } as never, (() => {
      const store = getStore()!;
      store.userId = 'u1';
      store.workspaceId = 'w1';
      expect(getStore()).toMatchObject({ userId: 'u1', workspaceId: 'w1' });
    }) as never);
  });
});

describe('resolveRequestId', () => {
  it('dùng header hợp lệ, sinh mới khi thiếu hoặc quá dài', () => {
    expect(resolveRequestId({ headers: { 'x-request-id': 'rid-1' } } as never)).toBe('rid-1');
    const generated = resolveRequestId({ headers: {} } as never);
    expect(generated.length).toBeGreaterThan(8);
    expect(resolveRequestId({ headers: { 'x-request-id': 'x'.repeat(65) } } as never)).not.toBe('x'.repeat(65));
  });
});
