// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDueDate } from '@tirapro/shared';
import type * as ApiModule from '@/lib/api';
import { formatViDate } from '@/lib/dateInput';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: {
      get: vi.fn().mockRejectedValue(new Error('offline')),
      post: vi.fn(),
      patch: vi.fn(),
    },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useCreateIssueModal } from '@/stores/createIssue';
import { CreateIssueModal } from './CreateIssueModal';

beforeEach(() => {
  // jsdom thiếu vài API mà Radix Dialog dùng
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  for (const [name, value] of [
    ['scrollIntoView', () => undefined],
    ['hasPointerCapture', () => false],
  ] as const)
    Object.defineProperty(Element.prototype, name, { value, configurable: true, writable: true });
});
afterEach(() => {
  cleanup();
  act(() => useCreateIssueModal.getState().close());
});

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreateIssueModal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  act(() => useCreateIssueModal.getState().openCreate());
}

describe('hộp Tạo việc: Hạn điền sẵn ngày mai (giờ VN) và không xoá trống được', () => {
  it('ô Hạn hoàn thành ban đầu hiện NGÀY MAI theo giờ Việt Nam', async () => {
    open();
    const date = await screen.findByLabelText<HTMLInputElement>('Hạn hoàn thành');
    const tomorrow = defaultDueDate(new Date()).slice(0, 10); // yyyy-MM-dd
    expect(date.value).toBe(formatViDate(tomorrow));
    expect(screen.getByLabelText<HTMLInputElement>('Hạn hoàn thành — giờ').value).toBe('17:00');
  });

  it('xoá hết ngày rồi rời ô → điền lại ngày mai (không để trống)', async () => {
    const user = userEvent.setup();
    open();
    const date = await screen.findByLabelText<HTMLInputElement>('Hạn hoàn thành');
    const tomorrow = formatViDate(defaultDueDate(new Date()).slice(0, 10));
    await user.clear(date);
    expect(date.value).toBe('');
    await user.tab(); // rời ô
    expect(date.value).toBe(tomorrow);
  });
});
